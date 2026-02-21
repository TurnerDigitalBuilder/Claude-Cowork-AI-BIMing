/* ============================================================
   UniFormat Classification Tool — uniformat.js
   ASTM E1557-97 Uniformat II hierarchy with IFC auto-mapping,
   property-based classification detection, and manual overrides.
   ============================================================ */

import { getViewerState } from './viewer.js';

// ======================== UNIFORMAT II HIERARCHY (E1557-97) ========================
// Full Level 1 → Level 2 → Level 3 taxonomy from the ASTM standard

const UNIFORMAT_HIERARCHY = {
  A: {
    label: 'Substructure',
    children: {
      A10: {
        label: 'Foundations',
        children: {
          A1010: { label: 'Standard Foundations' },
          A1020: { label: 'Special Foundations' },
          A1030: { label: 'Slab on Grade' },
        },
      },
      A20: {
        label: 'Basement Construction',
        children: {
          A2010: { label: 'Basement Excavation' },
          A2020: { label: 'Basement Walls' },
        },
      },
    },
  },
  B: {
    label: 'Shell',
    children: {
      B10: {
        label: 'Superstructure',
        children: {
          B1010: { label: 'Floor Construction' },
          B1020: { label: 'Roof Construction' },
        },
      },
      B20: {
        label: 'Exterior Enclosure',
        children: {
          B2010: { label: 'Exterior Walls' },
          B2020: { label: 'Exterior Windows' },
          B2030: { label: 'Exterior Doors' },
        },
      },
      B30: {
        label: 'Roofing',
        children: {
          B3010: { label: 'Roof Coverings' },
          B3020: { label: 'Roof Openings' },
        },
      },
    },
  },
  C: {
    label: 'Interiors',
    children: {
      C10: {
        label: 'Interior Construction',
        children: {
          C1010: { label: 'Partitions' },
          C1020: { label: 'Interior Doors' },
          C1030: { label: 'Fittings' },
        },
      },
      C20: {
        label: 'Stairs',
        children: {
          C2010: { label: 'Stair Construction' },
          C2020: { label: 'Stair Finishes' },
        },
      },
      C30: {
        label: 'Interior Finishes',
        children: {
          C3010: { label: 'Wall Finishes' },
          C3020: { label: 'Floor Finishes' },
          C3030: { label: 'Ceiling Finishes' },
        },
      },
    },
  },
  D: {
    label: 'Services',
    children: {
      D10: {
        label: 'Conveying',
        children: {
          D1010: { label: 'Elevators & Lifts' },
          D1020: { label: 'Escalators & Moving Walks' },
          D1090: { label: 'Other Conveying Systems' },
        },
      },
      D20: {
        label: 'Plumbing',
        children: {
          D2010: { label: 'Plumbing Fixtures' },
          D2020: { label: 'Domestic Water Distribution' },
          D2030: { label: 'Sanitary Waste' },
          D2040: { label: 'Rain Water Drainage' },
          D2090: { label: 'Other Plumbing Systems' },
        },
      },
      D30: {
        label: 'HVAC',
        children: {
          D3010: { label: 'Energy Supply' },
          D3020: { label: 'Heat Generating Systems' },
          D3030: { label: 'Cooling Generating Systems' },
          D3040: { label: 'Distribution Systems' },
          D3050: { label: 'Terminal & Package Units' },
          D3060: { label: 'Controls & Instrumentation' },
          D3070: { label: 'Systems Testing & Balancing' },
          D3090: { label: 'Other HVAC Systems & Equipment' },
        },
      },
      D40: {
        label: 'Fire Protection',
        children: {
          D4010: { label: 'Sprinklers' },
          D4020: { label: 'Standpipes' },
          D4030: { label: 'Fire Protection Specialties' },
          D4090: { label: 'Other Fire Protection Systems' },
        },
      },
      D50: {
        label: 'Electrical',
        children: {
          D5010: { label: 'Electrical Service & Distribution' },
          D5020: { label: 'Lighting and Branch Wiring' },
          D5030: { label: 'Communications & Security' },
          D5090: { label: 'Other Electrical Systems' },
        },
      },
    },
  },
  E: {
    label: 'Equipment & Furnishings',
    children: {
      E10: {
        label: 'Equipment',
        children: {
          E1010: { label: 'Commercial Equipment' },
          E1020: { label: 'Institutional Equipment' },
          E1030: { label: 'Vehicular Equipment' },
          E1090: { label: 'Other Equipment' },
        },
      },
      E20: {
        label: 'Furnishings',
        children: {
          E2010: { label: 'Fixed Furnishings' },
          E2020: { label: 'Movable Furnishings' },
        },
      },
    },
  },
  F: {
    label: 'Special Construction & Demolition',
    children: {
      F10: {
        label: 'Special Construction',
        children: {
          F1010: { label: 'Special Structures' },
          F1020: { label: 'Integrated Construction' },
          F1030: { label: 'Special Construction Systems' },
          F1040: { label: 'Special Facilities' },
          F1050: { label: 'Special Controls & Instrumentation' },
        },
      },
      F20: {
        label: 'Selective Building Demolition',
        children: {
          F2010: { label: 'Building Elements Demolition' },
          F2020: { label: 'Hazardous Components Abatement' },
        },
      },
    },
  },
};

// ======================== FLAT LOOKUP TABLES ========================

// Build flat code→label map for all L3 codes
const L3_LABELS = {};
const L2_LABELS = {};
const L1_LABELS = {};

for (const [l1Code, l1] of Object.entries(UNIFORMAT_HIERARCHY)) {
  L1_LABELS[l1Code] = l1.label;
  for (const [l2Code, l2] of Object.entries(l1.children)) {
    L2_LABELS[l2Code] = l2.label;
    for (const [l3Code, l3] of Object.entries(l2.children)) {
      L3_LABELS[l3Code] = l3.label;
    }
  }
}

