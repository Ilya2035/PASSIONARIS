// The graphics album (docs/ALBUM.md): a real 3D map of Iberia and southern France whose looks the owner can switch,
// tune and rate. URL keys for captures: page, lat, lon, h, tilt, heading, place, ui=0, shot=1, plus any parameter
// of the look as p.<name>=<value> (see params.js).
import { WebGLRenderer, Scene, Clock } from 'three';
import { loadData } from './data.js';
import { Terrain } from './terrain.js';
import { Chunks } from './chunks.js';
import { AlbumCamera } from './camera.js';
import { createParams } from './params.js';
import { Post } from './post.js';

const q = new URLSearchParams(location.search);
const SHOT = q.get('shot') === '1';
const canvas = document.getElementById('view');
const step = t => { document.getElementById('ld-step').textContent = t; };
// opened as the game («Играть» in the launcher: view=game, mapview.js) the page is the game, not the album
if (q.get('view') === 'game') { document.title = 'Passionaris'; const t = document.querySelector('#loading .ld-title'); if (t) t.textContent = 'Passionaris'; }

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new Scene();
// overlay: what is drawn over the finished picture, after the finishing pass (the clouds: layers/clouds.js)
const overlay = new Scene();
const album = window.__album = { ready: false, shot: SHOT, renderer, scene, overlay, fps: 0, layers: {} };

