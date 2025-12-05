// Call Center WFM Pro - Advanced Forecast & Dashboard Logic

const CONFIG = {
    MAX_SEARCH_ADDITION: 20000,
    HISTORY_DAYS: 365,
    STORAGE_KEY: 'wfm_history_data_v1', // Reverted to restore user data
    OPERATING_HOURS: 13 // Assumption: Calls are spread over ~13 active hours, not 24
};

// State
let state = {
    historyData: {} // 'YYYY-MM-DD': { calls, agents, talkTime, sl }
};

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    initTabs();
    initCalculator(); // The manual calculator logic
    initHistoryTable();
    initPlanning(); // The forecast logic
    renderDashboard();
});

// --- Helper for Date Keys (Local Time) ---
function getLocalDateKey(date) {
    // Returns YYYY-MM-DD for the local time of the date object
    const offset = date.getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() - offset);
    return localDate.toISOString().split('T')[0];
}

// --- Tab Logic ---
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view-section');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.target;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            views.forEach(v => {
                v.classList.remove('active');
                v.style.display = 'none';
            });
            const targetView = document.getElementById(targetId);
            targetView.style.display = 'block';
            setTimeout(() => targetView.classList.add('active'), 10);

            // Refresh dashboard if opened
            if (targetId === 'dashboard-view') renderDashboard();
        });
    });
}

// --- Data Management ---
function loadHistory() {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (stored) {
        try {
            state.historyData = JSON.parse(stored);
        } catch (e) {
            console.error('Data load error', e);
        }
    }
}

function saveHistory() {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.historyData));
    alert('Veriler başarıyla kaydedildi ve analiz edildi.');
    renderDashboard();
}

function clearHistory() {
    if (confirm('Tüm geçmiş veriler silinecek?')) {
        state.historyData = {};
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        // Refresh table
        const inputs = document.querySelectorAll('#history-table .table-input');
        inputs.forEach(i => i.value = '');
        renderDashboard();
    }
}

// --- Forecast / Planning Logic ---
function initPlanning() {
    document.getElementById('generate-forecast-btn').addEventListener('click', generateForecast);
}

function generateForecast() {
    const tbody = document.getElementById('forecast-table-body');
    const targetSL = parseInt(document.getElementById('forecast-sl-target').value) || 80;

    tbody.innerHTML = '';

    // Start from December 1st (Month 11)
    const startDate = new Date(new Date().getFullYear(), 11, 1);

    let totalCalls = 0;
    let totalAgents = 0;
    let dayCount = 0;

    // Generate for 31 days (Dec 1 - Dec 31)
    for (let i = 0; i < 31; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);

        const dateStr = d.toLocaleDateString('tr-TR');
        const dayName = d.toLocaleDateString('tr-TR', { weekday: 'long' });

        // Prediction Logic
        const prediction = predictForWeekday(d.getDay());

        // Calculate Requirement
        const result = calculateRequirement(prediction.calls, prediction.aht, targetSL);

        // Visuals
        const row = document.createElement('tr');
        if ([0, 6].includes(d.getDay())) row.classList.add('weekend');

        row.innerHTML = `
            <td>${dateStr}</td>
            <td class="day-cell">${dayName}</td>
            <td>${Math.round(prediction.calls).toLocaleString()}</td>
            <td>${Math.round(prediction.aht)} sn</td>
            <td style="font-weight:bold; color:var(--accent-color); font-size:1.1rem;">${result.requiredAgents}</td>
            <td>${result.tve.toFixed(2)}</td>
        `;
        tbody.appendChild(row);

        totalCalls += prediction.calls;
        totalAgents += result.requiredAgents;
        dayCount++;
    }

    // Update Summary
    document.getElementById('forecast-summary').style.display = 'grid';
    document.getElementById('total-forecast-calls').textContent = Math.round(totalCalls).toLocaleString();

    // Average Daily Requirement
    const avgReq = dayCount ? Math.round(totalAgents / dayCount) : 0;
    document.getElementById('avg-required-agents').textContent = avgReq;
}

function predictForWeekday(dayIndex) {
    // Collect entries
    const entries = Object.entries(state.historyData);

    // Find matching days
    const matches = [];
    for (let [date, data] of entries) {
        let calls = parseInt(data.calls) || 0;
        let aht = parseInt(data.aht) || 0;
        let talkTimeHours = parseInt(data.talkTime) || 0; // Treated as hours

        if (calls <= 0) continue;

        // Auto-calculate AHT (Hours to Seconds)
        if (aht === 0 && talkTimeHours > 0) {
            aht = (talkTimeHours * 3600) / calls;
        }

        if (aht <= 0) continue;

        const d = new Date(date);
        if (d.getDay() === dayIndex) {
            matches.push({ calls, aht });
        }
    }

    if (matches.length === 0) {
        return { calls: 0, aht: 0 };
    }

    const avgCalls = matches.reduce((sum, m) => sum + m.calls, 0) / matches.length;
    const avgAht = matches.reduce((sum, m) => sum + m.aht, 0) / matches.length;

    return { calls: avgCalls, aht: avgAht };
}


