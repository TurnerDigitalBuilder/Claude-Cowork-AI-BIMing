/* ============================================================
   Construction Estimate Tool — estimate.js
   Floating estimate window over the 3D viewer.
   Uses Spatial (Storey → Type) or UniFormat (L1 → L2 → L3)
   tree structure with editable unit costs, subtotals, and
   grand total — a basic construction estimate sheet.
   ============================================================ */

import { getViewerState } from './viewer.js';
import { classifications, UNIFORMAT_HIERARCHY, L3_LABELS } from './uniformat.js';

// ======================== STATE ========================

let estimateMode = 'uniformat'; // 'spatial' | 'uniformat'
let estimateVisible = false;

/**
 * Cost rates store — keyed by row identifier:
 *   UniFormat mode:  L3 code (e.g. "A1010")
 *   Spatial mode:    "storey::ifcType" (e.g. "Level 1::IFCBEAM")
 *
 * Each entry: { unitCost: number, unit: 'ea'|'sf'|'lf'|'cy' }
 */
let costRates = new Map();

// ======================== UNIT CONVERSIONS ========================

const M2_TO_SF = 10.7639;
const M_TO_LF  = 3.28084;
const M3_TO_CY = 1.30795;

const UNIT_LABELS = { ea: 'EA', sf: 'SF', lf: 'LF', cy: 'CY' };

// ======================== QUANTITY DETECTION ========================

const QTO_SET_NAMES = [
  'basequantities', 'qto_', 'dimensions', 'quantities',
  'elementquantity', 'analytical properties', 'pset_revit_dimensions',
];

const QUANTITY_NAME_KEYWORDS = [
  'area', 'surface', 'volume',
  'length', 'height', 'width', 'depth', 'perimeter', 'thickness',
  'count',
];

function classifyQuantityKey(propKey) {
  const lower = propKey.toLowerCase();
  const parts = lower.split('.');
  const setName = parts[0] || '';
  const name = parts[parts.length - 1] || '';
  const isKnownSet = QTO_SET_NAMES.some(p => setName.startsWith(p));
  const isDimensionName = QUANTITY_NAME_KEYWORDS.some(k => name.includes(k));
  if (!isKnownSet && !isDimensionName) return null;
  if (name.includes('area') || name.includes('surface')) return 'area';
  if (name.includes('volume')) return 'volume';
  if (name.includes('length') || name.includes('height') ||
      name.includes('width') || name.includes('depth') ||
      name.includes('perimeter') || name.includes('thickness')) return 'length';
  if (name.includes('count')) return 'count';
  return null;
}

function extractQuantities(props) {
  const result = { area: 0, volume: 0, length: 0, count: 0 };
  if (!props) return result;
  const candidates = { area: [], volume: [], length: [], count: [] };
  for (const [key, val] of Object.entries(props)) {
    const cat = classifyQuantityKey(key);
    if (cat && typeof val === 'number' && val > 0) {
      const lower = key.toLowerCase();
      const isGross = lower.includes('gross');
      candidates[cat].push({ value: val, isGross, key });
    }
  }
  for (const cat of Object.keys(result)) {
    const vals = candidates[cat];
    if (vals.length === 0) continue;
    const gross = vals.filter(v => v.isGross);
    result[cat] = gross.length > 0
      ? Math.max(...gross.map(v => v.value))
      : Math.max(...vals.map(v => v.value));
  }
  return result;
}

// ======================== AGGREGATION ========================

function emptyAgg() {
  return { ea: 0, sf: 0, lf: 0, cy: 0, elements: [] };
}

function addToAgg(agg, quantities, key) {
  agg.ea++;
  agg.sf += quantities.area * M2_TO_SF;
  agg.lf += quantities.length * M_TO_LF;
  agg.cy += quantities.volume * M3_TO_CY;
  agg.elements.push(key);
}

// L2 label lookup
const L2_LABELS = {};
for (const [, l1] of Object.entries(UNIFORMAT_HIERARCHY)) {
  if (l1.children) {
    for (const [l2Code, l2] of Object.entries(l1.children)) {
      L2_LABELS[l2Code] = l2.label;
    }
  }
}

function aggregateSpatial() {
  const { elementDataMap } = getViewerState();
  const tree = {};
  const totals = emptyAgg();
  for (const [key, data] of elementDataMap) {
    const q = extractQuantities(data.props);
    const storey = data.storey || 'Unassigned';
    const ifcType = data.ifcType || 'UNKNOWN';
    if (!tree[storey]) tree[storey] = { agg: emptyAgg(), types: {} };
    if (!tree[storey].types[ifcType]) tree[storey].types[ifcType] = emptyAgg();
    addToAgg(tree[storey].agg, q, key);
    addToAgg(tree[storey].types[ifcType], q, key);
    addToAgg(totals, q, key);
  }
  return { tree, totals };
}

