/* ============================================================
   BIM Model Viewer — production.js
   Production Tracking: day-to-date installation tracking
   with 3D color overlay, timeline scrubber, and dashboard
   ============================================================ */

import { getViewerState } from './viewer.js';

// ======================== STATE ========================
// compositeKey → { installed: true, date: 'YYYY-MM-DD' }
let installationMap = new Map();
let productionMode = false;    // whether production color overlay is active
let timelineDate = null;       // null = show all, or 'YYYY-MM-DD' = show as-of
let dashboardVisible = false;

// Colors for production overlay
const PROD_COLORS = {
  installed:   0x34d399,   // green
  notInstalled: 0x4b5563,  // gray
  highlight:    0xfbbf24,  // yellow (for just-selected batch)
};

const STORAGE_KEY = 'prod_installation_data';

// ======================== PERSISTENCE ========================
function saveToLocalStorage() {
  const { models } = getViewerState();
  if (models.length === 0) return;

  const data = {};
  for (const [key, entry] of installationMap) {
    // Store by filename:expressID for cross-session persistence
    const { elementDataMap } = getViewerState();
    const d = elementDataMap.get(key);
    if (!d) continue;
    const model = models.find(m => m.idx === d.modelIdx);
    if (!model) continue;
    const persistKey = `${model.filename}:${key.split(':')[1]}`;
    data[persistKey] = entry;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    showSaveStatus('Saved');
  } catch (e) {
    console.warn('[production] localStorage save failed:', e);
  }
}

function loadFromLocalStorage() {
  const { models, elementDataMap } = getViewerState();
  if (models.length === 0) return;

  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    data = JSON.parse(raw);
  } catch { return; }

  // Build filename→idx lookup
  const fileMap = {};
  for (const m of models) fileMap[m.filename] = m.idx;

  let loaded = 0;
  for (const [persistKey, entry] of Object.entries(data)) {
    const colonIdx = persistKey.indexOf(':');
    if (colonIdx < 0) continue;
    const filename = persistKey.substring(0, colonIdx);
    const expressID = persistKey.substring(colonIdx + 1);
    const modelIdx = fileMap[filename];
    if (modelIdx === undefined) continue;
    const compositeKey = `${modelIdx}:${expressID}`;
    if (elementDataMap.has(compositeKey)) {
      installationMap.set(compositeKey, entry);
      loaded++;
    }
  }

  console.log(`[production] Loaded ${loaded} installation records from localStorage`);
}

function exportToJSON() {
  const { models, elementDataMap } = getViewerState();
  const records = [];

  for (const [key, entry] of installationMap) {
    const d = elementDataMap.get(key);
    if (!d) continue;
    const model = models.find(m => m.idx === d.modelIdx);
    records.push({
      compositeKey: key,
      elementName: d.name,
      ifcType: d.ifcType,
      storey: d.storey,
      model: model?.filename || '',
      installed: entry.installed,
      date: entry.date,
    });
  }

  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `production-tracking-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showSaveStatus('Exported');
}

function importFromJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.records || !Array.isArray(data.records)) {
        alert('Invalid production tracking file.');
        return;
      }

      const { models, elementDataMap } = getViewerState();
      const fileMap = {};
      for (const m of models) fileMap[m.filename] = m.idx;

      let imported = 0;
      for (const rec of data.records) {
        // Try compositeKey first, then rebuild from model+expressID
        let key = rec.compositeKey;
        if (!elementDataMap.has(key) && rec.model) {
          const idx = fileMap[rec.model];
          if (idx !== undefined) {
            const eid = key.split(':')[1];
            key = `${idx}:${eid}`;
          }
        }
        if (elementDataMap.has(key) && rec.installed) {
          installationMap.set(key, { installed: true, date: rec.date });
          imported++;
        }
      }

      console.log(`[production] Imported ${imported} records`);
      saveToLocalStorage();
      refreshAll();
      showSaveStatus(`Imported ${imported}`);
    } catch (err) {
      alert('Failed to parse file: ' + err.message);
    }
  };
  input.click();
}

function exportToCSV() {
  const { models, elementDataMap } = getViewerState();
  let csv = 'Element Name,IFC Type,Storey,Model,Status,Installation Date\n';

  for (const [key, d] of elementDataMap) {
    const entry = installationMap.get(key);
    const model = models.find(m => m.idx === d.modelIdx);
    const status = entry?.installed ? 'Installed' : 'Not Installed';
    const date = entry?.date || '';
    csv += `"${d.name}","${d.ifcType}","${d.storey}","${model?.filename || ''}","${status}","${date}"\n`;
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `production-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showSaveStatus('CSV exported');
}

