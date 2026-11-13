// The climate under the ground of the album (docs/album/ground.md): how wet a place is, how dry its summer, how warm.
// Baked from open data by scripts/album/bake-ground.mjs into public/assets/album/ground/climate.bin.gz and read here —
// by the ground shader as one texture (CLIMATE_GLSL in glsl.js), by the rules on the CPU through wetAt() and its like.
// Without the file the old formula fitted to Iberia by hand answers instead, so nothing breaks.
//
// The file, little-endian, after gunzip:
//   bytes 0..3   'PGC1'
//   Uint16       cells a side (n)
//   Uint16       0
//   Float32 × 3  x0, y0 — the south-west corner in flat km (chunks.js); km — the side of a cell
//   Uint32       0
//   n × n × 4 bytes, rows from the south: wet, summer, warm, year (see the scales below)

export const CLIM_N = 256, CLIM_MAGIC = 'PGC1';
export const LAPSE = .0064;                     // °C per metre of height
export const WARM = [5, 45], YEAR = [-5, 35];   // °C at sea level that bytes 0 and 255 stand for
const HEAD = 24;
const clamp01 = v => Math.max(0, Math.min(1, v));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The moisture index α (share of the evaporation demand of the year that is met) → the scale the album paints with.
// The steps of that scale are those of the forest rules (aspects/forest.js): under .2 nothing but steppe, .34 open
// woodland, .58 closed forest. They are set where the land really changes: closed forest from α .8 (the Atlantic rim,
// Gascony, the mountains), half-open oak and pine country around .7 (the high plateaux of Soria and Burgos), open
// woodland from .5 (the dehesa of the west, the foot of the sierras), steppe below, desert under .3.
export const WET_OF = [[0, 0], [.2, .05], [.3, .12], [.4, .2], [.5, .30], [.62, .40], [.75, .50], [.82, .62], [.9, .80], [1, 1]];
export function wetOfAlpha(a) {
  for (let i = 1; i < WET_OF.length; i++) if (a <= WET_OF[i][0]) { const [a0, w0] = WET_OF[i - 1], [a1, w1] = WET_OF[i]; return w0 + (w1 - w0) * (a - a0) / (a1 - a0); }
  return 1;
}

export function encodeClimate({ x0, y0, km, wet, summer, warm, year }) {
  const n = Math.round(Math.sqrt(wet.length)), out = new Uint8Array(HEAD + n * n * 4), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CLIM_MAGIC.charCodeAt(i);
  dv.setUint16(4, n, true); dv.setFloat32(8, x0, true); dv.setFloat32(12, y0, true); dv.setFloat32(16, km, true);
  const byte = (v, lo, hi) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)));
  for (let o = 0; o < n * n; o++) {
    out[HEAD + o * 4] = byte(wet[o], 0, 1); out[HEAD + o * 4 + 1] = byte(summer[o], 0, 1);
    out[HEAD + o * 4 + 2] = byte(warm[o], ...WARM); out[HEAD + o * 4 + 3] = byte(year[o], ...YEAR);
  }
  return out;
}
// the gunzipped file → { n, x0, y0, km, data: bytes n × n × 4 (wet, summer, warm, year) }, or null if it is not one
export function decodeClimate(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.length < HEAD || String.fromCharCode(u[0], u[1], u[2], u[3]) !== CLIM_MAGIC) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), n = dv.getUint16(4, true);
  if (u.length < HEAD + n * n * 4) return null;
  return { n, x0: dv.getFloat32(8, true), y0: dv.getFloat32(12, true), km: dv.getFloat32(16, true), data: u.subarray(HEAD, HEAD + n * n * 4) };
}

// ---- the climate in use: one for the page (the album sets it once the file is read; tests set their own)
let CLIM = null;
export function useClimate(c) { CLIM = c || null; }
export const climateInUse = () => CLIM;

const KMD = 111.195, COS = Math.cos(40 * Math.PI / 180);   // flat km, as in chunks.js and geo.js
// the four numbers at a place, joined smoothly between the cells: [wet, summer, warm °C, year °C], or null without data
export function climateAt(lat, lon, c = CLIM) {
  if (!c) return null;
  const x = Math.max(0, Math.min(c.n - 1, (lon * KMD * COS - c.x0) / c.km - .5)), y = Math.max(0, Math.min(c.n - 1, (lat * KMD - c.y0) / c.km - .5));
  const i = Math.min(c.n - 2, Math.floor(x)), j = Math.min(c.n - 2, Math.floor(y)), fx = x - i, fy = y - j, d = c.data, o = (j * c.n + i) * 4, r = c.n * 4;
  const at = b => ((d[o + b] * (1 - fx) + d[o + 4 + b] * fx) * (1 - fy) + (d[o + r + b] * (1 - fx) + d[o + r + 4 + b] * fx) * fy) / 255;
  return [at(0), at(1), WARM[0] + at(2) * (WARM[1] - WARM[0]), YEAR[0] + at(3) * (YEAR[1] - YEAR[0])];
}

