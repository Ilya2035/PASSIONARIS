// Weather × aerosols: the volcanic winter of the aerosol layer (src/sim/aerosols `cooling`, degC per latitude row)
// cools the daily weather itself (setCooling / the worker's 'cooling' message): more snow and sea ice, a colder
// year, at the daily pace and in fast-clock blocks; no cooling = bit-identical weather; saves keep their format and
// the cooling survives a load in the worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthNormals, LAND } from './weather-fixtures.mjs';
import { createWeather, fromDate, cellOf, W, H } from '../src/sim/weather/core.js';
import { installWeatherWorker } from '../src/sim/weather/worker-host.js';
import { WeatherClient } from '../src/sim/weather/client.js';
import { AerosolSim, AH, eruptionSources } from '../src/sim/aerosols/index.js';

const n = synthNormals();
const base = { normals: n, mask: n.mask };
const DEG = Math.PI / 180;
const md5 = a => createHash('md5').update(new Uint8Array(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength)).digest('hex');
const logHash = sim => {
  const l = sim.getClimateLog(), h = createHash('md5');
  for (const part of [l.years, l.decades]) for (const k of Object.keys(part).sort()) h.update(new Uint8Array(part[k].buffer));
  return h.digest('hex');
};
const rowLat = y => 90 - (y + 0.5) * 0.5;
const COOL_STEP = 0.05; // as src/game/world/weather.js: a change this large is sent to the worker

/**
 * One year of weather from 1815-01-01, optionally after a VEI 7 eruption at 40N on the first day. The aerosol layer
 * steps along and its cooling is handed to the weather the way the game does (only when it changed noticeably).
 * Returns the northern-hemisphere means over the year: land snow (SWE, mm), sea / lake ice area (cells x cos lat)
 * and the climate log's mean temperature of 1815.
 */
function year(stride, erupt) {
  const t0 = fromDate(1815, 1, 1);
  const sim = createWeather({ ...base, seed: 9, t: t0 });
  sim.setOptions({ stride });
  const aero = new AerosolSim({ t: t0 });
  if (erupt) for (const s of eruptionSources({ t: t0, lat: 40, lon: 20, vei: 7 })) aero.addSource(s);
  let sent = null, sends = 0, swe = 0, ice = 0, k = 0;
  const mask = sim.getField('mask');
  for (let d = stride; ; d += stride) {
    const t = Math.min(t0 + d, fromDate(1816, 1, 2));
    aero.advanceTo(t, { maxSteps: 4 * stride });
    const c = aero.cooling, on = c.some(v => v !== 0);
    let send = on ? !sent || c.some((v, y) => Math.abs(v - sent[y]) > COOL_STEP) : sent !== null;
    if (send) { sent = on ? c.slice() : null; sim.setCooling(sent); sends++; }
    sim.step(t);
    const sw = sim.getField('swe'), ic = sim.getField('ice');
    for (let y = 0; y < H / 2; y++) {
      const w = Math.cos(rowLat(y) * DEG);
      for (let x = 0, cc = y * W; x < W; x++, cc++) {
        if (mask[cc] === LAND) swe += sw[cc] * w;
        else if (ic[cc] >= 5) ice += w;
      }
    }
    k++;
    if (t >= fromDate(1816, 1, 2)) break;
  }
  const L = sim.getClimateLog().years, B = L.meanT.length / L.year.length, i = [...L.year].indexOf(1815);
  assert.ok(i >= 0, 'the climate log has 1815');
  let T = 0, wt = 0;
  for (let b = 0; b < B / 2; b++) { const w = Math.cos((87.5 - 5 * Math.floor(b / 72)) * DEG); T += L.meanT[i * B + b] / 10 * w; wt += w; }
  return { swe: swe / k, ice: ice / k, T: T / wt, sends, cool: aero.meanCooling(0, 90) };
}

