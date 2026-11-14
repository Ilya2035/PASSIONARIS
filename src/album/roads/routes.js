// Roads as people would have laid them (the owner, 12.11.2026: «дорога всегда старалась идти через проходимые пути,
// не через горы… входит в район, идёт через его центр и там расходится… самые логичные пути, исторические пути. Не
// как сейчас, просто линии, которые ни на что не опираются»; 13.11.2026: «нужно прочертить все дороги заранее…
// главные дороги (от провинции к провинции) и малые дороги; плюс мелкие улочки и тропы»).
//   • The land is the chunks of 1 km² with their heights and rivers. A step costs its length, much more on a slope, a
//     little more high up; stepping onto a river costs a crossing (a ford or a bridge). So a way keeps to valleys,
//     crosses a range at a pass and a river once, square on.
//   • A road never runs anywhere but from the centre of a district to the centre of a neighbouring one: such a stretch
//     is a LEG, the cheapest way between the two centres. A leg that costs far more than its length is no road at
//     all: the mountain is impassable there (a tunnel, one day).
//   • A great road of history takes a range at its real PASS: a point with a name in roads/historic.js. There a leg
//     is led from the centre of a district on one side over that very point to the centre of a district on the other
//     side, whatever it costs. The two need not be neighbours: the valley that leads up to a pass is often the edge
//     of two districts, with their centres in other valleys, and the road of the pass keeps to its own valley.
//   • MAIN roads (kind 0): first the great roads of history (roads/historic.js), town after town; then the town of
//     every province is joined with the towns of the provinces next to it — unless the main roads already laid lead
//     there almost as fast. A new main road likes to run along one that is there: roads gather into trunks.
//   • LESSER roads (kind 1) run between districts: the cheapest legs first, and a leg is laid only where the roads
//     laid so far make a long way round. Every district that can be reached is reached.
//   • TRACKS (kind 2) are the same for hard ground: a leg that climbs is a mule track over its pass, not a road.
//     (The paths to the villages are tracks too; the settlements lay them: town/tracks.js.)
// Plain JavaScript without the GPU: the same division always gives the same roads. The page does not work the
// network out at every start: it is laid once (scripts/album/bake-roads.mjs) and kept in
// public/assets/album/roads/roads.bin.gz; netSignature() tells whether the file was laid for this very division.
import { kmOf, llOf } from '../chunks.js';
import { KN as FN, KKM as FKM } from '../division/km.js';
import { Heap } from '../division/graph.js';
import { HISTORIC } from './historic.js';

const X0 = -880, Y0 = 3880, LAND = 0;
export const STEEP = [28, 520];                    // a slope s (rise over run) makes a step 1 + 28 s + 520 s² times dearer
export const HIGH = .00012;                        // … and every metre above the sea by this share
export const CROSSING = [0, 2.5, 5, 9];            // km of way for stepping onto a river: a small one, a lesser, a great
export const ALONG = 1.5;                          // … and for every further step in the bed of a river: a road keeps to the bank
export const HARD = 5.5;                           // a leg dearer than this many times its length (and 6 km) is impassable
export const SPAN_MAIN = 1.3;                      // a main road between two provinces is laid unless the main roads there are no more than this many times longer
export const SPAN_LESSER = 2.1;                    // the same for a leg between two districts and all roads laid so far
export const TRUNK = .8;                           // a main road finds a leg that is a main road already this much cheaper
export const POOR = 2.1;                           // a leg that costs this many times its length is a track, not a road
// passes. rise: a leg has a pass where it climbs this many metres over both its ends. A pass of history is joined
// with the centres of two districts no farther than `reach` km from it; of two ways about as cheap, the one between
// the nearer centres is taken: every km from the pass to a centre counts as `keep` km of way more; and where the way
// to a centre passes another centre within `by` km, the leg ends there: the road goes through that town, not past it
export const PASS = { rise: 120, reach: 40, keep: 1.2, by: 2 };
export const NET_ALGO = 5;                         // changes whenever the rules above do: a kept network of another number is laid anew
const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
const texelOf = (x, y) => { const tx = Math.floor((x - X0) / FKM), ty = Math.floor((y - Y0) / FKM); return tx < 0 || ty < 0 || tx >= FN || ty >= FN ? -1 : ty * FN + tx; };
const xyOf = t => [X0 + (t % FN + .5) * FKM, Y0 + (Math.floor(t / FN) + .5) * FKM];

