// Partition of a weighted graph into connected parts of about one size. One tool for all three levels of the
// division: chunks → districts, districts → provinces, provinces → regions (docs/album/division.md).
//
// A graph here: n nodes with a position (x, y km) and a size (chunks), and edges with a cost (km of "walking"; a
// river or a ridge on the way makes it dearer). Parts grow from seeds by a shortest-path race (Dijkstra): every node
// goes to the seed that reaches it cheapest, so a dear edge — a river, a ridge — tends to become a border. Seeds are
// then moved to the middle of their parts (Lloyd), and every seed gets a weight that slows a part down while it is
// too big and speeds it up while it is too small, so the sizes even out. At the end parts that are still too small
// join a neighbour and parts that are still too big are cut in two. Each part is connected: a node always takes the
// seed of the node it was reached from.
//
// Everything is deterministic: the same graph gives the same parts (ties are broken by node number).

// a binary heap of (key, node), ties broken by the node number
export class Heap {
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
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
    const K = this.k, V = this.v, val = V[0];
    this.key = K[0];
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

// Builds a graph from edge triples. edges: flat array [a, b, cost, a, b, cost, …] (each pair once).
export function makeGraph(n, x, y, size, edges) {
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < edges.length; e += 3) { deg[edges[e]]++; deg[edges[e + 1]]++; }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
  const nb = new Int32Array(off[n]), cost = new Float64Array(off[n]), pen = new Float64Array(off[n]), fill = off.slice(0, n);
  for (let e = 0; e < edges.length; e += 3) {
    const a = edges[e], b = edges[e + 1], c = edges[e + 2], p = Math.max(0, c - Math.hypot(x[a] - x[b], y[a] - y[b]));
    nb[fill[a]] = b; pen[fill[a]] = p; cost[fill[a]++] = c; nb[fill[b]] = a; pen[fill[b]] = p; cost[fill[b]++] = c;
  }
  // cost: the whole price of the step; pen: what it costs beyond the straight distance (a river, a ridge)
  return { n, x, y, size, off, nb, cost, pen };
}

// The race from the seeds: label[i] = index of the seed that reaches node i cheapest. The price of a node is the
// straight distance from the seed times the weight of the seed, plus every river and ridge crossed on the way — the
// straight distance, not the steps along the grid, so open ground and water part along straight lines in every
// direction rather than only along the grid. Only nodes with allowed[i] === mark take part.
function race(g, nodes, seeds, weight, allowed, mark, label, dist, acc, heap) {
  heap.clear();
  for (const i of nodes) { dist[i] = Infinity; label[i] = -1; }
  for (let s = 0; s < seeds.length; s++) { const i = seeds[s]; if (dist[i] === 0) continue; dist[i] = 0; acc[i] = 0; label[i] = s; heap.push(0, i); }
  while (heap.n > 0) {
    const i = heap.pop(), d = heap.key;
    if (d > dist[i]) continue;
    const s = label[i], w = weight[s], sx = g.x[seeds[s]], sy = g.y[seeds[s]];
    for (let e = g.off[i]; e < g.off[i + 1]; e++) {
      const j = g.nb[e];
      if (allowed[j] !== mark || dist[j] === 0) continue;
      const a = acc[i] + g.pen[e], nd = a + Math.hypot(g.x[j] - sx, g.y[j] - sy) * w;
      if (nd < dist[j] || (nd === dist[j] && s < label[j])) { dist[j] = nd; acc[j] = a; label[j] = s; heap.push(nd, j); }
    }
  }
  // a node may have been won over after it passed its seed on: every part keeps only what hangs together with its
  // seed, the rest goes to the part beside it
  const ok = new Uint8Array(nodes.length), pos = new Map(nodes.map((i, q) => [i, q])), q = [];
  for (let s = 0; s < seeds.length; s++) { const i = seeds[s]; if (label[i] === s && !ok[pos.get(i)]) { ok[pos.get(i)] = 1; q.push(i); } }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let e = g.off[i]; e < g.off[i + 1]; e++) { const j = g.nb[e], p = pos.get(j); if (p !== undefined && !ok[p] && allowed[j] === mark && label[j] === label[i]) { ok[p] = 1; q.push(j); } }
  }
  if (q.length === nodes.length) return;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let e = g.off[i]; e < g.off[i + 1]; e++) { const j = g.nb[e], p = pos.get(j); if (p !== undefined && !ok[p] && allowed[j] === mark) { ok[p] = 1; label[j] = label[i]; q.push(j); } }
  }
}

