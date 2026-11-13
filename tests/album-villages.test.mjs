// The villages between the centres of districts (src/album/town/villages.js, docs/album/settle.md): the list of
// places of a district, the villages the model of growth founds on them, their patches in the fine grid of the
// settlement texture. On made-up land, and on the album's real data when public/album-data/ is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { KN, KX0, KY0, squareOf, kmFacts, kmData } from '../src/album/division/km.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { decodeSites } from '../src/album/town/sites.js';
import { GN, GK, GX0, GY0, VN, VK, TEX_W, TEX_H, FINE_AT, COARSE_AT, VILLAGE_RMAX, TOWN_R, CULTURES, STAGES, cellSize, radiusByte, radiusOf, fineOf, fineBytes, villageLobe, fieldsBeyond, peopleOf, classOf, RULES_GLSL } from '../src/album/town/rules.js';
import { districtSites, villagePlaces, siteNumbers, madeAllowed, SITE, PER, DENSE, GAP, NEAR, MOST, MADE_R, MADE_POP, GOOD, TOO_HIGH, SWAMP } from '../src/album/town/villages.js';
import { growTowns, centrePlaces, fullRadius, FIELD_FLOOR, KEEP_OFF } from '../src/album/town/grow.js';
import { mirrorSettle, mirrorVillages, packAtlas, settleBytes, atlasBytes, villageBytes, settleTex } from '../src/album/town/state.js';
import { planLobe, ROW } from '../src/album/town/plan.js';
import { patchIndex, ploughed } from '../src/album/town/yards.js';
import { landOfAlbum, packLand, unpackLand, MAX_IN_DISTRICT } from '../src/album/save/land.js';
import settle from '../src/album/aspects/settle.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- a made-up division on the lattice of chunks: two land districts of 20 × 20 km side by side, the sea around.
// District 0 is level ground. District 1 is rolling ground with a river down its column 625 and mountains east of
// column 630.
const I0 = 600, J0 = 600, D = 20;
function madeDiv() {
  const n = KN * KN, cells = new Int32Array(n).fill(2), hgt = new Float32Array(n), riv = new Uint8Array(n), cls = new Uint8Array(n);
  for (let j = J0; j < J0 + D; j++) for (let i = I0; i < I0 + 2 * D; i++) {
    const c = j * KN + i, d = i < I0 + D ? 0 : 1; cells[c] = d; hgt[c] = d ? 400 + (i - I0 - D) * 30 : 200;
    cls[c] = d === 0 ? 1 : i >= I0 + 30 ? 5 : 2; if (i === I0 + 25) riv[c] = 2;
  }
  const x = k => KX0 + k + .5, y = k => KY0 + k + .5;
  const div = { count: 3, cells, kinds: [0, 0, 1], raster: { hgt, riv },
    centres: { x: Float64Array.of(x(I0 + 10), x(I0 + 24), NaN), y: Float64Array.of(y(J0 + 10), y(J0 + 10), NaN), site: Int32Array.of(0, -1, -1), texel: Int32Array.of((J0 + 10) * KN + I0 + 10, (J0 + 10) * KN + I0 + 24, -1) } };
  return { div, facts: { cls }, x, y };
}
const within = (list, d) => Array.from({ length: list.first[d + 1] - list.first[d] }, (_, k) => list.first[d] + k);

