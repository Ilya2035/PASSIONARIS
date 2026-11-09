// Determinism, save/load, fast-forward, paleo anomalies and the climateLog store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthNormals, N, LAND } from './weather-fixtures.mjs';
import { createWeather, fromDate, toDate, cellOf, boxOfCell, LOG_SYNTHETIC } from '../src/sim/weather/core.js';
import { ClimateLog } from '../src/sim/weather/climatelog.js';

const n = synthNormals();
const base = { normals: n, mask: n.mask };
const start = fromDate(1950, 11, 1);
const DAYS = 120; // crosses the new year (log finalisation) and several month changes
const md5 = a => createHash('md5').update(new Uint8Array(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength)).digest('hex');
const logHash = sim => {
  const l = sim.getClimateLog(), h = createHash('md5');
  for (const part of [l.years, l.decades]) for (const k of Object.keys(part).sort()) h.update(new Uint8Array(part[k].buffer));
  return h.digest('hex');
};

// reference run: one day at a time
const ref = createWeather({ ...base, seed: 77, t: start });
const refEvents = [...ref.current().events];
const refGrids = new Map();
for (let d = 1; d <= DAYS; d++) {
  const f = ref.step(start + d);
  refEvents.push(...f.events);
  if (d === 45 || d === DAYS) refGrids.set(d, md5(f.grid));
}
const refLog = logHash(ref);

test('same seed gives identical results regardless of step chunking', () => {
  const sim = createWeather({ ...base, seed: 77, t: start + 0.3 });
  const ev = [...sim.current().events];
  let d = 0;
  for (const chunk of [1, 2, 5, 13, 24, 30, 45]) {
    d += chunk;
    const f = sim.step(start + d + 0.75); // fractional times select the same days
    ev.push(...f.events);
    if (d === 45) assert.equal(md5(f.grid), refGrids.get(45));
  }
  assert.equal(d, DAYS);
  assert.equal(md5(sim.grid), refGrids.get(DAYS));
  assert.deepEqual(ev, refEvents);
  assert.equal(logHash(sim), refLog);
  assert.ok(refEvents.length > 20, `events in ${DAYS} days: ${refEvents.length}`);
});

test('a different seed gives different weather', () => {
  const sim = createWeather({ ...base, seed: 78, t: start });
  const f = sim.step(start + 10), g = ref.grid;
  const r = createWeather({ ...base, seed: 77, t: start }).step(start + 10).grid;
  let diff = 0;
  for (let i = 0; i < N * 4; i++) if (f.grid[i] !== r[i]) diff++;
  assert.ok(diff > N * 0.5, `differing bytes ${diff}`);
  assert.ok(g.length === N * 4);
});

test('serialize -> deserialize continues exactly (incl. active events and year end)', () => {
  const a = createWeather({ ...base, seed: 77, t: start });
  for (let d = 1; d <= 45; d++) a.step(start + d);
  a.current(); // drain
  const snap = a.serialize();
  assert.equal(snap.version, 1);
  assert.equal(snap.kind, 'passionaris.weather');
  for (const v of Object.values(snap.buffers)) assert.ok(v instanceof ArrayBuffer);
  assert.ok(snap.meta.events.active.length > 0, 'snapshot taken with active events');
  const sizeMB = Object.values(snap.buffers).reduce((s, b) => s + b.byteLength, 0) / 1e6;
  console.log(`# snapshot: ${Object.keys(snap.buffers).length} buffers, ${sizeMB.toFixed(2)} MB raw, ${snap.meta.events.active.length} active events`);
  // through JSON (meta) and fresh buffer copies, as a save file would
  const copy = { version: snap.version, kind: snap.kind, meta: JSON.parse(JSON.stringify(snap.meta)), buffers: {} };
  for (const [k, v] of Object.entries(snap.buffers)) copy.buffers[k] = v.slice(0);
  const before = md5(snap.buffers['cell.swe']);
  // original continues
  const evA = [];
  for (let d = 46; d <= DAYS; d++) evA.push(...a.step(start + d).events);
  assert.equal(md5(snap.buffers['cell.swe']), before, 'snapshot is a copy');
  // restored continues
  const b = createWeather({ ...base, seed: 1, deferInit: true });
  b.deserialize(copy);
  const cur = b.current();
  assert.equal(cur.day, start + 45);
  assert.equal(md5(cur.grid), refGrids.get(45));
  assert.deepEqual(b.query(cellOf(60, 90)), (() => { const r = createWeather({ ...base, seed: 77, t: start }); for (let d = 1; d <= 45; d++) r.step(start + d); return r.query(cellOf(60, 90)); })());
  const evB = [];
  for (let d = 46; d <= DAYS; d++) evB.push(...b.step(start + d).events);
  assert.equal(md5(b.grid), refGrids.get(DAYS));
  assert.deepEqual(evB, evA);
  assert.equal(logHash(b), refLog);
  assert.equal(toDate(b.day).year, 1951);
});

