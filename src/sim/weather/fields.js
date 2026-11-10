// Spatially correlated AR(1) anomaly fields on the coarse 144x72 grid (2.5 deg).
//
// Each day a white-noise field (a window of a seeded Gaussian table at a hashed daily
// offset, or counter-based hashing when no table is given) is smoothed with
// two box blurs in x (radius widened by 1/cos(lat) so features keep their size in km
// towards the poles, periodic) and two in y (clamped). The smoothing kernels are known,
// so each row is renormalised analytically to exactly unit variance. The field then
// evolves as F = phi * advect(F) + sqrt(1 - phi^2) * innovation, which keeps it a
// stationary unit-variance Gaussian process.
//
// Advection moves whole rows by integer node counts with a per-row phase accumulator:
// no interpolation, so no numerical damping of the variance. Rows drift eastward under
// the mid-latitude westerlies and westward in the trade-wind belt.

import { CX, CY, CN, nodeLat } from './grid.js';
import { GAUSS, GAUSS_BITS, dayBase } from './rng.js';

const GSHIFT = 32 - GAUSS_BITS;
const DEG = Math.PI / 180;

// shared scratch (all users are synchronous)
const tmpA = new Float32Array(CN), tmpB = new Float32Array(CN);
const colA = new Float64Array(CY), colB = new Float64Array(CY);
const rowT = new Float32Array(CX);

/** Zonal drift speed of weather systems, m/s (positive = eastward). */
export function systemSpeed(lat) {
  const a = Math.abs(lat);
  return 11 * Math.exp(-(((a - 45) / 16) ** 2)) - 6 * Math.exp(-((lat / 14) ** 2)) - 2 * Math.exp(-(((a - 78) / 8) ** 2));
}

const ext = new Float64Array(CX + 2 * 64);
/** Periodic box blur of one row (radius r < CX/2) through a padded copy, no modulo in the loop. */
function boxRowPeriodic(src, so, dst, d0, r) {
  const n = CX, inv = 1 / (2 * r + 1);
  for (let i = 0; i < r; i++) { ext[i] = src[so + n - r + i]; ext[n + r + i] = src[so + i]; }
  for (let i = 0; i < n; i++) ext[r + i] = src[so + i];
  let s = 0;
  for (let k = 0; k <= 2 * r; k++) s += ext[k];
  for (let i = 0; i < n; i++) {
    dst[d0 + i] = s * inv;
    s += ext[i + 2 * r + 1] - ext[i];
  }
}

function boxColClamped(src, dst, r) {
  const n = CY, w = 2 * r + 1, inv = 1 / w, last = n - 1;
  let s = 0;
  for (let k = -r; k <= r; k++) s += src[k < 0 ? 0 : k > last ? last : k];
  for (let j = 0; j < n; j++) {
    dst[j] = s * inv;
    const a = j + r + 1, b = j - r;
    s += src[a > last ? last : a] - src[b < 0 ? 0 : b];
  }
}

const yA = new Float64Array(CN), yB = new Float64Array(CN), ySum = new Float64Array(CX);
/** boxColClamped applied to every column of a CY x CX field at once (row-wise running sums). */
function boxRowsClamped(src, dst, r) {
  const n = CY, inv = 1 / (2 * r + 1), last = n - 1, s = ySum;
  s.fill(0);
  for (let k = -r; k <= r; k++) {
    const o = (k < 0 ? 0 : k > last ? last : k) * CX;
    for (let i = 0; i < CX; i++) s[i] += src[o + i];
  }
  for (let j = 0; j < n; j++) {
    const o = j * CX, a = j + r + 1, b = j - r;
    const oa = (a > last ? last : a) * CX, ob = (b < 0 ? 0 : b) * CX;
    for (let i = 0; i < CX; i++) {
      dst[o + i] = s[i] * inv;
      s[i] += src[oa + i] - src[ob + i];
    }
  }
}

// x kernel of radius r (two periodic box passes): unit-variance factor and lag-1 autocorrelation
const xKernelCache = new Map();
function xKernel(r) {
  if (!xKernelCache.has(r)) {
    const a = new Float32Array(CX), b = new Float32Array(CX);
    a[0] = 1;
    boxRowPeriodic(a, 0, b, 0, r);
    boxRowPeriodic(b, 0, a, 0, r);
    let s = 0, s1 = 0;
    for (let i = 0; i < CX; i++) { s += a[i] * a[i]; s1 += a[i] * a[(i + 1) % CX]; }
    xKernelCache.set(r, { norm: 1 / Math.sqrt(s), rho1: s1 / s });
  }
  return xKernelCache.get(r);
}