// All valid L3 codes for dropdown population
const ALL_L3_CODES = Object.keys(L3_LABELS).sort();

// ======================== IFC TYPE → UNIFORMAT L3 MAPPING ========================
// Default mapping from IFC entity types. Uses heuristics based on typical construction usage.
// These defaults can be refined by property-based detection (IsExternal, storey position, etc.)

const IFC_TYPE_DEFAULT_MAP = {
  // Substructure
  IFCFOOTING:               'A1010',  // Standard Foundations
  IFCPILE:                  'A1020',  // Special Foundations

  // Shell — Superstructure
  IFCBEAM:                  'B1010',  // Floor Construction (structural frame)
  IFCCOLUMN:                'B1010',  // Floor Construction (structural frame)
  IFCMEMBER:                'B1010',  // Floor Construction (structural frame)
  IFCPLATE:                 'B1010',  // Floor Construction (structural plate/deck)
  IFCSLAB:                  'B1010',  // Floor Construction (default — refined by context)
  IFCELEMENTASSEMBLY:       'B1010',  // Floor Construction (typically structural assemblies)

  // Shell — Exterior Enclosure
  IFCWALL:                  'B2010',  // Exterior Walls (default — refined by IsExternal)
  IFCWALLSTANDARDCASE:      'B2010',  // Exterior Walls (default — refined by IsExternal)
  IFCCURTAINWALL:           'B2010',  // Exterior Walls
  IFCWINDOW:                'B2020',  // Exterior Windows (default — refined by IsExternal)
  IFCDOOR:                  'B2030',  // Exterior Doors (default — refined by IsExternal)

  // Interiors
  IFCRAILING:               'C1030',  // Fittings
  IFCSTAIR:                 'C2010',  // Stair Construction
  IFCSTAIRFLIGHT:           'C2010',  // Stair Construction
  IFCRAMP:                  'C2010',  // Stair Construction (ramps grouped with stairs)
  IFCRAMPFLIGHT:            'C2010',  // Stair Construction

  // Catch-all
  IFCBUILDINGELEMENTPROXY:  null,     // Unclassified — needs manual assignment
};

// ======================== STATE ========================

// compositeKey → { code, source, confidence }
//   code: UniFormat L3 code (e.g. 'B1010')
//   source: 'ifc-property' | 'auto-mapped' | 'manual'
//   confidence: 0-1 (1 = from IFC classification data, 0.7 = auto-mapped, 1 = manual override)
let classifications = new Map();

// Manual overrides persist per session: compositeKey → L3 code
let manualOverrides = new Map();

// Current tree filter
let ufSearchTerm = '';

// ======================== CLASSIFICATION ENGINE ========================

/**
 * Classify all loaded elements. Runs three passes:
 * 1. Check IFC property sets for existing UniFormat/classification codes
 * 2. Apply context-aware heuristics (IsExternal, storey position)
 * 3. Fall back to IFC type default mapping
 * Manual overrides always take priority.
 */
function classifyAllElements() {
  const { elementDataMap } = getViewerState();
  classifications.clear();

  for (const [key, data] of elementDataMap) {
    // Manual override always wins
    if (manualOverrides.has(key)) {
      classifications.set(key, {
        code: manualOverrides.get(key),
        source: 'manual',
        confidence: 1.0,
      });
      continue;
    }

    // Pass 1: Check properties for existing UniFormat classification
    const fromProps = detectFromProperties(data);
    if (fromProps) {
      classifications.set(key, {
        code: fromProps,
        source: 'ifc-property',
        confidence: 1.0,
      });
      continue;
    }

    // Pass 2: Context-aware auto-mapping
    const contextCode = contextAwareMap(data);
    if (contextCode) {
      classifications.set(key, {
        code: contextCode,
        source: 'auto-mapped',
        confidence: 0.7,
      });
      continue;
    }

    // Pass 3: Direct IFC type default
    const defaultCode = IFC_TYPE_DEFAULT_MAP[data.ifcType] || null;
    if (defaultCode) {
      classifications.set(key, {
        code: defaultCode,
        source: 'auto-mapped',
        confidence: 0.5,
      });
    } else {
      // Unclassified
      classifications.set(key, {
        code: null,
        source: 'none',
        confidence: 0,
      });
    }
  }
}

/**
 * Check element property sets for existing UniFormat/Uniformat codes.
 * Looks for patterns like "A1010", "B2010" etc. in classification-related properties.
 */
function detectFromProperties(data) {
  if (!data.props) return null;

  const classificationKeys = [
    'uniformat', 'uniformatii', 'classification', 'assembly code',
    'assemblycode', 'assembly_code', 'omniclass', 'uniclass',
    'classificationcode', 'classification code',
  ];

  // Regex to match UniFormat L3 codes: letter + 4 digits (e.g. A1010, B2030)
  const ufPattern = /^[A-F]\d{4}$/;

  for (const [propKey, propVal] of Object.entries(data.props)) {
    const keyLower = propKey.toLowerCase();
    const isClassProp = classificationKeys.some(ck => keyLower.includes(ck));

    if (isClassProp && typeof propVal === 'string') {
      // Try to extract a UniFormat code from the value
      const cleaned = propVal.trim().replace(/[.\-\s]/g, '');
      if (ufPattern.test(cleaned) && L3_LABELS[cleaned]) {
        return cleaned;
      }
      // Try partial match — some models use "B20.10" or "B20-10" format
      const parts = propVal.replace(/[.\-\s]/g, '');
      if (ufPattern.test(parts) && L3_LABELS[parts]) {
        return parts;
      }
    }
  }
  return null;
}

/**
 * Apply context-aware heuristics to refine the default mapping.
 * Uses IsExternal property, storey elevation, name patterns, etc.
 */