function aggregateUniformat() {
  const { elementDataMap } = getViewerState();
  const tree = {};
  const totals = emptyAgg();
  const unclassified = emptyAgg();
  for (const [key, data] of elementDataMap) {
    const q = extractQuantities(data.props);
    const cls = classifications.get(key);
    if (!cls || !cls.code) {
      addToAgg(unclassified, q, key);
      addToAgg(totals, q, key);
      continue;
    }
    const l3 = cls.code;
    const l2 = l3.substring(0, 3);
    const l1 = l3.substring(0, 1);
    if (!tree[l1]) tree[l1] = { agg: emptyAgg(), children: {} };
    if (!tree[l1].children[l2]) tree[l1].children[l2] = { agg: emptyAgg(), children: {} };
    if (!tree[l1].children[l2].children[l3]) tree[l1].children[l2].children[l3] = emptyAgg();
    addToAgg(tree[l1].agg, q, key);
    addToAgg(tree[l1].children[l2].agg, q, key);
    addToAgg(tree[l1].children[l2].children[l3], q, key);
    addToAgg(totals, q, key);
  }
  return { tree, totals, unclassified };
}

// ======================== COST CALCULATION ========================

/**
 * Determine the "primary" unit for a given aggregation row.
 * Uses the unit with the largest non-zero quantity.
 */
function primaryUnit(agg) {
  if (agg.sf > 0) return 'sf';
  if (agg.lf > 0) return 'lf';
  if (agg.cy > 0) return 'cy';
  return 'ea';
}

function primaryQty(agg, unit) {
  return agg[unit] || agg.ea;
}

function getRowCost(rowId, agg) {
  const rate = costRates.get(rowId);
  if (!rate || !rate.unitCost) return 0;
  const qty = primaryQty(agg, rate.unit);
  return qty * rate.unitCost;
}

function setRowCost(rowId, unitCost, unit) {
  costRates.set(rowId, { unitCost: parseFloat(unitCost) || 0, unit });
}

// ======================== FORMATTING ========================

function fmtQty(val) {
  if (val === 0) return '—';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 10_000) return Math.round(val).toLocaleString();
  if (val >= 100) return Math.round(val).toLocaleString();
  if (val >= 1) return val.toFixed(1);
  return val.toFixed(2);
}

function fmtCount(n) {
  if (n === 0) return '—';
  return n.toLocaleString();
}