test('villages: a district has its list of places — the centre, the real places, then the best free ground', () => {
  const { div, facts, x, y } = madeDiv();
  const sites = [
    { x: x(I0 + 10), y: y(J0 + 10), pop: 40000, name: 'Центр' },        // the centre of district 0
    { x: x(I0 + 4), y: y(J0 + 4), pop: 900, name: 'Малое' },
    { x: x(I0 + 15), y: y(J0 + 5), pop: 6000, name: 'Большое' },
    { x: x(I0 + 15) + .6, y: y(J0 + 5), pop: 700, name: 'Выселки' },     // 600 m from a greater place: the same settlement
    { x: x(I0 - 30), y: y(J0 + 5), pop: 5000, name: 'В море' },
  ];
  const list = districtSites(div, facts, sites);
  assert.equal(list.count, 3); assert.equal(list.first[0], 0); assert.equal(list.first[3], list.x.length); assert.equal(list.first[3], list.first[2], 'the sea has no places');
  // district 0: the centre first, then the real places in the order of the list given (the most important first)
  const a = within(list, 0);
  assert.deepEqual(a.slice(0, 3).map(s => [list.kind[s], list.src[s]]), [[SITE.centre, 0], [SITE.real, 1], [SITE.real, 2]]);
  assert.equal(list.real[0], 2); assert.ok(a.slice(3).every(s => list.kind[s] === SITE.made && list.src[s] === -1));
  assert.ok(!a.some(s => list.src[s] === 3) && !list.src.includes(4), 'a place beside a greater one, and a place in the sea, are not in the list');
  // the made places: as many as the good ground of the district allows at the greatest density
  assert.equal(list.good[0], D * D * GOOD[1]); assert.equal(madeAllowed(list, 0, 1), Math.round(D * D / PER) - 2); assert.equal(a.length - 3, Math.round(DENSE * D * D / PER) - 2);
  assert.ok(Math.abs(list.good[1] - 10 * D * GOOD[2]) < 1e-3, 'mountains are no good ground: ' + list.good[1]);
  const b = within(list, 1);
  assert.deepEqual([list.kind[b[0]], list.src[b[0]]], [SITE.centre, -1]); assert.equal(b.length - 1, Math.round(DENSE * list.good[1] / PER));
  for (const d of [0, 1]) for (const s of within(list, d)) {
    const c = squareOf(list.x[s], list.y[s]); assert.equal(div.cells[c], d, 'a place stands in its own district');
    if (list.kind[s] !== SITE.made) continue;
    assert.equal(list.chunk[s], c); assert.ok(facts.cls[c] >= 1 && facts.cls[c] <= 4, 'never where nobody can live');
    assert.ok(list.size[s] <= MADE_R[0] + 1e-6 && list.size[s] >= MADE_R[1] - 1e-6);
  }
  // no two places in one square of the fine grid, and a made place keeps its distance from every other
  const all = [...within(list, 0), ...within(list, 1)], squares = new Set(all.map(s => fineOf(list.x[s], list.y[s]))); assert.equal(squares.size, all.length);
  for (const s of all) if (list.kind[s] === SITE.made) for (const t of all) if (t !== s) assert.ok(Math.hypot(list.x[s] - list.x[t], list.y[s] - list.y[t]) >= GAP - 1e-9);
  assert.ok(Math.hypot(list.x[a[1]] - list.x[a[0]], list.y[a[1]] - list.y[a[0]]) >= NEAR);
  // the best made place of district 1 lies beside its river; the best come first and are the largest
  const m1 = b.slice(1); assert.ok(Math.abs(list.x[m1[0]] - x(I0 + 25)) < 1.6, 'the first place chosen lies by the river'); assert.ok(Math.abs(list.size[m1[0]] - MADE_R[0]) < 1e-6 && list.size[m1[m1.length - 1]] < list.size[m1[0]]);
  // the same division, the same list
  const again = districtSites(div, facts, sites); assert.deepEqual([...again.x], [...list.x]); assert.deepEqual([...again.kind], [...list.kind]);
  // a place the album draws as a town (the first `base` sites) is listed even beside another place; no place is made in wet land
  const based = districtSites(div, facts, [sites[0], { x: x(I0 + 10) + .5, y: y(J0 + 10), pop: 30000, name: 'Пригород' }], { base: 2 });
  assert.deepEqual([based.kind[1], based.src[1]], [SITE.real, 1]);
  const wet = districtSites(div, facts, sites, { swamp: px => (px < x(I0 + 10) ? SWAMP : 0) });
  assert.ok(within(wet, 0).every(s => wet.kind[s] !== SITE.made || wet.x[s] >= x(I0 + 10))); assert.ok(within(wet, 0).length < a.length);
  // a made place takes the most level spot of its chunk when the ground is known
  const bumpy = (px, py) => (px - Math.floor(px) < .5 ? 200 + Math.abs(Math.sin(py * 40)) * 400 : 200), onGround = districtSites(div, facts, sites, { at: bumpy });
  assert.ok(within(onGround, 0).filter(s => onGround.kind[s] === SITE.made).every(s => onGround.x[s] - Math.floor(onGround.x[s]) >= .5), 'never on the broken half of its chunk');
});

