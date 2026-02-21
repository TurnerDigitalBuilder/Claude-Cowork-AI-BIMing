# BIM Model Viewer — Build Conversation

---

## Ben

Help me build a BIM model viewer that can load ifc models. I want to start off with a capable but not complex model viewer before adding additional capabilities. Think standard model viewer with standard capabilities. Feel free to think this out with me before you build it. I am also looking for an html, js, css stack that I can run locally. You can also reference the viewer in the reference folder for how I did it in the past for loading an ifc model, rendering settings, and some others. Dont do anything with the quantities from that viewer yet. That will be later. Go!

---

## Claude

Let me start by looking at your reference viewer to understand your past approach, then we'll plan this out together.

*[Explored reference folder and analyzed ifc-takeoff.html]*

Your reference viewer is a solid single-file IFC viewer using **Three.js 0.160 + web-ifc 0.0.66**, all vanilla JS with no build step. Now let me think through the approach for your new viewer before we build.

---

**Here's my thinking on a "standard capable viewer" — the foundation before we layer on quantities, takeoff, etc.:**

**What I'd carry forward from your reference:**
- Same library stack (Three.js 0.160 + web-ifc 0.0.66, CDN-loaded, no build)
- Your rendering config is solid — the 3-light rig, camera constraints, orbit controls setup
- Streaming mesh loading pipeline (`StreamAllMeshes`)
- Type-based color coding for element categories
- The rotation presets (critical for IFC Z-up vs Y-up handling)
- Unit detection from IFC project metadata

**What I'd include as "standard viewer capabilities":**
- Drag-and-drop IFC file loading with progress feedback
- Spatial tree / element browser (storey → type → elements)
- Element selection with highlight + info panel (properties, not quantities yet)
- View controls: reset, wireframe, x-ray/transparency mode
- Rotation presets for axis orientation
- Fit-to-model camera positioning
- Search/filter by element type or level

**What I'd intentionally leave out for now:**
- All quantity computation, takeoff panels, CSV export (your "later" scope)
- Weight/formwork calculations
- Imperial/metric toggle (we'll add it when quantities come in)

**Architecture question:** Your reference is a single monolithic HTML file at ~57KB. For this new viewer that's meant to grow, would you prefer I keep it as a single file for simplicity, or split it into `index.html` + `viewer.js` + `styles.css` so it's easier to extend as you add capabilities? Either way, no build tools — just files you open in a browser.

What's your call on the file structure, and does the feature scope above match what you're envisioning?

---

## Ben

I am ok going with your thinking on the single file vs the three. We will eventually add more capabilities, like quantification, 4d, and other complexities.

---

## Claude

Good call — the split structure will pay off as you layer in 4D, quantification, etc. Let me read your reference viewer for the exact implementation details, then I'll build it out.

*[Read the full ifc-takeoff.html reference file — 1,252 lines]*

Now I have every detail. Let me build the three-file viewer — carrying forward your proven rendering config and IFC pipeline, stripped to a clean foundation ready for future capabilities.

*[Created styles.css — 430 lines]*
*[Created viewer.js — 1,004 lines]*
*[Created index.html — 126 lines]*

All three files are built and syntax-checked. Here's what you've got:

**File structure:**
```
viewer/
├── index.html   (126 lines — layout, CDN imports, no inline JS)
├── viewer.js    (1,004 lines — the full engine)
└── styles.css   (430 lines — dark theme, all UI)
```

**To run it:** Open `index.html` in any modern browser — just needs a local server since it uses ES modules. Quickest way: `npx serve viewer/` or `python3 -m http.server 8080` from the viewer folder, then hit `localhost`. Drag your Snowdon Towers IFC onto it to test.

**What's in the box:**

- Drag-and-drop or browse for IFC files
- Full streaming geometry pipeline (same as your reference — `StreamAllMeshes`, merged placed geometries, proper normal transforms)
- Same proven rendering config — 3-light rig, Phong materials at 0.88 opacity, BIM turntable orbit controls
- 6 rotation presets for Z-up/Y-up handling
- Spatial tree panel (storey → type → elements, collapsible)
- Flat elements list with search (capped at 200 with filter)
- Properties panel grouped by property set name
- Click-to-select with highlight + dim-others
- Filter dropdowns that isolate elements in 3D
- Wireframe, X-Ray, Reset View, Axis Rotation toolbar
- Keyboard shortcuts: `Esc` (reset), `F` (fit), `W` (wireframe), `X` (x-ray), `R` (rotate)
- Unit detection from IFC project metadata (stored for when you add quantities later)

**What's deliberately excluded** (your future scope):
- Quantity computation, takeoff tables, CSV export
- Imperial/metric toggle
- Weight/formwork calculations

The `elementDataMap` already stores raw properties and the `unitFactor` is detected, so when you're ready to layer in quantification you'll have the foundation waiting.

---

## Ben

do you have the ability to preview this Claude or you can only preview single file apps?

---

## Claude

I can preview single-file HTML apps natively in the conversation, but for a multi-file setup like this (HTML + JS + CSS as separate files), I'd need to serve it from a local HTTP server since ES modules require proper CORS headers.

Let me spin one up and open it in the browser so we can both see it.

*[Started local HTTP server on port 8080]*
*[Connected to Chrome extension]*
*[Attempted to navigate to localhost:8080]*

The browser can't reach localhost from your machine to my VM — that's the issue. The server is running inside my sandbox, but your Chrome is on your actual computer. They're different networks.

Two paths forward:

1. **I bundle it into a single HTML file** you can open directly from your folder (no server needed) — just for preview. We keep the 3-file split as the real codebase.
2. **You run the server yourself** — open a terminal in the `viewer/` folder and run `python3 -m http.server 8080`, then hit `localhost:8080`.

Want me to generate a single-file preview version so we can eyeball the layout together right now? It'd just be a convenience build — your real source stays as the clean three files.

---

## Ben

try chrome again

---

## Claude

*[Reconnected to Chrome, created new tab, navigated to localhost:8080]*

The page errored — confirmed that `localhost:8080` on my VM isn't reachable from your browser. Two options:

**Option 1 — Quick local server** (from your terminal, in the `viewer/` folder):
```bash
npx serve .
# or
python3 -m http.server 8080
```
Then open `http://localhost:8080` and drag your Snowdon Towers IFC onto it.

**Option 2 — I can bundle it into a single HTML file** so it previews as an artifact right here in the conversation. The trade-off is you'd lose the clean three-file split temporarily, but it would let us visually verify the UI layout, sidebar, toolbar, and loading flow before you test with a real model.

Want me to generate a single-file preview version so we can eyeball it together?
