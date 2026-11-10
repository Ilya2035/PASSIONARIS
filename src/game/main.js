import '@fontsource/alegreya-sc/500.css';
import '@fontsource/alegreya-sc/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './game.css';
import * as THREE from 'three';
import { APP_NAME, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron } from '../shared/settings.js';
import { getPalette, applyUiPalette } from '../shared/palettes.js';
import { applyStippleTheme } from '../shared/stipple.js';
import { loadWorld } from './data.js';
import { Globe } from './globe.js';
import { GlobeCamera, vecToGeo } from './camera.js';
import { Upscaler } from './post.js';
import { DetailTerrain } from './terrain/detail.js';
import * as hud from './ui/hud.js';
import { buildSettings, openModal, closeModal, anyModalOpen } from './ui/menus.js';
import { createWorldSystems } from './world/systems.js';
import { openChronicle } from './ui/chronicle.js';
import { applyPackData, runPackScripts } from '../engine/packs.js';
import { BIOME_COLORS } from './world/biomes.js';
import { VERSION } from '../shared/version.js';

const $ = id => document.getElementById(id);
const settings = await loadSettings();
const params = new URLSearchParams(location.search);
if (params.has('palette')) settings.palette = params.get('palette');
if (params.has('shaders')) settings.shaders = params.get('shaders');
// mods and DLC: data first (palettes, colours), scripts once the world is up; ?packs=a,b switches packs on (tests)
if (params.has('packs')) settings.packs = Object.fromEntries(params.get('packs').split(',').filter(Boolean).map(id => [id, true]));
const packs = await applyPackData(settings, { biomeColors: BIOME_COLORS }).catch(e => { console.warn('packs', e); return { enabled: [] }; });
applyUiPalette(settings.palette);
applyStippleTheme();
const PAL = getPalette(settings.palette).map;

document.title = `${APP_NAME} ${VERSION_LABEL}`;
$('load-version').textContent = `${VERSION_LABEL} · ${EPOCH_LABEL}`;
$('menu-version').textContent = `${APP_NAME} ${VERSION_LABEL} · ${EPOCH_LABEL}`;

// ------------------------------------------------------------------ renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reverseDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * (settings.pixelRatio || 1)));
renderer.setSize(window.innerWidth, window.innerHeight);
const upscaler = new Upscaler(renderer);
// GPU class: integrated GPUs get lighter defaults; "auto" settings adapt at runtime
const gpuName = (() => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })();
const integratedGpu = /Intel|UHD|Iris|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics|Microsoft Basic|SwiftShader/i.test(gpuName) && !/RTX|GTX|Radeon RX|Arc A/i.test(gpuName);
settings.qualityResolved = settings.quality === 'auto' ? (integratedGpu ? 'medium' : 'high') : settings.quality;
let dynScale = integratedGpu ? 0.75 : 1, frameEma = 16, dynT = 0;
const scene = new THREE.Scene();
const SPACE = new THREE.Color(...PAL.space);
const SKY = new THREE.Color(...PAL.haze);
scene.background = SPACE.clone();
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.001, 50);

// stars
const stars = (() => {
  const n = 4000, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(40); pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8d2c4, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
  scene.add(p);
  return p;
})();

// ------------------------------------------------------------------ data
const fill = $('load-fill'), loadText = $('load-text');
const data = await loadWorld(p => { fill.style.width = `${(p * 70).toFixed(1)}%`; });
loadText.textContent = 'Поднимаем горы и наполняем океаны…';
await new Promise(r => setTimeout(r, 20));
const globe = new Globe(scene, renderer, data, settings);
globe.setShaders(settings.shaders);
const gcam = new GlobeCamera(camera, settings);
const detail = new DetailTerrain(globe, data);
if (params.has('lat')) gcam.lookAt(+params.get('lat'), +params.get('lon'), +(params.get('alt') || 0.3));

// "shot" mode: no UI, camera placed instantly — used to render menu art (scripts/render-menu-art.mjs)
const SHOT = params.get('shot') === '1';
if (SHOT) {
  if (params.get('ui') !== '1') document.body.classList.add('shot');
  gcam.alt = gcam.altTarget;
  if (params.has('tilt')) gcam.tiltOverride = THREE.MathUtils.degToRad(+params.get('tilt'));
  globe.clean = params.get('clean') === '1';
}

