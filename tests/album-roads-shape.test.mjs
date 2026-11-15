// The shape of a road in the mountains (src/album/roads/shape.js): a leg that climbs is laid once more with a step of
// 200 m — on the floor of its valley, off the water, with the bends of a mountain road (the lead, 14.11.2026: «идёт
// дном долины, на подъём — с поворотами, а не прямой чертой по склону»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { KN, KKM, KX0, KY0 } from '../src/album/division/km.js';
import { Heap } from '../src/album/division/graph.js';
import { llOf, kmOf } from '../src/album/chunks.js';
import { FINE, FW, DIRS, cellOf, cellXY, fineRivers, climbs, fineWay, fineSteps, thin, dense, fineCover } from '../src/album/roads/shape.js';
import { hugBanks, BANK } from '../src/album/roads/banks.js';

const X0 = KX0, Y0 = KY0, F = FINE.step, K = Math.round(KKM / F);
// a piece of made-up ground: chunks with the heights of `height(x, y)` (metres at a point of the flat km plane)
function ground(height, riverChunks = []) {
  const n = KN * KN, G = { land: new Uint8Array(n).fill(1), hgt: new Float32Array(n), riv: new Uint8Array(n), g: new Float64Array(n), mark: new Int32Array(n), done: new Int32Array(n), from: new Int32Array(n), stamp: 0, heap: new Heap(1 << 12) };
  for (let ty = 380; ty < 460; ty++) for (let tx = 380; tx < 460; tx++) G.hgt[ty * KN + tx] = height(X0 + tx + .5, Y0 + ty + .5);
  for (const t of riverChunks) G.riv[t] = 1;
  return G;
}
const chunk = (x, y) => Math.floor(y - Y0) * KN + Math.floor(x - X0);
const lengthOf = cells => { let s = 0; for (let k = 1; k < cells.length; k++) { const a = cellXY(cells[k - 1]), b = cellXY(cells[k]); s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; };
const AX = X0 + 420.5, AY = Y0 + 400.5;                         // the middle of a chunk in the made-up ground

test('roads, shape: a line is thinned for drawing — the points on a straight go, the corners and the ends stay', () => {
  const line = []; for (let k = 0; k <= 20; k++) line.push([k * .2, 0]); for (let k = 1; k <= 20; k++) line.push([4, k * .2]);
  const t = thin(line);
  assert.deepEqual(t, [[0, 0], [4, 0], [4, 4]]);
  assert.deepEqual(thin([[0, 0], [1, 1]]), [[0, 0], [1, 1]]); assert.deepEqual(thin([[0, 0]]), [[0, 0]]);
  // a bend smaller than the tolerance goes, a larger one stays
  assert.equal(thin([[0, 0], [1, FINE.thin * .5], [2, 0]]).length, 2); assert.equal(thin([[0, 0], [1, FINE.thin * 2], [2, 0]]).length, 3);
  // a hairpin is kept whole
  const pin = [[0, 0], [1, 0], [1.1, .1], [1, .2], [0, .2]]; assert.equal(thin(pin).length, 5);
});

test('roads, shape: the fine cells and their sixteen steps', () => {
  assert.equal(K, 5); assert.equal(FW, KN * K); assert.equal(DIRS.length, 16);
  const c = cellOf(AX, AY), [x, y] = cellXY(c); assert.ok(Math.abs(x - AX) <= F / 2 + 1e-9 && Math.abs(y - AY) <= F / 2 + 1e-9);
  // the steps go round the circle in the order of their bearing, a sixteenth at a time more or less, and each has its opposite
  for (let d = 0; d < 16; d++) {
    const a = Math.atan2(DIRS[d][1], DIRS[d][0]), b = Math.atan2(DIRS[(d + 1) & 15][1], DIRS[(d + 1) & 15][0]), turn = ((b - a) * 180 / Math.PI + 360) % 360;
    assert.ok(turn > 15 && turn < 30, 'step ' + d + ' turns ' + turn.toFixed(1));
    assert.ok(DIRS[(d + 8) & 15][0] === -DIRS[d][0] && DIRS[(d + 8) & 15][1] === -DIRS[d][1]);
  }
  // the steps of a way for the file and back
  const way = [c]; for (const d of [0, 1, 2, 5, 9, 15, 15, 8]) way.push(way[way.length - 1] + DIRS[d][0] + DIRS[d][1] * FW);
  assert.deepEqual(Array.from(fineSteps(Int32Array.from(way))), [0, 1, 2, 5, 9, 15, 15, 8]);
});

test('roads, shape: the real course of a river on the fine cells — no way through between two of its cells', () => {
  const ll = (x, y) => { const p = llOf(x, y); return [p.lon, p.lat]; };
  const course = (pts, w) => ({ n: pts.length, ll: Float32Array.from(pts.flatMap(p => ll(p[0], p[1]))), w: Float32Array.from(pts.map(() => w)) });
  const diag = course([[AX, AY], [AX + 6, AY + 4.3]], .03), brook = course([[AX, AY + 10], [AX + 6, AY + 10]], .002);
  const bits = fineRivers({ rivers: [diag, brook] }), isRiver = c => { const i = c % FW, j = Math.floor(c / FW), t = Math.floor(j / K) * KN + Math.floor(i / K); return (bits[t] >> ((j % K) * K + (i % K))) & 1; };
  assert.ok(isRiver(cellOf(AX, AY)) && isRiver(cellOf(AX + 3, AY + 2.15)) && isRiver(cellOf(AX + 6, AY + 4.3)));
  assert.ok(!isRiver(cellOf(AX + 3, AY + 3.5)) && !isRiver(cellOf(AX + 3, AY + 10)), 'water narrower than a ford is no river');
  // walk the cells of the course: each next one shares a side with the one before
  let cells = []; for (let k = 0; k <= 600; k++) { const c = cellOf(AX + 6 * k / 600, AY + 4.3 * k / 600); if (cells[cells.length - 1] !== c) cells.push(c); }
  const marked = new Set(); for (let j = Math.floor((AY - Y0) / F) - 2; j < Math.floor((AY + 4.3 - Y0) / F) + 3; j++) for (let i = Math.floor((AX - X0) / F) - 2; i < Math.floor((AX + 6 - X0) / F) + 3; i++) if (isRiver(j * FW + i)) marked.add(j * FW + i);
  for (const c of cells) assert.ok(marked.has(c) || [1, -1, FW, -FW].some(d => marked.has(c + d)), 'the cells the course runs through are marked (a corner it only clips may be left)');
  // from any cell of the river another one is reached by a side step, never only by a corner
  for (const c of marked) { const side = [1, -1, FW, -FW].some(d => marked.has(c + d)); assert.ok(side || marked.size === 1); }
  // a great river marks the cells its water covers
  const wide = fineRivers({ rivers: [course([[AX, AY], [AX + 4, AY]], .9)] }), on = c => { const i = c % FW, j = Math.floor(c / FW), t = Math.floor(j / K) * KN + Math.floor(i / K); return (wide[t] >> ((j % K) * K + (i % K))) & 1; };
  assert.ok(on(cellOf(AX + 2, AY + .35)) && on(cellOf(AX + 2, AY - .35)) && !on(cellOf(AX + 2, AY + .9)));
});

test('roads, shape: which leg climbs', () => {
  const flat = ground(() => 400), G = ground((x, y) => 400 + (x - AX) * 100), row = n => Array.from({ length: n }, (_, k) => chunk(AX + k, AY));
  assert.equal(climbs(flat, row(12)), false);
  assert.equal(climbs(G, row(2)), true, 'a step of 100 m in a km');
  const gentle = ground((x, y) => 400 + (x - AX) * 40); assert.equal(climbs(gentle, row(5)), false); assert.equal(climbs(gentle, row(10)), true, 'the top stands ' + FINE.range + ' m over the foot');
});

test('roads, shape: on a slope steeper than it likes a road goes aslant and turns back; a track climbs straighter', () => {
  // a slope of 25 % facing south, 2 km of it between two level grounds
  const height = (x, y) => 500 + Math.max(0, Math.min(2, y - AY)) * 250, G = ground(height), at = (x, y) => height(x, y);
  const path = [0, 1, 2, 3].map(k => chunk(AX, AY - .5 + k)), ends = [[AX, AY - .4], [AX, AY + 2.4]];
  const grades = way => { const g = []; for (let k = 1; k < way.length; k++) { const a = cellXY(way[k - 1]), b = cellXY(way[k]); g.push(Math.abs(height(...b) - height(...a)) / (Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000)); } return g; };
  const main = fineWay(G, path, ends, 0, at), track = fineWay(G, path, ends, 2, at);
  assert.ok(main && track); assert.equal(main[0], cellOf(...ends[0])); assert.equal(main[main.length - 1], cellOf(...ends[1]));
  const lm = lengthOf(main), lt = lengthOf(track);
  assert.ok(lm > 4.5, 'the main road makes 500 m of height in ' + lm.toFixed(1) + ' km, not in the 2.8 km of the straight');
  assert.ok(lt < lm * .75 && lt >= 2.8, 'the track is shorter: ' + lt.toFixed(1) + ' km');
  for (const [way, kind] of [[main, 0], [track, 2]]) { const g = grades(way), steep = g.filter(v => v > FINE.grade[kind] * 1.25).length; assert.ok(steep <= g.length * .1, 'kind ' + kind + ': ' + steep + ' of ' + g.length + ' steps steeper than it likes'); }
  // it turns back at least once, and does not wriggle: few turns for its length
  const turns = way => { let n = 0, last = -1; for (const d of fineSteps(way)) { if (last >= 0 && d !== last) n++; last = d; } return n; };
  const xs = Array.from(main, c => cellXY(c)[0]); assert.ok(Math.max(...xs) - Math.min(...xs) > .8 && Math.max(...xs) - Math.min(...xs) <= 2 * FINE.wide + 1.2, 'it swings across the slope, inside its strip');
  assert.ok(turns(main) < main.length * .5, turns(main) + ' turns in ' + main.length + ' steps');
  // every step is one of the sixteen, the same land gives the same way
  assert.ok(fineSteps(main).every(d => d < 16) && fineSteps(track).every(d => d < 16));
  assert.deepEqual(Array.from(fineWay(G, path, ends, 0, at)), Array.from(main));
  // on level ground the fine way is the straight
  const flat = ground(() => 300), level = fineWay(flat, path, ends, 0, () => 300); assert.ok(lengthOf(level) < 2.95 && turns(level) <= 2);
});

test('roads, shape: in a valley the road keeps to the floor, a step off the water, and crosses the river no more than it must', () => {
  // a valley running north: its floor at x = AX, the sides rise 30 % each way; the floor climbs 2 % to the north. The river runs down the middle
  const height = (x, y) => 400 + Math.abs(x - AX) * 300 + (y - AY) * 20, ll = (x, y) => { const p = llOf(x, y); return [p.lon, p.lat]; };
  const pts = Array.from({ length: 81 }, (_, k) => [AX + .25 * Math.sin(k / 3), AY - 2 + k * .25]), course = { n: pts.length, ll: Float32Array.from(pts.flatMap(p => ll(p[0], p[1]))), w: Float32Array.from(pts.map(() => .02)) };
  const rivers = fineRivers({ rivers: [course] }), G = ground(height, Array.from({ length: 20 }, (_, k) => chunk(AX, AY - 2 + k)));
  // the way chunk by chunk ran on the eastern side, a km from the river (a chunk with a river in it is dear to walk along)
  const path = Array.from({ length: 13 }, (_, k) => chunk(AX + 1, AY + k)), ends = [[AX + .5, AY], [AX + .5, AY + 12]];
  const way = fineWay(G, path, ends, 0, (x, y) => height(x, y), rivers);
  assert.ok(way);
  const isRiver = c => { const i = c % FW, j = Math.floor(c / FW), t = Math.floor(j / K) * KN + Math.floor(i / K); return (rivers[t] >> ((j % K) * K + (i % K))) & 1; };
  const mid = Array.from(way).filter(c => { const y = cellXY(c)[1]; return y > AY + 2 && y < AY + 10; }), off = mid.map(c => Math.abs(cellXY(c)[0] - AX));
  assert.ok(Math.max(...off) < .75, 'between its ends the road is on the floor of the valley: no farther than ' + Math.max(...off).toFixed(2) + ' km from its middle');
  let wet = 0, crossings = 0, was = 0; for (const c of way) { const r = isRiver(c); if (r) wet++; if (r && !was) crossings++; was = r; }
  assert.ok(crossings <= 1 && wet <= 3, crossings + ' crossings, ' + wet + ' steps in the water');
  // without the real courses a chunk with a river is all water: the road stays out of those chunks
  const coarse = fineWay(G, path, ends, 0, (x, y) => height(x, y), null); assert.ok(coarse && Array.from(coarse).every(c => G.riv[Math.floor(Math.floor(c / FW) / K) * KN + Math.floor((c % FW) / K)] === 0));
});

test('roads, shape: a way is led through every point given, never leaves the land or its strip', () => {
  const height = (x, y) => 600 + 300 * Math.sin((x - AX) / 2) * Math.cos((y - AY) / 3), G = ground(height);
  const path = Array.from({ length: 11 }, (_, k) => chunk(AX + k, AY + Math.round(k / 2))), P = [AX + 5.3, AY + 3.4], ends = [[AX + .1, AY - .2], P, [AX + 10.2, AY + 5.1]];
  const way = fineWay(G, path, ends, 1, (x, y) => height(x, y));
  assert.ok(way && way[0] === cellOf(...ends[0]) && way[way.length - 1] === cellOf(...ends[2]) && Array.from(way).includes(cellOf(...P)));
  for (const c of way) { const [x, y] = cellXY(c); assert.ok(path.some(t => Math.hypot(X0 + t % KN + .5 - x, Y0 + Math.floor(t / KN) + .5 - y) <= FINE.wide + F), 'inside the strip'); }
  // water in the way: no fine way through it — the leg keeps its way chunk by chunk
  const sea = ground(height); for (let k = -3; k <= 8; k++) sea.land[chunk(AX + 5, AY + k)] = 0;
  assert.equal(fineWay(sea, path, ends, 1, (x, y) => height(x, y)), null);
  // a point outside the strip of the leg: no way
  assert.equal(fineWay(G, path, [[AX, AY], [AX + 40, AY + 40]], 1, (x, y) => height(x, y)), null);
});

test('roads, shape: over fine ground a line gets a corner every 120 m at most — and is the same line', () => {
  const line = [[0, 0], [.35, 0], [.7, 0], [1.05, .1], [1.4, .1], [1.75, .1]], step = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  assert.deepEqual(dense(line, () => false), line, 'no fine ground: the line as it was');
  const all = dense(line, () => true);
  assert.equal(all.length, 1 + 3 + 3 + 4 + 3 + 3, 'a stretch of 350 m in three, the slanted one of 364 m in four');
  for (let i = 1; i < all.length; i++) assert.ok(step(all[i - 1], all[i]) <= FINE.drape + 1e-9);
  for (const p of line) assert.ok(all.some(q => q[0] === p[0] && q[1] === p[1]), 'every corner of the line stays');
  assert.deepEqual(thin(all, 1e-6), thin(line, 1e-6), 'the new corners lie on the line');
  // fine ground east of x = 1 only: the stretches with an end on it
  const part = dense(line, x => x > 1);
  assert.equal(part.length, 3 + 4 + 3 + 3); assert.deepEqual(part.slice(0, 3), line.slice(0, 3));
  assert.deepEqual(dense([[1, 2]], () => true), [[1, 2]]); assert.deepEqual(dense([], () => true), []);
  // where there is fine ground: the tiles of meta.json (Web-Mercator, level 11 — a tile of the Somport here)
  const tileOf = (lat, lon) => { const r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * 2048), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2048)]; };
  const cover = fineCover({ z: 11, tiles: [tileOf(42.795, -.527)] }), at = (lat, lon) => cover(...kmOf(lat, lon));
  assert.equal(at(42.795, -.527), true); assert.equal(at(42.80, -.50), true); assert.equal(at(42.795, -.20), false); assert.equal(at(42.50, -.527), false);
  assert.equal(fineCover(null), null); assert.equal(fineCover({ z: 11, tiles: [] }), null);
  // a line that enters the tile is made finer from its last corner outside it on
  const [x0, y0] = kmOf(42.795, -.527), row = Array.from({ length: 40 }, (_, k) => [x0 - 5 + k * .35, y0]), drawn = dense(row, cover);
  const inside = row.filter(p => cover(p[0], p[1])).length; assert.ok(inside > 10 && inside < 38 && drawn.length >= row.length + 2 * (inside - 1) && drawn.length <= row.length + 2 * (inside + 1), row.length + ' → ' + drawn.length);
});