test('deserialize rejects snapshots from another land mask or format', () => {
  const a = createWeather({ ...base, seed: 3, t: start, options: { events: false } });
  const snap = a.serialize();
  const mask2 = n.mask.slice(); mask2[cellOf(0, 0)] = LAND;
  const b = createWeather({ ...base, mask: mask2, seed: 3, deferInit: true });
  assert.throws(() => b.deserialize(snap), /mask/);
  assert.throws(() => a.deserialize({ ...snap, version: 99 }), /version/);
  assert.throws(() => a.deserialize({}), /snapshot/);
});

test('fast-forward: long jumps re-initialise from climatology and fill the climateLog', () => {
  const sim = createWeather({ ...base, seed: 5, t: fromDate(1950, 1, 1) });
  for (let d = 1; d <= 400; d++) sim.step(fromDate(1950, 1, 1) + d); // completes 1950
  let t0 = performance.now();
  const f = sim.step(fromDate(2060, 1, 20));
  const jumpMs = performance.now() - t0;
  assert.deepEqual([f.date.year, f.date.month, f.date.day], [2060, 1, 20]);
  assert.ok(f.events.every(e => e.phase === 'end' || e.t0 >= fromDate(2060, 1, 1)), 'old events were closed');
  const log = sim.getClimateLog();
  const years = Array.from(log.years.year);
  assert.equal(years[0], 1950); assert.equal(years.at(-1), 2059);
  assert.equal(log.years.flags[0] & LOG_SYNTHETIC, 0);
  assert.equal(log.years.flags.at(-1) & LOG_SYNTHETIC, LOG_SYNTHETIC);
  const sib = boxOfCell(cellOf(62.5, 102.5));
  assert.equal(sim.climateAt(2000, sib).synthetic, true);
  // state is a plausible January: snow in Siberia, ice in the Arctic
  const q = sim.queryLatLon(62, 100);
  assert.ok(q.swe > 5 && q.temp < -5, `Siberia in January after a jump: ${JSON.stringify(q)}`);
  assert.ok(sim.queryLatLon(85, 0).ice, 'Arctic sea ice');
  // continues normally
  t0 = performance.now();
  for (let d = 1; d <= 30; d++) sim.step(fromDate(2060, 1, 20) + d);
  const monthMs = performance.now() - t0;
  // rewind
  const r = sim.step(fromDate(2030, 6, 1));
  assert.equal(r.date.year, 2030);
  assert.equal(sim.getClimateLog().years.year.at(-1), 2029);
  // across the whole game span: annual for the last 300 years, decades before
  t0 = performance.now();
  const far = createWeather({ ...base, seed: 6, t: fromDate(-4999, 1, 1), options: { events: false } });
  const initMs = performance.now() - t0;
  t0 = performance.now();
  far.step(fromDate(2100, 12, 1));
  const farMs = performance.now() - t0;
  const fl = far.getClimateLog();
  assert.equal(fl.years.year.length, 300);
  assert.equal(fl.years.year[0], 1800); assert.equal(fl.years.year.at(-1), 2099);
  assert.ok(fl.decades.year.length >= 678 && fl.decades.year.length <= 681, `decades ${fl.decades.year.length}`);
  assert.ok(Array.from(fl.decades.nYears).every(v => v >= 1 && v <= 10));
  assert.equal(far.climateAt(-3000, sib).kind, 'decade');
  console.log(`# jump 110 y: ${jumpMs.toFixed(0)} ms; next month: ${monthMs.toFixed(0)} ms; init: ${initMs.toFixed(0)} ms; jump 7100 y: ${farMs.toFixed(0)} ms`);
  assert.ok(jumpMs < 2000 && farMs < 5000, 'jumps stay fast');
});

