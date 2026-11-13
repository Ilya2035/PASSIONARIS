// The trial of how the land and its settlements go into a save (docs/SAVE-LAND.md, src/album/save/land.js): the
// numbers survive the game's save container, and the album's whole world is a few kilobytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packLand, unpackLand, landBytes, landOfAlbum, farmsteadsOfAlbum, peopleCode, peopleOf, LAND_FORMAT, GENERATOR, STRUCTURES, ROAD_LEVELS, EXCEPTIONS, MAX_IN_DISTRICT, YARD_CHUNKS, YARD_SLOTS, YARD_LIST, YARD_LIST_CHUNKS } from '../src/album/save/land.js';
import { encodeSave, decodeSave } from '../src/save/saveSystem.js';
import { Chunks, kmOf } from '../src/album/chunks.js';
import { KN as FN, KKM as FKM, kmOrder, kmData, cellsOfChunks } from '../src/album/division/km.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { roadNetwork } from '../src/album/roads/routes.js';
import { decodeSites } from '../src/album/town/sites.js';
import { growTowns, centrePlaces } from '../src/album/town/grow.js';
import { cultureAt } from '../src/album/town/rules.js';
import { allYards, patchIndex, yardPlace } from '../src/album/town/yards.js';
import { mirrorFarm, farmAt } from '../src/album/town/state.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('save of the land: people in two bytes — exact for a village, to one part in a thousand for a city', () => {
  for (const n of [0, 1, 7, 250, 999, 2047]) assert.equal(peopleOf(peopleCode(n)), n);
  for (const n of [2048, 15000, 650000, 5.6e6, 3.1e7, 1.4e9]) { const back = peopleOf(peopleCode(n)); assert.ok(Math.abs(back / n - 1) < 1 / 1000, `${n} → ${back}`); assert.ok(peopleCode(n) <= 65535); }
  assert.ok(peopleCode(1e6) > peopleCode(1e5) && peopleCode(-5) === 0);
  assert.ok(STRUCTURES.length <= 16 && ROAD_LEVELS.length === 4 && EXCEPTIONS.length <= 256);
});

