// Farmland: the fields as the state of the chunks of 1 km² (src/album/town/farmland.js, docs/album/settle.md) — who
// ploughs which chunk, the rows of the chunks in the settlement texture, what the ground shader and the yards read
// from them. On made-up land, and on the album's real data when public/album-data/ is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { KN, KKM, KX0, KY0, JITTER, squareOf, seedOf, kmHash, kmFacts, kmData, chunkAt, cellsOfChunks } from '../src/album/division/km.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { packDivision } from '../src/album/division/gpu.js';
import { decodeSites } from '../src/album/town/sites.js';
import { GN, VN, TEX_W, TEX_H, FINE_AT, COARSE_AT, FARM_SOFT, FARM_WARP, FARM_UNEVEN, FARM_SHARP, RULES_GLSL } from '../src/album/town/rules.js';
import { farmGround, farmRun, farmWithCells, farmOfDistricts, HA_PER_PERSON, FARM_CAP, FARM_HIGH, FARM_WET, FARM_REACH, FARM_LEAST } from '../src/album/town/farmland.js';
import { growTowns, centrePlaces, reachOf, FIELD_FLOOR, FELL_FROM, FELL } from '../src/album/town/grow.js';
import { districtSites, villagePlaces, GOOD } from '../src/album/town/villages.js';
import { mirrorFarm, farmAt, farmBytes, atlasBytes, settleTex } from '../src/album/town/state.js';
import { landOfAlbum, farmRank } from '../src/album/save/land.js';
import settle from '../src/album/aspects/settle.js';
import division from '../src/album/aspects/division.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// a flat land 300 m high with the sea east of x = 100 km and a steep ridge west of x = −400 km
const at = (x, y) => (x > 100 ? -50 : x < -400 ? 300 + (-400 - x) * 600 : 300);
const ch = new Chunks((lat, lon) => at(...kmOf(lat, lon)));
const place = (x, y, pop, more = {}) => ({ ...llOf(x, y), pop, ...more });
const vil = (x, y, pop, more = {}) => place(x, y, pop, { village: true, ...more });
const sq = (x, y) => squareOf(x, y);

test('farmland: a settlement ploughs a hectare a person — the chunks around its houses, whole near them and in part at the rim', () => {
  const m = growTowns(ch, [place(-205, 4405, 650000)], 1, at), t = m.towns[0], f = m.farm;
  assert.equal(HA_PER_PERSON, 1); assert.ok(Math.abs(t.ploughed - t.people / 100) < .01, `${t.people} people, ${t.ploughed.toFixed(2)} km² of fields`);
  // the state: a byte a chunk, the list of the chunks that have fields, their sum
  assert.equal(f.km.length, KN * KN); assert.ok(f.list.length > t.ploughed && f.list.length < t.ploughed * 2.2, `${f.list.length} chunks for ${t.ploughed.toFixed(0)} km²`);
  assert.ok(f.list.every((c, i) => f.km[c] > 0 && (i === 0 || c > f.list[i - 1])), 'the list is the chunks with fields, in rising order');
  let n = 0, sum = 0; for (let c = 0; c < f.km.length; c++) if (f.km[c]) { n++; sum += f.km[c] / 255; } assert.equal(n, f.list.length);
  assert.ok(Math.abs(sum - t.ploughed) < f.list.length / 255 && Math.abs(f.area - t.ploughed) < 1e-3, 'the bytes add up to the fields');
  // whole chunks by the houses, parts at the rim, nothing far away; the nearer, the more
  const whole = f.list.filter(c => f.km[c] === 255), home = sq(t.x, t.y);
  assert.equal(f.km[home], 255); assert.ok(whole.length > t.ploughed * .5 && whole.length < f.list.length, `${whole.length} chunks ploughed whole of ${f.list.length}`);
  const dist = c => Math.hypot(...seedOf(c % KN, Math.floor(c / KN)).map((v, i) => v - [t.x, t.y][i])), R = Math.sqrt(t.ploughed / Math.PI);
  assert.ok(whole.every(c => dist(c) < R * 1.25) && [...f.list].every(c => dist(c) < R * 1.45 + 1), 'the fields lie around the houses');
  assert.ok([...f.list].filter(c => dist(c) < R * .6).every(c => f.km[c] === 255), 'no gap in the fields near the houses'); assert.equal(f.km[sq(t.x + 3 * R, t.y)], 0);
  // the same people, the same fields; more people, more fields, and the first fields stay
  const again = growTowns(ch, [place(-205, 4405, 650000)], 1, at); assert.deepEqual([...again.farm.list], [...f.list]); assert.ok(again.farm.list.every(c => again.farm.km[c] === f.km[c]));
  const half = growTowns(ch, [place(-205, 4405, 650000)], .5, at).farm; assert.ok(half.area < f.area * .5 && [...half.list].every(c => f.km[c] >= half.km[c]), 'a settlement that grows keeps the fields it had');
  // the knob «Угодья на жителя»: none at zero, twice as many at two hectares
  const none = growTowns(ch, [place(-205, 4405, 650000)], 1, at, undefined, { ha: 0 }); assert.equal(none.farm.list.length, 0); assert.equal(none.towns[0].ploughed, 0); assert.ok(none.fields.every(v => v === 0) && none.keep.every(v => v === 1));
  const two = growTowns(ch, [place(-205, 4405, 650000)], 1, at, undefined, { ha: 2 }); assert.ok(Math.abs(two.farm.area - 2 * f.area) < .02);
});

