/* ============================================================
   BIM Model Viewer — viewer.js
   Three.js + web-ifc IFC viewer engine
   Multi-model support: load, append, clear
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ======================== STATE ========================
let ifcAPI = null;
let scene, camera, renderer, controls, raycaster, mouse;

// --- Multi-model state ---
// Each loaded model entry: { idx, filename, modelID, modelGroup, unitFactor, elementCount }
let models = [];
let modelCounter = 0;  // monotonically increasing index for composite keys

// Global combined maps use composite key: "modelIdx:expressID"
let elementMeshMap = new Map();   // compositeKey → THREE.Mesh
let elementDataMap = new Map();   // compositeKey → { ifcType, name, storey, props, modelIdx }
let storeys = {};                 // name → { elevation, expressID, modelIdx }

let selectedKey = null;           // composite key of selected element (legacy, kept for compat)
let selectedKeys = new Set();     // multi-select: set of selected composite keys
let wireframeMode = false;
let xrayMode = false;
let rotationPresetIndex = 0;

const ROTATION_PRESETS = [
  { label: 'No rotation (raw IFC)', rx: 0, ry: 0, rz: 0 },
  { label: 'Z-up → Y-up (−90° X)', rx: -Math.PI / 2, ry: 0, rz: 0 },
  { label: 'Z-up → Y-up (+90° X)', rx: Math.PI / 2, ry: 0, rz: 0 },
  { label: '−90° X + 180° Z', rx: -Math.PI / 2, ry: 0, rz: Math.PI },
  { label: '+90° X + 180° Z', rx: Math.PI / 2, ry: 0, rz: Math.PI },
  { label: '180° X', rx: Math.PI, ry: 0, rz: 0 },
];

// ======================== IFC TYPE CONSTANTS ========================
const IFCTYPES = {
  IFCBEAM: 753842376, IFCCOLUMN: 3495092785, IFCSLAB: 1529196076,
  IFCWALL: 2391406946, IFCWALLSTANDARDCASE: 3512223829, IFCFOOTING: 900683007,
  IFCMEMBER: 1073191201, IFCPLATE: 3171933400, IFCRAILING: 2262370178,
  IFCSTAIR: 331165859, IFCSTAIRFLIGHT: 4252922144, IFCRAMP: 3024970846,
  IFCRAMPFLIGHT: 3283111854, IFCCURTAINWALL: 844718557, IFCDOOR: 395920057,
  IFCWINDOW: 3304561284, IFCBUILDINGELEMENTPROXY: 1095909175,
  IFCPILE: 1687234759, IFCELEMENTASSEMBLY: 4123344466,
  IFCBUILDINGSTOREY: 3124254112, IFCRELCONTAINEDINSPATIALSTRUCTURE: 3242617779,
  IFCRELAGGREGATES: 160246688, IFCRELDEFINESBYPROPERTIES: 4186316022,
  IFCPROPERTYSET: 1451395588, IFCELEMENTQUANTITY: 1883228015,
  IFCPROPERTYSINGLEVALUE: 3972844353, IFCQUANTITYLENGTH: 931644368,
  IFCQUANTITYAREA: 2044713172, IFCQUANTITYVOLUME: 3124970251,
  IFCQUANTITYWEIGHT: 825690147, IFCQUANTITYCOUNT: 2093928680,
  IFCPROJECT: 103090709, IFCSIUNIT: 448429030, IFCUNITASSIGNMENT: 180925521,
  IFCCONVERSIONBASEDUNIT: 2889183280, IFCMEASUREWITHUNIT: 3368373690,
};

const TYPE_ID_TO_NAME = {};
for (const [name, id] of Object.entries(IFCTYPES)) {
  TYPE_ID_TO_NAME[id] = name;
}

const SKIP_TYPES = new Set([
  'IFCBUILDINGSTOREY', 'IFCBUILDING', 'IFCSITE', 'IFCPROJECT',
  'IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION',
]);

const TYPE_COLORS = {
  IFCBEAM: 0x7799cc, IFCCOLUMN: 0xcc6666, IFCSLAB: 0xaaaaaa,
  IFCWALL: 0xd9cc99, IFCWALLSTANDARDCASE: 0xd9cc99, IFCFOOTING: 0x808080,
  IFCMEMBER: 0x88bb88, IFCPLATE: 0xbbaa88, IFCBUILDINGELEMENTPROXY: 0xbbbbbb,
  IFCPILE: 0x998877, IFCELEMENTASSEMBLY: 0xb388b3, IFCRAILING: 0x88aacc,
  IFCSTAIR: 0xccaa88, IFCSTAIRFLIGHT: 0xccaa88, IFCOPENINGELEMENT: 0x555555,
  IFCDOOR: 0x66aa66, IFCWINDOW: 0x66aacc, IFCCURTAINWALL: 0x88bbcc,
  IFCRAMP: 0xbb9977, IFCRAMPFLIGHT: 0xbb9977,
};

// ======================== COMPOSITE KEY HELPERS ========================
function makeKey(modelIdx, expressID) {
  return `${modelIdx}:${expressID}`;
}

function parseKey(key) {
  const parts = key.split(':');
  return { modelIdx: parseInt(parts[0]), expressID: parseInt(parts[1]) };
}

// ======================== INIT THREE.JS ========================
function initThreeJS() {
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);

  camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.1, 10000
  );
  camera.position.set(50, 40, 50);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  // Lighting rig — 3-point + ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.7);
  d1.position.set(80, 120, 60);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x8899cc, 0.35);
  d2.position.set(-60, 80, -40);
  scene.add(d2);
  const d3 = new THREE.DirectionalLight(0xffffff, 0.15);
  d3.position.set(0, -50, 0);
  scene.add(d3);

  // Grid
  scene.add(new THREE.GridHelper(500, 50, 0x3d3e66, 0x2d2e52));

  // Raycaster for selection
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // Click-to-select + right-click context menu
  renderer.domElement.addEventListener('click', onCanvasClick);
  renderer.domElement.addEventListener('contextmenu', onCanvasRightClick);

  // Render loop
  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

// ======================== INIT WEB-IFC ========================
async function initIfcAPI() {
  showLoading('Initializing IFC engine...', 5);
  ifcAPI = new WebIFC.IfcAPI();
  await ifcAPI.Init();
  hideLoading();
  console.log('[viewer] web-ifc initialized');
}

// ======================== LOAD TOAST (non-blocking loading indicator) ========================
let loadToastTimer = null;
let loadToastStart = 0;

function showLoadToast(title) {
  const toast = document.getElementById('loadToast');
  toast.classList.add('visible');
  document.getElementById('loadToastTitle').textContent = title;
  document.getElementById('loadToastStep').textContent = 'Preparing...';
  document.getElementById('loadToastQueue').innerHTML = '';
  setLoadToastProgress(0);

  // Start elapsed timer
  loadToastStart = Date.now();
  clearInterval(loadToastTimer);
  loadToastTimer = setInterval(() => {
    const elapsed = ((Date.now() - loadToastStart) / 1000) | 0;
    const min = (elapsed / 60) | 0;
    const sec = elapsed % 60;
    document.getElementById('loadToastTimer').textContent =
      min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }, 500);
}

function setLoadToastStep(step) {
  document.getElementById('loadToastStep').textContent = step;
}

function setLoadToastProgress(pct) {
  document.getElementById('loadToastProgressFill').style.width = Math.min(100, pct) + '%';
}

function updateLoadToastQueue(files, currentIndex) {
  const container = document.getElementById('loadToastQueue');
  let html = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
    let status, cls;
    if (i < currentIndex) {
      status = '✓'; cls = 'done';
    } else if (i === currentIndex) {
      status = '⟳'; cls = 'active';
    } else {
      status = '·'; cls = 'pending';
    }
    html += `<div class="load-toast-file ${cls}">`;
    html += `<span class="load-toast-file-status">${status}</span>`;
    html += `<span class="load-toast-file-name">${f.name}</span>`;
    html += `<span class="load-toast-file-size">${sizeMB} MB</span>`;
    html += `</div>`;
  }
  container.innerHTML = html;
}

function hideLoadToast() {
  clearInterval(loadToastTimer);
  const toast = document.getElementById('loadToast');
  // Brief "done" flash before hiding
  document.getElementById('loadToastStep').textContent = 'Complete';
  setLoadToastProgress(100);
  setTimeout(() => toast.classList.remove('visible'), 800);
}

// ======================== LOAD MULTIPLE IFC FILES ========================
/**
 * Load one or more IFC files. Supports both initial load and append.
 * @param {Array<{name: string, buffer: ArrayBuffer, size: number}>} files
 * @param {boolean} append - if false, clears existing models first
 */
