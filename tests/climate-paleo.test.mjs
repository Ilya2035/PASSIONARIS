// Paleoclimate model: shape, continuity, determinism.
// Run: tools/node/node.exe --test tests/climate.test.mjs tests/climate-paleo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  globalDT, globalDTPreindustrial, regionalDT, precipFactor, precipAddMm, adjustPrecip, seaLevel,
  relativeSeaLevel, seaIceExtent, seaIceEdgeLat, humidPeriodStrength, fillRegionalDT, fillPrecip,
  polarAmplification, monotoneCubic, BASELINE_1970_2000, YEAR_MIN, YEAR_MAX,
} from '../src/sim/climate/paleo.js';

const PLACES = [[23, 10], [16, 0], [62, 130], [80, 0], [50, 10], [-3, -60], [-75, 120], [37, -110], [18.5, -89.5], [33, 45], [0, -150]];

function maxStep(f, step = 1) {
  let prev = f(YEAR_MIN), max = 0;
  for (let y = YEAR_MIN + step; y <= YEAR_MAX; y += step) {
    const v = f(y);
    assert.ok(Number.isFinite(v), `finite at ${y}`);
    max = Math.max(max, Math.abs(v - prev));
    prev = v;
  }
  return max;
}

test('globalDT: shape (Holocene optimum, MCA, LIA, SSP2-4.5 by 2100)', () => {
  const g2100 = globalDT(2100);
  assert.ok(g2100 > 1.5 && g2100 < 3.5, `2100: ${g2100}`);
  const pre2100 = globalDTPreindustrial(2100);
  assert.ok(pre2100 > 2.1 && pre2100 < 3.5, `2100 vs 1850–1900: ${pre2100}`);
  // baseline: the 1970–2000 mean is ~0
  let s = 0, n = 0;
  for (let y = 1970; y <= 2000; y += 0.5) { s += globalDT(y); n++; }
  assert.ok(Math.abs(s / n) < 0.02, `1970–2000 mean ${s / n}`);
  assert.ok(BASELINE_1970_2000 > 0.3 && BASELINE_1970_2000 < 0.6);
  assert.ok(globalDT(-4500) > globalDT(1000), 'mid-Holocene warmer than the MCA');
  assert.ok(globalDT(1000) > globalDT(1650), 'MCA warmer than the LIA');
  assert.ok(globalDT(1650) < globalDT(1900));
  assert.ok(globalDT(2050) > globalDT(2025) && globalDT(2025) > globalDT(2000));
  const pre2020 = globalDTPreindustrial(2020);
  assert.ok(pre2020 > 1.0 && pre2020 < 1.4, `2020 vs pre-industrial ${pre2020}`);
});

test('continuity: no abrupt jumps from -4999 to 2100', () => {
  assert.ok(maxStep(globalDT) < 0.06, 'globalDT step');
  assert.ok(maxStep(globalDT, 0.1) < 0.01, 'globalDT sub-year step');
  for (const [la, lo] of PLACES) {
    assert.ok(maxStep(y => regionalDT(y, la, lo)) < 0.15, `regionalDT ${la},${lo}`);
    assert.ok(maxStep(y => regionalDT(y, la, lo, 6)) < 0.15, `regionalDT July ${la},${lo}`);
    assert.ok(maxStep(y => precipFactor(y, la, lo)) < 0.05, `precipFactor ${la},${lo}`);
    assert.ok(maxStep(y => precipAddMm(y, la, lo, 7)) < 1, `precipAddMm ${la},${lo}`);
    assert.ok(maxStep(y => relativeSeaLevel(y, la, lo)) < 0.05, `relativeSeaLevel ${la},${lo}`);
  }
  assert.ok(maxStep(seaLevel) < 0.02, 'seaLevel step');
  for (const m of [2, 8]) {
    assert.ok(maxStep(y => seaIceExtent(y, m, 'N')) < 0.3, `seaIce N ${m}`);
    assert.ok(maxStep(y => seaIceExtent(y, m, 'S')) < 0.3, `seaIce S ${m}`);
  }
  // smooth in space and season too
  for (let lat = -89; lat < 89; lat += 0.5) {
    assert.ok(Math.abs(precipFactor(-4000, lat + 0.5, 10) - precipFactor(-4000, lat, 10)) < 0.4, `space step at ${lat}`);
    assert.ok(Math.abs(regionalDT(2100, lat + 0.5, 10) - regionalDT(2100, lat, 10)) < 0.2);
  }
  for (let m = 0; m < 12; m += 0.1) {
    assert.ok(Math.abs(seaIceExtent(1500, m + 0.1, 'N') - seaIceExtent(1500, m, 'N')) < 0.5);
  }
});

