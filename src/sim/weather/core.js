// Passionaris daily weather simulator (pure, no DOM; runs in Node and in a Web Worker).
//
// Grid: SIM 720x360 (docs/ENGINE.md). One step = one day. Per cell and day:
//   T = normal (daily, mean-preserving interpolation of the monthly normals)
//       + paleo dT (anomalyFn, cached per year)
//       + sigma(cell, season) * synoptic anomaly (coarse AR(1) fields, see fields.js)
//   precipitation: a latent unit Gaussian z (fast advected coarse field + mesoscale noise) decides
//       occurrence (wet when z > z*, P(wet) = p from the monthly mean) and intensity
//       (mu/(p*M) * g(z - z*), g(d) = d + d^2/2 + d^3/6, M = E[g | wet]); persistent wet/dry
//       spells come from an independent lognormal factor exp(k1*S + k2*V - (k1^2+k2^2)/2) of
//       the slow (25 d) and very slow (150 d) fields, with mean exactly 1. So the expectation
//       equals the monthly normal exactly, amounts are heavy-tailed and spatially coherent, and
//       the interannual variability is the same in wet and dry climates.
//   snow water equivalent: snowfall below ~0.5 degC, degree-day melt.
//   sea/lake ice: thickness proxy, Stefan-like growth from frost, degree-day melt + ocean heat flux.
//   drought: rolling (exponential) 90- and 365-day precipitation vs. normal.
//   fire danger: warm + dry spell + seasonal dryness (90-day rain vs. evaporative demand) + drought
//       anomaly + vegetation fuel, with rare ignitions.
// Box diagnostics (5x5 deg) feed the extreme-event detectors (events.js) and the
// per-year climateLog (climatelog.js).
//
// The mesoscale noise is a static per-seed smooth Gaussian table read through a daily random window
// (buildMesoNoise): rain areas and the cloud band below the rain threshold come in coherent patches
// a few cells wide (fronts, cloud systems) instead of per-cell salt-and-pepper, while every cell keeps a
// unit-variance latent, so the precipitation statistics per cell are those of white cell noise.
//
// A day is one pass over the SIM rows (#passRows): the coarse fields are interpolated once per row,
// then small loops over the row run while it is cache-resident: every cell (synoptic anomaly, B;
// precipitation, G), the row's land cells (temperature, snow, flood memory, dry spell, drought, fire,
// R/A, box sums) and its freezing sea/lake cells (ice, R). Land and ice state is stored compactly
// (indexed by land / ice cell number, in row order), the rest per SIM cell.
//
// Fast clock (setOptions({stride: k})): blocks of up to k days in one step (#simulateDay). The fields,
// tropical cyclones and the field-based detectors still advance every day; the cell pass runs once for
// the block's middle day, and snow / ice integrate day by day with each day's box-mean field change.
//
// Output grid: Uint8Array RGBA (720*360*4)
//   R  land: snow cover 0-255; water: sea/lake ice cover 0-255 (>= 50 means ice)
//   G  0-127 cloud fraction without precipitation, 128-255 precipitation intensity
//      (128 = trace, 255 >= 60 mm/day; log scale)
//   B  temperature anomaly vs. the (modern) normals incl. paleo dT: 128 = 0, 8 units per degC
//   A  drought 0-255 (land only)

import { W, H, N, CX, CY, CN, BX, BY, BN, OCEAN, LAKE, LAND, cellLat, cellLon, nodeLat, boxLat, boxLon, interpTables, nodesToCells, cellOf } from './grid.js';
import { dayInfo, dayOf, daysInMonth, daysBeforeMonth, toDate } from './date.js';
import { GAUSS, GAUSS_BITS, invNorm, normCdf, normPdf, phiLut, gexLut, dayBase, cellHash, u01 } from './rng.js';
import { SynopticField } from './fields.js';
import { EventEngine, DET } from './events.js';
import { ClimateLog, LOG_SYNTHETIC, LOG_PARTIAL } from './climatelog.js';

export const FORMAT_VERSION = 1;
export const FORMAT_KIND = 'passionaris.weather';

export const DEFAULT_OPTIONS = {
  maxSimDays: 730,      // a jump longer than this re-initialises from climatology instead of simulating every day
  stride: 1,            // simulate blocks of up to this many days at once (run-time pacing for a fast clock, see setOptions)
  anomalyStride: 5,     // anomalyFn is evaluated every N cells (5 = 2.5 deg) once per year and interpolated
  logAnnualYears: 300,  // climateLog keeps this many recent years annually, older ones as decades
  events: true,
  spinupDays: 400,      // climatological spin-up length on (re)initialisation
  spinupStep: 5,
};

// --------------------------------------------------------------------- model constants
const SNOW_T0 = -0.5, SNOW_T1 = 1.5;   // all snow below, all rain above (50 % at 0.5 degC)
const DDF = 3.0;                        // degree-day melt factor, mm SWE / degC / day
const SWE_MAX = 3000;                   // mm, perennial snow / ice sheets saturate here
// Sea/lake ice thickness proxy (cm). Growth is Stefan-like (slows as the ice thickens:
// KF * frost * H0 / (H0 + h), ~2 m after a 4000 degC-day Arctic winter), melt is degree-day
// plus a constant ocean heat flux (strong around Antarctica, weak in the Arctic). Without the
// thickness limit and the ocean heat, Southern Ocean ice never melted (summer extent 14 Mkm2
// instead of ~3).
const ICE_KF = 0.15, ICE_H0 = 50, ICE_KM = 1.0, ICE_MAX = 400;
const ICE_QO_N = 0.03, ICE_QO_S = 0.7;   // ocean heat flux melt, cm/day (lakes: 0)
const ICE_FLAG_CM = 5;
const WET_K = 4.0;                      // p(wet) = 1 - exp(-mu / WET_K), mu in mm/day
const A3 = 1 - 1 / 3, A90 = 1 - 1 / 90, A365 = 1 - 1 / 365;
const C90 = 90 * 0.25, C365 = 365 * 0.25; // ratio regularisation (mm) so deserts never look like droughts
const DROUGHT_R0 = 0.9, DROUGHT_K = 2.0; // d = clamp((0.9 - ratio) * 2)
const PF_TAU = 30;                      // years: the drought reference adapts to slow paleo precipitation change
// precipFactor clamp: the climate module's effective factor (anomaly.js, maxFactor 25) folds the
// green-Sahara monsoon rain into the factor of a near-zero desert normal, so it must pass through
const PF_MAX = 50;
// log-amplitudes of the persistent precipitation factor (slow 25 d / very slow 150 d fields)
const SF_K1 = 0.35, SF_K2 = 0.25, SF_C = -(SF_K1 * SF_K1 + SF_K2 * SF_K2) / 2;
// weights of the temperature unit field
const T_FAST = 0.8, T_SLOW = 0.6;
const TCLIP = 3.3;                      // synoptic temperature anomaly clipped at +-3.3 sigma
const W_FIELD = 0.88, W_NOISE = Math.sqrt(1 - W_FIELD * W_FIELD);
const SNOWSTORM_MM = 25;                // daily snowfall (SWE, mm) of a snowstorm cell
const SNOWSTORM_CELLS = 25;               // calibrated with the mesoscale noise (coherent heavy cells) to the earlier event rates
const FLOOD_CELLS = 9;
const IGNITION = 2.5e-3;                // ignition probability per cell-day at fire danger 1 (scaled by FD^3)
const FIRE_MIN = 0.35;
const HEAT_A = 2.1, COLD_A = 2.1;       // box-mean synoptic anomaly (sigma units) of heat/cold waves
const HEAT_C = 2.5, COLD_C = 3.0;       // ... and at least this many degC (no +1 degC "heat waves" in the rainforest)
const STORM_Z = 3.2;                    // coarse fast precipitation field value of an extratropical storm
const GSHIFT = 32 - GAUSS_BITS;
const DEG = Math.PI / 180;
// mesoscale noise of the precipitation latent (see buildMesoNoise): blob scale in cells, daily window shifts
const MESO_SX = 1.6, MESO_SY = 1.4;
const MZ_RS = 16, MZ_ROWS = H + MZ_RS, MZ_PAD = 10, MZ_W = W + MZ_PAD;
// n-day blocks (fast clock). The fast part of a block's precipitation total is shrunk towards its
// conditional mean so that sums over many blocks (the 90 / 365-day drought sums) keep the variance of
// daily sums: n * lambda^2 = (1 + rho) / (1 - rho) for a day-to-day correlation rho of daily amounts.
// The wettest day of a block is estimated from the middle day's latent shifted by the expected maximum
// of the block's days (k * E[max of n standard normals]): a block counts as wet (dry-spell reset) when
// that day gives more than 1 mm (k = BLOCK_DRY_K + BLOCK_DRY_KN * n, calibrated on the fire danger of daily
// steps for n = 3..12), and snowstorm / flood cells are detected on it (k = BLOCK_EXT_K), so these events keep
// roughly their daily rates although only one day is simulated. Blocks are meant for n <= ~8.
const BLOCK_MAX = 31, BLOCK_RHO = 0.3, BLOCK_DRY_K = 0.62, BLOCK_DRY_KN = 0.015, BLOCK_EXT_K = 0.57;
const BLOCK_LAMBDA = new Float64Array(BLOCK_MAX + 1), BLOCK_DSHIFT = new Float64Array(BLOCK_MAX + 1), BLOCK_XSHIFT = new Float64Array(BLOCK_MAX + 1);
for (let n = 1; n <= BLOCK_MAX; n++) {
  BLOCK_LAMBDA[n] = Math.min(1, Math.sqrt((1 + BLOCK_RHO) / (1 - BLOCK_RHO) / n));
  // E[max of n iid N(0,1)] = integral of (1 - Phi(x)^n - Phi(-x)^n) over x > 0
  let e = 0;
  for (let x = 0.0025; x < 8; x += 0.005) e += (1 - normCdf(x) ** n - normCdf(-x) ** n) * 0.005;
  BLOCK_DSHIFT[n] = n === 1 ? 0 : (BLOCK_DRY_K + BLOCK_DRY_KN * n) * e;
  BLOCK_XSHIFT[n] = n === 1 ? 0 : BLOCK_EXT_K * e;
}
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// synthetic climateLog (fast-forward) rates per box-year, calibrated on the real normals:
// drought months (SYN_DM * E[max(0, -Z - 0.5)] = 0.42), severe-winter probability, heat waves
// (SYN_HW * E[max(0, 1 + 0.8 Z)] = 0.18)
const SYN_DM = 0.42 / 0.1978, SYN_SW = 0.134, SYN_HW = 0.18 / 1.04;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** E[max(0, X)] for X ~ N(mu, s^2). */
const posPart = (mu, s) => (s > 1e-9 ? mu * normCdf(mu / s) + s * normPdf(mu / s) : mu > 0 ? mu : 0);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const INV255 = 1 / 255;
/**
 * Heat/cold wave value from the box-mean anomaly in sigma units: 1 at 2.1, 2 at 2.4, 3 at 2.7, 4 at 3.0,
 * 5 at 3.25 (the anomaly is clipped at 3.3). An event keeps the peak over all its boxes and days.
 */
const waveSeverity = a => (a < 3 ? 1 + (a - 2.1) / 0.3 : 4 + (a - 3) / 0.25);

