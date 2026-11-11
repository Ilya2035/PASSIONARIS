// Settlements of the album (docs/album/settle.md): the shapes of the buildings, the rules of a patch, the model of
// growth and the plan of the blocks — everything that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, CHUNK_KM, CN, kmOf, llOf } from '../src/album/chunks.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';
import settle from '../src/album/aspects/settle.js';
import { RMAX, RVIS, CULTURES, STAGES, stageOf, cellHash, cellRule, lobeOf, zoomLobe, zoomAt, cellSize, radiusByte, siteBytes, cultureAt, RULES_GLSL, PALETTE_GLSL, MAT } from '../src/album/town/rules.js';
import { buildShapes, KINDS, KIND, KIND_TITLES, MAX_TRIS, SLOTS } from '../src/album/town/shapes.js';
import { growTowns, sampleLand, fullRadius, RCAP } from '../src/album/town/grow.js';
import { planLobe, planShowcase, ROW, FLAG_WATER } from '../src/album/town/plan.js';
import { mirrorSettle, settleUniforms } from '../src/album/town/state.js';

// a flat land 300 m high with the sea east of x = 100 km and a steep ridge west of x = −400 km
const at = (x, y) => (x > 100 ? -50 : x < -400 ? 300 + (-400 - x) * 600 : 300);
const atLL = (lat, lon) => at(...kmOf(lat, lon));
const env = { at, river: () => 1e9, swamp: () => 0 };
const world = () => { const ch = new Chunks(atLL); return { ch, land: sampleLand(ch, at) }; };
const place = (x, y, pop) => ({ ...llOf(x, y), pop });
const rows = flat => Array.from({ length: flat.length / ROW }, (_, i) => flat.slice(i * ROW, i * ROW + ROW));
// where a block of the plan stands, km
const centreOf = (r, S) => { const c = Math.cos(r[2]), s = Math.sin(r[2]); return [r[0] + (c * r[4] - s * r[5]) * S, r[1] + (s * r[4] + c * r[5]) * S]; };

test('settle shapes: twelve kinds of a few triangles each, all in one small texture', () => {
  const s = buildShapes();
  assert.equal(KINDS.length, 12); assert.equal(KIND_TITLES.length, 12); assert.equal(s.tris.length, 12);
  assert.equal(s.width, SLOTS); assert.equal(s.height, 24); assert.equal(s.data.length, SLOTS * 24 * 4);
  assert.ok(s.data.length < 20000, `the shape texture is ${s.data.length} bytes`);
  s.tris.forEach((n, k) => assert.ok(n >= 12 && n <= MAX_TRIS, `${KINDS[k]}: ${n} triangles`));
  assert.ok(s.tris.reduce((a, b) => a + b) / 12 < 48, 'on average under 48 triangles a block');
  for (const [k, sh] of s.shapes.entries()) for (const t of sh.t) {
    for (const p of t.p) assert.ok(Math.abs(p[0]) <= .5001 && Math.abs(p[1]) <= .5001 && p[2] >= -.0401 && p[2] < .59, `${KINDS[k]}: corner ${p} outside the footprint`);
    const [a, b, c] = t.p, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(g[0] * t.n[0] + g[1] * t.n[1] + g[2] * t.n[2] > 0, `${KINDS[k]}: a face is wound against its normal`);
    assert.ok(Math.abs(Math.hypot(...t.n) - 1) < 1e-6 && t.mat >= 0 && t.mat <= 9);
  }
  // heights are close to real against the plan: nothing but towers and sails rises above a quarter of a block
  for (const name of ['quarter', 'rows', 'terrace', 'cluster', 'farm', 'house', 'market', 'site']) assert.ok(Math.max(...s.shapes[KIND[name]].t.flatMap(t => t.p.map(p => p[2]))) <= .2, name);
});

