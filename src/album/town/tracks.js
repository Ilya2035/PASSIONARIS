// Tracks to the villages. The owner, when he first saw the settlements at their real size: «если там появляется
// городок, то он появляется небольшой… какие-то дорожки от него идут к основной дорожке»; 13.11.2026: «тропы к
// деревням».
//
// The roads of the album run from the centre of one district to the centre of the next (roads/routes.js). The
// villages between the centres (villages.js) stand off them. Every place of a district has its WAY to the roads of
// that district — or, where the district has no road, to its centre: the cheapest way over the relief, by the same
// price of a step as the roads (a slope is dear, a river is crossed once), and never out of the district.
//
// The ways of a district are one TREE: from any chunk there is one cheapest step toward the road, so the ways of
// two villages that come together run on as one track. The tree is the same every time for the same division and
// the same roads; it does not depend on which places are settled. A track is drawn for every settled village: its
// way down the tree, as far as the track of another village that is drawn already.
// Where a way passes the chunk of another place, it passes through that place: a track leads from village to village.
// Plain JavaScript without the GPU.
import { KN, KKM, KX0, KY0, kmData, kmHash } from '../division/km.js';
import { stepCost } from '../roads/routes.js';
import { Heap } from '../division/graph.js';

const LAND = 0;
export const TRACK_SMOOTH = 2;                 // how many times the bends of the ways are eased
// On level ground a lattice of chunks has many ways of the same price, and the cheapest of them run in straight rows
// and columns. So no two chunks are quite alike: stepping onto a chunk costs up to this share more or less (the same
// for the same chunk every time), and the ways wander as tracks do.
export const TRACK_UNEVEN = .35;
export const TRACK_BY_PLACE = .7;              // stepping onto the chunk of a place costs this share of the price: a way likes to pass a village
export const TRACK_STEPS = 4;                  // pieces of the drawn line between two chunks of a way
export const TRACK_ON_ROAD = .06;              // km: a village nearer than this to a road needs no track
export const TRACK_SNAP = 1.5;                 // km: how far from the middle of its last chunk a track may end on the road as drawn
const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

// which chunks carry a road: every chunk of every leg that was laid (roadNetwork().legs; kind 3 is a leg that is no road)
export function roadChunks(legs) {
  const on = new Uint8Array(KN * KN);
  for (const L of legs) if (L.kind !== 3) for (const t of L.path) on[t] = 1;
  return on;
}

