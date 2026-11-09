// Test fixtures for the weather module: synthetic but Earth-like climate normals in the
// docs/ENGINE.md format (tavg Int16 degC*10 [12][360][720], prec Uint16 mm/month,
// elev Int16 m). The climate module is built in parallel, so nothing is imported from it.
//
// Geography: if the baked map exists (public/assets/map/cells.bin.gz + height.delta.bin.gz)
// the real land mask and elevation are downsampled to the SIM grid; otherwise (or with
// WEATHER_PROCEDURAL=1) a crude procedural Earth with the same major regions is used.
// Climate is a latitude/season/continentality/elevation formula: ITCZ with seasonal
// migration, subtropical deserts, mid-latitude storm tracks, continental seasonality.

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { W, H, N, OCEAN, LAKE, LAND, cellLat, cellLon, maskFromCells } from '../src/sim/weather/grid.js';

const ROOT = new URL('../', import.meta.url);
const DEG = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let geoCache = null;

/** {mask Uint8Array(N), elev Int16Array(N), real:boolean} */
export function loadGeography() {
  if (geoCache) return geoCache;
  const cellsUrl = new URL('public/assets/map/cells.bin.gz', ROOT);
  const hUrl = new URL('public/assets/map/height.delta.bin.gz', ROOT);
  if (process.env.WEATHER_PROCEDURAL !== '1' && existsSync(cellsUrl) && existsSync(hUrl)) {
    try { geoCache = realGeography(cellsUrl, hUrl); return geoCache; } catch { /* fall through */ }
  }
  geoCache = proceduralGeography();
  return geoCache;
}

