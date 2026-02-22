/* ============================================================
   Model Quantification Tool — quantification.js
   Aggregates IFC element quantities by Spatial (Storey → Type)
   or UniFormat (L1 → L2 → L3) organization.
   Displays in standard construction units: EA, SF, LF, CY
   ============================================================ */

import { getViewerState } from './viewer.js';
import { classifications, UNIFORMAT_HIERARCHY, L3_LABELS } from './uniformat.js';

// ======================== STATE ========================

let currentMode = 'spatial'; // 'spatial' | 'uniformat'
let qtSearchTerm = '';

// ======================== UNIT CONVERSIONS (metric → imperial) ========================

const M2_TO_SF = 10.7639;    // square meters → square feet
const M_TO_LF  = 3.28084;    // meters → linear feet
const M3_TO_CY = 1.30795;    // cubic meters → cubic yards

// ======================== QUANTITY DETECTION ========================

/**
 * Property set names known to contain dimensional quantities.
 * Matches case-insensitively against the set name portion of "SetName.PropName".
 *
 * Sources:
 *  - IFC standard: BaseQuantities, Qto_*
 *  - Revit IFC exports: Dimensions, PSet_Revit_Dimensions, Analytical Properties
 *  - ArchiCAD / others: Quantities, ElementQuantity
 */
const QTO_SET_NAMES = [
  'basequantities', 'qto_', 'dimensions', 'quantities',
  'elementquantity', 'analytical properties',
  'pset_revit_dimensions',
];

/**
 * Property name keywords that indicate a dimensional quantity,
 * regardless of which property set they live in.
 * Used as a fallback when the set name isn't in the known list.
 */
const QUANTITY_NAME_KEYWORDS = [
  'area', 'surface',
  'volume',
  'length', 'height', 'width', 'depth', 'perimeter', 'thickness',
  'count',
];

/**
 * Classify a property key ("SetName.PropName") into a quantity category.
 * Returns: 'area' | 'volume' | 'length' | 'count' | null
 *
 * Two-pass approach:
 *  1. If the set name is a known quantity set → classify by prop name keyword.
 *  2. If not, but the prop name itself IS a dimension keyword AND the value
 *     is numeric → still classify it (catches Revit "Dimensions.Area" etc.)
 */
function classifyQuantityKey(propKey) {
  const lower = propKey.toLowerCase();
  const parts = lower.split('.');
  const setName = parts[0] || '';
  const name = parts[parts.length - 1] || '';

  // Check if property set is a known quantity container
  const isKnownSet = QTO_SET_NAMES.some(p => setName.startsWith(p));

  // Check if prop name matches a dimension keyword
  const isDimensionName = QUANTITY_NAME_KEYWORDS.some(k => name.includes(k));

  // Reject if neither the set nor the name indicate a quantity
  if (!isKnownSet && !isDimensionName) return null;

  // Classify by the property name
  if (name.includes('area') || name.includes('surface'))
    return 'area';

  if (name.includes('volume'))
    return 'volume';

  if (name.includes('length') || name.includes('height') ||
      name.includes('width') || name.includes('depth') ||
      name.includes('perimeter') || name.includes('thickness'))
    return 'length';

  if (name.includes('count'))
    return 'count';

  return null;
}

/**
 * Extract classified quantities from an element's props map.
 * Returns metric values: { area: m², volume: m³, length: m, count: n }
 * Each value is the MAX found for that category (avoids double-counting gross vs net).
 */
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
    if (gross.length > 0) {
      result[cat] = Math.max(...gross.map(v => v.value));
    } else {
      result[cat] = Math.max(...vals.map(v => v.value));
    }
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

/**
 * Build aggregated tree in Spatial mode: Storey → IFC Type → elements
 */
function aggregateSpatial() {
  const { elementDataMap } = getViewerState();
  const tree = {};   // storeyName → { agg, types: { ifcType → agg } }
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

// L2 label lookup
const L2_LABELS = {};
for (const [l1Code, l1] of Object.entries(UNIFORMAT_HIERARCHY)) {
  if (l1.children) {
    for (const [l2Code, l2] of Object.entries(l1.children)) {
      L2_LABELS[l2Code] = l2.label;
    }
  }
}

/**
 * Build aggregated tree in UniFormat mode: L1 → L2 → L3 → elements
 */
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

// ======================== FORMATTING ========================

function fmtQty(val) {
  if (val === 0) return '';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 10_000) return Math.round(val).toLocaleString();
  if (val >= 100) return Math.round(val).toLocaleString();
  if (val >= 1) return val.toFixed(1);
  return val.toFixed(2);
}