// ======================== STATUS MANAGEMENT ========================
/** Mark selected elements as installed on a given date. */
function markInstalled(keys, date) {
  if (!date) date = new Date().toISOString().slice(0, 10);
  for (const key of keys) {
    installationMap.set(key, { installed: true, date });
  }
  saveToLocalStorage();
  refreshAll();
}

/** Unmark elements (set back to not installed). */
function markNotInstalled(keys) {
  for (const key of keys) {
    installationMap.delete(key);
  }
  saveToLocalStorage();
  refreshAll();
}

/** Mark all elements of a given type/storey as installed. */
function markBulk(filterFn, date) {
  if (!date) date = new Date().toISOString().slice(0, 10);
  const { elementDataMap } = getViewerState();
  for (const [key, d] of elementDataMap) {
    if (filterFn(key, d)) {
      installationMap.set(key, { installed: true, date });
    }
  }
  saveToLocalStorage();
  refreshAll();
}

/** Clear all installation data. */
function clearAll() {
  if (!confirm('Clear all production tracking data? This cannot be undone.')) return;
  installationMap.clear();
  saveToLocalStorage();
  refreshAll();
}

// ======================== 3D COLOR OVERLAY ========================
function applyProductionOverlay() {
  const { elementMeshMap, elementDataMap } = getViewerState();
  productionMode = true;

  for (const [key, mesh] of elementMeshMap) {
    // Save original color if not already saved
    if (mesh.userData._prodOrigColor === undefined) {
      mesh.userData._prodOrigColor = mesh.material.color.getHex();
      mesh.userData._prodOrigOpacity = mesh.material.opacity;
      mesh.userData._prodOrigEmissive = mesh.material.emissive.getHex();
    }

    const entry = installationMap.get(key);
    const isInstalled = entry?.installed;

    // If timeline date is set, only show as installed if date <= timelineDate
    const showAsInstalled = isInstalled && (!timelineDate || entry.date <= timelineDate);

    if (showAsInstalled) {
      mesh.material.color.setHex(PROD_COLORS.installed);
      mesh.material.opacity = 0.92;
      mesh.material.emissive.setHex(0x0a3320);
    } else {
      mesh.material.color.setHex(PROD_COLORS.notInstalled);
      mesh.material.opacity = 0.35;
      mesh.material.emissive.setHex(0x000000);
    }
    mesh.material.needsUpdate = true;
  }

  updateProductionButton(true);
}

function removeProductionOverlay() {
  const { elementMeshMap } = getViewerState();
  productionMode = false;

  for (const [key, mesh] of elementMeshMap) {
    if (mesh.userData._prodOrigColor !== undefined) {
      mesh.material.color.setHex(mesh.userData._prodOrigColor);
      mesh.material.opacity = mesh.userData._prodOrigOpacity;
      mesh.material.emissive.setHex(mesh.userData._prodOrigEmissive || 0x000000);
      delete mesh.userData._prodOrigColor;
      delete mesh.userData._prodOrigOpacity;
      delete mesh.userData._prodOrigEmissive;
      mesh.material.needsUpdate = true;
    }
  }

  updateProductionButton(false);
}

function toggleProductionOverlay() {
  if (productionMode) {
    removeProductionOverlay();
  } else {
    applyProductionOverlay();
  }
}

function updateProductionButton(active) {
  const btn = document.getElementById('btnProduction');
  if (btn) btn.classList.toggle('active', active);
}

