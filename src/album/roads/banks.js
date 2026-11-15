// A road in a gorge lies on its floor, by the river (the owner, 15.11.2026, at the Somport: «здесь дорога идёт по
// ущелью, надо показать это как-нибудь аккуратно, совместить дорогу с ущельем, потому что сейчас она просто поверх
// скал идёт»; «главная дорога здесь идёт по реке»; «некоторые дороги, которые рядом с реками через ущелье идут, очень
// криво сделаны»).
//   • A road is laid over cells of 200 m (roads/shape.js) and keeps a cell off the water. In a wide valley that is
//     the floor of the valley. In a gorge a cell beside the river is already its wall, and the road was drawn across
//     the rocks, a hundred metres over the water.
//   • So where a road runs ALONG a river — nearer than BANK.reach, the same way, for a kilometre or more — and the
//     ground under it stands over the river, that stretch is laid anew as the BANK of that river: the course of the
//     river itself, moved aside by half the water and a few metres. Road and river run side by side, bend for bend.
//   • The road keeps to the bank it was on. A short stretch on the other bank, between two on this one, comes over
//     to this bank: a road does not cross and cross back.
//   • Where the valley is wide and level, nothing is moved: the road is on its floor already.
// Plain JavaScript without the GPU: the same roads and rivers always give the same banks. Everything is in flat km.
import { kmOf } from '../chunks.js';

export const BANK = {
  reach: .32,                        // km: a road this near a river, running the same way, is a road along that river
  along: .64,                        // … the same way: the cosine of the angle between the two is at least this (50°)
  min: 3,                            // … for at least this many corners of the road on end
  clear: .02,                        // km from the edge of the water to the middle of a road on the bank
  rise: [5, 20],                     // metres the ground under the road stands over the river: not pulled to the bank … pulled wholly
  least: .3,                         // a stretch is laid along the bank where that pull is at least this
  step: .07,                         // km between the corners of a road on a bank
  weave: 1.2,                        // km: a shorter stretch on the other bank comes over to this one
  minW: .004,                        // km: water narrower than this is not followed
};
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CELL = .5, key = (i, j) => i * 100003 + j;

