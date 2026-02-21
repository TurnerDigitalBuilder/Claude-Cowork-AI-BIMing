# Sun Study Tool — Conversation Log

---

## Ben

I would like to create a sun study analysis capability within the viewer as a tool

---

## Claude

Let me explore your workspace to understand the existing viewer and codebase before we plan this out.

**[Explored viewer codebase structure]**

### Comprehensive Project Analysis: AIM BIM Viewer

**Overview:** This is a browser-based BIM (Building Information Model) viewer built with Three.js and web-ifc. It's a progressive web application with no build step, using ES modules and CDN-hosted dependencies.

**Viewer Application:** 3D BIM Construction Model Viewer located at `/viewer/`

**Key Files:**
- `/viewer/index.html` - Main entry point
- `/viewer/viewer.js` - Core application logic (1,342 lines)
- `/viewer/styles.css` - Dark-themed UI styling

**Tech Stack:**
- Three.js v0.160.0 — 3D rendering engine
- web-ifc v0.0.66 — WASM-based IFC parser
- Vanilla CSS with CSS variables (dark theme)
- ES6 modules (no bundler needed)

**Existing Tools:**
- Wireframe mode (W key), X-Ray mode (X key), Axis rotation (R key), Reset view (Esc)
- Spatial tree browser, element search, storey/type filters
- Multi-model support, per-model visibility toggle
- Properties panel with Pset/quantities inspection

**Current Lighting:** 3-point + ambient (static), no shadows implemented

**Materials:** MeshPhongMaterial (basic shading)

Now I have a thorough understanding of your viewer. This is a well-architected Three.js/web-ifc BIM viewer with a no-build ES module approach. Currently it has static 3-point lighting with no shadows — a perfect foundation for a sun study tool.

---

## Ben

go, I stopped you

---

## Claude

Got it — let me plan this out and get your sign-off before building.

**[Entered plan mode, read viewer.js, index.html, and styles.css]**

### Sun Study Tool — Implementation Plan

#### Context
The BIM viewer (`/viewer/`) is a no-build Three.js + web-ifc IFC viewer. It currently uses a static 3-point lighting rig with no shadows. A sun study tool will let users simulate realistic solar lighting at any geographic location, date, and time of day — critical for construction planning, facade analysis, and site logistics.

#### Architecture
Create a self-contained ES module `sun-study.js` that plugs into the existing viewer. The module manages its own state, light, shadow ground plane, and UI panel. It hooks into the existing scene/renderer/camera exposed by `viewer.js`.

#### Files to Modify/Create

| File | Action |
|------|--------|
| `viewer/sun-study.js` | **CREATE** — Sun study module (solar calc, shadow setup, UI, animation) |
| `viewer/viewer.js` | **MODIFY** — Export scene/renderer/camera/models refs; add Sun Study toolbar button; enable shadow map on renderer; set castShadow on meshes during geometry load |
| `viewer/index.html` | **MODIFY** — Add `<script>` import for sun-study module; add Sun Study button to viewer-tools div |
| `viewer/styles.css` | **MODIFY** — Add styles for sun study control panel |

#### Implementation Details

**1. `sun-study.js` — New Module (~400 lines)**

**Solar Position Algorithm** (no external deps, pure math):
- Implement standard astronomical solar position from latitude, longitude, date, time
- Outputs: solar azimuth (compass bearing), solar altitude (elevation angle above horizon)
- Handles sunrise/sunset detection (altitude < 0 = nighttime)

**Sun Study State:**
```js
{ active: false, latitude: 40.7128, longitude: -74.0060,  // default NYC
  date: new Date(), hour: 12, minute: 0, playing: false, speed: 1 }
```

**Shadow Infrastructure:**
- On activate: enable `renderer.shadowMap` (PCFSoftShadowMap), create a DirectionalLight with shadow camera sized to model bounding box, add a shadow-receiving ground plane at model base elevation
- On deactivate: remove sun light, ground plane, restore original lighting, disable shadow map
- Shadow camera frustum auto-sized from scene bounding box (reuse `fitCameraAll` pattern)

