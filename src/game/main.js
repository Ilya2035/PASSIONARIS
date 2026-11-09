import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './game.css';
import * as THREE from 'three';
import { APP_NAME, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron } from '../shared/settings.js';
import { loadWorld, fillMapMode, MAP_MODES } from './data.js';
import { Globe } from './globe.js';
import { GlobeCamera, vecToGeo } from './camera.js';

const $ = id => document.getElementById(id);
const settings = await loadSettings();
const params = new URLSearchParams(location.search);

document.title = `${APP_NAME} ${VERSION_LABEL}`;
$('load-version').textContent = `${VERSION_LABEL} · ${EPOCH_LABEL}`;
$('tb-version').textContent = VERSION_LABEL;
$('tb-epoch').textContent = EPOCH_LABEL;
$('menu-version').textContent = `${APP_NAME} ${VERSION_LABEL} · ${EPOCH_LABEL}`;

// ------------------------------------------------------------------ renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reverseDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * (settings.pixelRatio || 1)));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const SPACE = new THREE.Color('#04070d');
const SKY = new THREE.Color(0.62, 0.7, 0.78);
scene.background = SPACE.clone();
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.001, 50);

// stars
{
  const n = 5000, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(40); pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfc8d8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false })));
}

// ------------------------------------------------------------------ data
const fill = $('load-fill'), loadText = $('load-text');
const data = await loadWorld(p => { fill.style.width = `${(p * 85).toFixed(1)}%`; });
loadText.textContent = 'Поднимаем горы и наполняем океаны…';
await new Promise(r => setTimeout(r, 30));
const globe = new Globe(scene, renderer, data, settings);
const world = data.world;
fill.style.width = '100%';

const gcam = new GlobeCamera(camera, settings);
if (params.has('lat')) gcam.lookAt(+params.get('lat'), +params.get('lon'), +(params.get('alt') || 0.3));

// ------------------------------------------------------------------ map modes
let mode = 'political';
const modesEl = $('modes');
for (const m of MAP_MODES) {
  const b = document.createElement('button');
  b.className = 'btn'; b.dataset.mode = m.id;
  b.innerHTML = `${m.name}<span class="k">${m.key}</span>`;
  b.onclick = () => setMode(m.id);
  modesEl.appendChild(b);
}
function setMode(id) {
  mode = id;
  fillMapMode(globe.colorTex, world, id);
  globe.overlayBase = id === 'terrain' ? 0 : 1;
  for (const b of modesEl.children) b.classList.toggle('active', b.dataset.mode === id);
}
setMode('political');

// ------------------------------------------------------------------ lookup helpers
const D = world.districts;
function describe(id) {
  if (id === 0) return { kind: 'ocean', title: 'Мировой океан' };
  if (id === 1) return { kind: 'lake', title: 'Озеро' };
  const pv = world.provinces[D.province[id]];
  const c = world.countries[pv?.country ?? 0];
  const name = D.names[id] || `Район №${id - 1}`;
  return { kind: 'district', title: name, province: pv, country: c, area: D.area[id], lat: D.lat[id], lon: D.lon[id] };
}
const fmtKm2 = a => `${Math.round(a).toLocaleString('ru-RU')} км²`;
const fmtLat = v => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'с.ш.' : 'ю.ш.'}`;
const fmtLon = v => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'в.д.' : 'з.д.'}`;

// ------------------------------------------------------------------ input
const ndc = new THREE.Vector2();
const mouse = { x: 0, y: 0, inside: false };
let dragAnchor = null, downAt = null, moved = false;
const keys = new Set();

function toNdc(e, out = ndc) {
  const r = canvas.getBoundingClientRect();
  return out.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.button !== 1) return;
  canvas.setPointerCapture(e.pointerId);
  dragAnchor = gcam.pick(toNdc(e));
  gcam.anchor = null;
  downAt = { x: e.clientX, y: e.clientY }; moved = false;
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
  if (dragAnchor) {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 3) moved = true;
    const cur = gcam.pick(toNdc(e));
    if (cur) { gcam.drag(cur, dragAnchor); gcam.place(gcam.derived); }
  }
});
canvas.addEventListener('pointerup', e => {
  canvas.classList.remove('dragging');
  const wasClick = dragAnchor && !moved && e.button === 0;
  dragAnchor = null;
  if (wasClick) select(hoverId);
});
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); select(0); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 240) * 0.0024);
  const n = toNdc(e, new THREE.Vector2());
  gcam.zoom(f, gcam.pick(n), n);
}, { passive: false });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleMenu(); return; }
  if (menuOpen) return;
  keys.add(e.code);
  const m = MAP_MODES.find(m => m.key === e.key);
  if (m) setMode(m.id);
  if (e.code === 'Home') gcam.altTarget = 2.15;
  if (e.key === '+' || e.key === '=') gcam.zoom(0.7);
  if (e.key === '-') gcam.zoom(1.4);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ------------------------------------------------------------------ selection / info