// the formula the album used before the climate was baked: fitted to Iberia by hand. It answers where there is no data.
export function wetFormula(lat, lon) {
  const g = (la, lo, s) => Math.exp(-((lat - la) ** 2 + (lon - lo) ** 2) / s);
  return .42 + .34 * ss(42.2, 43.4, lat) * ss(-.5, -2.5, lon) + .30 * ss(-6.2, -8.6, lon) * ss(38.2, 41.8, lat)
    + .22 * ss(42, 43.2, lat) * ss(3.5, .5, lon) + .25 * ss(43, 44.5, lat)
    - .24 * g(41.6, -.6, 1.7) - .30 * g(37.6, -1.8, 2.2) - .12 * g(39.3, -3, 2.6);
}
// How much wetter a place is for standing above the country around it (hRef: mean height of that country, m). The
// baked wetness belongs to the mean height of its cell; a summit above it is cooler and catches more rain.
export const WET_RISE = .00013, WET_RISE_MIN = -.06, WET_RISE_MAX = .2;
export const wetRise = dh => Math.max(WET_RISE_MIN, Math.min(WET_RISE_MAX, dh * WET_RISE));
// The CPU twin of albumWet() in glsl.js, without its noise: 0 desert .. 1 Atlantic forest.
//   h: height of the place, m;  hRef: mean height of the country around it (as the texture holds it), by default h
export function wetAt(lat, lon, h = 0, hRef = h) {
  const c = climateAt(lat, lon);
  return c ? c[0] + wetRise(h - hRef) : wetFormula(lat, lon) + h * .00016;
}
// 0 a summer without water .. 1 a green summer
export function summerAt(lat, lon) { const c = climateAt(lat, lon); return c ? c[1] : clamp01(wetFormula(lat, lon) * 1.5 - .45); }
// mean temperature of the warmest month and of the year at a height, °C
export function warmAt(lat, lon, h = 0) { const c = climateAt(lat, lon); return (c ? c[2] : 29.5 - (lat - 37) * .75) - LAPSE * h; }
export function yearAt(lat, lon, h = 0) { const c = climateAt(lat, lon); return (c ? c[3] : 17.5 - (lat - 38) * .75) - LAPSE * h; }
// Trees stop where the warmest month is cooler than 10 °C (the old rule of the foresters; Körner's 6.4 °C of the
// growing season says nearly the same). Height of that line, m.
// In the hot dry mountains of the south that line would lie above 3000 m, and there drought and wind stop the trees
// first: above TREE_SOFT the line rises only TREE_SOFT_K as fast. (Cantabrian range about 1650 m, Pyrenees 2280 m,
// Sierra Nevada 2580 m.)
export const TREE_WARM = 9.5, TREE_SOFT = 2200, TREE_SOFT_K = .35;
export const treelineOf = warm => { const t = (warm - TREE_WARM) / LAPSE; return t < TREE_SOFT ? t : TREE_SOFT + (t - TREE_SOFT) * TREE_SOFT_K; };
export function treelineAt(lat, lon) { const c = climateAt(lat, lon); return c ? treelineOf(c[2]) : 2150; }

// ---- the climate as the shaders read it: one picture of n × n texels over the square of the chunks, 4 bytes each —
// mean height of the land around / 4096 m (counted here, from the heights of the album), wet, warm, summer
//   heightAt(lat, lon) → m;  rect: { x0, y0, side } of the square in flat km
export function climateTexels(heightAt, rect, c = CLIM, n = CLIM_N) {
  const out = new Uint8Array(n * n * 4), cell = rect.side / n, land = new Float32Array(n * n), has = new Uint8Array(n * n);
  // mean height of the land of every cell, then of the three by three cells around it: the country a place stands in
  for (let j = 0, o = 0; j < n; j++) for (let i = 0; i < n; i++, o++) {
    let sum = 0, cnt = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) { const x = rect.x0 + (i + (a + .5) / 2) * cell, y = rect.y0 + (j + (b + .5) / 2) * cell, h = heightAt(y / KMD, x / (KMD * COS)); if (h > 0) { sum += h; cnt++; } }
    if (cnt) { land[o] = sum / cnt; has[o] = 1; }
  }
  for (let j = 0, o = 0; j < n; j++) for (let i = 0; i < n; i++, o++) {
    let sum = 0, cnt = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n || jj >= n || !has[jj * n + ii]) continue; sum += land[jj * n + ii]; cnt++; }
    const q = [(rect.y0 + (j + .5) * cell) / KMD, (rect.x0 + (i + .5) * cell) / (KMD * COS)], v = climateAt(q[0], q[1], c);
    out[o * 4] = cnt ? Math.min(255, Math.round(sum / cnt / 4096 * 255)) : 0;
    out[o * 4 + 1] = Math.round(clamp01(v ? v[0] : wetFormula(q[0], q[1])) * 255);
    out[o * 4 + 2] = Math.round(clamp01(((v ? v[2] : 29.5 - (q[0] - 37) * .75) - WARM[0]) / (WARM[1] - WARM[0])) * 255);
    out[o * 4 + 3] = Math.round(clamp01(v ? v[1] : wetFormula(q[0], q[1]) * 1.5 - .45) * 255);
  }
  return out;
}
