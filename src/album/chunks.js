// NOTE (v0.6.40): what this file calls a chunk is now the NATURAL CELL of about 100 km². Since the owner's decision of
// 12.11.2026 the chunk of the division is one square kilometre: src/album/division/km.js. A district is made of those;
// the cells here still hold the state the picture is drawn from, until it moves to the chunks of 1 km².
//
// The chunk system (docs/ALBUM-CHUNKS.md). The land and the sea are divided into chunks — the smallest unit of the
// game world: chunk → district → province → region. A chunk is a small natural cell about 10 km across (around
// 100 km²), NOT a square: its outline is rounded and follows the lie of the land — a river, the foot of a range, the
// coast — the way a district does, only smaller. A chunk cannot be clicked; it only holds state (how much forest
// stands, how much ice, snow, swamp, houses, fields …). The picture is drawn from that state: every pixel reads the
// state of the chunks around it, joined smoothly (CHUNK_GLSL in glsl.js), so neighbouring chunks merge without a
// visible seam and a change of state (a forest cut down, a sea freezing) spreads chunk by chunk.
import { DataTexture, RGBAFormat, RGFormat, UnsignedByteType, LinearFilter, NearestFilter, ClampToEdgeWrapping, Vector4 } from 'three';
import { KM_PER_DEG, COS_REF, BBOX } from './geo.js';

// Chunks grow from seeds, one seed in every square of a 128 × 128 lattice of 10 km. The number of a chunk is the
// number of its seed's square: k = (j − CJ0) · CN + (i − CI0); chunks added later (islands, lagoons) follow after.
export const CHUNK_KM = 10, CN = 128, CI0 = -88, CJ0 = 388;
export const FKM = 1.25, FN = CN * CHUNK_KM / FKM;      // the fine raster the outlines live on: 1024 × 1024 texels of 1.25 km
const SN = FN / 2;                                      // the state raster the shaders read: 512 × 512 texels of 2.5 km
const X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM, Q = CHUNK_KM / FKM, NONE = 0xFFFF;

// Every number a chunk carries for the picture: name → [texture, byte, Russian label]. Values are 0..1.
// The textures are read by the ground shader, the trees, the houses — by everything, the same way.
export const CHANNELS = {
  forest: ['A', 0, 'лес'],            // how much of the natural forest stands: 0 cut down .. 1 untouched
  conifer: ['A', 1, 'хвойные'],       // share of conifers among the trees
  age: ['A', 2, 'возраст леса'],      // 0 young growth .. 1 old forest
  swamp: ['A', 3, 'болото'],          // share of the chunk under bog and marsh
  ice: ['B', 0, 'лёд'],               // ice on the water of the chunk: 0 open water .. 1 solid
  snow: ['B', 1, 'снег'],             // snow lying on the chunk, on land and on ice
  flood: ['B', 2, 'разлив'],          // extra water over the land: 0 none .. 1 flooded
  spareB: ['B', 3, 'волнение моря'],  // the water aspect keeps the roughness of the sea here: 0 calm .. 1 storm
  built: ['C', 0, 'застройка'],       // share of the chunk under houses
  fields: ['C', 1, 'поля'],           // share under fields and pasture
  culture: ['C', 2, 'манера строить'], // building manner, index / 255
  burnt: ['C', 3, 'гарь'],            // 0 .. 1 burnt out
};
const DEFAULTS = { forest: 1, conifer: .3, age: .8 };

export const kmOf = (lat, lon) => [lon * KM_PER_DEG * COS_REF, lat * KM_PER_DEG];          // flat km: east, north
export const llOf = (x, y) => ({ lat: y / KM_PER_DEG, lon: x / (KM_PER_DEG * COS_REF) });

// colour ramps for show(): t 0..1 → [r, g, b] 0..1, as seen on screen
export const RAMPS = {
  green: t => [.93 - .75 * t, .90 - .42 * t, .80 - .66 * t],
  blue: t => [.92 - .74 * t, .94 - .52 * t, .97 - .22 * t],
  warm: t => [.96 - .12 * t, .90 - .62 * t, .70 - .58 * t],
  grey: t => [.95 - .75 * t, .95 - .75 * t, .95 - .75 * t],
};

