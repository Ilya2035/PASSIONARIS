// Natural resources (docs/RESOURCES.md): the baked table, the chunk grid, reproducible scattering, known places.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  RESOURCES, RES_INDEX, ALBUM_GRID, chunkOf, chunkI, chunkJ, chunkLat, chunkLon, gridForBox, openTable,
  hash32, strHash, scatterZone, withZones, sumCells,
} from '../scripts/resources/lib.mjs';
import { CN, CI0, CJ0, CHUNK_KM, kmOf } from '../src/album/chunks.js';

const DIR = new URL('../public/assets/resources/', import.meta.url);
const load = name => {
  const meta = JSON.parse(fs.readFileSync(new URL(name + '.json', DIR), 'utf8'));
  return { meta, table: openTable(meta, zlib.gunzipSync(fs.readFileSync(new URL(meta.file, DIR)))) };
};
const ALBUM_BOX = { lon0: -10, lon1: 4.5, lat0: 35.2, lat1: 44.8 };
const { meta, table } = load('album');

// the largest amount of a resource within r chunks of a point
function near(res, lat, lon, r = 1, amount = table.amount) {
  const { i, j } = chunkOf(lat, lon);
  let best = 0;
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const c = table.cell(i + di, j + dj);
    if (c >= 0) best = Math.max(best, amount[RES_INDEX[res] * table.N + c]);
  }
  return best;
}

