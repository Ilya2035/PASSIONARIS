// Hazards module: baked catalogues, hazard levels, physics relations, loader.
//   tools/node/node.exe --test tests/hazards.test.mjs tests/hazards-scheduler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadHazards } from '../src/sim/hazards/loader.js';
import {
  mmiAllen2012, quakeIntensityAt, intensityToLevel, tsunamiLevelFromHeight, volcanoLevelAt, magnitudeFromIntensity,
  impactsPerYearAbove, simCellOf, simLat, simLon, distKm,
} from '../src/sim/hazards/physics.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'assets', 'hazards');
const data = await loadHazards({ dir: DIR });

const rowsOf = (j, name) => { const f = Object.fromEntries(j.fields.map((n, i) => [n, i])); return j.rows.map(r => new Proxy(r, { get: (o, k) => (k in f ? o[f[k]] : o[k]) })); };
const volcanoes = rowsOf(data.volcanoes);
const eruptions = rowsOf(data.eruptions);
const quakes = rowsOf(data.earthquakes);
const tsunamis = rowsOf(data.tsunamis);
const meteorites = rowsOf(data.meteorites);
const volcanoIdx = name => volcanoes.findIndex(v => v.nameEn === name);

test('catalogue counts are sane', () => {
  assert.ok(volcanoes.length >= 1000, `Holocene volcanoes: ${volcanoes.length}`);
  assert.ok(eruptions.length >= 5000, `eruptions: ${eruptions.length}`);
  const withVei = eruptions.filter(e => e.vei >= 0);
  assert.ok(withVei.length >= 4000, `eruptions with VEI: ${withVei.length}`);
  assert.ok(withVei.some(e => e.vei >= 7), 'at least one VEI 7');
  assert.ok(quakes.length >= 15000, `earthquakes: ${quakes.length}`);
  assert.ok(tsunamis.length >= 1500, `tsunamis: ${tsunamis.length}`);
  assert.ok(meteorites.filter(m => m.fall === 1).length >= 900, 'observed falls');
  for (const e of eruptions) assert.ok(e.y >= -4999 && e.y <= 2100);
  for (const q of quakes.slice(0, 2000)) assert.ok(Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180 && q.mag > 0);
});

test('hazards folder stays under 15 MB', () => {
  let total = 0;
  for (const f of fs.readdirSync(DIR)) total += fs.statSync(path.join(DIR, f)).size;
  assert.ok(total < 15e6, `size ${total}`);
});

test('Vesuvius AD 79 eruption on the GVP date (24 Oct 79), VEI 5', () => {
  const vi = volcanoIdx('Vesuvius');
  assert.ok(vi >= 0);
  assert.equal(volcanoes[vi].name, 'Везувий');
  const e = eruptions.find(r => r.v === vi && r.y === 79);
  assert.ok(e, 'eruption of 79 present');
  assert.deepEqual([e.m, e.d, e.vei], [10, 24, 5]);
});

test('Krakatau 1883 (paroxysm 27 Aug, VEI 6) and its tsunami', () => {
  const vi = volcanoIdx('Krakatau');
  const e = eruptions.find(r => r.v === vi && r.y === 1883);
  assert.ok(e);
  assert.equal(e.vei, 6);
  assert.deepEqual([e.cy, e.cm, e.cd], [1883, 8, 27]);
  const ts = tsunamis.find(t => t.y === 1883 && t.m === 8 && t.d === 27);
  assert.ok(ts && ts.maxH >= 30 && ts.level === 5, 'Krakatau tsunami');
});

test('Tambora 1815 (VEI 7, paroxysm 10 Apr 1815)', () => {
  const vi = volcanoIdx('Tambora');
  const e = eruptions.find(r => r.v === vi && r.vei === 7);
  assert.ok(e);
  assert.deepEqual([e.cy, e.cm, e.cd], [1815, 4, 10]);
});

test('Lisbon earthquake of 1 Nov 1755', () => {
  const q = quakes.find(r => r.y === 1755 && r.m === 11 && r.d === 1 && Math.abs(r.lat - 37) < 2 && Math.abs(r.lon + 10) < 2);
  assert.ok(q, 'present');
  assert.ok(q.mag >= 8, `M ${q.mag}`);
  assert.equal(q.level, 5);
  assert.match(data.earthquakes.places[q.place], /Лиссабон/);
  assert.ok(q.ts > 0, 'linked tsunami');
});

