// Dev-only preview for the zone labels (not part of the game build).
// Open http://localhost:5173/scripts/labels/preview.html?lat=25&lon=20&alt=1.2
// Drag to pan, wheel to zoom. window.__labels / window.__gcam for inspection.
import * as THREE from 'three';
import { loadWorld } from '/src/game/data.js';
import { Globe } from '/src/game/globe.js';
import { GlobeCamera } from '/src/game/camera.js';
import { ZoneLabels } from '/src/game/fx/labels.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, reverseDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.045, 0.045, 0.043);
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.001, 50);

const settings = { quality: 'medium', unroll: +(params.get('unroll') ?? 0.85), reliefScale: 1, showRivers: true, showDistricts: false, palette: params.get('palette') || 'graphite' };
const data = await loadWorld();
const globe = new Globe(scene, renderer, data, settings);
globe.overlayBase = 0;
globe.clean = true;
const gcam = new GlobeCamera(camera, settings);
if (params.has('lat')) gcam.lookAt(+params.get('lat'), +params.get('lon'), +(params.get('alt') || 1));
gcam.alt = gcam.altTarget;
if (params.has('tilt')) gcam.tiltOverride = THREE.MathUtils.degToRad(+params.get('tilt'));

const labels = new ZoneLabels(scene, globe, { palette: settings.palette, renderer, lang: params.get('lang') || 'ru' });

let drag = null;
const ndc = e => new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
canvas.addEventListener('pointerdown', e => { drag = gcam.pick(ndc(e)); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (drag) { const c = gcam.pick(ndc(e)); if (c) { gcam.drag(c, drag); gcam.place(gcam.derived); } } });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); const n = ndc(e); gcam.zoom(Math.exp(Math.sign(e.deltaY) * 0.25), gcam.pick(n), n); }, { passive: false });
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

const timer = new THREE.Timer();
let frames = 0;
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(0.05, timer.getDelta()), t = timer.getElapsed();
  gcam.update(dt, globe.heightAt(gcam.F));
  globe.update(gcam, t, camera);
  labels.update(gcam, t);
  renderer.render(scene, camera);
  if (++frames % 10 === 0) {
    const shown = labels.ready ? labels.alpha.reduce((s, a) => s + (a > 0.5 ? 1 : 0), 0) : 0;
    hud.textContent = `alt ${gcam.alt.toFixed(3)} · подписей видно: ${shown}${labels.ready ? '' : ' (загрузка)'}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// synchronous stepping for automated screenshots (background tabs get no rAF)
let simT = 1000;
window.__step = (n = 30, dt = 0.1) => {
  for (let k = 0; k < n; k++) {
    simT += dt;
    gcam.update(dt, globe.heightAt(gcam.F));
    globe.update(gcam, simT, camera);
    labels.update(gcam, simT);
  }
  renderer.render(scene, camera);
  return labels.zones?.filter((z, i) => labels.alpha[i] > 0.5).map(z => z.nameRu) ?? [];
};
window.__look = (lat, lon, alt, tiltDeg = null) => {
  gcam.lookAt(lat, lon, alt);
  gcam.alt = alt;
  gcam.tiltOverride = tiltDeg === null ? undefined : THREE.MathUtils.degToRad(tiltDeg);
  return window.__step(40);
};
window.__labels = labels;
window.__gcam = gcam;
window.__ready = () => labels.ready && frames > 30;
