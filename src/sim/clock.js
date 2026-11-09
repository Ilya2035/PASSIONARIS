// Passionaris game clock (owner: time-save module, see docs/ENGINE.md).
//
// Deterministic fixed-step clock:
// - Game time advances in whole TICKS of one game hour (TICKS_PER_DAY = 24); `t = ticks / 24` days.
//   Real seconds are converted to ticks through a fractional accumulator, so the tick sequence is a pure
//   function of the sequence of advance(dt) calls, and the calendar sequence of day/month/year boundaries
//   is the same at any frame rate. Simulations should react to boundary events, not to raw dt.
// - Speeds 1..5 (0 = pause). The pace is data-driven per era: each era has a table of 5 rates in
//   game days per real second (see DEFAULT_SPEED_TABLE). An advance() that crosses an era start switches
//   rate exactly at the boundary.
// - Catch-up cap: a single advance() uses at most `maxRealDt` real seconds and at most `maxDaysPerAdvance`
//   game days; the excess is dropped (the game slows down instead of spiralling after a stall).
// - The world ends on 2100-12-31: the last tick is 2100-12-31 23:00, then the clock stops (`ended`).
//
// Events are emitted coarse-to-fine for the same instant: 'era' → 'year' → 'month' → 'day'.
// Listeners run synchronously inside advance(); if a listener pauses the clock, the clock stops right at the
// start of that day (remaining days of the frame are not processed). Event objects come from a pool and
// the array returned by advance() is reused: copy what you need, do not keep references across frames.

import { ERAS, T_END, MEAN_MONTH_DAYS, MEAN_YEAR_DAYS, daysInMonth, toDateInto, fromDate } from './calendar.js';

export const TICKS_PER_DAY = 24;
export const MAX_SPEED = 5;

const H = 1 / 24, D = 1, W = 7, M = MEAN_MONTH_DAYS, Y = MEAN_YEAR_DAYS;

/**
 * Game days per real second for speeds 1..5 in each era (era ids from src/sim/calendar.js ERAS).
 *
 * | era (from)                   | 1     | 2      | 3      | 4      | 5      |
 * |------------------------------|-------|--------|--------|--------|--------|
 * | ancient      (5000 BC)       | 1 wk  | 2 wk   | 1 mon  | 3 mon  | 1 yr   |
 * | antiquity    (2000 BC)       | 3 d   | 1 wk   | 2 wk   | 1 mon  | 3 mon  |
 * | medieval     (500)           | 1 d   | 3 d    | 1 wk   | 2 wk   | 1 mon  |
 * | early-modern (1500)          | 12 h  | 1 d    | 3 d    | 1 wk   | 2 wk   |
 * | industrial   (1800)          | 6 h   | 12 h   | 1 d    | 3 d    | 1 wk   |
 * | contemporary (1914)          | 2 h   | 6 h    | 12 h   | 1 d    | 3 d    |
 *
 * Default speed 3 in the ancient era = 1 mean month (30.436875 days) per second: a year in 12 s,
 * 1000 years in 200 min.
 */
export const DEFAULT_SPEED_TABLE = Object.freeze({
  ancient: Object.freeze([W, 2 * W, M, 3 * M, Y]),
  antiquity: Object.freeze([3 * D, W, 2 * W, M, 3 * M]),
  medieval: Object.freeze([D, 3 * D, W, 2 * W, M]),
  'early-modern': Object.freeze([12 * H, D, 3 * D, W, 2 * W]),
  industrial: Object.freeze([6 * H, 12 * H, D, 3 * D, W]),
  contemporary: Object.freeze([2 * H, 6 * H, 12 * H, D, 3 * D]),
});

export const DEFAULT_SPEED = 3;

/** Default clock eras: calendar eras + speed table. Pass your own list to createClock({eras}) to retune. */
export const DEFAULT_CLOCK_ERAS = Object.freeze(ERAS.map(e => Object.freeze({
  id: e.id, nameRu: e.nameRu, fromYear: e.fromYear, daysPerSecond: DEFAULT_SPEED_TABLE[e.id],
})));

const EVENT_TYPES = ['era', 'year', 'month', 'day', 'end', 'state'];

