// The one shape of every border (the owner, 13.11.2026, of the districts mode: the outline of a district and the light
// under the cursor were of different shapes — «такого не должно быть»).
//
// A border is worked out ONCE, here, and everything draws or asks by it:
//   • the lines on the ground (lines.js) are these lines;
//   • the shader fills a district, lights it up under the cursor and draws its outline by the side of these lines a
//     point lies on (aspects/division.js; the pieces of the lines go to the GPU in gpu.js);
//   • the district under the cursor (runtime.js districtAt) is found the same way;
//   • a chunk of 1 km² belongs to the district its seed lies in by these lines, so what the chunks hold is what is drawn.
//
// The lines: the sides of the squares of 1 km (km.js) between chunks of different districts, chained into lines,
// evened out by a running mean (the steps of the squares go), laid on a river where they run beside one (within
// 1.9 km), rounded (Chaikin) and thinned (Douglas–Peucker). A line keeps for every piece the district on its left and
// on its right. A side gets the highest level it divides (district, province, region); the shore is not a border.
// Where a lower line meets a higher one that runs on (a district border ends on a province border), the lower line
// ends exactly on the higher one, at the point where the districts along it change: the lines join, no gap.
//
// Which district a point lies in: the nearest piece of line within NEAR_KM says it — the side the point lies on. Every
// square keeps the list of pieces that come that near to any point of it. A point farther than that from every line is
// in the district of the middle of its square (worked out once, below).
// Plain JavaScript without the GPU; the same division always gives the same lines.
import { KN as FN, KKM as FKM, KX0 as X0, KY0 as Y0, seedOf } from './km.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';

const LAND = 0, V = FN + 1, NONE = 0xFFFFFFFF;
export const NEAR_KM = .75;          // how near a piece of line must be to say the side (more than half the diagonal of a square)
export const PIECE_KM = 2;           // no piece of a line is longer (the GPU keeps its far end as a short offset)
const HALF_DIAG = Math.SQRT1_2 * FKM;
// how far the running mean reaches, corners either way (a kilometre apart), by key = level · 2 + water: the higher the
// level, the farther it is seen from and the more its line is evened out (regions as neat as provinces)
export const REACH = [3, 3, 4, 4, 5, 5, 5];
const ALONG = .6;                    // a line runs along a river where the angle between them is under 53°
const RAMP_KM = 2.5;                 // km from an end that stays over which a line is pulled onto a river more and more
export const TIE_KM = .001;          // pieces this close in distance from a point meet at one end: the angle decides
const swap = l => ((l >>> 16) | (l & 0xFFFF) << 16) >>> 0;
const cornerXY = c => [X0 + (c % V) * FKM, Y0 + Math.floor(c / V) * FKM];

// Where a border of the land runs beside a river, it lies on the river: the nearest point of a river no farther than
// reach km. The same point always goes to the same place, so lines that meet still meet.
// → snap(p) = [x, y, dx, dy]: the point on the river and the direction of the river there (0, 0 when none is near)
export function riverSnapper(rivers, reach = 1.9) {
  if (!rivers || !rivers.length) return null;
  const G = 2.5, grid = new Map(), segs = [], KX = KM_PER_DEG * COS_REF, KY = KM_PER_DEG;
  for (const rv of rivers) for (let i = 1; i < rv.pts.length; i++) {
    const ax = rv.pts[i - 1][0] * KX, ay = rv.pts[i - 1][1] * KY, bx = rv.pts[i][0] * KX, by = rv.pts[i][1] * KY, id = segs.length / 4; segs.push(ax, ay, bx, by);
    for (let gy = Math.floor((Math.min(ay, by) - reach) / G); gy <= Math.floor((Math.max(ay, by) + reach) / G); gy++)
      for (let gx = Math.floor((Math.min(ax, bx) - reach) / G); gx <= Math.floor((Math.max(ax, bx) + reach) / G); gx++) { const k = gx * 100003 + gy, a = grid.get(k); if (a) a.push(id); else grid.set(k, [id]); }
  }
  return p => {
    let bd = reach * reach, qx = p[0], qy = p[1], rx = 0, ry = 0;
    for (const id of grid.get(Math.floor(p[0] / G) * 100003 + Math.floor(p[1] / G)) || []) {
      const ax = segs[id * 4], ay = segs[id * 4 + 1], dx = segs[id * 4 + 2] - ax, dy = segs[id * 4 + 3] - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)) : 0, x = ax + dx * t, y = ay + dy * t, dd = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (dd < bd) { bd = dd; qx = x; qy = y; rx = dx; ry = dy; }
    }
    return [qx, qy, rx, ry];
  };
}

