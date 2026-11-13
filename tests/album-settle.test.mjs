// Settlements of the album (docs/album/settle.md): the shapes of the buildings, the rules of a patch, the model of
// growth and the plan of the blocks — everything that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';
import settle from '../src/album/aspects/settle.js';
import { RMAX, CELL, GN, GK, GX0, GY0, CULTURES, STAGES, stageOf, cellHash, cellRule, lobeOf, cellSize, radiusByte, radiusOf, radiusOfShare, siteBytes, gridOf, bend, unbend, cultureAt, fieldsBeyond, lanesBeyond,
  RULES_GLSL, PALETTE_GLSL, MAT } from '../src/album/town/rules.js';
import { buildShapes, KINDS, KIND, KIND_TITLES, MAX_TRIS, SLOTS } from '../src/album/town/shapes.js';
import { growTowns, fullRadius, reachOf, RCAP, FELL_FROM } from '../src/album/town/grow.js';
import { planLobe, planShowcase, ROW, FLAG_WATER } from '../src/album/town/plan.js';
import { mirrorSettle, mirrorFarm, farmAt, settleUniforms } from '../src/album/town/state.js';
import { yardAt, planYards, allYards, patchIndex, ploughed, yardPlace, YARD_KINDS, YARD_STEP, YARD_TILE, YARDS_PER_KM2, YARD_FARM } from '../src/album/town/yards.js';
import { farmsteadsOfAlbum, packLand, unpackLand, landBytes } from '../src/album/save/land.js';
import { KN, squareOf, districtOrder } from '../src/album/division/km.js';

// a flat land 300 m high with the sea east of x = 100 km and a steep ridge west of x = −400 km
const at = (x, y) => (x > 100 ? -50 : x < -400 ? 300 + (-400 - x) * 600 : 300);
const env = { at, river: () => 1e9, swamp: () => 0 };
const ch = new Chunks((lat, lon) => at(...kmOf(lat, lon)));             // one world for all the tests: its chunks have natural outlines
const place = (x, y, pop) => ({ ...llOf(x, y), pop });
const rows = flat => Array.from({ length: flat.length / ROW }, (_, i) => flat.slice(i * ROW, i * ROW + ROW));
const clear = () => { for (let k = 0; k < ch.count; k++) { ch.set('built', k, 0); ch.set('culture', k, 0); } };
const blank = () => new Uint8Array(GN * GN * 4);
const S = cellSize(20);
// where a block of the plan stands, km
const centreOf = r => { const c = Math.cos(r[2]), s = Math.sin(r[2]); return [r[0] + (c * r[4] - s * r[5]) * S, r[1] + (s * r[4] + c * r[5]) * S]; };
const patch = (x, y, r, cul = CULTURES.med) => { const [bx, by] = siteBytes(x, y), L = lobeOf(gridOf(x, y), bx, by, radiusByte(r), cul); L.rivals = []; return L; };

test('settle shapes: twenty-one kinds of a few triangles each, all in one small texture', () => {
  const s = buildShapes();
  assert.equal(KINDS.length, 21); assert.equal(KIND_TITLES.length, 21); assert.equal(new Set(KINDS).size, 21);
  assert.equal(s.width, SLOTS); assert.equal(s.height, 42); assert.equal(s.data.length, SLOTS * 42 * 4);
  assert.ok(s.data.length < 30000, `the shape texture is ${s.data.length} bytes`);
  s.tris.forEach((n, k) => assert.ok(n >= 12 && n <= MAX_TRIS, `${KINDS[k]}: ${n} triangles`));
  assert.ok(s.tris.reduce((a, b) => a + b) / KINDS.length < 48, 'on average under 48 triangles a block');
  for (const [k, sh] of s.shapes.entries()) for (const t of sh.t) {
    for (const p of t.p) assert.ok(Math.abs(p[0]) <= .5001 && Math.abs(p[1]) <= .5001 && p[2] >= -.0401 && p[2] < .59, `${KINDS[k]}: corner ${p} outside the footprint`);
    const [a, b, c] = t.p, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(g[0] * t.n[0] + g[1] * t.n[1] + g[2] * t.n[2] > 0, `${KINDS[k]}: a face is wound against its normal`);
    assert.ok(Math.abs(Math.hypot(...t.n) - 1) < 1e-6 && t.mat >= 0 && t.mat <= 10);
  }
  // heights are real against the plan: nothing but towers and sails rises above a quarter of a block
  for (const name of ['quarter', 'quarterU', 'quarterL', 'rows', 'lanes', 'terrace', 'cluster', 'farm', 'villa', 'house', 'market', 'site']) assert.ok(Math.max(...s.shapes[KIND[name]].t.flatMap(t => t.p.map(p => p[2]))) <= .2, name);
});

