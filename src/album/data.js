// Loads what scripts/album/fetch-data.mjs baked into public/album-data/ (heights, vectors) and the part of the ground
// that lies in the repository, public/assets/album/ground/: the climate (scripts/album/bake-ground.mjs) and the grain
// of the ground (scripts/album/bake-ground-tiles.mjs).
import { DataTexture, RedFormat, HalfFloatType, FloatType, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, DataUtils, TextureLoader } from 'three';
import { mercX, mercY, distKm } from './geo.js';
import { decodeTile, windowFor, windowRect, joinWindow, tilesOf, FINE_Z, WIN } from './ground/fine.js';
import { despike } from './ground/despike.js';
import { loadCourses, mainRivers } from './water/courses.js';
import { fillHollows } from './water/hollows.js';
import { decodeClimate, useClimate } from './ground/climate.js';

const BASE = 'album-data/', GROUND = 'assets/album/ground/';
// the grain of the ground: the layers of the ground texture, in their order there (terrain.js)
export const GROUND_TILES = ['heath', 'steppe', 'stone', 'dunes'];
async function gunzipU16(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint16Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function heightTexture(u16, w, h) {
  const hf = new Uint16Array(u16.length);
  for (let i = 0; i < u16.length; i++) hf[i] = DataUtils.toHalfFloat(u16[i] / 4 - 8192);
  const t = new DataTexture(hf, w, h, RedFormat, HalfFloatType);
  t.internalFormat = 'R16F'; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
// The heights of a window of fine tiles (ground/fine.js) as a texture: m is metres, n points a side. Whole floats
// where the video card can smooth them — it nearly always can. A half float holds a height above 2048 m only to 2 m;
// with a point every 57 m that is a slope in steps of 2°, terraces on the gentle ground of the high mountains.
let floatOk;
function fineTexture(m, n) {
  if (floatOk === undefined) {
    const gl = document.createElement('canvas').getContext('webgl2');
    floatOk = !!(gl && gl.getExtension('OES_texture_float_linear') && gl.getExtension('EXT_color_buffer_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  let t;
  if (floatOk) { t = new DataTexture(m, n, n, RedFormat, FloatType); t.internalFormat = 'R32F'; }
  else {
    const hf = new Uint16Array(m.length);
    for (let i = 0; i < m.length; i++) hf[i] = DataUtils.toHalfFloat(m[i]);
    t = new DataTexture(hf, n, n, RedFormat, HalfFloatType); t.internalFormat = 'R16F';
  }
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
// rect of a baked mosaic in normalised Web-Mercator: (u0, v0, 1/width, 1/height); uv = (merc − u0v0) * inv
const rectOf = m => { const n = 2 ** m.z; return [m.x0 / n, m.y0 / n, n * 256 / m.w, n * 256 / m.h]; };

export async function loadData(onProgress = () => {}) {
  const meta = await (await fetch(BASE + 'meta.json')).json();
  onProgress('высоты региона');
  const raw = await gunzipU16(BASE + meta.base.file);
  despike(raw, meta.base.w, meta.base.h);                           // needles and wells of broken points on the coast (ground/despike.js)
  fillHollows(raw, meta.base.w, meta.base.h);                       // dips below zero that the sea cannot reach are land, not ponds of sea
  const base = { ...meta.base, raw, rect: rectOf(meta.base), tex: heightTexture(raw, meta.base.w, meta.base.h) };
  // bilinear height in metres on the CPU (roads, towns, rivers, picking)
  base.at = (lat, lon) => {
    const x = Math.max(0, Math.min(base.w - 1.001, (mercX(lon) - base.rect[0]) * base.rect[2] * base.w - 0.5));
    const y = Math.max(0, Math.min(base.h - 1.001, (mercY(lat) - base.rect[1]) * base.rect[3] * base.h - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * base.w + i;
    const a = raw[k], b = raw[k + 1], c = raw[k + base.w], d = raw[k + base.w + 1];
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 4 - 8192;
  };
  onProgress('реки и поселения');
  const vectors = await (await fetch(BASE + 'vectors.json')).json();
  // the real courses of the rivers (the water work); those who only ask where a river runs get the greater ones as lines
  const courses = await loadCourses('assets/album/water/rivers.bin.gz');
  if (courses) { vectors.riversCoarse = vectors.rivers; vectors.rivers = mainRivers(courses); }
  onProgress('климат и земля');
  // the climate under the ground; without the file the rules fall back on the old formula (ground/climate.js)
  let climate = null;
  try {
    const r = await fetch(GROUND + 'climate.bin.gz');
    if (r.ok) climate = decodeClimate(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  } catch (e) { console.warn('[album] no climate of the ground:', e.message); }
  useClimate(climate);
  // the grain of the ground: pictures of 1024 px; a missing one leaves its ground smooth. (The close-up photographs
  // of soil the album began with are no longer read: enlarged a hundred times they were what looked false.)
  const loader = new TextureLoader(), tex = {}, ground = {};
  await Promise.all(GROUND_TILES.map(id => loader.loadAsync(`${GROUND}${id}.webp`).then(x => { ground[id] = x; }).catch(() => {})));
  // detail patches around the showcase places are loaded on demand
  const details = new Map();
  async function detail(id) {
    if (details.has(id)) return details.get(id);
    const p = meta.places.find(q => q.id === id);
    if (!p?.detail) return null;
    const d = gunzipU16(BASE + p.detail.file).then(u => ({ ...p.detail, rect: rectOf(p.detail), tex: heightTexture(u, p.detail.w, p.detail.h) }));
    details.set(id, d);
    return d;
  }
  // ---- the fine heights under the camera: a window of tiles of level 11 in the mountains (ground/fine.js), or the
  // square of a showcase place where there are no such tiles
  const N = 2 ** FINE_Z, fine = meta.fine?.tiles?.length ? new Set(meta.fine.tiles.map(([x, y]) => x + '_' + y)) : null, tiles = new Map();
  const hasFine = (x, y) => fine.has(x + '_' + y);
  // a fine tile, decoded (a promise), or null where there is none; the last 400 asked for are kept
  function fineTile(x, y) {
    const key = x + '_' + y;
    if (!fine.has(key)) return null;
    let t = tiles.get(key);
    if (t) tiles.delete(key);
    else t = gunzipU16(`${BASE}${meta.fine.dir}${key}.u16d.gz`).then(decodeTile).catch(e => { console.warn('[album] fine tile', key, e.message); return null; });
    tiles.set(key, t);
    if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
    return t;
  }
  // the height of the base at a point of the normalised Mercator plane, m — between four points, as the shader reads it
  const baseAtM = (mx, my) => {
    const x = Math.max(0, Math.min(base.w - 1.001, (mx - base.rect[0]) * base.rect[2] * base.w - .5)), y = Math.max(0, Math.min(base.h - 1.001, (my - base.rect[1]) * base.rect[3] * base.h - .5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * base.w + i;
    return ((raw[k] * (1 - fx) + raw[k + 1] * fx) * (1 - fy) + (raw[k + base.w] * (1 - fx) + raw[k + base.w + 1] * fx) * fy) / 4 - 8192;
  };
  async function fineWindow(win) {
    const n = tilesOf(win.L), got = new Map(), jobs = [];
    for (let y = win.y0; y < win.y0 + n; y++) for (let x = win.x0; x < win.x0 + n; x++) { const t = fineTile(x, y); if (t) jobs.push(t.then(u => { if (u) got.set(x + '_' + y, u); })); }
    await Promise.all(jobs);
    return { z: FINE_Z - win.L, rect: windowRect(win), tex: fineTexture(joinWindow(win, (x, y) => got.get(x + '_' + y) || null, hasFine, baseAtM), WIN) };
  }
  let winNow = null, texNow = null, want = '', busy = 0;
  const idle = [];
  // What the ground should have as its fine heights when the camera looks at s ({ lat, lon, h }). Resolves to the
  // detail for Terrain.setDetail(), to null for none, or to undefined when nothing changes (or a later call has
  // already asked for something else). main.js calls this whenever the camera moves.
  async function detailFor(s) {
    let win = fine ? windowFor(winNow, mercX(s.lon) * N, mercY(s.lat) * N, s.h) : null, id = null;
    if (win && win !== winNow) {                                    // (a window with no fine tile in it is not built: the plains)
      let any = false;
      for (let y = win.y0, n = tilesOf(win.L); y < win.y0 + n && !any; y++) for (let x = win.x0; x < win.x0 + n; x++) if (hasFine(x, y)) { any = true; break; }
      if (!any) win = null;
    }
    if (!win && s.h < 420) { let bd = 70; for (const p of meta.places) if (p.detail) { const d = distKm(s, p); if (d < bd) { bd = d; id = p.id; } } }
    const key = win ? `w${win.L}_${win.x0}_${win.y0}` : id ? 'p' + id : '';
    if (key === want) return undefined;
    want = key; busy++;
    let d = null;
    try { d = win ? await fineWindow(win) : id ? await detail(id) : null; } catch (e) { console.warn('[album] fine heights:', e.message); }
    if (--busy === 0) for (const r of idle.splice(0)) r();
    if (want !== key) { if (win && d) d.tex.dispose(); return undefined; }
    const old = texNow;
    winNow = win && d ? win : null; texNow = win && d ? d.tex : null;
    if (old) setTimeout(() => old.dispose(), 0);                    // (after the ground has taken the new one)
    return d;
  }
  // resolves when no window is being built (captures wait for it after a jump of the camera)
  const fineIdle = () => (busy ? new Promise(r => idle.push(r)) : Promise.resolve());
  return { meta, base, vectors, courses, tex, ground, climate, detail, detailFor, fineIdle, places: meta.places };
}