for (const stride of [1, 8]) {
  test(`a VEI 7 eruption at 40N: the next year has more snow and sea ice and is colder (stride ${stride})`, () => {
    const a = year(stride, true), b = year(stride, false);
    const f = v => v.toFixed(2);
    console.log(`# stride ${stride}: NH snow ${f(a.swe / b.swe)}x, sea ice ${f(a.ice / b.ice)}x, mean T ${f(a.T)} vs ${f(b.T)} degC ` +
      `(${f(a.T - b.T)}), cooling at the end ${f(a.cool)} degC, ${a.sends} cooling messages`);
    assert.equal(b.sends, 0, 'no eruption: the weather never hears of cooling');
    assert.ok(a.sends > 5 && a.sends < 200, `cooling sent ${a.sends} times`);
    assert.ok(a.swe > b.swe * 1.05, `snow ${f(a.swe)} vs ${f(b.swe)}`);
    assert.ok(a.ice > b.ice * 1.05, `sea ice ${f(a.ice)} vs ${f(b.ice)}`);
    assert.ok(a.T < b.T - 0.5, `mean temperature ${f(a.T)} vs ${f(b.T)}`);
  });
}

test('without ash the weather is bit-identical (null, zeros, a cooling set and cleared again)', () => {
  const t0 = fromDate(1950, 11, 20);
  for (const stride of [1, 6]) {
    const a = createWeather({ ...base, seed: 31, t: t0 }), b = createWeather({ ...base, seed: 31, t: t0 });
    a.setOptions({ stride }); b.setOptions({ stride });
    const ea = [...a.current().events], eb = [...b.current().events];
    const cold = new Float32Array(AH).fill(-3);
    b.setCooling(null);
    b.setCooling(new Float32Array(AH));
    // steps of `stride` days, so the fast clock really simulates blocks
    for (let i = 1, d = stride; d <= 72; i++, d += stride) {
      if (i === 3) b.setCooling([0, 0]);
      if (i === 6) { b.setCooling(cold); assert.equal(b.query(cellOf(50, 10)).cooling, -3); b.setCooling(null); }
      ea.push(...a.step(t0 + d).events);
      eb.push(...b.step(t0 + d).events);
      assert.equal(md5(b.grid), md5(a.grid), `stride ${stride}, day ${d}`);
    }
    assert.deepEqual(b.dT, a.dT);
    assert.deepEqual(eb, ea);
    assert.equal(logHash(b), logHash(a));
    assert.deepEqual(b.query(cellOf(60, 90)), a.query(cellOf(60, 90)));
  }
});

test('cooling acts by latitude: rows are resampled, the B channel, the readout and the snow see it', () => {
  const t0 = fromDate(1900, 1, 10);
  const a = createWeather({ ...base, seed: 5, t: t0, options: { events: false } }), b = createWeather({ ...base, seed: 5, t: t0, options: { events: false } });
  // 1-degree rows: -4 degC north of 30N, nothing south of it
  const rows = new Float32Array(AH);
  for (let y = 0; y < AH; y++) rows[y] = 89.5 - y > 30.5 ? -4 : 89.5 - y < 29.5 ? 0 : -2;
  b.setCooling(rows);
  assert.equal(b.coolingRow(0), -4);
  assert.equal(b.coolingRow(H - 1), 0);
  assert.ok(Math.abs(b.coolingRow(119) + 2) < 1e-6, `row at 30.25N: ${b.coolingRow(119)}`); // between the -4 and the 0 row
  for (let d = 1; d <= 20; d++) { a.step(t0 + d); b.step(t0 + d); }
  const north = cellOf(55, 40), south = cellOf(-20, 25);
  const qa = a.query(north), qb = b.query(north);
  assert.equal(qb.cooling, -4);
  assert.equal(qb.paleoDT, qa.paleoDT, 'the paleo dT stays apart from the cooling');
  assert.ok(Math.abs(qb.temp - qa.temp + 4) < 1e-3, `temp ${qb.temp} vs ${qa.temp}`);
  assert.ok(qb.swe > qa.swe, `snow at 55N 40E: ${qb.swe} vs ${qa.swe}`);
  assert.deepEqual(b.query(south), a.query(south), 'south of 30N nothing changes');
  // B channel: the anomaly is 4 degC (32 units) colder in the north
  let dB = 0, cnt = 0;
  for (let y = 20; y < 100; y++) for (let x = 0; x < W; x += 7) { const c = y * W + x; dB += b.grid[c * 4 + 2] - a.grid[c * 4 + 2]; cnt++; }
  assert.ok(Math.abs(dB / cnt + 32) < 1.5, `mean B change ${dB / cnt}`);
});

