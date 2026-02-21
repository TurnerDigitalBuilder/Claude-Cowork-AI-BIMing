/* ============================================================
   Sun Study Tool — sun-study.js
   Solar position simulation with real-time shadow casting
   for BIM Model Viewer
   ============================================================ */

import * as THREE from 'three';
import { getViewerState } from './viewer.js';

// ======================== SOLAR POSITION ALGORITHM ========================
// Standard astronomical solar position — no external dependencies
// Reference: NOAA Solar Calculator / Meeus "Astronomical Algorithms"

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

/**
 * Calculate Julian Day Number from a Date + hours
 */
function julianDay(year, month, day, hours) {
  if (month <= 2) { year -= 1; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) +
         Math.floor(30.6001 * (month + 1)) +
         day + hours / 24 + B - 1524.5;
}

/**
 * Calculate solar position (altitude and azimuth) for given location and time.
 * @param {number} lat - Latitude in degrees (+ north)
 * @param {number} lng - Longitude in degrees (+ east)
 * @param {Date} date - Date object
 * @param {number} hours - Decimal hours (e.g., 14.5 = 2:30 PM) in local solar time
 * @returns {{ altitude: number, azimuth: number }} angles in degrees
 */
function getSolarPosition(lat, lng, date, hours) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Julian day at UTC noon
  const JD = julianDay(year, month, day, 12);
  const n = JD - 2451545.0; // days since J2000.0

  // Mean solar longitude and anomaly
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = toRad((357.528 + 0.9856003 * n) % 360);

  // Ecliptic longitude of the sun
  const lambda = toRad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));

  // Obliquity of the ecliptic
  const epsilon = toRad(23.439 - 0.0000004 * n);

  // Solar declination
  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const declination = Math.asin(sinDec);

  // Right ascension (for equation of time)
  const cosRA = Math.cos(lambda) / Math.cos(declination);
  const sinRA = Math.sin(lambda) * Math.cos(epsilon) / Math.cos(declination);
  const RA = Math.atan2(sinRA, cosRA);

  // Equation of time (approximate, in hours)
  const GMST = (6.697375 + 0.0657098242 * n + 12) % 24;
  const eot = (toDeg(RA) / 15 - (L / 15)) ;

  // Hour angle
  // Use local solar time: hours parameter is already "clock time at that longitude"
  // Solar noon offset from UTC = longitude / 15
  const solarNoonUTC = 12 - lng / 15 - eot;
  const hourAngle = toRad((hours - 12) * 15 + lng - (solarNoonUTC - 12 + lng) * 0 );

  // Simplified: hour angle directly from hours
  // Local solar time hour angle = (hours - 12) * 15 degrees
  const H = toRad((hours - 12) * 15);

  const latRad = toRad(lat);

  // Solar altitude (elevation)
  const sinAlt = Math.sin(latRad) * Math.sin(declination) +
                 Math.cos(latRad) * Math.cos(declination) * Math.cos(H);
  const altitude = toDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));

  // Solar azimuth (from north, clockwise)
  const cosAz = (Math.sin(declination) - Math.sin(latRad) * sinAlt) /
                (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
  let azimuth = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));

  // Correct azimuth for afternoon (sin of hour angle > 0 means afternoon)
  if (Math.sin(H) > 0) azimuth = 360 - azimuth;

  return { altitude, azimuth };
}

/**
 * Convert solar azimuth + altitude to a 3D direction vector.
 * Convention: Y-up, azimuth 0 = north (+Z), 90 = east (+X)
 */
function solarToDirection(azimuth, altitude) {
  const azRad = toRad(azimuth);
  const altRad = toRad(altitude);
  const cosAlt = Math.cos(altRad);

  return new THREE.Vector3(
    Math.sin(azRad) * cosAlt,   // X (east)
    Math.sin(altRad),            // Y (up)
    Math.cos(azRad) * cosAlt     // Z (north)
  ).normalize();
}