// ---- the shapes of the chunks
const hash2 = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
// every texel a segment passes through, joined by their sides, so the line leaves no diagonal gap to slip through
function line(x0, y0, x1, y1, mark) {
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1), dx = x1 - x0, dy = y1 - y0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  let mx = dx !== 0 ? ((sx > 0 ? tx + 1 : tx) - x0) / dx : Infinity, my = dy !== 0 ? ((sy > 0 ? ty + 1 : ty) - y0) / dy : Infinity;
  const ax = dx !== 0 ? Math.abs(1 / dx) : Infinity, ay = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  mark(tx, ty);
  for (let guard = 0; (tx !== ex || ty !== ey) && guard < 8192; guard++) { if (mx < my) { mx += ax; tx += sx; } else { my += ay; ty += sy; } mark(tx, ty); }
}

// Divides the fine raster into chunks. Every chunk grows from a seed; where two growing chunks meet is their border.
// On land the growth is a flood rising from the low ground, so in broken country a chunk is a piece of a valley with
// its slopes and its border is the crest; on level ground chunks are rounded cells, and a river is a border. Land and
// water never share a chunk, so the coast is always a border. The seeds stand in staggered rows with some scatter.
// A lake is cut out of the land along its own outline and is always a chunk of its own, however small.
//   heightAt(lat, lon) → metres (missing = all land); rivers: [{ pts: [[lon, lat], …], rank }];
//   lakes: [{ ring: [[lon, lat], …] }]
export function buildCells(heightAt, rivers = [], lakes = []) {
  const n = FN * FN, land = new Uint8Array(n), hgt = new Float32Array(n), riv = new Uint8Array(n), pace = new Float32Array(n), lakeAt = new Uint16Array(n);
  for (let ty = 0, t = 0; ty < FN; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KM_PER_DEG, inLat = lat > BBOX.lat0 && lat < BBOX.lat1;
    for (let tx = 0; tx < FN; tx++, t++) {
      const lon = (X0 + (tx + .5) * FKM) / (KM_PER_DEG * COS_REF);
      const h = !heightAt ? 100 : (inLat && lon > BBOX.lon0 && lon < BBOX.lon1 ? heightAt(lat, lon) : -3200);
      hgt[t] = h; land[t] = h > 0 ? 1 : 0;
      pace[t] = .82 + .5 * vnoise(tx / 7.1, ty / 7.1, 5);            // an even pace with slow swells: neat rounded cells, none alike
    }
  }
  // lakes: every texel whose middle lies inside the outline (at least one texel, for a lake smaller than a texel)
  lakes.forEach((lk, i) => {
    if (!lk.ring || lk.ring.length < 3) return;
    const pts = lk.ring.map(p => [(p[0] * KM_PER_DEG * COS_REF - X0) / FKM, (p[1] * KM_PER_DEG - Y0) / FKM]);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, sx = 0, sy = 0, any = false;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); sx += p[0]; sy += p[1]; }
    const inside = (x, y) => { let c = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const p = pts[a], q = pts[b]; if ((p[1] > y) !== (q[1] > y) && x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]) c = !c; } return c; };
    const put = (tx, ty) => { if (tx >= 0 && ty >= 0 && tx < FN && ty < FN) { land[ty * FN + tx] = 0; lakeAt[ty * FN + tx] = i + 1; any = true; } };
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) if (inside(tx + .5, ty + .5)) put(tx, ty);
    if (!any) put(Math.floor(sx / pts.length), Math.floor(sy / pts.length));
  });
  // The lie of the land for the flood: heights with the small bumps ironed out (the mean within 2.5 km). A furrow or
  // a hillock on a plain then does not bend a border, while a real valley and a real crest still do.
  const lie = new Float32Array(n);
  {
    const W = FN + 1, sum = new Float64Array(W * W), R = 2;
    for (let y = 0; y < FN; y++) { let row = 0; for (let x = 0; x < FN; x++) { row += Math.max(0, hgt[y * FN + x]); sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row; } }
    for (let y = 0; y < FN; y++) for (let x = 0; x < FN; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(FN, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(FN, y + R + 1);
      lie[y * FN + x] = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  for (const rv of rivers) {
    const r = rv.rank <= 6 ? 2 : 1, mark = (tx, ty) => { if (tx >= 0 && ty >= 0 && tx < FN && ty < FN && r > riv[ty * FN + tx]) riv[ty * FN + tx] = r; };
    for (let i = 1; i < rv.pts.length; i++) {
      const a = rv.pts[i - 1], b = rv.pts[i];
      line((a[0] * KM_PER_DEG * COS_REF - X0) / FKM, (a[1] * KM_PER_DEG - Y0) / FKM, (b[0] * KM_PER_DEG * COS_REF - X0) / FKM, (b[1] * KM_PER_DEG - Y0) / FKM, mark);
    }
  }
  // seeds: land where the square is at least three tenths land, otherwise water; off the rivers where possible
  const cell = new Uint16Array(n).fill(NONE), dist = new Int32Array(n).fill(1 << 30), kind = [], seed = new Uint8Array(n), seedAt = new Int32Array(CN * CN);
  const MAXC = 8192, buckets = new Array(MAXC), put = (t, c) => { const b = c < MAXC ? c : MAXC - 1; (buckets[b] || (buckets[b] = [])).push(t); };
  for (let yj = 0; yj < CN; yj++) for (let xi = 0; xi < CN; xi++) {
    let nl = 0, low = 1e9;
    for (let b = 0; b < Q; b++) for (let a = 0; a < Q; a++) { const t = (yj * Q + b) * FN + xi * Q + a; nl += land[t]; if (land[t] && lie[t] < low) low = lie[t]; }
    const isLand = nl >= Q * Q * .3 ? 1 : 0;
    const cx = (xi + .5) * Q + ((yj & 1) ? 2 : -2) + (hash2(xi, yj, 11) - .5) * 4.4, cy = (yj + .5) * Q + (hash2(xi, yj, 23) - .5) * 4.4;
    // On land the seed goes down into the low ground of its square: the valley floor, the plain.
    let best = -1, bd = 1e9;
    for (let b = 0; b < Q; b++) for (let a = 0; a < Q; a++) {
      const t = (yj * Q + b) * FN + xi * Q + a; if (land[t] !== isLand || lakeAt[t]) continue;
      const d = (xi * Q + a + .5 - cx) ** 2 + (yj * Q + b + .5 - cy) ** 2 + (riv[t] ? 40 : 0) + (isLand ? Math.min(90, (lie[t] - low) * .09) : 0);
      if (d < bd) { bd = d; best = t; }
    }
    if (best < 0) for (let b = 0; b < Q && best < 0; b++) for (let a = 0; a < Q; a++) { const t = (yj * Q + b) * FN + xi * Q + a; if (land[t] === isLand) { best = t; break; } }   // a square that is all lake
    kind.push(isLand); cell[best] = yj * CN + xi; seedAt[yj * CN + xi] = best; seed[best] = 1; dist[best] = isLand ? Math.max(0, Math.round(lie[best])) : 0; put(best, dist[best]);
  }
  // The flood. Every land seed is a spring: its water rises and spreads, level by level, and takes the ground it
  // reaches first. Water from the valley floor climbs both slopes and meets the water of the next valley on the crest,
  // so the crest becomes the border. On level ground the height says nothing and the way decides: LAM metres of level
  // per km of way, which gives rounded cells. A river costs extra to cross. The sea spreads by the way alone.
  // Steps go to the 8 texels around and to the 8 a knight's move away: with sixteen directions the way is close to
  // a straight line, so a cell on level ground comes out round, not eight-sided.
  const DX = [1, -1, 0, 0, 1, 1, -1, -1, 2, 2, -2, -2, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2], LAM = 36;
  for (let c = 0; c < MAXC; c++) {
    const bucket = buckets[c]; if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const t = bucket[q]; if (dist[t] !== c && !(c === MAXC - 1 && dist[t] >= c)) continue;
      const tx = t % FN, ty = (t / FN) | 0, id = cell[t], lt = land[t], rt = riv[t], lvl = dist[t];
      for (let d = 0; d < 16; d++) {
        const dx = DX[d], dy = DY[d], x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const m = y * FN + x; if (land[m] !== lt || lakeAt[m] !== lakeAt[t]) continue;
        let way = (d < 4 ? FKM : d < 8 ? FKM * 1.414 : FKM * 2.236) * LAM * pace[m], top = lt ? lie[m] : 0, tolls = riv[m] !== rt ? 1 : 0;
        if (d >= 8) {                     // a knight's move passes over two texels: it may not jump the coast, a crest or a river
          const a = t + (dx === 2 || dx === -2 ? dx / 2 : dy / 2 * FN), b = a + (dx === 2 || dx === -2 ? dy * FN : dx);
          if (land[a] !== lt || land[b] !== lt || lakeAt[a] !== lakeAt[t] || lakeAt[b] !== lakeAt[t]) continue;
          if (lt) { top = Math.max(top, lie[a], lie[b]); if (!tolls && (riv[a] !== rt || riv[b] !== rt)) tolls = 2; }
        }
        if (lt && tolls) way += tolls * (Math.max(riv[m], rt, 1) === 2 ? 80 : 50);  // a river is paid for on entering and on leaving
        const nd = Math.round(Math.max(lvl, top) + way);                           // the level has to rise to the ground it takes
        if (nd < dist[m]) { dist[m] = nd; cell[m] = id; put(m, nd); }
      }
    }
    buckets[c] = null;
  }
  // what no seed reached — an island in a square of open sea, a lagoon behind a bar: a chunk of its own if it is big
  // enough, otherwise part of the chunk it lies in
  const stack = [], lakeChunk = new Map();
  for (let s = 0; s < n; s++) {
    if (cell[s] !== NONE) continue;
    const lt = land[s], comp = [s]; let host = NONE; cell[s] = NONE - 1; stack.push(s);
    while (stack.length) {
      const t = stack.pop(), tx = t % FN, ty = (t / FN) | 0;
      for (let d = 0; d < 4; d++) {
        const x = tx + DX[d], y = ty + DY[d]; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const m = y * FN + x;
        if (cell[m] === NONE && land[m] === lt && lakeAt[m] === lakeAt[s]) { cell[m] = NONE - 1; comp.push(m); stack.push(m); } else if (cell[m] < NONE - 1 && host === NONE) host = cell[m];
      }
    }
    let id = host;
    if (lakeAt[s]) {                      // a lake is one chunk whatever its size, even if its texels do not touch
      id = lakeChunk.get(lakeAt[s]); if (id === undefined) { id = kind.length; kind.push(lt); lakeChunk.set(lakeAt[s], id); }
    } else if (comp.length >= 8 || host === NONE) { id = kind.length; kind.push(lt); }
    for (const t of comp) cell[t] = id;
  }
  // Round the outlines off. Every texel near a border looks at the texels within 2.5 km, each weighted by a bell
  // around itself, and joins the chunk of its own kind that weighs most there: spurs and corners go, the outline
  // becomes a clean curve. Texels on and beside a river stay put, so that border keeps to the river.
  const BELL = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) BELL.push(dy * FN + dx, Math.exp(-(dx * dx + dy * dy) / 8));
  for (let pass = 0; pass < 2; pass++) {
    const prev = cell.slice(), ids = new Uint16Array(49), ws = new Float32Array(49);
    for (let ty = 3; ty < FN - 3; ty++) for (let tx = 3; tx < FN - 3; tx++) {
      const t = ty * FN + tx, id = prev[t];
      if (seed[t] || lakeAt[t] || riv[t] || riv[t - 1] || riv[t + 1] || riv[t - FN] || riv[t + FN]) continue;
      if (prev[t - 3] === id && prev[t + 3] === id && prev[t - 3 * FN] === id && prev[t + 3 * FN] === id
        && prev[t - 2 * FN - 2] === id && prev[t + 2 * FN + 2] === id && prev[t - 2 * FN + 2] === id && prev[t + 2 * FN - 2] === id) continue;   // deep inside its chunk
      let nIds = 0;
      for (let b = 0; b < BELL.length; b += 2) {
        const m = t + BELL[b], v = prev[m]; if (land[m] !== land[t] || lakeAt[m] || kind[v] !== kind[id]) continue;
        let j = 0; while (j < nIds && ids[j] !== v) j++;
        if (j === nIds) { ids[nIds] = v; ws[nIds++] = 0; }
        ws[j] += BELL[b + 1];
      }
      let best = id, bw = 0;
      for (let j = 0; j < nIds; j++) if (ws[j] > bw) { bw = ws[j]; best = ids[j]; }
      cell[t] = best;
    }
  }
  // A chunk its neighbours squeezed down to a scrap (under 25 km²) takes ground back from the large neighbours of its
  // own kind, ring by ring, until it is about 30 km². An island keeps its chunk however small.
  const size = new Uint32Array(kind.length), own = new Map();
  for (let t = 0; t < n; t++) size[cell[t]]++;
  // a seed the rounding left alone inside a neighbour's ground, while its own chunk lives on beside it, joins the neighbour
  for (let k = 0; k < CN * CN; k++) {
    const t = seedAt[k], tx = t % FN, ty = (t / FN) | 0; if (cell[t] !== k || size[k] < 2 || tx < 1 || ty < 1 || tx >= FN - 1 || ty >= FN - 1) continue;
    let alone = true, to = -1;
    for (let d = 0; d < 4; d++) { const v = cell[t + DY[d] * FN + DX[d]]; if (v === k) alone = false; else if (kind[v] === kind[k]) to = v; }
    if (alone && to >= 0) { cell[t] = to; seed[t] = 0; size[k]--; size[to]++; }
  }
  for (let t = 0; t < n; t++) { const k = cell[t]; if (size[k] < 16) { let l = own.get(k); if (!l) own.set(k, l = []); l.push(t); } }
  for (const [k, list] of own) {
    for (let q = 0; q < list.length && size[k] < 20; q++) {
      const t = list[q], tx = t % FN, ty = (t / FN) | 0;
      for (let d = 0; d < 4 && size[k] < 20; d++) {
        const x = tx + DX[d], y = ty + DY[d]; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const m = y * FN + x, o = cell[m];
        if (o !== k && kind[o] === kind[k] && land[m] === land[t] && lakeAt[m] === lakeAt[t] && size[o] > 26 && !seed[m]) { cell[m] = k; size[k]++; size[o]--; list.push(m); }
      }
    }
  }
  const lakeOf = new Int16Array(kind.length).fill(-1);
  for (let t = 0; t < n; t++) if (lakeAt[t]) lakeOf[cell[t]] = lakeAt[t] - 1;
  return { cell, count: kind.length, kind: Uint8Array.from(kind), land, hgt, riv, seedAt, lakeOf };
}

