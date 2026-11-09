// Climate behaviour of the daily weather simulator over a 4-year run on synthetic normals:
// Siberian snow, Sahara without snow, monthly temperature and precipitation vs. normals,
// events and climateLog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { synthNormals, regionCells, N, LAND } from './weather-fixtures.mjs';
import { createWeather, fromDate, EVENT_TYPES, cellOf, boxOfCell, LOG_PARTIAL } from '../src/sim/weather/core.js';
import { DETECTORS } from '../src/sim/weather/events.js';

const YEARS = 4;
const n = synthNormals();
const start = fromDate(1900, 1, 1);
const end = fromDate(1900 + YEARS, 1, 1);
const sim = createWeather({ normals: n, mask: n.mask, seed: 2026, t: start });
const L = sim.landIdx.length;
const W8 = new Float64Array(L);
for (let k = 0; k < L; k++) W8[k] = Math.cos(((90 - (sim.landY[k] + 0.5) * 0.5) * Math.PI) / 180);

const sib = regionCells(n, { lat0: 55, lat1: 68, lon0: 70, lon1: 130, maxElev: 800 });
const sah = regionCells(n, { lat0: 18, lat1: 27, lon0: -8, lon1: 30, maxElev: 400 });
const sibK = Array.from(sib, c => sim.landK[c]), sahK = Array.from(sah, c => sim.landK[c]);

// collectors
const tSum = new Float64Array(12 * L), tDays = new Float64Array(12);
const pSim = new Float64Array(N), pNorm = new Float64Array(N);
const snapshots = {}; // 'YYYY-MM-DD' -> {swe, cover, snowy}
let sahSnowCellDays = 0, sahWetCellDays = 0, sahMaxR = 0;
const events = [];
const dayInfo = {};

const t0 = performance.now();
for (let t = start + 1; t <= end; t++) {
  const f = sim.step(t);
  const { year, month, day } = f.date, mi = month - 1;
  for (const e of f.events) events.push({ ...e, at: t });
  // monthly mean temperature per land cell
  const TL = sim.TL;
  for (let k = 0; k < L; k++) tSum[mi * L + k] += TL[k];
  tDays[mi]++;
  // precipitation balance
  const dim = new Date(Date.UTC(2001, month, 0)).getUTCDate() + (month === 2 && year % 4 === 0 ? 1 : 0);
  const mo = mi * N, pr = sim.precip;
  for (let c = 0; c < N; c++) { pSim[c] += pr[c]; pNorm[c] += n.prec[mo + c] / dim; }
  // Sahara lowlands: never snow
  for (let i = 0; i < sahK.length; i++) {
    if (sim.swe[sahK[i]] > 0) sahSnowCellDays++;
    if (pr[sah[i]] > 0) sahWetCellDays++;
    sahMaxR = Math.max(sahMaxR, f.grid[sah[i] * 4]);
  }
  if (day === 15) {
    let s = 0, cov = 0, snowy = 0;
    for (let i = 0; i < sibK.length; i++) {
      const w = sim.swe[sibK[i]];
      s += w; if (f.grid[sib[i] * 4] >= 128) cov++; if (w > 1) snowy++;
    }
    snapshots[`${year}-${String(month).padStart(2, '0')}`] = { swe: s / sibK.length, cover: cov / sibK.length, snowy: snowy / sibK.length };
  }
}
const runMs = performance.now() - t0;
dayInfo.ms = runMs / (end - start);

test('setup sanity', () => {
  assert.ok(sib.length > 1000, `Siberian lowland cells: ${sib.length}`);
  assert.ok(sah.length > 200, `Saharan lowland cells: ${sah.length}`);
  console.log(`# geography: ${n.real ? 'baked map' : 'procedural'}; ${YEARS}-year run ${(runMs / 1000).toFixed(1)} s (${dayInfo.ms.toFixed(2)} ms/day incl. test bookkeeping)`);
});