// the ground the roads are laid on: { land (1 where a land district is), hgt, riv } from the division
export function roadGround(div) {
  const n = FN * FN, land = new Uint8Array(n);
  for (let t = 0; t < n; t++) { const d = div.cells[t]; land[t] = d >= 0 && div.kinds[d] === LAND ? 1 : 0; }
  return { land, hgt: div.raster.hgt, riv: div.raster.riv, g: new Float64Array(n), mark: new Int32Array(n), done: new Int32Array(n), from: new Int32Array(n), stamp: 0, heap: new Heap(1 << 12) };
}
export function stepCost(G, t, u, diag) {
  const d = diag ? 1.4142 : 1, s = Math.abs(G.hgt[u] - G.hgt[t]) / (d * FKM * 1000);
  return d * FKM * (1 + STEEP[0] * s + STEEP[1] * s * s) * (1 + G.hgt[u] * HIGH) + (G.riv[u] > 0 ? (G.riv[t] === 0 ? CROSSING[G.riv[u]] : ALONG) : 0);
}
// where a path steps onto a river: the chunks of its crossings
const crossingsOf = (G, path) => { const out = []; for (let i = 1; i < path.length; i++) if (G.riv[path[i]] > 0 && G.riv[path[i - 1]] === 0) out.push(path[i]); return out; };
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
  const path = []; let km = 0;
  for (let t = b; t >= 0; t = G.from[t]) { path.push(t); const f = G.from[t]; if (f >= 0) km += (Math.abs(t - f) === 1 || Math.abs(t - f) === FN ? 1 : 1.4142) * FKM; }
  path.reverse();
  return { path, cost: G.g[b], km, crossings: crossingsOf(G, path) };
}
// the cheapest ways from texel a to every land texel of the square that reaches R texels from it. While G.stamp is the
// number returned, G.done[u] === that number tells that u was reached, G.g[u] is what the way costs and G.from leads back
export function fanFrom(G, a, R) {
  const ax = a % FN, ay = (a - ax) / FN, x0 = Math.max(0, ax - R), x1 = Math.min(FN - 1, ax + R), y0 = Math.max(0, ay - R), y1 = Math.min(FN - 1, ay + R);
  const stamp = ++G.stamp, heap = G.heap; heap.clear();
  G.g[a] = 0; G.mark[a] = stamp; G.from[a] = -1; heap.push(0, a);
  while (heap.n) {
    const t = heap.pop(); if (G.done[t] === stamp) continue; G.done[t] = stamp;
    const tx = t % FN, ty = (t - tx) / FN, gt = G.g[t];
    for (let q = 0; q < 16; q += 2) {
      const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < x0 || uy < y0 || ux > x1 || uy > y1) continue;
      const u = uy * FN + ux; if (!G.land[u] || G.done[u] === stamp) continue;
      const c = gt + stepCost(G, t, u, q >= 8);
      if (G.mark[u] !== stamp || c < G.g[u]) { G.g[u] = c; G.mark[u] = stamp; G.from[u] = t; heap.push(c, u); }
    }
  }
  return stamp;
}