test('resources: 15–20 resources with unique ids, a name, a depth class and an era', () => {
  assert.ok(RESOURCES.length >= 15 && RESOURCES.length <= 20, `${RESOURCES.length} resources`);
  assert.equal(new Set(RESOURCES.map(r => r.id)).size, RESOURCES.length);
  for (const r of RESOURCES) {
    assert.ok(r.name && [0, 1, 2].includes(r.depth) && Number.isInteger(r.era) && /^#[0-9a-f]{6}$/.test(r.color), r.id);
  }
  for (const id of ['fish', 'wood', 'stone', 'rarestone', 'gems', 'clay', 'salt', 'coal', 'bogiron', 'iron', 'copper',
    'tin', 'gold', 'silver', 'oil', 'gas']) assert.ok(id in RES_INDEX, id);
  assert.ok(RESOURCES[RES_INDEX.bogiron].era < RESOURCES[RES_INDEX.iron].era, 'bog iron comes before deep iron ore');
});

test('chunk grid: the formula of the brief, and chunk centres map back to their chunk', () => {
  // x = lon · 111.195 · cos 40°, y = lat · 111.195, chunk = floor(km / 10)
  assert.equal(chunkI(-3.7), Math.floor(-3.7 * 111.195 * Math.cos(40 * Math.PI / 180) / 10));
  assert.equal(chunkJ(40.4), Math.floor(40.4 * 111.195 / 10));
  for (const [lat, lon] of [[35.2, -10], [44.8, 4.5], [40.4, -3.7], [37.7, -6.6], [43.3, -2.9]]) {
    const { i, j } = chunkOf(lat, lon);
    assert.deepEqual(chunkOf(chunkLat(j), chunkLon(i)), { i, j });
    assert.ok(Math.abs(chunkLat(j, 0) - chunkLat(j, 1) + 10 / 111.195) < 1e-9, 'a chunk is 10 km tall');
  }
  // the table uses the album's own chunk grid and numbering (src/album/chunks.js)
  assert.deepEqual([ALBUM_GRID.i0, ALBUM_GRID.j0, ALBUM_GRID.W, ALBUM_GRID.H, ALBUM_GRID.chunkKm], [CI0, CJ0, CN, CN, CHUNK_KM]);
  assert.deepEqual([meta.grid.i0, meta.grid.j0, meta.grid.W, meta.grid.H], [CI0, CJ0, CN, CN]);
  for (const [lat, lon] of [[40.4, -3.7], [43.3, -2.9]]) {
    const [x, y] = kmOf(lat, lon), { i, j } = chunkOf(lat, lon);
    assert.deepEqual([Math.floor(x / CHUNK_KM), Math.floor(y / CHUNK_KM)], [i, j]);
  }
  // the whole album region is inside the grid
  const g = gridForBox(ALBUM_BOX);
  assert.ok(g.i0 >= CI0 && g.j0 >= CJ0 && g.i0 + g.W <= CI0 + CN && g.j0 + g.H <= CJ0 + CN);
});

test('album table: format, sizes, depths only where something lies, amounts in their ranges', () => {
  assert.equal(meta.format, 'passionaris-resources');
  assert.deepEqual(meta.resources.map(r => r.id), RESOURCES.map(r => r.id));
  assert.equal(table.N, meta.grid.W * meta.grid.H);
  for (let k = 0; k < table.amount.length; k++) {
    if (table.amount[k] === 0) assert.equal(table.depth[k], 255);
    else assert.ok(table.depth[k] <= 2);
  }
  const max = id => Math.max(...table.layer(id));
  for (const id of ['fish', 'wood', 'stone']) assert.ok(max(id) <= 100 && max(id) > 50, `${id} max ${max(id)}`);
  // something on land and at sea
  assert.ok(table.layer('wood').filter(v => v > 0).length > 5000);
  assert.ok(table.layer('fish').filter(v => v > 0).length > 5000);
  // every deposit sits in its own chunk with at least its amount
  for (const d of meta.deposits) {
    const { i, j } = chunkOf(d.lat, d.lon);
    assert.equal(table.cell(i, j), d.cell, d.name);
    assert.ok(table.amount[RES_INDEX[d.res] * table.N + d.cell] >= d.amount, d.name);
    assert.ok(d.src, d.name);
  }
});

test('reproducible randomness: fixed hash values on every machine', () => {
  assert.equal(hash32(0), hash32(0));
  assert.equal(hash32(1, 2, 3, 4), 1202037658);
  assert.equal(strHash('field:bogiron'), 2166247275);
  assert.notEqual(hash32(1, 2, 3, 4), hash32(2, 2, 3, 4));
});

test('«место известно неточно»: same seed → same places, other seed → other places, always inside the zone', () => {
  assert.ok(meta.zones.length > 0);
  for (const z of meta.zones) {
    assert.equal(z.cells.length, z.weights.length, z.id);
    const a = scatterZone(z, 2026), b = scatterZone(z, 2026);
    assert.deepEqual(a, b, z.id);
    const inside = new Set(z.cells);
    for (const p of a) assert.ok(inside.has(p.cell), z.id);
    if (z.kind === 'zone') assert.equal(a.length, Math.min(z.pieces, z.cells.length), z.id);
  }
  const big = meta.zones.find(z => z.kind === 'field' && z.cells.length > 100);
  assert.ok(big, 'a field with many candidate chunks');
  const s1 = scatterZone(big, 1).map(p => p.cell).join(), s2 = scatterZone(big, 2).map(p => p.cell).join();
  assert.notEqual(s1, s2, 'another world seed gives other places');
  // locality: a chunk's draw does not depend on the other candidates
  const half = { ...big, cells: big.cells.filter((_, k) => k % 2 === 0), weights: big.weights.filter((_, k) => k % 2 === 0) };
  const inHalf = new Set(half.cells);
  assert.deepEqual(scatterZone(half, 7), scatterZone(big, 7).filter(p => inHalf.has(p.cell)));
  // a zone with a vague place gives exactly its pieces, each with its share of the amount
  const zone = { id: 'test:zone', res: 'gold', kind: 'zone', pieces: 3, amount: 90, depth: 1, cells: [5, 6, 7, 8, 9], weights: [255, 255, 255, 255, 255] };
  const z3 = scatterZone(zone, 99);
  assert.equal(z3.length, 3);
  assert.equal(new Set(z3.map(p => p.cell)).size, 3);
  assert.equal(z3.reduce((s, p) => s + p.amount, 0), 90);
  // zero weight is never chosen
  const zw = scatterZone({ ...zone, weights: [0, 0, 255, 0, 0], pieces: 2 }, 3);
  assert.deepEqual(zw.map(p => p.cell), [7]);
});

test('withZones adds the scattered pieces on top of the table and leaves the table itself alone', () => {
  const before = table.amount.slice();
  const w1 = withZones(table, meta.zones, 42), w2 = withZones(table, meta.zones, 42);
  assert.deepEqual(w1.placed, w2.placed);
  assert.deepEqual(table.amount, before);
  let added = 0;
  for (let k = 0; k < before.length; k++) { assert.ok(w1.amount[k] >= before[k]); added += w1.amount[k] - before[k]; }
  assert.equal(added, w1.placed.reduce((s, p) => s + p.amount, 0));
  assert.ok(w1.placed.some(p => p.res === 'bogiron'), 'bog iron appears somewhere in the wet north-west');
});

test('district sums: the resources of a district are the sums over its chunks', () => {
  const { i, j } = chunkOf(37.7, -6.6);
  const cells = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) cells.push(table.cell(i + di, j + dj));
  const s = sumCells(table.amount, table.N, cells);
  assert.equal(Object.keys(s).length, RESOURCES.length);
  let copper = 0;
  for (const c of cells) copper += table.amount[RES_INDEX.copper * table.N + c];
  assert.equal(s.copper, copper);
  assert.ok(s.copper >= 100, 'the Rio Tinto district is rich in copper');
});

