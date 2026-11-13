// Where the Sun and the Moon stand in the sky of a place: unit directions as (east, north, up), from the hour of the
// local solar time, the day of the year and the latitude. Both bodies are at their real distance, that is, so far
// that their rays are parallel: only the direction matters. No dependencies: the tests run this file as it is.
const D = Math.PI / 180, OBLIQUITY = 23.44 * D, YEAR = 365.25, EQUINOX = 80;   // day 80 = 21 March

// ecliptic longitude of the Sun on a day of the year (1 = 1 January), radians; 0 at the March equinox
export const sunLongitude = yday => (yday - EQUINOX) / YEAR * 2 * Math.PI;
// a point of the ecliptic → right ascension and declination, radians
export function equatorial(lon) {
  return { ra: Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lon), Math.cos(lon)), dec: Math.asin(Math.sin(OBLIQUITY) * Math.sin(lon)) };
}
// a body with the hour angle H (0 when it crosses the meridian, growing after that) and the declination dec, seen
// from the latitude lat (all radians) → [east, north, up]
export function horizontal(H, dec, lat) {
  const sl = Math.sin(lat), cl = Math.cos(lat), sd = Math.sin(dec), cd = Math.cos(dec), ch = Math.cos(H);
  return [-cd * Math.sin(H), cl * sd - sl * cd * ch, sl * sd + cl * cd * ch];
}
// the Sun: hour 12 is local noon, the Sun is then due south (north of the tropic) at its highest
export function sunDir(hour, yday = 172, latDeg = 40) {
  return horizontal((hour - 12) * 15 * D, equatorial(sunLongitude(yday)).dec, latDeg * D);
}
// The Moon by its phase: 0 new moon, .25 first quarter, .5 full moon, .75 last quarter. It runs along the ecliptic
// ahead of the Sun by the phase (its real path leaves the ecliptic by up to 5°: not counted). So a full moon rises
// at sunset and stands low in summer and high in winter, as the real one does.
export function moonDir(hour, yday = 172, latDeg = 40, phase = .5) {
  const ls = sunLongitude(yday), s = equatorial(ls), m = equatorial(ls + phase * 2 * Math.PI);
  return horizontal((hour - 12) * 15 * D + s.ra - m.ra, m.dec, latDeg * D);
}
// the lit share of the Moon's disc
export const moonLit = phase => (1 - Math.cos(phase * 2 * Math.PI)) / 2;
// How strong the moonlight on the ground is, 0..1: nothing by day, under the horizon and at new moon; 1 for a full
// moon standing high in a dark sky. sunUp and moonUp are the «up» parts of the two directions.
export function moonStrength(sunUp, moonUp, phase) {
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return moonLit(phase) * ss(-.03, .22, moonUp) * (1 - ss(-.14, .02, sunUp));
}
// hours of sunrise and sunset on a day at a latitude, or null in polar day and polar night
export function sunTimes(yday = 172, latDeg = 40) {
  const x = -Math.tan(latDeg * D) * Math.tan(equatorial(sunLongitude(yday)).dec);
  if (x <= -1 || x >= 1) return null;
  const h = Math.acos(x) / D / 15;
  return { rise: 12 - h, set: 12 + h };
}
