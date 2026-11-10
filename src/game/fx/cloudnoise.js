// Baked cloud noise for the terrain shader (the B and A channels of its tiling noise texture, globe.js):
//   B  "billows": rounded lobes separated by sharp creases (the tops of cumulus seen from above), four scales
//   A  a smooth fractal field of the same scales, independent of B (veils, thickness, domain warp)
// Both tile seamlessly and span the full 0..255 range. One mip-mapped fetch gives a whole stack of octaves that
// fades by itself before it can alias, which is what lets clouds and aerosol masses keep ragged edges and volume
// from orbit at the cost of two or three fetches (shaders.js: cloudNoise).
//
// Gradient noise and jittered domes on a wrapping lattice (`P` cells across the tile), deterministic (mulberry32).

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// one octave of tiling gradient noise added into `out` (n x n): out += w * noise
function addOctave(out, n, P, seed, w) {
  const rnd = mulberry(seed);
  const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  // per-column lattice index, fraction and fade (the same for rows)
  const i0 = new Int32Array(n), i1 = new Int32Array(n), fr = new Float32Array(n), fd = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const v = (x + 0.5) / n * P, k = Math.floor(v), f = v - k;
    i0[x] = k % P; i1[x] = (k + 1) % P; fr[x] = f; fd[x] = f * f * f * (f * (f * 6 - 15) + 10);
  }
  for (let y = 0; y < n; y++) {
    const r0 = i0[y] * P, r1 = i1[y] * P, fy = fr[y], v = fd[y], o = y * n;
    for (let x = 0; x < n; x++) {
      const a = i0[x], b = i1[x], fx = fr[x], u = fd[x];
      const n00 = gx[r0 + a] * fx + gy[r0 + a] * fy, n10 = gx[r0 + b] * (fx - 1) + gy[r0 + b] * fy;
      const n01 = gx[r1 + a] * fx + gy[r1 + a] * (fy - 1), n11 = gx[r1 + b] * (fx - 1) + gy[r1 + b] * (fy - 1);
      const top = n00 + (n10 - n00) * u, bot = n01 + (n11 - n01) * u;
      const val = top + (bot - top) * v;   // about -0.7 .. 0.7
      out[o + x] += w * val;
    }
  }
}

// one octave of rounded lobes: every lattice cell holds a dome (a paraboloid cap) at a jittered point, and the field
// is the highest dome over each texel — a union of spheres seen from above, with sharp creases where they meet and
// no lattice directions. out += w * dome. Splatted dome by dome (cheaper than searching the cells around a texel).
function addPuffs(out, n, P, seed, w) {
  const rnd = mulberry(seed), cell = n / P, tmp = new Float32Array(n * n);
  for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) {
    const px = (cx + 0.15 + 0.7 * rnd()) * cell, py = (cy + 0.15 + 0.7 * rnd()) * cell;
    const r = cell * (0.8 + 0.55 * rnd()), top = 0.7 + 0.3 * rnd(), ir2 = 1 / (r * r);
    const x0 = Math.floor(px - r), x1 = Math.ceil(px + r), y0 = Math.floor(py - r), y1 = Math.ceil(py + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - py, row = (((y % n) + n) % n) * n;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - px, h = top * (1 - (dx * dx + dy * dy) * ir2);
        if (h <= 0) continue;
        const i = row + (((x % n) + n) % n);
        if (h > tmp[i]) tmp[i] = h;
      }
    }
  }
  for (let i = 0; i < tmp.length; i++) out[i] += w * tmp[i];
}

// stretch to 0..255 between the lo / hi quantiles (a few values clip: the full range is used)
function toBytes(f, dst, offset, stride, lo = 0.004, hi = 0.996) {
  const s = Float32Array.from(f).sort();
  const a = s[Math.floor(lo * (s.length - 1))], b = s[Math.floor(hi * (s.length - 1))], k = 255 / Math.max(b - a, 1e-6);
  for (let i = 0; i < f.length; i++) dst[i * stride + offset] = Math.max(0, Math.min(255, Math.round((f[i] - a) * k)));
}

/**
 * Fills channels B (billows) and A (smooth fractal) of an n x n RGBA byte array (stride 4).
 * The lattice periods are 4, 8, 16, 32, 64 cells across the tile: sampled over 30 degrees the broadest lobes are
 * ~7 degrees, sampled over 6 degrees the finest are ~10 km.
 */
export function bakeCloudNoise(rgba, n = 512) {
  const B = new Float32Array(n * n), A = new Float32Array(n * n);
  // billows: a smooth broad swell carries rounded lobes of four finer scales. Each scale has well under half the
  // height of the one above, so the slopes (which is what the shading shows) belong to the large domes and the
  // small lobes only roughen them
  addOctave(B, n, 4, 101, 0.9);
  addPuffs(B, n, 8, 211, 1.0);
  addPuffs(B, n, 16, 307, 0.42);
  addPuffs(B, n, 32, 401, 0.17);
  addPuffs(B, n, 64, 503, 0.07);
  addOctave(A, n, 4, 601, 1.0);
  addOctave(A, n, 8, 701, 0.55);
  addOctave(A, n, 16, 809, 0.3);
  addOctave(A, n, 32, 907, 0.16);
  addOctave(A, n, 64, 1009, 0.09);
  toBytes(B, rgba, 2, 4);
  toBytes(A, rgba, 3, 4);
  return rgba;
}
