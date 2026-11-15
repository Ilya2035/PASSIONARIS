// Where the roads meet the rivers and the settlements (the owner, 12.11.2026: «если пересечение идёт через реку…
// прокладывается дорога и показывается перепутье. И мы потом там строим мост»; the task of 13.11.2026: bridges and
// fords, and a road never runs over the houses).
//   • A CROSSING is a point where a road as it is drawn meets the real course of a river (water/courses.js). What
//     stands there depends on the road and on the water (the owner, 15.11.2026: «Малая дорога без инфраструктуры не
//     может пересекаться… Там должен быть мост»; of a track: «мосты должны быть, какие-то маленькие, или нужно
//     просчитать, где у реки броды… А если нету брода, то тропа не пересекает реку и идёт на следующей стороне, как
//     будто там переправа. Надо визуально домик какой-нибудь нарисовать»):
//       a main road    a bridge of stone over any river;
//       a lesser road  a bridge of timber over a river it can span, a ferry over a great one;
//       a track        a ford where the river can be forded; else a footbridge over narrow water; else a ferry.
//     A brook is stepped through by everyone, and that too is a ford.
//   • A FORD is where a river can be waded: the water is not wide and both banks are low (fordable()). The fords of
//     a river are found all along it, whether a road comes to them or not (fordSites()): «на всех реках, как в
//     реальности, надо попытаться отметить все места брода».
//   • A FERRY is where there is neither: the road comes down to the bank, a hut and a boat stand there, and the road
//     goes on from the other bank.
//   • A road STOPS at the first houses of a settlement: inside, the streets of the settlement take over.
// Plain JavaScript without the GPU. Everything is in flat km (chunks.js, kmOf).
import { kmOf } from '../chunks.js';

export const FORD_MIN = .004;                       // km: water narrower than this is stepped over and is no crossing at all
// bridges: over water at least `min` km wide; a lesser road spans no more than `lesserMax`; `abut` km of deck on each
// bank; `wide`: the deck against the road; `fade`: the sizes of a pixel (km) between which bridges go as the camera rises
export const BRIDGE = { min: .01, lesserMax: .15, footMax: .04, abut: .012, wide: 2, fade: [.035, .075] };
// fords: water no wider than `max` km; both banks, `reach` km from the middle of the water, no higher than `bank`
// metres over it; a river dry for a part of the year is forded anywhere. Along a river a ford is marked no oftener
// than every `every` km, and none within `clear` km of a place where a road crosses already.
export const FORD = { max: .045, bank: 6, reach: .12, every: 5, clear: 1.5, step: .2 };
export const WEAVE = 2.5;                           // km along a road: see riverCrossings()
export const TOWN_EDGE = .92;                       // a road stops at this share of the radius of a settlement
const SOFT = .04;                                   // km over which it fades out there

// what stands where a road of `kind` (0 main, 1 lesser, 2 track) meets water `w` km wide: 'bridge' | 'ford' | 'ferry'.
// shallow: the river can be forded there (fordable())
export function crossingType(kind, w, shallow = false) {
  if (w < BRIDGE.min) return 'ford';
  if (kind === 0) return 'bridge';
  if (kind === 1) return w <= BRIDGE.lesserMax ? 'bridge' : 'ferry';
  if (shallow && w <= FORD.max) return 'ford';
  return w <= BRIDGE.footMax ? 'bridge' : 'ferry';
}
// Can water w km wide be forded at (x, y), where it is crossed along the unit vector (dx, dy)? heightAt(x, y) → metres
// on the flat km plane (without it only the width tells); dry: the river is dry for a part of the year
export function fordable(w, x, y, dx, dy, heightAt = null, dry = false) {
  if (dry) return true; if (w > FORD.max) return false; if (!heightAt) return true;
  const h = heightAt(x, y), r = FORD.reach + w / 2;
  return heightAt(x + dx * r, y + dy * r) - h <= FORD.bank && heightAt(x - dx * r, y - dy * r) - h <= FORD.bank;
}