async function loadIFCFiles(files, append = false) {
  if (!append) {
    clearAllModels(true); // silent clear (no UI update yet)
  }

  const totalFiles = files.length;
  const toastTitle = totalFiles === 1
    ? `Loading ${files[0].name.replace('.ifc', '')}`
    : `Loading ${totalFiles} models`;
  showLoadToast(toastTitle);
  updateLoadToastQueue(files, 0);

  for (let f = 0; f < totalFiles; f++) {
    const { name, buffer } = files[f];
    const overallPct = (f / totalFiles) * 100;

    updateLoadToastQueue(files, f);

    setLoadToastStep(`Parsing ${name}...`);
    setLoadToastProgress(overallPct + 2);
    await yieldToUI();

    const idx = modelCounter++;
    const data = new Uint8Array(buffer);
    const modelID = ifcAPI.OpenModel(data);

    setLoadToastStep(`${name}: Detecting units`);
    setLoadToastProgress(overallPct + (100 / totalFiles) * 0.1);
    const unitFactor = detectUnits(modelID);

    setLoadToastStep(`${name}: Extracting spatial structure`);
    setLoadToastProgress(overallPct + (100 / totalFiles) * 0.2);
    await yieldToUI();
    extractStoreys(modelID, idx, unitFactor);
    const spatialMap = buildSpatialMap(modelID);

    setLoadToastStep(`${name}: Loading 3D geometry...`);
    setLoadToastProgress(overallPct + (100 / totalFiles) * 0.3);
    await yieldToUI();
    const { modelGroup, elementCount } = await loadGeometry(modelID, idx);

    setLoadToastStep(`${name}: Extracting properties (${elementCount} elements)`);
    setLoadToastProgress(overallPct + (100 / totalFiles) * 0.8);
    await yieldToUI();
    extractProperties(modelID, idx, spatialMap);

    // Apply rotation and add to scene
    if (modelGroup) {
      applyRotationPreset(rotationPresetIndex, modelGroup);
      scene.add(modelGroup);
      modelGroup.updateMatrixWorld(true);
    }

    const modelEntry = {
      idx,
      filename: name.replace('.ifc', ''),
      modelID,
      modelGroup,
      unitFactor,
      elementCount,
    };
    models.push(modelEntry);

    setLoadToastProgress(((f + 1) / totalFiles) * 100);
    console.log(`[viewer] Loaded model "${name}" (idx=${idx}, elements=${elementCount})`);
  }

  // Mark all files done in queue
  updateLoadToastQueue(files, totalFiles);
  setLoadToastStep('Finalizing...');

  // Update title
  if (models.length === 1) {
    document.getElementById('modelTitle').textContent = models[0].filename;
  } else {
    document.getElementById('modelTitle').textContent = `${models.length} Models Loaded`;
  }

  fitCameraAll();
  updateUI();
  hideLoadToast();

  // Notify UniFormat panel to refresh classifications
  window.dispatchEvent(new CustomEvent('uniformat-refresh'));
  window.dispatchEvent(new CustomEvent('quantification-refresh'));
}

/** Yield to the browser so the UI can repaint (timer updates, progress bar, etc.) */
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ======================== CLEAR ALL MODELS ========================
function clearAllModels(silent = false) {
  clearSelection();

  // Remove model groups from scene
  for (const m of models) {
    if (m.modelGroup) {
      scene.remove(m.modelGroup);
      // Dispose geometries and materials
      m.modelGroup.traverse(child => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
    }
    // Close model in web-ifc
    try { ifcAPI.CloseModel(m.modelID); } catch {}
  }

  models = [];
  elementMeshMap.clear();
  elementDataMap.clear();
  storeys = {};
  selectedKey = null;

  if (!silent) {
    document.getElementById('modelTitle').textContent = 'BIM Model Viewer';
    document.getElementById('modelSubtitle').textContent = 'Load IFC files to begin';
    document.getElementById('welcomePanel').style.display = '';
    document.getElementById('treeContent').classList.add('hidden');
    document.getElementById('viewerInfo').textContent = 'No model loaded';
    document.getElementById('spatialTree').innerHTML = '';
    document.getElementById('elementsList').innerHTML = '';
    document.getElementById('detailContent').style.display = 'none';
    document.getElementById('detailPlaceholder').style.display = '';
    updateModelsPanel();

    // Reset filters
    const storeySelect = document.getElementById('filterStorey');
    const typeSelect = document.getElementById('filterType');
    storeySelect.innerHTML = '<option value="all">All Levels</option>';
    typeSelect.innerHTML = '<option value="all">All Types</option>';

    // Clear UniFormat tree
    const ufTree = document.getElementById('uniformatTree');
    if (ufTree) ufTree.innerHTML = '';
  }
}

// ======================== REMOVE SINGLE MODEL ========================
function removeModel(idx) {
  const mIndex = models.findIndex(m => m.idx === idx);
  if (mIndex === -1) return;

  const m = models[mIndex];
  clearSelection();

  // Remove from scene
  if (m.modelGroup) {
    scene.remove(m.modelGroup);
    m.modelGroup.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        child.material?.dispose();
      }
    });
  }

  // Close model in web-ifc
  try { ifcAPI.CloseModel(m.modelID); } catch {}

  // Remove entries from global maps with this model's idx
  const prefix = `${idx}:`;
  for (const key of [...elementMeshMap.keys()]) {
    if (key.startsWith(prefix)) elementMeshMap.delete(key);
  }
  for (const key of [...elementDataMap.keys()]) {
    if (key.startsWith(prefix)) elementDataMap.delete(key);
  }

  // Remove storeys belonging to this model
  for (const [name, data] of Object.entries(storeys)) {
    if (data.modelIdx === idx) delete storeys[name];
  }

  models.splice(mIndex, 1);

  // Update title
  if (models.length === 0) {
    clearAllModels();
  } else if (models.length === 1) {
    document.getElementById('modelTitle').textContent = models[0].filename;
    updateUI();
    fitCameraAll();
    window.dispatchEvent(new CustomEvent('uniformat-refresh'));
  window.dispatchEvent(new CustomEvent('quantification-refresh'));
  } else {
    document.getElementById('modelTitle').textContent = `${models.length} Models Loaded`;
    updateUI();
    fitCameraAll();
    window.dispatchEvent(new CustomEvent('uniformat-refresh'));
  window.dispatchEvent(new CustomEvent('quantification-refresh'));
  }
}

// ======================== UNIT DETECTION ========================
function detectUnits(modelID) {
  let unitFactor = 1.0;
  try {
    const projects = ifcAPI.GetLineIDsWithType(modelID, IFCTYPES.IFCPROJECT);
    if (projects.size() > 0) {
      const proj = ifcAPI.GetLine(modelID, projects.get(0));
      if (proj.UnitsInContext) {
        const unitAssign = ifcAPI.GetLine(modelID, proj.UnitsInContext.value);
        if (unitAssign.Units) {
          for (const unitRef of unitAssign.Units) {
            const unit = ifcAPI.GetLine(modelID, unitRef.value);
            if (unit.UnitType && unit.UnitType.value === 'LENGTHUNIT') {
              if (unit.type === IFCTYPES.IFCCONVERSIONBASEDUNIT) {
                const factor = ifcAPI.GetLine(modelID, unit.ConversionFactor.value);
                if (factor.ValueComponent) {
                  unitFactor = factor.ValueComponent.value;
                }
              } else if (unit.Prefix) {
                const prefixes = {
                  '.MILLI.': 0.001, '.CENTI.': 0.01,
                  '.DECI.': 0.1, '.KILO.': 1000,
                };
                unitFactor = prefixes[unit.Prefix.value] || 1.0;
              }
            }
          }
        }
      }
    }
  } catch (e) { console.warn('[viewer] Unit detection fallback:', e); }
  console.log('[viewer] Unit factor (to meters):', unitFactor);
  return unitFactor;
}

