// Local calendar helper of the weather module (src/sim/weather/date.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDate, toDate, dayOf, dayInfo, isLeap, daysInMonth, daysInYear, daysFromCivil, civilFromDays, EPOCH_UNIX_DAYS, daysBeforeMonth } from '../src/sim/weather/date.js';

/** Unix days of y-m-d via JS Date (proleptic Gregorian, astronomical years). */
function jsUnixDays(y, m, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.round(dt.getTime() / 864e5);
}

test('epoch is astronomical -4999-01-01 (5000 BC)', () => {
  assert.equal(fromDate(-4999, 1, 1), 0);
  assert.equal(EPOCH_UNIX_DAYS, jsUnixDays(-4999, 1, 1));
  const d = toDate(0);
  assert.deepEqual(d, { year: -4999, month: 1, day: 1, hour: 0, minute: 0, dayOfYear: 1 });
});

test('7200 years = 18 Gregorian cycles of 146097 days', () => {
  assert.equal(fromDate(2201, 1, 1), 18 * 146097);
  assert.equal(fromDate(-4599, 1, 1), 146097);
});

test('leap rules incl. year 0 and negative years', () => {
  assert.equal(isLeap(0), true);     // 1 BC
  assert.equal(isLeap(-4), true);
  assert.equal(isLeap(-100), false);
  assert.equal(isLeap(-400), true);
  assert.equal(isLeap(1900), false);
  assert.equal(isLeap(2000), true);
  assert.equal(isLeap(2100), false);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInYear(-4999), 365);
  assert.equal(daysBeforeMonth(2024, 3), 60);
});

test('matches JS Date on random days across 5000 BC .. 2100 AD', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 5000; i++) {
    const y = -4999 + Math.floor(rnd() * 7100), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * daysInMonth(y, m));
    const ud = daysFromCivil(y, m, d);
    assert.equal(ud, jsUnixDays(y, m, d), `${y}-${m}-${d}`);
    assert.deepEqual(civilFromDays(ud), [y, m, d]);
    const info = dayInfo(ud - EPOCH_UNIX_DAYS);
    assert.equal(info.year, y); assert.equal(info.month, m); assert.equal(info.day, d);
    assert.equal(info.dayOfYear, ud - daysFromCivil(y, 1, 1) + 1);
  }
});

test('day of year, end of world, hours', () => {
  assert.equal(dayInfo(fromDate(2024, 12, 31)).dayOfYear, 366);
  assert.equal(dayInfo(fromDate(2023, 12, 31)).dayOfYear, 365);
  assert.equal(dayInfo(fromDate(-1, 3, 1)).dayOfYear, 60); // 2 BC is not leap
  const end = toDate(fromDate(2100, 12, 31, 14) + 0.5 / 24);
  assert.deepEqual(end, { year: 2100, month: 12, day: 31, hour: 14, minute: 30, dayOfYear: 365 });
  // every day of a few whole years round-trips
  for (let t = fromDate(-1, 1, 1); t < fromDate(2, 1, 1); t++) {
    const d = toDate(t + 0.25);
    assert.equal(fromDate(d.year, d.month, d.day), t);
    assert.equal(d.hour, 6);
  }
});

test('float times a hair before midnight count as the next day (same rule as calendar.js)', () => {
  let t = 0;
  for (let i = 0; i < 24 * 831; i++) t += 1 / 24; // accumulated hourly steps drift below whole days
  assert.equal(dayOf(t), 831);
  assert.equal(dayOf(19945.999999999993), 19946);
  assert.deepEqual(toDate(19945.999999999993), toDate(19946));
  assert.equal(dayOf(19945.99), 19945);
  assert.equal(dayOf(-0.5), -1);
});