test('saves: same format with and without cooling; the cooling is kept across deserialize and set again after a load', () => {
  const t0 = fromDate(1816, 2, 1);
  const rows = new Float32Array(AH).fill(-2.5);
  const plain = createWeather({ ...base, seed: 12, t: t0 });
  const a = createWeather({ ...base, seed: 12, t: t0 });
  a.setCooling(rows);
  for (let d = 1; d <= 30; d++) { a.step(t0 + d); plain.step(t0 + d); }
  const snap = a.serialize(), snapPlain = plain.serialize();
  assert.equal(snap.version, snapPlain.version);
  assert.deepEqual(Object.keys(snap.buffers).sort(), Object.keys(snapPlain.buffers).sort(), 'no new save sections');
  assert.deepEqual(Object.keys(snap.meta).sort(), Object.keys(snapPlain.meta).sort());
  const copy = () => ({ version: snap.version, kind: snap.kind, meta: JSON.parse(JSON.stringify(snap.meta)), buffers: Object.fromEntries(Object.entries(snap.buffers).map(([k, v]) => [k, v.slice(0)])) });
  // a fresh simulator loads it and gets the cooling again (as the game does after a load)
  const b = createWeather({ ...base, seed: 1, deferInit: true });
  b.deserialize(copy());
  b.setCooling(rows);
  // a running simulator that already had the cooling keeps it through deserialize
  const c = createWeather({ ...base, seed: 3, t: t0 + 400 });
  c.setCooling(rows);
  c.deserialize(copy());
  assert.equal(c.query(cellOf(50, 0)).cooling, -2.5);
  for (let d = 31; d <= 60; d++) { a.step(t0 + d); b.step(t0 + d); c.step(t0 + d); }
  assert.equal(md5(b.grid), md5(a.grid));
  assert.equal(md5(c.grid), md5(a.grid));
  assert.equal(logHash(b), logHash(a));
  // a load without the cooling continues differently (it is not in the save)
  const d0 = createWeather({ ...base, seed: 1, deferInit: true });
  d0.deserialize(copy());
  for (let d = 31; d <= 60; d++) d0.step(t0 + d);
  assert.notEqual(md5(d0.grid), md5(a.grid));
});

/** A fake Worker pair (structuredClone + transfer), as in weather-worker.test.mjs. */
function fakeWorker() {
  const scope = { onmessage: null, postMessage: null };
  const worker = {
    onmessage: null, onerror: null,
    postMessage(msg, transfer = []) { const data = structuredClone(msg, { transfer }); setImmediate(() => scope.onmessage?.({ data })); },
    terminate() {},
  };
  scope.postMessage = (msg, transfer = []) => { const data = structuredClone(msg, { transfer }); setImmediate(() => worker.onmessage?.({ data })); };
  installWeatherWorker(scope);
  return worker;
}

test('worker protocol: the cooling message reaches the simulator before the next step and survives a load', async () => {
  const t0 = fromDate(1816, 1, 5);
  const rows = new Float32Array(AH);
  for (let y = 0; y < 60; y++) rows[y] = -3;
  const wx = new WeatherClient({ worker: fakeWorker() });
  await wx.init({ ...base, seed: 6, t: t0 });
  const local = createWeather({ ...base, seed: 6, t: t0 });
  const snap = await wx.serialize();
  wx.setCooling(rows);            // not awaited: messages are served in order
  local.setCooling(rows);
  for (let d = 1; d <= 6; d++) assert.deepEqual((await wx.step(t0 + d)).grid, local.step(t0 + d).grid);
  assert.equal((await wx.queryLatLon(60, 0)).cooling, -3);
  await wx.deserialize(snap);     // back to day 0: the worker still has the cooling, like a load in the game
  assert.equal((await wx.queryLatLon(60, 0)).cooling, -3);
  const again = createWeather({ ...base, seed: 6, t: t0 });
  again.setCooling(rows);
  assert.deepEqual((await wx.step(t0 + 3)).grid, again.step(t0 + 3).grid);
  await wx.setCooling(null);
  assert.equal((await wx.queryLatLon(60, 0)).cooling, 0);
  await wx.dispose();
});
