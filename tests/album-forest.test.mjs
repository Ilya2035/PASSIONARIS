// The forest of the album (docs/album/forest.md): the natural state of the chunks, growing over, the demonstration
// states, the pages, and the parts of the 3D trees that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import forest, { naturalForest, wetAt, Regrowth, applyDemo, DEMO, DEMOS, FOREST_RULES, CLOSE_RATE, OLD_AFTER } from '../src/album/aspects/forest.js';
import { treeLevel, crownGeometry, G, K0, S0, CROWN, treeTop, shoreDistance, lakeTiles, lakeEdge, LAKE_T, LAKE_PAD } from '../src/album/layers/forest.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const near = (a, b, e = .004) => Math.abs(a - b) <= e;
const model = (ch, speed = 1, natAge = .9) => new Regrowth(ch, new Float32Array(ch.count).fill(speed), new Float32Array(ch.count).fill(natAge));
const LAND = new Chunks(() => 300), land = () => { LAND.reset(); return LAND; };   // one world of plain land for all tests, reset for each

test('forest nature: conifers in the mountains and the dry south, broadleaf on the Atlantic coast; old forest where it is wet', () => {
  const coast = naturalForest(43.3, -4, 100), pyrenees = naturalForest(42.6, .7, 1800), dry = naturalForest(37.8, -1.8, 400), meseta = naturalForest(40.5, -3.5, 800);
  assert.ok(coast.conifer < .15, `Atlantic lowland is broadleaf: ${coast.conifer}`);
  assert.ok(pyrenees.conifer > .8, `the mountain belt is conifer: ${pyrenees.conifer}`);
  assert.ok(dry.conifer > .5 && dry.conifer < .8, `the dry south is pine and juniper: ${dry.conifer}`);
  assert.ok(meseta.conifer > coast.conifer && meseta.conifer < pyrenees.conifer, 'the interior is mixed');
  assert.ok(coast.age > .85 && dry.age < coast.age - .2 && naturalForest(42.6, .7, 2200).age < coast.age - .2, 'old forest in wet mild country, younger wood where it is dry or high');
  assert.ok(coast.speed > dry.speed && coast.speed > naturalForest(42.6, .7, 2200).speed, 'wet lowland grows over fastest');
  for (let lat = 35.5; lat < 45; lat += 1.7) for (let lon = -10; lon < 4.5; lon += 2.3) for (const h of [0, 500, 1400, 2600]) for (const jit of [-.5, .5]) {
    const n = naturalForest(lat, lon, h, jit);
    assert.ok(n.conifer >= 0 && n.conifer <= 1 && n.age >= 0 && n.age <= 1 && n.speed > .2 && n.speed < 1.21, `${lat},${lon},${h}`);
  }
  assert.ok(wetAt(43.3, -4, 0) > .7 && wetAt(37.6, -1.8, 0) < .2, 'the wetness twin: wet north, dry south-east');
});

test('forest growing over: a felled chunk closes with young forest, then the forest grows old', () => {
  const ch = land(), m = model(ch), k = ch.at(42, -3);
  m.sync();
  ch.set('forest', k, 0); ch.set('age', k, .9);                     // felled by someone else
  m.sync();
  let lastF = 0, lastA = 0; const seen = {};
  for (let y = 5; y <= 300; y += 5) {
    m.step(5);
    const f = ch.get('forest', k), a = ch.get('age', k);
    assert.ok(f >= lastF - 1e-9, `forest never shrinks while growing over (year ${y})`);
    if (y > 20) assert.ok(a >= lastA - .004, `the forest grows older (year ${y})`);
    lastF = f; lastA = a; seen[y] = { f, a };
  }
  assert.ok(seen[10].f > .05 && seen[10].f < .6 && seen[10].a < .1, `brush after 10 years: ${JSON.stringify(seen[10])}`);
  assert.ok(seen[40].f > .85 && seen[40].a < .3, `young closed forest after 40 years: ${JSON.stringify(seen[40])}`);
  assert.ok(seen[150].f > .99 && seen[150].a > .6, `grown forest after 150 years: ${JSON.stringify(seen[150])}`);
  assert.ok(near(seen[300].a, .9), 'old forest in the end, no older than nature allows');
  const far = ch.at(38, -6);
  assert.ok(near(ch.get('forest', far), 1) && near(ch.get('age', far), ch.getNatural('age', far), .11), 'untouched chunks stay as they were');
  assert.ok(CLOSE_RATE > 0 && OLD_AFTER > 50);
});

