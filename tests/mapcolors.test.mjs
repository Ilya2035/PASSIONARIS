// Colours of the data map modes (src/game/ui/mapcolors.js) and the baked cloud noise (src/game/fx/cloudnoise.js).
// Run: tools/node/node.exe --test tests/mapcolors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { KOPPEN } from '../src/sim/climate/koppen.js';
import { KOPPEN_COLORS, koppenColor, WX, WX_STEPS, AIR, WIND, MAPCOLORS_GLSL } from '../src/game/ui/mapcolors.js';
import { PALETTES } from '../src/shared/palettes.js';
import { bakeCloudNoise } from '../src/game/fx/cloudnoise.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const isColor = c => Array.isArray(c) && c.length === 3 && c.every(v => v >= 0 && v <= 1);

test('mapcolors: every Köppen class has its own colour', () => {
  const classes = KOPPEN.slice(1);
  assert.equal(Object.keys(KOPPEN_COLORS).length, classes.length);
  for (const k of classes) assert.ok(isColor(KOPPEN_COLORS[k.code]), k.code);
  // no two classes share a colour, and none is a near twin of another (the smallest step on the map)
  let min = Infinity, pair = '';
  for (let i = 0; i < classes.length; i++) for (let j = i + 1; j < classes.length; j++) {
    const d = dist(koppenColor(classes[i].code), koppenColor(classes[j].code));
    if (d < min) { min = d; pair = `${classes[i].code} / ${classes[j].code}`; }
  }
  assert.ok(min > 0.07, `closest pair ${pair}: ${min.toFixed(3)}`);
});

test('mapcolors: land classes stand apart from the sea of the data maps', () => {
  // the sea of these modes (shaders.js): the palette's waters toward paper, cooled — shallow and mid-depth
  for (const [id, p] of Object.entries(PALETTES)) {
    const { shallow, deep, paper } = p.map;
    for (const k of [0, 0.5]) {
      let sea = shallow.map((v, i) => (v + (deep[i] - v) * k) * 0.72 + paper[i] * 0.28);
      sea = [sea[0] * 0.95, sea[1] * 0.985, sea[2] * 1.03];
      for (const kc of KOPPEN.slice(1)) {
        assert.ok(dist(koppenColor(kc.code), sea) > 0.1, `${kc.code} vs the sea of "${id}" (depth ${k}): ${dist(koppenColor(kc.code), sea).toFixed(3)}`);
      }
    }
  }
});

test('mapcolors: weather, air and winds tables, and their GLSL copy', () => {
  for (const c of [WX.warm, WX.cold, WX.cloud, WX.snow, WX.drought, ...WX.rain, ...WX.snowfall, ...Object.values(AIR), ...Object.values(WIND)]) assert.ok(isColor(c));
  assert.equal(WX.rain.length, WX_STEPS.rain.length);
  assert.ok(WX_STEPS.anomaly.every((v, i, a) => i === 0 || v > a[i - 1]));
  assert.ok(WX_STEPS.rain.every((v, i, a) => v > 0 && v < 1 && (i === 0 || v > a[i - 1])));
  // rain classes get darker step by step (they must read in a row), warm and cold are clearly different
  const lum = c => 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
  assert.ok(lum(WX.rain[0]) > lum(WX.rain[1]) && lum(WX.rain[1]) > lum(WX.rain[2]));
  assert.ok(dist(WX.warm, WX.cold) > 0.5);
  // the shader's copy: the class palette in id order, and every constant the modes use
  assert.match(MAPCOLORS_GLSL, new RegExp(`const vec3 KPAL\\[${KOPPEN.length}\\] = vec3\\[${KOPPEN.length}\\]\\(`));
  const pal = MAPCOLORS_GLSL.slice(MAPCOLORS_GLSL.indexOf('KPAL'), MAPCOLORS_GLSL.indexOf('WX_WARM'));
  assert.equal((pal.match(/vec3\(/g) || []).length, KOPPEN.length);
  const first = KOPPEN_COLORS[KOPPEN[1].code].map(v => v.toFixed(3)).join(', ');
  assert.ok(pal.indexOf(`vec3(${first})`) > 0 && pal.indexOf(`vec3(${first})`) < pal.indexOf(`vec3(${KOPPEN_COLORS[KOPPEN[2].code].map(v => v.toFixed(3)).join(', ')})`));
  for (const name of ['WX_WARM', 'WX_COLD', 'WX_DROUGHT', 'WX_CLOUD', 'WX_SNOW', 'WX_RAIN0', 'WX_RAIN1', 'WX_RAIN2', 'WX_SNOWF0', 'WX_SNOWF1', 'WX_ASTEP', 'WX_RSTEP',
    'AIR_ASH', 'AIR_SMOKE', 'AIR_DUST', 'AIR_SULF', 'AIR_FALL', 'AIR_COOL', 'WIND_EAST', 'WIND_WEST']) assert.match(MAPCOLORS_GLSL, new RegExp(`\\b${name} = `), name);
  assert.ok(!MAPCOLORS_GLSL.includes('`'));   // it is pasted into a template literal
});

test('cloud noise: fills B and A only, full range, deterministic, seamless', () => {
  const n = 128;
  const a = new Uint8Array(n * n * 4).fill(7), b = new Uint8Array(n * n * 4).fill(7);
  bakeCloudNoise(a, n); bakeCloudNoise(b, n);
  assert.deepEqual(a, b);
  for (const ch of [2, 3]) {
    let lo = 255, hi = 0, step = 0, seamX = 0, seamY = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = a[(y * n + x) * 4 + ch];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (x) step += Math.abs(v - a[(y * n + x - 1) * 4 + ch]);
    }
    for (let i = 0; i < n; i++) {
      seamX += Math.abs(a[(i * n) * 4 + ch] - a[(i * n + n - 1) * 4 + ch]);
      seamY += Math.abs(a[i * 4 + ch] - a[((n - 1) * n + i) * 4 + ch]);
    }
    assert.ok(lo <= 2 && hi >= 253, `channel ${ch}: ${lo}..${hi}`);
    // the wrap-around step is no bigger than a step inside the tile
    const mean = step / (n * (n - 1));
    assert.ok(seamX / n < mean * 2.5 + 1 && seamY / n < mean * 2.5 + 1, `channel ${ch}: seam ${(seamX / n).toFixed(1)} / ${(seamY / n).toFixed(1)}, inside ${mean.toFixed(1)}`);
  }
  for (let i = 0; i < a.length; i += 4) { if (a[i] !== 7 || a[i + 1] !== 7) assert.fail('R / G were touched'); }
});