test('settle rules: one hash and one rule for the plan and for the shader', () => {
  const seen = new Set(); let sum = 0;
  for (let i = -40; i < 40; i++) for (let j = -40; j < 40; j++) { const h = cellHash(i, j, 777, 1); assert.ok(h >= 0 && h < 1); seen.add(Math.floor(h * 64)); sum += h; }
  assert.equal(seen.size, 64, 'the hash fills its range'); assert.ok(Math.abs(sum / 6400 - .5) < .02);
  assert.equal(cellHash(3, -5, 1234, 2), cellHash(3, -5, 1234, 2)); assert.notEqual(cellHash(3, -5, 1234, 2), cellHash(3, -5, 1234, 3));
  assert.ok(RULES_GLSL.includes(`#define SET_RMAX ${RMAX.toFixed(4)}`) && RULES_GLSL.includes(`#define SET_RVIS ${RVIS.toFixed(4)}`) && RULES_GLSL.includes(`#define SET_CN ${CN}`));
  for (const f of ['float setHash(ivec2 id, int k, int salt)', 'float setWob(vec2 pk)', 'float setCell(']) assert.ok(RULES_GLSL.includes(f), f);
  assert.ok(PALETTE_GLSL.includes('vec3 settleMat(int m, float atl, float t)')); assert.equal(Object.keys(MAT).length, 10);
  // a radius byte and back: the patch of a chunk has the area of its built share
  assert.equal(radiusByte(0), 0); assert.equal(radiusByte(1), 255); assert.equal(radiusByte(1 / 255), 16);
  const L = lobeOf(CN * 60 + 40, 128, 128, radiusByte(.25), CULTURES.med);
  assert.ok(Math.abs(Math.PI * L.r ** 2 - 25) < 1, `a quarter of a chunk: ${(Math.PI * L.r ** 2).toFixed(1)} km²`);
  assert.deepEqual(siteBytes(L.x, L.y), [128, 128]);
  assert.equal(stageOf(.35), 0); assert.equal(stageOf(.6), 1); assert.equal(stageOf(1.2), 2); assert.equal(stageOf(2.3), 3); assert.equal(stageOf(4.2), 4); assert.equal(STAGES.length, 5);
  assert.equal(cultureAt(43.25, -2.93), CULTURES.atl); assert.equal(cultureAt(41.65, -.89), CULTURES.med);
});

test('settle rules: what stands in a cell follows the size and the manner of the settlement', () => {
  const S = cellSize(20), count = L => { const n = {}; for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) { const c = cellRule(i, j, L, S); if (c) n[c.cls] = (n[c.cls] || 0) + 1; } return n; };
  const k = CN * 60 + 40, hamlet = lobeOf(k, 128, 128, 16, CULTURES.med), town = lobeOf(k, 128, 128, radiusByte(.17), CULTURES.med), city = lobeOf(k, 128, 128, radiusByte(.6), CULTURES.med), atl = lobeOf(k, 128, 128, radiusByte(.6), CULTURES.atl);
  const h = count(hamlet), t = count(town), c = count(city), a = count(atl);
  assert.ok(h[3] >= 2 && h[3] <= 9 && !h[1] && !h[2] && !h[4], `a hamlet is a few farmsteads: ${JSON.stringify(h)}`);
  assert.ok(t[4] === 1 && t[1] > 3 && t[2] > 10 && t[3] > 10, `a small town has a square, blocks, rows and houses: ${JSON.stringify(t)}`);
  assert.ok(c[1] > t[1] * 3 && c[1] + c[2] > 150, `a city has hundreds of blocks: ${JSON.stringify(c)}`);
  assert.ok(a[3] > 150 && !a[1] && !a[2] && !a[4], `the Atlantic manner is loose farmsteads only: ${JSON.stringify(a)}`);
  assert.ok(a[3] < (c[1] + c[2] + c[3]) * .85, 'and stands looser');
  assert.ok(t[5] > 0 && c[5] > t[5], 'building sites stand just outside a growing settlement');
  assert.equal(cellRule(0, 0, city, S).cls, 4); assert.ok(cellRule(0, 0, hamlet, S).cls === 3);
  // every footprint stays inside its cell (rotated Atlantic yards may lean out a little)
  for (const L of [hamlet, town, city]) for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) { const r = cellRule(i, j, L, S); if (r) assert.ok(Math.abs(r.ox) + r.hx <= .5001 && Math.abs(r.oy) + r.hy <= .5001, `cell ${i},${j}`); }
  // from high up a settlement smaller than one cell is a single mark; higher still it is drawn larger than life
  const far = cellRule(0, 0, hamlet, cellSize(120)); assert.ok(far.mark && far.hx >= .12 && cellRule(1, 0, hamlet, cellSize(120)) === null);
  assert.equal(zoomAt(20), 1); assert.equal(zoomAt(60), 1); assert.ok(zoomAt(200) > 1.5 && zoomAt(500) > zoomAt(200));
  assert.equal(zoomLobe(lobeOf(k, 128, 128, 255, 1), zoomAt(500)).re, RVIS); assert.ok(zoomLobe(lobeOf(k, 128, 128, 16, 1), zoomAt(500)).re > .8);
  assert.ok(cellSize(200) > cellSize(50) && cellSize(50) > cellSize(20) && cellSize(20, 2) === cellSize(20) * 2);
});