test('settle rules: real sizes, one hash and one rule for the plan and for the shader', () => {
  const seen = new Set(); let sum = 0;
  for (let i = -40; i < 40; i++) for (let j = -40; j < 40; j++) { const h = cellHash(i, j, 777, 1); assert.ok(h >= 0 && h < 1); seen.add(Math.floor(h * 64)); sum += h; }
  assert.equal(seen.size, 64, 'the hash fills its range'); assert.ok(Math.abs(sum / 6400 - .5) < .02);
  assert.equal(cellHash(3, -5, 1234, 2), cellHash(3, -5, 1234, 2)); assert.notEqual(cellHash(3, -5, 1234, 2), cellHash(3, -5, 1234, 3));
  for (const d of [`#define SET_RMAX ${RMAX.toFixed(4)}`, `#define SET_GN ${GN}`, `#define SET_GK ${GK.toFixed(1)}`, 'float setHash(ivec2 id, int k, int salt)', 'float setWob(vec2 pk)', 'vec2 setBend(vec2 q, float th)', 'float setCell(']) assert.ok(RULES_GLSL.includes(d), d);
  assert.ok(PALETTE_GLSL.includes('vec3 settleMat(int m, float atl, float t)')); assert.equal(Object.keys(MAT).length, 11);
  // one to one: a block with its street is 85 m at any camera height; the knob alone changes it
  assert.equal(CELL, .085); assert.equal(cellSize(20), cellSize(500)); assert.equal(cellSize(20, 2), CELL * 2);
  // a radius survives its byte, finely for small settlements
  assert.equal(radiusByte(0), 0); assert.equal(radiusByte(RMAX), 255);
  for (const r of [.07, .15, .3, .85, 2.2, 5]) assert.ok(Math.abs(radiusOf(radiusByte(r)) - r) < Math.max(.008, r * .02), `radius ${r}`);
  assert.ok(Math.abs(Math.PI * radiusOfShare(.25, 100) ** 2 - 25) < 1e-9, 'the patch of a brushed chunk has the area of its built share');
  const L = patch(-205, 4405, .85);
  assert.ok(Math.abs(L.x + 205) < .04 && Math.abs(L.y - 4405) < .04 && Math.abs(L.r - .85) < .02 && L.k === gridOf(-205, 4405));
  assert.deepEqual(STAGES.map(s => stageOf(s.r + .01)), [0, 1, 2, 3, 4]); assert.ok(fieldsBeyond(.07) < 1 && fieldsBeyond(.85) > 2);
  assert.equal(cultureAt(43.25, -2.93), CULTURES.atl); assert.equal(cultureAt(41.65, -.89), CULTURES.med);
  // the lattice is bent, and the bend can be undone
  for (const [x, y] of [[0, 0], [3.5, -2], [-7, 9.25]]) { const [u, v] = unbend(L, x, y), [bx, by] = bend(L, u, v); assert.ok(Math.abs(bx - x) < 1e-3 && Math.abs(by - y) < 1e-3); }
});

test('settle rules: what stands in a cell follows the size and the manner of the settlement', () => {
  const count = L => { const n = {}; for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) { const c = cellRule(i, j, L, S); if (c) n[c.cls] = (n[c.cls] || 0) + 1; } return n; };
  const hamlet = patch(-205, 4405, .07), town = patch(-205, 4405, .5), city = patch(-205, 4405, .85), atl = patch(-205, 4405, .85, CULTURES.atl);
  const h = count(hamlet), t = count(town), c = count(city), a = count(atl);
  assert.ok(h[3] >= 2 && h[3] <= 9 && !h[1] && !h[2] && !h[4], `a hamlet is a few farmsteads: ${JSON.stringify(h)}`);
  assert.ok(t[4] === 1 && t[1] > 3 && t[2] > 10 && t[3] > 10, `a small town has a square, blocks, rows and houses: ${JSON.stringify(t)}`);
  assert.ok(c[1] > t[1] * 2 && c[1] + c[2] > 120, `a city has hundreds of blocks: ${JSON.stringify(c)}`);
  assert.ok(a[3] > 100 && !a[1] && !a[2] && !a[4], `the Atlantic manner is loose farmsteads only: ${JSON.stringify(a)}`);
  assert.ok(a[3] < (c[1] + c[2] + c[3]) * .85, 'and stands looser');
  assert.ok(t[5] > 0 && c[5] > 0, `building sites stand just outside a growing settlement: ${t[5]}, ${c[5]}`);
  assert.equal(cellRule(0, 0, city, S).cls, 4); assert.equal(cellRule(0, 0, hamlet, S).cls, 3);
  // every footprint stays inside its cell
  for (const L of [hamlet, town, city]) for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) { const r = cellRule(i, j, L, S); if (r) assert.ok(Math.abs(r.ox) + r.hx <= .5001 && Math.abs(r.oy) + r.hy <= .5001, `cell ${i},${j}`); }
  // the plan is the same from any height: the rule does not know the camera
  assert.deepEqual(cellRule(3, -2, city, cellSize(20)), cellRule(3, -2, city, cellSize(300)));
});

test('settle growth: a place grows from a hamlet to a city and writes houses, fields and felling into the chunks', () => {
  const pl = [place(-205, 4405, 650000)];
  const stages = [.082, .176, .33, .59, 1].map(g => growTowns(ch, pl, g, at));
  assert.deepEqual(stages.map(s => s.towns[0].stage), [0, 1, 2, 3, 4]);
  const home = stages[4].towns[0].home; assert.equal(home, ch.at(pl[0].lat, pl[0].lon)); assert.equal(ch.kind[home], 1);
  for (let i = 1; i < stages.length; i++) {
    assert.ok(stages[i].towns[0].R > stages[i - 1].towns[0].R && stages[i].built[home] >= stages[i - 1].built[home], 'more growth, more houses');
    assert.ok(stages[i].fields.reduce((a, b) => a + b) > stages[i - 1].fields.reduce((a, b) => a + b) && stages[i].farm.area > stages[i - 1].farm.area, 'and more fields');
    // a hamlet and a village clear only their own ground; from FELL_FROM on a settlement thins the forest of its chunks
    const k1 = stages[i].keep.reduce((a, b) => a + b), k0 = stages[i - 1].keep.reduce((a, b) => a + b);
    if (stages[i].towns[0].R >= FELL_FROM) assert.ok(k1 < k0, 'and less forest'); else assert.equal(k1, k0, 'a village leaves the forest of its chunk alone');
  }
  const m = stages[4], t = m.towns[0];
  assert.ok(t.R < 1 && t.R > .7, `a city of its time is under two km across: ${t.R}`);
  assert.equal(t.byte, Math.max(1, Math.round(Math.PI * t.R ** 2 / ch.area[home] * 255))); assert.ok(Math.abs(m.built[home] - t.byte / 255) < 1e-6);
  assert.ok(m.fields[home] > .15 && m.keep[home] < .85 && m.keep[home] < 1 - m.fields[home], 'around the houses the land is ploughed and the forest felled');
  assert.ok(Math.abs(t.ploughed - t.people / 100) < .05 && Math.abs(m.farm.area - t.ploughed) < 1e-3, `a hectare a person: ${t.people} people plough ${t.ploughed.toFixed(1)} km²`);
  const far = ch.at(...Object.values(llOf(-145, 4405)).slice(0, 2)); assert.equal(m.keep[far], 1, 'far away the forest stands untouched'); assert.equal(m.fields[far], 0);
  assert.equal(growTowns(ch, pl, 0, at).towns.length, 0, 'no growth, no settlement');
  assert.ok(fullRadius(15000) < .2 && fullRadius(5.6e6) > 1.4 && fullRadius(5.6e6) <= RCAP);
});

