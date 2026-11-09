// Agglomeration of a weighted adjacency graph into contiguous groups of a target
// weight: farthest-point seeding + graph Lloyd (multi-source Dijkstra) with
// split / drop balancing, small-group cleanup and attachment of islands.
// Used for districts -> provinces -> regions (land and sea separately).
import { Heap, EARTH_KM } from './grid.mjs';

// g: { n, x, y, z (unit vectors, Float64Array), weight (Float64Array),
//      adj: Array<Array<[j, cost, border]>> }
export function groupGraph(g, { target, iterations = 8, splitK = 1.8, dropK = 0.35, smallShare = 0.35, minShare = 0.3, attachKm = 600 } = {}) {
  const { n, x, y, z, weight, adj } = g;
  const heap = new Heap(1024);
  // ---------------------------------------------------- connected components
  const cc = new Int32Array(n).fill(-1);
  const ccNodes = [];
  for (let s = 0; s < n; s++) {
    if (cc[s] >= 0) continue;
    const id = ccNodes.length, list = [s];
    cc[s] = id;
    for (let k = 0; k < list.length; k++) for (const [j] of adj[list[k]]) if (cc[j] < 0) { cc[j] = id; list.push(j); }
    ccNodes.push(list);
  }
  const ccW = ccNodes.map(l => l.reduce((a, i) => a + weight[i], 0));
  const nearestToCentroid = list => {
    let sx = 0, sy = 0, sz = 0;
    for (const i of list) { sx += weight[i] * x[i]; sy += weight[i] * y[i]; sz += weight[i] * z[i]; }
    let best = list[0], bd = -2;
    for (const i of list) { const d = sx * x[i] + sy * y[i] + sz * z[i]; if (d > bd || (d === bd && i < best)) { bd = d; best = i; } }
    return best;
  };
  // ---------------------------------------------------- farthest-point seeds
  const minD = new Float64Array(n).fill(Infinity);
  const relax = (src) => {
    heap.clear(); minD[src] = 0; heap.push(0, src);
    while (heap.n) {
      const i = heap.pop(), d = heap.topKey;
      if (d > minD[i]) continue;
      for (const [j, c] of adj[i]) { const nd = d + c; if (nd < minD[j]) { minD[j] = nd; heap.push(nd, j); } }
    }
  };
  let seeds = [];
  const big = [];
  ccNodes.forEach((list, c) => {
    if (ccW[c] < smallShare * target) return;
    big.push(c);
    const k = Math.max(1, Math.round(ccW[c] / target));
    let s = nearestToCentroid(list);
    seeds.push(s); relax(s);
    for (let m = 1; m < k; m++) {
      let far = -1, fd = -1;
      for (const i of list) if (minD[i] > fd || (minD[i] === fd && i < far)) { fd = minD[i]; far = i; }
      if (far < 0 || fd <= 0) break;
      seeds.push(far); relax(far);
    }
  });
  // ---------------------------------------------------- graph Lloyd
  const grp = new Int32Array(n), dist = new Float64Array(n);
  const assign = sd => {
    grp.fill(-1); dist.fill(Infinity); heap.clear();
    sd.forEach((s, k) => { if (dist[s] === 0) return; dist[s] = 0; grp[s] = k; heap.push(0, s); });
    while (heap.n) {
      const i = heap.pop(), d = heap.topKey;
      if (d > dist[i]) continue;
      for (const [j, c] of adj[i]) { const nd = d + c; if (nd < dist[j]) { dist[j] = nd; grp[j] = grp[i]; heap.push(nd, j); } }
    }
  };
  for (let it = 0; it <= iterations; it++) {
    assign(seeds);
    if (it === iterations) break;
    const S = seeds.length;
    const gw = new Float64Array(S), gx = new Float64Array(S), gy = new Float64Array(S), gz = new Float64Array(S);
    const far = new Int32Array(S).fill(-1), farD = new Float64Array(S).fill(-1);
    for (let i = 0; i < n; i++) {
      const k = grp[i]; if (k < 0) continue;
      gw[k] += weight[i]; gx[k] += weight[i] * x[i]; gy[k] += weight[i] * y[i]; gz[k] += weight[i] * z[i];
      if (dist[i] > farD[k]) { farD[k] = dist[i]; far[k] = i; }
    }
    const best = new Int32Array(S).fill(-1), bd = new Float64Array(S).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const k = grp[i]; if (k < 0) continue;
      const d = gx[k] * x[i] + gy[k] * y[i] + gz[k] * z[i];
      if (d > bd[k] || (d === bd[k] && i < best[k])) { bd[k] = d; best[k] = i; }
    }
    const order = Array.from({ length: S }, (_, k) => k).sort((a, b) => gw[b] - gw[a] || a - b);
    const keptCC = new Set(), next = [], used = new Set();
    const add = s => { if (s >= 0 && !used.has(s)) { used.add(s); next.push(s); } };
    for (const k of order) {
      const s = best[k] >= 0 ? best[k] : seeds[k];
      const c = cc[s];
      if (gw[k] < dropK * target && keptCC.has(c)) continue;
      keptCC.add(c);
      add(s);
      if (gw[k] > splitK * target && far[k] >= 0) add(far[k]);
    }
    next.sort((a, b) => a - b);
    seeds = next;
  }
  // ---------------------------------------------------- cleanup of small groups
  let G = seeds.length;
  const parent = Int32Array.from({ length: G }, (_, k) => k);
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (let pass = 0; pass < 4; pass++) {
    const gw = new Float64Array(G);
    for (let i = 0; i < n; i++) if (grp[i] >= 0) gw[find(grp[i])] += weight[i];
    const border = new Map();
    for (let i = 0; i < n; i++) {
      const a = grp[i] >= 0 ? find(grp[i]) : -1; if (a < 0) continue;
      for (const [j, , b] of adj[i]) {
        const c = grp[j] >= 0 ? find(grp[j]) : -1;
        if (c < 0 || c === a) continue;
        let m = border.get(a); if (!m) border.set(a, m = new Map());
        m.set(c, (m.get(c) || 0) + (b || 1));
      }
    }
    const small = [];
    for (let k = 0; k < G; k++) if (find(k) === k && gw[k] > 0 && gw[k] < minShare * target && border.has(k)) small.push(k);
    small.sort((a, b) => gw[a] - gw[b] || a - b);
    let merged = 0;
    for (const k of small) {
      if (find(k) !== k) continue;
      let best = -1, bb = 0;
      for (const [c, b] of border.get(k)) { const r = find(c); if (r === k) continue; if (b > bb || (b === bb && r < best)) { bb = b; best = r; } }
      if (best >= 0) { parent[k] = best; gw[best] += gw[k]; merged++; }
    }
    if (!merged) break;
  }
  for (let i = 0; i < n; i++) if (grp[i] >= 0) grp[i] = find(grp[i]);
  // ---------------------------------------------------- small components (islands)
  const smallCC = ccNodes.map((l, c) => c).filter(c => ccW[c] < smallShare * target).sort((a, b) => ccW[b] - ccW[a] || a - b);
  const assigned = [];
  for (let i = 0; i < n; i++) if (grp[i] >= 0) assigned.push(i);
  const cosLim = Math.cos(attachKm / EARTH_KM);
  for (const c of smallCC) {
    const list = ccNodes[c];
    const s = nearestToCentroid(list);
    let best = -1, bd = -2;
    for (const i of assigned) { const d = x[s] * x[i] + y[s] * y[i] + z[s] * z[i]; if (d > bd) { bd = d; best = i; } }
    const gid = best >= 0 && bd >= cosLim ? grp[best] : G++;
    for (const i of list) { grp[i] = gid; assigned.push(i); }
  }
  // ---------------------------------------------------- compact numbering
  const remap = new Map();
  for (let i = 0; i < n; i++) {
    if (grp[i] < 0) continue;
    if (!remap.has(grp[i])) remap.set(grp[i], remap.size);
    grp[i] = remap.get(grp[i]);
  }
  return { group: grp, count: remap.size };
}
