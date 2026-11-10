// Passionaris climate baker, step 1: monthly climate normals on the SIM grid.
//
// Input : data/raw/climate-open/ (scripts/climate/download-open.mjs, sources in data/sources/climate.md):
//           CHELSA V2.1 climatologies 1981–2010, monthly tas / pr, 4′ overview of the 30″ COGs (CC0 1.0);
//           ETOPO 2022 60″ surface elevation sampled every 3′ (CC0 1.0).
//         public/assets/map/cells.bin.gz (map land/lake mask: elevation samples, landfrac.bin.gz).
// Output: public/assets/climate/normals-open.bin.gz  one gzip blob, little-endian:
//           Int16  tavg[12][360][720]  °C * 10
//           Uint16 prec[12][360][720]  mm / month
//           Int16  elev[360][720]      m (ocean = 0)
//         public/assets/climate/landfrac.bin.gz  Uint8 [2][360][720] (land, lake) fraction * 255
//         public/assets/climate/normals.json     layout, offsets, units, source
// (The old WorldClim bake wrote normals.bin.gz; that name stays gitignored and is never read any more.)
//
// Resampling: CHELSA 5400x2610 (4′, 84°N..90°S) -> 720x360 by the area-weighted mean of the pixels
// (7.5 x 7.5 pixels per 0.5° cell, the shared border pixels weighted by their overlap). CHELSA V2.1 downscales
// the ERA5 reanalysis and covers the seas as well, so land and sea both come from it.
// Elevation ("mean land elevation, open ocean = 0"): mean of the ETOPO samples (10 x 10 per cell) on map land
// (cells.bin.gz); a sample below sea level in a cell that also holds sea counts as 0 m (map islands / fjords over
// ETOPO sea floor); cells inside big lakes take the lowest neighbouring land height (≈ the lake surface); sea 0.
// Baseline: the game's paleoclimate model (src/sim/climate/paleo.js) is relative to 1970–2000. CHELSA is
// 1981–2010, so every cell is shifted by the model's own difference between the two periods:
// T -= mean(regionalDT, 1981–2010) - mean(regionalDT, 1970–2000)   (0.13..0.67 °C: 0.18 °C x polar amplification),
// P /= mean(precipFactor, 1981–2010) / mean(precipFactor, 1970–2000)   (0.99..1.02).
// Antarctic plateau: CHELSA is 3–4 °C warmer than the stations (Dome C −50.7 vs −54.5 °C; mean error of the 4 plateau
// stations 3.3 °C vs 4.3 °C for the old WorldClim + Fortuin & Oerlemans blend), so it is kept as it is (the bake logs
// the station check).
// North of 84°N (no CHELSA data, all sea) the cells are filled by a screened Poisson solve: the cells at 84°N are
// fixed (Dirichlet), the cap relaxes towards an SST-like air-temperature / precipitation formula, with a second
// temperature pass over frozen sea towards a long-range extension of the (colder) edge.
// Everything is deterministic (no randomness, no timestamps in the outputs).
//
// Run: tools/node/node.exe scripts/climate/download-open.mjs   (once, ~200 MB)
//      tools/node/node.exe scripts/climate/bake-normals.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { regionalDT, precipFactor } from '../../src/sim/climate/paleo.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'climate-open');
const OUT = path.join(ROOT, 'public', 'assets', 'climate');
const MAP = path.join(ROOT, 'public', 'assets', 'map');
const NORMALS_OUT = 'normals-open.bin.gz';

const CW = 5400, CH = 2610, CLAT0 = 84, CPX = 15;   // CHELSA overview: px per degree, row 0 = 84°N
const EW = 7200, EH = 3600, EPX = 20;              // ETOPO samples: px per degree, row 0 = 90°N
const ND = 65535;
const W = 720, H = 360, N = W * H;                 // SIM grid
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const DEG = Math.PI / 180;
const rowLat = y => 90 - (y + 0.5) * 0.5;
const colLon = x => -180 + (x + 0.5) * 0.5;

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(RAW, 'manifest.json'), 'utf8'));
const readRaw = (rel, Type, len) => {
  const b = zlib.gunzipSync(fs.readFileSync(path.join(RAW, rel)));
  const copy = new Uint8Array(b.byteLength); copy.set(b);
  const a = new Type(copy.buffer);
  if (a.length !== len) throw new Error(`${rel}: ${a.length} values, expected ${len}`);
  return a;
};

