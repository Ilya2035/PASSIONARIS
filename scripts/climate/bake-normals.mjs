// Passionaris climate baker, step 1: monthly climate normals on the SIM grid.
//
// Input : WorldClim 2.1, 10 arc-minute monthly tavg / prec + elevation (1970–2000),
//         unzipped into data/raw/climate/{tavg,prec,elev}/ (see data/sources/climate.md).
//         public/assets/map/cells.bin.gz (map land/lake mask, only for landfrac.bin.gz).
// Output: public/assets/climate/normals.bin.gz  one gzip blob, little-endian:
//           Int16  tavg[12][360][720]  °C * 10
//           Uint16 prec[12][360][720]  mm / month
//           Int16  elev[360][720]      m (ocean = 0)
//         public/assets/climate/landfrac.bin.gz  Uint8 [2][360][720] (land, lake) fraction * 255
//         public/assets/climate/normals.json     layout, offsets, units, source
//
// Resampling: 2160x1080 -> 720x360 by averaging the valid pixels of each 3x3 block.
// Ocean (nodata in WorldClim) is filled by a screened Poisson solve: land cells are
// fixed (Dirichlet), sea cells relax towards an SST-like air-temperature / precipitation
// formula with a coastal influence length of a few cells; small enclosed water bodies
// (Caspian, Black Sea, Baltic if closed at 0.5°, big lakes) are pure Laplace fills from
// their shores. The East Antarctic plateau, where WorldClim is far too warm, is blended towards
// an elevation/latitude parametrisation (see below). Everything is deterministic (no randomness).
//
// Run: tools/node/node.exe scripts/climate/bake-normals.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromFile } from 'geotiff';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'climate');
const OUT = path.join(ROOT, 'public', 'assets', 'climate');
const MAP = path.join(ROOT, 'public', 'assets', 'map');

const SW = 2160, SHH = 1080, B = 3;            // source grid and block size
const W = 720, H = 360, N = W * H;             // SIM grid
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const DEG = Math.PI / 180;
const rowLat = y => 90 - (y + 0.5) * 0.5;
const colLon = x => -180 + (x + 0.5) * 0.5;

fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ read + block mean
async function readTif(file) {
  const tiff = await fromFile(file);
  const im = await tiff.getImage();
  if (im.getWidth() !== SW || im.getHeight() !== SHH) throw new Error(`${file}: unexpected size ${im.getWidth()}x${im.getHeight()}`);
  const [a] = await im.readRasters();
  const nd = im.getGDALNoData();
  if (typeof tiff.close === 'function') await tiff.close();
  return { a, nd };
}

// mean of valid pixels per 3x3 block; count = number of valid pixels (0..9)
function blockMean({ a, nd }, count) {
  const mean = new Float32Array(N);
  const cnt = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = 0; dy < B; dy++) {
        const row = (y * B + dy) * SW + x * B;
        for (let dx = 0; dx < B; dx++) {
          const v = a[row + dx];
          if (v === nd || !(v > -1e30) || !Number.isFinite(v)) continue;
          s += v; n++;
        }
      }
      const i = y * W + x;
      cnt[i] = n;
      mean[i] = n ? s / n : NaN;
    }
  }
  if (count) count.set(cnt);
  return { mean, cnt };
}

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
const dlon = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const gauss2 = (lat, lon, la, lo, sla, slo) => {
  const u = (lat - la) / sla, v = dlon(lon, lo) / slo;
  return Math.exp(-(u * u + v * v));
};

// Approximate surface-air anomalies of the major ocean currents [lat, lon, sLat, sLon,
// winter anomaly, summer anomaly] (NH winter = Jan; for SH entries "winter" = Jul).
const CURRENTS = [
  [66, 5, 10, 28, 15, 5],      // North Atlantic Drift (Norwegian Sea ice-free in winter)
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
  const peak = lat >= 0 ? 7.2 : 1.2; // months (0-based, centre at m+0.5): ~Aug / ~Feb
  const c = Math.cos(2 * Math.PI * (m + 0.5 - peak) / 12);
  let t = ann + amp * c;
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

// ------------------------------------------------------------------ main
log('reading WorldClim 2.1 10m GeoTIFFs');
const tavg = [], prec = [];
let landCount = null;
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  const t = blockMean(await readTif(path.join(RAW, 'tavg', `wc2.1_10m_tavg_${mm}.tif`)));
  const p = blockMean(await readTif(path.join(RAW, 'prec', `wc2.1_10m_prec_${mm}.tif`)));
  tavg.push(t.mean); prec.push(p.mean);
  if (!landCount) landCount = t.cnt;
}
const elevB = blockMean(await readTif(path.join(RAW, 'elev', 'wc2.1_10m_elev.tif')));
log('block means done');

