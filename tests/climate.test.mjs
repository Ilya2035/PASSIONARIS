// Climate module: baked normals, samplers and biome map.
// Run: tools/node/node.exe --test tests/climate.test.mjs tests/climate-paleo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  loadNormals, loadLandFrac, cellAt, cellCenter, sampleMonthly, sampleMonthlyAt, sampleDay, fillDay,
  monthPhase, annual, MONTH_CENTRE, NORMALS_BYTES, W, H, N,
} from '../src/sim/climate/climatology.js';
import { BIOMES, BIOME, climateStats, classifyBiome } from '../src/sim/climate/biomes.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLIMATE = path.join(ROOT, 'public', 'assets', 'climate');
const nm = await loadNormals();
const T = (lat, lon, m) => sampleMonthly(nm, cellAt(lat, lon), m).tavg;
const P = (lat, lon, m) => sampleMonthly(nm, cellAt(lat, lon), m).prec;

// ------------------------------------------------------------------ normals: format
test('normals: array sizes and header', () => {
  assert.equal(nm.W, 720);
  assert.equal(nm.H, 360);
  assert.equal(N, 720 * 360);
  assert.ok(nm.tavg instanceof Int16Array);
  assert.ok(nm.prec instanceof Uint16Array);
  assert.ok(nm.elev instanceof Int16Array);
  assert.equal(nm.tavg.length, 12 * 360 * 720);
  assert.equal(nm.prec.length, 12 * 360 * 720);
  assert.equal(nm.elev.length, 360 * 720);
  const hdr = JSON.parse(fs.readFileSync(path.join(CLIMATE, 'normals.json'), 'utf8'));
  assert.equal(hdr.totalBytes, NORMALS_BYTES);
  assert.deepEqual(hdr.sections.map(s => s.name), ['tavg', 'prec', 'elev']);
  assert.deepEqual(hdr.sections.map(s => s.offset), [0, 12 * N * 2, 24 * N * 2]);
  assert.equal(hdr.grid.W, 720);
  assert.equal(hdr.grid.H, 360);
  // the weather module's parseNormals(buffer, header) reads header.offsets
  assert.deepEqual(hdr.offsets, { tavg: 0, prec: 12 * N * 2, elev: 24 * N * 2 });
  // reproducible bakes: no timestamps in the generated headers
  assert.equal(hdr.generated, undefined);
  const bj = JSON.parse(fs.readFileSync(path.join(CLIMATE, 'biomes.json'), 'utf8'));
  assert.equal(bj.generated, undefined);
});

test('normals: WorldClim zero-filled gaps are masked (no cell sits at 0.0 °C all year)', () => {
  let flat = 0;
  for (let i = 0; i < N; i++) {
    let z = true;
    for (let m = 0; m < 12 && z; m++) z = nm.tavg[m * N + i] === 0;
    if (z) flat++;
  }
  assert.equal(flat, 0, 'cells with tavg exactly 0 in all months');
  // their halo too: polar winters stay polar (before the fix: 0.0 °C on N Greenland / Ross Ice Shelf)
  for (let y = 0; y < 22; y++) for (let x = 0; x < W; x++) {
    if (nm.tavg[y * W + x] > -90) assert.fail(`January ${90 - (y + 0.5) * 0.5}N ${-180 + (x + 0.5) * 0.5}: ${nm.tavg[y * W + x] / 10}`);
  }
  for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) {
    const v = nm.tavg[6 * N + y * W + x];
    if (v > -150) assert.fail(`July ${90 - (y + 0.5) * 0.5}S ${-180 + (x + 0.5) * 0.5}: ${v / 10}`);
  }
  assert.ok(T(56.25, -79.25, 0) < -15, 'Belcher Islands / Hudson Bay in January');
});

test('ocean fill: frozen seas are continental in winter, the North Atlantic Current is mild', () => {
  assert.ok(T(60, -85, 0) < -20, `Hudson Bay Jan ${T(60, -85, 0)}`);
  assert.ok(T(55, 148, 0) < -10, `Sea of Okhotsk Jan ${T(55, 148, 0)}`);
  assert.ok(T(73, -140, 0) < -22, `Beaufort Sea Jan ${T(73, -140, 0)}`);
  assert.ok(T(76, 125, 0) < -25, `Laptev Sea Jan ${T(76, 125, 0)}`);
  assert.ok(T(52.5, -20, 0) > 6, `ocean weather ship J (52.5N 20W) Jan ${T(52.5, -20, 0)}`);
  assert.ok(T(45, -16, 0) > 9, `ocean weather ship K (45N 16W) Jan ${T(45, -16, 0)}`);
  assert.ok(T(-75, -175, 6) < -20, `Ross Sea July ${T(-75, -175, 6)}`);
});