function calculateRequirement(calls, aht, targetSL) {
    if (calls <= 0 || aht <= 0) return { requiredAgents: 0, tve: 0 };

    // Advanced Traffic Calculation (Operating Hours)
    const effectiveSeconds = CONFIG.OPERATING_HOURS * 3600;
    const traffic = (calls * aht) / effectiveSeconds;

    if (traffic <= 0) return { requiredAgents: 0, tve: 0 };

    let agents = Math.floor(traffic) + 1;
    let sl = 0;
    const slTime = 20;

    // Search
    for (let k = 0; k < 5000; k++) {
        sl = calculateServiceLevel(traffic, agents, slTime, aht);
        if (sl * 100 >= targetSL) break;
        agents++;
    }

    const tve = (aht * sl) / agents;
    // Shrinkage 30%
    const netAgents = Math.ceil(agents / 0.7);

    return { requiredAgents: netAgents, tve };
}

// --- Erlang Math ---
function calculateErlangC(traffic, agents) {
    if (agents <= traffic) return 1;
    let erlangB = 1.0;
    for (let i = 1; i <= Math.floor(traffic); i++) {
        erlangB = (traffic * erlangB) / (i + traffic * erlangB);
    }
    for (let i = Math.floor(traffic) + 1; i <= agents; i++) {
        erlangB = (traffic * erlangB) / (i + traffic * erlangB);
    }

    const numerator = agents * erlangB;
    const denominator = agents - traffic * (1 - erlangB);
    return (denominator <= 0) ? 1 : numerator / denominator;
}

function calculateServiceLevel(traffic, agents, targetTime, aht) {
    let pw = calculateErlangC(traffic, agents);
    if (pw > 1) pw = 1; if (pw < 0) pw = 0;
    return 1 - (pw * Math.exp(-(agents - traffic) * (targetTime / aht)));
}