test('save of the land: districts, settlements, roads and exceptions come back from the game\'s save file as they went in', async () => {
  const world = {
    districts: [
      { forest: 1, fields: 0, pasture: 0, built: 0, burnt: 0, age: 0 },
      { forest: 153 / 255, fields: 51 / 255, pasture: 20 / 255, built: 2 / 255, burnt: 0, age: 40 },
      { forest: 0, fields: 204 / 255, pasture: 30 / 255, built: 12 / 255, burnt: 5 / 255, age: 255 },
    ],
    // a city, a town and two villages: every one with a record of its own
    settlements: [{ district: 2, site: 0, people: 2047 * 32, structures: 0b1110, culture: 2, founded: -210 }, { district: 1, site: 3, people: 1500, structures: 2, culture: 1, founded: 912 },
      { district: 2, site: 5, people: 240, structures: 0, culture: 2, founded: 1250 }, { district: 1, site: 0, people: 85, structures: 32, culture: 1, founded: 1404 }],
    // six farmsteads among the fields of two districts: each is only a place — a chunk of its district (counted in the
    // order the land is taken up) and one of sixteen places in it; two of them stand in one chunk
    farmsteads: [{ district: 2, chunk: 3, slot: 9 }, { district: 1, chunk: 0, slot: 0 }, { district: 2, chunk: 0, slot: 15 }, { district: 2, chunk: 5, slot: 3 }, { district: 1, chunk: 2, slot: 7 }, { district: 2, chunk: 3, slot: 10 }],
    roads: [0, 1, 2, 3, 3, 0, 1], exceptions: [{ district: 2, chunk: 317, kind: 0, value: 200 }, { district: 1, chunk: 12, kind: 2, value: 1 }],
  };
  const sections = packLand(world), b = landBytes(sections);
  assert.deepEqual(b, { districts: 3 * 9, settlements: 4 * 8, farmsteads: (2 + 4) * 2, roads: 2, exceptions: 2 * 8 }, 'nine bytes a district, eight a settlement, two for every farmstead where they stand thinly (two in one district, four in the other: the map of their chunks would be three and six), two bits a road, eight an exception');
  assert.deepEqual([...sections['land/yardChunks']], [0, YARD_LIST | 2, YARD_LIST | 4], 'both districts keep their yards as a list');
  const file = await encodeSave({ meta: { t: 0, name: 'trial' }, sections }), back = unpackLand((await decodeSave(file)).sections);
  assert.equal(back.format, LAND_FORMAT); assert.equal(back.generator, GENERATOR);
  assert.deepEqual(back.districts, world.districts); assert.deepEqual(back.roads, world.roads); assert.deepEqual(back.exceptions, world.exceptions);
  assert.deepEqual(back.settlements, [world.settlements[3], world.settlements[1], world.settlements[0], world.settlements[2]], 'settlements come back in the order of their districts and sites; the district is not written, it is counted');
  assert.deepEqual(back.farmsteads, [world.farmsteads[1], world.farmsteads[4], world.farmsteads[2], world.farmsteads[0], world.farmsteads[5], world.farmsteads[3]], 'farmsteads come back in the order of their districts, chunks and places');
  assert.equal(YARD_SLOTS, 16, 'sixteen places in a chunk: two bytes say which are taken');
  for (const bad of [{ district: 3, chunk: 0, slot: 0 }, { district: 1, chunk: YARD_CHUNKS, slot: 0 }, { district: 1, chunk: 5, slot: YARD_SLOTS }]) assert.throws(() => packLand({ ...world, farmsteads: [bad] }), RangeError);
  // however thickly the farmsteads stand, the cost is the land they stand on: a chunk full of sixteen is two bytes too
  { const full = Array.from({ length: 16 }, (_, slot) => ({ district: 0, chunk: 0, slot })), one = [{ district: 0, chunk: 0, slot: 4 }];
    assert.equal(landBytes(packLand({ ...world, farmsteads: full })).farmsteads, 2); assert.equal(landBytes(packLand({ ...world, farmsteads: one })).farmsteads, 2);
    assert.equal(unpackLand(packLand({ ...world, farmsteads: full })).farmsteads.length, 16);
    assert.deepEqual([...packLand({ ...world, farmsteads: full })['land/yardChunks']], [1, 0, 0], 'a chunk full of yards is kept as the map of its places');
    // a lone yard far from the centre of its district is two bytes, not the map of every chunk before it
    const far = [{ district: 0, chunk: 900, slot: 2 }], fs = packLand({ ...world, farmsteads: far });
    assert.equal(landBytes(fs).farmsteads, 2); assert.deepEqual(unpackLand(fs).farmsteads, far);
    // … beyond what the list can number the map is used again
    const out = [{ district: 0, chunk: YARD_LIST_CHUNKS + 3, slot: 2 }], os = packLand({ ...world, farmsteads: out });
    assert.equal(landBytes(os).farmsteads, (YARD_LIST_CHUNKS + 4) * 2); assert.deepEqual(unpackLand(os).farmsteads, out); }
  assert.deepEqual(unpackLand(packLand({ ...world, farmsteads: undefined })).farmsteads, [], 'a world without farmsteads is a valid one');
  // a district holds no more settlements than its one byte counts, and none lies outside the districts
  const crowd = Array.from({ length: MAX_IN_DISTRICT + 1 }, (_, i) => ({ district: 1, site: i % 256, people: 50, structures: 0, culture: 1, founded: 0 }));
  assert.throws(() => packLand({ ...world, settlements: crowd }), RangeError); assert.throws(() => packLand({ ...world, settlements: [{ ...world.settlements[0], district: 3 }] }), RangeError);
  assert.equal(packLand({ ...world, settlements: crowd.slice(1) })['land/count'][1], MAX_IN_DISTRICT);
  // an empty world is a valid one
  const none = unpackLand((await decodeSave(await encodeSave({ meta: { t: 0 }, sections: packLand({ districts: [], settlements: [], roads: [], exceptions: [] }) }))).sections);
  assert.deepEqual([none.districts.length, none.settlements.length, none.farmsteads.length, none.roads.length, none.exceptions.length], [0, 0, 0, 0, 0]);
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('save of the land: the whole world of the album is a few kilobytes — far less than a byte for every square kilometre', { skip }, async () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), sitesFile = join(ROOT, 'public/assets/album/town/sites.json.gz');
  const osm = existsSync(sitesFile) ? decodeSites(JSON.parse(gunzipSync(readFileSync(sitesFile)))) : [];
  const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const div = buildDivision(ch, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const sites = [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  div.centres = districtCentres(div, sites);
  const net = roadNetwork(div, div.centres, data.vectors.places), places = centrePlaces(data.vectors.places, div, sites);
  const at = (x, y) => data.base.at(y / 111.195, x / (111.195 * Math.cos(40 * Math.PI / 180)));
  const districtOf = (x, y) => { const tx = Math.floor((x + 880) / FKM), ty = Math.floor((y - 3880) / FKM); return tx < 0 || ty < 0 || tx >= FN || ty >= FN ? -1 : div.cells[ty * FN + tx]; };
  let landKm2 = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) landKm2 += div.area[d];
  const model = growTowns(ch, places, 1, at);
  // the yards among the fields, as the album draws them (town/yards.js), each at its place in a square kilometre of its district
  const patches = patchIndex(model.towns.map(t => ({ x: t.x, y: t.y, r: t.R }))), manner = new Uint8Array(ch.count);
  for (let k = 0; k < ch.count; k++) { const c = ch.centre(k); manner[k] = cultureAt(c.lat, c.lon); }
  const landSquare = (kx, ky) => { const d = div.cells[ky * FN + kx]; return d >= 0 && div.kinds[d] === LAND; };
  const farmTex = new Uint8Array(FN * FN * 4); mirrorFarm(model.farm, farmTex);
  const yards = allYards({ cell: ch.cell, land: c => ch.kind[c] === 1, farm: (x, y) => farmAt(x, y, farmTex), farmList: model.farm.list, culture: c => manner[c], patches, density: 1, landSquare, env: { at, river: () => 1e9, swamp: () => 0 } });
  // every yard is one of the sixteen places of a chunk of 1 km²; the chunks of a district are numbered from its centre outward
  const order = kmOrder(div, data.base.at);
  const farmsteads = farmsteadsOfAlbum(yards.map(y => yardPlace(y.i, y.j)), { cells: div.cells, rank: order.rank, n: FN });
  const world = landOfAlbum({ div, model, places, legs: net.legs, districtOf, farmsteads, cellOf: cellsOfChunks(ch).cell });
  { let chunks = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) chunks += kmData(div).box.num[d]; assert.equal(order.list.length, chunks, 'every chunk of land has its number in its district'); }
  assert.equal(world.districts.length, div.count); assert.equal(world.roads.length, net.legs.length);
  const villages = world.settlements.filter(s => s.people < 1000).length;
  assert.equal(world.settlements.length, model.towns.length, 'every settlement has a record of its own, a hamlet as much as a city');
  assert.ok(world.settlements.length - villages > 50 && villages > 1000, `${world.settlements.length - villages} towns, ${villages} villages`);
  const sections = packLand(world), b = landBytes(sections), raw = b.districts + b.settlements + b.farmsteads + b.roads + b.exceptions;
  const file = await encodeSave({ meta: { t: 0, name: 'album' }, sections }), back = unpackLand((await decodeSave(file)).sections);
  assert.equal(back.settlements.length, world.settlements.length); assert.deepEqual(back.roads, world.roads);
  assert.equal(b.settlements, world.settlements.length * 8); assert.equal(b.districts, div.count * 9);
  // the yards the album draws: some twenty thousand in the chunks of farmland, every one kept, under two bytes each
  assert.ok(yards.length > 15000 && yards.length < 30000, `${yards.length} yards among the fields`); assert.equal(world.farmsteads.length, yards.length, 'every yard has its place in the save');
  assert.equal(back.farmsteads.length, yards.length); assert.ok(b.farmsteads > 0 && b.farmsteads < yards.length * 3, `${b.farmsteads} bytes for ${yards.length} yards`);
  { const key = f => f.district * 1e7 + f.chunk * 16 + f.slot, sent = new Set(world.farmsteads.map(key)); assert.equal(sent.size, yards.length); assert.ok(back.farmsteads.every(f => sent.has(key(f)))); }
  // every land district ploughs its first sixty chunks and stands farmsteads on them, four to a chunk and then
  // sixteen: four times as many farmsteads, not a byte more
  { const land = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) land.push(d);
    const yards = per => land.flatMap(d => Array.from({ length: 60 * per }, (_, i) => ({ district: d, chunk: Math.floor(i / per), slot: (i % per) * (16 / per) })));
    const thin = packLand({ ...world, farmsteads: yards(4) }), thick = packLand({ ...world, farmsteads: yards(16) });
    assert.equal(landBytes(thin).farmsteads, land.length * 60 * 2); assert.equal(landBytes(thick).farmsteads, landBytes(thin).farmsteads);
    const got = unpackLand((await decodeSave(await encodeSave({ meta: { t: 0 }, sections: thick }))).sections).farmsteads;
    assert.equal(got.length, land.length * 60 * 16); assert.deepEqual(got[17], { district: land[0], chunk: 1, slot: 1 }); }
  assert.ok(raw < 90000 && file.length < 40000, `the land of the album: ${raw} bytes, ${file.length} in the save file`);
  assert.ok(raw / landKm2 * 1000 < 115, `${(raw / landKm2 * 1000).toFixed(1)} bytes for 1 000 km² of land`);
  assert.ok(raw / landKm2 * 149e6 < 18e6, 'the land of the whole world at this density is under 18 MB before packing');
  // people are not lost on the way: a village keeps every one of its own, a city to a part in a thousand
  const before = world.settlements.reduce((s, t) => s + t.people, 0), after = back.settlements.reduce((s, t) => s + t.people, 0);
  assert.ok(Math.abs(after / before - 1) < 1e-3);
});