// The town of every land province: the district its main roads start from (−1: the province has no district with a
// centre). The largest of `places` that stands in the province; in a province with none of them, the centre that
// stands on the most important real settlement (centres.site: the lower the number, the greater the place); failing
// that, the centre nearest to the middle of the province. What the division says itself wins: centres.seat[d] with
// bit 1 set (the main town of its province stands in district d), or div.capitals (province → district).
export function provinceTowns(div, centres, places = []) {
  const P = div.provinceCount ?? (div.provinces ? div.provinces.length : 0), cap = new Int32Array(P).fill(-1); if (!P || !div.province) return cap;
  const districtAt = p => { const [x, y] = kmOf(p.lat, p.lon), t = texelOf(x, y); if (t < 0) return -1; const d = div.cells[t]; return d >= 0 && div.kinds[d] === LAND && centres.texel[d] >= 0 ? d : -1; };
  for (const p of places) { const d = districtAt(p); if (d >= 0 && cap[div.province[d]] < 0) cap[div.province[d]] = d; }
  const best = new Float64Array(P).fill(Infinity), mx = new Float64Array(P), my = new Float64Array(P), num = new Float64Array(P);
  for (let d = 0; d < div.count; d++) { if (div.kinds[d] !== LAND || centres.texel[d] < 0) continue; const p = div.province[d]; mx[p] += centres.x[d]; my[p] += centres.y[d]; num[p]++; }
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== LAND || centres.texel[d] < 0) continue;
    const p = div.province[d]; if (cap[p] >= 0 && best[p] === Infinity) continue;       // a place of the list holds it
    const s = centres.site[d], sc = s >= 0 ? s : 1e7 + Math.hypot(centres.x[d] - mx[p] / num[p], centres.y[d] - my[p] / num[p]);
    if (sc < best[p]) { best[p] = sc; cap[p] = d; }
  }
  // the division may say itself which district holds the main town of its province: centres.seat (bit 1), or div.capitals
  if (centres.seat) for (let d = 0; d < div.count; d++) if ((centres.seat[d] & 1) && div.kinds[d] === LAND && centres.texel[d] >= 0) cap[div.province[d]] = d;
  if (div.capitals) for (let p = 0; p < P; p++) { const d = div.capitals[p]; if (d >= 0 && div.kinds[d] === LAND && centres.texel[d] >= 0) cap[p] = d; }
  return cap;
}

// the points of a line: the chunks of its legs one after another, from district `from` on, through the centres
export function linePoints(legs, centres, run, from) {
  const pts = []; let at = from;
  for (const i of run) {
    const L = legs[i], fw = L.a === at, path = L.path, n = path.length, to = fw ? L.b : L.a;
    if (!pts.length) pts.push([centres.x[at], centres.y[at]]);
    for (let j = 1; j < n - 1; j++) pts.push(xyOf(path[fw ? j : n - 1 - j]));
    pts.push([centres.x[to], centres.y[to]]); at = to;
  }
  return pts;
}

