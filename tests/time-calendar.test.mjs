// Calendar tests: tools/node/node.exe --test tests/time-calendar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromDate, toDate, toDateInto, isLeap, daysInMonth, daysInYear, dayOfYear, formatRu, yearLabelRu,
  eraOf, eraIndexOf, ERAS, T_END, T_LAST_DAY, MEAN_MONTH_DAYS,
} from '../src/sim/calendar.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent oracle: JS Date is proleptic Gregorian with astronomical years (setUTCFullYear accepts any year).
function jsDayNumber(y, m, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.round(dt.getTime() / 86400000);
}
const JS_EPOCH = jsDayNumber(-4999, 1, 1);

test('epoch and known values', () => {
  assert.equal(fromDate(-4999, 1, 1), 0);
  assert.equal(fromDate(-4999, 1, 2), 1);
  assert.equal(fromDate(-4999, 2, 1), 31);
  assert.equal(fromDate(-4998, 1, 1), 365); // -4999 is not leap
  assert.equal(fromDate(1970, 1, 1), -JS_EPOCH);
  assert.equal(fromDate(2000, 1, 1) - fromDate(1970, 1, 1), 10957);
  assert.equal(T_END, fromDate(2101, 1, 1));
  assert.equal(T_LAST_DAY, fromDate(2100, 12, 31));
  assert.deepEqual(toDate(0), { year: -4999, month: 1, day: 1, hour: 0, minute: 0, dayOfYear: 1 });
  assert.deepEqual(toDate(T_LAST_DAY), { year: 2100, month: 12, day: 31, hour: 0, minute: 0, dayOfYear: 365 });
  // 400-year cycle = 146097 days, anywhere in the range
  assert.equal(fromDate(-3600, 5, 17) - fromDate(-4000, 5, 17), 146097);
  assert.equal(fromDate(2000, 3, 1) - fromDate(1600, 3, 1), 146097);
});

test('leap rules (astronomical years, proleptic Gregorian)', () => {
  assert.equal(isLeap(0), true);       // 1 BC
  assert.equal(isLeap(-4), true);      // 5 BC
  assert.equal(isLeap(-1), false);
  assert.equal(isLeap(-100), false);
  assert.equal(isLeap(-400), true);
  assert.equal(isLeap(-4800), true);
  assert.equal(isLeap(-4999), false);
  assert.equal(isLeap(1900), false);
  assert.equal(isLeap(2000), true);
  assert.equal(isLeap(2024), true);
  assert.equal(isLeap(2100), false);
  assert.equal(daysInMonth(0, 2), 29);
  assert.equal(daysInMonth(-4, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2023, 4), 30);
  assert.equal(daysInYear(0), 366);
  assert.equal(fromDate(1, 1, 1) - fromDate(0, 1, 1), 366);
  assert.equal(fromDate(-3, 1, 1) - fromDate(-4, 1, 1), 366);
  assert.equal(fromDate(1901, 1, 1) - fromDate(1900, 1, 1), 365);
  assert.deepEqual(toDate(fromDate(0, 2, 29)), { year: 0, month: 2, day: 29, hour: 0, minute: 0, dayOfYear: 60 });
});

test('matches JS Date for 10k random dates across the span', () => {
  const rnd = mulberry32(12345);
  for (let i = 0; i < 10000; i++) {
    const y = -4999 + Math.floor(rnd() * 7100);
    const m = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * daysInMonth(y, m));
    const t = fromDate(y, m, d);
    assert.equal(t, jsDayNumber(y, m, d) - JS_EPOCH, `fromDate(${y},${m},${d})`);
    const back = toDate(t);
    assert.equal(back.year, y); assert.equal(back.month, m); assert.equal(back.day, d);
    assert.equal(back.dayOfYear, dayOfYear(y, m, d));
  }
});

test('toDate(fromDate(...)) roundtrip incl. time of day, 10k random', () => {
  const rnd = mulberry32(777);
  for (let i = 0; i < 10000; i++) {
    const y = -4999 + Math.floor(rnd() * 7100);
    const m = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * daysInMonth(y, m));
    const h = Math.floor(rnd() * 24), min = Math.floor(rnd() * 60);
    const x = toDate(fromDate(y, m, d, h, min));
    assert.deepEqual([x.year, x.month, x.day, x.hour, x.minute], [y, m, d, h, min]);
  }
  // and random t → date → t
  for (let i = 0; i < 10000; i++) {
    const day = Math.floor(rnd() * T_END);
    const x = toDate(day);
    assert.equal(fromDate(x.year, x.month, x.day), day);
  }
});

test('every day of the span increments the calendar by exactly one day', () => {
  const a = { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 };
  const b = { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 };
  toDateInto(0, a);
  for (let t = 1; t < T_END; t++) {
    toDateInto(t, b);
    if (b.day === a.day + 1) {
      if (b.month !== a.month || b.year !== a.year || b.dayOfYear !== a.dayOfYear + 1) assert.fail(`bad step at t=${t}`);
    } else {
      if (b.day !== 1 || a.day !== daysInMonth(a.year, a.month)) assert.fail(`bad month end at t=${t}`);
      if (a.month === 12) {
        if (b.month !== 1 || b.year !== a.year + 1 || b.dayOfYear !== 1 || a.dayOfYear !== daysInYear(a.year)) assert.fail(`bad year end at t=${t}`);
      } else if (b.month !== a.month + 1 || b.year !== a.year || b.dayOfYear !== a.dayOfYear + 1) assert.fail(`bad month step at t=${t}`);
    }
    a.year = b.year; a.month = b.month; a.day = b.day; a.dayOfYear = b.dayOfYear;
  }
  assert.equal(a.year, 2100); assert.equal(a.month, 12); assert.equal(a.day, 31);
});