// Sides into lines. sides: flat [a, b, label, …] (corners; label = left | right << 16 going from a to b, or 0 when the
// sides carry none); pinned: corners where a line must end even if it could run on. Walks from the ends and the forks
// (and the pinned corners), then what is left are rings. → [{ vs: corners, labs: label of every piece, ring }] (a walk
// from a junction that comes back to it is a line with both ends there, not a ring: its ends stay)
export function chainSides(sides, pinned = null) {
  const m = sides.length / 3, adj = new Map();
  for (let i = 0; i < m; i++) for (const v of [sides[i * 3], sides[i * 3 + 1]]) { const a = adj.get(v); if (a) a.push(i); else adj.set(v, [i]); }
  const used = new Uint8Array(m), lines = [];
  const walk = (v, i) => {
    const vs = [v], labs = [];
    for (;;) {
      used[i] = 1;
      const fwd = sides[i * 3] === v, w = fwd ? sides[i * 3 + 1] : sides[i * 3];
      labs.push(fwd ? sides[i * 3 + 2] : swap(sides[i * 3 + 2])); vs.push(w);
      const nb = adj.get(w); if (nb.length !== 2 || (pinned && pinned.has(w))) break;
      const j = nb[0] === i ? nb[1] : nb[0]; if (used[j]) break;
      v = w; i = j;
    }
    return { vs, labs, ring: false };
  };
  const corners = [...adj.keys()].sort((p, q) => p - q);
  for (const v of corners) { const nb = adj.get(v); if (nb.length !== 2 || (pinned && pinned.has(v))) for (const i of nb) if (!used[i]) lines.push(walk(v, i)); }
  for (const v of corners) for (const i of adj.get(v)) if (!used[i]) { const l = walk(v, i); l.ring = l.vs.length > 2 && l.vs[0] === l.vs[l.vs.length - 1]; lines.push(l); }
  return lines;
}

