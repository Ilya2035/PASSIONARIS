// The forest of the album (docs/album/forest.md): the natural state of the chunks, growing over, the demonstration
// states, the pages, the rules in GLSL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import forest, { naturalForest, wetAt, Regrowth, applyDemo, DEMO, DEMOS, FOREST_RULES, CLOSE_RATE, OLD_AFTER } from '../src/album/aspects/forest.js';
import { existsSync, readFileSync } from 'node:fs';
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
  assert.equal(DEFS.find(d => d.key === 'trees').label, 'Высота леса');
  assert.ok(forest.uniforms.uForestVol && !forest.uniforms.uTreeZone && !forest.uniforms.tForestRise, 'the height of the canopy is a uniform of the ground; the forest brings no texture of its own');
  assert.ok(ids.includes('forest-open'), 'the open woodland of dry country has a page');
  // the contract and what other files take from the rules
  for (const f of ['float forestCover(Px p)', 'void aspForest(Px p, inout Land L)']) assert.ok(forest.glsl.includes(f), f);
  // no forest in the fields: the canopy asks the state of the chunk of 1 km² (setFarm of the settlements) and the built share
  assert.ok(forest.glsl.includes('fFarm = 0.; if (fStand.x > .003) fFarm = setFarm(p.pk);') && forest.glsl.includes('return fStand.x * forestKeep(fFarm, fPat, p.px, p.cC.rg, p.wet);') && /float forestKeep\(float farm, float pat, float px, vec2 people, float wet\)[^}]*people\.x/.test(forest.glsl), 'the forest keeps off ploughed and built land');
  for (const f of ['float albumClosure(float wet)', 'gTreeline', 'gRise']) assert.ok(FOREST_RULES.includes(f) || forest.glsl.includes(f), f);
  for (const f of ['float albumTreeline(float n1)', 'float albumForestShare(', 'vec2 albumStand(', 'float albumConifer(', 'float albumAge(', 'vec3 albumForestTint(']) assert.ok(FOREST_RULES.includes(f), f);
  // words GLSL ES 3.0 keeps for itself must not be used as names (a shader with one does not compile)
  const code = forest.glsl.replace(/\/\/[^\n]*/g, '');
  for (const word of ['patch', 'sample', 'filter', 'input', 'output', 'common', 'active', 'smooth', 'flat']) assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `reserved word ${word}`);
  for (const [o, c] of ['()', '{}', '[]']) assert.equal(code.split(o).length, code.split(c).length, `balanced ${o}${c}`);
});

test('no trees stand on the land: the forest is painted, and the height of the crowns it publishes is 0', () => {
  // the layer of 3D trees is gone with its file; nothing in the album asks it for anything any more
  assert.ok(!existsSync(new URL('../src/album/layers/forest.js', import.meta.url)), 'src/album/layers/forest.js is removed');
  const src = readFileSync(new URL('../src/album/aspects/forest.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('layers/forest.js') && /id: 'forest', top: 0/.test(src), 'album.layers.forest.top stays, and is 0');
});
