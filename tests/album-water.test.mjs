// The water of the album (docs/album/water.md): the freeze model, the lakes, the rivers, the pages — what can be
// checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chunks, CHANNELS, CN } from '../src/album/chunks.js';
import water, { WATER_CORE, SHEET_FRAG, sheetPull } from '../src/album/aspects/water.js';
import { makeFreeze, winterPhase, SHOWS, SPAN, SEA_CHANNEL, MELT_CHANNEL } from '../src/album/layers/freeze.js';
import { ringDistance, lakeGrid } from '../src/album/layers/lakes.js';
import { riverLines, riverWidth } from '../src/album/layers/rivers.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';
import { BBOX } from '../src/album/geo.js';

// a plain world: land west of 2.75° W, a sea east of it that deepens away from the shore
const heightAt = (lat, lon) => (lon < -2.75 ? 400 : -Math.min(2500, 15 + (lon + 2.75) * 900));
const world = () => { const ch = new Chunks(heightAt); return { ch, m: makeFreeze(ch, heightAt) }; };

test('water: the channels of the chunk are the ones the docs name, and the aspect keeps its contract', () => {
  assert.equal(SEA_CHANNEL, 'spareB'); assert.equal(MELT_CHANNEL, 'flood');
  for (const name of ['ice', 'snow', MELT_CHANNEL, SEA_CHANNEL]) assert.equal(CHANNELS[name][0], 'B', `${name} is read as p.cB`);
  assert.match(water.glsl, /vec3 aspWater\(Px p\)/);
  assert.ok(SHEET_FRAG.includes(WATER_CORE), 'lakes and rivers run the same water code as the sea');
  assert.ok(!/\b(vnoise|fbm|hash21)\(/.test(WATER_CORE), 'the water uses its own precision-safe noise');
  for (const fn of ['wHash', 'wNoise', 'wCells', 'wTrain', 'waterBody', 'waterLit']) assert.ok(WATER_CORE.includes(fn + '('), fn);
});

test('water: no ice without cold; the natural sea has its own weather, rougher on the ocean and far from the shore', () => {
  const { ch, m } = world();
  m.natural(); m.settle({ cold: 0 });
  const sea = ch.at(43.5, 1), shore = ch.at(43.5, -2.6), inland = ch.at(41, -6);
  for (const k of [sea, shore, inland]) { assert.equal(ch.get('ice', k), 0); assert.equal(ch.get(MELT_CHANNEL, k), 0); }
  assert.equal(ch.get(SEA_CHANNEL, inland), 0, 'no sea state where there is no water');
  assert.ok(ch.get(SEA_CHANNEL, sea) > .1 && ch.get(SEA_CHANNEL, sea) < .7, 'the open sea is neither dead calm nor a storm');
  assert.equal(ch.getNatural(SEA_CHANNEL, sea), ch.get(SEA_CHANNEL, sea), 'the weather of the sea is its natural state: reset() keeps it');
  m.settle({ cold: 0, sea: 1 }); assert.ok(ch.get(SEA_CHANNEL, sea) > .8, 'the knob sets one state for the whole sea');
});

test('water: ice comes from the shore and from the north, later over deep water; full cold freezes everything', () => {
  const { ch, m } = world();
  const nearN = ch.at(44, -2.6), farN = ch.at(44, 2), nearS = ch.at(37, -2.6), lake = ch.at(43, -6), high = ch.at(37, -6);
  assert.ok(m.res[nearN] < m.res[farN], 'the shore freezes before the open sea');
  assert.ok(m.res[nearN] < m.res[nearS], 'the north freezes before the south');
  assert.ok(m.res[lake] < m.res[nearN], 'still fresh water freezes before the sea');
  assert.ok(m.depth[farN] > m.depth[nearN] && m.off[farN] > m.off[nearN]);
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
  const near = ch.at(44, -2.6), far = ch.at(44, -1);
  assert.ok(m.target(far, o) > .9 && m.off[far] > 5);
  for (let i = 0; i < 10; i++) m.step(.1, o);
  assert.ok(ch.get('ice', near) > .2, 'the shore has started'); assert.equal(ch.get('ice', far), 0, 'the open sea waits for a frozen neighbour');
  let prev = 0;
  for (let i = 0; i < 1200; i++) { m.step(.1, o); assert.ok(m.ice[far] >= prev - 1e-6 && m.ice[far] <= m.target(far, o) + 1e-6); prev = m.ice[far]; }
  assert.ok(Math.abs(ch.get('ice', far) - m.target(far, o)) < .01, 'in the end every chunk reaches its target');
  // warmer: the ice goes, and while it goes it carries melt water
  m.step(.5, { cold: 0 }); m.step(.5, { cold: 0 });
  assert.ok(ch.get(MELT_CHANNEL, near) > .3 && ch.get('ice', near) < 1 && ch.get('ice', near) > 0);
  for (let i = 0; i < 400; i++) m.step(.2, { cold: 0 });
  assert.equal(ch.get('ice', near), 0); assert.equal(ch.get('ice', far), 0); assert.equal(ch.get(MELT_CHANNEL, near), 0);
});

test('water: snow lies only on ice that can bear it; a thaw wets the ice and takes the snow', () => {
  const { ch, m } = world(), near = ch.at(44, -2.6), far = ch.at(44, 2), land = ch.at(43, -6);
  m.settle({ cold: .45, snow: .8 });
  assert.ok(ch.get('snow', near) > .6); assert.equal(ch.get('snow', far), 0, 'no snow on open water');
  assert.equal(ch.get('snow', land), 0, 'snow on the land is not the water\'s to set');
  const before = ch.get('ice', near);
  m.settle({ cold: .45, snow: .8, thaw: .6 });
  assert.ok(ch.get(MELT_CHANNEL, near) > .3 && ch.get('snow', near) < .2 && ch.get('ice', near) < before && ch.get('ice', near) > 0);
});

test('water: a reset of the chunks is followed by the model laying its state again; the brush is taken as the truth', () => {
  const { ch, m } = world(), near = ch.at(44, -2.6), far = ch.at(44, 2), o = { cold: .45 };
  ch.onReset(() => m.relay(o));
  m.natural(); m.settle(o); ch.reset();
  assert.equal(ch.get('ice', near), 1, 'the state is back after reset()');
  ch.set('ice', far, .9);                                             // someone froze a chunk of open sea by hand
  m.step(.1, o); assert.ok(m.ice[far] > .85, 'the model takes it over');
  for (let i = 0; i < 300; i++) m.step(.2, o);
  assert.equal(ch.get('ice', far), 0, 'and it melts back to where the cold allows');
  // while a stand-in demonstration of chunktool.js is on, the model leaves ice alone
  ch.set('ice', far, .5); m.step(1, { ...o, keepIce: true }); m.settle({ ...o, keepIce: true });
  assert.ok(Math.abs(ch.get('ice', far) - .5) < .01);
});

test('water: the rows of states for the album pages cover every stage in order', () => {
  const { ch, m } = world(), row = Math.floor(CN * .8) * CN;
  for (const [id, s] of Object.entries(SHOWS)) {
    assert.ok(s.title && s.bands.length >= 5 && s.bands.every((v, i) => !i || v > s.bands[i - 1]), `${id}: rising bands`);
    assert.ok(water.params.find(p => p.key === 'waterShow').options.some(o => o[0] === id));
    m.settle({ show: id });
    const name = id === 'sea' ? SEA_CHANNEL : id === 'ice' ? 'ice' : id === 'snow' ? 'snow' : MELT_CHANNEL;
    for (let b = 0; b < s.bands.length; b++) assert.ok(Math.abs(ch.get(name, row + s.width * s.bands.length + b * s.width) - s.bands[b]) < .01 || name === 'snow', `${id} band ${b}`);
  }
  m.settle({ show: 'sea' }); assert.equal(ch.get('ice', row + 100), 0);
  assert.equal(winterPhase(0), 0); assert.equal(winterPhase(50), 1); assert.ok(winterPhase(20) > 0 && winterPhase(20) < 1 && winterPhase(105) === 0);
});

test('water: lakes — a small open list of natural lakes with outlines inside the region', () => {
  const { lakes } = JSON.parse(readFileSync(new URL('../public/assets/album/water/lakes.json', import.meta.url), 'utf8'));
  assert.ok(lakes.length >= 8 && lakes.length <= 40);
  assert.ok(readFileSync(new URL('../public/assets/album/water/lakes.json', import.meta.url)).length < 200e3, 'a small tracked file');
  const ids = new Set();
  for (const l of lakes) {
    assert.ok(l.id && l.name && !ids.has(l.id)); ids.add(l.id);
    assert.ok(!/водохранилищ|embalse|reservoir/i.test(l.name + (l.note || '')), `${l.id}: no reservoirs in 5000 BC`);
    assert.ok(l.ring.length >= 20 && l.depth > 0 && l.level >= 0 && l.area > .3 && l.area < 120, l.id);
    for (const [lon, lat] of l.ring) assert.ok(lon > BBOX.lon0 && lon < BBOX.lon1 && lat > BBOX.lat0 && lat < BBOX.lat1, `${l.id}: inside the region`);
    const g = lakeGrid(l), c = Math.cos(l.lat * Math.PI / 180), ring = l.ring.map(p => [(p[0] - l.lon) * 111.195 * c, (p[1] - l.lat) * 111.195]);
    assert.ok(g.idx.length >= 6 && g.idx.every(i => i >= 0 && i < g.n) && g.n < 60000, `${l.id}: a sound grid`);
    let inside = 0; for (let k = 0; k < g.n; k++) if (g.sd[k] > 0) inside++;
    assert.ok(inside > 20, `${l.id}: water inside its shore`);
    assert.ok(Math.max(...g.sd) < 12 && Math.abs(ringDistance(ring, ring[0][0], ring[0][1])) < 1e-6);
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
});

test('water: the album shows it — pages for every state, from 20, 200 and 500 km, and knobs for the model', () => {
  const mine = PAGES.filter(p => water.pages.includes(p));
  assert.ok(mine.length >= 8, `${mine.length} water pages`);
  for (const need of ['sea-delta', 'water-sea', 'water-ice', 'water-snow', 'water-thaw', 'water-lake', 'water-lake-ice', 'water-river', 'water-edge', 'water-edge-grid', 'water-20', 'water-200', 'water-500'])
    assert.ok(mine.some(p => p.id === need), need);
  assert.equal(mine.find(p => p.id === 'water-20').cam.h, 20); assert.equal(mine.find(p => p.id === 'water-200').cam.h, 200); assert.equal(mine.find(p => p.id === 'water-500').cam.h, 500);
  assert.equal(mine.find(p => p.id === 'water-edge-grid').p.grid, 1); assert.ok(!mine.find(p => p.id === 'water-edge').p.grid);
  for (const key of ['cold', 'thaw', 'iceSnow', 'seaState', 'waterShow', 'winterCycle', 'rivers', 'riversOn', 'lakesOn']) assert.ok(DEFS.some(d => d.key === key), key);
  for (const key of ['cold', 'thaw', 'iceSnow', 'seaState', 'waterShow', 'winterCycle']) assert.ok(!DEFS.find(d => d.key === key).value, `${key}: off by default, the natural sea has no ice`);
  // the depth of a sheet is pulled toward the eye by more than the crowns of the trees drawn at that height
  const album = h => [{ params: { get: k => ({ forest3d: 1, trees: 1 })[k] } }, { s: { h } }];
  assert.ok(sheetPull(...album(20)) > .05 && sheetPull(...album(160)) > sheetPull(...album(20)) && sheetPull(...album(500)) > .2);
});