// One line, from corners of squares to a smooth line that keeps its labels.
//   L = { pts: [[x, y]], labs: [label of every piece], ids: [corner ids of every point, or null] }
//   r: reach of the running mean; snap: onto the rivers (or null); fixed: [first, last] points that must not move;
//   ring: a closed line with no ends (otherwise told by its first point being its last)
// → the same, smoothed: ids are kept only on the points where the labels change (a lower line ends there)
export function smoothLabelled(L, r, snap = null, fixed = [false, false], isRing = undefined) {
  let p = L.pts.map(v => v.slice()), labs = L.labs.slice(), ids = L.ids.slice();
  const n = p.length, ring = isRing ?? (n > 3 && p[0][0] === p[n - 1][0] && p[0][1] === p[n - 1][1]);
  // a running mean over ±r corners, twice; the ends stay (they meet other lines). A small ring (a pocket of a few
  // squares) is evened out less, or it would shrink to nothing
  if (ring) r = Math.min(r, Math.floor((n - 1) / 6));
  for (let it = 0; it < 2 && n > 4; it++) {
    const q = p.map(v => v.slice());
    for (let i = ring ? 0 : 1; i < n - 1; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let j = -r; j <= r; j++) {
        let m = i + j;
        if (ring) m = ((m % (n - 1)) + (n - 1)) % (n - 1); else if (m < 0 || m >= n) continue;
        sx += p[m][0]; sy += p[m][1]; c++;
      }
      q[i] = [sx / c, sy / c];
    }
    if (ring) q[n - 1] = q[0];
    p = q;
  }
  // onto the river where the line runs along it (not where it only comes near it: a line that leaves a river at a
  // junction must not run on the river beside another one); points that fall together merge (their corner ids too)
  if (snap) {
    // (near an end that stays, the pull onto the river grows over RAMP_KM: a junction off the river joins the river
    // smoothly, without a hairpin)
    const run = new Float64Array(n); for (let i = 1; i < n; i++) run[i] = run[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    p = p.map((v, i) => {
      if ((i === 0 && fixed[0]) || (i === n - 1 && fixed[1])) return v;
      const s = snap(v), a = p[ring ? (i - 1 + n - 1) % (n - 1) : Math.max(0, i - 1)], b = p[ring ? (i + 1) % (n - 1) : Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], c = (tx * s[2] + ty * s[3]) / (Math.hypot(tx, ty) * Math.hypot(s[2], s[3]) || 1);
      if (Math.abs(c) < ALONG) return v;
      const w = ring ? 1 : Math.min(1, fixed[0] ? run[i] / RAMP_KM : 1, fixed[1] ? (run[n - 1] - run[i]) / RAMP_KM : 1);
      return w >= 1 ? [s[0], s[1]] : [v[0] + (s[0] - v[0]) * w, v[1] + (s[1] - v[1]) * w];
    });
    const P = [], Lb = [], I = [];
    for (let i = 0; i < p.length; i++) {
      const last = P.length - 1;
      if (last >= 0 && P[last][0] === p[i][0] && P[last][1] === p[i][1]) {
        if (ids[i]) I[last] = I[last] ? [...I[last], ...ids[i]] : ids[i];
        if (i < p.length - 1) Lb[last] = labs[i]; else Lb.pop();
      } else { P.push(p[i]); I.push(ids[i]); if (i < p.length - 1) Lb.push(labs[i]); }
    }
    if (P.length < 2) return { pts: [p[0], p[p.length - 1]], labs: [labs[0]], ids: [ids[0], ids[ids.length - 1]] };
    p = P; labs = Lb; ids = I;
  }
  // Chaikin twice; where the labels change at a point, the cut corner is split at its middle and the point of the
  // split keeps the corner ids: there a lower line ends
  for (let round = 0; round < 2 && p.length > 2; round++) {
    const isRing = ring && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1], m = p.length - 1;
    const q = [], ql = [], qi = [];
    const emit = (pt, l, id) => { q.push(pt); ql.push(l); qi.push(id); };
    if (!isRing) emit(p[0], labs[0], ids[0]);
    let prevB = null;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[i + 1], A = [a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], B = [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75];
      if (i > 0 && labs[i - 1] !== labs[i]) emit([(prevB[0] + A[0]) / 2, (prevB[1] + A[1]) / 2], labs[i], ids[i]);
      emit(A, labs[i], null); emit(B, labs[i], null); prevB = B;
    }
    if (isRing) {
      if (labs[m - 1] !== labs[0]) emit([(prevB[0] + q[0][0]) / 2, (prevB[1] + q[0][1]) / 2], labs[0], ids[0]);
      emit(q[0], labs[0], null);
    } else emit(p[m], labs[m - 1], ids[m]);
    p = q; labs = ql.slice(0, q.length - 1); ids = qi;
  }
  // Douglas–Peucker, 0.1 km; the ends, the points where the labels change and the junction points stay
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  for (let i = 1; i < p.length - 1; i++) if (labs[i - 1] !== labs[i] || ids[i]) keep[i] = 1;
  const tol2 = .01, stack = [];
  for (let a = 0, b = 1; b < p.length; b++) if (keep[b]) { stack.push([a, b]); a = b; }
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol2;
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const t = L2 ? Math.max(0, Math.min(1, ((p[i][0] - ax) * dx + (p[i][1] - ay) * dy) / L2)) : 0;
      const dd = (p[i][0] - ax - dx * t) ** 2 + (p[i][1] - ay - dy * t) ** 2; if (dd > bd) { bd = dd; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const P = [], Lb = [], I = [];
  for (let i = 0; i < p.length; i++) if (keep[i]) { P.push(p[i]); I.push(ids[i]); if (i < p.length - 1) Lb.push(labs[i]); }
  // (the label of a piece is that of the first of the pieces it was made of: inside a run they are all the same)
  Lb.length = P.length - 1;
  return { pts: P, labs: Lb, ids: I };
}

