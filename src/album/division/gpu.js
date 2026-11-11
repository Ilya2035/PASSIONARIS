// The division for the ground shader: one integer texture, a texel per chunk (album.chunks.palW a side, chunk k at
// (k % palW, floor(k / palW)) — read with chunkTexel() of glsl.js). The ground shader may read only 16 textures; the
// base takes nine, every aspect gets one, so everything of the division lives in the channels of this one:
//   r  district | province << 16
//   g  region | look << 16; look = colour of the district (3 bits) | of the province << 3 | of the region << 6 | kind << 9
//   b  the middle of the district, tenths of km: (x + 1000) | (y − 3000) << 16
//   a  a random number of the district, 0 .. 65535 (the same for all its chunks)
import { DataTexture, RGBAIntegerFormat, UnsignedIntType, NearestFilter, ClampToEdgeWrapping } from 'three';

function utex(data, w, h) {
  const t = new DataTexture(data, w, h, RGBAIntegerFormat, UnsignedIntType);
  t.internalFormat = 'RGBA32UI'; t.minFilter = t.magFilter = NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
// stand-in until the division is worked out
export const emptyTexture = () => utex(new Uint32Array(4), 1, 1);

// a random number of a district's own that does not change when other districts change: from its first chunk
const hashOf = k => { let x = Math.imul(k + 7, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) % 65536; };

export function packDivision(ch, div) {
  const W = ch.palW, a = new Uint32Array(W * W * 4), c = div.colour;
  for (let k = 0; k < ch.count; k++) {
    const d = div.district[k], p = div.province[d], r = div.region[p], o = k * 4;
    const look = c.district[d] | c.province[p] << 3 | c.region[r] << 6 | div.kinds[d] << 9;
    a[o] = (d | p << 16) >>> 0; a[o + 1] = (r | look << 16) >>> 0;
    a[o + 2] = (Math.round((div.cx[d] + 1000) * 10) | Math.round((div.cy[d] - 3000) * 10) << 16) >>> 0;
    a[o + 3] = hashOf(div.chunks[d][0]);
  }
  return a;
}
export const divisionTexture = (ch, div) => utex(packDivision(ch, div), ch.palW, ch.palW);
