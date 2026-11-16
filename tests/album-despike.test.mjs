// Broken points of the base heights (src/album/ground/despike.js): needles and wells on the coast are mended, real
// land is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liftDryLand, innerLandOf, DRY_LAND, mendPockets, POCKET, POCKET_FLOOR, POCKET_MAX, POCKET_NECK, despike, NEEDLE, NEEDLE_LAND, WELL, WELL_SEA } from '../src/album/ground/despike.js';

const raw = m => Math.round((m + 8192) * 4), W = 40, H = 30;
// a flat shore: sea of −3 m in the west, land rising slowly to the east
const shore = () => { const u = new Uint16Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) u[j * W + i] = raw(i < 12 ? -3 : (i - 12) * 2); return u; };
const at = (u, i, j) => u[j * W + i] / 4 - 8192;
const put = (u, i, j, m) => { u[j * W + i] = raw(m); };

test('despike: the needle and the well beside the islet of Santa Marina are mended, cluster and all', () => {
  const u = shore(), clean = shore();
  // as in the base at 43.47° N, 3.73° W: four points of a needle in a square, three of a well in a row, one more beside
  put(u, 14, 10, 727); put(u, 15, 10, 1437); put(u, 14, 11, 453); put(u, 15, 11, 889);
  put(u, 14, 13, -185); put(u, 15, 13, -362); put(u, 16, 13, -234); put(u, 16, 14, -94);
  const n = despike(u, W, H);
  assert.ok(n >= 8, 'eight broken points, some looked at twice');
  for (let j = 8; j < 17; j++) for (let i = 11; i < 20; i++) assert.ok(Math.abs(at(u, i, j) - at(clean, i, j)) <= 6, `(${i}, ${j}) is the shore again: ${at(u, i, j)}`);
  for (let k = 0; k < u.length; k++) { const i = k % W, j = (k - i) / W; if (i < 11 || i > 19 || j < 8 || j > 16) assert.equal(u[k], clean[k], 'nothing else is touched'); }
});

test('despike: a single needle of 3900 m and a single well of 950 m', () => {
  const u = shore();
  put(u, 20, 5, 3939); put(u, 30, 20, -952);
  assert.equal(despike(u, W, H), 2);
  assert.ok(Math.abs(at(u, 20, 5) - 16) <= 2 && Math.abs(at(u, 30, 20) - 36) <= 2);
});

test('despike: real land is left alone', () => {
  // a sharp ridge in low country: the crest runs on, so two neighbours are as high as the point
  const ridge = new Uint16Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ridge[j * W + i] = raw(Math.max(0, 500 - Math.abs(i - 20) * 300));
  // a gorge cut 400 m into a plateau, its floor above the sea; and a strait 60 m deep between high banks
  const gorge = new Uint16Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) gorge[j * W + i] = raw(i === 20 ? 300 : i === 10 ? -60 : 700);
  // a horn of the high mountains: one point 300 m above all its neighbours, at 2600 m
  const horn = new Uint16Array(W * H).fill(raw(2300)); put(horn, 20, 15, 2600);
  // a rock in the sea, 200 m high and one point wide; a hole in the sea floor 60 m deep
  const sea = new Uint16Array(W * H).fill(raw(-20)); put(sea, 20, 15, 200); put(sea, 30, 15, -80);
  for (const [name, u] of Object.entries({ ridge, gorge, horn, sea })) { const o = u.slice(); assert.equal(despike(u, W, H), 0, name); assert.deepEqual(u, o, name); }
  // the limits themselves
  const low = new Uint16Array(W * H).fill(raw(10)); put(low, 20, 15, 10 + NEEDLE - 1); assert.equal(despike(low, W, H), 0, 'under the height of a needle');
  put(low, 20, 15, 10 + NEEDLE); assert.equal(despike(low, W, H), 1);
  const high = new Uint16Array(W * H).fill(raw(NEEDLE_LAND)); put(high, 20, 15, NEEDLE_LAND + 900); assert.equal(despike(high, W, H), 0, 'not in the mountains');
  const pit = new Uint16Array(W * H).fill(raw(45)); put(pit, 20, 15, WELL_SEA); assert.equal(despike(pit, W, H), 0, 'a dip that is not far under the sea');
  put(pit, 20, 15, WELL_SEA - 1); assert.equal(despike(pit, W, H), 1); assert.ok(45 - WELL_SEA >= WELL);
});