test('known places: Rio Tinto, Almadén, Bizkaia, Cardona, Asturias, Linares, Iberian pyrite belt', () => {
  assert.ok(near('copper', 37.70, -6.60) >= 100, 'copper of Rio Tinto');
  assert.ok(near('silver', 37.70, -6.60) >= 50, 'silver of Rio Tinto');
  assert.ok(near('gold', 37.70, -6.60) >= 30, 'gold of Rio Tinto');
  assert.ok(near('mercury', 38.78, -4.84) >= 50, 'mercury of Almadén');
  assert.ok(near('iron', 43.26, -2.95, 2) >= 10, 'iron of Bizkaia');
  assert.ok(near('salt', 41.92, 1.68) >= 30, 'salt of Cardona');
  assert.ok(near('coal', 43.25, -5.75, 3) >= 10, 'coal of central Asturias');
  assert.ok(near('lead', 38.09, -3.63) >= 10 && near('silver', 38.09, -3.63) >= 5, 'lead and silver of Linares');
  assert.ok(near('copper', 37.57, -7.97) >= 100, 'copper of Neves-Corvo');
  // places without them
  assert.equal(near('mercury', 41.4, 2.15, 2), 0, 'no mercury in Barcelona');
  assert.equal(near('oil', 40.4, -3.7, 2), 0, 'no oil under Madrid');
});

test('rules: rich Atlantic shelf fish, forests in the wet north, little wood in the dry south-east', () => {
  assert.ok(near('fish', 42.6, -9.2, 0) > near('fish', 40.0, -3.5, 0), 'the Galician coast beats the dry Meseta');
  assert.ok(near('fish', 40.7, 0.85, 1) >= 60, 'the Ebro delta');
  const wood = (lat, lon) => table.get('wood', chunkI(lon), chunkJ(lat));
  assert.ok(wood(43.2, -5.0) > wood(37.0, -2.4), 'Asturias is greener than Almería');
  assert.ok(near('stone', 42.7, 0.6, 0) > near('stone', 39.0, -3.0, 0), 'the Pyrenees are rockier than La Mancha');
});

test('album aspect «Ресурсы»: its knobs, its pages inside the region, every resource selectable', async () => {
  const { default: aspect } = await import('../src/album/aspects/resources.js');
  const { DEFS } = await import('../src/album/params.js');
  assert.equal(aspect.id, 'resources');
  const keys = new Set(DEFS.map(d => d.key));
  for (const d of aspect.params) assert.ok(keys.has(d.key) && d.group === 'modes', d.key);
  const res = aspect.params.find(d => d.key === 'res');
  assert.deepEqual(res.options.slice(1).map(o => o[0]), RESOURCES.map(r => r.id));
  assert.ok(aspect.pages.length >= 5);
  for (const pg of aspect.pages) {
    assert.equal(pg.group, 'Ресурсы', pg.id);
    for (const k of Object.keys(pg.p)) assert.ok(keys.has(k), `${pg.id}: unknown knob ${k}`);
    assert.ok(pg.p.res in RES_INDEX, pg.id);
    const c = pg.cam;
    assert.ok(c.lat >= ALBUM_BOX.lat0 && c.lat <= ALBUM_BOX.lat1 && c.lon >= ALBUM_BOX.lon0 && c.lon <= ALBUM_BOX.lon1 && c.h >= 20, pg.id);
  }
});

test('world table (0.5°): format, and a few places of the whole globe', () => {
  const { meta: wm, table: wt } = load('world');
  assert.equal(wm.grid.W, 720); assert.equal(wm.grid.H, 360);
  assert.deepEqual(wm.resources.map(r => r.id), RESOURCES.map(r => r.id));
  const at = (res, lat, lon, r = 1) => {
    let best = 0;
    const y0 = Math.floor((90 - lat) / .5), x0 = Math.floor((lon + 180) / .5);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const y = y0 + dy, x = (x0 + dx + 720) % 720;
      if (y >= 0 && y < 360) best = Math.max(best, wt.amount[RES_INDEX[res] * wt.N + y * 720 + x]);
    }
    return best;
  };
  assert.ok(at('fish', -12, -78, 0) > at('fish', 28, -60, 0), 'the Peru upwelling beats the Sargasso Sea');
  assert.ok(at('wood', 60, 90, 0) > at('wood', 23, 10, 0), 'the Siberian taiga beats the Sahara');
  assert.equal(at('clay', -80, 0, 0), 0, 'no clay under the Antarctic ice');
  assert.ok(at('oil', 26, 50, 2) > 0, 'oil around the Persian Gulf');
  assert.ok(at('copper', -22.3, -68.9, 1) >= 100, 'copper of Chuquicamata');
  assert.ok(at('copper', 37.7, -6.6, 0) >= 100, 'Rio Tinto on the world grid too');
});
