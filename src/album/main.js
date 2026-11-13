// The graphics album (docs/ALBUM.md): a real 3D map of Iberia and southern France whose looks the owner can switch,
// tune and rate. URL keys for captures: page, lat, lon, h, tilt, heading, place, ui=0, shot=1, plus any parameter
// of the look as p.<name>=<value> (see params.js).
import { WebGLRenderer, Scene, Clock } from 'three';
import { loadData } from './data.js';
import { Terrain } from './terrain.js';
import { Chunks } from './chunks.js';
import { AlbumCamera } from './camera.js';
import { distKm } from './geo.js';
import { createParams } from './params.js';
import { Post } from './post.js';

const q = new URLSearchParams(location.search);
const SHOT = q.get('shot') === '1';
const canvas = document.getElementById('view');
const step = t => { document.getElementById('ld-step').textContent = t; };

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new Scene();
const album = window.__album = { ready: false, shot: SHOT, renderer, scene, fps: 0, layers: {} };

async function start() {
  const data = album.data = await loadData(step);
  step('сцена');
  step('чанки'); const tChunks = performance.now();
  // the lakes of the water aspect are cut out of the land as chunks of their own (the shoals in the list are not lakes)
  const lakes = await fetch('assets/album/water/lakes.json').then(r => r.json()).then(j => (j.lakes || []).filter(l => !l.shoal && l.ring)).catch(() => []);
  const chunks = album.chunks = new Chunks(data.base.at, data.vectors.rivers, lakes); album.chunkMs = Math.round(performance.now() - tChunks);
  const terrain = album.terrain = new Terrain(data, scene, chunks);
  const cam = album.cam = new AlbumCamera(canvas, data.base.at);
  const params = album.params = createParams(album);

  // the nearest showcase place lends its fine heights when the camera is low over it
  let detailId = null;
  async function pickDetail(s) {
    let best = null, bd = 1e9;
    for (const p of data.places) { const d = distKm(s, p); if (d < bd) { bd = d; best = p; } }
    const id = best && bd < 70 && s.h < 420 ? best.id : null;
    if (id === detailId) return;
    detailId = id;
    const d = id ? await data.detail(id) : null;
    if (detailId === id) terrain.setDetail(d);
  }
  cam.on(s => { terrain.update(s); pickDetail(s); });

  const { initLayers } = await import('./layers.js');
  await initLayers(album);
  const { initPages } = await import('./pages.js');
  initPages(album, q);
  if (q.get('ui') !== '0') { const { initUI } = await import('./ui.js'); initUI(album); }
  // the map on its own — the view the album opens in (mapview.js): the modes of the map without the pages and knobs
  if (q.get('ui') !== '0') { const { initMapView } = await import('./mapview.js'); album.mapView = initMapView(album, q); }

  // camera from the URL wins over the page's own camera
  const num = k => (q.has(k) ? +q.get(k) : undefined), c = { lat: num('lat'), lon: num('lon'), h: num('h'), tilt: num('tilt'), heading: num('heading') };
  for (const k of Object.keys(c)) if (c[k] === undefined || Number.isNaN(c[k])) delete c[k];
  if (Object.keys(c).length) cam.set(c, true);
  if (q.get('place')) { const p = data.places.find(x => x.id === q.get('place')); if (p) cam.set({ lat: p.lat, lon: p.lon }, true); }
  for (const [k, v] of q) if (k.startsWith('p.')) params.set(k.slice(2), Number.isNaN(+v) ? v : +v);

  const post = new Post(renderer);
  const clock = new Clock();
  // one picture, with or without the finishing pass (scripts/album/frametime.js times this call)
  album.draw = () => { if (params.get('fx')) post.render(scene, cam.cam, cam.s.h, params.get('ao'), params.get('sharp')); else renderer.render(scene, cam.cam); };
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
    for (const l of Object.values(album.layers)) l.update?.(dt, t, cam);
    chunks.flush();
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
  if (detailId) await data.detail(detailId);
  requestAnimationFrame(frame);
  document.getElementById('loading').classList.add('done');
  // captures wait for this flag: a few frames after everything is on screen
  setTimeout(() => { album.ready = true; console.log(`[album] ready fps=${album.fps.toFixed(1)} chunks=${chunks.count} built in ${album.chunkMs} ms`); }, SHOT ? 1500 : 600);
}
start().catch(e => { console.error('[album] failed', e); step('Ошибка: ' + e.message); });
