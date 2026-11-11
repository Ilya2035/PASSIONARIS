// Natural resources (docs/RESOURCES.md): the baked table, the chunk grid, reproducible scattering, known places.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  RESOURCES, RES_INDEX, ALBUM_GRID, chunkOf, chunkI, chunkJ, chunkLat, chunkLon, gridForBox, openTable,
  hash32, strHash, scatterZone, withZones, sumCells, spreadToChunks, zonesToChunks,
} from '../scripts/resources/lib.mjs';
import { CN, CI0, CJ0, CHUNK_KM, kmOf, Chunks, FN, FKM } from '../src/album/chunks.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../public/assets/resources/', import.meta.url);
const load = name => {
  const meta = JSON.parse(fs.readFileSync(new URL(name + '.json', DIR), 'utf8'));
  return { meta, table: openTable(meta, zlib.gunzipSync(fs.readFileSync(new URL(meta.file, DIR)))) };
};
const ALBUM_BOX = { lon0: -10, lon1: 4.5, lat0: 35.2, lat1: 44.8 };
const { meta, table } = load('album');
const albumData = loadAlbumData(fileURLToPath(new URL('..', import.meta.url)));

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
    if (z.kind === 'rich') assert.equal(a.length, z.cells.length, z.id);
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

test('bog iron: the rule of the swamp aspect — every iron-bearing mire holds some, the seed decides how much', () => {
  const z = meta.zones.find(q => q.res === 'bogiron');
  assert.ok(z && z.kind === 'rich' && z.cells.length > 50, 'a rich zone of iron-bearing mires');
  assert.equal(z.depth, 0, 'bog ore lies on the surface');
  const a = scatterZone(z, 1), b = scatterZone(z, 2);
  assert.deepEqual(a.map(p => p.cell), z.cells, 'every candidate holds bog iron');
  assert.ok(a.every(p => p.amount >= 1));
  assert.notDeepEqual(a.map(p => p.amount), b.map(p => p.amount), 'another seed makes other mires the rich ones');
  // on average the seed factor is 1: the sum stays near amount · weight
  const expect = z.cells.reduce((s, _, k) => s + z.amount * z.weights[k] / 255, 0);
  for (const seed of [1, 2, 3]) {
    const sum = scatterZone(z, seed).reduce((s, p) => s + p.amount, 0);
    assert.ok(Math.abs(sum - expect) < expect * .2 + z.cells.length, `seed ${seed}: ${sum} vs ${expect}`);
  }
  // where: the Landes and the wet north-west; none in the dry south-east
  const at = z.cells.map(c => ({ lat: chunkLat(meta.grid.j0 + Math.floor(c / meta.grid.W)), lon: chunkLon(meta.grid.i0 + c % meta.grid.W) }));
  assert.ok(at.filter(p => p.lat > 43.5 && p.lon > -1.6 && p.lon < 0.5).length > z.cells.length / 3, 'mostly the Landes');
  assert.equal(at.filter(p => p.lat < 39.5 && p.lon > -4).length, 0, 'none in the dry south-east');
});

