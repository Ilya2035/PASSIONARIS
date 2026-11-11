// How the division is drawn. A district is made of whole chunks, but its border on the map must not be a staircase
// along the chunk grid: it runs along the river where a river divides the districts, and smoothly between the
// chunks elsewhere. So the drawing gets its own finer grid of 8 × 8 cells per chunk (1.25 km), two layers of it:
//   land  — the land district of every cell (cells over the sea take the nearest land district),
//   water — the sea or lake district of every cell (cells over land take the nearest water district).
// The shader picks the layer by whether the pixel is land or water, so the coast itself is the border between land
// and sea districts and no line is drawn along it. Inside a layer:
//   1. every cell votes among the chunks around it, each chunk weighted by how much of a small bell (σ ≈ 4 km)
//      centred on the cell falls on it; the point is shifted a little by a slow noise so the line is not too even.
//      The middle of every chunk keeps its own district, so no chunk disappears from the picture (only a river
//      that cuts a chunk may give its far bank to the district across);
//   2. near a river that the districts follow, the cells are filled again from farther away without crossing the
//      river, so the line lies on the river itself;
//   3. the shader smooths the cells once more (cubic B-spline) and draws the line where two districts weigh equal.
// The CPU twin of the shader's choice, pick(), answers which district is under the cursor.
import { CHUNK_KM, CN, CI0, CJ0, kmOf } from '../chunks.js';
import { LAND, SEA, LAKE, smoothRivers } from './build.js';

export const FINE = 8;                                  // cells per chunk side
export const G = CN * FINE;                             // cells across the grid
export const CELL_KM = CHUNK_KM / FINE;
export const X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM;  // south-west corner of the grid, flat km
export const FLAG = 32768;                              // set when the 4 × 4 cells the shader reads around a cell are all one district
export const FAR = 32767;                               // river distance of cells far from any river

// ---- small deterministic noise
function hash2(i, j) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * su) + ((c + (d - c) * su) - (a + (b - a) * su)) * sv;
}
// the normal distribution function (erf after Abramowitz and Stegun 7.1.26)
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + .3275911 * x);
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x);
  return z >= 0 ? .5 * (1 + e) : .5 * (1 - e);
}

// the shift of a cell before it votes, chunk units: a slow wave (about 25 km) and a small ripple (about 7 km), so a
// border between two chunks wanders like a natural one instead of running straight along the grid
function warpField() {                                   // worked out on a lattice of half chunks …
  const n = CN * 2 + 3, wx = new Float32Array(n * n), wy = new Float32Array(n * n);
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    const x = (a - 1) / 2, y = (b - 1) / 2;
    wx[b * n + a] = (vnoise(x / 2.5 + 3.7, y / 2.5) - .5) * 1.1 + (vnoise(x / .8 + 21.3, y / .8 + 2.1) - .5) * .3;
    wy[b * n + a] = (vnoise(x / 2.5 + 11.1, y / 2.5 + 5.3) - .5) * 1.1 + (vnoise(x / .8 + 7.7, y / .8 + 31.9) - .5) * .3;
  }
  // … read back smoothly
  return (x, y, out) => {
    const fx = x * 2 + 1, fy = y * 2 + 1, i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fy))), u = fx - i, v = fy - j;
    const k = j * n + i;
    out[0] = (wx[k] * (1 - u) + wx[k + 1] * u) * (1 - v) + (wx[k + n] * (1 - u) + wx[k + n + 1] * u) * v;
    out[1] = (wy[k] * (1 - u) + wy[k + 1] * u) * (1 - v) + (wy[k + n] * (1 - u) + wy[k + n + 1] * u) * v;
  };
}
// phi() in a table
const PHI_N = 4096, PHI_R = 6, PHI = new Float64Array(PHI_N + 1);
for (let i = 0; i <= PHI_N; i++) PHI[i] = phi(-PHI_R + 2 * PHI_R * i / PHI_N);
const phiT = z => { const f = (z + PHI_R) / (2 * PHI_R) * PHI_N; if (f <= 0) return 0; if (f >= PHI_N) return 1; const i = f | 0, t = f - i; return PHI[i] + (PHI[i + 1] - PHI[i]) * t; };