test('despike: the album mends the base before anything reads it', () => {
  const data = fs.readFileSync(new URL('../src/album/data.js', import.meta.url), 'utf8');
  assert.ok(data.indexOf('despike(raw, meta.base.w, meta.base.h)') > 0 && data.indexOf('despike(raw, meta.base.w, meta.base.h)') < data.indexOf('fillHollows(raw'), 'before the hollows are filled and before the texture is made');
});

test('pockets: a pit of deep water in a shallow lagoon takes the depth of the lagoon; the open sea and its bays are left', () => {
  const W2 = 60, H2 = 40, raw2 = m => (m + 8192) * 4, u = new Uint16Array(W2 * H2).fill(raw2(12));
  const box = (x0, y0, x1, y1, m) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) u[y * W2 + x] = raw2(m); };
  box(0, 0, 14, H2 - 1, -60);                      // the open sea, on the edge of the base
  box(15, 5, 22, 12, -40);                         // a deep bay of it
  box(15, 20, 40, 34, -3);                         // a lagoon three metres deep, open to the sea over its own depth
  box(28, 24, 33, 28, -35);                        // a pit in it
  box(48, 6, 52, 9, -50);                          // a pit in the middle of dry land: that is the lagoon, as the heights hold it
  const before = u.slice(), n = mendPockets(u, W2, H2);
  assert.equal(n, 6 * 5 + 5 * 4, 'the two pits and nothing else');
  assert.equal(u[26 * W2 + 30], raw2(-3), 'the pit in the lagoon is as deep as the lagoon');
  assert.equal(u[7 * W2 + 50], raw2(POCKET_FLOOR), 'the pit in the land stays water: whether it is a pond or a lagoon is the rule of fillHollows');
  assert.equal(u[8 * W2 + 18], raw2(-40), 'a bay the sea reaches through deep water');
  assert.equal(u[20 * W2 + 5], raw2(-60)); assert.equal(u[25 * W2 + 20], raw2(-3)); assert.equal(u[2 * W2 + 40], raw2(12));
  for (let k = 0; k < u.length; k++) assert.equal(u[k] < raw2(0), before[k] < raw2(0), 'land stays land and water stays water');
  // a pocket larger than the limit is a sea of its own
  const big = new Uint16Array(200 * 200).fill(raw2(-2)); for (let y = 20; y < 180; y++) for (let x = 20; x < 180; x++) big[y * 200 + x] = raw2(-30);
  assert.ok(160 * 160 > POCKET_MAX); assert.equal(mendPockets(big, 200, 200), 0);
  assert.ok(POCKET < POCKET_FLOOR && POCKET_FLOOR < 0);
});