// ------------------------------------------------------------------ read + area-weighted block mean
// overlap of SIM cell k (0.5°) with 4′ pixels: 7.5 pixels per cell, [k*7.5, (k+1)*7.5)
function overlaps(k) {
  const a = k * 7.5, b = a + 7.5, out = [];
  for (let p = Math.floor(a); p < Math.ceil(b); p++) out.push([p, Math.min(p + 1, b) - Math.max(p, a)]);
  return out;
}
const OX = Array.from({ length: W }, (_, x) => overlaps(x));
const ROW_OFF = (90 - CLAT0) * 2;                  // SIM rows north of 84°N have no CHELSA data
const OY = Array.from({ length: H }, (_, y) => (y < ROW_OFF ? [] : overlaps(y - ROW_OFF)));

// mean of valid pixels per cell (value = raw * scale + offset); cnt = valid area in pixels (0..56.25)
function blockMean(a, scale, offset, lo, hi) {
  const mean = new Float32Array(N).fill(NaN);
  const cnt = new Float32Array(N);
  let rejected = 0;
  for (let y = 0; y < H; y++) {
    const oy = OY[y];
    if (!oy.length) continue;
    for (let x = 0; x < W; x++) {
      let s = 0, w = 0;
      for (const [py, wy] of oy) {
        const row = py * CW;
        for (const [px, wx] of OX[x]) {
          const v = a[row + px];
          if (v === ND) continue;
          if (v < lo || v > hi) { rejected++; continue; }
          s += wy * wx * v; w += wy * wx;
        }
      }
      const i = y * W + x;
      cnt[i] = w;
      if (w > 0) mean[i] = (s / w) * scale + offset;
    }
  }
  return { mean, cnt, rejected };
}

log('reading CHELSA V2.1 1981–2010 (4′ overviews)');
const tavg = [], prec = [];
let landCount = null, rejected = 0;
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  const ta = readRaw(`chelsa/tas_${mm}.u16.gz`, Uint16Array, CW * CH);
  const pa = readRaw(`chelsa/pr_${mm}.u16.gz`, Uint16Array, CW * CH);
  // plausible ranges: tas 170..340 K, pr 0..6000 mm/month (anything else would be a decoding error)
  const t = blockMean(ta, 0.1, -273.15, 1700, 3400), p = blockMean(pa, 0.1, 0, 0, 60000);
  rejected += t.rejected + p.rejected;
  tavg.push(t.mean); prec.push(p.mean);
  if (!landCount) landCount = t.cnt;
}
if (rejected) throw new Error(`${rejected} CHELSA pixels outside the plausible range`);
log('block means done');

// CHELSA V2.1 is a downscaling of the ERA5 reanalysis and covers the oceans too (south of 84°N); a cell has
// data when the valid pixels cover at least half a 4′ pixel of it. Only the polar cap north of 84°N is filled.
const LAND_MIN = 0.5;

