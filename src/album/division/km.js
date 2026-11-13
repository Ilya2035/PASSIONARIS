// The chunk of one square kilometre (the owner, 12.11.2026: «чанк — это километр на километр»; «мы делим район на
// чанки, их получается под 500»; «чанки могут быть плюс-минус разного размера, но у них ровные края, это не
// квадраты»; «некоторые чанки надо отмечать как нежилые»; «в них должны быть цифры, которые заранее тип генерации
// выстраивают»).
//
// The land and the water lie under a lattice of squares of 1 km: KN × KN of them from (KX0, KY0) of the flat km
// plane. Every square is the home of one chunk. The seed of the chunk stands in its square, a little off the middle,
// and the chunk is the ground OF ITS DISTRICT that lies nearer to its seed than to any other seed of the district. So:
//   • a district is made of whole chunks — as many as it has squares, that is square kilometres;
//   • a chunk is not a square: inside the district its sides are straight pieces half-way between seeds, at the edge
//     of the district its outline is the edge of the district — a river, a crest, the shore;
//   • land and water never share a chunk, because they never share a district.
// A chunk has the number of its square: c = j · KN + i. Anything kept for chunks is an array KN · KN long.
// What a chunk is like is worked out once, from the relief (chunkFacts): how level its ground is, in five classes,
// and whether people can live on it. The order in which a district takes up its chunks is districtOrder().
//
// The natural cells of about 100 km² (../chunks.js) are no longer the chunks of the division. The forest, the ice and
// the swamps are still worked out cell by cell; a chunk reads that state from the cell its middle lies in
// (cellsOfChunks). Plain JavaScript without the GPU: the same land always gives the same chunks.
import { FN, FKM } from '../chunks.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';

export const KKM = 1, KN = 1280, KX0 = -880, KY0 = 3880;
export const JITTER = .3;                           // km: how far a seed may stand from the middle of its square, each way
const LAND = 0;

