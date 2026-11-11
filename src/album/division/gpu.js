// The division for the ground shader: three small integer textures (read with texelFetch, never filtered).
//   tDivF  RGBA16UI, G × G cells of 1.25 km: land district (r) and water district (g) of every cell (fine.js), bit 15
//          set when the 4 × 4 cells around are one district; signed distance to the nearest river, m + 32768 (b)
//   tDivC  R16UI, 128 × 128: the district of every chunk, exactly
//   tDivT  RGBA16UI, two texels per district: (province, region, colours | kind << 12, chunks) and
//          (centre x, centre y in tenths of km from (−1000, 3000), a random number of its own, 0)
import { DataTexture, RedIntegerFormat, RGBAIntegerFormat, UnsignedShortType, NearestFilter, ClampToEdgeWrapping } from 'three';
import { CN } from '../chunks.js';
import { G } from './fine.js';

function utex(data, w, h, format, internal) {
  const t = new DataTexture(data, w, h, format, UnsignedShortType);
  t.internalFormat = internal; t.minFilter = t.magFilter = NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
// stand-ins until the division is worked out: one district 0 everywhere
export const emptyTextures = () => ({
  tDivF: utex(new Uint16Array([0, 0, 65535, 0]), 1, 1, RGBAIntegerFormat, 'RGBA16UI'),
  tDivC: utex(new Uint16Array(1), 1, 1, RedIntegerFormat, 'R16UI'),
  tDivT: utex(new Uint16Array(8), 2, 1, RGBAIntegerFormat, 'RGBA16UI'),
});

export function fineTexture(fine) {
  const a = new Uint16Array(G * G * 4);
  for (let t = 0; t < G * G; t++) { a[t * 4] = fine.land[t]; a[t * 4 + 1] = fine.water[t]; a[t * 4 + 2] = fine.river[t] + 32768; }
  return utex(a, G, G, RGBAIntegerFormat, 'RGBA16UI');
}
export function chunkTexture(div) { return utex(Uint16Array.from(div.district), CN, CN, RedIntegerFormat, 'R16UI'); }

// a random number of a district's own that does not change when other districts change: from its first chunk
const hashOf = k => { let x = Math.imul(k + 7, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) % 65536; };
export function tableTexture(div) {
  const rows = Math.max(1, Math.ceil(div.count / 64)), a = new Uint16Array(128 * rows * 4);
  for (let d = 0; d < div.count; d++) {
    const o = ((d >> 6) * 128 + (d & 63) * 2) * 4, p = div.province[d], r = div.region[p], c = div.colour;
    a[o] = p; a[o + 1] = r; a[o + 2] = c.district[d] | c.province[p] << 4 | c.region[r] << 8 | div.kinds[d] << 12; a[o + 3] = Math.min(65535, div.chunks[d].length);
    a[o + 4] = Math.round((div.cx[d] + 1000) * 10); a[o + 5] = Math.round((div.cy[d] - 3000) * 10); a[o + 6] = hashOf(div.chunks[d][0]);
  }
  return utex(a, 128, rows, RGBAIntegerFormat, 'RGBA16UI');
}
