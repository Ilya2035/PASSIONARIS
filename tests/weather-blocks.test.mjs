// Fast-clock blocks (setOptions({stride})): k days per step must keep the climate of daily steps
// (snow cover, sea ice, heat / cold waves, severe winters, drought), stay deterministic, never cross a
// month end, and stay a run-time option (not taken from saves).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthNormals, N, W, LAND } from './weather-fixtures.mjs';
import { createWeather, fromDate, dayInfo } from '../src/sim/weather/core.js';

const n = synthNormals();
const base = { normals: n, mask: n.mask };
const md5 = a => createHash('md5').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const area = y => Math.cos(((90 - (y + 0.5) * 0.5) * Math.PI) / 180);

/** Two years from 1900 at the given stride: monthly NH snow / Arctic ice area, climateLog sums, events, cost. */
function run(stride, seed = 2026) {
  const sim = createWeather({ ...base, seed, t: fromDate(1900, 1, 1) });
  if (stride > 1) sim.setOptions({ stride });
  const snow = new Float64Array(12), ice = new Float64Array(12), cnt = new Float64Array(12), ev = {};
  let drought = 0, dn = 0, steps = 0;
  const end = fromDate(1902, 1, 1);
  const t0 = performance.now();
  for (let t = fromDate(1900, 1, 1); t < end;) {
    t = Math.min(end, t + stride);
    const f = sim.step(t);
    steps++;
    for (const e of f.events) if (e.phase === 'start') { const k = e.subtype === 'tropical' ? 'tropical' : e.type; ev[k] = (ev[k] || 0) + 1; }
    if (f.date.day % 5 !== 0 && stride === 1) continue; // sample daily runs on ~1/5 of the days (cheaper, same statistics)
    const mi = f.date.month - 1, g = f.grid;
    let s = 0, i = 0;
    for (let c = 0; c < N / 2; c++) {
      const a = area((c / W) | 0);
      if (n.mask[c] === LAND) { if (g[c * 4] >= 128) s += a; drought += g[c * 4 + 3]; dn++; } else if (g[c * 4] >= 50) i += a;
    }
    snow[mi] += s; ice[mi] += i; cnt[mi]++;
  }
  const ms = performance.now() - t0;
  const log = sim.getClimateLog().years;
  let hw = 0, sw = 0, dm = 0;
  for (let k = 0; k < log.heatwaves.length; k++) { hw += log.heatwaves[k]; sw += log.severeWinter[k]; dm += log.droughtMonths[k]; }
  for (let m = 0; m < 12; m++) { snow[m] /= cnt[m]; ice[m] /= cnt[m]; }
  return { sim, snow, ice, ev, hw, sw, dm, drought: drought / dn, ms, steps, years: Array.from(log.year) };
}

const daily = run(1), b4 = run(4);

test('blocks keep the seasonal snow and sea-ice cycle of daily steps', () => {
  const rel = (a, b) => Math.abs(a - b) / Math.max(b, 1e-9);
  for (const m of [0, 1, 2, 6, 7, 10, 11]) {
    assert.ok(rel(b4.snow[m], daily.snow[m]) < 0.12, `NH snow month ${m + 1}: blocks ${b4.snow[m].toFixed(0)} vs daily ${daily.snow[m].toFixed(0)}`);
    assert.ok(rel(b4.ice[m], daily.ice[m]) < 0.08, `Arctic ice month ${m + 1}: blocks ${b4.ice[m].toFixed(0)} vs daily ${daily.ice[m].toFixed(0)}`);
  }
  assert.ok(rel(b4.drought, daily.drought) < 0.2, `mean land drought ${b4.drought.toFixed(1)} vs ${daily.drought.toFixed(1)}`);
});

