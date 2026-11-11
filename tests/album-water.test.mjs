// The water of the album (docs/album/water.md): the freeze model, the lakes, the rivers, the pages — what can be
// checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chunks, CHANNELS, CHUNK_KM, CI0, llOf } from '../src/album/chunks.js';
import water, { WATER_CORE, SHEET_FRAG, sheetPull, WATER_UNIFORMS, MELT_TOP, MELT_SPAN } from '../src/album/aspects/water.js';
import { makeFreeze, winterPhase, SHOWS, SPAN, SEA_CHANNEL } from '../src/album/layers/freeze.js';
import { ringDistance, lakeGrid } from '../src/album/layers/lakes.js';
import { riverLines, riverWidth } from '../src/album/layers/rivers.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';
import { BBOX } from '../src/album/geo.js';

// a plain world: land west of 2.75° W, a sea east of it that deepens away from the shore. The chunks are natural
// cells (not squares), so the tests pick them by what they are: `shore` a chunk of sea that touches the land.
const heightAt = (lat, lon) => (lon < -2.75 ? 400 : -Math.min(2500, 15 + (lon + 2.75) * 900));
const chunks = new Chunks(heightAt);                                  // the shapes are built once: they never change
const world = () => { for (const t of 'ABC') chunks.bytes[t].set(chunks.natural[t]); chunks.resetters.length = 0; return { ch: chunks, m: makeFreeze(chunks, heightAt) }; };
const shoreAt = lat => chunks.at(lat, -2.74);                         // a point of the sea under a km from the coast