// ------------------------------------------------------------------ world systems (time, climate, weather, hazards, fx…)
loadText.textContent = 'Заводим часы мира…';
const world = await createWorldSystems({ scene, globe, gcam, camera, renderer, settings, hud, renderHeight: () => window.innerHeight * renderer.getPixelRatio() * (settings.renderScale === 'auto' ? dynScale : Number(settings.renderScale) || 1), onProgress: p => { fill.style.width = `${(70 + p * 30).toFixed(1)}%`; } });
fill.style.width = '100%';
if ((!SHOT || params.has('packs')) && packs.enabled.length) runPackScripts(packs.enabled, { version: VERSION, hud, world, globe, scene, gcam });
// ?date=Y-M-D (astronomical year, e.g. -4999-07-01 or 1650-01-15): start at that moment (captures, checks)
if (params.has('date') && world.clock && world.cal) {
  const m = /^(-?\d+)-(\d{1,2})-(\d{1,2})$/.exec(params.get('date'));
  if (m) world.clock.setTime(world.cal.fromDate(+m[1], +m[2], +m[3]));
}
// "Continue" in the launcher: load the save it picked (one-shot)
try {
  const cont = localStorage.getItem('passionaris.continue');
  if (cont) { localStorage.removeItem('passionaris.continue'); if (!SHOT) world.time?.loadId(cont); }
} catch { /* storage unavailable */ }

// ------------------------------------------------------------------ map modes
let mode = 'terrain';
function setMode(id) {
  mode = id;
  globe.setMode(id);
  world.onModeChange?.(id);
  hud.markMode(id);
}
function rebuildModes() { hud.buildModes(setMode, world.features); hud.markMode(mode); }
rebuildModes();
setMode(params.get('mode') || 'terrain');

// ?fxdemo=<seconds>: a sample of every event effect around the view centre, pre-aged (captures, style checks)
if (params.has('fxdemo') && world.fx) {
  const la = +params.get('lat') || 0, lo = +params.get('lon') || 0, d = Math.max(0.6, gcam.altTarget * 9);
  const at = (dy, dx, ev) => world.fx.spawn({ lat: la + dy * d, lon: lo + dx * d / Math.max(0.2, Math.cos(la * Math.PI / 180)), ...ev });
  at(0.15, 0.1, { type: 'eruption', vei: 4 });
  at(-0.6, -1.2, { type: 'earthquake', level: 4 });
  at(-0.9, 1.0, { type: 'tsunami', level: 3 });
  at(0.8, -0.9, { type: 'wildfire', level: 3 });
  at(1.0, 1.1, { type: 'flood', level: 3 });
  at(-0.2, 2.2, { type: 'storm', level: 3 });
  at(0.3, -2.2, { type: 'heatwave', level: 3 });
  world.fx.now += +params.get('fxdemo') || 2;
  at(-1.3, 0.1, { type: 'meteorite', level: 3 });
  world.fx.now += 0.3;
}

// ------------------------------------------------------------------ helpers
const fmtLat = v => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'с.ш.' : 'ю.ш.'}`;
const fmtLon = v => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'в.д.' : 'з.д.'}`;
function describePoint(g) {
  const geo = vecToGeo(g);
  const cell = globe.cellAt(g);
  const h = globe.heightAt(g);
  const base = world.describe?.(g, geo, cell, h) || {};
  const water = cell === 0 ? 'ocean' : cell === 1 ? 'lake' : 'land';
  const kicker = base.kicker || (water === 'ocean' ? 'Мировой океан' : water === 'lake' ? 'Озеро' : 'Суша');
  const rows = [
    [water === 'land' ? 'Высота' : 'Глубина', `${Math.abs(Math.round(h)).toLocaleString('ru-RU')} м`],
    ['Координаты', `${fmtLat(geo.lat)}, ${fmtLon(geo.lon)}`],
    ...(base.rows || []),
  ];
  return { kicker, title: base.title || kicker, rows, tip: base.tip, water };
}

// ------------------------------------------------------------------ input
const ndc = new THREE.Vector2();
const mouse = { x: 0, y: 0, inside: false };
let dragAnchor = null, downAt = null, moved = false, hoverPoint = null;
const keys = new Set();
const toNdc = (e, out = ndc) => {
  const r = canvas.getBoundingClientRect();
  return out.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};
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
  if (wasClick && hoverPoint) openInfo(hoverPoint);
});
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); closeInfo(); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 240) * 0.0024);
  const n = toNdc(e, new THREE.Vector2());
  gcam.zoom(f, gcam.pick(n), n);
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('settings').classList.contains('open')) { closeModal('settings'); return; }
    if ($('saves').classList.contains('open')) { closeModal('saves'); return; }
    toggleMenu(); return;
  }
  if (anyModalOpen() || e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); world.togglePause?.(); }
  if (/^Digit[1-5]$/.test(e.code)) world.setSpeed?.(Number(e.code.slice(5)));
  if (e.code === 'KeyJ' && world.chronicle) showChronicle();
  if (e.code === 'F5') { e.preventDefault(); world.quickSave?.(); }
  if (e.code === 'F9') { e.preventDefault(); world.quickLoad?.(); }
  if (e.code === 'Home') gcam.altTarget = 2.15;
  if (e.key === '+' || e.key === '=') gcam.zoom(0.7);
  if (e.key === '-') gcam.zoom(1.4);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ------------------------------------------------------------------ info window
