import '@fontsource/alegreya-sc/500.css';
import '@fontsource/alegreya-sc/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './game.css';
import * as THREE from 'three';
import { APP_NAME, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, updateStoredSettings, isElectron } from '../shared/settings.js';
import { getPalette, applyUiPalette } from '../shared/palettes.js';
import { applyStippleTheme } from '../shared/stipple.js';
import { loadWorld } from './data.js';
import { Globe } from './globe.js';
import { GlobeCamera, vecToGeo } from './camera.js';
import { Upscaler } from './post.js';
import { DynamicResolution } from './dynres.js';
import { installMapSnapshot } from './snapshot.js';
import { DetailTerrain } from './terrain/detail.js';
import * as hud from './ui/hud.js';
import { buildSettings, refreshSettingsView, openModal, closeModal, anyModalOpen } from './ui/menus.js';
import { createWorldSystems } from './world/systems.js';
import { openChronicle } from './ui/chronicle.js';
import { showLegend } from './ui/legend.js';
import { MODE_DEFS } from './ui/icons.js';
import { applyPackData, runPackScripts } from '../engine/packs.js';
import { BIOME_COLORS } from './world/biomes.js';
import { VERSION } from '../shared/version.js';

const $ = id => document.getElementById(id);
// loading-time marks (performance.getEntriesByType('mark')): p:start, p:data, p:globe, p:systems, p:frame1, p:ready
performance.mark('p:start');
// the map data starts loading at once: its fetches and decompression overlap the settings, packs and WebGL start-up
const worldP = loadWorld(p => { $('load-fill').style.width = `${(p * 70).toFixed(1)}%`; });
worldP.catch(() => {});   // a failure surfaces where it is awaited
const settings = await loadSettings();
const params = new URLSearchParams(location.search);
if (params.has('palette')) settings.palette = params.get('palette');
if (params.has('shaders')) settings.shaders = params.get('shaders');
// mods and DLC: data first (palettes, colours), scripts once the world is up; ?packs=a,b switches packs on (tests)
if (params.has('packs')) settings.packs = Object.fromEntries(params.get('packs').split(',').filter(Boolean).map(id => [id, true]));
const packs = await applyPackData(settings, { biomeColors: BIOME_COLORS }).catch(e => { console.warn('packs', e); return { enabled: [] }; });
applyUiPalette(settings.palette);
applyStippleTheme();
if (params.has('uiscale')) settings.uiScale = params.get('uiscale'); // captures: ?uiscale=auto|1.25
if (params.has('fps')) settings.fpsLimit = +params.get('fps');        // checks: ?fps=30
// checks: ?scale=0.5|0.75|1|auto — the render scale; ?upscale=0 — the old upscale filter (before/after), =fsr|lite —
// that filter of the new ones (post.js; by default by the GPU class);
// ?gputimer=0 — dynamic resolution without GPU timer queries (judged by frame times alone)
if (params.has('scale')) settings.renderScale = params.get('scale') === 'auto' ? 'auto' : +params.get('scale');
hud.applyUiScale(settings.uiScale);
hud.applySeamlessPaper();
const PAL = getPalette(settings.palette).map;

document.title = `${APP_NAME} ${VERSION_LABEL}`;
$('load-version').textContent = `${VERSION_LABEL} · ${EPOCH_LABEL}`;
$('menu-version').textContent = `${APP_NAME} ${VERSION_LABEL} · ${EPOCH_LABEL}`;

// ------------------------------------------------------------------ renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reverseDepthBuffer: true });
// The map's shaders write display colours. With three's default (sRGB output on the canvas, linear in a render target)
// the canvas path and the upscaler's path used different shader programs — a synchronous recompile of every shader the
// first time the dynamic resolution crossed 100% — and the space around the globe came out grey on one, black on the
// other. Linear output everywhere: one set of programs, one look (the one captures and the menu art were made with).
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const pixelRatio = () => Math.min(2, (window.devicePixelRatio || 1) * (settings.pixelRatio || 1));
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
const upscaleParam = { 0: 'legacy', fsr: 'fsr', lite: 'lite' }[params.get('upscale')] || 'auto';
const upscaler = new Upscaler(renderer, { mode: upscaleParam, gpuTimer: params.get('gputimer') !== '0' });
installMapSnapshot(renderer); // save thumbnails: a copy of the canvas right after a drawn frame (src/game/snapshot.js)
// GPU class: integrated GPUs get lighter defaults; "auto" settings adapt at runtime
const gpuName = (() => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })();
const integratedGpu = /Intel|UHD|Iris|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics|Microsoft Basic|SwiftShader/i.test(gpuName) && !/RTX|GTX|Radeon RX|Arc A/i.test(gpuName);
settings.qualityResolved = settings.quality === 'auto' ? (integratedGpu ? 'medium' : 'high') : settings.quality;
// MSAA of the upscaler's target: 4x on the 'high' class, 2x below (see post.js); ?msaa=N for checks
upscaler.samples = params.has('msaa') ? +params.get('msaa') : settings.qualityResolved === 'high' ? 4 : 2;
// upscale filter: FSR 1 (EASU + RCAS) on discrete GPUs, the one-pass light filter on integrated ones (post.js)
upscaler.autoTier = integratedGpu ? 'lite' : 'fsr';
// dynamic resolution (dynres.js): 50-100% of the base below, aiming at 60 FPS or the frame cap
const dyn = new DynamicResolution({ min: 0.5, max: 1, start: integratedGpu ? 0.75 : 1 });