// ------------------------------------------------------------------ Antarctic plateau correction
// WorldClim has almost no stations on the East Antarctic plateau and is far too warm there
// (Dome C annual ≈ -38 °C vs observed -54.5 °C) with zonal artifacts near the pole. Blend
// towards the Fortuin & Oerlemans (1990, Ann. Glaciol. 14:64) parametrisation of annual mean
// surface temperature of the ice sheet, T = 34.46 - 0.00914 z - 0.688 |lat|, with the South Pole
// station seasonal cycle (coreless winter); weight grows with elevation (coasts keep the
// station-based WorldClim values). Accumulation is blended towards ~25 mm/yr on the high plateau.
const SP_ANOM = [21.1, 8.6, -4.2, -8.3, -8.5, -9.4, -10.3, -10.2, -9.6, -1.5, 11.3, 21.6];
let antCells = 0;
for (let y = 0; y < H; y++) {
  const lat = rowLat(y);
  if (lat > -60) continue;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const z = elevB.mean[i];
    if (!(landCount[i] > 0) || !Number.isFinite(z)) continue;
    const u = Math.max(0, Math.min(1, (z - 1000) / 1500));
    const w = u * u * (3 - 2 * u);
    if (w <= 0) continue;
    antCells++;
    const tAnn = 34.46 - 0.00914 * z - 0.688 * Math.abs(lat);
    const pMon = (600 * Math.exp(-z / 700) + 20) / 12;
    for (let m = 0; m < 12; m++) {
      tavg[m][i] = (1 - w) * tavg[m][i] + w * (tAnn + SP_ANOM[m]);
      prec[m][i] = (1 - w) * prec[m][i] + w * pMon;
    }
  }
}
log(`Antarctic plateau correction: ${antCells} cells`);

// water = no valid WorldClim pixel in any month / field
const isWater = new Uint8Array(N);
let nWater = 0;
for (let i = 0; i < N; i++) {
  let water = landCount[i] === 0;
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
// (Black Sea ~ sea level, Caspian ~ -28 m where WorldClim marks it as nodata, lakes ~ shore level)
const elev = elevB.mean;
{
  const smin = shoreMin(elev);
  for (let i = 0; i < N; i++) if (isWater[i]) elev[i] = inland[i] ? Math.max(-50, Math.min(smin(label[i]), 6000)) : 0;
}
log('elevation filled');

const LAPSE = 0.0065; // °C per m: temperature is filled as a sea-level-reduced field
const LT = 3.5, LP = 5; // coastal influence length, cells (0.5° each)
const kT = new Float32Array(N), kP = new Float32Array(N);
for (let i = 0; i < N; i++) {
  kT[i] = inland[i] ? 0 : 1 / (LT * LT);
  kP[i] = inland[i] ? 0 : 1 / (LP * LP);
}

const target = new Float32Array(N), init = new Float32Array(N);
for (let m = 0; m < 12; m++) {
  // reduce land temperatures to sea level so high coastal cells (Norway, Andes, Antarctica)
  // do not chill the neighbouring sea; restored after the fill
  const T = tavg[m];
  for (let i = 0; i < N; i++) if (!isWater[i]) T[i] += LAPSE * Math.max(0, elev[i]);
  for (const [field, fn, k] of [[T, seaT, kT], [prec[m], seaP, kP]]) {
    for (let y = 0; y < H; y++) {
      const lat = rowLat(y);
      for (let x = 0; x < W; x++) target[y * W + x] = fn(lat, colLon(x), m);
    }
    const sh = shoreInit(field);
    for (let i = 0; i < N; i++) {
      if (!isWater[i]) continue;
      const v = inland[i] ? sh(label[i]) : NaN;
      init[i] = Number.isFinite(v) ? v : target[i];
    }
    solveFill(field, isWater, target, k, init);
  }
  for (let i = 0; i < N; i++) T[i] -= LAPSE * Math.max(0, elev[i]);
  log(`month ${m + 1} filled`);
}

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
fs.writeFileSync(path.join(OUT, 'normals.bin.gz'), gz);
log(`normals.bin.gz ${(gz.length / 1e6).toFixed(2)} MB (raw ${(total / 1e6).toFixed(2)} MB)`);

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
  generated: new Date().toISOString(),
  file: 'normals.bin.gz',
  compression: 'gzip',
  byteOrder: 'little-endian',
  totalBytes: total,
  grid: {
    W, H, resolutionDeg: 0.5, cell: 'y * 720 + x',
    rows: 'row 0 = 90°N .. 89.5°N (centre lat = 90 - (y + 0.5) * 0.5)',
    cols: 'col 0 = 180°W .. 179.5°W (centre lon = -180 + (x + 0.5) * 0.5)',
  },
  months: 'index 0 = January .. 11 = December',
  baseline: '1970–2000 climatological normals',
  sections,
  extras: landfracInfo ? { landfrac: landfracInfo } : {},
  source: {
    name: 'WorldClim version 2.1, 10 arc-minute monthly tavg / prec / elev',
    url: 'https://www.worldclim.org/data/worldclim21.html',
    citation: 'Fick, S.E. and R.J. Hijmans, 2017. WorldClim 2: new 1-km spatial resolution climate surfaces for global land areas. International Journal of Climatology 37 (12): 4302–4315.',
    terms: 'See data/sources/climate.md: worldclim.org states free academic / non-commercial use; redistribution or commercial use requires prior permission.',
  },
  processing: {
    resample: '3x3 block mean of valid 10′ pixels -> 0.5°',
    oceanFill: `screened Poisson fill from coasts towards a zonal/seasonal sea-surface air formula with current anomalies; influence length T ${LT} cells, P ${LP} cells; enclosed water bodies < ${INLAND_MAX} cells: Laplace fill from shores`,
    antarctic: `land cells south of 60°S above 1000 m blended (weight smoothstep((z-1000)/1500)) towards Fortuin & Oerlemans 1990 T = 34.46 - 0.00914 z - 0.688|lat| + South Pole seasonal cycle; accumulation towards (600 e^(-z/700) + 20)/12 mm/month; ${antCells} cells`,
    waterCells: nWater,
    enclosedCells: inland.reduce((a, b) => a + b, 0),
    script: 'scripts/climate/bake-normals.mjs',
  },
};
fs.writeFileSync(path.join(OUT, 'normals.json'), JSON.stringify(header, null, 2));
log('normals.json written — done');
