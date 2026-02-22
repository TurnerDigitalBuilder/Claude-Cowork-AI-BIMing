# Production Tracking Feature — Conversation Log

## User
I want to add a production tracking tool to my model viewer to track day to date installation of model elements. To be able to track and visualize progress over time.

## Claude
Let me explore your workspace to understand your current model viewer before we plan this out.

*[Explored the codebase at /mnt/lastest-viewer thoroughly]*

### Comprehensive BIM Model Viewer Analysis

**Model Viewer Type:** Full-featured 3D BIM/IFC Viewer built for browser-based visualization and analysis of building information models.

**Technology Stack:**
- Three.js (v0.160.0) — 3D graphics rendering via WebGL
- web-ifc (v0.0.66) — IFC file parsing and geometry extraction using WASM
- OrbitControls — Camera control for 3D model navigation
- Pure ES6 Modules — No build step, runs directly in browser
- Vanilla JavaScript — No frameworks

**File Structure:**
```
/lastest-viewer/
├── index.html           — DOM layout + module loader
├── viewer.js            — Core 3D viewer engine (1,959 lines)
├── uniformat.js         — UniFormat classification system
├── quantification.js    — Quantity takeoff & aggregation
├── estimate.js          — Cost estimation tool
├── section-cut.js       — Section cutting & clipping planes
├── styles.css           — UI styling
└── uniformat_overrides.json — Pre-loaded classifications
```

**Key Data Structures:**
- `elementMeshMap` — compositeKey → THREE.Mesh
- `elementDataMap` — compositeKey → { ifcType, name, storey, props, modelIdx }

**What's Already Tracked:**
- Element selection (multi-select aware)
- Element visibility (hidden keys tracked)
- UniFormat classification (with source & confidence)
- Quantities (aggregated)
- Costs (editable, saveable)

**What Could Be Enhanced:**
- No built-in workflow status tracking
- No time-based progress visualization

---

## Claude
Before I start building, let me clarify a few things to make sure I design this right for your workflow.

**Questions asked:**

1. How should installation status be tracked per element?
2. How should progress be visualized in the 3D view?
3. What time-based visualization do you want?
4. How should installation data be entered and persisted?

## User Answers
1. **Binary (Installed / Not Installed)** — Simple toggle. Track the date it was marked installed.
2. **Color-coded by status** — Elements change color based on their installation status (gray=not started, green=installed).
3. **Full dashboard** — Both a timeline scrubber AND charts showing installation counts over time.
4. **Manual in-viewer** — Select elements in 3D, right-click or use a panel to mark status + date. Persist to localStorage + JSON export/import.

---

## Claude
Great choices. Binary status with color-coded 3D view, a full dashboard with charts and timeline, and manual in-viewer entry. Let me build this out.

### Implementation Plan (Todo List)
1. Read key source files for integration points
2. Create production.js module with tracking data model, status management, and persistence
3. Add production tracking UI panel (sidebar tab + dashboard overlay)
4. Implement 3D color overlay system for installed/not-installed visualization
5. Add timeline scrubber for day-to-date playback
6. Build progress dashboard with S-curve and breakdown charts
7. Integrate with right-click context menu and selection workflow
8. Wire into index.html, add styles, keyboard shortcuts
9. Test and verify the full feature end-to-end

*[Read viewer.js, index.html, styles.css]*

### Created: production.js

New file — the complete production tracking module (~880 lines). Key sections:

**State:**
```javascript
// compositeKey → { installed: true, date: 'YYYY-MM-DD' }
let installationMap = new Map();
let productionMode = false;    // whether production color overlay is active
let timelineDate = null;       // null = show all, or 'YYYY-MM-DD' = show as-of
```

**Colors:**
```javascript
const PROD_COLORS = {
  installed:    0x34d399,   // green
  notInstalled: 0x4b5563,   // gray
};
```

**Persistence:** localStorage auto-save + JSON export/import + CSV export

**Status Management:**
- `markInstalled(keys, date)` — Mark selected elements as installed on a given date
- `markNotInstalled(keys)` — Unmark elements
- `markBulk(filterFn, date)` — Mark all elements matching a filter
- `clearAll()` — Clear all installation data

**3D Color Overlay:**
- `applyProductionOverlay()` — Color all meshes green (installed) or gray (not installed), respecting timeline date
- `removeProductionOverlay()` — Restore original colors
- `toggleProductionOverlay()` — Toggle on/off

**Statistics:**
- `getStats()` — Returns total, installed, notInstalled, pct, byDate, byStorey, byType
- `getSCurveData()` — Cumulative S-curve data sorted by date
- `getDateRange()` — Min/max installation dates

**Sidebar Panel:** Stats bar, progress bar, quick actions (Mark Installed / Unmark / Dashboard), date input, breakdown by level, breakdown by type, I/O buttons (Save/Load JSON, Export CSV, Clear)

**Dashboard Overlay:**
- Summary cards (total, installed, remaining, % complete)
- Timeline scrubber with date slider that updates 3D view in real-time
- S-Curve chart (Canvas API) — cumulative progress
- Daily installation rate bar chart
- Horizontal bar charts — progress by level and by element type

