// Land fertility (src/sim/climate/fertility.js) and the fresh-water raster (src/sim/climate/waters.js).
// Run: tools/node/node.exe --test tests/fertility.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fertilityStats, fertility, fertTier, fertRamp, waterFactor, FERT_TIERS, FERT_STOPS, FERT_GLSL, FERT_RAMP_GLSL,
} from '../src/sim/climate/fertility.js';
import { buildWaterRaster, waterAt, riverWeight, LAKE_W, COAST_W } from '../src/sim/climate/waters.js';

const C = {
  Cairo: { lat: 30.1, T: [14.0, 15.3, 17.6, 21.3, 24.8, 27.2, 28.1, 28.0, 26.3, 23.6, 19.2, 15.4], P: [5, 4, 4, 1, 1, 0, 0, 0, 0, 1, 3, 5] },
  Paris: { lat: 48.8, T: [5.0, 5.6, 8.8, 11.6, 15.3, 18.6, 20.6, 20.4, 16.9, 13.0, 8.4, 5.5], P: [50, 41, 46, 47, 63, 52, 59, 50, 47, 60, 52, 58] },
  Kyiv: { lat: 50.4, T: [-3.5, -2.8, 2.0, 9.3, 15.5, 19.0, 20.8, 20.1, 14.7, 8.6, 2.6, -1.8], P: [38, 37, 36, 46, 56, 70, 76, 60, 51, 41, 46, 45] },
  Moscow: { lat: 55.8, T: [-6.5, -6.7, -1.0, 6.7, 13.2, 17.0, 19.2, 17.0, 11.3, 5.6, -0.5, -4.7], P: [52, 41, 35, 37, 49, 80, 85, 82, 68, 71, 55, 52] },
  Yakutsk: { lat: 62.0, T: [-38.6, -33.8, -20.1, -4.8, 7.5, 16.4, 19.5, 15.2, 6.1, -7.8, -27.0, -37.6], P: [10, 8, 6, 9, 22, 38, 47, 39, 27, 19, 15, 11] },
  Singapore: { lat: 1.4, T: [26.5, 27.1, 27.5, 28.0, 28.3, 28.3, 27.9, 27.9, 27.6, 27.6, 27.0, 26.4], P: [222, 105, 154, 166, 171, 132, 159, 176, 169, 194, 256, 288] },
  Sahara: { lat: 22, T: [14.7, 17, 21, 25.5, 29.5, 32.5, 33.8, 33, 30.5, 26, 20, 15.5], P: [0.5, 0.5, 0.5, 0.5, 1, 1, 2, 3, 1, 0.5, 0.5, 0.5] },
  Utqiagvik: { lat: 71.3, T: [-25.6, -27.0, -25.6, -17.7, -6.2, 1.5, 4.7, 3.4, -0.4, -9.0, -17.3, -23.4], P: [4, 4, 3, 4, 4, 9, 24, 25, 16, 11, 5, 4] },
};
const S = Object.fromEntries(Object.entries(C).map(([k, c]) => [k, fertilityStats(c.T, c.P, c.lat, {})]));
const F = (k, ...a) => fertility(S[k], ...a);

test('fertility: climate statistics', () => {
  assert.ok(S.Paris.gdd5 > 2000 && S.Paris.gdd5 < 3000, `Paris GDD5 ${S.Paris.gdd5}`);
  assert.ok(S.Sahara.water < 0.02 && S.Cairo.water < 0.05);
  assert.ok(S.Paris.water > 0.9);
  assert.ok(S.Utqiagvik.gdd5 < 100);
  assert.ok(S.Singapore.soil < 0.7, 'ever-wet tropics: leached soils');
  assert.ok(S.Yakutsk.soil < 0.75, 'permafrost');
  assert.equal(waterFactor(0), 0);
  assert.ok(waterFactor(1) > 0.99 && waterFactor(5) < 0.75);
});

