// Settlements of the album (docs/album/settle.md): the shapes of the buildings, the rules of a patch, the model of
// growth and the plan of the blocks — everything that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';
import settle from '../src/album/aspects/settle.js';
import { RMAX, CELL, GN, GK, CULTURES, STAGES, stageOf, cellHash, cellRule, lobeOf, cellSize, radiusByte, radiusOf, radiusOfShare, siteBytes, gridOf, bend, unbend, cultureAt, fieldsBeyond,
  RULES_GLSL, PALETTE_GLSL, MAT } from '../src/album/town/rules.js';
import { buildShapes, KINDS, KIND, KIND_TITLES, MAX_TRIS, SLOTS } from '../src/album/town/shapes.js';
import { growTowns, fullRadius, reachOf, RCAP } from '../src/album/town/grow.js';
import { planLobe, planShowcase, ROW, FLAG_WATER } from '../src/album/town/plan.js';
import { mirrorSettle, settleUniforms } from '../src/album/town/state.js';

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

test('settle shapes: eighteen kinds of a few triangles each, all in one small texture', () => {
  const s = buildShapes();
  assert.equal(KINDS.length, 18); assert.equal(KIND_TITLES.length, 18); assert.equal(new Set(KINDS).size, 18);
  assert.equal(s.width, SLOTS); assert.equal(s.height, 36); assert.equal(s.data.length, SLOTS * 36 * 4);
  assert.ok(s.data.length < 25000, `the shape texture is ${s.data.length} bytes`);
  s.tris.forEach((n, k) => assert.ok(n >= 12 && n <= MAX_TRIS, `${KINDS[k]}: ${n} triangles`));
  assert.ok(s.tris.reduce((a, b) => a + b) / 18 < 48, 'on average under 48 triangles a block');
  for (const [k, sh] of s.shapes.entries()) for (const t of sh.t) {
    for (const p of t.p) assert.ok(Math.abs(p[0]) <= .5001 && Math.abs(p[1]) <= .5001 && p[2] >= -.0401 && p[2] < .59, `${KINDS[k]}: corner ${p} outside the footprint`);
    const [a, b, c] = t.p, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(g[0] * t.n[0] + g[1] * t.n[1] + g[2] * t.n[2] > 0, `${KINDS[k]}: a face is wound against its normal`);
    assert.ok(Math.abs(Math.hypot(...t.n) - 1) < 1e-6 && t.mat >= 0 && t.mat <= 9);
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
  assert.ok(PALETTE_GLSL.includes('vec3 settleMat(int m, float atl, float t)')); assert.equal(Object.keys(MAT).length, 10);
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
    assert.ok(stages[i].fields.reduce((a, b) => a + b) > stages[i - 1].fields.reduce((a, b) => a + b), 'and more fields');
    assert.ok(stages[i].keep.reduce((a, b) => a + b) < stages[i - 1].keep.reduce((a, b) => a + b), 'and less forest');
  }
  const m = stages[4], t = m.towns[0];
  assert.ok(t.R < 1 && t.R > .7, `a city of its time is under two km across: ${t.R}`);
  assert.equal(t.byte, Math.max(1, Math.round(Math.PI * t.R ** 2 / ch.area[home] * 255))); assert.ok(Math.abs(m.built[home] - t.byte / 255) < 1e-6);
  assert.ok(m.fields[home] > .15 && m.keep[home] < .6, 'around the houses the land is ploughed and the forest felled');
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
  // on the steep ridge nothing is ploughed
  const acres = m => m.fields.reduce((a, v, k) => a + v * ch.area[k], 0), hill = growTowns(ch, [place(-401, 4405, 650000)], 1, at), flat = growTowns(ch, [place(-205, 4405, 650000)], 1, at);
  assert.ok(acres(hill) > 0 && acres(hill) < acres(flat) * .8, `fields by the ridge ${acres(hill).toFixed(1)} km², on the plain ${acres(flat).toFixed(1)} km²`);
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
    assert.equal(out[(gq + 1) * 4 + 3], 1 + 3, 'the squares around know which one holds the patch'); assert.equal(out[(gq - GN) * 4 + 3], 1 + 7); assert.equal(out[(gq + 3) * 4 + 3], 0);
    const plan = rows(planLobe(L, S, env)); counts.push(plan.length);
    for (const r of plan) assert.ok(r[3] >= 0 && r[3] < KINDS.length && r[8] > 0 && r[8] <= 2 && r[9] > 0 && r[9] <= 2 && r[10] >= 0 && r[10] <= 1, `row ${r}`);
    for (const r of plan) assert.ok(Math.hypot(...centreOf(r).map((v, i) => v - [L.x, L.y][i])) < L.r + .6, 'a block far outside its patch');
  }
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1] * 1.3, `blocks by the size of the settlement: ${counts}`);
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
  assert.equal(showcase.length, 36); assert.deepEqual([...new Set(showcase.map(r => r[3]))].sort((a, b) => a - b), KINDS.map((_, i) => i)); assert.equal(showcase.filter(r => r[7] & 1).length, 18);
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
  const ids = settle.pages.map(p => p.id); assert.ok(ids.includes('town-marks') && ids.includes('town-marks-near'));
});