**Context Menu:** Returns "Mark Installed" or "Unmark" items for the right-click 3D context menu

### Modified: index.html

**Added Production tab:**
```html
<div class="tab" data-tab="production">Production</div>
```

**Added Production panel:**
```html
<div class="panel" id="panel-production">
  <div class="prod-toolbar">
    <button id="prodToggleOverlayBtn">Color Overlay</button>
    <span id="prodSaveStatus"></span>
  </div>
  <div id="productionContent">...</div>
</div>
```

**Added Production toolbar button:**
```html
<button class="viewer-btn" id="btnProduction" title="Toggle production tracking overlay (T)">
  Production
</button>
```

**Added Dashboard overlay:**
```html
<div class="prod-dashboard-overlay" id="productionDashboard">
  <div class="prod-dash-header">...</div>
  <div class="prod-dash-body" id="prodDashBody">...</div>
</div>
```

**Added module wiring:**
```html
<script type="module">
  import { initProductionPanel, wireProductionEvents, toggleProductionOverlay, getContextMenuItems } from './production.js';
  wireProductionEvents();
  window.__prodGetContextMenuItems = getContextMenuItems;
  document.getElementById('btnProduction').addEventListener('click', toggleProductionOverlay);
  window.addEventListener('uniformat-refresh', () => {
    setTimeout(() => initProductionPanel(), 100);
  });
</script>
```

### Modified: viewer.js

**Added to 3D context menu** — Production Tracking section with Mark Installed / Unmark items:
```javascript
// Production tracking
html += `<div class="ctx3d-section-label">Production Tracking</div>`;
const prodItems = window.__prodGetContextMenuItems ? window.__prodGetContextMenuItems(compositeKey) : [];
for (let pi = 0; pi < prodItems.length; pi++) {
  html += `<div class="ctx3d-item" data-action="prod-${pi}">`;
  html += `<span class="ctx3d-icon">${prodItems[pi].icon}</span> ${prodItems[pi].label}</div>`;
}
```

**Wired click handlers** for production context menu items.

### Modified: styles.css

Added ~400 lines of production tracking styles including:
- `.prod-toolbar`, `.prod-stats`, `.prod-stat`, `.prod-progress-bar`
- `.prod-actions`, `.prod-date-row`, `.prod-date-input`
- `.prod-section-header`, `.prod-breakdown`, `.prod-mini-bar`
- `.prod-io-bar`
- `.prod-dashboard-overlay`, `.prod-dash-header`, `.prod-dash-body`
- `.prod-dash-summary`, `.prod-dash-card` (with green/gray/accent variants)
- `.prod-dash-section`, `.prod-chart-canvas`
- `.prod-timeline-controls`, `.prod-timeline-slider`, `.prod-timeline-label`

### Verification

Ran a thorough verification across all four files:
- All IDs match between HTML elements and JavaScript references
- All CSS classes are defined and properly styled
- Module exports are correct and imported properly
- Context menu integration is wired correctly
- Event handlers are attached to all buttons and UI elements
- All HTML tags are properly closed
- Data flow between modules is correctly established
- No broken references or mismatches detected

---

## Claude — Summary

The production tracking feature is fully built and integrated. Here's what was added:

**New file:** `production.js` — the complete production tracking module

**How it works:**

1. **Sidebar tab** — "Production" tab shows real-time stats (total, installed, remaining, % complete), a progress bar, and breakdowns by level and element type. Select elements in 3D, pick a date, and click "Mark Installed."

2. **3D color overlay** — Press **T** or click the "Production" toolbar button to toggle. Installed elements turn green, remaining elements go gray/transparent. Works alongside the timeline scrubber.

3. **Right-click context menu** — Right-click any element to see "Mark Installed" or "Unmark" directly in the 3D context menu, alongside the existing Select By and UniFormat options.

4. **Dashboard** — Click "Dashboard" in the Production panel to open a full analytics overlay with:
   - Summary cards (total, installed, remaining, % complete)
   - **Timeline scrubber** — drag the slider to see installation state as-of any date; the 3D model updates in real-time
   - **S-curve** — cumulative progress chart
   - **Daily rate** — bar chart of daily installs
   - **Horizontal bar charts** — progress by level and by element type

5. **Persistence** — Data saves to localStorage automatically. Export/import as JSON for sharing across sessions, or export to CSV for field reporting.

**Keyboard shortcuts:** `T` toggles overlay, `D` opens dashboard (when Production tab is active).

---

## User
How did you do?

## Claude
Let me open the viewer in the browser to check it visually.

*[Opened browser tab]*

---

## User
All good. The tools don't all fit in the panel. I can't see the model tool.

## Claude
Good catch — with 6 tabs the sidebar is too tight. Let me fix that by making the tabs more compact so they all fit.

**Fix applied to styles.css:**
```css
.tab {
  flex: 1;
  padding: 8px 4px;
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 0;
}
```

Shrunk the tabs — smaller font (11px), tighter padding, and `min-width: 0` to let flexbox compress them evenly. The "Models" tab should now be visible.
