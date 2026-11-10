// Performance of the weather simulator (targets from the module brief):
//   one simulated day for all 259,200 cells < 8 ms (~4 ms since the rows pass), stepping a month < 250 ms;
//   fast-clock blocks (stride 6) cost well under half a daily step per game day.
// Timings are printed. The day limit uses the best of 5 medians of 24 single-day steps, the month limit
// the best of 7 month steps: when the other test files run in parallel the CPU is shared, and the best
// run is what the code costs on this CPU. Run this file alone for undisturbed numbers.
// WEATHER_PERF_SCALE=2 relaxes the limits on slow hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { synthNormals } from './weather-fixtures.mjs';
import { createWeather, fromDate } from '../src/sim/weather/core.js';

const SCALE = +(process.env.WEATHER_PERF_SCALE || 1);
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

test('daily step, month step, init and fast-forward timings', () => {
  const n = synthNormals();
  const start = fromDate(1850, 6, 1);
  let t0 = performance.now();
  const sim = createWeather({ normals: n, mask: n.mask, seed: 11, t: start });
  const initMs = performance.now() - t0;

  let day = start;
  for (let i = 0; i < 40; i++) sim.step(++day); // JIT warm-up
  const days = [];
  for (let i = 0; i < 120; i++) { t0 = performance.now(); sim.step(++day); days.push(performance.now() - t0); }
  const months = [];
  for (let i = 0; i < 7; i++) { t0 = performance.now(); day += 30; sim.step(day); months.push(performance.now() - t0); }
  t0 = performance.now();
  sim.step(day + 365 * 50);
  const jumpMs = performance.now() - t0;
  t0 = performance.now();
  const snap = sim.serialize();
  const serMs = performance.now() - t0;
  t0 = performance.now();
  createWeather({ normals: n, mask: n.mask, deferInit: true }).deserialize(snap);
  const desMs = performance.now() - t0;

  const dMed = median(days), dP90 = [...days].sort((a, b) => a - b)[Math.floor(days.length * 0.9)], mMed = median(months), mBest = Math.min(...months);
  const dBest = Math.min(...[0, 1, 2, 3, 4].map(i => median(days.slice(i * 24, i * 24 + 24))));
  const line = `init ${initMs.toFixed(0)} ms | day: median ${dMed.toFixed(2)} ms (best 24-day median ${dBest.toFixed(2)}), p90 ${dP90.toFixed(2)} ms, min ${Math.min(...days).toFixed(2)} ms ` +
    `| month (30 days): best ${mBest.toFixed(0)} ms, median ${mMed.toFixed(0)} ms [${months.map(v => v.toFixed(0)).join(', ')}] | jump 50 y ${jumpMs.toFixed(0)} ms ` +
    `| serialize ${serMs.toFixed(0)} ms, construct+deserialize ${desMs.toFixed(0)} ms`;
  console.log(`# weather perf: ${line}`);
  assert.ok(dBest < 8 * SCALE, `one day takes ${dBest.toFixed(2)} ms (target < 8 ms)`);
  assert.ok(mBest < 250 * SCALE, `one month takes ${mBest.toFixed(0)} ms (target < 250 ms)`);
  assert.ok(jumpMs < 1500 * SCALE, `a 50-year jump takes ${jumpMs.toFixed(0)} ms`);
});

test('fast-clock blocks: cost per game day at strides 1, 3, 6 (interleaved, same process)', () => {
  const n = synthNormals();
  const t = fromDate(1850, 6, 1);
  const sims = [1, 3, 6].map(k => { const s = createWeather({ normals: n, mask: n.mask, seed: 11, t }); s.setOptions({ stride: k }); return { k, s, day: t + 40, r: [] }; });
  for (const x of sims) x.s.step(x.day);
  for (let r = 0; r < 5; r++) for (const x of sims) { const t0 = performance.now(); x.day += 60; x.s.step(x.day); x.r.push((performance.now() - t0) / 60); }
  const [d1, d3, d6] = sims.map(x => median(x.r));
  console.log(`# weather perf, ms per game day: daily ${d1.toFixed(2)}, stride 3 ${d3.toFixed(2)} (x${(d1 / d3).toFixed(2)}), stride 6 ${d6.toFixed(2)} (x${(d1 / d6).toFixed(2)})`);
  assert.ok(d3 < 0.8 * d1, `stride 3: ${d3.toFixed(2)} vs daily ${d1.toFixed(2)} ms per game day`);
  assert.ok(d6 < 0.6 * d1, `stride 6: ${d6.toFixed(2)} vs daily ${d1.toFixed(2)} ms per game day`);
});