function factorial(n) {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

// --- Dashboard Logic ---
function renderDashboard() {
    const entries = Object.values(state.historyData).filter(d => (parseInt(d.calls) || 0) > 0);

    let totalCalls = 0;
    let totalAhtWeighted = 0;
    let totalSlWeighted = 0;
    let totalAgents = 0;
    let count = 0;

    entries.forEach(d => {
        const calls = parseInt(d.calls) || 0;
        const agents = parseInt(d.agents) || 0;
        const talkTimeHours = parseInt(d.talkTime) || 0;
        const sl = parseInt(d.sl) || 0;

        let aht = parseInt(d.aht) || 0;
        if (aht === 0 && talkTimeHours > 0 && calls > 0) aht = (talkTimeHours * 3600) / calls;

        let tve = 0;
        if (agents > 0) tve = (aht * (sl / 100)) / agents;

        totalCalls += calls;
        totalAhtWeighted += (calls * aht);
        totalSlWeighted += (calls * sl);
        totalAgents += agents;

        count++;
    });

    const avgCalls = count ? (totalCalls / count) : 0;
    const avgAht = totalCalls ? (totalAhtWeighted / totalCalls) : 0;
    const avgSl = totalCalls ? (totalSlWeighted / totalCalls) : 0;
    const avgAgents = count ? (totalAgents / count) : 0;

    // Avg TVE
    const tveArr = entries.map(d => {
        let a = parseInt(d.aht) || 0;
        if (a === 0 && d.talkTime && d.calls) a = (d.talkTime * 3600) / d.calls;
        let s = parseInt(d.sl) || 0;
        let ag = parseInt(d.agents) || 1;
        return (a * (s / 100)) / ag;
    });
    const avgTve = tveArr.length ? tveArr.reduce((a, b) => a + b, 0) / tveArr.length : 0;

    const elCalls = document.getElementById('dash-avg-calls');
    if (elCalls) elCalls.textContent = Math.round(avgCalls).toLocaleString();

    const elAht = document.getElementById('dash-avg-aht');
    if (elAht) elAht.textContent = Math.round(avgAht) + ' sn';

    const elTve = document.getElementById('dash-avg-tve');
    if (elTve) elTve.textContent = avgTve.toFixed(2);

    const elSl = document.getElementById('dash-avg-sl');
    if (elSl) elSl.textContent = '%' + avgSl.toFixed(1);

    const elAgents = document.getElementById('dash-avg-agents');
    if (elAgents) elAgents.textContent = Math.round(avgAgents);

    // Chart
    const container = document.getElementById('history-chart-container');
    if (container) {
        container.innerHTML = '';
        const sortedKeys = Object.keys(state.historyData).sort().slice(-30);
        const maxCalls = Math.max(...sortedKeys.map(k => parseInt(state.historyData[k].calls) || 0), 100);

        sortedKeys.forEach(date => {
            const data = state.historyData[date];
            const calls = parseInt(data.calls) || 0;
            const height = (calls / maxCalls) * 100;
            const bar = document.createElement('div');
            bar.className = 'dash-bar';
            bar.style.height = `${height}%`;
            bar.title = `${date}: ${calls} calls`;
            container.appendChild(bar);
        });
    }
}

// --- History Table ---
function initHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const today = new Date();
    // 365 days
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const isoDate = getLocalDateKey(d);

        const dayIndex = d.getDay();
        const row = document.createElement('tr');
        if (dayIndex === 0 || dayIndex === 6) row.classList.add('weekend');

        const data = state.historyData[isoDate] || {};

        row.innerHTML = `
            <td>${d.toLocaleDateString('tr-TR')}</td>
            <td class="day-cell">${d.toLocaleDateString('tr-TR', { weekday: 'long' })}</td>
            <td><input type="number" class="table-input" data-field="calls" data-date="${isoDate}" value="${data.calls || ''}" placeholder="0"></td>
            <td><input type="number" class="table-input" data-field="agents" data-date="${isoDate}" value="${data.agents || ''}" placeholder="0"></td>
            <td><input type="number" class="table-input" data-field="talkTime" data-date="${isoDate}" value="${data.talkTime || ''}" placeholder="0"></td>
            <td><input type="number" class="table-input" data-field="sl" data-date="${isoDate}" value="${data.sl || ''}" placeholder="0"></td>
        `;

        tbody.appendChild(row);
    }

    tbody.addEventListener('input', (e) => {
        if (e.target.classList.contains('table-input')) {
            const date = e.target.dataset.date;
            const field = e.target.dataset.field;
            let value = e.target.value;

            if (!state.historyData[date]) state.historyData[date] = {};
            state.historyData[date][field] = value;
        }
    });

    document.getElementById('save-history').addEventListener('click', saveHistory);
    document.getElementById('reset-history').addEventListener('click', clearHistory);

    document.getElementById('load-sample-data').addEventListener('click', () => {
        // Generate mock data
        for (let k = 0; k < 60; k++) {
            const d = new Date();
            d.setDate(today.getDate() - k);
            const iso = getLocalDateKey(d);
            const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
            if (!state.historyData[iso]) state.historyData[iso] = {};

            state.historyData[iso].calls = isWeekend ? 800 + Math.floor(Math.random() * 400) : 2500 + Math.floor(Math.random() * 1000);
            // Hours
            state.historyData[iso].talkTime = Math.floor((state.historyData[iso].calls * (180 + Math.random() * 40)) / 3600);
            state.historyData[iso].sl = 70 + Math.floor(Math.random() * 25);
            state.historyData[iso].agents = isWeekend ? 10 : 35;
        }
        initHistoryTable();
        alert('Son 2 ay için örnek veriler yüklendi.');
    });
}

// --- Manual Calculator (Existing Logic) ---
function initCalculator() {
    const ids = ['calls-range', 'calls', 'aht-range', 'aht'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', syncManualCalc);
    });
    syncManualCalc();
}

function syncManualCalc() {
    document.getElementById('calls').value = document.getElementById('calls-range').value;
    document.getElementById('aht').value = document.getElementById('aht-range').value;

    const calls = parseInt(document.getElementById('calls').value);
    const aht = parseInt(document.getElementById('aht').value);

    // Manual calc assumes 24h spread for basic Erlang
    // Or should we use the new Operating Hours logic?
    // User wants "Anlık Hesaplama Simülatörü" likely to be standard.
    // Let's stick to standard 24h for the simple slider tool unless requested otherwise.
    // Or align it with Forecast for consistency?
    // Let's align it with a milder factor (e.g. 18h) or keep 24h. 
    // Keeping 24h (86400) for now as it matches the labels "24 Saat (Günlük)".

    const res = calculateRequirementSimple(calls, aht, 80);

    document.getElementById('req-agents').textContent = res.requiredAgents;
    const traff = (calls * aht) / 86400;
    const sl = calculateServiceLevel(traff, Math.ceil(res.requiredAgents * 0.7), 20, aht);
    document.getElementById('est-sl').textContent = '%' + (sl * 100).toFixed(1);
}

function calculateRequirementSimple(calls, aht, targetSL) {
    // Simple 24h calc for the slider tool
    const traffic = (calls * aht) / 86400;
    if (traffic <= 0) return { requiredAgents: 0 };
    let agents = Math.floor(traffic) + 1;
    let sl = 0;
    for (let k = 0; k < 1000; k++) {
        sl = calculateServiceLevel(traffic, agents, 20, aht);
        if (sl * 100 >= targetSL) break;
        agents++;
    }
    const netAgents = Math.ceil(agents / 0.7);
    return { requiredAgents: netAgents };
}
