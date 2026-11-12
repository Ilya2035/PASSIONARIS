// Roads as people would have laid them (the owner, 12.11.2026: «дорога всегда старалась идти через проходимые пути,
// не через горы… входит в район, идёт через его центр и там расходится… самые логичные пути, исторические пути. Не
// как сейчас, просто линии, которые ни на что не опираются»).
//   • The land is the fine raster (texels of 1.25 km) with its heights and rivers. A step costs its length, much more
//     on a slope, a little more high up; stepping onto a river costs a crossing (a ford or a bridge). So a way keeps to
//     valleys, crosses a range at a pass and a river once, square on.
//   • A road never runs anywhere but from the centre of a district to the centre of a neighbouring one: such a stretch
//     is a LEG, the cheapest way between the two centres. A leg that costs far more than its length is no road at
//     all: the mountain is impassable there (a tunnel, one day).
//   • Main roads join the largest places through the chain of districts between them, lesser roads the other places;
//     then every remaining district gets a track to its nearest neighbour that already has a road. Roads meet and
//     part only at centres.
// Plain JavaScript without the GPU: the same division always gives the same roads.
import { FN, FKM, kmOf, llOf } from '../chunks.js';
import { Heap } from '../division/graph.js';

const X0 = -880, Y0 = 3880, LAND = 0;
export const STEEP = [28, 520];                    // a slope s (rise over run) makes a step 1 + 28 s + 520 s² times dearer
export const HIGH = .00012;                        // … and every metre above the sea by this share
export const CROSSING = [0, 2.5, 5, 9];            // km of way for stepping onto a river: a small one, a lesser, a great
export const HARD = 5.5;                           // a leg dearer than this many times its length (and 6 km) is impassable
export const TRACK_MAX = 90;                       // a track to a district is laid only if its leg costs no more, km of way
const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
const texelOf = (x, y) => { const tx = Math.floor((x - X0) / FKM), ty = Math.floor((y - Y0) / FKM); return tx < 0 || ty < 0 || tx >= FN || ty >= FN ? -1 : ty * FN + tx; };

// the ground the roads are laid on: { land (1 where a land district is), hgt, riv } from the division
export function roadGround(div) {
  const n = FN * FN, land = new Uint8Array(n);
  for (let t = 0; t < n; t++) { const d = div.cells[t]; land[t] = d >= 0 && div.kinds[d] === LAND ? 1 : 0; }
  return { land, hgt: div.raster.hgt, riv: div.raster.riv, g: new Float64Array(n), mark: new Int32Array(n), done: new Int32Array(n), from: new Int32Array(n), stamp: 0, heap: new Heap(1 << 12) };
}
export function stepCost(G, t, u, diag) {
  const d = diag ? 1.4142 : 1, s = Math.abs(G.hgt[u] - G.hgt[t]) / (d * FKM * 1000);
  return d * FKM * (1 + STEEP[0] * s + STEEP[1] * s * s) * (1 + G.hgt[u] * HIGH) + (G.riv[u] > 0 && G.riv[t] === 0 ? CROSSING[G.riv[u]] : 0);
}
// the cheapest way over land from texel a to texel b → { path: [texels a … b], cost (km of way), km, crossings: [texels] } or null
export function legBetween(G, a, b) {
  if (a < 0 || b < 0 || !G.land[a] || !G.land[b]) return null;
  const ax = a % FN, ay = (a - ax) / FN, bx = b % FN, by = (b - bx) / FN, M = 8 + Math.round(Math.max(Math.abs(ax - bx), Math.abs(ay - by)) * .6);
  const x0 = Math.max(0, Math.min(ax, bx) - M), x1 = Math.min(FN - 1, Math.max(ax, bx) + M), y0 = Math.max(0, Math.min(ay, by) - M), y1 = Math.min(FN - 1, Math.max(ay, by) + M);
  const stamp = ++G.stamp, heap = G.heap; heap.clear();
  G.g[a] = 0; G.mark[a] = stamp; G.from[a] = -1; heap.push(Math.hypot(ax - bx, ay - by) * FKM, a);
  while (heap.n) {
    const t = heap.pop(); if (G.done[t] === stamp) continue; G.done[t] = stamp; if (t === b) break;
    const tx = t % FN, ty = (t - tx) / FN, gt = G.g[t];
    for (let q = 0; q < 16; q += 2) {
      const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < x0 || uy < y0 || ux > x1 || uy > y1) continue;
      const u = uy * FN + ux; if (!G.land[u] || G.done[u] === stamp) continue;
      const c = gt + stepCost(G, t, u, q >= 8);
      if (G.mark[u] !== stamp || c < G.g[u]) { G.g[u] = c; G.mark[u] = stamp; G.from[u] = t; heap.push(c + Math.hypot(ux - bx, uy - by) * FKM, u); }
    }
  }
  if (G.done[b] !== stamp) return null;
  const path = [], crossings = []; let km = 0;
  for (let t = b; t >= 0; t = G.from[t]) { path.push(t); const f = G.from[t]; if (f >= 0) { km += (Math.abs(t - f) === 1 || Math.abs(t - f) === FN ? 1 : 1.4142) * FKM; if (G.riv[t] > 0 && G.riv[f] === 0) crossings.push(t); } }
  path.reverse();
  return { path, cost: G.g[b], km, crossings };
}