test('villages: the places the model is given — the real ones, and as many made ones as the density allows', () => {
  const { div, facts, x, y } = madeDiv();
  const sites = [{ x: x(I0 + 10), y: y(J0 + 10), pop: 40000, name: 'Центр' }, { x: x(I0 + 4), y: y(J0 + 4), pop: 900, name: 'Малое' }, { x: x(I0 + 15), y: y(J0 + 5), pop: 6000, name: 'Большое' }];
  const list = districtSites(div, facts, sites), one = villagePlaces(list, sites), half = villagePlaces(list, sites, { density: .5 }), two = villagePlaces(list, sites, { density: DENSE });
  assert.equal(villagePlaces(list, sites, { density: 0 }).length, 0, 'no villages at all');
  const n = d => Math.round(d * list.good[0] / PER) - 2 + Math.round(d * list.good[1] / PER) + 2;
  assert.deepEqual([half.length, one.length, two.length], [n(.5), n(1), n(2)]); assert.equal(two.length, list.x.length - 2, 'at the greatest density every place of the lists but the centres');
  // the places of a lesser density are the first of a greater one: a village never moves when the knob is turned
  const key = p => `${p.district}:${p.site}`, of = v => new Set(v.map(key));
  assert.ok(half.every(p => of(one).has(key(p))) && one.every(p => of(two).has(key(p))));
  for (const p of one) { assert.ok(p.village === true && p.site >= 1 && p.district >= 0); const [px, py] = kmOf(p.lat, p.lon), s = list.first[p.district] + p.site; assert.ok(Math.abs(px - list.x[s]) < 1e-6 && Math.abs(py - list.y[s]) < 1e-6); }
  const real = one.filter(p => p.r === undefined), made = one.filter(p => p.r !== undefined);
  assert.deepEqual(real.map(p => [p.name, p.pop, p.district, p.site]), [['Малое', 900, 0, 1], ['Большое', 6000, 0, 2]]);
  assert.ok(made.every(p => p.name === '' && p.pop <= MADE_POP && p.pop < 500 && p.r >= MADE_R[1] - 1e-6 && p.r <= MADE_R[0] + 1e-6), 'a made place is founded after every real one');
  // a place the album draws as a town is not given twice
  assert.equal(villagePlaces(districtSites(div, facts, sites, { base: 2 }), sites, { base: 2 }).filter(p => p.r === undefined).length, 1);
  // which place of which district a real place is
  const num = siteNumbers(list); assert.deepEqual(num.get(0), { district: 0, site: 0 }); assert.deepEqual(num.get(2), { district: 0, site: 2 }); assert.equal(num.size, 3);
  assert.ok(MOST < MAX_IN_DISTRICT, 'a save counts the settlements of a district in one byte');
});

// ---- the model of growth and the texture, on the made-up land of the settlement tests
const at = (x, y) => (x > 100 ? -50 : 300);
const ch = new Chunks((lat, lon) => at(...kmOf(lat, lon)));
const place = (x, y, pop, more = {}) => ({ ...llOf(x, y), pop, ...more });
const vil = (x, y, pop, more = {}) => place(x, y, pop, { village: true, ...more });
const clear = () => { for (let k = 0; k < ch.count; k++) { ch.set('built', k, 0); ch.set('culture', k, 0); } };
const write = m => { for (let k = 0; k < ch.count; k++) ch.set('built', k, m.built[k]); };