test('settle growth: a place grows from a hamlet to a city and writes houses, fields and felling into the chunks', () => {
  const { ch, land } = world(), pl = [place(-205, 4405, 650000)], k = ch.at(pl[0].lat, pl[0].lon);
  const stages = [.08, .16, .3, .55, 1].map(g => growTowns(ch, pl, g, at, land));
  assert.deepEqual(stages.map(s => s.towns[0].stage), [0, 1, 2, 3, 4]);
  for (let i = 1; i < stages.length; i++) {
    assert.ok(stages[i].built[k] > stages[i - 1].built[k], 'more growth, more houses');
    assert.ok(stages[i].fields.reduce((a, b) => a + b) > stages[i - 1].fields.reduce((a, b) => a + b), 'and more fields');
    assert.ok(stages[i].keep.reduce((a, b) => a + b) < stages[i - 1].keep.reduce((a, b) => a + b), 'and less forest');
  }
  const m = stages[4];
  assert.ok(Math.abs(m.built[k] - (fullRadius(650000) / RMAX) ** 2) < 1e-6 && m.built[k] < 1);
  assert.deepEqual(m.sites.get(k), siteBytes(m.towns[0].x, m.towns[0].y)); assert.ok(Math.abs(m.towns[0].x + 205) < 1e-6);
  assert.ok(m.keep[k] < .05, 'around the houses the forest is felled'); assert.ok(m.fields[k] > .15);
  assert.equal(m.keep[ch.k(-21 + 6, 440)], 1, 'far away it stands untouched'); assert.equal(m.fields[ch.k(-21 + 6, 440)], 0);
  assert.equal(growTowns(ch, pl, 0, at, land).towns.length, 0, 'no growth, no settlement');
  assert.ok(fullRadius(15000) < .9 && fullRadius(5.6e6) > 7.5 && fullRadius(5.6e6) <= RCAP);
});

test('settle growth: a great city spills into the neighbouring chunks; nothing is founded on water; one settlement a chunk', () => {
  const { ch, land } = world();
  const big = growTowns(ch, [place(-205, 4405, 5.6e6)], 1, at, land), t = big.towns[0];
  assert.ok(t.R > RMAX && t.chunks.length >= 5, `chunks of the city: ${t.chunks.length}`);
  assert.equal(big.built[t.k], 1);
  for (const kn of t.chunks.slice(1)) { assert.ok(big.built[kn] > 0 && big.built[kn] < 1 && big.sites.has(kn)); const c = ch.centre(kn); assert.ok(Math.hypot(c.x + 205, c.y - 4405) < 16, 'a lobe lies in a neighbour'); }
  // a place in the sea two km off the shore moves to dry land; one far out is not founded at all
  const coast = growTowns(ch, [place(102, 4405, 300000), place(160, 4405, 300000)], 1, at, land);
  assert.equal(coast.towns.length, 1); assert.ok(coast.towns[0].x <= 100 && at(coast.towns[0].x, coast.towns[0].y) > 0);
  const two = growTowns(ch, [place(-203, 4403, 20000), place(-207, 4407, 900000)], 1, at, land);
  assert.equal(two.towns.length, 1); assert.equal(two.towns[0].index, 1, 'the larger place takes the chunk');
  // on the steep ridge nothing is ploughed
  const hill = growTowns(ch, [place(-405, 4405, 650000)], 1, at, land);
  assert.equal(hill.fields[ch.k(-43, 440)], 0); assert.ok(hill.fields[ch.k(-40, 440)] > 0);
});