// 1. the vote of the chunks around every cell. member: Int32Array, district of every chunk for this layer or −1.
function vote(member, sigma) {
  const out = new Int32Array(G * G).fill(-1), s = sigma / CHUNK_KM, warp = warpField(), wv = new Float64Array(2);
  // chunks whose 3 × 3 block is all one district need no vote
  const same = new Uint8Array(CN * CN);
  for (let k = 0; k < CN * CN; k++) {
    const x = k % CN, y = (k / CN) | 0, d = member[k];
    let ok = 1;
    for (let b = -1; b <= 1 && ok; b++) for (let a = -1; a <= 1; a++) { const i = x + a, j = y + b; if (i >= 0 && j >= 0 && i < CN && j < CN && member[j * CN + i] !== d) { ok = 0; break; } }
    same[k] = ok;
  }
  const ids = new Int32Array(9), ws = new Float64Array(9), ax = new Float64Array(3), ay = new Float64Array(3);
  for (let v = 0; v < G; v++) for (let u = 0; u < G; u++) {
    const x = (u + .5) / FINE, y = (v + .5) / FINE;              // chunk units from the corner of the grid
    warp(x, y, wv);
    const X = x + wv[0], Y = y + wv[1];
    const ci = Math.floor(X), cj = Math.floor(Y), fx = X - ci, fy = Y - cj;
    if (ci >= 0 && cj >= 0 && ci < CN && cj < CN) {
      const k = cj * CN + ci;
      if (same[k] || (fx > .3 && fx < .7 && fy > .3 && fy < .7 && member[k] >= 0)) { out[v * G + u] = member[k]; continue; }
    }
    for (let o = -1; o <= 1; o++) { ax[o + 1] = phiT((o + 1 - fx) / s) - phiT((o - fx) / s); ay[o + 1] = phiT((o + 1 - fy) / s) - phiT((o - fy) / s); }
    let n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const i = ci + a, j = cj + b; if (i < 0 || j < 0 || i >= CN || j >= CN) continue;
      const d = member[j * CN + i]; if (d < 0) continue;
      const w = ax[a + 1] * ay[b + 1];
      let q = 0; while (q < n && ids[q] !== d) q++;
      if (q === n) { ids[n] = d; ws[n] = 0; n++; }
      ws[q] += w;
    }
    if (!n) continue;
    let best = 0; for (let q = 1; q < n; q++) if (ws[q] > ws[best] || (ws[q] === ws[best] && ids[q] < ids[best])) best = q;
    // the land layer needs a real share of land around to claim a cell over the water; otherwise the nearest wins later
    if (ws[best] > .02) out[v * G + u] = ids[best];
  }
  return out;
}

// cells a polyline in flat km passes through, made side-connected so nothing leaks across it diagonally
function rasterise(lines, mark) {
  for (const pts of lines) for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / CELL_KM * 4));
    let pu = -1, pv = -1;
    for (let t = 0; t <= steps; t++) {
      const x = ax + (bx - ax) * t / steps, y = ay + (by - ay) * t / steps;
      const u = Math.floor((x - X0) / CELL_KM), v = Math.floor((y - Y0) / CELL_KM);
      if (u === pu && v === pv) continue;
      if (pu >= 0 && u !== pu && v !== pv) mark(u, pv);         // a diagonal step: close the corner
      mark(u, v); pu = u; pv = v;
    }
  }
}

