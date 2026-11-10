// Climatology: monthly normals (1970–2000) on the SIM grid 720x360 and smooth samplers.
//
// Data: public/assets/climate/normals-open.bin.gz (open data: CHELSA V2.1 + ETOPO 2022, both CC0; layout in
// normals.json, baked by scripts/climate/bake-normals.mjs):
//   Int16  tavg[12][360][720]  °C * 10
//   Uint16 prec[12][360][720]  mm / month
//   Int16  elev[360][720]      m (open ocean = 0)
// Grid: cell = y * 720 + x, row 0 = 90°N, col 0 = 180°W, 0.5° cells.
// Months are 0-based everywhere in this module (0 = January).
//
// Works in the browser / Web Worker (fetch + DecompressionStream) and in Node (fs + zlib).
// All samplers take an optional `out` object so hot loops allocate nothing.

export const W = 720;
export const H = 360;
export const N = W * H;
export const RES = 0.5;

const PLANE = N;
const TAVG_BYTES = 12 * PLANE * 2;
const PREC_BYTES = 12 * PLANE * 2;
const ELEV_BYTES = PLANE * 2;
export const NORMALS_BYTES = TAVG_BYTES + PREC_BYTES + ELEV_BYTES;

const BROWSER_BASE = 'assets/climate/';
/** File name of the baked normals (the old WorldClim name normals.bin.gz is never read). */
export const NORMALS_FILE = 'normals-open.bin.gz';
/** Browser URL of the baked normals. */
export const NORMALS_URL = BROWSER_BASE + NORMALS_FILE;
const isNode = typeof process !== 'undefined' && !!process.versions?.node
  && typeof window === 'undefined' && typeof self === 'undefined';

// Non-literal specifiers keep bundlers (Vite) from trying to resolve Node built-ins.
const nodeImport = name => import(/* @vite-ignore */ 'node:' + name);

async function defaultNodePath(file) {
  const { fileURLToPath } = await nodeImport('url');
  const path = await nodeImport('path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', 'public', 'assets', 'climate', file);
}

function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }

