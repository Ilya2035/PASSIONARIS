// The division for the ground shader: one integer texture (the ground shader may read only 16 textures; the base
// takes nine, every aspect gets one, so everything of the division lives in this one). It is FN texels wide and holds
// two things:
//   rows 0 .. FN − 1   a texel for every texel of the fine raster (1.25 km): r = the district there (division/cells.js:
//                      the outlines of districts are drawn texel by texel, along rivers and crests)
//   rows FN ..         a texel for every district, district d at (d % FN, FN + floor(d / FN)):
//     r  district | province << 16
//     g  region | look << 16; look = colour of the district (3 bits) | of the province << 3 | of the region << 6 | kind << 9
//     b  the middle of the district, tenths of km: (x + 1000) | (y − 3000) << 16
//     a  a random number of the district, 0 .. 65535 | 1 << 16 for a district inside the state of history shown
//        (lands.json "states")
import { DataTexture, RGBAIntegerFormat, UnsignedIntType, NearestFilter, ClampToEdgeWrapping } from 'three';
import { FN } from '../chunks.js';

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
// the district of a texel of the fine raster: its drawn outline, or the district of its chunk
export const districtOfTexel = (ch, div, t) => { const d = div.cells ? div.cells[t] : div.district[ch.cell[t]]; return d >= 0 ? d : 0; };

// state: a byte a chunk, 1 inside the state shown (build.js stateMask); a state is made of whole provinces, so a
// district is inside it when its first chunk is
export function packDivision(ch, div, state = null) {
  const rows = Math.ceil(div.count / FN), a = new Uint32Array(FN * (FN + rows) * 4), c = div.colour;
  for (let t = 0; t < FN * FN; t++) a[t * 4] = districtOfTexel(ch, div, t);
  for (let d = 0; d < div.count; d++) {
    const p = div.province[d], r = div.region[p], o = (FN * FN + d) * 4, first = div.chunks[d][0];
    const look = c.district[d] | c.province[p] << 3 | c.region[r] << 6 | div.kinds[d] << 9;
    a[o] = (d | p << 16) >>> 0; a[o + 1] = (r | look << 16) >>> 0;
    a[o + 2] = (Math.round((div.cx[d] + 1000) * 10) | Math.round((div.cy[d] - 3000) * 10) << 16) >>> 0;
    a[o + 3] = (hashOf(first) | (state && state[first] ? 1 << 16 : 0)) >>> 0;
  }
  return a;
}
export const divisionTexture = (ch, div, state) => { const a = packDivision(ch, div, state); return utex(a, FN, a.length / 4 / FN); };