// 2. cells near the rivers are filled again from beyond the river's band, never crossing the river. Each of them also
// keeps its exact distance to the river, metres, with a sign for the side (left of the river's course is +): the
// shader draws the border on the zero of that distance, on the river itself, finer than the cells.
function followRivers(lab, rivers, band, sd) {
  const bar = new Uint8Array(G * G);
  const lines = rivers.map(r => (r.pts || []).map(([lon, lat]) => kmOf(lat, lon)));
  rasterise(lines, (u, v) => { if (u >= 0 && v >= 0 && u < G && v < G) bar[v * G + u] = 1; });
  // the band: cells within `band` cells of a river
  const near = new Int16Array(G * G).fill(-1), q = [];
  for (let t = 0; t < G * G; t++) if (bar[t]) { near[t] = 0; q.push(t); }
  for (let h = 0; h < q.length; h++) {
    const t = q[h], u = t % G, v = (t / G) | 0; if (near[t] >= band) continue;
    for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
      const uu = u + du, vv = v + dv; if (uu < 0 || vv < 0 || uu >= G || vv >= G) continue;
      const m = vv * G + uu; if (near[m] < 0) { near[m] = near[t] + 1; q.push(m); }
    }
  }
  const prev = lab.slice(), dist = new Float32Array(G * G).fill(Infinity), heap = new MinHeap(1 << 16);
  for (let t = 0; t < G * G; t++) if (near[t] >= 0) lab[t] = -2;               // unknown
  for (let t = 0; t < G * G; t++) {
    if (lab[t] < 0) continue;
    const u = t % G, v = (t / G) | 0;
    if ((u > 0 && lab[t - 1] === -2) || (u < G - 1 && lab[t + 1] === -2) || (v > 0 && lab[t - G] === -2) || (v < G - 1 && lab[t + G] === -2)) { dist[t] = 0; heap.push(0, t); }
  }
  while (heap.n) {
    const t = heap.pop(), d = heap.key; if (d > dist[t]) continue;
    const u = t % G, v = (t / G) | 0;
    for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
      if (!du && !dv) continue;
      const uu = u + du, vv = v + dv; if (uu < 0 || vv < 0 || uu >= G || vv >= G) continue;
      const m = vv * G + uu; if (lab[m] !== -2 && dist[m] === Infinity) continue;
      if (bar[m]) continue;
      if (du && dv && (bar[v * G + uu] || bar[vv * G + u])) continue;      // no slipping through a diagonal of the river
      const nd = d + (du && dv ? 1.41421356 : 1);
      if (nd < dist[m]) { dist[m] = nd; lab[m] = lab[t]; heap.push(nd, m); }
    }
  }
  // signed distance to the nearest river segment, for the cells of the band
  const segs = [], bucket = new Map();
  for (const pts of lines) for (let s = 0; s + 1 < pts.length; s++) {
    const id = segs.length; segs.push([pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]]);
    const i0 = Math.floor(Math.min(pts[s][0], pts[s + 1][0]) / CHUNK_KM), i1 = Math.floor(Math.max(pts[s][0], pts[s + 1][0]) / CHUNK_KM);
    const j0 = Math.floor(Math.min(pts[s][1], pts[s + 1][1]) / CHUNK_KM), j1 = Math.floor(Math.max(pts[s][1], pts[s + 1][1]) / CHUNK_KM);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = i * 4096 + j; if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(id); }
  }
  for (let t = 0; t < G * G; t++) {
    if (near[t] < 0) continue;
    const x = X0 + (t % G + .5) * CELL_KM, y = Y0 + (((t / G) | 0) + .5) * CELL_KM, ci = Math.floor(x / CHUNK_KM), cj = Math.floor(y / CHUNK_KM);
    let bd = Infinity, sgn = 1;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const list = bucket.get(i * 4096 + j); if (!list) continue;
      for (const id of list) {
        const [ax, ay, bx, by] = segs[id], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const u = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        const ex = x - ax - dx * u, ey = y - ay - dy * u, d = ex * ex + ey * ey;
        if (d < bd) { bd = d; sgn = dx * (y - ay) - dy * (x - ax) >= 0 ? 1 : -1; }
      }
    }
    if (bd < Infinity) sd[t] = Math.max(-FAR + 1, Math.min(FAR - 1, Math.round(Math.sqrt(bd) * 1000 * sgn)));
  }
  // the river cells themselves go to the bank their middle lies on: the district of a neighbour on the same side;
  // anything the refill did not reach keeps what it had
  for (let t = 0; t < G * G; t++) {
    if (lab[t] !== -2) continue;
    const u = t % G, v = (t / G) | 0, side = Math.sign(sd[t]);
    let got = -1;
    for (let r = 1; r <= 2 && got < 0; r++) for (let dv = -r; dv <= r && got < 0; dv++) for (let du = -r; du <= r; du++) {
      const uu = u + du, vv = v + dv; if (uu < 0 || vv < 0 || uu >= G || vv >= G) continue;
      const m = vv * G + uu; if (lab[m] >= 0 && !bar[m] && Math.sign(sd[m]) === side) { got = lab[m]; break; }
    }
    lab[t] = got >= 0 ? got : prev[t];
  }
  return prev;
}

// 3. a district that lost too much of itself to the rivers gets its chunks' middles back
function keepEveryone(lab, div, member) {
  const n = new Int32Array(div.count);
  for (let t = 0; t < G * G; t++) if (lab[t] >= 0) n[lab[t]]++;
  for (let d = 0; d < div.count; d++) {
    const list = div.chunks[d]; if (!list.length || member[list[0]] !== d) continue;
    if (n[d] >= .45 * list.length * FINE * FINE) continue;
    for (const k of list) {
      const i0 = (k % CN) * FINE, j0 = ((k / CN) | 0) * FINE;
      for (let b = 2; b < FINE - 2; b++) for (let a = 2; a < FINE - 2; a++) lab[(j0 + b) * G + i0 + a] = d;
    }
  }
}

// 4. every cell still empty takes the nearest district of its layer
function fillNearest(lab) {
  const q = [];
  for (let t = 0; t < G * G; t++) if (lab[t] >= 0) q.push(t);
  for (let h = 0; h < q.length; h++) {
    const t = q[h], u = t % G, v = (t / G) | 0, d = lab[t];
    if (u > 0 && lab[t - 1] < 0) { lab[t - 1] = d; q.push(t - 1); }
    if (u < G - 1 && lab[t + 1] < 0) { lab[t + 1] = d; q.push(t + 1); }
    if (v > 0 && lab[t - G] < 0) { lab[t - G] = d; q.push(t - G); }
    if (v < G - 1 && lab[t + G] < 0) { lab[t + G] = d; q.push(t + G); }
  }
  for (let t = 0; t < G * G; t++) if (lab[t] < 0) lab[t] = 0;
}

