// Natural resources (docs/RESOURCES.md): the list of 52 raw materials, the baked tables (real amounts, whole numbers,
// metric units), the 0–100 scale, reproducible scattering, the natural chunks of the album, known places.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  RESOURCES, RES_INDEX, ALBUM_GRID, chunkOf, chunkI, chunkJ, chunkLat, chunkLon, gridForBox, openTable,
  hash32, strHash, scatterZone, withZones, sumCells, spreadToChunks, zonesToChunks, index100, fmtAmount, SPREAD,
} from '../scripts/resources/lib.mjs';
import { BONUS, SIZE, KNOWN } from '../scripts/resources/reference.mjs';
import { CN, CI0, CJ0, CHUNK_KM, kmOf, Chunks, FN, FKM } from '../src/album/chunks.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';

const DIR = new URL('../public/assets/resources/', import.meta.url);
const load = name => {
  const meta = JSON.parse(fs.readFileSync(new URL(name + '.json', DIR), 'utf8'));
  return { meta, table: openTable(meta, zlib.gunzipSync(fs.readFileSync(new URL(meta.file, DIR)))) };
};
const ALBUM_BOX = { lon0: -10, lon1: 4.5, lat0: 35.2, lat1: 44.8 };
const { meta, table } = load('album');
const albumData = loadAlbumData(fileURLToPath(new URL('..', import.meta.url)));
const ref = id => meta.resources[RES_INDEX[id]].ref100;

// the largest amount of a resource within r squares of a point
function near(res, lat, lon, r = 1, amount = table.amount) {
  const { i, j } = chunkOf(lat, lon);
  let best = 0;
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const c = table.cell(i + di, j + dj);
    if (c >= 0) best = Math.max(best, amount[RES_INDEX[res] * table.N + c]);
  }
  return best;
}