// pieces never longer than PIECE_KM
function split(L) {
  const P = [L.pts[0]], Lb = [];
  for (let i = 1; i < L.pts.length; i++) {
    const a = L.pts[i - 1], b = L.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / PIECE_KM));
    if (len < 1e-4) continue;                                            // (no piece of no length)
    for (let j = 1; j <= k; j++) { P.push(j === k ? b : [a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); Lb.push(L.labs[i - 1]); }
  }
  return { pts: P, labs: Lb };
}

// ---- the lines of all borders
// cells: the district of every square (cells.js); kinds, province, region: of the division; rivers as for riverSnapper
// → { lines: [{ key, pts, labs }], seg: Float64Array (ax, ay, bx, by per piece), lab: Uint32Array, key: Uint8Array }
export function borderLines(cells, kinds, province, region, rivers = null) {
  const snap = riverSnapper(rivers), groups = new Map();
  const wetOf = d => (kinds[d] === LAND ? 0 : 1);
  for (let y = 0; y < FN; y++) for (let x = 0; x < FN; x++) {
    const t = y * FN + x, d0 = cells[t]; if (d0 < 0) continue;
    for (let s = 0; s < 2; s++) {
      if (s ? y >= FN - 1 : x >= FN - 1) continue;
      const d1 = cells[s ? t + FN : t + 1]; if (d1 < 0 || d1 === d0) continue;
      const w = wetOf(d0); if (w !== wetOf(d1)) continue;                                   // the shore is not a border
      const level = region[province[d0]] !== region[province[d1]] ? 2 : province[d0] !== province[d1] ? 1 : 0, key = level * 2 + w;
      // a side at x + 1 runs north, the square on its left is (x, y); a side at y + 1 runs east, the square on its left is (x, y + 1)
      const g = groups.get(key) || groups.set(key, []).get(key);
      if (!s) g.push(y * V + x + 1, (y + 1) * V + x + 1, (d0 | d1 << 16) >>> 0);
      else g.push((y + 1) * V + x, (y + 1) * V + x + 1, (d1 | d0 << 16) >>> 0);
    }
  }
  // the higher levels first: where a lower line ends on a higher one that runs on, it ends on the point of that line
  // where its labels change (anchor)
  const anchor = new Map(), lines = [];
  for (const key of [4, 5, 2, 3, 0, 1]) {
    const sides = groups.get(key); if (!sides) continue;
    for (const c of chainSides(sides)) {
      const ring = c.ring;
      const pts = c.vs.map(cornerXY), ids = c.vs.map(v => [v]), fixed = [false, false];
      if (!ring) for (const [e, i] of [[0, 0], [1, c.vs.length - 1]]) {
        const a = anchor.get(c.vs[i]);
        // the ends stay where they are: at the shore the line reaches the water, at a junction all its lines meet
        // (pulled onto a river, junctions near one would run together); on a higher line, at its anchor
        if (a) pts[i] = a.slice();
        fixed[e] = true;
      }
      const s = smoothLabelled({ pts, labs: c.labs, ids }, REACH[key], snap, fixed, ring);
      for (let i = 1; i < s.pts.length - 1; i++) if (s.ids[i]) for (const v of s.ids[i]) if (!anchor.has(v)) anchor.set(v, s.pts[i]);
      const sp = split(s); if (sp.labs.length) lines.push({ key, ...sp });
    }
  }
  let m = 0; for (const L of lines) m += L.labs.length;
  const seg = new Float64Array(m * 4), lab = new Uint32Array(m), key = new Uint8Array(m);
  let i = 0;
  for (const L of lines) {
    L.first = i;
    for (let j = 0; j < L.labs.length; j++, i++) { seg.set([L.pts[j][0], L.pts[j][1], L.pts[j + 1][0], L.pts[j + 1][1]], i * 4); lab[i] = L.labs[j]; key[i] = L.key; }
  }
  return { lines, seg, lab, key, count: m };
}