// Internal render resolution — what the GPU draws before the sharpening upscale (post.js):
//  * settings.resolution 'WxH' is in physical pixels. In fullscreen / maximized mode it caps the drawing:
//    base = min(1, W / bufferW, H / bufferH) — the screen's aspect is kept, nothing is supersampled.
//    In window mode it is the window's size instead (electron/main.cjs), so the base stays 1. 'native' = 1.
//  * settings.renderScale multiplies the base: a fixed 0.5..1, or 'auto' = dynamic resolution, which moves between
//    50% and 100% OF THAT BASE to hold the frame rate (so "1920×1080" on a 4K screen draws 1080p at best and drops
//    towards 960×540 only when the GPU cannot keep up). The product never goes below 25% of the screen.
let resBase = 1;
function updateResolutionBase() {
  const m = /^(\d+)x(\d+)$/.exec(String(settings.resolution || ''));
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  resBase = m && settings.windowMode !== 'window' ? Math.min(1, +m[1] / Math.max(1, size.x), +m[2] / Math.max(1, size.y)) : 1;
}
updateResolutionBase();
const currentRenderScale = () => Math.max(0.25, resBase * (settings.renderScale === 'auto' ? dyn.scale : Number(settings.renderScale) || 1));
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
const data = await worldP;
performance.mark('p:data');
loadText.textContent = 'Поднимаем горы и наполняем океаны…';
await new Promise(r => setTimeout(r, 20));
const globe = new Globe(scene, renderer, data, settings);
globe.setShaders(settings.shaders);
// the terrain shaders compile in the GPU process while the world systems load (instead of stalling the first frame)
// (compiled for the target the frame is drawn into: the upscaler's, or the canvas — see post.js prepare)
globe.compileTarget = () => upscaler.prepare(currentRenderScale(), settings.brightness);
if (!params.has('novariants')) globe.precompile(camera); else globe.noVariants = true;
// the heights and the imagery (~220 MB with mips) go to the GPU now: the GPU process digests them while the world
// systems load (the cell raster waits: the regions module re-encodes it)
for (const t of [globe.heightTex, data.albedo, globe.terrainMat.uniforms.uNoise.value]) { try { renderer.initTexture(t); } catch { /* uploaded at first use */ } }
const gcam = new GlobeCamera(camera, settings);
const detail = new DetailTerrain(globe, data);
if (params.has('lat')) gcam.lookAt(+params.get('lat'), +params.get('lon'), +(params.get('alt') || 0.3));
performance.mark('p:globe');

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
// onIdle (called by the world systems at a few points while they load): compile the shaders made so far in the GPU
// process (KHR_parallel_shader_compile) and upload the map textures, so the GPU process works on them in parallel
// with the loading instead of all at once at the first frames (compiles and uploads already done are skipped)
function warmUp() {
  const done = [];
  try {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(globe.compileTarget());
    done.push(renderer.compileAsync(scene, camera).catch(() => {}));
    renderer.setRenderTarget(prev);
    done.push(renderer.compileAsync(upscaler.compileScene, upscaler.quadCam).catch(() => {}));
    const seen = new Set();
    for (const u of [globe.terrainMat.uniforms, globe.shared]) {
      for (const k in u) {
        const t = u[k].value;
        if (t?.isTexture && !seen.has(t)) { seen.add(t); renderer.initTexture(t); }
      }
    }
  } catch (e) { console.warn('warm-up', e); }
  return Promise.all(done);
}
const world = await createWorldSystems({ scene, globe, gcam, camera, renderer, settings, hud, renderHeight: () => window.innerHeight * renderer.getPixelRatio() * currentRenderScale(), onProgress: p => { fill.style.width = `${(70 + p * 30).toFixed(1)}%`; }, onIdle: warmUp });
// Before the first frame, let the GPU process finish what the loading queued (shader compiles, ~0.4 GB of map
// texture uploads): otherwise the first frames stall behind it — ~0.5 s of a frozen map and a stuck loading-screen fade
// on a weak PC. Waited for here, behind the loading screen: the zone labels (built asynchronously), the remaining
// compiles, then a fence after everything queued so far (at most ~3 s in all).
{
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await Promise.race([world.labels?.ready$, wait(800)]);
  await Promise.race([warmUp(), wait(1000)]);
  upscaler.warm(currentRenderScale());   // the upscaler's targets and passes, drawn once (post.js)
  try {
    const gl = renderer.getContext(), fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    for (const t0 = performance.now(); performance.now() - t0 < 1500 && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED;) await wait(8);
    gl.deleteSync(fence);
  } catch { /* no fences: start at once */ }
}
fill.style.width = '100%';
performance.mark('p:systems');
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
  showLegend(id);
}
// the mode the player picks is remembered (settings.mapMode) and comes back at the next start; ?mode= in the address
// wins (captures, checks), and shot mode (menu art) ignores the remembered one
function pickMode(id) {
  setMode(id);
  if (settings.mapMode !== id) { settings.mapMode = id; updateStoredSettings({ mapMode: id }); }
}
const modeAvailable = id => MODE_DEFS.some(m => m.id === id && (!m.needs || world.features?.has?.(m.needs)));
function rebuildModes() { hud.buildModes(pickMode, world.features); hud.markMode(mode); }
rebuildModes();
setMode(params.get('mode') || (!SHOT && modeAvailable(settings.mapMode) ? settings.mapMode : 'terrain'));