test('resources: the owner\'s 52 raw materials with a name, a metric unit, a group, a depth and an era', () => {
  assert.equal(RESOURCES.length, 52);
  assert.equal(new Set(RESOURCES.map(r => r.id)).size, 52);
  for (const r of RESOURCES) {
    assert.ok(r.name && r.en && r.group && ['t', 'kg', 'l', 'm3'].includes(r.unit), r.id);
    assert.ok([0, 1, 2].includes(r.depth) && Number.isInteger(r.era) && /^#[0-9a-f]{6}$/.test(r.color), r.id);
    assert.ok(['living', 'flow', 'common', 'deposit'].includes(r.kind), r.id);
    if (r.kind === 'living') assert.ok(['sea', 'province'].includes(r.pool), `${r.id} lives in a sea or a province`);
  }
  for (const id of ['fish', 'seamammals', 'game', 'wood', 'water', 'stone', 'limestone', 'clay', 'kaolin', 'sand', 'quartz',
    'gypsum', 'marble', 'flint', 'gems', 'ornamental', 'gold', 'silver', 'platinum', 'copper', 'tin', 'lead', 'zinc', 'mercury',
    'iron', 'manganese', 'chromium', 'nickel', 'cobalt', 'tungsten', 'molybdenum', 'aluminium', 'titanium', 'magnesium',
    'lithium', 'ree', 'raremetals', 'uranium', 'thorium', 'salt', 'potash', 'phosphate', 'nitrate', 'sulfur', 'borates',
    'fluorite', 'graphite', 'peat', 'coal', 'oil', 'gas', 'helium']) assert.ok(id in RES_INDEX, id);
  // the owner: bog iron is iron, bitumen is oil
  assert.ok(!('bogiron' in RES_INDEX) && !('bitumen' in RES_INDEX) && !('rarestone' in RES_INDEX));
  // metals in tonnes of the metal itself, precious things in kilograms, oil in litres, gas in cubic metres
  assert.equal(RESOURCES[RES_INDEX.copper].unit, 't');
  assert.equal(RESOURCES[RES_INDEX.gold].unit, 'kg');
  assert.equal(RESOURCES[RES_INDEX.oil].unit, 'l');
  assert.equal(RESOURCES[RES_INDEX.gas].unit, 'm3');
  assert.equal(RESOURCES[RES_INDEX.fish].unit, 't');
});

test('reference numbers: a size for every deposit class of every resource, growing with the class; 15 % on top', () => {
  assert.equal(BONUS, 1.15);
  for (const r of RESOURCES) {
    const s = SIZE[r.id];
    assert.ok(Array.isArray(s) && s.length === 5, r.id);
    for (let k = 1; k < 5; k++) assert.ok(s[k] > s[k - 1], `${r.id}: class ${k}`);
  }
  for (const k of KNOWN) assert.ok(k.res in RES_INDEX && k.amount > 0 && k.name instanceof RegExp && k.label && k.src, k.label);
});

test('chunk grid: the formula of the brief, and chunk centres map back to their chunk', () => {
  assert.equal(chunkI(-3.7), Math.floor(-3.7 * 111.195 * Math.cos(40 * Math.PI / 180) / 10));
  assert.equal(chunkJ(40.4), Math.floor(40.4 * 111.195 / 10));
  for (const [lat, lon] of [[35.2, -10], [44.8, 4.5], [40.4, -3.7], [37.7, -6.6], [43.3, -2.9]]) {
    const { i, j } = chunkOf(lat, lon);
    assert.deepEqual(chunkOf(chunkLat(j), chunkLon(i)), { i, j });
    assert.ok(Math.abs(chunkLat(j, 0) - chunkLat(j, 1) + 10 / 111.195) < 1e-9, 'a chunk is 10 km tall');
  }
  assert.deepEqual([ALBUM_GRID.i0, ALBUM_GRID.j0, ALBUM_GRID.W, ALBUM_GRID.H, ALBUM_GRID.chunkKm], [CI0, CJ0, CN, CN, CHUNK_KM]);
  assert.deepEqual([meta.grid.i0, meta.grid.j0, meta.grid.W, meta.grid.H], [CI0, CJ0, CN, CN]);
  for (const [lat, lon] of [[40.4, -3.7], [43.3, -2.9]]) {
    const [x, y] = kmOf(lat, lon), { i, j } = chunkOf(lat, lon);
    assert.deepEqual([Math.floor(x / CHUNK_KM), Math.floor(y / CHUNK_KM)], [i, j]);
  }
  const g = gridForBox(ALBUM_BOX);
  assert.ok(g.i0 >= CI0 && g.j0 >= CJ0 && g.i0 + g.W <= CI0 + CN && g.j0 + g.H <= CJ0 + CN);
});

test('album table: format 2 — whole numbers in metric units, a scale step and a 0–100 reference per resource', () => {
  assert.equal(meta.format, 'passionaris-resources');
  assert.equal(meta.version, 2);
  assert.deepEqual(meta.resources.map(r => r.id), RESOURCES.map(r => r.id));
  for (const r of meta.resources) assert.ok(Number.isInteger(r.scale) && r.scale >= 1 && r.ref100 > 0, r.id);
  assert.equal(table.N, meta.grid.W * meta.grid.H);
  for (let k = 0; k < table.amount.length; k++) {
    assert.ok(Number.isInteger(table.amount[k]), 'whole numbers');
    if (table.amount[k] === 0) assert.equal(table.depth[k], 255);
    else assert.ok(table.depth[k] <= 2);
  }
  assert.ok(table.layer('wood').filter(v => v > 0).length > 5000, 'forest on land');
  assert.ok(table.layer('fish').filter(v => v > 0).length > 5000, 'fish in the sea');
  // every deposit sits in its own square with at least its amount (less one scale step of rounding)
  for (const d of meta.deposits) {
    const { i, j } = chunkOf(d.lat, d.lon);
    assert.equal(table.cell(i, j), d.cell, d.name);
    assert.ok(Number.isInteger(d.amount) && d.cls >= 0 && d.cls <= 4, d.name);
    assert.ok(table.amount[RES_INDEX[d.res] * table.N + d.cell] >= d.amount - meta.resources[RES_INDEX[d.res]].scale, d.name);
    assert.ok(d.src, d.name);
  }
});

test('the 0–100 scale: the richest place is 100, anything there at all is at least 1, area counts', () => {
  assert.equal(index100(0, 1000), 0);
  assert.equal(index100(1000, 1000), 100);
  assert.equal(index100(5000, 1000), 100, 'never above 100');
  assert.equal(index100(80, 1000), 8, 'the owner\'s example: 2 billion of 25 billion is 8');
  assert.equal(index100(1, 1e9), 1, 'a trace still shows as 1');
  assert.equal(index100(1000, 1000, 400), 25, 'the same stock on four times the area is a quarter as rich');
  assert.equal(fmtAmount(12_300_000, 't'), '12 млн т');
  assert.equal(fmtAmount(1_500, 'kg'), '1,5 тыс. кг');
  assert.equal(fmtAmount(42, 'm3'), '42 м³');
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
  const half = { ...big, cells: big.cells.filter((_, k) => k % 2 === 0), weights: big.weights.filter((_, k) => k % 2 === 0) };
  const inHalf = new Set(half.cells);
  assert.deepEqual(scatterZone(half, 7), scatterZone(big, 7).filter(p => inHalf.has(p.cell)));
  const zone = { id: 'test:zone', res: 'gold', kind: 'zone', pieces: 3, amount: 90, depth: 1, cells: [5, 6, 7, 8, 9], weights: [255, 255, 255, 255, 255] };
  const z3 = scatterZone(zone, 99);
  assert.equal(z3.length, 3);
  assert.equal(new Set(z3.map(p => p.cell)).size, 3);
  assert.equal(z3.reduce((s, p) => s + p.amount, 0), 90);
  assert.deepEqual(scatterZone({ ...zone, weights: [0, 0, 255, 0, 0], pieces: 2 }, 3).map(p => p.cell), [7]);
  // «rich»: every candidate holds some, the seed decides how much
  const rich = { id: 'test:rich', res: 'iron', kind: 'rich', amount: 100, depth: 0, cells: [1, 2, 3, 4], weights: [255, 255, 128, 64] };
  const r1 = scatterZone(rich, 1), r2 = scatterZone(rich, 2);
  assert.deepEqual(r1.map(p => p.cell), rich.cells);
  assert.notDeepEqual(r1.map(p => p.amount), r2.map(p => p.amount));
});

test('withZones adds the scattered pieces on top of the table and leaves the table itself alone', () => {
  const before = table.amount.slice();
  const w1 = withZones(table, meta.zones, 42), w2 = withZones(table, meta.zones, 42);
  assert.deepEqual(w1.placed, w2.placed);
  assert.deepEqual(table.amount, before);
  let added = 0;
  for (let k = 0; k < before.length; k++) { assert.ok(w1.amount[k] >= before[k]); added += w1.amount[k] - before[k]; }
  assert.ok(Math.abs(added - w1.placed.reduce((s, p) => s + p.amount, 0)) < 1e-3 * added + 1);
  assert.ok(w1.placed.some(p => p.res === 'flint'), 'flint turns up somewhere in the chalk and limestone');
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
  assert.ok(s.copper >= 1e6, `the Rio Tinto district holds over a million tonnes of copper (${s.copper})`);
});

test('known places in real units: Rio Tinto, Almadén, Bizkaia, Cardona, Asturias, Linares, Neves-Corvo', () => {
  assert.ok(near('copper', 37.70, -6.60) >= 1e6, 'copper of Rio Tinto, t');
  assert.ok(near('silver', 37.70, -6.60) >= 1e5, 'silver of Rio Tinto, kg');
  assert.ok(near('gold', 37.70, -6.60) >= 1e3, 'gold of Rio Tinto, kg');
  assert.ok(near('mercury', 38.78, -4.84) >= 1e4, 'mercury of Almadén, t');
  assert.ok(near('iron', 43.26, -2.95, 2) >= 1e6, 'iron of Bizkaia, t');
  assert.ok(near('salt', 41.92, 1.68) >= 1e6, 'salt of Cardona, t');
  assert.ok(near('potash', 41.92, 1.68, 2) >= 1e6, 'potash of the Catalan basin, t');
  assert.ok(near('coal', 43.25, -5.75, 3) >= 1e7, 'coal of central Asturias, t');
  assert.ok(near('lead', 38.09, -3.63) >= 1e4, 'lead of Linares, t');
  assert.ok(near('copper', 37.57, -7.97) >= 1e6, 'copper of Neves-Corvo, t');
  assert.ok(near('gas', 43.41, -0.62) > 0, 'gas of Lacq');
  assert.equal(near('mercury', 41.4, 2.15, 2), 0, 'no mercury in Barcelona');
  assert.equal(near('oil', 40.4, -3.7, 2), 0, 'no oil under Madrid');
  // Almadén is the richest mercury place of the world: 100 on the scale
  assert.equal(index100(near('mercury', 38.78, -4.84, 0), ref('mercury')), 100, 'Almadén = 100');
});

test('rules: rich Atlantic shelf fish, forests in the wet north, wet Galicia, stony Pyrenees', () => {
  assert.ok(near('fish', 42.6, -9.2, 0) > near('fish', 40.0, -3.5, 0), 'the Galician coast beats the dry Meseta');
  assert.ok(near('fish', 40.7, 0.85, 1) > 0, 'the Ebro delta');
  const at = (res, lat, lon) => table.get(res, chunkI(lon), chunkJ(lat));
  assert.ok(at('wood', 43.2, -5.0) > at('wood', 37.0, -2.4), 'Asturias is greener than Almería');
  assert.ok(at('water', 42.8, -8.2) > 3 * at('water', 37.9, -1.2), 'Galicia is far wetter than Murcia');
  assert.ok(near('stone', 42.7, 0.6, 0) > near('stone', 39.0, -3.0, 0), 'the Pyrenees are rockier than La Mancha');
  assert.ok(Math.max(...table.layer('limestone')) > 0, 'limestone in the carbonate ranges');
  assert.ok(at('game', 41.0, -5.0) > 0, 'game in the woods of the Meseta');
});

test('album aspect «Ресурсы»: its knobs, its pages inside the region, every resource selectable', async () => {
  const { default: aspect } = await import('../src/album/aspects/resources.js');
  const { DEFS } = await import('../src/album/params.js');
  assert.equal(aspect.id, 'resources');
  const keys = new Set(DEFS.map(d => d.key));
  for (const d of aspect.params) assert.ok(keys.has(d.key) && d.group === 'modes', d.key);
  assert.deepEqual(aspect.params.find(d => d.key === 'res').options.slice(1).map(o => o[0]), RESOURCES.map(r => r.id));
  assert.ok(!aspect.params.some(d => d.key === 'resMarks'), 'no marker dots — colour and names only');
  assert.ok(aspect.pages.length >= 5);
  for (const pg of aspect.pages) {
    assert.equal(pg.group, 'Ресурсы', pg.id);
    for (const k of Object.keys(pg.p)) assert.ok(keys.has(k), `${pg.id}: unknown knob ${k}`);
    assert.ok(pg.p.res in RES_INDEX, pg.id);
    const c = pg.cam;
    assert.ok(c.lat >= ALBUM_BOX.lat0 && c.lat <= ALBUM_BOX.lat1 && c.lon >= ALBUM_BOX.lon0 && c.lon <= ALBUM_BOX.lon1 && c.h >= 20, pg.id);
  }
});

test('world table (1°): format 2, and a few places of the whole globe', () => {
  const { meta: wm, table: wt } = load('world');
  assert.equal(wm.version, 2);
  assert.equal(wm.grid.W, 360); assert.equal(wm.grid.H, 180);
  assert.deepEqual(wm.resources.map(r => r.id), RESOURCES.map(r => r.id));
  const at = (res, lat, lon, r = 1) => {
    let best = 0;
    const y0 = Math.floor(90 - lat), x0 = Math.floor(lon + 180);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const y = y0 + dy, x = (x0 + dx + 360) % 360;
      if (y >= 0 && y < 180) best = Math.max(best, wt.amount[RES_INDEX[res] * wt.N + y * 360 + x]);
    }
    return best;
  };
  assert.ok(at('fish', -12, -78, 0) > at('fish', 28, -60, 0), 'the Peru upwelling beats the Sargasso Sea');
  assert.ok(at('wood', 60, 90, 0) > at('wood', 23, 10, 0), 'the Siberian taiga beats the Sahara');
  assert.equal(at('clay', -80, 0, 0), 0, 'no clay under the Antarctic ice');
  assert.ok(at('oil', 26, 50, 2) > 0, 'oil around the Persian Gulf');
  assert.ok(at('copper', -22.3, -68.9, 1) >= 1e6, 'copper of Chuquicamata, t');
});

