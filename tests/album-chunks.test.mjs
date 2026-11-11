// The chunk system of the album (docs/ALBUM-CHUNKS.md): the natural shapes of the chunks, their state, and the
// contract of the aspects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunks, buildCells, CHANNELS, CHUNK_KM, CN, CI0, CJ0, FN, FKM, kmOf, llOf } from '../src/album/chunks.js';
import { ASPECTS, ASPECT_GLSL } from '../src/album/aspects/index.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';
import { BBOX } from '../src/album/geo.js';

const flat = new Chunks();      // a world of plain land without rivers
// land west of 2.75° W, sea east of it, and one great river running north along 6° W
const river = { rank: 5, pts: Array.from({ length: 81 }, (_, i) => [-6, 36 + i * .1]) };
const world = new Chunks((lat, lon) => (lon < -2.75 ? 300 : -100), [river]);

test('chunks: every texel lies in one chunk; chunks are about 100 km², rounded, and are not the lattice squares', () => {
  assert.ok(flat.count >= CN * CN);
  let max = 0; for (const v of flat.cell) if (v > max) max = v;
  assert.ok(max < flat.count, 'every texel has a chunk');
  let sum = 0, lo = 1e9, hi = 0, shape = 0;
  for (let k = 0; k < CN * CN; k++) { const a = flat.area[k]; sum += a; lo = Math.min(lo, a); hi = Math.max(hi, a); const per = flat.links[k].reduce((s, l) => s + l.km, 0); shape += per * per / (4 * Math.PI * a); }
  const mean = sum / (CN * CN);
  assert.ok(mean > 95 && mean < 105, `mean area ${mean}`);
  assert.ok(lo > 20 && hi < 300, `areas from ${lo} to ${hi}`);
  assert.ok(shape / (CN * CN) < 2.6, `outlines are compact, ${shape / (CN * CN)}`);
  let off = 0;                    // texels that belong to a chunk other than the one seeded in their own square
  const Q = CHUNK_KM / FKM;
  for (let ty = 0; ty < FN; ty += 3) for (let tx = 0; tx < FN; tx += 3) if (flat.cell[ty * FN + tx] !== Math.floor(ty / Q) * CN + Math.floor(tx / Q)) off++;
  assert.ok(off / (FN * FN / 9) > .2, `a chunk is not its square: ${off / (FN * FN / 9)}`);
});

test('chunks: points map to chunks and back; the mapped square covers the whole region of the album', () => {
  for (const [lat, lon] of [[BBOX.lat0, BBOX.lon0], [BBOX.lat1, BBOX.lon1], [BBOX.lat0, BBOX.lon1], [BBOX.lat1, BBOX.lon0], [40, -2.75]]) assert.ok(flat.at(lat, lon) >= 0, `${lat},${lon} is inside`);
  assert.equal(flat.at(50, 0), -1); assert.equal(flat.at(40, 20), -1);
  let inside = 0;
  for (let k = 3000; k < 5000; k++) { const c = flat.centre(k); if (flat.at(c.lat, c.lon) === k) inside++; }
  assert.ok(inside > 1900, `the middle of a chunk lies in the chunk: ${inside} of 2000`);
  const [x, y] = kmOf(41.3, -3.7), b = llOf(x, y);
  assert.ok(Math.abs(b.lat - 41.3) < 1e-9 && Math.abs(b.lon + 3.7) < 1e-9);
  assert.equal(flat.k(CI0, CJ0), 0); assert.deepEqual(flat.ij(0), { i: CI0, j: CJ0 }); assert.equal(flat.k(CI0 - 1, CJ0), -1);
});

test('chunks: neighbours share a border both ways; ring() walks outward by steps', () => {
  const k = 7000;
  assert.ok(flat.links[k].length >= 3 && flat.links[k].length <= 10, `neighbours ${flat.links[k].length}`);
  for (const l of flat.links[k]) { const back = flat.links[l.k].find(m => m.k === k); assert.ok(back && back.km === l.km && l.km > 0); }
  assert.deepEqual(flat.neighbours(k), flat.links[k].map(l => l.k));
  assert.deepEqual(flat.ring(k, 0), [[k, 0]]);
  const r1 = flat.ring(k, 1), r2 = flat.ring(k, 2);
  assert.equal(r1.length, flat.links[k].length + 1); assert.ok(r2.length > r1.length && r2.every(([, d]) => d <= 2));
});