// ------------------------------------------------------------------ elevation (ETOPO 2022 surface on map land)
// "mean land elevation of the cell; open ocean = 0": land, lakes and sea come from the game map (cells.bin.gz:
// 0 ocean, 1 lake, >= 2 land), so the climate grid and the map agree on where the coast is.
const mapCells = (() => {
  const b = zlib.gunzipSync(fs.readFileSync(path.join(MAP, 'cells.bin.gz')));
  const c = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (c.length !== 8192 * 4096) throw new Error('cells.bin.gz: unexpected size');
  return c;
})();
const etopo = readRaw('etopo/surface_3m.i16.gz', Int16Array, EW * EH);
const elevMean = new Float32Array(N).fill(NaN);
let lakeCells = 0;
{
  const sum = new Float64Array(N), cnt = new Uint16Array(N), lake = new Uint16Array(N), sea = new Uint16Array(N);
  const below = new Float64Array(N);                    // sum of the below-sea-level part of the land samples
  for (let ey = 0; ey < EH; ey++) {
    const lat = 90 - (ey + 0.5) / EPX;
    const my = Math.min(4095, Math.floor((90 - lat) / 180 * 4096));
    const sy = Math.floor(ey / 10);
    for (let ex = 0; ex < EW; ex++) {
      const lon = -180 + (ex + 0.5) / EPX;
      const mx = Math.min(8191, Math.floor((lon + 180) / 360 * 8192));
      const c = mapCells[my * 8192 + mx], i = sy * W + Math.floor(ex / 10);
      if (c === 0) { sea[i]++; continue; }
      if (c === 1) { lake[i]++; continue; }             // lake bed in ETOPO: no land height sample
      // the lowest dry land on Earth is the Dead Sea shore, −430 m
      const z = Math.max(-430, etopo[ey * EW + ex]);
      sum[i] += z; cnt[i]++;
      if (z < 0) below[i] += z;
    }
  }
  // Where the cell also holds sea, a land sample below sea level is the sea floor next to a small island, a reef
  // or a fjord that the map draws as land (Bahamas: −880 m) — it counts as 0 m. Depressions away from the
  // sea (Caspian lowland, Qattara, Turpan, Dead Sea) keep their height.
  for (let i = 0; i < N; i++) if (sea[i] && below[i] < 0) sum[i] -= below[i];
  for (let i = 0; i < N; i++) {
    if (cnt[i]) elevMean[i] = sum[i] / cnt[i];
    else if (lake[i] <= sea[i]) elevMean[i] = 0;        // open sea: the sea surface
    else lakeCells++;                                   // a cell inside a big lake: filled below
  }
  // cells inside big lakes (Caspian, Superior, Victoria, Baikal, …): the lowest neighbouring land height,
  // repeated inwards (≈ the lake surface)
  let pending = 0, pass = 0;
  do {
    pending = 0;
    const next = elevMean.slice();
    for (let i = 0; i < N; i++) {
      if (Number.isFinite(elevMean[i])) continue;
      const y = (i / W) | 0, x = i - y * W;
      let mn = Infinity;
      for (const j of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && Number.isFinite(elevMean[j]) && elevMean[j] < mn) mn = elevMean[j];
      }
      if (Number.isFinite(mn)) next[i] = mn; else pending++;
    }
    elevMean.set(next);
  } while (pending && ++pass < 50);
}
const elevB = { mean: elevMean };
log(`cells inside big lakes: ${lakeCells}`);
log('elevation done (ETOPO 2022 surface)');

// ------------------------------------------------------------------ baseline 1981–2010 -> 1970–2000
let shiftT = [Infinity, -Infinity], shiftP = [Infinity, -Infinity];
{
  const meanOver = (f, y0, y1) => { let s = 0, n = 0; for (let yr = y0; yr <= y1 + 0.75; yr += 0.25) { s += f(yr); n++; } return s / n; };
  for (let y = 0; y < H; y++) {
    const lat = rowLat(y);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(landCount[i] >= LAND_MIN)) continue;
      const lon = colLon(x);
      const dT = meanOver(yr => regionalDT(yr, lat, lon), 1981, 2010) - meanOver(yr => regionalDT(yr, lat, lon), 1970, 2000);
      const rP = meanOver(yr => precipFactor(yr, lat, lon), 1981, 2010) / meanOver(yr => precipFactor(yr, lat, lon), 1970, 2000);
      for (let m = 0; m < 12; m++) { tavg[m][i] -= dT; prec[m][i] /= rP; }
      shiftT = [Math.min(shiftT[0], dT), Math.max(shiftT[1], dT)];
      shiftP = [Math.min(shiftP[0], rP), Math.max(shiftP[1], rP)];
    }
  }
}
log(`baseline shift to 1970–2000: T −${shiftT[0].toFixed(2)}..−${shiftT[1].toFixed(2)} °C, P ÷${shiftP[0].toFixed(3)}..${shiftP[1].toFixed(3)}`);

