// Extreme weather events (docs/ENGINE.md list):
//   snowstorm | heatwave | coldwave | drought | flood | storm | wildfire
//
// Box events are detected on the 5x5 deg boxes from daily box diagnostics computed by
// core.js (a "value" >= 1 means the condition holds; floor(value) is the severity 1..5).
// A condition must persist `minRun` days before an event starts; neighbouring boxes
// within `radius` join an existing event instead of spawning duplicates; an event ends
// once none of its boxes met the condition for `grace` days, but never before
// t0 + `minDur` days, so even short weather is visible at week-scale play.
//
// Tropical cyclones are explicit moving vortices (genesis per basin and season, westward
// track, recurvature, decay over land/cool water); they also inject rain into the coarse
// precipitation field. Wildfires are rare stochastic ignitions of hot, dry, vegetated cells.
//
// Each event is emitted twice: phase 'start' (t1 = earliest expected end, ongoing = true)
// and phase 'end' (final t1 and peak severity, ongoing = false). Same `id` in both.

import { BX, BY, BN, CX, CY, W, cellLat, cellLon, cellOf, boxOfCell, OCEAN } from './grid.js';
import { dayBase, cellHash, u01 } from './rng.js';

export const EVENT_TYPES = ['snowstorm', 'heatwave', 'coldwave', 'drought', 'flood', 'storm', 'wildfire'];
export const EVENT_NAMES_RU = {
  snowstorm: 'Снежная буря', heatwave: 'Аномальная жара', coldwave: 'Аномальный холод', drought: 'Засуха',
  flood: 'Наводнение', storm: 'Шторм', wildfire: 'Природный пожар',
};
export const TROPICAL_CYCLONE_RU = 'Тропический циклон';

/** Box detectors, in the order of core.js value planes. */
export const DETECTORS = [
  { type: 'snowstorm', minRun: 1, grace: 1, minDur: 3, radius: 1, cooldown: 2 },
  { type: 'heatwave', minRun: 3, grace: 1, minDur: 5, radius: 2, cooldown: 7 },
  { type: 'coldwave', minRun: 3, grace: 1, minDur: 5, radius: 2, cooldown: 7 },
  { type: 'drought', minRun: 30, grace: 20, minDur: 60, radius: 2, cooldown: 45 },
  { type: 'flood', minRun: 1, grace: 2, minDur: 5, radius: 1, cooldown: 5 },
  { type: 'storm', minRun: 1, grace: 1, minDur: 3, radius: 2, cooldown: 2 },
];
export const DET = Object.fromEntries(DETECTORS.map((d, i) => [d.type, i]));
const ND = DETECTORS.length;

// Tropical cyclone basins: genesis box, mean storms per year, peak month (1-12, fractional), season width (months).
const BASINS = [
  { lat0: 10, lat1: 22, lon0: -75, lon1: -25, rate: 12, peak: 9.0, width: 1.4 },  // North Atlantic
  { lat0: 10, lat1: 18, lon0: -125, lon1: -95, rate: 15, peak: 8.0, width: 1.5 }, // East Pacific
  { lat0: 6, lat1: 22, lon0: 125, lon1: 165, rate: 25, peak: 8.5, width: 2.3 },   // West Pacific
  { lat0: 8, lat1: 18, lon0: 84, lon1: 95, rate: 2, peak: 5.2, width: 0.7 },      // North Indian (pre-monsoon)
  { lat0: 8, lat1: 18, lon0: 82, lon1: 95, rate: 3, peak: 10.8, width: 0.9 },     // North Indian (post-monsoon)
  { lat0: -18, lat1: -8, lon0: 50, lon1: 100, rate: 10, peak: 1.8, width: 1.5 },  // South Indian
  { lat0: -20, lat1: -10, lon0: 120, lon1: 180, rate: 10, peak: 2.0, width: 1.4 }, // Australia / South Pacific
];
for (const b of BASINS) {
  let s = 0;
  for (let m = 1; m <= 12; m++) s += seasonWeight(b, m) * 30.44;
  b.norm = b.rate / s;
}
function seasonWeight(b, m) {
  let d = Math.abs(m - b.peak);
  d = Math.min(d, 12 - d);
  return Math.exp(-0.5 * (d / b.width) ** 2);
}
// peak category distribution (tropical storm .. category 5)
const CAT_CDF = [0.48, 0.73, 0.86, 0.96, 1.0];
const MAX_CYCLONES = 40, MAX_FIRES = 80;