// ======================== STATISTICS ========================
function getStats() {
  const { elementDataMap } = getViewerState();
  const total = elementDataMap.size;
  let installed = 0;
  const byDate = {};    // date → count
  const byStorey = {};  // storey → { installed, total }
  const byType = {};    // ifcType → { installed, total }

  for (const [key, d] of elementDataMap) {
    // Storey stats
    if (!byStorey[d.storey]) byStorey[d.storey] = { installed: 0, total: 0 };
    byStorey[d.storey].total++;

    // Type stats
    if (!byType[d.ifcType]) byType[d.ifcType] = { installed: 0, total: 0 };
    byType[d.ifcType].total++;

    const entry = installationMap.get(key);
    if (entry?.installed) {
      installed++;
      byStorey[d.storey].installed++;
      byType[d.ifcType].installed++;
      const date = entry.date;
      byDate[date] = (byDate[date] || 0) + 1;
    }
  }

  return { total, installed, notInstalled: total - installed, pct: total > 0 ? (installed / total * 100) : 0, byDate, byStorey, byType };
}

/** Get cumulative S-curve data: array of { date, cumulative, daily } sorted by date */
function getSCurveData() {
  const stats = getStats();
  const dates = Object.keys(stats.byDate).sort();
  if (dates.length === 0) return [];

  let cumulative = 0;
  return dates.map(date => {
    const daily = stats.byDate[date];
    cumulative += daily;
    return { date, daily, cumulative };
  });
}