// ======================== STOREYS ========================
function extractStoreys(modelID, modelIdx, unitFactor) {
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCTYPES.IFCBUILDINGSTOREY);
  for (let i = 0; i < ids.size(); i++) {
    const line = ifcAPI.GetLine(modelID, ids.get(i));
    const name = line.Name?.value || `Level ${i}`;
    const elev = line.Elevation?.value || 0;
    // Use model-prefixed name if there's a collision with another model's storey
    const storeyKey = storeys[name] && storeys[name].modelIdx !== modelIdx
      ? `${name} [${models.length > 0 ? models.find(m => m.idx === modelIdx)?.filename || modelIdx : modelIdx}]`
      : name;
    storeys[storeyKey] = {
      name: storeyKey,
      elevation_m: elev * unitFactor,
      expressID: ids.get(i),
      modelIdx,
    };
  }
}

function buildSpatialMap(modelID) {
  const map = new Map();
  const parentMap = new Map();

  try {
    const relIds = ifcAPI.GetLineIDsWithType(
      modelID, IFCTYPES.IFCRELCONTAINEDINSPATIALSTRUCTURE
    );
    for (let i = 0; i < relIds.size(); i++) {
      const rel = ifcAPI.GetLine(modelID, relIds.get(i));
      let storeyName = null;
      try {
        const container = ifcAPI.GetLine(modelID, rel.RelatingStructure.value);
        if (container.type === IFCTYPES.IFCBUILDINGSTOREY) {
          storeyName = container.Name?.value || 'Unknown';
        }
      } catch {}
      if (storeyName && rel.RelatedElements) {
        for (const elemRef of rel.RelatedElements) {
          map.set(elemRef.value, storeyName);
        }
      }
    }

    const aggIds = ifcAPI.GetLineIDsWithType(modelID, IFCTYPES.IFCRELAGGREGATES);
    for (let i = 0; i < aggIds.size(); i++) {
      const rel = ifcAPI.GetLine(modelID, aggIds.get(i));
      try {
        const parentId = rel.RelatingObject.value;
        const parent = ifcAPI.GetLine(modelID, parentId);
        if (parent.type === IFCTYPES.IFCBUILDINGSTOREY) {
          const pName = parent.Name?.value || 'Unknown';
          if (rel.RelatedObjects) {
            for (const childRef of rel.RelatedObjects) {
              map.set(childRef.value, pName);
            }
          }
        } else if (rel.RelatedObjects) {
          for (const childRef of rel.RelatedObjects) {
            parentMap.set(childRef.value, parentId);
          }
        }
      } catch {}
    }

    for (const [childId, parentId] of parentMap) {
      if (!map.has(childId)) {
        let current = parentId;
        let depth = 0;
        while (current && depth < 10) {
          if (map.has(current)) {
            map.set(childId, map.get(current));
            break;
          }
          current = parentMap.get(current);
          depth++;
        }
      }
    }
  } catch (e) { console.warn('[viewer] Spatial map error:', e); }

  console.log(`[viewer] Spatial map: ${map.size} elements mapped to storeys`);
  return map;
}

// ======================== GEOMETRY ========================
async function loadGeometry(modelID, modelIdx) {
  const modelGroup = new THREE.Group();
  modelGroup.name = `IFC Model ${modelIdx}`;
  modelGroup.userData.modelIdx = modelIdx;

  let count = 0;
  let skipped = 0;

  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    const expressID = mesh.expressID;

    let line;
    try { line = ifcAPI.GetLine(modelID, expressID, true); } catch { return; }

    let typeName = TYPE_ID_TO_NAME[line.type] || null;
    if (!typeName) {
      try {
        const typeStr = ifcAPI.GetNameFromTypeCode?.(line.type) || '';
        typeName = typeStr.toUpperCase();
      } catch {}
    }
    if (!typeName) typeName = 'UNKNOWN';
    if (SKIP_TYPES.has(typeName)) { skipped++; return; }

    const geometries = mesh.geometries;
    if (!geometries || geometries.size() === 0) return;

    const mergedPositions = [];
    const mergedNormals = [];
    const mergedIndices = [];
    let vertexOffset = 0;

    for (let g = 0; g < geometries.size(); g++) {
      const placed = geometries.get(g);
      let geomData;
      try { geomData = ifcAPI.GetGeometry(modelID, placed.geometryExpressID); } catch { continue; }

      const vData = ifcAPI.GetVertexArray(
        geomData.GetVertexData(), geomData.GetVertexDataSize()
      );
      const iData = ifcAPI.GetIndexArray(
        geomData.GetIndexData(), geomData.GetIndexDataSize()
      );

      if (!vData || vData.length === 0 || !iData || iData.length === 0) {
        geomData.delete();
        continue;
      }

      const numVerts = vData.length / 6;
      const matrix = new THREE.Matrix4();
      matrix.fromArray(placed.flatTransformation);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

      for (let v = 0; v < numVerts; v++) {
        const px = vData[v * 6], py = vData[v * 6 + 1], pz = vData[v * 6 + 2];
        const nx = vData[v * 6 + 3], ny = vData[v * 6 + 4], nz = vData[v * 6 + 5];

        const pos = new THREE.Vector3(px, py, pz).applyMatrix4(matrix);
        const norm = new THREE.Vector3(nx, ny, nz).applyMatrix3(normalMatrix).normalize();

        mergedPositions.push(pos.x, pos.y, pos.z);
        mergedNormals.push(norm.x, norm.y, norm.z);
      }

      for (let idx = 0; idx < iData.length; idx++) {
        mergedIndices.push(iData[idx] + vertexOffset);
      }

      vertexOffset += numVerts;
      geomData.delete();
    }

    if (mergedPositions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
    geometry.setIndex(mergedIndices);

    const color = TYPE_COLORS[typeName] || 0x99aacc;
    const material = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      shininess: 40,
      flatShading: false,
    });

    const meshObj = new THREE.Mesh(geometry, material);
    const compositeKey = makeKey(modelIdx, expressID);
    meshObj.userData.expressID = expressID;
    meshObj.userData.ifcType = typeName;
    meshObj.userData.modelIdx = modelIdx;
    meshObj.userData.compositeKey = compositeKey;
    modelGroup.add(meshObj);
    elementMeshMap.set(compositeKey, meshObj);

    count++;
  });

  console.log(`[viewer] Model ${modelIdx}: ${count} meshes (skipped ${skipped} non-geometric)`);
  return { modelGroup, elementCount: count };
}

// ======================== PROPERTIES ========================
function extractProperties(modelID, modelIdx, spatialMap) {
  const propRels = new Map();
  try {
    const relIds = ifcAPI.GetLineIDsWithType(modelID, IFCTYPES.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < relIds.size(); i++) {
      const rel = ifcAPI.GetLine(modelID, relIds.get(i));
      const psetRef = rel.RelatingPropertyDefinition?.value;
      if (!psetRef || !rel.RelatedObjects) continue;
      for (const objRef of rel.RelatedObjects) {
        if (!propRels.has(objRef.value)) propRels.set(objRef.value, []);
        propRels.get(objRef.value).push(psetRef);
      }
    }
  } catch (e) { console.warn('[viewer] PropRel error:', e); }

  const prefix = `${modelIdx}:`;
  for (const [key, mesh] of elementMeshMap) {
    if (!key.startsWith(prefix)) continue;

    const expressID = mesh.userData.expressID;
    let line;
    try { line = ifcAPI.GetLine(modelID, expressID, true); } catch { continue; }

    const ifcType = mesh.userData.ifcType;
    const name = line.Name?.value || 'Unnamed';
    const storey = spatialMap.get(expressID) || 'Unassigned';

    const props = {};
    const psetIds = propRels.get(expressID) || [];
    for (const psetId of psetIds) {
      try {
        const pset = ifcAPI.GetLine(modelID, psetId, true);
        const psetName = pset.Name?.value || 'Properties';

        if (pset.HasProperties) {
          for (const propRef of pset.HasProperties) {
            try {
              const prop = (typeof propRef === 'object' && propRef.value)
                ? ifcAPI.GetLine(modelID, propRef.value) : propRef;
              if (prop.Name && prop.NominalValue) {
                props[`${psetName}.${prop.Name.value}`] = prop.NominalValue.value;
              }
            } catch {}
          }
        }
        if (pset.Quantities) {
          for (const qRef of pset.Quantities) {
            try {
              const q = (typeof qRef === 'object' && qRef.value)
                ? ifcAPI.GetLine(modelID, qRef.value) : qRef;
              const qName = q.Name?.value || '';
              const qPrefix = `${psetName}.${qName}`;
              if (q.LengthValue !== undefined) props[qPrefix] = q.LengthValue.value;
              else if (q.AreaValue !== undefined) props[qPrefix] = q.AreaValue.value;
              else if (q.VolumeValue !== undefined) props[qPrefix] = q.VolumeValue.value;
              else if (q.WeightValue !== undefined) props[qPrefix] = q.WeightValue.value;
              else if (q.CountValue !== undefined) props[qPrefix] = q.CountValue.value;
            } catch {}
          }
        }
      } catch {}
    }

    elementDataMap.set(key, { ifcType, name, storey, props, modelIdx });
  }
}