test('settle growth: natural chunks — nothing is founded on water, one settlement a chunk, a river is a limit', () => {
  // a place in the sea two km off the shore moves to dry land; one far out is not founded at all
  const coast = growTowns(ch, [place(102, 4405, 300000), place(160, 4405, 300000)], 1, at);
  assert.equal(coast.towns.length, 1); assert.ok(coast.towns[0].x <= 100 && at(coast.towns[0].x, coast.towns[0].y) > 0 && ch.kind[coast.towns[0].home] === 1);
  const two = growTowns(ch, [place(-205.3, 4405, 20000), place(-204.7, 4405, 900000)], 1, at);
  assert.equal(two.towns.length, 1); assert.equal(two.towns[0].index, 1, 'the larger place takes the chunk');
  // on the steep ridge nothing is ploughed: a town at its foot has all its fields on the level side
  const hill = growTowns(ch, [place(-399, 4405, 650000)], 1, at), flat = growTowns(ch, [place(-205, 4405, 650000)], 1, at);
  assert.ok(hill.farm.area > 50 && Math.abs(hill.farm.area - flat.farm.area) < 1, `fields by the ridge ${hill.farm.area.toFixed(1)} km², on the plain ${flat.farm.area.toFixed(1)} km²`);
  assert.ok([...hill.farm.list].every(c => c % KN >= 480), 'no chunk of the ridge is ploughed'); assert.ok([...flat.farm.list].some(c => c % KN < 675) && [...flat.farm.list].some(c => c % KN > 675), 'on the plain the fields lie on every side');
  // a river runs north–south at x = −205.2: the settlement is moved off it until its houses touch the bank
  const river = (x, y) => Math.abs(x + 205.2) - .1, m = growTowns(ch, [place(-205, 4405, 650000)], 1, at, river), t = m.towns[0];
  assert.ok(river(t.x, t.y) >= t.R * 1.05, `the site stands ${river(t.x, t.y).toFixed(2)} km from the bank, the houses reach ${t.R.toFixed(2)} km`);
  assert.ok(t.x > -205 && Math.abs(t.y - 4405) < .2, 'it stays on its own bank');
  // fields and felling spread over land from chunk to chunk
  const ok = reachOf(ch, t.home, 2, 1); assert.ok(ok.size > 3 && [...ok.keys()].every(k => ch.kind[k] === 1));
  assert.ok(reachOf(ch, t.home, 0, 1).size === 1);
});

test('settle mirror and plan: the blocks are drawn from the state of the chunks', () => {
  clear();
  assert.equal(mirrorSettle(ch, [], blank()).lobes.length, 0);
  // the model founds a settlement; the mirror gives it a patch of its real size at its site
  const counts = [];
  for (const g of [.082, .176, .33, .59, 1]) {
    clear();
    const m = growTowns(ch, [place(-205, 4405, 650000)], g, at), t = m.towns[0]; ch.set('built', t.home, m.built[t.home]);
    const out = blank(), { lobes, changed } = mirrorSettle(ch, m.towns, out), L = lobes[0];
    assert.ok(changed); assert.equal(lobes.length, 1); assert.equal(L.home, t.home);
    assert.ok(Math.abs(L.r - t.R) < .02 && Math.hypot(L.x - t.x, L.y - t.y) < .06, 'the patch is the settlement of the model');
    const gq = gridOf(t.x, t.y); assert.equal(out[gq * 4 + 2], radiusByte(t.R)); assert.equal(out[gq * 4 + 3], 200 + CULTURES.med);
    assert.equal(out[(gq + 1) * 4 + 3], 0, 'a settlement in the middle of its square is no business of the squares around'); assert.equal(out[(gq - GN) * 4 + 3], 0); assert.equal(out[(gq + 3) * 4 + 3], 0);
    const plan = rows(planLobe(L, S, env)); counts.push(plan.length);
    for (const r of plan) assert.ok(r[3] >= 0 && r[3] < KINDS.length && r[8] > 0 && r[8] <= 2 && r[9] > 0 && r[9] <= 2 && r[10] >= 0 && r[10] <= 1, `row ${r}`);
    for (const r of plan) assert.ok(Math.hypot(...centreOf(r).map((v, i) => v - [L.x, L.y][i])) < L.r + .6, 'a block far outside its patch');
  }
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1] * 1.3, `blocks by the size of the settlement: ${counts}`);
  // a settlement by the edge of its square: the square its fields reach into knows of it, the others do not
  { clear();
    const m = growTowns(ch, [place(-200.6, 4405, 650000)], 1, at), t = m.towns[0]; ch.set('built', t.home, m.built[t.home]);
    const out = blank(); mirrorSettle(ch, m.towns, out); const gq = gridOf(t.x, t.y);
    assert.equal(out[(gq + 1) * 4 + 3], 1 + 3, 'the square to the east knows which one holds the patch'); assert.equal(out[(gq - 1) * 4 + 3], 0); assert.equal(out[(gq + GN) * 4 + 3], 0); }
  assert.ok(counts[0] >= 2 && counts[0] <= 12 && counts[4] > 200 && counts[4] < 500, `from a hamlet to a city: ${counts}`);
  // a chunk built up by a brush, with no model behind it: a patch in its middle, of the area of its built share, in its own manner
  clear();
  const k = ch.at(...Object.values(llOf(-305, 4505)).slice(0, 2)); ch.set('built', k, .02); ch.set('culture', k, CULTURES.atl / 255);
  const { lobes } = mirrorSettle(ch, [], blank()), L = lobes[0];
  assert.equal(lobes.length, 1); assert.equal(L.home, k); assert.equal(L.cul, CULTURES.atl);
  assert.ok(Math.hypot(L.x - ch.cx[k], L.y - ch.cy[k]) < .06 && Math.abs(L.r - radiusOfShare(ch.get('built', k), ch.area[k])) < .03);
  const kinds = new Set(rows(planLobe(L, S, env)).map(r => KINDS[r[3]]));
  assert.ok(!kinds.has('quarter') && !kinds.has('market') && kinds.has('farm') && kinds.has('house'), [...kinds].join());
  // two patches in neighbouring squares are rivals; a square between two knows both
  ch.set('built', ch.at(...Object.values(llOf(-285, 4505)).slice(0, 2)), .02);
  const two = blank(), pair = mirrorSettle(ch, [], two);
  if (pair.lobes.length === 2 && Math.abs(pair.lobes[0].gx - pair.lobes[1].gx) + Math.abs(pair.lobes[0].gy - pair.lobes[1].gy) === 1) assert.ok(pair.lobes.every(P => P.rivals.length === 1));
  assert.ok(pair.lobes.length >= 1);
  clear();
});