/** Get date range for timeline */
function getDateRange() {
  const dates = [];
  for (const [, entry] of installationMap) {
    if (entry.installed && entry.date) dates.push(entry.date);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

// ======================== SIDEBAR PANEL ========================
function initProductionPanel() {
  loadFromLocalStorage();
  renderPanel();
}

function renderPanel() {
  const container = document.getElementById('productionContent');
  if (!container) return;

  const stats = getStats();
  const pctFormatted = stats.pct.toFixed(1);

  let html = '';

  // ---- Stats bar ----
  html += `<div class="prod-stats">`;
  html += `<div class="prod-stat"><span class="prod-stat-val">${stats.total}</span><span class="prod-stat-label">Total</span></div>`;
  html += `<div class="prod-stat"><span class="prod-stat-val prod-installed">${stats.installed}</span><span class="prod-stat-label">Installed</span></div>`;
  html += `<div class="prod-stat"><span class="prod-stat-val prod-remaining">${stats.notInstalled}</span><span class="prod-stat-label">Remaining</span></div>`;
  html += `<div class="prod-stat"><span class="prod-stat-val prod-pct">${pctFormatted}%</span><span class="prod-stat-label">Complete</span></div>`;
  html += `</div>`;

  // ---- Progress bar ----
  html += `<div class="prod-progress-bar"><div class="prod-progress-fill" style="width:${stats.pct}%"></div></div>`;

  // ---- Quick actions ----
  html += `<div class="prod-actions">`;
  html += `<button class="btn-sm btn-primary" id="prodMarkSelectedBtn" title="Mark selected elements as installed">`;
  html += `<span class="icon">✓</span> Mark Installed</button>`;
  html += `<button class="btn-sm btn-secondary" id="prodUnmarkSelectedBtn" title="Unmark selected elements">`;
  html += `<span class="icon">✕</span> Unmark</button>`;
  html += `<button class="btn-sm btn-secondary" id="prodDashboardBtn" title="Open production dashboard (D)">`;
  html += `<span class="icon">◪</span> Dashboard</button>`;
  html += `</div>`;

  // ---- Date input ----
  html += `<div class="prod-date-row">`;
  html += `<label class="prod-date-label">Installation Date:</label>`;
  html += `<input type="date" id="prodDateInput" class="prod-date-input" value="${new Date().toISOString().slice(0, 10)}">`;
  html += `</div>`;

  // ---- Storey breakdown ----
  html += `<div class="prod-section-header">By Level</div>`;
  html += `<div class="prod-breakdown" id="prodStoreyBreakdown">`;
  const sortedStoreys = Object.entries(stats.byStorey).sort((a, b) => b[1].total - a[1].total);
  for (const [storey, s] of sortedStoreys) {
    const sPct = s.total > 0 ? (s.installed / s.total * 100) : 0;
    html += `<div class="prod-breakdown-row">`;
    html += `<span class="prod-breakdown-label">${storey}</span>`;
    html += `<div class="prod-mini-bar"><div class="prod-mini-fill" style="width:${sPct}%"></div></div>`;
    html += `<span class="prod-breakdown-val">${s.installed}/${s.total}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  // ---- Type breakdown ----
  html += `<div class="prod-section-header">By Element Type</div>`;
  html += `<div class="prod-breakdown" id="prodTypeBreakdown">`;
  const sortedTypes = Object.entries(stats.byType).sort((a, b) => b[1].total - a[1].total);
  for (const [type, t] of sortedTypes) {
    const tPct = t.total > 0 ? (t.installed / t.total * 100) : 0;
    const typeName = type.replace('IFC', '').replace('STANDARDCASE', '').replace('ELEMENTPROXY', 'Proxy');
    html += `<div class="prod-breakdown-row" data-type="${type}">`;
    html += `<span class="prod-breakdown-label">${typeName}</span>`;
    html += `<div class="prod-mini-bar"><div class="prod-mini-fill" style="width:${tPct}%"></div></div>`;
    html += `<span class="prod-breakdown-val">${t.installed}/${t.total}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  // ---- I/O buttons ----
  html += `<div class="prod-io-bar">`;
  html += `<button class="btn-sm btn-secondary" id="prodExportJSONBtn" title="Export tracking data to JSON">&#128190; Save</button>`;
  html += `<button class="btn-sm btn-secondary" id="prodImportJSONBtn" title="Import tracking data from JSON">&#128194; Load</button>`;
  html += `<button class="btn-sm btn-secondary" id="prodExportCSVBtn" title="Export to CSV">&#8615; CSV</button>`;
  html += `<button class="btn-sm btn-secondary prod-btn-danger" id="prodClearBtn" title="Clear all tracking data">&#10005; Clear</button>`;
  html += `</div>`;

  container.innerHTML = html;

  // ---- Wire events ----
  document.getElementById('prodMarkSelectedBtn')?.addEventListener('click', () => {
    const { selectedKeys } = getViewerState();
    if (selectedKeys.size === 0) { alert('Select elements first.'); return; }
    const date = document.getElementById('prodDateInput')?.value || new Date().toISOString().slice(0, 10);
    markInstalled([...selectedKeys], date);
  });

  document.getElementById('prodUnmarkSelectedBtn')?.addEventListener('click', () => {
    const { selectedKeys } = getViewerState();
    if (selectedKeys.size === 0) { alert('Select elements first.'); return; }
    markNotInstalled([...selectedKeys]);
  });

  document.getElementById('prodDashboardBtn')?.addEventListener('click', toggleDashboard);
  document.getElementById('prodExportJSONBtn')?.addEventListener('click', exportToJSON);
  document.getElementById('prodImportJSONBtn')?.addEventListener('click', importFromJSON);
  document.getElementById('prodExportCSVBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('prodClearBtn')?.addEventListener('click', clearAll);

  // Wire breakdown row clicks → select all elements of that type
  container.querySelectorAll('.prod-breakdown-row[data-type]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const type = row.dataset.type;
      if (type && window.__ufSelectByCategory) {
        // Find the first element with this type to use as seed
        const { elementDataMap } = getViewerState();
        for (const [key, d] of elementDataMap) {
          if (d.ifcType === type) {
            window.__ufSelectByCategory(key);
            break;
          }
        }
      }
    });
  });
}

function showSaveStatus(msg) {
  const el = document.getElementById('prodSaveStatus');
  if (el) {
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2000);
  }
}