// ======================== ROTATION ========================
function applyRotationPreset(idx, targetGroup) {
  const p = ROTATION_PRESETS[idx];
  if (targetGroup) {
    targetGroup.rotation.set(p.rx, p.ry, p.rz);
  } else {
    // Apply to all model groups
    for (const m of models) {
      if (m.modelGroup) m.modelGroup.rotation.set(p.rx, p.ry, p.rz);
    }
  }
  updateViewerInfo();
}

function cycleRotation() {
  if (models.length === 0) return;
  rotationPresetIndex = (rotationPresetIndex + 1) % ROTATION_PRESETS.length;
  applyRotationPreset(rotationPresetIndex);
  for (const m of models) {
    if (m.modelGroup) m.modelGroup.updateMatrixWorld(true);
  }
  fitCameraAll();
}

// ======================== CAMERA ========================
function fitCameraAll() {
  if (models.length === 0) return;

  const box = new THREE.Box3();
  for (const m of models) {
    if (m.modelGroup) {
      m.modelGroup.updateMatrixWorld(true);
      box.expandByObject(m.modelGroup);
    }
  }

  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  controls.target.copy(center);

  const dist = maxDim * 1.3;
  camera.position.set(
    center.x + dist * 0.7,
    center.y + dist * 0.5,
    center.z + dist * 0.7,
  );
  camera.near = dist * 0.01;
  camera.far = dist * 10;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
}

// ======================== SELECTION (multi-select aware) ========================

/** Raycast helper — returns the compositeKey of the first hit mesh, or null. */
function raycastElement(event) {
  if (models.length === 0) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const meshes = [];
  for (const m of models) {
    if (m.modelGroup) m.modelGroup.traverse(c => { if (c.isMesh) meshes.push(c); });
  }
  const hits = raycaster.intersectObjects(meshes);
  return hits.length > 0 ? hits[0].object.userData.compositeKey : null;
}

function onCanvasClick(event) {
  remove3DContextMenu(); // always dismiss context menu on left click
  const key = raycastElement(event);
  const additive = event.ctrlKey || event.metaKey;

  if (key) {
    if (additive) {
      // Toggle this element in/out of current selection
      if (selectedKeys.has(key)) {
        deselectElement(key);
      } else {
        addToSelection(key);
      }
    } else {
      // Replace selection with just this element
      selectElement(key);
    }
  } else if (!additive) {
    clearSelection();
  }
}

/** Right-click on canvas → 3D context menu */
function onCanvasRightClick(event) {
  event.preventDefault();
  const key = raycastElement(event);
  if (key) {
    // Make sure the element is selected
    if (!selectedKeys.has(key)) {
      if (!event.ctrlKey && !event.metaKey) {
        selectElement(key);
      } else {
        addToSelection(key);
      }
    }
    show3DContextMenu(key, event.clientX, event.clientY);
  } else {
    remove3DContextMenu();
  }
}

/** Select a single element (clears previous selection). */
function selectElement(compositeKey) {
  clearSelectionHighlights();
  selectedKeys.clear();

  selectedKeys.add(compositeKey);
  selectedKey = compositeKey;
  highlightSelectedMeshes();

  const data = elementDataMap.get(compositeKey);
  if (data) {
    showSelectionInfo(data);
    showPropertyDetail(data);
    highlightElementInList(compositeKey);
  }
}

/** Add an element to the current multi-selection (Ctrl/Cmd+click). */
function addToSelection(compositeKey) {
  selectedKeys.add(compositeKey);
  selectedKey = compositeKey; // keep last-selected for compat
  highlightSelectedMeshes();

  if (selectedKeys.size === 1) {
    const data = elementDataMap.get(compositeKey);
    if (data) {
      showSelectionInfo(data);
      showPropertyDetail(data);
    }
  } else {
    showMultiSelectionInfo();
  }
  highlightElementInList(compositeKey);
}

/** Remove a single element from multi-selection. */
function deselectElement(compositeKey) {
  selectedKeys.delete(compositeKey);
  if (selectedKeys.size === 0) {
    clearSelection();
    return;
  }
  selectedKey = [...selectedKeys][selectedKeys.size - 1]; // update to last remaining
  highlightSelectedMeshes();

  if (selectedKeys.size === 1) {
    const data = elementDataMap.get(selectedKey);
    if (data) showSelectionInfo(data);
  } else {
    showMultiSelectionInfo();
  }
}

/** Parse Revit Family/Type from element data.
 *  Revit IFC exports use "Family:Type" in the Name field, and may also
 *  store these in property sets like "Other.Family and Type", "Other.Type", etc.
 *  Returns { category, family, type, familyAndType }
 */
function parseRevitClassification(data) {
  const category = data.ifcType; // IFC entity = Revit Category

  // Try property sets first (most reliable)
  let family = null;
  let type = null;
  let familyAndType = null;

  if (data.props) {
    // Revit exports these in various property set formats
    for (const [pKey, pVal] of Object.entries(data.props)) {
      const keyLower = pKey.toLowerCase();
      // "Other.Family and Type" or "Pset_Revit...Family and Type"
      if (keyLower.endsWith('.family and type') || keyLower.endsWith('.familyandtype')) {
        familyAndType = String(pVal);
      }
      // "Other.Family" or "Pset_Revit...Family" (but NOT "Family and Type")
      else if ((keyLower.endsWith('.family') || keyLower.endsWith('.type family'))
               && !keyLower.includes('and type')) {
        family = String(pVal);
      }
      // "Other.Type" — careful not to grab "Family and Type"
      else if (keyLower.endsWith('.type') && !keyLower.includes('family')
               && !keyLower.includes('mark')) {
        type = String(pVal);
      }
    }
  }

  // Fallback: parse from element Name (Revit uses "Family:Type" pattern)
  if (!family && !type && data.name) {
    const colonIdx = data.name.indexOf(':');
    if (colonIdx > 0) {
      family = data.name.substring(0, colonIdx).trim();
      type = data.name.substring(colonIdx + 1).trim();
      if (!familyAndType) familyAndType = data.name.trim();
    } else {
      // No colon — treat the whole name as the family (some elements don't have types)
      family = data.name.trim();
    }
  }

  // If we got familyAndType from props but not family/type individually, parse it
  if (familyAndType && (!family || !type)) {
    const colonIdx = familyAndType.indexOf(':');
    if (colonIdx > 0) {
      if (!family) family = familyAndType.substring(0, colonIdx).trim();
      if (!type) type = familyAndType.substring(colonIdx + 1).trim();
    }
  }

  // Build familyAndType from parts if we have both but not the combined string
  if (!familyAndType && family && type) {
    familyAndType = `${family}:${type}`;
  }

  return {
    category: category || 'Unknown',
    family: family || data.name || 'Unknown',
    type: type || null,
    familyAndType: familyAndType || data.name || 'Unknown',
  };
}