test('forest growing over: the edge of a large clearing closes first, and time adds up', () => {
  const ch = land(), a = model(ch), c = ch.at(42, -3), ring = ch.ring(c, 4);          // a clearing four chunks deep around c
  const cut = () => { for (const [k] of ring) ch.set('forest', k, 0); };
  a.sync(); cut(); a.sync(); a.step(18);
  const rim = ring.filter(([, d]) => d === 4).map(([k]) => ch.get('forest', k)), edge = rim.reduce((s, v) => s + v, 0) / rim.length, middle = ch.get('forest', c);
  assert.ok(rim.length > 6 && edge > middle + .1, `edge ${edge} closes before the middle ${middle}`);
  assert.equal(a.years, 18);
  ch.reset(); const b = model(ch);
  b.sync(); cut(); b.sync(); for (let i = 0; i < 9; i++) b.step(2);
  assert.ok(near(ch.get('forest', c), middle, .02), 'nine steps of two years are one step of eighteen');
  // seeds come across the borders with the land chunks around, each by its share of the common border
  assert.ok(ch.links[c].length >= 3 && a.nb[c].every(([k, share]) => ch.kind[k] === 1 && share > 0) && near(a.nb[c].reduce((s, [, share]) => s + share, 0), 1, 1e-6));
});

test('forest growing over: fields and houses hold the land; felling by others is taken in; reset starts again', () => {
  const ch = land(), m = model(ch), k = ch.at(41, -2), k2 = ch.at(41, -4);
  m.sync();
  ch.set('forest', k, 0); ch.set('fields', k, .6); ch.set('built', k, .1);
  m.sync(); m.step(400);
  assert.ok(near(ch.get('forest', k), .3, .01), `forest returns only to the land nobody holds: ${ch.get('forest', k)}`);
  ch.set('forest', k2, .4); m.sync();                                // the brush tool, the settlements …
  assert.ok(near(m.F[k2], .4), 'a change made by others is the new state of the model');
  m.step(3); assert.ok(ch.get('forest', k2) > .4 && ch.get('forest', k2) < .7, 'and it grows on from there');
  ch.add('forest', k2, .3); const before = m.A[k2]; m.sync();
  assert.ok(m.A[k2] < before, 'forest added by hand is young');
  ch.reset(); m.restart(); m.sync();
  assert.equal(ch.get('forest', k), 1); assert.ok(near(m.F[k], 1) && m.years === 0, 'after a reset the model starts from the natural state');
  m.step(50); assert.equal(ch.get('forest', k), 1);
  ch.set('forest', k, .2); m.sync(); m.step(30); m.rewind();
  assert.ok(near(ch.get('forest', k), 1), 'rewind returns to the state of the last restart');
});

test('forest demonstrations: only the forest channels change, only around the showcase', () => {
  for (const id of Object.keys(DEMOS)) {
    const ch = new Chunks(), before = { A: ch.bytes.A.slice(), B: ch.bytes.B.slice(), C: ch.bytes.C.slice() };
    applyDemo(ch, id);
    let changed = 0;
    const [ox, oy] = kmOf(DEMO.lat, DEMO.lon);
    for (let k = 0; k < ch.count; k++) {
      for (const t of 'BC') for (let b = 0; b < 4; b++) assert.equal(ch.bytes[t][k * 4 + b], before[t][k * 4 + b], `${id}: channel ${t}${b} untouched`);
      assert.equal(ch.bytes.A[k * 4 + 3], before.A[k * 4 + 3], `${id}: swamp untouched`);
      const dirty = [0, 1, 2].some(b => ch.bytes.A[k * 4 + b] !== before.A[k * 4 + b]);
      if (dirty) { changed++; const c = ch.centre(k); assert.ok(Math.abs(c.x - ox) <= 95 && Math.abs(c.y - oy) <= 95 && ch.kind[k] === 1, `${id}: far chunk changed`); }
    }
    assert.ok(changed > 20, `${id} changes chunks: ${changed}`);
  }
  const ch = new Chunks(), [ox, oy] = kmOf(DEMO.lat, DEMO.lon);
  applyDemo(ch, 'kinds');
  // a chunk belongs to the band its middle lies in: chunks whose middles sit near the middle of a band are surely its own
  const shareAt = dx => { const q = llOf(ox + dx, oy), k = ch.at(q.lat, q.lon), c = ch.centre(k); return Math.abs(c.x - ox - dx) < 12 ? Math.round(ch.get('conifer', k) * 2) / 2 : dx / 60 + .5; };
  assert.deepEqual([-30, 0, 30].map(shareAt), [0, .5, 1], 'three bands: broadleaf, mixed, conifer');
  applyDemo(ch, 'nothing'); applyDemo(ch, '');
  assert.ok(DEMO.lat > 35.2 && DEMO.lat < 44.8 && ch.at(DEMO.lat, DEMO.lon) >= 0);
});