// ======================== DASHBOARD OVERLAY ========================
function toggleDashboard() {
  dashboardVisible = !dashboardVisible;
  const overlay = document.getElementById('productionDashboard');
  if (overlay) overlay.classList.toggle('visible', dashboardVisible);
  if (dashboardVisible) renderDashboard();
}

function closeDashboard() {
  dashboardVisible = false;
  const overlay = document.getElementById('productionDashboard');
  if (overlay) overlay.classList.remove('visible');
}

function renderDashboard() {
  const body = document.getElementById('prodDashBody');
  if (!body) return;

  const stats = getStats();
  const sCurveData = getSCurveData();
  const dateRange = getDateRange();

  let html = '';

  // ---- Summary cards ----
  html += `<div class="prod-dash-summary">`;
  html += `<div class="prod-dash-card"><div class="prod-dash-card-val">${stats.total}</div><div class="prod-dash-card-label">Total Elements</div></div>`;
  html += `<div class="prod-dash-card prod-dash-card-green"><div class="prod-dash-card-val">${stats.installed}</div><div class="prod-dash-card-label">Installed</div></div>`;
  html += `<div class="prod-dash-card prod-dash-card-gray"><div class="prod-dash-card-val">${stats.notInstalled}</div><div class="prod-dash-card-label">Remaining</div></div>`;
  html += `<div class="prod-dash-card prod-dash-card-accent"><div class="prod-dash-card-val">${stats.pct.toFixed(1)}%</div><div class="prod-dash-card-label">Complete</div></div>`;
  html += `</div>`;

  // ---- Timeline scrubber ----
  html += `<div class="prod-dash-section">`;
  html += `<div class="prod-dash-section-title">Timeline Scrubber</div>`;
  if (dateRange) {
    html += `<div class="prod-timeline-controls">`;
    html += `<input type="date" id="prodTimelineStart" class="prod-date-input" value="${dateRange.min}" min="${dateRange.min}" max="${dateRange.max}">`;
    html += `<input type="range" id="prodTimelineSlider" class="prod-timeline-slider" min="0" max="100" value="100">`;
    html += `<input type="date" id="prodTimelineEnd" class="prod-date-input" value="${dateRange.max}" min="${dateRange.min}" max="${dateRange.max}">`;
    html += `</div>`;
    html += `<div class="prod-timeline-label" id="prodTimelineLabel">Showing all dates (${stats.installed} installed)</div>`;
    html += `<button class="btn-sm btn-secondary" id="prodTimelineResetBtn" style="margin-top:6px">Reset to All</button>`;
  } else {
    html += `<div class="prod-timeline-empty">No installation dates recorded yet.</div>`;
  }
  html += `</div>`;

  // ---- S-Curve chart (canvas) ----
  html += `<div class="prod-dash-section">`;
  html += `<div class="prod-dash-section-title">Cumulative Progress (S-Curve)</div>`;
  html += `<canvas id="prodSCurveCanvas" class="prod-chart-canvas" width="700" height="260"></canvas>`;
  html += `</div>`;

  // ---- Daily install chart ----
  html += `<div class="prod-dash-section">`;
  html += `<div class="prod-dash-section-title">Daily Installation Rate</div>`;
  html += `<canvas id="prodDailyCanvas" class="prod-chart-canvas" width="700" height="200"></canvas>`;
  html += `</div>`;

  // ---- Breakdown by storey (horizontal bar chart) ----
  html += `<div class="prod-dash-section">`;
  html += `<div class="prod-dash-section-title">Progress by Level</div>`;
  html += `<canvas id="prodStoreyCanvas" class="prod-chart-canvas" width="700" height="${Math.max(160, Object.keys(stats.byStorey).length * 32 + 40)}"></canvas>`;
  html += `</div>`;

  // ---- Breakdown by type (horizontal bar) ----
  html += `<div class="prod-dash-section">`;
  html += `<div class="prod-dash-section-title">Progress by Element Type</div>`;
  html += `<canvas id="prodTypeCanvas" class="prod-chart-canvas" width="700" height="${Math.max(160, Object.keys(stats.byType).length * 32 + 40)}"></canvas>`;
  html += `</div>`;

  body.innerHTML = html;

  // ---- Draw charts ----
  requestAnimationFrame(() => {
    drawSCurve(sCurveData, stats.total);
    drawDailyChart(sCurveData);
    drawHBarChart('prodStoreyCanvas', stats.byStorey, (name) => name);
    drawHBarChart('prodTypeCanvas', stats.byType, (t) => t.replace('IFC', '').replace('STANDARDCASE', ''));
    wireTimeline(dateRange, sCurveData);
  });
}

