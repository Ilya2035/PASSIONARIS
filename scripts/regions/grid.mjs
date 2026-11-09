// Shared grid helpers for the regions bake: MAP grid geometry (equirectangular,
// row 0 = 90N, column 0 = 180W), gzip IO, a seeded RNG and a typed binary heap.
import fs from 'node:fs';
import zlib from 'node:zlib';

export const EARTH_KM = 6371.0088;
export const DEG = Math.PI / 180;

// Geometry of an equirectangular W x H grid. Everything is precomputed per row.
export function makeGrid(W, H) {
  const dyKm = Math.PI * EARTH_KM / H;
  const rowLat = new Float64Array(H);
  const dxKm = new Float64Array(H);   // texel width (km) on each row
  const areaKm2 = new Float64Array(H); // texel area (km2) on each row
  const cosLat = new Float64Array(H), sinLat = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 180 / H;
    rowLat[y] = lat;
    cosLat[y] = Math.cos(lat * DEG); sinLat[y] = Math.sin(lat * DEG);
    dxKm[y] = Math.max(1e-3, 2 * Math.PI * EARTH_KM / W * cosLat[y]);
    areaKm2[y] = dxKm[y] * dyKm;
  }
  const colLon = new Float64Array(W), cosLon = new Float64Array(W), sinLon = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    colLon[x] = -180 + (x + 0.5) * 360 / W;
    cosLon[x] = Math.cos(colLon[x] * DEG); sinLon[x] = Math.sin(colLon[x] * DEG);
  }
  const lonToX = lon => (lon + 180) / 360 * W;
  const latToY = lat => (90 - lat) / 180 * H;
  const texelOf = (lon, lat) => {
    let x = Math.floor(lonToX(lon)); x = ((x % W) + W) % W;
    const y = Math.min(H - 1, Math.max(0, Math.floor(latToY(lat))));
    return y * W + x;
  };
  return { W, H, N: W * H, dyKm, rowLat, dxKm, areaKm2, cosLat, sinLat, colLon, cosLon, sinLon, lonToX, latToY, texelOf };
}

// Unit vector convention of src/game/camera.js: (cos(lat) sin(lon), sin(lat), cos(lat) cos(lon)).
export function unitOf(lon, lat) {
  const cl = Math.cos(lat * DEG);
  return [cl * Math.sin(lon * DEG), Math.sin(lat * DEG), cl * Math.cos(lon * DEG)];
}
export function lonLatOfVec(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return [Math.atan2(x, z) / DEG, Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG];
}
export function haversineKm(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------ IO
export function readGz(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
export function typedOf(bytes, Type) {
  // copy when misaligned
  if (bytes.byteOffset % Type.BYTES_PER_ELEMENT) bytes = bytes.slice();
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}
export function writeGz(file, typed, level = 9) {
  const buf = zlib.gzipSync(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), { level });
  fs.writeFileSync(file, buf);
  return buf.length;
}
// height.delta.bin.gz: Int16 rows delta-encoded, h[x] = h[x-1] + d[x]
export function loadHeight(file, W, H) {
  const h = typedOf(readGz(file), Int16Array);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) { acc = (acc + h[row + x]) << 16 >> 16; h[row + x] = acc; }
  }
  return h;
}

// ------------------------------------------------------------------ RNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------------ heap
// Min-heap of (Float64 key, Int32 value) on typed arrays; grows on demand.
// Ties are broken by value so results never depend on insertion order quirks.
export class Heap {
  constructor(cap = 1 << 16) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; this.topKey = 0; }
  clear() { this.n = 0; }
  get size() { return this.n; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const nk = new Float64Array(this.k.length * 2); nk.set(this.k); this.k = nk;
      const nv = new Int32Array(this.v.length * 2); nv.set(this.v); this.v = nv;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] < key || (K[p] === key && V[p] <= val)) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const val = V[0];
    this.topKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const lk = K[n], lv = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (K[c + 1] < K[c] || (K[c + 1] === K[c] && V[c + 1] < V[c]))) c++;
        if (K[c] > lk || (K[c] === lk && V[c] >= lv)) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = lk; V[i] = lv;
    }
    return val;
  }
}

// 4-connected component labelling of texels where cls[i] >= 0, joining texels of
// equal class. Wraps in x. Returns { comp: Int32Array (-1 = none), count, area: Float64Array, first: Int32Array }.
export function components(grid, cls) {
  const { W, H, N, areaKm2 } = grid;
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const areas = [], firsts = [];
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (cls[s] < 0 || comp[s] >= 0) continue;
    const c = cls[s], id = count++;
    let sp = 0, a = 0;
    stack[sp++] = s; comp[s] = id;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % W, y = (i - x) / W;
      a += areaKm2[y];
      const r = i - x;
      let j = r + (x + 1 === W ? 0 : x + 1);
      if (comp[j] < 0 && cls[j] === c) { comp[j] = id; stack[sp++] = j; }
      j = r + (x === 0 ? W - 1 : x - 1);
      if (comp[j] < 0 && cls[j] === c) { comp[j] = id; stack[sp++] = j; }
      if (y > 0) { j = i - W; if (comp[j] < 0 && cls[j] === c) { comp[j] = id; stack[sp++] = j; } }
      if (y < H - 1) { j = i + W; if (comp[j] < 0 && cls[j] === c) { comp[j] = id; stack[sp++] = j; } }
    }
    areas.push(a); firsts.push(s);
  }
  return { comp, count, area: Float64Array.from(areas), first: Int32Array.from(firsts) };
}