/**
 * Get sun color based on altitude (warm at horizon, white at zenith)
 */
function getSunColor(altitude) {
  if (altitude <= 0) return new THREE.Color(0x1a1a3a); // night
  if (altitude < 5) return new THREE.Color(0xff6633);   // deep sunrise/sunset
  if (altitude < 15) return new THREE.Color(0xffaa55);  // golden hour
  if (altitude < 30) return new THREE.Color(0xffd499);  // warm morning/evening
  return new THREE.Color(0xfff5e6);                      // daylight
}

/**
 * Get ambient intensity based on altitude
 */
function getAmbientIntensity(altitude) {
  if (altitude <= 0) return 0.08;
  if (altitude < 10) return 0.2 + (altitude / 10) * 0.2;
  return 0.35 + Math.min(altitude / 90, 1) * 0.25;
}

/**
 * Get sun light intensity based on altitude
 */
function getSunIntensity(altitude) {
  if (altitude <= 0) return 0;
  if (altitude < 5) return altitude / 5 * 0.4;
  if (altitude < 15) return 0.4 + ((altitude - 5) / 10) * 0.3;
  return 0.7 + Math.min((altitude - 15) / 60, 1) * 0.5;
}

// ======================== SUN STUDY STATE ========================
const state = {
  active: false,
  latitude: 40.7128,
  longitude: -74.0060,
  date: new Date(),
  totalMinutes: 720, // noon = 12:00
  playing: false,
  speed: 60, // minutes per second
  shadowQuality: 2048,
};

// Three.js objects managed by sun study
let sunLight = null;
let sunTarget = null;
let ambientLight = null;
let groundPlane = null;
let sunIndicator = null;
let skyHemisphere = null;

// Original lighting refs (to restore on deactivate)
let originalLights = [];

// Animation
let animFrameId = null;
let lastAnimTime = 0;

// ======================== LOCATION PRESETS ========================
const LOCATION_PRESETS = [
  { name: 'New York', lat: 40.7128, lng: -74.0060 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Dubai', lat: 25.2048, lng: 55.2708 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
];

// ======================== ACTIVATE / DEACTIVATE ========================

function activate() {
  const { scene, renderer, models } = getViewerState();
  if (state.active || models.length === 0) return;
  state.active = true;

  // Store and remove original lights
  originalLights = [];
  scene.traverse(child => {
    if (child.isLight) originalLights.push(child);
  });
  for (const light of originalLights) scene.remove(light);

  // Enable shadow mapping
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.needsUpdate = true;

  // Create sun study ambient light
  ambientLight = new THREE.AmbientLight(0x8899bb, 0.4);
  scene.add(ambientLight);

  // Create hemisphere light for sky/ground bounce
  skyHemisphere = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.15);
  scene.add(skyHemisphere);

  // Create sun directional light with shadows
  sunLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
  sunLight.castShadow = true;

  // Shadow map quality
  sunLight.shadow.mapSize.width = state.shadowQuality;
  sunLight.shadow.mapSize.height = state.shadowQuality;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;

  sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sunLight.target = sunTarget;
  scene.add(sunLight);

  // Size shadow camera to model bounds
  const box = getModelBounds();
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const halfExtent = maxDim * 0.8;

    sunLight.shadow.camera.left = -halfExtent;
    sunLight.shadow.camera.right = halfExtent;
    sunLight.shadow.camera.top = halfExtent;
    sunLight.shadow.camera.bottom = -halfExtent;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = maxDim * 6;
    sunLight.shadow.camera.updateProjectionMatrix();

    sunTarget.position.copy(center);

    // Create ground plane for shadow reception
    const groundSize = maxDim * 3;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.ShadowMaterial({
      opacity: 0.35,
      color: 0x000000,
    });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(center.x, box.min.y - 0.05, center.z);
    groundPlane.receiveShadow = true;
    groundPlane.name = 'SunStudyGround';
    scene.add(groundPlane);

    // Create sun indicator (small sphere showing sun direction)
    const indicatorGeo = new THREE.SphereGeometry(maxDim * 0.02, 16, 16);
    const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    sunIndicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    scene.add(sunIndicator);
  }

  // Enable castShadow on all model meshes
  const { elementMeshMap } = getViewerState();
  for (const [, mesh] of elementMeshMap) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  // Update sun position
  updateSunPosition();

  // Show UI panel
  showPanel();

  // Update toolbar button
  const btn = document.getElementById('btnSunStudy');
  if (btn) btn.classList.add('active');
}

