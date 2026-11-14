// The shape of a road in the mountains (the lead, 14.11.2026: «идёт дном долины, на подъём — с поворотами, а не прямой
// чертой по склону. Мельче шаг пути там, где круто (насколько позволяют высоты)»).
//   • The network is laid chunk by chunk, a step of 1 km (routes.js): that is right for the plains and decides which
//     districts a road joins and by which valley it goes. But over a range such a way is a few straight strokes.
//   • So a leg that climbs is laid once more, FINE: with a step of 200 m (the heights come every 230 m), no farther
//     than FINE.wide from its way chunk by chunk, between the same two centres (and over the same pass of history).
//   • A fine step costs its length and more on a slope. A road climbs willingly up to a grade (9 % a main road, 11 %
//     a lesser one, 18 % a track; cheapest for the height gained at about that grade) and very unwillingly beyond it: on a slope steeper than that it goes aslant and
//     turns back — the bends of a mountain road. Turning costs a little, so the way does not wriggle.
//   • The rivers are the real courses here, not the chunks they run through: a road keeps a step off the water, on
//     the floor of the valley, and crosses where it must.
// Plain JavaScript without the GPU: the same land always gives the same shape. The plains are not touched.
import { KN, KKM } from '../division/km.js';
import { Heap } from '../division/graph.js';
import { kmOf } from '../chunks.js';

export const FINE = {
  step: .2,                          // km: the step of a fine way
  wide: 1.5,                         // km: how far from the way of the leg (chunk by chunk) the fine way may go
  slope: .08, range: 300,            // a leg climbs where a step of its way rises this much (rise over run) or its top stands this many metres over its lowest point
  grade: [.09, .11, .18],            // the steepest grade a main road, a lesser road, a track takes willingly
  cost: [.7, .8, 32],                // a step at r times the willing grade is 1 + .7 r + .8 r² times dearer, and 32 (r − 1)² more beyond it
  turn: .01, hairpin: .25,           // km of way for turning by a sixteenth of a circle (by two: four times that); for any sharper turn — a hairpin
  haste: 1,                          // above 1 the search hurries toward its end and the way found may be that many times dearer than the cheapest; 1: the cheapest way
  cross: [1, 2.5, 5, 9], along: 1.5, // km of way for stepping onto a brook, a small river, a lesser, a great one; for every km in the bed
  pass: .7,                          // km: a leg over a pass of history is left to find its own line if that runs this near the point of the pass
  thin: .012,                        // km: a point this near the straight between its neighbours is dropped when the line is drawn
};
const X0 = -880, Y0 = 3880, F = FINE.step, K = Math.round(KKM / F);
export const FW = KN * K;            // the fine cells: FW × FW of them over the same ground as the chunks; cell = j · FW + i
// sixteen ways to step, in the order of their bearing
export const DIRS = [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1], [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]];
const LEN = DIRS.map(([x, y]) => Math.hypot(x, y) * F);
// a long step passes two cells on its way: [dx, dy, dx, dy] (zeros for a short step)
const MID = DIRS.map(([x, y]) => (Math.abs(x) === 2 ? [x / 2, 0, x / 2, y] : Math.abs(y) === 2 ? [0, y / 2, x, y / 2] : [0, 0, 0, 0]));
export const cellOf = (x, y) => Math.floor((y - Y0) / F) * FW + Math.floor((x - X0) / F);
export const cellXY = c => [X0 + (c % FW + .5) * F, Y0 + (Math.floor(c / FW) + .5) * F];
const chunkOf = (i, j) => Math.floor(j / K) * KN + Math.floor(i / K);
export const cellChunk = c => chunkOf(c % FW, Math.floor(c / FW));     // the chunk a fine cell lies in