// lines: [{ km: [[x, y] …] }] — the roads as they are drawn, changed in place; courses: decodeCourses() of
// water/courses.js; heightAt(x, y) → metres at a point of the flat km plane.
// A corner of a road on a bank carries `bank`: [nx, ny (a unit vector, away from the river), the width of the water
// km, how far the corner lies from the middle of the river km] — for whoever draws a river wider than life and must
// move the road aside with it (layers/ribbon.js).
// → { stretches, km (of road on banks), over (how many stretches came over to the other bank) }
export function hugBanks(lines, courses, heightAt, B = BANK) {
  const stats = { stretches: 0, km: 0, over: 0 };
  // ---- every corner of every road, in squares of CELL km
  const grid = new Map(), start = []; let total = 0;
  lines.forEach((l, li) => { start.push(total); for (let i = 0; i < l.km.length; i++) { const k = key(Math.floor(l.km[i][0] / CELL), Math.floor(l.km[i][1] / CELL)); (grid.get(k) || grid.set(k, []).get(k)).push(total + i); } total += l.km.length; });
  if (!total) return stats;
  const lineOf = new Int32Array(total); lines.forEach((l, li) => lineOf.fill(li, start[li], start[li] + l.km.length));
  // ---- the nearest point of a river to each of them: how far, which river, where along it (segment + share)
  const far = new Float32Array(total).fill(Infinity), riv = new Int32Array(total).fill(-1), at = new Float64Array(total), xy = [];
  courses.rivers.forEach((r, ri) => {
    const p = new Float64Array(r.n * 2); xy.push(p);
    for (let n = 0; n < r.n; n++) { const q = kmOf(r.ll[n * 2 + 1], r.ll[n * 2]); p[n * 2] = q[0]; p[n * 2 + 1] = q[1]; }
    for (let n = 1; n < r.n; n++) {
      if (Math.max(r.w[n], r.w[n - 1]) < B.minW) continue;
      const ax = p[n * 2 - 2], ay = p[n * 2 - 1], dx = p[n * 2] - ax, dy = p[n * 2 + 1] - ay, len2 = dx * dx + dy * dy || 1e-12;
      for (let j = Math.floor((Math.min(ay, ay + dy) - B.reach) / CELL); j <= Math.floor((Math.max(ay, ay + dy) + B.reach) / CELL); j++)
        for (let i = Math.floor((Math.min(ax, ax + dx) - B.reach) / CELL); i <= Math.floor((Math.max(ax, ax + dx) + B.reach) / CELL); i++) {
          const list = grid.get(key(i, j)); if (!list) continue;
          for (const id of list) { const q = lines[lineOf[id]].km[id - start[lineOf[id]]], t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / len2)), d = Math.hypot(q[0] - ax - dx * t, q[1] - ay - dy * t);
            if (d < far[id]) { far[id] = d; riv[id] = ri; at[id] = n - 1 + t; } }
        }
    }
  });
  // a point of a river by its place along it: [x, y, the way it runs (a unit vector, over a few points), width]
  const onRiver = (ri, s) => {
    const r = courses.rivers[ri], p = xy[ri], n = Math.max(0, Math.min(r.n - 2, Math.floor(s))), t = Math.max(0, Math.min(1, s - n)), a = Math.max(0, n - 1), b = Math.min(r.n - 1, n + 2);
    let dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    return [p[n * 2] + (p[n * 2 + 2] - p[n * 2]) * t, p[n * 2 + 1] + (p[n * 2 + 3] - p[n * 2 + 1]) * t, dx, dy, r.w[n] + (r.w[n + 1] - r.w[n]) * t];
  };
  lines.forEach((l, li) => {
    const P = l.km, n = P.length, o = start[li]; if (n < B.min + 2) return;
    // ---- which corners run along a river over ground that stands above it: pull 0..1, the side of the river (+1 its left bank)
    const pull = new Float32Array(n), side = new Int8Array(n), along = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) {
      along[i] = along[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (!(far[o + i] <= B.reach)) continue;
      const q = onRiver(riv[o + i], at[o + i]); let dx = P[i + 1][0] - P[i - 1][0], dy = P[i + 1][1] - P[i - 1][1]; const len = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx * q[2] + dy * q[3]) / len < B.along) continue;
      side[i] = q[2] * (P[i][1] - q[1]) - q[3] * (P[i][0] - q[0]) >= 0 ? 1 : -1;
      pull[i] = far[o + i] < q[4] / 2 + B.clear ? 1 : ss(B.rise[0], B.rise[1], heightAt(P[i][0], P[i][1]) - heightAt(q[0], q[1]));
    }
    along[n - 1] = along[n - 2] + Math.hypot(P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]);
    const on = i => pull[i] >= B.least;
    for (let i = 2; i < n - 2; i++) if (!on(i) && on(i - 1) && on(i + 1) && riv[o + i - 1] === riv[o + i + 1] && far[o + i] <= B.reach && riv[o + i] === riv[o + i - 1]) { pull[i] = (pull[i - 1] + pull[i + 1]) / 2; side[i] = side[i] || side[i - 1]; }   // a corner between two such corners is one of them
    // ---- the stretches: corners on end by one river, the place along it moving one way; from the far end of the road, so that the numbers before stay
    const runs = [];
    for (let i = 1; i < n - 1; i++) {
      if (!on(i)) continue; let j = i, dir = 0;
      while (j + 1 < n - 1 && on(j + 1) && riv[o + j + 1] === riv[o + i]) { const d = Math.sign(at[o + j + 1] - at[o + j]); if (d && dir && d !== dir) break; if (d) dir = d; j++; }
      if (j - i + 1 >= B.min) runs.push([i, j]); i = j;
    }
    for (const [a, b] of runs.reverse()) {
      const ri = riv[o + a], r = courses.rivers[ri];
      // a short stretch on the other bank, between two on this one, comes over
      for (let c = a; c <= b;) { let d = c; while (d < b && side[d + 1] === side[c]) d++;
        if (c > a && d < b && side[c - 1] === side[d + 1] && along[d] - along[c] < B.weave) { for (let k = c; k <= d; k++) { side[k] = side[c - 1]; pull[k] = 2; } stats.over++; }
        c = d + 1; }
      // how far from the middle of the river each corner of the stretch is to lie: at the ends of the stretch the road comes to the bank gently
      const want = new Float32Array(b - a + 1);
      for (let i = a; i <= b; i++) { const w = onRiver(ri, at[o + i])[4], tgt = w / 2 + B.clear, d = far[o + i], k = pull[i] > 1 ? 1 : Math.min(1, pull[i]) * Math.min(1, (i - a + 1) / 2, (b - i + 1) / 2); want[i - a] = pull[i] > 1 || d < tgt ? tgt : d + (tgt - d) * k; }
      // the bank: the course of the river from corner to corner, moved aside
      const out = [];
      for (let i = a; i < b; i++) {
        const s0 = at[o + i], s1 = at[o + i + 1], w0 = want[i - a], w1 = want[i + 1 - a], stops = [s0];
        if (s1 > s0) for (let v = Math.floor(s0) + 1; v < s1; v++) stops.push(v); else for (let v = Math.ceil(s0) - 1; v > s1; v--) stops.push(v);
        if (side[i] !== side[i + 1]) { stops.length = 1; }               // the road changes its bank here: straight across, from this corner to the next
        for (const s of stops) { const q = onRiver(ri, s), t = s1 === s0 ? 0 : (s - s0) / (s1 - s0), off = w0 + (w1 - w0) * t, sg = side[i], nx = -q[3] * sg, ny = q[2] * sg, pt = [q[0] + nx * off, q[1] + ny * off]; pt.bank = [nx, ny, q[4], off]; out.push(pt); }
      }
      { const q = onRiver(ri, at[o + b]), sg = side[b], nx = -q[3] * sg, ny = q[2] * sg, pt = [q[0] + nx * want[b - a], q[1] + ny * want[b - a]]; pt.bank = [nx, ny, q[4], want[b - a]]; out.push(pt); }
      // a corner every BANK.step or so; a corner that would run back along the road (the inside of a sharp bend) is dropped
      const kept = [out[0]]; let dx0 = P[a][0] - P[a - 1][0], dy0 = P[a][1] - P[a - 1][1];
      for (let k = 1; k < out.length; k++) {
        const last = kept[kept.length - 1], dx = out[k][0] - last[0], dy = out[k][1] - last[1], len = Math.hypot(dx, dy);
        if (k < out.length - 1 && (len < B.step * .5 || dx * dx0 + dy * dy0 < 0)) continue;
        for (let m = 1, mm = Math.floor(len / (B.step * 1.5)); m <= mm; m++) { const t = m / (mm + 1), pt = [last[0] + dx * t, last[1] + dy * t]; pt.bank = out[k].bank; kept.push(pt); }
        kept.push(out[k]); dx0 = dx; dy0 = dy;
      }
      for (let k = 1; k < kept.length; k++) stats.km += Math.hypot(kept[k][0] - kept[k - 1][0], kept[k][1] - kept[k - 1][1]);
      P.splice(a, b - a + 1, ...kept); stats.stretches++;
    }
  });
  stats.km = Math.round(stats.km);
  return stats;
}
