// Game clock tests: tools/node/node.exe --test tests/time-clock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, DEFAULT_SPEED_TABLE, DEFAULT_CLOCK_ERAS, TICKS_PER_DAY, describeRateRu } from '../src/sim/clock.js';
import { fromDate, formatRu, T_END, MEAN_MONTH_DAYS, MEAN_YEAR_DAYS, ERAS } from '../src/sim/calendar.js';

const run = (clock, seconds, dt) => {
  const events = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) for (const e of clock.advance(dt)) events.push(`${e.type}@${e.t}`);
  return events;
};

test('default speed table: speed 3 before 2000 BC = 1 month per second; later eras slower', () => {
  const c = createClock();
  assert.equal(c.speed, 3);
  assert.equal(c.paused, true);
  assert.equal(c.era.id, 'ancient');
  assert.deepEqual([...DEFAULT_SPEED_TABLE.ancient], [7, 14, MEAN_MONTH_DAYS, 3 * MEAN_MONTH_DAYS, MEAN_YEAR_DAYS]);
  assert.equal(c.rateOf(3), MEAN_MONTH_DAYS);
  assert.ok(Math.abs(1000 * MEAN_YEAR_DAYS / c.rateOf(3) / 60 - 200) < 1e-9, '1000 years ≈ 200 minutes');
  assert.equal(c.daysPerSecond, 0, 'paused');
  // every era has 5 increasing speeds, and each speed slows down from era to era
  const ids = ERAS.map(e => e.id);
  assert.deepEqual(DEFAULT_CLOCK_ERAS.map(e => e.id), ids);
  for (const id of ids) {
    const r = DEFAULT_SPEED_TABLE[id];
    assert.equal(r.length, 5);
    for (let s = 1; s < 5; s++) assert.ok(r[s] > r[s - 1], `${id} speeds increase`);
  }
  for (let i = 1; i < ids.length; i++) {
    for (let s = 0; s < 5; s++) assert.ok(DEFAULT_SPEED_TABLE[ids[i]][s] <= DEFAULT_SPEED_TABLE[ids[i - 1]][s], `${ids[i]} not faster`);
  }
  assert.ok(DEFAULT_SPEED_TABLE.contemporary[0] < 1, 'latest era runs in hours');
});

test('one real second at speed 3 = one month; a year of 12 s crosses 365 days, 12 months, 1 year', () => {
  const c = createClock({ t0: 0 });
  c.resume();
  run(c, 1, 1 / 60);
  assert.ok(Math.abs(c.t - MEAN_MONTH_DAYS) <= 1 / 24 + 1e-9, `t=${c.t}`);
  assert.equal(c.ticks, Math.floor(MEAN_MONTH_DAYS * 24));

  const d = createClock({ t0: 0, paused: false });
  const ev = run(d, 12, 1 / 60);
  const count = type => ev.filter(e => e.startsWith(type + '@')).length;
  assert.equal(count('day'), 365);
  assert.equal(count('month'), 12);
  assert.equal(count('year'), 1);
  assert.equal(d.year, -4998);
  assert.equal(formatRu(d.t, 'day'), '1 января 4999 г. до н.э.');
});

test('speeds 1..5 in the first era: week, 2 weeks, month, 3 months, year per second', () => {
  const want = [7, 14, MEAN_MONTH_DAYS, 3 * MEAN_MONTH_DAYS, MEAN_YEAR_DAYS];
  for (let s = 1; s <= 5; s++) {
    const c = createClock({ t0: 0, paused: false, speed: s });
    run(c, 0.2, 0.05);
    const expected = Math.floor(want[s - 1] * 0.2 * 24 + 1e-9);
    assert.ok(Math.abs(c.ticks - expected) <= 1, `speed ${s}: ${c.ticks} vs ${expected}`);
  }
});