async function gunzip(u8) {
  if (!isGzip(u8)) return u8; // a dev server may already have decoded Content-Encoding: gzip
  // DecompressionStream exists in browsers, workers and Node >= 18; zlib is the fallback
  if (typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined' && typeof Response !== 'undefined') {
    const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  const zlib = await nodeImport('zlib');
  const b = zlib.gunzipSync(u8);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/**
 * Read raw bytes of a (possibly gzipped) asset.
 * src: URL / path string (a string ending in '/' is a folder: the file name is appended),
 * a fetch-like function (called with 'assets/climate/<file>'), a Response, an ArrayBuffer /
 * Uint8Array (already loaded bytes), or undefined (default location).
 */
export async function readAsset(src, defaultFile = NORMALS_FILE) {
  let bytes;
  if (src instanceof Uint8Array) bytes = src;
  else if (src instanceof ArrayBuffer) bytes = new Uint8Array(src);
  else if (typeof Response !== 'undefined' && src instanceof Response) bytes = new Uint8Array(await src.arrayBuffer());
  else if (typeof src === 'function') {
    const url = BROWSER_BASE + defaultFile;
    const res = await src(url);
    if (res && typeof res.arrayBuffer === 'function') {
      if (res.ok === false) throw new Error(`${url}: HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  } else {
    let p = typeof src === 'string' && src.endsWith('/') ? src + defaultFile : src;
    const isUrl = typeof p === 'string' && /^(https?:|blob:|data:)/.test(p);
    if (isNode && !isUrl) {
      if (p == null) p = await defaultNodePath(defaultFile);
      else if (typeof p === 'string' && p.startsWith('file:')) p = (await nodeImport('url')).fileURLToPath(p);
      const fs = await nodeImport('fs');
      const b = await fs.promises.readFile(p);
      bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    } else {
      const url = p ?? BROWSER_BASE + defaultFile;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  }
  bytes = await gunzip(bytes);
  // typed views need 2-byte alignment
  if (bytes.byteOffset % 4 !== 0) bytes = bytes.slice();
  return bytes;
}

/**
 * Load the monthly normals.
 * @param {string|Function|ArrayBuffer|Uint8Array|Response} [fetchOrPath]
 *   Browser: URL (default NORMALS_URL = 'assets/climate/normals-open.bin.gz') or a fetch-like function.
 *   Node: file path (default <project>/public/assets/climate/normals-open.bin.gz).
 * @returns {Promise<{W:number,H:number,tavg:Int16Array,prec:Uint16Array,elev:Int16Array}>}
 *   tavg °C*10 [month*N + cell], prec mm/month [month*N + cell], elev m [cell].
 */
export async function loadNormals(fetchOrPath) {
  const bytes = await readAsset(fetchOrPath, NORMALS_FILE);
  if (bytes.byteLength !== NORMALS_BYTES) {
    throw new Error(`${NORMALS_FILE}: expected ${NORMALS_BYTES} bytes, got ${bytes.byteLength}`);
  }
  const buf = bytes.buffer, o = bytes.byteOffset;
  return {
    W, H,
    tavg: new Int16Array(buf, o, 12 * PLANE),
    prec: new Uint16Array(buf, o + TAVG_BYTES, 12 * PLANE),
    elev: new Int16Array(buf, o + TAVG_BYTES + PREC_BYTES, PLANE),
  };
}

/**
 * Optional land/lake fraction per SIM cell (from the game map). Returns
 * {land: Uint8Array(N), lake: Uint8Array(N)} with 0..255 = 0..1.
 */
export async function loadLandFrac(fetchOrPath) {
  const bytes = await readAsset(fetchOrPath, 'landfrac.bin.gz');
  if (bytes.byteLength !== 2 * N) throw new Error(`landfrac.bin.gz: expected ${2 * N} bytes, got ${bytes.byteLength}`);
  return { land: bytes.subarray(0, N), lake: bytes.subarray(N, 2 * N) };
}

// ------------------------------------------------------------------ grid helpers

/** SIM cell index of a geographic point (lon wraps, lat clamps). */
export function cellAt(lat, lon) {
  let x = Math.floor((lon + 180) / RES);
  x = ((x % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  return y * W + x;
}

/** Centre of a SIM cell: writes {lat, lon} into out. */
export function cellCenter(cell, out = { lat: 0, lon: 0 }) {
  const y = (cell / W) | 0, x = cell - y * W;
  out.lat = 90 - (y + 0.5) * RES;
  out.lon = -180 + (x + 0.5) * RES;
  return out;
}

/** Monthly values of one cell. month 0..11. Returns {tavg °C, prec mm/month, elev m}. */
export function sampleMonthly(normals, cell, month, out = { tavg: 0, prec: 0, elev: 0 }) {
  const m = ((month | 0) % 12 + 12) % 12;
  out.tavg = normals.tavg[m * PLANE + cell] * 0.1;
  out.prec = normals.prec[m * PLANE + cell];
  out.elev = normals.elev[cell];
  return out;
}

/** Bilinear monthly sample at an arbitrary point (centre-based, lon wraps). */
export function sampleMonthlyAt(normals, lat, lon, month, out = { tavg: 0, prec: 0, elev: 0 }) {
  const m = ((month | 0) % 12 + 12) % 12;
  const fx = (lon + 180) / RES - 0.5, fy = (90 - lat) / RES - 0.5;
  const xf = Math.floor(fx), tx = fx - xf;
  const y0 = Math.max(0, Math.min(H - 1, Math.floor(fy)));
  const y1 = Math.min(H - 1, y0 + 1);
  const ty = Math.max(0, Math.min(1, fy - y0));
  const x0 = ((xf % W) + W) % W, x1 = (x0 + 1) % W;
  const a = y0 * W + x0, b = y0 * W + x1, c = y1 * W + x0, d = y1 * W + x1;
  const bl = (arr, base) => (arr[base + a] * (1 - tx) + arr[base + b] * tx) * (1 - ty)
    + (arr[base + c] * (1 - tx) + arr[base + d] * tx) * ty;
  out.tavg = bl(normals.tavg, m * PLANE) * 0.1;
  out.prec = bl(normals.prec, m * PLANE);
  out.elev = bl(normals.elev, 0);
  return out;
}

// ------------------------------------------------------------------ smooth daily sampling
// Month centres in a mean Gregorian year (365.2425 d), 0-based days from Jan 1 00:00.
export const YEAR_DAYS = 365.2425;
const MONTH_LEN = [31, 28.2425, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_CENTRE = new Float64Array(12);
export const MONTH_DAYS = Float64Array.from(MONTH_LEN);
{
  let s = 0;
  for (let m = 0; m < 12; m++) { MONTH_CENTRE[m] = s + MONTH_LEN[m] / 2; s += MONTH_LEN[m]; }
}

// Uniform Catmull-Rom basis; month centres are 28–31 days apart, close enough to uniform
// that the local parameter t (fraction of the way between two centres) is used directly.
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Locate a day of year between month centres.
 * Writes {m0 (month whose centre precedes the day), t (0..1 towards the next centre)}.
 */
export function monthPhase(dayOfYear, out = { m0: 0, t: 0 }) {
  let d = (dayOfYear - 1) % YEAR_DAYS;
  if (d < 0) d += YEAR_DAYS;
  let m0 = 11;
  for (let m = 0; m < 12; m++) if (d >= MONTH_CENTRE[m]) m0 = m;
  const c0 = MONTH_CENTRE[m0];
  let c1 = MONTH_CENTRE[(m0 + 1) % 12];
  let dd = d - c0;
  if (m0 === 11) { c1 += YEAR_DAYS; if (dd < 0) dd += YEAR_DAYS; }
  out.m0 = m0;
  out.t = dd / (c1 - c0);
  return out;
}

const _ph = { m0: 0, t: 0 };

/**
 * Smoothly interpolated climate of one cell on a given day.
 * dayOfYear: 1-based, fractional allowed (1.0 = Jan 1 00:00), periodic over 365.2425 days.
 * Periodic Catmull-Rom through the 12 month-centre values (C1-smooth across the year).
 * Returns {tavg °C, prec mm/month (interpolated monthly total), precDay mm/day, elev m}.
 */
export function sampleDay(normals, cell, dayOfYear, out = { tavg: 0, prec: 0, precDay: 0, elev: 0 }) {
  monthPhase(dayOfYear, _ph);
  const m1 = _ph.m0, t = _ph.t;
  const m0 = (m1 + 11) % 12, m2 = (m1 + 1) % 12, m3 = (m1 + 2) % 12;
  const T = normals.tavg, P = normals.prec;
  out.tavg = 0.1 * catmull(T[m0 * PLANE + cell], T[m1 * PLANE + cell], T[m2 * PLANE + cell], T[m3 * PLANE + cell], t);
  const p0 = P[m0 * PLANE + cell], p1 = P[m1 * PLANE + cell], p2 = P[m2 * PLANE + cell], p3 = P[m3 * PLANE + cell];
  // precipitation stays within the range of its two bracketing months (no negative overshoot)
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
  out.prec = Math.min(hi, Math.max(lo, catmull(p0, p1, p2, p3, t)));
  const r0 = p0 / MONTH_LEN[m0], r1 = p1 / MONTH_LEN[m1], r2 = p2 / MONTH_LEN[m2], r3 = p3 / MONTH_LEN[m3];
  out.precDay = Math.min(Math.max(r1, r2), Math.max(Math.min(r1, r2), catmull(r0, r1, r2, r3, t)));
  out.elev = normals.elev[cell];
  return out;
}

/**
 * Fill whole-grid fields for a day (no allocation if outputs are given).
 * tOut: Float32Array(N) °C, pOut: Float32Array(N) mm/day (either may be null).
 */
export function fillDay(normals, dayOfYear, tOut, pOut) {
  monthPhase(dayOfYear, _ph);
  const m1 = _ph.m0, t = _ph.t;
  const m0 = (m1 + 11) % 12, m2 = (m1 + 1) % 12, m3 = (m1 + 2) % 12;
  const T = normals.tavg, P = normals.prec;
  const t2 = t * t, t3 = t2 * t;
  const w0 = 0.5 * (-t + 2 * t2 - t3), w1 = 0.5 * (2 - 5 * t2 + 3 * t3);
  const w2 = 0.5 * (t + 4 * t2 - 3 * t3), w3 = 0.5 * (-t2 + t3);
  const o0 = m0 * PLANE, o1 = m1 * PLANE, o2 = m2 * PLANE, o3 = m3 * PLANE;
  if (tOut) for (let i = 0; i < N; i++) tOut[i] = 0.1 * (w0 * T[o0 + i] + w1 * T[o1 + i] + w2 * T[o2 + i] + w3 * T[o3 + i]);
  if (pOut) {
    const l0 = 1 / MONTH_LEN[m0], l1 = 1 / MONTH_LEN[m1], l2 = 1 / MONTH_LEN[m2], l3 = 1 / MONTH_LEN[m3];
    for (let i = 0; i < N; i++) {
      const r1 = P[o1 + i] * l1, r2 = P[o2 + i] * l2;
      const v = w0 * P[o0 + i] * l0 + w1 * r1 + w2 * r2 + w3 * P[o3 + i] * l3;
      pOut[i] = Math.min(Math.max(r1, r2), Math.max(Math.min(r1, r2), v));
    }
  }
}

/** Annual mean temperature (°C) and annual precipitation (mm) of a cell. */
export function annual(normals, cell, out = { tavg: 0, prec: 0 }) {
  let t = 0, p = 0;
  for (let m = 0; m < 12; m++) { t += normals.tavg[m * PLANE + cell] * MONTH_LEN[m]; p += normals.prec[m * PLANE + cell]; }
  out.tavg = 0.1 * t / YEAR_DAYS;
  out.prec = p;
  return out;
}