test('villages: the model founds them — a village stays a village, one to a square, none where a town has grown', () => {
  const town = place(-205, 4405, 650000), places = [town, vil(-199.6, 4405.3, 3000), vil(-198.5, 4405.9, 800), vil(-205.9, 4405, 2000), vil(-195, 4410, MADE_POP, { r: MADE_R[0] }), vil(-190, 4410, MADE_POP - 9, { r: MADE_R[1] })];
  const m = growTowns(ch, places, 1, at), by = Object.fromEntries(m.towns.map(t => [t.index, t]));
  // the town as before; the villages around it
  assert.ok(by[0] && !by[0].village && by[0].R > .7);
  assert.ok(by[1].village && by[1].fine === fineOf(by[1].x, by[1].y) && by[1].byte === 1 && Math.abs(by[1].R - fullRadius(3000)) < 1e-9);
  assert.equal(fineOf(-199.6, 4405.3), fineOf(-198.5, 4405.9)); assert.ok(!by[2], 'two places in one square of the fine grid: the greater is founded');
  assert.ok(!by[3], `a place ${(.9 - by[0].R).toFixed(2)} km from the last houses of the town is under the town`); assert.ok(.9 < by[0].R + fullRadius(2000) + KEEP_OFF);
  assert.ok(by[4] && Math.abs(by[4].R - MADE_R[0]) < 1e-9 && by[5] && Math.abs(by[5].R - MADE_R[1]) < 1e-9, 'a made place has the radius it was given');
  assert.equal(by[1].home, ch.at(...Object.values(llOf(-199.6, 4405.3)).slice(0, 2))); assert.ok(m.built[by[4].home] >= 1 / 255);
  // before the town has grown its place is free; the made places come one after another as the growth rises
  const early = growTowns(ch, places, .5, at); assert.ok(early.towns.some(t => t.index === 3) && early.towns.some(t => t.index === 0));
  const some = growTowns(ch, places, .6, at); assert.ok(some.towns.some(t => t.index === 4) && !some.towns.some(t => t.index === 5), 'the best made place first');
  // however the knob is turned a village is no town
  const big = growTowns(ch, [vil(-250, 4405, 400000), vil(-150, 4405, MADE_POP, { r: MADE_R[0] })], 3, at);
  assert.equal(big.towns.length, 2); assert.ok(big.towns.every(t => t.R <= VILLAGE_RMAX + 1e-9 && t.stage < 3), 'a village does not grow into a small town'); assert.ok(VILLAGE_RMAX < STAGES[3].r);
  assert.ok(VILLAGE_RMAX + fieldsBeyond(VILLAGE_RMAX) + .3 < VK, 'a village and its fields stay within a square of the fine grid of their own');
  // towns are still one to a natural cell, villages are not: two villages and a town share a cell
  const home = ch.at(...Object.values(llOf(-205, 4405)).slice(0, 2)), same = [];
  for (let dx = -4; dx <= 4 && same.length < 2; dx += .5) for (let dy = -4; dy <= 4 && same.length < 2; dy += .5) {
    const q = llOf(-205 + dx, 4405 + dy); if (ch.at(q.lat, q.lon) === home && Math.hypot(dx, dy) > 2.6 && !same.some(s => Math.hypot(s[0] - dx, s[1] - dy) < 2.6 || fineOf(-205 + dx, 4405 + dy) === fineOf(-205 + s[0], 4405 + s[1]))) same.push([dx, dy]);
  }
  assert.equal(same.length, 2);
  const shared = growTowns(ch, [town, ...same.map(([dx, dy]) => vil(-205 + dx, 4405 + dy, 2000))], 1, at);
  assert.equal(shared.towns.length, 3); assert.ok(shared.towns.every(t => t.home === home));
  // the fields of a village are in the numbers of every cell they reach
  const lone = growTowns(ch, [vil(-250, 4405, 3000)], 1, at), t = lone.towns[0];
  assert.ok(lone.fields[t.home] >= FIELD_FLOOR && lone.keep.every(v => v === 1), 'a village ploughs, and fells nothing beyond its fields');
  for (let k = 0; k < ch.count; k++) assert.ok(lone.fields[k] === 0 || lone.fields[k] >= FIELD_FLOOR);
});