test('farmland: what the natural cells hold — the fields of their chunks, and the forest that made room', () => {
  const m = growTowns(ch, [place(-205, 4405, 650000)], 1, at), t = m.towns[0], f = m.farm, cellOf = cellsOfChunks(ch);
  const per = new Float64Array(ch.count); for (const c of f.list) per[cellOf.cell[c]] += f.km[c] / 255;
  let cells = 0;
  for (let k = 0; k < ch.count; k++) {
    if (!per[k]) { assert.equal(m.fields[k], 0); assert.equal(m.keep[k], 1); continue; }
    cells++; const share = per[k] / cellOf.count[k];
    assert.ok(Math.abs(m.fields[k] - Math.max(FIELD_FLOOR, share)) < .01, `cell ${k}: ${m.fields[k].toFixed(3)} against ${share.toFixed(3)} of its chunks`);
    assert.ok(Math.abs(m.keep[k] - Math.max(0, 1 - FELL * share)) < .012, 'a town fells a little more forest than it ploughs');
  }
  assert.ok(cells >= 2 && t.R >= FELL_FROM && FELL > 1);
  // a village clears its fields and no more: the forest of its cell is left alone
  const v = growTowns(ch, [vil(-250, 4405, 3000)], 1, at); assert.ok(v.towns[0].R < FELL_FROM && v.farm.area > .2 && v.keep.every(k => k === 1));
  assert.ok(v.fields[v.towns[0].home] >= FIELD_FLOOR && v.fields.every(x => x === 0 || x >= FIELD_FLOOR), 'a few fields are never rounded down to none');
});

test('farmland: only ground that can be ploughed — not the sea, not a ridge; what one settlement took is not there for the next', () => {
  // a town on the shore: its fields lie inland; one at the foot of the ridge: on the plain
  const shore = growTowns(ch, [place(98, 4405, 650000)], 1, at); assert.ok(shore.farm.area > 50 && [...shore.farm.list].every(c => KX0 + c % KN + .5 < 100.5), 'no field in the sea');
  assert.ok(Math.abs(shore.towns[0].ploughed - shore.towns[0].people / 100) < .01, 'the fields reach farther inland to make up for the sea');
  const ridge = growTowns(ch, [place(-399, 4405, 650000)], 1, at); assert.ok(ridge.farm.area > 50 && [...ridge.farm.list].every(c => KX0 + c % KN + .5 > -400.5), 'no field on the ridge');
  // two towns 5 km apart: every chunk is ploughed once; the greater chose first, the lesser went farther for the same land
  const a = place(-205, 4405, 900000), b = place(-200, 4405, 300000), both = growTowns(ch, [b, a], 1, at), alone = growTowns(ch, [b], 1, at);
  assert.equal(both.towns.length, 2); assert.equal(both.towns[0].index, 1, 'the greater first');
  assert.ok(Math.abs(both.farm.area - both.towns[0].ploughed - both.towns[1].ploughed) < 1e-3 && [...both.farm.list].every(c => both.farm.km[c] <= 255));
  assert.ok(Math.abs(both.towns[1].ploughed - alone.towns[0].ploughed) < .01, 'the lesser town has all the fields it needs');
  const east = m => [...m.farm.list].reduce((s, c) => s + (KX0 + c % KN + .5 > -197 ? m.farm.km[c] / 255 : 0), 0); assert.ok(east(both) > east(alone) * 1.3, 'and they lie farther from the greater town');
  // a village does not walk farther than FARM_REACH[0]: where its people need more than lies within reach, it is short of fields
  const big = growTowns(ch, [vil(-250, 4405, 400000)], 3, at, undefined, { ha: 12 }), vt = big.towns[0];
  assert.ok(vt.village && vt.ploughed < vt.people * .12 - 20 && vt.ploughed > 30 && [...big.farm.list].every(c => Math.hypot(KX0 + c % KN + .5 - vt.x, KY0 + Math.floor(c / KN) + .5 - vt.y) < FARM_REACH[0] + 1.2));
  assert.ok(FARM_REACH[1] > FARM_REACH[0] * 4);
});

