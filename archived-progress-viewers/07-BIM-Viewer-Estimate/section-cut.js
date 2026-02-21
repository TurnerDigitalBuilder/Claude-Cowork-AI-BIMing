/* ============================================================
   Section Cut Tool — section-cut.js
   Single plane + Section Box (6 planes) clipping
   for BIM Model Viewer
   ============================================================ */

import * as THREE from 'three';
import { getViewerState } from './viewer.js';

// ======================== STATE ========================
const state = {
  active: false,
  mode: 'plane',         // 'plane' | 'box'

  // Single plane
  planeAxis: 'y',        // 'x' | 'y' | 'z'
  planeFlipped: false,
  planePosition: 0.5,    // 0-1 normalized within model bounds

  // Section box — normalized 0-1 within model bounds
  box: {
    xMin: 0.0, xMax: 1.0,
    yMin: 0.0, yMax: 1.0,
    zMin: 0.0, zMax: 1.0,
  },

  // Visual options
  showPlaneHelper: true,
  showCaps: false,        // fill cut faces (stencil-based)
};

// Three.js clipping objects
let clipPlanes = [];       // active THREE.Plane array
let planeHelpers = [];     // visual helpers in scene
let stencilGroup = null;   // for cap rendering

// Cached model bounds
let cachedBounds = null;

// ======================== ACTIVATE / DEACTIVATE ========================

function activate() {
  const { renderer, models } = getViewerState();
  if (state.active || models.length === 0) return;
  state.active = true;

  // Enable clipping on renderer
  renderer.localClippingEnabled = true;

  // Calculate and cache model bounds
  cachedBounds = getModelBounds();
  if (cachedBounds.isEmpty()) {
    state.active = false;
    return;
  }

  // Initialize plane position to center
  state.planePosition = 0.5;
  state.box = { xMin: 0.0, xMax: 1.0, yMin: 0.0, yMax: 1.0, zMin: 0.0, zMax: 1.0 };

  // Create clip planes and apply
  updateClipping();

  // Show UI
  showPanel();

  // Update toolbar button
  const btn = document.getElementById('btnSectionCut');
  if (btn) btn.classList.add('active');
}

function deactivate() {
  const { renderer, elementMeshMap } = getViewerState();
  if (!state.active) return;
  state.active = false;

  // Remove clip planes from all materials
  for (const [, mesh] of elementMeshMap) {
    mesh.material.clippingPlanes = [];
    mesh.material.needsUpdate = true;
  }

  // Remove helpers
  removeHelpers();

  // Remove stencil group
  removeStencil();

  // Disable clipping
  renderer.localClippingEnabled = false;
  clipPlanes = [];

  // Hide UI
  hidePanel();

  const btn = document.getElementById('btnSectionCut');
  if (btn) btn.classList.remove('active');
}

function toggle() {
  if (state.active) deactivate();
  else activate();
}

// ======================== CLIPPING LOGIC ========================

/**
 * Recalculate clip planes from state and apply to all mesh materials.
 */
function updateClipping() {
  if (!state.active || !cachedBounds) return;

  const bounds = cachedBounds;
  const min = bounds.min;
  const max = bounds.max;
  const size = bounds.getSize(new THREE.Vector3());

  // Build clip planes based on mode
  clipPlanes = [];

  if (state.mode === 'plane') {
    clipPlanes = buildSinglePlane(min, max, size);
  } else {
    clipPlanes = buildSectionBox(min, max, size);
  }

  // Apply to all mesh materials
  const { elementMeshMap } = getViewerState();
  for (const [, mesh] of elementMeshMap) {
    mesh.material.clippingPlanes = clipPlanes;
    mesh.material.clipShadows = true;
    mesh.material.needsUpdate = true;
  }

  // Update visual helpers
  updateHelpers(bounds);

  // Update cap rendering if enabled
  if (state.showCaps) {
    updateStencilCaps();
  }
}

/**
 * Build a single THREE.Plane from state.
 */
