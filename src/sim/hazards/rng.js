// Deterministic hashing and random streams for the hazards module.
// Everything stochastic is keyed by (seed, purpose, index...) so that any year or event
// can be regenerated independently and in any order with identical results.

/** murmur3 fmix32 finaliser. */
export function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of up to 5 integers (any sign) into a uint32. */
export function hash32(a, b = 0, c = 0, d = 0, e = 0) {
  let h = fmix32((a | 0) ^ 0x9e3779b9);
  h = fmix32(h ^ Math.imul((b | 0) + 0x7f4a7c15, 0x27d4eb2f));
  h = fmix32(h ^ Math.imul((c | 0) + 0x165667b1, 0x9e3779b1));
  h = fmix32(h ^ Math.imul((d | 0) + 0x61c88647, 0x85ebca77));
  h = fmix32(h ^ Math.imul((e | 0) + 0x2545f491, 0xc2b2ae3d));
  return h;
}

/** Uniform [0,1) from a hash of integers. */
export const hashUnit = (a, b, c, d, e) => hash32(a, b, c, d, e) / 4294967296;

/** String -> uint32 (FNV-1a), for seeds given as text. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return fmix32(h);
}

/** Small fast PRNG (sfc32). Re-seedable without allocation. */
export class Rng {
  constructor(seed = 1) { this.a = 0; this.b = 0; this.c = 0; this.d = 0; this.reseed(seed); }
  reseed(a, b = 0, c = 0, d = 0) {
    this.a = hash32(a, b, c, d, 1); this.b = hash32(a, b, c, d, 2);
    this.c = hash32(a, b, c, d, 3); this.d = hash32(a, b, c, d, 4) | 1;
    for (let i = 0; i < 8; i++) this.u32();
    return this;
  }
  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  /** Uniform [0,1). */
  next() { return this.u32() / 4294967296; }
  /** Integer in [0, n). */
  int(n) { return Math.floor(this.next() * n); }
  /** Standard normal (Box–Muller, one value per call). */
  normal() {
    let u = this.next(); if (u < 1e-12) u = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Poisson-distributed count with mean lambda. */
  poisson(lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      for (;;) { p *= this.next(); if (p <= L) return k; k++; }
    }
    // normal approximation is adequate for the large global classes
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
  }
}