test('pockets: a pit that hangs on the sea by a thread of deep water is a pocket; a bay with a wide mouth is the sea', () => {
  const W2 = 60, H2 = 40, raw2 = m => (m + 8192) * 4;
  // the open sea in the west, shallows east of it, and in the shallows a pit joined to the sea by a channel of deep
  // water `wide` points wide
  const make = wide => {
    const u = new Uint16Array(W2 * H2).fill(raw2(-2));
    const box = (x0, y0, x1, y1, m) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) u[y * W2 + x] = raw2(m); };
    box(0, 0, 14, H2 - 1, -60); box(30, 14, 39, 23, -50); box(15, 18, 29, 18 + wide - 1, -20);
    return u;
  };
  assert.equal(POCKET_NECK, 1, 'the sea reaches through deep water three points wide and more');
  for (const wide of [1, 2]) {
    const u = make(wide), n = mendPockets(u, W2, H2);
    assert.equal(u[18 * W2 + 34], raw2(-2), `a channel ${wide} wide: the pit takes the depth of the shallows`);
    assert.equal(u[10 * W2 + 5], raw2(-60), 'the open sea is left'); assert.equal(u[18 * W2 + 14], raw2(-60), 'with its own rim of deep water'); assert.equal(u[18 * W2 + 15], raw2(-2), 'the thread itself goes with the pit');
    assert.equal(n, 100 + 15 * wide, 'the pit and the thread');
  }
  { const u = make(3), before = u.slice(); assert.equal(mendPockets(u, W2, H2), 0, 'a channel three wide: a bay of the sea'); assert.deepEqual(u, before); }
  // without the neck: the rule as it was — whatever deep water touches is the sea
  { const u = make(1); assert.equal(mendPockets(u, W2, H2, POCKET_MAX, 0), 0); }
  // a narrow cove of the sea, two points wide, becomes as shallow as the water around it: no land appears
  { const u = new Uint16Array(W2 * H2).fill(raw2(-2)); for (let y = 0; y < H2; y++) for (let x = 0; x < 15; x++) u[y * W2 + x] = raw2(-60); for (let x = 15; x < 26; x++) { u[20 * W2 + x] = raw2(-30); u[21 * W2 + x] = raw2(-30); }
    const before = u.slice(); mendPockets(u, W2, H2); assert.equal(u[20 * W2 + 24], raw2(-2)); for (let k = 0; k < u.length; k++) assert.equal(u[k] < raw2(0), before[k] < raw2(0)); }
});

test('pockets: the page does not mend them yet — the division must take the same step first', () => {
  // The baked cells of the division are stamped with the heights (division/cells.js, cellsStamp), and its Node loader
  // (division/nodedata.js) must make the heights by the steps of data.js: tests/album-division-bake.test.mjs. So
  // mendPockets() goes into data.js and nodedata.js in one change, with the cells baked anew.
  const data = fs.readFileSync(new URL('../src/album/data.js', import.meta.url), 'utf8'), node = fs.readFileSync(new URL('../src/album/division/nodedata.js', import.meta.url), 'utf8');
  assert.equal(data.includes('mendPockets('), node.includes('mendPockets('), 'both loaders or neither');
});

test('dry land below the sea: what the mask calls inner land is raised above it; the shore stays where the heights put it', () => {
  const W2 = 40, H2 = 30, raw2 = m => (m + 8192) * 4, u = new Uint16Array(W2 * H2);
  // a land of 20 m with a chott 30 m under the sea in its middle; the sea in the west; the mask: land east of column 10
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) u[j * W2 + i] = raw2(i < 10 ? -50 : i >= 20 && i < 30 && j >= 10 && j < 20 ? -30 : 20);
  u[5 * W2 + 10] = raw2(-2);                      // a point below zero on the very shore: the first column of the land
  const mask = (i, j) => (i < 0 || j < 0 || i >= W2 || j >= H2 ? 0 : i < 10 ? 2 : 1);
  // (one point of the base to one square of the mask, to keep the numbers plain)
  const inner = (k, i, j) => { for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (mask(i + a, j + b) !== 1) return false; return true; };
  const n = liftDryLand(u, W2, H2, inner);
  assert.equal(n, 100, 'the chott and nothing else');
  assert.equal(u[15 * W2 + 25], raw2(DRY_LAND)); assert.equal(u[15 * W2 + 5], raw2(-50), 'the sea');
  assert.equal(u[5 * W2 + 10], raw2(-2), 'on the shore the heights decide: a square of the mask beside it is water');
  assert.equal(u[2 * W2 + 20], raw2(20), 'land above the sea is not touched');
  // innerLandOf: from a mask by latitude and longitude
  const KMD = 111.195, COS = Math.cos(40 * Math.PI / 180), at = (lat, lon) => mask(Math.floor(lon * KMD * COS), Math.floor(lat * KMD));
  const llOf = (i, j) => [(j + .5) / KMD, (i + .5) / (KMD * COS)], f2 = innerLandOf(at, llOf, 1);
  assert.equal(f2(0, 25, 15), true); assert.equal(f2(0, 10, 15), false, 'the square beside the sea'); assert.equal(f2(0, 5, 15), false); assert.equal(f2(0, 11, 0), false, 'the edge of the mask is the world');
});