test('natural chunks: squares spread over the chunks of their texels — fish to water, wood to land, totals kept', () => {
  const FNt = 16, sub = 8, cell = new Uint16Array(FNt * FNt);
  for (let ty = 0; ty < FNt; ty++) for (let tx = 0; tx < FNt; tx++) cell[ty * FNt + tx] = ty < 8 ? (tx < 8 ? 0 : 1) : (tx < 4 ? 2 : 3);
  const links = [[{ k: 2, km: 5 }], [], [{ k: 0, km: 5 }], []];
  const g = { count: 4, kind: Uint8Array.from([1, 0, 1, 0]), cell, FN: FNt, sub, at: () => 2 };
  const R = RESOURCES.length, N = 4, amount = new Float64Array(R * N), depth = new Uint8Array(R * N).fill(255);
  const put = (res, s, v, d = 0) => { amount[RES_INDEX[res] * N + s] = v; depth[RES_INDEX[res] * N + s] = d; };
  put('fish', 0, 64); put('fish', 2, 64); put('wood', 2, 32); put('wood', 1, 16); put('copper', 0, 30, 1);
  const tbl = { amount, depth, N, R, index: RES_INDEX };
  const mt = { grid: { W: 2, H: 2 }, resources: RESOURCES, deposits: [{ res: 'copper', cell: 0, amount: 30, cls: 3, depth: 1, lat: 0, lon: 0 }] };
  const out = spreadToChunks(tbl, mt, g);
  const get = (res, k) => out.amount[RES_INDEX[res] * 4 + k];
  assert.deepEqual([0, 1, 2, 3].map(k => get('fish', k)), [64, 0, 0, 64]);
  assert.deepEqual([0, 1, 2, 3].map(k => get('wood', k)), [0, 16, 32, 0]);
  assert.deepEqual([0, 1, 2, 3].map(k => get('copper', k)), [0, 0, 30, 0], 'without links a deposit stays in its chunk');
  assert.deepEqual(out.depositChunk, [2]);
  // with links a large deposit eases into its land neighbours, the total kept
  const eased = spreadToChunks(tbl, mt, { ...g, links });
  const e = k => eased.amount[RES_INDEX.copper * 4 + k];
  assert.ok(Math.abs(e(2) - 30 * (1 - SPREAD[3])) < 1e-9 && Math.abs(e(0) - 30 * SPREAD[3]) < 1e-9);
  const zs = zonesToChunks([
    { id: 'z:gold', res: 'gold', kind: 'zone', pieces: 1, amount: 10, depth: 1, cells: [2], weights: [200] },
    { id: 'z:oil', res: 'oil', kind: 'zone', pieces: 1, amount: 10, depth: 2, cells: [2, 3], weights: [100, 50] },
    { id: 'z:none', res: 'gold', kind: 'zone', pieces: 1, amount: 10, depth: 1, cells: [1], weights: [255] },
  ], mt, g);
  assert.deepEqual(zs.map(z => [z.id, z.cells, z.weights]), [['z:gold', [2], [200]], ['z:oil', [2, 3], [100, 100]]]);
  const half = { amount: Float32Array.from([0.5, 0.25]), depth: Uint8Array.from([0, 0]), index: { fish: 0 }, N: 2 };
  assert.ok(withZones(half, [], 1).amount instanceof Float32Array);
});