// div: the division (cells, kinds, count, province …); centres: districtCentres(); places: [{ lat, lon, pop }], the
// largest first; opts.historic: the great roads of history (roads/historic.js unless given; [] for none)
// → { lines: [{ kind (0 main, 1 lesser, 2 track), pts: [[x, y] flat km …], legs: [numbers], start (district), name }],
//     legs: [{ a, b, cost, km, path, crossings, kind (3: no road) }], crossings: [[x, y] …], capitals: Int32Array,
//     stats: { legs, hard, main, lesser, track, km: [main, lesser, track], crossings, unreached, capitals, links } }
export function roadNetwork(div, centres, places = [], G = roadGround(div), opts = {}) {
  const count = div.count, cells = div.cells;
  // which districts touch: sides of texels between two land districts
  const touch = new Map();
  for (let ty = 0; ty < FN - 1; ty++) for (let tx = 0; tx < FN - 1; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || div.kinds[d] !== LAND) continue;
    for (const u of [t + 1, t + FN]) { const e = cells[u]; if (e < 0 || e === d || div.kinds[e] !== LAND) continue; const k = d < e ? d * 65536 + e : e * 65536 + d; touch.set(k, (touch.get(k) || 0) + 1); }
  }
  // a leg for every pair of neighbours with centres
  const legs = [], of = Array.from({ length: count }, () => []), pairLeg = new Map(), nbr = Array.from({ length: count }, () => []); let hard = 0;
  for (const [k, sides] of [...touch].sort((p, q) => p[0] - q[0])) {
    if (sides < 2) continue;
    const a = Math.floor(k / 65536), b = k % 65536; if (centres.texel[a] < 0 || centres.texel[b] < 0) continue;
    nbr[a].push(b); nbr[b].push(a);
    const L = legBetween(G, centres.texel[a], centres.texel[b]); if (!L) continue;
    const straight = Math.hypot(centres.x[a] - centres.x[b], centres.y[a] - centres.y[b]);
    if (L.cost > HARD * straight + 6) { hard++; continue; }                  // impassable: no road between these two
    const i = legs.length; legs.push({ a, b, cost: L.cost, km: L.km, path: L.path, crossings: L.crossings, kind: 3 }); of[a].push(i); of[b].push(i); pairLeg.set(k, i);
  }
  const lines = [];
  // the cheapest chain of legs from a district to the others. price(i): what leg i costs on this errand (Infinity: not
  // to be used); stop: a district to stop at; limit: no farther than this
  const heap = new Heap(1024), dist = new Float64Array(count), via = new Int32Array(count);
  const spread = (source, price, stop = -1, limit = Infinity) => {
    dist.fill(Infinity); via.fill(-1); heap.clear(); dist[source] = 0; heap.push(0, source);
    while (heap.n) { const d = heap.pop(), dd = heap.key; if (dd > dist[d]) continue; if (d === stop) break;
      for (const i of of[d]) { const L = legs[i], e = L.a === d ? L.b : L.a, c = dd + price(i); if (c < dist[e] && c <= limit) { dist[e] = c; via[e] = i; heap.push(c, e); } } }
  };
  const chainTo = d0 => { const chain = []; for (let d = d0; via[d] >= 0; d = legs[via[d]].a === d ? legs[via[d]].b : legs[via[d]].a) chain.push(via[d]); return chain; };
  // a chain is walked from `from`; a run of legs not yet a road becomes a new line of the road
  const lay = (chain, from, kind, name) => {
    let run = [], start = from, at = from;
    const flush = () => { if (run.length) lines.push({ kind, pts: linePoints(legs, centres, run, start), legs: run, start, ...(name ? { name } : {}) }); run = []; };
    for (const i of chain) { const L = legs[i], to = L.a === at ? L.b : L.a;
      if (used[i]) { flush(); start = to; } else { if (!run.length) start = at; run.push(i); used[i] = 1; L.kind = kind; }
      at = to; }
    flush();
  };
  const plain = i => legs[i].cost;
  const districtOf = p => { const [x, y] = Array.isArray(p) ? kmOf(p[0], p[1]) : kmOf(p.lat, p.lon), t = texelOf(x, y); if (t < 0) return -1; const d = cells[t]; return d >= 0 && div.kinds[d] === LAND && centres.texel[d] >= 0 ? d : -1; };

  // ---- the passes of history. A pass P on the way from district `from` to district `to`:
  // of all pairs of districts x, y near the pass, the one for which «from … x, over P, y … to» is the cheapest. The
  // leg x—y is the way from the centre of x up to P and down to the centre of y. A leg has one way: a pair that goes
  // over a pass already is not taken again; a leg that is a road already keeps its kind and takes the way over the pass.
  const viaPass = (P, from, to) => {
    const [px, py] = kmOf(P[0], P[1]), t = texelOf(px, py); if (t < 0 || !G.land[t]) return null;
    const cand = []; for (let d = 0; d < count; d++) { if (div.kinds[d] !== LAND || centres.texel[d] < 0) continue; const far = Math.hypot(centres.x[d] - px, centres.y[d] - py); if (far <= PASS.reach) cand.push([d, far]); }
    spread(to, plain); const D2 = Float64Array.from(dist); spread(from, plain);
    const stamp = fanFrom(G, t, Math.ceil(PASS.reach / FKM) + 8); let best = null;
    for (const [x, fx] of cand) { const cx = centres.texel[x]; if (G.done[cx] !== stamp || dist[x] === Infinity) continue;
      for (const [y, fy] of cand) { const cy = centres.texel[y]; if (y === x || G.done[cy] !== stamp || D2[y] === Infinity) continue;
        const had = pairLeg.get(Math.min(x, y) * 65536 + Math.max(x, y)); if (had !== undefined && legs[had].pass) continue;
        const c = dist[x] + G.g[cx] + G.g[cy] + D2[y] + PASS.keep * (fx + fy); if (!best || c < best.c) best = { c, x, y }; } }
    if (!best) return null;
    const walk = u => { const p = []; for (let v = u; v >= 0; v = G.from[v]) p.push(v); return p; };     // u … the pass
    const stop = (d, other) => {                                 // the centre nearest to the pass that the way from d passes by
      const path = walk(centres.texel[d]); let pick = d, at = -1;
      for (const [z] of cand) { if (z === d || z === other || G.done[centres.texel[z]] !== stamp) continue;
        for (let j = path.length - 1; j > at; j--) { const q = xyOf(path[j]); if (Math.hypot(q[0] - centres.x[z], q[1] - centres.y[z]) <= PASS.by) { at = j; pick = z; break; } } }
      return pick;
    };
    let { x, y } = best;
    { const sx = stop(x, y), sy = stop(y, sx), had = pairLeg.get(Math.min(sx, sy) * 65536 + Math.max(sx, sy)); if (sx !== sy && !(had !== undefined && legs[had].pass)) { x = sx; y = sy; } }
    const a = Math.min(x, y), b = Math.max(x, y), k = a * 65536 + b;
    const path = walk(centres.texel[a]).concat(walk(centres.texel[b]).slice(0, -1).reverse()); let km = 0;
    for (let j = 1; j < path.length; j++) { const e = Math.abs(path[j] - path[j - 1]); km += (e === 1 || e === FN ? 1 : 1.4142) * FKM; }
    const L = { a, b, cost: G.g[centres.texel[a]] + G.g[centres.texel[b]], km, path, crossings: crossingsOf(G, path), kind: 3, pass: { name: P[2], t } };
    let i = pairLeg.get(k); if (i === undefined) { i = legs.length; legs.push(L); of[a].push(i); of[b].push(i); pairLeg.set(k, i); } else { L.kind = legs[i].kind; legs[i] = L; }
    return { i, x, y };
  };
  // what a road of history is laid through: the districts of its towns { d } and the legs of its passes { i, x, y }
  const planOf = road => {
    const plan = []; let last = -1, pending = [];
    for (const p of road.way) {
      if (Array.isArray(p) && p.length > 2) { if (last >= 0) pending.push(p); continue; }
      const d = districtOf(p); if (d < 0 || d === last) continue;
      let at = last; for (const P of pending) { const v = viaPass(P, at, d); if (v) { plan.push(v); at = v.y; } }
      pending = []; plan.push({ d }); last = d;
    }
    return plan;
  };
  const used = [];                                              // legs that are roads (legs are added for the passes)
  const trunk = i => (used[i] ? legs[i].cost * TRUNK : legs[i].cost), onMain = i => (legs[i].kind === 0 ? legs[i].cost : Infinity), onRoad = i => (used[i] ? legs[i].cost : Infinity);

  // ---- main roads, 1: the great roads of history, town after town, over their passes (a road marked `after` is
  // laid when the towns of the provinces are joined: it adds its way to the main roads and takes none from them —
  // the legs of its passes are not there before that either)
  const roads = opts.historic || HISTORIC;
  { const plans = roads.filter(r => !r.after).map(r => [r, planOf(r)]);       // every pass first: a leg has one way, whichever road comes to it
    for (const [road, plan] of plans) { let last = -1;
      for (const s of plan) {
        const target = s.d ?? s.x;
        if (last >= 0 && target !== last) { spread(target, trunk, last); if (dist[last] < Infinity) lay(chainTo(last), last, 0, road.name); }
        if (s.i !== undefined) { lay([s.i], s.x, 0, road.name); last = s.y; } else last = s.d;
      } } }
  // ---- main roads, 2: the town of a province with the towns of the provinces next to it, the nearest pairs first
  const capitals = provinceTowns(div, centres, places), prov = div.province, pairs = new Set(), links = [];
  if (prov) for (const L of legs) { const pa = prov[L.a], pb = prov[L.b]; if (pa !== pb && capitals[pa] >= 0 && capitals[pb] >= 0) pairs.add(Math.min(pa, pb) * 65536 + Math.max(pa, pb)); }
  { let from = -1; for (const k of [...pairs].sort((p, q) => p - q)) { const pa = Math.floor(k / 65536), pb = k % 65536; if (pa !== from) { spread(capitals[pa], plain); from = pa; } if (dist[capitals[pb]] < Infinity) links.push([capitals[pa], capitals[pb], dist[capitals[pb]]]); } }
  links.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  let laidLinks = 0;
  for (const [a, b, cost] of links) {
    spread(a, onMain, b, cost * SPAN_MAIN); if (dist[b] <= cost * SPAN_MAIN) continue;       // the main roads lead there already
    spread(b, trunk, a); if (!(dist[a] < Infinity)) continue;
    lay(chainTo(a), a, 0); laidLinks++;
  }
  for (const road of roads) { if (!road.after) continue; let last = -1;
    for (const s of planOf(road)) {
      const target = s.d ?? s.x;
      if (last >= 0 && target !== last) { spread(target, trunk, last); if (dist[last] < Infinity) lay(chainTo(last), last, 0, road.name); }
      if (s.i !== undefined) { lay([s.i], s.x, 0, road.name); last = s.y; } else last = s.d;
    } }
  // ---- lesser roads and tracks between districts: the cheapest legs first; a leg is laid where the roads so far
  // make a long way round. Such legs are then joined into lines through the centres where just two of them meet.
  const rest = []; for (let i = 0; i < legs.length; i++) if (!used[i]) rest.push(i);
  rest.sort((p, q) => legs[p].cost - legs[q].cost || p - q);
  const loose = [];
  for (const i of rest) {
    const L = legs[i]; spread(L.a, onRoad, L.b, L.cost * SPAN_LESSER); if (dist[L.b] <= L.cost * SPAN_LESSER) continue;
    used[i] = 1; L.kind = L.cost > POOR * L.km ? 2 : 1; loose.push(i);
  }
  for (const kind of [1, 2]) {
    const mine = loose.filter(i => legs[i].kind === kind), at = new Map(), seen = new Set();
    for (const i of mine) for (const d of [legs[i].a, legs[i].b]) (at.get(d) || at.set(d, []).get(d)).push(i);
    const walk = (i, from) => {                                   // from a centre along leg i, on through every centre where two legs meet
      const run = []; let d = from;
      for (;;) { run.push(i); seen.add(i); const L = legs[i]; d = L.a === d ? L.b : L.a; const there = at.get(d); if (there.length !== 2) break; const j = there[0] === i ? there[1] : there[0]; if (seen.has(j)) break; i = j; }
      lines.push({ kind, pts: linePoints(legs, centres, run, from), legs: run, start: from });
    };
    for (const i of mine) { if (seen.has(i)) continue; const L = legs[i]; if (at.get(L.a).length !== 2) walk(i, L.a); else if (at.get(L.b).length !== 2) walk(i, L.b); }
    for (const i of mine) if (!seen.has(i)) walk(i, legs[i].a);    // rings
  }
  for (const l of lines) l.pts = linePoints(legs, centres, l.legs, l.start);      // a leg may have taken the way over a pass after its line was laid
  return finishNet(div, centres, legs, lines, capitals, { hard, links: laidLinks }, passesOf(G, legs));
}
// The passes of the network: for every leg that is a road, the highest point of its way where that stands PASS.rise
// metres over both its ends (the leg crosses a crest between its two districts); for a leg led over a pass of
// history, that pass. → [{ x, y (flat km), h (metres), name ('' unless a pass of history), kind (of the road: 0 main,
// 1 lesser, 2 track), a, b (the districts on both sides), rank (0 a pass of history, 1 of a main road, 2 other), leg }]
export function passesOf(G, legs) {
  const out = [];
  legs.forEach((L, i) => {
    if (L.kind === 3 || !L.path) return;
    const p = L.path, n = p.length; let top = -1, h = -Infinity;
    if (L.pass) { top = p.indexOf(L.pass.t); h = G.hgt[L.pass.t]; }
    else { for (let j = 1; j < n - 1; j++) if (G.hgt[p[j]] > h) { h = G.hgt[p[j]]; top = j; } if (top < 0 || h - Math.max(G.hgt[p[0]], G.hgt[p[n - 1]]) < PASS.rise) return; }
    const [x, y] = xyOf(p[top]); out.push({ x, y, h: Math.round(h), name: L.pass ? L.pass.name : '', kind: L.kind, a: L.a, b: L.b, rank: L.pass ? 0 : L.kind === 0 ? 1 : 2, leg: i });
  });
  return out.sort((p, q) => p.rank - q.rank || q.h - p.h || p.leg - q.leg);
}
// what the rest of the album asks of a network: its numbers and the places where it crosses rivers
function finishNet(div, centres, legs, lines, capitals, extra, passes = []) {
  const on = new Uint8Array(div.count), km = [0, 0, 0], num = [0, 0, 0], crossings = [];
  for (const L of legs) { if (L.kind === 3) continue; on[L.a] = on[L.b] = 1; km[L.kind] += L.km; num[L.kind]++; for (const t of L.crossings) crossings.push(xyOf(t)); }
  let unreached = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND && centres.texel[d] >= 0 && !on[d]) unreached++;
  let caps = 0; for (const d of capitals) if (d >= 0) caps++;
  return { lines, legs, crossings, capitals, passes, stats: { legs: legs.length, hard: extra.hard, main: num[0], lesser: num[1], track: num[2], km: km.map(Math.round), crossings: crossings.length, unreached, capitals: caps, links: extra.links, passes: [0, 1, 2].map(r => passes.filter(p => p.rank === r).length) } };
}

