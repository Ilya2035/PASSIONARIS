// The mask of the worked land (src/album/worked.js, scripts/album/bake-worked.mjs): the regions the owner named on
// 15.11.2026 are in, their neighbours are the world, and the sea along the coast belongs to the worked land.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeWorked, WORLD, WORKED, WORKED_WATER } from '../src/album/worked.js';

const raw = gunzipSync(readFileSync(new URL('../public/assets/album/worked.bin.gz', import.meta.url)));
const m = decodeWorked(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
const is = (what, places) => { for (const [name, lat, lon] of places) assert.equal(m.at(lat, lon), what, name); };

test('worked land: the lattice covers the rectangle of the detailed heights, one byte a square kilometre', () => {
  assert.deepEqual([m.x0, m.y0, m.w, m.h], [-880, 3240, 1920, 2800]);
  assert.equal(m.data.length, 1920 * 2800);
  assert.ok(m.data.every(v => v <= 2));
  assert.equal(m.at(60, 10), WORLD, 'beyond the lattice');
});
test('worked land: Iberia, Western Europe up to the Rhine, the Maghreb down to the edge of the Sahara', () => {
  is(WORKED, [['Madrid', 40.42, -3.7], ['Evora', 38.57, -7.9], ['Palma', 39.6, 2.9], ['Andorra', 42.55, 1.55],
    ['Paris', 48.85, 2.35], ['Brest', 48.4, -4.45], ['Strasbourg', 48.58, 7.7], ['Jersey', 49.21, -2.13],
    ['Brussels', 50.85, 4.35], ['Amsterdam', 52.37, 4.9], ['Groningen', 53.2, 6.57], ['Luxembourg', 49.6, 6.13],
    ['Trier', 49.75, 6.64], ['Kaiserslautern', 49.44, 7.77], ['Alzey', 49.75, 8.12], ['Aachen', 50.78, 6.08], ['Kleve', 51.75, 6.1],
    ['Rabat', 34.0, -6.8], ['Marrakesh', 31.63, -8.0], ['Agadir plain', 30.4, -9.4], ['Algiers hills', 36.7, 3.0], ['Biskra', 34.85, 5.73],
    ['Tunis', 36.8, 10.1], ['Tataouine', 32.93, 10.45]]);
});
test('worked land: the neighbours are the world until their turn — and so is Corsica', () => {
  is(WORLD, [['London', 51.5, -0.12], ['Frankfurt', 50.11, 8.68], ['Heidelberg', 49.4, 8.69], ['Essen', 51.45, 7.01], ['Freiburg', 47.99, 7.85],
    ['Bern', 46.95, 7.45], ['Turin', 45.07, 7.68], ['Corte, Corsica', 42.3, 9.15], ['Cagliari', 39.25, 9.1],
    ['Ghardaia', 32.49, 3.67], ['Remada', 32.3, 10.4], ['Tan-Tan', 28.44, -11.1], ['Tripoli', 32.88, 13.19]]);
});
test('worked land: the sea within a hundred kilometres of its coast, up to the middle line with other land', () => {
  is(WORKED_WATER, [['Gulf of Lion', 42.8, 4.0], ['Strait of Gibraltar', 35.95, -5.5], ['off Calais', 51.03, 1.75], ['off Lisbon', 38.6, -9.8], ['off Algiers', 37.2, 3.0]]);
  is(WORLD, [['off Dover', 51.1, 1.45], ['mid Biscay', 45.3, -6.5], ['west of Sardinia', 39.8, 6.3], ['off Cornwall', 49.8, -5.5]]);
});