// ---- which pieces every square must know: those within NEAR_KM of any point of it (within NEAR_KM + half a
// diagonal of its middle). Lists are padded to fours: the GPU reads four at a time.
// → first: Uint32Array (where the list of a square begins, in fours), num: Uint8Array (how many fours), list:
//   Uint32Array (piece | key << 24; NONE pads)
export const MAX_FOURS = 24;
function squareLists(geo) {
  const n = FN * FN, R = NEAR_KM + HALF_DIAG, R2 = R * R, { seg, count } = geo;
  const num = new Uint16Array(n);
  const visit = fn => {
    for (let s = 0; s < count; s++) {
      const ax = seg[s * 4], ay = seg[s * 4 + 1], bx = seg[s * 4 + 2], by = seg[s * 4 + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - X0) / FKM)), i1 = Math.min(FN - 1, Math.floor((Math.max(ax, bx) + R - X0) / FKM));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R - Y0) / FKM)), j1 = Math.min(FN - 1, Math.floor((Math.max(ay, by) + R - Y0) / FKM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = X0 + (i + .5) * FKM, cy = Y0 + (j + .5) * FKM, t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L2));
        if ((cx - ax - dx * t) ** 2 + (cy - ay - dy * t) ** 2 <= R2) fn(j * FN + i, s);
      }
    }
  };
  visit(t => { num[t]++; });
  const first = new Uint32Array(n), fours = new Uint8Array(n);
  let total = 0, over = 0;
  for (let t = 0; t < n; t++) { if (!num[t]) continue; let f = Math.ceil(num[t] / 4); if (f > MAX_FOURS) { f = MAX_FOURS; over++; } first[t] = total; fours[t] = f; total += f; }
  const list = new Uint32Array(total * 4).fill(NONE), at = new Uint16Array(n);
  visit((t, s) => { if (at[t] < fours[t] * 4) list[first[t] * 4 + at[t]++] = (s | geo.key[s] << 24) >>> 0; });
  return { first, num: fours, list, over };
}