// div: the division (cells, kinds, count); centres: districtCentres(); places: [{ lat, lon, pop }], the largest first
// → { lines: [{ kind (0 main, 1 lesser, 2 track), pts: [[x, y] flat km …] }], legs: […], crossings: [[x, y] …],
//     stats: { legs, hard, main, lesser, track, km: [main, lesser, track], crossings, unreached } }
export function roadNetwork(div, centres, places = [], G = roadGround(div)) {
  const count = div.count, cells = div.cells, n = FN * FN;
  // which districts touch: sides of texels between two land districts
  const touch = new Map();
  for (let ty = 0; ty < FN - 1; ty++) for (let tx = 0; tx < FN - 1; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || div.kinds[d] !== LAND) continue;
    for (const u of [t + 1, t + FN]) { const e = cells[u]; if (e < 0 || e === d || div.kinds[e] !== LAND) continue; const k = d < e ? d * 65536 + e : e * 65536 + d; touch.set(k, (touch.get(k) || 0) + 1); }
  }
  // a leg for every pair of neighbours with centres
  const legs = [], of = Array.from({ length: count }, () => []); let hard = 0;
  for (const [k, sides] of [...touch].sort((p, q) => p[0] - q[0])) {
    if (sides < 2) continue;
    const a = Math.floor(k / 65536), b = k % 65536; if (centres.texel[a] < 0 || centres.texel[b] < 0) continue;
    const L = legBetween(G, centres.texel[a], centres.texel[b]); if (!L) continue;
    const straight = Math.hypot(centres.x[a] - centres.x[b], centres.y[a] - centres.y[b]);
    if (L.cost > HARD * straight + 6) { hard++; continue; }                  // impassable: no road between these two
    const i = legs.length; legs.push({ a, b, cost: L.cost, km: L.km, path: L.path, crossings: L.crossings, kind: 3 }); of[a].push(i); of[b].push(i);
  }
  // the cheapest chain of legs from some districts to all others
  const heap = new Heap(1024), dist = new Float64Array(count), via = new Int32Array(count);
  const spread = sources => {
    dist.fill(Infinity); via.fill(-1); heap.clear();
    for (const s of sources) { dist[s] = 0; heap.push(0, s); }
    while (heap.n) { const d = heap.pop(), dd = heap.key; if (dd > dist[d]) continue;
      for (const i of of[d]) { const L = legs[i], e = L.a === d ? L.b : L.a, c = dd + L.cost; if (c < dist[e]) { dist[e] = c; via[e] = i; heap.push(c, e); } } }
  };
  const districtOf = p => { const [x, y] = kmOf(p.lat, p.lon), t = texelOf(x, y); if (t < 0) return -1; const d = cells[t]; return d >= 0 && div.kinds[d] === LAND ? d : -1; };
  const town = places.map(p => ({ p, d: districtOf(p) })).filter(q => q.d >= 0);
  const big = town.slice(0, 16), rest = town.slice(16, 60), near = (a, list, k) => list.filter(q => q !== a && q.d !== a.d).sort((p, q) => Math.hypot(p.p.lat - a.p.lat, (p.p.lon - a.p.lon) * .77) - Math.hypot(q.p.lat - a.p.lat, (q.p.lon - a.p.lon) * .77)).slice(0, k);
  const links = []; for (const a of big) for (const b of near(a, big, 3)) links.push([a, b, 0]); for (const a of rest) for (const b of near(a, [...big, ...rest], 2)) links.push([a, b, 1]);
  // every link is walked from one town to the other; a run of legs not yet a road becomes a new line of the road
  const lines = [], used = new Uint8Array(legs.length);
  const pointsOf = (run, from) => {                               // the texels of a run of legs, from district `from` on
    const pts = []; let at = from;
    for (const i of run) { const L = legs[i], fw = L.a === at, path = fw ? L.path : [...L.path].reverse(), to = fw ? L.b : L.a;
      pts.push(pts.length ? null : [centres.x[at], centres.y[at]]);
      for (let j = 1; j < path.length - 1; j++) pts.push([X0 + (path[j] % FN + .5) * FKM, Y0 + (Math.floor(path[j] / FN) + .5) * FKM]);
      pts.push([centres.x[to], centres.y[to]]); at = to; }
    return pts.filter(Boolean);
  };
  const lay = (chain, from, kind) => {                             // chain: legs in the order they are walked from `from`
    let run = [], start = from, at = from;
    const flush = () => { if (run.length) lines.push({ kind, pts: pointsOf(run, start), legs: run }); run = []; };
    for (const i of chain) { const L = legs[i], to = L.a === at ? L.b : L.a;
      if (used[i]) { flush(); start = to; } else { if (!run.length) start = at; run.push(i); used[i] = 1; L.kind = kind; }
      at = to; }
    flush();
  };
  let last = -1;
  for (const [a, b, kind] of links.sort((p, q) => p[2] - q[2])) {
    if (a.d !== last) { spread([a.d]); last = a.d; }
    if (!(dist[b.d] < Infinity)) continue;
    const chain = []; for (let d = b.d; via[d] >= 0; d = legs[via[d]].a === d ? legs[via[d]].b : legs[via[d]].a) chain.push(via[d]);
    lay(chain, b.d, kind);
  }
  // tracks: every other district to its nearest neighbour that has a road, the far ones first so that a long way in
  // is one line
  const on = new Set(); for (let i = 0; i < legs.length; i++) if (used[i]) { on.add(legs[i].a); on.add(legs[i].b); }
  if (!on.size && town.length) on.add(town[0].d);
  if (on.size) {
    const heavy = legs.map(L => L.cost); for (const L of legs) if (L.cost > TRACK_MAX) L.cost = Infinity;
    spread([...on]);
    legs.forEach((L, i) => { L.cost = heavy[i]; });
    const order = []; for (let d = 0; d < count; d++) if (via[d] >= 0 && dist[d] < Infinity) order.push(d);
    order.sort((p, q) => dist[q] - dist[p] || p - q);
    for (const d0 of order) { const chain = []; for (let d = d0; via[d] >= 0 && !used[via[d]]; d = legs[via[d]].a === d ? legs[via[d]].b : legs[via[d]].a) chain.push(via[d]); if (chain.length) lay(chain, d0, 2); }
  }
  let unreached = 0; for (let d = 0; d < count; d++) if (div.kinds[d] === LAND && centres.texel[d] >= 0 && !of[d].some(i => used[i])) unreached++;
  const km = [0, 0, 0], num = [0, 0, 0], crossings = [];
  legs.forEach((L, i) => { if (!used[i]) return; km[L.kind] += L.km; num[L.kind]++; for (const t of L.crossings) crossings.push([X0 + (t % FN + .5) * FKM, Y0 + (Math.floor(t / FN) + .5) * FKM]); });
  return { lines, legs, crossings, stats: { legs: legs.length, hard, main: num[0], lesser: num[1], track: num[2], km: km.map(Math.round), crossings: crossings.length, unreached } };
}

// a line of the network as the ribbons want it: the steps of the texels ironed out, [[lon, lat] …]
export function roadLine(pts) {
  let p = pts;
  for (let it = 0; it < 2 && p.length > 3; it++) p = p.map((v, i) => (i === 0 || i === p.length - 1 ? v : [(p[i - 1][0] + 2 * v[0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * v[1] + p[i + 1][1]) / 4]));
  return p.map(([x, y]) => { const q = llOf(x, y); return [q.lon, q.lat]; });
}
