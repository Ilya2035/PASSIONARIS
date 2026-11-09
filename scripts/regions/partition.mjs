// Seeded multi-source Dijkstra partition of texel "compartments" with adaptive
// Lloyd relaxation. Growth never leaves a compartment (comp[i] equal), so rivers,
// coasts and class borders (mountain / lowland) that separate compartments act
// as hard barriers. Diagonal moves need both corner texels in the same compartment,
// so 4-connected compartments are respected exactly.
import { Heap, EARTH_KM, DEG } from './grid.mjs';

const OX = [1, -1, 0, 0, 1, -1, 1, -1];
const OY = [0, 0, 1, -1, 1, 1, -1, -1];

// Grow regions from seeds. Fills label (seed index, -1 = unreached) and dist.
// opts: { comp, seeds, height?, slopeK, speed?, cross?, crossKm, heap? }
export function grow(grid, label, dist, opts) {
  const { W, H, dxKm, dyKm } = grid;
  const { comp, seeds, height = null, slopeK = 0, speed = null, cross = null, crossKm = 0 } = opts;
  const heap = opts.heap || new Heap(1 << 20);
  heap.clear();
  label.fill(-1);
  dist.fill(Infinity);
  for (let s = 0; s < seeds.length; s++) {
    const t = seeds[s];
    if (dist[t] === 0) continue; // duplicate seed
    label[t] = s; dist[t] = 0; heap.push(0, t);
  }
  const dyk = dyKm;
  while (heap.n > 0) {
    const i = heap.pop();
    const d0 = heap.topKey;
    if (d0 > dist[i]) continue;
    const x = i % W, y = (i - x) / W;
    const c = comp[i], lab = label[i];
    const hi = height ? height[i] : 0;
    const fi = speed ? speed[i] : 1;
    const ci = cross ? cross[i] : 0;
    for (let k = 0; k < 8; k++) {
      const ny = y + OY[k];
      if (ny < 0 || ny >= H) continue;
      let nx = x + OX[k];
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      const j = ny * W + nx;
      if (comp[j] !== c) continue;
      let step;
      if (k < 2) step = dxKm[y];
      else if (k < 4) step = dyk;
      else {
        // diagonal: both corners must be in the same compartment
        if (comp[y * W + nx] !== c || comp[ny * W + x] !== c) continue;
        const dxm = 0.5 * (dxKm[y] + dxKm[ny]);
        step = Math.sqrt(dxm * dxm + dyk * dyk);
      }
      let cost = step;
      if (speed) cost *= 0.5 * (fi + speed[j]);
      if (slopeK > 0) {
        const dh = Math.abs(height[j] - hi) * 0.001;
        cost += slopeK * dh * (speed ? 0.5 * (fi + speed[j]) : 1);
      }
      if (cross && cross[j] && !ci) cost += crossKm;
      const nd = d0 + cost;
      if (nd < dist[j]) { dist[j] = nd; label[j] = lab; heap.push(nd, j); }
    }
  }
  return heap;
}

// Area, centroid direction and farthest texel of every seed's region, plus the
// region texel closest to the centroid (the relaxed seed position).
export function regionStats(grid, label, dist, S) {
  const { W, N, areaKm2, cosLat, sinLat, cosLon, sinLon } = grid;
  const area = new Float64Array(S), vx = new Float64Array(S), vy = new Float64Array(S), vz = new Float64Array(S);
  const far = new Int32Array(S).fill(-1), farD = new Float64Array(S).fill(-1);
  for (let i = 0; i < N; i++) {
    const s = label[i];
    if (s < 0) continue;
    const x = i % W, y = (i - x) / W;
    const a = areaKm2[y];
    area[s] += a;
    vx[s] += a * cosLat[y] * sinLon[x]; vy[s] += a * sinLat[y]; vz[s] += a * cosLat[y] * cosLon[x];
    if (dist[i] > farD[s]) { farD[s] = dist[i]; far[s] = i; }
  }
  for (let s = 0; s < S; s++) {
    const r = Math.hypot(vx[s], vy[s], vz[s]) || 1;
    vx[s] /= r; vy[s] /= r; vz[s] /= r;
  }
  const best = new Int32Array(S).fill(-1), bestDot = new Float64Array(S).fill(-2);
  for (let i = 0; i < N; i++) {
    const s = label[i];
    if (s < 0) continue;
    const x = i % W, y = (i - x) / W;
    const d = vx[s] * cosLat[y] * sinLon[x] + vy[s] * sinLat[y] + vz[s] * cosLat[y] * cosLon[x];
    if (d > bestDot[s]) { bestDot[s] = d; best[s] = i; }
  }
  return { area, vx, vy, vz, far, farD, best };
}

// Adaptive Lloyd: grow, move seeds to region centroids, split regions that are
// much larger than their target, drop seeds of tiny regions (keeping at least one
// seed per compartment). Returns { seeds, label, dist, stats }.
// opts: grow options + { targetOf(texel) -> km2, iterations, splitK, dropK, log }
export function lloyd(grid, label, dist, opts) {
  const { comp, targetOf, iterations = 4, splitK = 1.85, dropK = 0.3, log = () => {} } = opts;
  let seeds = Int32Array.from(opts.seeds);
  const stamp = new Int32Array(grid.N);
  let stampV = 0;
  let heap = opts.heap || new Heap(1 << 22);
  for (let it = 0; it <= iterations; it++) {
    const t0 = Date.now();
    heap = grow(grid, label, dist, { ...opts, seeds, heap });
    if (it === iterations) { log(`  lloyd final grow: ${seeds.length} seeds, ${((Date.now() - t0) / 1000).toFixed(1)}s`); break; }
    const S = seeds.length;
    const st = regionStats(grid, label, dist, S);
    const order = Array.from({ length: S }, (_, s) => s).sort((a, b) => st.area[b] - st.area[a] || a - b);
    const keptInComp = new Map();
    const next = [];
    stampV++;
    let split = 0, dropped = 0;
    const add = t => { if (t >= 0 && stamp[t] !== stampV) { stamp[t] = stampV; next.push(t); } };
    for (const s of order) {
      const pos = st.best[s] >= 0 ? st.best[s] : seeds[s];
      const c = comp[pos];
      const T = targetOf(pos, c);
      const area = st.area[s];
      if (area < dropK * T && keptInComp.get(c)) { dropped++; continue; }
      keptInComp.set(c, (keptInComp.get(c) || 0) + 1);
      add(pos);
      if (area > splitK * T && st.far[s] >= 0 && st.far[s] !== pos) { add(st.far[s]); split++; }
    }
    next.sort((a, b) => a - b);
    seeds = Int32Array.from(next);
    log(`  lloyd it ${it}: ${S} -> ${seeds.length} seeds (split ${split}, dropped ${dropped}), ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return { seeds, heap };
}

// Jittered equal-area point set with spacing ~sideKm (deterministic for an rng).
export function jitteredPoints(sideKm, rng) {
  const pts = [];
  const dLat = sideKm / EARTH_KM / DEG;
  for (let lat = -90 + dLat / 2; lat < 90; lat += dLat) {
    const dLon = Math.min(360, dLat / Math.max(0.01, Math.cos(lat * DEG)));
    const off = rng() * dLon;
    for (let lon = -180 + off; lon < 180; lon += dLon) {
      const la = Math.max(-89.999, Math.min(89.999, lat + (rng() - 0.5) * dLat * 0.7));
      let lo = lon + (rng() - 0.5) * dLon * 0.7;
      if (lo >= 180) lo -= 360; if (lo < -180) lo += 360;
      pts.push(lo, la);
    }
  }
  return Float64Array.from(pts);
}