// G channel: precipitation intensity, log scale, index = mm * 4
const GLUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) GLUT[i] = Math.round(128 + 127 * Math.min(1, Math.log1p(i / 4) / Math.log1p(60)));
// Precipitation parameters as a function of the daily mean mu (index = sqrt(mu) * ZS_SCALE):
// threshold z* = Q^-1(p), p = 1 - exp(-mu / WET_K), and amount scale 1 / (p * M(z*)), where
// M(a) = E[g(Z - a) | Z > a] = E[Y] + E[Y^2]/2 + E[Y^3]/6 with Y = Z - a, lambda = phi(a) / Q(a):
// E[Y] = lambda - a, E[Y^2] = 1 - a*lambda + a^2, E[Y^3] = (2 + a^2)*lambda - 3a - a^3.
const ZS_N = 4096, ZS_MAX = 8, ZS_SCALE = ZS_N / ZS_MAX;
const ZT_LUT = new Float64Array(ZS_N + 2), MWK_LUT = new Float64Array(ZS_N + 2);
for (let i = 0; i < ZS_N + 2; i++) {
  const sq = Math.max(i, 0.25) / ZS_SCALE, mu = sq * sq;
  const p = -Math.expm1(-mu / WET_K);
  const a = -invNorm(p), lam = normPdf(a) / p;
  const M = (lam - a) + (1 - a * lam + a * a) / 2 + ((2 + a * a) * lam - 3 * a - a * a * a) / 6;
  ZT_LUT[i] = a; MWK_LUT[i] = 1 / (p * M);
}
const NO_RAIN = 99;
// R channel: snow cover from SWE, index = mm * 4
const SNOW_LUT_N = 480, SNOW_LUT = new Uint8Array(SNOW_LUT_N);
for (let i = 0; i < SNOW_LUT_N; i++) SNOW_LUT[i] = Math.round(255 * (1 - Math.exp(-(i + 0.5) / 4 / 12)));

/**
 * Create a simulator. `normals` follow docs/ENGINE.md:
 *   tavg Int16Array(12*N) degC*10, prec Uint16Array(12*N) mm/month, elev Int16Array(N) m.
 * @param {object} o
 * @param {{tavg, prec, elev}} o.normals
 * @param {number} [o.seed=1]
 * @param {number} [o.t=0]      game time, days since -4999-01-01
 * @param {Uint8Array} [o.mask] 0 ocean, 1 lake, 2 land (see maskFromCells); default elev > 0
 * @param {Float32Array|Uint8Array} [o.veg] fuel 0..1 (Uint8 0..255); default from the normals
 * @param {(year:number, lat:number, lon:number) => {dT?:number, precipFactor?:number}} [o.anomalyFn]
 * @param {object} [o.options] see DEFAULT_OPTIONS
 * @param {boolean} [o.deferInit] skip the initial spin-up (deserialize() follows)
 */
export function createWeather(o) { return new WeatherSim(o); }

export class WeatherSim {
  constructor({ normals, seed = 1, t = 0, mask = null, veg = null, anomalyFn = null, options = {}, deferInit = false }) {
    if (!normals?.tavg || !normals?.prec) throw new Error('weather: normals {tavg, prec, elev} required');
    if (normals.tavg.length !== 12 * N || normals.prec.length !== 12 * N) throw new Error('weather: normals must be [12][360][720]');
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.seed = seed >>> 0;
    this.anomalyFn = typeof anomalyFn === 'function' ? anomalyFn : null;
    this.#setupStatic(normals, mask, veg);
    this.#setupState();
    this.#buildNoise();
    for (const k in this.fields) this.fields[k].noise = this.NZ;
    this.events = new EventEngine(this.seed);
    this.events.onAttach = (k, b, ev) => this.#onAttach(k, b, ev);
    this.log = new ClimateLog(BN, this.opts.logAnnualYears);
    this.day = -Infinity;
    if (!deferInit) {
      const d = dayOf(t);
      this.#reinit(d);
      this.#simulateDay(d);
    }
  }

  // ===================================================================== setup
  #setupStatic(normals, mask, veg) {
    // ---- sanitize inputs (nodata -> zonal mean)
    const tavg = Float32Array.from(normals.tavg, v => (v <= -9000 ? NaN : v * 0.1));
    const prec = Float32Array.from(normals.prec, v => (v >= 65535 ? NaN : v));
    fillNaNZonal(tavg); fillNaNZonal(prec);
    this.prec = prec;
    this.elev = normals.elev && normals.elev.length === N ? normals.elev : new Int16Array(N);

    const cls = new Uint8Array(N);
    if (mask) { if (mask.length !== N) throw new Error('weather: mask must be 720*360'); cls.set(mask); }
    else for (let c = 0; c < N; c++) cls[c] = this.elev[c] > 0 ? LAND : OCEAN;
    for (let c = 0; c < N; c++) if (cls[c] > LAND) cls[c] = LAND;
    this.cls = cls;
    let h = 0x811c9dc5;
    for (let c = 0; c < N; c++) h = Math.imul(h ^ cls[c], 0x01000193);
    this.maskHash = h >>> 0;

    // ---- mean-preserving node values for the daily interpolation of monthly T:
    // the month mean of the piecewise-linear curve is (V[k-1] + 6 V[k] + V[k+1]) / 8 = M[k]
    this.Tv = meanPreservingNodes(tavg, N);

