// Worker protocol (worker-host.js) driven through the main-thread client (client.js).
// Node has no Web Worker, so an in-process message channel with structuredClone + transfer
// stands in for it; the same code runs unchanged in a browser module worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { synthNormals, N } from './weather-fixtures.mjs';
import { installWeatherWorker, anomalyFromModule } from '../src/sim/weather/worker-host.js';
import { WeatherClient } from '../src/sim/weather/client.js';
import { createWeather, fromDate } from '../src/sim/weather/core.js';
import * as stub from './weather-paleo-stub.mjs';

/** A fake Worker pair: client side gets {postMessage, onmessage, terminate}, worker side a scope. */
function fakeWorker() {
  const scope = { onmessage: null, postMessage: null };
  const worker = {
    onmessage: null, onerror: null, terminated: false,
    postMessage(msg, transfer = []) {
      const data = structuredClone(msg, { transfer });
      setImmediate(() => scope.onmessage?.({ data }));
    },
    terminate() { this.terminated = true; },
  };
  scope.postMessage = (msg, transfer = []) => {
    const data = structuredClone(msg, { transfer });
    setImmediate(() => worker.onmessage?.({ data }));
  };
  installWeatherWorker(scope);
  return worker;
}

const n = synthNormals();
const t0 = fromDate(-2500, 3, 1);

test('client <-> worker: init, step, release, query, field, climateLog, serialize/deserialize', async () => {
  const wx = new WeatherClient({ worker: fakeWorker() });
  await assert.rejects(wx.step(t0), /init first/);
  const f0 = await wx.init({ normals: n, mask: n.mask, seed: 4, t: t0 });
  assert.equal(f0.day, t0);
  assert.ok(f0.grid instanceof Uint8Array && f0.grid.length === N * 4);
  assert.deepEqual([f0.date.year, f0.date.month, f0.date.day], [-2500, 3, 1]);

  // same results as the in-process simulator
  const local = createWeather({ normals: n, mask: n.mask, seed: 4, t: t0 });
  assert.deepEqual(f0.events, local.current().events, 'init-day events come with the init frame');
  const steps = [];
  for (let d = 1; d <= 10; d++) steps.push(wx.step(t0 + d)); // pipelined requests are served in order
  const frames = await Promise.all(steps);
  for (let d = 1; d <= 10; d++) {
    const lf = local.step(t0 + d);
    assert.deepEqual(frames[d - 1].grid, lf.grid);
    assert.deepEqual(frames[d - 1].events, lf.events);
  }
  // released buffers are transferred back (detached here) and reused by the worker
  const old = frames[0].grid;
  wx.release(old);
  assert.equal(old.byteLength, 0, 'buffer transferred to the worker');
  const f11 = await wx.step(t0 + 11);
  assert.equal(f11.grid.length, N * 4);
  local.step(t0 + 11);

  const q = await wx.queryLatLon(55.75, 37.6);
  assert.equal(q.kind, 'land');
  assert.deepEqual(q, local.queryLatLon(55.75, 37.6));
  const temp = await wx.field('temp');
  assert.ok(temp instanceof Float32Array && temp.length === N);
  const log = await wx.climateLog();
  assert.equal(log.count, 2592);

  // save / load through the worker
  const snap = await wx.serialize();
  assert.equal(snap.kind, 'passionaris.weather');
  const a = await wx.step(t0 + 40);
  const wx2 = new WeatherClient({ worker: fakeWorker() });
  const r0 = await wx2.init({ normals: n, mask: n.mask, snapshot: snap });
  assert.equal(r0.day, t0 + 11);
  const b = await wx2.step(t0 + 40);
  assert.deepEqual(b.grid, a.grid);
  // deserialize into a running worker too
  await wx.deserialize(snap);
  const c = await wx.step(t0 + 40);
  assert.deepEqual(c.grid, a.grid);
  await wx.dispose();
  await wx2.dispose();
});