test('settle plan: special buildings by the size of the settlement; nothing on water, on a slope, in a swamp or on a river', () => {
  const kindsOf = plan => { const n = {}; for (const r of plan) n[KINDS[r[3]]] = (n[KINDS[r[3]]] || 0) + 1; return n; };
  const village = kindsOf(rows(planLobe(patch(-205, 4405, .15), S, env))), town = kindsOf(rows(planLobe(patch(-205, 4405, .5), S, env))), city = kindsOf(rows(planLobe(patch(-205, 4405, .85), S, env)));
  assert.ok(!village.temple && !village.market && !village.fort && !village.quarter, JSON.stringify(village));
  assert.ok(town.temple === 1 && town.market === 1 && town.mill === 2 && !town.fort && town.site > 0, JSON.stringify(town));
  assert.ok((town.quarter || 0) + (town.quarterU || 0) + (town.quarterL || 0) + (town.palace || 0) > 3, JSON.stringify(town));
  assert.ok(city.fort === 1 && city.temple >= 1 && city.mill === 3 && city.house > 10 && city.farm > 3, JSON.stringify(city));
  // variety: a city is built of many kinds of blocks
  assert.ok(Object.keys(city).length >= 14, `kinds in a city: ${Object.keys(city).join()}`);
  for (const k of ['quarter', 'quarterU', 'quarterL', 'rows', 'lanes', 'terrace', 'cluster']) assert.ok(city[k] > 2, `${k}: ${city[k]}`);
  // a town on the shore: no block stands in the sea, and a pier reaches over the water
  const shore = patch(99.75, 4405, .5), plan = rows(planLobe(shore, S, env));
  assert.ok(plan.length > 30);
  for (const r of plan) if (!(r[7] & FLAG_WATER)) assert.ok(at(...centreOf(r)) > 0, 'a block in the sea');
  const piers = plan.filter(r => KINDS[r[3]] === 'pier'); assert.equal(piers.length, 1); assert.ok(piers[0][7] & FLAG_WATER && Math.abs(piers[0][0] - 100) < .1, 'the pier stands on the shoreline');
  // on the steep ridge, in a swamp and along a river nothing stands
  assert.equal(planLobe(patch(-450, 4405, .5), S, env).length, 0);
  assert.equal(planLobe(patch(-205, 4405, .5), S, { ...env, swamp: () => .8 }).length, 0);
  const L = patch(-205, 4405, .5), free = rows(planLobe(L, S, env)), cut = rows(planLobe(patch(-205, 4405, .5), S, { ...env, river: (x, y) => Math.abs(y - L.y) - .06 }));
  assert.ok(cut.length < free.length - 5); for (const r of cut) assert.ok(Math.abs(centreOf(r)[1] - L.y) > .06, 'a block on the river');
});

test('settle plan: two patches that meet leave an open strip, their blocks never run into each other', () => {
  const A = patch(-205, 4405, 1.2), B = patch(-203.2, 4405.4, 1.0); B.k = A.k + 1; A.rivals = [B]; B.rivals = [A];
  const pts = [A, B].flatMap(L => rows(planLobe(L, S, env)).filter(r => r[4] || r[5]).map(r => [...centreOf(r), L.k]));
  assert.ok(pts.length > 500, `${pts.length} blocks`);
  const grid = new Map(); let clash = 0;
  for (const p of pts) { const key = `${Math.floor(p[0] / .1)},${Math.floor(p[1] / .1)}`; (grid.get(key) || grid.set(key, []).get(key)).push(p); }
  for (const p of pts) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of grid.get(`${Math.floor(p[0] / .1) + dx},${Math.floor(p[1] / .1) + dy}`) || []) if (q[2] !== p[2] && Math.hypot(p[0] - q[0], p[1] - q[1]) < S * .5) clash++;
  assert.equal(clash, 0, 'blocks of two patches overlap');
});

