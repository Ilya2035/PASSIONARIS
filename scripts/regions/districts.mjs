// District post-processing on the MAP grid: absorbing river / small-water texels
// into land districts, adjacency with border lengths, sliver and islet merging,
// per-district statistics.
export const T_LAND = 1, T_MOUNT = 2, T_LAKE = 3, T_SEA = 4;
export const TYPE_NAMES = ['', 'land', 'mountain', 'lake', 'sea'];
export const isLandType = t => t === T_LAND || t === T_MOUNT;

// Texels with did == 0 and absorb[i] != 0 take the id of a neighbouring land
// district (BFS, 4-neighbour, deterministic order). Returns the number filled.
export function fillFromLand(grid, did, absorb, typeOf) {
  const { W, H, N } = grid;
  let q = new Int32Array(N), qn = 0;
  for (let i = 0; i < N; i++) {
    if (did[i] === 0 || !isLandType(typeOf[did[i]])) continue;
    const x = i % W, y = (i - x) / W;
    const r = i - x;
    if ((absorb[r + (x + 1) % W] && did[r + (x + 1) % W] === 0) || (absorb[r + (x + W - 1) % W] && did[r + (x + W - 1) % W] === 0) ||
      (y > 0 && absorb[i - W] && did[i - W] === 0) || (y < H - 1 && absorb[i + W] && did[i + W] === 0)) q[qn++] = i;
  }
  let head = 0, filled = 0;
  while (head < qn) {
    const i = q[head++];
    const x = i % W, y = (i - x) / W, r = i - x, id = did[i];
    const a = r + (x + 1) % W, b = r + (x + W - 1) % W;
    if (absorb[a] && did[a] === 0) { did[a] = id; q[qn++] = a; filled++; }
    if (absorb[b] && did[b] === 0) { did[b] = id; q[qn++] = b; filled++; }
    if (y > 0 && absorb[i - W] && did[i - W] === 0) { did[i - W] = id; q[qn++] = i - W; filled++; }
    if (y < H - 1 && absorb[i + W] && did[i + W] === 0) { did[i + W] = id; q[qn++] = i + W; filled++; }
  }
  q = null;
  return filled;
}

// Adjacency: 4-neighbour edges between different ids (both > 0).
// Returns { a: Int32Array, b: Int32Array, plain: Int32Array, river: Int32Array, count }.
export function adjacency(grid, did, barrier = null) {
  const { W, H } = grid;
  const keyIdx = new Map();
  let A = new Int32Array(1 << 16), B = new Int32Array(1 << 16), P = new Int32Array(1 << 16), R = new Int32Array(1 << 16), n = 0;
  const add = (p, q, riv) => {
    const lo = p < q ? p : q, hi = p < q ? q : p;
    const key = lo * 2097152 + hi;
    let k = keyIdx.get(key);
    if (k === undefined) {
      if (n >= A.length) {
        const g = arr => { const z = new Int32Array(arr.length * 2); z.set(arr); return z; };
        A = g(A); B = g(B); P = g(P); R = g(R);
      }
      k = n++; keyIdx.set(key, k); A[k] = lo; B[k] = hi;
    }
    if (riv) R[k]++; else P[k]++;
  };
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x, p = did[i];
      if (p === 0) continue;
      const j = row + (x + 1 === W ? 0 : x + 1), q = did[j];
      if (q !== p && q !== 0) add(p, q, barrier ? (barrier[i] | barrier[j]) : 0);
      if (y < H - 1) {
        const k = i + W, r = did[k];
        if (r !== p && r !== 0) add(p, r, barrier ? (barrier[i] | barrier[k]) : 0);
      }
    }
  }
  return { a: A.subarray(0, n), b: B.subarray(0, n), plain: P.subarray(0, n), river: R.subarray(0, n), count: n };
}

