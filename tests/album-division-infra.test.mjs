// The level of infrastructure of a chunk in the division (division/infra.js): the levels are the roads' (roads/infra.js,
// the limits the network is laid by); the division adds the words, the switch on the map, and the rule that no main
// road can be laid through some districts — a band of chunks of the main level must join two of their neighbours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mainThrough, chunkLevels, landOf, INFRA_CAN, ROAD_KIND, LEVEL } from '../src/album/division/infra.js';
import { infraLevels } from '../src/album/roads/infra.js';
import { LAND } from '../src/album/division/build.js';
import { KN as FN, KKM, KX0, KY0 } from '../src/album/division/km.js';
import { DEFS } from '../src/album/params.js';
import { Chunks, kmOf } from '../src/album/chunks.js';
import { buildDivision } from '../src/album/division/build.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// three districts of land side by side: 0 | 1 | 2, and district 3 alone below them
function world() {
  const cells = new Int32Array(FN * FN).fill(-1), at = (x, y) => y * FN + x;
  for (let y = 10; y < 20; y++) for (let x = 10; x < 40; x++) cells[at(x, y)] = x < 20 ? 0 : x < 30 ? 1 : 2;
  for (let y = 20; y < 25; y++) for (let x = 10; x < 20; x++) cells[at(x, y)] = 3;
  return { div: { cells, kinds: [LAND, LAND, LAND, LAND], count: 4 }, at };
}

test('infrastructure: a main road through a district needs a band from one neighbour to another', () => {
  const { div, at } = world(), lv = new Uint8Array(FN * FN).fill(LEVEL.track);
  for (let x = 10; x < 40; x++) lv[at(x, 15)] = LEVEL.main;                  // a valley across the three
  let th = mainThrough(div, lv);
  assert.equal(th[1], 1, 'the valley runs from 0 through 1 to 2');
  assert.equal(th[0], 0, '0 has one neighbour on the valley: the road ends there');
  lv[at(25, 15)] = LEVEL.lesser;                                              // a gorge in the middle of 1
  th = mainThrough(div, lv);
  assert.equal(th[1], 0, 'cut in two: no main road through 1');
  lv[at(25, 14)] = LEVEL.main; lv[at(24, 14)] = LEVEL.main; lv[at(26, 14)] = LEVEL.main;   // a way round the gorge
  assert.equal(mainThrough(div, lv)[1], 1, 'round the gorge');
  assert.equal(mainThrough({ ...div, kinds: [LAND, 1, LAND, LAND] }, lv)[0], 0, 'water is no neighbour to join');
});

test('infrastructure: the levels are the roads\' own, the words and the switch', () => {
  const { div } = world(), hgt = new Float32Array(FN * FN); div.raster = { hgt };
  for (let t = 0; t < hgt.length; t++) hgt[t] = (t % FN) * 40;                 // a slope of 4 % to the east
  assert.deepEqual(chunkLevels(div), infraLevels(hgt, landOf(div), FN, KKM), 'the same as roads/infra.js');
  assert.equal(INFRA_CAN.length, 4); assert.equal(ROAD_KIND.length, 4);
  assert.equal(INFRA_CAN[LEVEL.main], 'главную дорогу'); assert.equal(INFRA_CAN[LEVEL.none], 'ничего');
  const knob = DEFS.find(k => k.key === 'kmInfra');
  assert.equal(knob?.map, 'Что можно проложить'); assert.equal(knob?.uniform, 'uDivInfra');
});

const data = loadAlbumData(ROOT);
test('infrastructure: the real land — a main road through most districts, not through the high mountains', { skip: !data && 'public/album-data/ is not there' }, () => {
  const json = f => JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division', f), 'utf8'));
  const ch = new Chunks(data.base.at, data.vectors.rivers);
  const div = buildDivision(ch, { lands: json('lands.json'), admin: json('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size: 20 });
  const lv = chunkLevels(div), th = mainThrough(div, lv);
  let n = 0, yes = 0; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND && div.neighbours[d].filter(e => div.kinds[e] === LAND).length >= 2) { n++; yes += th[d]; }
  assert.ok(yes / n > .7 && yes / n < .95, `through most districts, not all: ${yes} of ${n}`);
  // the district of the Maladeta and Aneto: no main road through it; the district of Zaragoza: yes
  const of = (lat, lon) => { const [x, y] = kmOf(lat, lon); return div.cells[Math.floor((y - KY0) / KKM) * FN + Math.floor((x - KX0) / KKM)]; };
  assert.equal(th[of(42.63, 0.66)], 0, 'Aneto');
  assert.equal(th[of(41.65, -0.89)], 1, 'Zaragoza');
});
