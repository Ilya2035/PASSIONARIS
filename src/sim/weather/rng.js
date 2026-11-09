// Counter-based randomness and lookup tables.
//
// Every random number in the weather model is a pure function of
// (seed, day, stream, index), so the simulator carries no RNG state: saving,
// loading and re-chunking the time steps can never change the outcome.

/** 32-bit finalizer (lowbias32 by C. Wellons). */
export function mix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Base hash for one (seed, day, stream) triple. Index-level hashing is done inline in hot loops with cellHash(). */
export function dayBase(seed, day, stream) {
  return mix32(mix32((seed ^ 0x5bd1e995) + Math.imul(day | 0, 0x9e3779b1)) ^ Math.imul(stream + 1, 0x85ebca77));
}

/** Hash of an index under a base (same arithmetic as the inlined hot-loop version). */
export function cellHash(base, i) {
  let h = Math.imul(base ^ i, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15; h = Math.imul(h, 0x4b1d6f2b);
  h ^= h >>> 13;
  return h >>> 0;
}

export const u01 = h => (h >>> 0) / 4294967296;

// ---------------------------------------------------------------- normal distribution

/** Inverse standard normal CDF (P. Acklam, rel. error < 1.2e-9 after refinement). */
export function invNorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5, r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // one Halley step
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/** ln(erfc(x)) for x >= 0 (Numerical Recipes erfcc, rel. error < 1.2e-7), stable in the far tail. */
function lnErfcPos(x) {
  const t = 1 / (1 + 0.5 * x);
  return Math.log(t) - x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
}
export function erfc(x) {
  return x >= 0 ? Math.exp(lnErfcPos(x)) : 2 - Math.exp(lnErfcPos(-x));
}
/** Standard normal CDF. */
export const normCdf = x => 0.5 * erfc(-x / Math.SQRT2);
export const normPdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
/** ln Q(z) = ln(1 - Phi(z)), accurate in the upper tail. */
export function lnUpperTail(z) {
  return z >= 0 ? Math.log(0.5) + lnErfcPos(z / Math.SQRT2) : Math.log(1 - 0.5 * Math.exp(lnErfcPos(-z / Math.SQRT2)));
}

// ---------------------------------------------------------------- LUTs (built once per module load)

/** Gaussian quantiles indexed by the top GAUSS_BITS of a hash: GAUSS[h >>> (32 - GAUSS_BITS)]. */
export const GAUSS_BITS = 14;
export const GAUSS = new Float32Array(1 << GAUSS_BITS);
{
  const n = GAUSS.length;
  for (let i = 0; i < n; i++) GAUSS[i] = invNorm((i + 0.5) / n);
  // remove the tiny discretization variance deficit so the LUT has exactly unit variance
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += GAUSS[i] * GAUSS[i];
  const k = 1 / Math.sqrt(s2 / n);
  for (let i = 0; i < n; i++) GAUSS[i] *= k;
}

/** Phi(x) and G(x) = x*Phi(x) + phi(x) (partial expectation of max(Z+x,0)) on [-8, 8], used by the climatological spin-up. */
export const PG_MIN = -8, PG_SIZE = 4096, PG_SCALE = PG_SIZE / 16;
export const PHI_T = new Float32Array(PG_SIZE + 1);
export const GEX_T = new Float32Array(PG_SIZE + 1);
for (let i = 0; i <= PG_SIZE; i++) {
  const x = PG_MIN + i / PG_SCALE;
  PHI_T[i] = normCdf(x);
  GEX_T[i] = x * PHI_T[i] + normPdf(x);
}
export function phiLut(x) {
  const f = (x - PG_MIN) * PG_SCALE;
  return f <= 0 ? 0 : f >= PG_SIZE ? 1 : PHI_T[f | 0];
}
export function gexLut(x) {
  const f = (x - PG_MIN) * PG_SCALE;
  return f <= 0 ? 0 : f >= PG_SIZE ? x : GEX_T[f | 0];
}