test('settle mirror and plan: the blocks are drawn from the built share of the chunks', () => {
  const { ch } = world(), k = ch.k(-21, 440), S = cellSize(20), site = () => [128, 128];
  assert.equal(mirrorSettle(ch, site, new Uint8Array(CN * CN * 4)).lobes.length, 0);
  const counts = [];
  for (const b of [.004, .02, .1, .4, 1]) {
    ch.set('built', k, b);
    const out = new Uint8Array(CN * CN * 4), { lobes, changed } = mirrorSettle(ch, site, out);
    assert.ok(changed); assert.equal(lobes.length, 1); assert.equal(lobes[0].k, k);
    assert.equal(out[k * 4 + 2], radiusByte(ch.get('built', k))); assert.equal(out[k * 4 + 3], 200 + CULTURES.med);
    assert.equal(out[(k + 1) * 4 + 3], 1 + 3, 'the neighbours know which chunk holds the patch'); assert.equal(out[(k - CN) * 4 + 3], 1 + 7); assert.equal(out[(k + 3) * 4 + 3], 0);
    const plan = rows(planLobe(lobes[0], S, env)); counts.push(plan.length);
    for (const r of plan) { assert.ok(r[3] >= 0 && r[3] < 12 && r[8] > 0 && r[8] <= 2 && r[9] > 0 && r[9] <= 2 && r[10] >= 0 && r[10] <= 1, `row ${r}`); }
  }
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1] * 1.5, `blocks by built share: ${counts}`);
  assert.ok(counts[0] >= 2 && counts[0] <= 10 && counts[4] > 400, `from a hamlet to a chunk full of houses: ${counts}`);
  // two built chunks side by side: each names the other, a chunk between knows both, and the patches are rivals
  ch.set('built', k + 2, .1);
  const two = new Uint8Array(CN * CN * 4), pair = mirrorSettle(ch, site, two);
  assert.equal(two[k * 4 + 3], 200 + CULTURES.med); assert.equal(two[(k + 1) * 4 + 3], 10 + 9 * 3 + 5); assert.equal(two[(k + 3) * 4 + 3], 1 + 3);
  ch.set('built', k + 1, .1);
  const three = new Uint8Array(CN * CN * 4), trio = mirrorSettle(ch, site, three);
  assert.equal(three[k * 4 + 3], 110 + 2 * 5 + CULTURES.med - 1); assert.equal(three[(k + 1) * 4 + 3], 210 + CULTURES.med); assert.equal(three[(k + 1 + CN) * 4 + 3], 100);
  assert.equal(pair.lobes[0].rivals.length, 0); assert.equal(trio.lobes.find(L => L.k === k + 1).rivals.length, 2);
  ch.set('built', k + 1, 0); ch.set('built', k + 2, 0);
  // a chunk built up by a brush, with no model behind it, is drawn all the same; its manner comes from the chunk
  ch.set('culture', k, CULTURES.atl / 255);
  const { lobes } = mirrorSettle(ch, site, new Uint8Array(CN * CN * 4));
  assert.equal(lobes[0].cul, CULTURES.atl);
  const kinds = new Set(rows(planLobe(lobes[0], S, env)).map(r => KINDS[r[3]]));
  assert.ok(!kinds.has('quarter') && !kinds.has('market') && kinds.has('farm') && kinds.has('house'), [...kinds].join());
});

test('settle plan: special buildings by the size of the settlement; nothing on water, on a slope, in a swamp or on a river', () => {
  const { ch } = world(), S = cellSize(20), kindsOf = plan => { const n = {}; for (const r of plan) n[KINDS[r[3]]] = (n[KINDS[r[3]]] || 0) + 1; return n; };
  const lobe = (i, j, built, bx = 128, by = 128) => { const L = lobeOf(ch.k(i, j), bx, by, radiusByte(built), CULTURES.med); L.rivals = []; return L; };
  const village = kindsOf(rows(planLobe(lobe(-21, 440, .012), S, env))), town = kindsOf(rows(planLobe(lobe(-21, 440, .17), S, env))), city = kindsOf(rows(planLobe(lobe(-21, 440, .6), S, env)));
  assert.ok(!village.temple && !village.market && !village.fort && !village.quarter, JSON.stringify(village));
  assert.ok(town.temple === 1 && town.market === 1 && town.mill === 2 && !town.fort && town.quarter > 3 && town.site > 0, JSON.stringify(town));
  assert.ok(city.fort === 1 && city.temple >= 1 && city.mill === 3 && city.quarter > 60 && city.rows > 20 && city.house > 20 && city.farm > 5, JSON.stringify(city));
  // a town on the shore: no block stands in the sea, and a pier reaches over the water
  const shore = lobe(9, 440, .25, 200, 128), plan = rows(planLobe(shore, S, env));
  assert.ok(plan.length > 40);
  for (const r of plan) if (!(r[7] & FLAG_WATER)) assert.ok(at(...centreOf(r, S)) > 0, 'a block in the sea');
  const piers = plan.filter(r => KINDS[r[3]] === 'pier'); assert.equal(piers.length, 1); assert.ok(piers[0][7] & FLAG_WATER && Math.abs(piers[0][0] - 100) < .3, 'the pier stands on the shoreline');
  // on the steep ridge, in a swamp and along a river nothing stands
  assert.equal(planLobe(lobe(-45, 440, .25), S, env).length, 0);
  assert.equal(planLobe(lobe(-21, 440, .25), S, { ...env, swamp: () => .8 }).length, 0);
  const L = lobe(-21, 440, .25), free = rows(planLobe(L, S, env)), cut = rows(planLobe(lobe(-21, 440, .25), S, { ...env, river: (x, y) => Math.abs(y - L.y) - .1 }));
  assert.ok(cut.length < free.length - 8); for (const r of cut) assert.ok(Math.abs(centreOf(r, S)[1] - L.y) > .1, 'a block on the river');
});