test('chunks: land and water never share a chunk, the coast and a river are borders', () => {
  const a = world.at(40, -6.5), s = world.at(40, 1);
  assert.equal(world.kind[a], 1); assert.equal(world.land[a], 1); assert.equal(world.height[a], 300);
  assert.equal(world.kind[s], 0); assert.equal(world.land[s], 0);
  for (let lat = 37; lat <= 43; lat += .25) { assert.equal(world.kind[world.at(lat, -2.78)], 1, `land at ${lat}`); assert.equal(world.kind[world.at(lat, -2.72)], 0, `sea at ${lat}`); }
  let across = 0, plain = 0, n = 0;
  for (let lat = 36.5; lat <= 43.5; lat += .05, n++) {
    if (world.at(lat, -6.035) !== world.at(lat, -5.965)) across++;       // 3 km either side of the river
    if (world.at(lat, -8.035) !== world.at(lat, -7.965)) plain++;        // the same step where there is no river
  }
  assert.ok(across / n > .88, `the river divides chunks along ${across} of ${n} points`);
  assert.ok(across - plain > n * .2, `far more often than open ground does (${plain})`);
  assert.ok(world.links.some(ls => ls.some(l => l.river === 2 && l.wet > 0)), 'borders along the river are marked');
});

test('chunks: the same data give the same chunks', () => {
  const a = buildCells(), b = buildCells();
  assert.equal(a.count, b.count); assert.deepEqual(a.cell, b.cell);
});

test('chunks: state is kept as 0..1, starts natural, and reset() returns to the natural state', () => {
  const ch = flat, k = 1234;
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

test('chunks: the rasters the shaders read hold every chunk in its own outline, with soft steps', () => {
  const ch = new Chunks(), k = 8000, c = ch.centre(k);
  ch.set('ice', k, 1); ch.flush();
  const SN = FN / 2, [x, y] = kmOf(c.lat, c.lon), sx = Math.floor((x - CI0 * CHUNK_KM) / 2.5), sy = Math.floor((y - CJ0 * CHUNK_KM) / 2.5);
  assert.ok(ch.raster.B[(sy * SN + sx) * 4] > 200, 'full in the middle of the chunk');
  assert.equal(ch.raster.B[((sy + 12) * SN + sx) * 4], 0, 'nothing 30 km away');
  let soft = 0; for (let d = -8; d <= 8; d++) { const v = ch.raster.B[(sy * SN + sx + d) * 4]; if (v > 10 && v < 245) soft++; }
  assert.ok(soft >= 2, 'the edge is a soft step');
  const seen = new Set();
  for (const [name, ch2] of Object.entries(CHANNELS)) { const id = ch2[0] + ch2[1]; assert.ok(!seen.has(id), `${name} shares a byte`); seen.add(id); assert.ok('ABC'.includes(ch2[0]) && ch2[1] >= 0 && ch2[1] < 4 && ch2[2]); }
});

test('chunks: extra numbers per chunk are layers, and show() paints any of them, chunk by chunk', () => {
  const ch = flat, iron = ch.layer('iron', { title: 'Железо', unit: 'т' });
  assert.equal(iron.data.length, ch.count); assert.equal(ch.layer('iron'), iron); assert.equal(iron.sum, true);
  iron.data[7] = 3;
  ch.show(iron.data, { max: 3 });
  assert.ok(ch.uniforms.uChunkShow.value > 0); assert.equal(ch.pal[7 * 4 + 3], 255); assert.equal(ch.pal[8 * 4 + 3], 0, 'empty chunks stay clear');
  assert.ok(ch.palW * ch.palW >= ch.count);
  ch.show(null); assert.equal(ch.uniforms.uChunkShow.value, 0);
});

test('aspects: each has an id and the functions the ground shader calls; knobs and pages do not collide', () => {
  const need = { swamp: /void aspSwamp\(Px p, inout Land L\)/, settle: /void aspSettle\(Px p, inout Land L\)/, forest: /void aspForest\(Px p, inout Land L\)/,
    water: /vec3 aspWater\(Px p\)/, division: /void aspDivision\(Px p, inout vec3 col, float landA\)/ };
  for (const [id, re] of Object.entries(need)) { const a = ASPECTS.find(x => x.id === id); assert.ok(a, `aspect ${id}`); assert.match(a.glsl, re, `${id}: contract function`); }
  for (const f of ['float forestCover(Px p)', 'void aspForest(Px p, inout Land L)', 'vec3 districtAt(vec2 pk)']) assert.ok(ASPECT_GLSL.includes(f), f);
  const keys = DEFS.map(d => d.key); assert.equal(new Set(keys).size, keys.length, 'knob keys are unique');
  const ids = PAGES.map(p => p.id); assert.equal(new Set(ids).size, ids.length, 'page ids are unique');
  const groups = PAGES.map(p => p.group), firstSeen = [...new Set(groups)];
  assert.deepEqual(groups, firstSeen.flatMap(g => groups.filter(x => x === g)), 'pages of one group stand together');
});