test('settle album: the aspect, its knobs and its pages', () => {
  assert.match(settle.glsl, /void aspSettle\(Px p, inout Land L\)/);
  assert.equal(settle.uniforms, settleUniforms); assert.ok(settle.uniforms.tSettle.value.isDataTexture && settle.uniforms.uSettle.value.isVector4);
  assert.equal(Object.values(settle.uniforms).filter(u => u.value?.isTexture).length, 1, 'one texture of its own in the ground shader');
  assert.ok(!/models\.json|GLTFLoader/.test(settle.glsl));
  const keys = new Set(DEFS.map(d => d.key)); for (const k of ['houses', 'houseH', 'growth', 'towns', 'showcase']) assert.ok(keys.has(k), k);
  assert.equal(DEFS.find(d => d.key === 'houses').value, 1, 'houses stand at their real size unless the knob is moved');
  const ids = settle.pages.map(p => p.id);
  for (const id of ['town-kinds', 'grow-1', 'grow-2', 'grow-3', 'grow-4', 'grow-5', 'town-50', 'town-200', 'town-500', 'town-med', 'town-atl', 'fields', 'town-build', 'town-night']) assert.ok(ids.includes(id), id);
  assert.ok(settle.pages.every(p => p.group === 'Города и дороги' && PAGES.includes(p)));
  const cams = Object.fromEntries(settle.pages.map(p => [p.id, p.cam.h]));
  assert.ok(cams['grow-1'] === 20 && cams['town-50'] === 50 && cams['town-200'] === 200 && cams['town-500'] === 500);
  const showcase = rows(planShowcase(0, 4400, 3));
  assert.equal(showcase.length, 42); assert.deepEqual([...new Set(showcase.map(r => r[3]))].sort((a, b) => a - b), KINDS.map((_, i) => i)); assert.equal(showcase.filter(r => r[7] & 1).length, 21);
  { const seen = new Set(showcase.map(r => `${r[0].toFixed(2)},${r[1].toFixed(2)}`)); assert.equal(seen.size, 42, 'no two blocks of the showcase stand on one spot'); }
});