test('Siberian snow builds up through winter and is gone by mid-July', () => {
  for (let y = 1900; y < 1900 + YEARS; y++) {
    const feb = snapshots[`${y}-02`], jul = snapshots[`${y}-07`];
    assert.ok(feb.swe > 20, `${y}-02-15 mean SWE ${feb.swe.toFixed(1)} mm`);
    assert.ok(feb.cover > 0.85, `${y}-02-15 snow cover ${feb.cover.toFixed(2)}`);
    assert.ok(jul.snowy < 0.02, `${y}-07-15 snowy fraction ${jul.snowy.toFixed(3)}`);
    assert.equal(snapshots[`${y}-08`].snowy, 0);
  }
  for (let y = 1900; y < 1900 + YEARS - 1; y++) {
    const nov = snapshots[`${y}-11`].swe, jan = snapshots[`${y + 1}-01`].swe, mar = snapshots[`${y + 1}-03`].swe;
    assert.ok(nov < jan && jan < mar, `winter ${y}/${y + 1}: SWE Nov ${nov.toFixed(1)} < Jan ${jan.toFixed(1)} < Mar ${mar.toFixed(1)}`);
  }
});

test('never snow in the Sahara lowlands', () => {
  assert.ok(sahWetCellDays > 100, `some rain fell in the Sahara (${sahWetCellDays} wet cell-days)`);
  assert.equal(sahSnowCellDays, 0);
  assert.equal(sahMaxR, 0);
});

test('monthly mean temperature over 4 years matches the normals (+-1.5 degC)', () => {
  let rms = 0, wsum = 0, within = 0, cnt = 0;
  const lines = [];
  for (let m = 0; m < 12; m++) {
    let bias = 0, absd = 0, w = 0;
    for (let k = 0; k < L; k++) {
      const c = sim.landIdx[k];
      const diff = tSum[m * L + k] / tDays[m] - n.tavg[m * N + c] / 10;
      bias += diff * W8[k]; absd += Math.abs(diff) * W8[k]; w += W8[k];
      rms += diff * diff * W8[k]; wsum += W8[k];
      if (Math.abs(diff) <= 1.5) within++;
      cnt++;
    }
    lines.push(`${m + 1}: bias ${(bias / w).toFixed(2)} mean|d| ${(absd / w).toFixed(2)}`);
    assert.ok(Math.abs(bias / w) < 0.3, `month ${m + 1}: area-weighted land bias ${(bias / w).toFixed(2)} degC`);
    assert.ok(absd / w < 1.5, `month ${m + 1}: mean |sim - normal| ${(absd / w).toFixed(2)} degC`);
  }
  console.log('# monthly T vs normals (land):', lines.join('; '));
  console.log(`# area-weighted RMS ${Math.sqrt(rms / wsum).toFixed(2)} degC, ${((100 * within) / cnt).toFixed(1)} % of cell-months within +-1.5 degC`);
  assert.ok(Math.sqrt(rms / wsum) < 1.5, 'RMS of monthly means');
  assert.ok(within / cnt > 0.75, 'most cell-months within +-1.5 degC');
});

test('precipitation matches the normals on average', () => {
  let s = 0, nn = 0, sl = 0, nl = 0;
  for (let c = 0; c < N; c++) {
    const w = Math.cos(((90 - (((c / 720) | 0) + 0.5) * 0.5) * Math.PI) / 180);
    s += pSim[c] * w; nn += pNorm[c] * w;
    if (n.mask[c] === LAND) { sl += pSim[c] * w; nl += pNorm[c] * w; }
  }
  console.log(`# precipitation sim/normal: global ${(s / nn).toFixed(3)}, land ${(sl / nl).toFixed(3)}`);
  assert.ok(Math.abs(s / nn - 1) < 0.06, `global ratio ${(s / nn).toFixed(3)}`);
  assert.ok(Math.abs(sl / nl - 1) < 0.1, `land ratio ${(sl / nl).toFixed(3)}`);
});