function normalizeEras(eras) {
  if (!Array.isArray(eras) || eras.length === 0) throw new TypeError('clock: eras must be a non-empty array');
  const out = eras.map((e, i) => {
    const t0 = e.t0 !== undefined ? e.t0 : fromDate(e.fromYear ?? -4999, 1, 1);
    const rates = e.daysPerSecond;
    if (!Number.isFinite(t0)) throw new TypeError(`clock: era #${i} has no valid start (fromYear or t0)`);
    if (!rates || rates.length !== MAX_SPEED || ![...rates].every(r => Number.isFinite(r) && r > 0)) {
      throw new TypeError(`clock: era #${i} needs daysPerSecond = ${MAX_SPEED} positive numbers`);
    }
    return {
      index: i, id: String(e.id ?? `era${i}`), nameRu: e.nameRu ?? String(e.id ?? ''),
      startTick: Math.floor(t0) * TICKS_PER_DAY, // eras start at a day boundary
      daysPerSecond: Float64Array.from(rates),
    };
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i].startTick <= out[i - 1].startTick) throw new TypeError('clock: eras must be sorted by start, strictly increasing');
  }
  return out;
}

/** Create a game clock. See GameClock for options. */
export function createClock(opts) {
  return new GameClock(opts);
}

export class GameClock {
  /**
   * @param {object} [o]
   * @param {number} [o.t0=0]                 start time (days since -4999-01-01), quantised to the hour
   * @param {Array}  [o.eras]                 [{id, nameRu?, fromYear|t0, daysPerSecond:[5]}], sorted
   * @param {number} [o.speed=3]              initial speed 1..5
   * @param {boolean}[o.paused=true]          start paused (Paradox-style)
   * @param {number} [o.tEnd=T_END]           exclusive end; the last tick is one hour before it
   * @param {number} [o.maxRealDt=0.25]       cap of real seconds consumed by one advance()
   * @param {number} [o.maxDaysPerAdvance=400] cap of game days processed by one advance()
   */
  constructor({ t0 = 0, eras = DEFAULT_CLOCK_ERAS, speed = DEFAULT_SPEED, paused = true, tEnd = T_END,
    maxRealDt = 0.25, maxDaysPerAdvance = 400 } = {}) {
    this._eras = normalizeEras(eras);
    this._endTick = Math.round(tEnd * TICKS_PER_DAY) - 1;
    this._maxRealDt = maxRealDt;
    this._maxDaysPerAdvance = Math.max(1, Math.floor(maxDaysPerAdvance));
    this._speed = speed >= 1 ? clampSpeed(speed) : DEFAULT_SPEED;
    this._paused = !!paused || !(speed >= 1); // speed 0 = start paused
    this._ended = false;
    this._gen = 0;         // bumped by every time jump / walk: a walk stops if a listener moved the clock
    this._pauseSeq = 0;    // bumped by every pause() call: a walk stops if a listener asked to pause
    this._ticks = 0;
    this._acc = 0;         // fractional ticks accumulated from real time
    this._eraIdx = 0;
    this._y = 0; this._m = 0; this._d = 0; // calendar date of the current day
    this.droppedSeconds = 0; // real seconds dropped by the catch-up caps (diagnostics)
    this._listeners = Object.create(null);
    for (const k of EVENT_TYPES) this._listeners[k] = [];
    this._out = [];
    this._pool = [];
    this._outN = 0;
    this._tmpDate = { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 };
    this.setTime(t0);
  }

  // ---------------------------------------------------------------- state
  /** Game time in days (hour-quantised). */
  get t() { return this._ticks / TICKS_PER_DAY; }
  /** Smooth game time for rendering: includes the fractional tick accumulated from real time. */
  get renderT() { return (this._ticks + (this.running ? this._acc : 0)) / TICKS_PER_DAY; }
  get ticks() { return this._ticks; }
  get speed() { return this._speed; }
  /** 0 while paused or ended, otherwise 1..5. */
  get effectiveSpeed() { return this.running ? this._speed : 0; }
  get paused() { return this._paused; }
  get ended() { return this._ended; }
  get running() { return !this._paused && !this._ended; }
  get year() { return this._y; }
  get month() { return this._m; }
  get day() { return this._d; }
  get hour() { return this._ticks % TICKS_PER_DAY; }
  /** Current clock era {index, id, nameRu, startTick, daysPerSecond}. */
  get era() { return this._eras[this._eraIdx]; }
  get eras() { return this._eras; }
  /** Current pace in game days per real second (0 when not running). */
  get daysPerSecond() { return this.running ? this._eras[this._eraIdx].daysPerSecond[this._speed - 1] : 0; }
  /** Pace of a given speed (1..5) in the current era, regardless of pause. */
  rateOf(speed) { return speed >= 1 ? this._eras[this._eraIdx].daysPerSecond[clampSpeed(speed) - 1] : 0; }
  get tEnd() { return (this._endTick + 1) / TICKS_PER_DAY; }