test('villages: their patches lie in the fine grid of the one settlement texture; the towns stay in the coarse one', () => {
  clear();
  // a town; two villages 1.4 km apart on both sides of a line of the fine grid; a made place far away; a village 1.6 km from the town
  const places = [place(-205, 4405, 650000), vil(-200.6, 4406, 3000), vil(-199.2, 4406, 2500), vil(-148.4, 4446.5, MADE_POP, { r: MADE_R[0] }), vil(-204.2, 4403.6, 1500)];
  const m = growTowns(ch, places, 1, at), by = Object.fromEntries(m.towns.map(t => [t.index, t])); write(m);
  assert.equal(m.towns.length, 5);
  // the coarse grid knows the town alone: a village gives no patch there, and a cell with only a village in it none either
  const coarse = new Uint8Array(GN * GN * 4), r = mirrorSettle(ch, m.towns, coarse);
  assert.equal(r.lobes.length, 1); assert.ok(Math.abs(r.lobes[0].r - by[0].R) < .02);
  let held = 0; for (let g = 0; g < GN * GN; g++) if (coarse[g * 4 + 2]) held++; assert.equal(held, 1);
  // the fine grid: one square a village — its place in the square, its radius, its manner and who is near
  const fine = new Uint8Array(VN * VN * 4), v = mirrorVillages(ch, m.towns, r.lobes, fine);
  assert.ok(v.changed); assert.equal(v.lobes.length, 4); assert.equal(mirrorVillages(ch, m.towns, r.lobes, fine).changed, false, 'nothing changed, nothing to send');
  for (const i of [1, 2, 3, 4]) {
    const t = by[i], o = t.fine * 4, [bx, by2] = fineBytes(t.x, t.y), L = v.lobes.find(l => l.fine === t.fine);
    assert.deepEqual([fine[o], fine[o + 1], fine[o + 2]], [bx, by2, radiusByte(t.R)]);
    assert.ok(Math.hypot(L.x - t.x, L.y - t.y) < VK / 256 && Math.abs(L.r - t.R) < .006 && L.k === GN * GN + t.fine && L.home === t.home && L.cul === CULTURES.med);
    assert.deepEqual([L.vx, L.vy], [t.fine % VN, Math.floor(t.fine / VN)]);
  }
  // the two villages in neighbouring squares know of each other; the far one stands alone
  const A = by[1], B = by[2], C = by[3], Dv = by[4]; assert.equal(B.fine, A.fine + 1);
  assert.equal(fine[A.fine * 4 + 3], 110 + 2 * 5 + 0, 'a village with one neighbour, east of it'); assert.equal(fine[B.fine * 4 + 3], 110 + 2 * 3 + 0); assert.equal(fine[C.fine * 4 + 3], 200 + CULTURES.med);
  assert.equal(fine[(C.fine + 1) * 4 + 3], 1 + 3, 'the empty square east of a village knows the village west of it'); assert.equal(fine[(C.fine + VN) * 4 + 3], 1 + 1); assert.equal(fine[(C.fine + 5) * 4 + 3], 0);
  const LA = v.lobes.find(l => l.fine === A.fine), LB = v.lobes.find(l => l.fine === B.fine);
  assert.ok(LA.rivals.includes(LB) && LB.rivals.includes(LA) && !LA.rivals.includes(r.lobes[0])); assert.equal(v.lobes.find(l => l.fine === C.fine).rivals.length, 0);
  assert.ok(v.lobes.find(l => l.fine === Dv.fine).rivals.includes(r.lobes[0]), 'a village knows the town beside it');
  // the texture holds both grids below the rows of the chunks of 1 km²: the fine one, and the coarse one beside it
  assert.equal(settleTex.image.width, TEX_W); assert.equal(settleTex.image.height, TEX_H); assert.equal(atlasBytes.length, TEX_W * TEX_H * 4); assert.equal(villageBytes.length, VN * VN * 4);
  assert.deepEqual([TEX_W, TEX_H, FINE_AT, COARSE_AT], [KN, KN + VN, [0, KN], [VN, KN]]); assert.ok(COARSE_AT[0] + GN <= TEX_W && FINE_AT[1] + VN <= TEX_H, 'both grids fit beside each other');
  mirrorSettle(ch, m.towns); mirrorVillages(ch, m.towns, r.lobes); packAtlas();
  const g = r.lobes[0].k; assert.equal(atlasBytes[((COARSE_AT[1] + Math.floor(g / GN)) * TEX_W + COARSE_AT[0] + g % GN) * 4 + 2], settleBytes[g * 4 + 2]);
  assert.equal(atlasBytes[((FINE_AT[1] + Math.floor(A.fine / VN)) * TEX_W + FINE_AT[0] + A.fine % VN) * 4 + 2], radiusByte(A.R));
  // the plan of a village: a few blocks around its place, on its own lattice
  const S = cellSize(20), env = { at, river: () => 1e9, swamp: () => 0 }, rows = planLobe(LA, S, env);
  assert.ok(rows.length >= ROW * 3 && rows.length < ROW * 60, `${rows.length / ROW} blocks in a village`);
  for (let i = 0; i < rows.length; i += ROW) { const c = Math.cos(rows[i + 2]), s = Math.sin(rows[i + 2]); assert.ok(Math.hypot(rows[i] + (c * rows[i + 4] - s * rows[i + 5]) * S - LA.x, rows[i + 1] + (s * rows[i + 4] + c * rows[i + 5]) * S - LA.y) < LA.r + .25); }
  // a village whose houses were pulled down (a brush) is gone from the grid
  ch.set('built', C.home, 0); const gone = mirrorVillages(ch, m.towns, r.lobes, fine); assert.ok(gone.changed); assert.equal(gone.lobes.length, 3); assert.equal(fine[C.fine * 4 + 2], 0); assert.equal(fine[(C.fine + 1) * 4 + 3], 0);
  clear();
});