/** Select all elements with the same Name as the given element. */
function selectBySameName(compositeKey) {
  const data = elementDataMap.get(compositeKey);
  if (!data) return;
  const targetName = data.name;

  clearSelectionHighlights();
  selectedKeys.clear();

  for (const [key, d] of elementDataMap) {
    if (d.name === targetName) {
      selectedKeys.add(key);
    }
  }
  selectedKey = compositeKey;
  highlightSelectedMeshes();
  showMultiSelectionInfo();
}

/** Select all elements with the same IFC type / Revit Category. */
function selectByCategory(compositeKey) {
  const data = elementDataMap.get(compositeKey);
  if (!data) return;
  const targetType = data.ifcType;

  clearSelectionHighlights();
  selectedKeys.clear();

  for (const [key, d] of elementDataMap) {
    if (d.ifcType === targetType) {
      selectedKeys.add(key);
    }
  }
  selectedKey = compositeKey;
  highlightSelectedMeshes();
  showMultiSelectionInfo();
}

/** Select all elements with the same Revit Family (ignoring specific type variant). */
function selectByFamily(compositeKey) {
  const data = elementDataMap.get(compositeKey);
  if (!data) return;
  const parsed = parseRevitClassification(data);

  clearSelectionHighlights();
  selectedKeys.clear();

  for (const [key, d] of elementDataMap) {
    const p = parseRevitClassification(d);
    if (p.family === parsed.family) {
      selectedKeys.add(key);
    }
  }
  selectedKey = compositeKey;
  highlightSelectedMeshes();
  showMultiSelectionInfo();
}

/** Select all elements with the same Revit Family AND Type. */
function selectByFamilyAndType(compositeKey) {
  const data = elementDataMap.get(compositeKey);
  if (!data) return;
  const parsed = parseRevitClassification(data);

  clearSelectionHighlights();
  selectedKeys.clear();

  for (const [key, d] of elementDataMap) {
    const p = parseRevitClassification(d);
    if (p.familyAndType === parsed.familyAndType) {
      selectedKeys.add(key);
    }
  }
  selectedKey = compositeKey;
  highlightSelectedMeshes();
  showMultiSelectionInfo();
}

/** Select all elements with the same Revit Type (specific variant, ignoring family). */
function selectByType(compositeKey) {
  const data = elementDataMap.get(compositeKey);
  if (!data) return;
  const parsed = parseRevitClassification(data);

  // If no separate type found, fall back to familyAndType
  const targetType = parsed.type || parsed.familyAndType;

  clearSelectionHighlights();
  selectedKeys.clear();

  for (const [key, d] of elementDataMap) {
    const p = parseRevitClassification(d);
    const t = p.type || p.familyAndType;
    if (t === targetType) {
      selectedKeys.add(key);
    }
  }
  selectedKey = compositeKey;
  highlightSelectedMeshes();
  showMultiSelectionInfo();
}

/** @deprecated Use selectByCategory instead */
function selectBySameType(compositeKey) {
  selectByCategory(compositeKey);
}

/** Apply highlight color to all selected meshes and dim the rest. */
function highlightSelectedMeshes() {
  for (const [key, m] of elementMeshMap) {
    if (selectedKeys.has(key)) {
      if (m.userData.origColor === undefined) {
        m.userData.origColor = m.material.color.getHex();
        m.userData.origOpacity = m.material.opacity;
      }
      m.material.color.setHex(0x4d8ef7);
      m.material.opacity = 1.0;
      m.material.emissive.setHex(0x1a3a7a);
      m.userData.dimmed = false;
    } else {
      if (!m.userData.dimmed) {
        m.userData.origOpacity2 = m.material.opacity;
      }
      m.material.opacity = 0.15;
      m.userData.dimmed = true;
    }
  }
}

/** Restore original materials on all meshes, respecting hidden elements. */
function clearSelectionHighlights() {
  for (const [key, m] of elementMeshMap) {
    const isHidden = hiddenKeys.has(key);
    if (m.userData.origColor !== undefined) {
      m.material.color.setHex(m.userData.origColor);
      m.material.opacity = isHidden ? 0 : m.userData.origOpacity;
      m.material.emissive.setHex(0x000000);
      delete m.userData.origColor;
      delete m.userData.origOpacity;
    }
    if (m.userData.dimmed) {
      m.material.opacity = isHidden ? 0 : (m.userData.origOpacity2 || 0.88);
      m.userData.dimmed = false;
      delete m.userData.origOpacity2;
    }
  }
}

function clearSelection(keepDim) {
  clearSelectionHighlights();
  selectedKeys.clear();
  selectedKey = null;
  document.getElementById('selectionInfo').classList.remove('visible');
  remove3DContextMenu();
}

// Track manually hidden elements so Show All can restore them
let hiddenKeys = new Set();

/** Isolate selection — show only selected elements, hide everything else. */
function isolateSelection() {
  if (selectedKeys.size === 0) return;

  // Restore selection highlight colors first
  clearSelectionHighlights();

  for (const [key, mesh] of elementMeshMap) {
    if (selectedKeys.has(key)) {
      // Restore original appearance for selected items
      mesh.visible = true;
      mesh.material.opacity = 0.88;
    } else {
      mesh.visible = false;
      hiddenKeys.add(key);
    }
  }

  // Clear the active selection state (elements stay visible, no highlight)
  selectedKeys.clear();
  selectedKey = null;
  document.getElementById('selectionInfo').classList.remove('visible');
  updateVisibilityButtons();
}

/** Hide selection — hide selected elements, keep everything else. */
function hideSelection() {
  if (selectedKeys.size === 0) return;

  // Restore selection highlight colors first
  clearSelectionHighlights();

  for (const key of selectedKeys) {
    const mesh = elementMeshMap.get(key);
    if (mesh) {
      mesh.visible = false;
      hiddenKeys.add(key);
    }
  }

  // Restore dimmed elements back to normal opacity
  for (const [key, mesh] of elementMeshMap) {
    if (mesh.visible && mesh.userData.dimmed) {
      mesh.material.opacity = mesh.userData.origOpacity2 || 0.88;
      mesh.userData.dimmed = false;
      delete mesh.userData.origOpacity2;
    }
  }

  selectedKeys.clear();
  selectedKey = null;
  document.getElementById('selectionInfo').classList.remove('visible');
  updateVisibilityButtons();
}

/** Show all elements — restore everything to visible. */
function showAll() {
  // Restore any selection highlights
  clearSelectionHighlights();

  for (const [, mesh] of elementMeshMap) {
    mesh.visible = true;
    mesh.material.opacity = 0.88;
    mesh.material.depthWrite = true;
    // Clean up any lingering UniFormat selection state
    if (mesh.userData._ufOrigColor !== undefined) {
      mesh.material.color.setHex(mesh.userData._ufOrigColor);
      mesh.material.emissive.setHex(mesh.userData._ufOrigEmissive || 0x000000);
      delete mesh.userData._ufOrigColor;
      delete mesh.userData._ufOrigEmissive;
      delete mesh.userData._ufOrigOpacity;
    }
    if (mesh.userData._ufOrigOpacity2 !== undefined) {
      delete mesh.userData._ufOrigOpacity2;
    }
    mesh.userData._ufSelected = false;
  }

  hiddenKeys.clear();
  selectedKeys.clear();
  selectedKey = null;
  document.getElementById('selectionInfo').classList.remove('visible');
  updateVisibilityButtons();
}

/** Update button active state to indicate hidden elements exist. */
function updateVisibilityButtons() {
  const showAllBtn = document.getElementById('btnShowAll');
  if (showAllBtn) {
    if (hiddenKeys.size > 0) {
      showAllBtn.classList.add('active');
      showAllBtn.title = `Show all elements (${hiddenKeys.size} hidden) (A)`;
    } else {
      showAllBtn.classList.remove('active');
      showAllBtn.title = 'Show all elements (A)';
    }
  }
}

function showSelectionInfo(data) {
  const modelEntry = models.find(m => m.idx === data.modelIdx);
  const modelLabel = modelEntry ? modelEntry.filename : '';
  document.getElementById('selName').textContent = data.name;
  document.getElementById('selMeta').textContent =
    `${fmtType(data.ifcType)} · ${data.storey}${models.length > 1 ? ` · ${modelLabel}` : ''}`;
  document.getElementById('selectionInfo').classList.add('visible');
}

