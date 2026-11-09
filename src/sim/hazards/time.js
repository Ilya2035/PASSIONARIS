// Local calendar helpers for the hazards module (kept separate from src/sim/calendar.js,
// which belongs to the time-save module; both follow docs/ENGINE.md):
//   - astronomical year numbering (year 0 = 1 BC, -4999 = 5000 BC);
//   - proleptic Gregorian calendar;
//   - game time t = days (float) since -4999-01-01 00:00.

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil). */
export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;                       // [0, 399]
  const mp = (m + 9) % 12;                         // March = 0
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil: integer days since 1970-01-01 -> {year, month, day}. */
export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export const EPOCH_DAYS = daysFromCivil(-4999, 1, 1);
export const START_YEAR = -4999;
export const END_YEAR = 2100;

export const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y, m) => (m === 2 && isLeap(y) ? 29 : MDAYS[m - 1]);
export const daysInYear = y => (isLeap(y) ? 366 : 365);

/** Game time (days since -4999-01-01) of a date; hour may be fractional. */
export function ymdToT(year, month = 1, day = 1, hour = 0) {
  return daysFromCivil(year, month, day) - EPOCH_DAYS + hour / 24;
}

/** Game time -> {year, month, day, hour}. */
export function tToYmd(t) {
  const dayIdx = Math.floor(t);
  const { year, month, day } = civilFromDays(dayIdx + EPOCH_DAYS);
  return { year, month, day, hour: (t - dayIdx) * 24 };
}

/** Start of a year in game time. */
export const yearStartT = y => ymdToT(y, 1, 1);

/** Astronomical year of a game time (fast path via tToYmd). */
export const yearOfT = t => tToYmd(t).year;

/** Converts a historical "BC = negative, no year 0" year into astronomical numbering. */
export const historicalToAstronomical = y => (y < 0 ? y + 1 : y);

/** Game time at the end of the world (2100-12-31 24:00). */
export const T_END = ymdToT(2101, 1, 1);
