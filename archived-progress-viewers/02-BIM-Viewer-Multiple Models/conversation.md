# BIM Viewer — Multi-Model Support Conversation

---

## User

With my BIM Viewer, can you give me the ability to load multiple ifc models at once and after models are loaded to let me append or clear the models.

---

## Claude

Let me explore your current BIM Viewer implementation first.

Now I have a full picture of your viewer. Let me implement multi-model support.

### Changes Made

**index.html**

- Changed file input to `multiple` (`<input type="file" id="fileInput" accept=".ifc" multiple>`)
- Added a fourth sidebar tab: **Models**
- Added a Models panel with an "Append Models" button, a "Clear All" button, and a model list container
- Updated drop zone text to reference plural "IFC Files"
- Updated welcome screen text for plural files

**viewer.js — State Refactor**

Replaced the single-model state:

```js
let modelID = -1;
let modelGroup = null;
```

With a multi-model architecture:

```js
let models = [];        // Array of { idx, filename, modelID, modelGroup, unitFactor, elementCount }
let modelCounter = 0;   // monotonically increasing index for composite keys
```

Global maps now use composite keys (`modelIdx:expressID`) to avoid expressID collisions across different IFC files:

```js
let elementMeshMap = new Map();   // compositeKey → THREE.Mesh
let elementDataMap = new Map();   // compositeKey → { ifcType, name, storey, props, modelIdx }
let storeys = {};                 // name → { elevation, expressID, modelIdx }
```

**viewer.js — Core Functions**

- `makeKey(modelIdx, expressID)` / `parseKey(key)` — composite key helpers
- `loadIFCFiles(files, append)` — loads one or more IFC files; when `append = false`, clears existing models first. Progress overlay shows per-file status (`Loading Structure.ifc (2/3)...`)
- `clearAllModels(silent)` — disposes all Three.js geometry/materials, closes all web-ifc models, resets to welcome screen
- `removeModel(idx)` — removes a single model by index, cleans up its composite-keyed entries from global maps, disposes its Three.js group
- `fitCameraAll()` — computes bounding box across all loaded model groups so the camera frames the combined scene
- `updateModelsPanel()` — renders model cards in the Models tab, each with a visibility toggle (👁) and remove (✕) button

**viewer.js — File Handling**

- `handleFiles(fileList, append)` — filters for `.ifc` files and reads ArrayBuffers
- Browse button (welcome screen) — replaces existing models
- Append Models button (Models tab) — sets `fileInput.dataset.appendMode = 'true'` before opening picker
- Drag-and-drop — auto-detects: if models are already loaded it appends, otherwise it replaces
- File input `change` handler checks `appendMode` flag, then clears it after use

**viewer.js — All Other Functions Updated**

Every function that previously used `modelID`, `modelGroup`, `elementMeshMap[expressID]`, or `elementDataMap[expressID]` was updated to use composite keys and iterate across the `models[]` array:

- `detectUnits(modelID)` — now takes modelID as parameter, returns unitFactor
- `extractStoreys(modelID, modelIdx, unitFactor)` — writes to global `storeys` with `modelIdx` tracking
- `buildSpatialMap(modelID)` — unchanged interface, still returns local map
- `loadGeometry(modelID, modelIdx)` — stores `compositeKey` in `meshObj.userData`, returns `{ modelGroup, elementCount }`
- `extractProperties(modelID, modelIdx, spatialMap)` — filters by composite key prefix
- `applyRotationPreset(idx, targetGroup)` — can target one group or all
- `onCanvasClick` — collects meshes from all model groups for raycasting
- `selectElement` / `clearSelection` — use `selectedKey` (composite) instead of `selectedId`
- `showSelectionInfo` — shows model name when multiple models loaded
- `showPropertyDetail` — shows model name in detail view when multiple models loaded
- `buildSpatialTree` / `updateElementsList` — use `data-key` attribute with composite keys
- `highlightElementInList` — matches on composite key

**styles.css — Models Panel**

Added styles for:

- `.models-toolbar` — flex container for Append/Clear buttons
- `.btn-danger-sm` — red-tinted clear button
- `.model-card` — card layout with info and action buttons
- `.model-card-name` / `.model-card-meta` — filename and element count display
- `.btn-toggle-vis` / `.btn-remove-model` — 30×30px action buttons with hover states
- `.btn-toggle-vis.dimmed` — reduced opacity when model is hidden

---

## User

Can we add a loading model indicator so I know slower larger models are loading?

---

## Claude

Good call — large IFC files can take a while and the current full-screen overlay hides what's happening. Let me add a non-blocking loading indicator that shows real-time progress per model.

### Changes Made

**index.html**

Added a new toast element after the existing loading overlay:

```html
<!-- Model Loading Toast (non-blocking, shown during file loads) -->
<div class="load-toast" id="loadToast">
  <div class="load-toast-header">
    <div class="load-toast-spinner"></div>
    <div class="load-toast-title" id="loadToastTitle">Loading models...</div>
    <div class="load-toast-timer" id="loadToastTimer">0s</div>
  </div>
  <div class="load-toast-progress">
    <div class="load-toast-progress-fill" id="loadToastProgressFill"></div>
  </div>
  <div class="load-toast-step" id="loadToastStep">Preparing...</div>
  <div class="load-toast-queue" id="loadToastQueue"></div>
</div>
```

The original full-screen overlay is kept only for the one-time engine initialization.

**viewer.js — New Toast Functions**

```js
let loadToastTimer = null;
let loadToastStart = 0;
```

- `showLoadToast(title)` — shows the toast, starts the elapsed timer interval (updates every 500ms)
- `setLoadToastStep(step)` — updates the current processing phase text
- `setLoadToastProgress(pct)` — sets the gradient progress bar width
- `updateLoadToastQueue(files, currentIndex)` — renders the file queue list with status icons:
  - `✓` (green) for completed files
  - `⟳` (spinning, accent) for the active file
  - `·` (muted) for pending files
  - Each file shows its name and size in MB
- `hideLoadToast()` — flashes "Complete" briefly, then hides after 800ms

**viewer.js — Updated `loadIFCFiles`**

Replaced all `showLoading()` calls with toast equivalents:

```js
showLoadToast(toastTitle);
updateLoadToastQueue(files, 0);

// Per file:
updateLoadToastQueue(files, f);
setLoadToastStep(`Parsing ${name}...`);
setLoadToastStep(`${name}: Detecting units`);
setLoadToastStep(`${name}: Extracting spatial structure`);
setLoadToastStep(`${name}: Loading 3D geometry...`);
setLoadToastStep(`${name}: Extracting properties (${elementCount} elements)`);
```

**viewer.js — `yieldToUI()`**

```js
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
```

Called between heavy processing steps so the browser actually repaints — the timer ticks, the progress bar moves, and the step text updates in real time even while web-ifc is crunching geometry.

**viewer.js — Updated `handleFiles`**

Now passes `size` property to `loadIFCFiles`:

```js
files.push({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
```

**styles.css — Toast Styles**

Added comprehensive styles for the toast component:

- `.load-toast` — fixed bottom-right, 340px wide, dark card with shadow, slide-up animation
- `.load-toast-header` — flex row with spinner, title, and timer
- `.load-toast-spinner` — 18px spinning border animation
- `.load-toast-timer` — accent-colored, tabular-nums for steady width
- `.load-toast-progress` / `.load-toast-progress-fill` — 3px gradient progress bar
- `.load-toast-step` — muted text showing current processing phase
- `.load-toast-queue` — scrollable file list (max 180px)
- `.load-toast-file` — file row with status icon, name, and size
- `.load-toast-file.active` — subtle accent background, bold name, spinning status icon
- `.load-toast-file.done` — muted name, green checkmark
- `.load-toast-file.pending` — muted dot

The toast is non-blocking so you can still orbit/pan the 3D scene while models load. The elapsed timer gives you confidence that processing is still happening on larger files.