function showMultiSelectionInfo() {
  const count = selectedKeys.size;
  // Summarize types in selection
  const types = {};
  for (const key of selectedKeys) {
    const d = elementDataMap.get(key);
    if (d) types[d.ifcType] = (types[d.ifcType] || 0) + 1;
  }
  const typeSummary = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${n} ${fmtType(t)}`)
    .join(', ');

  document.getElementById('selName').textContent = `${count} elements selected`;
  document.getElementById('selMeta').textContent = typeSummary + (Object.keys(types).length > 3 ? ', ...' : '');
  document.getElementById('selectionInfo').classList.add('visible');
}

// ======================== 3D CONTEXT MENU ========================
let ctx3DMenu = null;

function show3DContextMenu(compositeKey, x, y) {
  remove3DContextMenu();

  const data = elementDataMap.get(compositeKey);
  if (!data) return;

  const menu = document.createElement('div');
  menu.className = 'ctx3d-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const multiCount = selectedKeys.size;
  const headerText = multiCount > 1 ? `${multiCount} elements selected` : data.name;
  const metaText = multiCount > 1
    ? 'Apply to all selected elements'
    : `${fmtType(data.ifcType)} · ${data.storey}`;

  // Parse Revit classification for display
  const parsed = parseRevitClassification(data);

  let html = `<div class="ctx3d-header">${headerText}</div>`;
  html += `<div class="ctx3d-meta">${metaText}</div>`;
  html += `<div class="ctx3d-divider"></div>`;

  // Select-by options — Revit-style hierarchy
  html += `<div class="ctx3d-section-label">Select All By</div>`;
  html += `<div class="ctx3d-item" data-action="by-category">`;
  html += `<span class="ctx3d-icon">◫</span> Category <span class="ctx3d-hint">${fmtType(parsed.category)}</span></div>`;
  html += `<div class="ctx3d-item" data-action="by-family">`;
  html += `<span class="ctx3d-icon">≡</span> Family <span class="ctx3d-hint">${truncate(parsed.family, 24)}</span></div>`;
  html += `<div class="ctx3d-item" data-action="by-family-type">`;
  html += `<span class="ctx3d-icon">⊞</span> Family &amp; Type <span class="ctx3d-hint">${truncate(parsed.familyAndType, 24)}</span></div>`;
  if (parsed.type) {
    html += `<div class="ctx3d-item" data-action="by-type">`;
    html += `<span class="ctx3d-icon">▪</span> Type <span class="ctx3d-hint">${truncate(parsed.type, 24)}</span></div>`;
  }
  html += `<div class="ctx3d-divider"></div>`;

  // UniFormat assignment
  html += `<div class="ctx3d-label">Assign UniFormat</div>`;
  html += `<select class="ctx3d-select" id="ctx3dUfSelect">`;
  html += `<option value="">— Select code —</option>`;

  // Import the hierarchy from window (set by uniformat.js)
  const hierarchy = window.__ufHierarchy;
  if (hierarchy) {
    for (const [l1Code, l1] of Object.entries(hierarchy)) {
      html += `<optgroup label="${l1Code} - ${l1.label}">`;
      for (const [l2Code, l2] of Object.entries(l1.children)) {
        for (const [l3Code, l3] of Object.entries(l2.children)) {
          html += `<option value="${l3Code}">${l3Code} — ${l3.label}</option>`;
        }
      }
      html += `</optgroup>`;
    }
  }
  html += `</select>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);
  ctx3DMenu = menu;

  // Keep in viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  });

  // Wire select-by actions
  menu.querySelector('[data-action="by-category"]').addEventListener('click', () => {
    selectByCategory(compositeKey);
    remove3DContextMenu();
  });

  menu.querySelector('[data-action="by-family"]').addEventListener('click', () => {
    selectByFamily(compositeKey);
    remove3DContextMenu();
  });

  menu.querySelector('[data-action="by-family-type"]').addEventListener('click', () => {
    selectByFamilyAndType(compositeKey);
    remove3DContextMenu();
  });

  const typeItem = menu.querySelector('[data-action="by-type"]');
  if (typeItem) {
    typeItem.addEventListener('click', () => {
      selectByType(compositeKey);
      remove3DContextMenu();
    });
  }

  menu.querySelector('#ctx3dUfSelect').addEventListener('change', (e) => {
    const code = e.target.value;
    if (code && window.__ufSetClassification) {
      // Apply to all selected elements
      for (const key of selectedKeys) {
        window.__ufSetClassification(key, code);
      }
      // Refresh the UniFormat tree
      if (window.__ufRefreshTree) window.__ufRefreshTree();
      remove3DContextMenu();
    }
  });

  // Close on outside click (delayed to avoid immediate close)
  setTimeout(() => {
    document.addEventListener('click', onCtx3DClickOutside);
    document.addEventListener('contextmenu', onCtx3DClickOutside);
  }, 10);
}

function onCtx3DClickOutside(e) {
  if (ctx3DMenu && !ctx3DMenu.contains(e.target)) {
    remove3DContextMenu();
  }
}

function remove3DContextMenu() {
  if (ctx3DMenu) {
    ctx3DMenu.remove();
    ctx3DMenu = null;
  }
  document.removeEventListener('click', onCtx3DClickOutside);
  document.removeEventListener('contextmenu', onCtx3DClickOutside);
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
}

// ======================== 3D FILTER / ISOLATE ========================
function isolateByFilter(storeyFilter, typeFilter) {
  clearSelection();
  for (const [key, mesh] of elementMeshMap) {
    const data = elementDataMap.get(key);
    if (!data) continue;
    const matchStorey = storeyFilter === 'all' || data.storey === storeyFilter;
    const matchType = typeFilter === 'all' || data.ifcType === typeFilter;
    if (matchStorey && matchType) {
      mesh.material.opacity = 0.88;
      mesh.visible = true;
    } else {
      mesh.material.opacity = 0.06;
    }
  }
}

function resetVisibility() {
  clearSelection();
  for (const [, m] of elementMeshMap) {
    m.material.opacity = xrayMode ? 0.2 : 0.88;
    m.visible = true;
    m.material.depthWrite = !xrayMode;
  }
}

// ======================== VIEW TOOLS ========================
function toggleWireframe() {
  wireframeMode = !wireframeMode;
  for (const [, m] of elementMeshMap) m.material.wireframe = wireframeMode;
  document.getElementById('btnWireframe').classList.toggle('active', wireframeMode);
}

function toggleXray() {
  xrayMode = !xrayMode;
  for (const [, m] of elementMeshMap) {
    m.material.opacity = xrayMode ? 0.2 : 0.88;
    m.material.depthWrite = !xrayMode;
  }
  document.getElementById('btnXray').classList.toggle('active', xrayMode);
}

// ======================== UI UPDATES ========================
function updateUI() {
  const elCount = elementDataMap.size;
  const levelCount = Object.keys(storeys).length;
  const modelCount = models.length;
  document.getElementById('modelSubtitle').textContent =
    `${modelCount} model${modelCount !== 1 ? 's' : ''} · ${elCount} elements · ${levelCount} levels`;

  document.getElementById('welcomePanel').style.display = 'none';
  document.getElementById('treeContent').classList.remove('hidden');

  populateFilters();
  buildSpatialTree();
  updateElementsList();
  updateViewerInfo();
  updateModelsPanel();
}

function updateViewerInfo() {
  const elCount = elementDataMap.size;
  const modelCount = models.length;
  const preset = ROTATION_PRESETS[rotationPresetIndex];
  if (modelCount === 0) {
    document.getElementById('viewerInfo').textContent = 'No model loaded';
  } else if (modelCount === 1) {
    document.getElementById('viewerInfo').textContent =
      `${models[0].filename} · ${elCount} elements · ${preset.label}`;
  } else {
    document.getElementById('viewerInfo').textContent =
      `${modelCount} models · ${elCount} elements · ${preset.label}`;
  }
}

