# AI BIMing

An open-source experiment in building a full-featured IFC/BIM viewer entirely through AI-assisted development. Each iteration was built in a single conversation with [Claude Cowork](https://claude.ai), progressively adding real construction technology capabilities — from 3D model loading to quantity takeoffs, cost estimation, and production tracking.

**[Live Site →](https://turnerdigitalbuilder.github.io/Claude-Cowork-AI-BIMing/)**

---

## Quick Start

| | |
|---|---|
| **[Launch Demo](https://turnerdigitalbuilder.github.io/Claude-Cowork-AI-BIMing/demo/index.html)** | Pre-loads the structural model so you can explore every feature immediately — no upload required. |
| **[Launch Latest Viewer](https://turnerdigitalbuilder.github.io/Claude-Cowork-AI-BIMing/lastest-viewer/index.html)** | Upload your own IFC models to view, analyze, and track — starts with a blank canvas. |

Sample IFC models from the Snowdon Towers project are available in the [`models/`](models/) folder if you want to try the latest viewer with real data.

---

## What It Does

The latest viewer (Version 08) is a browser-based BIM viewer with six integrated construction technology modules:

**3D Visualization** — Load one or more IFC files via drag-and-drop. Orbit, pan, zoom, select elements, toggle wireframe or x-ray modes, and rotate between axis presets. Elements are color-coded by building system (structural, mechanical, electrical, etc.).

**Spatial Navigation** — Browse the model through a building-structure tree organized by storey and element type. Search across names, types, and properties. Click any node to isolate and fit-to-view.

**UniFormat Classification** — Every element is automatically classified to UniFormat II (A10 Foundations, B10 Superstructure, D20 Plumbing, etc.). The engine maps IFC types to UniFormat codes, tracks classification confidence (IFC Data / Auto-mapped / Manual), and supports right-click reclassification. Export to CSV or save overrides to JSON.

**Section Cutting** — Single-plane clipping on any axis, or a full section box with six adjustable planes. Visual helpers show the cut plane and bounding box in the 3D scene.

**Quantity Takeoffs** — Extracts area, volume, length, and count from IFC property sets. View quantities aggregated by storey (spatial) or by UniFormat category. Export to CSV.

**Cost Estimation** — Assign unit costs to each UniFormat line item. The viewer computes extended totals (quantity × unit cost) and rolls up a project cost summary. Save/load estimates as JSON, export to CSV for spreadsheet integration.

**Production Tracking** — Mark elements as installed with a date stamp. The 3D view color-codes installation status (gray = not started, green = installed). A timeline scrubber plays back progress day-by-day, and an S-curve dashboard charts cumulative installation over time. Import/export tracking data as JSON for field-to-office workflows.

---

## Build Progress

Each version was built in a single AI-assisted conversation, with no traditional IDE. The conversation logs are preserved as `conversation.md` files in each viewer folder.

| Version | Name | What Was Added |
|---------|------|----------------|
| 01 | Single Model Viewer | IFC loading, 3D rendering, element selection, spatial tree, property inspector |
| 02 | Multi-Model Support | Load multiple IFC files into one scene, per-model visibility toggles, non-blocking loading |
| 03 | Sun Study | Solar analysis with lat/long, date, and time-of-day controls; realistic shadow casting |
| 04 | Section Cutting | Single-plane and section-box clipping with visual helpers and axis sliders |
| 05 | UniFormat Classification | Auto-classification engine, manual overrides, confidence tracking, CSV export |
| 06 | Quantity Takeoffs | Property extraction for area/volume/length/count, spatial and UniFormat aggregation |
| 07 | Cost Estimation | Editable unit costs, extended totals, project cost summary, JSON/CSV persistence |
| 08 | Production Tracking | Installation status, date tracking, timeline playback, S-curve dashboard |

Archived versions are browsable from the [landing page](https://turnerdigitalbuilder.github.io/Claude-Cowork-AI-BIMing/) under "Build Progress."

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| 3D Rendering | [Three.js](https://threejs.org/) v0.160.0 |
| IFC Parsing | [web-ifc](https://ifcjs.github.io/info/) v0.0.66 (WASM) |
| Language | Vanilla ES6 Modules — no frameworks, no build step |
| Hosting | GitHub Pages (static files only) |

The entire viewer runs client-side in the browser. There is no backend, no bundler, and no compilation step. All dependencies load from CDN via an ES module import map.

---

## Project Structure

```
├── index.html                          Landing page hub
├── README.md
│
├── demo/                               Pre-loaded demo viewer
│   ├── index.html
│   ├── viewer.js                       Core 3D engine (2,064 lines)
│   ├── uniformat.js                    UniFormat classification (1,434 lines)
│   ├── quantification.js              Quantity takeoffs (582 lines)
│   ├── estimate.js                     Cost estimation (670 lines)
│   ├── section-cut.js                  Section cutting (653 lines)
│   ├── production.js                   Production tracking (881 lines)
│   ├── styles.css
│   ├── models.json                     Pre-load config
│   ├── Snowdon Towers ST.ifc           Structural model (4.9 MB)
│   └── uniformat_overrides.json
│
├── lastest-viewer/                     Latest full viewer (Version 08)
│   ├── index.html
│   ├── viewer.js                       Core 3D engine (1,981 lines)
│   ├── uniformat.js
│   ├── quantification.js
│   ├── estimate.js
│   ├── section-cut.js
│   ├── production.js
│   ├── styles.css
│   └── uniformat_overrides.json
│
├── archived-progress-viewers/          Versions 01–07
│   ├── 01-BIM-Viewer-Single/
│   ├── 02-BIM-Viewer-Multiple Models/
│   ├── 03-BIM-Viewer-Sun-Study/
│   ├── 04-BIM-Viewer-Section-Cut/
│   ├── 05-BIM-Viewer-Model-Organizer/
│   ├── 06-BIM-Viewer-Quantities/
│   └── 07-BIM-Viewer-Estimate/
│
└── models/                             Sample IFC files (~143 MB total)
    ├── Snowdon Towers ST.ifc           Structural
    ├── Snowdon Towers AR Simple.ifc    Architectural
    ├── Snowdon Towers ME.ifc           Mechanical
    ├── Snowdon Towers EL Lighting.ifc  Electrical – Lighting
    ├── Snowdon Towers EL Power.ifc     Electrical – Power
    ├── Snowdon Towers PL.ifc           Plumbing
    ├── Snowdon Towers FA.ifc           Facade
    ├── Snowdon Towers SI.ifc           Site
    └── Snowdon Towers AR Back Wall.ifc Architectural detail
```

---

## Architecture Notes

**No build step.** Every file runs directly in the browser via ES6 module imports. This was a deliberate choice — it keeps the project approachable and eliminates toolchain friction for anyone who wants to explore or fork it.

**Composite key system.** Multi-model support uses `"modelIdx:expressID"` as a composite key so elements from different IFC files coexist in the same scene without namespace collisions.

**Modular tool pattern.** Each capability (section-cut, uniformat, quantification, estimate, production) is a self-contained module that registers its own event listeners and UI. Tools communicate through custom DOM events like `uniformat-refresh` and `quantification-refresh` rather than tight coupling.

**JSON persistence.** Classifications, cost estimates, and production tracking data can all be saved to JSON and reloaded later. This enables field-to-office data flow — mark installation status on a tablet, export JSON, import it back at the office for reporting.

---

## Sample Models

The `models/` folder contains IFC files from the **Snowdon Towers** project, a multi-discipline building model covering structural, architectural, mechanical, electrical, plumbing, facade, and site work. These are real-world construction models suitable for testing all viewer features.

To use them with the latest viewer: download the files, then drag and drop them onto the viewer. You can load multiple disciplines simultaneously to see the full coordinated model.

---

## Running Locally

No install required. Clone the repo and serve the files with any static server:

```bash
git clone https://github.com/TurnerDigitalBuilder/Claude-Cowork-AI-BIMing.git
cd Claude-Cowork-AI-BIMing

# Any of these work:
python3 -m http.server 8000
npx serve .
# Then open http://localhost:8000
```

Or just open `index.html` directly in a browser — the CDN-loaded dependencies handle everything.

---

## About

This project was built by [Turner Digital Builder](https://github.com/TurnerDigitalBuilder) as an experiment in AI-assisted construction technology development. Every line of code was written through conversational direction with Claude, Anthropic's AI assistant, using the Cowork desktop environment. No traditional IDE was used.

The goal was to explore how far AI-assisted development can go in a specialized domain like construction — where you need deep knowledge of IFC data structures, BIM workflows, 3D graphics, and construction operations to build useful tools.
