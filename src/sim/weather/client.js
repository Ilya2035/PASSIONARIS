// Main-thread wrapper of the weather worker: a promise API over the message protocol
// (worker-host.js). Big buffers are transferred, never copied twice.
//
//   import { WeatherClient } from '../sim/weather/client.js';
//   const wx = new WeatherClient();
//   const f0 = await wx.init({ normals, mask, seed: 7, t });  // normals: {tavg, prec, elev} or raw ArrayBuffer
//   const f = await wx.step(t);    // {t, day, date, grid: Uint8Array(720*360*4), events: [...]}
//   texture.image.data.set(f.grid); texture.needsUpdate = true;
//   wx.release(f.grid);             // optional: give the buffer back to the worker (no allocation next step)
//   const snap = await wx.serialize(); ... await wx.deserialize(snap);

export class WeatherClient {
  /**
   * @param {object} [o]
   * @param {Worker|object} [o.worker] a ready worker (e.g. a custom entry with a static anomalyFn);
   *   any object with postMessage/onmessage works (tests use an in-process fake).
   */
  constructor({ worker = null } = {}) {
    this.worker = worker ?? new Worker(new URL('./weather.worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.onmessage = e => {
      const { id, ok, result, error } = e.data || {};
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error));
    };
    this.worker.onerror = e => {
      const err = new Error(`weather worker error: ${e?.message ?? e}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  /** True while a request is in flight (e.g. skip a step request on a slow frame). */
  get busy() { return this.pending.size > 0; }

  #call(cmd, args = {}, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, cmd, args }, transfer);
    });
  }

  /**
   * Start the simulator.
   * @param {object} o
   * @param {{tavg:Int16Array, prec:Uint16Array, elev:Int16Array}|ArrayBuffer} o.normals docs/ENGINE.md normals (or the raw decompressed normals.bin + o.normalsHeader)
   * @param {number} [o.seed=1]
   * @param {number} [o.t=0] game time in days since -4999-01-01
   * @param {Uint8Array} [o.mask] SIM-grid mask (0 ocean, 1 lake, 2 land), e.g. maskFromCells(cells)
   * @param {Float32Array|Uint8Array} [o.veg] fuel 0..1 / 0..255
   * @param {object} [o.options] see core.js DEFAULT_OPTIONS
   * @param {string} [o.anomalyModule] URL of a module with regionalDT/precipFactor (imported inside the worker)
   * @param {object} [o.anomalyExports] export names, {dT: 'regionalDT' | ['globalDT', 'regionalDT'], precipFactor}
   * @param {object} [o.snapshot] start from a saved snapshot instead of climatology
   * @param {boolean} [o.transfer=false] transfer (not copy) the normals' buffers; the caller loses them
   */
  init({ normals, normalsHeader, seed = 1, t = 0, mask, veg, options, anomalyModule, anomalyExports, snapshot, transfer = false }) {
    const tr = [];
    if (transfer) {
      if (normals instanceof ArrayBuffer) tr.push(normals);
      else for (const k of ['tavg', 'prec', 'elev']) if (normals?.[k]?.buffer) tr.push(normals[k].buffer);
    }
    const tl = [...new Set(tr)];
    return this.#call('init', { normals, normalsHeader, seed, t, mask, veg, options, anomalyModule, anomalyExports, snapshot }, tl);
  }

  /** Advance to game time t. Resolves to {t, day, date, grid, events}. */
  step(t) { return this.#call('step', { t }); }

  /** Last frame without advancing. */
  current() { return this.#call('current'); }

  /** Give a grid buffer from a previous frame back to the worker's pool (do not use it afterwards). */
  release(grid) {
    const buffer = grid?.buffer ?? grid;
    if (buffer instanceof ArrayBuffer && buffer.byteLength) this.worker.postMessage({ id: 0, cmd: 'release', args: { buffer } }, [buffer]);
  }

  /** Snapshot for saves: {version, kind, meta, buffers: {name: ArrayBuffer}}. */
  serialize() { return this.#call('serialize'); }

  /** Restore a snapshot (made with the same normals and mask). Set transfer to hand over its buffers. */
  deserialize(snapshot, { transfer = false } = {}) {
    return this.#call('deserialize', { snapshot }, transfer ? Object.values(snapshot.buffers) : []);
  }

  /** Point info for tooltips: {temp, normalTemp, precip, swe, snowCover, ice, drought, fireDanger, ...}. */
  query(cell) { return this.#call('query', { cell }); }
  queryLatLon(lat, lon) { return this.#call('query', { lat, lon }); }

  /** Full SIM-grid field: 'temp' | 'precip' | 'swe' | 'ice' | 'drought' | 'fire' | 'mask' | 'grid'. */
  field(name) { return this.#call('field', { name }); }

  /** climateLog arrays (see climatelog.js). */
  climateLog() { return this.#call('climateLog'); }

  dispose() {
    const p = this.#call('dispose').catch(() => {});
    if (typeof this.worker.terminate === 'function') p.then(() => this.worker.terminate());
    return p;
  }
}