    // ---- per-row geometry
    this.rowLat = new Float32Array(H); this.rowW = new Float32Array(H); this.rowWLat = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const lat = cellLat(y);
      this.rowLat[y] = lat; this.rowW[y] = Math.cos(lat * DEG); this.rowWLat[y] = smooth(20, 45, Math.abs(lat));
    }

    // ---- per-cell climate descriptors
    const sig = new Float32Array(N), fuelN = new Float32Array(N), iceable = new Uint8Array(N);
    const tAnn = new Float32Array(N), pAnn = new Float32Array(N);
    for (let c = 0; c < N; c++) {
      const alat = Math.abs(this.rowLat[(c / W) | 0]);
      let mn = Infinity, mx = -Infinity, st = 0, sp = 0;
      for (let k = 0; k < 12; k++) {
        const v = tavg[k * N + c];
        if (v < mn) mn = v; if (v > mx) mx = v;
        st += v; sp += prec[k * N + c];
      }
      const range = mx - mn;
      tAnn[c] = st / 12; pAnn[c] = sp;
      if (cls[c] === LAND) {
        sig[c] = Math.min(7, Math.max(0.5, 0.5 + 0.08 * range + 3.5 * smooth(25, 60, alat) * Math.min(1, 0.4 + range / 30)));
        // fuel: moisture index (annual P vs. a crude evaporative demand) keeps cold forests such as
        // the taiga fully vegetated at 400 mm, deserts bare; tundra and ice have little to burn
        const moist = sp / (300 + 40 * Math.max(0, st / 12));
        fuelN[c] = mx <= 0 ? 0 : smooth(0.15, 0.6, moist) * smooth(-14, -2, st / 12) * (1 - 0.65 * smooth(1800, 3500, sp));
      } else {
        sig[c] = Math.min(5, 0.4 + 0.06 * range + 1.2 * smooth(20, 60, alat));
        iceable[c] = mn < 4 ? 1 : 0;
      }
    }
    if (veg) {
      if (veg.length !== N) throw new Error('weather: veg must be 720*360');
      const k = veg instanceof Uint8Array ? 1 / 255 : 1;
      for (let c = 0; c < N; c++) fuelN[c] = cls[c] === LAND ? clamp01(veg[c] * k) : 0;
    }
    this.sig = sig;

    // ---- compact land / ice cell lists
    this.landIdx = indexWhere(cls, v => v === LAND);
    const L = this.landIdx.length;
    this.landY = new Uint16Array(L); this.landBox = new Uint16Array(L); this.fuel = new Float32Array(L);
    this.droughtOn = new Uint8Array(L); // no drought index on ice sheets and polar deserts
    this.landK = new Int32Array(N).fill(-1);
    for (let k = 0; k < L; k++) {
      const c = this.landIdx[k], y = (c / W) | 0;
      this.landY[k] = y; this.landBox[k] = ((y / 10) | 0) * BX + (((c % W) / 10) | 0); this.fuel[k] = fuelN[c];
      this.droughtOn[k] = tAnn[c] > -8 ? 1 : 0;
      this.landK[c] = k;
    }
    this.iceIdx = indexWhere(iceable, v => v === 1);
    const I = this.iceIdx.length;
    this.iceY = new Uint16Array(I); this.iceTf = new Float32Array(I); this.iceQ = new Float32Array(I);
    this.iceK = new Int32Array(N).fill(-1);
    for (let i = 0; i < I; i++) {
      const c = this.iceIdx[i], y = (c / W) | 0, lake = cls[c] === LAKE;
      this.iceY[i] = y; this.iceTf[i] = lake ? 0 : -1.8; this.iceK[c] = i;
      this.iceQ[i] = lake ? 0 : this.rowLat[y] >= 0 ? ICE_QO_N : ICE_QO_S;
    }
    // compact (row-ordered) copies for the rows pass: the cell lists are sorted, so the land / ice
    // cells of row y are [landRow[y], landRow[y+1]) / [iceRow[y], iceRow[y+1])
    this.landRow = rowRanges(this.landY); this.iceRow = rowRanges(this.iceY);
    this.sigL = gather(sig, this.landIdx); this.sigI = gather(sig, this.iceIdx);
    this.TvL = new Float32Array(12 * L); this.TvI = new Float32Array(12 * I);
    for (let m = 0; m < 12; m++) {
      const o = m * N;
      for (let k = 0; k < L; k++) this.TvL[m * L + k] = this.Tv[o + this.landIdx[k]];
      for (let i = 0; i < I; i++) this.TvI[m * I + i] = this.Tv[o + this.iceIdx[i]];
    }
    this.dTL = new Float32Array(L); this.dTI = new Float32Array(I);

    // ---- interpolation tables
    this.cTab = interpTables(5);
    this.aTab = interpTables(this.opts.anomalyStride);

    // ---- box statics
    const bLW = new Float64Array(BN), bAllW = new Float64Array(BN), bT = new Float64Array(BN), bP = new Float64Array(BN);
    const bTw = new Float64Array(BN), bPw = new Float64Array(BN), bWin = new Float64Array(BN), bSum = new Float64Array(BN);
    const bSig = new Float64Array(BN), bWinL = new Float64Array(BN), bSumL = new Float64Array(BN);
    const bMonAll = new Float32Array(12 * BN);
    const bRep = new Int32Array(BN).fill(-1), bRepD = new Float64Array(BN).fill(Infinity);
    for (let c = 0; c < N; c++) {
      const y = (c / W) | 0, x = c % W, b = ((y / 10) | 0) * BX + ((x / 10) | 0), w = this.rowW[y];
      const north = this.rowLat[y] >= 0;
      const win = north ? (tavg[11 * N + c] + tavg[c] + tavg[N + c]) / 3 : (tavg[5 * N + c] + tavg[6 * N + c] + tavg[7 * N + c]) / 3;
      const sum = north ? (tavg[5 * N + c] + tavg[6 * N + c] + tavg[7 * N + c]) / 3 : (tavg[11 * N + c] + tavg[c] + tavg[N + c]) / 3;
      bAllW[b] += w; bTw[b] += tAnn[c] * w; bPw[b] += pAnn[c] * w; bWin[b] += win * w; bSum[b] += sum * w;
      for (let k = 0; k < 12; k++) bMonAll[k * BN + b] += tavg[k * N + c] * w;
      if (cls[c] === LAND) {
        bLW[b] += w; bT[b] += tAnn[c] * w; bP[b] += pAnn[c] * w; bSig[b] += sig[c] * w; bWinL[b] += win * w; bSumL[b] += sum * w;
        const dx = (x % 10) - 4.5, dy = (y % 10) - 4.5, d = dx * dx + dy * dy;
        if (d < bRepD[b]) { bRepD[b] = d; bRep[b] = c; }
      }
    }
    for (let k = 0; k < 12; k++) for (let b = 0; b < BN; b++) bMonAll[k * BN + b] /= bAllW[b];
    this.bTvAll = meanPreservingNodes(bMonAll, BN);
    this.bLandW = bLW; this.bAllW = bAllW;
    this.bLandFrac = new Float32Array(BN); this.bClimT = new Float32Array(BN); this.bClimP = new Float32Array(BN);
    this.bWinterT = new Float32Array(BN); this.bSummerT = new Float32Array(BN); this.bSig = new Float32Array(BN);
    this.bRep = bRep; this.bNorth = new Uint8Array(BN); this.bHasLand = new Uint8Array(BN); this.bHeat = new Uint8Array(BN);
    for (let b = 0; b < BN; b++) {
      const by = (b / BX) | 0, bx = b % BX;
      this.bNorth[b] = boxLat(by) >= 0 ? 1 : 0;
      this.bLandFrac[b] = bLW[b] / bAllW[b];
      const land = bLW[b] > 0;
      this.bHasLand[b] = land ? 1 : 0;
      this.bClimT[b] = land ? bT[b] / bLW[b] : bTw[b] / bAllW[b];
      this.bClimP[b] = land ? bP[b] / bLW[b] : bPw[b] / bAllW[b];
      this.bWinterT[b] = land ? bWinL[b] / bLW[b] : bWin[b] / bAllW[b];
      this.bSummerT[b] = land ? bSumL[b] / bLW[b] : bSum[b] / bAllW[b];
      this.bSig[b] = land ? bSig[b] / bLW[b] : 1;
      if (bRep[b] < 0) bRep[b] = (by * 10 + 5) * W + bx * 10 + 5;
      // boxes where heat waves can be detected (see #boxes) and have a warm enough summer
      this.bHeat[b] = land && this.bLandFrac[b] >= 0.25 && this.bClimT[b] > -12 && this.bSummerT[b] >= 18 ? 1 : 0;
    }

    // ---- coarse-node land fraction (3x3 node neighbourhood) for storm relevance
    const nodeLand = new Float32Array(CN);
    for (let c = 0; c < N; c++) if (cls[c] === LAND) nodeLand[((((c / W) | 0) / 5) | 0) * CX + (((c % W) / 5) | 0)] += 1 / 25;
    this.nodeCoast = new Uint8Array(CN);
    for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = j + dj; if (jj < 0 || jj >= CY) continue;
        s += nodeLand[jj * CX + ((i + di + CX) % CX)];
      }
      this.nodeCoast[j * CX + i] = s >= 0.3 ? 1 : 0;
    }
  }

  #setupState() {
    // synoptic fields: temperature (fast advected + slow), precipitation (fast advected + slow + very slow)
    this.fields = {
      fastT: new SynopticField({ stream: 1, ry: 2, rx: 2, phi: 0.75, advect: true }),
      slowT: new SynopticField({ stream: 2, ry: 2, rx: 2, phi: 1 - 1 / 25, cosFloor: 0.3 }),
      fastP: new SynopticField({ stream: 3, ry: 1, rx: 1, phi: 0.55, advect: true }),
      slowP: new SynopticField({ stream: 4, ry: 2, rx: 2, phi: 1 - 1 / 25, cosFloor: 0.3 }),
      vslowP: new SynopticField({ stream: 5, ry: 2, rx: 2, phi: 1 - 1 / 150, cosFloor: 0.4 }),
    };
    // bilinear interpolation between correlated nodes lowers the variance between nodes;
    // these per-(row, x mod 5) factors restore exactly unit variance at every cell
    const F = this.fields;
    this.normT = this.#interpNorm([[F.fastT, T_FAST * T_FAST], [F.slowT, T_SLOW * T_SLOW]]);
    this.normP = this.#interpNorm([[F.fastP, 1]]);
    this.TC = new Float32Array(CN); this.PC = new Float32Array(CN); this.SF = new Float32Array(CN);
    this.rT = new Float32Array(CX); this.rP = new Float32Array(CX); this.rS = new Float32Array(CX);
    // full-resolution row buffers of the interpolated fields, and the per-phase interpolation
    // fractions / unit-variance factors (cell x = 5i + 2 + j lies at fraction j/5 between nodes i, i+1)
    this.uX = new Float64Array(W); this.zX = new Float64Array(W); this.sX = new Float64Array(W); this.dzX = new Float64Array(W);
    this.phF = new Float64Array(5); this.kT = new Float64Array(5); this.kP = new Float64Array(5); this.kOne = new Float64Array(5).fill(1);
    for (let j = 0; j < 5; j++) this.phF[j] = this.cTab.fx[2 + j];
    this.sRow = new Float32Array(H);
    this.nodeSummer = new Float32Array(CY);

    // per-year / per-month caches
    const L = this.landIdx.length, I = this.iceIdx.length;
    this.dT = new Float32Array(N); this.pf = new Float32Array(N).fill(1);
    this.zth = new Float32Array(N).fill(NO_RAIN); this.mwN = new Float32Array(N);
    this.muL = new Float32Array(L); this.muRef = new Float32Array(L); this.floodThr = new Float32Array(L);
    this.anomYear = null;

    // state: land (compact), ice (compact), drought reference adaptation (per cell)
    this.swe = new Float32Array(L);
    // p90/p365: exponentially weighted precipitation sums; n90/n365: their expected values
    // at day refDay (advanced in closed form, muRef is constant within a month)
    this.p90 = new Float32Array(L); this.n90 = new Float32Array(L);
    this.p365 = new Float32Array(L); this.n365 = new Float32Array(L);
    this.refDay = 0;
    this.w3 = new Float32Array(L); this.dry = new Uint8Array(L);
    this.TL = new Float32Array(L); // today's land temperature (scratch)
    this.ice = new Float32Array(I);
    this.pfLong = new Float32Array(N).fill(1);

    // outputs of the last simulated day
    this.grid = new Uint8Array(N * 4);
    this.grid32 = new Uint32Array(this.grid.buffer);
    this.aU = new Float32Array(N);       // synoptic temperature anomaly, sigma units
    this.precip = new Float32Array(N);   // mm/day
    this.drought = new Uint8Array(N); this.fire = new Uint8Array(N);

    // box accumulators: daily (scratch), monthly, winter, yearly
    this.bd = {
      Tl: new Float64Array(BN), Al: new Float64Array(BN), Pl: new Float64Array(BN), Dl: new Float64Array(BN),
      Aall: new Float64Array(BN), Pall: new Float64Array(BN),
      snowN: new Int32Array(BN), snowMax: new Float32Array(BN), snowCell: new Int32Array(BN),
      floodN: new Int32Array(BN), floodMax: new Float32Array(BN), floodCell: new Int32Array(BN),
      rain: new Float64Array(BN), stormV: new Float32Array(BN), stormCell: new Int32Array(BN),
    };
    this.acc = {
      yT: new Float64Array(BN), yP: new Float64Array(BN), yDM: new Uint8Array(BN), ySW: new Uint8Array(BN), yHW: new Uint8Array(BN),
      mD: new Float64Array(BN), wA: new Float64Array(BN), wN: new Int32Array(BN), wCold: new Uint8Array(BN),
    };
    this.yDays = 0; this.mDays = 0;
    this.curYear = null; this.curMonth = null;
    // n-day blocks: per-day box-mean temperature field and storm values, middle-day box values
    this.blkTC = new Float32Array(BLOCK_MAX * BN); this.blkSV = new Float32Array(BLOCK_MAX * BN); this.blkSC = new Int32Array(BLOCK_MAX * BN);
    this.blkH = new Float32Array(BN); this.blkC = new Float32Array(BN); this.blkDB = new Float32Array(BLOCK_MAX * BN); this.blkDBmin = new Float32Array(BN);
    this.repTC = new Float32Array(CN); this.repPC = new Float32Array(CN); this.repSF = new Float32Array(CN);
    this.iceBox = new Uint16Array(this.iceIdx.length);
    for (let i = 0; i < this.iceIdx.length; i++) { const c = this.iceIdx[i]; this.iceBox[i] = ((((c / W) | 0) / 10) | 0) * BX + (((c % W) / 10) | 0); }
    this.bAUr = new Float32Array(BN); this.bMTr = new Float32Array(BN);
    // kappa: land-weighted mean unit-variance factor of the box (box-mean u ~ kappa * box-mean TC)
    this.bKappa = new Float32Array(BN); this.bHeatable = new Uint8Array(BN);
    {
      const wsum = new Float64Array(BN), ksum = new Float64Array(BN);
      for (let k = 0; k < L; k++) {
        const c = this.landIdx[k], y = this.landY[k], b = this.landBox[k], w = this.rowW[y];
        wsum[b] += w; ksum[b] += w * this.normT[y * 5 + (c % W) % 5];
      }
      for (let b = 0; b < BN; b++) {
        this.bKappa[b] = wsum[b] > 0 ? ksum[b] / wsum[b] : 1;
        this.bHeatable[b] = this.bLandW[b] > 0 && this.bLandFrac[b] >= 0.25 && this.bClimT[b] > -12 ? 1 : 0;
      }
    }
    this.candCell = new Int32Array(8192); this.candFD = new Float32Array(8192); this.nCand = 0;
    this.info = {}; this.infoR = {}; this.infoA = {};
    this.tw = { m0: 0, m1: 0, w1: 0 };
    this.winterNow = { n: false, s: false };
  }

  /** Static per-seed cell noise: NZ[c + dayOffset] gives a fresh white Gaussian field every day. */
  #buildNoise() {
    if (this.noiseSeed === this.seed) return;
    this.noiseSeed = this.seed;
    this.NZ = this.NZ || new Float32Array(2 * N);
    const base = dayBase(this.seed, 0x7fffffff, 13);
    let s = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const v = GAUSS[cellHash(base, i) >>> GSHIFT]; this.NZ[i] = v; s += v; s2 += v * v; }
    // exactly zero mean / unit variance: the synoptic fields draw daily windows of this table,
    // and any table mean would be amplified by the blur normalisation and accumulated by AR(1)
    const mean = s / N, k = 1 / Math.sqrt(s2 / N - mean * mean);
    for (let i = 0; i < N; i++) this.NZ[i] = this.NZ[i + N] = (this.NZ[i] - mean) * k;
    this.MZ = buildMesoNoise(this.seed, this.MZ);
  }

  #interpNorm(parts) {
    const { iy0, iy1, fy, fx } = this.cTab;
    const cov = (j, j2, lag) => { let s = 0; for (const [f, w2] of parts) s += w2 * f.covariance(j, j2, lag); return s; };
    const out = new Float32Array(H * 5);
    for (let y = 0; y < H; y++) {
      const j0 = iy0[y], j1 = iy1[y], v = fy[y];
      const a0 = cov(j0, j0, 0), a1 = cov(j0, j0, 1), b0 = cov(j1, j1, 0), b1 = cov(j1, j1, 1), c0 = cov(j0, j1, 0), c1 = cov(j0, j1, 1);
      for (let ph = 0; ph < 5; ph++) {
        const u = fx[ph];
        const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
        const vr = (w00 * w00 + w10 * w10) * a0 + (w01 * w01 + w11 * w11) * b0 + 2 * w00 * w10 * a1 + 2 * w01 * w11 * b1
          + 2 * (w00 * w01 + w10 * w11) * c0 + 2 * (w00 * w11 + w10 * w01) * c1;
        out[y * 5 + ph] = 1 / Math.sqrt(vr);
      }
    }
    return out;
  }

  // ===================================================================== public API
  /** Advance to game time t (days). Returns {t, day, date, grid, events}. */
  step(t) {
    const target = dayOf(t);
    if (!(target >= -1e7 && target <= 1e8)) throw new Error(`weather: bad time ${t}`);
    // built with deferInit and never deserialized: start here (no synthetic history from year 1)
    if (this.curYear === null) { this.#reinit(target); this.#simulateDay(target); }
    else if (target < this.day) this.#jump(target, true);
    else if (target - this.day > this.opts.maxSimDays) this.#jump(target, false);
    else while (this.day < target) this.#advance(target);
    return this.current(t);
  }

  /** One daily step, or with stride k > 1 one block of up to k days (never across a month end). */
  #advance(target) {
    const k = this.opts.stride;
    if (!(k > 1)) { this.#simulateDay(this.day + 1); return; }
    const i = dayInfo(this.day + 1, this.infoA);
    const end = Math.min(target, this.day + k, this.day + 1 + i.daysInMonth - i.day);
    this.#simulateDay(end, end - this.day);
  }

  /** Last simulated frame without advancing; events emitted since the previous call. */
  current(t = this.day) {
    return { t, day: this.day, date: toDate(this.day), grid: this.grid, events: this.events.takeOutput() };
  }

  /** Normal (climatological) temperature of a cell for the current day, degC (modern normals). */
  normalTemp(c) {
    const { m0, m1, w1 } = this.tw;
    return this.Tv[m0 * N + c] * (1 - w1) + this.Tv[m1 * N + c] * w1;
  }

  /** Temperature of a cell for the current day, degC. */
  tempAt(c) {
    return this.normalTemp(c) + this.dT[c] + this.sig[c] * this.sRow[(c / W) | 0] * this.aU[c];
  }

  /** Point query for tooltips: everything known about one cell today. */
  query(cell) {
    const c = cell | 0, y = (c / W) | 0, x = c % W, k = this.landK[c], i = this.iceK[c];
    return {
      cell: c, lat: cellLat(y), lon: cellLon(x), kind: ['ocean', 'lake', 'land'][this.cls[c]],
      temp: this.tempAt(c), normalTemp: this.normalTemp(c), paleoDT: this.dT[c], precipFactor: this.pf[c],
      precip: this.precip[c], cloud: this.grid[c * 4 + 1],
      swe: k >= 0 ? this.swe[k] : 0, snowCover: k >= 0 ? this.grid[c * 4] / 255 : 0,
      iceCm: i >= 0 ? this.ice[i] : 0, ice: i >= 0 && this.ice[i] >= ICE_FLAG_CM,
      drought: this.drought[c] / 255, fireDanger: this.fire[c] / 255,
    };
  }
  queryLatLon(lat, lon) { return this.query(cellOf(lat, lon)); }

  /**
   * A full SIM-grid field (new array): 'temp' (degC), 'precip' (mm/day), 'swe' (mm), 'ice' (cm),
   * 'drought' / 'fire' (0..255), 'mask', 'grid'.
   */
  getField(name) {
    switch (name) {
      case 'temp': { const o = new Float32Array(N); for (let c = 0; c < N; c++) o[c] = this.tempAt(c); return o; }
      case 'precip': return this.precip.slice();
      case 'swe': return expand(this.swe, this.landIdx, Float32Array);
      case 'ice': return expand(this.ice, this.iceIdx, Float32Array);
      case 'drought': return this.drought.slice();
      case 'fire': return this.fire.slice();
      case 'mask': return this.cls.slice();
      case 'grid': return this.grid.slice();
      default: throw new Error(`weather: unknown field ${name}`);
    }
  }

  /**
   * Change the run-time pacing (not part of the simulated climate, never taken from saves):
   *   maxSimDays  a step further ahead than this re-initialises from climatology instead of simulating;
   *   stride      1 = every day; k > 1 = blocks of up to k days per step (the weather shown is the
   *               middle day of the block, snow / ice / drought / flood memory advance with the block
   *               totals), so a clock running k times faster than the simulator still moves smoothly.
   */
  setOptions({ maxSimDays, stride } = {}) {
    if (maxSimDays !== undefined) {
      if (!(maxSimDays >= 1)) throw new Error(`weather: bad maxSimDays ${maxSimDays}`);
      this.opts.maxSimDays = maxSimDays;
    }
    if (stride !== undefined) {
      if (!(stride >= 1 && stride <= BLOCK_MAX)) throw new Error(`weather: bad stride ${stride}`);
      this.opts.stride = Math.floor(stride);
    }
    return { ...this.opts };
  }

  /** climateLog arrays (copies), see climatelog.js. */
  getClimateLog() { return this.log.export(); }
  climateAt(year, box) { return this.log.get(year, box); }

  setAnomalyFn(fn) {
    this.anomalyFn = typeof fn === 'function' ? fn : null;
    this.anomYear = null;
    if (this.curYear !== null) { this.#loadYear(this.curYear); this.#loadMonth(dayInfo(this.day)); }
  }

  // ===================================================================== time control
  #jump(target, rewind) {
    // active events end now; their 'end' messages are returned by the next current()
    if (this.opts.events) this.events.endAll(this.day + 1);
    const ty = dayInfo(target).year;
    if (rewind) this.log.truncateFrom(ty);
    else {
      this.#finalizeYear();
      this.#fillSynthetic(this.curYear + 1, ty);
    }
    this.#reinit(target);
    this.#simulateDay(target);
  }

  /** Reset all state to climatology (+ anomalies) for the start of `day`. */
  #reinit(day) {
    const info = dayInfo(day);
    this.curYear = info.year; this.curMonth = info.month;
    this.anomYear = null;
    this.#loadYear(info.year);
    if (this.anomalyFn) {
      const acc = new Float32Array(this.aTab.nx * this.aTab.ny);
      for (const dy of [30, 20, 10, 0]) {
        const r = this.#evalAnomalyNodes(info.year - dy);
        for (let n = 0; n < acc.length; n++) acc[n] += r.pf[n] / 4;
      }
      nodesToCells(acc, this.aTab, this.pfLong);
    } else this.pfLong.fill(1);
    this.#loadMonth(info);
    for (const k in this.fields) this.fields[k].reset(this.seed, day);
    this.#spinup(day);
    this.refDay = day - 1;
    const a = this.acc;
    a.yT.fill(0); a.yP.fill(0); a.yDM.fill(0); a.ySW.fill(0); a.yHW.fill(0); a.mD.fill(0); a.wA.fill(0); a.wN.fill(0); a.wCold.fill(0);
    this.yDays = 0; this.mDays = 0;
    this.day = day - 1;
  }

  /** Deterministic expected-value run of snow, ice and drought references over the last spinupDays. */
  #spinup(day) {
    const S = this.opts.spinupDays, st = this.opts.spinupStep;
    const { Tv, prec, sig, dT, pf, pfLong, swe, ice, n90, n365, landIdx, landY, iceIdx, iceY, iceTf, iceQ, sRow } = this;
    swe.fill(0); ice.fill(0);
    const L = landIdx.length, I = iceIdx.length;
    // drought references start at equilibrium with the start month / annual mean
    const i0 = dayInfo(day - S);
    for (let k = 0; k < L; k++) {
      const c = landIdx[k];
      let ann = 0;
      for (let m = 0; m < 12; m++) ann += prec[m * N + c];
      n90[k] = (90 * prec[(i0.month - 1) * N + c] * pfLong[c]) / i0.daysInMonth;
      n365[k] = ann * pfLong[c];
    }
    const info = {}, tw = {};
    for (let d = day - S; d < day; d += st) {
      const n = Math.min(st, day - d);
      dayInfo(d + (n >> 1), info);
      this.#tWeights(info, tw);
      this.#seasonRows(info);
      const o0 = tw.m0 * N, o1 = tw.m1 * N, w1 = tw.w1, w0 = 1 - w1;
      const mo = (info.month - 1) * N, invDim = 1 / info.daysInMonth;
      const a90 = Math.pow(A90, n), k90 = (1 - a90) / (1 - A90), a365 = Math.pow(A365, n), k365 = (1 - a365) / (1 - A365);
      for (let k = 0; k < L; k++) {
        const c = landIdx[k];
        const tn = Tv[o0 + c] * w0 + Tv[o1 + c] * w1 + dT[c];
        const s = sig[c] * sRow[landY[k]];
        const pm = prec[mo + c] * invDim;
        let sw = swe[k] + n * pm * pf[c] * phiLut((0.5 - tn) / s);
        if (sw > 0) sw -= n * DDF * s * gexLut(tn / s);
        swe[k] = sw < 0 ? 0 : sw > SWE_MAX ? SWE_MAX : sw;
        const muR = pm * pfLong[c];
        n90[k] = n90[k] * a90 + muR * k90;
        n365[k] = n365[k] * a365 + muR * k365;
      }
      for (let i = 0; i < I; i++) {
        const c = iceIdx[i];
        const tn = Tv[o0 + c] * w0 + Tv[o1 + c] * w1 + dT[c];
        const s = sig[c] * sRow[iceY[i]];
        const tf = iceTf[i];
        const h = ice[i];
        const v = h + n * (ICE_KF * s * gexLut((tf - tn) / s) * ICE_H0 / (ICE_H0 + h) - ICE_KM * s * gexLut((tn - tf) / s) - iceQ[i]);
        ice[i] = v < 0 ? 0 : v > ICE_MAX ? ICE_MAX : v;
      }
    }
    // initial drought pattern from the slow precipitation fields; dry spells and flood memory neutral
    const sp = nodesToCells(this.fields.slowP.data, this.cTab, this.aU);
    const vp = nodesToCells(this.fields.vslowP.data, this.cTab, this.precip);
    for (let k = 0; k < L; k++) {
      const c = landIdx[k];
      const f90 = Math.exp(0.6 * SF_K1 * sp[c] + SF_K2 * vp[c] - (0.36 * SF_K1 * SF_K1 + SF_K2 * SF_K2) / 2);
      const f365 = Math.exp(0.8 * SF_K2 * vp[c] - 0.32 * SF_K2 * SF_K2);
      this.p90[k] = n90[k] * f90;
      this.p365[k] = n365[k] * f365;
      const d1 = clamp01((DROUGHT_R0 - (this.p90[k] + C90) / (n90[k] + C90)) * DROUGHT_K);
      const d2 = clamp01((DROUGHT_R0 - (this.p365[k] + C365) / (n365[k] + C365)) * DROUGHT_K);
      this.drought[c] = this.droughtOn[k] ? (127.5 * (d1 + d2) + 0.5) | 0 : 0;
      this.w3[k] = 3 * this.muL[k] * 0.6;
      this.dry[k] = 3;
    }
    this.aU.fill(0); this.precip.fill(0);
  }

  // ===================================================================== caches
  #evalAnomalyNodes(year) {
    const { nx, ny } = this.aTab, s = this.opts.anomalyStride * 0.5;
    const dT = new Float32Array(nx * ny), pf = new Float32Array(nx * ny);
    const fn = this.anomalyFn;
    for (let j = 0; j < ny; j++) {
      const lat = 90 - (j + 0.5) * s;
      for (let i = 0; i < nx; i++) {
        const r = fn(year, lat, -180 + (i + 0.5) * s) || {};
        const t = +r.dT, p = +r.precipFactor;
        dT[j * nx + i] = Number.isFinite(t) ? t : 0;
        pf[j * nx + i] = Number.isFinite(p) ? Math.min(PF_MAX, Math.max(0, p)) : 1;
      }
    }
    return { dT, pf };
  }

  /** Per-year paleo anomaly cache (dT, precipFactor per cell). */
  #loadYear(year) {
    if (this.anomYear === year) return;
    this.anomYear = year;
    if (!this.anomalyFn) { this.dT.fill(0); this.pf.fill(1); this.dTL.fill(0); this.dTI.fill(0); return; }
    const r = this.#evalAnomalyNodes(year);
    nodesToCells(r.dT, this.aTab, this.dT);
    nodesToCells(r.pf, this.aTab, this.pf);
    gather(this.dT, this.landIdx, this.dTL); gather(this.dT, this.iceIdx, this.dTI);
  }

  /** Per-month precipitation parameters. */
  #loadMonth(info) {
    const mo = (info.month - 1) * N, inv = 1 / info.daysInMonth;
    const { prec, pf, pfLong, zth, mwN, muL, muRef, floodThr, landK } = this;
    for (let c = 0; c < N; c++) {
      const base = prec[mo + c] * inv;
      const m = base * pf[c];
      if (m > 0.002) {
        let f = Math.sqrt(m) * ZS_SCALE;
        if (f > ZS_N) f = ZS_N;
        const i = f | 0, t = f - i;
        zth[c] = ZT_LUT[i] + (ZT_LUT[i + 1] - ZT_LUT[i]) * t;
        mwN[c] = m * (MWK_LUT[i] + (MWK_LUT[i + 1] - MWK_LUT[i]) * t);
      } else { zth[c] = NO_RAIN; mwN[c] = 0; }
      const k = landK[c];
      if (k >= 0) { muL[k] = m; muRef[k] = base * pfLong[c]; floodThr[k] = Math.max(70, 15 * m + 20); }
    }
  }

  /** Advance the expected drought sums n90/n365 to the given day with the current month's muRef. */
  #advanceRef(day) {
    const j = day - this.refDay;
    if (j <= 0) return;
    const a90 = Math.pow(A90, j), k90 = (1 - a90) / (1 - A90), a365 = Math.pow(A365, j), k365 = (1 - a365) / (1 - A365);
    const { n90, n365, muRef } = this;
    for (let k = 0; k < n90.length; k++) { n90[k] = n90[k] * a90 + muRef[k] * k90; n365[k] = n365[k] * a365 + muRef[k] * k365; }
    this.refDay = day;
  }

  /** Interpolation weights between mid-month nodes for the centre of the day. */
  #tWeights(info, out) {
    const y = info.year, mi = info.month - 1, p = info.doy0 + 0.5;
    const mid = k => daysBeforeMonth(y, k + 1) + daysInMonth(y, k + 1) / 2;
    const mc = mid(mi);
    if (p < mc) {
      const pp = mi === 0 ? -15.5 : mid(mi - 1);
      out.m0 = mi === 0 ? 11 : mi - 1; out.m1 = mi; out.w1 = (p - pp) / (mc - pp);
    } else {
      const pn = mi === 11 ? info.daysInYear + 15.5 : mid(mi + 1);
      out.m0 = mi; out.m1 = mi === 11 ? 0 : mi + 1; out.w1 = (p - mc) / (pn - mc);
    }
    return out;
  }

  /** Seasonal modulation of the synoptic amplitude (winter x1.2, summer x0.6 outside the tropics). */
  #seasonRows(info) {
    const ph = (2 * Math.PI) / info.daysInYear;
    const csN = Math.cos(ph * (info.doy0 - 15)), csS = Math.cos(ph * (info.doy0 - 196));
    for (let y = 0; y < H; y++) {
      const cs = this.rowLat[y] >= 0 ? csN : csS;
      this.sRow[y] = 1 + this.rowWLat[y] * (0.3 * cs - 0.1);
    }
    for (let j = 0; j < CY; j++) {
      const lat = nodeLat(j), cs = lat >= 0 ? csN : csS;
      this.nodeSummer[j] = Math.max(0, -cs) * smooth(20, 45, Math.abs(lat));
    }
  }

  // ===================================================================== one day (or one n-day block)
  /**
   * Simulate day d, or with n > 1 the block of days d-n+1 .. d (within one month) at once. A block
   * steps the synoptic fields, tropical cyclones and the field-based detectors (storms, heat and cold
   * waves from box-mean field values) every day, exactly as daily steps would, but runs the cell
   * pass once, for the block's middle day: that day's weather is shown, and snow, ice, drought sums,
   * flood memory, dry spells and the climate accumulators advance by n days with the block totals.
   * Used when the clock runs faster than the simulator (setOptions({stride})).
   */
  #simulateDay(d, n = 1) {
    const info = dayInfo(d, this.info);
    if (info.month !== this.curMonth || info.year !== this.curYear) {
      this.#monthEnd();
      this.#advanceRef(d - n);
      if (info.year !== this.curYear) {
        this.#finalizeYear();
        this.curYear = info.year;
        this.#loadYear(info.year);
        const { pf, pfLong } = this;
        for (let c = 0; c < N; c++) pfLong[c] += (pf[c] - pfLong[c]) / PF_TAU;
      }
      this.curMonth = info.month;
      this.#loadMonth(info);
      if (info.month === 3 || info.month === 9) this.#evalWinter(info.month === 3 ? 1 : 0);
    }
    const m = info.month;
    this.winterNow.n = m === 12 || m <= 2; this.winterNow.s = m >= 6 && m <= 8;
    const d0 = d - n + 1, rep = d - ((n - 1) >> 1);
    const infoR = n > 1 ? dayInfo(rep, this.infoR) : info;
    const tw = this.#tWeights(infoR, this.tw);
    this.#seasonRows(infoR);
    const seed = this.seed, F = this.fields, evOn = this.opts.events;
    const ctx = evOn ? { month: info.month + (info.day - 0.5) / info.daysInMonth - 0.5, cls: this.cls, normalT: c => this.normalTemp(c) + this.dT[c] } : null;
    const blk = n > 1, jr = rep - d0;
    for (let dd = d0; dd <= d; dd++) {
      for (const k in F) F[k].step(seed, dd);
      const isRep = dd === rep;
      this.#coarseFields(isRep);
      if (evOn) {
        this.events.cyclones(dd, ctx);
        this.#stormValues(info);
        if (isRep) this.events.cycloneRain(this.PC);
      }
      if (!blk) break;
      this.#recordDay(dd - d0, evOn);
      if (isRep) { this.repTC.set(this.TC); this.repPC.set(this.PC); this.repSF.set(this.SF); }
    }
    if (blk) {
      // the middle day's coarse fields for the cell pass; per-day box-mean field changes since then
      this.TC.set(this.repTC); this.PC.set(this.repPC); this.SF.set(this.repSF);
      const dB = this.blkDB, dMin = this.blkDBmin, tc = this.blkTC, kap = this.bKappa, tR = jr * BN;
      dMin.fill(0);
      for (let j = 0, o = 0; j < n; j++) for (let b = 0; b < BN; b++, o++) { const v = kap[b] * (tc[o] - tc[tR + b]); dB[o] = v; if (v < dMin[b]) dMin[b] = v; }
    }
    this.#passRows(rep, tw, n, jr);
    this.#boxes(tw, n);
    if (blk) this.#blockDays(d0, n, jr, evOn);
    if (evOn) {
      if (!blk) this.events.boxes(d);
      this.events.fires(d, this.candCell, this.candFD, this.nCand, this.bd.rain);
    }
    const bd = this.bd;
    for (const k of ['Tl', 'Al', 'Pl', 'Dl', 'Aall', 'Pall', 'snowN', 'snowMax', 'floodN', 'floodMax']) bd[k].fill(0);
    this.yDays += n; this.mDays += n;
    this.day = d;
  }

  /** Coarse combined fields of today: temperature unit field TC; with `all` also precipitation PC and slow factor SF. */
  #coarseFields(all) {
    const F = this.fields, TC = this.TC, PC = this.PC, SF = this.SF;
    const fT = F.fastT.data, sT = F.slowT.data, fP = F.fastP.data, sP = F.slowP.data, vP = F.vslowP.data;
    for (let j = 0; j < CY; j++) {
      const th = 0.5 * this.nodeSummer[j], ct = Math.cos(th), st = Math.sin(th);
      for (let i = 0, o = j * CX; i < CX; i++, o++) TC[o] = T_FAST * fT[o] + T_SLOW * (ct * sT[o] - st * sP[o]);
      if (all) for (let i = 0, o = j * CX; i < CX; i++, o++) { PC[o] = fP[o]; SF[o] = Math.exp(SF_K1 * sP[o] + SF_K2 * vP[o] + SF_C); }
    }
  }

  /** Block day j: box means of the coarse temperature field (2x2 nodes per box) and the day's storm values. */
  #recordDay(j, evOn) {
    const TC = this.TC, tc = this.blkTC, sv = this.blkSV, sc = this.blkSC, bd = this.bd, o = j * BN;
    for (let by = 0; by < BY; by++) {
      for (let bx = 0; bx < BX; bx++) {
        const n0 = 2 * by * CX + 2 * bx;
        tc[o + by * BX + bx] = 0.25 * (TC[n0] + TC[n0 + 1] + TC[n0 + CX] + TC[n0 + CX + 1]);
      }
    }
    if (evOn) { sv.set(bd.stormV, o); sc.set(bd.stormCell, o); }
  }

  /**
   * The days of an n-day block (jr = index of the simulated middle day): winter anomaly accumulators and
   * box detectors day by day. Box-mean anomaly of a day = middle day's + its box-mean field change (dB),
   * so heat and cold waves and severe winters keep the field's day-to-day persistence. Storms come from
   * each day's field; snowstorms, floods and droughts keep the middle day's values for the whole block.
   */
  #blockDays(d0, n, jr, evOn) {
    const ev = this.events, val = ev.val, vc = ev.valCell, acc = this.acc;
    const HW = DET.heatwave * BN, CW = DET.coldwave * BN, ST = DET.storm * BN;
    const { bAUr, bMTr, bSig, bHeatable, bHasLand, bNorth, sRow, blkDB, blkSV, blkSC } = this;
    const nWin = this.winterNow.n, sWin = this.winterNow.s;
    const repH = this.blkH, repC = this.blkC;
    repH.set(val.subarray(HW, HW + BN)); repC.set(val.subarray(CW, CW + BN));
    for (let j = 0; j < n; j++) {
      const o = j * BN;
      for (let b = 0; b < BN; b++) if (bHasLand[b] && (bNorth[b] ? nWin : sWin)) { acc.wA[b] += bAUr[b] + blkDB[o + b]; acc.wN[b]++; }
      if (!evOn) continue;
      if (j === jr) { val.set(repH, HW); val.set(repC, CW); }
      else {
        for (let b = 0; b < BN; b++) {
          let vh = 0, vcw = 0;
          if (bHeatable[b]) {
            let aU = bAUr[b] + blkDB[o + b];
            if (aU > TCLIP) aU = TCLIP; else if (aU < -TCLIP) aU = -TCLIP;
            const kC = bSig[b] * sRow[((b / BX) | 0) * 10 + 5], aC = aU * kC, mT = bMTr[b] + (aU - bAUr[b]) * kC;
            if (aU >= HEAT_A && aC >= HEAT_C && mT >= 18) vh = waveSeverity(aU);
            if (aU <= -COLD_A && aC <= -COLD_C && mT <= 12) vcw = waveSeverity(-aU);
          }
          val[HW + b] = vh; val[CW + b] = vcw;
        }
      }
      for (let b = 0; b < BN; b++) { val[ST + b] = blkSV[o + b]; vc[ST + b] = blkSC[o + b]; }
      ev.boxes(d0 + j);
    }
  }


  #stormValues(info) {
    const bd = this.bd, fP = this.fields.fastP.data, coast = this.nodeCoast;
    bd.stormV.fill(0);
    const m = info.month, nCold = m >= 10 || m <= 3, sCold = m >= 4 && m <= 9;
    for (let j = 0; j < CY; j++) {
      const lat = nodeLat(j), a = Math.abs(lat);
      if (a < 35 || a > 72 || !(lat > 0 ? nCold : sCold)) continue;
      for (let i = 0; i < CX; i++) {
        const o = j * CX + i, v = fP[o];
        if (v < STORM_Z || !coast[o]) continue;
        const b = (j >> 1) * BX + (i >> 1), val = 1 + (v - STORM_Z) / 0.25;
        if (val > bd.stormV[b]) { bd.stormV[b] = val; bd.stormCell[b] = (j * 5 + 2) * W + i * 5 + 2; }
      }
    }
  }

  /**
   * Rows pass. Per SIM row the coarse fields are interpolated once into full-resolution row buffers
   * (expandRow), then small loops run over the row's cells while it is cache-resident:
   * (1) every cell: synoptic temperature anomaly, B channel (clears R/G/A);
   * (2) every cell: precipitation and cloud, G channel (latent = synoptic field + mesoscale noise);
   * (3) the row's land cells: temperature, snow, flood memory, dry spell, drought sums, R channel;
   * (4) the row's land cells: drought index, A channel, fire danger and ignitions, land box sums;
   * (5) the row's freezing sea/lake cells: ice, R channel.
   * Small loop bodies keep the JIT's registers from spilling; land / ice data are compact and in
   * row order, and box sums are accumulated in registers over each run of cells of the same box.
   */
  #passRows(d, tw, n, jr = 0) {
    const { sig, dT, zth, mwN, grid, grid32, precip, aU, rT, rP, rS, uX, zX, sX, sRow, rowW, TC, PC, SF, normT, normP, MZ } = this;
    const { iy0, iy1, fy } = this.cTab;
    const bd = this.bd, bAall = bd.Aall, bPall = bd.Pall;
    const PH = this.phF, kT = this.kT, kP = this.kP, kOne = this.kOne;
    // mesoscale noise window of the day
    const hN = dayBase(this.seed, d, 11), mzR = hN % (MZ_RS + 1), mzS = (hN >>> 5) % W;
    // block constants (n = 1: the daily model exactly)
    const nd = n, lam = BLOCK_LAMBDA[Math.min(n, BLOCK_MAX)], lam1 = 1 - lam, dSh = BLOCK_DSHIFT[Math.min(n, BLOCK_MAX)], xSh = BLOCK_XSHIFT[Math.min(n, BLOCK_MAX)];
    const dzX = this.dzX, dB = this.blkDB, dBmin = this.blkDBmin;
    const a3n = n === 1 ? A3 : Math.pow(A3, n), k3n = n === 1 ? 1 : (1 - a3n) / (1 - A3) / n;
    const a90n = n === 1 ? A90 : Math.pow(A90, n), k90n = n === 1 ? 1 : (1 - a90n) / (1 - A90) / n;
    const a365n = n === 1 ? A365 : Math.pow(A365, n), k365n = n === 1 ? 1 : (1 - a365n) / (1 - A365) / n;
    // land
    const { landIdx, landRow, landBox, TvL, dTL, sigL, swe, w3, dry, floodThr, TL, muL, p90, n90, p365, n365, muRef, droughtOn, drought, fire, fuel } = this;
    const L = landIdx.length;
    const snowN = bd.snowN, snowMax = bd.snowMax, snowCell = bd.snowCell, floodN = bd.floodN, floodMax = bd.floodMax, floodCell = bd.floodCell;
    const bTl = bd.Tl, bAl = bd.Al, bPl = bd.Pl, bDl = bd.Dl;
    const w1 = tw.w1, w0 = 1 - w1, o0L = tw.m0 * L, o1L = tw.m1 * L;
    // drought: expected sums advanced to today; each cell recomputes the slowly changing index every
    // 4th day (staggered), or every block
    const jd = d - this.refDay, ph4 = n === 1 ? d & 3 : -1;
    const a90 = Math.pow(A90, jd), k90 = (1 - a90) / (1 - A90), a365 = Math.pow(A365, jd), k365 = (1 - a365) / (1 - A365);
    // fires
    const candCell = this.candCell, candFD = this.candFD, candCap = candCell.length;
    const baseF = dayBase(this.seed, d, 12) | 0, evOn = this.opts.events, ign = IGNITION * nd;
    let nCand = 0;
    // ice
    const { iceIdx, iceRow, iceBox, TvI, dTI, sigI, iceTf, iceQ, ice } = this;
    const I = iceIdx.length, o0I = tw.m0 * I, o1I = tw.m1 * I;

    for (let y = 0; y < H; y++) {
      const r0 = iy0[y] * CX, r1 = iy1[y] * CX, wy = fy[y];
      for (let i = 0; i < CX; i++) {
        const a = TC[r0 + i], b = PC[r0 + i], q = SF[r0 + i];
        rT[i] = a + (TC[r1 + i] - a) * wy;
        rP[i] = b + (PC[r1 + i] - b) * wy;
        rS[i] = q + (SF[r1 + i] - q) * wy;
      }
      const nr = y * 5;
      for (let j = 0; j < 5; j++) { const ph = (j + 2) % 5; kT[j] = normT[nr + ph]; kP[j] = normP[nr + ph]; }
      expandRow(rT, uX, PH, kT, 1);
      expandRow(rP, zX, PH, kP, W_FIELD);
      expandRow(rS, sX, PH, kOne, 1);
      const sR = sRow[y], wr = rowW[y], boxRow = ((y / 10) | 0) * BX, c0 = y * W;

      // (1) temperature anomaly (sigma units, clipped), B channel; clears R/G/A
      for (let bx = 0, x = 0, c = c0; bx < BX; bx++) {
        let sa = 0;
        for (const xe = x + 10; x < xe; x++, c++) {
          let u = uX[x];
          if (u > TCLIP) u = TCLIP; else if (u < -TCLIP) u = -TCLIP;
          aU[c] = u;
          const da = dT[c] + sig[c] * sR * u;
          sa += da;
          let Bc = 128.5 + da * 8;
          Bc = Bc < 0 ? 0 : Bc > 255 ? 255 : Bc | 0;
          grid32[c] = LITTLE_ENDIAN ? Bc << 16 : Bc << 8;
        }
        bAall[boxRow + bx] += sa * wr;
      }

      // (2) precipitation and cloud, G channel. Latent = W_FIELD * synoptic + W_NOISE * mesoscale noise;
      // cells without rain within 0.7 of the threshold carry the cloud band (0..127)
      const mzRow = (y + mzR) * MZ_W;
      for (let bx = 0, x = 0, c = c0; bx < BX; bx++) {
        let sp = 0;
        const xs = bx * 10 + mzS, mo = mzRow + (xs >= W ? xs - W : xs) - x;
        for (const xe = x + 10; x < xe; x++, c++) {
          const dz = zX[x] + W_NOISE * MZ[mo + x] - zth[c];
          let pr = 0, G = 0;
          if (dz > 0) {
            pr = mwN[c] * dz * (1 + dz * (0.5 + dz * (1 / 6))) * sX[x];
            const gi = (pr * 4) | 0;
            G = GLUT[gi > 255 ? 255 : gi];
          } else if (dz > -0.7) G = (127 + dz * 181.4) | 0;
          precip[c] = pr;
          sp += pr;
          grid[(c << 2) + 1] = G;
          dzX[x] = dz;
        }
        bPall[boxRow + bx] += sp * wr;
      }

      const k0 = landRow[y], ke = landRow[y + 1];
      // (3) land: temperature, snow, flood memory, dry spell, drought sums
      if (nd === 1) {
        for (let k = k0; k < ke; k++) {
          const c = landIdx[k];
          const T = TvL[o0L + k] * w0 + TvL[o1L + k] * w1 + dTL[k] + sigL[k] * sR * aU[c];
          TL[k] = T;
          const pr = precip[c];
          let sw = swe[k], rain = pr, melt = 0;
          if (pr > 0 && T < SNOW_T1) {
            const sn = T <= SNOW_T0 ? pr : pr * (SNOW_T1 - T) * 0.5;
            sw += sn; rain = pr - sn;
            if (sn >= SNOWSTORM_MM) { const b = landBox[k]; snowN[b]++; if (sn > snowMax[b]) { snowMax[b] = sn; snowCell[b] = c; } }
          }
          if (T > 0 && sw > 0) { melt = DDF * T; if (melt > sw) melt = sw; sw -= melt; }
          if (sw > SWE_MAX) sw = SWE_MAX;
          swe[k] = sw;
          let R = 0;
          if (sw > 0) { const si = (sw * 4) | 0; R = si >= SNOW_LUT_N ? 255 : SNOW_LUT[si]; }
          grid[c << 2] = R;
          const ww = w3[k] * A3 + rain + 0.5 * melt;
          w3[k] = ww;
          const ft = floodThr[k];
          if (ww > ft) { const b = landBox[k]; floodN[b]++; const r = ww / ft; if (r > floodMax[b]) { floodMax[b] = r; floodCell[b] = c; } }
          const dd = dry[k];
          dry[k] = pr > 1 ? 0 : dd < 255 ? dd + 1 : 255;
          p90[k] = p90[k] * A90 + pr;
          p365[k] = p365[k] * A365 + pr;
        }
      } else {
        // n-day block. Precipitation: the block total, its fast part shrunk towards the conditional mean
        // (muL * slow factor), spread evenly over the days. Snow and melt day by day with the day's
        // temperature T + kc * dB (the change of the box-mean field since the middle day). Snowstorms and
        // floods are detected on the middle day's own (daily) values.
        for (let k = k0; k < ke; k++) {
          const c = landIdx[k], b = landBox[k], x = c - c0, kc = sigL[k] * sR;
          const T = TvL[o0L + k] * w0 + TvL[o1L + k] * w1 + dTL[k] + kc * aU[c];
          TL[k] = T;
          const pr = precip[c];
          const P = nd * (lam * pr + lam1 * muL[k] * sX[x]), Pd = P / nd;
          let sw = swe[k], rain = 0, melt = 0, meltR = 0;
          if (sw === 0 && T + kc * dBmin[b] >= SNOW_T1) rain = P; // no snow on any day of the block
          else for (let j = 0, o = b; j < nd; j++, o += BN) {
            const Tj = T + kc * dB[o];
            if (Tj < SNOW_T1) { const fr = Tj <= SNOW_T0 ? 1 : (SNOW_T1 - Tj) * 0.5; sw += Pd * fr; rain += Pd * (1 - fr); } else rain += Pd;
            if (Tj > 0 && sw > 0) { let mj = DDF * Tj; if (mj > sw) mj = sw; sw -= mj; melt += mj; if (j === jr) meltR = mj; }
            if (sw > SWE_MAX) sw = SWE_MAX;
          }
          // the block's wettest day (expected maximum): snowstorm and flood cells
          const zx = dzX[x] + xSh, px = zx > 0 ? mwN[c] * zx * (1 + zx * (0.5 + zx * (1 / 6))) * sX[x] : 0;
          const sd = T < SNOW_T1 ? (T <= SNOW_T0 ? px : px * (SNOW_T1 - T) * 0.5) : 0;
          if (sd >= SNOWSTORM_MM) { snowN[b]++; if (sd > snowMax[b]) { snowMax[b] = sd; snowCell[b] = c; } }
          swe[k] = sw;
          let R = 0;
          if (sw > 0) { const si = (sw * 4) | 0; R = si >= SNOW_LUT_N ? 255 : SNOW_LUT[si]; }
          grid[c << 2] = R;
          const w3o = w3[k];
          w3[k] = w3o * a3n + (rain + 0.5 * melt) * k3n;
          const ft = floodThr[k], wd = w3o * A3 + px - sd + 0.5 * meltR;
          if (wd > ft) { floodN[b]++; const r = wd / ft; if (r > floodMax[b]) { floodMax[b] = r; floodCell[b] = c; } }
          // dry-spell reset: any wet day in the block (the middle day's latent shifted by the expected maximum)
          let wet = pr > 1;
          if (!wet) { const z = dzX[x] + dSh; wet = z > 0 && mwN[c] * z * (1 + z * (0.5 + z * (1 / 6))) * sX[x] > 1; }
          const dd = dry[k] + nd;
          dry[k] = wet ? 0 : dd < 255 ? dd : 255;
          p90[k] = p90[k] * a90n + P * k90n;
          p365[k] = p365[k] * a365n + P * k365n;
        }
      }


      // (4) land: drought index, A channel, fire danger and ignitions, land box sums (register runs per box)
      let bCur = -1, sT = 0, sA = 0, sP = 0, sD = 0;
      for (let k = k0; k < ke; k++) {
        const c = landIdx[k], b = landBox[k];
        if (((k & 3) === ph4 || ph4 < 0) && droughtOn[k]) {
          const mr = muRef[k];
          let d1 = (DROUGHT_R0 - (p90[k] + C90) / (n90[k] * a90 + mr * k90 + C90)) * DROUGHT_K;
          let d2 = (DROUGHT_R0 - (p365[k] + C365) / (n365[k] * a365 + mr * k365 + C365)) * DROUGHT_K;
          d1 = d1 < 0 ? 0 : d1 > 1 ? 1 : d1;
          d2 = d2 < 0 ? 0 : d2 > 1 ? 1 : d2;
          drought[c] = (127.5 * (d1 + d2) + 0.5) | 0;
        }
        const D = drought[c];
        grid[(c << 2) + 3] = D;
        const T = TL[k], vg = fuel[k];
        let FD = 0;
        if (vg > 0 && T > 5 && swe[k] < 1) {
          let ht = (T - 5) * (1 / 15); if (ht > 1) ht = 1;
          let dr = dry[k] * (1 / 25); if (dr > 1) dr = 1;
          // dryness: the seasonal one (90-day precipitation vs. a crude evaporative demand, so
          // a normal Mediterranean summer or savanna dry season counts as dry) or the drought anomaly
          let sd = 1 - p90[k] / (90 * (0.5 + 0.2 * T));
          if (sd < 0) sd = 0;
          FD = vg * ht * dr * (0.25 + 0.45 * sd + 0.3 * INV255 * D);
          if (evOn && FD > FIRE_MIN && nCand < candCap) {
            let g = Math.imul(baseF ^ c, 0x2c1b3c6d);
            g ^= g >>> 12; g = Math.imul(g, 0x297a2d39);
            g ^= g >>> 15; g = Math.imul(g, 0x4b1d6f2b);
            g ^= g >>> 13;
            if ((g >>> 0) / 4294967296 < ign * FD * FD * FD) { candCell[nCand] = c; candFD[nCand] = FD; nCand++; }
          }
        }
        fire[c] = (FD * 255 + 0.5) | 0;
        if (b !== bCur) {
          if (bCur >= 0) { bTl[bCur] += sT * wr; bAl[bCur] += sA * wr; bPl[bCur] += sP * wr; bDl[bCur] += sD * wr; }
          bCur = b; sT = 0; sA = 0; sP = 0; sD = 0;
        }
        sT += T; sA += aU[c]; sP += precip[c]; sD += D;
      }
      if (bCur >= 0) { bTl[bCur] += sT * wr; bAl[bCur] += sA * wr; bPl[bCur] += sP * wr; bDl[bCur] += sD * wr; }

      // (5) sea/lake cells that can freeze: ice proxy, R channel (blocks: day by day as for snow)
      for (let i = iceRow[y], ie = iceRow[y + 1]; i < ie; i++) {
        const c = iceIdx[i], kc = sigI[i] * sR;
        const T = TvI[o0I + i] * w0 + TvI[o1I + i] * w1 + dTI[i] + kc * aU[c];
        const tf = iceTf[i], q = iceQ[i];
        let v = ice[i];
        if (nd === 1) {
          v = v - q + (T < tf ? (ICE_KF * ICE_H0 * (tf - T)) / (ICE_H0 + v) : -ICE_KM * (T - tf));
          v = v < 0 ? 0 : v > ICE_MAX ? ICE_MAX : v;
        } else if (v > 0 || T + kc * dBmin[iceBox[i]] <= tf) {
          for (let j = 0, o = iceBox[i]; j < nd; j++, o += BN) {
            const Tj = T + kc * dB[o];
            v = v - q + (Tj < tf ? (ICE_KF * ICE_H0 * (tf - Tj)) / (ICE_H0 + v) : -ICE_KM * (Tj - tf));
            v = v < 0 ? 0 : v > ICE_MAX ? ICE_MAX : v;
          }
        }
        ice[i] = v;
        grid[c << 2] = v >= 25.5 ? 255 : (v * 10) | 0;
      }
    }

    for (let b = 0; b < BN; b++) bDl[b] *= INV255;
    this.nCand = nCand;
  }


  /** Box diagnostics of the simulated day: climate accumulators (x n days), detector values, rep values for blocks. */
  #boxes(tw, n) {
    const bd = this.bd, acc = this.acc, ev = this.events, val = ev.val, vc = ev.valCell;
    const { bLandFrac, bClimP, bClimT, bRep, bNorth, bLandW, bAllW, bTvAll } = this;
    const nWin = this.winterNow.n, sWin = this.winterNow.s;
    const o0 = tw.m0 * BN, o1 = tw.m1 * BN, w1 = tw.w1, w0 = 1 - w1;
    const S = DET.snowstorm * BN, HW = DET.heatwave * BN, CW = DET.coldwave * BN, DR = DET.drought * BN, FL = DET.flood * BN, ST = DET.storm * BN;
    for (let b = 0; b < BN; b++) {
      const wl = bLandW[b], hasL = wl > 0;
      let mT, mP;
      let vh = 0, vcw = 0, vdr = 0;
      if (hasL) {
        mT = bd.Tl[b] / wl; mP = bd.Pl[b] / wl;
        // aC: the box-mean anomaly in degC (box-mean sigma at the box's centre row)
        const aU = bd.Al[b] / wl, aC = aU * this.bSig[b] * this.sRow[((b / BX) | 0) * 10 + 5], D = bd.Dl[b] / wl;
        this.bAUr[b] = aU; this.bMTr[b] = mT;
        acc.mD[b] += D * n;
        if (n === 1 && (bNorth[b] ? nWin : sWin)) { acc.wA[b] += aU; acc.wN[b]++; } // blocks: day by day in #blockDays
        if (bLandFrac[b] >= 0.25 && bClimT[b] > -12) { // no heat/cold waves over the ice sheets
          if (aU >= HEAT_A && aC >= HEAT_C && mT >= 18) vh = waveSeverity(aU);
          if (aU <= -COLD_A && aC <= -COLD_C && mT <= 12) vcw = waveSeverity(-aU);
          if (bLandFrac[b] >= 0.25 && bClimP[b] >= 150 && D >= 0.33) vdr = 1 + (D - 0.33) / 0.12;
        }
      } else {
        const w = bAllW[b];
        mT = bTvAll[o0 + b] * w0 + bTvAll[o1 + b] * w1 + bd.Aall[b] / w;
        mP = bd.Pall[b] / w;
      }
      acc.yT[b] += mT * n; acc.yP[b] += mP * n; bd.rain[b] = mP;
      const sn = bd.snowN[b], fl = bd.floodN[b];
      val[S + b] = sn >= SNOWSTORM_CELLS && bClimT[b] > -12 ? 1 + 4 * Math.min(1, (sn - SNOWSTORM_CELLS) / 60) : 0; vc[S + b] = bd.snowCell[b];
      val[HW + b] = vh; vc[HW + b] = bRep[b];
      val[CW + b] = vcw; vc[CW + b] = bRep[b];
      val[DR + b] = vdr; vc[DR + b] = bRep[b];
      val[FL + b] = fl >= FLOOD_CELLS ? 1 + Math.log2(fl / FLOOD_CELLS) : 0; vc[FL + b] = bd.floodCell[b];
      val[ST + b] = bd.stormV[b]; vc[ST + b] = bd.stormCell[b];
    }
  }

  #onAttach(k, b, ev) {
    const acc = this.acc;
    if (k === DET.heatwave) { if (acc.yHW[b] < 255) acc.yHW[b]++; }
    else if (k === DET.coldwave && ev.peak >= 3 && (this.bNorth[b] ? this.winterNow.n : this.winterNow.s)) acc.wCold[b] = 1;
  }

  #monthEnd() {
    const acc = this.acc;
    if (this.mDays > 0) {
      const inv = 1 / this.mDays;
      for (let b = 0; b < BN; b++) if (this.bHasLand[b] && acc.mD[b] * inv >= 0.35 && acc.yDM[b] < 255) acc.yDM[b]++;
    }
    acc.mD.fill(0);
    this.mDays = 0;
  }

  /** Severe-winter flag (north = 1: evaluated on 1 March; south: on 1 September). */
  #evalWinter(north) {
    const acc = this.acc;
    for (let b = 0; b < BN; b++) {
      if (this.bNorth[b] !== north) continue;
      if (acc.wN[b] >= 45 && this.bWinterT[b] <= 8 && (acc.wA[b] / acc.wN[b] <= -0.45 || acc.wCold[b])) acc.ySW[b] = 1;
      acc.wA[b] = 0; acc.wN[b] = 0; acc.wCold[b] = 0;
    }
  }

  #finalizeYear() {
    if (!this.yDays || this.curYear === null) return;
    const acc = this.acc, n = this.yDays, diy = dayInfo(this.day).daysInYear;
    const T = new Int16Array(BN), P = new Uint16Array(BN);
    for (let b = 0; b < BN; b++) {
      T[b] = Math.max(-32768, Math.min(32767, Math.round((acc.yT[b] / n) * 10)));
      P[b] = Math.min(65535, Math.round((acc.yP[b] * diy) / n));
    }
    this.log.pushYear(this.curYear, n < diy ? LOG_PARTIAL : 0, T, P, acc.yDM, acc.ySW, acc.yHW);
    acc.yT.fill(0); acc.yP.fill(0); acc.yDM.fill(0); acc.ySW.fill(0); acc.yHW.fill(0);
    this.yDays = 0;
  }

  /** climateLog estimates for skipped years [y0, y1) from box climatology + anomalies. */
  #fillSynthetic(y0, y1) {
    if (y1 <= y0) return;
    const log = this.log;
    const annualFrom = Math.max(y0, y1 - this.opts.logAnnualYears);
    const T = new Int16Array(BN), P = new Uint16Array(BN), DM = new Uint8Array(BN), SW = new Uint8Array(BN), HWa = new Uint8Array(BN);
    // A record of n years: g1 (temperature) and g2 (precipitation) are the n-year means of unit
    // annual indices (sd 1/sqrt(n)); the year-to-year spread around them is sw. Counts are n times
    // the expected annual count given that mean (exact for the piecewise-linear count models),
    // stochastically rounded, so annual and decade records have the same long-run rates as the
    // simulated years (SYN_* calibrated on the real normals).
    const sround = (x, h) => Math.min(255, Math.floor(x + u01(h)));
    const fill = (year, n) => {
      const ns = 1 / Math.sqrt(n), sw = Math.sqrt(1 - 1 / n), base = dayBase(this.seed, year, 90);
      for (let b = 0; b < BN; b++) {
        let dT = 0, pf = 1;
        if (this.anomalyFn) {
          const r = this.anomalyFn(year, boxLat((b / BX) | 0), boxLon(b % BX)) || {};
          if (Number.isFinite(+r.dT)) dT = +r.dT;
          if (Number.isFinite(+r.precipFactor)) pf = Math.min(PF_MAX, Math.max(0, +r.precipFactor));
        }
        const h = cellHash(base, 5 * b);
        const g1 = GAUSS[h >>> GSHIFT] * ns, g2 = GAUSS[cellHash(h, 1) >>> GSHIFT] * ns;
        T[b] = Math.round((this.bClimT[b] + dT + g1 * (0.25 + 0.06 * this.bSig[b])) * 10);
        P[b] = Math.min(65535, Math.max(0, Math.round(this.bClimP[b] * pf * (1 + 0.12 * g2))));
        const land = this.bHasLand[b] === 1;
        DM[b] = land ? sround(n * SYN_DM * posPart(-g2 - 0.5, sw), cellHash(h, 2)) : 0;
        SW[b] = land && this.bWinterT[b] <= 8 ? sround(n * clamp01(SYN_SW - 0.12 * g1), cellHash(h, 3)) : 0;
        HWa[b] = this.bHeat[b] ? sround(n * SYN_HW * posPart(1 + 0.8 * g1, 0.8 * sw), cellHash(h, 4)) : 0;
      }
    };
    let y = y0;
    while (y < annualFrom) {
      const dec = Math.floor(y / 10) * 10, end = Math.min(dec + 10, annualFrom), n = end - y;
      fill(Math.floor((y + end - 1) / 2), n);
      log.pushDecade(dec, n, LOG_SYNTHETIC, T, P, DM, SW, HWa);
      y = end;
    }
    for (; y < y1; y++) {
      fill(y, 1);
      log.pushYear(y, LOG_SYNTHETIC, T, P, DM, SW, HWa);
    }
  }

  // ===================================================================== save / load
  /** Snapshot for saves: {version, kind, meta (JSON-safe), buffers: {name: ArrayBuffer}}. */
  serialize() {
    const buffers = {};
    const put = (k, a) => { buffers[k] = a.slice().buffer; };
    for (const k of ['swe', 'p90', 'n90', 'p365', 'n365', 'w3', 'dry', 'ice', 'pfLong', 'aU', 'precip', 'drought', 'fire', 'grid']) put(`cell.${k}`, this[k]);
    for (const k in this.fields) { put(`field.${k}`, this.fields[k].data); put(`field.${k}.phase`, this.fields[k].phase); }
    for (const k in this.acc) put(`acc.${k}`, this.acc[k]);
    const ev = this.events.serialize();
    const lg = this.log.serialize();
    for (const k in ev.buffers) buffers[k] = ev.buffers[k];
    for (const k in lg.buffers) buffers[k] = lg.buffers[k];
    return {
      version: FORMAT_VERSION, kind: FORMAT_KIND,
      meta: {
        day: this.day, seed: this.seed, curYear: this.curYear, curMonth: this.curMonth, yDays: this.yDays, mDays: this.mDays, refDay: this.refDay,
        maskHash: this.maskHash, options: this.opts, events: ev.meta, log: lg.meta, hasAnomaly: !!this.anomalyFn,
      },
      buffers,
    };
  }

  /** Restore a snapshot made by serialize() on a simulator built from the same normals/mask. */
  deserialize(snap) {
    if (!snap || snap.kind !== FORMAT_KIND) throw new Error('weather: not a weather snapshot');
    if (snap.version !== FORMAT_VERSION) throw new Error(`weather: unsupported snapshot version ${snap.version}`);
    const m = snap.meta;
    if (!m || !snap.buffers || typeof snap.buffers !== 'object') throw new Error('weather: not a weather snapshot');
    if (m.maskHash !== this.maskHash) throw new Error('weather: snapshot was made with a different land mask / normals');
    // buffers as ArrayBuffers (also accepts typed-array views and buffers from another realm, as a save loader may return)
    const B = {};
    for (const [k, v] of Object.entries(snap.buffers)) {
      if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') B[k] = v;
      else if (ArrayBuffer.isView(v)) B[k] = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    }
    // validate everything before touching the state: a bad save must not leave a half-loaded simulator
    const need = (key, bytes) => {
      if (!B[key] || B[key].byteLength !== bytes) throw new Error(`weather: snapshot buffer ${key} is missing or has the wrong size`);
    };
    for (const k of ['swe', 'p90', 'n90', 'p365', 'n365', 'w3', 'dry', 'ice', 'pfLong', 'aU', 'precip', 'drought', 'fire', 'grid']) need(`cell.${k}`, this[k].byteLength);
    for (const k in this.fields) { need(`field.${k}`, this.fields[k].data.byteLength); need(`field.${k}.phase`, this.fields[k].phase.byteLength); }
    for (const k in this.acc) need(`acc.${k}`, this.acc[k].byteLength);
    need('events.box', (this.events.run.length * 5 + BN) * 4);
    if (!m.events || !Array.isArray(m.events.active) || !m.log || m.log.B !== BN || !(m.day >= -1e7 && m.day <= 1e8)) throw new Error('weather: snapshot meta is incomplete');
    const log = ClimateLog.deserialize(m.log, B); // pure, throws on bad buffers
    this.seed = m.seed >>> 0;
    this.events.seed = this.seed;
    this.#buildNoise();
    for (const k in this.fields) this.fields[k].noise = this.NZ;
    // model options come from the snapshot (exact continuation); maxSimDays is the caller's
    // run-time pacing policy (setOptions) and stays as it is
    const stride = this.opts.anomalyStride, maxSimDays = this.opts.maxSimDays, pace = this.opts.stride;
    this.opts = { ...this.opts, ...m.options, maxSimDays, stride: pace };
    if (this.opts.anomalyStride !== stride) this.aTab = interpTables(this.opts.anomalyStride);
    for (const k of ['swe', 'p90', 'n90', 'p365', 'n365', 'w3', 'dry', 'ice', 'pfLong', 'aU', 'precip', 'drought', 'fire', 'grid']) {
      this[k].set(new this[k].constructor(B[`cell.${k}`]));
    }
    for (const k in this.fields) {
      this.fields[k].data.set(new Float32Array(B[`field.${k}`]));
      this.fields[k].phase.set(new Float64Array(B[`field.${k}.phase`]));
    }
    for (const k in this.acc) this.acc[k].set(new this.acc[k].constructor(B[`acc.${k}`]));
    this.events.deserialize(m.events, B);
    this.log = log;
    this.day = m.day; this.curYear = m.curYear; this.curMonth = m.curMonth; this.yDays = m.yDays; this.mDays = m.mDays; this.refDay = m.refDay;
    this.anomYear = null;
    const info = dayInfo(this.day);
    this.#loadYear(this.curYear);
    this.#loadMonth(info);
    this.#tWeights(info, this.tw);
    this.#seasonRows(info);
    return this;
  }
}