test('green Sahara: strong precipitation increase before ~3500–3000 BC', () => {
  const f5000 = precipFactor(-4999, 23, 10);
  assert.ok(f5000 > 1.5, `Sahara 5000 BC factor ${f5000}`);
  const f1000 = precipFactor(1000, 23, 10);
  assert.ok(Math.abs(f1000 - 1) < 0.05, `Sahara 1000 AD factor ${f1000}`);
  assert.ok(precipFactor(-2500, 23, 10) < 1.2, 'humid period over by 2500 BC');
  assert.ok(precipFactor(-4999, 22, 45) > 1.5, 'Arabia wetter too');
  assert.ok(Math.abs(precipFactor(-4999, 50, 10) - 1) < 0.05, 'no effect in Europe');
  assert.ok(humidPeriodStrength(-4999, 20) > 0.99 && humidPeriodStrength(-2000, 20) < 0.01);
  assert.ok(humidPeriodStrength(-3500, 28) < humidPeriodStrength(-3500, 12), 'northern Sahara dries first');
  // additive monsoon rain makes the desert green (hundreds of mm per year)
  let yr = 0;
  for (let m = 0; m < 12; m++) yr += adjustPrecip(1, -4999, 20, 10, m);
  assert.ok(yr > 250, `green Sahara annual rain ${yr}`);
  assert.equal(precipAddMm(1000, 20, 10, 7), 0);
});

test('regional patterns: polar amplification, MCA/LIA in Europe, droughts', () => {
  assert.ok(polarAmplification(85) > 2.5 && polarAmplification(0) < 0.8);
  assert.ok(regionalDT(2100, 80, 0) > 2 * globalDT(2100), 'Arctic amplification');
  assert.ok(regionalDT(1650, 55, 0) < globalDT(1650), 'LIA stronger in Europe');
  assert.ok(regionalDT(1050, 60, -10) > globalDT(1050), 'MCA warmer in the North Atlantic');
  assert.ok(regionalDT(-4999, 70, 0, 6) > regionalDT(-4999, 70, 0, 0), 'mid-Holocene NH summers boosted by orbit');
  assert.ok(precipFactor(-2150, 33, 45) < 0.85, '4.2 ka event in Mesopotamia');
  assert.ok(precipFactor(900, 18.5, -89.5) < 0.8, 'Maya drought');
  assert.ok(precipFactor(1640, 37, 113) < 0.8, 'late-Ming drought');
  assert.ok(precipFactor(2100, 38, 18) < 0.95, 'drier Mediterranean under SSP2-4.5');
  assert.ok(precipFactor(2100, 68, 60) > 1.05, 'wetter high latitudes under SSP2-4.5');
  for (const [la, lo] of PLACES) for (const y of [-4999, -2150, 900, 1640, 2100]) assert.ok(precipFactor(y, la, lo) >= 0.2);
});

test('sea level: Holocene rise, near-stable for 2 ka, modern rise', () => {
  const sl = seaLevel(-4999);
  assert.ok(sl > -6 && sl < -2, `5000 BC: ${sl}`);
  assert.ok(Math.abs(seaLevel(2005)) < 0.05);
  const s2100 = seaLevel(2100);
  assert.ok(s2100 > 0.3 && s2100 < 1.0, `2100: ${s2100}`);
  for (let y = YEAR_MIN; y < YEAR_MAX; y += 1) assert.ok(seaLevel(y + 1) >= seaLevel(y) - 1e-9, `monotone at ${y}`);
  assert.ok(Math.abs(seaLevel(1500) - seaLevel(500)) < 0.1, 'stable in the Common Era');
  // relative sea level: Baltic shore far inland in 5000 BC (Fennoscandian uplift), Dutch coast lower
  assert.ok(relativeSeaLevel(-4999, 63, 20) > 50, 'Gulf of Bothnia');
  assert.ok(relativeSeaLevel(-4999, 52.5, 4.5) < seaLevel(-4999), 'Netherlands (collapsing forebulge)');
  assert.ok(relativeSeaLevel(-3000, -17.5, -149.5) > 0, 'equatorial mid-Holocene highstand');
  for (const [la, lo] of PLACES) assert.ok(Math.abs(relativeSeaLevel(2005, la, lo)) < 0.1, `present RSL ~0 at ${la},${lo}`);
});

