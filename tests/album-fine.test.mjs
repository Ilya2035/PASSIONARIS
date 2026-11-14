// Fine heights of the mountains (src/album/ground/fine.js): the tiles of level 11, the window of them around the
// camera, and how the ground shader is told how fine they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FINE_Z, TILE, WIN, FEATHER, SHORE, decodeTile, encodeTile, levelFor, tilesOf, windowFor, windowRect, joinWindow } from '../src/album/ground/fine.js';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const raw = m => Math.round((m + 8192) * 4);                         // metres → the number a tile holds

test('fine tile: the way it lies in its file is undone exactly', () => {
  const u = new Uint16Array(TILE * TILE);
  for (let k = 0; k < u.length; k++) u[k] = raw(1500 + 900 * Math.sin(k / 517) + (k % TILE) * 3);
  u[0] = raw(-55); u[1] = raw(3447); u[TILE] = 0; u[TILE + 1] = 65535;   // the limits, and a wrap around 65536
  assert.deepEqual(decodeTile(encodeTile(u)), u);
  // the rule as the baker states it: a number minus the one before it in its row; the first of a row minus the first of the row above
  const d = encodeTile(u);
  assert.equal(d[0], u[0]);
  assert.equal(d[5], (u[5] - u[4]) & 65535);
  assert.equal(d[TILE * 3], (u[TILE * 3] - u[TILE * 2]) & 65535);
});

test('fine window: how fine it is goes by the height of the camera, and does not flutter at a limit', () => {
  assert.equal(levelFor(10), 0); assert.equal(levelFor(31), 0); assert.equal(levelFor(33), 1); assert.equal(levelFor(120), 1); assert.equal(levelFor(126), -1); assert.equal(levelFor(400), -1);
  assert.equal(levelFor(34, 0), 0, 'kept a little past the limit on the way up');
  assert.equal(levelFor(37, 0), 1);
  assert.equal(levelFor(33, 1), 1); assert.equal(levelFor(31, 1), 0);
  assert.equal(levelFor(135, 1), 1, 'and on the way out'); assert.equal(levelFor(135, -1), -1); assert.equal(levelFor(141, 1), -1);
  assert.equal(tilesOf(0), 8); assert.equal(tilesOf(1), 16);
  assert.equal(tilesOf(0) * TILE, WIN); assert.equal(tilesOf(1) * (TILE / 2), WIN, 'every window is one square of 2048 points: the shader counts on it');
});

test('fine window: centred on the camera, kept while the camera stays near its middle', () => {
  const w = windowFor(null, 1000.4, 760.7, 20);
  assert.deepEqual(w, { L: 0, x0: 996, y0: 757 });
  assert.equal(windowFor(w, 1001.9, 760.7, 20), w, 'two tiles from the middle: the same window');
  assert.equal(windowFor(w, 998.1, 762.9, 25), w);
  assert.deepEqual(windowFor(w, 1002.2, 760.7, 20), { L: 0, x0: 998, y0: 757 }, 'further: a new one, centred on the camera');
  const w1 = windowFor(w, 1000.4, 760.7, 60);
  assert.deepEqual(w1, { L: 1, x0: 992, y0: 753 }, 'higher: a window twice as wide, every other point');
  assert.equal(windowFor(w1, 1003.9, 757.5, 60), w1, 'kept within four tiles of its middle');
  assert.equal(windowFor(w1, 1000, 760, 300), null, 'from on high the base is fine enough');
  // where it lies, as the shader is told: corner in the Mercator plane and 1 / side; log2 of that − 6 = levels below the base (z9)
  assert.deepEqual(windowRect(w), [996 / 2048, 757 / 2048, 256, 256]);
  assert.deepEqual(windowRect(w1), [992 / 2048, 753 / 2048, 128, 128]);
  assert.equal(Math.log2(windowRect(w)[2]) - 6, FINE_Z - 9); assert.equal(Math.log2(windowRect(w1)[2]) - 6, FINE_Z - 1 - 9);
  assert.equal(Math.log2(2 ** 12 * 256 / 2048) - 6, 3, 'and the square of a showcase place (level 12, 2048 points) is three levels below it');
});

test('fine window: tiles are joined, the base fills what is missing, a fine tile leans toward the base where it ends', () => {
  const win = { L: 0, x0: 100, y0: 200 }, fine = new Set(['101_200', '102_200', '101_201']);
  const t = new Uint16Array(TILE * TILE).fill(raw(1000));
  const base = (mx, my) => (mx * 2048 < 100.5 ? .3 : mx * 2048 >= 106 ? -40 : 400);   // a flat by the shore, land, and sea in the east
  const out = joinWindow(win, (x, y) => (fine.has(x + '_' + y) ? t : null), (x, y) => fine.has(x + '_' + y), base);
  const at = (i, j) => out[j * WIN + i];
  assert.equal(out.length, WIN * WIN);
  assert.equal(at(TILE + 100, 100), 1000, 'inside a fine tile: its own height');
  assert.equal(at(TILE * 3 + 5, 5), 400, 'no fine tile: the base');
  assert.equal(at(TILE * 7 + 5, 5), -40, 'the sea of the base stays sea');
  assert.equal(at(5, 5), SHORE, 'land of the base under .6 m would be read as water by the shader: it is lifted');
  // tile 101_200 has no fine tile to its west and none to its north; to its east and south there are
  assert.ok(Math.abs(at(TILE, 100) - (400 + 600 * .5 / FEATHER)) < 1e-3, 'at its west side it is nearly the base');
  assert.ok(at(TILE + FEATHER - 1, 100) > 950 && at(TILE + FEATHER, 100) === 1000, 'and its own height sixteen points in');
  assert.equal(at(TILE * 2 - 1, 100), 1000, 'no leaning toward a fine neighbour');
  assert.ok(at(TILE + 100, 0) < 450 && at(TILE + 100, TILE - 1) === 1000, 'north side leans, south side does not');
  // every other point: a mean of four, and the leaning is half as many points
  const g = new Uint16Array(TILE * TILE); for (let k = 0; k < g.length; k++) g[k] = raw((k % 2) * 8 + ((k / TILE | 0) % 2) * 4);
  const o1 = joinWindow({ L: 1, x0: 100, y0: 200 }, () => g, () => true, () => 0);
  assert.equal(o1[0], 6); assert.equal(o1[WIN * 300 + 1700], 6);
});

test('fine heights in the shaders: how fine they are is read off the square itself, by everyone who asks heightLod()', () => {
  const glsl = read('../src/album/glsl.js'), terrain = read('../src/album/terrain.js'), data = read('../src/album/data.js'), main = read('../src/album/main.js');
  assert.ok(glsl.includes('max(0., lod + log2(uDetRect.z) - 6. - (uDetOn - 1.) * (1. - min(lod * 8., 1.)))'), 'no «three levels» written in: a window of tiles is two or one');
  assert.ok(terrain.includes('mix(.24, 17.92 / uDetRect.z, dw)'), 'the step of the slope is a point and a quarter of the fine heights');
  assert.ok(data.includes("t = new DataTexture(m, n, n, RedFormat, FloatType); t.internalFormat = 'R32F';"), 'whole floats: a half float is 2 m above 2048 m');
  assert.ok(data.includes('detailFor, fineIdle,') && main.includes('const d = await data.detailFor(s); if (d !== undefined) terrain.setDetail(d);'), 'the album asks data.js what the ground should have');
  assert.ok(!main.includes('bd < 70'), 'the choice is no longer in main.js');
});