export class SynopticField {
  /**
   * @param {object} o
   * @param {number} o.stream  random stream id (unique per field)
   * @param {number} o.ry      y blur radius in nodes
   * @param {number} o.rx      x blur radius in nodes at the equator
   * @param {number} o.phi     daily AR(1) coefficient
   * @param {boolean} o.advect drift with the zonal flow
   * @param {number} [o.cosFloor] x radius grows as rx / max(cos(lat), cosFloor): 0.05 keeps the
   *   feature size in km up to the poles; larger values keep slow fields regional at high latitudes
   */
  constructor({ stream, ry, rx, phi, advect = false, cosFloor = 0.05 }) {
    this.stream = stream; this.ry = ry; this.phi = phi; this.advect = advect;
    this.noise = null; // optional seeded Gaussian table (Float32Array, length > 2*CN)
    this.data = new Float32Array(CN);
    this.phase = new Float64Array(CY);
    this.rxRow = new Int32Array(CY);
    this.xNorm = new Float32Array(CY);
    this.xRho1 = new Float32Array(CY);
    this.speed = new Float32Array(CY);
    for (let j = 0; j < CY; j++) {
      const lat = nodeLat(j), cl = Math.max(Math.cos(lat * DEG), 0.05);
      this.rxRow[j] = Math.min(30, Math.max(rx, Math.round(rx / Math.max(cl, cosFloor))));
      const xk = xKernel(this.rxRow[j]);
      this.xNorm[j] = xk.norm; this.xRho1[j] = xk.rho1;
      const nodesPerDay = (systemSpeed(lat) * 86400) / (111320 * Math.max(cl, 0.2)) / (360 / CX);
      this.speed[j] = advect ? Math.max(-6, Math.min(6, nodesPerDay)) : 0;
    }
    // y kernel variance per output row (rows are independent after the x pass)
    this.yNorm = new Float32Array(CY);
    this.Ky = new Float64Array(CY * CY); // Ky[j*CY + src]: weight of x-blurred row src in output row j
    const k2 = new Float64Array(CY);
    for (let src = 0; src < CY; src++) {
      colA.fill(0); colA[src] = 1;
      boxColClamped(colA, colB, ry);
      boxColClamped(colB, colA, ry);
      for (let j = 0; j < CY; j++) { k2[j] += colA[j] * colA[j]; this.Ky[j * CY + src] = colA[j]; }
    }
    for (let j = 0; j < CY; j++) this.yNorm[j] = 1 / Math.sqrt(k2[j]);
  }

  /** Exact covariance of the stationary field between node (i, j) and node (i + lag, j2), lag in {0, 1}. */
  covariance(j, j2, lag) {
    let s = 0;
    const K = this.Ky, a = j * CY, b = j2 * CY;
    for (let r = 0; r < CY; r++) {
      const w = K[a + r] * K[b + r];
      if (w) s += w * (lag ? this.xRho1[r] : 1);
    }
    return s * this.yNorm[j] * this.yNorm[j2];
  }

  /** Unit-variance smoothed noise for (seed, day) into out. */
  innovation(seed, day, out) {
    const base = dayBase(seed, day, this.stream);
    const tab = this.noise;
    if (tab && tab.length > 2 * CN) {
      const off = base % (tab.length - CN);
      tmpA.set(tab.subarray(off, off + CN));
    } else {
      for (let n = 0; n < CN; n++) {
        let h = Math.imul(base ^ n, 0x2c1b3c6d);
        h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
        h ^= h >>> 15; h = Math.imul(h, 0x4b1d6f2b);
        h ^= h >>> 13;
        tmpA[n] = GAUSS[h >>> GSHIFT];
      }
    }
    for (let j = 0; j < CY; j++) {
      const o = j * CX, r = this.rxRow[j], k = this.xNorm[j];
      boxRowPeriodic(tmpA, o, tmpB, o, r);
      boxRowPeriodic(tmpB, o, tmpA, o, r);
      for (let i = 0; i < CX; i++) tmpA[o + i] *= k;
    }
    // y: the same two clamped box passes as boxColClamped, run on whole rows (all columns at once,
    // same arithmetic per column, so bit-identical but cache-friendly)
    boxRowsClamped(tmpA, yA, this.ry);
    boxRowsClamped(yA, yB, this.ry);
    const yN = this.yNorm;
    for (let j = 0; j < CY; j++) {
      const o = j * CX, k = yN[j];
      for (let i = 0; i < CX; i++) out[o + i] = yB[o + i] * k;
    }
    return out;
  }

  /** Draw from the stationary distribution (used on (re)initialisation). */
  reset(seed, day) {
    // a different stream than step() so the first step does not reuse the same innovation
    const s = this.stream;
    this.stream = s + 1000;
    this.innovation(seed, day, this.data);
    this.stream = s;
    this.phase.fill(0);
  }

  /** Advance one day, or n days at once (exact for the AR(1) process: phi^n, n days of drift). */
  step(seed, day, n = 1) {
    const d = this.data;
    if (this.advect) {
      for (let j = 0; j < CY; j++) {
        let p = this.phase[j] + (n === 1 ? this.speed[j] : this.speed[j] * n);
        const k = Math.trunc(p);
        p -= k;
        this.phase[j] = p;
        if (k === 0) continue;
        const o = j * CX, kk = ((k % CX) + CX) % CX;
        for (let i = 0; i < CX; i++) rowT[i] = d[o + i];
        // new[i] = old[i - kk] (periodic)
        for (let i = 0; i < kk; i++) d[o + i] = rowT[CX - kk + i];
        for (let i = kk; i < CX; i++) d[o + i] = rowT[i - kk];
      }
    }
    const inn = this.innovation(seed, day, tmpB);
    const a = n === 1 ? this.phi : Math.pow(this.phi, n), b = Math.sqrt(1 - a * a);
    for (let i = 0; i < CN; i++) d[i] = a * d[i] + b * inn[i];
  }
}