// ======================== TIMELINE SCRUBBER ========================
function wireTimeline(dateRange, sCurveData) {
  if (!dateRange) return;

  const slider = document.getElementById('prodTimelineSlider');
  const label = document.getElementById('prodTimelineLabel');
  const resetBtn = document.getElementById('prodTimelineResetBtn');
  if (!slider || !label) return;

  // Build array of all dates in range
  const allDates = [];
  const d = new Date(dateRange.min);
  const end = new Date(dateRange.max);
  while (d <= end) {
    allDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  slider.max = allDates.length; // 0 = beginning, allDates.length = show all

  slider.addEventListener('input', () => {
    const idx = parseInt(slider.value);
    if (idx >= allDates.length) {
      // Show all
      timelineDate = null;
      const stats = getStats();
      label.textContent = `Showing all dates (${stats.installed} installed)`;
    } else {
      timelineDate = allDates[idx];
      // Count elements installed as of this date
      let count = 0;
      for (const [, entry] of installationMap) {
        if (entry.installed && entry.date <= timelineDate) count++;
      }
      label.textContent = `As of ${timelineDate}: ${count} installed`;
    }

    if (productionMode) applyProductionOverlay();
  });

  resetBtn?.addEventListener('click', () => {
    timelineDate = null;
    slider.value = allDates.length;
    const stats = getStats();
    label.textContent = `Showing all dates (${stats.installed} installed)`;
    if (productionMode) applyProductionOverlay();
  });
}

// ======================== CHART DRAWING ========================
function drawSCurve(data, totalElements) {
  const canvas = document.getElementById('prodSCurveCanvas');
  if (!canvas || data.length === 0) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const maxY = totalElements;

  // Grid lines
  ctx.strokeStyle = '#3d3e66';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + chartH - (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#6b6f8d';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxY * i / 4), pad.left - 8, y + 3);
  }

  // Draw S-curve line
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - (data[i].cumulative / maxY) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill area under curve
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(52, 211, 153, 0.1)';
  ctx.fill();

  // Dots
  ctx.fillStyle = '#34d399';
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - (data[i].cumulative / maxY) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // X-axis labels (show a subset)
  ctx.fillStyle = '#6b6f8d';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 8));
  for (let i = 0; i < data.length; i += step) {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    ctx.fillText(data[i].date.slice(5), x, H - pad.bottom + 16); // show MM-DD
  }
  // Always label last point
  if (data.length > 1) {
    const x = pad.left + chartW;
    ctx.fillText(data[data.length - 1].date.slice(5), x, H - pad.bottom + 16);
  }

  // Y-axis title
  ctx.save();
  ctx.translate(14, pad.top + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#6b6f8d';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Elements Installed', 0, 0);
  ctx.restore();

  // Total line
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const totalY = pad.top;
  ctx.moveTo(pad.left, totalY);
  ctx.lineTo(W - pad.right, totalY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#818cf8';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Total: ${totalElements}`, pad.left + 4, totalY - 4);
}

function drawDailyChart(data) {
  const canvas = document.getElementById('prodDailyCanvas');
  if (!canvas || data.length === 0) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 16, right: 20, bottom: 40, left: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const maxDaily = Math.max(...data.map(d => d.daily), 1);

  // Grid
  ctx.strokeStyle = '#3d3e66';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + chartH - (i / 3) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#6b6f8d';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxDaily * i / 3), pad.left - 8, y + 3);
  }

  // Bars
  const barWidth = Math.max(4, (chartW / data.length) - 2);
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + (i / data.length) * chartW + 1;
    const barH = (data[i].daily / maxDaily) * chartH;
    const y = pad.top + chartH - barH;

    ctx.fillStyle = 'rgba(99, 102, 241, 0.7)';
    ctx.fillRect(x, y, barWidth, barH);
  }

  // X labels
  ctx.fillStyle = '#6b6f8d';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 8));
  for (let i = 0; i < data.length; i += step) {
    const x = pad.left + (i / data.length) * chartW + barWidth / 2;
    ctx.fillText(data[i].date.slice(5), x, H - pad.bottom + 16);
  }
}

