// The plan of one patch of settlement: which block stands in which cell of its lattice. The cells and what class of
// thing stands in each come from cellRule() (rules.js), the same rule the ground shader paints by, so every block
// stands on its own painted plot. Here the class becomes a kind of building (shapes.js), the special buildings take
// their places (square, temple, castle, mills, piers), and anything on water, on a steep slope, in a swamp or on a
// river is left out. The plan depends on the patch alone, not on the camera: it stays as it is while one flies in.
//
// A town has more than its blocks (the owner, 13.11.2026: «внутри — улицы, построена стена или замок… у моря —
// гавань»): MAIN STREETS run from its site — the knot of its roads, its market square — straight out along its roads
// (the directions are L.gates: state.js mirrorGates()); a WALL rings the middle of a town from WALL_FROM km on, with
// a GATE where every main street crosses it; a smaller town has a CASTLE on its highest ground instead, a great one
// besides. No block stands on a street, on a road or on the wall: a block that would is made smaller, or left out.
import { cellRule, cellHash, wob, depthAt, unbend, bendTurn, midOf, wallAt, CULTURES, STAGES, WALL_SHARE, WALL_FROM, CASTLE_FROM, KEEP_FROM, WALL_W, WALL_CLEAR, WALL_SEG, STREET_W, GATE_W } from './rules.js';
import { KIND } from './shapes.js';

export const ROW = 12;   // numbers per block: site x, y, turn of the lattice, kind · cell i, j, own turn, flags · size x, y, tint, height
export const FLAG_ATL = 1, FLAG_WATER = 2;                          // Atlantic colours · may stand over water (a pier)
const VILLAGE = STAGES[2].r, SMALLTOWN = STAGES[3].r, TOWN = STAGES[4].r, TAU = 6.283185307179586;
export const LEAST = .45;                                           // a block made smaller than this share of itself is left out