test('ocean fill: no seam at the equator (hemispheric seasonal cycle blended smoothly)', () => {
  const meanStep = y => {
    let s = 0, n = 0;
    for (let m = 0; m < 12; m++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (nm.elev[i] !== 0 || nm.elev[i + W] !== 0) continue;
      s += Math.abs(nm.tavg[m * N + i + W] - nm.tavg[m * N + i]) / 10; n++;
    }
    return s / n;
  };
  const eq = meanStep(179), north = meanStep(174), south = meanStep(184);
  assert.ok(eq < 1.5 * Math.max(north, south), `row step across the equator ${eq} vs ${north} / ${south}`);
});

test('normals: loader accepts a path and raw bytes with identical results', async () => {
  const p = path.join(CLIMATE, 'normals.bin.gz');
  const a = await loadNormals(p);
  const b = await loadNormals(new Uint8Array(fs.readFileSync(p)));
  // browser-style: a fetch-like function (gzip decoded by DecompressionStream)
  let asked = null;
  const c = await loadNormals(async url => { asked = url; return new Response(fs.readFileSync(p)); });
  assert.equal(asked, 'assets/climate/normals.bin.gz');
  // a dev server that already decoded Content-Encoding: gzip hands over raw bytes
  const d = await loadNormals(new Uint8Array(zlib.gunzipSync(fs.readFileSync(p))));
  for (const k of ['tavg', 'prec', 'elev']) {
    assert.equal(a[k].length, nm[k].length);
    for (let i = 0; i < a[k].length; i += 997) {
      assert.equal(a[k][i], nm[k][i]);
      assert.equal(b[k][i], nm[k][i]);
      assert.equal(c[k][i], nm[k][i]);
      assert.equal(d[k][i], nm[k][i]);
    }
  }
  await assert.rejects(loadNormals(new Uint8Array(10)), /expected/);
});

test('normals: every cell has plausible values (ocean filled)', () => {
  for (let i = 0; i < 12 * N; i++) {
    const t = nm.tavg[i], p = nm.prec[i];
    if (t < -750 || t > 450) assert.fail(`tavg out of range at ${i}: ${t / 10}`);
    if (p > 2500) assert.fail(`prec out of range at ${i}: ${p}`);
  }
  for (let i = 0; i < N; i++) if (nm.elev[i] < -500 || nm.elev[i] > 7000) assert.fail(`elev out of range at ${i}`);
  // open ocean: sea level, plausible SST-like air temperatures
  assert.equal(nm.elev[cellAt(0, -150)], 0);
  const pac = T(0, -150, 0);
  assert.ok(pac > 24 && pac < 30, `equatorial Pacific ${pac}`);
  assert.ok(T(85, 0, 0) < -15, 'Arctic Ocean is far below freezing in January');
  assert.ok(T(-65, 0, 7) < -2, 'Southern Ocean below freezing in August');
  assert.ok(T(68, 2, 0) > -3, 'Norwegian Sea kept mild by the North Atlantic Drift');
});

// ------------------------------------------------------------------ normals: climate sanity
test('sanity: Sahara 23N 10E July mean > 28 °C', () => {
  const t = T(23, 10, 6);
  assert.ok(t > 28, `Sahara July ${t}`);
});

test('sanity: Yakutsk 62N 130E January mean < -30 °C', () => {
  const t = T(62, 130, 0);
  assert.ok(t < -30, `Yakutsk January ${t}`);
});

test('sanity: Amazon 3S 60W wet-season monthly precipitation > 150 mm', () => {
  let max = 0;
  for (let m = 0; m < 12; m++) max = Math.max(max, P(-3, -60, m));
  assert.ok(max > 150, `Amazon wettest month ${max}`);
});