function drawHBarChart(canvasId, dataObj, labelFn) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const entries = Object.entries(dataObj).sort((a, b) => b[1].total - a[1].total);
  if (entries.length === 0) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 10, right: 60, bottom: 10, left: 140 };
  const chartW = W - pad.left - pad.right;
  const barH = 22;
  const gap = 8;

  ctx.clearRect(0, 0, W, H);

  const maxTotal = Math.max(...entries.map(([, v]) => v.total), 1);

  for (let i = 0; i < entries.length; i++) {
    const [name, val] = entries[i];
    const y = pad.top + i * (barH + gap);
    const totalW = (val.total / maxTotal) * chartW;
    const instW = (val.installed / maxTotal) * chartW;

    // Total bar (background)
    ctx.fillStyle = '#2d2e52';
    ctx.fillRect(pad.left, y, totalW, barH);

    // Installed bar
    ctx.fillStyle = 'rgba(52, 211, 153, 0.7)';
    ctx.fillRect(pad.left, y, instW, barH);

    // Label
    ctx.fillStyle = '#a0a3bd';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(labelFn(name), pad.left - 8, y + barH / 2 + 4);

    // Value
    const pct = val.total > 0 ? Math.round(val.installed / val.total * 100) : 0;
    ctx.fillStyle = '#e8e9f3';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${val.installed}/${val.total} (${pct}%)`, pad.left + totalW + 6, y + barH / 2 + 4);
  }
}

// ======================== CONTEXT MENU INTEGRATION ========================
/** Add production tracking items to the 3D context menu. Called from viewer.js */
function getContextMenuItems(compositeKey) {
  const entry = installationMap.get(compositeKey);
  const isInstalled = entry?.installed;
  const { selectedKeys } = getViewerState();
  const count = selectedKeys.size;
  const label = count > 1 ? `${count} elements` : 'element';

  const items = [];
  if (isInstalled) {
    items.push({
      icon: '✕',
      label: `Unmark ${label}`,
      action: () => {
        markNotInstalled([...selectedKeys]);
      }
    });
  } else {
    items.push({
      icon: '✓',
      label: `Mark ${label} Installed`,
      action: () => {
        const date = document.getElementById('prodDateInput')?.value || new Date().toISOString().slice(0, 10);
        markInstalled([...selectedKeys], date);
      }
    });
  }

  return items;
}

// ======================== REFRESH ========================
function refreshAll() {
  renderPanel();
  if (productionMode) applyProductionOverlay();
  if (dashboardVisible) renderDashboard();
}

// ======================== WIRING ========================
function wireProductionEvents() {
  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    if (e.key === 't' || e.key === 'T') {
      toggleProductionOverlay();
    }
    if (e.key === 'd' || e.key === 'D') {
      // Only if production tab is active
      const prodTab = document.querySelector('.tab[data-tab="production"]');
      if (prodTab?.classList.contains('active')) {
        toggleDashboard();
      }
    }
  });

  // Dashboard close
  document.getElementById('prodDashClose')?.addEventListener('click', closeDashboard);
}

// ======================== EXPORTS ========================
export {
  initProductionPanel,
  wireProductionEvents,
  getContextMenuItems,
  markInstalled,
  markNotInstalled,
  toggleProductionOverlay,
  toggleDashboard,
  refreshAll,
};