test('ancient and BC dates use astronomical years', () => {
  // NCEI: "2150 BC" Jordan -> astronomical -2149
  assert.ok(quakes.some(q => q.y === -2149), 'earliest NCEI earthquake at -2149');
  assert.ok(!quakes.some(q => q.y < -2149));
  // GVP Minoan eruption of Santorini "1610 BCE" -> -1609
  const vi = volcanoIdx('Santorini');
  assert.ok(eruptions.some(e => e.v === vi && e.y === -1609 && e.vei === 7));
});

test('meteorites: Tunguska 1908 airburst and Chelyabinsk 2013 fall', () => {
  const tg = meteorites.find(m => m.nameEn === 'Tunguska');
  assert.ok(tg && tg.fall === 2 && tg.y === 1908 && tg.m === 6 && tg.d === 30 && tg.level >= 4);
  const ch = meteorites.find(m => m.nameEn === 'Chelyabinsk');
  assert.ok(ch && ch.fall === 1 && ch.y === 2013 && ch.m === 2 && ch.d === 15);
  // finds carry mass >= 1 kg; all rows carry a year
  for (const m of meteorites) {
    assert.ok(Number.isInteger(m.y));
    if (m.fall === 0) assert.ok(m.massKg >= 1);
  }
});

// ------------------------------------------------------------------ levels
const lv = data.levels.layers;
function boxStats(layer, lat0, lat1, lon0, lon1, landOnly = true) {
  const vals = [];
  for (let lat = lat0; lat <= lat1; lat += 0.5) for (let lon = lon0; lon <= lon1; lon += 0.5) {
    const c = simCellOf(lat, lon);
    if (landOnly && lv.land[c] < 128) continue;
    vals.push(layer[c]);
  }
  vals.sort((a, b) => a - b);
  return { n: vals.length, max: vals[vals.length - 1], median: vals[vals.length >> 1] };
}

test('level grid layout', () => {
  assert.equal(data.levels.width, 720);
  assert.equal(data.levels.height, 360);
  for (const k of ['quake', 'tsunami', 'volcano', 'landslide', 'land', 'coast']) assert.equal(lv[k].length, 720 * 360, k);
  for (const k of ['quake', 'tsunami', 'volcano', 'landslide']) for (const v of lv[k]) assert.ok(v <= 5);
  // tsunami exposure only on coastal cells
  for (let i = 0; i < lv.tsunami.length; i++) if (lv.tsunami[i]) assert.equal(lv.coast[i], 1);
  assert.equal(simCellOf(simLat(10), simLon(20)), 10 * 720 + 20);
});

test('earthquake levels high in Japan, Chile, Indonesia', () => {
  const japan = boxStats(lv.quake, 33, 41, 131, 142);
  const chile = boxStats(lv.quake, -40, -20, -73, -69);
  for (const [name, s] of [['Japan', japan], ['Chile', chile]]) {
    assert.ok(s.n > 10 && s.median >= 4, `${name}: ${JSON.stringify(s)}`);
  }
  // Indonesia: the Sunda arc is high everywhere, the trench side very high (Borneo is genuinely quiet)
  const sunda = boxStats(lv.quake, -8.5, 4, 95, 115);
  assert.ok(sunda.median >= 3 && sunda.max >= 4, `Sunda arc: ${JSON.stringify(sunda)}`);
  const cities = { 'Banda Aceh': [5.55, 95.32], Padang: [-0.95, 100.35], Bengkulu: [-3.8, 102.27], Jakarta: [-6.2, 106.8],
    Yogyakarta: [-7.8, 110.37], Palu: [-0.9, 119.87], Ambon: [-3.7, 128.18] };
  for (const [name, [la, lo]] of Object.entries(cities)) assert.ok(lv.quake[simCellOf(la, lo)] >= 4, `${name}: ${lv.quake[simCellOf(la, lo)]}`);
});