function buildSinglePlane(min, max, size) {
  const axis = state.planeAxis;
  const t = state.planePosition; // 0-1

  // Map axis to normal vector and calculate constant
  let normal, point;

  switch (axis) {
    case 'x':
      normal = new THREE.Vector3(1, 0, 0);
      point = min.x + t * size.x;
      break;
    case 'y':
      normal = new THREE.Vector3(0, 1, 0);
      point = min.y + t * size.y;
      break;
    case 'z':
      normal = new THREE.Vector3(0, 0, 1);
      point = min.z + t * size.z;
      break;
  }

  if (state.planeFlipped) normal.negate();

  // THREE.Plane: normal.dot(point) + constant = 0
  // constant = -normal.dot(pointOnPlane)
  const plane = new THREE.Plane(normal, -normal.dot(new THREE.Vector3().copy(min).setComponent(
    axis === 'x' ? 0 : axis === 'y' ? 1 : 2,
    point
  )));

  return [plane];
}

/**
 * Build 6 THREE.Plane objects for section box.
 */
function buildSectionBox(min, max, size) {
  const b = state.box;
  const planes = [];

  // +X plane (clips everything beyond xMax)
  const xMaxPos = min.x + b.xMax * size.x;
  planes.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), xMaxPos));

  // -X plane (clips everything below xMin)
  const xMinPos = min.x + b.xMin * size.x;
  planes.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -xMinPos));

  // +Y plane
  const yMaxPos = min.y + b.yMax * size.y;
  planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), yMaxPos));

  // -Y plane
  const yMinPos = min.y + b.yMin * size.y;
  planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -yMinPos));

  // +Z plane
  const zMaxPos = min.z + b.zMax * size.z;
  planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), zMaxPos));

  // -Z plane
  const zMinPos = min.z + b.zMin * size.z;
  planes.push(new THREE.Plane(new THREE.Vector3(0, 0, 1), -zMinPos));

  return planes;
}

// ======================== VISUAL HELPERS ========================

function removeHelpers() {
  const { scene } = getViewerState();
  for (const h of planeHelpers) {
    scene.remove(h);
    if (h.geometry) h.geometry.dispose();
    if (h.material) {
      if (Array.isArray(h.material)) h.material.forEach(m => m.dispose());
      else h.material.dispose();
    }
  }
  planeHelpers = [];
}

function updateHelpers(bounds) {
  removeHelpers();
  if (!state.showPlaneHelper) return;

  const { scene } = getViewerState();
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  if (state.mode === 'plane') {
    // Single plane visualization
    const plane = clipPlanes[0];
    if (!plane) return;

    const helperSize = maxDim * 1.2;
    const helperGeo = new THREE.PlaneGeometry(helperSize, helperSize);
    const helperMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const helperMesh = new THREE.Mesh(helperGeo, helperMat);

    // Position and orient the helper to match the clip plane
    const axis = state.planeAxis;
    const t = state.planePosition;
    const min = bounds.min;

    switch (axis) {
      case 'x': {
        const pos = min.x + t * size.x;
        helperMesh.position.set(pos, center.y, center.z);
        helperMesh.rotation.y = Math.PI / 2;
        break;
      }
      case 'y': {
        const pos = min.y + t * size.y;
        helperMesh.position.set(center.x, pos, center.z);
        helperMesh.rotation.x = -Math.PI / 2;
        break;
      }
      case 'z': {
        const pos = min.z + t * size.z;
        helperMesh.position.set(center.x, center.y, pos);
        break;
      }
    }

    // Add a thin edge outline for the plane
    const edgeGeo = new THREE.EdgesGeometry(helperGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.4 });
    const edgeLine = new THREE.LineSegments(edgeGeo, edgeMat);
    helperMesh.add(edgeLine);

    helperMesh.name = 'SectionPlaneHelper';
    helperMesh.renderOrder = 1;
    scene.add(helperMesh);
    planeHelpers.push(helperMesh);

  } else {
    // Section box wireframe visualization
    const b = state.box;
    const min = bounds.min;

    const boxMin = new THREE.Vector3(
      min.x + b.xMin * size.x,
      min.y + b.yMin * size.y,
      min.z + b.zMin * size.z,
    );
    const boxMax = new THREE.Vector3(
      min.x + b.xMax * size.x,
      min.y + b.yMax * size.y,
      min.z + b.zMax * size.z,
    );

    const boxSize = new THREE.Vector3().subVectors(boxMax, boxMin);
    const boxCenter = new THREE.Vector3().addVectors(boxMin, boxMax).multiplyScalar(0.5);

    // Wireframe box
    const boxGeo = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
    const edgeGeo = new THREE.EdgesGeometry(boxGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.6,
    });
    const wireBox = new THREE.LineSegments(edgeGeo, edgeMat);
    wireBox.position.copy(boxCenter);
    wireBox.name = 'SectionBoxHelper';
    wireBox.renderOrder = 1;
    scene.add(wireBox);
    planeHelpers.push(wireBox);

    // Semi-transparent faces
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.03,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(boxGeo.clone(), faceMat);
    faceMesh.position.copy(boxCenter);
    faceMesh.name = 'SectionBoxFaces';
    faceMesh.renderOrder = 0;
    scene.add(faceMesh);
    planeHelpers.push(faceMesh);

    boxGeo.dispose();
  }
}