// env: at(x, y) → metres · river(x, y) → km to the bank of the nearest river · swamp(x, y) → 0..1 ·
//      road(x, y) → km to the nearest road as it is drawn (may be left out)
function groundOk(env, x, y, half, maxSlope) {
  if (env.at(x, y) <= 1) return false;
  const e = Math.max(half, .1), hE = env.at(x + e, y), hW = env.at(x - e, y), hN = env.at(x, y + e), hS = env.at(x, y - e);
  if (Math.min(hE, hW, hN, hS) <= .5) return false;
  if (Math.hypot(hE - hW, hN - hS) / (2 * e * 1000) > maxSlope) return false;
  return env.river(x, y) >= half * 1.1 && env.swamp(x, y) < .3;
}
// has patch L a wall? (a town of the coarse grid from WALL_FROM km on)
export const walled = L => L.fine === undefined && L.r >= WALL_FROM;
// km from a point to the nearest main street of patch L: a ray from its site in each of the directions L.gates
export function streetAt(L, x, y) {
  let best = 1e9; const dx = x - L.x, dy = y - L.y;
  for (const a of L.gates || []) { const ux = Math.cos(a), uy = Math.sin(a); if (dx * ux + dy * uy > -.006) best = Math.min(best, Math.abs(dx * uy - dy * ux)); }
  return best;
}
// km from a point to the wall of patch L (1e9 when it has none)
export function wallDist(L, x, y) {
  if (!walled(L)) return 1e9;
  const [mx, my] = midOf(L), dx = x - mx, dy = y - my; return Math.abs(Math.hypot(dx, dy) - wallAt(L, Math.atan2(dy, dx)));
}
// where the main streets of patch L cross its wall: [{ x, y, a (the direction of the street), at (the direction of
// the gate as seen from the middle of the patch, 0..2π) }], in the order of `at`
export function gatesOf(L) {
  const out = []; if (!walled(L)) return out;
  const [mx, my] = midOf(L);
  for (const a of L.gates || []) {
    const ux = Math.cos(a), uy = Math.sin(a);
    for (let t = 0; t <= 2 * L.r; t += .004) {
      const x = L.x + ux * t, y = L.y + uy * t, dx = x - mx, dy = y - my;
      if (Math.hypot(dx, dy) >= wallAt(L, Math.atan2(dy, dx))) { out.push({ x, y, a, at: (Math.atan2(dy, dx) + TAU) % TAU }); break; }
    }
  }
  return out.sort((p, q) => p.at - q.at);
}
// the highest sound ground of the patch that has room for it: where its castle stands — inside the wall, if the
// town has one. free(x, y) → is there room at that point?
function fortPoint(L, env, free) {
  let best = null, bh = -1; const [mx, my] = midOf(L), wall = walled(L);
  for (let a = 0; a < 16; a++) for (const q of wall ? [.3, .55, .8] : [.3, .5, .72]) {
    const an = a * .3927 + L.th, d = wall ? wallAt(L, an) * q : L.re * q, x = mx + Math.cos(an) * d, y = my + Math.sin(an) * d, h = env.at(x, y);
    if (h > bh && groundOk(env, x, y, .1, .25) && free(x, y)) { bh = h; best = [x, y]; }
  }
  return best;
}
// where the patch meets the sea: up to n points, nearest first, a pier's length and more apart
function shores(L, env, n) {
  if (!L._shores) {
    L._shores = []; const [mx, my] = midOf(L);
    if (env.at(mx, my) > 1) for (let a = 0; a < 24; a++) {
      // (the first water along the ray, once dry land has been crossed: a beach may be many steps wide)
      const dx = Math.cos(a * .2618), dy = Math.sin(a * .2618);
      for (let d = .25 * L.r; d <= L.r + .2; d += .03) {
        if (env.at(mx + dx * d, my + dy * d) > 0) continue;
        let e = d; while (e > d - .03 && env.at(mx + dx * e, my + dy * e) <= 0) e -= .005;        // the very edge of the water
        L._shores.push({ a: a * .2618, d: e + .0025, dx, dy }); break;
      }
    }
    L._shores.sort((p, q) => p.d - q.d);
  }
  const out = [];
  const apart = Math.max(.14, .22 * L.r);
  for (const s of L._shores) { if (out.length >= n) break; if (out.every(o => Math.hypot(o.dx * o.d - s.dx * s.d, o.dy * o.d - s.dy * s.d) > apart)) out.push(s); }
  return out;
}
// the kind of building for a cell: the class from the rule, the variety from the random numbers of the cell
function kindOf(rule, L, atl) {
  const v = (rule.h2 * 97) % 1;                                     // one more random number, for the choice among look-alikes
  if (rule.mark) return L.r < STAGES[1].r ? KIND.farm : L.r < SMALLTOWN || atl ? KIND.cluster : KIND.quarter;
  if (rule.cls === 1) return v < .34 ? KIND.quarter : v < .56 ? KIND.quarterU : v < .76 ? KIND.quarterL : v < .9 ? KIND.palace : KIND.quarter;
  if (rule.cls === 4) return KIND.market;
  if (rule.cls === 5) return KIND.site;
  if (rule.cls === 2) return rule.core ? (rule.h2 < .13 ? KIND.rows : rule.h2 < .24 ? KIND.lanes : KIND.terrace) : rule.h2 < .3 ? KIND.rows : rule.h2 < .52 ? KIND.lanes : rule.h2 < .86 ? KIND.cluster : KIND.terrace;
  if (!rule.big) return v < .7 ? KIND.house : KIND.tower;
  return atl ? (v < .5 ? KIND.cluster : KIND.farm) : v < .7 ? KIND.farm : KIND.villa;
}