test('roads, shape: a road along a river in a gorge lies on its bank — the same bank all the way; in a wide level valley nothing moves', () => {
  // a river down the line y = 0 of the flat km plane, 20 m wide, a point every 50 m
  const [lat0, lon0] = [42.7, -.5], [x0, y0] = kmOf(lat0, lon0), N = 201, ll = new Float64Array(N * 2), w = new Float32Array(N).fill(.02);
  for (let n = 0; n < N; n++) { const g = llOf(x0 + n * .05, y0 + .03 * Math.sin(n * .05 / 1.2)); ll[n * 2] = g.lon; ll[n * 2 + 1] = g.lat; }
  const courses = { rivers: [{ n: N, ll, w }] }, mid = x => y0 + .03 * Math.sin((x - x0) / 1.2);
  const gorge = (x, y) => 500 + Math.abs(y - mid(x)) * 400, level = () => 500;                    // walls of 40 %; a level floor
  const road = off => { const p = []; for (let x = x0; x <= x0 + 10 + 1e-9; x += .35) p.push([x, mid(x) + off(x - x0)]); return p; };
  // in the gorge: the road ran 200 m up the wall, now it is on the bank, a few metres over the water
  { const lines = [{ km: road(() => .2) }], st = hugBanks(lines, courses, gorge), P = lines[0].km;
    assert.ok(st.stretches === 1 && st.km >= 8 && st.over === 0, JSON.stringify(st));
    const inner = P.filter(q => q[0] > x0 + 1.2 && q[0] < x0 + 8.8); assert.ok(inner.length > 80, inner.length + ' corners');
    for (const q of inner) { const d = q[1] - mid(q[0]); assert.ok(d > .02 && d < .045 && q.bank && q.bank[2] > .019 && Math.abs(q.bank[3] - (.01 + BANK.clear)) < 1e-6 && q.bank[1] > .9, 'on the bank it was over: ' + d.toFixed(3)); }
    assert.ok(Math.max(...inner.map(q => gorge(q[0], q[1]) - 500)) < 20, 'a few metres over the water');
    assert.deepEqual(P[0], [x0, mid(x0) + .2]); assert.ok(Math.abs(P[P.length - 1][1] - mid(P[P.length - 1][0]) - .2) < 1e-9, 'the ends of the road stay');
    for (let k = 1; k < P.length; k++) assert.ok(P[k][0] > P[k - 1][0] - 1e-9 && Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]) < .4, 'the road runs on, without a jump'); }
  // a stretch of 700 m on the other bank comes over: the road does not cross and cross back
  { const lines = [{ km: road(s => (s > 4 && s < 4.75 ? -.2 : .2)) }], st = hugBanks(lines, courses, gorge);
    assert.ok(st.over === 1 && lines[0].km.filter(q => q[0] > x0 + 1.2 && q[0] < x0 + 8.8).every(q => q[1] > mid(q[0])), JSON.stringify(st)); }
  // … but a road that goes over to the other bank for good does cross, once
  { const lines = [{ km: road(s => (s > 5 ? -.2 : .2)) }]; hugBanks(lines, courses, gorge); let flips = 0, last = 0;
    for (const q of lines[0].km) { if (!q.bank) continue; const sd = Math.sign(q[1] - mid(q[0])); if (last && sd !== last) flips++; last = sd; } assert.equal(flips, 1); }
  // a wide level valley: the road is on its floor already and stays where it is; so does a road that only crosses the river
  { const lines = [{ km: road(() => .2) }], was = JSON.stringify(lines[0].km), st = hugBanks(lines, courses, level); assert.equal(st.stretches, 0); assert.equal(JSON.stringify(lines[0].km), was); }
  { const across = []; for (let y = -3; y <= 3 + 1e-9; y += .35) across.push([x0 + 5, y0 + y]); const lines = [{ km: across }], st = hugBanks(lines, courses, gorge); assert.equal(st.stretches, 0); assert.equal(lines[0].km.length, across.length); }
  // a road nearer to the water than its bank is moved out of it, level ground or not
  { const lines = [{ km: road(() => .005) }], st = hugBanks(lines, courses, level); assert.ok(st.stretches === 1 && lines[0].km.filter(q => q.bank).every(q => q[1] - mid(q[0]) > .012), JSON.stringify(st)); }
  assert.ok(BANK.reach > .28 && BANK.clear > .01 && BANK.rise[0] < BANK.rise[1] && BANK.min >= 3);
});