function fmtMoney(val) {
  if (!val || val === 0) return '—';
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtMoneyExact(val) {
  if (!val || val === 0) return '—';
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function prettyType(ifcType) {
  const raw = (ifcType || '').replace(/^IFC/i, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// ======================== L1 COLORS ========================

const L1_COLORS = {
  A: '#e67e22', B: '#3498db', C: '#2ecc71',
  D: '#9b59b6', E: '#e74c3c', F: '#95a5a6',
};

// ======================== UI BUILDER ========================

function toggleEstimate() {
  const panel = document.getElementById('estimateOverlay');
  if (!panel) return;
  estimateVisible = !estimateVisible;
  if (estimateVisible) {
    panel.classList.add('visible');
    buildEstimatePanel();
  } else {
    panel.classList.remove('visible');
  }
  // Update toolbar button state
  const btn = document.getElementById('btnEstimate');
  if (btn) btn.classList.toggle('active', estimateVisible);
}

function buildEstimatePanel() {
  const body = document.getElementById('estimateBody');
  if (!body) return;

  let html = '';

  if (estimateMode === 'uniformat') {
    html = buildUniformatEstimate();
  } else {
    html = buildSpatialEstimate();
  }

  body.innerHTML = html;
  wireEstimateInteractions();
}

function buildUniformatEstimate() {
  const { tree, totals, unclassified } = aggregateUniformat();
  let html = '';
  let grandTotal = 0;

  const l1Order = ['A', 'B', 'C', 'D', 'E', 'F'];

  for (const l1Code of l1Order) {
    const l1Node = tree[l1Code];
    if (!l1Node) continue;

    const l1Color = L1_COLORS[l1Code] || '#6c7293';
    const l1Label = UNIFORMAT_HIERARCHY[l1Code]?.label || l1Code;
    let l1Total = 0;

    // Build L2→L3 rows first so we can compute l1 subtotal
    let l2Html = '';
    const l2Codes = Object.keys(l1Node.children).sort();

    for (const l2Code of l2Codes) {
      const l2Node = l1Node.children[l2Code];
      const l2Label = L2_LABELS[l2Code] || l2Code;
      let l2Total = 0;

      let l3Html = '';
      const l3Codes = Object.keys(l2Node.children).sort();

      for (const l3Code of l3Codes) {
        const l3Agg = l2Node.children[l3Code];
        const l3Label = L3_LABELS[l3Code] || l3Code;
        const rowId = l3Code;
        const pUnit = costRates.has(rowId) ? costRates.get(rowId).unit : primaryUnit(l3Agg);
        const qty = primaryQty(l3Agg, pUnit);
        const rate = costRates.get(rowId);
        const unitCost = rate ? rate.unitCost : 0;
        const lineCost = qty * unitCost;
        l2Total += lineCost;

        l3Html += `<tr class="est-row est-row-item" data-row-id="${rowId}">
          <td class="est-code">${l3Code}</td>
          <td class="est-desc">${l3Label}</td>
          <td class="est-qty">${fmtQty(qty)}</td>
          <td class="est-unit">
            <select class="est-unit-select" data-row-id="${rowId}">
              <option value="ea" ${pUnit === 'ea' ? 'selected' : ''}>EA</option>
              <option value="sf" ${pUnit === 'sf' ? 'selected' : ''}>SF</option>
              <option value="lf" ${pUnit === 'lf' ? 'selected' : ''}>LF</option>
              <option value="cy" ${pUnit === 'cy' ? 'selected' : ''}>CY</option>
            </select>
          </td>
          <td class="est-unit-cost">
            <input type="number" class="est-cost-input" data-row-id="${rowId}"
                   value="${unitCost || ''}" placeholder="0.00" step="0.01" min="0">
          </td>
          <td class="est-line-total">${lineCost > 0 ? fmtMoney(lineCost) : '—'}</td>
        </tr>`;
      }

      l1Total += l2Total;

      l2Html += `<tr class="est-row est-row-l2">
        <td class="est-code est-l2-code">${l2Code}</td>
        <td class="est-desc est-l2-desc" colspan="4">${l2Label}</td>
        <td class="est-subtotal">${l2Total > 0 ? fmtMoney(l2Total) : '—'}</td>
      </tr>`;
      l2Html += l3Html;
    }

    grandTotal += l1Total;

    // L1 section header
    html += `<tr class="est-row est-row-l1" data-l1="${l1Code}">
      <td class="est-code est-l1-code" style="border-left:3px solid ${l1Color}">
        <span class="est-l1-badge" style="background:${l1Color}20;color:${l1Color}">${l1Code}</span>
      </td>
      <td class="est-desc est-l1-desc" colspan="4">${l1Label}</td>
      <td class="est-section-total">${l1Total > 0 ? fmtMoney(l1Total) : '—'}</td>
    </tr>`;
    html += l2Html;
  }

  // Unclassified
  if (unclassified.ea > 0) {
    const rowId = '__unclassified';
    const pUnit = costRates.has(rowId) ? costRates.get(rowId).unit : primaryUnit(unclassified);
    const qty = primaryQty(unclassified, pUnit);
    const rate = costRates.get(rowId);
    const unitCost = rate ? rate.unitCost : 0;
    const lineCost = qty * unitCost;
    grandTotal += lineCost;

    html += `<tr class="est-row est-row-l1 est-unclassified">
      <td class="est-code est-l1-code" style="border-left:3px solid #6c7293">—</td>
      <td class="est-desc est-l1-desc" colspan="4">Unclassified</td>
      <td class="est-section-total">${lineCost > 0 ? fmtMoney(lineCost) : '—'}</td>
    </tr>
    <tr class="est-row est-row-item" data-row-id="${rowId}">
      <td class="est-code"></td>
      <td class="est-desc">Unclassified Elements</td>
      <td class="est-qty">${fmtQty(qty)}</td>
      <td class="est-unit">
        <select class="est-unit-select" data-row-id="${rowId}">
          <option value="ea" ${pUnit === 'ea' ? 'selected' : ''}>EA</option>
          <option value="sf" ${pUnit === 'sf' ? 'selected' : ''}>SF</option>
          <option value="lf" ${pUnit === 'lf' ? 'selected' : ''}>LF</option>
          <option value="cy" ${pUnit === 'cy' ? 'selected' : ''}>CY</option>
        </select>
      </td>
      <td class="est-unit-cost">
        <input type="number" class="est-cost-input" data-row-id="${rowId}"
               value="${unitCost || ''}" placeholder="0.00" step="0.01" min="0">
      </td>
      <td class="est-line-total">${lineCost > 0 ? fmtMoney(lineCost) : '—'}</td>
    </tr>`;
  }

  // Grand total row
  html += `<tr class="est-row est-row-grand-total">
    <td colspan="5" class="est-grand-label">ESTIMATE TOTAL</td>
    <td class="est-grand-total-val">${grandTotal > 0 ? fmtMoney(grandTotal) : '$0'}</td>
  </tr>`;

  // Wrap in table
  return `<table class="est-table">
    <thead>
      <tr class="est-header">
        <th class="est-hdr-code">Code</th>
        <th class="est-hdr-desc">Description</th>
        <th class="est-hdr-qty">Quantity</th>
        <th class="est-hdr-unit">Unit</th>
        <th class="est-hdr-unitcost">Unit Cost</th>
        <th class="est-hdr-total">Total</th>
      </tr>
    </thead>
    <tbody>${html}</tbody>
  </table>`;
}

function buildSpatialEstimate() {
  const { tree, totals } = aggregateSpatial();
  const { storeys } = getViewerState();
  let html = '';
  let grandTotal = 0;

  const storeyNames = Object.keys(tree).sort((a, b) => {
    const ea = storeys[a]?.elevation ?? -Infinity;
    const eb = storeys[b]?.elevation ?? -Infinity;
    return eb - ea;
  });

  for (const storeyName of storeyNames) {
    const node = tree[storeyName];
    let storeyTotal = 0;

    let typeRows = '';
    const types = Object.keys(node.types).sort();

    for (const ifcType of types) {
      const typeAgg = node.types[ifcType];
      const rowId = `${storeyName}::${ifcType}`;
      const pUnit = costRates.has(rowId) ? costRates.get(rowId).unit : primaryUnit(typeAgg);
      const qty = primaryQty(typeAgg, pUnit);
      const rate = costRates.get(rowId);
      const unitCost = rate ? rate.unitCost : 0;
      const lineCost = qty * unitCost;
      storeyTotal += lineCost;

      typeRows += `<tr class="est-row est-row-item" data-row-id="${rowId}">
        <td class="est-code"></td>
        <td class="est-desc">${prettyType(ifcType)}</td>
        <td class="est-qty">${fmtQty(qty)}</td>
        <td class="est-unit">
          <select class="est-unit-select" data-row-id="${rowId}">
            <option value="ea" ${pUnit === 'ea' ? 'selected' : ''}>EA</option>
            <option value="sf" ${pUnit === 'sf' ? 'selected' : ''}>SF</option>
            <option value="lf" ${pUnit === 'lf' ? 'selected' : ''}>LF</option>
            <option value="cy" ${pUnit === 'cy' ? 'selected' : ''}>CY</option>
          </select>
        </td>
        <td class="est-unit-cost">
          <input type="number" class="est-cost-input" data-row-id="${rowId}"
                 value="${unitCost || ''}" placeholder="0.00" step="0.01" min="0">
        </td>
        <td class="est-line-total">${lineCost > 0 ? fmtMoney(lineCost) : '—'}</td>
      </tr>`;
    }

    grandTotal += storeyTotal;

    html += `<tr class="est-row est-row-l1">
      <td class="est-code est-l1-code" style="border-left:3px solid var(--accent)">
        <span class="est-l1-badge">${storeyName.substring(0, 3)}</span>
      </td>
      <td class="est-desc est-l1-desc" colspan="4">${storeyName}</td>
      <td class="est-section-total">${storeyTotal > 0 ? fmtMoney(storeyTotal) : '—'}</td>
    </tr>`;
    html += typeRows;
  }

  // Grand total
  html += `<tr class="est-row est-row-grand-total">
    <td colspan="5" class="est-grand-label">ESTIMATE TOTAL</td>
    <td class="est-grand-total-val">${grandTotal > 0 ? fmtMoney(grandTotal) : '$0'}</td>
  </tr>`;

  return `<table class="est-table">
    <thead>
      <tr class="est-header">
        <th class="est-hdr-code">Code</th>
        <th class="est-hdr-desc">Description</th>
        <th class="est-hdr-qty">Quantity</th>
        <th class="est-hdr-unit">Unit</th>
        <th class="est-hdr-unitcost">Unit Cost</th>
        <th class="est-hdr-total">Total</th>
      </tr>
    </thead>
    <tbody>${html}</tbody>
  </table>`;
}

// ======================== INTERACTIONS ========================

function wireEstimateInteractions() {
  const body = document.getElementById('estimateBody');
  if (!body) return;

  // Cost input changes — recalculate on input
  body.querySelectorAll('.est-cost-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const rowId = e.target.dataset.rowId;
      const unitSelect = body.querySelector(`.est-unit-select[data-row-id="${rowId}"]`);
      const unit = unitSelect ? unitSelect.value : 'ea';
      setRowCost(rowId, e.target.value, unit);
      buildEstimatePanel(); // rebuild to recalculate totals
      // Restore focus to this input
      requestAnimationFrame(() => {
        const newInput = body.querySelector(`.est-cost-input[data-row-id="${rowId}"]`);
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      });
    });
  });

  // Unit select changes — recalculate
  body.querySelectorAll('.est-unit-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const rowId = e.target.dataset.rowId;
      const costInput = body.querySelector(`.est-cost-input[data-row-id="${rowId}"]`);
      const unitCost = costInput ? costInput.value : 0;
      setRowCost(rowId, unitCost, e.target.value);
      buildEstimatePanel();
    });
  });
}