test('villages: the ground shader reads both grids; a village has no mark from afar', () => {
  assert.equal(VN, 512); assert.equal(VK, 2.5); assert.equal(VN * VK, GN * GK);
  assert.match(RULES_GLSL, /#define SET_VN 512/); assert.match(RULES_GLSL, /#define SET_VK 2\.50/);
  const g = settle.glsl;
  assert.match(g, /texelFetch\(tSettle, c \+ \(fine \? SET_FINE : SET_COARSE\), 0\)/, 'each grid at its own place in the texture');
  assert.match(RULES_GLSL, new RegExp(`#define SET_FINE ivec2\\(0, ${KN}\\)`)); assert.match(RULES_GLSL, new RegExp(`#define SET_COARSE ivec2\\(${VN}, ${KN}\\)`));
  assert.match(g, /setSquares\(code, c0, false/); assert.match(g, /setSquares\(vcode, v0, true/);
  assert.match(g, /ck = village \? SET_GN \* SET_GN \+ bc\.y \* SET_VN \+ bc\.x/);
  assert.match(g, /bool small = village \|\| r < SET_TOWN_R;/); assert.match(g, /if \(small\) tm \*= 1\. - smoothstep/, 'a village melts into the land from afar: no mark');
  assert.match(g, /mt = m \+ \(small \? 0\. : max\(0\., 2\.2 \* px - r\)\)/, 'only a place of a thousand people and more has a mark from afar');
  assert.ok(Math.abs(TOWN_R - .2523) < 1e-3 && peopleOf(TOWN_R) >= 999 && peopleOf(TOWN_R) <= 1001 && classOf(peopleOf(TOWN_R + .01)) === 1 && classOf(peopleOf(TOWN_R - .01)) === 0);
  // the yards: every patch is known
  const idx = patchIndex([{ x: -205, y: 4405, r: .9 }, { x: -203, y: 4405, r: .08 }, { x: -150, y: 4405, r: .08 }]);
  assert.equal([...idx.values()].reduce((a, l) => a + l.length, 0), 3); assert.ok([...idx.values()].some(l => l.length === 2), 'a town and a village in one square of 10 km');
  assert.ok(ploughed(.3, -.02, .08) > ploughed(.3, -1.2, .08), 'in a chunk ploughed in part the land beside a village is ploughed first');
});

test('villages in the album: the knob, the check of places and the pages', () => {
  const k = settle.params.find(p => p.key === 'villages'); assert.ok(k && k.value === 1 && k.min === 0 && k.max === DENSE && k.group === 'scale');
  const s = settle.params.find(p => p.key === 'sitesShow'); assert.ok(s && s.type === 'toggle' && s.value === 0, 'the places are shown only for checking');
  assert.ok(DEFS.some(d => d.key === 'villages') && DEFS.some(d => d.key === 'sitesShow'));
  for (const id of ['villages', 'villages-45', 'villages-grown', 'villages-dense', 'villages-atl', 'villages-valley', 'villages-sites', 'villages-sites-near']) {
    const pg = PAGES.find(p => p.id === id); assert.ok(pg && pg.group === 'Города и дороги' && pg.note.length > 60, id);
  }
  assert.equal(PAGES.find(p => p.id === 'villages-sites').p.sitesShow, 1); assert.equal(PAGES.find(p => p.id === 'villages-dense').p.villages, 2);
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('villages of the album: about nine to a district, on level ground by the water; every one has its record in the save', { skip }, async () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), sitesFile = join(ROOT, 'public/assets/album/town/sites.json.gz');
  const osm = existsSync(sitesFile) ? decodeSites(JSON.parse(gunzipSync(readFileSync(sitesFile)))) : [];
  const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const div = buildDivision(ch, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const sites = [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  div.centres = districtCentres(div, sites);
  const at = (x, y) => data.base.at(y / 111.195, x / (111.195 * Math.cos(40 * Math.PI / 180))), facts = kmFacts(div, data.base.at);
  const list = districtSites(div, facts, sites, { base: own.length, at });
  // the lists: every land district with a centre begins with it; then its real places; then the made ones
  let landD = 0, centres = 0; const perD = [];
  for (let d = 0; d < div.count; d++) {
    const n = list.first[d + 1] - list.first[d];
    if (div.kinds[d] !== LAND) { assert.equal(n, 0); continue; }
    landD++; if (!n) continue;
    centres++; assert.equal(list.kind[list.first[d]], SITE.centre); assert.ok(n <= MOST + 1);
    let made = 0, last = SITE.centre; for (let s = list.first[d] + 1; s < list.first[d + 1]; s++) { assert.ok(list.kind[s] >= last, 'real places before made ones'); last = list.kind[s]; if (list.kind[s] === SITE.made) made++; }
    perD.push(list.real[d] + Math.min(made, madeAllowed(list, d, 1)));
  }
  perD.sort((a, b) => a - b);
  const kinds = [0, 0, 0]; for (const k of list.kind) kinds[k]++;
  assert.ok(centres > landD * .98); assert.equal(kinds[0], centres);
  if (osm.length) assert.ok(kinds[1] > 5000 && kinds[1] < 8000, `${kinds[1]} real places besides the centres`);
  assert.ok(kinds[2] > 15000 && kinds[2] < 40000, `${kinds[2]} made places at the greatest density`);
  const mid = perD[perD.length >> 1]; assert.ok(mid >= 6 && mid <= 12, `a district has ${mid} villages in the middle`);
  // where the made places stand: level ground, never mountains, never too high, each in its own district
  const cls = [0, 0, 0, 0, 0, 0]; let byWater = 0;
  for (let s = 0; s < list.x.length; s++) {
    if (list.kind[s] !== SITE.made) continue;
    const c = list.chunk[s]; cls[facts.cls[c]]++; assert.ok(div.raster.hgt[c] <= TOO_HIGH);
    const i = c % KN, j = (c - i) / KN; let w = false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const t = (j + dj) * KN + i + di, d = div.cells[t]; if (d < 0 || div.kinds[d] !== LAND || div.raster.riv[t] > 0) w = true; }
    if (w) byWater++;
  }
  assert.equal(cls[5], 0); assert.equal(cls[0], 0); assert.ok(cls[1] > cls[2] && cls[2] > cls[3] * 5 && cls[4] < cls[1] * .02, 'made places by the class of their ground: ' + cls);
  assert.ok(byWater / kinds[2] > .3, `${Math.round(byWater / kinds[2] * 100)} % of the made places stand by a river or the shore`);
  // the model: the towns as before, and the villages between them
  const base = centrePlaces(data.vectors.places, div, sites), vill = villagePlaces(list, sites, { base: own.length }), places = [...base, ...vill];
  const alone = growTowns(ch, base, 1, at), model = growTowns(ch, places, 1, at), founded = model.towns.filter(t => !t.town);
  assert.equal(model.towns.length - founded.length, alone.towns.length, 'the towns are the same with the villages and without them');
  assert.ok(founded.length > vill.length * .95, `${founded.length} of ${vill.length} villages founded`); assert.ok(founded.every(t => t.cls === 0 && t.R <= VILLAGE_RMAX), 'a place between the centres is a village: under a thousand people');
  const inFine = model.towns.filter(t => t.village);
  assert.equal(new Set(inFine.map(t => t.fine)).size, inFine.length, 'one village a square of the fine grid');
  assert.ok(inFine.length - founded.length < alone.towns.length * .1, `${inFine.length - founded.length} towns of districts lie in the fine grid: a greater town holds their natural cell`);
  // the save: every settlement stands on a place of its district, and no two on one
  const num = siteNumbers(list), siteOf = t => { const pl = places[t.index]; return pl.site !== undefined ? { district: pl.district, site: pl.site } : pl.district !== undefined ? { district: pl.district, site: 0 } : num.get(t.index) || null; };
  const { cellsOfChunks } = await import('../src/album/division/km.js');
  // (a place of the album that lies on a chunk of water and was moved to the shore is on no list: it is numbered from the far end)
  const districtOf = (x, y) => { const c = squareOf(x, y); return c < 0 ? -1 : div.cells[c]; };
  const world = landOfAlbum({ div, model, places, legs: [], districtOf, cellOf: cellsOfChunks(ch).cell, siteOf });
  assert.equal(world.settlements.length, model.towns.length); assert.equal(new Set(world.settlements.map(s => s.district * 256 + s.site)).size, world.settlements.length);
  assert.ok(world.settlements.every(s => s.site >= 0 && s.site <= MAX_IN_DISTRICT && div.kinds[s.district] === LAND));
  const back = unpackLand(packLand(world)); assert.equal(back.settlements.length, world.settlements.length);
  assert.ok(world.settlements.length * 8 < 200000, `${world.settlements.length * 8} bytes for the settlements of the album`);
  // the same settlements over the land of the whole world: within the bound the owner set for them
  let landKm2 = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) landKm2 += kmData(div).box.num[d];
  assert.ok(world.settlements.length * 8 / landKm2 * 149e6 < 40e6, `${(world.settlements.length * 8 / landKm2 * 149).toFixed(1)} MB for the settlements of a world settled as thickly as this land`);
});