// The real courses of the rivers on the fine cells: for every chunk, a bit for each of its K × K cells that a river
// at least `min` km wide runs through. courses: decodeCourses() of water/courses.js
export function fineRivers(courses, min = .004) {
  const bits = new Int32Array(KN * KN);
  const mark = (i, j) => { if (i >= 0 && j >= 0 && i < FW && j < FW) bits[chunkOf(i, j)] |= 1 << ((j % K) * K + (i % K)); };
  for (const r of courses.rivers) {
    let px = 0, py = 0;
    for (let n = 0; n < r.n; n++) {
      const [qx, qy] = kmOf(r.ll[n * 2 + 1], r.ll[n * 2]);
      if (n && Math.max(r.w[n], r.w[n - 1]) >= min) {
        const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / (F * .4))), half = Math.max(r.w[n], r.w[n - 1]) / 2, R = half > F * .6 ? Math.ceil(half / F) : 0;
        let li = Math.floor((px - X0) / F), lj = Math.floor((py - Y0) / F); mark(li, lj);
        for (let s = 1; s <= steps; s++) {
          const i = Math.floor((px + (qx - px) * s / steps - X0) / F), j = Math.floor((py + (qy - py) * s / steps - Y0) / F);
          if (i !== li && j !== lj) mark(i, lj);                 // no way through between two cells of a river that touch at a corner
          mark(i, j);
          for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (Math.hypot(di, dj) * F <= half) mark(i + di, j + dj);
          li = i; lj = j;
        }
      }
      px = qx; py = qy;
    }
  }
  return bits;
}

// does the way of a leg (chunk by chunk) climb — is it a leg of the mountains?
export function climbs(G, path) {
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < path.length; j++) {
    const h = G.hgt[path[j]]; if (h < lo) lo = h; if (h > hi) hi = h;
    if (j) { const e = Math.abs(path[j] - path[j - 1]), run = (e === 1 || e === KN ? 1 : 1.4142) * KKM * 1000; if (Math.abs(h - G.hgt[path[j - 1]]) >= FINE.slope * run) return true; }
  }
  return hi - lo >= FINE.range;
}

// everything the search keeps between legs: it grows to the largest leg and is told apart by stamps, never cleared
const S = { n: 0, stamp: 0, heap: new Heap(1 << 12) };
function room(cells) {
  if (S.n >= cells) return;
  S.n = Math.ceil(cells * 1.5); S.stamp = 0;
  S.in = new Int32Array(S.n); S.seen = new Int32Array(S.n); S.hgt = new Float32Array(S.n); S.flag = new Uint8Array(S.n);
  S.g = new Float32Array(S.n * 16); S.from = new Int32Array(S.n * 16); S.mark = new Int32Array(S.n * 16); S.done = new Int32Array(S.n * 16);
}