function populateFilters() {
  const storeySelect = document.getElementById('filterStorey');
  const typeSelect = document.getElementById('filterType');
  if (!storeySelect || !typeSelect) return;

  const sorted = Object.entries(storeys)
    .sort((a, b) => a[1].elevation_m - b[1].elevation_m);

  storeySelect.innerHTML = '<option value="all">All Levels</option>';
  for (const [name, data] of sorted) {
    storeySelect.innerHTML +=
      `<option value="${name}">${name} (${data.elevation_m.toFixed(1)} m)</option>`;
  }

  const types = [...new Set([...elementDataMap.values()].map(d => d.ifcType))].sort();
  typeSelect.innerHTML = '<option value="all">All Types</option>';
  for (const t of types) {
    typeSelect.innerHTML += `<option value="${t}">${fmtType(t)}</option>`;
  }
}

// ======================== MODELS PANEL ========================
function updateModelsPanel() {
  const container = document.getElementById('modelsList');
  const empty = document.getElementById('modelsEmpty');
  if (!container) return;

  if (models.length === 0) {
    empty.style.display = '';
    container.querySelectorAll('.model-card').forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';
  let html = '';
  for (const m of models) {
    html += `<div class="model-card" data-model-idx="${m.idx}">`;
    html += `<div class="model-card-info">`;
    html += `<div class="model-card-name">${m.filename}</div>`;
    html += `<div class="model-card-meta">${m.elementCount} elements · unit factor: ${m.unitFactor}</div>`;
    html += `</div>`;
    html += `<div class="model-card-actions">`;
    html += `<button class="btn-toggle-vis" data-model-idx="${m.idx}" title="Toggle visibility">👁</button>`;
    html += `<button class="btn-remove-model" data-model-idx="${m.idx}" title="Remove model">✕</button>`;
    html += `</div>`;
    html += `</div>`;
  }
  // Keep the empty div, clear the cards
  container.querySelectorAll('.model-card').forEach(el => el.remove());
  container.insertAdjacentHTML('beforeend', html);

  // Wire remove buttons
  container.querySelectorAll('.btn-remove-model').forEach(btn => {
    btn.addEventListener('click', () => {
      removeModel(parseInt(btn.dataset.modelIdx));
    });
  });

  // Wire visibility toggle
  container.querySelectorAll('.btn-toggle-vis').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.modelIdx);
      const m = models.find(m => m.idx === idx);
      if (m && m.modelGroup) {
        m.modelGroup.visible = !m.modelGroup.visible;
        btn.classList.toggle('dimmed', !m.modelGroup.visible);
      }
    });
  });
}