test('sanity: Antarctic interior always < -20 °C', () => {
  for (const [name, la, lo] of [['Dome C', -75.1, 123.3], ['Vostok', -78.5, 106.8], ['South Pole', -89.9, 0], ['Dome A', -80.4, 77.1]]) {
    for (let m = 0; m < 12; m++) {
      const t = T(la, lo, m);
      assert.ok(t < -20, `${name} month ${m}: ${t}`);
    }
  }
  let n = 0;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 0.5;
    if (lat > -75) continue;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (nm.elev[i] < 2800) continue;
      n++;
      for (let m = 0; m < 12; m++) {
        if (nm.tavg[m * N + i] >= -200) assert.fail(`plateau cell ${lat} month ${m}: ${nm.tavg[m * N + i] / 10}`);
      }
    }
  }
  assert.ok(n > 1000, 'plateau cells found');
});

// ------------------------------------------------------------------ samplers
test('sampleDay: equals the monthly value at month centres and is continuous over the year', () => {
  const cells = [cellAt(55.75, 37.6), cellAt(62, 130), cellAt(-3, -60), cellAt(23, 10)];
  const o = {};
  for (const c of cells) {
    for (let m = 0; m < 12; m++) {
      sampleDay(nm, c, MONTH_CENTRE[m] + 1, o);
      assert.ok(Math.abs(o.tavg - nm.tavg[m * N + c] / 10) < 1e-6, 'tavg at centre');
      assert.ok(Math.abs(o.prec - nm.prec[m * N + c]) < 1e-6, 'prec at centre');
    }
    let prevT = null, prevP = null, maxDT = 0, maxDP = 0;
    for (let d = 1; d <= 366.25; d += 0.25) {
      sampleDay(nm, c, d, o);
      assert.ok(Number.isFinite(o.tavg) && o.prec >= 0 && o.precDay >= 0);
      if (prevT !== null) { maxDT = Math.max(maxDT, Math.abs(o.tavg - prevT)); maxDP = Math.max(maxDP, Math.abs(o.precDay - prevP)); }
      prevT = o.tavg; prevP = o.precDay;
    }
    assert.ok(maxDT < 0.5, `temperature step per 6 h ${maxDT}`);
    assert.ok(maxDP < 0.5, `precipitation step per 6 h ${maxDP}`);
    // the year wraps smoothly (Dec 31 -> Jan 1)
    const a = sampleDay(nm, c, 365.2425 + 0.999, {}).tavg, b = sampleDay(nm, c, 1, {}).tavg;
    assert.ok(Math.abs(a - b) < 0.05, 'wraps at new year');
  }
});

test('monthPhase / fillDay agree with sampleDay', () => {
  const ph = monthPhase(1);
  assert.equal(ph.m0, 11);
  assert.ok(ph.t > 0.4 && ph.t < 0.6);
  const tF = new Float32Array(N), pF = new Float32Array(N), o = {};
  for (const d of [1, 40.3, 200, 365]) {
    fillDay(nm, d, tF, pF);
    for (const c of [cellAt(55, 37), cellAt(-3, -60), cellAt(0, -150), cellAt(-80, 0)]) {
      sampleDay(nm, c, d, o);
      assert.ok(Math.abs(tF[c] - o.tavg) < 1e-3);
      assert.ok(Math.abs(pF[c] - o.precDay) < 1e-3);
    }
  }
});

test('grid helpers and bilinear sampling', () => {
  assert.equal(cellAt(89.9, -179.9), 0);
  assert.equal(cellAt(-89.9, 179.9), N - 1);
  assert.equal(cellAt(0, 180), cellAt(0, -180)); // lon wraps
  const cc = cellCenter(cellAt(10.1, 20.1));
  assert.ok(Math.abs(cc.lat - 10.25) < 1e-9 && Math.abs(cc.lon - 20.25) < 1e-9);
  const s = sampleMonthlyAt(nm, cc.lat, cc.lon, 3);
  assert.ok(Math.abs(s.tavg - T(10.1, 20.1, 3)) < 1e-6);
  const an = annual(nm, cellAt(55.75, 37.6));
  assert.ok(an.tavg > 2 && an.tavg < 8, `Moscow annual ${an.tavg}`);
  assert.ok(an.prec > 450 && an.prec < 900, `Moscow precip ${an.prec}`);
});

