// Passionaris calendar (owner: time-save module, see docs/ENGINE.md).
//
// - Astronomical year numbering: year 0 = 1 BC, -4999 = 5000 BC.
// - Proleptic Gregorian calendar for the whole span (leap: divisible by 4, except centuries not divisible by 400).
// - Game time `t` = days (float64) since -4999-01-01 00:00. The fractional part is the time of day.
// - World span: t = 0 (-4999-01-01) .. T_END (2101-01-01 00:00, exclusive) — the last day is 2100-12-31.
//
// Conversions are O(1): days are counted from 0000-03-01 in 400-year cycles of 146097 days
// (H. Hinnant, "chrono-compatible low-level date algorithms"), which is exact for negative years as well.
// No allocations on the hot path: use toDateInto(t, out) in per-frame code; formatRu reuses a scratch object.

export const EPOCH_YEAR = -4999;
export const END_YEAR = 2100;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_400_YEARS = 146097;
export const MEAN_YEAR_DAYS = DAYS_PER_400_YEARS / 400; // 365.2425
export const MEAN_MONTH_DAYS = MEAN_YEAR_DAYS / 12;     // 30.436875

// Russian month names: nominative (month level, «март 1066 г.») and genitive (day dates, «12 марта 1066 г.»).
export const MONTHS_NOM_RU = Object.freeze([
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]);
export const MONTHS_GEN_RU = Object.freeze([
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]);

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Proleptic Gregorian leap year test (astronomical numbering: 0 and -4 are leap, -100 is not, -400 is). */
export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y) {
  return isLeap(y) ? 366 : 365;
}

/** Days in month m (1-12) of year y. */
export function daysInMonth(y, m) {
  return m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1];
}