test('farmland: the ground by its class, its height and its swamps; the cells a settlement can walk to', () => {
  // a made-up division: level ground west of column 640, hills (class 3) to 650, mountains beyond; high ground north of row 610
  const n = KN * KN, cls = new Uint8Array(n), hgt = new Float32Array(n);
  for (let j = 560; j < 660; j++) for (let i = 560; i < 720; i++) { const c = j * KN + i; cls[c] = i < 640 ? 1 : i < 650 ? 3 : 5; hgt[c] = j >= 630 ? 2000 : j >= 610 ? 1500 : 300; }
  const flat = () => 300, world = new Chunks(() => 300), g = farmGround(world, flat, { cls, hgt });
  assert.equal(g.room(600 * KN + 600), FARM_CAP[1]); assert.equal(g.room(600 * KN + 645), FARM_CAP[3]); assert.equal(g.room(600 * KN + 660), 0); assert.equal(g.room(100 * KN + 100), 0, 'water');
  assert.deepEqual(FARM_CAP, GOOD, 'as much of a chunk can be ploughed as counts as good ground for a village');
  assert.ok(g.room(620 * KN + 600) > 0 && g.room(620 * KN + 600) < FARM_CAP[1] && g.room(640 * KN + 600) === 0, 'the fields thin out with the height'); assert.ok(FARM_HIGH[0] < 1500 && FARM_HIGH[1] < 2000);
  // a settlement on the level ground by the hills: the hills are ploughed less, and count as lying farther
  const run = farmRun(g), x = KX0 + 636.5, y = KY0 + 590.5, got = run.claim(x, y, 200, 30), st = run.done();
  assert.ok(Math.abs(got - 200) < .01); assert.ok([...st.list].every(c => cls[c] === 1 || cls[c] === 3) && [...st.list].every(c => st.km[c] <= Math.round(FARM_CAP[cls[c]] * 255)));
  const west = [...st.list].filter(c => c % KN < 633).length, east = [...st.list].filter(c => c % KN > 640).length; assert.ok(west > east * 1.5 && east > 0, `${west} chunks of level ground, ${east} of hills`);
  // swamps: a cell that is a third swamp leaves two thirds of each chunk; a cell that is all swamp none
  const cellOf = cellsOfChunks(world).cell, wetCell = cellOf[600 * KN + 600], bogCell = cellOf[600 * KN + 620];
  const wet = farmGround(world, flat, { cls, hgt }, k => (k === wetCell ? 1 / 3 : k === bogCell ? .95 : 0));
  assert.ok(Math.abs(wet.room(600 * KN + 600) - 2 / 3) < 1e-6); assert.equal(wet.room(600 * KN + 620), 0); assert.ok(FARM_WET > .5 && FARM_WET < 1);
  // the cells it can walk to: nothing is ploughed beyond them
  const home = cellOf[590 * KN + 636], near = new Set([home]), fenced = farmRun(g), took = fenced.claim(x, y, 200, 30, near), fs = fenced.done();
  assert.ok(took > 5 && took < 150 && [...fs.list].every(c => cellOf[c] === home), `a settlement shut in its cell ploughs what the cell has: ${took.toFixed(0)} km²`);
  assert.equal(farmRun(g).claim(x, y, 0, 30), 0); assert.ok(FARM_LEAST > 0 && FARM_LEAST < 1 / 200, 'about one step of the byte');
  // before the land is divided the class of a chunk is read off the relief
  const rough = farmGround(ch, at); assert.equal(rough.divided, false); assert.equal(rough.room(sq(-205, 4405)), 1); assert.equal(rough.room(sq(150, 4405)), 0); assert.equal(rough.room(sq(-420, 4405)), 0);
});