test('settle classes: the mark of a settlement follows its people, as the owner set it', async () => {
  const { CLASSES, classOf, peopleOf } = await import('../src/album/town/rules.js');
  assert.deepEqual(CLASSES.map(c => c.mark), ['circle', 'triangle', 'diamond', 'square', 'pentagon']);
  assert.deepEqual([0, 999, 1000, 19999, 20000, 59999, 60000, 999999, 1e6, 3e7].map(n => classOf(n)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([5, 10, 50, 300, 1500].map(a => classOf(0, a)), [0, 1, 2, 3, 4], 'a place that sprawls is of a higher class');
  assert.ok(peopleOf(.1) < 1000 && peopleOf(.22) < 1000 && peopleOf(.4) >= 1000 && peopleOf(2.2) >= 60000, 'a hamlet and a village are villages, a full-grown city is a city');
  clear();
  const m = growTowns(ch, [place(-205, 4405, 5.6e6), place(-405, 4455, 20000)], 3, at);
  const big = m.towns.find(t => t.index === 0), small = m.towns.find(t => t.index === 1);
  assert.equal(big.cls, 3); assert.equal(big.people, peopleOf(big.R)); assert.equal(small.cls, classOf(small.people));
  const { MARK_FROM, markSvg } = await import('../src/album/layers/labels.js');
  assert.ok(MARK_FROM[0] < 60 && MARK_FROM.every((h, i) => !i || h > MARK_FROM[i - 1]), 'villages are marked only from close by, greater places from higher');
  for (let c = 0; c < 5; c++) assert.match(markSvg(c), c === 0 ? /<circle/ : c === 3 ? /<rect/ : /<polygon/);
  const ids = settle.pages.map(p => p.id); assert.ok(ids.includes('town-marks') && ids.includes('town-marks-near') && ids.includes('town-districts') && ids.includes('town-districts-map'));
});

test('settle by districts: a settlement at the centre of every district — the album places keep their numbers, the rest follow', async () => {
  const { centrePlaces, HAMLET_POP, fullRadius: fr } = await import('../src/album/town/grow.js');
  // small places: a hamlet, a village, and no jump where the villages end
  assert.ok(fr(100) === fr(300) && fr(300) < fr(1000) && fr(1000) < fr(5000) && fr(5000) < fr(15000));
  assert.ok(Math.abs(fr(14999) - fr(15000)) < .002 && fr(HAMLET_POP) >= .04 && fr(HAMLET_POP) < .08, 'a hamlet is founded at full growth');
  assert.ok(stageOf(fr(HAMLET_POP)) === 0 && stageOf(fr(15000)) === 1 && (await import('../src/album/town/rules.js')).classOf((await import('../src/album/town/rules.js')).peopleOf(fr(15000))) === 0, 'a place of 15 000 today was a village');
  const base = [place(-205, 4405, 5e5), place(-305, 4455, 9e4)];
  const sites = [{ pop: 5e5, name: 'А' }, { pop: 9e4, name: 'Б' }, { pop: 3000, name: 'Село' }];
  // five districts: two stand on the album's places, one on a real village, one on bare ground, one is water
  const div = { count: 5, kinds: [0, 0, 0, 0, 1], centres: { x: Float64Array.of(-205, -305, -250, -150, NaN), y: Float64Array.of(4405, 4455, 4480, 4380, NaN), site: Int32Array.of(0, 1, 2, -1, -1), texel: Int32Array.of(5, 6, 7, 8, -1) } };
  const all = centrePlaces(base, div, sites);
  assert.equal(all.length, 4); assert.equal(all[0], base[0]); assert.equal(all[1], base[1]);
  assert.deepEqual([all[2].pop, all[2].name, all[2].district], [3000, 'Село', 2]); assert.deepEqual([all[3].pop, all[3].name, all[3].district], [HAMLET_POP, '', 3]);
  const [x, y] = kmOf(all[2].lat, all[2].lon); assert.ok(Math.abs(x + 250) < 1e-6 && Math.abs(y - 4480) < 1e-6);
  assert.deepEqual(centrePlaces(base, null), base); assert.deepEqual(centrePlaces(base, { count: 0, kinds: [] }), base);
  // the model founds them all: the village is a village, the bare centre a hamlet, each in its own chunk
  clear();
  const m = growTowns(ch, all, 1, at);
  assert.equal(m.towns.length, 4); assert.deepEqual(m.towns.map(t => t.index).sort(), [0, 1, 2, 3]);
  const byIndex = Object.fromEntries(m.towns.map(t => [t.index, t]));
  assert.ok(byIndex[3].R < byIndex[2].R && byIndex[2].R < byIndex[1].R && byIndex[1].R < byIndex[0].R);
  assert.equal(byIndex[3].cls, 0); assert.equal(byIndex[2].cls, 0);
  assert.equal(growTowns(ch, all, .5, at).towns.length, 3, 'at half growth the hamlet is not there yet');
});

// ---- yards among the fields (src/album/town/yards.js)
// every yard of the tiles of the plan around a point, as rows
const yardsAround = (ctx, x, y, km = 8) => {
  const T = YARD_TILE * YARD_STEP, out = [];
  for (let tj = Math.floor((y - km - GY0) / T); tj <= Math.floor((y + km - GY0) / T); tj++) for (let ti = Math.floor((x - km - GX0) / T); ti <= Math.floor((x + km - GX0) / T); ti++) out.push(...rows(planYards(ctx, ti, tj)));
  return out;
};
// a world where every chunk is ploughed from edge to edge, unless a test says otherwise
const yardCtx = (list, extra = {}) => ({ cell: ch.cell, land: c => ch.kind[c] === 1, farm: () => 1, culture: () => CULTURES.med, patches: patchIndex(list), env, density: 1, S: CELL, ...extra });
// a town as the model founds it, with the fields it ploughs: its patch and what a yard must know of its chunks
function ploughedTown(x, y, pop = 650000) {
  const m = growTowns(ch, [place(x, y, pop)], 1, at), t = m.towns[0], bytes = new Uint8Array(KN * KN * 4); mirrorFarm(m.farm, bytes);
  return { L: { x: t.x, y: t.y, r: t.R, th: .4 }, m, farm: (px, py) => farmAt(px, py, bytes), farmList: m.farm.list };
}

test('yards: sixteen places a square kilometre; a yard stands only in a chunk of farmland, and never among the houses of a settlement', () => {
  const town = ploughedTown(-205.3, 4405.2), L = town.L, W = fieldsBeyond(L.r), ctx = yardCtx([L], { farm: town.farm, farmList: town.farmList });
  const yards = yardsAround(ctx, L.x, L.y, 12);
  assert.ok(yards.length > town.m.farm.area * 1.5 && yards.length < town.m.farm.area * 3, `${yards.length} yards on ${town.m.farm.area.toFixed(0)} km² of fields`);
  assert.deepEqual(yardsAround(ctx, L.x, L.y, 12), yards, 'the same every time');
  const names = new Set(yards.map(r => KINDS[r[3]])); assert.deepEqual([...names].sort(), [...YARD_KINDS].sort(), 'every kind of yard is there, and nothing else');
  for (const r of yards) {
    const d = Math.hypot(r[0] - L.x, r[1] - L.y);
    assert.ok(d > L.r + .4, `a yard ${(d - L.r).toFixed(2)} km from the last houses`);
    assert.ok(town.farm(r[0], r[1]) > .3, 'a yard outside the fields');
    const i = Math.floor((r[0] - GX0) / YARD_STEP), j = Math.floor((r[1] - GY0) / YARD_STEP);
    assert.ok(Math.abs(r[0] - (GX0 + (i + .5) * YARD_STEP)) <= .0701 && Math.abs(r[1] - (GY0 + (j + .5) * YARD_STEP)) <= .0701, 'a yard stands by the middle of its place');
    assert.deepEqual(yardAt(ctx, i, j), r, 'the place of a yard gives the yard back');
    assert.ok(r[8] > .5 && r[8] < 1 && r[9] > .5 && r[9] < 1 && r[10] >= 0 && r[10] < 1 && r[7] === 0);
    // not on the lanes that run out of the settlement — they end a little way past its last houses
    const cs = Math.cos(L.th), sn = Math.sin(L.th), q = bend(L, (cs * (r[0] - L.x) + sn * (r[1] - L.y)) / CELL, (-sn * (r[0] - L.x) + cs * (r[1] - L.y)) / CELL);
    if (d < L.r + lanesBeyond(L.r)) assert.ok(Math.min(Math.abs(q[0] - .5), Math.abs(q[1] - .5)) * CELL >= Math.max(r[8], r[9]) * .5 * CELL, 'a yard on a lane');
  }
  assert.ok(lanesBeyond(.1) < .2 && lanesBeyond(1) < fieldsBeyond(1) / 4, 'the lanes end by the houses; the tracks and the roads lead on');
  // no two yards closer than a hundred metres: their plots never overlap
  for (let a = 0; a < yards.length; a++) for (let b = a + 1; b < yards.length; b++) assert.ok(Math.hypot(yards[a][0] - yards[b][0], yards[a][1] - yards[b][1]) > .1);
  // the knob: more yards, and those that stood stay where they were; none at zero
  const key = r => `${r[0]},${r[1]}`, thick = yardsAround({ ...ctx, density: 3 }, L.x, L.y, 12), thickSet = new Set(thick.map(key));
  assert.ok(thick.length > yards.length * 2 && yards.every(r => thickSet.has(key(r))));
  assert.equal(yardsAround({ ...ctx, density: 0 }, L.x, L.y, 12).length, 0);
  // the Atlantic manner: about twice as many, turned any way, under dark roofs
  const atl = yardsAround({ ...ctx, culture: () => CULTURES.atl }, L.x, L.y, 12);
  assert.ok(atl.length > yards.length * 1.4 && atl.length < yards.length * 2.8, `${atl.length} Atlantic yards against ${yards.length}`);
  assert.ok(atl.every(r => r[7] === 1) && new Set(atl.map(r => Math.round(r[2] * 4))).size > 12, 'Atlantic yards stand any way');
  assert.ok(new Set(yards.map(r => Math.round(((r[2] - .5236) % 1.5707963 + 1.5707963) % 1.5707963 * 10))).size <= 6, 'Mediterranean yards stand along the furlongs');
  assert.equal(YARDS_PER_KM2[CULTURES.atl], 2 * YARDS_PER_KM2[CULTURES.med]);
  // nothing ploughed: no yards; a land ploughed from edge to edge has them without a settlement; the less of a
  // chunk is ploughed, the fewer
  assert.equal(yardsAround(yardCtx([], { farm: () => 0 }), L.x, L.y).length, 0);
  const open = yardsAround(yardCtx([]), L.x, L.y, 4), part = yardsAround(yardCtx([], { farm: () => .5 }), L.x, L.y, 4);
  assert.ok(open.length > 300 && open.length < 520, `${open.length} yards on 144 km² ploughed from edge to edge`);
  assert.ok(part.length > open.length * .05 && part.length < open.length * .6, `${part.length} yards where half the land is ploughed`); assert.equal(yardsAround(yardCtx([], { farm: () => .2 }), L.x, L.y, 4).length, 0);
  // a yard stands in a chunk of farmland only: one ploughed for the greater part
  const km = town.m.farm.km, inFarmland = yardsAround({ ...ctx, farmSquare: (kx, ky) => km[ky * KN + kx] / 255 }, L.x, L.y, 12), all = new Set(yards.map(key));
  assert.equal(YARD_FARM, .5); assert.ok(inFarmland.length > yards.length * .7 && inFarmland.length < yards.length && inFarmland.every(r => all.has(key(r))), `${inFarmland.length} of ${yards.length} yards stand in chunks of farmland`);
  for (const r of inFarmland) assert.ok(km[squareOf(r[0] - (r[0] - GX0) % YARD_STEP + YARD_STEP / 2, r[1] - (r[1] - GY0) % YARD_STEP + YARD_STEP / 2)] >= 128);
  // how surely the land is ploughed: by the share of its chunk; in a chunk ploughed in part, more beside the houses
  assert.equal(ploughed(0), 0); assert.equal(ploughed(1), 1); assert.equal(ploughed(.5), .5); assert.ok(ploughed(.8) === 1 && ploughed(.2) === 0, 'fields keep together');
  assert.ok(ploughed(.4, 0, .9) > ploughed(.4, -.5 * fieldsBeyond(.9), .9) && ploughed(.4, -.5 * fieldsBeyond(.9), .9) > ploughed(.4, -fieldsBeyond(.9), .9)); assert.equal(ploughed(.4, -fieldsBeyond(.9), .9), ploughed(.4)); assert.equal(ploughed(0, 0, .9), 0);
});

test('yards: never on water, a river, a swamp, a steep slope or a road', () => {
  const shore = { x: 99.2, y: 4405.2, r: .9 }, onShore = yardsAround(yardCtx([shore]), shore.x, shore.y);
  assert.ok(onShore.length > 3 && onShore.every(r => r[0] < 99.95), `${onShore.length} yards by the shore, one of them in the sea`);
  const ridge = { x: -400.6, y: 4405.2, r: .9 }, byRidge = yardsAround(yardCtx([ridge]), ridge.x, ridge.y);
  assert.ok(byRidge.length > 3 && byRidge.every(r => r[0] > -400.05), `${byRidge.length} yards by the ridge, one of them on a slope of six in ten`);
  const L = { x: -205.3, y: 4405.2, r: .9 }, all = yardsAround(yardCtx([L]), L.x, L.y);
  assert.equal(yardsAround(yardCtx([L], { env: { ...env, swamp: () => .5 } }), L.x, L.y).length, 0);
  // a river 60 m wide along x = −204 and a road along y = 4406.5: the yards keep off both, the rest stand as they stood
  const river = x => Math.abs(x + 204) - .03, road = y => Math.abs(y - 4406.5);
  const kept = yardsAround(yardCtx([L], { env: { ...env, river: x => river(x), road: (x, y) => road(y) } }), L.x, L.y);
  assert.ok(kept.length < all.length && kept.length > all.length * .6);
  for (const r of kept) { const half = Math.max(r[8], r[9]) * .5 * CELL; assert.ok(river(r[0]) >= half + .03 && road(r[1]) >= half + .03); }
  const keys = new Set(all.map(r => `${r[0]},${r[1]}`)); assert.ok(kept.every(r => keys.has(`${r[0]},${r[1]}`)));
});

test('yards: light blocks with their own plot; the knob and the pages are in the album', () => {
  const s = buildShapes();
  for (const k of YARD_KINDS) {
    assert.ok(s.tris[KIND[k]] <= 33, `${k}: ${s.tris[KIND[k]]} triangles`);
    const plot = s.shapes[KIND[k]].t.filter(t => t.mat === MAT.plot);
    assert.equal(plot.length, 2); assert.ok(plot.every(t => t.n[2] > .99 && t.p.every(p => p[2] > 0 && p[2] < .01)), 'the plot lies flat just over the ground');
  }
  assert.ok(KINDS.every((k, i) => YARD_KINDS.includes(k) || !s.shapes[i].t.some(t => t.mat === MAT.plot)), 'the blocks of a settlement have no plot: their ground is painted');
  assert.match(PALETTE_GLSL, /m == 10/);
  const knob = DEFS.find(d => d.key === 'yards'); assert.ok(knob && knob.value === 1 && knob.min === 0 && knob.max * YARDS_PER_KM2[CULTURES.atl] <= 16.001, 'at most every place is taken');
  const ids = settle.pages.map(p => p.id); for (const id of ['yards', 'yards-dense', 'yards-atl', 'yards-50']) assert.ok(ids.includes(id), id);
  assert.equal(settle.pages.find(p => p.id === 'yards-dense').p.yards, 3);
});

test('yards in the save: a chunk of 1 km² and one of its sixteen places; the chunks of a district are counted from its centre outward', () => {
  // sixteen places in a chunk, each with its own number
  const seen = new Set(); for (let j = 8; j < 12; j++) for (let i = 4; i < 8; i++) { const p = yardPlace(i, j); assert.deepEqual([p.kx, p.ky], [1, 2]); seen.add(p.slot); }
  assert.equal(seen.size, 16); assert.deepEqual(yardPlace(4, 8), { kx: 1, ky: 2, slot: 0 }); assert.deepEqual(yardPlace(7, 11), { kx: 1, ky: 2, slot: 15 });
  const town = ploughedTown(-205.3, 4405.2), L = town.L, ctx = yardCtx([L], { farm: town.farm, farmList: town.farmList });
  // every yard of the map is found, the same as tile by tile
  const all = allYards(ctx), around = yardsAround(ctx, L.x, L.y, 16);
  assert.equal(all.length, around.length); assert.ok(all.length > 100 && all.every(y => Math.hypot(y.x - L.x, y.y - L.y) < 12));
  // two districts of land, west and east of the line x = −205 (column 675 of the lattice of chunks), each with its
  // centre 3 km from the line; east of column 980 the sea
  const cells = new Int32Array(KN * KN), cls = new Uint8Array(KN * KN).fill(1);
  for (let c = 0; c < cells.length; c++) { const i = c % KN; cells[c] = i >= 980 ? 2 : i < 675 ? 0 : 1; }
  const div = { count: 3, cells, kinds: [0, 0, 2], cx: [L.x - 3, L.x + 3, 300], cy: [L.y, L.y, L.y] };
  const steepOne = squareOf(L.x - 5, L.y); cls[steepOne] = 4;                       // one chunk of steep ground among the level ones
  const order = districtOrder(div, { cls });
  // the chunk of the centre is the first of its district; the numbers grow outward; level ground comes before steep
  assert.equal(order.rank[squareOf(L.x - 3, L.y)], 0); assert.equal(order.rank[squareOf(L.x + 3, L.y)], 0); assert.equal(order.rank[squareOf(150, L.y)], -1, 'a chunk of water has no number');
  assert.ok(order.rank[squareOf(L.x - 9, L.y)] > order.rank[squareOf(L.x - 5.5, L.y + 3)] && order.rank[squareOf(L.x - 5.5, L.y + 3)] > order.rank[squareOf(L.x - 4, L.y)]);
  assert.ok(order.rank[steepOne] > order.rank[squareOf(L.x - 6.5, L.y)], 'the steep chunk 2 km from the centre is taken up after the level one 3.5 km from it');
  { const d0 = order.list.subarray(order.first[0], order.first[1]); assert.equal(d0.length, 675 * KN); assert.equal(new Set(d0).size, d0.length); assert.ok(d0.every((c, r) => r > 2000 || (cells[c] === 0 && order.rank[c] === r))); }
  const places = all.map(y => yardPlace(y.i, y.j));
  const farms = farmsteadsOfAlbum(places, { cells, rank: order.rank, n: KN });
  assert.equal(farms.length, all.length);
  const west = farms.filter(f => f.district === 0), east = farms.filter(f => f.district === 1); assert.ok(west.length > 5 && east.length > 5 && west.length + east.length === farms.length);
  // the land near the centre is taken up first: no yard lies further out than the chunks the fields reach
  const most = Math.max(...farms.map(f => f.chunk)); assert.ok(most < 400, `the last chunk with a yard is number ${most} of its district`);
  const world = { districts: [{}, {}, {}].map(() => ({ forest: 1, fields: .2, pasture: 0, built: 0, burnt: 0, age: 0 })), settlements: [], farmsteads: farms, roads: [], exceptions: [] };
  const sections = packLand(world), back = unpackLand(sections);
  assert.equal(back.farmsteads.length, farms.length); assert.ok(landBytes(sections).farmsteads <= (most + 1) * 2 * 2, 'two bytes a chunk, in two districts');
  const k = f => `${f.district},${f.chunk},${f.slot}`, sent = new Set(farms.map(k)); assert.equal(sent.size, farms.length, 'no two yards share a place'); assert.ok(back.farmsteads.every(f => sent.has(k(f))));
  // no yard in a chunk of water: with the squares east of the settlement taken for the sea, the yards there are gone
  const dry = allYards({ ...ctx, landSquare: kx => kx < 675 });
  assert.ok(dry.length > 5 && dry.length < all.length && dry.every(y => yardPlace(y.i, y.j).kx < 675));
});