test('boundaries are frame-rate independent and deterministic', () => {
  const t0 = fromDate(-3000, 11, 3, 5);
  const a = createClock({ t0, paused: false, speed: 4 });
  const b = createClock({ t0, paused: false, speed: 4 });
  const c = createClock({ t0, paused: false, speed: 4 });
  const ea = run(a, 6, 1 / 60);
  const eb = run(b, 6, 1 / 30);
  const ec = run(c, 6, 0.1);
  assert.ok(ea.length > 200);
  assert.deepEqual(eb, ea);
  assert.deepEqual(ec, ea);
  // identical inputs → identical state
  const x = createClock({ t0, paused: false, speed: 5 });
  const y = createClock({ t0, paused: false, speed: 5 });
  const dts = [0.016, 0.017, 0.033, 0.001, 0.2, 0.016];
  for (let i = 0; i < 300; i++) { x.advance(dts[i % dts.length]); y.advance(dts[i % dts.length]); }
  assert.deepEqual(x.serialize(), y.serialize());
});

test('event order and fields at a year start: era → year → month → day', () => {
  const c = createClock({ t0: fromDate(-2000, 12, 31, 12), paused: false, speed: 3 });
  const ev = [...c.advance(0.1)].map(e => ({ ...e, era: e.era.id }));
  const t = fromDate(-1999, 1, 1);
  assert.deepEqual(ev.slice(0, 4).map(e => e.type), ['era', 'year', 'month', 'day']);
  for (const e of ev.slice(0, 4)) {
    assert.equal(e.t, t);
    assert.deepEqual([e.year, e.month, e.day, e.era], [-1999, 1, 1, 'antiquity']);
  }
  assert.equal(c.era.id, 'antiquity');
  assert.equal(c.rateOf(3), 14);
});

test('pace switches exactly at the era start inside one advance', () => {
  const t0 = fromDate(-2000, 12, 31);
  const c = createClock({ t0, paused: false, speed: 5 });
  c.advance(0.25);
  // 1 day at 1 year/s, the rest of 0.25 s at 3 months/s
  const expectDays = 1 + (0.25 - 1 / MEAN_YEAR_DAYS) * 3 * MEAN_MONTH_DAYS;
  assert.ok(Math.abs((c.t - t0) - expectDays) <= 1 / 24 + 1e-9, `${c.t - t0} vs ${expectDays}`);
});

test('pause, resume and speed control', () => {
  const c = createClock({ t0: 100 });
  const states = [];
  c.onState(k => states.push(`${k.paused ? 'p' : 'r'}${k.speed}`));
  assert.equal(c.advance(1).length, 0);
  assert.equal(c.t, 100);
  c.resume();
  assert.ok(c.advance(0.1).length > 0);
  c.setSpeed(0);
  assert.equal(c.paused, true);
  const t = c.t;
  c.advance(0.2);
  assert.equal(c.t, t);
  c.setSpeed(5);
  assert.equal(c.paused, true, 'choosing a speed does not unpause');
  assert.equal(c.speed, 5);
  c.togglePause();
  assert.equal(c.effectiveSpeed, 5);
  c.faster();
  assert.equal(c.speed, 5);
  c.slower(); c.slower();
  assert.equal(c.speed, 3);
  c.setSpeed(9);
  assert.equal(c.speed, 5);
  assert.deepEqual(states, ['r3', 'p3', 'p5', 'r5', 'r4', 'r3', 'r5']);
  assert.equal(createClock({ speed: 0, paused: false }).paused, true);
});

test('catch-up caps: real dt and days per advance', () => {
  const c = createClock({ t0: 0, paused: false, speed: 3 });
  c.advance(10); // a 10 s hitch only advances 0.25 s worth
  assert.ok(Math.abs(c.t - 0.25 * MEAN_MONTH_DAYS) <= 1 / 24 + 1e-9);
  assert.ok(Math.abs(c.droppedSeconds - 9.75) < 1e-9);

  const fast = [{ id: 'fast', fromYear: -4999, daysPerSecond: [1, 10, 100, 1000, 10000] }];
  const f = createClock({ eras: fast, t0: 0, paused: false, speed: 5, maxDaysPerAdvance: 400 });
  const ev = f.advance(0.25);
  assert.equal(f.t, 400);
  assert.equal(ev.filter(e => e.type === 'day').length, 400);
  assert.ok(f.droppedSeconds > 0.2);
});

