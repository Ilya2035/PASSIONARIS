// The chunk system of the album (docs/ALBUM-CHUNKS.md): the grid, the state, and the contract of the aspects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, CHANNELS, CHUNK_KM, CN, CI0, CJ0, kmOf, llOf } from '../src/album/chunks.js';
import { ASPECTS, ASPECT_GLSL } from '../src/album/aspects/index.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';
import { BBOX } from '../src/album/geo.js';

test('chunks: the grid covers the whole region of the album and maps points to chunks and back', () => {
  const ch = new Chunks();
  for (const [lat, lon] of [[BBOX.lat0, BBOX.lon0], [BBOX.lat1, BBOX.lon1], [BBOX.lat0, BBOX.lon1], [BBOX.lat1, BBOX.lon0], [40, -2.75]]) assert.ok(ch.at(lat, lon) >= 0, `${lat},${lon} is inside the grid`);
  assert.equal(ch.at(50, 0), -1); assert.equal(ch.at(40, 20), -1);
  for (const k of [0, 77, CN * 60 + 31, ch.count - 1]) { const c = ch.centre(k); assert.equal(ch.at(c.lat, c.lon), k); assert.equal(ch.k(ch.ij(k).i, ch.ij(k).j), k); }
  assert.deepEqual(ch.ij(0), { i: CI0, j: CJ0 });
  const [x, y] = kmOf(41.3, -3.7), b = llOf(x, y);
  assert.ok(Math.abs(b.lat - 41.3) < 1e-9 && Math.abs(b.lon + 3.7) < 1e-9);
  const a = ch.centre(500), n = ch.centre(501), up = ch.centre(500 + CN);
  assert.ok(Math.abs(n.x - a.x - CHUNK_KM) < 1e-9 && Math.abs(up.y - a.y - CHUNK_KM) < 1e-9, 'neighbours are 10 km apart');
  assert.equal(ch.neighbours(0).length, 2); assert.equal(ch.neighbours(CN + 1).length, 4);
});

test('chunks: state is kept as 0..1, starts natural, and reset() returns to the natural state', () => {
  const ch = new Chunks(), k = 1234;
  assert.equal(ch.get('forest', k), 1); assert.equal(ch.get('ice', k), 0);
  ch.set('forest', k, .4); ch.add('ice', k, .5); ch.add('ice', k, .9);
  assert.ok(Math.abs(ch.get('forest', k) - .4) < .003); assert.equal(ch.get('ice', k), 1, 'values stay inside 0..1');
  const v = ch.version; ch.set('forest', k, .4); assert.equal(ch.version, v, 'no change, no new version');
  ch.setNatural('swamp', k, .6);
  let called = 0; ch.onReset(c => { called++; c.set('snow', k, 1); });
  ch.reset();
  assert.equal(ch.get('forest', k), 1); assert.equal(ch.get('ice', k), 0); assert.ok(Math.abs(ch.get('swamp', k) - .6) < .003);
  assert.equal(called, 1); assert.equal(ch.get('snow', k), 1, 'an aspect lays its own state over the natural one');
});

test('chunks: every channel has its own byte, and the land share is measured from heights', () => {
  const seen = new Set();
  for (const [name, c] of Object.entries(CHANNELS)) { const id = c[0] + c[1]; assert.ok(!seen.has(id), `${name} shares a byte`); seen.add(id); assert.ok('ABC'.includes(c[0]) && c[1] >= 0 && c[1] < 4 && c[2]); }
  const ch = new Chunks((lat, lon) => (lon < -2.75 ? 500 : -100));     // land in the west, sea in the east
  assert.equal(ch.land[ch.at(40, -6)], 1); assert.equal(ch.land[ch.at(40, 1)], 0); assert.equal(ch.height[ch.at(40, -6)], 500);
});

test('chunks: extra numbers per chunk are layers, and show() paints any of them as squares', () => {
  const ch = new Chunks(), iron = ch.layer('iron', { title: 'Железо', unit: 'т' });
  assert.equal(iron.data.length, ch.count); assert.equal(ch.layer('iron'), iron); assert.equal(iron.sum, true);
  iron.data[7] = 3;
  ch.show(iron.data, { max: 3 });
  assert.ok(ch.uniforms.uChunkShow.value > 0); assert.equal(ch.bytes.D[7 * 4 + 3], 255); assert.equal(ch.bytes.D[8 * 4 + 3], 0, 'empty chunks stay clear');
  ch.show(null); assert.equal(ch.uniforms.uChunkShow.value, 0);
});

test('aspects: each has an id and the functions the ground shader calls; knobs and pages do not collide', () => {
  const need = { swamp: /void aspSwamp\(Px p, inout Land L\)/, settle: /void aspSettle\(Px p, inout Land L\)/, forest: /void aspForest\(Px p, inout Land L\)[\s\S]*|float forestCover\(Px p\)/,
    water: /vec3 aspWater\(Px p\)/, division: /void aspDivision\(Px p, inout vec3 col, float landA\)/ };
  for (const [id, re] of Object.entries(need)) { const a = ASPECTS.find(x => x.id === id); assert.ok(a, `aspect ${id}`); assert.match(a.glsl, re, `${id}: contract function`); }
  for (const f of ['float forestCover(Px p)', 'void aspForest(Px p, inout Land L)', 'vec3 districtAt(vec2 pk)']) assert.ok(ASPECT_GLSL.includes(f), f);
  const keys = DEFS.map(d => d.key); assert.equal(new Set(keys).size, keys.length, 'knob keys are unique');
  const ids = PAGES.map(p => p.id); assert.equal(new Set(ids).size, ids.length, 'page ids are unique');
  const groups = PAGES.map(p => p.group), firstSeen = [...new Set(groups)];
  assert.deepEqual(groups, firstSeen.flatMap(g => groups.filter(x => x === g)), 'pages of one group stand together');
});
