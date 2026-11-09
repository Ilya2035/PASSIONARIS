// Pure geometry helpers for the zone-label baker: sphere <-> local azimuthal
// equidistant projection, polygon rasterisation, exact Euclidean distance
// transform, connected components, hole filling and grid path search.
// Everything is deterministic and works on typed arrays.

export const R_KM = 6371;
const D2R = Math.PI / 180;
const clamp1 = x => (x < -1 ? -1 : x > 1 ? 1 : x);

// unit vector, same convention as src/game/camera.js: (cos lat sin lon, sin lat, cos lat cos lon)
export function toVec(lon, lat) {
  const la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
  return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)];
}
export function toLonLat(v) {
  return [Math.atan2(v[0], v[2]) / D2R, Math.asin(clamp1(v[1])) / D2R];
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// local east / north tangent vectors at a unit vector (arbitrary but stable at the poles)
export function eastNorth(v) {
  const h = Math.hypot(v[0], v[2]);
  const e = h > 1e-9 ? [v[2] / h, 0, -v[0] / h] : [1, 0, 0];
  const n = cross(v, e);
  return { e, n: norm(n) };
}

export function gcKm(a, b) {
  // great-circle distance between two unit vectors
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b)) * R_KM;
}

// Azimuthal equidistant projection centred on unit vector c; x = east, y = north, km.
export function makeAeqd(c) {
  const { e, n } = eastNorth(c);
  return {
    c, e, n,
    fwd(v) {
      const d = clamp1(dot(v, c));
      const t0 = v[0] - c[0] * d, t1 = v[1] - c[1] * d, t2 = v[2] - c[2] * d;
      const tl = Math.hypot(t0, t1, t2);
      if (tl < 1e-15) return [0, 0];
      const rho = Math.atan2(tl, d) * R_KM / tl;
      return [rho * (t0 * e[0] + t1 * e[1] + t2 * e[2]), rho * (t0 * n[0] + t1 * n[1] + t2 * n[2])];
    },
    inv(x, y) {
      const r = Math.hypot(x, y);
      if (r < 1e-12) return [c[0], c[1], c[2]];
      const a = r / R_KM, s = Math.sin(a) / r, k = Math.cos(a);
      return norm([
        c[0] * k + (x * e[0] + y * n[0]) * s,
        c[1] * k + (x * e[1] + y * n[1]) * s,
        c[2] * k + (x * e[2] + y * n[2]) * s,
      ]);
    },
  };
}

// ------------------------------------------------------------------ polygons (lon/lat)

// Spherical ring area (km², unsigned) — Chamberlain & Duquette approximation, robust across the antimeridian.
export function ringAreaKm2(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const [l0, p0] = ring[i], [l1, p1] = ring[i + 1];
    a += (l1 - l0) * D2R * (2 + Math.sin(p0 * D2R) + Math.sin(p1 * D2R));
  }
  return Math.abs(a * R_KM * R_KM / 2);
}

// Insert vertices so that no edge (straight in lon/lat, like Natural Earth) is longer than `step` degrees.
export function densifyRing(ring, step = 0.25) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const k = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step));
    for (let j = 0; j < k; j++) out.push([x0 + (x1 - x0) * j / k, y0 + (y1 - y0) * j / k]);
  }
  if (ring.length) out.push(ring[ring.length - 1]);
  return out;
}

// even-odd point-in-ring test in lon/lat space
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Inside any outer ring of a (Multi)Polygon — holes count as inside (labels ignore holes by design).
export function pointInParts(lon, lat, parts) {
  for (const p of parts) if (pointInRing(lon, lat, p[0])) return true;
  return false;
}

