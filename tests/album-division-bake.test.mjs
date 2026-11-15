// The baked texels of the division (division/bake.js, public/assets/album/division/cells-20.bin.gz): the file is what
// the code builds from the data as they are now — a change of the land or of the rules of cells.js without baking
// anew fails here (node src/album/division/bake-cells.mjs) — and the division built from it is the division built
// without it, to the last texel. A file of other land is not taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeCells, decodeCells } from '../src/album/division/bake.js';
import { nodeDivision } from '../src/album/division/bake-cells.mjs';
import { KN, KNY } from '../src/album/division/km.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'public/assets/album/division/cells-20.bin.gz');
const read = () => { const u = gunzipSync(readFileSync(FILE)); return decodeCells(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('bake: the file packs and unpacks the texels as they are', () => {
  const cells = Int32Array.from([-1, 0, 5, 32767, 12]), prov = Int32Array.from([-1, 3, 3, -1, 0]);
  const raw = encodeCells({ size: 20, stamp: 'abc', cells, prov, width: 5, height: 1 }), back = decodeCells(raw.buffer);
  assert.equal(back.stamp, 'abc'); assert.equal(back.size, 20); assert.equal(back.width, 5);
  assert.ok(same(back.cells, cells) && same(back.prov, prov));
  assert.throws(() => encodeCells({ size: 20, stamp: 'x', cells: Int32Array.from([40000]), prov: Int32Array.from([0]), width: 1, height: 1 }));
  assert.equal(decodeCells(new Uint8Array(16).buffer), null, 'not such a file');
});

test('bake: the file in the repository is the land as it is now, and the division read from it is the division built', { skip: !existsSync(join(ROOT, 'public/album-data/meta.json')) && 'no album data' }, () => {
  assert.ok(existsSync(FILE), 'the baked texels are there');
  const baked = read();
  assert.equal(baked.width, KN); assert.equal(baked.height, KNY); assert.equal(baked.n, KN * KNY);
  const fresh = nodeDivision(ROOT, 20, null, true).div;
  assert.equal(fresh.baked, false);
  assert.equal(baked.stamp, fresh.stamp, 'the stamp of the land now: bake again (node src/album/division/bake-cells.mjs)');
  assert.ok(same(baked.cells, fresh.claim), 'the districts of the texels as claimed: bake again');
  assert.ok(same(baked.prov, fresh.provCells), 'the provinces of the texels: bake again');
  const read20 = nodeDivision(ROOT, 20, baked).div;
  assert.equal(read20.baked, true, 'taken');
  for (const k of ['cells', 'provCells', 'provChunks']) assert.ok(same(read20[k], fresh[k]), k);
  for (const k of ['hgt', 'riv', 'mtn']) assert.ok(same(read20.raster[k], fresh.raster[k]), k);
  for (const k of ['seg', 'list', 'first', 'num', 'centre', 'lab']) assert.ok(same(read20.geo[k], fresh.geo[k]), `geo.${k}`);
  // another land: the stamp does not fit, the texels are worked out anew
  const other = nodeDivision(ROOT, 20, { ...baked, stamp: '0000000000000000' }).div;
  assert.equal(other.baked, false);
  assert.ok(same(other.cells, fresh.cells));
});