// ===================================================================== helpers
/** Node values V (12 per cell) whose piecewise-linear curve has the given monthly means. */
function meanPreservingNodes(M, n) {
  const V = Float32Array.from(M), tmp = new Float32Array(12);
  for (let c = 0; c < n; c++) {
    for (let it = 0; it < 6; it++) {
      for (let k = 0; k < 12; k++) tmp[k] = (8 * M[k * n + c] - V[((k + 11) % 12) * n + c] - V[((k + 1) % 12) * n + c]) / 6;
      for (let k = 0; k < 12; k++) V[k * n + c] = tmp[k];
    }
  }
  return V;
}

function fillNaNZonal(a) {
  const months = a.length / N;
  for (let m = 0; m < months; m++) {
    const rowMean = new Float64Array(H).fill(NaN);
    let any = false;
    for (let y = 0; y < H; y++) {
      let s = 0, n = 0;
      for (let x = 0, o = m * N + y * W; x < W; x++) { const v = a[o + x]; if (v === v) { s += v; n++; } }
      if (n) { rowMean[y] = s / n; any = true; }
    }
    if (!any) { a.fill(0, m * N, (m + 1) * N); continue; }
    for (let y = 0; y < H; y++) {
      if (rowMean[y] === rowMean[y]) continue;
      for (let r = 1; r < H; r++) {
        if (y - r >= 0 && rowMean[y - r] === rowMean[y - r]) { rowMean[y] = rowMean[y - r]; break; }
        if (y + r < H && rowMean[y + r] === rowMean[y + r]) { rowMean[y] = rowMean[y + r]; break; }
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0, o = m * N + y * W; x < W; x++) if (a[o + x] !== a[o + x]) a[o + x] = rowMean[y];
  }
}

function indexWhere(arr, pred) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (pred(arr[i])) n++;
  const out = new Int32Array(n);
  for (let i = 0, k = 0; i < arr.length; i++) if (pred(arr[i])) out[k++] = i;
  return out;
}