const sevOf = v => (v >= 5 ? 5 : v < 1 ? 1 : Math.floor(v));

export class EventEngine {
  constructor(seed) {
    this.seed = seed >>> 0;
    // per detector: run length, attached event slot+1, last day on, cooldown-until, last event id
    this.run = new Uint16Array(ND * BN);
    this.slot = new Uint16Array(ND * BN);
    this.lastOn = new Int32Array(ND * BN);
    this.cool = new Int32Array(ND * BN).fill(-2147483648);
    this.lastEvt = new Int32Array(ND * BN).fill(-1);
    this.fireCool = new Int32Array(BN).fill(-2147483648);
    this.val = new Float32Array(ND * BN);   // today's values (input, not state)
    this.valCell = new Int32Array(ND * BN); // location of each value (input)
    this.slots = [];
    this.active = [];
    this.nextId = 1;
    this.out = [];
    this.onAttach = null; // (detectorIndex, box, ev) => void, set by core
  }

  // ------------------------------------------------------------ helpers
  #alloc(ev) {
    let s = this.slots.indexOf(null);
    if (s < 0) { s = this.slots.length; this.slots.push(null); }
    if (s >= 65534) return null;
    this.slots[s] = ev; ev.slot = s;
    this.active.push(ev);
    return ev;
  }
  #free(ev) {
    this.slots[ev.slot] = null;
    const i = this.active.indexOf(ev);
    if (i >= 0) this.active.splice(i, 1);
  }
  #emit(ev, phase) {
    const msg = {
      id: ev.id, type: ev.type, phase, t0: ev.t0, t1: phase === 'end' ? ev.t1 : ev.t1est,
      cell: ev.cell, lat: cellLat((ev.cell / W) | 0), lon: cellLon(ev.cell % W),
      severity: phase === 'end' ? sevOf(ev.peak) : sevOf(ev.sev0), ongoing: phase !== 'end',
      name: ev.subtype === 'tropical' ? TROPICAL_CYCLONE_RU : EVENT_NAMES_RU[ev.type],
    };
    if (ev.subtype) msg.subtype = ev.subtype;
    if (ev.track && phase === 'end') {
      msg.track = ev.track.slice();
      msg.peakCell = ev.peakCell;
      msg.peakLat = cellLat((ev.peakCell / W) | 0); msg.peakLon = cellLon(ev.peakCell % W);
    }
    this.out.push(msg);
  }
  #newEvent(type, k, day, t0, cell, v, minDur, extra) {
    const ev = { id: this.nextId++, type, k, t0, t1est: Math.max(day, t0 + minDur), t1: 0, cell, sev0: v, peak: v, last: day, slot: -1, ...extra };
    if (!this.#alloc(ev)) { this.nextId--; return null; }
    this.#emit(ev, 'start');
    return ev;
  }
  #end(ev, t1) {
    ev.t1 = t1;
    this.#emit(ev, 'end');
    if (ev.k >= 0) {
      const o = ev.k * BN, tag = ev.slot + 1, cd = DETECTORS[ev.k].cooldown;
      for (let b = 0; b < BN; b++) if (this.slot[o + b] === tag) { this.slot[o + b] = 0; this.cool[o + b] = t1 + cd; }
    }
    this.#free(ev);
  }

  // ------------------------------------------------------------ box detectors
  /** Run all box detectors for `day` on this.val / this.valCell. */
  boxes(day) {
    const { run, slot, lastOn, cool, val, valCell, slots } = this;
    for (let k = 0; k < ND; k++) {
      const det = DETECTORS[k], o = k * BN;
      for (let b = 0; b < BN; b++) {
        const i = o + b, v = val[i];
        if (v >= 1) { if (run[i] < 65535) run[i]++; } else run[i] = 0;
        const s = slot[i];
        if (s) {
          const ev = slots[s - 1];
          if (v >= 1) { lastOn[i] = day; ev.last = day; if (v > ev.peak) ev.peak = v; } else if (day - lastOn[i] > det.grace) slot[i] = 0;
        } else if (v >= 1 && run[i] >= det.minRun && day >= cool[i]) {
          let ev = this.#neighbour(k, b, det.radius);
          if (!ev) ev = this.#newEvent(det.type, k, day, day - run[i] + 1, valCell[i], v, det.minDur, null);
          if (!ev) continue;
          slot[i] = ev.slot + 1; lastOn[i] = day; ev.last = day;
          if (v > ev.peak) ev.peak = v;
          if (this.lastEvt[i] !== ev.id) { this.lastEvt[i] = ev.id; this.onAttach?.(k, b, ev); }
        }
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ev = this.active[i];
      if (ev.k < 0) continue;
      const det = DETECTORS[ev.k];
      if (day - ev.last > det.grace && day >= ev.t0 + det.minDur) this.#end(ev, Math.max(ev.last + 1, ev.t0 + det.minDur));
    }
  }

  #neighbour(k, b, r) {
    const bx = b % BX, by = (b / BX) | 0, o = k * BN;
    for (let d = 1; d <= r; d++) {
      for (let dy = -d; dy <= d; dy++) {
        const y = by + dy;
        if (y < 0 || y >= BY) continue;
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const x = (bx + dx + BX) % BX, s = this.slot[o + y * BX + x];
          if (s) return this.slots[s - 1];
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------ wildfires
  /**
   * @param day
   * @param {Int32Array} candCell ignition candidate cells (from the cell loop)
   * @param {Float32Array} candFD  their fire danger 0..1
   * @param n number of candidates
   * @param {Float64Array} boxRain today's box-mean precipitation, mm
   */
  fires(day, candCell, candFD, n, boxRain) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ev = this.active[i];
      if (ev.type !== 'wildfire') continue;
      const b = boxOfCell(ev.cell);
      if (day >= ev.minEnd && (boxRain[b] > 2.5 || day >= ev.maxEnd)) this.#end(ev, day);
    }
    let nf = 0;
    for (const ev of this.active) if (ev.type === 'wildfire') nf++;
    for (let i = 0; i < n && nf < MAX_FIRES; i++) {
      const c = candCell[i], b = boxOfCell(c);
      if (day < this.fireCool[b]) continue;
      const fd = candFD[i];
      const v = 1 + 4 * Math.min(1, Math.max(0, (fd - 0.3) / 0.45));
      const sev = sevOf(v);
      const h = cellHash(dayBase(this.seed, day, 77), c);
      const minDur = 4 + 2 * sev + (h % 4);
      const ev = this.#newEvent('wildfire', -1, day, day, c, v, minDur, { minEnd: day + minDur, maxEnd: day + minDur + 6 + 3 * sev });
      if (!ev) break;
      this.fireCool[b] = day + 30;
      nf++;
    }
  }

  // ------------------------------------------------------------ tropical cyclones
  /**
   * Move existing cyclones and spawn new ones.
   * @param ctx {month (1-12, fractional ok), cls: Uint8Array mask, normalT(cell) -> degC today}
   */
  cyclones(day, ctx) {
    const seed = this.seed;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ev = this.active[i];
      if (ev.subtype !== 'tropical') continue;
      const cy = ev.cy;
      const h = cellHash(dayBase(seed, day, 31), ev.id);
      const jit = u01(h) - 0.5, jit2 = u01(cellHash(h, 7)) - 0.5;
      const north = cy.lat >= 0 ? 1 : -1;
      let u, v;
      if (Math.abs(cy.lat) < cy.recurve) { u = -5 + 3 * jit; v = (1.6 + 1.5 * jit2) * north; }
      else { u = 7 + 4 * jit; v = (3.5 + 2 * jit2) * north; }
      cy.lat += v * 0.776;
      cy.lon += (u * 0.776) / Math.max(0.2, Math.cos((cy.lat * Math.PI) / 180));
      if (cy.lon > 180) cy.lon -= 360; else if (cy.lon < -180) cy.lon += 360;
      cy.age++;
      const c = cellOf(cy.lat, cy.lon);
      const overLand = ctx.cls[c] !== OCEAN;
      const sst = ctx.normalT(c);
      if (overLand) cy.I *= 0.5;
      else if (sst < 24.5 || Math.abs(cy.lat) > 35) cy.I *= 0.72;
      else cy.I = Math.min(cy.cat, cy.I + Math.max(0.6, cy.cat / 2.5));
      ev.track.push(Math.round(cy.lat * 100) / 100, Math.round(cy.lon * 100) / 100);
      if (cy.I > ev.peak) { ev.peak = cy.I; ev.peakCell = c; }
      ev.last = day;
      if (cy.I < 0.45 || cy.age >= cy.life || Math.abs(cy.lat) > 55) this.#end(ev, Math.max(day, ev.t0 + 3));
    }
    let n = 0;
    for (const ev of this.active) if (ev.subtype === 'tropical') n++;
    for (let bi = 0; bi < BASINS.length && n < MAX_CYCLONES; bi++) {
      const B = BASINS[bi];
      const p = B.norm * seasonWeight(B, ctx.month);
      const h = cellHash(dayBase(seed, day, 40 + bi), 1);
      if (u01(h) >= p) continue;
      const lat = B.lat0 + (B.lat1 - B.lat0) * u01(cellHash(h, 2));
      const lon = B.lon0 + (B.lon1 - B.lon0) * u01(cellHash(h, 3));
      const c = cellOf(lat, lon);
      if (ctx.cls[c] !== OCEAN || ctx.normalT(c) < 25.5) continue;
      const r = u01(cellHash(h, 4));
      let cat = 1;
      while (cat < 5 && r > CAT_CDF[cat - 1]) cat++;
      const cy = { lat, lon, age: 0, cat, I: 0.6, life: 6 + (cellHash(h, 5) % 8), recurve: 22 + 8 * u01(cellHash(h, 6)) };
      const ev = this.#newEvent('storm', -1, day, day, c, 1, 4, { subtype: 'tropical', cy, track: [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100], peakCell: c });
      if (ev) { ev.peak = cy.I; n++; }
    }
  }

  /** Add the rain shields of active cyclones to a coarse precipitation-unit field (144x72). */
  cycloneRain(pc) {
    for (const ev of this.active) {
      if (ev.subtype !== 'tropical') continue;
      const cy = ev.cy;
      const fj = (90 - cy.lat) / (180 / CY) - 0.5, fi = (cy.lon + 180) / (360 / CX) - 0.5;
      const amp = 1.0 + 0.55 * cy.I, cl = Math.max(0.2, Math.cos((cy.lat * Math.PI) / 180));
      const j0 = Math.round(fj), i0 = Math.round(fi);
      for (let dj = -2; dj <= 2; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= CY) continue;
        for (let di = -3; di <= 3; di++) {
          const i = (((i0 + di) % CX) + CX) % CX;
          const dy = j - fj, dx = (i0 + di - fi) * cl;
          const w = Math.exp(-(dx * dx + dy * dy) / 1.5);
          if (w > 0.02) pc[j * CX + i] += amp * w;
        }
      }
    }
  }

  // ------------------------------------------------------------ lifecycle
  /** End every active event at t1 (used when the simulator jumps or rewinds). */
  endAll(t1) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ev = this.active[i];
      this.#end(ev, Math.max(ev.t0, Math.min(t1, ev.last + 1)));
    }
    this.run.fill(0); this.slot.fill(0);
  }

  takeOutput() {
    const o = this.out;
    this.out = [];
    return o;
  }

  serialize() {
    const box = new Int32Array(ND * BN * 5 + BN);
    let o = 0;
    for (const a of [this.run, this.slot, this.lastOn, this.cool, this.lastEvt]) { box.set(a, o); o += a.length; }
    box.set(this.fireCool, o);
    const active = this.active.map(ev => ({ ...ev, cy: ev.cy ? { ...ev.cy } : undefined, track: ev.track ? ev.track.slice() : undefined }));
    return { meta: { nextId: this.nextId, nSlots: this.slots.length, active }, buffers: { 'events.box': box.buffer } };
  }

  deserialize(meta, buffers) {
    const box = new Int32Array(buffers['events.box']);
    let o = 0;
    for (const a of [this.run, this.slot, this.lastOn, this.cool, this.lastEvt]) { a.set(box.subarray(o, o + a.length)); o += a.length; }
    this.fireCool.set(box.subarray(o, o + BN));
    this.nextId = meta.nextId;
    this.slots = new Array(meta.nSlots).fill(null);
    this.active = [];
    for (const e of meta.active) {
      const ev = { ...e };
      if (e.cy) ev.cy = { ...e.cy };
      if (e.track) ev.track = e.track.slice();
      for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
      this.slots[ev.slot] = ev;
      this.active.push(ev);
    }
    this.out = [];
  }
}