// ------------------------------------------------------------------ sea formulas
// Piecewise-linear zonal profiles of near-surface air temperature over open/ice-covered
// sea: [lat, annual mean °C, half seasonal amplitude °C]. Hand-tuned to the broad shape of
// reanalysis zonal means (warm pool ~27 °C, Arctic ~ -18 °C annual with large winter
// cooling over sea ice, Southern Ocean colder than the North Atlantic/Pacific).
const SEA_T = [
  [-90, -30, 13], [-80, -22, 12], [-70, -9, 9], [-65, -4, 6], [-60, 0, 3.5], [-55, 4, 2],
  [-50, 7, 2], [-40, 13.5, 2.5], [-30, 19, 2.5], [-20, 23.5, 2], [-10, 26, 1.2], [0, 27, 1],
  [10, 27, 1], [20, 25, 2], [30, 21, 3.5], [40, 15, 5], [50, 8, 5], [60, 2, 6],
  [70, -6, 10], [80, -15, 13], [90, -18, 15],
];
function interpProfile(tab, lat, col) {
  if (lat <= tab[0][0]) return tab[0][col];
  for (let i = 1; i < tab.length; i++) {
    if (lat <= tab[i][0]) {
      const [l0] = tab[i - 1], [l1] = tab[i];
      const f = (lat - l0) / (l1 - l0);
      return tab[i - 1][col] * (1 - f) + tab[i][col] * f;
    }
  }
  return tab[tab.length - 1][col];
}
const smooth01 = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const dlon = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const gauss2 = (lat, lon, la, lo, sla, slo) => {
  const u = (lat - la) / sla, v = dlon(lon, lo) / slo;
  return Math.exp(-(u * u + v * v));
};

// Approximate surface-air anomalies of the major ocean currents [lat, lon, sLat, sLon,
// winter anomaly, summer anomaly] (NH winter = Jan; for SH entries "winter" = Jul).
const CURRENTS = [
  [66, 5, 10, 28, 15, 5],      // North Atlantic Drift (Norwegian Sea ice-free in winter)
  [50, -25, 12, 25, 6.5, 1.5], // North Atlantic Current (ocean weather ships I/J/K/C: Jan air 7–13 °C)
  [73, 30, 5, 18, 12, 3],      // its Barents-Sea branch
  [38, -60, 6, 18, 3, 1],      // Gulf Stream
  [35, 145, 6, 15, 3, 1],      // Kuroshio
  [52, -52, 6, 10, -4, -3],    // Labrador Current
  [46, 152, 6, 12, -3, -2],    // Oyashio
  [55, 148, 6, 10, -6, -1],    // Sea of Okhotsk (winter ice)
  [32, -122, 7, 6, -3, -3],    // California Current
  [25, -18, 6, 6, -2.5, -2.5], // Canary Current
  [-15, -78, 10, 7, -4, -4],   // Humboldt Current
  [-22, 10, 8, 6, -3.5, -3.5], // Benguela Current
];

function seaT(lat, lon, m) {
  const ann = interpProfile(SEA_T, lat, 1), amp = interpProfile(SEA_T, lat, 2);
  // seasonal cycle peaks ~Aug in the north and ~Feb in the south (half a year apart, i.e. the
  // same cosine with the opposite sign); the sign is blended smoothly across 10°S..10°N so the
  // target field has no step at the equator
  const c = Math.cos(2 * Math.PI * (m + 0.5 - 7.2) / 12);
  const hemi = 2 * smooth01((lat + 10) / 20) - 1;
  let t = ann + amp * hemi * c;
  // winterness 1 in NH Jan / SH Jul
  const wNH = (1 - Math.cos(2 * Math.PI * (m + 0.5 - 7) / 12)) / 2; // 1 near Jan
  for (const [la, lo, sla, slo, aw, as] of CURRENTS) {
    const g = gauss2(lat, lon, la, lo, sla, slo);
    if (g < 1e-4) continue;
    const win = la >= 0 ? wNH : 1 - wNH;
    t += g * (as + (aw - as) * win);
  }
  return t;
}

// Ocean precipitation, mm/month: ITCZ (seasonal shift), storm tracks, warm-pool, polar taper.
function seaP(lat, lon, m) {
  const itcz = 6 + 4 * Math.cos(2 * Math.PI * (m + 0.5 - 8) / 12);
  const nhWin = 1 + 0.3 * Math.cos(2 * Math.PI * (m + 0.5 - 0.5) / 12);
  const shWin = 1 + 0.2 * Math.cos(2 * Math.PI * (m + 0.5 - 6.5) / 12);
  let p = 22
    + 200 * Math.exp(-(((lat - itcz) / 6) ** 2))
    + 85 * nhWin * Math.exp(-(((lat - 45) / 12) ** 2))
    + 95 * shWin * Math.exp(-(((lat + 50) / 12) ** 2))
    + 110 * gauss2(lat, lon, 0, 135, 12, 35);
  const a = Math.abs(lat);
  if (a > 60) p *= Math.max(0.25, 1 - (a - 60) / 35);
  return p;
}