/**
 * Static per-seed mesoscale noise for the precipitation latent: white Gaussian noise blurred with a
 * Gaussian of MESO_SY cells in y and MESO_SX / cos(lat) cells in x (so blobs keep roughly their size in
 * km), renormalised to exactly unit variance per row and zero mean / unit variance overall. Rows are
 * x-periodic with the first MZ_PAD columns repeated at the end, so a day reads the window
 * MZ[(y + r) * MZ_W + ((x + s) mod W)] for a daily random row shift r <= MZ_RS and column shift s, box by
 * box (10 cells) without a modulo per cell. Precipitation cells and the cloud band below the rain threshold
 * then come in coherent patches a few cells wide instead of salt-and-pepper, while every cell keeps a
 * unit-variance latent (so the precipitation statistics per cell are unchanged).
 */
function buildMesoNoise(seed, out) {
  const rows = MZ_ROWS, pad = Math.ceil(3 * MESO_SY);
  const src = new Float32Array((rows + 2 * pad) * W), tmp = new Float64Array(W), row = new Float64Array(W);
  const base = dayBase(seed, 0x7ffffffe, 17);
  for (let i = 0; i < src.length; i++) src[i] = GAUSS[cellHash(base, i) >>> GSHIFT];
  // x blur, row by row (latitude of a table row = that of the cell row it serves at the middle shift)
  for (let t = 0; t < rows + 2 * pad; t++) {
    const y = Math.min(H - 1, Math.max(0, t - pad - (MZ_RS >> 1)));
    const sx = MESO_SX / Math.max(Math.cos(cellLat(y) * DEG), 0.22), R = Math.ceil(3 * sx);
    const wts = new Float64Array(2 * R + 1);
    let e = 0;
    for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sx) ** 2); wts[j + R] = w; e += w * w; }
    const k = 1 / Math.sqrt(e), o = t * W;
    for (let x = 0; x < W; x++) tmp[x] = src[o + x];
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = -R; j <= R; j++) { let xx = x + j; xx = xx < 0 ? xx + W : xx >= W ? xx - W : xx; s += wts[j + R] * tmp[xx]; }
      row[x] = s * k;
    }
    for (let x = 0; x < W; x++) src[o + x] = row[x];
  }
  // y blur (rows are independent unit-variance after the x pass)
  const Ry = pad, wy = new Float64Array(2 * Ry + 1);
  let ey = 0;
  for (let j = -Ry; j <= Ry; j++) { const w = Math.exp(-0.5 * (j / MESO_SY) ** 2); wy[j + Ry] = w; ey += w * w; }
  const ky = 1 / Math.sqrt(ey);
  const mz = out && out.length === rows * MZ_W ? out : new Float32Array(rows * MZ_W);
  let s1 = 0, s2 = 0;
  for (let t = 0; t < rows; t++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = -Ry; j <= Ry; j++) s += wy[j + Ry] * src[(t + pad + j) * W + x];
      const v = s * ky;
      mz[t * MZ_W + x] = v; s1 += v; s2 += v * v;
    }
  }
  const cnt = rows * W, mean = s1 / cnt, kk = 1 / Math.sqrt(s2 / cnt - mean * mean);
  for (let t = 0; t < rows; t++) {
    const o = t * MZ_W;
    for (let x = 0; x < W; x++) mz[o + x] = (mz[o + x] - mean) * kk;
    for (let x = 0; x < MZ_PAD; x++) mz[o + W + x] = mz[o + x];
  }
  return mz;
}