test('blocks keep the climateLog and event statistics of daily steps', () => {
  assert.deepEqual(b4.years, daily.years);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.max(b, 10), `${what}: blocks ${a} vs daily ${b}`);
  near(b4.hw, daily.hw, 0.3, 'heatwave box-hits');
  near(b4.sw, daily.sw, 0.2, 'severe winters');
  near(b4.dm, daily.dm, 0.25, 'drought months');
  for (const k of ['heatwave', 'coldwave', 'storm', 'tropical']) near(b4.ev[k] || 0, daily.ev[k] || 0, 0.3, `${k} events`);
  // cell-count events are detected on the block's estimated wettest day: roughly their daily rates
  for (const k of ['snowstorm', 'flood', 'wildfire']) near(b4.ev[k] || 0, daily.ev[k] || 0, 0.5, `${k} events`);
  console.log(`# blocks of 4 days vs daily (2 years): steps ${b4.steps} vs ${daily.steps}, ${(b4.ms / 730).toFixed(2)} vs ${(daily.ms / 730).toFixed(2)} ms per game day (incl. test sampling); ` +
    `heatwave hits ${b4.hw}/${daily.hw}, severe winters ${b4.sw}/${daily.sw}, drought months ${b4.dm}/${daily.dm}; events ${JSON.stringify(b4.ev)} vs ${JSON.stringify(daily.ev)}`);
});

test('blocks are deterministic, end exactly on the target day and never cross a month end', () => {
  const a = createWeather({ ...base, seed: 9, t: fromDate(1950, 1, 25), options: { events: true } });
  const b = createWeather({ ...base, seed: 9, t: fromDate(1950, 1, 25), options: { events: true } });
  a.setOptions({ stride: 6 }); b.setOptions({ stride: 6 });
  const fa = a.step(fromDate(1950, 3, 3)), fb = b.step(fromDate(1950, 3, 3));
  assert.equal(fa.day, fromDate(1950, 3, 3));
  assert.equal(md5(fa.grid), md5(fb.grid));
  assert.deepEqual(fa.events, fb.events);
  // month bookkeeping: the 3 days of March are this month's days
  assert.equal(a.mDays, 3);
  // stepping in other chunks with the same stride gives the same weather
  const c = createWeather({ ...base, seed: 9, t: fromDate(1950, 1, 25) });
  c.setOptions({ stride: 6 });
  c.step(fromDate(1950, 1, 31)); c.step(fromDate(1950, 2, 28));
  const fc = c.step(fromDate(1950, 3, 3));
  assert.equal(md5(fc.grid), md5(fa.grid));
  // stride 1 is the daily model
  const d = createWeather({ ...base, seed: 9, t: fromDate(1950, 1, 25) }), e = createWeather({ ...base, seed: 9, t: fromDate(1950, 1, 25) });
  e.setOptions({ stride: 1 });
  for (let t = fromDate(1950, 1, 26); t <= fromDate(1950, 2, 10); t++) d.step(t);
  assert.equal(md5(e.step(fromDate(1950, 2, 10)).grid), md5(d.grid));
  assert.throws(() => a.setOptions({ stride: 0 }), /stride/);
  assert.throws(() => a.setOptions({ stride: 99 }), /stride/);
  assert.ok(dayInfo(fa.day).month === 3);
});

test('stride is run-time pacing: saves do not carry it, and a block run continues daily after a load', () => {
  const a = createWeather({ ...base, seed: 5, t: fromDate(1980, 6, 1), options: { events: false } });
  a.setOptions({ stride: 5 });
  a.step(fromDate(1980, 7, 15));
  const snap = a.serialize();
  const b = createWeather({ ...base, seed: 1, deferInit: true, options: { events: false } });
  b.deserialize(snap);
  assert.equal(b.opts.stride, 1, 'the loading simulator keeps its own pacing');
  assert.equal(b.day, a.day);
  assert.equal(md5(b.grid), md5(a.grid));
  const f = b.step(fromDate(1980, 7, 20));
  assert.equal(f.day, fromDate(1980, 7, 20));
  assert.equal(b.mDays, 20);
});