test('sea ice: seasonal cycle, history and the future', () => {
  for (const y of [-4999, -2000, 1000, 1650, 1985, 2025, 2100]) {
    const mar = seaIceExtent(y, 2, 'N'), sep = seaIceExtent(y, 8, 'N');
    assert.ok(mar > sep, `N seasonal cycle ${y}`);
    assert.ok(seaIceExtent(y, 8, 'S') > seaIceExtent(y, 1, 'S'), `S seasonal cycle ${y}`);
    for (let m = 0; m < 12; m++) {
      const n = seaIceExtent(y, m, 'N'), s = seaIceExtent(y, m, 'south');
      assert.ok(n >= 0.3 && n <= 18 && s >= 1 && s <= 22, `bounds ${y}/${m}`);
    }
  }
  const sep1985 = seaIceExtent(1985, 8, 'N');
  assert.ok(sep1985 > 5.5 && sep1985 < 7.5, `Sept 1985 ${sep1985}`);
  assert.ok(seaIceExtent(2100, 8, 'N') < 1.5, 'nearly ice-free Arctic summer by 2100');
  assert.ok(seaIceExtent(1650, 8, 'N') > sep1985, 'more ice in the LIA');
  const edge = seaIceEdgeLat(1985, 2, 'N');
  assert.ok(edge > 55 && edge < 72, `March ice edge ${edge}`);
  const edgeS = seaIceEdgeLat(1985, 8, 'S');
  assert.ok(edgeS < -55 && edgeS > -66, `September Antarctic ice edge ${edgeS}`);
});

test('grid fills match the point functions; everything is deterministic', () => {
  const N = 720 * 360, out = new Float32Array(N), pf = new Float32Array(N), add = new Float32Array(N);
  const cell = (lat, lon) => Math.floor((90 - lat) / 0.5) * 720 + Math.floor((lon + 180) / 0.5);
  const centre = c => [90 - (Math.floor(c / 720) + 0.5) * 0.5, -180 + ((c % 720) + 0.5) * 0.5];
  for (const [year, month] of [[620, 3], [1050, undefined], [2100, 7], [-4999, 7]]) {
    fillRegionalDT(year, month, out);
    fillPrecip(year, month ?? 0, pf, add);
    for (const [la, lo] of PLACES) {
      const c = cell(la, lo), [cl, cn] = centre(c);
      assert.ok(Math.abs(out[c] - regionalDT(year, cl, cn, month)) < 1e-4, `DT field ${year} ${la},${lo}`);
      assert.ok(Math.abs(pf[c] - precipFactor(year, cl, cn)) < 1e-4, `PF field ${year} ${la},${lo}`);
      assert.ok(Math.abs(add[c] - precipAddMm(year, cl, cn, month ?? 0)) < 1e-3, `add field ${year} ${la},${lo}`);
    }
  }
  assert.equal(regionalDT(1234.5, 45, 7, 3), regionalDT(1234.5, 45, 7, 3));
  assert.equal(precipFactor(-3333, 20, 5), precipFactor(-3333, 20, 5));
});

test('monotoneCubic: interpolates anchors without overshoot', () => {
  const f = monotoneCubic([[0, 0], [1, 1], [2, 1], [3, 5]]);
  assert.equal(f(1), 1);
  assert.equal(f(3), 5);
  for (let x = 1; x <= 2; x += 0.05) assert.ok(Math.abs(f(x) - 1) < 1e-12, 'flat segment stays flat');
  for (let x = 0; x < 3; x += 0.01) assert.ok(f(x + 0.01) >= f(x) - 1e-12, 'monotone');
  assert.equal(f(-10), 0);
  assert.equal(f(10), 5);
});