function deactivate() {
  const { scene, renderer, elementMeshMap } = getViewerState();
  if (!state.active) return;
  state.active = false;
  state.playing = false;

  // Stop animation
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Remove sun study objects
  if (sunLight) { scene.remove(sunLight); sunLight.dispose?.(); sunLight = null; }
  if (sunTarget) { scene.remove(sunTarget); sunTarget = null; }
  if (ambientLight) { scene.remove(ambientLight); ambientLight.dispose?.(); ambientLight = null; }
  if (skyHemisphere) { scene.remove(skyHemisphere); skyHemisphere.dispose?.(); skyHemisphere = null; }
  if (groundPlane) {
    scene.remove(groundPlane);
    groundPlane.geometry.dispose();
    groundPlane.material.dispose();
    groundPlane = null;
  }
  if (sunIndicator) {
    scene.remove(sunIndicator);
    sunIndicator.geometry.dispose();
    sunIndicator.material.dispose();
    sunIndicator = null;
  }

  // Restore original lights
  for (const light of originalLights) scene.add(light);
  originalLights = [];

  // Disable shadow mapping
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.needsUpdate = true;

  // Remove shadow flags from meshes
  for (const [, mesh] of elementMeshMap) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }

  // Hide UI panel
  hidePanel();

  // Update toolbar button
  const btn = document.getElementById('btnSunStudy');
  if (btn) btn.classList.remove('active');
}

function toggle() {
  if (state.active) deactivate();
  else activate();
}

// ======================== UPDATE SUN POSITION ========================

function updateSunPosition() {
  if (!state.active || !sunLight) return;

  const hours = state.totalMinutes / 60;
  const { altitude, azimuth } = getSolarPosition(
    state.latitude, state.longitude, state.date, hours
  );

  // Get model bounds for positioning
  const box = getModelBounds();
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2.5;

  // Position sun light
  const dir = solarToDirection(azimuth, Math.max(altitude, 2));
  sunLight.position.copy(center).addScaledVector(dir, distance);
  sunTarget.position.copy(center);

  // Update light properties based on altitude
  const color = getSunColor(altitude);
  sunLight.color.copy(color);
  sunLight.intensity = getSunIntensity(altitude);

  // Update ambient
  if (ambientLight) {
    ambientLight.intensity = getAmbientIntensity(altitude);
    if (altitude <= 0) {
      ambientLight.color.setHex(0x1a1a3a);
    } else if (altitude < 15) {
      ambientLight.color.setHex(0x667799);
    } else {
      ambientLight.color.setHex(0x8899bb);
    }
  }

  // Update sun indicator position
  if (sunIndicator) {
    const indicatorDir = solarToDirection(azimuth, altitude);
    sunIndicator.position.copy(center).addScaledVector(indicatorDir, distance * 0.7);
    sunIndicator.material.color.copy(color);
    sunIndicator.visible = altitude > 0;
  }

  // Update UI readout
  updateReadout(altitude, azimuth);
}

// ======================== ANIMATION ========================

function startAnimation() {
  state.playing = true;
  lastAnimTime = performance.now();
  animateLoop();
  updatePlayButton();
}

function stopAnimation() {
  state.playing = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  updatePlayButton();
}

function togglePlay() {
  if (state.playing) stopAnimation();
  else startAnimation();
}