  // ---------------------------------------------------------------- control
  pause() { this._pauseSeq++; if (!this._paused) { this._paused = true; this._emitState(); } }
  resume() { if (this._paused && !this._ended) { this._paused = false; this._emitState(); } }
  togglePause() { if (this._paused) this.resume(); else this.pause(); }
  /**
   * 0 = pause (keeps the selected speed); 1..5 selects a speed without changing pause state.
   * Non-numeric input (NaN, undefined, 'abc') is ignored; values above 5 clamp to 5.
   */
  setSpeed(s) {
    const v = Math.round(Number(s));
    if (Number.isNaN(v)) return;
    if (v <= 0) { this.pause(); return; }
    const c = clampSpeed(v);
    if (c !== this._speed) { this._speed = c; this._emitState(); }
  }
  faster() { this.setSpeed(Math.min(MAX_SPEED, this._speed + 1)); }
  slower() { this.setSpeed(Math.max(1, this._speed - 1)); }

  /**
   * Jump to time t (no boundary events). Used by loading and debug tools.
   * Safe to call from a listener: the running advance()/stepDays() stops at the jump.
   */
  setTime(t) {
    if (!Number.isFinite(t)) throw new TypeError('clock.setTime: t must be a finite number');
    this._gen++;
    this._ticks = Math.min(this._endTick, Math.max(0, Math.round(t * TICKS_PER_DAY)));
    this._acc = 0;
    this._syncDate();
    this._ended = this._ticks >= this._endTick;
    if (this._ended) this._paused = true;
    this._emitState();
  }