test('settle plan: the patches of a great city join without their blocks running into each other', () => {
  const { ch, land } = world(), S = cellSize(20), m = growTowns(ch, [place(-205, 4405, 5.6e6)], 1, at, land);
  for (let k = 0; k < ch.count; k++) if (m.built[k] > 0) ch.set('built', k, m.built[k]);
  const { lobes } = mirrorSettle(ch, k => m.sites.get(k), new Uint8Array(CN * CN * 4));
  assert.ok(lobes.length >= 5); assert.ok(lobes.every(L => L.rivals.length >= 1));
  const pts = lobes.flatMap(L => rows(planLobe(L, S, env)).filter(r => r[4] || r[5]).map(r => [...centreOf(r, S), L.k]));
  assert.ok(pts.length > 500, `${pts.length} blocks`);
  const grid = new Map(); let clash = 0;
  for (const p of pts) { const key = `${Math.floor(p[0] / .5)},${Math.floor(p[1] / .5)}`; (grid.get(key) || grid.set(key, []).get(key)).push(p); }
  for (const p of pts) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of grid.get(`${Math.floor(p[0] / .5) + dx},${Math.floor(p[1] / .5) + dy}`) || []) if (q[2] !== p[2] && Math.hypot(p[0] - q[0], p[1] - q[1]) < S * .5) clash++;
  assert.equal(clash, 0, 'blocks of two patches overlap');
  // the city reaches as far as its radius in every direction a lobe grew
  const far = Math.max(...pts.map(p => Math.hypot(p[0] + 205, p[1] - 4405)));
  assert.ok(far > 7 && far < RCAP + 1.5, `the city reaches ${far.toFixed(1)} km`);
});

test('settle album: the aspect, its knobs and its pages', () => {
  assert.match(settle.glsl, /void aspSettle\(Px p, inout Land L\)/);
  assert.equal(settle.uniforms, settleUniforms); assert.ok(settle.uniforms.tSettle.value.isDataTexture && settle.uniforms.uSettle.value.isVector4);
  assert.ok(!/models\.json|GLTFLoader/.test(settle.glsl));
  const keys = new Set(DEFS.map(d => d.key)); for (const k of ['houses', 'houseH', 'growth', 'towns', 'showcase']) assert.ok(keys.has(k), k);
  const ids = settle.pages.map(p => p.id);
  for (const id of ['town-kinds', 'grow-1', 'grow-2', 'grow-3', 'grow-4', 'grow-5', 'town-50', 'town-200', 'town-500', 'town-med', 'town-atl', 'fields', 'town-build', 'town-night']) assert.ok(ids.includes(id), id);
  assert.ok(settle.pages.every(p => p.group === 'Города и дороги' && PAGES.includes(p)));
  const cams = Object.fromEntries(settle.pages.map(p => [p.id, p.cam.h]));
  assert.ok(cams['grow-1'] === 20 && cams['town-50'] === 50 && cams['town-200'] === 200 && cams['town-500'] === 500);
  const showcase = rows(planShowcase(0, 4400, 3));
  assert.equal(showcase.length, 24); assert.deepEqual([...new Set(showcase.map(r => r[3]))].sort((a, b) => a - b), KINDS.map((_, i) => i)); assert.equal(showcase.filter(r => r[7] & 1).length, 12);
  assert.equal(CHUNK_KM, 10);
});
