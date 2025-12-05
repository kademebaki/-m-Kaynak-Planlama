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
    state.historyData = {}; // Start fresh
    const keysToCheck = [CONFIG.STORAGE_KEY, 'wfm_history_data_v2', 'wfm_history_data']; // Priority order
    let totalLoaded = 0;

    console.log('Starting comprehensive data recovery...');

    // Diagnostic: Tell user what keys exist
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        allKeys.push(localStorage.key(i));
    }
    // Only alert if we suspect data loss issues (which we do now)
    if (allKeys.length > 0) {
        console.log("Current LocalStorage Keys:", allKeys);
        // alert("Bulunan Kayıt Anahtarları: " + allKeys.join(", ")); // Uncomment to debug on screen
    }

    keysToCheck.forEach(key => {
        const raw = localStorage.getItem(key);
        if (raw && raw !== '{}' && raw !== 'null') {
            try {
                const parsed = JSON.parse(raw);
                const count = Object.keys(parsed).length;
                if (count > 0) {
                    console.log(`Found ${count} records in ${key}. Merging...`);
                    // Merge strategy: Spread new data over existing. 
                    // This creates a union of all data found across all keys.
                    state.historyData = { ...state.historyData, ...parsed };
                    totalLoaded += count; // Just for counting, true unique count is Object.keys(state.historyData).length
                }
            } catch (e) {
                console.error(`Error parsing ${key}:`, e);
            }
        }
    });

    const finalCount = Object.keys(state.historyData).length;

    if (finalCount > 0) {
        console.log(`Recovery complete. Total unique merged records: ${finalCount}`);
        // Save the merged state back to the primary key to consolidate immediately
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.historyData));

        // Let user know if we recovered something significant
        // alert(`Data Recovery Report: ${finalCount} records found and merged.`);
        renderDashboard();
    } else {
        console.warn('Scanned all keys but found no data at all.');
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

    // Start from January 1, 2025 (Month 0)
    const startDate = new Date(2025, 0, 1);

    let totalCalls = 0;
    let totalAgents = 0;
    let dayCount = 0;
    let perfectAccuracyCount = 0;

    // Generate for Jan 1, 2025 to Jan 31, 2026 (396 days)
    for (let i = 0; i < 396; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);

        const isoDate = getLocalDateKey(d);
        const dateStr = d.toLocaleDateString('tr-TR');
        const dayName = d.toLocaleDateString('tr-TR', { weekday: 'long' });

        // Retrieve Actual Data
        const actualData = state.historyData[isoDate] || {};
        const actualCalls = parseInt(actualData.calls) || 0;
        const actualAgents = parseInt(actualData.agents) || 0;
        const actualSl = parseInt(actualData.sl) || 0;

        // Prediction Logic
        const prediction = predictForWeekday(d.getDay());

        // Calculate Requirement
        const result = calculateRequirement(prediction.calls, prediction.aht, targetSL);

        // Difference Calculation (Actual - Required)
        const diff = actualAgents - result.requiredAgents;
        let diffClass = '';
        let diffStr = '-';
        if (actualAgents > 0) {
            diffStr = diff > 0 ? `+${diff}` : `${diff}`;
            diffClass = diff >= 0 ? 'text-success' : 'text-danger';
        }

        // Success Rate Calculation (Realization %)
        let successRateStr = '-';
        let rate = 0;
        if (result.requiredAgents > 0 && actualAgents > 0) {
            rate = (actualAgents / result.requiredAgents);
            successRateStr = '%' + (rate * 100).toFixed(0);

            // Check for Perfect Accuracy (100% - 105%)
            // 1.00 <= rate <= 1.05
            if (rate >= 1.00 && rate <= 1.05) {
                perfectAccuracyCount++;
                successRateStr += ' ⭐'; // Mark visual indicator
            }
        }

        // Inline styles for difference
        const diffStyle = diff >= 0 ? 'color: var(--success-color); font-weight:bold;' : 'color: var(--danger-color); font-weight:bold;';

        // Visuals
        const row = document.createElement('tr');
        if ([0, 6].includes(d.getDay())) row.classList.add('weekend');

        row.innerHTML = `
            <td>${dateStr}</td>
            <td class="day-cell">${dayName}</td>
            <td>${Math.round(prediction.calls).toLocaleString()}</td>
            <td style="color:var(--text-secondary);">${actualCalls > 0 ? actualCalls.toLocaleString() : '-'}</td>
            <td style="font-weight:bold; color:var(--accent-color); font-size:1.1rem;">${result.requiredAgents}</td>
            <td style="font-weight:bold;">${actualAgents > 0 ? actualAgents : '-'}</td>
            <td style="${actualAgents > 0 ? diffStyle : ''}">${actualAgents > 0 ? diffStr : '-'}</td>
            <td style="font-weight:bold;">${successRateStr}</td>
            <td>${actualSl > 0 ? '%' + actualSl : '-'}</td>
        `;
        tbody.appendChild(row);

        totalCalls += prediction.calls;
        totalAgents += result.requiredAgents;
        dayCount++;
    }

    // Update Summary
    document.getElementById('forecast-summary').style.display = 'grid';

    // Calculate Average Monthly Calls (Daily Avg * 30)
    const avgMonthlyCalls = dayCount ? (totalCalls / dayCount) * 30 : 0;
    document.getElementById('total-forecast-calls').textContent = Math.round(avgMonthlyCalls).toLocaleString();

    // Average Daily Requirement
    const avgReq = dayCount ? Math.round(totalAgents / dayCount) : 0;
    document.getElementById('avg-required-agents').textContent = avgReq;

    // Update Perfect Accuracy Count
    document.getElementById('perfect-accuracy-days').textContent = perfectAccuracyCount;

    // Perform Optimization Analysis
    analyzeStaffing(targetSL);
}