// → flat array of ROW numbers per block
export function planLobe(L, S, env) {
  const out = [], atl = L.cul === CULTURES.atl, fl = atl ? FLAG_ATL : 0, cs = Math.cos(L.th), sn = Math.sin(L.th), R = L.re;
  const [mx, my] = midOf(L), ax = cs * (mx - L.x) + sn * (my - L.y), ay = -sn * (mx - L.x) + cs * (my - L.y);   // the middle of the patch; the same in the lattice, km
  const world = (a, b) => [L.x + (cs * a - sn * b) * S, L.y + (sn * a + cs * b) * S];
  const cell = (kind, i, j, rot, sx, sy, tint, zs = 1) => out.push(L.x, L.y, L.th, kind, i, j, rot, fl, sx, sy, tint, zs);
  const free = (kind, x, y, ang, sx, sy, tint, flags = 0) => out.push(x, y, ang, kind, 0, 0, 0, fl + flags, sx, sy, tint, 1);
  const first = cellRule(0, 0, L, S);
  if (first?.mark) {                                                // the whole settlement is one small house
    if (groundOk(env, L.x, L.y, first.hx * S, .3)) cell(kindOf(first, L, atl), 0, 0, 0, first.hx * 2, first.hy * 2, .5, first.hx * 2);
    return out;
  }
  const blocked = new Set(), keepOut = [], detailed = S * 1.2 <= R, town = L.fine === undefined, wall = walled(L) && S * 2.5 <= R, streets = town && (L.gates || []).length > 0;
  // How much room a thing with half-size `half` km has at (x, y), as a share of itself: 1 — all of it; less — it must be
  // made that much smaller to keep off the main streets, the roads and the wall
  const room = (x, y, half) => {
    let most = half;
    if (streets) most = Math.min(most, streetAt(L, x, y) - STREET_W / 2 - .003);
    if (wall) most = Math.min(most, wallDist(L, x, y) - WALL_CLEAR - WALL_W / 2);
    if (env.road) most = Math.min(most, env.road(x, y) - .011);
    return most / half;
  };
  // ---- special buildings
  // a castle on the highest sound ground: the stronghold of a town too small for a wall, the citadel of a great one
  if (town && ((L.r >= CASTLE_FROM && L.r < WALL_FROM) || L.r >= KEEP_FROM) && S * 2.5 <= R) {
    // (where it would stand is the middle of four cells of the lattice: that spot must be sound and have room)
    const size = L.r >= KEEP_FROM ? 1.84 : 1.3, spot = (px, py) => {
      const a = (cs * (px - L.x) + sn * (py - L.y)) / S, b = (-sn * (px - L.x) + cs * (py - L.y)) / S;
      let i0 = Math.round(a - .5), j0 = Math.round(b - .5);
      if (i0 >= -1 && i0 <= 1 && j0 >= -1 && j0 <= 0) j0 = 1;       // not on the square and the temple
      const [qi, qj] = unbend(L, i0 + .5, j0 + .5), [x, y] = world(qi, qj);
      return { i0, j0, qi, qj, x, y };
    };
    const f = fortPoint(L, env, (px, py) => { const s = spot(px, py); return groundOk(env, s.x, s.y, .9 * S, .3) && room(s.x, s.y, size * .56 * S) > .9; });
    if (f) {
      const { i0, j0, qi, qj } = spot(f[0], f[1]);
      {
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) blocked.add(`${i0 + di},${j0 + dj}`);
        cell(KIND.fort, qi, qj, bendTurn(L, qi, qj), size, size, cellHash(i0, j0, L.k, 3), size > 1.5 ? 1.5 : 1.2);
      }
    }
  }
  if (L.r >= VILLAGE && S * 1.5 <= R) {                             // a temple by the middle of the settlement, off its main streets
    for (const [ti, tj] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const [qi, qj] = unbend(L, ti, tj), [x, y] = world(qi, qj);
      if (blocked.has(`${ti},${tj}`) || !groundOk(env, x, y, .45 * S, .25) || room(x, y, .46 * S) < .98) continue;
      blocked.add(`${ti},${tj}`); const s = atl ? .78 : .92; cell(KIND.temple, qi, qj, atl ? cellHash(1, 0, L.k, 4) * 6.2831853 : bendTurn(L, qi, qj), s, s, cellHash(1, 0, L.k, 3));
      break;
    }
  }
  if (L.r >= VILLAGE && detailed) {                                 // piers where the settlement meets the sea: a town has a harbour of them
    for (const s of shores(L, env, L.r >= TOWN ? 5 : L.r >= SMALLTOWN ? 3 : 1)) {
      const sx = mx + s.dx * s.d, sy = my + s.dy * s.d;
      free(KIND.pier, sx + s.dx * .135 * S, sy + s.dy * .135 * S, s.a, .9, .5, cellHash(Math.round(s.a * 10), 7, L.k, 3), FLAG_WATER);
      keepOut.push({ x: sx - s.dx * .3 * S, y: sy - s.dy * .3 * S, r: .6 * S });
    }
  }
  if (L.r >= VILLAGE && detailed) {                                 // mills just outside the last houses
    const n = L.r >= TOWN ? 3 : L.r >= SMALLTOWN ? 2 : 1;
    for (let m = 0; m < n; m++) for (let t = 0; t < 6; t++) {
      const a = cellHash(m, t, L.k, 9) * 6.2831853, dx = Math.cos(a), dy = Math.sin(a), d = R + L.amp * wob(mx + dx * R, my + dy * R) + 1.2 * S, x = mx + dx * d, y = my + dy * d;
      if (!groundOk(env, x, y, .3 * S, .3) || L.rivals.some(o => depthAt(o, x, y) > -.4 * S) || keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + .4 * S) || room(x, y, .3 * S) < 1) continue;
      free(KIND.mill, x, y, cellHash(m, t, L.k, 10) * 6.2831853, .5, .5, cellHash(m, t, L.k, 3));
      keepOut.push({ x, y, r: .35 * S }); break;
    }
  }
  // ---- the wall: pieces from tower to tower along its ring, a gatehouse where a main street crosses it. It stops at
  // the water, at a river, at a swamp and at a cliff.
  if (wall) {
    // (a wall climbs a hill, but not a cliff; it does not stand in a swamp)
    const steep = (x, y) => Math.hypot(env.at(x + .06, y) - env.at(x - .06, y), env.at(x, y + .06) - env.at(x, y - .06)) / 120 > .45;
    const gates = gatesOf(L), dry = (x, y) => env.at(x, y) > .6 && env.river(x, y) > .012 && env.swamp(x, y) < .3 && !steep(x, y), at = a => { const w = wallAt(L, a); return [mx + Math.cos(a) * w, my + Math.sin(a) * w]; };
    for (const g of gates) if (dry(g.x, g.y)) free(KIND.gate, g.x, g.y, g.at + 1.5707963, GATE_W * 1.25 / S, GATE_W * 1.25 / S, cellHash(Math.round(g.at * 40), 3, L.k, 3));
    // the arcs between the gates (one whole ring when there is no gate)
    const ends = gates.length ? gates.map(g => g.at) : [L.th], mean = WALL_SHARE * L.r;
    for (let e = 0; e < ends.length; e++) {
      const gap = gates.length ? GATE_W * .62 / mean : 0, a0 = ends[e] + gap, a1 = (e + 1 < ends.length ? ends[e + 1] : ends[0] + TAU) - gap; if (!(a1 > a0)) continue;
      const n = Math.max(1, Math.round((a1 - a0) * mean / WALL_SEG));
      for (let k = 0; k < n; k++) {
        const p0 = at(a0 + (a1 - a0) * k / n), p1 = at(a0 + (a1 - a0) * (k + 1) / n), x = (p0[0] + p1[0]) / 2, y = (p0[1] + p1[1]) / 2;
        if (!dry(x, y) || !dry(p0[0], p0[1])) continue;
        free(KIND.wall, x, y, Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / S, 1, cellHash(k, e, L.k, 3));
      }
    }
  }
  // ---- the lattice
  const N = Math.ceil((R + Math.hypot(ax, ay) + L.amp + Math.min(1.5 * S, .15)) / S) + 1;
  for (let j = -N; j <= N; j++) for (let i = -N; i <= N; i++) {
    const rule = cellRule(i, j, L, S); if (!rule || blocked.has(`${i},${j}`)) continue;
    const [x0, y0] = world(i, j), own = R - Math.hypot(i * S - ax, j * S - ay);
    let riv = -1e9; for (const o of L.rivals) { const [ox, oy] = midOf(o); riv = Math.max(riv, o.re - Math.hypot(x0 - ox, y0 - oy)); }
    if (own - riv < .55 * S) continue;                              // where two patches meet nothing stands: an open strip
    const [qi, qj] = unbend(L, i + rule.ox, j + rule.oy), [x, y] = world(qi, qj), half = Math.max(rule.hx, rule.hy) * S;   // the lattice is bent: where the cell really lies
    if (!groundOk(env, x, y, half, rule.cls === 3 ? .3 : .22) || keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + half * .7)) continue;
    // off the main streets, the roads and the wall: a block that reaches onto them is made smaller; one that would be
    // less than half of itself is left out. (The market square is open ground: the streets meet on it.)
    let fit = 1;
    if (rule.cls !== 4 && (streets || wall || env.road)) { fit = Math.min(1, room(x, y, half * 1.12)); if (fit < LEAST) continue; }
    const turn = bendTurn(L, qi, qj);
    if (rule.core && L.r >= TOWN && fit === 1 && cellHash(i, j, L.k, 6) < .012) { cell(KIND.temple, qi, qj, turn, .9, .9, rule.h3); continue; }   // more temples in a city
    const kind = kindOf(rule, L, atl), flip = rule.cls < 2.5 && kind !== KIND.market ? Math.floor(rule.h1 * 97 % 1 * 4) * 1.5707963 : 0;   // a block may face any of the four streets
    const k = (kind === KIND.market ? .96 : 1) * fit, quarter = flip % 3.1415926 > 1;
    cell(kind, qi, qj, rule.rot + turn + flip + (kind === KIND.site ? Math.floor(rule.h3 * 4) * 1.5707963 : 0), (quarter ? rule.hy : rule.hx) * 2 * k, (quarter ? rule.hx : rule.hy) * 2 * k, rule.h3);
  }
  return out;
}

