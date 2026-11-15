// Bakes the mask of the WORKED LAND (docs/BACKLOG.md, «Этап 3»): where the map is made in detail — chunks, districts,
// roads, settlements — and where it is the simple land of the world. One byte for every square kilometre of the
// lattice of the chunks:
//   0 — the world (simple land or open sea)   1 — worked land   2 — its water: the lakes inside it and the sea within
//   SEA_KM of its coast, but not beyond the middle line with land that is not worked (the Channel, Sardinia, Sicily)
// The worked land, by the owner's words of 15.11.2026 (regions are lands, not states; their borders are natural):
//   Iberia          Spain with the Balearics (not the Canaries), Portugal, Andorra, Gibraltar
//   Western Europe  France without Corsica, Monaco, the Channel Islands, Belgium, the Netherlands, Luxembourg,
//                   Germany on the left bank of the Rhine from Lauterbourg down to the Dutch border
//   the Maghreb     Morocco, Algeria and Tunisia north of the edge of the Sahara (the line of the division session)
// Land is taken from the outlines of the countries of Natural Earth, not from the heights: a polder below the sea
// is land. Lakes are those of Natural Earth without the reservoirs.
//   node scripts/album/bake-worked.mjs [preview.png]
//   → public/assets/album/worked.bin.gz: Int32 x0, y0, w, h (km of the plane of chunks.js, kmOf), then w·h bytes,
//     rows from the south to the north
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { KM_PER_DEG, COS_REF } from '../../src/album/geo.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MAIN = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
const RAW = [join(ROOT, 'data', 'raw'), join(MAIN, 'data', 'raw')].find(d => existsSync(join(d, 'ne_10m_admin_0_countries.geojson')));
const OUT = join(ROOT, 'public', 'assets', 'album', 'worked.bin.gz');

// the lattice: squares of 1 km over the rectangle of the detailed heights (192 × 280 natural cells of 10 km)
export const GRID = { x0: -880, y0: 3240, w: 1920, h: 2800 };
export const SEA_KM = 100;
const KX = KM_PER_DEG * COS_REF, KY = KM_PER_DEG;
const gx = lon => lon * KX - GRID.x0, gy = lat => lat * KY - GRID.y0;

// the southern edge of the Maghreb, west to east: [lat, lon]; worked land lies north of it (division session, 15.11.2026)
export const SAHARA_EDGE = [[29.38, -10.25], [29.45, -9.6], [29.65, -7.97], [30.05, -6.87], [30.25, -5.84], [30.95, -4.0], [31.9, -3.0], [32.05, -1.23],
  [32.6, -0.6], [33.05, 1.25], [33.7, 2.9], [34.0, 3.5], [34.35, 5.05], [34.6, 5.9], [34.5, 6.6], [34.4, 7.45], [33.75, 7.6], [33.2, 8.4], [33.2, 9.2],
  [32.7, 10.4], [32.6, 11.0], [32.9, 11.6]];
const WHOLE = new Set(['Portugal', 'Andorra', 'Gibraltar', 'Monaco', 'Jersey', 'Guernsey', 'Belgium', 'Netherlands', 'Luxembourg']);
const MAGHREB = new Set(['Morocco', 'Algeria', 'Tunisia']);

const rd = f => JSON.parse(readFileSync(join(RAW, f), 'utf8')).features;
const polysOf = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const n = GRID.w * GRID.h;

// fills the squares whose middle lies inside a polygon (rings in [lon, lat]; even-odd, so holes stay empty)
function fill(poly, put) {
  const rings = poly.map(r => r.map(p => [gx(p[0]), gy(p[1])]));
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
  for (const p of rings[0]) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
  if (y1 < 0 || y0 > GRID.h || x1 < 0 || x0 > GRID.w) return;
  const xs = [];
  for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(GRID.h - 1, Math.ceil(y1)); j++) {
    const y = j + .5; xs.length = 0;
    for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const p = r[a], q = r[b];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k] - .5)); i <= Math.min(GRID.w - 1, Math.ceil(xs[k + 1] - .5) - 1); i++) put(j * GRID.w + i, i, j);
    }
  }
}
// > 0 when the point lies to the left of the line as it runs (by its nearest stretch); the line is [[x, y], …] in squares
function leftOf(line, px, py) {
  let best = 1e30, side = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)), ex = a[0] + t * dx - px, ey = a[1] + t * dy - py, d = ex * ex + ey * ey;
    if (d < best) { best = d; side = dx * (py - a[1]) - dy * (px - a[0]); }
  }
  return side;
}
const centre = ring => { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; };

