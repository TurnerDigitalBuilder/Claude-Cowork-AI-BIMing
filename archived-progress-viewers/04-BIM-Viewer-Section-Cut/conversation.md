# Conversation: 3D Section Cutting Tool for BIM Viewer

---

## Ben

In my Viewer I would like to add a 3D section cutting tool. Ideally a single plane and a section box (6 slices) that I can adjust. Reference in the progress folder for how the sun study tool is laid out.

---

## Claude

Let me explore your codebase to understand the Viewer architecture and the sun study tool reference before planning this out.

I launched an exploration agent to thoroughly examine the workspace at `/mnt/AIM` — looking for the main viewer application structure, the progress folder with the sun study reference, how existing tools/panels are structured, and any existing section cutting or clipping functionality.

The exploration returned a comprehensive analysis:

### Directory Structure

```
/mnt/AIM/
├── models/                          # IFC model files (9 Snowdon Towers variants)
├── progress/                        # Development progression with reference implementations
│   ├── 01-BIM-Viewer-Single/
│   ├── 02-BIM-Viewer-Multiple Models/
│   ├── 03-BIM-Viewer-Sun-Study/     # Sun study tool (REFERENCE)
│   │   ├── index.html
│   │   ├── viewer.js
│   │   ├── sun-study.js
│   │   └── styles.css
│   └── README.md
├── references/
│   └── ifc-takeoff.html
└── viewer/                          # Main application (current state)
    ├── index.html
    ├── viewer.js
    └── styles.css
```

I have a thorough understanding of your viewer architecture. The production viewer doesn't export `getViewerState()` yet, but the sun study reference does. I'll create the section cut tool as step 04 in the progress folder, following the exact same module pattern.

I then read the full contents of all key files:

- `progress/03-BIM-Viewer-Sun-Study/sun-study.js` (669 lines)
- `progress/03-BIM-Viewer-Sun-Study/index.html`
- `progress/03-BIM-Viewer-Sun-Study/styles.css`
- `viewer/viewer.js` (1353 lines)
- `viewer/index.html`
- `viewer/styles.css`

With a complete picture of the architecture, I created the following files:

### Created: `progress/04-BIM-Viewer-Section-Cut/`

**4 files, same pattern as the Sun Study tool:**

**`section-cut.js`** (653 lines) — the core module with two modes:

- **Single Plane** — pick axis (X/Y/Z), drag a slider to position the cut, flip direction. Uses one `THREE.Plane` applied to every mesh material via `material.clippingPlanes`.
- **Section Box** — 6 clip planes forming an adjustable box. Min/Max sliders for each axis with automatic clamping (min can't exceed max). Reset button snaps back to full bounds.
- Visual helpers: semi-transparent plane helper for single-plane mode, wireframe box + translucent faces for section box mode, both toggleable.
- Keyboard shortcut: `C` to toggle.

**`viewer.js`** — production viewer + `getViewerState()` export (same pattern as sun-study reference).

**`index.html`** — adds the Section button (`✂ Section`) to the toolbar, wires the ES module import.

**`styles.css`** — production styles + section cut panel CSS (`.sc-*` prefix) matching the sun study's layout: fixed bottom-left at `left: 396px`, 340px wide, same header/section/readout structure with your dark theme variables.

The panel layout:

```
┌─────────────────────────────────┐
│ ✂ Section Cut           [×]     │
├─────────────────────────────────┤
│ Mode: [Single Plane] [Section Box] │
├─────────────────────────────────┤
│ Plane Axis: [X] [Y] [Z]        │
│ Position: ════●════  50%        │
│ □ Flip Direction                │
├── or (Section Box mode) ────────┤
│ X: Min ══●══  Max ══●══        │
│ Y: Min ══●══  Max ══●══        │
│ Z: Min ══●══  Max ══●══        │
│        [Reset Box]              │
├─────────────────────────────────┤
│ ☑ Show Plane Helper             │
├─────────────────────────────────┤
│ Mode: Plane │ Planes: 1 │ Axis: Y │
└─────────────────────────────────┘
```

---

## Key Implementation Details

### section-cut.js Module Structure

```javascript
import * as THREE from 'three';
import { getViewerState } from './viewer.js';

const state = {
  active: false,
  mode: 'plane',         // 'plane' | 'box'
  planeAxis: 'y',        // 'x' | 'y' | 'z'
  planeFlipped: false,
  planePosition: 0.5,    // 0-1 normalized within model bounds
  box: {
    xMin: 0.0, xMax: 1.0,
    yMin: 0.0, yMax: 1.0,
    zMin: 0.0, zMax: 1.0,
  },
  showPlaneHelper: true,
  showCaps: false,
};
```

**Core functions:**
- `activate()` / `deactivate()` / `toggle()` — lifecycle management
- `updateClipping()` — recalculates clip planes from state and applies to all mesh materials
- `buildSinglePlane()` — creates one `THREE.Plane` from axis + position
- `buildSectionBox()` — creates 6 `THREE.Plane` objects forming a box
- `updateHelpers()` — renders visual plane/box helpers in the scene
- `refreshBounds()` — recalculates model bounds (call after model load/remove)
- `createPanel()` / `wirePanel()` / `showPanel()` / `hidePanel()` — UI management

**Clipping approach:** Uses `renderer.localClippingEnabled = true` and per-material `material.clippingPlanes` arrays, which is the Three.js standard approach for section cutting.

### viewer.js Addition

Added `getViewerState()` export at the bottom of viewer.js:

```javascript
function getViewerState() {
  return {
    scene, camera, renderer, controls,
    models, elementMeshMap, elementDataMap, storeys,
    selectedKey,
  };
}

export { getViewerState };
```

### index.html Toolbar Button

```html
<button class="viewer-btn" id="btnSectionCut" title="Section cut (C)">
  <span class="icon">✂</span> Section
</button>
```

Wired via ES module:

```html
<script type="module">
  import { toggle } from './section-cut.js';
  document.getElementById('btnSectionCut').addEventListener('click', toggle);
</script>
```

### styles.css Panel Styles

All section cut styles use the `.sc-*` prefix, matching the sun study's `.ss-*` pattern:
- `.section-cut-panel` — fixed bottom-left, 340px wide, glassmorphism background
- `.sc-header` — title with scissors icon, close button
- `.sc-mode-btn` — toggle between Single Plane and Section Box
- `.sc-axis-btn` — X/Y/Z axis selection
- `.sc-slider` / `.sc-slider-sm` — range inputs with custom thumbs
- `.sc-range-row` — section box min/max layout
- `.sc-readout` — bottom status bar (mode, plane count, axis)