const newScratch = n => ({ allowed: new Int32Array(n), label: new Int32Array(n), dist: new Float64Array(n), acc: new Float64Array(n), mark: 0 });

// Splits one connected set of nodes into k parts. → Int32Array part per node of `nodes` (0..k−1), in that order.
export function splitNodes(g, nodes, k, { iters = 10, heap = new Heap(), scratch } = {}) {
  const m = nodes.length, out = new Int32Array(m);
  if (k <= 1 || m <= 1) return out;
  k = Math.min(k, m);
  const S = scratch || newScratch(g.n);
  const mark = ++S.mark;
  let total = 0, cx = 0, cy = 0;
  for (const i of nodes) { S.allowed[i] = mark; total += g.size[i]; cx += g.x[i] * g.size[i]; cy += g.y[i] * g.size[i]; }
  cx /= total; cy /= total;
  // seeds spread by farthest-point sampling, the first one nearest the middle
  const near = new Float64Array(m).fill(Infinity), seeds = [];
  let first = 0, bd = Infinity;
  for (let q = 0; q < m; q++) { const i = nodes[q], d = (g.x[i] - cx) ** 2 + (g.y[i] - cy) ** 2; if (d < bd) { bd = d; first = q; } }
  seeds.push(nodes[first]);
  for (let s = 1; s < k; s++) {
    const last = seeds[s - 1];
    let far = -1, fd = -1;
    for (let q = 0; q < m; q++) {
      const i = nodes[q], d = (g.x[i] - g.x[last]) ** 2 + (g.y[i] - g.y[last]) ** 2;
      if (d < near[q]) near[q] = d;
      if (near[q] > fd) { fd = near[q]; far = q; }
    }
    seeds.push(nodes[far]);
  }
  const weight = new Float64Array(k).fill(1), want = total / k;
  const sz = new Float64Array(k), sx = new Float64Array(k), sy = new Float64Array(k), best = new Int32Array(k), bestD = new Float64Array(k);
  for (let it = 0; ; it++) {
    race(g, nodes, seeds, weight, S.allowed, mark, S.label, S.dist, S.acc, heap);
    if (it >= iters) break;
    sz.fill(0); sx.fill(0); sy.fill(0); bestD.fill(Infinity); best.fill(-1);
    for (const i of nodes) { const s = S.label[i]; if (s < 0) continue; sz[s] += g.size[i]; sx[s] += g.x[i] * g.size[i]; sy[s] += g.y[i] * g.size[i]; }
    for (const i of nodes) {
      const s = S.label[i]; if (s < 0) continue;
      const d = (g.x[i] - sx[s] / sz[s]) ** 2 + (g.y[i] - sy[s] / sz[s]) ** 2;
      if (d < bestD[s]) { bestD[s] = d; best[s] = i; }
    }
    for (let s = 0; s < k; s++) {
      if (best[s] >= 0) seeds[s] = best[s];
      weight[s] = Math.min(4, Math.max(.25, weight[s] * Math.pow(Math.max(sz[s], .5) / want, .45)));
    }
    // two seeds may have moved onto one node: keep the first, move the other to the farthest node of the largest part
    const seen = new Set();
    for (let s = 0; s < k; s++) {
      if (!seen.has(seeds[s])) { seen.add(seeds[s]); continue; }
      let far = -1, fd = -1;
      for (const i of nodes) if (!seen.has(i) && S.dist[i] > fd) { fd = S.dist[i]; far = i; }
      if (far >= 0) { seeds[s] = far; seen.add(far); weight[s] = 1; }
    }
  }
  for (let q = 0; q < m; q++) out[q] = Math.max(0, S.label[nodes[q]]);
  return out;
}