let infoPoint = null;
function openInfo(g) { infoPoint = g.clone(); hud.showInfo(describePoint(infoPoint)); world.onSelect?.(infoPoint); }
function closeInfo() { infoPoint = null; hud.hideInfo(); world.onSelect?.(null); }
$('info-close').onclick = closeInfo;

function updateHover() {
  if (!mouse.inside || dragAnchor || anyModalOpen()) { hud.hideTooltip(); return; }
  const r = canvas.getBoundingClientRect();
  const n = new THREE.Vector2(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1);
  hoverPoint = gcam.pick(n);
  if (!hoverPoint) { hud.hideTooltip(); return; }
  const d = describePoint(hoverPoint);
  hud.showTooltip(`<b>${hud.esc(d.title)}</b>${d.tip ? `<div>${d.tip}</div>` : ''}`, mouse.x, mouse.y);
  world.onHover?.(hoverPoint);
}

// ------------------------------------------------------------------ menus & settings
let menuOpen = false;
function toggleMenu(force) {
  menuOpen = force ?? !menuOpen;
  if (menuOpen) { openModal('menu'); world.pauseForMenu?.(true); } else { closeModal('menu'); world.pauseForMenu?.(false); }
}
function showChronicle() {
  openChronicle({ items: world.chronicle(), onPick: it => gcam.flyTo(it.lat, it.lon, Math.min(gcam.alt, it.kind === 'weather' ? 0.8 : 0.35)) });
}
$('chronicle-btn').onclick = () => showChronicle();
$('chronicle-btn').hidden = !world.chronicle;
$('menu-resume').onclick = () => toggleMenu(false);
$('menu-settings').onclick = () => openModal('settings');
$('menu-save').onclick = () => world.openSaves?.('save');
$('menu-load').onclick = () => world.openSaves?.('load');
$('menu-save').disabled = $('menu-load').disabled = !world.openSaves;
$('menu-launcher').onclick = () => { if (isElectron) window.passionaris.exitToLauncher(); else location.href = './index.html'; };
$('menu-quit').onclick = () => { if (isElectron) window.passionaris.quit(); else location.href = './index.html'; };
buildSettings(settings, (key, value) => {
  if (key === 'brightness' || key === 'renderScale' || key === 'sharpen') return; // read every frame
  if (key === 'shaders') globe.setShaders(value);
  world.onSetting?.(key, value);
});

// ------------------------------------------------------------------ loop
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const timer = new THREE.Timer();
let fpsAcc = 0, fpsN = 0, hudT = 0, fpsText = '';
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(0.05, timer.getDelta());
  const t = timer.getElapsed();

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
  detail.update(gcam, ts || performance.now());
  world.update(dt, t, p);
  globe.update(gcam, settings.waterAnimation === false ? 0 : t, camera);
  scene.background.copy(SPACE).lerp(SKY, (1 - p.globe) * Math.min(1, p.tilt / 0.6) * 0.9);
  stars.material.opacity = 0.7 * p.globe;

  // dynamic resolution: keep ~50 FPS by moving the internal render scale between 50% and 100%
  frameEma = frameEma * 0.92 + dt * 1000 * 0.08;
  dynT += dt;
  if (settings.renderScale === 'auto' && dynT > 0.5) {
    dynT = 0;
    if (frameEma > 21) dynScale = Math.max(0.5, dynScale - 0.05);
    else if (frameEma < 14.5) dynScale = Math.min(1, dynScale + 0.025);
  }
  const renderScale = settings.renderScale === 'auto' ? dynScale : Number(settings.renderScale) || 1;
  upscaler.render(scene, camera, { renderScale, sharpen: settings.sharpen, brightness: settings.brightness });

  hudT += dt;
  if (hudT > 0.05) {
    hudT = 0;
    updateHover();
    hud.updateCompassAndScale(gcam.heading, gcam.kmPerPixel(window.innerHeight));
    if (infoPoint && world.liveInfo) hud.showInfo(describePoint(infoPoint));
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsText = `${Math.round(fpsN / fpsAcc)} FPS`; fpsAcc = 0; fpsN = 0; }
  world.renderClock?.(settings.showFps ? fpsText : '');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(() => $('loading')?.classList.add('done'), SHOT ? 0 : 150);
if (SHOT) $('loading')?.remove();

// debug hooks for automated checks
window.__game = { gcam, globe, camera, renderer, setMode, world, settings, detail, gpuName, integratedGpu, get dynScale() { return dynScale; }, ready: false, rebuildModes };
let framesDrawn = 0;
(function markReady() { if (++framesDrawn > 20) window.__game.ready = true; else requestAnimationFrame(markReady); })();