// ======================== STENCIL CAPS (optional) ========================

function removeStencil() {
  const { scene } = getViewerState();
  if (stencilGroup) {
    scene.remove(stencilGroup);
    stencilGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    stencilGroup = null;
  }
}

function updateStencilCaps() {
  // Stencil-based cap rendering is complex and perf-heavy.
  // For now we keep this as a placeholder — the visual effect
  // comes from the clipping itself. Full stencil caps would require
  // a two-pass render with stencil buffer manipulation.
  // This can be enhanced in a future iteration.
}

// ======================== HELPERS ========================

function getModelBounds() {
  const { models } = getViewerState();
  const box = new THREE.Box3();
  for (const m of models) {
    if (m.modelGroup) {
      m.modelGroup.updateMatrixWorld(true);
      box.expandByObject(m.modelGroup);
    }
  }
  return box;
}

/** Refresh bounds (call after model load/remove) */
function refreshBounds() {
  if (!state.active) return;
  cachedBounds = getModelBounds();
  updateClipping();
}

// ======================== UI PANEL ========================

function createPanel() {
  const existing = document.getElementById('sectionCutPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'sectionCutPanel';
  panel.className = 'section-cut-panel';

  panel.innerHTML = `
    <div class="sc-header">
      <div class="sc-title">Section Cut</div>
      <button class="sc-close" id="scClose" title="Close section cut">&times;</button>
    </div>

    <div class="sc-section">
      <label class="sc-label">Mode</label>
      <div class="sc-mode-row">
        <button class="sc-mode-btn active" id="scModePlane" data-mode="plane">Single Plane</button>
        <button class="sc-mode-btn" id="scModeBox" data-mode="box">Section Box</button>
      </div>
    </div>

    <!-- SINGLE PLANE CONTROLS -->
    <div id="scPlaneControls">
      <div class="sc-section">
        <label class="sc-label">Plane Axis</label>
        <div class="sc-axis-row" id="scAxisBtns">
          <button class="sc-axis-btn" data-axis="x">X</button>
          <button class="sc-axis-btn active" data-axis="y">Y</button>
          <button class="sc-axis-btn" data-axis="z">Z</button>
        </div>
      </div>

      <div class="sc-section">
        <label class="sc-label">
          Position <span class="sc-pos-display" id="scPosDisplay">50%</span>
        </label>
        <input type="range" id="scPosSlider" class="sc-slider" min="0" max="1000" step="1" value="500">
        <div class="sc-slider-labels">
          <span>Min</span><span>Center</span><span>Max</span>
        </div>
      </div>

      <div class="sc-section sc-option-row">
        <label class="sc-checkbox-label">
          <input type="checkbox" id="scFlip"> Flip Direction
        </label>
      </div>
    </div>

    <!-- SECTION BOX CONTROLS -->
    <div id="scBoxControls" style="display:none;">
      <div class="sc-section">
        <label class="sc-label">X Range</label>
        <div class="sc-range-row">
          <span class="sc-range-label">Min</span>
          <input type="range" id="scBoxXMin" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="0">
          <span class="sc-range-val" id="scBoxXMinVal">0%</span>
        </div>
        <div class="sc-range-row">
          <span class="sc-range-label">Max</span>
          <input type="range" id="scBoxXMax" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="1000">
          <span class="sc-range-val" id="scBoxXMaxVal">100%</span>
        </div>
      </div>

      <div class="sc-section">
        <label class="sc-label">Y Range</label>
        <div class="sc-range-row">
          <span class="sc-range-label">Min</span>
          <input type="range" id="scBoxYMin" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="0">
          <span class="sc-range-val" id="scBoxYMinVal">0%</span>
        </div>
        <div class="sc-range-row">
          <span class="sc-range-label">Max</span>
          <input type="range" id="scBoxYMax" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="1000">
          <span class="sc-range-val" id="scBoxYMaxVal">100%</span>
        </div>
      </div>

      <div class="sc-section">
        <label class="sc-label">Z Range</label>
        <div class="sc-range-row">
          <span class="sc-range-label">Min</span>
          <input type="range" id="scBoxZMin" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="0">
          <span class="sc-range-val" id="scBoxZMinVal">0%</span>
        </div>
        <div class="sc-range-row">
          <span class="sc-range-label">Max</span>
          <input type="range" id="scBoxZMax" class="sc-slider sc-slider-sm" min="0" max="1000" step="1" value="1000">
          <span class="sc-range-val" id="scBoxZMaxVal">100%</span>
        </div>
      </div>

      <div class="sc-section" style="text-align:center;">
        <button class="sc-reset-btn" id="scResetBox">Reset Box</button>
      </div>
    </div>

    <!-- OPTIONS -->
    <div class="sc-section sc-option-row">
      <label class="sc-checkbox-label">
        <input type="checkbox" id="scShowHelper" checked> Show Plane Helper
      </label>
    </div>

    <!-- READOUT -->
    <div class="sc-readout" id="scReadout">
      <div class="sc-readout-item">
        <span class="sc-readout-label">Mode</span>
        <span class="sc-readout-value" id="scReadoutMode">Plane</span>
      </div>
      <div class="sc-readout-item">
        <span class="sc-readout-label">Planes</span>
        <span class="sc-readout-value" id="scReadoutPlanes">1</span>
      </div>
      <div class="sc-readout-item">
        <span class="sc-readout-label">Axis</span>
        <span class="sc-readout-value" id="scReadoutAxis">Y</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  wirePanel();
}

function wirePanel() {
  // Close
  document.getElementById('scClose').addEventListener('click', deactivate);

  // Mode toggle
  document.querySelectorAll('.sc-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.sc-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide control sections
      document.getElementById('scPlaneControls').style.display = state.mode === 'plane' ? '' : 'none';
      document.getElementById('scBoxControls').style.display = state.mode === 'box' ? '' : 'none';

      updateClipping();
      updateReadout();
    });
  });

  // Axis buttons (single plane)
  document.getElementById('scAxisBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('.sc-axis-btn');
    if (!btn) return;
    state.planeAxis = btn.dataset.axis;
    document.querySelectorAll('.sc-axis-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateClipping();
    updateReadout();
  });

  // Position slider (single plane)
  document.getElementById('scPosSlider').addEventListener('input', (e) => {
    state.planePosition = parseInt(e.target.value) / 1000;
    document.getElementById('scPosDisplay').textContent = `${Math.round(state.planePosition * 100)}%`;
    updateClipping();
  });

  // Flip
  document.getElementById('scFlip').addEventListener('change', (e) => {
    state.planeFlipped = e.target.checked;
    updateClipping();
  });

  // Section box sliders
  const boxSliders = ['XMin', 'XMax', 'YMin', 'YMax', 'ZMin', 'ZMax'];
  for (const key of boxSliders) {
    const slider = document.getElementById(`scBox${key}`);
    const valEl = document.getElementById(`scBox${key}Val`);
    if (!slider || !valEl) continue;

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value) / 1000;
      const stateKey = key.charAt(0).toLowerCase() + key.slice(1); // xMin, xMax, etc.
      state.box[stateKey] = val;
      valEl.textContent = `${Math.round(val * 100)}%`;

      // Enforce min < max
      const axis = key.charAt(0).toLowerCase();
      if (key.endsWith('Min') && state.box[`${axis}Min`] > state.box[`${axis}Max`]) {
        state.box[`${axis}Max`] = state.box[`${axis}Min`];
        const maxSlider = document.getElementById(`scBox${key.charAt(0)}Max`);
        const maxVal = document.getElementById(`scBox${key.charAt(0)}MaxVal`);
        if (maxSlider) maxSlider.value = Math.round(state.box[`${axis}Max`] * 1000);
        if (maxVal) maxVal.textContent = `${Math.round(state.box[`${axis}Max`] * 100)}%`;
      }
      if (key.endsWith('Max') && state.box[`${axis}Max`] < state.box[`${axis}Min`]) {
        state.box[`${axis}Min`] = state.box[`${axis}Max`];
        const minSlider = document.getElementById(`scBox${key.charAt(0)}Min`);
        const minVal = document.getElementById(`scBox${key.charAt(0)}MinVal`);
        if (minSlider) minSlider.value = Math.round(state.box[`${axis}Min`] * 1000);
        if (minVal) minVal.textContent = `${Math.round(state.box[`${axis}Min`] * 100)}%`;
      }

      updateClipping();
    });
  }

  // Reset box
  document.getElementById('scResetBox').addEventListener('click', () => {
    state.box = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 };
    // Reset all sliders
    for (const key of boxSliders) {
      const slider = document.getElementById(`scBox${key}`);
      const valEl = document.getElementById(`scBox${key}Val`);
      const isMin = key.endsWith('Min');
      if (slider) slider.value = isMin ? 0 : 1000;
      if (valEl) valEl.textContent = isMin ? '0%' : '100%';
    }
    updateClipping();
  });

  // Show helper toggle
  document.getElementById('scShowHelper').addEventListener('change', (e) => {
    state.showPlaneHelper = e.target.checked;
    updateClipping();
  });
}

function showPanel() {
  createPanel();
  // Set initial axis highlight
  const activeAxis = document.querySelector(`.sc-axis-btn[data-axis="${state.planeAxis}"]`);
  if (activeAxis) {
    document.querySelectorAll('.sc-axis-btn').forEach(b => b.classList.remove('active'));
    activeAxis.classList.add('active');
  }
  updateReadout();
}

function hidePanel() {
  const panel = document.getElementById('sectionCutPanel');
  if (panel) panel.remove();
}

function updateReadout() {
  const modeEl = document.getElementById('scReadoutMode');
  const planesEl = document.getElementById('scReadoutPlanes');
  const axisEl = document.getElementById('scReadoutAxis');

  if (modeEl) modeEl.textContent = state.mode === 'plane' ? 'Plane' : 'Box';
  if (planesEl) planesEl.textContent = state.mode === 'plane' ? '1' : '6';
  if (axisEl) axisEl.textContent = state.mode === 'plane'
    ? state.planeAxis.toUpperCase()
    : 'X/Y/Z';
}

// ======================== KEYBOARD SHORTCUT ========================
document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;

  if (e.key === 'c' || e.key === 'C') {
    toggle();
  }
});

// ======================== EXPORTS ========================
export { toggle, activate, deactivate, state, refreshBounds };