// --- Agent Analysis Logic ---
function analyzeStaffing(targetSL) {
    const tbody = document.getElementById('recommendation-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const dayStats = {}; // { 1: { diffSum: 0, count: 0, slSum: 0, agentSum: 0 }, ... }

    // Initialize stats
    for (let i = 1; i <= 31; i++) {
        dayStats[i] = { diffSum: 0, count: 0, slSum: 0, agentSum: 0 };
    }

    // Iterate through ALL history data
    const keys = Object.keys(state.historyData);
    keys.forEach(date => {
        const d = state.historyData[date];
        const calls = parseInt(d.calls) || 0;
        const actualAgents = parseInt(d.agents) || 0;
        const aht = parseInt(d.aht) || 0;
        const talkTime = parseInt(d.talkTime) || 0;
        const sl = parseFloat(d.sl) || 0;

        // Skip if no volume or agents
        if (calls <= 0 || actualAgents <= 0) return;

        // Determine effective AHT
        let effectiveAht = aht;
        if (effectiveAht === 0 && talkTime > 0 && calls > 0) {
            effectiveAht = (talkTime * 3600) / calls;
        }
        if (effectiveAht === 0) effectiveAht = 300; // Default fallback

        // Calculate Requirement for that historical day
        const req = calculateRequirement(calls, effectiveAht, targetSL);
        const diff = actualAgents - req.requiredAgents;

        // Group by Day of Month (1-31)
        const dateObj = new Date(date);
        const dayOfMonth = dateObj.getDate();

        if (dayStats[dayOfMonth]) {
            dayStats[dayOfMonth].diffSum += diff;
            dayStats[dayOfMonth].slSum = (dayStats[dayOfMonth].slSum || 0) + sl;
            dayStats[dayOfMonth].agentSum += actualAgents;
            dayStats[dayOfMonth].count++;
        }
    });

    let hasRecommendations = false;
    const significantDays = [];

    // Analyze Results
    for (let i = 1; i <= 31; i++) {
        const stat = dayStats[i];
        if (stat.count < 2) continue; // Need at least 2 data points for a trend

        const avgDiff = stat.diffSum / stat.count;
        const avgSl = (stat.slSum || 0) / stat.count;
        const avgAgents = stat.agentSum / stat.count;

        let status = 'Dengeli';
        let color = 'var(--text-secondary)';
        let recommendation = 'Mevcut seviye uygun.';

        // Thresholds for recommendations
        if (avgDiff >= 1 && avgSl >= 86) {
            status = 'Fazla Temsilci';
            color = 'var(--danger-color)';
            recommendation = `Ortalama **${Math.round(avgDiff)}** kişi azaltılabilir.`;
            significantDays.push({ day: i, type: 'surplus', amount: avgDiff });
        } else if (avgDiff <= -0.5) {
            status = 'Eksik Temsilci';
            color = 'var(--accent-color)';
            recommendation = `Ortalama **${Math.abs(Math.round(avgDiff))}** kişi artırılmalı.`;
            significantDays.push({ day: i, type: 'deficit', amount: Math.abs(avgDiff) });
        } else {
            // Balanced, skip row to avoid clutter? Or show OK? 
            // Let's only show significant items to keep it clean.
            continue;
        }

        hasRecommendations = true;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>Ayın ${i}. Günü</td>
            <td style="color:${color}; font-weight:bold;">${status}</td>
            <td>${Math.round(avgAgents)}</td>
            <td>${Math.round(avgDiff) > 0 ? '+' : ''}${Math.round(avgDiff)}</td>
            <td>%${avgSl.toFixed(1)}</td>
            <td>${recommendation}</td>
        `;
        tbody.appendChild(row);
    }

    // Cross-Shift Recommendations (Münakale)
    if (significantDays.length > 0) {
        const surpluses = significantDays.filter(d => d.type === 'surplus');
        const deficits = significantDays.filter(d => d.type === 'deficit');

        if (surpluses.length > 0 && deficits.length > 0) {
            // Sort by magnitude
            surpluses.sort((a, b) => b.amount - a.amount);
            deficits.sort((a, b) => b.amount - a.amount);

            const row = document.createElement('tr');
            row.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            row.innerHTML = `
                <td colspan="6" style="padding:1rem; text-align:left;">
                    <strong>💡 Münakale Önerisi:</strong><br>
                    Ayın <b>${surpluses[0].day}.</b> günündeki fazlalık, <b>${deficits[0].day}.</b> günündeki eksikliği kapatmak için kaydırılabilir.
                </td>
            `;
            tbody.prepend(row);
        }
    }

    if (!hasRecommendations) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem;">Kayda değer bir sistemsel sapma tespit edilemedi.</td></tr>';
    }
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

    // Traffic Intensity Calculation
    // Erlang C needs traffic in "Erlangs" (Call Minutes / Interval Minutes)
    // If input is Daily Calls, we need to estimate Peak Hour Traffic.
    // Typical Rule of Thumb: ~10-15% of daily volume occurs in the peak hour.
    // Let's assume 12% peak hour factor (0.12).

    // Peak Hour Calls = calls * 0.12
    // Traffic in Erlangs = (PeakCalls * AHT) / 3600

    const peakHourRatio = 0.14; // Slightly aggressive peak factor
    const peakCalls = calls * peakHourRatio;
    const traffic = (peakCalls * aht) / 3600;

    if (traffic <= 0) return { requiredAgents: 0, tve: 0 };

    let agents = Math.floor(traffic) + 1;
    let sl = 0;
    const slTime = 20;

    // Search for required agents
    for (let k = 0; k < 5000; k++) {
        sl = calculateServiceLevel(traffic, agents, slTime, aht);
        if (sl * 100 >= targetSL) break;
        agents++;
    }

    const tve = (aht * sl) / agents;

    // Shrinkage & Efficiency Buffer
    // Real world agents aren't 100% productive every second of the hour on phone.
    // Plus breaks, training, shrinkage (sick, etc).
    // Let's assume net availability is ~70%.
    const netAgents = Math.ceil(agents / 0.70); // More realistic shrinkage

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
    console.log("Rendering Dashboard...");
    const allKeys = Object.keys(state.historyData).sort();

    // Debug: Check keys
    console.log(`Found ${allKeys.length} total history records.`);
    if (allKeys.length > 0) {
        console.log("Sample Keys:", allKeys.slice(-5));
        console.log("Sample Data (Last):", state.historyData[allKeys[allKeys.length - 1]]);
    }

    // Filter to only days with data (calls > 0)
    const keysWithData = allKeys.filter(date => {
        const d = state.historyData[date];
        return (parseInt(d.calls) || 0) > 0;
    });

    // Use the last 30 days that actually have data
    const sortedKeys = keysWithData.slice(-30);
    const chartData = [];

    sortedKeys.forEach(date => {
        const d = state.historyData[date];
        const calls = parseInt(d.calls) || 0;
        const agents = parseInt(d.agents) || 0;
        const sl = parseFloat(d.sl) || 0;
        const talkTimeHours = parseInt(d.talkTime) || 0; // Assuming input is hours? Or seconds?
        // Note: In handleExcelUpload we treated it as simple int.

        let aht = parseInt(d.aht) || 0;
        // Auto-calculate AHT if missing but we have TalkTime(hours) and Calls
        // If talkTime is hours: (talkTime * 3600) / calls
        if (aht === 0 && talkTimeHours > 0 && calls > 0) {
            aht = Math.round((talkTimeHours * 3600) / calls);
        }

        chartData.push({
            date: date,
            calls: calls,
            aht: aht,
            sl: sl,
            agents: agents
        });
    });

    console.log("Chart Data Prepared:", chartData);

    // KPI Aggregates (using ALL data with calls > 0)
    // We need keys to determine Day of Week
    const allValidKeys = Object.keys(state.historyData).filter(k => (parseInt(state.historyData[k].calls) || 0) > 0);

    let totalCalls = 0;
    let totalAgents = 0;
    let totalAhtWeighted = 0;
    let totalSlWeighted = 0;
    let totalTveWeighted = 0;

    // Weekly Breakdown Stats
    let weekdayCalls = 0, weekdayCount = 0;
    let satCalls = 0, satCount = 0;
    let sunCalls = 0, sunCount = 0;

    allValidKeys.forEach(key => {
        const d = state.historyData[key];
        const calls = parseInt(d.calls) || 0;
        const agents = parseInt(d.agents) || 0;
        const sl = parseFloat(d.sl) || 0;
        const talkTimeHours = parseInt(d.talkTime) || 0;
        let aht = parseInt(d.aht) || 0;

        if (aht === 0 && talkTimeHours > 0 && calls > 0) {
            aht = (talkTimeHours * 3600) / calls;
        }

        let tve = 0;
        if (agents > 0) tve = (aht * (sl / 100)) / agents;

        totalCalls += calls;
        totalAgents += agents;
        totalAhtWeighted += (calls * aht);
        totalSlWeighted += (calls * sl);
        if (tve > 0) totalTveWeighted += (calls * tve);

        // Day Breakdown
        const dateObj = new Date(key);
        const dayIdx = dateObj.getDay(); // 0=Sun, 6=Sat

        if (dayIdx === 0) {
            sunCalls += calls;
            sunCount++;
        } else if (dayIdx === 6) {
            satCalls += calls;
            satCount++;
        } else {
            weekdayCalls += calls;
            weekdayCount++;
        }
    });

    const count = allValidKeys.length;
    const avgCalls = count ? (totalCalls / count) : 0;
    const avgAht = totalCalls ? (totalAhtWeighted / totalCalls) : 0;
    const avgSl = totalCalls ? (totalSlWeighted / totalCalls) : 0;
    const avgAgents = count ? (totalAgents / count) : 0;
    const avgTve = totalCalls ? (totalTveWeighted / totalCalls) : 0;

    // Breakdown Averages
    const avgWeekday = weekdayCount ? (weekdayCalls / weekdayCount) : 0;
    const avgSat = satCount ? (satCalls / satCount) : 0;
    const avgSun = sunCount ? (sunCalls / sunCount) : 0;

    // Update KPI Cards
    if (document.getElementById('dash-avg-calls')) document.getElementById('dash-avg-calls').textContent = Math.round(avgCalls).toLocaleString();
    if (document.getElementById('dash-avg-aht')) document.getElementById('dash-avg-aht').textContent = Math.round(avgAht) + ' sn';
    if (document.getElementById('dash-avg-tve')) document.getElementById('dash-avg-tve').textContent = avgTve.toFixed(2);
    if (document.getElementById('dash-avg-sl')) document.getElementById('dash-avg-sl').textContent = '%' + avgSl.toFixed(1);
    if (document.getElementById('dash-avg-agents')) document.getElementById('dash-avg-agents').textContent = Math.round(avgAgents);

    // Update Weekly Breakdown Cards
    if (document.getElementById('dash-weekday-calls')) document.getElementById('dash-weekday-calls').textContent = Math.round(avgWeekday).toLocaleString();
    if (document.getElementById('dash-sat-calls')) document.getElementById('dash-sat-calls').textContent = Math.round(avgSat).toLocaleString();
    if (document.getElementById('dash-sun-calls')) document.getElementById('dash-sun-calls').textContent = Math.round(avgSun).toLocaleString();

    // Render Charts
    renderChart('chart-calls', 'y-axis-calls', 'x-axis-calls', chartData, 'calls', '#4f46e5', 'Adet');
    renderChart('chart-aht', 'y-axis-aht', 'x-axis-aht', chartData, 'aht', '#10b981', 'Sn');
    renderChart('chart-sl', 'y-axis-sl', null, chartData, 'sl', '#f59e0b', '%');
    renderChart('chart-agents', 'y-axis-agents', null, chartData, 'agents', '#ec4899', 'Kişi');
}

function renderChart(chartId, yAxisId, xAxisId, data, key, color, unit) {
    const container = document.getElementById(chartId);
    const yAxisContainer = document.getElementById(yAxisId);
    const xAxisContainer = xAxisId ? document.getElementById(xAxisId) : null;

    if (!container) return;

    container.innerHTML = '';
    if (yAxisContainer) yAxisContainer.innerHTML = '';
    if (xAxisContainer) xAxisContainer.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<div style="width:100%; text-align:center; color:var(--text-secondary); padding-top:20px;">Veri Yok</div>';
        return;
    }

    // Find Max Value safely
    const values = data.map(d => d[key]);
    const rawMax = Math.max(...values, 10); // Default to 10 if all are 0

    // Prevent Infinity/NaN
    const safeMax = isFinite(rawMax) ? rawMax : 100;

    // Nice number rounding
    const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)));
    const normalized = safeMax / magnitude;
    let niceMultiplier;

    if (normalized <= 1) niceMultiplier = 1;
    else if (normalized <= 2) niceMultiplier = 2;
    else if (normalized <= 5) niceMultiplier = 5;
    else niceMultiplier = 10;

    const maxValue = niceMultiplier * magnitude;

    // Draw Y Axis
    if (yAxisContainer) {
        yAxisContainer.innerHTML = `
            <div>${maxValue.toLocaleString()}</div>
            <div>${(maxValue * 0.75).toLocaleString()}</div>
            <div>${(maxValue * 0.5).toLocaleString()}</div>
            <div>${(maxValue * 0.25).toLocaleString()}</div>
            <div>0</div>
        `;
    }

    // Draw Bars
    data.forEach((d, index) => {
        const val = d[key] || 0;
        const height = (val / maxValue) * 100;

        const bar = document.createElement('div');
        bar.className = 'dash-bar';
        bar.style.height = `${Math.min(height, 100)}%`; // Cap at 100%
        bar.style.backgroundColor = color;
        bar.style.opacity = '0.8';
        bar.style.flex = '1';
        bar.title = `${d.date}: ${val} ${unit}`;

        bar.onmouseover = () => bar.style.opacity = '1';
        bar.onmouseout = () => bar.style.opacity = '0.8';

        container.appendChild(bar);
    });

    // X-Axis
    if (xAxisContainer) {
        data.forEach((d, index) => {
            const labelBox = document.createElement('div');
            labelBox.style.flex = '1';
            labelBox.style.textAlign = 'center';
            labelBox.style.fontSize = '0.7rem';
            labelBox.style.overflow = 'hidden';
            labelBox.style.whiteSpace = 'nowrap';

            // Smart X-Axis Labeling
            const step = Math.ceil(data.length / 6);
            if (index % step === 0) {
                const dateParts = d.date.split('-');
                if (dateParts.length === 3) {
                    labelBox.textContent = `${dateParts[1]}/${dateParts[2]}`; // MM/DD
                } else {
                    labelBox.textContent = d.date;
                }
            } else {
                labelBox.innerHTML = '&nbsp;';
            }
            xAxisContainer.appendChild(labelBox);
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
            const value = e.target.value;

            if (!state.historyData[date]) state.historyData[date] = {};
            state.historyData[date][field] = value;
        }
    });

    document.getElementById('save-history').addEventListener('click', saveHistory);

    // Excel Upload Logic
    document.getElementById('excel-upload').addEventListener('change', handleExcelUpload);
}

function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
            raw: false, // Parse dates as strings if possible
            dateNF: 'yyyy-mm-dd',
            defval: ''
        });

        console.log("Excel Raw Data (First 3 rows):", jsonData.slice(0, 3));

        if (jsonData.length === 0) {
            alert("Excel dosyasında veri bulunamadı.");
            return;
        }

        let importedCount = 0;

        jsonData.forEach((row, index) => {
            // Helper to find value by fuzzy key
            const getValue = (keywords) => {
                const keys = Object.keys(row);
                for (const k of keys) {
                    const normKey = k.toLowerCase().replace(/\s+/g, '').trim(); // Remove spaces, lowercase
                    for (const keyword of keywords) {
                        if (normKey.includes(keyword)) return row[k];
                    }
                }
                return null;
            };

            // Debug mapping for first row
            if (index === 0) {
                console.log(" debug: Inspecting first row keys:", Object.keys(row));
            }

            // Fuzzy Match Strategies
            let dateStr = getValue(['tarih', 'date', 'gün', 'day']);
            let calls = getValue(['çağrı', 'cagri', 'call', 'inbound', 'vol']);
            let aht = getValue(['aht', 'süre', 'time', 'handle']);
            let agents = getValue(['temsilci', 'agent', 'personel', 'kisi']);
            let sl = getValue(['sl', 'service', 'hizmet', 'level', 'seviye']);
            let talkTime = getValue(['talk', 'görüşme', 'konusma']);

            if (index === 0) {
                console.log(" debug Mapped Values:", { dateStr, calls, aht, agents, sl });
            }

            if (dateStr) {
                // Try to parse date string to YYYY-MM-DD
                let d;

                // Debug date parsing for first row
                if (index === 0) console.log(" debug: First row dateStr:", dateStr);

                // If it looks like Excel Serial Date (integer > 20000)
                if (!isNaN(dateStr) && parseInt(dateStr) > 20000) {
                    d = new Date((parseInt(dateStr) - 25569) * 86400 * 1000);
                } else if (typeof dateStr === 'string') {
                    // Handling DD.MM.YYYY format
                    if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                        const [day, month, year] = dateStr.split('.');
                        d = new Date(`${year}-${month}-${day}`);
                    }
                    // Handling DD/MM/YYYY format
                    else if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                        const [day, month, year] = dateStr.split('/');
                        d = new Date(`${year}-${month}-${day}`);
                    }
                    else {
                        d = new Date(dateStr);
                    }
                } else {
                    d = new Date(dateStr);
                }

                if (!isNaN(d.getTime())) {
                    const isoDate = getLocalDateKey(d);

                    if (!state.historyData[isoDate]) state.historyData[isoDate] = {};

                    // Clean and Assign Numbers
                    const cleanInt = (v) => {
                        if (typeof v === 'string') return parseInt(v.replace(/[^0-9]/g, '')) || 0;
                        return parseInt(v) || 0;
                    };
                    const cleanFloat = (v) => {
                        if (typeof v === 'string') return parseFloat(v.replace(',', '.')) || 0;
                        return parseFloat(v) || 0;
                    };

                    // Update only present fields
                    if (calls) state.historyData[isoDate].calls = cleanInt(calls);
                    if (agents) state.historyData[isoDate].agents = cleanInt(agents);
                    if (sl) state.historyData[isoDate].sl = cleanFloat(sl);
                    if (aht) state.historyData[isoDate].aht = cleanInt(aht);
                    if (talkTime) state.historyData[isoDate].talkTime = cleanInt(talkTime);

                    importedCount++;
                } else {
                    console.warn(`Row ${index}: Invalid Date parsed from "${dateStr}"`);
                }
            } else {
                if (index < 5) console.warn(`Row ${index}: No Date column found. Keys present:`, Object.keys(row));
            }
        });

        console.log(`Import finished. ${importedCount} records valid.`);
        if (importedCount > 0) {
            alert(`${importedCount} satır veri başarıyla yüklendi. Tablo güncelleniyor...`);
            initHistoryTable();
            renderDashboard();
        } else {
            alert("Veri okunamadı. Lütfen Excel başlıklarınızın (Tarih, Çağrı, AHT, vb.) doğru olduğundan emin olun.");
        }
    };
    reader.readAsArrayBuffer(file);
}