// Days since 0000-03-01 for a civil date (month 1-12). Valid for any integer year.
function daysFromCivil(y, m, d) {
  if (m <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;                                   // [0, 399]
  const mp = m > 2 ? m - 3 : m + 9;                            // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;          // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * DAYS_PER_400_YEARS + doe;
}

const EPOCH_DAYS = daysFromCivil(EPOCH_YEAR, 1, 1);

/**
 * Game time (days since -4999-01-01 00:00) for a date. Month overflow is normalised (m = 13 → January next year);
 * day overflow is linear (d = 32 of January → 1 February).
 */
export function fromDate(y, m = 1, d = 1, h = 0, min = 0) {
  if (m < 1 || m > 12) {
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
  }
  const day = daysFromCivil(y, m, d) - EPOCH_DAYS;
  return h === 0 && min === 0 ? day : day + (h * 60 + min) / MINUTES_PER_DAY;
}

/** First instant after the world ends (2101-01-01 00:00); the last playable day is 2100-12-31. */
export const T_END = fromDate(END_YEAR + 1, 1, 1);
/** Start of the last day, 2100-12-31 00:00. */
export const T_LAST_DAY = T_END - 1;

/**
 * Fills `out` with {year, month, day, hour, minute, dayOfYear} for game time t and returns it.
 * Allocation-free; prefer it over toDate() in per-frame code.
 */
export function toDateInto(t, out) {
  let day = Math.floor(t);
  // +1e-4 min (6 ms) guards values like 13:59:59.9999 produced by float rounding of h/24.
  let mins = Math.floor((t - day) * MINUTES_PER_DAY + 1e-4);
  if (mins >= MINUTES_PER_DAY) { day += 1; mins -= MINUTES_PER_DAY; }
  const z = day + EPOCH_DAYS;
  const era = Math.floor(z / DAYS_PER_400_YEARS);
  const doe = z - era * DAYS_PER_400_YEARS;                                  // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doyMar = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365], 0 = 1 March
  const mp = Math.floor((5 * doyMar + 2) / 153);
  const d = doyMar - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  out.year = y;
  out.month = m;
  out.day = d;
  out.hour = Math.floor(mins / 60);
  out.minute = mins % 60;
  out.dayOfYear = m <= 2 ? doyMar - 305 : doyMar + 60 + (isLeap(y) ? 1 : 0);
  return out;
}

/** {year, month(1-12), day(1-31), hour, minute, dayOfYear(1-366)} for game time t. */
export function toDate(t) {
  return toDateInto(t, { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 });
}

const scratch = { year: 0, month: 0, day: 0, hour: 0, minute: 0, dayOfYear: 0 };

/**
 * Day of year (1 = 1 January). Two forms: dayOfYear(y, m, d) for a civil date, or dayOfYear(t) for game time.
 */
export function dayOfYear(yOrT, m, d) {
  if (m === undefined) return toDateInto(yOrT, scratch).dayOfYear;
  let n = d;
  for (let i = 1; i < m; i++) n += daysInMonth(yOrT, i);
  return n;
}

/** Integer day index (days since epoch) of the first day of year y / of month m. */
export const yearStart = y => fromDate(y, 1, 1);
export const monthStart = (y, m) => fromDate(y, m, 1);

/** Russian year label: «1066 г.», «44 г. до н.э.», «5000 г. до н.э.» (astronomical 0 → «1 г. до н.э.»). */
export function yearLabelRu(y) {
  return y <= 0 ? `${1 - y} г. до н.э.` : `${y} г.`;
}

const pad2 = n => (n < 10 ? `0${n}` : `${n}`);

/**
 * Russian date text.
 *  'year'     → «5000 г. до н.э.»
 *  'month'    → «март 1066 г.»               (nominative month)
 *  'day'      → «12 марта 1066 г.», «12 марта 44 г. до н.э.» (genitive month)
 *  'hour'     → «14:00»                       (time of day only)
 *  'datetime' → «12 марта 1066 г., 14:00»
 */
export function formatRu(t, level = 'day') {
  if (!Number.isFinite(t)) return '—';
  const x = toDateInto(t, scratch);
  switch (level) {
    case 'year': return yearLabelRu(x.year);
    case 'month': return `${MONTHS_NOM_RU[x.month - 1]} ${yearLabelRu(x.year)}`;
    case 'day': return `${x.day} ${MONTHS_GEN_RU[x.month - 1]} ${yearLabelRu(x.year)}`;
    case 'hour': return `${pad2(x.hour)}:${pad2(x.minute)}`;
    case 'datetime': return `${x.day} ${MONTHS_GEN_RU[x.month - 1]} ${yearLabelRu(x.year)}, ${pad2(x.hour)}:${pad2(x.minute)}`;
    default: throw new RangeError(`formatRu: unknown level "${level}"`);
  }
}

// ------------------------------------------------------------------ eras
// Historical periods of the game span. The clock uses them to pick its speed table (src/sim/clock.js),
// so the pace of time slows down as history gets denser. `fromYear` is astronomical; each era starts on 1 January.
const ERA_DEFS = [
  { id: 'ancient', nameRu: 'Древнейший мир', fromYear: EPOCH_YEAR }, // 5000 BC
  { id: 'antiquity', nameRu: 'Древний мир', fromYear: -1999 },       // 2000 BC
  { id: 'medieval', nameRu: 'Средние века', fromYear: 500 },
  { id: 'early-modern', nameRu: 'Новое время', fromYear: 1500 },
  { id: 'industrial', nameRu: 'Промышленная эпоха', fromYear: 1800 },
  { id: 'contemporary', nameRu: 'Новейшее время', fromYear: 1914 },
];

/** Frozen list of eras: {index, id, nameRu, fromYear, toYear (inclusive), t0, t1 (exclusive)}. */
export const ERAS = Object.freeze(ERA_DEFS.map((e, i) => {
  const next = ERA_DEFS[i + 1];
  const toYear = next ? next.fromYear - 1 : END_YEAR;
  return Object.freeze({ index: i, ...e, toYear, t0: fromDate(e.fromYear, 1, 1), t1: fromDate(toYear + 1, 1, 1) });
}));

/** Index of the era containing t (clamped to the first/last era outside the span). */
export function eraIndexOf(t) {
  let i = ERAS.length - 1;
  while (i > 0 && t < ERAS[i].t0) i--;
  return i;
}

/** Era object containing t (see ERAS). */
export function eraOf(t) {
  return ERAS[eraIndexOf(t)];
}