test('natural chunks: squares spread over the chunks of their texels — fish to water, wood to land, totals kept', () => {
  // 2 × 2 squares of 8 × 8 texels. Chunk 0: land, square 0. Chunk 1: water, square 1. Square 2: its west half is
  // land chunk 2, its east half water chunk 3; square 3 is water chunk 3 too.
  const FN = 16, sub = 8, cell = new Uint16Array(FN * FN);
  for (let ty = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++) {
    cell[ty * FN + tx] = ty < 8 ? (tx < 8 ? 0 : 1) : (tx < 4 ? 2 : 3);
  }
  const g = { count: 4, kind: Uint8Array.from([1, 0, 1, 0]), cell, FN, sub, at: () => 2 };
  const R = RESOURCES.length, N = 4, amount = new Uint16Array(R * N), depth = new Uint8Array(R * N).fill(255);
  const put = (res, s, v, d = 0) => { amount[RES_INDEX[res] * N + s] = v; depth[RES_INDEX[res] * N + s] = d; };
  put('fish', 0, 64);        // inland square: river fish → its land chunk
  put('fish', 2, 64);        // square with water: all of it to the water texels
  put('wood', 2, 32);        // to the land texels of square 2 only
  put('wood', 1, 16);        // a square without land: to its water chunk
  put('copper', 0, 30, 1);   // a known deposit: goes where its coordinates are (at() → chunk 2)
  const table = { amount, depth, N, R, index: RES_INDEX };
  const meta = { grid: { W: 2, H: 2 }, resources: RESOURCES, deposits: [{ res: 'copper', cell: 0, amount: 30, depth: 1, lat: 0, lon: 0 }] };
  const out = spreadToChunks(table, meta, g);
  const get = (res, k) => out.amount[RES_INDEX[res] * 4 + k];
  assert.deepEqual([0, 1, 2, 3].map(k => get('fish', k)), [64, 0, 0, 64]);
  assert.deepEqual([0, 1, 2, 3].map(k => get('wood', k)), [0, 16, 32, 0]);
  assert.deepEqual([0, 1, 2, 3].map(k => get('copper', k)), [0, 0, 30, 0]);
  assert.equal(out.depth[RES_INDEX.copper * 4 + 2], 1);
  assert.equal(out.depth[RES_INDEX.copper * 4 + 0], 255);
  assert.deepEqual(out.depositChunk, [2]);
  // zones: land resources take land chunks only, oil may lie under water
  const zs = zonesToChunks([
    { id: 'z:gold', res: 'gold', kind: 'zone', pieces: 1, amount: 10, depth: 1, cells: [2], weights: [200] },
    { id: 'z:oil', res: 'oil', kind: 'zone', pieces: 1, amount: 10, depth: 2, cells: [2, 3], weights: [100, 50] },
    { id: 'z:none', res: 'gold', kind: 'zone', pieces: 1, amount: 10, depth: 1, cells: [1], weights: [255] },
  ], meta, g);
  assert.deepEqual(zs.map(z => [z.id, z.cells, z.weights]), [['z:gold', [2], [200]], ['z:oil', [2, 3], [100, 100]]]);
  // withZones keeps the fractions of a spread table (Float32), not whole numbers
  const half = { amount: Float32Array.from([0.5, 0.25]), depth: Uint8Array.from([0, 0]), index: { fish: 0 }, N: 2 };
  assert.ok(withZones(half, [], 1).amount instanceof Float32Array);
  assert.equal(withZones(half, [], 1).amount[0], 0.5);
});

// ---- the album's real natural chunks (needs public/album-data/, not in git: scripts/album/fetch-data.mjs)
test('natural chunks of the album: totals kept, wood on land, fish in water, known places in their chunks', { skip: !albumData && 'public/album-data/ is not there' }, () => {
  const ch = new Chunks(albumData.base.at, albumData.vectors.rivers);
  const g = { count: ch.count, kind: ch.kind, cell: ch.cell, FN, sub: CHUNK_KM / FKM, at: (lat, lon) => ch.at(lat, lon) };
  const out = spreadToChunks(table, meta, g), n = ch.count;
  const total = (arr, N, res, filter = () => true) => { let s = 0; for (let k = 0; k < N; k++) if (filter(k)) s += arr[RES_INDEX[res] * N + k]; return s; };
  for (const res of ['fish', 'wood', 'stone', 'clay', 'copper', 'silver']) {
    const a = total(table.amount, table.N, res), b = total(out.amount, n, res);
    assert.ok(Math.abs(a - b) <= a * .005 + 1, `${res}: ${a} in squares, ${b} in chunks`);
  }
  // inside the album's region (outside it the album has no heights and draws no land)
  const inside = k => { const c = ch.centre(k); return c.lat >= ALBUM_BOX.lat0 && c.lat <= ALBUM_BOX.lat1 && c.lon >= ALBUM_BOX.lon0 && c.lon <= ALBUM_BOX.lon1; };
  for (const res of ['wood', 'stone', 'clay']) assert.ok(total(out.amount, n, res, k => inside(k) && !ch.kind[k]) < total(out.amount, n, res, inside) * .005, `${res} on land chunks`);
  assert.ok(total(out.amount, n, 'fish', k => inside(k) && !ch.kind[k]) > total(out.amount, n, 'fish', inside) * .6, 'most fish in water chunks');
  const near = (res, lat, lon, r = 1) => {
    let best = 0;
    for (const [k] of ch.ring(ch.at(lat, lon), r)) best = Math.max(best, out.amount[RES_INDEX[res] * n + k]);
    return best;
  };
  assert.ok(near('copper', 37.70, -6.60) >= 100, 'copper of Rio Tinto');
  assert.ok(near('mercury', 38.78, -4.84) >= 50, 'mercury of Almadén');
  assert.ok(near('coal', 43.25, -5.75, 2) >= 10, 'coal of central Asturias');
  assert.ok(near('salt', 41.92, 1.68) >= 30, 'salt of Cardona');
  // every known deposit inside the raster lands in the chunk under its own coordinates
  meta.deposits.forEach((d, q) => assert.equal(out.depositChunk[q], ch.at(d.lat, d.lon), d.name));
  // the zones move to chunks: candidates are chunks, land resources on land
  for (const z of zonesToChunks(meta.zones, meta, g)) {
    assert.ok(z.cells.every(k => k >= 0 && k < n), z.id);
    if (!['oil', 'gas'].includes(z.res)) assert.ok(z.cells.every(k => ch.kind[k] === 1), z.id);
  }
});