export class UnionFind {
  constructor(n) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(x) { const p = this.p; while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
}

// Merge small districts into neighbours. D = id upper bound (exclusive).
// type: Uint8 per id, comp: Int32 per id (water compartment, -1 for land),
// area: Float64 per id (updated), target: Float64 per id, adj from adjacency().
// opts.minShare: merge if area < minShare * target.
export function mergeSmall(D, type, comp, area, target, adj, uf, { minShare = 0.25, riverWeight = 0.25 } = {}) {
  const nb = Array.from({ length: D }, () => null);
  const link = (p, q, w) => { (nb[p] ||= new Map()).set(q, ((nb[p] && nb[p].get(q)) || 0) + w); };
  for (let k = 0; k < adj.count; k++) {
    const p = uf.find(adj.a[k]), q = uf.find(adj.b[k]);
    if (p === q) continue;
    const w = adj.plain[k] + riverWeight * adj.river[k];
    link(p, q, w); link(q, p, w);
  }
  const compatible = (s, r) => {
    const ts = type[s], tr = type[r];
    if (isLandType(ts)) return isLandType(tr);
    return ts === tr && comp[s] === comp[r];
  };
  let merged = 0;
  for (let pass = 0; pass < 6; pass++) {
    const cand = [];
    for (let s = 1; s < D; s++) if (uf.p[s] === s && area[s] > 0 && area[s] < minShare * target[s] && nb[s]) cand.push(s);
    cand.sort((a, b) => area[a] - area[b] || a - b);
    let m = 0;
    for (const s of cand) {
      if (uf.p[s] !== s || area[s] >= minShare * target[s] || !nb[s]) continue;
      let best = -1, bestScore = 0;
      for (const [r, w] of nb[s]) {
        if (!compatible(s, r)) continue;
        const same = type[s] === type[r] ? 1 : 0.15;
        const score = w * same / Math.sqrt(Math.max(area[r], 1) / target[r] + 0.25);
        if (score > bestScore || (score === bestScore && r < best)) { bestScore = score; best = r; }
      }
      if (best < 0) continue;
      // merge s into best
      uf.p[s] = best; area[best] += area[s]; area[s] = 0;
      const ns = nb[s]; nb[s] = null;
      for (const [n, w] of ns) {
        if (n === best) continue;
        link(best, n, w);
        const mn = nb[n]; mn.delete(s); mn.set(best, (mn.get(best) || 0) + w);
      }
      nb[best].delete(s);
      m++;
    }
    merged += m;
    if (!m) break;
  }
  return { merged, nb };
}

// Merge small isolated islands into the nearest land district within maxRings
// texels (searching across water). did must be relabelled to roots already.
export function mergeIslets(grid, did, D, type, area, target, nb, uf, { minShare = 0.25, maxRings = 13, capShare = 1.3, tinyShare = 0.05 } = {}) {
  const { W, H, N } = grid;
  const cand = new Uint8Array(D);
  let nc = 0;
  for (let s = 1; s < D; s++) {
    if (uf.p[s] !== s || !isLandType(type[s]) || area[s] <= 0 || area[s] >= minShare * target[s]) continue;
    let hasLand = false;
    if (nb[s]) for (const r of nb[s].keys()) if (isLandType(type[r])) { hasLand = true; break; }
    if (!hasLand) { cand[s] = 1; nc++; }
  }
  if (!nc) return 0;
  const texels = new Map();
  for (let i = 0; i < N; i++) { const s = did[i]; if (cand[s]) { let a = texels.get(s); if (!a) texels.set(s, a = []); a.push(i); } }
  const seen = new Int32Array(N);
  let stamp = 0, merged = 0;
  const order = [...texels.keys()].sort((a, b) => area[b] - area[a] || a - b);
  for (const s of order) {
    const root = uf.find(s);
    stamp++;
    let frontier = texels.get(s).slice();
    for (const i of frontier) seen[i] = stamp;
    let found = -1;
    for (let ring = 0; ring < maxRings && found < 0 && frontier.length; ring++) {
      const next = [];
      for (const i of frontier) {
        const x = i % W, y = (i - x) / W;
        const nbs = [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nbs) {
          if (j < 0 || seen[j] === stamp) continue;
          seen[j] = stamp;
          const t = did[j];
          if (t > 0) {
            const rt = uf.find(t);
            if (rt !== root && isLandType(type[rt])) { if (found < 0 || rt < found) found = rt; continue; }
          }
          next.push(j);
        }
      }
      frontier = next;
    }
    if (found < 0) continue;
    const ra = area[root], rb = area[found];
    if (ra < tinyShare * target[root] || ra + rb <= capShare * target[found]) {
      uf.p[root] = found; area[found] += ra; area[root] = 0; merged++;
    }
  }
  return merged;
}

// Per-district statistics after relabelling: area, centroid, anchor texel (closest
// to the centroid), mean height / relief, coast contact, bbox-ish lat range.
export function districtStats(grid, did, D, height, relief) {
  const { W, N, areaKm2, cosLat, sinLat, cosLon, sinLon } = grid;
  const area = new Float64Array(D), vx = new Float64Array(D), vy = new Float64Array(D), vz = new Float64Array(D);
  const hSum = new Float64Array(D), rSum = new Float64Array(D), count = new Int32Array(D);
  for (let i = 0; i < N; i++) {
    const s = did[i];
    if (s <= 0) continue;
    const x = i % W, y = (i - x) / W;
    const a = areaKm2[y];
    area[s] += a; count[s]++;
    vx[s] += a * cosLat[y] * sinLon[x]; vy[s] += a * sinLat[y]; vz[s] += a * cosLat[y] * cosLon[x];
    hSum[s] += a * height[i];
    if (relief) rSum[s] += a * relief[i];
  }
  for (let s = 1; s < D; s++) {
    const r = Math.hypot(vx[s], vy[s], vz[s]) || 1;
    vx[s] /= r; vy[s] /= r; vz[s] /= r;
  }
  const anchor = new Int32Array(D).fill(-1), bestDot = new Float64Array(D).fill(-2);
  for (let i = 0; i < N; i++) {
    const s = did[i];
    if (s <= 0) continue;
    const x = i % W, y = (i - x) / W;
    const d = vx[s] * cosLat[y] * sinLon[x] + vy[s] * sinLat[y] + vz[s] * cosLat[y] * cosLon[x];
    if (d > bestDot[s]) { bestDot[s] = d; anchor[s] = i; }
  }
  const meanH = new Float32Array(D), meanR = new Float32Array(D);
  for (let s = 1; s < D; s++) if (area[s] > 0) { meanH[s] = hSum[s] / area[s]; meanR[s] = rSum[s] / area[s]; }
  return { area, vx, vy, vz, anchor, meanH, meanR, count };
}