// ------------------------------------------------------------------ infill solver
const NB_X = new Float32Array(H); // zonal neighbour weight per row (isotropic on the sphere)
for (let y = 0; y < H; y++) NB_X[y] = 1 / Math.max(Math.cos(rowLat(y) * DEG) ** 2, 0.02);

// Label connected nodata components (4-neighbour, lon wrap). Returns {label, sizes}.
function components(isWater) {
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!isWater[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let sp = 0, n = 0;
    stack[sp++] = s; label[s] = id;
    while (sp) {
      const i = stack[--sp]; n++;
      const y = (i / W) | 0, x = i - y * W;
      const nb = [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && isWater[j] && label[j] < 0) { label[j] = id; stack[sp++] = j; }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

// Screened Poisson / Laplace fill. field: land values set, water cells overwritten.
// k[i] = screening (0 = pure Laplace) towards target[i]. SOR Gauss-Seidel.
function solveFill(field, isWater, target, k, init, iters = 500, omega = 1.6) {
  for (let i = 0; i < N; i++) if (isWater[i]) field[i] = init[i];
  for (let it = 0; it < iters; it++) {
    // alternate sweep direction for faster, symmetric convergence
    const fwd = (it & 1) === 0;
    for (let yy = 0; yy < H; yy++) {
      const y = fwd ? yy : H - 1 - yy;
      const wx = NB_X[y], row = y * W;
      for (let xx = 0; xx < W; xx++) {
        const x = fwd ? xx : W - 1 - xx;
        const i = row + x;
        if (!isWater[i]) continue;
        let s = wx * (field[row + ((x + 1) % W)] + field[row + ((x + W - 1) % W)]);
        let ws = 2 * wx;
        if (y > 0) { s += field[i - W]; ws += 1; }
        if (y < H - 1) { s += field[i + W]; ws += 1; }
        const ki = k[i];
        const v = (s + ki * target[i]) / (ws + ki);
        field[i] += omega * (v - field[i]);
      }
    }
  }
}

// ------------------------------------------------------------------ Antarctic plateau check
// (WorldClim needed a correction here; CHELSA is checked against the stations and left as it is.)
const at = (lat, lon) => Math.floor((90 - lat) / 0.5) * W + Math.floor((lon + 180) / 0.5);
const annualT = i => tavg.reduce((s, a) => s + a[i], 0) / 12;
for (const [n, la, lo, obs] of [['Dome C', -75.1, 123.35, -54.5], ['Vostok', -78.46, 106.84, -55.2], ['South Pole', -89.99, 0, -49.4], ['Dome A', -80.37, 77.37, -54.5], ['Summit (Greenland)', 72.58, -38.46, -29.0]]) {
  log(`station check ${n.padEnd(18)} annual ${annualT(at(la, lo)).toFixed(1)} °C (observed ≈ ${obs}), elev ${elevMean[at(la, lo)]?.toFixed(0)} m`);
}

// water = (almost) no valid CHELSA pixel, or no value in some month / field
const isWater = new Uint8Array(N);
let nWater = 0;
for (let i = 0; i < N; i++) {
  let water = !(landCount[i] >= LAND_MIN);
  if (!water) for (let m = 0; m < 12; m++) if (!Number.isFinite(tavg[m][i]) || !Number.isFinite(prec[m][i])) { water = true; break; }
  if (!water && !Number.isFinite(elevB.mean[i])) water = true;
  isWater[i] = water ? 1 : 0;
  nWater += isWater[i];
}
const { label, sizes } = components(isWater);
const INLAND_MAX = 600; // cells; Mediterranean (~1000) and the open ocean are larger
const inland = new Uint8Array(N);
for (let i = 0; i < N; i++) if (isWater[i] && sizes[label[i]] < INLAND_MAX) inland[i] = 1;
log(`water cells ${nWater} (${(100 * nWater / N).toFixed(1)}%), components ${sizes.length}, enclosed cells ${inland.reduce((a, b) => a + b, 0)}`);

// per-component shore means, used as the initial guess for enclosed basins
function shoreInit(field) {
  const sum = new Float64Array(sizes.length), cnt = new Float64Array(sizes.length);
  for (let i = 0; i < N; i++) {
    if (!inland[i]) continue;
    const y = (i / W) | 0, x = i - y * W;
    for (const j of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && !isWater[j]) { sum[label[i]] += field[j]; cnt[label[i]]++; }
    }
  }
  return id => (cnt[id] ? sum[id] / cnt[id] : NaN);
}

// lowest shore elevation per enclosed component (≈ lake / enclosed-sea surface level)
function shoreMin(field) {
  const mn = new Float64Array(sizes.length).fill(Infinity);
  for (let i = 0; i < N; i++) {
    if (!inland[i]) continue;
    const y = (i / W) | 0, x = i - y * W;
    for (const j of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && !isWater[j] && field[j] < mn[label[i]]) mn[label[i]] = field[j];
    }
  }
  return id => (Number.isFinite(mn[id]) ? mn[id] : 0);
}

// elevation: open ocean = 0 m (sea surface); enclosed water = its lowest shore cell
// (Black Sea ~ sea level, lakes ~ shore level; CHELSA covers the Caspian and the large lakes, whose
// height came from their shores above)
const elev = elevB.mean;
{
  const smin = shoreMin(elev);
  for (let i = 0; i < N; i++) if (isWater[i]) elev[i] = inland[i] ? Math.max(-50, Math.min(smin(label[i]), 6000)) : 0;
}
log('elevation filled');

const LAPSE = 0.0065; // °C per m: temperature is filled as a sea-level-reduced field
const LT = 3.5, LP = 5; // coastal influence length, cells (0.5° each)
// Sea ice: air over pack ice is continental, not maritime. Where the first temperature pass is
// below ICE_T0 (ice fraction fi rising smoothly to 1 at ICE_T1) the sea target is pulled down to
// a long-range (LT_ICE cells) extension of the surrounding coasts when that is colder than the
// zonal formula (Sea of Okhotsk, Bering and Chukchi Seas, Beaufort Sea, Antarctic sea-ice zone in
// winter). It only ever cools: where the zonal formula is colder (central Arctic) it is kept.
const LT_ICE = 25, ICE_T0 = -1, ICE_T1 = -7;
const kT = new Float32Array(N), kP = new Float32Array(N), kLong = new Float32Array(N);
for (let i = 0; i < N; i++) {
  kT[i] = inland[i] ? 0 : 1 / (LT * LT);
  kP[i] = inland[i] ? 0 : 1 / (LP * LP);
  kLong[i] = inland[i] ? 0 : 1 / (LT_ICE * LT_ICE);
}

const target = new Float32Array(N), init = new Float32Array(N);
const T1 = new Float32Array(N), TL = new Float32Array(N);
function setTarget(fn, m) {
  for (let y = 0; y < H; y++) {
    const lat = rowLat(y);
    for (let x = 0; x < W; x++) target[y * W + x] = fn(lat, colLon(x), m);
  }
}
function setInit(field) {
  const sh = shoreInit(field);
  for (let i = 0; i < N; i++) {
    if (!isWater[i]) continue;
    const v = inland[i] ? sh(label[i]) : NaN;
    init[i] = Number.isFinite(v) ? v : target[i];
  }
}
let iceCells = 0;
for (let m = 0; m < 12; m++) {
  // reduce land temperatures to sea level so high coastal cells (Norway, Andes, Antarctica)
  // do not chill the neighbouring sea; restored after the fill
  const T = tavg[m];
  for (let i = 0; i < N; i++) if (!isWater[i]) T[i] += LAPSE * Math.max(0, elev[i]);
  // temperature, pass 1: open-sea screening everywhere
  setTarget(seaT, m);
  setInit(T);
  solveFill(T, isWater, target, kT, init);
  // long-range extension of the coasts (warm-started from pass 1)
  T1.set(T); TL.set(T);
  solveFill(TL, isWater, target, kLong, T1, 800);
  // temperature, pass 2: over (pass-1) frozen seas the target is min(formula, coast extension)
  for (let i = 0; i < N; i++) {
    if (!isWater[i] || inland[i]) continue;
    const fi = smooth01((ICE_T0 - T1[i]) / (ICE_T0 - ICE_T1));
    if (fi <= 0) continue;
    if (fi > 0.5) iceCells++;
    target[i] += fi * (Math.min(target[i], TL[i]) - target[i]);
  }
  solveFill(T, isWater, target, kT, T1);
  // precipitation
  setTarget(seaP, m);
  setInit(prec[m]);
  solveFill(prec[m], isWater, target, kP, init);
  for (let i = 0; i < N; i++) T[i] -= LAPSE * Math.max(0, elev[i]);
  log(`month ${m + 1} filled`);
}
log(`sea-ice cells (fi > 0.5), summed over months: ${iceCells}`);

// ------------------------------------------------------------------ pack
const PLANE = N;
const tavgI = new Int16Array(12 * PLANE);
const precU = new Uint16Array(12 * PLANE);
const elevI = new Int16Array(PLANE);
let bad = 0;
for (let m = 0; m < 12; m++) {
  for (let i = 0; i < N; i++) {
    const t = tavg[m][i], p = prec[m][i];
    if (!Number.isFinite(t) || !Number.isFinite(p)) bad++;
    tavgI[m * PLANE + i] = Math.max(-900, Math.min(600, Math.round((Number.isFinite(t) ? t : 0) * 10)));
    precU[m * PLANE + i] = Math.max(0, Math.min(65535, Math.round(Number.isFinite(p) ? p : 0)));
  }
}
for (let i = 0; i < N; i++) elevI[i] = Math.max(-1000, Math.min(9000, Math.round(Number.isFinite(elev[i]) ? elev[i] : 0)));
if (bad) throw new Error(`${bad} non-finite values after infill`);

const parts = [tavgI, precU, elevI];
const total = parts.reduce((s, a) => s + a.byteLength, 0);
const blob = Buffer.alloc(total);
let off = 0;
const sections = [];
const meta = [
  { name: 'tavg', type: 'Int16', shape: [12, H, W], scale: 0.1, units: '°C', note: 'monthly mean air temperature; value * 0.1 = °C' },
  { name: 'prec', type: 'Uint16', shape: [12, H, W], scale: 1, units: 'mm/month', note: 'monthly precipitation total' },
  { name: 'elev', type: 'Int16', shape: [H, W], scale: 1, units: 'm', note: 'mean land elevation of the cell; open ocean = 0 (sea surface)' },
];
parts.forEach((a, k) => {
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(blob, off);
  sections.push({ ...meta[k], offset: off, byteLength: a.byteLength });
  off += a.byteLength;
});
const gz = zlib.gzipSync(blob, { level: 9 });
fs.writeFileSync(path.join(OUT, NORMALS_OUT), gz);
log(`${NORMALS_OUT} ${(gz.length / 1e6).toFixed(2)} MB (raw ${(total / 1e6).toFixed(2)} MB)`);

// ------------------------------------------------------------------ land / lake fraction from the game map
let landfracInfo = null;
{
  const f = path.join(MAP, 'cells.bin.gz');
  if (fs.existsSync(f)) {
    const raw = zlib.gunzipSync(fs.readFileSync(f));
    const cells = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const MW = 8192, MH = 4096;
    if (cells.length !== MW * MH) throw new Error('cells.bin.gz: unexpected size');
    const land = new Float64Array(N), lake = new Float64Array(N), tot = new Float64Array(N);
    const sxOf = new Int32Array(MW);
    for (let x = 0; x < MW; x++) sxOf[x] = Math.min(W - 1, Math.floor((x + 0.5) * W / MW));
    for (let y = 0; y < MH; y++) {
      const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / MH));
      const row = y * MW;
      for (let x = 0; x < MW; x++) {
        const c = cells[row + x], i = sy * W + sxOf[x];
        tot[i]++;
        if (c >= 2) land[i]++; else if (c === 1) lake[i]++;
      }
    }
    const out = new Uint8Array(2 * N);
    for (let i = 0; i < N; i++) {
      out[i] = Math.round(255 * land[i] / tot[i]);
      out[N + i] = Math.round(255 * lake[i] / tot[i]);
    }
    const g = zlib.gzipSync(Buffer.from(out.buffer), { level: 9 });
    fs.writeFileSync(path.join(OUT, 'landfrac.bin.gz'), g);
    landfracInfo = { file: 'landfrac.bin.gz', compression: 'gzip', type: 'Uint8', shape: [2, H, W], layers: ['land', 'lake'], scale: 1 / 255, note: 'fraction of MAP cells (cells.bin.gz) inside the SIM cell: land = id >= 2, lake = id 1' };
    log(`landfrac.bin.gz ${(g.length / 1e3).toFixed(0)} kB`);
  } else {
    log('cells.bin.gz not found — landfrac.bin.gz skipped');
  }
}