function aligned(buf, C) {
  if (buf.byteOffset % C.BYTES_PER_ELEMENT === 0) return new C(buf.buffer, buf.byteOffset, buf.byteLength / C.BYTES_PER_ELEMENT);
  return new C(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function realGeography(cellsUrl, hUrl) {
  const MW = 8192, MH = 4096;
  const cells = aligned(gunzipSync(readFileSync(cellsUrl)), Uint32Array);
  if (cells.length !== MW * MH) throw new Error('unexpected cells size');
  const mask = maskFromCells(cells, MW, MH, 4);
  const d = aligned(gunzipSync(readFileSync(hUrl)), Int16Array);
  const sum = new Float64Array(N), cnt = new Float64Array(N);
  for (let py = 0; py < MH; py++) {
    const y = Math.floor((py * H) / MH), o = py * MW;
    let acc = 0;
    for (let px = 0; px < MW; px++) {
      acc += d[o + px];
      const c = y * W + Math.floor((px * W) / MW);
      sum[c] += acc; cnt[c]++;
    }
  }
  const elev = new Int16Array(N);
  for (let c = 0; c < N; c++) {
    let e = sum[c] / cnt[c];
    if (mask[c] === LAND) e = Math.max(1, e); else if (mask[c] === OCEAN) e = Math.min(-1, e);
    elev[c] = Math.round(e);
  }
  return { mask, elev, real: true };
}

function proceduralGeography() {
  const mask = new Uint8Array(N), elev = new Int16Array(N);
  const blobs = [ // [lat, lon, rLat, rLon]
    [55, 75, 20, 70], [48, 20, 12, 25], [30, 75, 12, 40], [5, 20, 30, 26], [22, 45, 10, 12], [50, -100, 20, 35],
    [65, -110, 10, 40], [-15, -60, 25, 17], [-25, 134, 11, 17], [72, -40, 9, 18], [15, 100, 10, 12],
  ];
  const bumps = [ // mountains [lat, lon, r, height]
    [33, 88, 8, 4500], [40, -110, 8, 1800], [-20, -68, 6, 3500], [46, 9, 3, 1500], [48, 100, 6, 1500], [-7, 30, 8, 1200],
  ];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = cellLat(y), lon = cellLon(x), c = y * W + x;
    let land = lat < -68;
    for (const [la, lo, rl, ro] of blobs) {
      let dl = lon - lo; dl = ((dl + 540) % 360) - 180;
      if (((lat - la) / rl) ** 2 + (dl / ro) ** 2 < 1) land = true;
    }
    if (land) {
      let e = 250 + 150 * Math.sin(lat * 0.3) * Math.cos(lon * 0.2);
      for (const [la, lo, r, hgt] of bumps) {
        let dl = lon - lo; dl = ((dl + 540) % 360) - 180;
        e += hgt * Math.exp(-((lat - la) ** 2 + dl ** 2) / (r * r));
      }
      if (lat < -68) e += 2500;
      mask[c] = LAND; elev[c] = Math.round(Math.max(1, e));
    } else { mask[c] = OCEAN; elev[c] = -3000; }
  }
  return { mask, elev, real: false };
}

/** Approximate distance to the ocean in km (two-pass chamfer). */
function distanceToOcean(mask) {
  const d = new Float32Array(N);
  for (let c = 0; c < N; c++) d[c] = mask[c] === OCEAN ? 0 : 1e9;
  const dy = 55.6;
  const pass = (y0, y1, sy, x0, x1, sx) => {
    for (let y = y0; y !== y1; y += sy) {
      const dx = 55.6 * Math.max(0.05, Math.cos(cellLat(y) * DEG)), dd = Math.hypot(dx, dy);
      for (let x = x0; x !== x1; x += sx) {
        const c = y * W + x;
        let v = d[c];
        if (v === 0) continue;
        const xp = (x - sx + W) % W, yp = y - sy;
        v = Math.min(v, d[y * W + xp] + dx);
        if (yp >= 0 && yp < H) {
          v = Math.min(v, d[yp * W + x] + dy, d[yp * W + xp] + dd, d[yp * W + ((x + sx + W) % W)] + dd);
        }
        d[c] = v;
      }
    }
  };
  pass(0, H, 1, 0, W, 1); pass(H - 1, -1, -1, W - 1, -1, -1);
  pass(0, H, 1, 0, W, 1); pass(H - 1, -1, -1, W - 1, -1, -1);
  return d;
}

let normalsCache = null;

/** Synthetic normals (ENGINE.md layout) + geography: {tavg, prec, elev, mask, real}. */
export function synthNormals() {
  if (normalsCache) return normalsCache;
  const geo = loadGeography();
  const { mask, elev } = geo;
  const dist = distanceToOcean(mask);
  const tavg = new Int16Array(12 * N), prec = new Uint16Array(12 * N);
  for (let y = 0; y < H; y++) {
    const lat = cellLat(y), alat = Math.abs(lat), north = lat >= 0 ? 1 : -1;
    for (let x = 0; x < W; x++) {
      const c = y * W + x, land = mask[c] !== OCEAN;
      const k = land ? 1 - Math.exp(-dist[c] / 900) : 0;
      const lon = cellLon(x);
      // ice sheets (the baked height raster has them near sea level): raise and chill them
      const sheet = land && (lat < -64 || (lat > 60 && lon > -73 && lon < -12));
      const h = land ? Math.max(sheet ? 2000 : 0, elev[c]) : 0;
      const tAnn = 27 - 47 * (alat / 90) ** 1.8 - 4 * k * smooth(40, 70, alat) - 6.5 * (h / 1000) - (sheet ? 10 : 0);
      const amp = (2 + 26 * smooth(5, 65, alat)) * (0.35 + 0.65 * k);
      for (let m = 0; m < 12; m++) {
        const cp = Math.cos((2 * Math.PI * (m + 0.5 - 0.7)) / 12); // +1 in January
        const t = tAnn - north * amp * cp;
        tavg[m * N + c] = Math.round(t * 10);
        // precipitation, mm/day
        const itczLat = 5 + (land ? 10 : 7) * Math.cos((2 * Math.PI * (m + 0.5 - 7.2)) / 12);
        const itcz = 9 * Math.exp(-(((lat - itczLat) / 6) ** 2)) * (1 - 0.3 * k);
        const summer = -north * cp; // +1 in local summer
        const track = 2.6 * Math.exp(-(((alat - 48) / 14) ** 2)) * (land ? (1 - 0.55 * k) * (1 + 0.6 * k * summer) : 1.15 + 0.25 * -summer);
        const subs = 1 - (land ? 0.92 : 0.6) * Math.exp(-(((alat - 24) / 8) ** 2));
        const pd = (itcz + track + 0.3) * subs + 0.03;
        prec[m * N + c] = Math.round(pd * 30.44);
      }
    }
  }
  normalsCache = { tavg, prec, elev, mask, real: geo.real };
  return normalsCache;
}

/** Land cells inside a lat/lon window with optional elevation bounds. */
export function regionCells(n, { lat0, lat1, lon0, lon1, maxElev = Infinity, minElev = -Infinity, cls = LAND }) {
  const out = [];
  for (let y = 0; y < H; y++) {
    const lat = cellLat(y);
    if (lat < lat0 || lat > lat1) continue;
    for (let x = 0; x < W; x++) {
      const lon = cellLon(x), c = y * W + x;
      if (lon < lon0 || lon > lon1 || n.mask[c] !== cls) continue;
      if (n.elev[c] > maxElev || n.elev[c] < minElev) continue;
      out.push(c);
    }
  }
  return Int32Array.from(out);
}

/** A smooth paleo-like anomaly function for tests (cooling + drying band). */
export function testAnomaly(year, lat, lon) {
  return { dT: -0.5 + 0.3 * Math.sin(year / 37) + 0.2 * Math.cos(lat * DEG * 2), precipFactor: 1 + 0.3 * Math.exp(-(((lat - 20) / 10) ** 2)) * Math.cos(lon * DEG) };
}

export { W, H, N, OCEAN, LAKE, LAND };