test('farmland: the chunks in the settlement texture — the share, the seed, and what the chunks around hold', () => {
  assert.deepEqual([TEX_W, TEX_H], [KN, KN + VN]); assert.equal(settleTex.image.width, KN); assert.equal(settleTex.image.height, KN + VN);
  assert.equal(farmBytes.length, KN * KN * 4); assert.equal(farmBytes.buffer, atlasBytes.buffer); assert.equal(farmBytes.byteOffset, 0, 'the chunks are the first rows of the texture');
  assert.ok(FINE_AT[1] >= KN && COARSE_AT[1] >= KN && COARSE_AT[0] >= FINE_AT[0] + VN && COARSE_AT[0] + GN <= TEX_W, 'the grids of the settlements lie below the chunks, side by side');
  const out = new Uint8Array(KN * KN * 4), m = growTowns(ch, [place(-205, 4405, 650000)], 1, at), f = m.farm, t = m.towns[0];
  assert.ok(mirrorFarm(f, out).changed);
  // R the share; G, B where the seed of the chunk stands in its square (the chunk of a point is the nearest seed)
  for (const c of f.list) assert.equal(out[c * 4], f.km[c]);
  let held = 0; for (let c = 0; c < KN * KN; c++) if (out[c * 4]) held++; assert.equal(held, f.list.length);
  for (const [i, j] of [[0, 0], [675, 525], [1279, 1279], [300, 900]]) {
    const o = (j * KN + i) * 4, s = seedOf(i, j);
    assert.ok(Math.abs(out[o + 1] / 255 - (s[0] - KX0 - i)) < .003 && Math.abs(out[o + 2] / 255 - (s[1] - KY0 - j)) < .003, 'the seed, to a few metres');
    assert.ok(out[o + 1] / 255 >= .5 - JITTER - .003 && out[o + 1] / 255 <= .5 + JITTER + .003);
  }
  // A: 0 no fields anywhere near · 255 the nine chunks around hold the same · 128 a mix
  const home = sq(t.x, t.y), far = sq(t.x + 40, t.y), edge = f.list.find(c => f.km[c] < 255);
  assert.equal(out[home * 4 + 3], 255); assert.equal(out[far * 4 + 3], 0); assert.equal(out[edge * 4 + 3], 128);
  const outside = [...f.list].map(c => c + 1).find(c => f.km[c] === 0); assert.equal(out[outside * 4 + 3], 128, 'a chunk without fields beside one with fields');
  for (let c = 0; c < KN * KN; c += 7) { const a = out[c * 4 + 3]; assert.ok(a === 0 || a === 128 || a === 255); if (a === 0) assert.equal(out[c * 4], 0); }
  // what the shader reads at a point (farmAt is its twin): the chunk of the point, the step to the next softened
  assert.equal(farmAt(t.x, t.y, out), 1); assert.equal(farmAt(t.x + 40, t.y, out), 0); assert.equal(farmAt(-1e4, 0, out), 0);
  const ei = edge % KN, ej = Math.floor(edge / KN), es = seedOf(ei, ej); assert.ok(Math.abs(farmAt(es[0], es[1], out) - f.km[edge] / 255) < .25, 'at the seed of a chunk, mostly its own share');
  { // from a chunk ploughed whole out into unploughed land the share falls steadily, over some hundreds of metres
    const R = Math.sqrt(t.ploughed / Math.PI), v = []; for (let d = R - 2.5; d <= R + 3; d += .1) v.push(farmAt(t.x + d, t.y + .37, out));
    assert.equal(v[0], 1); assert.equal(v[v.length - 1], 0); let jump = 0; for (let i = 1; i < v.length; i++) jump = Math.max(jump, Math.abs(v[i] - v[i - 1]));
    assert.ok(jump < .45, `the greatest step in a hundred metres is ${jump.toFixed(2)}`); assert.ok(FARM_SOFT >= 2 && FARM_SOFT <= 8);
  }
  // only what changed is touched: the fields gone, the texture is clean again but for the seeds
  assert.equal(mirrorFarm(f, out).changed, true); const less = growTowns(ch, [place(-205, 4405, 650000)], .3, at).farm; mirrorFarm(less, out);
  held = 0; for (let c = 0; c < KN * KN; c++) if (out[c * 4]) held++; assert.equal(held, less.list.length); assert.equal(out[edge * 4], less.km[edge]);
  mirrorFarm(null, out); for (let c = 0; c < KN * KN; c += 3) assert.ok(out[c * 4] === 0 && out[c * 4 + 3] === 0); assert.ok(out[home * 4 + 1] > 0, 'the seeds stay');
});