const key = (i, j) => i * 100003 + j;
// lines: [{ km: [[x, y] …], kind }] (the roads as drawn); courses: decodeCourses() of water/courses.js
// → [{ x, y, type, road (kind), line (its number), at (km along that line), width (km of water), river (name), dry, dx, dy (the way the road
//      runs, a unit vector), rx, ry (the way the river runs), span (km: the deck from bank to bank along the road, with its abutments) }]
export function riverCrossings(lines, courses, cell = 1, heightAt = null) {
  const grid = new Map(), out = [], ats = [];                    // ats: km along every line to each of its points
  lines.forEach((l, li) => {
    const at = new Float32Array(l.km.length); ats.push(at);
    for (let s = 1; s < l.km.length; s++) {
      const a = l.km[s - 1], b = l.km[s]; at[s] = at[s - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let j = Math.floor(Math.min(a[1], b[1]) / cell); j <= Math.floor(Math.max(a[1], b[1]) / cell); j++)
        for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i++) { const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(li, s); }
    }
  });
  if (!grid.size) return out;
  const seen = new Set();
  for (const r of courses.rivers) {
    let px = 0, py = 0;
    for (let n = 0; n < r.n; n++) {
      const [qx, qy] = kmOf(r.ll[n * 2 + 1], r.ll[n * 2]);
      if (n && Math.max(r.w[n], r.w[n - 1]) >= FORD_MIN) {
        seen.clear();
        for (let j = Math.floor(Math.min(py, qy) / cell); j <= Math.floor(Math.max(py, qy) / cell); j++) for (let i = Math.floor(Math.min(px, qx) / cell); i <= Math.floor(Math.max(px, qx) / cell); i++) {
          const list = grid.get(key(i, j)); if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const li = list[k], s = list[k + 1], id = li * 65536 + s; if (seen.has(id)) continue; seen.add(id);
            const a = lines[li].km[s - 1], b = lines[li].km[s], rx = b[0] - a[0], ry = b[1] - a[1], sx = qx - px, sy = qy - py, den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue;
            const t = ((px - a[0]) * sy - (py - a[1]) * sx) / den, u = ((px - a[0]) * ry - (py - a[1]) * rx) / den; if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
            const len = Math.hypot(rx, ry) || 1, w = r.w[n - 1] + (r.w[n] - r.w[n - 1]) * u, sin = Math.max(.5, Math.abs(den) / (len * (Math.hypot(sx, sy) || 1)));
            const cx = a[0] + rx * t, cy = a[1] + ry * t, shallow = lines[li].kind === 2 && w >= BRIDGE.min && fordable(w, cx, cy, rx / len, ry / len, heightAt, !!r.dry);
            out.push({ at: ats[li][s - 1] + len * t, x: cx, y: cy, type: crossingType(lines[li].kind, w, shallow), road: lines[li].kind, line: li, width: w, river: r.ru || r.name || '', dry: !!r.dry, dx: rx / len, dy: ry / len, rx: sx / (Math.hypot(sx, sy) || 1), ry: sy / (Math.hypot(sx, sy) || 1), sin, span: w / sin + 2 * BRIDGE.abut });
          }
        }
      }
      px = qx; py = qy;
    }
  }
  // the arms of one river side by side, or a river drawn twice: one crossing, the widest water
  out.sort((p, q) => p.line - q.line || q.width - p.width);
  const kept = [];
  for (const c of out) { if (kept.some(k => k.line === c.line && Math.hypot(k.x - c.x, k.y - c.y) < Math.max(.06, (k.width + c.width) * .75))) continue; kept.push(c); }
  // A road that runs beside a river may touch its bends: it steps over the water and comes straight back. That is no
  // bridge: two crossings of one river less than WEAVE km apart along one road are forded shallows of the bank.
  const byLine = new Map(); for (const c of kept) (byLine.get(c.line) || byLine.set(c.line, []).get(c.line)).push(c);
  for (const list of byLine.values()) {
    list.sort((p, q) => p.at - q.at);
    for (let i = 0; i + 1 < list.length; i++) { const a = list[i], b = list[i + 1]; if (a.river === b.river && b.at - a.at < WEAVE && a.type !== 'ford' && b.type !== 'ford') { a.type = b.type = 'ford'; a.weave = b.weave = true; i++; } }
  }
  return kept;
}