test('worker imports paleo anomalies from a module URL (ENGINE.md paleo.js signatures)', async () => {
  const t1 = fromDate(-4000, 3, 1); // "green Sahara" in the stub
  const wx = new WeatherClient({ worker: fakeWorker() });
  const url = pathToFileURL(new URL('./weather-paleo-stub.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
  await wx.init({ normals: n, mask: n.mask, seed: 4, t: t1, anomalyModule: url, options: { events: false } });
  const local = createWeather({ normals: n, mask: n.mask, seed: 4, t: t1, anomalyFn: anomalyFromModule(stub), options: { events: false } });
  const plain = createWeather({ normals: n, mask: n.mask, seed: 4, t: t1, options: { events: false } });
  const f = await wx.step(t1 + 3), lf = local.step(t1 + 3), pf = plain.step(t1 + 3);
  assert.deepEqual(f.grid, lf.grid);
  const q = await wx.queryLatLon(60, 30);
  assert.ok(Math.abs(q.paleoDT - (-1 + 0.5 * Math.sin((60 * Math.PI) / 180))) < 0.05, `paleo dT ${q.paleoDT}`);
  assert.ok(Math.abs((await wx.queryLatLon(20, 10)).precipFactor - 1.8) < 1e-6);
  let diff = 0;
  for (let c = 0; c < N; c++) diff += f.grid[c * 4 + 2] - pf.grid[c * 4 + 2];
  assert.ok(diff / N < -2, 'colder than the modern normals');
  await wx.dispose();
});

test('anomalyFromModule: export names and summed dT parts', () => {
  const fn = anomalyFromModule(stub, { dT: ['globalDT', 'regionalDT'] });
  const r = fn(-4000, 0, 0);
  assert.equal(r.dT, -2);
  assert.equal(r.precipFactor, 1);
  const fn2 = anomalyFromModule({ anomaly: () => ({ dT: 7, precipFactor: 2 }) });
  assert.deepEqual(fn2(0, 0, 0), { dT: 7, precipFactor: 2 });
  const fn3 = anomalyFromModule({});
  assert.deepEqual(fn3(0, 0, 0), { dT: 0, precipFactor: 1 });
});

test('weather.worker.js in a real thread (worker_threads + Web Worker shim)', async () => {
  const { Worker } = await import('node:worker_threads');
  const w = new Worker(new URL('./weather-worker-shim.mjs', import.meta.url));
  await new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
  // Web Worker facade for the client
  const facade = {
    onmessage: null, onerror: null,
    postMessage: (msg, transfer = []) => w.postMessage(msg, transfer),
    terminate: () => w.terminate(),
  };
  w.on('message', data => facade.onmessage?.({ data }));
  w.on('error', e => facade.onerror?.(e));
  const wx = new WeatherClient({ worker: facade });
  const f0 = await wx.init({ normals: n, mask: n.mask, seed: 12, t: t0 });
  const local = createWeather({ normals: n, mask: n.mask, seed: 12, t: t0 });
  assert.deepEqual(f0.grid, local.current().grid);
  const times = [];
  let prev = f0;
  for (let d = 1; d <= 20; d++) {
    const s = performance.now();
    const f = await wx.step(t0 + d);
    times.push(performance.now() - s);
    wx.release(prev.grid);
    prev = f;
  }
  local.step(t0 + 20);
  assert.deepEqual(prev.grid, local.grid);
  times.sort((a, b) => a - b);
  console.log(`# real worker thread: day step round trip median ${times[10].toFixed(2)} ms`);
  await wx.dispose();
});

test('anomalyFromModule prefers makeAnomalyFn(normals) when given the normals', () => {
  let got = null;
  const mod = { makeAnomalyFn: nn => { got = nn; return () => ({ dT: 1, precipFactor: 3 }); }, regionalDT: () => 9 };
  const fn = anomalyFromModule(mod, undefined, n);
  assert.equal(got, n);
  assert.deepEqual(fn(0, 0, 0), { dT: 1, precipFactor: 3 });
  assert.equal(anomalyFromModule(mod, { dT: 'regionalDT' })(0, 0, 0).dT, 9, 'explicit names win');
});
