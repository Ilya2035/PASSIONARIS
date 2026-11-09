// Tiny local calendar helper for the weather module.
//
// Game time t = days (float64) since astronomical -4999-01-01 00:00, proleptic
// Gregorian calendar, astronomical year numbering (year 0 = 1 BC). The main
// thread owns src/sim/calendar.js; this file only exists so the weather worker
// has no dependency on it. Both must agree (see tests/weather-date.test.mjs).
//
// Day arithmetic uses H. Hinnant's days_from_civil / civil_from_days, which is
// exact for any integer year (negative years included).

const floorDiv = (a, b) => Math.floor(a / b);

/** Days from 1970-01-01 to y-m-d (proleptic Gregorian). */
export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = floorDiv(y, 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = floorDiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil. Returns [year, month(1-12), day(1-31)]. */
export function civilFromDays(z) {
  z += 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** Epoch of game time: -4999-01-01, in days since 1970-01-01. */
export const EPOCH_UNIX_DAYS = daysFromCivil(-4999, 1, 1);

export const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = y => (isLeap(y) ? 366 : 365);
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y, m) => (m === 2 && isLeap(y) ? 29 : DIM[m - 1]);

/** Game time (days) of y-m-d h:00. */
export function fromDate(y, m = 1, d = 1, h = 0) {
  return daysFromCivil(y, m, d) - EPOCH_UNIX_DAYS + h / 24;
}

/** Integer day index (floor of t) -> {year, month, day, dayOfYear (1-based), doy0 (0-based), daysInMonth, daysInYear}. */
export function dayInfo(dayIndex, out = {}) {
  const [y, m, d] = civilFromDays(dayIndex + EPOCH_UNIX_DAYS);
  const doy0 = dayIndex + EPOCH_UNIX_DAYS - daysFromCivil(y, 1, 1);
  out.year = y; out.month = m; out.day = d;
  out.doy0 = doy0; out.dayOfYear = doy0 + 1;
  out.daysInMonth = daysInMonth(y, m); out.daysInYear = daysInYear(y);
  return out;
}

/**
 * Integer day of game time t. Same rule as src/sim/calendar.js: a value within 1e-4 minute of
 * the next midnight (float rounding of accumulated time) already counts as the next day.
 */
export function dayOf(t) {
  const d = Math.floor(t);
  return (t - d) * 1440 + 1e-4 >= 1440 ? d + 1 : d;
}

/** Game time (float days) -> {year, month, day, hour, minute, dayOfYear}. Same shape and rounding as calendar.toDate. */
export function toDate(t) {
  const di = dayOf(t);
  const info = dayInfo(di);
  const mins = Math.max(0, Math.floor((t - di) * 1440 + 1e-4));
  return { year: info.year, month: info.month, day: info.day, hour: Math.floor(mins / 60), minute: mins % 60, dayOfYear: info.dayOfYear };
}

/** Cumulative days before month m (1-12) in year y. */
export function daysBeforeMonth(y, m) {
  let s = 0;
  for (let k = 1; k < m; k++) s += daysInMonth(y, k);
  return s;
}
