// Preliminary road network: least-cost paths (A*) between the centres of
// adjacent land districts on a coarse cost grid (MAP / 4 = 2048 x 1024),
// straightened by line-of-sight pulling and simplified with Douglas-Peucker.
import { Heap, EARTH_KM, DEG } from './grid.mjs';

export const ROAD_DEFAULTS = {
  factor: 4,          // MAP texels per cost cell
  mountainK: 2.2,     // extra cost multiplier for fully mountainous cells
  reliefPer: 450,     // +1 multiplier per this many metres of in-cell relief
  coastK: 0.6,        // extra multiplier for cells that are mostly water
  slopeK: 18,         // km of extra cost per km of climb between cells
  riverKm: 14,        // crossing a major river
  pullSlack: 1.06,    // straightening may cost at most +6 %
  dpKm: 2,            // Douglas-Peucker tolerance
  minBorder: 2,       // districts must share >= this many texel edges
  finalOpenKm: 9,     // a finished road may pass water at most this far from land
};

// Build the cost grid. isLandId(id) -> bool. Returns typed arrays per cell.
export function buildCostGrid(grid, did, isLandId, isMountId, height, barrier, o = ROAD_DEFAULTS) {
  const { W, H } = grid, F = o.factor;
  const CW = W / F, CH = H / F, CN = CW * CH;
  const mult = new Float32Array(CN), meanH = new Float32Array(CN), river = new Uint8Array(CN);
  const cx = new Float64Array(CN), cy = new Float64Array(CN); // land-texel centroid (texel units)
  for (let by = 0; by < CH; by++) for (let bx = 0; bx < CW; bx++) {
    let n = 0, m = 0, rv = 0, hs = 0, hmin = 1e9, hmax = -1e9, sx = 0, sy = 0;
    for (let yy = 0; yy < F; yy++) for (let xx = 0; xx < F; xx++) {
      const tx = bx * F + xx, ty = by * F + yy, i = ty * W + tx, id = did[i];
      if (!isLandId(id)) continue;
      n++; sx += tx + 0.5; sy += ty + 0.5;
      if (isMountId(id)) m++;
      if (barrier[i]) rv = 1;
      const h = Math.max(0, height[i]);
      hs += h; if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
    const c = by * CW + bx;
    if (!n) { mult[c] = 0; continue; }
    const fl = n / (F * F);
    mult[c] = 1 + o.mountainK * (m / n) + (hmax - hmin) / o.reliefPer + (fl < 0.5 ? o.coastK : 0);
    meanH[c] = hs / n; river[c] = rv;
    cx[c] = sx / n; cy[c] = sy / n;
  }
  // land connectivity across cell edges: a texel pair (one on each side) that is
  // land on both sides. linkE/linkS store the texel on this side (-1 = none).
  const linkE = new Int32Array(CN).fill(-1), linkS = new Int32Array(CN).fill(-1);
  for (let by = 0; by < CH; by++) for (let bx = 0; bx < CW; bx++) {
    const c = by * CW + bx;
    if (!mult[c]) continue;
    const ex = ((bx + 1) * F) % W;
    let best = -1, bd = 1e9;
    for (let yy = 0; yy < F; yy++) {
      const ty = by * F + yy, a = ty * W + bx * F + F - 1, b = ty * W + ex;
      if (isLandId(did[a]) && isLandId(did[b])) { const d = Math.abs(yy - (F - 1) / 2); if (d < bd) { bd = d; best = a; } }
    }
    linkE[c] = best;
    if (by + 1 < CH) {
      best = -1; bd = 1e9;
      for (let xx = 0; xx < F; xx++) {
        const tx = bx * F + xx, a = (by * F + F - 1) * W + tx, b = a + W;
        if (isLandId(did[a]) && isLandId(did[b])) { const d = Math.abs(xx - (F - 1) / 2); if (d < bd) { bd = d; best = a; } }
      }
      linkS[c] = best;
    }
  }
  return { CW, CH, CN, F, mult, meanH, river, cx, cy, linkE, linkS };
}

// Is there a land link between cells a and b (direction k of OX/OY)?
// Returns the texel on the boundary (for waypoints) or -1.
export function cellLink(cg, a, k) {
  const { CW, linkE, linkS } = cg;
  const x = a % CW, y = (a - x) / CW;
  const xm = x === 0 ? CW - 1 : x - 1, xp = x === CW - 1 ? 0 : x + 1;
  switch (k) {
    case 0: return linkE[a];
    case 1: return linkE[y * CW + xm];
    case 2: return linkS[a];
    case 3: return linkS[(y - 1) * CW + x];
    default: return -1;
  }
}
// diagonal move a -> b allowed when a two-step land path exists through a corner cell
function diagOk(cg, a, k) {
  const { CW } = cg;
  const x = a % CW, y = (a - x) / CW;
  const ox = OX[k], oy = OY[k];
  const nx = (x + ox + CW) % CW, ny = y + oy;
  const cH = y * CW + nx, cV = ny * CW + x; // horizontal-first / vertical-first corner cells
  const kh = ox > 0 ? 0 : 1, kv = oy > 0 ? 2 : 3;
  if (cg.mult[cH] && cellLink(cg, a, kh) >= 0 && cellLink(cg, cH, kv) >= 0) return true;
  if (cg.mult[cV] && cellLink(cg, a, kv) >= 0 && cellLink(cg, cV, kh) >= 0) return true;
  return false;
}

// cells touched by each district: CSR { start: Int32Array(D+1), cells: Int32Array }
export function districtCells(grid, did, D, cg) {
  const { W } = grid, { CW, CH, F } = cg;
  const counts = new Int32Array(D + 1);
  const seen = new Int32Array(D).fill(-1);
  const pairsId = [], pairsCell = [];
  for (let by = 0; by < CH; by++) for (let bx = 0; bx < CW; bx++) {
    const c = by * CW + bx;
    for (let yy = 0; yy < F; yy++) for (let xx = 0; xx < F; xx++) {
      const id = did[(by * F + yy) * W + bx * F + xx];
      if (id <= 0 || seen[id] === c) continue;
      seen[id] = c; counts[id]++; pairsId.push(id); pairsCell.push(c);
    }
  }
  const start = new Int32Array(D + 1);
  for (let id = 1; id <= D; id++) start[id] = start[id - 1] + counts[id - 1];
  const fill = start.slice();
  const cells = new Int32Array(pairsId.length);
  for (let k = 0; k < pairsId.length; k++) cells[fill[pairsId[k]]++] = pairsCell[k];
  return { start, cells };
}

const OX = [1, -1, 0, 0, 1, -1, 1, -1];
const OY = [0, 0, 1, -1, 1, 1, -1, -1];

export class RoadRouter {
  constructor(grid, cg, o = ROAD_DEFAULTS) {
    this.grid = grid; this.cg = cg; this.o = o;
    const { CN, CH } = cg;
    this.g = new Float64Array(CN); this.par = new Int32Array(CN); this.stamp = new Int32Array(CN); this.corr = new Int32Array(CN);
    this.closed = new Int32Array(CN);
    this.sv = 0; this.cv = 0;
    this.heap = new Heap(4096);
    const F = cg.F;
    this.cdy = grid.dyKm * F;
    this.cdx = new Float64Array(CH);
    for (let y = 0; y < CH; y++) this.cdx[y] = 2 * Math.PI * EARTH_KM / cg.CW * Math.cos((90 - (y + 0.5) * 180 / CH) * DEG);
  }
  stepCost(a, b, k) {
    const { cg, o } = this;
    const ay = (a - a % cg.CW) / cg.CW, by = (b - b % cg.CW) / cg.CW;
    let step;
    if (k < 2) step = this.cdx[ay];
    else if (k < 4) step = this.cdy;
    else { const dx = 0.5 * (this.cdx[ay] + this.cdx[by]); step = Math.sqrt(dx * dx + this.cdy * this.cdy); }
    let c = step * 0.5 * (cg.mult[a] + cg.mult[b]) + o.slopeK * Math.abs(cg.meanH[b] - cg.meanH[a]) * 0.001;
    if (cg.river[b] && !cg.river[a]) c += o.riverKm;
    return c;
  }
  heuristic(a, b) {
    const { CW } = this.cg;
    const ax = a % CW, ay = (a - ax) / CW, bx = b % CW, by = (b - bx) / CW;
    let dx = Math.abs(ax - bx); if (dx > CW / 2) dx = CW - dx;
    const ex = dx * Math.min(this.cdx[ay], this.cdx[by]), ey = Math.abs(ay - by) * this.cdy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  // A* from cell s to cell t. corridorMark: cells allowed iff corr[c] === this.cv (when useCorridor).
  route(s, t, useCorridor, bbox = null) {
    const { cg, heap } = this;
    const { CW, CH, mult } = cg;
    this.sv++;
    const sv = this.sv, cv = this.cv;
    const g = this.g, par = this.par, stamp = this.stamp, corr = this.corr, closed = this.closed;
    heap.clear();
    g[s] = 0; par[s] = -1; stamp[s] = sv; heap.push(this.heuristic(s, t), s);
    let expanded = 0;
    while (heap.n) {
      const i = heap.pop();
      if (closed[i] === sv) continue;
      closed[i] = sv;
      if (i === t) break;
      if (++expanded > 400000) return null;
      const x = i % CW, y = (i - x) / CW;
      for (let k = 0; k < 8; k++) {
        const ny = y + OY[k]; if (ny < 0 || ny >= CH) continue;
        let nx = x + OX[k]; if (nx < 0) nx += CW; else if (nx >= CW) nx -= CW;
        const j = ny * CW + nx;
        if (!mult[j] || closed[j] === sv) continue;
        if (useCorridor && corr[j] !== cv) continue;
        if (bbox && (ny < bbox[2] || ny > bbox[3] || !inX(nx, bbox, CW))) continue;
        // moves must follow land: orthogonal moves need a land texel pair across the
        // shared edge, diagonal moves a two-step land path through a corner cell
        if (k < 4 ? cellLink(cg, i, k) < 0 : !diagOk(cg, i, k)) continue;
        const nd = g[i] + this.stepCost(i, j, k);
        if (stamp[j] !== sv || nd < g[j]) { stamp[j] = sv; g[j] = nd; par[j] = i; heap.push(nd + this.heuristic(j, t), j); }
      }
    }
    if (closed[t] !== sv) return null;
    const path = [];
    for (let c = t; c !== -1; c = par[c]) path.push(c);
    path.reverse();
    return { path, cost: g[t] };
  }
}
function inX(nx, bbox, CW) {
  const [x0, x1] = bbox;
  if (x0 <= x1) return nx >= x0 && nx <= x1;
  return nx >= x0 || nx <= x1; // wraps the antimeridian
}

// Douglas-Peucker on lon/lat points (Float64Array [lon,lat,...]) in km.
export function simplifyDP(pts, tolKm) {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const lat0 = pts[1] * DEG;
  const kx = EARTH_KM * DEG * Math.cos(lat0), ky = EARTH_KM * DEG;
  const X = k => { let d = pts[2 * k] - pts[0]; if (d > 180) d -= 360; if (d < -180) d += 360; return d * kx; };
  const Y = k => (pts[2 * k + 1] - pts[1]) * ky;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bd = tolKm;
    for (let k = a + 1; k < b; k++) {
      const px = X(k) - ax, py = Y(k) - ay;
      let d;
      if (L2 === 0) d = Math.hypot(px, py);
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2)); d = Math.hypot(px - t * dx, py - t * dy); }
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[2 * k], pts[2 * k + 1]);
  return Float64Array.from(out);
}