test('extreme events: all types occur, well-formed, start/end pairs, visible duration', () => {
  const starts = new Map(), ends = new Map(), perType = {};
  for (const e of events) {
    assert.ok(EVENT_TYPES.includes(e.type), e.type);
    assert.ok(e.severity >= 1 && e.severity <= 5 && Number.isInteger(e.severity));
    assert.ok(Number.isInteger(e.cell) && e.cell >= 0 && e.cell < N);
    assert.equal(cellOf(e.lat, e.lon), e.cell);
    assert.ok(typeof e.name === 'string' && /[а-яё]/i.test(e.name), 'Russian name');
    assert.ok(e.t0 <= e.at && e.t1 >= e.t0);
    if (e.phase === 'start') { assert.ok(!starts.has(e.id), 'unique ids'); starts.set(e.id, e); perType[e.type] = (perType[e.type] || 0) + 1; assert.equal(e.ongoing, true); }
    else { assert.equal(e.phase, 'end'); assert.ok(starts.has(e.id), 'end after start'); ends.set(e.id, e); assert.equal(e.ongoing, false); }
  }
  for (const [id, e] of ends) {
    const s = starts.get(id);
    assert.equal(e.t0, s.t0); assert.equal(e.type, s.type); assert.equal(e.cell, s.cell);
    assert.ok(e.severity >= s.severity, 'severity is the peak');
    assert.ok(e.t1 - e.t0 >= 3, `${e.type} lasts ${e.t1 - e.t0} days`);
    const det = DETECTORS.find(d => d.type === e.type && e.subtype !== 'tropical');
    if (det && e.type !== 'wildfire') assert.ok(e.t1 - e.t0 >= det.minDur, `${e.type} stretched to >= ${det.minDur} days`);
  }
  const rates = Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, +(v / YEARS).toFixed(0)]));
  console.log('# events per year:', JSON.stringify(rates));
  for (const ty of EVENT_TYPES) assert.ok(perType[ty] > 0, `${ty} occurred`);
  for (const ty of EVENT_TYPES) assert.ok(perType[ty] / YEARS < 400, `${ty} not spammy`);
  const tropical = [...ends.values()].filter(e => e.subtype === 'tropical');
  assert.ok(tropical.length > 10 && tropical.every(e => Array.isArray(e.track) && e.track.length >= 4));
});

test('climateLog: annual records per 5-degree box with plausible values', () => {
  const log = sim.getClimateLog();
  assert.deepEqual(Array.from(log.years.year), [1900, 1901, 1902, 1903]);
  assert.ok(Array.from(log.years.flags).every(f => (f & LOG_PARTIAL) === 0));
  const B = log.count;
  assert.equal(B, 72 * 36);
  assert.equal(log.years.meanT.length, 4 * B);
  const sahara = boxOfCell(cellOf(22.5, 12.5)), siberia = boxOfCell(cellOf(62.5, 102.5));
  for (let i = 0; i < 4; i++) {
    const tS = log.years.meanT[i * B + sahara] / 10, tY = log.years.meanT[i * B + siberia] / 10;
    assert.ok(tS > 15 && tS < 35, `Sahara box mean T ${tS}`);
    assert.ok(tY < 2, `Siberia box mean T ${tY}`);
    assert.ok(log.years.totalP[i * B + siberia] > 100, 'Siberia precipitation');
  }
  let dm = 0, sw = 0, hw = 0;
  for (let i = 0; i < 4 * B; i++) { dm += log.years.droughtMonths[i]; sw += log.years.severeWinter[i]; hw += log.years.heatwaves[i]; }
  console.log(`# climateLog totals: drought months ${dm}, severe winters ${sw}, heatwave box-hits ${hw}`);
  assert.ok(dm > 0 && sw > 0 && hw > 0);
  const r = sim.climateAt(1901, siberia);
  assert.equal(r.kind, 'year'); assert.equal(r.year, 1901);
});