export class Chunks {
  constructor(heightAt, rivers, lakes = []) {
    const g = buildCells(heightAt, rivers, lakes), n = g.count, cell = g.cell;
    this.n = CN; this.count = n; this.cell = cell;
    this.kind = g.kind;                  // 1 a chunk of land, 0 a chunk of water (sea or lake)
    this.lake = g.lakeOf;                // for a lake chunk the number of its lake in this.lakes, otherwise −1
    this.lakes = lakes;
    this.area = new Float32Array(n);     // km²
    this.land = new Float32Array(n);     // share of the chunk that is land, 0..1 (a water chunk may hold a rock)
    this.height = new Float32Array(n);   // mean height of its land, metres
    const sx = new Float64Array(n), sy = new Float64Array(n), cnt = new Uint32Array(n), links = new Map();
    for (let ty = 0, t = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++, t++) {
      const k = cell[t]; cnt[k]++; sx[k] += tx + .5; sy[k] += ty + .5;
      if (g.land[t]) { this.land[k]++; this.height[k] += g.hgt[t]; }
      for (let d = 0; d < 2; d++) {       // borders: the texel to the east and the one to the north
        if (d ? ty >= FN - 1 : tx >= FN - 1) continue;
        const m = cell[t + (d ? FN : 1)]; if (m === k) continue;
        const key = k < m ? k * 65536 + m : m * 65536 + k, l = links.get(key);
        const river = Math.max(g.riv[t], g.riv[t + (d ? FN : 1)]);
        if (l) { l.km += FKM; if (river) l.river = Math.max(l.river, river); l.wet += river ? FKM : 0; } else links.set(key, { a: Math.min(k, m), b: Math.max(k, m), km: FKM, river, wet: river ? FKM : 0 });
      }
    }
    this.cx = new Float32Array(n); this.cy = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const c = Math.max(1, cnt[k]);
      this.area[k] = cnt[k] * FKM * FKM;
      if (cnt[k]) { this.cx[k] = X0 + sx[k] / c * FKM; this.cy[k] = Y0 + sy[k] / c * FKM; }
      else { const s = g.seedAt[k]; this.cx[k] = X0 + ((s % FN) + .5) * FKM; this.cy[k] = Y0 + (((s / FN) | 0) + .5) * FKM; }   // a number without ground: where its seed stood
      this.height[k] = this.land[k] ? this.height[k] / this.land[k] : 0; this.land[k] /= c;
    }
    // neighbours: for every chunk, the chunks it borders, the length of the shared border in km and whether a river
    // runs along it (river: 0 none, 1 lesser, 2 great; wet: km of the border that lie on a river)
    this.links = Array.from({ length: n }, () => []);
    for (const l of links.values()) { this.links[l.a].push({ k: l.b, km: l.km, river: l.river, wet: l.wet }); this.links[l.b].push({ k: l.a, km: l.km, river: l.river, wet: l.wet }); }