let hoverId = 0, selectedId = 0;
const info = $('info');
function select(id) {
  selectedId = id >= 2 ? id : 0;
  globe.terrainMat.uniforms.uSelected.value = selectedId;
  if (!selectedId) { info.classList.add('hidden'); return; }
  const d = describe(selectedId);
  $('info-kicker').textContent = 'Район';
  $('info-title').textContent = d.title;
  $('info-list').innerHTML = `
    <dt>Страна</dt><dd><span class="swatch" style="background:${d.country.color}"></span>${d.country.name}</dd>
    <dt>Провинция</dt><dd>${d.province.name}</dd>
    <dt>Площадь района</dt><dd>${fmtKm2(d.area)}</dd>
    <dt>Площадь провинции</dt><dd>${fmtKm2(d.province.area)}</dd>
    <dt>Центр</dt><dd>${fmtLat(d.lat)}, ${fmtLon(d.lon)}</dd>
    <dt>Код</dt><dd class="muted">D-${selectedId} · P-${d.province.id} · ${d.country.code}</dd>`;
  info.classList.remove('hidden');
}
$('info-close').onclick = () => select(0);

const tooltip = $('tooltip');
function updateHover() {
  if (!mouse.inside || dragAnchor || menuOpen) { tooltip.classList.add('hidden'); return; }
  const r = canvas.getBoundingClientRect();
  const n = new THREE.Vector2(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1);
  const g = gcam.pick(n);
  const id = g ? globe.cellAt(g) : -1;
  hoverId = id >= 2 ? id : 0;
  globe.terrainMat.uniforms.uHover.value = hoverId;
  if (id < 0) { tooltip.classList.add('hidden'); return; }
  const d = describe(id);
  const geo = vecToGeo(g);
  tooltip.innerHTML = d.kind === 'district'
    ? `<b>${d.title}</b><div class="t-sub">${d.province.name} · ${d.country.name}</div><div class="muted">${fmtKm2(d.area)} · ${fmtLat(geo.lat)}, ${fmtLon(geo.lon)}</div>`
    : `<b>${d.title}</b><div class="muted">${fmtLat(geo.lat)}, ${fmtLon(geo.lon)}</div>`;
  tooltip.classList.remove('hidden');
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(window.innerWidth - tw - 8, mouse.x + 16)}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - th - 8, mouse.y + 18)}px`;
}

// ------------------------------------------------------------------ menu
let menuOpen = false;
const menu = $('menu');
function toggleMenu(force) {
  menuOpen = force ?? !menuOpen;
  menu.classList.toggle('open', menuOpen);
}
$('btn-menu').onclick = () => toggleMenu(true);
$('menu-resume').onclick = () => toggleMenu(false);
$('menu-launcher').onclick = () => { if (isElectron) window.orbis.exitToLauncher(); else location.href = './index.html'; };
$('menu-quit').onclick = () => { if (isElectron) window.orbis.quit(); else location.href = './index.html'; };
const bind = (id, key, prop = 'value', parse = Number) => {
  const el = $(id);
  el[prop] = settings[key];
  el.addEventListener('input', () => { settings[key] = parse(el[prop]); saveSettings(settings); });
};
bind('set-relief', 'reliefScale');
bind('set-unroll', 'unroll');
bind('set-districts', 'showDistricts', 'checked', Boolean);
bind('set-rivers', 'showRivers', 'checked', Boolean);

// ------------------------------------------------------------------ HUD
const needle = $('compass-needle'), scaleBar = $('scale-bar'), scaleText = $('scale-text'), coords = $('coords');
function updateHud() {
  needle.setAttribute('transform', `rotate(${(-gcam.heading * 180 / Math.PI).toFixed(2)} 24 24)`);
  const kmpp = gcam.kmPerPixel(window.innerHeight);
  const target = kmpp * 120;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map(m => m * pow).reverse().find(v => v <= target) || pow;
  scaleBar.style.width = `${(nice / kmpp).toFixed(0)}px`;
  scaleText.textContent = `${nice.toLocaleString('ru-RU')} км`;
  const g = vecToGeo(gcam.F);
  coords.textContent = `${fmtLat(g.lat)} · ${fmtLon(g.lon)} · высота ${Math.round(gcam.alt * 6371).toLocaleString('ru-RU')} км`;
}

// ------------------------------------------------------------------ loop
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const timer = new THREE.Timer();
let fpsAcc = 0, fpsN = 0, hudT = 0;
const fpsEl = $('fps');
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(0.05, timer.getDelta());
  const t = timer.getElapsed();

  // keyboard panning (arc radians per second ~ altitude)
  if (!menuOpen) {
    const sp = gcam.alt * 0.9 * dt;
    let dx = 0, dy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy += sp;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy -= sp;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += sp;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= sp;
    if (dx || dy) gcam.pan(dx, dy);
  }

  const p = gcam.update(dt, globe.heightAt(gcam.F));
  globe.update(gcam, t, camera);
  scene.background.copy(SPACE).lerp(SKY, (1 - p.globe) * Math.min(1, p.tilt / 0.6) * 0.9);

  renderer.render(scene, camera);

  hudT += dt;
  if (hudT > 0.05) { hudT = 0; updateHover(); updateHud(); }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} FPS`; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(() => $('loading').classList.add('done'), 150);

// debug hooks for automated checks
window.__orbis = { gcam, globe, camera, renderer, setMode, select, world };