test('weather bridge: anomalyFn greens the Sahara and is neutral in 1985', async () => {
  const { makeAnomalyFn } = await import('../src/sim/climate/anomaly.js');
  const fn = makeAnomalyFn(nm);
  const old = fn(-4999, 20, 10);
  assert.ok(old.precipFactor > 5, `effective factor ${old.precipFactor}`);
  assert.ok(Number.isFinite(old.dT));
  const now = fn(1985, 20, 10, {});
  assert.ok(Math.abs(now.precipFactor - 1) < 0.05 && Math.abs(now.dT) < 0.1);
  let prev = fn(-4999, 18, 5).precipFactor;
  for (let y = -4998; y <= -2000; y++) {
    const v = fn(y, 18, 5).precipFactor;
    assert.ok(Math.abs(v - prev) < 0.2, `effective factor continuous at ${y}`);
    prev = v;
  }
});

test('landfrac: sizes and land/ocean contrast', async () => {
  const lf = await loadLandFrac();
  assert.equal(lf.land.length, N);
  assert.equal(lf.lake.length, N);
  assert.ok(lf.land[cellAt(23, 10)] > 250);
  assert.equal(lf.land[cellAt(0, -150)], 0);
  assert.ok(lf.lake[cellAt(-1, 33)] > 200, 'Lake Victoria');
});

// ------------------------------------------------------------------ biomes
const biome = zlib.gunzipSync(fs.readFileSync(path.join(CLIMATE, 'biome.bin.gz')));
const MW = 8192, MH = 4096;
const bAt = (lat, lon) => biome[Math.min(MH - 1, Math.floor((90 - lat) / 180 * MH)) * MW + Math.floor(((lon + 180) / 360 * MW) % MW)];

test('biome map: size, ids and table', () => {
  assert.equal(biome.length, MW * MH);
  const table = JSON.parse(fs.readFileSync(path.join(CLIMATE, 'biomes.json'), 'utf8'));
  assert.equal(table.classes.length, BIOMES.length);
  assert.equal(table.classes.length, 13);
  for (const c of table.classes) {
    assert.ok(c.key && c.nameRu && c.description && /^#[0-9a-f]{6}$/.test(c.color), `class ${c.id}`);
  }
  const seen = new Uint8Array(256);
  for (let i = 0; i < biome.length; i += 7) seen[biome[i]] = 1;
  for (let k = BIOMES.length; k < 256; k++) assert.equal(seen[k], 0, `unknown id ${k}`);
  for (let k = 0; k < BIOMES.length; k++) assert.equal(seen[k], 1, `class ${BIOMES[k].key} present`);
});

test('biome map: water exactly where the map has ocean / lakes', () => {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz')));
  const cells = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  for (let i = 0; i < cells.length; i += 101) {
    const water = cells[i] < 2;
    if (water !== (biome[i] === BIOME.WATER)) assert.fail(`mask mismatch at ${i}`);
  }
});

test('biome spot checks', () => {
  assert.equal(bAt(23, 10), BIOME.DESERT, 'Sahara');
  assert.equal(bAt(25, 25), BIOME.DESERT, 'Libyan desert');
  assert.equal(bAt(-3, -60), BIOME.TROPICAL_FOREST, 'Amazon');
  assert.equal(bAt(0, 22), BIOME.TROPICAL_FOREST, 'Congo');
  assert.equal(bAt(62, 125), BIOME.TAIGA, 'Yakutia');
  assert.equal(bAt(60, 100), BIOME.TAIGA, 'central Siberia');
  assert.equal(bAt(72, -40), BIOME.ICE, 'Greenland ice sheet');
  assert.equal(bAt(-80, 30), BIOME.ICE, 'Antarctica');
  assert.equal(bAt(0, -150), BIOME.WATER, 'Pacific');
  assert.equal(bAt(33, 88), BIOME.HIGHLAND, 'Tibet');
  assert.equal(bAt(50, 70), BIOME.STEPPE, 'Kazakh steppe');
  assert.equal(bAt(-2.5, 35), BIOME.SAVANNA, 'Serengeti');
  assert.equal(bAt(41.9, 12.5), BIOME.MEDITERRANEAN, 'Rome');
  assert.equal(bAt(72, 80), BIOME.TUNDRA, 'Yamal / Gydan tundra');
});

// majority class in a 5x5-pixel (~25 km) window, robust to single-pixel speckle
const bMaj = (lat, lon) => {
  const c = new Uint32Array(BIOMES.length);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) c[bAt(lat + dy * 180 / MH, lon + dx * 360 / MW)]++;
  let b = 0;
  for (let k = 1; k < c.length; k++) if (c[k] > c[b]) b = k;
  return b;
};