test('natural chunks of the album: totals kept, wood on land, fish in water, known places in their chunks', { skip: !albumData && 'public/album-data/ is not there' }, () => {
  const ch = new Chunks(albumData.base.at, albumData.vectors.rivers);
  const g = { count: ch.count, kind: ch.kind, cell: ch.cell, FN, sub: CHUNK_KM / FKM, links: ch.links, at: (lat, lon) => ch.at(lat, lon) };
  const out = spreadToChunks(table, meta, g), n = ch.count;
  const total = (arr, N, res, filter = () => true) => { let s = 0; for (let k = 0; k < N; k++) if (filter(k)) s += arr[RES_INDEX[res] * N + k]; return s; };
  for (const res of ['fish', 'wood', 'stone', 'clay', 'copper', 'silver']) {
    const a = total(table.amount, table.N, res), b = total(out.amount, n, res);
    assert.ok(Math.abs(a - b) <= a * .005 + 1, `${res}: ${a} in squares, ${b} in chunks`);
  }
  const inside = k => { const c = ch.centre(k); return c.lat >= ALBUM_BOX.lat0 && c.lat <= ALBUM_BOX.lat1 && c.lon >= ALBUM_BOX.lon0 && c.lon <= ALBUM_BOX.lon1; };
  for (const res of ['wood', 'stone', 'clay']) assert.ok(total(out.amount, n, res, k => inside(k) && !ch.kind[k]) < total(out.amount, n, res, inside) * .005, `${res} on land chunks`);
  assert.ok(total(out.amount, n, 'fish', k => inside(k) && !ch.kind[k]) > total(out.amount, n, 'fish', inside) * .6, 'most fish in water chunks');
  const nearCh = (res, lat, lon, r = 1) => {
    let best = 0;
    for (const [k] of ch.ring(ch.at(lat, lon), r)) best = Math.max(best, out.amount[RES_INDEX[res] * n + k]);
    return best;
  };
  assert.ok(nearCh('copper', 37.70, -6.60) >= 5e5, 'copper of Rio Tinto');
  assert.ok(nearCh('mercury', 38.78, -4.84) >= 5e3, 'mercury of Almadén');
  assert.ok(nearCh('coal', 43.25, -5.75, 2) >= 5e6, 'coal of central Asturias');
  assert.ok(nearCh('salt', 41.92, 1.68) >= 5e5, 'salt of Cardona');
  meta.deposits.forEach((d, q) => assert.equal(out.depositChunk[q], ch.at(d.lat, d.lon), d.name));
  for (const z of zonesToChunks(meta.zones, meta, g)) {
    assert.ok(z.cells.every(k => k >= 0 && k < n), z.id);
    if (!['oil', 'gas', 'helium'].includes(z.res)) assert.ok(z.cells.every(k => ch.kind[k] === 1), z.id);
  }
});