// a random number 0..1 of a square: integer arithmetic only, the same bits in JS and in GLSL (KM_GLSL below)
export function kmHash(i, j, salt) {
  let h = (Math.imul(i + 7919, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}
export const KM_GLSL = /* glsl */`
#define KM_N ${KN}
#define KM_JIT ${(2 * JITTER).toFixed(3)}
float kmHash(ivec2 c, int salt) {
  uint h = uint(c.x + 7919) * 0x27d4eb2du ^ uint(c.y + 104729) * 0x165667b1u ^ uint(salt + 1) * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float(h >> 8) / 16777216.;
}
// where in its square the seed of a chunk stands, 0..1 each way
vec2 kmSeed(ivec2 c) { return .5 + (vec2(kmHash(c, 1), kmHash(c, 2)) - .5) * KM_JIT; }
`;
// the seed of the chunk of square (i, j), flat km
export const seedOf = (i, j) => [KX0 + (i + .5 + (kmHash(i, j, 1) - .5) * 2 * JITTER) * KKM, KY0 + (j + .5 + (kmHash(i, j, 2) - .5) * 2 * JITTER) * KKM];
// the square a point lies in (−1 outside the lattice) and the middle of a square
export const squareOf = (x, y) => { const i = Math.floor((x - KX0) / KKM), j = Math.floor((y - KY0) / KKM); return i < 0 || j < 0 || i >= KN || j >= KN ? -1 : j * KN + i; };
export const middleOf = c => [KX0 + (c % KN + .5) * KKM, KY0 + (Math.floor(c / KN) + .5) * KKM];

// The chunk a point lies in. cells: the district of every chunk (division/cells.js); d: the district of the point,
// when the caller knows it better (at the shore a point of land may lie in a square of water) — otherwise the
// district of the square the point is in. −1 outside the lattice.
export function chunkAt(cells, x, y, d = undefined) {
  const fx = (x - KX0) / KKM, fy = (y - KY0) / KKM, i0 = Math.floor(fx), j0 = Math.floor(fy);
  if (i0 < 0 || j0 < 0 || i0 >= KN || j0 >= KN) return -1;
  if (d === undefined) d = cells[j0 * KN + i0];
  let best = -1, bd = Infinity;
  // (the squares around; two squares out when none near is of the district: a border line may run a little off the
  // squares, border.js)
  for (let r = 1; r <= 2 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= KN || j >= KN) continue;
    const c = j * KN + i; if (cells[c] !== d) continue;
    const sx = i + .5 + (kmHash(i, j, 1) - .5) * 2 * JITTER - fx, sy = j + .5 + (kmHash(i, j, 2) - .5) * 2 * JITTER - fy, dd = sx * sx + sy * sy;
    if (dd < bd) { bd = dd; best = c; }
  }
  return best >= 0 ? best : j0 * KN + i0;
}

// Which natural cell of chunks.js the middle of every chunk lies in, and how many chunks each cell has: the way
// from a chunk to the state the nature models keep cell by cell, and from a number of a cell to its share in a district.
const CELLS = new WeakMap();
export function cellsOfChunks(ch) {
  let r = CELLS.get(ch); if (r) return r;
  const cell = new Uint16Array(KN * KN), count = new Uint32Array(ch.count);
  for (let j = 0, c = 0; j < KN; j++) {
    const row = Math.min(FN - 1, Math.floor((j + .5) * KKM / FKM)) * FN;
    for (let i = 0; i < KN; i++, c++) { const k = ch.cell[row + Math.min(FN - 1, Math.floor((i + .5) * KKM / FKM))]; cell[c] = k; if (k < ch.count) count[k]++; }
  }
  CELLS.set(ch, r = { cell, count });
  return r;
}

// ---- what the chunks of a division are like (kept with the division: div.km)
// How level the ground of a chunk is, in five classes (the owner: «ровная поверхность — первый класс, менее ровная —
// второй… пятый — это уже горы, невозможно, как и четвёртый, практически невозможно: там мелкие деревушки еле-еле»;
// «в горах, в промежутках гор… должна быть возможность строить города»).
// The chunk is looked at as four quarters of 500 m; each has a slope (rise on a length). The class is that of its
// most level quarter: the floor of a narrow valley between steep walls is ground one can live on, though the walls
// are not, and a quarter of a chunk is room enough for a village. The limits are this work's estimate:
export const CLASS_SLOPE = [.012, .04, .09, .18];    // up to: class 1 level · 2 rolling · 3 hilly · 4 steep; beyond — 5, mountain
export const CLASS_TITLE = ['вода', 'ровная земля', 'пологие холмы', 'холмы и склоны', 'крутые склоны', 'горы'];
export const HIGH_M = 2400;                         // above this a chunk is mountain whatever its slope: bare rock and snow
// who can live there: 2 freely (classes 1–3) · 1 barely, a hamlet at most (class 4) · 0 nobody (class 5, water)
export const livingOf = cls => (cls >= 1 && cls <= 3 ? 2 : cls === 4 ? 1 : 0);

// div: the division with div.cells (district per chunk) and div.raster.hgt (height at the middle of every land
// chunk); heightAt(lat, lon) → metres (missing: only the middles of neighbouring chunks are compared)
// → { cls: Uint8Array (0 water, 1..5), slope: Float32Array (of the most level quarter), steep: Float32Array (of the
//     steepest quarter), num: how many land chunks of each class }
export function chunkFacts(div, heightAt = null) {
  const n = KN * KN, cells = div.cells, kinds = div.kinds, hgt = div.raster.hgt, cls = new Uint8Array(n), slope = new Float32Array(n), steep = new Float32Array(n), num = new Uint32Array(6);
  const land = c => { const d = cells[c]; return d >= 0 && kinds[d] === LAND; };
  const classOf = (h, s) => (h >= HIGH_M ? 5 : s < CLASS_SLOPE[0] ? 1 : s < CLASS_SLOPE[1] ? 2 : s < CLASS_SLOPE[2] ? 3 : s < CLASS_SLOPE[3] ? 4 : 5);
  if (!heightAt) {
    for (let j = 0, c = 0; j < KN; j++) for (let i = 0; i < KN; i++, c++) {
      if (!land(c)) continue;
      const h = hgt[c]; let m = 0;
      if (i > 0 && land(c - 1)) m = Math.max(m, Math.abs(hgt[c - 1] - h)); if (i < KN - 1 && land(c + 1)) m = Math.max(m, Math.abs(hgt[c + 1] - h));
      if (j > 0 && land(c - KN)) m = Math.max(m, Math.abs(hgt[c - KN] - h)); if (j < KN - 1 && land(c + KN)) m = Math.max(m, Math.abs(hgt[c + KN] - h));
      slope[c] = steep[c] = m / (KKM * 1000); num[cls[c] = classOf(h, slope[c])]++;
    }
    return { cls, slope, steep, num };
  }
  // heights on a lattice of 500 m: the corners of every square, the middles of its sides and its middle; three rows
  // of it are kept at a time. A point no land chunk touches is not asked for.
  const W = 2 * KN + 1, HALF = KKM / 2, KX = KM_PER_DEG * COS_REF;
  const row = (jj, out) => {
    const lat = (KY0 + jj * HALF) / KM_PER_DEG, ja = Math.min(KN - 1, jj >> 1) * KN, jb = Math.max(0, (jj - 1) >> 1) * KN;
    for (let ii = 0; ii < W; ii++) {
      const ia = Math.min(KN - 1, ii >> 1), ib = Math.max(0, (ii - 1) >> 1);
      out[ii] = land(ja + ia) || land(ja + ib) || land(jb + ia) || land(jb + ib) ? Math.max(0, heightAt(lat, (KX0 + ii * HALF) / KX)) : 0;
    }
  };
  let r0 = new Float32Array(W), r1 = new Float32Array(W), r2 = new Float32Array(W);
  row(0, r0);
  const q = [0, 0, 0, 0], RUN = HALF * 2000;        // twice the side of a quarter, metres
  for (let j = 0, c = 0; j < KN; j++) {
    row(2 * j + 1, r1); row(2 * j + 2, r2);
    for (let i = 0; i < KN; i++, c++) {
      if (!land(c)) continue;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const lo = b ? r1 : r0, hi = b ? r2 : r1, x = 2 * i + a, h00 = lo[x], h10 = lo[x + 1], h01 = hi[x], h11 = hi[x + 1];
        q[b * 2 + a] = Math.hypot(h10 + h11 - h00 - h01, h01 + h11 - h00 - h10) / RUN;
      }
      q.sort((u, v) => u - v);
      slope[c] = q[0]; steep[c] = q[3];
      num[cls[c] = classOf(r1[2 * i + 1], slope[c])]++;
    }
    const t = r0; r0 = r2; r2 = t;
  }
  return { cls, slope, steep, num };
}

