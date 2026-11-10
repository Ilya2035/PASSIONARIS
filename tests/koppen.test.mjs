// Köppen–Geiger classes (src/sim/climate/koppen.js) and the era climate grid (src/sim/climate/era.js).
// Run: tools/node/node.exe --test tests/koppen.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOPPEN, KOPPEN_ID, KOPPEN_GROUPS, koppenStats, classifyStats, classifyKoppen, koppenCode, lapseDT, KOPPEN_GLSL, KOPPEN_COLORS_GLSL,
} from '../src/sim/climate/koppen.js';
import { createEraClimate, toHalf, fromHalf, LAYERS, N } from '../src/sim/climate/era.js';
import { loadNormals } from '../src/sim/climate/climatology.js';
import * as paleo from '../src/sim/climate/paleo.js';

// Station normals (monthly mean °C, monthly precipitation mm), January first.
const STATIONS = {
  Paris: { lat: 48.8, code: 'Cfb', T: [5.0, 5.6, 8.8, 11.6, 15.3, 18.6, 20.6, 20.4, 16.9, 13.0, 8.4, 5.5], P: [50, 41, 46, 47, 63, 52, 59, 50, 47, 60, 52, 58] },
  Cairo: { lat: 30.1, code: 'BWh', T: [14.0, 15.3, 17.6, 21.3, 24.8, 27.2, 28.1, 28.0, 26.3, 23.6, 19.2, 15.4], P: [5, 4, 4, 1, 1, 0, 0, 0, 0, 1, 3, 5] },
  Moscow: { lat: 55.8, code: 'Dfb', T: [-6.5, -6.7, -1.0, 6.7, 13.2, 17.0, 19.2, 17.0, 11.3, 5.6, -0.5, -4.7], P: [52, 41, 35, 37, 49, 80, 85, 82, 68, 71, 55, 52] },
  Singapore: { lat: 1.4, code: 'Af', T: [26.5, 27.1, 27.5, 28.0, 28.3, 28.3, 27.9, 27.9, 27.6, 27.6, 27.0, 26.4], P: [222, 105, 154, 166, 171, 132, 159, 176, 169, 194, 256, 288] },
  Yakutsk: { lat: 62.0, code: 'Dfd', T: [-38.6, -33.8, -20.1, -4.8, 7.5, 16.4, 19.5, 15.2, 6.1, -7.8, -27.0, -37.6], P: [10, 8, 6, 9, 22, 38, 47, 39, 27, 19, 15, 11] },
  Rome: { lat: 41.9, code: 'Csa', T: [7.5, 8.2, 10.2, 12.6, 17.2, 21.1, 24.1, 24.5, 20.8, 16.4, 11.4, 8.4], P: [67, 73, 58, 81, 53, 34, 19, 37, 73, 113, 115, 81] },
  Seattle: { lat: 47.6, code: 'Csb', T: [5.3, 6.1, 7.7, 10.0, 13.3, 16.0, 19.1, 19.4, 16.6, 11.8, 7.7, 5.0], P: [142, 89, 95, 70, 52, 40, 16, 23, 38, 89, 165, 141] },
  Beijing: { lat: 39.9, code: 'Dwa', T: [-3.1, 0.3, 6.7, 14.8, 20.8, 24.9, 26.7, 25.5, 20.8, 13.7, 5.0, -0.9], P: [3, 6, 9, 26, 29, 71, 176, 182, 49, 19, 6, 2] },
  HongKong: { lat: 22.3, code: 'Cwa', T: [16.3, 17.0, 19.2, 22.7, 26.0, 28.0, 28.7, 28.4, 27.6, 25.3, 21.6, 17.9], P: [33, 45, 75, 156, 289, 465, 377, 432, 327, 67, 34, 30] },
  Phoenix: { lat: 33.4, code: 'BWh', T: [12.8, 14.6, 17.6, 21.6, 26.6, 31.8, 34.6, 33.9, 31.0, 24.6, 17.3, 12.3], P: [23, 23, 25, 7, 3, 1, 26, 26, 17, 15, 17, 22] },
  Denver: { lat: 39.7, code: 'BSk', T: [-0.6, 0.4, 4.6, 8.7, 14.1, 19.8, 23.6, 22.3, 17.4, 10.6, 3.9, -0.9], P: [10, 14, 25, 45, 58, 47, 54, 49, 32, 25, 18, 13] },
  Utqiagvik: { lat: 71.3, code: 'ET', T: [-25.6, -27.0, -25.6, -17.7, -6.2, 1.5, 4.7, 3.4, -0.4, -9.0, -17.3, -23.4], P: [4, 4, 3, 4, 4, 9, 24, 25, 16, 11, 5, 4] },
  SouthPole: { lat: -90, code: 'EF', T: [-27.5, -40.1, -53.6, -57.8, -57.3, -57.6, -59.4, -59.6, -58.8, -51.0, -38.4, -27.8], P: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  Sydney: { lat: -33.9, code: 'Cfa', T: [23.5, 23.4, 22.1, 19.5, 16.6, 14.2, 13.4, 14.5, 17.0, 19.0, 20.4, 22.1], P: [91, 131, 117, 115, 98, 135, 70, 77, 64, 70, 84, 77] },
};

test('koppen: table — 30 classes, codes, groups, colours', () => {
  assert.equal(KOPPEN.length, 31);
  assert.equal(new Set(KOPPEN.slice(1).map(k => k.code)).size, 30);
  for (const k of KOPPEN.slice(1)) {
    assert.equal(k.group, k.code[0]);
    assert.ok(KOPPEN_GROUPS.some(g => g.key === k.group));
    assert.ok(k.nameRu && k.color.every(v => v >= 0 && v <= 1));
    assert.equal(KOPPEN_ID[k.code], k.id);
  }
  // the GLSL palette carries every class colour, in id order
  assert.equal((KOPPEN_COLORS_GLSL.match(/vec3\(/g) || []).length, 31);
  assert.match(KOPPEN_GLSL, /int koppenClass\(vec4 a, vec4 b, vec4 c, float dT\)/);
  assert.match(KOPPEN_GLSL, /float climLapse\(/);
});

test('koppen: known stations', () => {
  for (const [name, s] of Object.entries(STATIONS)) {
    assert.equal(koppenCode(classifyKoppen(s.T, s.P, s.lat)), s.code, name);
  }
});

test('koppen: classifyStats with an offset equals classifying the shifted months', () => {
  let seed = 7;
  const R = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let same = 0, n = 0;
  const T = new Float64Array(12), P = new Float64Array(12), T2 = new Float64Array(12), st = {};
  for (let i = 0; i < 4000; i++) {
    const mean = -30 + R() * 60, amp = R() * 25, wet = R() * 300, season = R() * 2 - 1, lat = R() < 0.5 ? 40 : -40;
    for (let m = 0; m < 12; m++) {
      const c = Math.cos(2 * Math.PI * (m - 6.5) / 12) * (lat > 0 ? 1 : -1);
      T[m] = mean + amp * c;
      P[m] = Math.max(0, wet * (1 + season * c) * (0.6 + 0.8 * R()));
    }
    const d = R() * 16 - 8;
    for (let m = 0; m < 12; m++) T2[m] = T[m] + d;
    koppenStats(T, P, lat, st);
    n++;
    if (classifyStats(st, d) === classifyKoppen(T2, P, lat)) same++;
  }
  assert.ok(same / n > 0.998, `${same} / ${n}`);
});

test('koppen: a cooler place (height) moves up the classes', () => {
  const s = koppenStats(STATIONS.Paris.T, STATIONS.Paris.P, 48.8, {});
  assert.equal(koppenCode(classifyStats(s, 0)), 'Cfb');
  assert.equal(koppenCode(classifyStats(s, -5)), 'Dfb');   // ~800 m higher: frost in winter
  assert.equal(koppenCode(classifyStats(s, -7)), 'Dfc');   // ~1100 m: fewer than 4 months above 10 °C
  assert.equal(koppenCode(classifyStats(s, -12)), 'ET');   // the snow line
  assert.equal(koppenCode(classifyStats(s, -25)), 'EF');
  // lapse rate: 1000 m above the cell = −6.5 °C; the ice-sheet rule keeps the climate's own height over glacial cells
  assert.ok(Math.abs(lapseDT(1100, 100, 20, 45) + 6.5) < 1e-9);
  assert.ok(Math.abs(lapseDT(-20, 3000, -10, 72)) < 1e-9);   // Greenland bedrock under 3 km of ice
  assert.ok(lapseDT(50, 900, 14, 62) > 5);                    // an ice-free valley below its cell's mean height
});

test('era: half floats round trip', () => {
  for (const v of [0, 1, -1, 0.5, 18, -38, 22.37, 650.5, -4999, 9876, 0.001]) {
    const r = fromHalf(toHalf(v));
    assert.ok(Math.abs(r - v) <= Math.max(1e-3, Math.abs(v) * 1e-3), `${v} → ${r}`);
  }
});

// ---- the era grid from the real normals + paleoclimate
const nm = await loadNormals();
const era = createEraClimate({ normals: nm, paleo });
const st = {};
const classAt = (la, lo) => koppenCode(classifyStats(era.statsAt(la, lo, st), 0));
function landHistogram() {
  const h = new Array(31).fill(0);
  for (let y = 0; y < 360; y++) for (let x = 0; x < 720; x++) {
    if (nm.elev[y * 720 + x] <= 0) continue;
    h[classifyStats(era.statsAt(90 - (y + 0.5) * 0.5, -180 + (x + 0.5) * 0.5, st), 0)]++;
  }
  return h;
}

test('era: today (1995) — cities on the 0.5° grid', () => {
  assert.equal(era.ready, false);
  era.request(1995);
  assert.equal(era.busy, true);
  assert.equal(era.work(0), false);   // a zero budget still makes one step, but cannot finish
  era.work();
  assert.equal(era.ready, true);
  assert.equal(era.year, 1995);
  assert.equal(era.version, 1);
  assert.equal(era.data.length, LAYERS * N * 4);
  const want = { 'Paris': [48.85, 2.35, 'Cfb'], Cairo: [30.05, 31.25, 'BWh'], Moscow: [55.75, 37.6, 'Dfb'], Singapore: [1.35, 103.8, 'Af'],
    Yakutsk: [62.03, 129.7, 'Dfd'], Rome: [41.9, 12.5, 'Csa'], Seattle: [47.6, -122.3, 'Csb'], Beijing: [39.9, 116.4, 'Dwa'], Chicago: [41.9, -87.6, 'Dfa'] };
  for (const [name, [la, lo, code]] of Object.entries(want)) assert.equal(classAt(la, lo), code, name);
  // Greenland's ice sheet and the Tibetan plateau
  assert.equal(classAt(72, -40), 'EF');
  assert.equal(classAt(33, 88), 'ET');
  // a repeated request is a no-op
  era.request(1995);
  assert.equal(era.busy, false);
});

test('era: 5000 BC — the green Sahara, and the Little Ice Age', () => {
  const h1995 = landHistogram();
  era.request(-4995); era.work();
  assert.equal(era.year, -4995);
  const hBC = landHistogram();
  // the African Humid Period: the Sahel is a savanna, the southern Sahara a steppe, far less hot desert
  assert.equal(classAt(14, 0), 'Aw');
  assert.match(classAt(20, 25), /^BS/);
  assert.ok(hBC[KOPPEN_ID.BWh] < h1995[KOPPEN_ID.BWh] * 0.75, `BWh ${hBC[KOPPEN_ID.BWh]} vs ${h1995[KOPPEN_ID.BWh]}`);
  assert.ok(hBC[KOPPEN_ID.Aw] > h1995[KOPPEN_ID.Aw]);
  // 1650: colder — more tundra, less temperate (Paris stays Cfb, London's summers shorter)
  era.request(1645); era.work();
  const h1645 = landHistogram();
  assert.ok(h1645[KOPPEN_ID.ET] > h1995[KOPPEN_ID.ET] * 1.1, `ET ${h1645[KOPPEN_ID.ET]} vs ${h1995[KOPPEN_ID.ET]}`);
  assert.ok(h1645[KOPPEN_ID.Cfa] + h1645[KOPPEN_ID.Dfa] < h1995[KOPPEN_ID.Cfa] + h1995[KOPPEN_ID.Dfa]);
  assert.equal(classAt(48.85, 2.35), 'Cfb');
});

test('era: a cut-off job back to the built era rebuilds it (no mixed rows)', () => {
  era.request(-2005); era.work();
  const v = era.version;
  era.request(1995);
  for (let i = 0; i < 40; i++) era.work(0);   // 24 month steps, then part of the rows of 1995 rewritten
  era.request(-2005);                          // back to the built era while 1995 is half done
  assert.equal(era.busy, true);
  era.work();
  assert.equal(era.year, -2005);
  assert.ok(era.version > v);
  // the monthly paleo dT rides in layer 3 .w
  const dT = new Float32Array(N).fill(1.5);
  const mv = era.monthVersion;
  era.setMonthDT(dT);
  assert.equal(era.monthVersion, mv + 1);
  assert.ok(Math.abs(era.statsAt(10, 10, {}).monthDT - 1.5) < 1e-3);
});