export function polylineKm(pts) {
  let L = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const p1 = pts[k + 1] * DEG, p2 = pts[k + 3] * DEG, dl = (pts[k + 2] - pts[k]) * DEG;
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    L += 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return L;
}

// Build all roads. pairs: [[a,b],...] district ids; anchor lon/lat per id;
// segmentOk(lon0,lat0,lon1,lat1) -> bool checks a straight segment at texel level.
export function buildRoads(grid, did, D, pairs, anchorLon, anchorLat, cg, segmentOk, o = ROAD_DEFAULTS, log = () => {}) {
  const dc = districtCells(grid, did, D, cg);
  const router = new RoadRouter(grid, cg, o);
  const { CW } = cg, F = cg.F;
  const cellOf = (lon, lat) => {
    const x = Math.min(CW - 1, Math.max(0, Math.floor(grid.lonToX(lon) / F)));
    const y = Math.min(cg.CH - 1, Math.max(0, Math.floor(grid.latToY(lat) / F)));
    return y * CW + x;
  };
  const lonOfX = tx => -180 + tx * 360 / grid.W;
  const latOfY = ty => 90 - ty * 180 / grid.H;
  const roads = [];
  let failed = 0, fallback = 0, dropped = 0, repaired = 0;
  for (const [a, b] of pairs) {
    router.cv++;
    for (let k = dc.start[a]; k < dc.start[a + 1]; k++) router.corr[dc.cells[k]] = router.cv;
    for (let k = dc.start[b]; k < dc.start[b + 1]; k++) router.corr[dc.cells[k]] = router.cv;
    const s = cellOf(anchorLon[a], anchorLat[a]), t = cellOf(anchorLon[b], anchorLat[b]);
    router.corr[s] = router.cv; router.corr[t] = router.cv;
    if (!cg.mult[s] || !cg.mult[t]) { failed++; continue; }
    let res = router.route(s, t, true);
    if (!res) {
      // wider search: any land cell within a padded box
      fallback++;
      const sx = s % CW, sy = (s - sx) / CW, tx = t % CW, ty = (t - tx) / CW;
      let dx = tx - sx; if (dx > CW / 2) dx -= CW; if (dx < -CW / 2) dx += CW;
      const pad = 12;
      const xa = ((Math.min(sx, sx + dx) - pad) % CW + CW) % CW, xb = ((Math.max(sx, sx + dx) + pad) % CW + CW) % CW;
      res = router.route(s, t, false, [xa, xb, Math.max(0, Math.min(sy, ty) - pad), Math.min(cg.CH - 1, Math.max(sy, ty) + pad)]);
      if (!res) { failed++; continue; }
    }
    // waypoints: land centroid of every cell, exact anchors at the ends; where the
    // straight hop between two waypoints would leave the land, the land texel on
    // the shared cell edge is inserted as an extra waypoint
    const P = res.path;
    const pts = [anchorLon[a], anchorLat[a]];
    const gAt = [0];
    let acc = 0;
    const texLon = t => grid.colLon[t % grid.W], texLat = t => grid.rowLat[(t - t % grid.W) / grid.W];
    for (let k = 1; k < P.length; k++) {
      const i = P[k - 1], j = P[k];
      const ix = i % CW, jx = j % CW, iy = (i - ix) / CW, jy = (j - jx) / CW;
      let ddx = jx - ix; if (ddx > 1) ddx = -1; if (ddx < -1) ddx = 1;
      const kk = OX.findIndex((v, q) => v === ddx && OY[q] === jy - iy);
      const accPrev = acc;
      acc += router.stepCost(i, j, kk < 0 ? 0 : kk);
      const tl = k === P.length - 1 ? anchorLon[b] : lonOfX(cg.cx[j]);
      const tt = k === P.length - 1 ? anchorLat[b] : latOfY(cg.cy[j]);
      const pl = pts[pts.length - 2], pt = pts[pts.length - 1];
      if (!segmentOk(pl, pt, tl, tt) && kk >= 0) {
        const links = [];
        if (kk < 4) links.push(cellLink(cg, i, kk));
        else {
          const nx = (ix + OX[kk] + CW) % CW, cH = iy * CW + nx, cV = jy * CW + ix;
          const kh = OX[kk] > 0 ? 0 : 1, kv = OY[kk] > 0 ? 2 : 3;
          if (cg.mult[cH] && cellLink(cg, i, kh) >= 0 && cellLink(cg, cH, kv) >= 0) {
            links.push(cellLink(cg, i, kh), cellLink(cg, cH, kv));
          } else links.push(cellLink(cg, i, kv), cellLink(cg, cV, kh));
        }
        links.forEach((t, q) => {
          if (t < 0) return;
          pts.push(texLon(t), texLat(t));
          gAt.push(accPrev + (acc - accPrev) * (q + 1) / (links.length + 1));
        });
      }
      pts.push(tl, tt);
      gAt.push(acc);
    }
    // line-of-sight pulling: from each kept point jump to the farthest point whose
    // straight segment stays on land and is not much dearer than the path
    const n = pts.length / 2;
    const keep = [0];
    let i0 = 0;
    while (i0 < n - 1) {
      let j = n - 1;
      for (; j > i0 + 1; j--) {
        const pathCost = gAt[j] - gAt[i0];
        const lineKm = polylineKm([pts[2 * i0], pts[2 * i0 + 1], pts[2 * j], pts[2 * j + 1]]);
        // average multiplier along the chord must not exceed the path's budget
        if (lineKm * 1.0 > pathCost * o.pullSlack) continue;
        if (!chordOk(i0, j)) continue;
        if (chordCost(i0, j) <= pathCost * o.pullSlack) break;
      }
      keep.push(j); i0 = j;
    }
    function chordOk(p, q) { return segmentOk(pts[2 * p], pts[2 * p + 1], pts[2 * q], pts[2 * q + 1]); }
    function chordCost(p, q) {
      // sample the cost grid along the chord
      const lon0 = pts[2 * p], lat0 = pts[2 * p + 1], lon1 = pts[2 * q], lat1 = pts[2 * q + 1];
      let dl = lon1 - lon0; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      const L = polylineKm([lon0, lat0, lon1, lat1]);
      const ns = Math.max(2, Math.ceil(L / 8));
      let c = 0, prev = cellOf(lon0, lat0);
      for (let s = 1; s <= ns; s++) {
        let lo = lon0 + dl * s / ns; if (lo >= 180) lo -= 360; if (lo < -180) lo += 360;
        const cur = cellOf(lo, lat0 + (lat1 - lat0) * s / ns);
        if (!cg.mult[cur]) return Infinity;
        c += (L / ns) * 0.5 * (cg.mult[prev] + cg.mult[cur]) + o.slopeK * Math.abs(cg.meanH[cur] - cg.meanH[prev]) * 0.001;
        if (cg.river[cur] && !cg.river[prev]) c += o.riverKm;
        prev = cur;
      }
      return c;
    }
    const pulled = [];
    for (const k of keep) pulled.push(pts[2 * k], pts[2 * k + 1]);
    let simp = simplifyDP(Float64Array.from(pulled), o.dpKm);
    const allOk = q => { for (let k = 0; k + 3 < q.length; k += 2) if (!segmentOk(q[k], q[k + 1], q[k + 2], q[k + 3], o.finalOpenKm)) return false; return true; };
    if (!allOk(simp)) {
      // keep every waypoint when straightening / simplification leaves the land
      const raw = Float64Array.from(pts);
      if (allOk(raw)) { simp = raw; repaired++; } else { dropped++; continue; }
    }
    roads.push({ a, b, coords: simp, lengthKm: polylineKm(simp), cost: res.cost });
  }
  log(`roads: ${roads.length} built, ${fallback} via fallback search, ${repaired} kept unstraightened, ${failed} without path, ${dropped} dropped (would cross open water)`);
  return { roads, failed, fallback, dropped, repaired };
}