// The fine way of one leg. G: roadGround(); path: its way chunk by chunk; ends: [[x, y] …] flat km, the points it
// must run through in order (the two centres; a pass between them); kind: 0 main, 1 lesser, 2 track;
// heightAt(x, y) → metres at a point of the flat km plane; rivers: fineRivers() or null (then a chunk with a river is
// all river) → Int32Array of fine cells from the first point to the last, or null where there is no such way
export function fineWay(G, path, ends, kind, heightAt, rivers = null) {
  // the box of the leg and the cells the way may use
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity; const R = Math.ceil(FINE.wide / F);
  for (const t of path) { const tx = t % KN, ty = (t - tx) / KN; if (tx < i0) i0 = tx; if (tx > i1) i1 = tx; if (ty < j0) j0 = ty; if (ty > j1) j1 = ty; }
  i0 = Math.max(0, i0 * K - R - 1); j0 = Math.max(0, j0 * K - R - 1); i1 = Math.min(FW - 1, (i1 + 1) * K + R); j1 = Math.min(FW - 1, (j1 + 1) * K + R);
  const w = i1 - i0 + 1, h = j1 - j0 + 1; room(w * h);
  const leg = ++S.stamp, local = (x, y) => { const i = Math.floor((x - X0) / F) - i0, j = Math.floor((y - Y0) / F) - j0; return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i; };
  for (const t of path) {
    const cx = (t % KN + .5) * K - i0, cy = (Math.floor(t / KN) + .5) * K - j0;
    for (let j = Math.max(0, Math.floor(cy - R)); j <= Math.min(h - 1, Math.ceil(cy + R)); j++) for (let i = Math.max(0, Math.floor(cx - R)); i <= Math.min(w - 1, Math.ceil(cx + R)); i++)
      if ((i + .5 - cx) * (i + .5 - cx) + (j + .5 - cy) * (j + .5 - cy) <= R * R) S.in[j * w + i] = leg;
  }
  // what a cell is like: its height; flag 1 a river runs through it, 2 it is land, and the size of the river above that
  const look = c => {
    if (S.seen[c] === leg) return; S.seen[c] = leg;
    const i = c % w + i0, j = (c - c % w) / w + j0, t = chunkOf(i, j), riv = rivers ? (rivers[t] >> ((j % K) * K + (i % K))) & 1 : G.riv[t] > 0 ? 1 : 0;
    S.flag[c] = riv | (G.land[t] ? 2 : 0) | (G.riv[t] << 2); S.hgt[c] = heightAt(X0 + (i + .5) * F, Y0 + (j + .5) * F);
  };
  const gmax = FINE.grade[kind] ?? FINE.grade[2], [c1, c2, c3] = FINE.cost, heap = S.heap, out = [];
  for (let e = 1; e < ends.length; e++) {
    const a = local(ends[e - 1][0], ends[e - 1][1]), b = local(ends[e][0], ends[e][1]); if (a < 0 || b < 0) return null;
    S.in[a] = S.in[b] = leg;
    const stamp = ++S.stamp, bi = b % w, bj = (b - bi) / w, far = c => Math.hypot(c % w - bi, (c - c % w) / w - bj) * F * FINE.haste;
    heap.clear(); look(a);
    for (let d = 0; d < 16; d++) { const s = a * 16 + d; S.g[s] = 0; S.mark[s] = stamp; S.from[s] = -1; heap.push(far(a), s); }
    let end = -1;
    while (heap.n) {
      const s = heap.pop(); if (S.done[s] === stamp) continue; S.done[s] = stamp;
      const c = s >> 4, d = s & 15; if (c === b) { end = s; break; }
      const ci = c % w, cj = (c - ci) / w, gs = S.g[s], hc = S.hgt[c], rc = S.flag[c] & 1;
      for (let d2 = 0; d2 < 16; d2++) {
        let q = (d2 - d) & 15; if (q === 8) continue; if (q > 8) q = 16 - q;
        const ni = ci + DIRS[d2][0], nj = cj + DIRS[d2][1]; if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni, s2 = n * 16 + d2; if (S.in[n] !== leg || S.done[s2] === stamp) continue;
        look(n); if (!(S.flag[n] & 2)) continue;
        let rn = S.flag[n] & 1, size = S.flag[n] >> 2; const m = MID[d2];
        if (m[0] || m[1]) for (let k = 0; k < 4; k += 2) { const u = (cj + m[k + 1]) * w + ci + m[k]; look(u); if (S.flag[u] & 1) { rn = 1; size = Math.max(size, S.flag[u] >> 2); } }
        const len = LEN[d2], g = Math.abs(S.hgt[n] - hc) / (len * 1000 * gmax), over = g - 1;
        const cost = gs + len * (1 + c1 * g + c2 * g * g + (over > 0 ? c3 * over * over : 0)) + (q <= 2 ? FINE.turn * q * q : FINE.hairpin) + (rn ? (rc ? FINE.along * len : FINE.cross[Math.min(3, size)]) : 0);
        if (S.mark[s2] !== stamp || cost < S.g[s2]) { S.g[s2] = cost; S.mark[s2] = stamp; S.from[s2] = s; heap.push(cost + far(n), s2); }
      }
    }
    if (end < 0) return null;
    const part = []; for (let s = end; s >= 0; s = S.from[s]) { const c = s >> 4; if (part[part.length - 1] !== c) part.push(c); }
    part.reverse(); if (out.length) part.shift();
    for (const c of part) out.push((Math.floor(c / w) + j0) * FW + c % w + i0);
  }
  return Int32Array.from(out);
}