// The fords of the rivers, whether a road comes to them or not: along every river that can be waded, the best place
// of every stretch of FORD.every km — the lowest banks. courses: decodeCourses(); heightAt(x, y) → metres; taken:
// [{ x, y }] places where a road crosses already (riverCrossings()) — no ford is marked within FORD.clear km of one.
// → [{ x, y, width, river, dx, dy (across the river: a unit vector), rx, ry (the way the river runs) }]
export function fordSites(courses, heightAt, taken = []) {
  const out = [], grid = new Map(), C = FORD.clear;
  for (const t of taken) { const k = key(Math.floor(t.x / C), Math.floor(t.y / C)); (grid.get(k) || grid.set(k, []).get(k)).push(t); }
  const near = (x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const t of grid.get(key(Math.floor(x / C) + i, Math.floor(y / C) + j)) || []) if (Math.hypot(t.x - x, t.y - y) < C) return true; return false; };
  for (const r of courses.rivers) {
    if (r.dry) continue;                                           // a dry river is forded anywhere: nothing to mark
    // (the river is told off in stretches of FORD.every km from its source; of two places with banks as low, the one nearer the middle of its stretch)
    let px = 0, py = 0, run = 0, from = 0, best = null, next = 0;
    const flush = () => { if (best) { out.push(best); const k = key(Math.floor(best.x / C), Math.floor(best.y / C)); (grid.get(k) || grid.set(k, []).get(k)).push(best); } best = null; from += FORD.every; };
    for (let n = 0; n < r.n; n++) {
      const [qx, qy] = kmOf(r.ll[n * 2 + 1], r.ll[n * 2]);
      if (n) {
        const len = Math.hypot(qx - px, qy - py); run += len; while (run - from >= FORD.every) flush();
        const w = (r.w[n] + r.w[n - 1]) / 2;
        if (w >= BRIDGE.min && w <= FORD.max && run >= next && len > 1e-6) {
          next = run + FORD.step;
          const sx = (qx - px) / len, sy = (qy - py) / len, x = (px + qx) / 2, y = (py + qy) / 2, h = heightAt(x, y), reach = FORD.reach + w / 2;
          const up = Math.max(heightAt(x - sy * reach, y + sx * reach) - h, heightAt(x + sy * reach, y - sx * reach) - h), score = Math.max(0, up) + Math.abs(run - from - FORD.every / 2) * .2;
          if (up <= FORD.bank && !near(x, y) && (!best || score < best.score)) best = { score, x, y, width: w, river: r.ru || r.name || '', dx: -sy, dy: sx, rx: sx, ry: sy, up };
        }
      }
      px = qx; py = qy;
    }
    flush();
  }
  for (const s of out) delete s.score;
  return out;
}

// A bridge stands square across its river, and the road turns to it: the points of the road within reach of the
// crossing give way to the two ends of the deck, one on each bank. lines, fords: as riverCrossings() took and gave
// them; the roads (lines[].km) and the bridges among the fords (dx, dy, sin, span) are changed in place.
export function squareBridges(lines, fords) {
  const by = new Map(); for (const f of fords) if (f.type === 'bridge') (by.get(f.line) || by.set(f.line, []).get(f.line)).push(f);
  for (const [li, list] of by) {
    const pts = lines[li].km, at = new Float64Array(pts.length); for (let i = 1; i < pts.length; i++) at[i] = at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    list.sort((p, q) => q.at - p.at);                                // from the far end: what lies before keeps its numbers
    let valid = pts.length - 1;                                      // the points before this number still stand where `at` says
    list.forEach((f, k) => {
      let nx = -f.ry, ny = f.rx; if (nx * f.dx + ny * f.dy < 0) { nx = -nx; ny = -ny; }
      const half = f.width / 2 + BRIDGE.abut; let R = Math.max(.18, f.width * 1.5 + .08);
      if (list[k + 1]) R = Math.min(R, (f.at - list[k + 1].at) / 2); if (list[k - 1]) R = Math.min(R, (list[k - 1].at - f.at) / 2);
      if (R < half) return;                                         // two bridges side by side: the road stays as it runs
      let i0 = 1; while (i0 < valid && at[i0] <= f.at - R) i0++;
      let i1 = i0 - 1; while (i1 + 1 < valid && at[i1 + 1] < f.at + R) i1++;
      pts.splice(i0, i1 - i0 + 1, [f.x - nx * half, f.y - ny * half], [f.x + nx * half, f.y + ny * half]); valid = i0;
      f.dx = nx; f.dy = ny; f.sin = 1; f.span = 2 * half; f.square = true;
    });
  }
  return fords;
}