// The nearest piece of line of one layer (wet: 0 land, 1 water) to a point x, y (flat km).
// → { d: the district on the point's side, d2: the one across, dist, e: [km to a border of a district, a province, a
// region] } or null when there is no piece in the list of its square
export function nearestPiece(geo, x, y, wet) {
  const i = Math.floor((x - X0) / FKM), j = Math.floor((y - Y0) / FKM); if (i < 0 || j < 0 || i >= FN || j >= FN) return null;
  const t = j * FN + i, nf = geo.num[t]; if (!nf) return null;
  const { seg, list } = geo, e = [1e4, 1e4, 1e4];
  let best = 1e9, ang0 = 9, lr = 0, left = false, ext = false, ends = 0;
  for (let k = geo.first[t] * 4, end = k + nf * 4; k < end; k++) {
    const en = list[k]; if (en === NONE || ((en >>> 24) & 1) !== wet) continue;
    const s = en & 0xFFFFFF, lv = en >>> 25, ax = seg[s * 4], ay = seg[s * 4 + 1], abx = seg[s * 4 + 2] - ax, aby = seg[s * 4 + 3] - ay, apx = x - ax, apy = y - ay;
    const L2 = Math.max(abx * abx + aby * aby, 1e-12), u0 = (apx * abx + apy * aby) / L2, u = Math.max(0, Math.min(1, u0));
    const dist = Math.hypot(apx - abx * u, apy - aby * u);
    if (dist < e[0]) e[0] = dist; if (lv >= 1 && dist < e[1]) e[1] = dist; if (lv >= 2 && dist < e[2]) e[2] = dist;
    // Nearest to a point inside the piece: the side of the piece says the district. Nearest to an end which other
    // pieces share (a junction, a bend): the point lies in the angle between two of them; the district is the one on
    // the right of the first piece met turning left from the point (ang: a measure of that turn, 0..4). Nearest to an
    // end no other piece shares (a line that ends at the shore): the side of the piece drawn on.
    let ang = -1, l;
    const side = abx * apy - aby * apx > 0;
    if (u0 > 0 && u0 < 1) l = side;
    else {
      const at1 = u0 >= 1, wx = at1 ? apx - abx : apx, wy = at1 ? apy - aby : apy, rx = at1 ? -abx : abx, ry = at1 ? -aby : aby, k2 = Math.hypot(wx, wy) * Math.hypot(rx, ry) || 1e-12;
      const cs = (wx * rx + wy * ry) / k2, sn = (wx * ry - wy * rx) / k2;
      ang = sn >= 0 ? 1 - cs : 3 + cs; l = at1;                    // right of the ray from the end: the right of the piece from its start, its left from its end
    }
    const near = dist < best - TIE_KM, tie = !near && dist <= best + TIE_KM;
    if (near) ends = ang >= 0 ? 1 : 0; else if (tie && ang >= 0) ends++;
    if (near || (tie && ang0 >= 0 && (ang < 0 || ang < ang0))) { if (near || dist < best) best = dist; ang0 = ang; lr = geo.lab[s]; left = l; ext = side; }
  }
  if (best > 1e8) return null;
  // (a lone end: the line stops at the shore and does not cross the square beyond it — the square says the district)
  const lone = ang0 >= 0 && ends === 1;
  if (lone) left = ext;
  const a = lr & 0xFFFF, b = lr >>> 16;
  return { d: left ? a : b, d2: left ? b : a, dist: best, e, lone };
}