/** a[idx[k]] for every k (into out). */
function gather(a, idx, out = new Float32Array(idx.length)) {
  for (let k = 0; k < idx.length; k++) out[k] = a[idx[k]];
  return out;
}

/** Start offsets per row of a sorted per-cell row list: cells of row y are [r[y], r[y+1]). */
function rowRanges(rowOf) {
  const r = new Int32Array(H + 1);
  for (let k = 0; k < rowOf.length; k++) r[rowOf[k] + 1]++;
  for (let y = 0; y < H; y++) r[y + 1] += r[y];
  return r;
}

/**
 * Linear interpolation of a coarse row (CX nodes, node i at cell 5i + 2, periodic) to W cells:
 * out[5i + 2 + j] = (pre * (r[i] + (r[i+1] - r[i]) * F[j])) * K[j] (same arithmetic as the
 * per-cell bilinear tables, so results are bit-identical).
 */
function expandRow(r, out, F, K, pre) {
  const f1 = F[1], f2 = F[2], f3 = F[3], f4 = F[4];
  const k0 = K[0], k1 = K[1], k2 = K[2], k3 = K[3], k4 = K[4];
  let a = r[0];
  for (let i = 0, x = 2; i < CX - 1; i++, x += 5) {
    const b = r[i + 1], dl = b - a;
    out[x] = (pre * (a + dl * F[0])) * k0;
    out[x + 1] = (pre * (a + dl * f1)) * k1;
    out[x + 2] = (pre * (a + dl * f2)) * k2;
    out[x + 3] = (pre * (a + dl * f3)) * k3;
    out[x + 4] = (pre * (a + dl * f4)) * k4;
    a = b;
  }
  const dl = r[0] - a; // last segment wraps: cells 717, 718, 719, 0, 1
  out[W - 3] = (pre * (a + dl * F[0])) * k0;
  out[W - 2] = (pre * (a + dl * f1)) * k1;
  out[W - 1] = (pre * (a + dl * f2)) * k2;
  out[0] = (pre * (a + dl * f3)) * k3;
  out[1] = (pre * (a + dl * f4)) * k4;
}

function expand(compact, idx, C) {
  const o = new C(N);
  for (let i = 0; i < idx.length; i++) o[idx[i]] = compact[i];
  return o;
}

export { maskFromCells, parseNormals, cellOf, boxOfCell, W, H, N, OCEAN, LAKE, LAND } from './grid.js';
export { fromDate, toDate, dayInfo, dayOf } from './date.js';
export { EVENT_TYPES, EVENT_NAMES_RU, TROPICAL_CYCLONE_RU } from './events.js';
export { LOG_SYNTHETIC, LOG_PARTIAL } from './climatelog.js';