async function start() {
  const data = album.data = await loadData(step);
  step('сцена');
  step('чанки'); const tChunks = performance.now();
  // the lakes of the water aspect are cut out of the land as chunks of their own (the shoals in the list are not lakes)
  // (data.worked: the mask of the worked land from the loader — at stage 3 chunks are made only under it; at stage 2
  // there is none, and every square of the lattice has its chunks)
  const lakes = await fetch('assets/album/water/lakes.json').then(r => r.json()).then(j => (j.lakes || []).filter(l => !l.shoal && l.ring)).catch(() => []);
  const chunks = album.chunks = new Chunks(data.base.at, data.vectors.rivers, lakes, data.worked); album.chunkMs = Math.round(performance.now() - tChunks);
  const terrain = album.terrain = new Terrain(data, scene, chunks);
  // (the up and down arrows turn the pages in the album and move the map when the map is shown on its own)
  const cam = album.cam = new AlbumCamera(canvas, data.base.at, { shot: SHOT, upDown: () => q.get('ui') === '0' || document.body.classList.contains('mapview') });
  const params = album.params = createParams(album);

  // the fine heights under the camera: a window of fine tiles in the mountains, or the square of a showcase place
  // (data.js, detailFor — the part «Земля и лес»); undefined: nothing to change
  async function pickDetail(s) { const d = await data.detailFor(s); if (d !== undefined) terrain.setDetail(d); }
  // The camera flies over the whole Earth, and a part may meet a place it has no data for. A part that fails does
  // not stop the picture: its error is written down once (album.broken, the console), the frame goes on.
  album.broken = {};
  const failed = (name, e) => { if (!album.broken[name]) { album.broken[name] = String(e?.stack || e); console.error(`[album] ${name} failed`, e); } };
  const safe = (name, fn) => { try { return fn(); } catch (e) { failed(name, e); } };
  cam.on(s => { safe('terrain', () => terrain.update(s)); pickDetail(s).catch(e => failed('detail', e)); });

  const { initLayers } = await import('./layers.js');
  await initLayers(album);
  const { initPages } = await import('./pages.js');
  initPages(album, q);
  if (q.get('ui') !== '0') { const { initUI } = await import('./ui.js'); initUI(album); }
  // the map on its own — the view the album opens in (mapview.js): the modes of the map without the pages and knobs
  if (q.get('ui') !== '0') { const { initMapView } = await import('./mapview.js'); album.mapView = initMapView(album, q); }
  // the switch of light on that panel: «Прежний · Утро · День · Вечер · Ночь» (sky/lightswitch.js)
  if (q.get('ui') !== '0') { const { mountLightSwitch } = await import('./sky/lightswitch.js'); mountLightSwitch(album); }

  // camera from the URL wins over the page's own camera
  const num = k => (q.has(k) ? +q.get(k) : undefined), c = { lat: num('lat'), lon: num('lon'), h: num('h'), tilt: num('tilt'), heading: num('heading') };
  for (const k of Object.keys(c)) if (c[k] === undefined || Number.isNaN(c[k])) delete c[k];
  if (Object.keys(c).length) cam.set(c, true);
  if (q.get('place')) { const p = data.places.find(x => x.id === q.get('place')); if (p) cam.set({ lat: p.lat, lon: p.lon }, true); }
  // The game opens by day, under a real Sun (the owner, 15.11.2026: «солнце нормально, чтобы работало»). A page of
  // the album keeps the light it was drawn with, and a light given in the URL wins (p.hour=0 is the old light of the map).
  if (q.get('view') === 'game' && !q.has('page') && !q.has('p.hour') && !q.has('p.light')) params.set('light', 'day');
  for (const [k, v] of q) if (k.startsWith('p.')) params.set(k.slice(2), Number.isNaN(+v) ? v : +v);

  const post = album.post = new Post(renderer, terrain.u);
  const clock = new Clock();
  // one picture, with or without the finishing pass (scripts/album/frametime.js times this call)
  album.draw = () => {
    if (params.get('fx')) post.render(scene, cam.cam, cam.s.h, params.get('ao'), params.get('sharp')); else renderer.render(scene, cam.cam);
    if (overlay.children.some(o => o.visible)) { renderer.autoClear = false; renderer.render(overlay, cam.cam); renderer.autoClear = true; }
  };
  let frames = 0, tAcc = 0, t = 0, auto = 1, slow = 0, fast = 0;
  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight, pr = Math.min(devicePixelRatio, 2) * (params.get('renderScale') || 1) * auto;
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) { renderer.setPixelRatio(pr); renderer.setSize(w, h, false); }
    return w / h;
  }
  function frame() {
    const dt = Math.min(clock.getDelta(), .1);
    t += SHOT ? 0 : dt * params.get('play');
    cam.exag = terrain.u.uExag.value;
    cam.update(SHOT ? 1 : dt, size());
    terrain.u.uTime.value = t + (SHOT ? 40 : 0);
    for (const [name, l] of Object.entries(album.layers)) if (l.update) safe(name, () => l.update(dt, t, cam));
    safe('chunks', () => chunks.flush());
    post.setSamples(auto <= .7 ? 0 : 4);
    album.draw();
    if (!SHOT) { // step the picture scale down when frames run late, back up when there is room
      if (dt > .024) { slow++; fast = 0; } else if (dt < .012) { fast++; slow = 0; } else { slow = fast = 0; }
      if (slow > 12 && auto > .5) { auto = Math.max(.5, auto - .1); slow = 0; } else if (fast > 90 && auto < 1) { auto = Math.min(1, auto + .1); fast = 0; }
      album.autoScale = auto;
    }
    frames++; tAcc += dt;
    if (tAcc >= 1) { album.fps = frames / tAcc; frames = 0; tAcc = 0; album.onFps?.(album.fps); }
    requestAnimationFrame(frame);
  }
  terrain.update(cam.s); await pickDetail(cam.s);
  requestAnimationFrame(frame);
  document.getElementById('loading').classList.add('done');
  // captures wait for this flag: a few frames after everything is on screen
  setTimeout(() => { album.ready = true; console.log(`[album] ready fps=${album.fps.toFixed(1)} chunks=${chunks.count} built in ${album.chunkMs} ms`); }, SHOT ? 1500 : 600);
}
start().catch(e => { console.error('[album] failed', e); step('Ошибка: ' + e.message); });