// ---- the border geometry of a division, and the chunks given to the district their seed lies in by it
// div: { cells, kinds, province, region }; rivers as for riverSnapper. Changes div.cells (and returns how many chunks
// changed district); → geo = { lines, seg, lab, key, count, first, num, list, centre: Int32Array (the district of
// the middle of every square) }
export function borderGeometry(div, rivers = null) {
  const geo = borderLines(div.cells, div.kinds, div.province, div.region, rivers);
  Object.assign(geo, squareLists(geo));
  const n = FN * FN, cells = div.cells, kinds = div.kinds, centre = new Int32Array(n).fill(-1), wetOf = d => (kinds[d] === LAND ? 0 : 1);
  // the middle of every square: by the nearest line, if one is near; else by the squares about it that no line comes
  // near — they hang together inside one district, and most of them already lie in it
  for (let t = 0; t < n; t++) {
    const d = cells[t]; if (d < 0) continue;
    if (!geo.num[t]) { centre[t] = d; continue; }
    const r = nearestPiece(geo, X0 + (t % FN + .5) * FKM, Y0 + (Math.floor(t / FN) + .5) * FKM, wetOf(d));
    if (r && r.dist <= NEAR_KM) centre[t] = r.lone ? d : r.d;
  }
  const open = new Uint8Array(n), stack = [];
  for (let t = 0; t < n; t++) if (cells[t] >= 0 && centre[t] < 0) open[t] = 1;
  for (let s0 = 0; s0 < n; s0++) {
    if (!open[s0]) continue;
    const w = wetOf(cells[s0]), part = [s0], votes = new Map(); open[s0] = 0; stack.push(s0);
    // the squares no line comes near, joined over squares no line comes near (a district of their kind)
    while (stack.length) {
      const t = stack.pop(), i = t % FN;
      for (const u of [i > 0 ? t - 1 : -1, i < FN - 1 ? t + 1 : -1, t - FN, t + FN]) {
        if (u < 0 || u >= n || cells[u] < 0 || wetOf(cells[u]) !== w) continue;
        if (open[u]) { open[u] = 0; stack.push(u); part.push(u); } else if (centre[u] >= 0 && !geo.num[u]) votes.set(centre[u], (votes.get(centre[u]) || 0) + 4);   // no line comes near it: sure
      }
    }
    for (const t of part) votes.set(cells[t], (votes.get(cells[t]) || 0) + 1);
    let best = cells[s0], bv = -1; for (const [d, v] of [...votes].sort((a, b) => a[0] - b[0])) if (v > bv) { bv = v; best = d; }
    for (const t of part) centre[t] = best;
  }
  // every chunk to the district its seed lies in
  let moved = 0;
  for (let t = 0; t < n; t++) {
    const d = cells[t]; if (d < 0) continue;
    let to = centre[t];
    if (geo.num[t]) { const [sx, sy] = seedOf(t % FN, Math.floor(t / FN)), r = nearestPiece(geo, sx, sy, wetOf(d)); if (r && r.dist <= NEAR_KM) to = r.lone ? d : r.d; }
    if (to >= 0 && to !== d && wetOf(to) === wetOf(d)) { cells[t] = to; moved++; }
  }
  geo.centre = centre; geo.moved = moved;
  return geo;
}

// The district at a point as it is drawn: by the nearest line within NEAR_KM, else by the middle of its square.
// wet: the layer (0 land, 1 water). −1 when the square is of the other kind (at the shore: the caller looks about).
export function districtByLines(geo, cells, kinds, x, y, wet) {
  const i = Math.floor((x - X0) / FKM), j = Math.floor((y - Y0) / FKM); if (i < 0 || j < 0 || i >= FN || j >= FN) return -1;
  const t = j * FN + i, d = cells[t]; if (d < 0 || (kinds[d] === LAND ? 0 : 1) !== wet) return -1;
  if (!geo.num[t]) return d;
  const r = nearestPiece(geo, x, y, wet);
  return r && r.dist <= NEAR_KM ? (r.lone ? d : r.d) : geo.centre[t];
}

// The outline of district d: the pieces of the lines with d on one side, joined end to end → [[[x, y], …], …]
export function outlineOf(geo, d) {
  const runs = [];
  for (const L of geo.lines) {
    let run = null;
    for (let j = 0; j < L.labs.length; j++) {
      const l = L.labs[j], on = (l & 0xFFFF) === d || l >>> 16 === d;
      if (on) { if (!run) { run = [L.pts[j]]; runs.push(run); } run.push(L.pts[j + 1]); } else run = null;
    }
  }
  // join runs whose ends meet (the same point: lines meet at their very ends)
  const key = p => p[0].toFixed(5) + ',' + p[1].toFixed(5), out = [], used = new Uint8Array(runs.length), ends = new Map();
  runs.forEach((r, i) => { for (const p of [r[0], r[r.length - 1]]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  for (let i = 0; i < runs.length; i++) {
    if (used[i]) continue;
    used[i] = 1; let line = runs[i].slice();
    for (let grow = 0; grow < 2; grow++) {
      for (;;) {
        const k = key(line[line.length - 1]), next = (ends.get(k) || []).find(j => !used[j]); if (next === undefined) break;
        used[next] = 1; const r = runs[next], fwd = key(r[0]) === k;
        line = line.concat((fwd ? r : r.slice().reverse()).slice(1));
      }
      line.reverse();
    }
    out.push(line);
  }
  return out;
}