  // ---------------------------------------------------------------- subscriptions
  /** Subscribe to 'day' | 'month' | 'year' | 'era' | 'end' | 'state'. Returns an unsubscribe function. */
  on(type, fn) {
    const list = this._listeners[type];
    if (!list) throw new RangeError(`clock.on: unknown event "${type}"`);
    if (typeof fn !== 'function') throw new TypeError('clock.on: listener must be a function');
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  onDay(fn) { return this.on('day', fn); }
  onMonth(fn) { return this.on('month', fn); }
  onYear(fn) { return this.on('year', fn); }
  onEra(fn) { return this.on('era', fn); }
  onEnd(fn) { return this.on('end', fn); }
  /** Pause/speed/time-jump changes, for HUD. */
  onState(fn) { return this.on('state', fn); }

  // ---------------------------------------------------------------- stepping
  /**
   * Advance by real seconds. Returns the (reused) array of boundary events crossed during this call:
   * {type:'era'|'year'|'month'|'day'|'end', t, year, month, day, era}. Valid until the next call.
   */
  advance(realDt) {
    this._beginOut();
    if (!this.running || !(realDt > 0)) return this._out;
    let rem = realDt;
    if (rem > this._maxRealDt) {
      if (Number.isFinite(rem)) this.droppedSeconds += rem - this._maxRealDt;
      rem = this._maxRealDt;
    }
    const start = this._ticks;
    const cap = Math.min(this._endTick, start + this._maxDaysPerAdvance * TICKS_PER_DAY);
    const eras = this._eras;
    const sIdx = this._speed - 1;
    let target = start, acc = this._acc, era = this._eraIdx;
    // integrate piecewise-constant pace across era starts
    for (let guard = 0; guard < 64 && rem > 0; guard++) {
      const rate = eras[era].daysPerSecond[sIdx] * TICKS_PER_DAY; // ticks per real second
      const nextStart = era + 1 < eras.length ? eras[era + 1].startTick : Infinity;
      const limit = Math.min(cap, nextStart);
      const want = acc + rem * rate;
      const whole = Math.floor(want);
      if (target + whole < limit) { target += whole; acc = want - whole; rem = 0; break; }
      rem -= (limit - target - acc) / rate; // real time needed to reach the limit
      target = limit; acc = 0;
      if (limit === cap) { if (rem > 0) this.droppedSeconds += rem; rem = 0; break; }
      era++;
    }
    this._acc = acc;
    if (target > start && !this._walkTo(target)) this._acc = 0;
    this._checkEnd();
    return this._out;
  }

  /** Advance exactly n game days (to the start of the n-th next day), ignoring real time and pause. */
  stepDays(n = 1) {
    this._beginOut();
    if (this._ended || !(n > 0)) return this._out;
    const target = Math.min(this._endTick, (Math.floor(this._ticks / TICKS_PER_DAY) + Math.floor(n)) * TICKS_PER_DAY);
    this._walkTo(target); // a listener calling pause() stops the walk at that day
    this._acc = 0;
    this._checkEnd();
    return this._out;
  }

  /** Advance by a number of ticks (hours), ignoring real time and pause. */
  stepHours(n = 1) {
    this._beginOut();
    if (this._ended || !(n > 0)) return this._out;
    this._walkTo(Math.min(this._endTick, this._ticks + Math.floor(n)));
    this._acc = 0;
    this._checkEnd();
    return this._out;
  }

  // ---------------------------------------------------------------- save / load
  serialize() {
    return { v: 1, ticks: this._ticks, acc: this._acc, speed: this._speed, paused: this._paused };
  }
  deserialize(s) {
    if (!s || s.v !== 1 || !Number.isInteger(s.ticks)) throw new TypeError('clock.deserialize: bad state');
    this._speed = s.speed >= 1 ? clampSpeed(s.speed) : DEFAULT_SPEED;
    this._paused = s.paused !== false;
    this.setTime(s.ticks / TICKS_PER_DAY); // exact: round((ticks / 24) * 24) === ticks
    this._acc = Number.isFinite(s.acc) && s.acc >= 0 && s.acc < 1 ? s.acc : 0;
    return this;
  }

  // ---------------------------------------------------------------- internals
  _syncDate() {
    const day = Math.floor(this._ticks / TICKS_PER_DAY);
    const x = toDateInto(day, this._tmpDate);
    this._y = x.year; this._m = x.month; this._d = x.day;
    let i = this._eras.length - 1;
    while (i > 0 && this._ticks < this._eras[i].startTick) i--;
    this._eraIdx = i;
  }

  // Walk day starts in (ticks, target]; returns false if a listener paused the clock, ended it or moved it
  // (setTime / a nested step) mid-way — the clock then stays where the listener left it.
  _walkTo(target) {
    const gen = ++this._gen, pauseSeq = this._pauseSeq;
    let next = (Math.floor(this._ticks / TICKS_PER_DAY) + 1) * TICKS_PER_DAY;
    while (next <= target) {
      this._ticks = next;
      // next calendar day, O(1)
      let newMonth = false, newYear = false;
      if (++this._d > daysInMonth(this._y, this._m)) {
        this._d = 1; newMonth = true;
        if (++this._m > 12) { this._m = 1; this._y++; newYear = true; }
      }
      const t = next / TICKS_PER_DAY;
      while (this._eraIdx + 1 < this._eras.length && next >= this._eras[this._eraIdx + 1].startTick) {
        this._eraIdx++;
        this._emit('era', t);
        if (this._gen !== gen) return false;
      }
      if (newYear) { this._emit('year', t); if (this._gen !== gen) return false; }
      if (newMonth) { this._emit('month', t); if (this._gen !== gen) return false; }
      this._emit('day', t);
      if (this._gen !== gen || this._pauseSeq !== pauseSeq || this._ended) return false;
      next += TICKS_PER_DAY;
    }
    this._ticks = target;
    return true;
  }

  _checkEnd() {
    if (!this._ended && this._ticks >= this._endTick) {
      this._ended = true;
      this._paused = true;
      this._emit('end', this._ticks / TICKS_PER_DAY);
      this._emitState();
    }
  }

  _beginOut() {
    this._out.length = 0;
    this._outN = 0;
  }

  _emit(type, t) {
    let ev = this._pool[this._outN];
    if (!ev) { ev = { type: '', t: 0, year: 0, month: 0, day: 0, era: null }; this._pool.push(ev); }
    this._outN++;
    ev.type = type; ev.t = t; ev.year = this._y; ev.month = this._m; ev.day = this._d;
    ev.era = this._eras[this._eraIdx];
    this._out.push(ev);
    const list = this._listeners[type];
    for (let i = 0; i < list.length; i++) list[i](ev, this);
  }

  _emitState() {
    const list = this._listeners.state;
    for (let i = 0; i < list.length; i++) list[i](this);
  }
}

// 1..MAX_SPEED for any number (Infinity → MAX_SPEED); callers filter NaN / non-positive values first.
function clampSpeed(s) {
  const v = Math.round(Number(s));
  return Number.isNaN(v) ? DEFAULT_SPEED : Math.min(MAX_SPEED, Math.max(1, v));
}

// ------------------------------------------------------------------ UI helpers
function pluralRu(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

const RATE_UNITS = [
  [Y, 'год', 'года', 'лет'],
  [M, 'месяц', 'месяца', 'месяцев'],
  [W, 'неделя', 'недели', 'недель'],
  [D, 'день', 'дня', 'дней'],
  [H, 'час', 'часа', 'часов'],
];

/** Russian pace label: 30.436875 → «1 месяц/с», 14 → «2 недели/с», 0.5 → «12 часов/с», 0 → «пауза». */
export function describeRateRu(daysPerSecond) {
  if (!(daysPerSecond > 0)) return 'пауза';
  for (const [unit, one, few, many] of RATE_UNITS) {
    const k = daysPerSecond / unit;
    const n = Math.round(k);
    if (n >= 1 && Math.abs(k - n) <= 1e-6 * k) return `${n} ${pluralRu(n, one, few, many)}/с`;
  }
  return `${+daysPerSecond.toFixed(2)} дн./с`;
}