// The tree of ways of district d.
//   div    the division: cells, kinds, centres            G     roadGround(div) of roads/routes.js
//   list   districtSites() of villages.js                 onRoad roadChunks()
// → null for a district without places, or
//   { d, n (nodes: the chunks some way runs over), chunk: Int32Array (node → its chunk), x, y: Float32Array (where the
//     track runs through the node, flat km), up: Int32Array (node → the next node toward the road; −1: the way ends
//     here), site: Int32Array (node → the place of the district that stands in this chunk, its number in the list of
//     the district; −1 none), start: Int32Array (place → its node; −1: no way from it), km: Float32Array (place →
//     length of its way), end: Uint8Array (node → 1 the way ends on a road, 2 at the centre of the district) }
export function districtTracks(div, G, list, d, onRoad) {
  const s0 = list.first[d], places = list.first[d + 1] - s0; if (!places || div.kinds[d] !== LAND) return null;
  const box = kmData(div).box, bx0 = box.x0[d], by0 = box.y0[d], w = box.x1[d] - bx0 + 1, h = box.y1[d] - by0 + 1, cells = div.cells, cen = div.centres;
  const cost = new Float64Array(w * h).fill(Infinity), to = new Int32Array(w * h).fill(-2), heap = new Heap(256);
  const local = t => (Math.floor(t / KN) - by0) * w + t % KN - bx0, chunkOf = l => (Math.floor(l / w) + by0) * KN + l % w + bx0;
  const held = new Uint8Array(w * h);                               // the chunks a place of the district stands in
  for (let p = 1; p < places; p++) { const t = Math.floor((list.y[s0 + p] - KY0) / KKM) * KN + Math.floor((list.x[s0 + p] - KX0) / KKM); if (cells[t] === d) held[local(t)] = 1; }
  // the ways end on the roads of the district; in a district without a road, at its centre
  const centre = cen && cen.texel[d] >= 0 && cells[cen.texel[d]] === d ? cen.texel[d] : -1;
  let roads = 0;
  for (let j = 0; j < h; j++) for (let i = 0, t = (j + by0) * KN + bx0; i < w; i++, t++) if (cells[t] === d && onRoad[t]) { const l = j * w + i; cost[l] = 0; to[l] = -1; heap.push(0, l); roads++; }
  if (centre >= 0 && !onRoad[centre]) { const l = local(centre); cost[l] = 0; to[l] = -1; heap.push(0, l); }
  while (heap.n) {
    const l = heap.pop(), c = heap.key; if (c > cost[l]) continue;
    const i = l % w, j = (l - i) / w, t = chunkOf(l);
    for (let q = 0; q < 16; q += 2) {
      const u = i + NB[q], v = j + NB[q + 1]; if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const m = v * w + u, tm = chunkOf(m); if (cells[tm] !== d) continue;
      // the step is taken from the far chunk toward the road; what it costs to pass the nearer chunk is that chunk's own
      const cm = c + stepCost(G, tm, t, q >= 8) * (1 + (kmHash(t % KN, Math.floor(t / KN), 21) - .5) * TRACK_UNEVEN) * (held[l] ? TRACK_BY_PLACE : 1);
      if (cm < cost[m]) { cost[m] = cm; to[m] = l; heap.push(cm, m); }
    }
  }
  // the nodes: every chunk on the way of some place
  const nodeOf = new Map(), chunk = [], up = [], start = new Int32Array(places).fill(-1), km = new Float32Array(places);
  const node = l => { let n = nodeOf.get(l); if (n === undefined) { n = chunk.length; nodeOf.set(l, n); chunk.push(chunkOf(l)); up.push(-1); } return n; };
  for (let p = 1; p < places; p++) {
    const t = Math.floor((list.y[s0 + p] - KY0) / KKM) * KN + Math.floor((list.x[s0 + p] - KX0) / KKM); if (cells[t] !== d) continue;
    let l = local(t); if (to[l] === -2) continue;                    // no way over land to the roads of the district
    start[p] = node(l);
    for (let n = start[p]; to[l] >= 0 && up[n] < 0; ) { const m = to[l], nm = node(m); up[n] = nm; l = m; n = nm; }
  }
  const n = chunk.length, x = new Float32Array(n), y = new Float32Array(n), site = new Int32Array(n).fill(-1), end = new Uint8Array(n);
  for (let k = 0; k < n; k++) { const t = chunk[k]; x[k] = KX0 + (t % KN + .5) * KKM; y[k] = KY0 + (Math.floor(t / KN) + .5) * KKM; if (up[k] < 0) end[k] = t === centre ? 2 : 1; }
  // a way runs through the place that stands in its chunk: from village to village, and into the town at the centre
  for (let p = 0; p < places; p++) {
    const t = Math.floor((list.y[s0 + p] - KY0) / KKM) * KN + Math.floor((list.x[s0 + p] - KX0) / KKM), k = cells[t] === d ? nodeOf.get(local(t)) : undefined;
    if (k === undefined || site[k] >= 0) continue;
    site[k] = p; if (p > 0 || end[k] === 2 || up[k] >= 0) { x[k] = list.x[s0 + p]; y[k] = list.y[s0 + p]; }
  }
  // ease the bends: a node between two others moves toward the line through its neighbours. Places and ends stay.
  const kids = new Float32Array(n * 3);
  for (let it = 0; it < TRACK_SMOOTH; it++) {
    kids.fill(0);
    for (let k = 0; k < n; k++) if (up[k] >= 0) { const o = up[k] * 3; kids[o] += x[k]; kids[o + 1] += y[k]; kids[o + 2]++; }
    const nx = Float32Array.from(x), ny = Float32Array.from(y);
    for (let k = 0; k < n; k++) { if (up[k] < 0 || site[k] >= 0 || !kids[k * 3 + 2]) continue; const c = kids[k * 3 + 2]; nx[k] = (x[up[k]] + 2 * x[k] + kids[k * 3] / c) / 4; ny[k] = (y[up[k]] + 2 * y[k] + kids[k * 3 + 1] / c) / 4; }
    x.set(nx); y.set(ny);
  }
  for (let p = 1; p < places; p++) { let len = 0; for (let k = start[p]; k >= 0 && up[k] >= 0; k = up[k]) len += Math.hypot(x[up[k]] - x[k], y[up[k]] - y[k]); km[p] = len; }
  return { d, n, chunk: Int32Array.from(chunk), x, y, up: Int32Array.from(up), site, start, km, end, roads };
}

