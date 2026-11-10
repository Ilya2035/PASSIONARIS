// Climate of an era: the 12 monthly temperatures and precipitation sums of a year in 5000 BC … 2100 (normals +
// paleoclimate — the very fields the temperature and precipitation map modes show) on the 0.5° SIM grid, reduced
// to the Köppen and fertility statistics and packed as half floats for the globe.
//
// Layout of `data` (Uint16 half floats, LAYERS layers of W x H RGBA, layer-major — a DataArrayTexture):
//   layer 0  tCold, tHot, mat, t4            °C at the cell's mean height (koppenStats)
//   layer 1  bcrit, wcrit, sM, wM            B thresholds (°C of MAT), s / w margins (mm)
//   layer 2  afM, amM, cellElev, gdd5         Af / Am margins (mm), cell height (m), degree-days above 5 °C
//   layer 3  water, n5, soil, monthDT         fertility factors, days above 5 °C; paleo dT of the shown month
//                                             (the weather map's anomaly is taken against the era, not today)
//
// The work is split into steps (one month of fields, then bands of rows) so a running game spreads it over
// frames: request(year) starts it, work(budgetMs) advances it, `version` grows when an era is complete.
import { koppenStats } from './koppen.js';
import { fertilityStats } from './fertility.js';
import { dayLengths } from './biomes.js';

export const W = 720, H = 360, N = W * H, LAYERS = 4;
const ROWS_PER_STEP = 6;   // ~3 ms in the browser

// ---- half floats (finite values well inside ±65504; tiny values flush to zero)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7bff;
  return sign | ((e << 10) + (((x & 0x7fffff) + 0x1000) >> 13));
}
let HALF_LUT = null;
export function fromHalf(h) {
  if (!HALF_LUT) {
    HALF_LUT = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) {
      const s = i & 0x8000 ? -1 : 1, e = (i >> 10) & 0x1f, m = i & 0x3ff;
      HALF_LUT[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? s * Infinity : s * (1 + m / 1024) * 2 ** (e - 15);
    }
  }
  return HALF_LUT[h];
}