// Approximate distance (km) from a point to the nearest outer-ring edge of the parts.
export function distToPartsKm(lon, lat, parts) {
  const P = toVec(lon, lat);
  const proj = makeAeqd(P);
  let best = Infinity;
  for (const p of parts) {
    const ring = p[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const A = toVec(ring[i][0], ring[i][1]), B = toVec(ring[i + 1][0], ring[i + 1][1]);
      if (dot(A, P) < 0.5 && dot(B, P) < 0.5) continue; // > 60° away
      const a = proj.fwd(A), b = proj.fwd(B);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? -(a[0] * dx + a[1] * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

export function partsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

// ------------------------------------------------------------------ raster

// Even-odd scanline fill of one projected ring (flat [x0,y0,x1,y1,...] in km) into mask (OR).
// Grid: column i covers x in [gx0 + i*px, gx0 + (i+1)*px), row j covers y in [gy0 + j*px, ...).
export function fillRing(mask, W, H, gx0, gy0, px, flat) {
  const n = flat.length >> 1;
  if (n < 3) return;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) { const y = flat[2 * i + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const j0 = Math.max(0, Math.floor((ymin - gy0) / px - 0.5)), j1 = Math.min(H - 1, Math.ceil((ymax - gy0) / px));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const yc = gy0 + (j + 0.5) * px;
    xs.length = 0;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const yi = flat[2 * i + 1], yk = flat[2 * k + 1];
      if ((yi > yc) !== (yk > yc)) {
        const xi = flat[2 * i], xk = flat[2 * k];
        xs.push(xi + (yc - yi) * (xk - xi) / (yk - yi));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - gx0) / px - 0.5));
      const b = Math.min(W - 1, Math.floor((xs[k + 1] - gx0) / px - 0.5));
      for (let i = a; i <= b; i++) mask[row + i] = 1;
    }
  }
}

const INF = 1e20;
// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
// For every pixel: squared distance (px²) to the nearest pixel where `mask[i] !== inside`.
export function edtSq(mask, W, H, inside = 1) {
  const f = new Float64Array(Math.max(W, H));
  const d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H));
  const z = new Float64Array(Math.max(W, H) + 1);
  const out = new Float32Array(W * H);
  const tmp = new Float64Array(W * H);
  const pass = (n) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] === inside ? INF : 0;
    pass(H);
    for (let y = 0; y < H; y++) tmp[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = tmp[y * W + x];
    pass(W);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.min(d[x], 3e38);
  }
  return out;
}