// what tells one leg from another for its shape: the kind of its road and its way chunk by chunk
export const legKey = L => L.kind + '|' + L.path.join(',');
// Every leg of the network that is a road and climbs gets its fine way: L.fine (cells from the centre of L.a to the
// centre of L.b). legs, centres: of roadNetwork(); heightAt(lat, lon) → metres; courses: the real rivers, or null;
// reuse: fine ways found before, by legKey (a leg with the same way between the same two points takes its own from
// there) → { shaped: how many legs have a fine way, reused: how many of them were taken from `reuse` }
export function shapeLegs(G, legs, centres, heightAt, courses = null, llOf, reuse = null) {
  const at = (x, y) => { const p = llOf(x, y); return heightAt(p.lat, p.lon); }; let n = 0, reused = 0, rivers;
  for (const L of legs) {
    L.fine = null; if (L.kind === 3 || !L.path || !climbs(G, L.path)) continue;
    const A = [centres.x[L.a], centres.y[L.a]], B = [centres.x[L.b], centres.y[L.b]], had = reuse ? reuse.get(legKey(L)) : null;
    if (had && had[0] === cellOf(A[0], A[1]) && had[had.length - 1] === cellOf(B[0], B[1])) { L.fine = had; n++; reused++; continue; }
    if (rivers === undefined) rivers = courses ? fineRivers(courses) : null;
    L.fine = fineWay(G, L.path, [A, B], L.kind, at, rivers);
    if (L.pass && L.pass.x !== undefined && !(L.fine && nearest(L.fine, L.pass.x, L.pass.y) <= FINE.pass)) {
      // the line it found misses the pass: it is led through the lowest ground by the point of the pass — the head of the valley that leads up to it
      let px = L.pass.x, py = L.pass.y, low = Infinity;
      for (let dy = -FINE.pass; dy <= FINE.pass + 1e-9; dy += F) for (let dx = -FINE.pass; dx <= FINE.pass + 1e-9; dx += F) { if (Math.hypot(dx, dy) > FINE.pass) continue; const h = at(L.pass.x + dx, L.pass.y + dy); if (h < low) { low = h; px = L.pass.x + dx; py = L.pass.y + dy; } }
      L.fine = fineWay(G, L.path, [A, [px, py], B], L.kind, at, rivers) || fineWay(G, L.path, [A, [L.pass.x, L.pass.y], B], L.kind, at, rivers) || L.fine;
    }
    if (L.fine) n++;
  }
  return { shaped: n, reused };
}
// km from a point to the nearest cell of a fine way
export function nearest(fine, x, y) { let d = Infinity; for (const c of fine) { const q = cellXY(c), e = Math.hypot(q[0] - x, q[1] - y); if (e < d) d = e; } return d; }
// the points of a shaped leg, flat km: the middles of its cells, the two centres at its ends
export function finePoints(L, centres) {
  const pts = Array.from(L.fine, cellXY); pts[0] = [centres.x[L.a], centres.y[L.a]]; pts[pts.length - 1] = [centres.x[L.b], centres.y[L.b]];
  return pts;
}
// a fine way as steps for the file: the number of each step in DIRS (255: no such step — the file is broken)
export function fineSteps(fine) {
  const out = new Uint8Array(fine.length - 1);
  for (let k = 1; k < fine.length; k++) { const dx = fine[k] % FW - fine[k - 1] % FW, dy = Math.floor(fine[k] / FW) - Math.floor(fine[k - 1] / FW); out[k - 1] = DIRS.findIndex(q => q[0] === dx && q[1] === dy) & 255; }
  return out;
}
// A line thinned for drawing: the points that lie within tol km of the straight between the points kept (Ramer,
// Douglas and Peucker). pts: [[x, y] …] → the points kept, the ends always
export function thin(pts, tol = FINE.thin) {
  const n = pts.length; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n), stack = [0, n - 1]; keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    const b = stack.pop(), a = stack.pop(), ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, len = Math.hypot(dx, dy); let far = -1, most = tol;
    for (let k = a + 1; k < b; k++) { const px = pts[k][0] - ax, py = pts[k][1] - ay, d = len > 1e-9 ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py); if (d > most) { most = d; far = k; } }
    if (far > 0) { keep[far] = 1; stack.push(a, far, far, b); }
  }
  return pts.filter((_, k) => keep[k]);
}