test('fertility: ordering of places', () => {
  const nile = F('Cairo', 0, 0, 20, 1);   // the same desert climate with the river at hand
  const paris = F('Paris'), kyiv = F('Kyiv'), moscow = F('Moscow'), yakutsk = F('Yakutsk'), sing = F('Singapore');
  const sahara = F('Sahara'), cairoDry = F('Cairo'), tundra = F('Utqiagvik');
  assert.ok(nile > 0.85, `Nile ${nile}`);
  assert.ok(nile >= paris && paris > moscow && moscow > yakutsk && yakutsk > sahara, `${nile} ${paris} ${moscow} ${yakutsk} ${sahara}`);
  assert.ok(kyiv > moscow, 'the black-earth steppe beats the forest north');
  assert.ok(paris > sing, 'the rainforest is harder than a temperate plain');
  assert.ok(sahara < 0.02 && cairoDry < 0.03 && tundra < 0.02);
  assert.equal(fertTier(nile).nameRu, 'богатейшие');
  assert.equal(fertTier(sahara).nameRu, 'бесплодные');
});

test('fertility: terrain and height hold the land back', () => {
  const flat = F('Paris'), steep = F('Paris', 0, 0.5), hills = F('Paris', 0, 0.15), high = F('Paris', -6.5, 0, 1000 + 59);
  assert.ok(steep < hills && hills < flat, `${steep} ${hills} ${flat}`);
  assert.ok(steep < 0.3 * flat);
  assert.ok(high < flat * 0.7, `1 km higher ${high} vs ${flat}`);
  // the info window's factor breakdown
  const o = {};
  F('Sahara', 0, 0, 0, 0, o);
  assert.ok(o.water < o.heat && o.f === 0 || o.f < 0.02);
});

test('fertility: tiers and ramp', () => {
  let prev = -Infinity;
  for (const t of FERT_TIERS) { assert.ok(t.max > prev); prev = t.max; }
  assert.deepEqual(fertRamp(0), FERT_STOPS[0][1]);
  assert.ok(fertRamp(1).every((v, i) => Math.abs(v - FERT_STOPS.at(-1)[1][i]) < 1e-9));
  // the GLSL ramp is generated from the same stops; the fertility function mirrors fertility()
  assert.equal((FERT_RAMP_GLSL.match(/smoothstep/g) || []).length, FERT_STOPS.length - 1);
  assert.match(FERT_GLSL, /float fertilityAt\(vec4 c, vec4 d, float dT, float slope, float h, float irrig\)/);
});

test('waters: rivers on the raster', () => {
  // a big river from 0E to 40E along 10N
  const rivers = new Float32Array([0, 10, 20, 10, 20, 10, 40, 10]), ranks = new Uint8Array([1, 1]);
  const r = buildWaterRaster({ rivers, ranks, cells: null, outW: 256, outH: 128 });
  const at = (la, lo) => waterAt(r, la, lo, 256, 128);
  assert.ok(at(10, 20) > 0.85, `on the river ${at(10, 20)}`);
  assert.ok(at(10, 20) > at(13, 20) && at(13, 20) > at(18, 20), 'falls off with distance');
  assert.ok(at(40, 100) < 0.01, 'far from any water');
  assert.equal(riverWeight(0), 1);
  assert.ok(riverWeight(10) >= 0.25 && riverWeight(10) < riverWeight(4));
});

test('waters: lakes and sea coasts', () => {
  // a 128x64 map: ocean west of column 29 (99W), a lake block at 45..67.5E, 22.5..45S, land elsewhere
  const W = 128, H = 64, cells = new Uint32Array(W * H).fill(5);
  for (let y = 0; y < H; y++) for (let x = 0; x < 29; x++) cells[y * W + x] = 0;
  for (let y = 40; y < 48; y++) for (let x = 80; x < 88; x++) cells[y * W + x] = 1;
  const r = buildWaterRaster({ rivers: null, ranks: null, cells, W, H, outW: 64, outH: 32 });
  const at = (la, lo) => waterAt(r, la, lo, 64, 32);
  assert.ok(at(-33.75, 56.25) > LAKE_W - 0.1, `lake ${at(-33.75, 56.25)}`);
  const coast = at(0, -98.4);
  assert.ok(coast > 0.05 && coast < COAST_W + 0.08, `coast ${coast}`);
  assert.ok(at(0, 0) < 0.02, 'inland, far from the sea and the lake');
});
