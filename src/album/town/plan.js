// The plan of one patch of settlement: which block stands in which cell of its lattice. The cells and what class of
// thing stands in each come from cellRule() (rules.js), the same rule the ground shader paints by, so every block
// stands on its own painted plot. Here the class becomes a kind of building (shapes.js), the special buildings take
// their places (square, temple, fort, mills, piers), and anything on water, on a steep slope, in a swamp or on a
// river is left out.
import { cellRule, cellHash, wob, depthAt, CULTURES } from './rules.js';   // a patch L: r what its chunk holds, re what is drawn (zoomLobe)
import { KIND } from './shapes.js';

export const ROW = 12;   // numbers per block: site x, y, turn of the lattice, kind · cell i, j, own turn, flags · size x, y, tint, height
export const FLAG_ATL = 1, FLAG_WATER = 2;                          // Atlantic colours · may stand over water (a pier)

// env: at(x, y) → metres · river(x, y) → km to the bank of the nearest river · swamp(x, y) → 0..1
function groundOk(env, x, y, half, maxSlope) {
  if (env.at(x, y) <= 1) return false;
  const e = Math.max(half, .12), hE = env.at(x + e, y), hW = env.at(x - e, y), hN = env.at(x, y + e), hS = env.at(x, y - e);
  if (Math.min(hE, hW, hN, hS) <= .5) return false;
  if (Math.hypot(hE - hW, hN - hS) / (2 * e * 1000) > maxSlope) return false;
  return env.river(x, y) >= half * 1.1 && env.swamp(x, y) < .3;
}
// the highest sound ground inside the patch: where its fort stands (the same spot at every camera height)
function fortPoint(L, env) {
  let best = null, bh = -1;
  for (let a = 0; a < 12; a++) for (const q of [.28, .45]) {
    const x = L.x + Math.cos(a * .5236 + L.th) * L.re * q, y = L.y + Math.sin(a * .5236 + L.th) * L.re * q, h = env.at(x, y);
    if (h > bh && groundOk(env, x, y, .4, .25)) { bh = h; best = [x, y]; }
  }
  return best;
}
// where the patch meets the sea: up to n points, nearest first, well apart
function shores(L, env, n) {
  if (!L._shores) {
    L._shores = [];
    if (env.at(L.x, L.y) > 1) for (let a = 0; a < 24; a++) {
      const dx = Math.cos(a * .2618), dy = Math.sin(a * .2618); let dry = true;
      for (let d = .25 * L.r; d <= L.r + .7; d += .1) {
        const h = env.at(L.x + dx * d, L.y + dy * d);
        if (h <= 0 && dry) { L._shores.push({ a: a * .2618, d: d - .05, dx, dy }); break; }
        dry = h > 1;
      }
    }
    L._shores.sort((p, q) => p.d - q.d);
  }
  const out = [];
  for (const s of L._shores) { if (out.length >= n) break; if (out.every(o => Math.abs(Math.atan2(Math.sin(o.a - s.a), Math.cos(o.a - s.a))) > .6)) out.push(s); }
  return out;
}
function kindOf(rule, L, atl) {
  if (rule.mark) return L.r < .45 ? KIND.farm : L.r < 1.6 || atl ? KIND.cluster : KIND.quarter;
  if (rule.cls === 1) return KIND.quarter;
  if (rule.cls === 4) return KIND.market;
  if (rule.cls === 5) return KIND.site;
  if (rule.cls === 2) return rule.core ? (rule.h2 < .26 ? KIND.rows : KIND.terrace) : rule.h2 < .5 ? KIND.rows : rule.h2 < .86 ? KIND.cluster : KIND.terrace;
  if (rule.group) return KIND.cluster;                              // from high up a cell is a group of houses
  if (!rule.big) return KIND.house;
  return atl && (rule.h2 * 9) % 1 < .55 ? KIND.cluster : KIND.farm;
}

