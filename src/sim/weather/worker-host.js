// Message protocol of the weather worker. Kept separate from weather.worker.js so a custom
// worker entry can install it with a statically imported anomaly function, e.g.
//
//   // my-weather.worker.js
//   import { installWeatherWorker } from './weather/worker-host.js';
//   import { makeAnomalyFn } from './climate/anomaly.js';
//   installWeatherWorker(self, { makeAnomalyFn });   // called with the normals on init
// (or a ready function: installWeatherWorker(self, { anomalyFn: (year, lat, lon) => ({ dT, precipFactor }) }))
//
// Requests:  {id, cmd, args}            Responses: {id, ok: true, result} | {id, ok: false, error}
// Commands:
//   init        {normals | normals: ArrayBuffer (+normalsHeader), seed, t, mask?, veg?, options?,
//                anomalyModule?: url (exports makeAnomalyFn(normals) | anomaly | regionalDT + precipFactor),
//                anomalyExports?: {dT: name | name[], precipFactor: name}, snapshot?}
//               -> frame
//   step        {t} -> frame {t, day, date, grid: Uint8Array (transferred), events}
//   current     {} -> frame without advancing
//   serialize   {} -> snapshot {version, kind, meta, buffers} (buffers transferred)
//   deserialize {snapshot} -> frame
//   options     {maxSimDays} -> current options (run-time pacing, see core.js setOptions)
//   query       {cell} | {lat, lon} -> point info
//   field       {name} -> typed array (transferred)
//   climateLog  {} -> climateLog arrays (transferred)
//   release     {buffer} -> returns a grid buffer to the worker's pool (no response needed)
//   dispose     {} -> true

import { createWeather } from './core.js';
import { N, parseNormals } from './grid.js';

/**
 * Build an anomalyFn(year, lat, lon) from a module namespace. Without explicit names it prefers
 * makeAnomalyFn(normals) (src/sim/climate/anomaly.js), then anomaly(), then regionalDT +
 * precipFactor (src/sim/climate/paleo.js).
 */
export function anomalyFromModule(mod, names = {}, normals = null) {
  const explicit = names && (names.dT || names.precipFactor);
  if (!explicit && typeof mod.makeAnomalyFn === 'function' && normals) return mod.makeAnomalyFn(normals);
  if (!explicit && typeof mod.anomaly === 'function') return mod.anomaly;
  names = names || {};
  const dTNames = [].concat(names.dT ?? 'regionalDT').filter(n => typeof mod[n] === 'function');
  const pfName = names.precipFactor ?? 'precipFactor';
  const pf = typeof mod[pfName] === 'function' ? mod[pfName] : null;
  return (year, lat, lon) => {
    let dT = 0;
    for (const n of dTNames) dT += +mod[n](year, lat, lon) || 0;
    return { dT, precipFactor: pf ? pf(year, lat, lon) : 1 };
  };
}

/**
 * Install the protocol on a worker scope (`self` in a module worker, or any object with
 * onmessage/postMessage semantics).
 */
export function installWeatherWorker(scope, { anomalyFn = null, makeAnomalyFn = null } = {}) {
  let sim = null;
  const pool = [];
  let queue = Promise.resolve();

  const frame = r => {
    const buf = pool.pop() || new ArrayBuffer(N * 4);
    const grid = new Uint8Array(buf);
    grid.set(r.grid);
    return { result: { t: r.t, day: r.day, date: r.date, grid, events: r.events }, transfer: [buf] };
  };

  const handlers = {
    async init(a) {
      const normals = a.normals instanceof ArrayBuffer || ArrayBuffer.isView(a.normals) ? parseNormals(a.normals, a.normalsHeader) : a.normals;
      let fn = anomalyFn;
      if (makeAnomalyFn) fn = makeAnomalyFn(normals);
      if (a.anomalyModule) fn = anomalyFromModule(await import(/* @vite-ignore */ a.anomalyModule), a.anomalyExports, normals);
      sim = createWeather({
        normals, seed: a.seed ?? 1, t: a.t ?? 0, mask: a.mask ?? null, veg: a.veg ?? null,
        anomalyFn: fn, options: a.options ?? {}, deferInit: !!a.snapshot,
      });
      if (a.snapshot) sim.deserialize(a.snapshot);
      return frame(sim.current(a.snapshot ? sim.day : a.t ?? 0));
    },
    step: a => frame(sim.step(a.t)),
    current: () => frame(sim.current()),
    serialize() {
      const s = sim.serialize();
      return { result: s, transfer: Object.values(s.buffers) };
    },
    deserialize(a) {
      sim.deserialize(a.snapshot);
      return frame(sim.current());
    },
    options: a => ({ result: sim.setOptions(a) }),
    query: a => ({ result: a.cell != null ? sim.query(a.cell) : sim.queryLatLon(a.lat, a.lon) }),
    field(a) {
      const f = sim.getField(a.name);
      return { result: f, transfer: [f.buffer] };
    },
    climateLog() {
      const l = sim.getClimateLog(), transfer = [];
      for (const part of [l.years, l.decades]) for (const k in part) transfer.push(part[k].buffer);
      return { result: l, transfer };
    },
    release(a) {
      if (a.buffer instanceof ArrayBuffer && a.buffer.byteLength === N * 4 && pool.length < 4) pool.push(a.buffer);
      return null;
    },
    dispose() {
      sim = null;
      pool.length = 0;
      return { result: true };
    },
  };

  scope.onmessage = e => {
    const { id, cmd, args } = e.data || {};
    queue = queue.then(async () => {
      try {
        const h = handlers[cmd];
        if (!h) throw new Error(`weather worker: unknown command ${cmd}`);
        if (!sim && cmd !== 'init' && cmd !== 'release' && cmd !== 'dispose') throw new Error('weather worker: init first');
        const out = await h(args || {});
        if (out) scope.postMessage({ id, ok: true, result: out.result }, out.transfer || []);
      } catch (err) {
        scope.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
      }
    });
  };
  return { get sim() { return sim; } };
}