export function createEraClimate({ normals, paleo }) {
  const T12 = new Int16Array(12 * N), P12 = new Uint16Array(12 * N);   // °C x10, mm x10 of the era being built
  const data = new Uint16Array(LAYERS * N * 4);
  const dTb = new Float32Array(N), pFb = new Float32Array(N), addb = new Float32Array(N);
  const T = new Float32Array(12), P = new Float32Array(12), DL = new Float32Array(12);
  const ks = {}, fs = {};
  let target = NaN, year = NaN, phase = 0, row = 0, version = 0, monthVersion = 0;
  const L = (layer, i) => (layer * N + i) * 4;

  // a month is two steps: the paleo fields (~4 ms), then the cells
  function monthFill(m) {
    if (paleo?.fillRegionalDT) paleo.fillRegionalDT(target, m, dTb); else dTb.fill(0);
    // the precipitation factor does not depend on the month: computed with January, kept for the other months
    if (paleo?.fillPrecip) paleo.fillPrecip(target, m, m === 0 ? pFb : null, addb); else { pFb.fill(1); addb.fill(0); }
  }
  function monthCells(m) {
    const off = m * N, tav = normals.tavg, pr = normals.prec;
    for (let i = 0; i < N; i++) {
      const t = tav[off + i] + dTb[i] * 10;
      T12[off + i] = t < -32000 ? -32000 : t > 32000 ? 32000 : Math.round(t);
      const p = (pr[off + i] * pFb[i] + addb[i]) * 10;
      P12[off + i] = p <= 0 ? 0 : p >= 65535 ? 65535 : Math.round(p);
    }
  }
  function rowStep(y) {
    const lat = 90 - (y + 0.5) * 0.5;
    dayLengths(lat, DL);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (let m = 0; m < 12; m++) { T[m] = T12[m * N + i] * 0.1; P[m] = P12[m * N + i] * 0.1; }
      koppenStats(T, P, lat, ks);
      fertilityStats(T, P, lat, fs, DL);
      let o = L(0, i);
      data[o] = toHalf(ks.tCold); data[o + 1] = toHalf(ks.tHot); data[o + 2] = toHalf(ks.mat); data[o + 3] = toHalf(ks.t4);
      o = L(1, i);
      data[o] = toHalf(ks.bcrit); data[o + 1] = toHalf(ks.wcrit); data[o + 2] = toHalf(ks.sM); data[o + 3] = toHalf(ks.wM);
      o = L(2, i);
      data[o] = toHalf(ks.afM); data[o + 1] = toHalf(ks.amM); data[o + 2] = toHalf(normals.elev[i]); data[o + 3] = toHalf(fs.gdd5);
      o = L(3, i);
      data[o] = toHalf(fs.water); data[o + 1] = toHalf(fs.n5); data[o + 2] = toHalf(fs.soil);   // .w: setMonthDT
    }
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const era = {
    W, H, N, LAYERS, data,
    /** Completed era (year), NaN before the first one. */
    get year() { return year; },
    get busy() { return target === target && target !== year; },
    get ready() { return year === year; },
    /** Grows by one whenever an era is complete (the globe re-uploads the layers). */
    get version() { return version; },
    /** Grows when the monthly paleo dT (layer 3 .w) changes. */
    get monthVersion() { return monthVersion; },
    /** Start building the climate of `y` (no-op when it is the current or pending era). */
    request(y) {
      if (y === target) return;
      const touched = era.busy && phase >= 24 && row > 0;   // a cut-off job has overwritten some rows
      target = y; phase = 0; row = 0;
      if (y === year && touched) year = NaN;   // back to the built era, but its rows are mixed: rebuild
    },
    /**
     * Advance the pending era by steps while another step still fits in budgetMs (at least one step; Infinity =
     * finish). Returns true when the era completed.
     */
    work(budgetMs = Infinity) {
      if (!era.busy) return false;
      const t0 = now();
      let last = 0;
      do {
        const s = now();
        if (phase < 24) { if (phase & 1) monthCells(phase >> 1); else monthFill(phase >> 1); phase++; }
        else {
          const y1 = Math.min(H, row + ROWS_PER_STEP);
          for (; row < y1; row++) rowStep(row);
          if (row >= H) { year = target; version++; return true; }
        }
        last = now() - s;
      } while (now() - t0 + last < budgetMs);
      return false;
    },
    /** Paleo temperature offset of the month on show (Float32Array(N), degC; null = 0). */
    setMonthDT(dT) {
      for (let i = 0; i < N; i++) data[L(3, i) + 3] = dT ? toHalf(dT[i]) : 0;
      monthVersion++;
    },
    /**
     * Statistics at a point, bilinear between cell centres like the GPU's linear filter (longitude wraps).
     * out: { tCold, tHot, mat, t4, bcrit, wcrit, sM, wM, afM, amM, elev, gdd5, water, n5, soil, monthDT }
     */
    statsAt(lat, lon, out = {}) {
      const fx = (lon + 180) / 0.5 - 0.5, fy = (90 - lat) / 0.5 - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const X = x => ((x % W) + W) % W, Y = y => Math.min(H - 1, Math.max(0, y));
      const c00 = Y(y0) * W + X(x0), c10 = Y(y0) * W + X(x0 + 1), c01 = Y(y0 + 1) * W + X(x0), c11 = Y(y0 + 1) * W + X(x0 + 1);
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const get = (layer, ch) => fromHalf(data[L(layer, c00) + ch]) * w00 + fromHalf(data[L(layer, c10) + ch]) * w10
        + fromHalf(data[L(layer, c01) + ch]) * w01 + fromHalf(data[L(layer, c11) + ch]) * w11;
      out.tCold = get(0, 0); out.tHot = get(0, 1); out.mat = get(0, 2); out.t4 = get(0, 3);
      out.bcrit = get(1, 0); out.wcrit = get(1, 1); out.sM = get(1, 2); out.wM = get(1, 3);
      out.afM = get(2, 0); out.amM = get(2, 1); out.elev = get(2, 2); out.gdd5 = get(2, 3);
      out.water = get(3, 0); out.n5 = get(3, 1); out.soil = get(3, 2); out.monthDT = get(3, 3);
      return out;
    },
    /** The 12 months of the cell at lat / lon of the era being built or last built (°C, mm). */
    monthsAt(lat, lon, outT = new Float32Array(12), outP = new Float32Array(12)) {
      const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 0.5))), x = ((Math.floor((lon + 180) / 0.5) % W) + W) % W;
      const i = y * W + x;
      for (let m = 0; m < 12; m++) { outT[m] = T12[m * N + i] * 0.1; outP[m] = P12[m * N + i] * 0.1; }
      return { T: outT, P: outP };
    },
  };
  return era;
}
