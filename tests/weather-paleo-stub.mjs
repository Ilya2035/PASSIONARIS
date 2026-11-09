// Stand-in for src/sim/climate/paleo.js (built in parallel) with the ENGINE.md signatures,
// used by tests/weather-worker.test.mjs to exercise the worker's anomalyModule import.
export const globalDT = year => (year < 0 ? -1 : 0);
export const regionalDT = (year, lat, lon) => globalDT(year) + 0.5 * Math.sin((lat * Math.PI) / 180);
export const precipFactor = (year, lat, lon) => (lat > 10 && lat < 30 && year < -3000 ? 1.8 : 1);
