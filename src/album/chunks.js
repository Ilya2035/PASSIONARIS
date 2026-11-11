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
  spareB: ['B', 3, 'запас'],
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

// Divides the fine raster into chunks. Every seed spreads over the texels around it, all seeds at the same pace; where
// two spreading chunks meet is their border. Spreading is slower uphill and across broken ground and pays a toll to
// cross a river, so borders settle on rivers and at the foot of slopes; land and water never share a chunk, so the
// coast is always a border. The seeds stand in staggered rows with a little scatter, which makes the cells rounded,
// like a honeycomb pulled out of shape, instead of square.
//   heightAt(lat, lon) → metres (missing = all land); rivers: [{ pts: [[lon, lat], …], rank }]
export function buildCells(heightAt, rivers = []) {
  const n = FN * FN, land = new Uint8Array(n), hgt = new Float32Array(n), riv = new Uint8Array(n), pace = new Float32Array(n);
  for (let ty = 0, t = 0; ty < FN; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KM_PER_DEG, inLat = lat > BBOX.lat0 && lat < BBOX.lat1;
    for (let tx = 0; tx < FN; tx++, t++) {
      const lon = (X0 + (tx + .5) * FKM) / (KM_PER_DEG * COS_REF);
      const h = !heightAt ? 100 : (inLat && lon > BBOX.lon0 && lon < BBOX.lon1 ? heightAt(lat, lon) : -3200);
      hgt[t] = h; land[t] = h > 0 ? 1 : 0;
      pace[t] = .72 + .8 * vnoise(tx / 6.3, ty / 6.3, 5) + .1 * vnoise(tx / 2.1, ty / 2.1, 9);
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
  const cell = new Uint16Array(n).fill(NONE), dist = new Int32Array(n).fill(1 << 30), kind = [], seed = new Uint8Array(n);
  const NB = 64, buckets = Array.from({ length: NB }, () => []);
  let pending = 0;
  for (let yj = 0; yj < CN; yj++) for (let xi = 0; xi < CN; xi++) {
    let nl = 0;
    for (let b = 0; b < Q; b++) for (let a = 0; a < Q; a++) nl += land[(yj * Q + b) * FN + xi * Q + a];
    const isLand = nl >= Q * Q * .3 ? 1 : 0;
    const cx = (xi + .5) * Q + ((yj & 1) ? 2 : -2) + (hash2(xi, yj, 11) - .5) * 4.4, cy = (yj + .5) * Q + (hash2(xi, yj, 23) - .5) * 4.4;
    let best = -1, bd = 1e9;
    for (let b = 0; b < Q; b++) for (let a = 0; a < Q; a++) {
      const t = (yj * Q + b) * FN + xi * Q + a; if (land[t] !== isLand) continue;
      const d = (xi * Q + a + .5 - cx) ** 2 + (yj * Q + b + .5 - cy) ** 2 + (riv[t] ? 40 : 0); if (d < bd) { bd = d; best = t; }
    }
    kind.push(isLand); cell[best] = yj * CN + xi; dist[best] = 0; seed[best] = 1; buckets[0].push(best); pending++;
  }
  // all seeds spread at once, cheapest step first (costs are whole numbers under 64, so 64 rotating buckets do)
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let c = 0; pending > 0; c++) {
    const bucket = buckets[c % NB];
    for (let q = 0; q < bucket.length; q++) {
      const t = bucket[q]; pending--; if (dist[t] !== c) continue;
      const tx = t % FN, ty = (t / FN) | 0, id = cell[t], lt = land[t], rt = riv[t], ht = hgt[t];
      for (let d = 0; d < 8; d++) {
        const x = tx + DX[d], y = ty + DY[d]; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const m = y * FN + x; if (land[m] !== lt) continue;
        let step = (d < 4 ? 4 : 5.66) * pace[m];
        if (lt) { step += Math.min(10, Math.abs(hgt[m] - ht) * .04); if (riv[m] !== rt) step += Math.max(riv[m], rt) === 2 ? 18 : 12; }   // a river is paid for on entering and on leaving
        const nd = c + Math.max(1, Math.round(step));
        if (nd < dist[m]) { dist[m] = nd; cell[m] = id; buckets[nd % NB].push(m); pending++; }
      }
    }
    bucket.length = 0;
  }
  // what no seed reached — an island in a square of open sea, a lagoon behind a bar: a chunk of its own if it is big
  // enough, otherwise part of the chunk it lies in
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (cell[s] !== NONE) continue;
    const lt = land[s], comp = [s]; let host = NONE; cell[s] = NONE - 1; stack.push(s);
    while (stack.length) {
      const t = stack.pop(), tx = t % FN, ty = (t / FN) | 0;
      for (let d = 0; d < 4; d++) {
        const x = tx + DX[d], y = ty + DY[d]; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const m = y * FN + x;
        if (cell[m] === NONE && land[m] === lt) { cell[m] = NONE - 1; comp.push(m); stack.push(m); } else if (cell[m] < NONE - 1 && host === NONE) host = cell[m];
      }
    }
    let id = host;
    if (comp.length >= 8 || host === NONE) { id = kind.length; kind.push(lt); }
    for (const t of comp) cell[t] = id;
  }
  // round the outlines off: a texel that sticks out into a neighbour goes over to it
  for (let pass = 0; pass < 4; pass++) {
    const prev = cell.slice();
    for (let ty = 1; ty < FN - 1; ty++) for (let tx = 1; tx < FN - 1; tx++) {
      const t = ty * FN + tx, id = prev[t]; if (seed[t]) continue;
      let same = 0, other = NONE, on = 0;
      for (let d = 0; d < 8; d++) { const v = prev[t + DY[d] * FN + DX[d]]; if (v === id) same++; else if (kind[v] === kind[id]) { if (v === other) on++; else if (on === 0) { other = v; on = 1; } } }
      if (same <= 3 && on >= 4) cell[t] = other;
    }
  }
  return { cell, count: kind.length, kind: Uint8Array.from(kind), land, hgt, riv };
}

export class Chunks {
  constructor(heightAt, rivers) {
    const g = buildCells(heightAt, rivers), n = g.count, cell = g.cell;
    this.n = CN; this.count = n; this.cell = cell;
    this.kind = g.kind;                  // 1 a chunk of land, 0 a chunk of water
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
      this.area[k] = cnt[k] * FKM * FKM; this.cx[k] = X0 + sx[k] / c * FKM; this.cy[k] = Y0 + sy[k] / c * FKM;
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