test('paleo anomalyFn: dT shifts temperature, precipFactor scales precipitation, cached per year', () => {
  let calls = 0;
  // +3 degC always; abrupt halving of precipitation from year 1000 on
  const fn = (year, lat, lon) => { calls++; return { dT: 3, precipFactor: year >= 1000 ? 0.5 : 1 }; };
  const t = fromDate(999, 10, 1), y1000 = fromDate(1000, 1, 1);
  const a = createWeather({ ...base, seed: 9, t, options: { events: false } });
  const b = createWeather({ ...base, seed: 9, t, anomalyFn: fn, options: { events: false } });
  const callsAfterInit = calls;
  assert.ok(callsAfterInit <= 5 * 144 * 72, `anomalyFn calls at init ${callsAfterInit}`);
  let pa = 0, pb = 0, db = 0, landT = 0, nl = 0, nd = 0;
  for (let d = t + 1; d <= y1000 + 150; d++) {
    const fa = a.step(d), fb = b.step(d);
    if (d === y1000 - 1) assert.equal(calls, callsAfterInit, 'no calls within the same year');
    if (d === y1000) assert.equal(calls, callsAfterInit + 144 * 72, 'one evaluation per new year on the 2.5-degree grid');
    if (d < y1000 + 30) continue;
    nd++;
    for (let c = 0; c < N; c++) { pa += a.precip[c]; pb += b.precip[c]; db += fb.grid[c * 4 + 2] - fa.grid[c * 4 + 2]; }
    for (let k = 0; k < a.landIdx.length; k++) { landT += b.TL[k] - a.TL[k]; nl++; }
  }
  let da = 0, dbb = 0;
  for (let k = 0; k < a.landIdx.length; k++) { da += a.drought[a.landIdx[k]]; dbb += b.drought[b.landIdx[k]]; }
  assert.ok(Math.abs(landT / nl - 3) < 0.01, `land temperature shift ${(landT / nl).toFixed(3)}`);
  assert.ok(Math.abs(db / (nd * N) - 24) < 1.5, `B channel shift ${(db / (nd * N)).toFixed(1)} (8 units per degC)`);
  assert.ok(pb / pa > 0.4 && pb / pa < 0.6, `precipitation ratio ${(pb / pa).toFixed(3)}`);
  // the drought reference adapts over decades, so an abrupt drying shows up as drought
  assert.ok(dbb / da > 1.5, `drought index ${(dbb / da).toFixed(2)}x after 150 days of halved precipitation`);
  console.log(`# anomaly test: precip ratio ${(pb / pa).toFixed(3)}, drought x${(dbb / da).toFixed(2)}, anomalyFn calls ${calls}`);
});

test('ClimateLog: decades beyond 300 years, lookup, truncate, serialize', () => {
  const B = 2592, log = new ClimateLog(B, 300);
  const T = new Int16Array(B), P = new Uint16Array(B), DM = new Uint8Array(B), SW = new Uint8Array(B), HW = new Uint8Array(B);
  for (let y = -55; y < 600; y++) {
    T.fill(y); P.fill(500 + (y % 7)); DM.fill(1); SW.fill(y % 2 === 0 ? 1 : 0); HW.fill(2);
    log.pushYear(y, 0, T, P, DM, SW, HW);
  }
  const e = log.export();
  assert.ok(e.years.year.length <= 300 && e.years.year.length > 290);
  assert.equal(e.years.year.at(-1), 599);
  assert.equal(e.decades.year[0], -60);
  assert.equal(e.decades.nYears[0], 5); // -55..-51
  const g = log.get(105, 17);
  assert.equal(g.kind, 'decade'); assert.equal(g.year, 100); assert.equal(g.nYears, 10);
  assert.equal(g.droughtMonths, 10); assert.equal(g.severeWinter, 5); assert.equal(g.heatwaves, 20);
  assert.equal(g.meanT, 10.5); // mean of 10.0..10.9 degC, stored at 0.1 degC
  assert.equal(log.get(598, 0).kind, 'year');
  const s = log.serialize();
  const r = ClimateLog.deserialize(JSON.parse(JSON.stringify(s.meta)), s.buffers);
  assert.deepEqual(r.export(), log.export());
  r.truncateFrom(550);
  assert.equal(r.export().years.year.at(-1), 549);
  assert.equal(r.get(560, 0), null);
});
