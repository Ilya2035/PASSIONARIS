// climateLog: compact per-"province" (5x5 deg box, 72x36 = 2592 boxes) climate history.
//
// One record per simulated year and box:
//   meanT  Int16  mean temperature, degC*10 (land cells if the box has land, else water)
//   totalP Uint16 annual precipitation, mm (partial years are scaled to a full year)
//   droughtMonths Uint8  months whose box-mean drought index was >= 0.35
//   severeWinter  Uint8  1 if the winter (DJF north / JJA south) was severe
//   heatwaves     Uint8  heatwave events that touched the box
// plus per-record year (Int32) and flags (Uint8: 1 = synthetic (fast-forward estimate),
// 2 = partial year).
//
// The newest `annualCap` (300) years are kept annually; older years are merged into
// decade records (meanT/totalP averaged per year, counts summed, nYears stored).

import { BN } from './grid.js';

export const LOG_SYNTHETIC = 1, LOG_PARTIAL = 2;

const FIELDS = [
  ['meanT', Int16Array], ['totalP', Uint16Array], ['droughtMonths', Uint8Array], ['severeWinter', Uint8Array], ['heatwaves', Uint8Array],
];

function makeSet(cap, B) {
  const s = { year: new Int32Array(cap), flags: new Uint8Array(cap), nYears: new Uint8Array(cap) };
  for (const [k, C] of FIELDS) s[k] = new C(cap * B);
  return s;
}
function growSet(s, cap, B) {
  const n = makeSet(cap, B);
  n.year.set(s.year); n.flags.set(s.flags); n.nYears.set(s.nYears);
  for (const [k] of FIELDS) n[k].set(s[k]);
  return n;
}

export class ClimateLog {
  constructor(B = BN, annualCap = 300) {
    this.B = B;
    this.annualCap = annualCap;
    this.a = makeSet(annualCap + 12, B);
    this.nA = 0;
    this.dCap = 64;
    this.d = makeSet(this.dCap, B);
    this.nD = 0;
    this.acc = { T: new Float64Array(B), P: new Float64Array(B), DM: new Float64Array(B), SW: new Float64Array(B), HW: new Float64Array(B) };
  }

  get lastYear() {
    if (this.nA) return this.a.year[this.nA - 1];
    if (this.nD) return this.d.year[this.nD - 1] + 9;
    return null;
  }

  /** Append one year (arrays of length B). Records at or after `year` are dropped first. */
  pushYear(year, flags, T, P, DM, SW, HW) {
    const last = this.lastYear;
    if (last !== null && year <= last) this.truncateFrom(year);
    const i = this.nA++, B = this.B, o = i * B, a = this.a;
    a.year[i] = year; a.flags[i] = flags; a.nYears[i] = 1;
    a.meanT.set(T, o); a.totalP.set(P, o); a.droughtMonths.set(DM, o); a.severeWinter.set(SW, o); a.heatwaves.set(HW, o);
    while (this.nA > this.annualCap) this.#mergeOldest();
  }

  /** Append an already aggregated decade (used by fast-forward). Annual records are flushed first. */
  pushDecade(start, nYears, flags, T, P, DM, SW, HW) {
    this.flushAnnual();
    while (this.nD && this.d.year[this.nD - 1] > start) this.nD--;
    this.#addDecade(start, nYears, flags, T, P, DM, SW, HW);
  }

  /** Merge every annual record into decades. */
  flushAnnual() {
    while (this.nA) this.#mergeOldest();
  }