// ?fxdemo=<seconds>: a sample of every event effect around the view centre, pre-aged (captures, style checks);
// &fxkind=<type> shows just that event at the centre instead (&fxlevel=1..5, &fxvei=0..8, &fxair=1: an airburst)
if (params.has('fxdemo') && world.fx) {
  const fx = world.fx, age = +params.get('fxdemo') || 2, t0 = fx.now;
  const la = +params.get('lat') || 0, lo = +params.get('lon') || 0, d = Math.max(0.6, gcam.altTarget * 9);
  const at = (dy, dx, ev) => fx.spawn({ lat: la + dy * d, lon: lo + dx * d / Math.max(0.2, Math.cos(la * Math.PI / 180)), ...ev });
  if (params.has('fxkind')) {
    at(0, 0, {
      type: params.get('fxkind'), level: +params.get('fxlevel') || 3,
      vei: params.has('fxvei') ? +params.get('fxvei') : undefined, kind: params.get('fxair') === '1' ? 'airburst' : undefined,
    });
  } else {
    at(0.15, 0.1, { type: 'eruption', vei: 4 });
    at(-0.6, -1.2, { type: 'earthquake', level: 4 });
    at(-0.9, 1.0, { type: 'tsunami', level: 3 });
    at(0.8, -0.9, { type: 'wildfire', level: 3 });
    at(1.0, 1.1, { type: 'flood', level: 3 });
    at(-0.2, 2.2, { type: 'storm', level: 3 });
    at(0.3, -2.2, { type: 'heatwave', level: 3 });
    at(-1.5, -2.2, { type: 'snowstorm', level: 3 });
    at(1.5, 2.3, { type: 'drought', level: 3 });
    at(0.7, 0.45, { type: 'landslide', level: 4 });
    fx.now = t0 + age - 2.6;
    at(-0.5, 0.8, { type: 'meteorite', level: 5 });     // its fireball and mushroom at capture time
    fx.now = t0 + age - 0.3;
    at(-1.3, 0.1, { type: 'meteorite', level: 3 });     // still falling
  }
  fx.now = t0 + age;
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
$('legend').onclick = () => $('legend').classList.toggle('mini');
$('chronicle-btn').hidden = !world.chronicle;
$('menu-resume').onclick = () => toggleMenu(false);
$('menu-settings').onclick = () => openModal('settings');
$('menu-save').onclick = () => world.openSaves?.('save');
$('menu-load').onclick = () => world.openSaves?.('load');
$('menu-save').disabled = $('menu-load').disabled = !world.openSaves;
$('menu-launcher').onclick = () => { if (isElectron) window.passionaris.exitToLauncher(); else location.href = './index.html'; };
$('menu-quit').onclick = () => { if (isElectron) window.passionaris.quit(); else location.href = './index.html'; };
buildSettings(settings, (key, value) => {
  if (key === 'brightness' || key === 'renderScale' || key === 'sharpen' || key === 'fpsLimit' || key === 'showFps') return; // read every frame
  if (key === 'uiScale') { applyDisplay(); return; }
  if (key === 'windowMode' || key === 'resolution') {
    // the window follows at once (Electron); the internal resolution is re-read here and again on the resize
    window.passionaris?.applyWindow?.({ windowMode: settings.windowMode, resolution: settings.resolution });
    applyDisplay();
    return;
  }
  if (key === 'shaders') globe.setShaders(value);
  world.onSetting?.(key, value);
});

// ------------------------------------------------------------------ loop
// window size, display scaling (moving to another monitor changes devicePixelRatio), interface scale, resolution
function applyDisplay() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  updateResolutionBase();
  const { auto, ui, wanted } = hud.applyUiScale(settings.uiScale);
  refreshSettingsView({ autoUi: auto, ui, wanted });
}
window.addEventListener('resize', applyDisplay);
applyDisplay();