// ---- settlements: an index of [{ x, y, r }] (flat km; r: the radius of the settlement), and a road cut at their edges
export function townIndex(list, cell = 4) {
  const grid = new Map(); let rmax = 0;
  for (const t of list) { if (!(t.r > 0)) continue; rmax = Math.max(rmax, t.r); const k = key(Math.floor(t.x / cell), Math.floor(t.y / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(t); }
  const span = Math.ceil((rmax + .5) / cell);
  // km from a point to the edge of the nearest settlement where a road stops: negative inside
  return (x, y) => {
    let best = 1e9; const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    for (let j = cj - span; j <= cj + span; j++) for (let i = ci - span; i <= ci + span; i++) for (const t of grid.get(key(i, j)) || []) best = Math.min(best, Math.hypot(x - t.x, y - t.y) - t.r * TOWN_EDGE);
    return best;
  };
}
// pts: a road as drawn, [[x, y] …]; outside: townIndex() (or a list of settlements)
// → the pieces of it that lie outside the settlements: [{ pts, fade: [0..1 for every point] }]; a piece fades out over
//   its last metres before the houses
export function cutAtTowns(pts, outside) {
  if (Array.isArray(outside)) outside = townIndex(outside);
  const P = [pts[0]], F = [], f = d => Math.max(0, Math.min(1, d / SOFT));
  let dPrev = outside(pts[0][0], pts[0][1]); F.push(f(dPrev));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), dCur = outside(b[0], b[1]);
    if (Math.min(dPrev, dCur) < len + SOFT) {                       // this stretch may reach the houses: look at it step by step
      const n = Math.min(24, Math.ceil(len / .025));
      for (let k = 1; k < n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n; P.push([x, y]); F.push(f(outside(x, y))); }
    }
    P.push(b); F.push(f(dCur)); dPrev = dCur;
  }
  const out = []; let cur = null;
  for (let i = 0; i < P.length; i++) {
    if (F[i] > 0) { if (!cur) { cur = { pts: [], fade: [] }; if (i) { cur.pts.push(P[i - 1]); cur.fade.push(0); } } cur.pts.push(P[i]); cur.fade.push(F[i]); }
    else if (cur) { cur.pts.push(P[i]); cur.fade.push(0); out.push(cur); cur = null; }
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

// km from a point to the nearest of the lines ([[x, y] …] each), for whoever must keep off the roads (a tree, a yard):
// an index over squares of `cell` km; 1e9 when no line is within `reach`
export function nearIndex(lines, cell = 2, reach = .3) {
  const segs = [], grid = new Map();
  for (const pts of lines) for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], id = segs.length / 4; segs.push(a[0], a[1], b[0], b[1]);
    for (let j = Math.floor((Math.min(a[1], b[1]) - reach) / cell); j <= Math.floor((Math.max(a[1], b[1]) + reach) / cell); j++)
      for (let i2 = Math.floor((Math.min(a[0], b[0]) - reach) / cell); i2 <= Math.floor((Math.max(a[0], b[0]) + reach) / cell); i2++) { const k = key(i2, j); (grid.get(k) || grid.set(k, []).get(k)).push(id); }
  }
  return (x, y) => {
    let best = 1e9;
    for (const id of grid.get(key(Math.floor(x / cell), Math.floor(y / cell))) || []) {
      const o = id * 4, ax = segs[o], ay = segs[o + 1], dx = segs[o + 2] - ax, dy = segs[o + 3] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return best <= reach ? best : 1e9;
  };
}