// ======================== SPATIAL TREE ========================
function buildSpatialTree() {
  const container = document.getElementById('spatialTree');
  if (!container) return;

  const grouped = {};
  for (const [key, data] of elementDataMap) {
    const s = data.storey;
    const t = data.ifcType;
    if (!grouped[s]) grouped[s] = {};
    if (!grouped[s][t]) grouped[s][t] = [];
    grouped[s][t].push({ key, ...data });
  }

  const order = Object.entries(storeys)
    .sort((a, b) => a[1].elevation_m - b[1].elevation_m)
    .map(([n]) => n);
  if (grouped['Unassigned']) order.push('Unassigned');

  let html = '';
  for (const storey of order) {
    if (!grouped[storey]) continue;
    const types = Object.keys(grouped[storey]).sort();
    const totalInStorey = types.reduce((sum, t) => sum + grouped[storey][t].length, 0);

    html += `<div class="tree-node">`;
    html += `<div class="tree-header" data-storey="${storey}">`;
    html += `<span class="tree-toggle">▶</span>`;
    html += `<span class="tree-label">${storey}</span>`;
    html += `<span class="tree-count">${totalInStorey}</span>`;
    html += `</div>`;
    html += `<div class="tree-children" data-storey-children="${storey}">`;

    for (const type of types) {
      const elems = grouped[storey][type];
      html += `<div class="tree-type-header" data-storey="${storey}" data-type="${type}">`;
      html += `<span class="tree-toggle">▶</span>`;
      html += `<span class="type-badge ${typeClass(type)}">${fmtType(type)}</span>`;
      html += `<span class="tree-count">${elems.length}</span>`;
      html += `</div>`;
      html += `<div class="tree-children" data-type-children="${storey}-${type}">`;
      for (const elem of elems) {
        html += `<div class="tree-element" data-key="${elem.key}">${elem.name}</div>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.tree-header').forEach(header => {
    header.addEventListener('click', () => {
      const storey = header.dataset.storey;
      const children = container.querySelector(`[data-storey-children="${storey}"]`);
      const toggle = header.querySelector('.tree-toggle');
      children.classList.toggle('open');
      toggle.classList.toggle('open');
    });
  });

  container.querySelectorAll('.tree-type-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = `${header.dataset.storey}-${header.dataset.type}`;
      const children = container.querySelector(`[data-type-children="${key}"]`);
      const toggle = header.querySelector('.tree-toggle');
      children.classList.toggle('open');
      toggle.classList.toggle('open');
    });

    header.addEventListener('dblclick', () => {
      isolateByFilter(header.dataset.storey, header.dataset.type);
    });
  });

  container.querySelectorAll('.tree-element').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectElement(el.dataset.key);
    });
  });
}

// ======================== ELEMENTS LIST ========================
function updateElementsList(search = '') {
  const container = document.getElementById('elementsList');
  if (!container) return;

  let items = [...elementDataMap.entries()];
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(([, d]) =>
      d.name.toLowerCase().includes(s) ||
      d.ifcType.toLowerCase().includes(s) ||
      d.storey.toLowerCase().includes(s)
    );
  }

  const display = items.slice(0, 200);
  let html = '';
  for (const [key, d] of display) {
    html += `<div class="element-item" data-key="${key}">`;
    html += `<div class="name"><span class="type-badge ${typeClass(d.ifcType)}" style="margin-right:6px">${fmtType(d.ifcType)}</span>${d.name}</div>`;
    html += `<div class="meta">${d.storey}</div>`;
    html += `</div>`;
  }

  if (items.length > 200) {
    html += `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px">Showing 200 of ${items.length} — use search to filter.</div>`;
  }

  container.innerHTML = html;
  container.querySelectorAll('.element-item').forEach(el => {
    el.addEventListener('click', () => selectElement(el.dataset.key));
  });
}

function highlightElementInList(compositeKey) {
  document.querySelectorAll('.element-item').forEach(el => {
    el.classList.toggle('selected', selectedKeys.has(el.dataset.key));
  });
  document.querySelectorAll('.tree-element').forEach(el => {
    el.classList.toggle('selected', selectedKeys.has(el.dataset.key));
  });
  // Also highlight in UniFormat tree
  document.querySelectorAll('.uf-element').forEach(el => {
    el.classList.toggle('selected', selectedKeys.has(el.dataset.key));
  });
}

// ======================== PROPERTIES PANEL (FLOATING) ========================
let propsPanelVisible = false;

function showPropsPanel() {
  const panel = document.getElementById('propsPanel');
  if (panel) {
    panel.classList.add('visible');
    propsPanelVisible = true;
    document.getElementById('btnPropsPanel')?.classList.add('active');
  }
}

function hidePropsPanel() {
  const panel = document.getElementById('propsPanel');
  if (panel) {
    panel.classList.remove('visible');
    propsPanelVisible = false;
    document.getElementById('btnPropsPanel')?.classList.remove('active');
  }
}

function togglePropsPanel() {
  if (propsPanelVisible) hidePropsPanel();
  else showPropsPanel();
}

// ======================== PROPERTIES DETAIL ========================
function showPropertyDetail(data) {
  const c = document.getElementById('detailContent');
  const placeholder = document.getElementById('detailPlaceholder');
  if (!c) return;

  const modelEntry = models.find(m => m.idx === data.modelIdx);
  const modelLabel = modelEntry ? modelEntry.filename : '';

  let html = `<div class="detail-section">`;
  html += `<h3>${data.name}</h3>`;
  html += `<div class="detail-meta">${fmtType(data.ifcType)} · ${data.storey}`;
  if (models.length > 1) html += ` · <em>${modelLabel}</em>`;
  html += `</div>`;

  const propEntries = Object.entries(data.props);
  if (propEntries.length > 0) {
    const groups = {};
    for (const [key, val] of propEntries) {
      const dot = key.indexOf('.');
      const group = dot > 0 ? key.substring(0, dot) : 'General';
      const prop = dot > 0 ? key.substring(dot + 1) : key;
      if (!groups[group]) groups[group] = [];
      groups[group].push([prop, val]);
    }

    for (const [groupName, props] of Object.entries(groups)) {
      html += `<h4>${groupName}</h4>`;
      html += `<table class="props-table">`;
      for (const [k, v] of props.slice(0, 30)) {
        html += `<tr><td class="prop-key">${k}</td><td class="prop-val">${v}</td></tr>`;
      }
      if (props.length > 30) {
        html += `<tr><td colspan="2" style="color:var(--text-muted);text-align:center">+${props.length - 30} more properties</td></tr>`;
      }
      html += `</table>`;
    }
  } else {
    html += `<p style="color:var(--text-muted);margin-top:12px">No properties found for this element.</p>`;
  }

  html += `</div>`;
  c.innerHTML = html;
  c.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
}

// ======================== HELPERS ========================
function fmtType(t) {
  return t.replace('IFC', '')
    .replace('STANDARDCASE', '')
    .replace('ELEMENTPROXY', 'Proxy')
    .replace('ELEMENTASSEMBLY', 'Assembly');
}

function typeClass(t) {
  if (t.includes('BEAM') || t.includes('MEMBER')) return 'type-beam';
  if (t.includes('COLUMN')) return 'type-column';
  if (t.includes('SLAB')) return 'type-slab';
  if (t.includes('WALL')) return 'type-wall';
  if (t.includes('FOOTING') || t.includes('PILE')) return 'type-footing';
  if (t.includes('PROXY')) return 'type-proxy';
  if (t.includes('ASSEMBLY')) return 'type-assembly';
  if (t.includes('DOOR')) return 'type-door';
  if (t.includes('WINDOW')) return 'type-window';
  if (t.includes('STAIR')) return 'type-stair';
  if (t.includes('RAILING')) return 'type-railing';
  return '';
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${name}`)
  );
}

function showLoading(msg, pct) {
  document.getElementById('loading').classList.add('visible');
  document.getElementById('loadingText').textContent = msg;
  if (pct !== undefined) setProgress(pct);
}
function setProgress(pct) {
  document.getElementById('progressFill').style.width = pct + '%';
}
function hideLoading() {
  document.getElementById('loading').classList.remove('visible');
}

// ======================== FILE HANDLING HELPERS ========================
async function handleFiles(fileList, append = false) {
  const ifcFiles = [...fileList].filter(f => f.name.toLowerCase().endsWith('.ifc'));
  if (ifcFiles.length === 0) return;

  const files = [];
  for (const f of ifcFiles) {
    files.push({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
  }

  await loadIFCFiles(files, append);
}

// ======================== EVENT WIRING ========================
function wireEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  // Filters
  const storeyFilter = document.getElementById('filterStorey');
  const typeFilter = document.getElementById('filterType');
  const applyFilter = () => {
    isolateByFilter(storeyFilter.value, typeFilter.value);
  };
  storeyFilter.addEventListener('change', applyFilter);
  typeFilter.addEventListener('change', applyFilter);

  // Search
  document.getElementById('elementSearch').addEventListener('input', e =>
    updateElementsList(e.target.value)
  );

  // Viewer tools
  document.getElementById('btnResetView').addEventListener('click', () => {
    storeyFilter.value = 'all';
    typeFilter.value = 'all';
    resetVisibility();
    fitCameraAll();
  });
  document.getElementById('btnRotateModel').addEventListener('click', cycleRotation);
  document.getElementById('btnWireframe').addEventListener('click', toggleWireframe);
  document.getElementById('btnXray').addEventListener('click', toggleXray);

  // Properties panel toggle + close
  document.getElementById('btnPropsPanel').addEventListener('click', togglePropsPanel);
  document.getElementById('propsPanelClose').addEventListener('click', hidePropsPanel);

  // Clear selection button
  document.getElementById('btnClearSelection').addEventListener('click', clearSelection);

  // Isolate / Hide / Show All
  document.getElementById('btnIsolateSelection').addEventListener('click', isolateSelection);
  document.getElementById('btnHideSelection').addEventListener('click', hideSelection);
  document.getElementById('btnShowAll').addEventListener('click', showAll);

  // Browse button (initial load — replaces existing models)
  document.getElementById('browseBtn').addEventListener('click', () =>
    document.getElementById('fileInput').click()
  );
  document.getElementById('fileInput').addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    // If coming from append button, append; otherwise replace
    const isAppend = e.target.dataset.appendMode === 'true';
    await handleFiles(e.target.files, isAppend);
    e.target.value = '';
    e.target.dataset.appendMode = '';
  });

  // Append models button
  document.getElementById('btnAppendModels').addEventListener('click', () => {
    const input = document.getElementById('fileInput');
    input.dataset.appendMode = 'true';
    input.click();
  });

  // Clear all button
  document.getElementById('btnClearAll').addEventListener('click', () => {
    clearAllModels();
  });

  // Drag and drop (supports multiple files)
  document.addEventListener('dragover', e => {
    e.preventDefault();
    document.getElementById('dropZone').classList.add('visible');
  });
  document.addEventListener('dragleave', e => {
    if (!document.contains(e.relatedTarget)) {
      document.getElementById('dropZone').classList.remove('visible');
    }
  });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    document.getElementById('dropZone').classList.remove('visible');
    const ifcFiles = [...e.dataTransfer.files].filter(f =>
      f.name.toLowerCase().endsWith('.ifc')
    );
    if (ifcFiles.length > 0) {
      // If models already loaded, append; otherwise replace
      const append = models.length > 0;
      await handleFiles(ifcFiles, append);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSelection();
      hidePropsPanel();
      storeyFilter.value = 'all';
      typeFilter.value = 'all';
      resetVisibility();
    }
    if (e.key === 'f' || e.key === 'F') {
      if (document.activeElement.tagName !== 'INPUT') fitCameraAll();
    }
    if (e.key === 'w' || e.key === 'W') {
      if (document.activeElement.tagName !== 'INPUT') toggleWireframe();
    }
    if (e.key === 'x' || e.key === 'X') {
      if (document.activeElement.tagName !== 'INPUT') toggleXray();
    }
    if (e.key === 'r' || e.key === 'R') {
      if (document.activeElement.tagName !== 'INPUT') cycleRotation();
    }
    if (e.key === 'p' || e.key === 'P') {
      if (document.activeElement.tagName !== 'INPUT') togglePropsPanel();
    }
    if (e.key === 'q' || e.key === 'Q') {
      if (document.activeElement.tagName !== 'INPUT') clearSelection();
    }
    if (e.key === 'i' || e.key === 'I') {
      if (document.activeElement.tagName !== 'INPUT') isolateSelection();
    }
    if (e.key === 'h' || e.key === 'H') {
      if (document.activeElement.tagName !== 'INPUT') hideSelection();
    }
    if (e.key === 'a' || e.key === 'A') {
      if (document.activeElement.tagName !== 'INPUT') showAll();
    }
  });
}

// ======================== VIEWER STATE EXPORT ========================
// Exposes internal state for tool modules (section-cut, sun-study, etc.)
function getViewerState() {
  return {
    scene, camera, renderer, controls,
    models, elementMeshMap, elementDataMap, storeys,
    selectedKey, selectedKeys, hiddenKeys,
  };
}

export { getViewerState };

// Expose functions globally for tool modules (UniFormat, etc.)
window.__ufSelectElement = selectElement;
window.__ufClearSelection = clearSelection;
window.__ufAddToSelection = addToSelection;
window.__ufSelectBySameName = selectBySameName;
window.__ufSelectBySameType = selectBySameType;
window.__ufSelectByCategory = selectByCategory;
window.__ufSelectByFamily = selectByFamily;
window.__ufSelectByFamilyAndType = selectByFamilyAndType;
window.__ufSelectByType = selectByType;

/** Bulk-set selectedKeys from an external source (e.g. UniFormat tree). */
window.__ufSetSelectedKeys = function(keys) {
  selectedKeys.clear();
  for (const k of keys) selectedKeys.add(k);
  selectedKey = keys.size > 0 ? [...keys][0] : null;
  showMultiSelectionInfo();
};

// ======================== INIT ========================
initThreeJS();
wireEvents();
initIfcAPI();