**Sun Light Positioning:**
- Convert azimuth + altitude → (x, y, z) unit vector × distance
- Distance = model diagonal × 2 (keeps light far enough for parallel rays)
- Shadow camera target = model center
- Update light color: warm at low sun (sunrise/sunset tint), white at high sun

**Animation System:**
- `requestAnimationFrame` loop that advances time when playing
- Configurable speed: 1x (real-time), 60x (1 min/sec), 3600x (1 hr/sec)
- Updates sun position + light each frame

**UI Panel** (overlay on viewer, bottom-left):
- Location: text input for lat/lng (with "Use NYC" / "Use London" / "Use Dubai" presets)
- Date: `<input type="date">`
- Time: range slider (0–1440 minutes, displays HH:MM) + digital readout
- Play/Pause button + speed selector
- Sun altitude + azimuth readout
- Close/deactivate button
- Toggle shadow quality (low/med/high → shadow map size 1024/2048/4096)

**2. `viewer.js` — Modifications**

- Export `scene`, `renderer`, `camera`, `models`, `elementMeshMap`, `fitCameraAll` for the sun study module to access
- In `loadGeometry()`, set `meshObj.castShadow = true` on each created mesh
- In `initThreeJS()`, add `renderer.shadowMap.enabled = false` (starts disabled, sun study activates it) and `renderer.shadowMap.type = THREE.PCFSoftShadowMap`
- Add Sun Study button next to existing Wire/X-Ray buttons

**3. `index.html` — Additions**
- Add sun study button in `.viewer-tools` div
- Import sun-study.js as module

**4. `styles.css` — Sun Study Panel Styles**
- `.sun-study-panel` — fixed overlay, bottom-left, dark glass theme matching existing overlays
- Time slider styling, location presets, play controls
- Matches existing design system (CSS variables, border-radius, backdrop-filter)

#### Key Design Decisions
- **No external dependencies** — solar position calculated from first principles (keeps the no-build CDN approach)
- **Module pattern** — sun-study.js imports from viewer.js exports; clean separation of concerns
- **Lazy shadow activation** — shadow maps only enabled when sun study is active (no perf cost otherwise)
- **Auto-sizing shadow frustum** — shadow camera frustum derived from model bounding box so it works with any model scale
- **Ground plane** — semi-transparent dark plane at model base for shadow reception, auto-positioned

#### Verification
1. Load an IFC model (e.g., Snowdon Towers AR Simple)
2. Click "Sun Study" button in toolbar — panel appears, sun light replaces static lighting, shadows appear on ground plane
3. Scrub time slider — shadows move in real-time as sun position updates
4. Change date — shadow angles shift (shorter in summer, longer in winter)
5. Click Play — animation auto-advances time, shadows sweep across the model
6. Click Sun Study button again — deactivates, restores original 3-point lighting, shadows disappear
7. Verify no performance degradation when sun study is inactive

**[Plan approved by user]**

---

## Claude — Implementation

### Created: `sun-study.js`

Self-contained ES module (~670 lines) with:

**Solar Position Algorithm (NOAA/Meeus):**
- `julianDay()` — Julian Day Number from date
- `getSolarPosition(lat, lng, date, hours)` — returns altitude and azimuth in degrees
- `solarToDirection(azimuth, altitude)` — converts to Three.js Vector3
- `getSunColor(altitude)` — warm orange at horizon, white at zenith, blue at night
- `getSunIntensity(altitude)` / `getAmbientIntensity(altitude)` — realistic falloff

**State Management:**
```js
const state = {
  active: false,
  latitude: 40.7128, longitude: -74.0060, // NYC default
  date: new Date(),
  totalMinutes: 720, // noon
  playing: false,
  speed: 60, // minutes per second
  shadowQuality: 2048,
};
```

**Location Presets:** New York, London, Dubai, Tokyo, Sydney, Los Angeles