function fmtCount(n) {
  if (n === 0) return '';
  return n.toLocaleString();
}

// ======================== L1 COLOR HELPER ========================

const L1_COLORS = {
  A: '#e67e22', B: '#3498db', C: '#2ecc71',
  D: '#9b59b6', E: '#e74c3c', F: '#95a5a6',
};

function getL1Color(code) {
  return L1_COLORS[code] || '#6c7293';
}

// ======================== IFC TYPE DISPLAY ========================

function prettyType(ifcType) {
  const raw = (ifcType || '').replace(/^IFC/i, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// ======================== ROW HELPER ========================

/**
 * Render a quantity row with 4 columns: EA | SF | LF | CY
 * Blank cells where the aggregated value is 0.
 */
function qtCols(agg) {
  return `<span class="qt-col qt-col-ea">${fmtCount(agg.ea)}</span>`
       + `<span class="qt-col qt-col-sf">${fmtQty(agg.sf)}</span>`
       + `<span class="qt-col qt-col-lf">${fmtQty(agg.lf)}</span>`
       + `<span class="qt-col qt-col-cy">${fmtQty(agg.cy)}</span>`;
}

// ======================== UI BUILDER ========================

// Indexed storage for element keys — avoids huge JSON in HTML attributes
let groupKeyStore = new Map();
let groupIdCounter = 0;

function storeGroupKeys(elements) {
  const id = `g${groupIdCounter++}`;
  groupKeyStore.set(id, elements);
  return id;
}

function buildQuantificationPanel() {
  const container = document.getElementById('qtTree');
  if (!container) return;

  groupKeyStore.clear();
  groupIdCounter = 0;

  let html = '';

  if (currentMode === 'spatial') {
    html = buildSpatialView();
  } else {
    html = buildUniformatView();
  }

  container.innerHTML = html;
  wireTreeInteractions();
}

/** Column header row — sticky at top of the tree */
function colHeader() {
  return `<div class="qt-col-header">`
       + `<span class="qt-col-hdr-label"></span>`
       + `<span class="qt-col qt-col-hdr">EA</span>`
       + `<span class="qt-col qt-col-hdr">SF</span>`
       + `<span class="qt-col qt-col-hdr">LF</span>`
       + `<span class="qt-col qt-col-hdr">CY</span>`
       + `</div>`;
}

function buildSpatialView() {
  const { tree, totals } = aggregateSpatial();
  const { storeys } = getViewerState();
  let html = '';

  // Summary totals row
  html += buildSummaryBar(totals);

  // Column headers
  html += colHeader();

  // Sort storeys by elevation descending
  const storeyNames = Object.keys(tree).sort((a, b) => {
    const ea = storeys[a]?.elevation ?? -Infinity;
    const eb = storeys[b]?.elevation ?? -Infinity;
    return eb - ea;
  });

  for (const storeyName of storeyNames) {
    const node = tree[storeyName];
    const agg = node.agg;

    if (qtSearchTerm) {
      const s = qtSearchTerm.toLowerCase();
      const storeyMatch = storeyName.toLowerCase().includes(s);
      const typeMatch = Object.keys(node.types).some(t => t.toLowerCase().includes(s));
      if (!storeyMatch && !typeMatch) continue;
    }

    html += `<div class="qt-node">`;
    html += `<div class="qt-row qt-row-group qt-storey-row" data-gid="${storeGroupKeys(agg.elements)}">`;
    html += `<span class="qt-row-label"><span class="tree-toggle">▶</span>${storeyName}</span>`;
    html += qtCols(agg);
    html += `</div>`;
    html += `<div class="tree-children qt-children">`;

    const types = Object.keys(node.types).sort();
    for (const ifcType of types) {
      const typeAgg = node.types[ifcType];

      if (qtSearchTerm && !ifcType.toLowerCase().includes(qtSearchTerm.toLowerCase()) &&
          !storeyName.toLowerCase().includes(qtSearchTerm.toLowerCase())) continue;

      html += `<div class="qt-row qt-row-type" data-gid="${storeGroupKeys(typeAgg.elements)}">`;
      html += `<span class="qt-row-label qt-row-indent">${prettyType(ifcType)}</span>`;
      html += qtCols(typeAgg);
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  return html;
}

function buildUniformatView() {
  const { tree, totals, unclassified } = aggregateUniformat();
  let html = '';

  html += buildSummaryBar(totals);
  html += colHeader();

  const l1Order = ['A', 'B', 'C', 'D', 'E', 'F'];

  for (const l1Code of l1Order) {
    const l1Node = tree[l1Code];
    if (!l1Node) continue;

    const l1Color = getL1Color(l1Code);
    const l1Label = UNIFORMAT_HIERARCHY[l1Code]?.label || l1Code;

    if (qtSearchTerm) {
      const s = qtSearchTerm.toLowerCase();
      const codeMatch = l1Code.toLowerCase().includes(s);
      const labelMatch = l1Label.toLowerCase().includes(s);
      if (!codeMatch && !labelMatch) {
        const childMatch = Object.keys(l1Node.children).some(l2 => {
          const l2Label = L2_LABELS[l2] || '';
          return l2.toLowerCase().includes(s) || l2Label.toLowerCase().includes(s);
        });
        if (!childMatch) continue;
      }
    }

    html += `<div class="qt-node">`;
    html += `<div class="qt-row qt-row-group qt-l1-row" data-gid="${storeGroupKeys(l1Node.agg.elements)}">`;
    html += `<span class="qt-row-label"><span class="tree-toggle">▶</span><span class="qt-l1-badge" style="background:${l1Color}20;color:${l1Color}">${l1Code}</span>${l1Label}</span>`;
    html += qtCols(l1Node.agg);
    html += `</div>`;
    html += `<div class="tree-children qt-children">`;

    const l2Codes = Object.keys(l1Node.children).sort();
    for (const l2Code of l2Codes) {
      const l2Node = l1Node.children[l2Code];
      const l2Label = L2_LABELS[l2Code] || l2Code;

      html += `<div class="qt-l2-row">`;
      html += `<div class="qt-row qt-row-group qt-row-l2" data-gid="${storeGroupKeys(l2Node.agg.elements)}">`;
      html += `<span class="qt-row-label qt-row-indent"><span class="tree-toggle">▶</span><span class="qt-l2-code">${l2Code}</span>${l2Label}</span>`;
      html += qtCols(l2Node.agg);
      html += `</div>`;
      html += `<div class="tree-children qt-children">`;

      const l3Codes = Object.keys(l2Node.children).sort();
      for (const l3Code of l3Codes) {
        const l3Agg = l2Node.children[l3Code];
        const l3Label = L3_LABELS[l3Code] || l3Code;

        html += `<div class="qt-row qt-row-type qt-row-indent2" data-gid="${storeGroupKeys(l3Agg.elements)}">`;
        html += `<span class="qt-row-label"><span class="qt-l3-code">${l3Code}</span>${l3Label}</span>`;
        html += qtCols(l3Agg);
        html += `</div>`;
      }

      html += `</div></div>`;
    }

    html += `</div></div>`;
  }

  // Unclassified
  if (unclassified.ea > 0) {
    html += `<div class="qt-node qt-unclassified">`;
    html += `<div class="qt-row qt-row-group" data-gid="${storeGroupKeys(unclassified.elements)}">`;
    html += `<span class="qt-row-label">Unclassified</span>`;
    html += qtCols(unclassified);
    html += `</div></div>`;
  }

  return html;
}

function buildSummaryBar(totals) {
  let html = `<div class="qt-summary">`;
  html += `<div class="qt-stat"><span class="qt-stat-val">${totals.ea.toLocaleString()}</span><span class="qt-stat-label">EA</span></div>`;
  html += `<div class="qt-stat"><span class="qt-stat-val">${fmtQty(totals.sf)}</span><span class="qt-stat-label">SF</span></div>`;
  html += `<div class="qt-stat"><span class="qt-stat-val">${fmtQty(totals.lf)}</span><span class="qt-stat-label">LF</span></div>`;
  html += `<div class="qt-stat"><span class="qt-stat-val">${fmtQty(totals.cy)}</span><span class="qt-stat-label">CY</span></div>`;
  html += `</div>`;
  return html;
}

// ======================== TREE INTERACTIONS ========================

function selectGroupByGid(gid) {
  const keys = groupKeyStore.get(gid);
  if (keys && keys.length > 0 && window.__ufSetSelectedKeys) {
    window.__ufSetSelectedKeys(new Set(keys));
  }
}

function wireTreeInteractions() {
  const container = document.getElementById('qtTree');
  if (!container) return;

  // Group rows: toggle + select
  container.querySelectorAll('.qt-row-group').forEach(row => {
    row.addEventListener('click', () => {
      const toggle = row.querySelector('.tree-toggle');
      const children = row.closest('.qt-node, .qt-l2-row')?.querySelector('.qt-children');

      if (toggle && children) {
        const isOpen = toggle.textContent === '▼';
        toggle.textContent = isOpen ? '▶' : '▼';
        children.style.display = isOpen ? 'none' : 'block';
      }

      const gid = row.getAttribute('data-gid');
      if (gid) selectGroupByGid(gid);
    });
  });

  // Leaf rows: select only
  container.querySelectorAll('.qt-row-type').forEach(row => {
    row.addEventListener('click', () => {
      const gid = row.getAttribute('data-gid');
      if (gid) selectGroupByGid(gid);
    });
  });
}

// ======================== CSV EXPORT ========================

function exportQuantificationCSV() {
  const { elementDataMap } = getViewerState();
  const rows = [];

  if (currentMode === 'spatial') {
    rows.push(['Storey', 'IFC Type', 'Element Name', 'CompositeKey', 'EA', 'SF', 'LF', 'CY']);

    for (const [key, data] of elementDataMap) {
      const q = extractQuantities(data.props);
      const sf = q.area > 0 ? (q.area * M2_TO_SF).toFixed(2) : '';
      const lf = q.length > 0 ? (q.length * M_TO_LF).toFixed(2) : '';
      const cy = q.volume > 0 ? (q.volume * M3_TO_CY).toFixed(2) : '';
      rows.push([
        data.storey || 'Unassigned',
        data.ifcType || '',
        data.name || '',
        key,
        '1',
        sf, lf, cy,
      ]);
    }
  } else {
    rows.push(['UniFormat Code', 'UniFormat Label', 'IFC Type', 'Element Name',
               'CompositeKey', 'EA', 'SF', 'LF', 'CY']);

    for (const [key, data] of elementDataMap) {
      const q = extractQuantities(data.props);
      const cls = classifications.get(key);
      const code = cls?.code || '';
      const label = code ? (L3_LABELS[code] || '') : '';
      const sf = q.area > 0 ? (q.area * M2_TO_SF).toFixed(2) : '';
      const lf = q.length > 0 ? (q.length * M_TO_LF).toFixed(2) : '';
      const cy = q.volume > 0 ? (q.volume * M3_TO_CY).toFixed(2) : '';
      rows.push([
        code, label,
        data.ifcType || '',
        data.name || '',
        key,
        '1',
        sf, lf, cy,
      ]);
    }
  }

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quantification_${currentMode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ======================== INITIALIZATION ========================

function initQuantificationPanel() {
  buildQuantificationPanel();
}

function wireQuantificationEvents() {
  const spatialBtn = document.getElementById('qtModeSpatial');
  const uniformatBtn = document.getElementById('qtModeUniformat');

  if (spatialBtn) {
    spatialBtn.addEventListener('click', () => {
      currentMode = 'spatial';
      spatialBtn.classList.add('active');
      if (uniformatBtn) uniformatBtn.classList.remove('active');
      buildQuantificationPanel();
    });
  }
  if (uniformatBtn) {
    uniformatBtn.addEventListener('click', () => {
      currentMode = 'uniformat';
      uniformatBtn.classList.add('active');
      if (spatialBtn) spatialBtn.classList.remove('active');
      buildQuantificationPanel();
    });
  }

  const searchInput = document.getElementById('qtSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      qtSearchTerm = e.target.value;
      buildQuantificationPanel();
    });
  }

  const exportBtn = document.getElementById('qtExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportQuantificationCSV);
  }
}

export {
  initQuantificationPanel,
  wireQuantificationEvents,
  buildQuantificationPanel,
};