// ------------------------------------------------------------------ header
const header = {
  format: 'passionaris-climate-normals',
  version: 1,
  file: NORMALS_OUT,
  compression: 'gzip',
  byteOrder: 'little-endian',
  totalBytes: total,
  // byte offsets of the sections inside the decompressed blob (same as sections[].offset;
  // this shape is what src/sim/weather/grid.js parseNormals(buffer, header) reads)
  offsets: Object.fromEntries(sections.map(s => [s.name, s.offset])),
  grid: {
    W, H, resolutionDeg: 0.5, cell: 'y * 720 + x',
    rows: 'row 0 = 90°N .. 89.5°N (centre lat = 90 - (y + 0.5) * 0.5)',
    cols: 'col 0 = 180°W .. 179.5°W (centre lon = -180 + (x + 0.5) * 0.5)',
  },
  months: 'index 0 = January .. 11 = December',
  baseline: '1970–2000 climatological normals (CHELSA 1981–2010 shifted with the game paleoclimate model, see processing.baseline)',
  sections,
  extras: landfracInfo ? { landfrac: landfracInfo } : {},
  source: {
    name: 'CHELSA V2.1 climatologies 1981–2010 (monthly tas, pr; 4′ overview of the 30″ COGs) + ETOPO 2022 v1 60″ surface elevation (sampled every 3′)',
    url: ['https://www.chelsa-climate.org/datasets/chelsa_climatologies', 'https://www.ncei.noaa.gov/products/etopo-global-relief-model'],
    citation: [
      'Karger, D. N., Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R. W., Zimmermann, N. E., Linder, H. P., Kessler, M. (2021). Climatologies at high resolution for the earth’s land surface areas. EnviDat. https://doi.org/10.16904/envidat.228',
      'Karger, D. N. et al. (2017). Climatologies at high resolution for the earth’s land surface areas. Scientific Data 4, 170122. https://doi.org/10.1038/sdata.2017.122',
      'NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. https://doi.org/10.25921/fd45-gt74',
    ],
    license: 'CC0 1.0 (both): https://creativecommons.org/publicdomain/zero/1.0/ — see data/sources/climate.md',
  },
  processing: {
    resample: 'area-weighted mean of the 4′ CHELSA pixels (7.5 x 7.5 per 0.5° cell, land and sea); a cell has data when the pixels cover >= ' + LAND_MIN + ' pixel; no data north of 84°N (sea, filled)',
    elevation: 'mean of the ETOPO 2022 surface samples (3′, 10 x 10 per cell) on map land (cells.bin.gz id >= 2), floored at -430 m and at 0 m in cells that also hold sea; cells inside big lakes: lowest neighbouring land height; sea: 0',
    antarctic: 'no correction: CHELSA annual Dome C -50.7, Vostok -52.4, South Pole -45.7 °C vs observed -54.5, -55.2, -49.4',
    baseline: `CHELSA 1981–2010 -> 1970–2000: T -= mean regionalDT(1981–2010) - mean regionalDT(1970–2000) (${shiftT[0].toFixed(2)}..${shiftT[1].toFixed(2)} °C), P /= ratio of mean precipFactor (${shiftP[0].toFixed(3)}..${shiftP[1].toFixed(3)}); src/sim/climate/paleo.js`,
    oceanFill: `only north of 84°N (no CHELSA data): screened Poisson fill from the 84°N edge towards a zonal/seasonal sea-surface air formula with current anomalies; influence length T ${LT} cells, P ${LP} cells; second temperature pass over frozen seas (ice weight 0..1 for pass-1 T ${ICE_T0}..${ICE_T1} °C): target = min(formula, ${LT_ICE}-cell coast extension); enclosed water bodies < ${INLAND_MAX} cells: Laplace fill from shores`,
    waterCells: nWater,
    enclosedCells: inland.reduce((a, b) => a + b, 0),
    script: 'scripts/climate/bake-normals.mjs',
  },
};
fs.writeFileSync(path.join(OUT, 'normals.json'), JSON.stringify(header, null, 2));
log('normals.json written — done');