// Partition of the whole graph. Nodes with group[i] < 0 are left out (label −1); edges between different groups are
// not used. target: wanted size of a part (in node sizes). → { label: Int32Array, count }
// Parts below minK × target join a neighbour of the same group (the one behind the cheapest border); parts above
// maxK × target are cut. A connected piece smaller than minK × target (an island) stays a part of its own.
export function partition(g, group, target, { iters = 10, minK = .4, maxK = 2, roundK = .5 } = {}) {
  const heap = new Heap(4096), scratch = newScratch(g.n);
  const sameGroup = (a, b) => group[a] === group[b];
  // edges across groups do not exist for the partition
  const g2 = { ...g, cost: g.cost.slice() };
  for (let i = 0; i < g.n; i++) for (let e = g.off[i]; e < g.off[i + 1]; e++) if (!sameGroup(i, g.nb[e])) g2.cost[e] = Infinity;
  // connected pieces of one group each
  const pieces = [];
  const seen = new Int32Array(g.n).fill(-1);
  for (let s = 0; s < g.n; s++) {
    if (group[s] < 0 || seen[s] >= 0) continue;
    const list = [s]; seen[s] = pieces.length;
    for (let q = 0; q < list.length; q++) {
      const i = list[q];
      for (let e = g.off[i]; e < g.off[i + 1]; e++) { const j = g.nb[e]; if (seen[j] < 0 && group[j] === group[i]) { seen[j] = pieces.length; list.push(j); } }
    }
    list.sort((a, b) => a - b); pieces.push(list);
  }
  const label = new Int32Array(g.n).fill(-1);
  let count = 0;
  for (const list of pieces) {
    let total = 0; for (const i of list) total += g.size[i];
    const k = Math.max(1, Math.floor(total / target + roundK));
    const part = splitNodes(g2, list, k, { iters, heap, scratch });
    for (let q = 0; q < list.length; q++) label[list[q]] = count + part[q];
    count += k;
  }
  return tidy(g2, group, label, count, target, { minK, maxK, heap, scratch, iters });
}

// sizes of parts, joins the too small ones to a neighbour, cuts the too big ones, numbers the parts again from 0 in
// the order of their first node
export function tidy(g, group, label, count, target, { minK = .4, maxK = 2, heap = new Heap(), scratch, iters = 8 } = {}) {
  scratch ||= newScratch(g.n);
  const members = () => { const m = Array.from({ length: count }, () => []); for (let i = 0; i < g.n; i++) if (label[i] >= 0) m[label[i]].push(i); return m; };
  for (let round = 0; round < 6; round++) {
    let changed = false;
    // cut the too big ones
    let mem = members();
    for (let p = 0; p < mem.length; p++) {
      const list = mem[p]; let total = 0; for (const i of list) total += g.size[i];
      if (total <= maxK * target || list.length < 2) continue;
      const k = Math.max(2, Math.round(total / target));
      const part = splitNodes(g, list, k, { iters, heap, scratch });
      for (let q = 0; q < list.length; q++) if (part[q] > 0) label[list[q]] = count + part[q] - 1;
      count += k - 1; changed = true;
    }
    // join the too small ones, smallest first, each to the neighbour behind the cheapest border
    mem = members();
    const size = mem.map(list => list.reduce((s, i) => s + g.size[i], 0));
    const order = mem.map((_, p) => p).sort((a, b) => size[a] - size[b] || a - b);
    for (const p of order) {
      if (!mem[p].length || size[p] >= minK * target) continue;
      const border = new Map();
      for (const i of mem[p]) for (let e = g.off[i]; e < g.off[i + 1]; e++) {
        const j = g.nb[e], q = label[j];
        if (q < 0 || q === p || group[j] !== group[i] || !Number.isFinite(g.cost[e])) continue;
        const b = border.get(q) || { n: 0, c: 0 }; b.n++; b.c += g.cost[e]; border.set(q, b);
      }
      let best = -1, bs = Infinity;
      for (const [q, b] of [...border].sort((a, b2) => a[0] - b2[0])) {
        const s = (b.c / b.n) / Math.sqrt(b.n) * (1 + size[q] / target);
        if (s < bs) { bs = s; best = q; }
      }
      if (best < 0) continue;
      for (const i of mem[p]) label[i] = best;
      mem[best] = mem[best].concat(mem[p]); size[best] += size[p]; mem[p] = []; size[p] = 0; changed = true;
    }
    if (!changed) break;
  }
  // number again in the order of first nodes
  const map = new Map(); let n = 0;
  for (let i = 0; i < g.n; i++) if (label[i] >= 0 && !map.has(label[i])) map.set(label[i], n++);
  for (let i = 0; i < g.n; i++) if (label[i] >= 0) label[i] = map.get(label[i]);
  return { label, count: n };
}