test('water: the channels of the chunk are the ones the docs name, and the aspect keeps its contract', () => {
  assert.equal(SEA_CHANNEL, 'spareB');
  for (const name of ['ice', 'snow', SEA_CHANNEL]) assert.equal(CHANNELS[name][0], 'B', `${name} is read as p.cB`);
  assert.equal(water.uniforms, WATER_UNIFORMS);
  assert.ok(Object.values(WATER_UNIFORMS).every(u => !u.value?.isTexture), 'the ground shader has no texture unit to spare: the water brings none');
  assert.ok(WATER_UNIFORMS.uWaterThaw.value.x === 0 && WATER_UNIFORMS.uWaterThaw.value.y === 0, 'no thaw until something thaws');
  assert.ok(!/texture\(|sampler/.test(WATER_CORE), 'and reads none of its own');
  assert.ok(!WATER_CORE.includes('cB.b'), 'flood is water over the land: the water never reads it');
  assert.match(water.glsl, /vec3 aspWater\(Px p\)/);
  assert.ok(SHEET_FRAG.includes(WATER_CORE), 'lakes and rivers run the same water code as the sea');
  assert.ok(!/\b(vnoise|fbm|hash21)\(/.test(WATER_CORE), 'the water uses its own precision-safe noise');
  for (const fn of ['wHash', 'wNoise', 'wCells', 'wTrain', 'waterBody', 'waterLit']) assert.ok(WATER_CORE.includes(fn + '('), fn);
  // The detail of the ice is the detail of the height it is seen from: great plates and long leads from space, floes
  // from 200 km, and the small things (pancakes, the pieces of a floe, ridges, seams, drifts) only from low down —
  // each of those is switched off by the size of a pixel before it could turn into a mesh of fine cracks.
  // the text between the last `mark` and the `end` after it (the last one: the waves have an f2 of their own)
  const after = (mark, end) => { const i = WATER_CORE.lastIndexOf(mark); assert.ok(i >= 0, mark); const j = i + mark.length; return WATER_CORE.slice(j, WATER_CORE.indexOf(end, j)); };
  // "fp = 1. - smoothstep(a, b, pq)": the detail is gone once a pixel is b km across
  const fadeAt = name => +after(name + ' = 1. - smoothstep(', ', pq)').split(',')[1];
  for (const [name, limit] of [['fp', .05], ['f2', .07], ['fb', .08], ['fs', .09]]) assert.ok(fadeAt(name) > 0 && fadeAt(name) <= limit, `${name}: gone before a pixel is ${limit} km across (seen from about ${Math.round(limit * 1500)} km)`);
  assert.ok(+after('wCells(hq / ', '.') >= 40, 'the plates of the pack are tens of km across');
});

test('water: no ice without cold; the natural sea has its own weather, rougher on the ocean and far from the shore', () => {
  const { ch, m } = world();
  m.natural(); m.settle({ cold: 0 });
  const sea = ch.at(43.5, 1), shore = shoreAt(43.5), inland = ch.at(41, -6);
  assert.ok(ch.kind[sea] === 0 && ch.kind[shore] === 0 && ch.kind[inland] === 1 && m.off[shore] === 1 && m.off[inland] === 0 && m.off[sea] > 5);
  assert.ok(m.depth[sea] > m.depth[shore] && m.depth[shore] > 0 && m.depth[inland] === 0);
  for (const k of [sea, shore, inland]) { assert.equal(ch.get('ice', k), 0); assert.equal(m.melt[k], 0); }
  assert.deepEqual(m.state, { thaw: 0, retreat: 0 });
  assert.equal(ch.get(SEA_CHANNEL, inland), 0, 'no sea state where there is no water');
  assert.ok(ch.get(SEA_CHANNEL, sea) > .1 && ch.get(SEA_CHANNEL, sea) < .7, 'the open sea is neither dead calm nor a storm');
  assert.equal(ch.getNatural(SEA_CHANNEL, sea), ch.get(SEA_CHANNEL, sea), 'the weather of the sea is its natural state: reset() keeps it');
  m.settle({ cold: 0, sea: 1 }); assert.ok(ch.get(SEA_CHANNEL, sea) > .8, 'the knob sets one state for the whole sea');
});

test('water: ice comes from the shore and from the north, later over deep water; full cold freezes everything', () => {
  const { ch, m } = world();
  const nearN = shoreAt(44), farN = ch.at(44, 2), nearS = shoreAt(37), lake = ch.at(43, -6), high = ch.at(37, -6);
  assert.ok(m.res[nearN] < m.res[farN], 'the shore freezes before the open sea');
  assert.ok(m.res[nearN] < m.res[nearS], 'the north freezes before the south');
  assert.ok(m.res[lake] < m.res[nearN], 'still fresh water freezes before the sea');
  assert.ok(m.depth[farN] > m.depth[nearN] && m.off[farN] > m.off[nearN]);
  // a lake is a chunk of water of its own (the base cuts it out of the land along its outline): it freezes as fresh
  // water, a mountain lake before the sea shore at its latitude, and holds snow on its ice
  const ring = Array.from({ length: 24 }, (_, i) => [-6 + .09 * Math.cos(i / 24 * 2 * Math.PI), 42 + .06 * Math.sin(i / 24 * 2 * Math.PI)]);
  const chL = new Chunks(heightAt, [], [{ name: 'tarn', level: 900, ring }]), kL = chL.at(42, -6), mL = makeFreeze(chL, heightAt);
  assert.ok(chL.kind[kL] === 0 && chL.lake[kL] === 0, 'the lake is a chunk of water'); assert.equal(mL.lake[kL], 900); assert.equal(mL.lake[chL.at(44, 2)], 0);
  assert.ok(mL.res[kL] < mL.res[chL.at(42, -2.74)] && mL.res[kL] < mL.res[chL.at(42, -5)], 'a mountain lake freezes first');
  mL.settle({ cold: .3, snow: .6 });
  assert.equal(chL.get('ice', kL), 1); assert.ok(chL.get('snow', kL) > .5, 'snow lies on the ice of a lake'); assert.equal(chL.get('ice', chL.at(42, 2)), 0);
  for (const k of [nearN, farN, nearS, lake, high]) {
    let last = -1;
    for (let c = 0; c <= 1.0001; c += .05) { const t = m.target(k, { cold: c }); assert.ok(t >= last - 1e-9, 'more cold, never less ice'); last = t; }
    assert.equal(m.target(k, { cold: 0 }), 0); assert.equal(m.target(k, { cold: 1 }), 1);
    assert.ok(m.res[k] + SPAN <= 1);
  }
  m.settle({ cold: .45 });
  assert.equal(ch.get('ice', nearN), 1); assert.equal(ch.get('ice', farN), 0); assert.ok(ch.get('ice', nearS) < ch.get('ice', nearN));
});

test('water: in time the ice spreads chunk by chunk from the shore, then melts back with melt water on it', () => {
  const { ch, m } = world(), o = { cold: .8 };
  m.natural(); m.settle({ cold: 0 });
  const near = shoreAt(44), far = ch.at(44, -1);
  assert.ok(m.target(far, o) > .9 && m.off[far] > 5);
  for (let i = 0; i < 10; i++) m.step(.1, o);
  assert.ok(ch.get('ice', near) > .2, 'the shore has started'); assert.equal(ch.get('ice', far), 0, 'the open sea waits for a frozen neighbour');
  let prev = 0;
  for (let i = 0; i < 1200; i++) { m.step(.1, o); assert.ok(m.ice[far] >= prev - 1e-6 && m.ice[far] <= m.target(far, o) + 1e-6); prev = m.ice[far]; }
  assert.ok(Math.abs(ch.get('ice', far) - m.target(far, o)) < .01, 'in the end every chunk reaches its target');
  // warmer: the ice goes, and while it goes it carries melt water
  for (let i = 0; i < 6; i++) m.step(.5, { cold: 0 });
  assert.ok(m.state.retreat > .5 && m.state.thaw === 0, 'the sea is in retreat');
  assert.ok(m.melt[near] > .3 && ch.get('ice', near) < MELT_TOP && ch.get('ice', near) > 0, 'ice that is no longer whole stands in melt water');
  for (let i = 0; i < 400; i++) m.step(.2, { cold: 0 });
  assert.equal(ch.get('ice', near), 0); assert.equal(ch.get('ice', far), 0); assert.equal(m.melt[near], 0); assert.ok(m.state.retreat < .01, 'the retreat is over');
  for (let k = 0; k < ch.count; k += 37) assert.equal(ch.get('flood', k), 0, 'the water never writes the flood of a chunk');
  assert.ok(ch.count >= 16384 && m.ice.length === ch.count, 'every chunk has its ice, the islands and lagoons added after the lattice too');
});

test('water: snow lies only on ice that can bear it; a thaw wets the ice and takes the snow', () => {
  const { ch, m } = world(), near = shoreAt(44), far = ch.at(44, 2), land = ch.at(43, -6);
  m.settle({ cold: .45, snow: .8 });
  assert.ok(ch.get('snow', near) > .6); assert.equal(ch.get('snow', far), 0, 'no snow on open water');
  assert.equal(ch.get('snow', land), 0, 'snow on the land is not the water\'s to set');
  const before = ch.get('ice', near);
  m.settle({ cold: .45, snow: .8, thaw: .6 });
  assert.ok(m.melt[near] > .3 && ch.get('snow', near) < .2 && ch.get('ice', near) < before && ch.get('ice', near) > 0);
  assert.equal(m.state.thaw, .6); assert.equal(m.state.retreat, 0); assert.equal(m.melt[far], 0, 'no melt water where there is no ice');
  m.settle({ cold: .45 }); assert.equal(m.melt[near], 0); assert.equal(m.state.thaw, 0);
});

test('water: a reset of the chunks is followed by the model laying its state again; a chunk changed by hand is left alone', () => {
  const { ch, m } = world(), near = shoreAt(44), far = ch.at(44, 2), o = { cold: .45 };
  ch.onReset(() => m.relay(o));
  m.natural(); m.settle(o); ch.reset();
  assert.equal(ch.get('ice', near), 1, 'the state is back after reset()');
  ch.set('ice', far, .9);                                             // someone froze a chunk of open sea by hand
  m.step(.1, o); assert.ok(m.ice[far] > .85, 'the model takes it over');
  for (let i = 0; i < 300; i++) m.step(.2, o);
  assert.ok(ch.get('ice', far) > .85, 'and leaves it alone: ice frozen by hand stays');
  assert.equal(ch.get('ice', near), 1, 'the rest of the sea goes on as before');
  m.settle(o); assert.equal(ch.get('ice', far), 0, 'until the state is laid anew');
  // snow on the land belongs to the ground (the «Показ: снег» of the chunk tools): the model never writes it
  const inland = ch.at(43, -6); ch.set('snow', inland, .7);
  m.step(1, { ...o, snow: .9 }); m.settle({ ...o, snow: .9 });
  assert.ok(Math.abs(ch.get('snow', inland) - .7) < .01 && ch.get('snow', near) > .6);
});

test('water: the rows of states for the album pages cover every stage in order', () => {
  const { ch, m } = world();
  const mid = xi => ch.at(44.1, llOf((CI0 + xi) * CHUNK_KM, 0).lon);    // the chunk at xi × 10 km east of the west edge of the grid
  for (const [id, s] of Object.entries(SHOWS)) {
    assert.ok(s.title && s.bands.length >= 5 && s.bands.every((v, i) => !i || v > s.bands[i - 1]), `${id}: rising bands`);
    assert.ok(water.params.find(p => p.key === 'waterShow').options.some(o => o[0] === id));
    m.settle({ show: id });
    const name = id === 'sea' ? SEA_CHANNEL : id === 'ice' ? 'ice' : id === 'snow' ? 'snow' : null;
    const period = s.width * s.bands.length, sea = period * Math.ceil(70 / period);      // the first whole row of bands that lies in the sea of this world
    for (let b = 0; b < s.bands.length; b++) { const k = mid(sea + (b + .5) * s.width); assert.ok(Math.abs((name ? ch.get(name, k) : m.melt[k]) - s.bands[b]) < .01, `${id} band ${b}`); }
  }
  assert.deepEqual(m.state, { thaw: 0, retreat: 1 }, 'the rows of thawing ice are laid with the sea in retreat');
  assert.ok(MELT_TOP - MELT_SPAN > .7 && MELT_TOP < .95, 'thawing ice is still a sheet');
  m.settle({ show: 'sea' }); assert.equal(ch.get('ice', ch.at(44.1, 1)), 0); assert.equal(m.state.retreat, 0);
  assert.equal(winterPhase(0), 0); assert.equal(winterPhase(50), 1); assert.ok(winterPhase(20) > 0 && winterPhase(20) < 1 && winterPhase(105) === 0);
});

test('water: lakes — a small open list of natural lakes with outlines inside the region', () => {
  const { lakes } = JSON.parse(readFileSync(new URL('../public/assets/album/water/lakes.json', import.meta.url), 'utf8'));
  assert.ok(lakes.filter(l => !l.shoal).length >= 8 && lakes.length <= 40);
  assert.ok(readFileSync(new URL('../public/assets/album/water/lakes.json', import.meta.url)).length < 200e3, 'a small tracked file');
  const ids = new Set();
  for (const l of lakes) {
    assert.ok(l.id && l.name && !ids.has(l.id)); ids.add(l.id);
    assert.ok(!/водохранилищ|embalse|reservoir/i.test(l.name + (l.note || '')), `${l.id}: no reservoirs in 5000 BC`);
    assert.ok(l.ring.length >= (l.shoal ? 6 : 20) && l.depth > 0 && l.level >= 0 && l.area > .3 && l.area < (l.shoal ? 2500 : 120), l.id);
    for (const [lon, lat] of l.ring) assert.ok(lon > BBOX.lon0 && lon < BBOX.lon1 && lat > BBOX.lat0 && lat < BBOX.lat1, `${l.id}: inside the region`);
    const g = lakeGrid(l), c = Math.cos(l.lat * Math.PI / 180), ring = l.ring.map(p => [(p[0] - l.lon) * 111.195 * c, (p[1] - l.lat) * 111.195]);
    assert.ok(g.idx.length >= 6 && g.idx.every(i => i >= 0 && i < g.n) && g.n < 60000, `${l.id}: a sound grid`);
    let inside = 0; for (let k = 0; k < g.n; k++) if (g.sd[k] > 0) inside++;
    assert.ok(inside > 20, `${l.id}: water inside its shore`);
    assert.ok(Math.max(...g.sd) < 25 && Math.abs(ringDistance(ring, ring[0][0], ring[0][1])) < 1e-6);
  }
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(ringDistance(sq, 2, 2), 2); assert.equal(ringDistance(sq, 2, 5), -1); assert.equal(ringDistance(sq, -3, 2), -3); assert.ok(Math.abs(ringDistance(sq, 1, 2) - 1) < 1e-9);
});

test('water: rivers — wider by rank, growing from the source down, running downhill', () => {
  assert.ok(riverWidth(5) > riverWidth(7) && riverWidth(7) > riverWidth(9) && riverWidth(9) > .2);
  const line = (lon0, lat0, n) => Array.from({ length: n }, (_, i) => [lon0 + i * .05, lat0 + Math.sin(i) * .01]);
  const hill = (lat, lon) => 900 + lon * 100;                           // the land falls to the west
  const rivers = [{ name: 'A', rank: 5, pts: line(-6, 41, 40) }, { name: 'A', rank: 5, pts: line(-4.05, 41, 20) }, { name: 'B', rank: 9, pts: [[-1, 40], [-1, 40.01]] }];
  const [a, b] = riverLines(rivers, hill);
  assert.equal(riverLines(rivers, hill).length, 2, 'a line of two points is not a river');
  assert.ok(a.pts[0][0] > a.pts[a.pts.length - 1][0], 'the line is turned to run from the high end to the low end');
  assert.ok(!a.spring && b.spring, 'a piece that starts where another ends is not a source');
  assert.ok(a.width.every(w => w === riverWidth(5)));
  assert.ok(b.width[0] < b.width[b.width.length - 1] && b.width[b.width.length - 1] <= riverWidth(5) && b.width[0] > .2 * riverWidth(5));
  assert.ok(b.dist.every((d, i) => !i || d > b.dist[i - 1]) && b.pts.length === b.width.length);
  assert.ok(!a.mouth && a.fade.every(v => v === 1), 'a river that never meets the sea is drawn whole');
  // the sea lies east of 3° W, with an island in it: the river stops at the shore and does not come out on the island
  const coast = (lat, lon) => (lon < -3 ? 300 - lon : lon > -2.9 && lon < -2.8 ? 5 : -20);
  const [m] = riverLines([{ name: 'M', rank: 6, pts: line(-4, 41, 40) }], coast), last = m.pts[m.pts.length - 1];
  assert.ok(m.mouth && last[0] > -3.01 && last[0] < -2.95, `the mouth is at the shore, got ${last[0]}`);
  assert.equal(m.fade[m.fade.length - 1], 0); assert.equal(m.fade[0], 1); assert.ok(m.fade.every((v, i) => !i || v <= m.fade[i - 1]));
});

test('water: the album shows it — pages for every state, from 20, 200 and 500 km, and knobs for the model', () => {
  const mine = PAGES.filter(p => water.pages.includes(p));
  assert.ok(mine.length >= 8, `${mine.length} water pages`);
  for (const need of ['sea-delta', 'water-sea', 'water-ice', 'water-snow', 'water-thaw', 'water-lake', 'water-lake-ice', 'water-river', 'water-edge', 'water-edge-grid', 'water-20', 'water-200', 'water-500', 'water-pack-500', 'water-pack-far'])
    assert.ok(mine.some(p => p.id === need), need);
  assert.equal(mine.find(p => p.id === 'water-20').cam.h, 20); assert.equal(mine.find(p => p.id === 'water-200').cam.h, 200); assert.equal(mine.find(p => p.id === 'water-500').cam.h, 500);
  assert.equal(mine.find(p => p.id === 'water-edge-grid').p.grid, 1); assert.ok(!mine.find(p => p.id === 'water-edge').p.grid);
  for (const key of ['cold', 'thaw', 'iceSnow', 'seaState', 'waterShow', 'winterCycle', 'rivers', 'riversOn', 'lakesOn']) assert.ok(DEFS.some(d => d.key === key), key);
  for (const key of ['cold', 'thaw', 'iceSnow', 'seaState', 'waterShow', 'winterCycle']) assert.ok(!DEFS.find(d => d.key === key).value, `${key}: off by default, the natural sea has no ice`);
  // the depth of a sheet is pulled toward the eye by more than the crowns of the trees drawn at that height
  const album = h => [{ params: { get: k => ({ forest3d: 1, trees: 1 })[k] } }, { s: { h } }];
  assert.ok(sheetPull(...album(20)) > .05 && sheetPull(...album(160)) > sheetPull(...album(20)) && sheetPull(...album(500)) > .2);
});