test('farmland: a cell ploughed by hand gives its share to every chunk in it; the fields of a district are those of its chunks', () => {
  const g = farmGround(ch, at), m = growTowns(ch, [place(-205, 4405, 650000)], 1, at, undefined, { ground: g }), f = m.farm, cellOf = cellsOfChunks(ch).cell;
  assert.equal(farmWithCells(g, f, new Map()), f);
  const cell = cellOf[sq(-150, 4405)], bare = cellOf[sq(-205, 4405)], w = farmWithCells(g, f, new Map([[cell, .6], [bare, 0]]));
  for (let c = 0; c < KN * KN; c++) { if (cellOf[c] === cell) assert.equal(w.km[c], 153); else if (cellOf[c] === bare) assert.equal(w.km[c], 0); else if (w.km[c] !== f.km[c]) assert.fail('a chunk of another cell changed'); }
  assert.ok(w.list.every((c, i) => w.km[c] > 0 && (i === 0 || c > w.list[i - 1])) && w.list.length !== f.list.length); assert.equal(f.km[sq(-150, 4405)], 0, 'the state of the model is left as it was');
  // districts: two halves of the land, west and east of the town
  const cells = new Int32Array(KN * KN); const col = Math.floor(-205 - KX0); for (let c = 0; c < cells.length; c++) cells[c] = c % KN < col ? 0 : 1;
  const per = farmOfDistricts(f, cells, 2); assert.ok(per[0] > 10 && per[1] > 10 && Math.abs(per[0] + per[1] - f.area) < f.list.length / 255);
  // the save counts the fields of a district the same way
  const world = landOfAlbum({ div: { count: 2, cells }, model: m, places: [place(-205, 4405, 650000)], legs: [], districtOf: x => (x < -205 ? 0 : 1), cellOf });
  let n0 = 0; for (let c = 0; c < cells.length; c++) if (cells[c] === 0 && cellOf[c] < ch.count) n0++; assert.ok(Math.abs(world.districts[0].fields - per[0] / n0) < 1e-4);
  // the chunks of farmland of a district have numbers of their own, in the order the district takes up its land:
  // a save counts the chunks that carry yards by them
  const order = { list: Uint32Array.of(5, 9, 2, 7, 11, 3), first: Uint32Array.of(0, 4, 6) }, some = new Uint8Array(12); some[9] = 255; some[7] = 130; some[2] = 90; some[3] = 128;
  assert.deepEqual([...farmRank(order, some, .5)].map((v, c) => [c, v]).filter(e => e[1] >= 0), [[3, 0], [7, 1], [9, 0]]); assert.deepEqual([...farmRank(order, some)].filter(v => v >= 0).length, 4);
  // the texture of the division can carry the fields of every chunk, for the check view
  const div = { count: 2, cells, kinds: [0, 0], colour: { district: [0, 1], province: [0], region: [0] }, province: [0, 0], region: [0], cx: [-300, -100], cy: [4405, 4405], chunks: [[0], [1]] };
  const a = packDivision(ch, div, null, { cls: new Uint8Array(KN * KN).fill(1) }, f.km), home = sq(-205, 4405);
  assert.equal((a[home * 4 + 1] >>> 8) & 255, 255); assert.equal(a[home * 4 + 1] & 7, 1); assert.equal((a[sq(-150, 4405) * 4 + 1] >>> 8) & 255, 0);
});

