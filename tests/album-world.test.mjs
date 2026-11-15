// The land of the whole Earth beyond the polygon (docs/album/ground.md, «Вся Земля»): the climate of the world as a
// file, and the rules that read it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { WORLD_W, WORLD_H, WARM, YEAR, LAPSE, encodeWorldClimate, decodeWorldClimate, snowlineOf, treelineOf, SNOW_WARM, SNOW_YEAR } from '../src/album/ground/climate.js';

const FILE = new URL('../public/assets/album/ground/world.bin.gz', import.meta.url);

test('world climate: the file format keeps every number to a byte', () => {
  const w = 8, h = 4, n = w * h, f = k => Float32Array.from({ length: n }, (_, o) => k(o % w, (o / w) | 0));
  const src = { w, h, year: f((i, j) => -5 + i * 5), wet: f((i, j) => (i + j) / 11), warm: f((i, j) => 5 + j * 12 + i), summer: f((i, j) => (i % 2 ? .25 : 1)) };
  const back = decodeWorldClimate(encodeWorldClimate(src));
  assert.equal(back.w, w); assert.equal(back.h, h); assert.equal(back.data.length, n * 4);
  for (let o = 0; o < n; o++) {
    assert.ok(Math.abs(YEAR[0] + back.data[o * 4] / 255 * (YEAR[1] - YEAR[0]) - src.year[o]) < .1);
    assert.ok(Math.abs(back.data[o * 4 + 1] / 255 - src.wet[o]) < .003);
    assert.ok(Math.abs(WARM[0] + back.data[o * 4 + 2] / 255 * (WARM[1] - WARM[0]) - Math.min(WARM[1], src.warm[o])) < .1);
    assert.ok(Math.abs(back.data[o * 4 + 3] / 255 - src.summer[o]) < .003);
  }
  assert.equal(decodeWorldClimate(new Uint8Array(40)), null, 'not such a file');
});

test('world climate: the snow line of the lands with a winter and of the tropics', () => {
  // with a winter, the summer decides; without one, the year does
  assert.equal(snowlineOf(24, 12), (24 - SNOW_WARM) / LAPSE);
  assert.equal(snowlineOf(27.5, 27), (27 - SNOW_YEAR) / LAPSE);
  assert.ok(snowlineOf(24, 12) > 2300 && snowlineOf(24, 12) < 2700, 'the Alps');
  assert.ok(snowlineOf(27.5, 27) > 4500, 'the equator: only the highest volcanoes');
  assert.ok(snowlineOf(5, -5) < 0, 'the polar lands are white down to the sea');
  assert.ok(treelineOf(5, 1) < 0, 'and nothing grows there');
});

test('world climate: the baked file says what everyone knows of the Earth', { skip: !fs.existsSync(FILE) }, () => {
  const c = decodeWorldClimate(zlib.gunzipSync(fs.readFileSync(FILE)));
  assert.equal(c.w, WORLD_W); assert.equal(c.h, WORLD_H);
  const at = (lat, lon) => { const o = (Math.floor((90 - lat) / 180 * c.h) * c.w + Math.floor((lon + 180) / 360 * c.w)) * 4, d = c.data;
    return { year: YEAR[0] + d[o] / 255 * (YEAR[1] - YEAR[0]), wet: d[o + 1] / 255, warm: WARM[0] + d[o + 2] / 255 * (WARM[1] - WARM[0]), summer: d[o + 3] / 255 }; };
  assert.ok(at(23, 10).wet < .05 && at(-24, -69.5).wet < .05 && at(43, 105).wet < .12, 'the Sahara, the Atacama and the Gobi are deserts');
  assert.ok(at(0, 22).wet > .9 && at(-3.1, -60).wet > .85 && at(1.3, 103.8).wet > .9, 'the Congo, the Amazon and Malaya are rain forest');
  assert.ok(at(48.85, 2.35).wet > .58 && at(55.75, 37.6).wet > .58, 'Paris and Moscow stand in closed forest country');
  assert.ok(at(14, 5).wet < .2 && at(-23.7, 133.9).wet < .2, 'the Sahel and the middle of Australia are steppe at best');
  // trees and snow
  const alps = at(45.83, 6.86), tl = treelineOf(alps.warm, alps.summer), sl = snowlineOf(alps.warm, alps.year);
  assert.ok(tl > 1900 && tl < 2400 && sl > 2300 && sl < 2800, `the Alps: trees to ${Math.round(tl)} m, snow from ${Math.round(sl)} m`);
  for (const [lat, lon] of [[78.5, 16], [72, -40], [-80, 90], [-70, 0]]) { const p = at(lat, lon); assert.ok(snowlineOf(p.warm, p.year) < 0 && treelineOf(p.warm, p.summer) < 0, `ice at ${lat}, ${lon}`); }
  const kili = at(-3.07, 37.35); assert.ok(snowlineOf(kili.warm, kili.year) > 4500 && snowlineOf(kili.warm, kili.year) < 5600, 'Kilimanjaro: snow on the summit only');
  const taymyr = at(74, 100); assert.ok(treelineOf(taymyr.warm, taymyr.summer) < 0 && snowlineOf(taymyr.warm, taymyr.year) > 100, 'the tundra of Taymyr: no trees, no lasting snow on the plain');
  // the polygon and the world are baked by one rule: Madrid, Santiago and Almería say the same in both
  const mad = at(40.42, -3.70), san = at(42.88, -8.54), alm = at(36.84, -2.46);
  assert.ok(mad.wet > .2 && mad.wet < .5 && san.wet > .75 && alm.wet < .15, `${mad.wet.toFixed(2)} ${san.wet.toFixed(2)} ${alm.wet.toFixed(2)}`);
});

test('world climate: the two bakes share one rule', () => {
  const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['../scripts/album/bake-ground.mjs', '../scripts/album/bake-world-climate.mjs']) assert.ok(read(f).includes("import { rawFolder, openClimate } from './climate-rule.mjs';"), f);
  assert.ok(read('../scripts/album/climate-rule.mjs').includes('export function balance(T, P, lat)'));
});