const timer = new THREE.Timer();
let fpsAcc = 0, fpsN = 0, hudT = 0, fpsText = '', lastDraw = -1e9, drawnFrames = 0;
function frame(ts) {
  // frame limiter (settings.fpsLimit): skip display refreshes until the next frame is due. The cadence is kept by
  // stepping lastDraw by whole intervals (a 60 cap on a 144 Hz screen averages 60), and resynced after a hitch.
  const cap = Number(settings.fpsLimit) || 0;
  if (cap > 0 && !SHOT) {
    const iv = 1000 / cap, since = ts - lastDraw;
    if (since < iv - Math.min(2, iv * 0.2)) { requestAnimationFrame(frame); return; }
    lastDraw = since > iv * 2 ? ts : lastDraw + iv;
  }
  upscaler.beginFrame();   // GPU time of this frame (post.js GpuTimer), for the dynamic resolution
  timer.update(ts);
  const rawDt = timer.getDelta();
  const dt = Math.min(0.05, rawDt);
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

  // dynamic resolution (dynres.js): GPU time of the frames when timer queries work, else the frame intervals.
  // Intervals are between drawn frames; under a cap the goal is the cap (30 FPS: 33 ms frames are on target).
  if (settings.renderScale === 'auto' && !SHOT) {
    const now = performance.now() / 1000;
    dyn.freeAtMax = resBase >= 0.999 && Math.abs(settings.brightness - 1) < 0.01;   // 100% = straight to the canvas
    if (upscaler.timer.fresh) dyn.gpuSample(upscaler.timer.scene, upscaler.timer.post, now);
    dyn.update(rawDt * 1000, cap > 0 ? 1000 / cap : 0, now);
  }
  upscaler.render(scene, camera, { renderScale: currentRenderScale(), sharpen: settings.sharpen, brightness: settings.brightness });
  if (!drawnFrames) performance.mark('p:frame1');

  hudT += dt;
  if (hudT > 0.05) {
    hudT = 0;
    updateHover();
    hud.updateCompassAndScale(gcam.heading, gcam.kmPerPixel(window.innerHeight));
    if (infoPoint && world.liveInfo) hud.showInfo(describePoint(infoPoint));
  }
  fpsAcc += rawDt; fpsN++; drawnFrames++;
  if (fpsAcc > 0.5) { fpsText = `${Math.round(fpsN / fpsAcc)} FPS`; fpsAcc = 0; fpsN = 0; }
  world.renderClock?.(settings.showFps ? fpsText : '');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(() => $('loading')?.classList.add('done'), SHOT ? 0 : 150);
if (SHOT) $('loading')?.remove();

// debug hooks for automated checks
window.__game = { gcam, globe, camera, renderer, setMode, world, settings, detail, gpuName, integratedGpu, dyn, get dynScale() { return dyn.scale; }, ready: false, rebuildModes,
  hud, applyDisplay, upscaler, get renderScale() { return currentRenderScale(); }, get fpsText() { return fpsText; }, get drawnFrames() { return drawnFrames; },
  openInfo: (lat, lon) => { const r = Math.PI / 180; openInfo(new THREE.Vector3(Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r), Math.cos(lat * r) * Math.cos(lon * r))); } };
let framesDrawn = 0;
(function markReady() { if (++framesDrawn > 20) { window.__game.ready = true; performance.mark('p:ready'); } else requestAnimationFrame(markReady); })();