// → flat array of ROW numbers per block
export function planLobe(L, S, env) {
  const out = [], atl = L.cul === CULTURES.atl, fl = atl ? FLAG_ATL : 0, cs = Math.cos(L.th), sn = Math.sin(L.th);
  const world = (a, b) => [L.x + (cs * a - sn * b) * S, L.y + (sn * a + cs * b) * S];
  const cell = (kind, i, j, rot, sx, sy, tint, zs = 1) => out.push(L.x, L.y, L.th, kind, i, j, rot, fl, sx, sy, tint, zs);
  const free = (kind, x, y, ang, sx, sy, tint, flags = 0) => out.push(x, y, ang, kind, 0, 0, 0, fl + flags, sx, sy, tint, 1);
  const first = cellRule(0, 0, L, S);
  if (first?.mark) {                                                // the whole settlement is one small mark
    if (groundOk(env, L.x, L.y, first.hx * S, .3)) cell(kindOf(first, L, atl), 0, 0, 0, first.hx * 2, first.hy * 2, .5, first.hx * 2);
    return out;
  }
  const blocked = new Set(), keepOut = [], R = L.re, detailed = S * 1.2 <= R;
  // ---- special buildings
  if (L.r >= 3.2 && S * 2.5 <= R) {                                 // a fort on the highest ground, two cells wide
    const f = fortPoint(L, env);
    if (f) {
      const a = (cs * (f[0] - L.x) + sn * (f[1] - L.y)) / S, b = (-sn * (f[0] - L.x) + cs * (f[1] - L.y)) / S;
      let i0 = Math.round(a - .5), j0 = Math.round(b - .5);
      if (i0 >= -1 && i0 <= 1 && j0 >= -1 && j0 <= 0) j0 = 1;       // not on the square and the temple
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) blocked.add(`${i0 + di},${j0 + dj}`);
      const [x, y] = world(i0 + .5, j0 + .5);
      if (groundOk(env, x, y, .9 * S, .3)) out.push(L.x, L.y, L.th, KIND.fort, i0 + .5, j0 + .5, 0, fl, 1.84, 1.84, cellHash(i0, j0, L.k, 3), 1.5);
    }
  }
  if (L.r >= .9 && S * 1.5 <= R) {                                  // a temple by the middle of the settlement
    const [x, y] = world(1, 0);
    if (groundOk(env, x, y, .45 * S, .25)) { blocked.add('1,0'); const s = atl ? .78 : .92; cell(KIND.temple, 1, 0, atl ? cellHash(1, 0, L.k, 4) * 6.2831853 : 0, s, s, cellHash(1, 0, L.k, 3)); }
  }
  if (L.r >= .9 && detailed) {                                      // piers where the settlement meets the sea
    for (const s of shores(L, env, L.r >= 3.2 ? 3 : 1)) {
      const sx = L.x + s.dx * s.d, sy = L.y + s.dy * s.d;
      free(KIND.pier, sx + s.dx * .135 * S, sy + s.dy * .135 * S, s.a, .9, .5, cellHash(Math.round(s.a * 10), 7, L.k, 3), FLAG_WATER);
      keepOut.push({ x: sx - s.dx * .3 * S, y: sy - s.dy * .3 * S, r: .6 * S });
    }
  }
  if (L.r >= .9 && detailed) {                                      // mills just outside the last houses
    const n = L.r >= 3.2 ? 3 : L.r >= 1.6 ? 2 : 1;
    for (let m = 0; m < n; m++) for (let t = 0; t < 6; t++) {
      const a = cellHash(m, t, L.k, 9) * 6.2831853, dx = Math.cos(a), dy = Math.sin(a), d = R + L.amp * wob(L.x + dx * R, L.y + dy * R) + .5 * S + .15, x = L.x + dx * d, y = L.y + dy * d;
      if (!groundOk(env, x, y, .3 * S, .3) || L.rivals.some(o => depthAt(o, x, y) > -.4 * S) || keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + .4 * S)) continue;
      free(KIND.mill, x, y, cellHash(m, t, L.k, 10) * 6.2831853, .5, .5, cellHash(m, t, L.k, 3));
      keepOut.push({ x, y, r: .35 * S }); break;
    }
  }
  // ---- the lattice
  const N = Math.ceil((R + L.amp + Math.min(.9 * S, .6)) / S) + 1;
  for (let j = -N; j <= N; j++) for (let i = -N; i <= N; i++) {
    const rule = cellRule(i, j, L, S); if (!rule || blocked.has(`${i},${j}`)) continue;
    const [x0, y0] = world(i, j), own = R - Math.hypot(i, j) * S;
    let riv = -1e9; for (const o of L.rivals) riv = Math.max(riv, o.re - Math.hypot(x0 - o.x, y0 - o.y));
    if (own - riv < .55 * S) continue;                              // where two patches meet nothing stands: an open strip
    const [x, y] = world(i + rule.ox, j + rule.oy), half = Math.max(rule.hx, rule.hy) * S;
    if (!groundOk(env, x, y, half, rule.cls === 3 ? .3 : .22) || keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + half * .7)) continue;
    if (rule.core && L.r >= 3.2 && cellHash(i, j, L.k, 6) < .012) { cell(KIND.temple, i, j, 0, .9, .9, rule.h3); continue; }   // more temples in a city
    const kind = kindOf(rule, L, atl), flip = kind === KIND.quarter || kind === KIND.rows || kind === KIND.terrace ? ((rule.h1 * 97) % 1 < .5 ? Math.PI : 0) : 0;
    const k = kind === KIND.market ? .96 : 1;
    cell(kind, i + rule.ox, j + rule.oy, rule.rot + flip + (kind === KIND.site ? Math.floor(rule.h3 * 4) * 1.5707963 : 0), rule.hx * 2 * k, rule.hy * 2 * k, rule.h3);
  }
  return out;
}

// every kind once in both manners of building, in rows around a point: the «витрина»
const SHOW = { quarter: [.9, .9], rows: [.9, .84], terrace: [.88, .88], cluster: [.84, .84], farm: [.76, .68], house: [.52, .3], temple: [.94, .94], market: [.96, .96], fort: [1.3, 1.3, 1.3], mill: [.5, .5], pier: [.9, .5], site: [.8, .8] };
export function planShowcase(x, y, gap) {
  const out = [], names = Object.keys(SHOW), cols = 6;
  for (let c = 0; c < 2; c++) names.forEach((name, n) => {
    const col = n % cols, row = Math.floor(n / cols) + c * 2, s = SHOW[name];
    out.push(x + (col - (cols - 1) / 2) * gap, y + (1.5 - row) * gap, 0, KIND[name], 0, 0, 0, c ? FLAG_ATL : 0, s[0], s[1], (n * .37 + .2) % 1, s[2] || 1);
  });
  return out;
}