test('farmland in the album: the shader draws the fields from the chunks; the knob, the check view and the pages', () => {
  const g = settle.glsl;
  for (const d of [`#define SET_KN ${KN}`, `#define SET_K0 vec2(${KX0.toFixed(1)}, ${KY0.toFixed(1)})`, `#define SET_SOFT ${FARM_SOFT.toFixed(1)}`, `#define SET_WARP ${(FARM_WARP / KKM).toFixed(3)}`, `#define SET_UNEVEN ${FARM_UNEVEN.toFixed(3)}`, `#define SET_SHARP ${FARM_SHARP.toFixed(2)}`]) assert.ok(RULES_GLSL.includes(d), d);
  assert.match(g, /float setFarm\(vec2 pk\)/); assert.match(g, /if \(o\.a < \.25 \|\| o\.a > \.75\) return o\.r;/, 'one texel where the chunks around hold the same');
  assert.match(g, /exp\(-SET_SOFT \* dot\(v, v\)\)/); assert.match(g, /float farm = setFarm\(p\.pk\);/);
  assert.match(g, /float want = \(farm \+ \.45 \* beside \+ \(\.5 - p\.n2 \* \.6 - p\.n3 \* \.4\) \* SET_UNEVEN - \.5\) \* SET_SHARP \+ \.5;/, 'the share of the chunk is the share of its furlongs');
  assert.match(g, /step\(setHash\(ivec2\(cid\), 3, 14\), want\)/); assert.ok(!/fieldsV|setFieldsSeen|fld\./.test(g), 'no fields in rings around the houses any more');
  assert.match(g, /if \(uSettle\.w < \.5 \|\| p\.h < \.4\) return;/); assert.match(g, /float seen = p\.cC\.g >= \.12 \? 1\./, 'a land ploughed here and there shows its fields only from near');
  // the knob and the pages
  const k = settle.params.find(p => p.key === 'farmHa'); assert.ok(k && k.value === HA_PER_PERSON && k.min === 0 && k.max === 3 && k.group === 'scale' && DEFS.some(d => d.key === 'farmHa'));
  for (const id of ['farm', 'farm-hills', 'farm-200']) { const pg = PAGES.find(p => p.id === id); assert.ok(pg && pg.group === 'Города и дороги' && pg.note.length > 60, id); }
  // the check view of the division: the chunks by their fields
  const km = DEFS.find(d => d.key === 'km'); assert.deepEqual(km.options[4], [4, 'угодья']);
  assert.match(division.glsl, /uDivKm == 4 && kf\.z > 0/); assert.match(division.glsl, /ivec3 kmFacts\(ivec2 q\)/);
  for (const id of ['km-farm', 'km-farm-natural']) { const pg = PAGES.find(p => p.id === id); assert.ok(pg && pg.p.km === 4 && pg.note.length > 60, id); }
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('farmland of the album: a few chunks by every village, the plains by the towns; nothing ploughed where nothing grows', { skip }, () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), sitesFile = join(ROOT, 'public/assets/album/town/sites.json.gz');
  const osm = existsSync(sitesFile) ? decodeSites(JSON.parse(gunzipSync(readFileSync(sitesFile)))) : [];
  const world = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const div = buildDivision(world, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const sites = [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  div.centres = districtCentres(div, sites);
  const hAt = (x, y) => data.base.at(y / 111.195, x / (111.195 * Math.cos(40 * Math.PI / 180))), facts = kmFacts(div, data.base.at);
  const list = districtSites(div, facts, sites, { base: own.length, at: hAt });
  const places = [...centrePlaces(data.vectors.places, div, sites), ...villagePlaces(list, sites, { base: own.length })];
  const ground = farmGround(world, hAt, { cls: facts.cls, hgt: div.raster.hgt });
  let landKm2 = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) landKm2 += kmData(div).box.num[d];
  const run = g => { const t0 = Date.now(), m = growTowns(world, places, g, hAt, undefined, { ground }); return { m, ms: Date.now() - t0 }; };
  const one = run(1), f = one.m.farm, people = one.m.towns.reduce((a, t) => a + t.people, 0);
  // nearly everybody has the hectare: the land of the album has room for its people at this growth
  assert.ok(f.area > people / 100 * .97 && f.area <= people / 100 + 1, `${f.area.toFixed(0)} km² ploughed for ${people} people`);
  assert.ok(f.area / landKm2 > .025 && f.area / landKm2 < .045, `${(f.area / landKm2 * 100).toFixed(2)} % of the land under fields at growth 1`);
  assert.ok(f.list.length > 40000 && f.list.length < 100000, `${f.list.length} chunks have fields`);
  // nothing where nothing grows: no water, no mountain, nothing above the height where fields end, never more than the ground gives
  for (const c of f.list) {
    const k = facts.cls[c], d = div.cells[c];
    if (!(k >= 1 && k <= 4 && d >= 0 && div.kinds[d] === LAND && div.raster.hgt[c] < FARM_HIGH[1])) assert.fail(`chunk ${c}: class ${k}, ${div.raster.hgt[c]} m`);
    if (f.km[c] > Math.round(FARM_CAP[k] * 255) + 1) assert.fail(`chunk ${c} of class ${k} is ploughed to ${f.km[c]}`);
  }
  // a village: a square kilometre or so; a district: a few per cent; the districts of the great towns far more
  const vill = one.m.towns.filter(t => t.village), mean = vill.reduce((a, t) => a + t.ploughed, 0) / vill.length; assert.ok(mean > .6 && mean < 1.4, `a village ploughs ${mean.toFixed(2)} km²`);
  const per = farmOfDistricts(f, div.cells, div.count), shares = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND && kmData(div).box.num[d] > 50) shares.push(per[d] / kmData(div).box.num[d]);
  shares.sort((a, b) => a - b); assert.ok(shares[shares.length >> 1] > .012 && shares[shares.length >> 1] < .05 && shares[shares.length - 1] > .5, `a district in the middle is ${(shares[shares.length >> 1] * 100).toFixed(1)} % fields, the most ploughed ${(shares[shares.length - 1] * 100).toFixed(0)} %`);
  // the natural cells carry the same fields, for the forest and the far view
  let cellSum = 0; const cnt = cellsOfChunks(world).count; for (let k = 0; k < world.count; k++) if (one.m.fields[k] > FIELD_FLOOR) cellSum += one.m.fields[k] * cnt[k]; assert.ok(Math.abs(cellSum / f.area - 1) < .05);
  // growth 3: the settled land is ploughed from village to village
  const three = run(3), f3 = three.m.farm; assert.ok(f3.area / landKm2 > .18 && f3.area / landKm2 < .32, `${(f3.area / landKm2 * 100).toFixed(1)} % of the land under fields at growth 3`);
  assert.ok(f3.list.filter(c => f3.km[c] === 255).length > 50000, 'tens of thousands of chunks of farmland from edge to edge');
  assert.ok(one.ms < 2500 && three.ms < 4000, `the model: ${one.ms} ms at growth 1, ${three.ms} ms at growth 3`);
  // the chunk a point lies in is the chunk whose fields are read there
  const zar = one.m.towns.filter(t => !t.village).sort((a, b) => b.people - a.people)[0], out = new Uint8Array(KN * KN * 4); mirrorFarm(f, out);
  for (let n = 0; n < 200; n++) { const x = zar.x + (kmHash(n, 1, 77) - .5) * 30, y = zar.y + (kmHash(n, 2, 77) - .5) * 30, c = chunkAt(div.cells, x, y); if (c < 0) continue;
    // (where the nine chunks around the square of the point hold the same, its chunk is one of them)
    const o = squareOf(x, y) * 4; if (out[o + 3] === 255) assert.equal(farmAt(x, y, out), f.km[c] / 255); if (out[o + 3] === 0) { assert.equal(farmAt(x, y, out), 0); assert.equal(f.km[c], 0); } }
});
