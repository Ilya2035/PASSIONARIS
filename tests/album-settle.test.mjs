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

test('settle shapes: twenty-three kinds of a few triangles each, all in one small texture', () => {
  const s = buildShapes();
  assert.equal(KINDS.length, 23); assert.equal(KIND_TITLES.length, 23); assert.equal(new Set(KINDS).size, 23);
  assert.ok(KIND.wall === 21 && KIND.gate === 22, 'the wall and the gate come after the yards: the kinds before them keep their numbers');
  assert.equal(s.width, SLOTS); assert.equal(s.height, 46); assert.equal(s.data.length, SLOTS * 46 * 4);
  assert.ok(s.data.length < 32000, `the shape texture is ${s.data.length} bytes`);
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
  // (a small town has a harbour of up to three piers, well apart)
  const piers = plan.filter(r => KINDS[r[3]] === 'pier'); assert.ok(piers.length >= 1 && piers.length <= 3, `${piers.length} piers`); assert.ok(piers.every(q => q[7] & FLAG_WATER && Math.abs(q[0] - 100) < .1), 'a pier stands on the shoreline');
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
  assert.equal(showcase.length, 46); assert.deepEqual([...new Set(showcase.map(r => r[3]))].sort((a, b) => a - b), KINDS.map((_, i) => i)); assert.equal(showcase.filter(r => r[7] & 1).length, 23);
  { const seen = new Set(showcase.map(r => `${r[0].toFixed(2)},${r[1].toFixed(2)}`)); assert.equal(seen.size, 46, 'no two blocks of the showcase stand on one spot'); }
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
  const { MARK_TO, markSvg } = await import('../src/album/layers/labels.js');
  assert.ok(MARK_TO[0] < 60 && MARK_TO.every((h, i) => !i || h > MARK_TO[i - 1]), 'villages are marked only from close by, greater places from higher');
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

// ---- the third wave (the owner's review of 13.11.2026): one town to a district, towns that grow together, the chunks
// of a town, marks and names by the height of the camera, the list of the panel, no shade of the houses
test('settle towns: one town to a district; towns grown together are one town; a second town of a natural cell lies in the fine grid', async () => {
  const { townsOfDistricts, builtChunks, MERGE_GAP, RMERGED } = await import('../src/album/town/grow.js');
  const { VILLAGE_RMAX, FINE_RMAX, TOWN_R, peopleOf, classOf } = await import('../src/album/town/rules.js');
  assert.ok(VILLAGE_RMAX < TOWN_R && classOf(peopleOf(VILLAGE_RMAX)) === 0, 'a village has under a thousand people');
  // a place of the album that is not the centre of its district becomes a village of it
  const pls = [place(-205, 4405, 9e5), place(-203, 4406, 3e5), place(-150, 4405, 2e5), { ...place(-100, 4405, 500), village: true }];
  const one = townsOfDistricts(pls, (pl, i) => [{ district: 7, site: 0 }, { district: 7, site: 2 }, null, { district: 9, site: 1 }][i]);
  assert.deepEqual(one.map(p => !!p.village), [false, true, false, true]); assert.equal(one[1].district, 7); assert.equal(one[1].site, 2); assert.equal(one[1].pop, 3e5);
  assert.equal(one[0], pls[0]); assert.equal(pls[1].village, undefined, 'the list given is left as it was');
  clear();
  const m1 = growTowns(ch, one, 1, at), second = m1.towns.find(t => t.index === 1);
  assert.ok(m1.towns.find(t => t.index === 0).town && (!second || (!second.town && second.R <= VILLAGE_RMAX + 1e-9)), 'the second place of the district is a village or lies under the houses of the town');
  // two towns whose houses touch: one town, the greater, with the built-up land and the people of both
  const a = place(-205, 4405, 9e5), b = place(-205 + fullRadius(9e5) + fullRadius(3e5) + MERGE_GAP - .05, 4405, 3e5), apart = place(-205 + fullRadius(9e5) + fullRadius(3e5) + MERGE_GAP + .4, 4405, 3e5);
  const both = growTowns(ch, [b, a], 1, at), T = both.towns[0];
  assert.equal(both.towns.length, 1); assert.equal(T.index, 1); assert.deepEqual(T.merged, [0]);
  assert.ok(Math.abs(T.R - Math.hypot(fullRadius(9e5), fullRadius(3e5))) < 1e-9 && T.R <= RMERGED && T.people === peopleOf(T.R) && Math.abs(T.ploughed - T.people / 100) < .05, 'the area of both, and the fields of all its people');
  assert.equal(Math.round(both.built[T.home] * 255), T.byte, 'the built share of its cell is that of the town grown together');
  // a little farther apart they are two towns; the lesser shares the natural cell (or the square of the grid) of the
  // greater, so it lies in the fine grid — still the town of its district
  const two = growTowns(ch, [apart, a], 1, at); assert.equal(two.towns.length, 2);
  const lesser = two.towns.find(t => t.index === 0); assert.ok(lesser.town && lesser.village && lesser.fine >= 0 && lesser.R <= FINE_RMAX + 1e-9 && !two.towns[0].village);
  // ---- «чанк города такого-то»: the chunks a settlement is built on; its area is their number
  const big = growTowns(ch, [place(-205.3, 4405.4, 5.6e6), { ...place(-195.5, 4405.5, 400), village: true }, { ...place(-205.3, 4407.2, 300), village: true }], 1, at);
  const own = builtChunks(big.towns), city = big.towns[0], n0 = own.chunks[0];
  assert.ok(city.R > 1.5 && n0 >= Math.PI * city.R * city.R * .75 && n0 <= Math.PI * city.R * city.R * 1.6 + 2, `a city of ${city.R.toFixed(2)} km holds ${n0} chunks`);
  assert.equal(city.chunks, n0); assert.equal(own.owner.get(squareOf(city.x, city.y)), 0);
  const ham = big.towns.findIndex(t => t.index === 1); assert.equal(own.chunks[ham], 1, 'a hamlet holds the chunk it stands in'); assert.equal(own.owner.get(squareOf(big.towns[ham].x, big.towns[ham].y)), ham);
  assert.equal([...own.owner.values()].filter(n => n === 0).length, n0);
  assert.equal(builtChunks(big.towns, () => false).owner.size, 0, 'no chunk of water is built up');
});

test('settle marks: the scheme of the owner by the height of the camera — far nothing, 500 km capitals, 200 km towns, 100 km lesser towns, villages last; names about 50 km', async () => {
  const { RANKS, rankOf, NAME_FROM, SHAPES_TO } = await import('../src/album/town/rules.js');
  const { shownAt, declutter, markSvg, markSize, MARK_TO } = await import('../src/album/layers/labels.js');
  assert.deepEqual(RANKS.map(r => r.id), ['village', 'town', 'bigtown', 'province', 'land', 'region']); assert.deepEqual(MARK_TO, RANKS.map(r => r.to));
  assert.deepEqual([{ cls: 0 }, { town: true, cls: 0 }, { town: true, cls: 1 }, { town: true, cls: 2 }, { town: true, cls: 0, capital: 'province' }, { town: true, cls: 1, capital: 'land' }, { town: true, cls: 2, capital: 'region' }, { cls: 1 }].map(rankOf),
    [0, 1, 2, 3, 3, 4, 5, 0], 'a village first, the town of a district, a greater town, the greatest cities with the chief towns of provinces, of lands, of regions');
  const marked = h => RANKS.map((_, r) => shownAt(r, h).mark > 0), named = h => RANKS.map((_, r) => shownAt(r, h).name > .5);
  assert.deepEqual(marked(1000), [false, false, false, false, false, false], 'from very far: nothing');
  assert.deepEqual(marked(500), [false, false, false, true, true, true], 'about 500 km: the greatest cities and the capitals');
  assert.deepEqual(marked(200), [false, false, true, true, true, true], '200 km: lesser towns');
  assert.deepEqual(marked(100), [false, true, true, true, true, true], '100 km: lesser still');
  assert.deepEqual(marked(40), [true, true, true, true, true, true], 'closer: villages too');
  assert.ok(RANKS.every((r, i) => !i || (r.to > RANKS[i - 1].to && r.name >= RANKS[i - 1].name)), 'villages go first, capitals stay the longest');
  assert.deepEqual(named(20), [false, false, false, false, false, false], 'from 20 km no names: one looks at the town itself');
  assert.deepEqual(named(50), [false, true, true, true, true, true]); assert.deepEqual(named(40), [true, true, true, true, true, true], 'about 50 km the names stand');
  assert.deepEqual(named(200), [false, false, false, false, false, false], 'farther they are gone');
  assert.ok(NAME_FROM[0] > 20 && NAME_FROM[1] < 45 && RANKS.every(r => r.name <= 180 && r.name <= r.to));
  assert.deepEqual(RANKS.map((_, r) => shownAt(r, 500, true).name > .5), [false, false, false, true, true, true], 'the knob keeps the names of the chief towns while they are marked');
  assert.ok(!shownAt(1, 60).far && shownAt(1, 100).far && SHAPES_TO > 50 && SHAPES_TO < 100, 'near — a shape by the class, from 100 km — a dot');
  // the marks: a shape near, a dot far; a chief town has a heart, that of a land a ring too
  assert.match(markSvg(1, 2, false), /<polygon/); assert.doesNotMatch(markSvg(1, 2, true), /<polygon/);
  assert.equal((markSvg(1, 3, true).match(/<circle/g) || []).length, 2); assert.equal((markSvg(1, 4, true).match(/<circle/g) || []).length, 4);
  assert.ok(markSize(0, 5, true) > markSize(0, 3, true) && markSize(0, 3, true) > markSize(0, 1, true), 'the higher the rank, the larger the dot');
  // nothing overlaps: the greater takes the room first; a name without room is left out and its mark stays
  const got = declutter([{ x: 100, y: 100, mark: 12, name: 80, gap: 14 }, { x: 104, y: 103, mark: 10, name: 60, gap: 14 }, { x: 150, y: 104, mark: 10, name: 60, gap: 14 }, { x: 100, y: 140, mark: 10, name: 60, gap: 14 }, { x: 300, y: 100, mark: 0, name: 70, gap: 30 }, { x: 290, y: 104, mark: 0, name: 70, gap: 30 }, { x: 40, y: 142, mark: 8, name: 50, gap: 12 }]);
  assert.deepEqual(got, [2, 0, 0, 2, 2, 0, 1], 'a mark on a mark or on a name: left out; a name on a name: the mark alone');
  for (const id of ['marks-20', 'marks-50', 'marks-100', 'marks-200', 'marks-500', 'marks-1000', 'marks-coast-100', 'marks-coast-500', 'marks-names-far']) assert.ok(settle.pages.some(p => p.id === id), id);
  assert.ok(settle.pages.filter(p => /^marks(-coast)?-\d+$/.test(p.id)).every(p => p.cam.h === +p.id.split('-').pop()));
  const far = DEFS.find(d => d.key === 'labelsFar'); assert.ok(far && far.value === 0 && far.map, 'names of capitals from afar: a switch of the map panel, off to begin with');
});

test('settle panel and shade: the list of a district names the class as the map marks it; houses throw no shade on the ground', async () => {
  const { classTitle } = await import('../src/album/division/panel.js');
  assert.equal(classTitle({ cls: 0, town: false }), 'деревня'); assert.equal(classTitle({ cls: 1, town: true }), 'малый городок');
  assert.equal(classTitle({ cls: 0, town: true }), 'город района (пока деревня)'); assert.match(classTitle({ cls: 2, town: true, capital: 'region' }), /средний город · главный город региона/);
  assert.match(classTitle({ partOf: 'Мадрид', town: true, cls: 0 }), /часть города Мадрид/);
  assert.doesNotMatch(settle.glsl, /p\.sd/, 'the ground shader paints no shade of the houses toward the sun');
  assert.doesNotMatch(settle.glsl, /earth \* \.8, cover \* blocks/, 'nor under a block');
});

test('settle towns by the water: the middle of a town lies off its site, toward the sea or a river; the patch, its belts and its chunks follow', async () => {
  const { towardWater, builtChunks } = await import('../src/album/town/grow.js');
  const R = await import('../src/album/town/rules.js'), none = () => 1e9;
  for (const s of [-1.5, -.4, 0, .013, .77, 1.5]) assert.ok(Math.abs(R.shiftOf(R.shiftByte(s)) - s) <= R.SHIFT_MAX / 254 + 1e-9, `a shift of ${s} km in a byte`);
  assert.equal(R.shiftByte(0), 128); assert.equal(R.shiftOf(128), 0);
  // the sea is east of x = 100: a town a kilometre and a half inland grows toward it, as far as half its radius
  const inland = towardWater(at, none, 98.5, 4405, 1); assert.ok(Math.abs(inland[0] - .5) < .01 && Math.abs(inland[1]) < .02, `toward the sea: ${inland}`);
  // nearer the shore it stops when its last houses stand on it: the middle is SHORE_AT of the radius inland
  const near = towardWater(at, none, 98.9, 4405, 1); assert.ok(Math.abs(98.9 + near[0] - (100 - R.SHORE_AT)) < .07, `the middle of the town lies ${(100 - 98.9 - near[0]).toFixed(2)} km from the shore`);
  // a town founded on the very shore grows inland, along its harbour; far from any water it stands where it is
  const shore = towardWater(at, none, 99.9, 4405, 1); assert.ok(shore[0] < -.45 && shore[0] >= -.5 - 1e-9);
  assert.deepEqual(towardWater(at, none, 0, 4405, 1), [0, 0]); assert.deepEqual(towardWater(at, none, 99.5, 4405, R.SHIFT_FROM - .01), [0, 0], 'a hamlet stands where it is');
  // a river a kilometre north: the town grows to its bank, no farther than half its radius
  const river = (x, y) => Math.abs(4406 - y), up = towardWater(at, river, 0, 4405, .5); assert.ok(Math.abs(up[0]) < .01 && up[1] > .2 && up[1] <= .25 + .006, `toward the river: ${up}`);
  assert.deepEqual(towardWater(at, river, 0, 4403, .5), [0, 0], 'a river too far to reach');
  assert.ok(R.SHIFT_SHARE < R.WALL_SHARE * (1 - .12), 'the site of a town always lies inside its wall');
  // the model keeps the shift, the patch has its middle there, and the texture holds it
  clear();
  const m = growTowns(ch, [place(98.5, 4405, 5.6e6)], 1, at), t = m.towns[0]; assert.ok(t.sx > .1 && Math.abs(98.5 + t.sx - (100 - R.SHORE_AT * t.R)) < .03 && Math.abs(t.sy) < .02 && Math.abs(t.x - 98.5) < 1e-6, 'the site stays, the middle moves to the shore');
  ch.set('built', t.home, t.byte / 255);
  const out = blank(), mir = mirrorSettle(ch, m.towns, out), L = mir.lobes[0];
  assert.ok(Math.abs(L.sx - t.sx) < 1e-9 && Math.abs(L.cx - L.x - t.sx) < 1e-9 && Math.abs(L.x - t.x) < .04 && R.midOf(L)[0] === L.cx);
  assert.deepEqual(R.midOf({ x: 3, y: 4 }), [3, 4], 'a patch made by hand has its middle at its site');
  clear();
  // a patch whose middle lies 400 m east of its site: a cell far to the east is built on, the cell as far to the west is open ground
  const [hx, hy] = siteBytes(-205, 4405), H = lobeOf(gridOf(-205, 4405), hx, hy, radiusByte(.8), CULTURES.med, R.shiftByte(.4), 128);
  assert.ok(Math.abs(H.sx - .4) < .007 && H.sy === 0 && Math.abs(H.cx - H.x - H.sx) < 1e-12);
  const S0 = cellSize(20), cs = Math.cos(H.th), sn = Math.sin(H.th), toCell = (dx, dy) => [Math.round((cs * dx + sn * dy) / S0), Math.round((-sn * dx + cs * dy) / S0)];
  let east = 0, west = 0; for (let d = .9; d < 1.12; d += .04) for (let s = -.2; s <= .2; s += .08) { if (cellRule(...toCell(d, s), H, S0)) east++; if (cellRule(...toCell(-d, s), H, S0)) west++; }
  assert.ok(east > 12 && west === 0, `cells built ${east} toward the water, ${west} away from it`);
  { const even = { ...H, amp: 0 }; assert.ok(Math.abs(R.depthAt(even, H.cx, H.cy) - H.re) < 1e-9 && Math.abs(R.depthAt(even, H.x, H.y) - (H.re - H.sx)) < 1e-9, 'the patch is deepest at its middle'); }
  const built = rows(planLobe(H, S, env)).map(centreOf); assert.ok(Math.abs(built.reduce((s, p) => s + p[0], 0) / built.length - H.cx) < .08, 'its blocks lie around its middle');
  // its chunks lie around its middle
  const own = builtChunks(m.towns); assert.equal(own.owner.get(squareOf(t.x + t.sx, t.y)), 0); assert.equal(own.owner.get(squareOf(t.x, t.y)), 0, 'and the chunk of its site is its own');
  assert.match(RULES_GLSL, /length\(ij \* S - sh\)/); assert.match(settle.glsl, /SET_MORE/); assert.match(settle.glsl, /SET_SHIFT \/ 127\./);
});

test('settle wall, gates and streets: a town has main streets along its roads, a wall with a gate on each, a castle; no block stands on them', async () => {
  const R = await import('../src/album/town/rules.js'), P = await import('../src/album/town/plan.js');
  const { mirrorGates, packAtlas, gateBytes, moreBytes, settleBytes, villageBytes } = await import('../src/album/town/state.js');
  for (const a of [0, .5, 1.5708, 3.1416, 4.7, 6.28]) assert.ok(Math.abs(Math.atan2(Math.sin(R.gateOf(R.gateByte(a)) - a), Math.cos(R.gateOf(R.gateByte(a)) - a))) < 6.2832 / 254, `a gate at ${a} in a byte`);
  assert.ok(R.gateByte(-1) >= 1 && R.gateByte(7) <= 255, 'never the byte of «no gate»');
  const kindsOf = plan => { const n = {}; for (const r of plan) n[KINDS[r[3]]] = (n[KINDS[r[3]]] || 0) + 1; return n; };
  // a walled town with four streets
  const L = patch(-205, 4405, .85); L.gates = [.2, 1.8, 3.4, 5].map(a => R.gateOf(R.gateByte(a)));
  for (let a = 0; a < 6.28; a += .1) { const w = R.wallAt(L, a); assert.ok(w > .5 * L.r && w < .72 * L.r, 'the wall keeps to the middle of the town'); }
  assert.ok(P.walled(L) && !P.walled(patch(-205, 4405, .3)));
  const gates = P.gatesOf(L); assert.equal(gates.length, 4);
  for (const g of gates) { assert.ok(P.wallDist(L, g.x, g.y) < .006, 'a gate stands on the wall'); assert.ok(P.streetAt(L, g.x, g.y) < 1e-6, 'and on its street'); }
  assert.ok(P.streetAt(L, L.x + Math.cos(L.gates[0]) * .3, L.y + Math.sin(L.gates[0]) * .3) < 1e-9 && P.streetAt(L, L.x + Math.cos(5.74) * .3, L.y + Math.sin(5.74) * .3) > .15, 'a street runs straight out from the site');
  assert.equal(P.streetAt({ x: 0, y: 0, gates: [0] }, -.3, 0), 1e9, 'and one way only: behind the site there is none'); assert.equal(P.streetAt({ x: 0, y: 0 }, 1, 1), 1e9);
  const plan = rows(planLobe(L, S, env)), n = kindsOf(plan);
  assert.equal(n.gate, 4); assert.ok(n.wall > 40 && n.wall < 80, `${n.wall} pieces of wall`); assert.equal(n.fort, 1, 'a great town has a castle besides');
  assert.ok(n.market === 1 && n.temple >= 1 && (n.quarter || 0) + (n.quarterU || 0) + (n.quarterL || 0) > 10, JSON.stringify(n));
  const ring = 2 * Math.PI * R.WALL_SHARE * L.r, laid = plan.filter(r => KINDS[r[3]] === 'wall').reduce((s, r) => s + r[8] * S, 0);
  assert.ok(laid > ring * .85 && laid < ring * 1.1, `the wall is ${laid.toFixed(2)} km long around a ring of ${ring.toFixed(2)} km`);
  for (const r of plan) {
    const k = KINDS[r[3]]; if (['wall', 'gate', 'market', 'pier', 'mill'].includes(k)) continue;
    const [x, y] = centreOf(r), half = Math.max(r[8], r[9]) * .5 * S;
    assert.ok(P.streetAt(L, x, y) >= Math.min(half, .03) + R.STREET_W / 2, `${k} on a main street`);
    assert.ok(P.wallDist(L, x, y) >= Math.min(half, .03) + R.WALL_W / 2, `${k} on the wall`);
  }
  for (const r of plan.filter(q => KINDS[q[3]] === 'wall')) assert.ok(P.wallDist(L, r[0], r[1]) < .004 && P.streetAt(L, r[0], r[1]) > R.GATE_W * .3, 'a piece of the wall lies on its ring and leaves the gateways open');
  // the same town without streets and wall has more and larger blocks
  const bare = patch(-205, 4405, .85), small = plan.filter(r => !['wall', 'gate'].includes(KINDS[r[3]])).length;
  assert.ok(rows(planLobe(bare, S, env)).filter(r => !['wall', 'gate'].includes(KINDS[r[3]])).length > small, 'blocks give way to the streets');
  // a small town: no wall, a castle; a village: neither
  const T = patch(-205, 4405, .32); T.gates = [.3, 2.4, 4.4].map(a => R.gateOf(R.gateByte(a)));
  const tn = kindsOf(rows(planLobe(T, S, env))); assert.ok(!tn.wall && !tn.gate && tn.fort === 1, JSON.stringify(tn));
  const vn = kindsOf(rows(planLobe(patch(-205, 4405, .2), S, env))); assert.ok(!vn.wall && !vn.gate && !vn.fort, JSON.stringify(vn));
  // a road through a settlement: no block stands on it
  const road = (x, y) => Math.abs(y - 4405.1), onRoad = rows(planLobe(patch(-205, 4405, .2), S, { ...env, road }));
  assert.ok(onRoad.length > 5); for (const r of onRoad) { const [x, y] = centreOf(r); assert.ok(road(x, y) >= Math.min(Math.max(r[8], r[9]) * .5 * S, .03), 'a block on the road'); }
  // a harbour: a town on a gentle beach has its piers at the edge of the water
  const beach = (x, y) => (x > 100 ? -5 : x > 99.8 ? .5 : 300), port = rows(planLobe(patch(99.4, 4405, .5), S, { ...env, at: beach })).filter(r => KINDS[r[3]] === 'pier');
  assert.ok(port.length >= 2 && port.every(r => Math.abs(r[0] - 100) < .03), `${port.length} piers at the water`);
  // ---- the gates in the texture
  const lobes = [L, patch(-305, 4405, .32), patch(-105, 4405, .2)], G = new Uint8Array(GN * GN * 4);   // (three squares of the grid)
  assert.ok(mirrorGates(lobes, o => (o === L ? [.2, 1.8, 3.4, 5, 5.9] : [.3, 2.4])));
  assert.equal(lobes[0].gates.length, 4, 'at most four'); assert.equal(lobes[1].gates.length, 2); assert.equal(lobes[2].gates.length, 0, 'a village has no main streets');
  assert.deepEqual([...G.subarray(L.k * 4, L.k * 4 + 4)], [0, 0, 0, 0], 'a block of bytes is written only when it is the one named');
  assert.ok(mirrorGates(lobes, o => (o === L ? [.2, 1.8, 3.4, 5] : [.3, 2.4]), G)); assert.deepEqual([...G.subarray(L.k * 4, L.k * 4 + 4)], [.2, 1.8, 3.4, 5].map(R.gateByte));
  assert.ok(!mirrorGates(lobes, o => (o === L ? [.2, 1.8, 3.4, 5] : [.3, 2.4]), G), 'nothing changed');
  assert.ok(R.VN + 3 * GN <= R.TEX_W && R.MORE_AT[0] === R.COARSE_AT[0] + GN && R.GATES_AT[0] === R.MORE_AT[0] + GN, 'three blocks of the coarse grid lie side by side under the chunks');
  const atlas = new Uint8Array(R.TEX_W * R.TEX_H * 4), more = new Uint8Array(GN * GN * 4); more[L.k * 4] = 200; packAtlas(settleBytes, villageBytes, atlas, more, G);
  const texel = (at, k) => ((at[1] + ((k / GN) | 0)) * R.TEX_W + at[0] + k % GN) * 4;
  assert.equal(atlas[texel(R.MORE_AT, L.k)], 200); assert.equal(atlas[texel(R.GATES_AT, L.k)], R.gateByte(.2));
  mirrorGates(lobes, () => []);                                    // (the gates of the texture itself, left as they were found)
  assert.match(settle.glsl, /SET_GATES/); assert.match(RULES_GLSL, /float setWall\(float r, float th, float a\)/); assert.match(settle.glsl, /setWall\(r, th, atan\(dc\.y, dc\.x\)\)/);
  for (const id of ['city-sea', 'city-inland', 'city-capital', 'city-small', 'city-village', 'city-45']) assert.ok(settle.pages.some(p => p.id === id), id);
  assert.ok(gateBytes.length === GN * GN * 4 && moreBytes.length === GN * GN * 4);
});

test('settle scale bar: a round length, cut into equal pieces — the real size of the towns can be read off the screen', async () => {
  const { scaleOf, kmPerPixel, SCALE_STEPS } = await import('../src/album/town/scale.js');
  const k20 = kmPerPixel(20, 32, 900); assert.ok(Math.abs(k20 - .01274) < .0001, `${k20} km to a pixel from 20 km`);
  const near = scaleOf(k20); assert.equal(near.km, 2); assert.equal(near.parts, 4); assert.equal(near.part, .5); assert.equal(near.label, '2 км'); assert.equal(near.partLabel, '500 м');
  const far = scaleOf(kmPerPixel(500, 32, 900)); assert.equal(far.km, 50); assert.equal(far.parts, 5); assert.equal(far.partLabel, '10 км');
  assert.equal(scaleOf(.0004).label, '50 м'); assert.equal(scaleOf(.0004).partLabel, '10 м');
  for (const k of [.0004, .003, .0127, .05, .13, .32, .64, 1.3]) { const s = scaleOf(k); assert.ok(s.px <= 170 + 1e-9 && s.px > 60 && SCALE_STEPS.includes(s.km) && Math.abs(s.px * k - s.km) < 1e-9, `${s.km} km is ${s.px.toFixed(0)} px`); }
  const bar = DEFS.find(d => d.key === 'scaleBar'); assert.ok(bar && bar.value === 1 && bar.map, 'the scale bar is on, with a switch on the map panel');
});

test('settle marks under a tilted camera: a far settlement is shown as from farther up, none beyond the horizon; a main street runs on to where the road takes over', async () => {
  const { heightFor, FAR, shownAt } = await import('../src/album/layers/labels.js');
  assert.equal(heightFor(100, 100), 100); assert.equal(heightFor(100, 100 * FAR), 100, 'within the picture of a camera that looks down: the height of the camera');
  assert.equal(heightFor(40, 400), 400 / FAR); assert.ok(shownAt(0, heightFor(40, 30)).mark > 0 && !(shownAt(0, heightFor(40, 400)).mark > 0), 'a village far toward the horizon is not marked');
  assert.ok(shownAt(3, heightFor(40, 400)).mark > 0 && !(shownAt(1, heightFor(40, 400)).name > 0), 'a chief town is, without its name');
  const g = settle.glsl;
  assert.match(g, /bool town = !village && r >= SET_STREETS_FROM/); assert.match(g, /smoothstep\(-reach, -reach \+ \.04, own\)/, 'the street is painted past the last houses');
  assert.ok(g.indexOf('float past = ') < g.indexOf('if (tm < .003) return;') && g.indexOf('if (tm < .003) return;') < g.indexOf('setWall(r, th, atan(dc.y, dc.x))'), 'before the pixel is given up as open land; the wall after');
  assert.equal((g.match(/texelFetch\(tSettle, bc\.xy \+ SET_GATES, 0\)/g) || []).length, 1, 'the gates are read once');
});

test('settle and the land nobody can live on: no village is founded there; where only a hamlet can stand a village stays a hamlet', async () => {
  const { placesAllowed, HAMLET_ONLY_R } = await import('../src/album/town/grow.js');
  const v = (x, pop, more = {}) => ({ ...place(x, 4405, pop), village: true, ...more });
  const pls = [place(-205, 4405, 9e5), v(-195, 9000), v(-185, 9000), v(-175, 9000), v(-165, 300, { r: .06 })];
  const out = placesAllowed(pls, pl => [2, 0, 1, 2, 1][pls.indexOf(pl)]);
  assert.equal(out.length, 5); assert.equal(out[0], pls[0]); assert.equal(out[3], pls[3]); assert.equal(out[1].r, 0);
  assert.ok(out[2].r > .05 && out[2].r <= HAMLET_ONLY_R && HAMLET_ONLY_R < STAGES[1].r); assert.equal(out[4].r, .06, 'a hamlet is a hamlet already');
  assert.equal(placesAllowed([pls[0]], () => 0)[0], pls[0], 'the town of a district stands where the division put it');
  clear();
  const m = growTowns(ch, out, 1, at);
  assert.deepEqual(m.towns.map(t => t.index).sort(), [0, 2, 3, 4], 'the village on forbidden land is not founded; the others stand under their own numbers');
  const cramped = m.towns.find(t => t.index === 2), free = m.towns.find(t => t.index === 3);
  assert.ok(cramped.R <= HAMLET_ONLY_R && stageOf(cramped.R) === 0 && free.R > HAMLET_ONLY_R && stageOf(free.R) === 1, 'where only a hamlet can stand, the village is a hamlet');
});

test('settle names: every name of a settlement is Russian — transcribed by rule when the data was prepared, the name of the data kept', async () => {
  const T = await import('../src/album/town/translit.js');
  const { decodeSites, namePlaces } = await import('../src/album/town/sites.js');
  const { readFileSync, existsSync } = await import('node:fs'); const { gunzipSync } = await import('node:zlib');
  const { join, dirname } = await import('node:path'), ROOT = join(dirname((await import('node:url')).fileURLToPath(import.meta.url)), '..');
  // the rules, a few names of every language
  const want = { es: { 'Majadahonda': 'Махадаонда', 'La Puebla de Alfindén': 'Ла-Пуэбла-де-Альфинден', 'Zuera': 'Суэра', 'Alcalá de Henares': 'Алькала-де-Энарес', 'Valladolid': 'Вальядолид', 'Huelva': 'Уэльва', 'Oviedo': 'Овьедо',
      'Soria': 'Сория', 'Gijón': 'Хихон', 'Ciudad Real': 'Сьюдад-Реаль', 'Logroño': 'Логроньо', 'Villanueva de la Cañada': 'Вильянуэва-де-ла-Каньяда', 'Los Palacios y Villafranca': 'Лос-Паласиос-и-Вильяфранка', 'Lahiguera': 'Лаигера' },
    gl: { 'Sanxenxo': 'Саншеншо', 'O Grove': 'О-Грове', 'Friol': 'Фриоль' }, nav: { 'Getxo': 'Гечо', 'Zarautz': 'Сарауц', 'Tudela': 'Тудела', 'Estella': 'Эстелья' },
    ca: { 'Vilanova i la Geltrú': 'Виланова-и-ла-Жельтру', 'el Vendrell': 'Эль-Вендрель', 'Sabadell': 'Сабадель', 'Puigcerdà': 'Пучсерда', "L'Hospitalet de Llobregat": 'Л’Оспиталет-де-Льобрегат', 'Sant Cugat del Vallès': 'Сан-Кугат-дель-Вальес',
      'Sant Andreu de la Barca': 'Сант-Андреу-де-ла-Барка', 'Montcada i Reixac': 'Монкада-и-Решак', 'Xàtiva': 'Шатива', "Vilobí d'Onyar": 'Вилоби-д’Оньяр' },
    pt: { 'Porto': 'Порту', 'Matosinhos': 'Матозиньюш', 'Cascais': 'Кашкайш', 'Coimbra': 'Коимбра', 'Guimarães': 'Гимарайнш', 'Santarém': 'Сантарен', 'Covilhã': 'Ковильян', 'Torres Vedras': 'Торриш-Ведраш',
      'Póvoa de Varzim': 'Повуа-ди-Варзин', 'Vila Nova de Gaia': 'Вила-Нова-ди-Гая', 'São João da Madeira': 'Сан-Жуан-да-Мадейра', 'Lagoa': 'Лагоа' },
    fr: { 'Montauban': 'Монтобан', 'Montpellier': 'Монпелье', 'Béziers': 'Безье', 'Carcassonne': 'Каркасон', 'Avignon': 'Авиньон', 'Tarbes': 'Тарб', 'Agen': 'Ажен', 'Auch': 'Ош', 'Millau': 'Мийо', 'Muret': 'Мюре', 'Blagnac': 'Бланьяк',
      "L'Isle-Jourdain": 'Л’Иль-Журден', 'Villeneuve-sur-Lot': 'Вильнёв-сюр-Ло', 'Saint-Étienne': 'Сент-Этьен', 'Saint-Girons': 'Сен-Жирон', 'Orange': 'Оранж', 'Alès': 'Алес', 'Perpignan': 'Перпиньян' },
    ar: { 'Tlemcen': 'Тлемсен', 'Chefchaouen': 'Шефшауэн', 'Sidi Bel Abbès': 'Сиди-Бель-Аббес', 'Ouled Brahim ⴰⵜ ⴱⵔⴰⵀⵉⵎ أولاد إبراهيم': 'Улед-Брахим', 'Algiers': 'Алжир', 'عزيز': 'Азиз' } };
  for (const [lang, list] of Object.entries(want)) for (const [name, ru] of Object.entries(list)) assert.equal(T.toRussian(name, lang), ru, `${lang}: ${name}`);
  assert.equal(T.toRussian('Мадрид', 'es'), 'Мадрид', 'a Russian name stays'); assert.equal(T.toRussian('A Корунья', 'gl'), 'Ла-Корунья'); assert.equal(T.toRussian('Puerto de Vega / Veiga', 'ast'), 'Пуэрто-де-Вега', 'the first of two names');
  assert.equal(T.toRussian('', 'es'), ''); assert.ok(!T.hasLatin(T.toRussian('Abanto y Ciérvana-Abanto Zierbena', 'nav')));
  // the language of a place: by its modern unit; the Valencian and the Basque lands by the spelling of the name
  assert.deepEqual(['ESP-5833', 'ESP-5827', 'ESP-5809', 'PRT-746', 'FRA-5298', 'AND-4876', 'DZA-2195', 'MAR-1445', 'ESP-5805'].map(T.langOfUnit), ['es', 'gl', 'ca', 'pt', 'fr', 'ca', 'ar', 'ar', 'ast']);
  assert.equal(T.guessLang('va', 'Xàtiva'), 'ca'); assert.equal(T.guessLang('va', 'Orihuela'), 'es'); assert.equal(T.guessLang('nav', 'Getxo'), 'eu'); assert.equal(T.guessLang('nav', 'Tudela'), 'es'); assert.equal(T.guessLang('pt', 'x'), 'pt');
  const unitAt = T.unitFinder({ 'ESP-1': { rings: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }, 'PRT-2': { rings: [[[-3, 0], [-1, 0], [-1, 2], [-3, 2]]] } });
  assert.equal(unitAt(1, 1), 'ESP-1'); assert.equal(unitAt(-2, 1), 'PRT-2'); assert.equal(unitAt(-.8, 1), 'PRT-2', 'a place on the shore takes the nearest unit');
  // records: the Russian name, and the name of the data as the sixth number
  const two = { 'ESP-1': { rings: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }, 'PRT-2': { rings: [[[-3, 0], [-1, 0], [-1, 2], [-3, 2]]] } };
  const [recs, st] = T.russifySites([[10000, 10000, 5000, 1, 'Zuera'], [10000, 10000, 9000, 0, 'Мадрид'], [-20000, 10000, 700, 2, 'Aveiro']], two);
  assert.deepEqual(recs, [[10000, 10000, 5000, 1, 'Суэра', 'Zuera'], [10000, 10000, 9000, 0, 'Мадрид'], [-20000, 10000, 700, 2, 'Авейру', 'Aveiro']]); assert.equal(st.kept, 1); assert.deepEqual(st.byLang, { es: 1, pt: 1 });
  assert.deepEqual(decodeSites({ sites: recs }).map(s => [s.name, s.orig]), [['Суэра', 'Zuera'], ['Мадрид', 'Мадрид'], ['Авейру', 'Aveiro']]);
  assert.deepEqual(T.russifySites(recs, two)[0], recs, 'done twice, nothing changes');
  // the data of the album: not one name in Latin letters
  const sites = decodeSites(JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/assets/album/town/sites.json.gz')))));
  assert.ok(sites.length > 9000); const latin = sites.filter(s => T.hasLatin(s.name) || !s.name);
  assert.equal(latin.length, 0, `names in Latin letters: ${latin.slice(0, 5).map(s => s.name).join(', ')}`);
  assert.ok(sites.filter(s => s.orig !== s.name).length > 8000 && sites.every(s => s.orig), 'the name of the data is kept');
  for (const [orig, ru] of [['Majadahonda', 'Махадаонда'], ['Zuera', 'Суэра'], ['La Puebla de Alfindén', 'Ла-Пуэбла-де-Альфинден']]) assert.equal(sites.find(s => s.orig === orig)?.name, ru);
  // the places of the album: a list of Russian names beside them
  const names = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/town/places-ru.json'), 'utf8')).names;
  assert.ok(Object.keys(names).length >= 40 && Object.values(names).every(v => v && !T.hasLatin(v)) && names.Guadalajara === 'Гвадалахара' && names.Algiers === 'Алжир');
  const pls = [{ name: 'Guadalajara' }, { name: 'Мадрид' }, { name: 'Granada‎' }]; assert.equal(namePlaces(pls, names), 2);
  assert.deepEqual(pls, [{ name: 'Гвадалахара', orig: 'Guadalajara' }, { name: 'Мадрид' }, { name: 'Гранада', orig: 'Granada' }]); assert.equal(namePlaces(pls, names), 0, 'done twice, nothing changes');
  const vec = join(ROOT, 'public/album-data/vectors.json');
  if (existsSync(vec)) { const own = JSON.parse(readFileSync(vec, 'utf8')).places; namePlaces(own, names); assert.deepEqual(own.filter(p => T.hasLatin(p.name)).map(p => p.name), [], 'every place of the album has a Russian name'); }
});

test('settle and the swamp: a chunk has one state — a chunk of bog is never ploughed, and no field is painted where the swamp is', async () => {
  const { farmGround } = await import('../src/album/town/farmland.js'); const { KN: N } = await import('../src/album/division/km.js');
  const n = N * N, cls = new Uint8Array(n).fill(1), hgt = new Float32Array(n).fill(300), bog = new Uint8Array(n), c0 = 600 * N + 600; bog[c0] = 1;
  const world = new Chunks(() => 300), g = farmGround(world, () => 300, { cls, hgt, bog });
  assert.equal(g.room(c0), 0, 'nothing of a bog chunk can be ploughed'); assert.equal(g.room(c0 + 1), 1, 'the chunk beside it — all of it');
  assert.equal(farmGround(world, () => 300, { cls, hgt }).room(c0), 1, 'without the marks of the division the ground is as before');
  // the swamp aspect, painted first, leaves what it has painted; the fields read it — by a clamp, not a smoothstep —
  // and work nothing of the swamp out again: smoothsteps with numbers written in the code are what slows the whole
  // frame on built-in graphics (v0.6.56: land-20 297 → 419 ms)
  const gsl = settle.glsl, { default: swamp } = await import('../src/album/aspects/swamp.js');
  assert.match(swamp.glsl, /float fSwampW = 0\.;/); assert.match(swamp.glsl, /fSwampW = m; if \(m < \.004\) return;/);
  assert.match(gsl, /fm \*= seen \* clamp\(1\. - fSwampW \* 2\., 0\., 1\.\);/);
  assert.doesNotMatch(gsl, /swamp(Depth|Kind|Field|Slope|Height)\(/, 'no rule of the swamp is run a second time for the fields');
  assert.doesNotMatch(gsl, /smoothstep\([^;]*fSwampW/, 'and no smoothstep is spent on it');
  const { ASPECTS } = await import('../src/album/aspects/index.js'); assert.ok(ASPECTS.findIndex(a => a.id === 'swamp') < ASPECTS.findIndex(a => a.id === 'settle'), 'the swamp is painted before the settlements');
  // the number of smoothsteps with thresholds written in the code of this aspect must not grow (30, as before the swamp block)
  const pairs = gsl.match(/smoothstep\(\s*-?[.0-9]+\s*,\s*-?[.0-9]+\s*,/g) || []; assert.ok(pairs.length <= 30, `${pairs.length} smoothsteps with numbers in the shader of the settlements`);
});

test('settle passes: a mark of its own, shown by the height of the camera, the name with the height in metres', async () => {
  const { PASS_RANKS, PASS_ROAD, passRank, passText, passesOfDistrict, RANKS } = await import('../src/album/town/rules.js');
  const { passSvg, passSize, passShownAt, markSvg, declutter } = await import('../src/album/layers/labels.js');
  // the name: «Сомпорт, 1632 м»; a pass without a name carries its height alone
  assert.equal(passText({ name: 'Сомпорт', h: 1632.4 }), 'Сомпорт, 1632 м'); assert.equal(passText({ name: '', h: 1208 }), '1208 м');
  // three ranks: the great passes are marked from the highest, the lesser only from near; a name never outlasts its mark
  assert.equal(PASS_RANKS.length, 3); assert.equal(PASS_ROAD.length, 3);
  for (let r = 0; r < 3; r++) { assert.ok(PASS_RANKS[r].name <= PASS_RANKS[r].to); if (r) assert.ok(PASS_RANKS[r].to < PASS_RANKS[r - 1].to && PASS_RANKS[r].order < PASS_RANKS[r - 1].order); }
  assert.ok(PASS_RANKS[2].to <= RANKS[0].to, 'a lesser pass goes no later than a village'); assert.ok(PASS_RANKS[0].to <= RANKS[2].to, 'and a great pass no later than a greater town');
  assert.ok(PASS_RANKS[0].order > RANKS.findIndex(r => r.id === 'town') && PASS_RANKS[2].order < 0, 'a great pass takes the room before the town of a district, a lesser one after the villages');
  assert.equal(passRank({ rank: 0 }), 0); assert.equal(passRank({ rank: 7 }), 2); assert.equal(passRank({}), 0);
  // by the height of the camera: from 20 km every pass has mark and name; from 60 km the lesser are gone; from 200 km
  // only the great ones stand, without names; from 300 km none
  for (let r = 0; r < 3; r++) { const s = passShownAt(r, 20); assert.equal(s.mark, 1); assert.equal(s.name, 1); assert.equal(s.far, false); }
  assert.equal(passShownAt(2, 60).mark, 0); assert.ok(passShownAt(1, 60).mark === 1 && passShownAt(1, 60).name === 1); assert.equal(passShownAt(1, 120).mark, 0);
  assert.ok(passShownAt(0, 200).mark === 1 && passShownAt(0, 200).name === 0 && passShownAt(0, 200).far); assert.equal(passShownAt(0, 300).mark, 0);
  // the mark: two arcs, not one of the shapes of the settlements; the great pass is larger
  const svg = passSvg(1, false); assert.match(svg, /<path d="M[^"]+Q[^"]+M[^"]+Q[^"]+"/); assert.doesNotMatch(svg, /<circle|<polygon|<rect/);
  for (let c = 0; c < 5; c++) assert.notEqual(markSvg(c, 1, false), svg);
  assert.ok(passSize(0, false) > passSize(1, false) && passSize(1, true) < passSize(1, false)); assert.notEqual(passSvg(0, false), passSvg(1, false)); assert.notEqual(passSvg(1, true), passSvg(1, false));
  // it takes its room like any mark: a pass that would touch the mark of a town is left out
  assert.deepEqual(declutter([{ x: 100, y: 100, mark: 12, name: 60, gap: 14 }, { x: 104, y: 102, mark: passSize(1, false), name: 90, gap: 14 }, { x: 100, y: 160, mark: passSize(1, false), name: 90, gap: 14 }]), [2, 0, 2]);
  // the panel of a district: the passes on its border, the greater first, then the higher; the district beyond is named
  const list = [{ x: 10, y: 20, h: 1632, name: 'Сомпорт', kind: 0, a: 3, b: 8, rank: 0 }, { x: 11, y: 21, h: 2408, name: '', kind: 2, a: 8, b: 4, rank: 2 }, { x: 12, y: 22, h: 1794, name: 'Порталет', kind: 1, a: 9, b: 8, rank: 1 }, { x: 1, y: 2, h: 900, name: 'Чужой', kind: 1, a: 1, b: 2, rank: 1 }, null, { x: NaN, y: 0, h: 1, a: 8, b: 1 }];
  const got = passesOfDistrict(list, 8, d => `Р${d}`, (x, y) => ({ lat: y, lon: x }));
  assert.deepEqual(got.map(q => q.text), ['Сомпорт, 1632 м', 'Порталет, 1794 м', '2408 м']); assert.deepEqual(got.map(q => q.to), ['Р3', 'Р9', 'Р4']); assert.deepEqual([got[0].lat, got[0].lon], [20, 10]);
  assert.deepEqual(passesOfDistrict(undefined, 8), []); assert.deepEqual(passesOfDistrict(list, 77), []);
  const { passTitle } = await import('../src/album/division/panel.js');
  assert.equal(passTitle(got[0]), 'большой исторический перевал · главная дорога · в район Р3'); assert.equal(passTitle(got[2]), 'тропа · в район Р4');
  // the switch: on to begin with, on the map panel too; the layer reads the list of the roads and stands without it
  const knob = DEFS.find(d => d.key === 'passMarks'); assert.ok(knob && knob.value === 1 && knob.map);
  const { readFileSync } = await import('node:fs'), src = readFileSync(new URL('../src/album/layers/labels.js', import.meta.url), 'utf8');
  assert.match(src, /album\.roadNet\?\.passes \|\| null/); assert.match(src, /Array\.isArray\(ps\) \? ps : \[\]/);
});

test('settle in the mountains: a village stands on the floor of a valley or on a ledge — a hamlet at most on a steep slope, nobody on rock or above the trees; the town of a district is marked without a name', async () => {
  const { groundCan, slopeOf, SLOPE_SPAN, SLOPE_HAMLET, SLOPE_NONE, placesAllowed, HAMLET_ONLY_R } = await import('../src/album/town/grow.js');
  assert.ok(SLOPE_HAMLET < SLOPE_NONE && SLOPE_HAMLET >= .25 && SLOPE_NONE <= .6 && SLOPE_SPAN >= .1 && SLOPE_SPAN <= .5);
  // a plane that rises k metres a metre eastward: its slope is k wherever it is asked
  const plane = k => (x, y) => 1000 + k * 1000 * x;
  for (const k of [0, .1, .29, .31, .49, .51, .8]) assert.ok(Math.abs(slopeOf(plane(k), 3, 7) - k) < 1e-9);
  assert.equal(groundCan(plane(.05), 0, 0), 2); assert.equal(groundCan(plane(.29), 0, 0), 2); assert.equal(groundCan(plane(.31), 0, 0), 1); assert.equal(groundCan(plane(.49), 0, 0), 1); assert.equal(groundCan(plane(.51), 0, 0), 0);
  // a ledge: level ground with a wall of rock beyond it is ground to build on
  const ledge = (x, y) => (Math.abs(x) < .4 ? 1200 : x > 0 ? 1200 + (x - .4) * 900 : 1200 - (-x - .4) * 900);
  assert.equal(groundCan(ledge, 0, 0), 2);
  // above the trees nobody settles, however level the ground
  assert.equal(groundCan(plane(0), 0, 0, 900), 0); assert.equal(groundCan(plane(0), 0, 0, 1001), 2);
  // the layer of settlements asks both the chunk and the ground, and only of villages: the place of a town is the district's
  const ps = placesAllowed([{ lat: 0, lon: 0, pop: 9000, village: true }, { lat: 0, lon: 1, pop: 9000, village: true }, { lat: 0, lon: 2, pop: 9000 }], pl => Math.min(2, groundCan(plane(pl.lon === 0 ? .35 : .6), 0, 0)));
  assert.ok(ps[0].r > 0 && ps[0].r <= HAMLET_ONLY_R); assert.equal(ps[1].r, 0); assert.equal(ps[2].r, undefined);
  const { readFileSync } = await import('node:fs'), src = readFileSync(new URL('../src/album/layers/towns.js', import.meta.url), 'utf8');
  assert.match(src, /Math\.min\(c < 0 \|\| st\.why\?\.\[c\] === 1 \? 2 : st\.can\[c\], groundCan\(at, x, y, treelineAt\(pl\.lat, pl\.lon\)\)\)/);
  // marks: a village without a name is not marked, the town of a district is — by its mark alone
  const lab = readFileSync(new URL('../src/album/layers/labels.js', import.meta.url), 'utf8');
  assert.match(lab, /if \(!m\.name && !\(m\.rank >= 1\)\) continue;/); assert.match(lab, /const nameA = it\.name \? s\.name : 0;/);
});