  /** Append a decade, or combine it with the last one if it has the same start. */
  #addDecade(start, k, flags, t, p, dm, sw, hw) {
    const B = this.B;
    if (this.nD && this.d.year[this.nD - 1] === start) {
      const i = this.nD - 1, o = i * B, d = this.d, n0 = d.nYears[i];
      for (let b = 0; b < B; b++) {
        d.meanT[o + b] = Math.round((d.meanT[o + b] * n0 + t[b] * k) / (n0 + k));
        d.totalP[o + b] = Math.round((d.totalP[o + b] * n0 + p[b] * k) / (n0 + k));
        d.droughtMonths[o + b] = Math.min(255, d.droughtMonths[o + b] + dm[b]);
        d.severeWinter[o + b] = Math.min(255, d.severeWinter[o + b] + sw[b]);
        d.heatwaves[o + b] = Math.min(255, d.heatwaves[o + b] + hw[b]);
      }
      d.nYears[i] = Math.min(255, n0 + k); d.flags[i] |= flags;
      return;
    }
    if (this.nD >= this.dCap) { this.dCap *= 2; this.d = growSet(this.d, this.dCap, B); }
    const i = this.nD++, o = i * B, d = this.d;
    d.year[i] = start; d.flags[i] = flags; d.nYears[i] = k;
    d.meanT.set(t, o); d.totalP.set(p, o); d.droughtMonths.set(dm, o); d.severeWinter.set(sw, o); d.heatwaves.set(hw, o);
  }

  #mergeOldest() {
    const a = this.a, B = this.B, dec = Math.floor(a.year[0] / 10);
    let k = 0, flags = 0;
    while (k < this.nA && Math.floor(a.year[k] / 10) === dec) { flags |= a.flags[k]; k++; }
    const { T, P, DM, SW, HW } = this.acc;
    T.fill(0); P.fill(0); DM.fill(0); SW.fill(0); HW.fill(0);
    for (let r = 0; r < k; r++) {
      const o = r * B;
      for (let b = 0; b < B; b++) {
        T[b] += a.meanT[o + b]; P[b] += a.totalP[o + b];
        DM[b] += a.droughtMonths[o + b]; SW[b] += a.severeWinter[o + b]; HW[b] += a.heatwaves[o + b];
      }
    }
    const t = new Int16Array(B), p = new Uint16Array(B), dm = new Uint8Array(B), sw = new Uint8Array(B), hw = new Uint8Array(B);
    for (let b = 0; b < B; b++) {
      t[b] = Math.round(T[b] / k); p[b] = Math.round(P[b] / k);
      dm[b] = Math.min(255, DM[b]); sw[b] = Math.min(255, SW[b]); hw[b] = Math.min(255, HW[b]);
    }
    this.#addDecade(dec * 10, k, flags, t, p, dm, sw, hw);
    // shift the annual section left by k
    a.year.copyWithin(0, k, this.nA); a.flags.copyWithin(0, k, this.nA); a.nYears.copyWithin(0, k, this.nA);
    for (const [f] of FIELDS) a[f].copyWithin(0, k * B, this.nA * B);
    this.nA -= k;
  }

  /** Drop every record for `year` and later (used on rewind / reload). */
  truncateFrom(year) {
    while (this.nA && this.a.year[this.nA - 1] >= year) this.nA--;
    if (!this.nA) while (this.nD && this.d.year[this.nD - 1] >= year) this.nD--;
  }

  /** Record for a year: {kind:'year'|'decade', year, nYears, flags, offset} or null. */
  find(year) {
    const a = this.a, d = this.d;
    if (this.nA && year >= a.year[0]) {
      let lo = 0, hi = this.nA - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (a.year[m] === year) return { kind: 'year', year, nYears: 1, flags: a.flags[m], index: m, set: a };
        if (a.year[m] < year) lo = m + 1; else hi = m - 1;
      }
      return null;
    }
    for (let i = this.nD - 1; i >= 0; i--) {
      if (year >= d.year[i] && year < d.year[i] + 10) return { kind: 'decade', year: d.year[i], nYears: d.nYears[i], flags: d.flags[i], index: i, set: d };
      if (d.year[i] + 10 <= year) break;
    }
    return null;
  }

  /** Values of one box for a year (or the decade containing it). */
  get(year, box) {
    const r = this.find(year);
    if (!r) return null;
    const o = r.index * this.B + box, s = r.set;
    return {
      kind: r.kind, year: r.year, nYears: r.nYears, synthetic: !!(r.flags & LOG_SYNTHETIC), partial: !!(r.flags & LOG_PARTIAL),
      meanT: s.meanT[o] / 10, totalP: s.totalP[o], droughtMonths: s.droughtMonths[o], severeWinter: s.severeWinter[o], heatwaves: s.heatwaves[o],
    };
  }

  /** Trimmed copies of all arrays, chronological: {boxes:{nx,ny}, decades:{...}, years:{...}}. */
  export() {
    const B = this.B;
    const cut = (s, n) => {
      const r = { year: s.year.slice(0, n), flags: s.flags.slice(0, n), nYears: s.nYears.slice(0, n) };
      for (const [k] of FIELDS) r[k] = s[k].slice(0, n * B);
      return r;
    };
    return { boxes: { nx: 72, ny: 36, degrees: 5 }, count: B, decades: cut(this.d, this.nD), years: cut(this.a, this.nA) };
  }

  serialize() {
    const e = this.export(), buffers = {};
    for (const part of ['decades', 'years'])
      for (const k of ['year', 'flags', 'nYears', ...FIELDS.map(f => f[0])]) buffers[`log.${part}.${k}`] = e[part][k].buffer;
    return { meta: { B: this.B, annualCap: this.annualCap, nA: this.nA, nD: this.nD }, buffers };
  }

  static deserialize(meta, buffers) {
    const log = new ClimateLog(meta.B, meta.annualCap);
    const fill = (set, part, n) => {
      set.year.set(new Int32Array(buffers[`log.${part}.year`]));
      set.flags.set(new Uint8Array(buffers[`log.${part}.flags`]));
      set.nYears.set(new Uint8Array(buffers[`log.${part}.nYears`]));
      for (const [k, C] of FIELDS) set[k].set(new C(buffers[`log.${part}.${k}`]));
      return n;
    };
    if (meta.nD > log.dCap) { log.dCap = 1 << Math.ceil(Math.log2(meta.nD)); log.d = makeSet(log.dCap, log.B); }
    log.nD = fill(log.d, 'decades', meta.nD);
    log.nA = fill(log.a, 'years', meta.nA);
    return log;
  }
}
