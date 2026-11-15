// Borders by chunks (division/edges.js): what runs along every chunk of 1 km² — a border, fields, a settlement — as
// the ground shader reads it from the texture of the division (gpu.js, g); the knob that shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkEdges, edgeOf, EDGE } from '../src/album/division/edges.js';
import { packDivision } from '../src/album/division/gpu.js';
import { KN as FN, KNY as FNY } from '../src/album/division/km.js';
import { DEFS } from '../src/album/params.js';

const LAND = 0, SEA = 1;
// three districts of land side by side and a sea below them
function world() {
  const cells = new Int32Array(FN * FNY).fill(-1), at = (x, y) => y * FN + x;
  for (let y = 10; y < 20; y++) for (let x = 10; x < 40; x++) cells[at(x, y)] = x < 20 ? 0 : x < 30 ? 1 : 2;
  for (let y = 20; y < 24; y++) for (let x = 10; x < 40; x++) cells[at(x, y)] = 3;
  return { div: { cells, kinds: [LAND, LAND, LAND, SEA], count: 4 }, at };
}

test('borders by chunks: the chunks along a border, and only those', () => {
  const { div, at } = world(), e = chunkEdges(div);
  assert.ok(edgeOf(e[at(19, 15)]).border && edgeOf(e[at(20, 15)]).border, 'both sides of the border of 0 and 1');
  assert.ok(edgeOf(e[at(20, 10)]).border, 'a corner of three districts');
  assert.ok(!edgeOf(e[at(15, 15)]).border && !edgeOf(e[at(18, 15)]).border, 'inside a district: no');
  assert.ok(!edgeOf(e[at(15, 19)]).border, 'the coast is no border: land next to the sea');
  assert.ok(!edgeOf(e[at(15, 20)]).border, '… nor the sea next to the land');
  assert.ok(edgeOf(e[at(21, 15)]).border === false, 'two chunks off the border: no');
});

test('borders by chunks: the settlement on a chunk and its fields', () => {
  const { div, at } = world(), farm = new Uint8Array(FN * FNY); farm[at(12, 12)] = 40;
  const owner = new Map([[at(15, 15), 7], [at(16, 15), 7], [at(17, 15), 8], [at(11, 11), 4095 + 7]]);
  const e = chunkEdges(div, c => owner.get(c), farm);
  assert.equal(edgeOf(e[at(15, 15)]).town, edgeOf(e[at(16, 15)]).town, 'one settlement, one number');
  assert.notEqual(edgeOf(e[at(16, 15)]).town, edgeOf(e[at(17, 15)]).town, 'neighbours are told apart');
  assert.ok(edgeOf(e[at(15, 15)]).town > 0 && edgeOf(e[at(14, 15)]).town === 0, 'no settlement: 0');
  assert.ok(edgeOf(e[at(12, 12)]).fields && !edgeOf(e[at(13, 12)]).fields, 'under fields');
  assert.ok(edgeOf(e[at(11, 11)]).town > 0, 'a number past the modulus is still a settlement');
});

test('borders by chunks: into the texture without touching the other bits of the chunk', () => {
  const { div, at } = world(), owner = new Map([[at(19, 15), 3]]), e = chunkEdges(div, c => owner.get(c));
  const facts = { cls: new Uint8Array(FN * FNY).fill(2) }, why = new Uint8Array(FN * FNY); why[at(19, 15)] = 5;
  const full = { ...div, province: [0, 0, 0, 1], region: [0, 1], colour: { district: [0, 1, 2, 3], province: [0, 1], region: [0, 1] }, chunks: [[at(10, 10)], [at(20, 10)], [at(30, 10)], [at(10, 20)]], cx: [0, 0, 0, 0], cy: [3000, 3000, 3000, 3000] };
  const ch = { count: 0 }, a = packDivision(ch, full, null, facts, null, {}, why, e), g = a[at(19, 15) * 4 + 1];
  assert.equal(g & 7, 2, 'the class of the ground is kept');
  assert.equal((g >> 16) & 7, 5, 'why nobody can settle is kept');
  assert.ok(g & EDGE.border, 'on the border');
  assert.equal(g >>> EDGE.town, 4, 'the settlement');
});

test('borders by chunks: a switch on the map panel', () => {
  const knob = DEFS.find(k => k.key === 'kmEdges');
  assert.equal(knob?.map, 'Границы по чанкам');
  assert.equal(knob?.uniform, 'uDivEdges');
});
