// The coast fix (scripts/bake-coast-fix.mjs, public/assets/coast/, src/game/terrain/coast.js): one coastline for
// every zoom level, as in 5000 BC — the lost islands are land, reservoirs and the IJsselmeer basin are land,
// natural lakes stay lakes, and every island has a detail land mask.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeCoastFix, fixDistricts, fixBiomes } from '../src/game/terrain/coast.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const COAST = path.join(ROOT, 'public', 'assets', 'coast');
const W = 8192, H = 4096;
const gz = f => { const b = zlib.gunzipSync(fs.readFileSync(f)); const c = new Uint8Array(b.byteLength); c.set(b); return c; };

const meta = JSON.parse(fs.readFileSync(path.join(COAST, 'coast.json'), 'utf8'));
const fix = { meta, ...decodeCoastFix(gz(path.join(COAST, meta.cells.file))), tiles: new Set(meta.tiles) };
const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'regions', 'regions.json'), 'utf8'));
const type = new Map(regions.districts.map(d => [d.id, d.type]));
const ids = new Uint16Array(gz(path.join(ROOT, 'public', 'assets', 'regions', 'districts.bin.gz')).buffer);
const before = ids.slice();
const applied = fixDistricts(ids, fix, regions.districts.length);
const biome = gz(path.join(ROOT, 'public', 'assets', 'climate', 'biome-open.bin.gz'));
fixBiomes(biome, fix);

const at = (lat, lon) => Math.min(H - 1, Math.floor((90 - lat) / 180 * H)) * W + Math.floor((lon + 180) / 360 * W);
const kindAt = (arr, lat, lon) => type.get(arr[at(lat, lon)]) || 'none';
const isLand = k => k === 'land' || k === 'mountain';

test('coast fix: file, counts and the districts it was baked for', () => {
  assert.equal(meta.format, 'passionaris-coast-fix');
  assert.equal(fix.idx.length, meta.cells.count);
  assert.equal(fix.idx.length, meta.cells.toLand + meta.cells.toWater);
  assert.equal(fix.bIdx.length, meta.cells.biomeOnly);
  assert.ok(applied, 'baked for the current regions set');
  for (let k = 1; k < fix.idx.length; k++) assert.ok(fix.idx[k] > fix.idx[k - 1], 'indices strictly increasing');
  assert.ok(fix.idx[fix.idx.length - 1] < W * H);
  // every district id is 0 (old cell's water) or a known district; a texel made land never gets water and back
  for (let k = 0; k < fix.id.length; k++) {
    const d = fix.id[k];
    if (d) assert.ok(type.has(d), `unknown district ${d}`);
    if (d && isLand(type.get(d))) assert.ok(fix.bio[k] > 0, 'new land has a biome class');
  }
});

test('coast fix: the Kurils and the Pacific islands are land at the map scale', () => {
  for (const [name, lat, lon] of [['Iturup', 45.2, 148.0], ['Urup', 45.9, 150.0], ['Simushir', 46.95, 152.0], ['Onekotan', 49.4, 154.8],
    ['Niihau', 21.9, -160.15], ['Kahoolawe', 20.55, -156.6], ['Moorea', -17.53, -149.83]]) {
    assert.ok(!isLand(kindAt(before, lat, lon)), `${name} was water before the fix (test premise)`);
    assert.ok(isLand(kindAt(ids, lat, lon)), `${name} is land`);
    assert.ok(biome[at(lat, lon)] > 0, `${name} has a biome class`);
  }
  // the open ocean around stays water
  for (const [name, lat, lon] of [['Pacific off the Kurils', 44.0, 154.0], ['Pacific off Hawaii', 18.0, -160.0], ['Sea of Okhotsk', 50.0, 150.0]]) {
    assert.ok(!isLand(kindAt(ids, lat, lon)), `${name} stays water`);
  }
});

test('coast fix: reservoirs and the IJsselmeer basin are land, natural lakes stay', () => {
  assert.ok(meta.reservoirsMadeLand.includes('Mingevir Reservoir'));
  for (const [name, lat, lon] of [['Mingachevir reservoir', 40.85, 46.95], ['Rybinsk reservoir', 58.4, 38.4], ['Lake Nasser', 22.5, 31.9],
    ['Kuybyshev reservoir', 54.6, 49.0], ['IJsselmeer', 52.8, 5.3], ['Markermeer', 52.55, 5.2], ['Flevoland', 52.45, 5.5]]) {
    assert.ok(isLand(kindAt(ids, lat, lon)), `${name} is land in 5000 BC`);
  }
  for (const [name, lat, lon] of [['Sevan', 40.35, 45.3], ["Il'men", 58.27, 31.3], ['Zaysan', 48.0, 84.0], ['Ladoga', 61.0, 31.5], ['Baikal', 53.5, 108.0]]) {
    assert.equal(kindAt(ids, lat, lon), 'lake', `${name} stays a lake`);
  }
  assert.ok(!isLand(kindAt(ids, 53.2, 5.2)), 'the Wadden Sea north of the Afsluitdijk stays water');
  assert.ok(!isLand(kindAt(ids, 42.0, 50.0)), 'the Caspian stays water');
});

test('coast fix: every island has a detail land mask', () => {
  const TX = meta.detail.tiles[0];
  const tileOf = (lat, lon) => Math.floor((90 - lat) / 180 * meta.detail.tiles[1]) * TX + Math.floor((lon + 180) / 360 * TX);
  // tiles without detail heights: their mask comes from the fix (Urup, Simushir; the Society Islands east of Tahiti)
  for (const [name, lat, lon] of [['Urup', 45.9, 150.0], ['Simushir', 46.95, 152.0], ['Mingachevir', 40.85, 46.95], ['IJsselmeer', 52.8, 5.3]]) {
    const key = tileOf(lat, lon);
    assert.ok(fix.tiles.has(key), `${name}: mask tile ${key} in the fix`);
    const tx = key % TX, ty = (key - tx) / TX;
    const m = gz(path.join(COAST, 'z7m', `${tx}_${ty}.bin.gz`));
    assert.equal(m.length, 256 * 256);
    const px = Math.floor(((lon + 180) / 360 * TX - tx) * 256), py = Math.floor(((90 - lat) / 180 * meta.detail.tiles[1] - ty) * 256);
    assert.ok(m[py * 256 + px] > 127, `${name}: land in the detail mask`);
  }
  for (const key of meta.tiles) {
    const tx = key % TX, ty = (key - tx) / TX;
    assert.ok(fs.existsSync(path.join(COAST, 'z7m', `${tx}_${ty}.bin.gz`)), `tile ${tx}_${ty}`);
  }
});

test('coast fix: a fix baked for other districts is not applied', () => {
  const copy = before.slice();
  assert.equal(fixDistricts(copy, fix, regions.districts.length + 1), false);
  assert.deepEqual(copy.subarray(0, 1000), before.subarray(0, 1000));
  assert.equal(fixDistricts(copy, null, regions.districts.length), false);
});