// ======================== EXPORT ========================

function exportEstimateCSV() {
  const rows = [];
  rows.push(['Code', 'Description', 'Quantity', 'Unit', 'Unit Cost', 'Total']);

  const table = document.querySelector('.est-table');
  if (!table) return;

  table.querySelectorAll('tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 6) return;

    const code = cells[0].textContent.trim();
    const desc = cells[1].textContent.trim();
    const qty = cells[2].textContent.trim();
    const unitEl = cells[3].querySelector('select');
    const unit = unitEl ? unitEl.value : cells[3].textContent.trim();
    const costEl = cells[4].querySelector('input');
    const unitCost = costEl ? costEl.value : cells[4].textContent.trim();
    const total = cells[5].textContent.trim();

    rows.push([code, desc, qty, unit, unitCost, total]);
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estimate_${estimateMode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ======================== SAVE / LOAD ESTIMATE ========================

function saveEstimate() {
  const data = {};
  for (const [key, val] of costRates) {
    data[key] = val;
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estimate_${estimateMode}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showEstimateStatus('Estimate saved');
}

function loadEstimate() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        costRates.clear();
        for (const [key, val] of Object.entries(data)) {
          costRates.set(key, val);
        }
        buildEstimatePanel();
        showEstimateStatus('Estimate loaded');
      } catch (err) {
        showEstimateStatus('Error loading file');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function clearEstimate() {
  costRates.clear();
  buildEstimatePanel();
  showEstimateStatus('Estimate cleared');
}

function showEstimateStatus(msg) {
  const el = document.getElementById('estStatus');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

// ======================== INITIALIZATION ========================

function wireEstimateEvents() {
  // Toggle button
  const btn = document.getElementById('btnEstimate');
  if (btn) btn.addEventListener('click', toggleEstimate);

  // Close button
  const closeBtn = document.getElementById('estimateClose');
  if (closeBtn) closeBtn.addEventListener('click', toggleEstimate);

  // Mode toggle
  const spatialBtn = document.getElementById('estModeSpatial');
  const uniformatBtn = document.getElementById('estModeUniformat');
  if (spatialBtn) {
    spatialBtn.addEventListener('click', () => {
      estimateMode = 'spatial';
      spatialBtn.classList.add('active');
      if (uniformatBtn) uniformatBtn.classList.remove('active');
      buildEstimatePanel();
    });
  }
  if (uniformatBtn) {
    uniformatBtn.addEventListener('click', () => {
      estimateMode = 'uniformat';
      uniformatBtn.classList.add('active');
      if (spatialBtn) spatialBtn.classList.remove('active');
      buildEstimatePanel();
    });
  }

  // Export
  const exportBtn = document.getElementById('estExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportEstimateCSV);

  // Save / Load / Clear
  const saveBtn = document.getElementById('estSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveEstimate);

  const loadBtn = document.getElementById('estLoadBtn');
  if (loadBtn) loadBtn.addEventListener('click', loadEstimate);

  const clearBtn = document.getElementById('estClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearEstimate);

  // Keyboard shortcut: E to toggle
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleEstimate();
      }
    }
  });
}

function initEstimatePanel() {
  if (estimateVisible) {
    buildEstimatePanel();
  }
}

export {
  toggleEstimate,
  initEstimatePanel,
  wireEstimateEvents,
};
