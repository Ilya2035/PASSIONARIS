// Loads what scripts/album/fetch-data.mjs baked into public/album-data/ (heights, vectors) and the part of the ground
// that lies in the repository, public/assets/album/ground/: the climate (scripts/album/bake-ground.mjs) and the grain
// of the ground (scripts/album/bake-ground-tiles.mjs).
import { DataTexture, RedFormat, RGBAFormat, HalfFloatType, FloatType, UnsignedByteType, NoColorSpace, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, RepeatWrapping, DataUtils, TextureLoader } from 'three';
import { mercX, mercY, distKm, STAGE } from './geo.js';
import { loadWorked } from './worked.js';
import { decodeTile, windowFor, windowRect, joinWindow, tilesOf, FINE_Z, WIN } from './ground/fine.js';
import { despike } from './ground/despike.js';
import { loadCourses, mainRivers } from './water/courses.js';
import { fillHollows } from './water/hollows.js';
import { decodeClimate, useClimate, decodeWorldClimate, ICE_STEP } from './ground/climate.js';
import { WMAP_W, WMAP_H, decodeWorldHeights, raiseIce, capSouth, fitWorld, joinHeights } from './ground/world.js';

const BASE = 'album-data/', GROUND = 'assets/album/ground/', WORLD = 'assets/map/height.delta.bin.gz';
// the grain of the ground: the layers of the ground texture, in their order there (terrain.js)
export const GROUND_TILES = ['heath', 'steppe', 'stone', 'dunes'];
async function gunzipU16(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint16Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
// A copy of the heights made for a texture — half floats — is needed only until the video card has it. three.js
// keeps the array of a DataTexture for as long as the texture lives; nothing here sends a height texture twice, so
// the array is let go right after the first upload (the renderer calls onUpdate when it has sent the texture). Now
// that is 55 MB of the base and 67 MB of the world map; with the base of stage 3 (8192 × 12288) it is 200 MB.
// (After a lost WebGL context such a texture cannot be sent again: the page has to be loaded anew.)
export const sentOnce = t => { t.onUpdate = () => { t.image.data = null; t.onUpdate = null; }; return t; };
function heightTexture(u16, w, h) {
  const hf = new Uint16Array(u16.length);
  for (let i = 0; i < u16.length; i++) hf[i] = DataUtils.toHalfFloat(u16[i] / 4 - 8192);
  const t = new DataTexture(hf, w, h, RedFormat, HalfFloatType);
  t.internalFormat = 'R16F'; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return sentOnce(t);
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
// ---- the whole Earth beyond the polygon (ground/world.js): its heights and its climate as textures. Both wrap round
// the Earth from east to west and stop at the poles.
// (The heights are whole metres; as half floats they are exact up to 2048 m and go by 2 and 4 m above — far finer
// than a map with a point every 4.9 km needs. A table turns them: 33 million calls of a function would take seconds.)
function worldHeightTexture(h, w, rows) {
  const half = new Uint16Array(65536), hf = new Uint16Array(h.length);
  for (let v = -32768; v < 32768; v++) half[v & 65535] = DataUtils.toHalfFloat(v);
  for (let i = 0; i < h.length; i++) hf[i] = half[h[i] & 65535];
  const t = new DataTexture(hf, w, rows, RedFormat, HalfFloatType);
  t.internalFormat = 'R16F'; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return sentOnce(t);
}
function worldClimateTexture(c) {
  const t = new DataTexture(c.data, c.w, c.h, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
// → { h: Int16 metres, w, rows, tex, clim: the climate as a texture or null }, or null when the height map is missing
// (then everything beyond the polygon is deep sea, as before)
async function loadWorld() {
  try {
    const r = await fetch(WORLD);
    if (!r.ok) throw new Error(`${WORLD}: ${r.status}`);
    const h = decodeWorldHeights(new Int16Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()));
    if (h.length !== WMAP_W * WMAP_H) throw new Error(`${WORLD}: ${h.length} points`);
    let clim = null, iced = false;
    try {
      const c = await fetch(GROUND + 'world.bin.gz');
      if (c.ok) {
        const d = decodeWorldClimate(await new Response(c.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        if (d) { clim = worldClimateTexture(d); raiseIce(h, d.ice, d.w, d.h, ICE_STEP); iced = true; }   // the ice sheets: the map holds the rock under them
      }
    } catch (e) { console.warn('[album] no climate of the world:', e.message); }
    if (!iced) capSouth(h);                                         // (without the ice the copied rows round the south pole are a fan of ridges)
    return { h, w: WMAP_W, rows: WMAP_H, tex: null, clim };        // (the texture is made in loadData(), once the map is fitted to the polygon)
  } catch (e) { console.warn('[album] no heights of the world:', e.message); return null; }
}
// rect of a baked mosaic in normalised Web-Mercator: (u0, v0, 1/width, 1/height); uv = (merc − u0v0) * inv
const rectOf = m => { const n = 2 ** m.z; return [m.x0 / n, m.y0 / n, n * 256 / m.w, n * 256 / m.h]; };

export async function loadData(onProgress = () => {}) {
  const worldJob = loadWorld();                                     // (36 MB: read while everything else loads)
  const meta = await (await fetch(BASE + 'meta.json')).json();
  onProgress('высоты региона');
  const raw = await gunzipU16(BASE + meta.base.file);
  // (The base of stage 3 is written already mended — despike, mendPockets, fillHollows, in that order, by the script
  // that bakes it — and says so in meta.json: then nothing is mended here. Mending it again would change nothing —
  // tests/album-despike.test.mjs — but takes a second and a half on a hundred million points.)
  if (!(meta.mended || meta.base.mended)) {
    despike(raw, meta.base.w, meta.base.h);                         // needles and wells of broken points on the coast (ground/despike.js)
    fillHollows(raw, meta.base.w, meta.base.h);                     // dips below zero that the sea cannot reach are land, not ponds of sea
  }
  const base = { ...meta.base, raw, rect: rectOf(meta.base), tex: heightTexture(raw, meta.base.w, meta.base.h) };
  // bilinear height in metres on the CPU (roads, towns, rivers, picking): inside the polygon; base.at itself, set
  // below, answers for the whole Earth
  const regionAt = (lat, lon) => {
    const x = Math.max(0, Math.min(base.w - 1.001, (mercX(lon) - base.rect[0]) * base.rect[2] * base.w - 0.5));
    const y = Math.max(0, Math.min(base.h - 1.001, (mercY(lat) - base.rect[1]) * base.rect[3] * base.h - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * base.w + i;
    const a = raw[k], b = raw[k + 1], c = raw[k + base.w], d = raw[k + base.w + 1];
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 4 - 8192;
  };
  onProgress('высоты мира');
  const world = await worldJob;
  // round the polygon the world map is made to agree with the polygon's own heights (ground/world.js), then it
  // becomes a texture
  if (world) { fitWorld(world.h, regionAt); world.tex = worldHeightTexture(world.h, world.w, world.rows); }
  // the height of any place of the Earth, m: the polygon's own inside it, the world map beyond (ground/world.js)
  base.at = joinHeights(regionAt, world?.h || null);
  onProgress('реки и поселения');
  const vectors = await (await fetch(BASE + 'vectors.json')).json();
  // the real courses of the rivers (the water work); those who only ask where a river runs get the greater ones as lines
  const courses = await loadCourses('assets/album/water/rivers.bin.gz');
  if (courses) { vectors.riversCoarse = vectors.rivers; vectors.rivers = mainRivers(courses); }
  // The mask of the worked land (worked.js): (lat, lon) → 0 the world, 1 worked land, 2 its water. At stage 3 the
  // chunks are made under it alone (chunks.js; main.js hands it to them); at stage 2 there is none — every cell of
  // the lattice has its chunk, as it always had.
  let worked = null;
  if (STAGE >= 3) { try { worked = (await loadWorked()).at; } catch (e) { console.warn('[album] no mask of the worked land,', e.message); } }
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
  return { meta, base, world, worked, vectors, courses, tex, ground, climate, detail, detailFor, fineIdle, places: meta.places };
}