function contextAwareMap(data) {
  const type = data.ifcType;
  const props = data.props || {};
  const name = (data.name || '').toLowerCase();
  const storey = (data.storey || '').toLowerCase();

  // Detect IsExternal from properties
  let isExternal = null;
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase().includes('isexternal') || k.toLowerCase().includes('is_external')) {
      if (v === true || v === 'True' || v === '.T.' || v === 1) isExternal = true;
      else if (v === false || v === 'False' || v === '.F.' || v === 0) isExternal = false;
    }
  }

  // --- WALLS ---
  if (type === 'IFCWALL' || type === 'IFCWALLSTANDARDCASE') {
    if (isExternal === false) return 'C1010';  // Interior partition
    if (name.includes('partition') || name.includes('interior')) return 'C1010';
    // Basement walls check
    if (storey.includes('basement') || storey.includes('b1') || storey.includes('b2') ||
        storey.includes('underground') || storey.includes('sub')) return 'A2020';
    return 'B2010';  // Default: exterior wall
  }

  // --- DOORS ---
  if (type === 'IFCDOOR') {
    if (isExternal === false) return 'C1020';  // Interior door
    if (name.includes('interior') || name.includes('int.')) return 'C1020';
    return 'B2030';  // Default: exterior door
  }

  // --- WINDOWS ---
  if (type === 'IFCWINDOW') {
    // Windows are almost always exterior in residential/commercial
    return 'B2020';
  }

  // --- SLABS ---
  if (type === 'IFCSLAB') {
    if (name.includes('roof') || storey.includes('roof')) return 'B1020';
    if (name.includes('grade') || name.includes('sog') || name.includes('on grade')) return 'A1030';
    if (storey.includes('basement') || storey.includes('foundation')) return 'A1030';
    return 'B1010';  // Default: floor construction
  }

  // --- FOOTINGS ---
  if (type === 'IFCFOOTING') {
    if (name.includes('pile') || name.includes('caisson') || name.includes('drilled')) return 'A1020';
    return 'A1010';
  }

  return null;  // No context refinement available
}

// ======================== MANUAL OVERRIDE ========================

function setManualClassification(compositeKey, l3Code) {
  if (l3Code && L3_LABELS[l3Code]) {
    manualOverrides.set(compositeKey, l3Code);
    classifications.set(compositeKey, {
      code: l3Code,
      source: 'manual',
      confidence: 1.0,
    });
  } else if (l3Code === null) {
    manualOverrides.delete(compositeKey);
    // Re-classify this element from scratch
    const { elementDataMap } = getViewerState();
    const data = elementDataMap.get(compositeKey);
    if (data) {
      const fromProps = detectFromProperties(data);
      if (fromProps) {
        classifications.set(compositeKey, { code: fromProps, source: 'ifc-property', confidence: 1.0 });
      } else {
        const ctx = contextAwareMap(data);
        if (ctx) {
          classifications.set(compositeKey, { code: ctx, source: 'auto-mapped', confidence: 0.7 });
        } else {
          const def = IFC_TYPE_DEFAULT_MAP[data.ifcType] || null;
          classifications.set(compositeKey, { code: def, source: def ? 'auto-mapped' : 'none', confidence: def ? 0.5 : 0 });
        }
      }
    }
  }
  saveOverrides(); // auto-persist
  buildUniformatTree();
}

/**
 * Bulk assign: set all elements of a given IFC type to a specific L3 code.
 */
function bulkAssignByType(ifcType, l3Code) {
  const { elementDataMap } = getViewerState();
  for (const [key, data] of elementDataMap) {
    if (data.ifcType === ifcType) {
      // Apply directly to avoid per-element save + tree rebuild
      if (l3Code && L3_LABELS[l3Code]) {
        manualOverrides.set(key, l3Code);
        classifications.set(key, { code: l3Code, source: 'manual', confidence: 1.0 });
      }
    }
  }
  saveOverrides(); // single save for the whole batch
  buildUniformatTree();
}

// ======================== STATISTICS ========================

function getClassificationStats() {
  let total = 0, classified = 0, fromProperty = 0, autoMapped = 0, manual = 0, unclassified = 0;

  for (const [, cls] of classifications) {
    total++;
    if (cls.code) {
      classified++;
      if (cls.source === 'ifc-property') fromProperty++;
      else if (cls.source === 'auto-mapped') autoMapped++;
      else if (cls.source === 'manual') manual++;
    } else {
      unclassified++;
    }
  }

  return { total, classified, fromProperty, autoMapped, manual, unclassified };
}

// ======================== TREE UI ========================