test('biome spot checks: Arctic tree line and boreal interiors', () => {
  // warmest month 11–12 °C but too little summer heat for trees (GDD5 < 400)
  assert.equal(bMaj(64.3, -96.1), BIOME.TUNDRA, 'Baker Lake (Kivalliq)');
  assert.equal(bMaj(72, 100), BIOME.TUNDRA, 'Taimyr');
  assert.equal(bMaj(66, 175), BIOME.TUNDRA, 'Chukotka');
  assert.equal(bMaj(69.5, -152), BIOME.TUNDRA, 'Alaskan North Slope');
  // forest-tundra / boreal forest stays forest
  assert.equal(bMaj(64.84, -147.7), BIOME.TAIGA, 'Fairbanks');
  assert.equal(bMaj(68.4, -133.7), BIOME.TAIGA, 'Inuvik');
  assert.equal(bMaj(67.5, 64), BIOME.TAIGA, 'Vorkuta (forest-tundra)');
  // dry but cold interior Alaska is boreal forest, not steppe
  assert.equal(bMaj(66.6, -145.3), BIOME.TAIGA, 'Yukon Flats');
  // ice-free coastal valleys keep their own (low) height: forest, not tundra
  assert.equal(bMaj(61.13, -146.35), BIOME.TAIGA, 'Valdez');
  assert.equal(bMaj(61.9, 6.72), BIOME.TAIGA, 'Stryn (Nordfjord)');
  assert.equal(bMaj(60.38, 6.15), BIOME.TEMPERATE_FOREST, 'Kvam (Hardangerfjord)');
});

test('classifier on synthetic climates', () => {
  const run = (t, p, lat, h = 100) => classifyBiome(climateStats(t, p, lat, {}), h);
  const fill = v => new Array(12).fill(v);
  assert.equal(run(fill(-20), fill(10), 75), BIOME.ICE);
  assert.equal(run(fill(27), fill(250), 0), BIOME.TROPICAL_FOREST);
  assert.equal(run(fill(28), fill(2), 23), BIOME.DESERT);
  const tundraT = [-30, -28, -25, -15, -5, 3, 7, 5, 0, -10, -20, -27];
  assert.equal(run(tundraT, fill(20), 70), BIOME.TUNDRA);
  assert.equal(run(tundraT, fill(20), 40, 3500), BIOME.HIGHLAND);
  const medT = [10, 11, 13, 15, 19, 23, 26, 26, 23, 19, 15, 11], medP = [90, 80, 70, 50, 30, 10, 5, 10, 40, 90, 110, 100];
  assert.equal(run(medT, medP, 38), BIOME.MEDITERRANEAN);
  // tree line by GDD5: July 11.5 °C but a short summer -> tundra; a longer one -> taiga
  const shortSummer = [-32, -31, -27, -18, -7, 3, 11.5, 9, 1, -10, -22, -29];
  assert.equal(run(shortSummer, fill(20), 64), BIOME.TUNDRA);
  const longerSummer = [-28, -26, -20, -9, 1, 9, 14, 11, 5, -4, -18, -25];
  assert.equal(run(longerSummer, fill(30), 64), BIOME.TAIGA);
  // cold and dry (aridity ratio 1..1.5) with GDD5 < 800 -> taiga, not steppe
  const coldDry = [-23, -20, -13, -2, 5, 12, 14, 11, 4, -4, -16, -22];
  const coldDryP = [9, 8, 7, 7, 15, 30, 45, 40, 22, 15, 12, 10];
  const s = climateStats(coldDry, coldDryP, 66, {});
  assert.ok(s.aridity >= 1 && s.aridity < 1.5 && s.gdd5 < 800, `synthetic Yukon Flats ${s.aridity} ${s.gdd5}`);
  assert.equal(classifyBiome(s, 150), BIOME.TAIGA);
});