test('forest aspect: pages of the group «Лес», knobs, and the rules in GLSL', () => {
  const pages = PAGES.filter(p => p.group === 'Лес'), ids = pages.map(p => p.id), keys = new Set(DEFS.map(d => d.key));
  assert.ok(pages.length >= 6, `at least six forest pages: ${pages.length}`);
  for (const id of ['forest-kinds', 'forest-density', 'forest-age', 'forest-regrow', 'forest-seam', 'forest-seam-grid', 'forest-3d', 'forest-moss', 'forest-500']) assert.ok(ids.includes(id), id);
  const height = id => pages.find(p => p.id === id).cam.h;
  assert.ok(height('forest-3d') <= 25 && height('forest-moss') === 200 && height('forest-500') === 500, 'the forest is shown from 20, 200 and 500 km');
  for (const pg of pages) for (const [k, v] of Object.entries(pg.p || {})) { assert.ok(keys.has(k), `${pg.id}: ${k}`); if (k === 'forestDemo') assert.ok(DEMOS[v], v); }
  for (const key of ['forest', 'trees', 'forest3d', 'forestDemo', 'regrow']) assert.ok(keys.has(key), key);
  assert.equal(DEFS.find(d => d.key === 'trees').label, 'Размер деревьев');
  assert.ok(forest.uniforms.uTreeZone, 'the zone of the 3D trees is a uniform of the ground');
  // the contract and what other files take from the rules
  for (const f of ['float forestCover(Px p)', 'void aspForest(Px p, inout Land L)']) assert.ok(forest.glsl.includes(f), f);
  for (const f of ['float albumTreeline(float n1)', 'float albumForestShare(', 'vec2 albumStand(', 'float albumConifer(', 'float albumAge(', 'vec3 albumForestTint(']) assert.ok(FOREST_RULES.includes(f), f);
  // words GLSL ES 3.0 keeps for itself must not be used as names (a shader with one does not compile)
  const code = forest.glsl.replace(/\/\/[^\n]*/g, '');
  for (const word of ['patch', 'sample', 'filter', 'input', 'output', 'common', 'active', 'smooth', 'flat']) assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `reserved word ${word}`);
  for (const [o, c] of ['()', '{}', '[]']) assert.equal(code.split(o).length, code.split(c).length, `balanced ${o}${c}`);
});