test('time of day survives float rounding (hours, minutes, end of day)', () => {
  for (const y of [-4999, -1000, 0, 1066, 2100]) {
    for (let h = 0; h < 24; h++) {
      const x = toDate(fromDate(y, 6, 15, h));
      assert.equal(x.hour, h); assert.equal(x.minute, 0); assert.equal(x.day, 15);
    }
  }
  // ticks of the clock are hours: t = ticks / 24
  const ticks = Math.round(fromDate(2050, 7, 1) * 24) + 14;
  assert.equal(formatRu(ticks / 24, 'hour'), '14:00');
  // 23:59:59.99999 rounds into the next day, not to "24:00"
  const x = toDate(fromDate(2000, 12, 31) + 1 - 1e-9);
  assert.deepEqual([x.year, x.month, x.day, x.hour], [2001, 1, 1, 0]);
});

test('month normalisation in fromDate', () => {
  assert.equal(fromDate(1999, 13, 1), fromDate(2000, 1, 1));
  assert.equal(fromDate(2000, 0, 1), fromDate(1999, 12, 1));
  assert.equal(fromDate(2000, -11, 1), fromDate(1999, 1, 1));
  assert.equal(fromDate(2000, 1, 32), fromDate(2000, 2, 1));
});

test('dayOfYear forms', () => {
  assert.equal(dayOfYear(2000, 12, 31), 366);
  assert.equal(dayOfYear(1900, 12, 31), 365);
  assert.equal(dayOfYear(2024, 3, 1), 61);
  assert.equal(dayOfYear(fromDate(2023, 3, 1)), 60);
  assert.equal(dayOfYear(fromDate(-4, 12, 31)), 366);
});

test('formatRu samples', () => {
  assert.equal(formatRu(0, 'year'), '5000 г. до н.э.');
  assert.equal(formatRu(fromDate(1066, 3, 12), 'day'), '12 марта 1066 г.');
  assert.equal(formatRu(fromDate(-43, 3, 12), 'day'), '12 марта 44 г. до н.э.');
  assert.equal(formatRu(fromDate(-43, 3, 15), 'year'), '44 г. до н.э.');
  assert.equal(formatRu(fromDate(1066, 3, 12, 14), 'hour'), '14:00');
  assert.equal(formatRu(fromDate(1066, 3, 12, 9, 5), 'hour'), '09:05');
  assert.equal(formatRu(fromDate(1066, 3, 12), 'month'), 'март 1066 г.');
  assert.equal(formatRu(fromDate(1066, 5, 1), 'month'), 'май 1066 г.');
  assert.equal(formatRu(fromDate(-4999, 1, 1), 'month'), 'январь 5000 г. до н.э.');
  assert.equal(formatRu(fromDate(1812, 9, 7, 6), 'datetime'), '7 сентября 1812 г., 06:00');
  assert.equal(formatRu(fromDate(2100, 12, 31), 'day'), '31 декабря 2100 г.');
  assert.equal(formatRu(fromDate(0, 8, 1), 'day'), '1 августа 1 г. до н.э.');
  assert.equal(formatRu(fromDate(1, 8, 1), 'day'), '1 августа 1 г.');
  assert.equal(formatRu(NaN), '—');
  assert.equal(yearLabelRu(0), '1 г. до н.э.');
  assert.equal(yearLabelRu(-4999), '5000 г. до н.э.');
  assert.equal(yearLabelRu(2026), '2026 г.');
  assert.throws(() => formatRu(0, 'century'), RangeError);
});

test('eras', () => {
  assert.equal(eraOf(0).id, 'ancient');
  assert.equal(eraOf(fromDate(-2000, 12, 31)).id, 'ancient');
  assert.equal(eraOf(fromDate(-1999, 1, 1)).id, 'antiquity'); // 2000 BC
  assert.equal(formatRu(ERAS[1].t0, 'year'), '2000 г. до н.э.');
  assert.equal(eraOf(fromDate(1066, 1, 1)).id, 'medieval');
  assert.equal(eraOf(fromDate(2100, 12, 31)).id, 'contemporary');
  assert.equal(eraIndexOf(-5), 0);
  assert.equal(ERAS[0].t0, 0);
  assert.equal(ERAS.at(-1).t1, T_END);
  for (let i = 1; i < ERAS.length; i++) assert.equal(ERAS[i].t0, ERAS[i - 1].t1);
  assert.ok(ERAS.every(e => typeof e.nameRu === 'string' && e.nameRu.length > 0));
  assert.ok(Math.abs(MEAN_MONTH_DAYS - 30.436875) < 1e-12);
});

test('toDate is fast (O(1))', () => {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 };
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 1e6; i++) acc += toDateInto((i * 2.59) % T_END, out).day;
  const ms = performance.now() - t0;
  assert.ok(acc > 0);
  assert.ok(ms < 1500, `1M conversions took ${ms.toFixed(0)} ms`);
});