// morphological closing with a disk of radius r px (result always contains the input)
export function closeMask(mask, W, H, r) {
  const r2 = r * r;
  const dOut = edtSq(mask, W, H, 0);           // distance from background pixels to the shape
  const dil = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dil[i] = mask[i] || dOut[i] <= r2 ? 1 : 0;
  // keep a 1-px empty frame so the erosion sees the outside
  for (let x = 0; x < W; x++) { dil[x] = 0; dil[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { dil[y * W] = 0; dil[y * W + W - 1] = 0; }
  const dIn = edtSq(dil, W, H, 1);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = mask[i] || (dil[i] && dIn[i] > r2) ? 1 : 0;
  return out;
}

// Connected components of pixels equal to `val`. Returns {label Int32Array (-1 = other), sizes, touchesBorder}.
export function components(mask, W, H, val = 1, conn8 = true) {
  const label = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  const sizes = [], border = [];
  const nb = conn8 ? [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1] : [-1, 1, -W, W];
  for (let s = 0; s < W * H; s++) {
    if (mask[s] !== val || label[s] >= 0) continue;
    const id = sizes.length;
    let qh = 0, qt = 0, size = 0, touch = false;
    queue[qt++] = s; label[s] = id;
    while (qh < qt) {
      const p = queue[qh++]; size++;
      const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch = true;
      for (const o of nb) {
        const q = p + o;
        if (q < 0 || q >= W * H) continue;
        const qx = q % W;
        if (Math.abs(qx - x) > 1) continue; // row wrap
        if (mask[q] === val && label[q] < 0) { label[q] = id; queue[qt++] = q; }
      }
    }
    sizes.push(size); border.push(touch);
  }
  return { label, sizes, border };
}

// Keep only the component `id` of a labelling (as a new 0/1 mask).
export function pick(label, id) {
  const out = new Uint8Array(label.length);
  for (let i = 0; i < label.length; i++) out[i] = label[i] === id ? 1 : 0;
  return out;
}

// Fill enclosed background regions smaller than maxFrac of the shape's area (islands, inclusions).
export function fillHoles(mask, W, H, maxFrac = 0.3) {
  let area = 0;
  for (let i = 0; i < W * H; i++) area += mask[i];
  const bg = components(mask, W, H, 0, false);
  const out = Uint8Array.from(mask);
  const fill = bg.sizes.map((s, i) => !bg.border[i] && s < maxFrac * area);
  for (let i = 0; i < W * H; i++) if (bg.label[i] >= 0 && fill[bg.label[i]]) out[i] = 1;
  return out;
}

// ------------------------------------------------------------------ grid search

class Heap {
  constructor(n) { this.k = new Float64Array(n + 1); this.v = new Int32Array(n + 1); this.n = 0; }
  push(key, val) {
    let i = ++this.n;
    const k = this.k, v = this.v;
    while (i > 1 && k[i >> 1] > key) { k[i] = k[i >> 1]; v[i] = v[i >> 1]; i >>= 1; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[1], key = k[this.n], val = v[this.n--];
    let i = 1;
    for (;;) {
      let c = i * 2;
      if (c > this.n) break;
      if (c + 1 <= this.n && k[c + 1] < k[c]) c++;
      if (k[c] >= key) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = key; v[i] = val;
    return top;
  }
}

const SQ2 = Math.SQRT2;
// Dijkstra over pixels with mask[i] = 1. stepCost(i) multiplies the metric step length (≥ 0).
// Returns {dist Float64Array (Infinity outside), prev Int32Array}.
export function dijkstra(mask, W, H, src, stepCost = null) {
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap(N * 8);
  dist[src] = 0; heap.push(0, src);
  const off = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  const len = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];
  const done = new Uint8Array(N);
  while (heap.n) {
    const p = heap.pop();
    if (done[p]) continue;
    done[p] = 1;
    const x = p % W;
    const cp = stepCost ? stepCost[p] : 1;
    for (let k = 0; k < 8; k++) {
      const q = p + off[k];
      if (q < 0 || q >= N || !mask[q] || done[q]) continue;
      if (Math.abs((q % W) - x) > 1) continue;
      const c = stepCost ? 0.5 * (cp + stepCost[q]) : 1;
      const nd = dist[p] + len[k] * c;
      if (nd < dist[q]) { dist[q] = nd; prev[q] = p; heap.push(nd, q); }
    }
  }
  return { dist, prev };
}

export function argmax(arr, mask = null) {
  let best = -Infinity, bi = -1;
  for (let i = 0; i < arr.length; i++) {
    if (mask && !mask[i]) continue;
    const v = arr[i];
    if (v > best && v !== Infinity) { best = v; bi = i; }
  }
  return bi;
}

// ------------------------------------------------------------------ 2D polylines (km)

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// cumulative arc lengths
function cumLen(pts) {
  const c = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return c;
}

export function pointAt(pts, cum, s) {
  if (s <= 0) return pts[0].slice();
  const L = cum[cum.length - 1];
  if (s >= L) return pts[pts.length - 1].slice();
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

// resample a polyline at M equally spaced points between arc lengths s0..s1
export function resample(pts, M, s0 = 0, s1 = null) {
  const cum = cumLen(pts);
  const L = cum[cum.length - 1];
  if (s1 === null) s1 = L;
  const out = [];
  for (let i = 0; i < M; i++) out.push(pointAt(pts, cum, s0 + (s1 - s0) * (M === 1 ? 0.5 : i / (M - 1))));
  return out;
}

// Gaussian smoothing of an open polyline (uniformly sampled); ends are extended by point reflection
// so the curve keeps its end positions and directions.
export function smooth(pts, sigma) {
  const n = pts.length;
  if (n < 3 || sigma <= 0) return pts.map(p => p.slice());
  const r = Math.ceil(sigma * 3);
  const w = [];
  let ws = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-0.5 * (k / sigma) ** 2); w.push(v); ws += v; }
  const at = i => {
    if (i < 0) { const a = pts[0], b = pts[Math.min(n - 1, -i)]; return [2 * a[0] - b[0], 2 * a[1] - b[1]]; }
    if (i >= n) { const a = pts[n - 1], b = pts[Math.max(0, 2 * (n - 1) - i)]; return [2 * a[0] - b[0], 2 * a[1] - b[1]]; }
    return pts[i];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let k = -r; k <= r; k++) { const p = at(i + k); x += p[0] * w[k + r]; y += p[1] * w[k + r]; }
    out.push([x / ws, y / ws]);
  }
  return out;
}

// total absolute turning (radians) of a polyline
export function turning(pts) {
  let t = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    t += Math.abs(d);
  }
  return t;
}

// range of the (unwrapped) heading along a polyline, radians: an S-curve bends little, a C-curve a lot
export function bendRange(pts) {
  let h = 0, lo = 0, hi = 0, prev = null;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    if (prev !== null) {
      let d = a - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      h += d; if (h < lo) lo = h; if (h > hi) hi = h;
    }
    prev = a;
  }
  return hi - lo;
}