test('forest trees: the lattice thins without a jump as the camera rises, and the crown is a closed little shape', () => {
  assert.ok(near(S0, K0 * 20, 1e-9) && G % 2 === 0);
  let last = null;
  for (let h = 20; h <= 170; h += .5) {
    const lv = treeLevel(h);
    assert.ok(lv.n >= 0 && lv.n <= 3 && lv.phase >= 0 && lv.phase <= 1.1 && lv.thin >= 0 && lv.thin <= 1, `h ${h}`);
    assert.ok(near(lv.S, S0 * 2 ** lv.n, 1e-9) && lv.S <= lv.x * 1.0001 && lv.S > lv.x / 2.2, `the cell stays between half the spacing and the spacing (h ${h})`);
    // ground covered by crowns: a quarter of the trees stay and grow, three quarters shrink — the sum stays the same
    const cover = (.25 + .75 * lv.thin ** 2) * (lv.x / lv.S) ** 2;
    assert.ok(near(cover, 1, 1e-6), `cover ${cover} at h ${h}`);
    if (last && lv.n !== last.n) assert.ok(last.thin < .12 && lv.thin > .95, 'a new lattice starts where the old one has thinned out');
    last = lv;
  }
  assert.ok(near(treeLevel(20).thin, 1) && treeLevel(20).n === 0);
  const g = crownGeometry(), V = g.pos.length / 3;
  assert.equal(V, 11); assert.equal(g.idx.length, 45, '15 triangles');
  assert.ok(g.spire.length === g.pos.length && g.nor.length === g.pos.length && g.spireN.length === g.pos.length);
  for (const shape of [g.pos, g.spire]) for (let t = 0; t < g.idx.length; t += 3) {
    const P = i => shape.slice(g.idx[t + i] * 3, g.idx[t + i] * 3 + 3), [a, b, c] = [P(0), P(1), P(2)];
    const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]), n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const out = a.map((v, i) => (v + b[i] + c[i]) / 3); out[2] -= .2;
    assert.ok(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0, `triangle ${t / 3} faces outward`);
  }
  assert.ok(Math.max(...g.pos.filter((_, i) => i % 3 === 2)) < Math.max(...g.spire.filter((_, i) => i % 3 === 2)), 'a conifer is taller than a broadleaf crown');

});

test('forest trees and water: no tree stands in a lake, and the height of the tallest crown is published for the sheets of water', () => {
  // the tallest crown: an old conifer of the largest size; it follows the camera, the size knob and the fade-out
  const spire = crownGeometry().spire, tip = Math.max(...spire.filter((_, i) => i % 3 === 2));
  assert.ok(near(treeTop(40), K0 * 40 * CROWN * 1.12 * 1.08 * tip * 1.25, 1e-9), 'spacing × crown × largest size × oldest × tallest spire');
  assert.ok(near(treeTop(40, 2), 2 * treeTop(40), 1e-9) && treeTop(100) > treeTop(40) && treeTop(170) === 0 && treeTop(400) === 0);
  assert.ok(treeTop(165) < treeTop(120) && treeTop(20) > .1 && treeTop(20) < .16, `near the ground the tallest tree is 100–160 m: ${treeTop(20)}`);
  // the shore: signed distance to the true outline
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(near(shoreDistance(sq, 2, 2), 2, 1e-9) && near(shoreDistance(sq, 1, 2), 1, 1e-9) && near(shoreDistance(sq, -3, 2), -3, 1e-9) && near(shoreDistance(sq, 7, 8), -5, 1e-9));
  // a lake of about 4 by 4 km: its tile holds the distance to the shore, cut off at LAKE_PAD km
  const c = llOf(-100, 4700), d = llOf(-96, 4704), lake = { ring: [[c.lon, c.lat], [d.lon, c.lat], [d.lon, d.lat], [c.lon, d.lat]] };
  const { data, rects } = lakeTiles([lake]), at = (x, y) => {                      // what the shader reads at a point, km
    const u = (x - rects[0][0]) * rects[0][2], v = (y - rects[0][1]) * rects[0][3];
    return (data[Math.round(v * (LAKE_T - 1)) * LAKE_T + Math.round(u * (LAKE_T - 1))] / 255 * 2 - 1) * LAKE_PAD;
  };
  assert.equal(data.length, LAKE_T * LAKE_T); assert.ok(near(rects[0][0], -100 - LAKE_PAD, 1e-6) && near(1 / rects[0][2], 4 + 2 * LAKE_PAD, 1e-6));
  assert.equal(at(-98, 4702), LAKE_PAD, 'deep in the lake'); assert.ok(near(at(-100, 4702), 0, .06), 'on the shore'); assert.ok(near(at(-100.5, 4702), -.5, .06), 'half a km outside');
  assert.ok(near(at(-99.7, 4702), .3, .06) && at(-100.95, 4700) < -.9);
  assert.equal(lakeTiles([]).rects.length, 0);
  assert.ok(lakeEdge(20) >= .06 && lakeEdge(20) < .12 && lakeEdge(160) > lakeEdge(20) && lakeEdge(160) < .3, 'trees keep off the beach, further from high above');
});
