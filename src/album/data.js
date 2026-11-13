// Loads what scripts/album/fetch-data.mjs baked into public/album-data/ (heights, vectors) and the part of the ground
// that lies in the repository, public/assets/album/ground/: the climate (scripts/album/bake-ground.mjs) and the grain
// of the ground (scripts/album/bake-ground-tiles.mjs).
import { DataTexture, RedFormat, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, DataUtils, TextureLoader } from 'three';
import { mercX, mercY } from './geo.js';
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
// rect of a baked mosaic in normalised Web-Mercator: (u0, v0, 1/width, 1/height); uv = (merc − u0v0) * inv
const rectOf = m => { const n = 2 ** m.z; return [m.x0 / n, m.y0 / n, n * 256 / m.w, n * 256 / m.h]; };

export async function loadData(onProgress = () => {}) {
  const meta = await (await fetch(BASE + 'meta.json')).json();
  onProgress('высоты региона');
  const raw = await gunzipU16(BASE + meta.base.file);
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
  return { meta, base, vectors, courses, tex, ground, climate, detail, places: meta.places };
}