// the flag for the shader: the 4 × 4 cells (u − 1 .. u + 2, v − 1 .. v + 2) are all one district
function flags(lab) {
  const out = new Uint16Array(G * G), row = new Uint8Array(G * G);
  const at = (u, v) => lab[Math.min(G - 1, Math.max(0, v)) * G + Math.min(G - 1, Math.max(0, u))];
  for (let v = 0; v < G; v++) for (let u = 0; u < G; u++) { const a = at(u - 1, v); row[v * G + u] = a === at(u, v) && a === at(u + 1, v) && a === at(u + 2, v) ? 1 : 0; }
  for (let v = 0; v < G; v++) for (let u = 0; u < G; u++) {
    const t = v * G + u, a = lab[t];
    let same = 1;
    for (let b = -1; b <= 2 && same; b++) { const vv = Math.min(G - 1, Math.max(0, v + b)); if (!row[vv * G + u] || at(u, vv) !== a) same = 0; }
    out[t] = a | (same ? FLAG : 0);
  }
  return out;
}

// → { land: Uint16Array(G²), water: Uint16Array(G²) }: district per cell (+ FLAG)
export function fineGrids(div, { rivers = [], sigma = 4, band = 6 } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const landMember = new Int32Array(CN * CN), waterMember = new Int32Array(CN * CN);
  for (let k = 0; k < CN * CN; k++) {
    const d = div.district[k], kd = div.kinds[d];
    landMember[k] = kd === LAND || kd === LAKE ? d : -1; waterMember[k] = kd === SEA || kd === LAKE ? d : -1;
  }
  const land = vote(landMember, sigma), river = new Int16Array(G * G).fill(FAR);
  // near every river the line is laid again; where a river runs inside a district this changes nothing
  const rv = smoothRivers(rivers);
  if (rv.length) followRivers(land, rv, band, river);
  keepEveryone(land, div, landMember);
  fillNearest(land);
  const water = vote(waterMember, sigma);
  fillNearest(water);
  const out = { land: flags(land), water: flags(water), river, rawLand: land, rawWater: water };
  out.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}

// ---- the shader's choice on the CPU: cubic B-spline weights of the 4 × 4 cells around the point, the heaviest district
function bspl(t, out) { const s = 1 - t; out[0] = s * s * s / 6; out[1] = (3 * t * t * t - 6 * t * t + 4) / 6; out[2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6; out[3] = t * t * t / 6; }
const WX = new Float64Array(4), WY = new Float64Array(4);
// river: the river distances (fine.river) for the land layer, so a point beside a river border goes to its own bank
export function pick(grid, x, y, river = null) {
  const qx = (x - X0) / CELL_KM - .5, qy = (y - Y0) / CELL_KM - .5, i0 = Math.floor(qx), j0 = Math.floor(qy), tx = qx - i0, ty = qy - j0;
  bspl(tx, WX); bspl(ty, WY);
  const w = new Map(), side = new Map();
  let sdA = 0, sdN = 0;
  for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
    const u = Math.min(G - 1, Math.max(0, i0 + a - 1)), v = Math.min(G - 1, Math.max(0, j0 + b - 1)), t = v * G + u;
    const d = grid[t] & (FLAG - 1), ww = WX[a] * WY[b];
    w.set(d, (w.get(d) || 0) + ww);
    if (river) {
      const r = river[t] === FAR ? 0 : river[t] / 1000;
      side.set(d, (side.get(d) || 0) + ww * Math.sign(r));
      if (a > 0 && a < 3 && b > 0 && b < 3) { const bw = (a === 1 ? 1 - tx : tx) * (b === 1 ? 1 - ty : ty); sdA += r * bw; if (r !== 0) sdN += bw; }
    }
  }
  const order = [...w].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  let best = order[0][0];
  if (river && order.length > 1 && sdN > .999 && Math.abs(sdA) < 3.5) {
    const a = order[0][0], b = order[1][0], sa = side.get(a), sb = side.get(b);
    if (sa * sb < 0) best = (sdA > 0) === (sa > 0) ? a : b;
  }
  return best;
}

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) { const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k; const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v; }
    const K = this.k, V = this.v; let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] < key || (K[p] === key && V[p] <= val)) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, val = V[0]; this.key = K[0];
    const n = --this.n;
    if (n > 0) {
      const lk = K[n], lv = V[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && (K[c + 1] < K[c] || (K[c + 1] === K[c] && V[c + 1] < V[c]))) c++; if (K[c] > lk || (K[c] === lk && V[c] >= lv)) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = lk; V[i] = lv;
    }
    return val;
  }
}