function animateLoop() {
  if (!state.playing || !state.active) return;

  const now = performance.now();
  const dt = (now - lastAnimTime) / 1000; // seconds
  lastAnimTime = now;

  // Advance time
  state.totalMinutes += state.speed * dt;
  if (state.totalMinutes >= 1440) state.totalMinutes -= 1440;
  if (state.totalMinutes < 0) state.totalMinutes += 1440;

  updateSunPosition();
  updateTimeSlider();

  animFrameId = requestAnimationFrame(animateLoop);
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

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.floor(totalMinutes % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// ======================== UI PANEL ========================

function createPanel() {
  // Remove existing if any
  const existing = document.getElementById('sunStudyPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'sunStudyPanel';
  panel.className = 'sun-study-panel';

  panel.innerHTML = `
    <div class="ss-header">
      <div class="ss-title">Sun Study</div>
      <button class="ss-close" id="ssClose" title="Close sun study">&times;</button>
    </div>

    <div class="ss-section">
      <label class="ss-label">Location</label>
      <div class="ss-location-row">
        <input type="number" id="ssLat" class="ss-input ss-coord" value="${state.latitude}" step="0.01" placeholder="Lat">
        <input type="number" id="ssLng" class="ss-input ss-coord" value="${state.longitude}" step="0.01" placeholder="Lng">
      </div>
      <div class="ss-presets" id="ssPresets">
        ${LOCATION_PRESETS.map(p =>
          `<button class="ss-preset-btn" data-lat="${p.lat}" data-lng="${p.lng}">${p.name}</button>`
        ).join('')}
      </div>
    </div>

    <div class="ss-section">
      <label class="ss-label">Date</label>
      <input type="date" id="ssDate" class="ss-input" value="${formatDate(state.date)}">
    </div>

    <div class="ss-section">
      <label class="ss-label">
        Time <span class="ss-time-display" id="ssTimeDisplay">${formatTime(state.totalMinutes)}</span>
      </label>
      <input type="range" id="ssTimeSlider" class="ss-slider" min="0" max="1439" step="1" value="${state.totalMinutes}">
      <div class="ss-slider-labels">
        <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
      </div>
    </div>

    <div class="ss-section ss-controls-row">
      <button class="ss-play-btn" id="ssPlayBtn" title="Play/Pause">
        <span id="ssPlayIcon">&#9654;</span>
      </button>
      <select class="ss-input ss-speed-select" id="ssSpeed">
        <option value="10">10 min/s</option>
        <option value="30">30 min/s</option>
        <option value="60" selected>1 hr/s</option>
        <option value="180">3 hr/s</option>
        <option value="360">6 hr/s</option>
      </select>
      <select class="ss-input ss-quality-select" id="ssQuality">
        <option value="1024">Low Shadow</option>
        <option value="2048" selected>Med Shadow</option>
        <option value="4096">High Shadow</option>
      </select>
    </div>

    <div class="ss-readout" id="ssReadout">
      <div class="ss-readout-item">
        <span class="ss-readout-label">Altitude</span>
        <span class="ss-readout-value" id="ssAltitude">--</span>
      </div>
      <div class="ss-readout-item">
        <span class="ss-readout-label">Azimuth</span>
        <span class="ss-readout-value" id="ssAzimuth">--</span>
      </div>
      <div class="ss-readout-item">
        <span class="ss-readout-label">Status</span>
        <span class="ss-readout-value" id="ssStatus">--</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  wirePanel();
}

function wirePanel() {
  // Close button
  document.getElementById('ssClose').addEventListener('click', deactivate);

  // Latitude/Longitude
  document.getElementById('ssLat').addEventListener('change', (e) => {
    state.latitude = parseFloat(e.target.value) || 0;
    updateSunPosition();
  });
  document.getElementById('ssLng').addEventListener('change', (e) => {
    state.longitude = parseFloat(e.target.value) || 0;
    updateSunPosition();
  });

  // Location presets
  document.getElementById('ssPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('.ss-preset-btn');
    if (!btn) return;
    state.latitude = parseFloat(btn.dataset.lat);
    state.longitude = parseFloat(btn.dataset.lng);
    document.getElementById('ssLat').value = state.latitude;
    document.getElementById('ssLng').value = state.longitude;
    // Highlight active preset
    document.querySelectorAll('.ss-preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSunPosition();
  });

  // Date
  document.getElementById('ssDate').addEventListener('change', (e) => {
    const parts = e.target.value.split('-');
    state.date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    updateSunPosition();
  });

  // Time slider
  document.getElementById('ssTimeSlider').addEventListener('input', (e) => {
    state.totalMinutes = parseInt(e.target.value);
    updateSunPosition();
    document.getElementById('ssTimeDisplay').textContent = formatTime(state.totalMinutes);
  });

  // Play/Pause
  document.getElementById('ssPlayBtn').addEventListener('click', togglePlay);

  // Speed
  document.getElementById('ssSpeed').addEventListener('change', (e) => {
    state.speed = parseInt(e.target.value);
  });

  // Shadow quality
  document.getElementById('ssQuality').addEventListener('change', (e) => {
    state.shadowQuality = parseInt(e.target.value);
    if (sunLight) {
      sunLight.shadow.mapSize.width = state.shadowQuality;
      sunLight.shadow.mapSize.height = state.shadowQuality;
      sunLight.shadow.map?.dispose();
      sunLight.shadow.map = null;
      const { renderer } = getViewerState();
      renderer.shadowMap.needsUpdate = true;
    }
  });
}

function showPanel() {
  createPanel();
  // Highlight default preset
  const defaultBtn = document.querySelector(`.ss-preset-btn[data-lat="${state.latitude}"]`);
  if (defaultBtn) defaultBtn.classList.add('active');
}

function hidePanel() {
  const panel = document.getElementById('sunStudyPanel');
  if (panel) panel.remove();
}

function updateReadout(altitude, azimuth) {
  const altEl = document.getElementById('ssAltitude');
  const azEl = document.getElementById('ssAzimuth');
  const statusEl = document.getElementById('ssStatus');
  const timeDisplay = document.getElementById('ssTimeDisplay');

  if (altEl) altEl.textContent = `${altitude.toFixed(1)}\u00B0`;
  if (azEl) azEl.textContent = `${azimuth.toFixed(1)}\u00B0`;

  if (statusEl) {
    if (altitude <= 0) statusEl.textContent = 'Night';
    else if (altitude < 5) statusEl.textContent = 'Twilight';
    else if (altitude < 15) statusEl.textContent = 'Golden Hour';
    else if (altitude < 30) statusEl.textContent = 'Morning/Evening';
    else statusEl.textContent = 'Daylight';

    statusEl.className = 'ss-readout-value' +
      (altitude <= 0 ? ' ss-night' : altitude < 15 ? ' ss-golden' : ' ss-day');
  }

  if (timeDisplay) timeDisplay.textContent = formatTime(state.totalMinutes);
}

function updateTimeSlider() {
  const slider = document.getElementById('ssTimeSlider');
  const display = document.getElementById('ssTimeDisplay');
  if (slider) slider.value = Math.floor(state.totalMinutes);
  if (display) display.textContent = formatTime(state.totalMinutes);
}

function updatePlayButton() {
  const icon = document.getElementById('ssPlayIcon');
  const btn = document.getElementById('ssPlayBtn');
  if (icon) icon.innerHTML = state.playing ? '&#10074;&#10074;' : '&#9654;';
  if (btn) btn.classList.toggle('active', state.playing);
}

// ======================== KEYBOARD SHORTCUT ========================
document.addEventListener('keydown', (e) => {
  if (e.key === 's' || e.key === 'S') {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      toggle();
    }
  }
  if (e.key === ' ' && state.active) {
    if (document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      togglePlay();
    }
  }
});

// ======================== EXPORTS ========================
export { toggle, activate, deactivate, state };