// ---- the Rhine, downstream: the Upper Rhine from the Untersee to Lauterbourg, then on to the sea
const rhine = [];
{
  const parts = {};
  for (const f of rd('ne_10m_rivers_lake_centerlines.geojson')) {
    const name = f.properties.name; if (name !== 'Rhin' && name !== 'Rhine') continue;
    for (const l of f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) if (!parts[name] || l.length > parts[name].length) parts[name] = l;
  }
  if (!parts.Rhin || !parts.Rhine) throw new Error('bake-worked: no line of the Rhine in Natural Earth');
  for (const l of [parts.Rhin, parts.Rhine]) { const up = l[0][1] < l[l.length - 1][1] ? l : [...l].reverse(); for (const p of up) rhine.push([gx(p[0]), gy(p[1])]); }
}
const sahara = SAHARA_EDGE.map(([lat, lon]) => [gx(lon), gy(lat)]);
const RHINE_FROM = gy(48.95);   // north of Lauterbourg the river divides Germany; south of it it is the border of France

// ---- land of every country, and which of it is worked
const land = new Uint8Array(n), mask = new Uint8Array(n), stats = {};
for (const f of rd('ne_10m_admin_0_countries.geojson')) {
  const name = f.properties.ADMIN || f.properties.NAME;
  for (const poly of polysOf(f.geometry)) {
    const [clon, clat] = centre(poly[0]);
    let rule = null;                                   // null: not worked · true: all of it · a function of the square
    if (WHOLE.has(name)) rule = true;
    else if (name === 'Spain') rule = clat > 30 && clon > -12;                             // not the Canaries
    else if (name === 'France') rule = !(clon > 8.4 && clon < 9.7 && clat > 41.2 && clat < 43.1);   // not Corsica
    else if (name === 'Germany') rule = (i, j) => j + .5 > RHINE_FROM && leftOf(rhine, i + .5, j + .5) > 0;
    else if (MAGHREB.has(name)) rule = (i, j) => leftOf(sahara, i + .5, j + .5) > 0;
    fill(poly, (t, i, j) => {
      land[t] = 1;
      if (rule === true || (typeof rule === 'function' && rule(i, j))) { if (!mask[t]) stats[name] = (stats[name] || 0) + 1; mask[t] = 1; }
    });
  }
}
// ---- lakes inside the worked land
let lakeSq = 0;
for (const f of rd('ne_10m_lakes.geojson')) {
  if (f.properties.featurecla === 'Reservoir') continue;
  for (const poly of polysOf(f.geometry)) fill(poly, t => { if (mask[t] === 1) { mask[t] = 2; lakeSq++; } });
}
// ---- the sea: within SEA_KM of the worked coast and nearer to it than to any other land
// squared distance to the nearest marked square (Felzenszwalb and Huttenlocher), in squares
function distance(marked) {
  const { w, h } = GRID, INF = 1e12, d = new Float64Array(n), f = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  for (let t = 0; t < n; t++) d[t] = marked(t) ? 0 : INF;
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; set(q, (q - p) * (q - p) + f[p]); }
  };
  for (let x = 0; x < w; x++) pass(h, q => d[q * w + x], (q, val) => { d[q * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, q => d[y * w + q], (q, val) => { d[y * w + q] = val; });
  return d;
}
const dWorked = distance(t => mask[t] === 1 || mask[t] === 2), dOther = distance(t => land[t] === 1 && mask[t] === 0);
let seaSq = 0;
for (let t = 0; t < n; t++) if (!land[t] && dWorked[t] <= SEA_KM * SEA_KM && dWorked[t] <= dOther[t]) { mask[t] = 2; seaSq++; }

// ---- write
const head = new Int32Array([GRID.x0, GRID.y0, GRID.w, GRID.h]);
mkdirSync(dirname(OUT), { recursive: true });
const gz = gzipSync(Buffer.concat([Buffer.from(head.buffer), Buffer.from(mask.buffer)]), { level: 9 });
writeFileSync(OUT, gz);
// true areas: a square of the plane is cos(lat) / cos(40°) km² on the ground
let flat = 0, real = 0;
for (let j = 0; j < GRID.h; j++) { const c = Math.cos((GRID.y0 + j + .5) / KY * Math.PI / 180) / COS_REF; for (let i = 0; i < GRID.w; i++) if (mask[j * GRID.w + i] === 1) { flat++; real += c; } }
console.log(`worked land: ${flat} squares, ${Math.round(real / 1000)} thousand km² on the ground; lakes ${lakeSq}, sea ${seaSq} squares`);
console.log(Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`→ ${OUT}: ${(gz.length / 1024).toFixed(0)} KB`);

// ---- a picture to check by eye: north up, half size
const png = process.argv[2];
if (png) {
  const sharp = (await import('sharp')).default, rgb = Buffer.alloc(n * 3);
  const COL = { world: [34, 46, 78], other: [112, 112, 104], land: [96, 168, 84], water: [86, 164, 214] };
  for (let j = 0; j < GRID.h; j++) for (let i = 0; i < GRID.w; i++) {
    const t = j * GRID.w + i, c = mask[t] === 1 ? COL.land : mask[t] === 2 ? COL.water : land[t] ? COL.other : COL.world, o = ((GRID.h - 1 - j) * GRID.w + i) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  }
  await sharp(rgb, { raw: { width: GRID.w, height: GRID.h, channels: 3 } }).resize({ width: GRID.w / 2 }).png().toFile(png);
  console.log('picture →', png);
}