test('the world ends on 2100-12-31 23:00', () => {
  const c = createClock({ t0: fromDate(2100, 12, 20), paused: false, speed: 5 });
  let ends = 0;
  c.onEnd(() => ends++);
  for (let i = 0; i < 400 && !c.ended; i++) c.advance(0.25);
  assert.equal(c.ended, true);
  assert.equal(c.paused, true);
  assert.equal(ends, 1);
  assert.equal(c.ticks, Math.round(T_END * 24) - 1);
  assert.equal(formatRu(c.t, 'datetime'), '31 декабря 2100 г., 23:00');
  c.resume();
  assert.equal(c.paused, true, 'cannot resume after the end');
  assert.equal(c.advance(1).length, 0);
  // setTime beyond the end clamps
  const d = createClock({ t0: T_END + 100 });
  assert.equal(d.ended, true);
  assert.equal(d.year, 2100);
});

test('a listener that pauses stops the clock at that day', () => {
  const fast = [{ id: 'fast', fromYear: -4999, daysPerSecond: [1, 10, 100, 1000, 10000] }];
  const c = createClock({ eras: fast, t0: 0, paused: false, speed: 5 });
  const seen = [];
  c.onDay(e => { seen.push(e.day); if (e.day === 10) c.pause(); });
  c.advance(0.25);
  assert.equal(c.t, 9); // Jan 10 00:00
  assert.deepEqual(seen, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(c.paused, true);
});

test('subscriptions: onDay/onMonth/onYear with unsubscribe; stepDays/stepHours', () => {
  const c = createClock({ t0: fromDate(1066, 12, 30) });
  const log = [];
  const offD = c.onDay(e => log.push(`d${e.month}.${e.day}`));
  c.onMonth(e => log.push(`m${e.month}`));
  c.onYear(e => log.push(`y${e.year}`));
  c.stepDays(3);
  assert.deepEqual(log, ['d12.31', 'y1067', 'm1', 'd1.1', 'd1.2']);
  assert.equal(c.paused, true, 'stepDays keeps pause state');
  offD();
  log.length = 0;
  c.stepDays(1);
  assert.deepEqual(log, []);
  c.stepHours(5);
  assert.equal(c.hour, 5);
  assert.equal(formatRu(c.t, 'hour'), '05:00');
  assert.throws(() => c.on('week', () => {}), RangeError);
});

test('serialize / deserialize continues identically', () => {
  const a = createClock({ t0: fromDate(1500, 6, 1), paused: false, speed: 4 });
  for (let i = 0; i < 37; i++) a.advance(0.0173);
  const b = createClock().deserialize(JSON.parse(JSON.stringify(a.serialize())));
  assert.equal(b.t, a.t);
  assert.equal(b.era.id, 'early-modern');
  assert.deepEqual([b.year, b.month, b.day, b.hour], [a.year, a.month, a.day, a.hour]);
  assert.deepEqual(run(b, 3, 0.02), run(a, 3, 0.02));
  assert.throws(() => b.deserialize({ v: 2 }), TypeError);
});

test('no per-frame allocations: result array and event objects are reused', () => {
  const c = createClock({ t0: 0, paused: false, speed: 5 });
  const first = c.advance(1 / 60);
  let same = true, maxEvents = 0;
  for (let i = 0; i < 6000; i++) {
    const ev = c.advance(1 / 60);
    same = same && ev === first;
    maxEvents = Math.max(maxEvents, ev.length);
  }
  assert.ok(same);
  // the pool only grows to the largest frame seen (≤ 7 days + month + year at 1 year/s, 60 fps)
  assert.equal(c._pool.length, maxEvents);
  assert.ok(maxEvents <= 10, `max events per frame ${maxEvents}`);
});

test('custom eras are validated', () => {
  assert.throws(() => createClock({ eras: [] }), TypeError);
  assert.throws(() => createClock({ eras: [{ id: 'x', fromYear: -4999, daysPerSecond: [1, 2, 3] }] }), TypeError);
  assert.throws(() => createClock({ eras: [{ id: 'x', fromYear: -4999, daysPerSecond: [1, 2, 3, 4, -5] }] }), TypeError);
  assert.throws(() => createClock({ eras: [
    { id: 'a', fromYear: 0, daysPerSecond: [1, 2, 3, 4, 5] }, { id: 'b', fromYear: -10, daysPerSecond: [1, 2, 3, 4, 5] },
  ] }), TypeError);
  const c = createClock({ eras: [{ id: 'one', fromYear: -4999, daysPerSecond: [1, 2, 3, 4, 5] }], paused: false, speed: 2 });
  c.advance(0.25);
  assert.equal(c.ticks, 12);
  assert.equal(c.renderT, 0.5);
  assert.equal(TICKS_PER_DAY, 24);
});

test('describeRateRu', () => {
  assert.equal(describeRateRu(MEAN_MONTH_DAYS), '1 месяц/с');
  assert.equal(describeRateRu(3 * MEAN_MONTH_DAYS), '3 месяца/с');
  assert.equal(describeRateRu(MEAN_YEAR_DAYS), '1 год/с');
  assert.equal(describeRateRu(7), '1 неделя/с');
  assert.equal(describeRateRu(14), '2 недели/с');
  assert.equal(describeRateRu(3), '3 дня/с');
  assert.equal(describeRateRu(1), '1 день/с');
  assert.equal(describeRateRu(0.5), '12 часов/с');
  assert.equal(describeRateRu(1 / 12), '2 часа/с');
  assert.equal(describeRateRu(0.25), '6 часов/с');
  assert.equal(describeRateRu(0), 'пауза');
  for (const e of DEFAULT_CLOCK_ERAS) for (const r of e.daysPerSecond) assert.doesNotMatch(describeRateRu(r), /дн\./);
});

// ---- regressions found by the verifier
test('setSpeed ignores non-numeric input instead of racing ahead; Infinity clamps to 5', () => {
  for (const bad of [NaN, undefined, 'abc', {}]) {
    const c = createClock({ t0: 0, paused: false, speed: 3 });
    c.setSpeed(bad);
    assert.equal(c.speed, 3, `setSpeed(${String(bad)})`);
    c.advance(1 / 60);
    assert.ok(c.t < 1, `no jump after setSpeed(${String(bad)}): t=${c.t}`);
  }
  const c = createClock({ t0: 0, paused: false, speed: 3 });
  c.setSpeed(Infinity);
  assert.equal(c.speed, 5);
  assert.equal(c.rateOf(Infinity), c.rateOf(5));
  c.advance(Infinity); // a broken dt is capped and does not poison the diagnostics
  assert.ok(Number.isFinite(c.droppedSeconds));
  assert.ok(c.t <= 0.25 * c.rateOf(5) + 1e-9, `t=${c.t}`);
});

test('setTime / stepDays from a listener stop the running walk; the calendar stays consistent', () => {
  const fast = [{ id: 'fast', fromYear: -4999, daysPerSecond: [1, 10, 100, 1000, 10000] }];
  const jumpTo = fromDate(1000, 6, 15);
  const c = createClock({ eras: fast, t0: 0, paused: false, speed: 5 });
  let jumped = false;
  c.onDay(e => { if (!jumped && e.day === 5) { jumped = true; c.setTime(jumpTo); } });
  c.advance(0.01);
  assert.equal(c.t, jumpTo);
  assert.deepEqual([c.year, c.month, c.day], [1000, 6, 15]);
  // the next frame continues from the new date (10000 days/s × 0.00015 s = 1.5 days)
  const ev = c.advance(0.00015);
  assert.equal(ev.find(e => e.type === 'day').t, jumpTo + 1);
  assert.deepEqual([c.year, c.month, c.day], [1000, 6, 16]);

  // a nested stepDays inside a listener does not let the outer walk replay days
  const d = createClock({ t0: fromDate(1066, 1, 1) });
  const days = [];
  let nested = false;
  d.onDay(e => { days.push(e.day); if (!nested && e.day === 2) { nested = true; d.stepDays(2); } });
  d.stepDays(5);
  assert.deepEqual(days, [2, 3, 4], 'outer walk stops after the nested one');
  assert.deepEqual([d.year, d.month, d.day], [1066, 1, 4]);
  assert.equal(d.paused, true);
});

test('stepDays on a paused clock: listeners see it paused and pause() still stops the step', () => {
  const c = createClock({ t0: fromDate(1500, 3, 1) });
  const states = [];
  c.onState(k => states.push(k.paused));
  const seen = [];
  c.onDay(e => { seen.push([e.day, c.paused]); if (e.day === 3) c.pause(); });
  c.stepDays(10);
  assert.deepEqual(seen, [[2, true], [3, true]]);
  assert.equal(c.day, 3);
  assert.deepEqual(states, [], 'no spurious pause/resume state events');
});