    // ---- state: four bytes per chunk in each of three sets; the shaders read rasters painted from them
    this.bytes = { A: new Uint8Array(n * 4), B: new Uint8Array(n * 4), C: new Uint8Array(n * 4) };
    this.natural = { A: new Uint8Array(n * 4), B: new Uint8Array(n * 4), C: new Uint8Array(n * 4) };
    this.dirty = { A: true, B: true, C: true, pal: true };
    this.layers = new Map();             // extra numbers per chunk that the shader does not read (resources …)
    this.version = 0;                    // grows with every change of state
    this.resetters = [];
    this.stateCell = new Uint16Array(SN * SN);
    for (let y = 0; y < SN; y++) for (let x = 0; x < SN; x++) this.stateCell[y * SN + x] = cell[(y * 2 + 1) * FN + x * 2 + 1];
    this.raster = { A: new Uint8Array(SN * SN * 4), B: new Uint8Array(SN * SN * 4), C: new Uint8Array(SN * SN * 4) };
    this.scratch = [new Uint8Array(SN * SN * 4), new Uint8Array(SN * SN * 4)];
    this.palW = Math.ceil(Math.sqrt(n)); this.pal = new Uint8Array(this.palW * this.palW * 4);
    this.bytes.D = this.pal;             // the colours of show(), four bytes per chunk (the old name of this array)
    const tex = (data, w, h, format, filter) => { const t = new DataTexture(data, w, h, format, UnsignedByteType); t.magFilter = t.minFilter = filter; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true; return t; };
    this.tex = { A: tex(this.raster.A, SN, SN, RGBAFormat, LinearFilter), B: tex(this.raster.B, SN, SN, RGBAFormat, LinearFilter), C: tex(this.raster.C, SN, SN, RGBAFormat, LinearFilter),
      id: tex(new Uint8Array(cell.buffer), FN, FN, RGFormat, NearestFilter), pal: tex(this.pal, this.palW, this.palW, RGBAFormat, NearestFilter) };
    this.uniforms = {
      tChunkA: { value: this.tex.A }, tChunkB: { value: this.tex.B }, tChunkC: { value: this.tex.C }, tChunkId: { value: this.tex.id }, tChunkPal: { value: this.tex.pal },
      uChunkRect: { value: new Vector4(X0, Y0, 1 / (CN * CHUNK_KM), 1 / (CN * CHUNK_KM)) }, uChunkPalW: { value: this.palW },
      uChunkShow: { value: 0 }, uChunkHoverId: { value: -1 },
    };
    for (const [name, v] of Object.entries(DEFAULTS)) for (let k = 0; k < n; k++) this.setNatural(name, k, v);
  }
  // ---- where things are
  at(lat, lon) {                          // the chunk a point lies in, −1 outside the mapped square
    const [x, y] = kmOf(lat, lon), tx = Math.floor((x - X0) / FKM), ty = Math.floor((y - Y0) / FKM);
    return tx >= 0 && ty >= 0 && tx < FN && ty < FN ? this.cell[ty * FN + tx] : -1;
  }
  centre(k) { const x = this.cx[k], y = this.cy[k]; return { ...llOf(x, y), x, y }; }   // the middle of the chunk (its centre of mass)
  neighbours(k) { return this.links[k].map(l => l.k); }
  // the chunks within r steps of k, as [chunk, steps] pairs, nearest first
  ring(k, r) {
    const seen = new Map([[k, 0]]), out = [[k, 0]];
    for (let q = 0; q < out.length; q++) { const [c, d] = out[q]; if (d >= r) continue; for (const l of this.links[c]) if (!seen.has(l.k)) { seen.set(l.k, d + 1); out.push([l.k, d + 1]); } }
    return out;
  }
  // Older code numbered chunks by lattice square. A chunk still carries the number of the square its seed stands in,
  // so these keep working, but a chunk is no longer that square: new code should use at(), centre(), links.
  k(i, j) { const x = i - CI0, y = j - CJ0; return x >= 0 && y >= 0 && x < CN && y < CN ? y * CN + x : -1; }
  ij(k) { return k < CN * CN ? { i: (k % CN) + CI0, j: ((k / CN) | 0) + CJ0 } : { i: Math.floor(this.cx[k] / CHUNK_KM), j: Math.floor(this.cy[k] / CHUNK_KM) }; }
  // ---- state read by the shaders
  get(name, k) { const c = CHANNELS[name]; return this.bytes[c[0]][k * 4 + c[1]] / 255; }
  set(name, k, v) {
    const c = CHANNELS[name], b = Math.max(0, Math.min(255, Math.round(v * 255))), a = this.bytes[c[0]], o = k * 4 + c[1];
    if (a[o] !== b) { a[o] = b; this.dirty[c[0]] = true; this.version++; }
  }
  add(name, k, dv) { this.set(name, k, this.get(name, k) + dv); }
  fill(name, fn) { for (let k = 0; k < this.count; k++) this.set(name, k, fn(k)); }
  // the natural state: what a chunk is before anything happens to it. reset() returns every chunk to it.
  setNatural(name, k, v) { this.set(name, k, v); const c = CHANNELS[name]; this.natural[c[0]][k * 4 + c[1]] = this.bytes[c[0]][k * 4 + c[1]]; }
  getNatural(name, k) { const c = CHANNELS[name]; return this.natural[c[0]][k * 4 + c[1]] / 255; }
  // An aspect that changes chunks on its own (a model of felling, of freezing) registers with onReset() to lay its
  // state over the natural one again.
  reset() { for (const t of 'ABC') { this.bytes[t].set(this.natural[t]); this.dirty[t] = true; } this.version++; for (const fn of this.resetters) fn(this); }
  onReset(fn) { this.resetters.push(fn); }
  // ---- numbers the shaders do not read: resources, anything a district sums up
  layer(name, opts = {}) {
    if (!this.layers.has(name)) this.layers.set(name, { name, title: name, unit: '', sum: true, ...opts, data: new Float32Array(this.count) });
    return this.layers.get(name);
  }
  // paints one number per chunk over the map, every chunk in its own outline; values = null switches the overlay off
  show(values, { min = 0, max = 1, ramp = RAMPS.green, alpha = .8, skip = v => v <= min } = {}) {
    if (!values) { this.uniforms.uChunkShow.value = 0; return; }
    const d = this.pal;
    for (let k = 0; k < this.count; k++) {
      const v = values[k] || 0, t = Math.max(0, Math.min(1, (v - min) / (max - min || 1))), c = ramp(t);
      d[k * 4] = c[0] * 255; d[k * 4 + 1] = c[1] * 255; d[k * 4 + 2] = c[2] * 255; d[k * 4 + 3] = skip(v) ? 0 : 255;
    }
    this.dirty.pal = true; this.uniforms.uChunkShow.value = alpha;
  }
  // repaints the rasters whose chunks changed and uploads them; called once per frame
  flush() {
    for (const t of 'ABC') {
      if (!this.dirty[t]) continue;
      const src = new Uint32Array(this.bytes[t].buffer), [a, b] = this.scratch, a32 = new Uint32Array(a.buffer), sc = this.stateCell, out = this.raster[t];
      for (let s = 0; s < a32.length; s++) a32[s] = src[sc[s]];
      // soften the step between two chunks: one pass along the rows, one along the columns
      const row = SN * 4;
      for (let y = 0, o = 0; y < SN; y++) for (let x = 0; x < SN; x++) for (let c = 0; c < 4; c++, o++) b[o] = (a[x > 0 ? o - 4 : o] + 2 * a[o] + a[x < SN - 1 ? o + 4 : o] + 2) >> 2;
      for (let y = 0, o = 0; y < SN; y++) for (let x = 0; x < SN; x++) for (let c = 0; c < 4; c++, o++) out[o] = (b[y > 0 ? o - row : o] + 2 * b[o] + b[y < SN - 1 ? o + row : o] + 2) >> 2;
      this.tex[t].needsUpdate = true; this.dirty[t] = false;
    }
    if (this.dirty.pal) { this.tex.pal.needsUpdate = true; this.dirty.pal = false; }
  }
}