**Activate/Deactivate cycle:**
- `activate()`: stores and removes original 3-point lights, enables shadow map, creates DirectionalLight with shadow camera auto-sized to model bounds, creates ShadowMaterial ground plane at model base, creates sun indicator sphere, enables castShadow/receiveShadow on all meshes
- `deactivate()`: removes all sun study objects, restores original lights, disables shadow map, cleans up

**Animation:** `requestAnimationFrame` loop advancing time at configurable speed (10 min/s to 6 hr/s)

**UI Panel:** Full HTML panel created dynamically with lat/lng inputs, location preset buttons, date picker, time range slider (0–1439 minutes with 12AM/6AM/12PM/6PM/12AM labels), play/pause button, speed selector, shadow quality selector, live readout (altitude, azimuth, status)

**Keyboard shortcuts:** `S` toggles sun study, `Space` toggles play/pause while active

### Modified: `viewer.js`

Added to `initThreeJS()`:
```js
renderer.shadowMap.enabled = false; // Sun study activates this on demand
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

Added to `loadGeometry()` mesh creation:
```js
meshObj.castShadow = true;   // Shadow-ready for sun study
meshObj.receiveShadow = true;
```

Added export function at bottom:
```js
export function getViewerState() {
  return { scene, renderer, camera, controls, models, elementMeshMap, elementDataMap, storeys };
}
```

### Modified: `index.html`

Added Sun Study button to viewer toolbar:
```html
<button class="viewer-btn" id="btnSunStudy" title="Sun study (S)">
  <span class="icon">☀</span> Sun
</button>
```

Added module import and wiring:
```html
<script type="module">
  import { toggle } from './sun-study.js';
  document.getElementById('btnSunStudy').addEventListener('click', toggle);
</script>
```

### Modified: `styles.css`

Added complete sun study panel styles (~250 lines):
- `.sun-study-panel` — fixed position overlay with dark glass theme (backdrop-filter, matching existing design system)
- `.ss-header` with title and close button
- `.ss-section` layout with label styling
- `.ss-location-row` and `.ss-preset-btn` for location controls
- `.ss-slider` with custom thumb styling for the time scrubber
- `.ss-controls-row` with `.ss-play-btn` (circular play/pause)
- `.ss-speed-select` and `.ss-quality-select` dropdowns
- `.ss-readout` bar with altitude, azimuth, and status (color-coded: `.ss-night`, `.ss-golden`, `.ss-day`)

### Verification

All files verified for consistency:
- All module imports/exports properly wired
- All DOM element IDs referenced in JS are defined in HTML
- All CSS classes referenced in JS are defined in styles.css
- Solar position algorithm mathematically sound
- Shadow rendering pipeline properly enabled/disabled
- UI panel creation and event wiring complete
- Keyboard shortcuts implemented (S for toggle, Space for play)

**No issues found. Implementation complete.**

---

### Summary

**New file: `sun-study.js`** — self-contained ES module with:
- Pure-math solar position algorithm (NOAA/Meeus) — no external dependencies, consistent with the no-build CDN architecture
- Shadow infrastructure: DirectionalLight with PCFSoftShadowMap, auto-sized shadow camera frustum from model bounding box, shadow-receiving ground plane at model base
- Sun color/intensity that shifts realistically — warm orange at sunrise/sunset, white at midday, dim blue at night
- Animation system with configurable playback speed (10 min/s to 6 hr/s)
- UI panel with location presets (NYC, London, Dubai, Tokyo, Sydney, LA), date picker, time slider, play/pause, shadow quality toggle, and live altitude/azimuth readout

**Modified: `viewer.js`** — added `getViewerState()` export, shadow map pre-configuration on renderer, and `castShadow`/`receiveShadow` on all loaded meshes

**Modified: `index.html`** — Sun button in toolbar, module import wired to toggle

**Modified: `styles.css`** — full panel styling matching existing dark glass theme

**Keyboard shortcuts:** `S` toggles sun study, `Space` toggles play/pause while active.

To test: load an IFC model, click the **Sun** button in the toolbar, and scrub the time slider to watch shadows sweep across the model. The tool cleanly deactivates and restores the original 3-point lighting when you close it.