// a smooth line through points (each [x, y]): Catmull–Rom, it passes through every one of them
function through(pts, steps = TRACK_STEPS) {
  if (pts.length < 3) return pts.map(p => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], e = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= steps; s++) { const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - e[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + e[0]) * t3),
        .5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - e[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + e[1]) * t3)]); }
  }
  return out;
}
// a line without its first r km (null when nothing is left of it)
function cut(pts, r) {
  if (!(r > 0)) return pts;
  let left = r;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > left) return [[a[0] + (b[0] - a[0]) * left / len, a[1] + (b[1] - a[1]) * left / len], ...pts.slice(i + 1)];
    left -= len;
  }
  return null;
}
const lengthOf = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

// The tracks of a district as they are drawn, for the places that are settled.
//   tree      districtTracks()
//   radius(p) the radius of the settlement on place p of the district, km (0: nobody lives there; p = 0 is the town
//             at the centre). A track begins at the last houses of its village and stops at the first houses of the
//             next: inside a settlement its own lanes go on.
//   snap(x, y) → [x, y] or null: the nearest point of a road as it is drawn (may be left out: the track then ends in
//             the middle of the chunk the road runs over)
// → [{ pts: [[x, y] …] flat km, place (the village whose way first drew this piece), km }]: every piece of the tree
//   once, however many ways run over it
export function trackLines(tree, radius, snap = null) {
  const lines = []; if (!tree) return lines;
  const { up, x, y, site, start, end } = tree, done = new Uint8Array(tree.n), settled = k => (site[k] >= 0 ? radius(site[k]) : 0);
  const emit = (pts, place, ra, rb) => {
    let line = through(pts); line = cut(line, ra); if (line && rb > 0) { line = cut(line.reverse(), rb); if (line) line.reverse(); }
    if (line && line.length > 1) { const km = lengthOf(line); if (km > .02) lines.push({ pts: line, place, km }); }
  };
  for (let p = 1; p < start.length; p++) {
    const r = radius(p); if (!(r > 0) || start[p] < 0) continue;
    let k = start[p];
    if (up[k] < 0) {                                                 // the village stands on the chunk the road runs over: a few steps to the road
      if (end[k] !== 1 || !snap) continue;
      const q = snap(x[k], y[k]); if (q && Math.hypot(q[0] - x[k], q[1] - y[k]) > Math.max(r, TRACK_ON_ROAD) + .02) emit([[x[k], y[k]], q], p, r, 0);
      continue;
    }
    while (up[k] >= 0 && !done[k]) {
      const pts = [[x[k], y[k]]], from = k;
      do { done[k] = 1; k = up[k]; pts.push([x[k], y[k]]); } while (up[k] >= 0 && !done[k] && !(settled(k) > 0));
      let rb = settled(k);
      if (up[k] < 0 && end[k] === 1 && snap) {                       // the last chunk: onto the road as it is drawn
        const q = snap(x[k], y[k]); if (q) { pts[pts.length - 1] = q; if (site[k] >= 0 && Math.hypot(q[0] - x[k], q[1] - y[k]) > rb) rb = 0; }
      }
      emit(pts, p, settled(from), rb);
    }
  }
  return lines;
}

// km to the nearest of the lines, for whoever must keep off them (a yard never stands on a track): an index over
// squares of `cell` km. lines: [{ pts }]; reach: how near a point must be to be found
export function trackIndex(lines, cell = 2, reach = .2) {
  const segs = [], grid = new Map();
  for (const l of lines) for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], b = l.pts[i], id = segs.length / 4; segs.push(a[0], a[1], b[0], b[1]);
    for (let gy = Math.floor((Math.min(a[1], b[1]) - reach) / cell); gy <= Math.floor((Math.max(a[1], b[1]) + reach) / cell); gy++)
      for (let gx = Math.floor((Math.min(a[0], b[0]) - reach) / cell); gx <= Math.floor((Math.max(a[0], b[0]) + reach) / cell); gx++) { const key = gx * 100000 + gy; (grid.get(key) || grid.set(key, []).get(key)).push(id); }
  }
  return (px, py) => {
    let best = 1e9;
    for (const id of grid.get(Math.floor(px / cell) * 100000 + Math.floor(py / cell)) || []) {
      const o = id * 4, ax = segs[o], ay = segs[o + 1], dx = segs[o + 2] - ax, dy = segs[o + 3] - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t));
    }
    return best;
  };
}