test('earthquake levels ~0 in central Russia and the Australian interior', () => {
  // "~0": at most level 1 (intensity 2–4, felt only weakly, e.g. Vrancea quakes felt in Moscow)
  const russia = boxStats(lv.quake, 53, 60, 35, 50);
  const siberia = boxStats(lv.quake, 58, 64, 65, 80);
  for (const [name, s] of [['central Russia', russia], ['West Siberia', siberia]]) {
    assert.ok(s.n > 10 && s.max <= 1 && s.median <= 1, `${name}: ${JSON.stringify(s)}`);
  }
  // Australian interior: mostly 0–1; isolated intraplate M6 events (Tennant Creek 1988, Petermann 2016) stay local
  const australia = boxStats(lv.quake, -30, -20, 120, 142);
  assert.ok(australia.median <= 1, `Australian interior: ${JSON.stringify(australia)}`);
  const share = (() => { let n = 0, hi = 0; for (let la = -30; la <= -20; la += 0.5) for (let lo = 120; lo <= 142; lo += 0.5) { const c = simCellOf(la, lo); if (lv.land[c] < 128) continue; n++; if (lv.quake[c] >= 3) hi++; } return hi / n; })();
  assert.ok(share < 0.05, `share of level>=3 in the Australian interior ${share}`);
});

test('volcanic hazard: high around Japan/Indonesia volcanoes, zero in stable interiors', () => {
  assert.ok(lv.volcano[simCellOf(-7.54, 110.45)] >= 4, 'Merapi');
  assert.ok(lv.volcano[simCellOf(40.82, 14.43)] >= 4, 'Vesuvius');
  assert.ok(lv.volcano[simCellOf(35.36, 138.73)] >= 4, 'Fuji');
  assert.equal(boxStats(lv.volcano, 53, 60, 35, 50).max, 0);
  assert.equal(boxStats(lv.volcano, -31, -27, 130, 141).max, 0);
});

test('tsunami exposure on Pacific coasts, none inland', () => {
  assert.ok(boxStats(lv.tsunami, 35, 41, 139, 142.5, false).max >= 4, 'NE Japan coast');
  assert.ok(boxStats(lv.tsunami, -38, -33, -74, -71, false).max >= 4, 'central Chile coast');
  assert.equal(boxStats(lv.tsunami, 53, 60, 35, 50).max, 0, 'central Russia');
});

test('landslide susceptibility follows the mountains', () => {
  const himalaya = boxStats(lv.landslide, 27, 30, 83, 90);
  const plains = boxStats(lv.landslide, 50, 56, 30, 45);
  assert.ok(himalaya.max >= 4, JSON.stringify(himalaya));
  assert.ok(plains.max <= 1, JSON.stringify(plains));
});

// ------------------------------------------------------------------ physics
test('intensity prediction equation behaves', () => {
  for (const M of [5, 6, 7, 8]) {
    let prev = Infinity;
    for (const R of [5, 10, 30, 60, 100, 300, 1000]) { const I = mmiAllen2012(M, R); assert.ok(I < prev); prev = I; }
  }
  assert.ok(quakeIntensityAt(7, 20, 10) > quakeIntensityAt(6, 20, 10));
  assert.ok(Math.abs(mmiAllen2012(6, 10) - 7.25) < 0.1, 'AWW2012 reference value');
  assert.ok(magnitudeFromIntensity(8, 15) > 5.5 && magnitudeFromIntensity(12, 15) <= 7.5);
});

test('user scale boundaries', () => {
  assert.deepEqual([1.9, 2, 3.9, 4, 5.9, 6, 7.9, 8, 9.9, 10, 12].map(intensityToLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([0, 0.5, 1.5, 3, 6, 12, 40].map(tsunamiLevelFromHeight), [0, 1, 2, 3, 4, 5, 5]);
  assert.equal(volcanoLevelAt(10, 7), 5);
  assert.equal(volcanoLevelAt(2000, 7), 0);
  assert.ok(Math.abs(1 / impactsPerYearAbove(10000) - 1075) < 50, 'Tunguska-class interval ~1000 yr');
  assert.ok(Math.abs(distKm(0, 0, 0, 1) - 111.2) < 0.2);
});

test('loader works through fetch as in the browser (gzip decoded)', async () => {
  const fakeFetch = async url => {
    const f = path.join(DIR, String(url).replace(/^.*\//, ''));
    const buf = fs.readFileSync(f);
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  const d2 = await loadHazards({ base: 'assets/hazards/', fetch: fakeFetch });
  assert.equal(d2.volcanoes.rows.length, data.volcanoes.rows.length);
  assert.deepEqual(Array.from(d2.levels.layers.quake.subarray(0, 5000)), Array.from(lv.quake.subarray(0, 5000)));
});