function buildUniformatTree() {
  const container = document.getElementById('uniformatTree');
  if (!container) return;

  const { elementDataMap, models } = getViewerState();
  const stats = getClassificationStats();

  // Group elements by L1 → L2 → L3
  const grouped = {};    // { L1: { L2: { L3: [elements] } } }
  const unclassifiedList = [];

  for (const [key, cls] of classifications) {
    const data = elementDataMap.get(key);
    if (!data) continue;

    // Apply search filter
    if (ufSearchTerm) {
      const s = ufSearchTerm.toLowerCase();
      const nameMatch = data.name.toLowerCase().includes(s);
      const typeMatch = data.ifcType.toLowerCase().includes(s);
      const codeMatch = cls.code && cls.code.toLowerCase().includes(s);
      const labelMatch = cls.code && L3_LABELS[cls.code] &&
        L3_LABELS[cls.code].toLowerCase().includes(s);
      if (!nameMatch && !typeMatch && !codeMatch && !labelMatch) continue;
    }

    if (!cls.code) {
      unclassifiedList.push({ key, ...data, cls });
      continue;
    }

    const l3 = cls.code;
    const l2 = l3.substring(0, 3);
    const l1 = l3.substring(0, 1);

    if (!grouped[l1]) grouped[l1] = {};
    if (!grouped[l1][l2]) grouped[l1][l2] = {};
    if (!grouped[l1][l2][l3]) grouped[l1][l2][l3] = [];
    grouped[l1][l2][l3].push({ key, ...data, cls });
  }

  // Build stats bar
  let html = '';
  html += `<div class="uf-stats">`;
  html += `<div class="uf-stat"><span class="uf-stat-val">${stats.classified}</span><span class="uf-stat-label">Classified</span></div>`;
  html += `<div class="uf-stat"><span class="uf-stat-val uf-unclassified">${stats.unclassified}</span><span class="uf-stat-label">Unclassified</span></div>`;
  html += `<div class="uf-stat"><span class="uf-stat-val">${stats.manual}</span><span class="uf-stat-label">Manual</span></div>`;
  const pct = stats.total > 0 ? ((stats.classified / stats.total) * 100).toFixed(0) : 0;
  html += `<div class="uf-stat"><span class="uf-stat-val uf-pct">${pct}%</span><span class="uf-stat-label">Coverage</span></div>`;
  html += `</div>`;

  // Render L1 → L2 → L3 → elements
  const l1Order = ['A', 'B', 'C', 'D', 'E', 'F'];

  for (const l1Code of l1Order) {
    if (!grouped[l1Code] && !ufSearchTerm) {
      // Show empty L1 nodes when not searching
      html += buildEmptyL1Node(l1Code);
      continue;
    }
    if (!grouped[l1Code]) continue;

    const l1Data = grouped[l1Code];
    const l1Total = countL1(l1Data);
    const l1Color = getL1Color(l1Code);

    html += `<div class="uf-node">`;
    html += `<div class="uf-l1-header" data-l1="${l1Code}">`;
    html += `<span class="tree-toggle">▶</span>`;
    html += `<span class="uf-l1-badge" style="background:${l1Color}20;color:${l1Color}">${l1Code}</span>`;
    html += `<span class="uf-l1-label">${UNIFORMAT_HIERARCHY[l1Code].label}</span>`;
    html += `<span class="tree-count">${l1Total}</span>`;
    html += `</div>`;
    html += `<div class="tree-children" data-uf-l1-children="${l1Code}">`;

    const l2Codes = Object.keys(l1Data).sort();
    for (const l2Code of l2Codes) {
      const l2Data = l1Data[l2Code];
      const l2Total = countL2(l2Data);
      const l2Label = L2_LABELS[l2Code] || l2Code;

      html += `<div class="uf-l2-header" data-l2="${l2Code}">`;
      html += `<span class="tree-toggle">▶</span>`;
      html += `<span class="uf-l2-code">${l2Code}</span>`;
      html += `<span class="uf-l2-label">${l2Label}</span>`;
      html += `<span class="tree-count">${l2Total}</span>`;
      html += `</div>`;
      html += `<div class="tree-children" data-uf-l2-children="${l2Code}">`;

      const l3Codes = Object.keys(l2Data).sort();
      for (const l3Code of l3Codes) {
        const elements = l2Data[l3Code];
        const l3Label = L3_LABELS[l3Code] || l3Code;

        html += `<div class="uf-l3-header" data-l3="${l3Code}">`;
        html += `<span class="tree-toggle">▶</span>`;
        html += `<span class="uf-l3-code">${l3Code}</span>`;
        html += `<span class="uf-l3-label">${l3Label}</span>`;
        html += `<span class="tree-count">${elements.length}</span>`;
        html += `</div>`;
        html += `<div class="tree-children" data-uf-l3-children="${l3Code}">`;

        for (const elem of elements) {
          const srcIcon = elem.cls.source === 'manual' ? '✎' :
                          elem.cls.source === 'ifc-property' ? '◆' : '⚙';
          const srcClass = elem.cls.source === 'manual' ? 'src-manual' :
                           elem.cls.source === 'ifc-property' ? 'src-prop' : 'src-auto';
          html += `<div class="uf-element" data-key="${elem.key}">`;
          html += `<span class="uf-src-icon ${srcClass}" title="${elem.cls.source}">${srcIcon}</span>`;
          html += `<span class="uf-elem-name">${elem.name}</span>`;
          html += `<span class="uf-elem-type">${fmtType(elem.ifcType)}</span>`;
          html += `</div>`;
        }

        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  // Unclassified section
  if (unclassifiedList.length > 0) {
    html += `<div class="uf-node">`;
    html += `<div class="uf-unclass-header" data-l1="UNCLASSIFIED">`;
    html += `<span class="tree-toggle">▶</span>`;
    html += `<span class="uf-l1-badge" style="background:rgba(248,113,113,0.15);color:#f87171">?</span>`;
    html += `<span class="uf-l1-label">Unclassified</span>`;
    html += `<span class="tree-count uf-unclass-count">${unclassifiedList.length}</span>`;
    html += `</div>`;
    html += `<div class="tree-children" data-uf-l1-children="UNCLASSIFIED">`;

    // Group unclassified by IFC type
    const byType = {};
    for (const elem of unclassifiedList) {
      if (!byType[elem.ifcType]) byType[elem.ifcType] = [];
      byType[elem.ifcType].push(elem);
    }

    for (const [type, elems] of Object.entries(byType).sort()) {
      html += `<div class="uf-l3-header uf-unclass-type" data-unclass-type="${type}">`;
      html += `<span class="tree-toggle">▶</span>`;
      html += `<span class="uf-l3-label">${fmtType(type)}</span>`;
      html += `<span class="tree-count">${elems.length}</span>`;
      html += `<button class="uf-bulk-assign-btn" data-ifc-type="${type}" title="Bulk assign all ${fmtType(type)} elements">Assign</button>`;
      html += `</div>`;
      html += `<div class="tree-children" data-uf-unclass-children="${type}">`;
      for (const elem of elems) {
        html += `<div class="uf-element" data-key="${elem.key}">`;
        html += `<span class="uf-src-icon src-none">○</span>`;
        html += `<span class="uf-elem-name">${elem.name}</span>`;
        html += `<span class="uf-elem-type">${fmtType(elem.ifcType)}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;
  wireTreeEvents(container);
}

function buildEmptyL1Node(l1Code) {
  const l1Color = getL1Color(l1Code);
  let html = `<div class="uf-node uf-empty">`;
  html += `<div class="uf-l1-header uf-l1-empty" data-l1="${l1Code}">`;
  html += `<span class="tree-toggle" style="visibility:hidden">▶</span>`;
  html += `<span class="uf-l1-badge" style="background:${l1Color}10;color:${l1Color}66">${l1Code}</span>`;
  html += `<span class="uf-l1-label" style="opacity:0.4">${UNIFORMAT_HIERARCHY[l1Code].label}</span>`;
  html += `<span class="tree-count" style="opacity:0.3">0</span>`;
  html += `</div></div>`;
  return html;
}

// ======================== TREE EVENT WIRING ========================

function wireTreeEvents(container) {

  // Helper: toggle expand/collapse for a header row
  function toggleExpand(header, childrenSelector) {
    const children = container.querySelector(childrenSelector);
    if (!children) return;
    const toggle = header.querySelector('.tree-toggle');
    children.classList.toggle('open');
    toggle.classList.toggle('open');
  }

  // --- L1 headers ---
  container.querySelectorAll('.uf-l1-header, .uf-unclass-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.uf-bulk-assign-btn')) return;
      const l1 = header.dataset.l1;

      // Click on the toggle arrow → expand/collapse only
      if (e.target.closest('.tree-toggle')) {
        toggleExpand(header, `[data-uf-l1-children="${l1}"]`);
        return;
      }

      // Click anywhere else on the header → select group in 3D
      if (l1 !== 'UNCLASSIFIED') {
        selectByUniformat(l1, null, null);
      }
      // Also expand if collapsed
      const children = container.querySelector(`[data-uf-l1-children="${l1}"]`);
      if (children && !children.classList.contains('open')) {
        toggleExpand(header, `[data-uf-l1-children="${l1}"]`);
      }
    });

    // Double-click to isolate (show only those elements)
    header.addEventListener('dblclick', () => {
      if (header.dataset.l1 !== 'UNCLASSIFIED') {
        isolateByUniformat(header.dataset.l1, null, null);
      }
    });
  });

  // --- L2 headers ---
  container.querySelectorAll('.uf-l2-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.uf-bulk-assign-btn')) return;
      const l2 = header.dataset.l2;

      if (e.target.closest('.tree-toggle')) {
        toggleExpand(header, `[data-uf-l2-children="${l2}"]`);
        return;
      }

      // Select group in 3D
      selectByUniformat(null, l2, null);
      // Also expand
      const children = container.querySelector(`[data-uf-l2-children="${l2}"]`);
      if (children && !children.classList.contains('open')) {
        toggleExpand(header, `[data-uf-l2-children="${l2}"]`);
      }
    });

    header.addEventListener('dblclick', () => {
      isolateByUniformat(null, header.dataset.l2, null);
    });
  });

  // --- L3 headers ---
  container.querySelectorAll('.uf-l3-header').forEach(header => {
    // Skip unclassified type subgroups (they have data-unclass-type, handled below)
    if (header.dataset.unclassType) return;

    header.addEventListener('click', (e) => {
      if (e.target.closest('.uf-bulk-assign-btn')) return;
      const l3 = header.dataset.l3;

      if (e.target.closest('.tree-toggle')) {
        toggleExpand(header, `[data-uf-l3-children="${l3}"]`);
        return;
      }

      // Select group in 3D
      selectByUniformat(null, null, l3);
      // Also expand
      const children = container.querySelector(`[data-uf-l3-children="${l3}"]`);
      if (children && !children.classList.contains('open')) {
        toggleExpand(header, `[data-uf-l3-children="${l3}"]`);
      }
    });

    header.addEventListener('dblclick', () => {
      isolateByUniformat(null, null, header.dataset.l3);
    });
  });

  // --- Unclassified type groups (expand/collapse only, no group select) ---
  container.querySelectorAll('.uf-unclass-type').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.uf-bulk-assign-btn')) return;
      const type = header.dataset.unclassType;
      toggleExpand(header, `[data-uf-unclass-children="${type}"]`);
    });
  });

  // --- Individual element click → select single in viewer ---
  container.querySelectorAll('.uf-element').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      // Clear group selection first if active
      if (selectedGroup) clearGroupSelection();
      const key = el.dataset.key;
      if (window.__ufSelectElement) {
        window.__ufSelectElement(key);
      }
    });

    // Right-click for manual override
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showOverrideMenu(el.dataset.key, e.clientX, e.clientY);
    });
  });

  // --- Bulk assign buttons ---
  container.querySelectorAll('.uf-bulk-assign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showBulkAssignMenu(btn.dataset.ifcType, e.clientX, e.clientY);
    });
  });
}

// ======================== OVERRIDE MENU ========================

let activeOverlayEl = null;

function showOverrideMenu(compositeKey, x, y) {
  removeOverrideMenu();

  const { elementDataMap } = getViewerState();
  const data = elementDataMap.get(compositeKey);
  const cls = classifications.get(compositeKey);
  if (!data) return;

  const menu = document.createElement('div');
  menu.className = 'uf-override-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  let html = `<div class="uf-override-header">${data.name}</div>`;
  html += `<div class="uf-override-meta">${fmtType(data.ifcType)} · ${cls?.code || 'Unclassified'}</div>`;
  html += `<div class="uf-override-label">Assign UniFormat Code:</div>`;
  html += `<select class="uf-override-select" id="ufOverrideSelect">`;
  html += `<option value="">— Select code —</option>`;

  for (const [l1Code, l1] of Object.entries(UNIFORMAT_HIERARCHY)) {
    html += `<optgroup label="${l1Code} - ${l1.label}">`;
    for (const [l2Code, l2] of Object.entries(l1.children)) {
      for (const [l3Code, l3] of Object.entries(l2.children)) {
        const selected = cls?.code === l3Code ? ' selected' : '';
        html += `<option value="${l3Code}"${selected}>${l3Code} — ${l3.label}</option>`;
      }
    }
    html += `</optgroup>`;
  }

  html += `</select>`;
  if (cls?.source === 'manual') {
    html += `<button class="uf-override-reset" id="ufOverrideReset">Reset to Auto</button>`;
  }

  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeOverlayEl = menu;

  // Keep menu in viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  });

  // Wire select change
  menu.querySelector('#ufOverrideSelect').addEventListener('change', (e) => {
    const code = e.target.value;
    if (code) {
      setManualClassification(compositeKey, code);
      removeOverrideMenu();
    }
  });

  // Wire reset button
  const resetBtn = menu.querySelector('#ufOverrideReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      setManualClassification(compositeKey, null);
      removeOverrideMenu();
    });
  }

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', onOverrideClickOutside);
  }, 10);
}

function showBulkAssignMenu(ifcType, x, y) {
  removeOverrideMenu();

  const menu = document.createElement('div');
  menu.className = 'uf-override-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  let html = `<div class="uf-override-header">Bulk Assign: ${fmtType(ifcType)}</div>`;
  html += `<div class="uf-override-meta">All unclassified ${fmtType(ifcType)} elements</div>`;
  html += `<div class="uf-override-label">Assign UniFormat Code:</div>`;
  html += `<select class="uf-override-select" id="ufBulkSelect">`;
  html += `<option value="">— Select code —</option>`;

  for (const [l1Code, l1] of Object.entries(UNIFORMAT_HIERARCHY)) {
    html += `<optgroup label="${l1Code} - ${l1.label}">`;
    for (const [l2Code, l2] of Object.entries(l1.children)) {
      for (const [l3Code, l3] of Object.entries(l2.children)) {
        html += `<option value="${l3Code}">${l3Code} — ${l3.label}</option>`;
      }
    }
    html += `</optgroup>`;
  }
  html += `</select>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeOverlayEl = menu;

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  });

  menu.querySelector('#ufBulkSelect').addEventListener('change', (e) => {
    const code = e.target.value;
    if (code) {
      bulkAssignByType(ifcType, code);
      removeOverrideMenu();
    }
  });

  setTimeout(() => {
    document.addEventListener('click', onOverrideClickOutside);
  }, 10);
}

function onOverrideClickOutside(e) {
  if (activeOverlayEl && !activeOverlayEl.contains(e.target)) {
    removeOverrideMenu();
  }
}

function removeOverrideMenu() {
  if (activeOverlayEl) {
    activeOverlayEl.remove();
    activeOverlayEl = null;
  }
  document.removeEventListener('click', onOverrideClickOutside);
}

// ======================== 3D SELECTION / ISOLATION BY UNIFORMAT ========================

// Track which group header is currently "selected" so we can highlight it in the tree
let selectedGroup = null;  // { level: 'l1'|'l2'|'l3', code: string } or null

/**
 * Collect all composite keys that match a given UniFormat filter.
 */
function getKeysForFilter(l1Filter, l2Filter, l3Filter) {
  const keys = [];
  for (const [key, cls] of classifications) {
    const code = cls?.code;
    if (!code) continue;
    if (l3Filter && code === l3Filter) keys.push(key);
    else if (l2Filter && code.startsWith(l2Filter)) keys.push(key);
    else if (l1Filter && code.startsWith(l1Filter)) keys.push(key);
  }
  return keys;
}

/**
 * Select (highlight) all elements matching a UniFormat group in the 3D viewer.
 * Single-click on a group header: highlights matching elements with selection color,
 * dims everything else — like selecting a single element but for a whole group.
 */
function selectByUniformat(l1Filter, l2Filter, l3Filter) {
  const { elementMeshMap } = getViewerState();

  // Toggle: if the same group is already selected, deselect it
  const code = l3Filter || l2Filter || l1Filter;
  const level = l3Filter ? 'l3' : l2Filter ? 'l2' : 'l1';
  if (selectedGroup && selectedGroup.level === level && selectedGroup.code === code) {
    clearGroupSelection();
    return;
  }

  const matchingKeys = new Set(getKeysForFilter(l1Filter, l2Filter, l3Filter));

  if (matchingKeys.size === 0) return;

  // Clear any existing viewer selection first (without restoring materials — we handle that)
  if (window.__ufClearSelection) window.__ufClearSelection();

  // Push matching keys into the viewer's selectedKeys so right-click context menu works
  if (window.__ufSetSelectedKeys) window.__ufSetSelectedKeys(matchingKeys);

  // Highlight matching, dim others
  for (const [key, mesh] of elementMeshMap) {
    if (matchingKeys.has(key)) {
      // Store originals for restore
      if (!mesh.userData._ufOrigColor) {
        mesh.userData._ufOrigColor = mesh.material.color.getHex();
        mesh.userData._ufOrigOpacity = mesh.material.opacity;
        mesh.userData._ufOrigEmissive = mesh.material.emissive.getHex();
      }
      mesh.material.color.setHex(0x4d8ef7);
      mesh.material.opacity = 1.0;
      mesh.material.emissive.setHex(0x1a3a7a);
      mesh.visible = true;
      mesh.userData._ufSelected = true;
    } else {
      if (!mesh.userData._ufOrigOpacity2) {
        mesh.userData._ufOrigOpacity2 = mesh.material.opacity;
      }
      mesh.material.opacity = 0.06;
      mesh.userData._ufSelected = false;
    }
  }

  // Track the group selection for tree highlighting
  selectedGroup = { level, code };

  // Update tree header styling
  updateTreeSelection(selectedGroup);

  // Update the selection info bar with group summary
  const label = l3Filter ? `${l3Filter} — ${L3_LABELS[l3Filter] || ''}` :
                l2Filter ? `${l2Filter} — ${L2_LABELS[l2Filter] || ''}` :
                `${l1Filter} — ${L1_LABELS[l1Filter] || ''}`;
  showGroupSelectionInfo(label, matchingKeys.size);
}

/**
 * Clear group selection and restore all mesh materials.
 */
function clearGroupSelection() {
  const { elementMeshMap, hiddenKeys } = getViewerState();

  for (const [key, mesh] of elementMeshMap) {
    // Restore original colors/emissive from group highlight
    if (mesh.userData._ufOrigColor !== undefined) {
      mesh.material.color.setHex(mesh.userData._ufOrigColor);
      mesh.material.emissive.setHex(mesh.userData._ufOrigEmissive || 0x000000);
      delete mesh.userData._ufOrigColor;
      delete mesh.userData._ufOrigEmissive;
    }
    if (mesh.userData._ufOrigOpacity !== undefined) {
      mesh.material.opacity = mesh.userData._ufOrigOpacity;
      delete mesh.userData._ufOrigOpacity;
    }
    if (mesh.userData._ufOrigOpacity2 !== undefined) {
      mesh.material.opacity = mesh.userData._ufOrigOpacity2;
      delete mesh.userData._ufOrigOpacity2;
    }
    mesh.userData._ufSelected = false;

    // Respect existing isolation/hide state — only restore visible elements
    if (hiddenKeys && hiddenKeys.has(key)) {
      mesh.visible = false;
    } else {
      mesh.visible = true;
      mesh.material.opacity = 0.88;
      mesh.material.depthWrite = true;
    }
  }

  selectedGroup = null;
  updateTreeSelection(null);
  hideGroupSelectionInfo();

  // Clear the viewer's selectedKeys so right-click no longer sees a selection
  if (window.__ufSetSelectedKeys) window.__ufSetSelectedKeys(new Set());
}

/**
 * Isolate (show only) elements matching a UniFormat group.
 * Double-click on a group header: shows ONLY matching elements.
 */
function isolateByUniformat(l1Filter, l2Filter, l3Filter) {
  const { elementMeshMap } = getViewerState();

  for (const [key, mesh] of elementMeshMap) {
    const cls = classifications.get(key);
    const code = cls?.code;

    let match = false;
    if (code) {
      if (l3Filter) match = (code === l3Filter);
      else if (l2Filter) match = code.startsWith(l2Filter);
      else if (l1Filter) match = code.startsWith(l1Filter);
    }

    if (match) {
      mesh.material.opacity = 0.88;
      mesh.visible = true;
    } else {
      mesh.material.opacity = 0.06;
    }
  }
}

/**
 * Highlight the currently selected group header in the tree UI.
 */
function updateTreeSelection(group) {
  // Remove all existing selected states
  document.querySelectorAll('.uf-l1-header, .uf-l2-header, .uf-l3-header, .uf-unclass-header')
    .forEach(el => el.classList.remove('uf-group-selected'));

  if (!group) return;

  let selector;
  if (group.level === 'l1') selector = `.uf-l1-header[data-l1="${group.code}"]`;
  else if (group.level === 'l2') selector = `.uf-l2-header[data-l2="${group.code}"]`;
  else if (group.level === 'l3') selector = `.uf-l3-header[data-l3="${group.code}"]`;

  if (selector) {
    const el = document.querySelector(selector);
    if (el) el.classList.add('uf-group-selected');
  }
}

/**
 * Show a group selection info bar at the bottom of the viewer.
 */
function showGroupSelectionInfo(label, count) {
  const el = document.getElementById('selName');
  const meta = document.getElementById('selMeta');
  const bar = document.getElementById('selectionInfo');
  if (!el || !meta || !bar) return;

  el.textContent = label;
  meta.textContent = `${count} element${count !== 1 ? 's' : ''} selected (UniFormat group)`;
  bar.classList.add('visible');
}

function hideGroupSelectionInfo() {
  const bar = document.getElementById('selectionInfo');
  if (bar) bar.classList.remove('visible');
}

// ======================== EXPORT CLASSIFICATION DATA ========================

function exportClassifications() {
  const { elementDataMap } = getViewerState();
  const rows = [['CompositeKey', 'Name', 'IFC Type', 'Storey', 'UniFormat Code', 'UniFormat Label', 'Source', 'Confidence']];

  for (const [key, cls] of classifications) {
    const data = elementDataMap.get(key);
    if (!data) continue;
    rows.push([
      key,
      data.name,
      data.ifcType,
      data.storey,
      cls.code || '',
      cls.code ? (L3_LABELS[cls.code] || '') : '',
      cls.source,
      cls.confidence.toFixed(2),
    ]);
  }

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'uniformat_classification.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ======================== SAVE / LOAD OVERRIDES ========================

const OVERRIDES_STORAGE_KEY = 'uf_manual_overrides';

/**
 * Build a stable key for persistence: "filename:expressID"
 * The composite key "modelIdx:expressID" changes every session, so we
 * resolve modelIdx → filename for a key that survives reload.
 */
function toStableKey(compositeKey) {
  const { models } = getViewerState();
  const [idxStr, eidStr] = compositeKey.split(':');
  const modelIdx = parseInt(idxStr);
  const model = models.find(m => m.idx === modelIdx);
  if (!model) return null;
  return `${model.filename}:${eidStr}`;
}

/**
 * Resolve a stable key back to a composite key for the current session.
 */
function fromStableKey(stableKey) {
  const { models } = getViewerState();
  const colonIdx = stableKey.lastIndexOf(':');
  if (colonIdx < 0) return null;
  const filename = stableKey.substring(0, colonIdx);
  const eid = stableKey.substring(colonIdx + 1);
  const model = models.find(m => m.filename === filename);
  if (!model) return null;
  return `${model.idx}:${eid}`;
}

/**
 * Save all manual overrides to localStorage as { stableKey → L3 code }.
 * Called automatically whenever a manual classification is made.
 */
function saveOverrides() {
  try {
    const data = {};
    for (const [compositeKey, l3Code] of manualOverrides) {
      const sk = toStableKey(compositeKey);
      if (sk) data[sk] = l3Code;
    }
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(data));
    showSaveIndicator('saved');
  } catch (e) {
    console.warn('[uniformat] Failed to save overrides:', e);
  }
}

/**
 * Load saved overrides from localStorage and apply them to the current
 * session's manualOverrides map. Should be called after models are loaded
 * and elementDataMap is populated.
 */
function loadOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw);
    let loaded = 0;
    for (const [stableKey, l3Code] of Object.entries(data)) {
      const ck = fromStableKey(stableKey);
      if (ck && L3_LABELS[l3Code]) {
        manualOverrides.set(ck, l3Code);
        loaded++;
      }
    }
    return loaded;
  } catch (e) {
    console.warn('[uniformat] Failed to load overrides:', e);
    return 0;
  }
}

/**
 * Export overrides to a JSON file for sharing or backup.
 */
function exportOverridesToFile() {
  const data = {};
  for (const [compositeKey, l3Code] of manualOverrides) {
    const sk = toStableKey(compositeKey);
    if (sk) data[sk] = l3Code;
  }
  const count = Object.keys(data).length;
  if (count === 0) {
    showSaveIndicator('empty');
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'uniformat_overrides.json';
  a.click();
  URL.revokeObjectURL(url);
  showSaveIndicator('exported');
}

/**
 * Import overrides from a JSON file, merge into current overrides,
 * then re-classify and rebuild the tree.
 */
function importOverridesFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let imported = 0;
        for (const [stableKey, l3Code] of Object.entries(data)) {
          const ck = fromStableKey(stableKey);
          if (ck && L3_LABELS[l3Code]) {
            manualOverrides.set(ck, l3Code);
            imported++;
          }
        }
        // Re-classify with the imported overrides and rebuild tree
        classifyAllElements();
        buildUniformatTree();
        saveOverrides(); // persist the merged set
        showSaveIndicator(`imported ${imported}`);
      } catch (err) {
        console.warn('[uniformat] Import failed:', err);
        showSaveIndicator('error');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

/**
 * Brief status flash in the toolbar to confirm save/load actions.
 */
function showSaveIndicator(status) {
  let el = document.getElementById('ufSaveStatus');
  if (!el) return;

  const messages = {
    saved: '✓ Saved',
    exported: '✓ Exported',
    empty: 'No overrides to export',
    error: '✗ Error',
  };
  el.textContent = messages[status] || `✓ ${status}`;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ======================== HELPERS ========================

function fmtType(t) {
  return t.replace('IFC', '')
    .replace('STANDARDCASE', '')
    .replace('ELEMENTPROXY', 'Proxy')
    .replace('ELEMENTASSEMBLY', 'Assembly');
}

function getL1Color(code) {
  const colors = {
    A: '#f59e0b', // amber — substructure
    B: '#6366f1', // indigo — shell
    C: '#34d399', // emerald — interiors
    D: '#f472b6', // pink — services
    E: '#60a5fa', // blue — equipment
    F: '#a78bfa', // violet — special
  };
  return colors[code] || '#888';
}

function countL1(l1Data) {
  let n = 0;
  for (const l2 of Object.values(l1Data)) {
    for (const l3 of Object.values(l2)) n += l3.length;
  }
  return n;
}

function countL2(l2Data) {
  let n = 0;
  for (const l3 of Object.values(l2Data)) n += l3.length;
  return n;
}

function getL3Parent(l3Code) {
  return { l2: l3Code.substring(0, 3), l1: l3Code.substring(0, 1) };
}

// ======================== INITIALIZATION ========================

/**
 * Initialize the UniFormat panel. Called from viewer.js after models load.
 */
function initUniformatPanel() {
  // Load any previously saved manual overrides before classifying
  const loaded = loadOverrides();
  if (loaded > 0) {
    console.log(`[uniformat] Restored ${loaded} manual override(s) from saved data`);
  }
  classifyAllElements();
  buildUniformatTree();
}

/**
 * Wire search input events.
 */
function wireUniformatSearch() {
  const input = document.getElementById('ufSearch');
  if (input) {
    input.addEventListener('input', (e) => {
      ufSearchTerm = e.target.value;
      buildUniformatTree();
    });
  }

  const exportBtn = document.getElementById('ufExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportClassifications);
  }

  const reclassifyBtn = document.getElementById('ufReclassifyBtn');
  if (reclassifyBtn) {
    reclassifyBtn.addEventListener('click', () => {
      classifyAllElements();
      buildUniformatTree();
    });
  }

  const resetViewBtn = document.getElementById('ufResetViewBtn');
  if (resetViewBtn) {
    resetViewBtn.addEventListener('click', () => {
      clearGroupSelection();
    });
  }

  // Save/Load overrides
  const saveBtn = document.getElementById('ufSaveOverridesBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', exportOverridesToFile);
  }

  const loadBtn = document.getElementById('ufLoadOverridesBtn');
  if (loadBtn) {
    loadBtn.addEventListener('click', importOverridesFromFile);
  }
}

// Expose on window so the 3D context menu (in viewer.js) can access these
window.__ufHierarchy = UNIFORMAT_HIERARCHY;
window.__ufSetClassification = setManualClassification;
window.__ufRefreshTree = buildUniformatTree;

// Expose functions for the viewer to call
export {
  initUniformatPanel,
  wireUniformatSearch,
  classifyAllElements,
  buildUniformatTree,
  setManualClassification,
  bulkAssignByType,
  getClassificationStats,
  exportClassifications,
  selectByUniformat,
  clearGroupSelection,
  isolateByUniformat,
  UNIFORMAT_HIERARCHY,
  L3_LABELS,
  classifications,
};
