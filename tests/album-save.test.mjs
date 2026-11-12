// The trial of how the land and its settlements go into a save (docs/SAVE-LAND.md, src/album/save/land.js): the
// numbers survive the game's save container, and the album's whole world is a few kilobytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packLand, unpackLand, landBytes, landOfAlbum, peopleCode, peopleOf, LAND_FORMAT, GENERATOR, STRUCTURES, ROAD_LEVELS, EXCEPTIONS } from '../src/album/save/land.js';
import { encodeSave, decodeSave } from '../src/save/saveSystem.js';
import { Chunks, kmOf, FN, FKM } from '../src/album/chunks.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { roadNetwork } from '../src/album/roads/routes.js';
import { decodeSites } from '../src/album/town/sites.js';
import { growTowns, centrePlaces } from '../src/album/town/grow.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('save of the land: people in two bytes — exact for a village, to one part in a thousand for a city', () => {
  for (const n of [0, 1, 7, 250, 999, 2047]) assert.equal(peopleOf(peopleCode(n)), n);
  for (const n of [2048, 15000, 650000, 5.6e6, 3.1e7, 1.4e9]) { const back = peopleOf(peopleCode(n)); assert.ok(Math.abs(back / n - 1) < 1 / 1000, `${n} → ${back}`); assert.ok(peopleCode(n) <= 65535); }
  assert.ok(peopleCode(1e6) > peopleCode(1e5) && peopleCode(-5) === 0);
  assert.ok(STRUCTURES.length <= 16 && ROAD_LEVELS.length === 4 && EXCEPTIONS.length <= 256);
});

test('save of the land: districts, towns, roads and exceptions come back from the game\'s save file as they went in', async () => {
  const world = {
    districts: [
      { forest: 1, fields: 0, pasture: 0, built: 0, burnt: 0, age: 0, villages: 0, villagers: 0 },
      { forest: 153 / 255, fields: 51 / 255, pasture: 20 / 255, built: 2 / 255, burnt: 0, age: 40, villages: 7, villagers: 1890 },
      { forest: 0, fields: 204 / 255, pasture: 30 / 255, built: 12 / 255, burnt: 5 / 255, age: 255, villages: 31, villagers: 12288 },
    ],
    settlements: [{ district: 2, site: 0, people: 2047 * 32, structures: 0b1110, culture: 2, founded: -210 }, { district: 1, site: 3, people: 1500, structures: 2, culture: 1, founded: 912 }, { district: 2, site: 5, people: 4096, structures: 6, culture: 2, founded: 1250 }],
    roads: [0, 1, 2, 3, 3, 0, 1], exceptions: [{ district: 2, chunk: 317, kind: 0, value: 200 }, { district: 1, chunk: 12, kind: 2, value: 1 }],
  };
  const sections = packLand(world), b = landBytes(sections);
  assert.deepEqual(b, { districts: 3 * 9, settlements: 3 * 12, roads: 2, exceptions: 2 * 8 }, 'nine bytes a district, twelve a town, two bits a road, eight an exception');
  const file = await encodeSave({ meta: { t: 0, name: 'trial' }, sections }), back = unpackLand((await decodeSave(file)).sections);
  assert.equal(back.format, LAND_FORMAT); assert.equal(back.generator, GENERATOR);
  assert.deepEqual(back.districts, world.districts); assert.deepEqual(back.roads, world.roads); assert.deepEqual(back.exceptions, world.exceptions);
  assert.deepEqual(back.settlements, [world.settlements[1], world.settlements[0], world.settlements[2]], 'towns come back in the order of their districts');
  // an empty world is a valid one
  const none = unpackLand((await decodeSave(await encodeSave({ meta: { t: 0 }, sections: packLand({ districts: [], settlements: [], roads: [], exceptions: [] }) }))).sections);
  assert.deepEqual([none.districts.length, none.settlements.length, none.roads.length, none.exceptions.length], [0, 0, 0, 0]);
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
  const model = growTowns(ch, places, 1, at), world = landOfAlbum({ ch, div, model, places, legs: net.legs, districtOf });
  assert.equal(world.districts.length, div.count); assert.equal(world.roads.length, net.legs.length);
  const villages = world.districts.reduce((s, d) => s + d.villages, 0);
  assert.equal(world.settlements.length + villages, model.towns.length, 'every settlement is a town with a record or a village that is counted');
  assert.ok(world.settlements.length > 50 && villages > 1000, `${world.settlements.length} towns, ${villages} villages`);
  const sections = packLand(world), b = landBytes(sections), raw = b.districts + b.settlements + b.roads + b.exceptions;
  const file = await encodeSave({ meta: { t: 0, name: 'album' }, sections }), back = unpackLand((await decodeSave(file)).sections);
  assert.equal(back.settlements.length, world.settlements.length); assert.deepEqual(back.roads, world.roads);
  assert.ok(raw < 40000 && file.length < 12000, `the land of the album: ${raw} bytes, ${file.length} in the save file`);
  assert.ok(raw / landKm2 * 1000 < 50, `${(raw / landKm2 * 1000).toFixed(1)} bytes for 1 000 km² of land`);
  assert.ok(raw / landKm2 * 149e6 < 10e6, 'the land of the whole world at this density is under 10 MB before packing');
  // people are not lost on the way: the towns hold theirs to a part in a thousand, the villages are summed
  const before = world.settlements.reduce((s, t) => s + t.people, 0), after = back.settlements.reduce((s, t) => s + t.people, 0);
  assert.ok(Math.abs(after / before - 1) < 1e-3);
});