// How many chunks every district has and the box of squares they lie in.
export function districtBoxes(div) {
  const count = div.count, cells = div.cells, num = new Uint32Array(count), x0 = new Uint16Array(count).fill(KN), x1 = new Uint16Array(count), y0 = new Uint16Array(count).fill(KN), y1 = new Uint16Array(count);
  for (let j = 0, c = 0; j < KN; j++) for (let i = 0; i < KN; i++, c++) {
    const d = cells[c]; if (d < 0) continue;
    num[d]++; if (i < x0[d]) x0[d] = i; if (i > x1[d]) x1[d] = i; if (j < y0[d]) y0[d] = j; if (j > y1[d]) y1[d] = j;
  }
  return { num, x0, x1, y0, y1 };
}
// the chunks of district d, in the order of their numbers
export function chunksOfDistrict(div, d) {
  const b = kmData(div).box, out = [];
  for (let j = b.y0[d]; j <= b.y1[d]; j++) for (let i = b.x0[d], c = j * KN + i; i <= b.x1[d]; i++, c++) if (div.cells[c] === d) out.push(c);
  return out;
}
// the natural cells district d lies over and how many of its chunks lie in each: [[cell, chunks], …]
export function cellsOfDistrict(div, ch, d) {
  const kc = cellsOfChunks(ch).cell, m = new Map();
  for (const c of chunksOfDistrict(div, d)) m.set(kc[c], (m.get(kc[c]) || 0) + 1);
  return [...m].filter(e => e[0] < ch.count).sort((a, b) => a[0] - b[0]);
}

// The order in which a district takes up its land: the chunks nearest to its centre first, level ground before
// broken ground; where nobody can live comes last. This is the number a save counts chunks by (save/land.js): it
// depends only on the relief and the division, never on what has been built. The weights are this work's estimate.
export const ORDER_WEIGHT = [0, 1, 1.15, 1.5, 2.4, 6];   // how much farther a chunk of each class counts as lying
// → { list: Uint32Array (the chunks of all land districts, district after district, each in its order),
//     first: Uint32Array (count + 1: where the chunks of a district begin in list), rank: Int32Array (the place of a
//     chunk in its district, −1 for water) }
export function districtOrder(div, facts) {
  const count = div.count, n = KN * KN, cells = div.cells, cen = div.centres, first = new Uint32Array(count + 1), key = new Float32Array(n), rank = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) { const d = cells[c]; if (d >= 0 && div.kinds[d] === LAND) first[d + 1]++; }
  for (let d = 0; d < count; d++) first[d + 1] += first[d];
  const list = new Uint32Array(first[count]), at = Uint32Array.from(first.subarray(0, count));
  for (let j = 0, c = 0; j < KN; j++) for (let i = 0; i < KN; i++, c++) {
    const d = cells[c]; if (d < 0 || div.kinds[d] !== LAND) continue;
    const cx = cen && cen.texel[d] >= 0 ? cen.x[d] : div.cx[d], cy = cen && cen.texel[d] >= 0 ? cen.y[d] : div.cy[d];
    key[c] = Math.hypot(KX0 + (i + .5) * KKM - cx, KY0 + (j + .5) * KKM - cy) * ORDER_WEIGHT[facts.cls[c] || 5];
    list[at[d]++] = c;
  }
  for (let d = 0; d < count; d++) {
    const part = list.subarray(first[d], first[d + 1]); if (!part.length) continue;
    part.sort((a, b) => key[a] - key[b] || a - b);
    for (let r = 0; r < part.length; r++) rank[part[r]] = r;
  }
  return { list, first, rank };
}

// Everything about the chunks of a division, worked out when first asked for: div.km.box at once, the rest by
// kmFacts() and kmOrder().
export function kmData(div) { if (!div.km) div.km = { box: districtBoxes(div), facts: null, order: null }; return div.km; }
export function kmFacts(div, heightAt = null) { const k = kmData(div); if (!k.facts) k.facts = chunkFacts(div, heightAt); return k.facts; }
export function kmOrder(div, heightAt = null) { const k = kmData(div); if (!k.order) k.order = districtOrder(div, kmFacts(div, heightAt)); return k.order; }