// every kind once in both manners of building, in rows around a point: the «витрина»
const SHOW = { quarter: [.9, .9], quarterU: [.9, .9], quarterL: [.9, .9], palace: [.9, .9], rows: [.9, .84], lanes: [.9, .86], terrace: [.88, .88], cluster: [.84, .84], farm: [.76, .68], villa: [.8, .7], house: [.52, .3], tower: [.4, .4],
  temple: [.94, .94], market: [.96, .96], fort: [1.3, 1.3, 1.3], mill: [.5, .5], pier: [.9, .5], site: [.8, .8], yard: [.9, .8], longyard: [.9, .7], cot: [.7, .6], wall: [1, 1], gate: [.7, .7] };
export function planShowcase(x, y, gap) {
  const out = [], names = Object.keys(SHOW), cols = 12, rows = Math.ceil(names.length / cols);
  for (let c = 0; c < 2; c++) names.forEach((name, n) => {
    const col = n % cols, row = Math.floor(n / cols) + c * rows, s = SHOW[name];
    out.push(x + (col - (cols - 1) / 2) * gap, y + (rows - .5 - row) * gap, 0, KIND[name], 0, 0, 0, c ? FLAG_ATL : 0, s[0], s[1], (n * .37 + .2) % 1, s[2] || 1);
  });
  return out;
}