// a line of the network as the ribbons want it: the steps of the texels ironed out, [[lon, lat] …]
export function roadLine(pts) {
  let p = pts;
  for (let it = 0; it < 2 && p.length > 3; it++) p = p.map((v, i) => (i === 0 || i === p.length - 1 ? v : [(p[i - 1][0] + 2 * v[0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * v[1] + p[i + 1][1]) / 4]));
  return p.map(([x, y]) => { const q = llOf(x, y); return [q.lon, q.lat]; });
}

// ---- the network kept in a file (public/assets/album/roads/roads.bin.gz), so that the page does not lay it at every
// start. Unzipped: [u32 length of the head][head, JSON][body].
//   head   { v, algo, sig, districts, legs, hard, links, capitals: [district of every province],
//            lines: [[kind, start district, name or 0, leg, leg …] …], names: [of roads and passes],
//            passes: [[leg, x · 100, y · 100, metres, name or 0] …] }
//   body   leg after leg: u16 a, u16 b, u8 kind, f32 cost, f32 km; then for every leg that is a road its path:
//          u16 steps, then the steps as bytes 0..7 (NB above), from the centre of a to the centre of b
// The file is good for one division only: the districts as they are numbered, their centres where they stand, the
// towns of the provinces (places: the list they are chosen from, as roadNetwork() takes it).
export function netSignature(div, centres, capitals = []) {
  let h = 0x811c9dc5 ^ NET_ALGO; const mix = v => { h ^= v & 0xffff; h = Math.imul(h, 0x01000193); h ^= v >>> 16; h = Math.imul(h, 0x01000193); };
  mix(div.count); for (let d = 0; d < div.count; d++) { mix(div.kinds[d]); mix(centres.texel[d] + 1); if (div.province) mix(div.province[d] + 1); }
  for (const d of capitals) mix(d + 1);
  for (const r of HISTORIC) for (const p of r.way) { mix(Math.round(p[0] * 1000) + 90000); mix(Math.round(p[1] * 1000) + 180000); if (p[2]) for (let i = 0; i < p[2].length; i++) mix(p[2].charCodeAt(i)); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function encodeNet(net, div, centres) {
  const legs = net.legs, names = [], nameOf = n => (n ? (names.includes(n) ? names.indexOf(n) : names.push(n) - 1) + 1 : 0), head = { v: 1, algo: NET_ALGO, sig: netSignature(div, centres, net.capitals), districts: div.count, legs: legs.length, hard: net.stats.hard, links: net.stats.links, capitals: Array.from(net.capitals),
    lines: net.lines.map(l => [l.kind, l.start, nameOf(l.name), ...l.legs]), passes: (net.passes || []).map(q => [q.leg, Math.round(q.x * 100), Math.round(q.y * 100), q.h, nameOf(q.name)]), names };
  const hb = new TextEncoder().encode(JSON.stringify(head)); let size = 4 + hb.length + legs.length * 13;
  for (const L of legs) if (L.kind !== 3) size += 2 + L.path.length - 1;
  const buf = new ArrayBuffer(size), dv = new DataView(buf); dv.setUint32(0, hb.length, true); new Uint8Array(buf, 4, hb.length).set(hb);
  let o = 4 + hb.length;
  for (const L of legs) { dv.setUint16(o, L.a, true); dv.setUint16(o + 2, L.b, true); dv.setUint8(o + 4, L.kind); dv.setFloat32(o + 5, L.cost, true); dv.setFloat32(o + 9, L.km, true); o += 13; }
  for (const L of legs) {
    if (L.kind === 3) continue;
    dv.setUint16(o, L.path.length - 1, true); o += 2;
    for (let j = 1; j < L.path.length; j++) { const dx = L.path[j] % FN - L.path[j - 1] % FN, dy = Math.floor(L.path[j] / FN) - Math.floor(L.path[j - 1] / FN); let q = 0; while (q < 8 && (NB[q * 2] !== dx || NB[q * 2 + 1] !== dy)) q++; dv.setUint8(o++, q); }
  }
  return buf;
}
// the head of the file: what it was laid for and how much of it there is
export function netHead(buf) { const dv = new DataView(buf), hl = dv.getUint32(0, true); return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))); }
// → the network as roadNetwork() gives it, or null when the file was laid for another division or by other rules
export function decodeNet(buf, div, centres, places = [], G = { riv: div.raster.riv }) {
  try {
    const dv = new DataView(buf), hl = dv.getUint32(0, true), head = netHead(buf);
    if (head.v !== 1 || head.algo !== NET_ALGO || head.districts !== div.count || head.sig !== netSignature(div, centres, provinceTowns(div, centres, places))) return null;
    const legs = []; let o = 4 + hl;
    for (let i = 0; i < head.legs; i++, o += 13) legs.push({ a: dv.getUint16(o, true), b: dv.getUint16(o + 2, true), kind: dv.getUint8(o + 4), cost: dv.getFloat32(o + 5, true), km: dv.getFloat32(o + 9, true), path: null, crossings: [] });
    for (const L of legs) {
      if (L.kind === 3) continue;
      const n = dv.getUint16(o, true); o += 2; const path = [centres.texel[L.a]];
      for (let j = 0; j < n; j++) { const q = dv.getUint8(o++), t = path[j]; path.push(t + NB[q * 2] + NB[q * 2 + 1] * FN); }
      if (path[n] !== centres.texel[L.b]) return null;
      L.path = path; L.crossings = crossingsOf(G, path);
    }
    const lines = head.lines.map(([kind, start, name, ...run]) => ({ kind, pts: linePoints(legs, centres, run, start), legs: run, start, ...(name ? { name: head.names[name - 1] } : {}) }));
    const passes = (head.passes || []).map(([leg, x, y, h, name]) => { const L = legs[leg]; return { x: x / 100, y: y / 100, h, name: name ? head.names[name - 1] : '', kind: L.kind, a: L.a, b: L.b, rank: name ? 0 : L.kind === 0 ? 1 : 2, leg }; });
    return finishNet(div, centres, legs, lines, Int32Array.from(head.capitals), { hard: head.hard, links: head.links }, passes);
  } catch { return null; }
}
