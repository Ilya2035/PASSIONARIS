// The division for the ground shader: one integer texture (the ground shader may read only 16 textures; the base
// takes nine, every aspect gets one, so everything of the division lives in this one). It is FN texels wide and holds
// two things:
//   rows 0 .. FN − 1   a texel for every chunk of 1 km² (division/km.js): r = its district (division/cells.js: the
//                      outlines of districts run chunk by chunk, along rivers and crests);
//                      g = what the chunk is like, once that is worked out (km.js chunkFacts): the class of its
//                      ground 1..5 (0 water or not known) | who can live there (0 nobody, 1 barely, 2 freely) << 3
//                      | how much of it is under fields, a byte (town/farmland.js) << 8 — only while the chunks are
//                      shown by their fields | why nobody can settle there (km.js chunkSettle) << 16 — while shown;
//                      b = the list of pieces of border lines near the square (border.js): its first four | how many
//                      fours << 24 (0 none);
//                      a = the district of the middle of the square, by the lines
//   rows FN ..         a texel for every district, district d at (d % FN, FN + floor(d / FN)):
//     r  district | province << 16
//     g  region | look << 16; look = colour of the district (3 bits) | of the province << 3 | of the region << 6 | kind << 9
//     b  the middle of the district, tenths of km: (x + 1000) | (y − 3000) << 16
//     a  a random number of the district, 0 .. 65535 | 1 << 16 for a district inside the state of history shown
//        (lands.json "states")
//   rows L0 ..         the lists of the squares, four entries a texel: piece | key << 24 (key = level · 2 + water;
//                      0xFFFFFFFF pads)
//   rows S0 ..         the pieces of the border lines, a texel each: x, y of the start as float bits, the offset to its
//                      end as two 16-bit numbers (fixOf), the district on its left | on its right << 16
// L0 and S0 go to the shader as the uniform uDivGeo (texture.userData.rows).
import { DataTexture, RGBAIntegerFormat, UnsignedIntType, NearestFilter, ClampToEdgeWrapping } from 'three';
import { KN as FN, cellsOfChunks, livingOf } from './km.js';
import { PIECE_KM } from './border.js';

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
// the district of a chunk of 1 km²: its drawn outline, or the district of the natural cell it lies in
export const districtOfTexel = (ch, div, t) => { const d = div.cells ? div.cells[t] : div.district[cellsOfChunks(ch).cell[t]]; return d >= 0 ? d : 0; };

// state: a byte a chunk, 1 inside the state shown (build.js stateMask); a state is made of whole provinces, so a
// district is inside it when its first chunk is
// facts: km.js chunkFacts(), when the chunks are to be shown; farm: the share of every chunk under fields, a byte
// (town/farmland.js), when they are to be shown by their fields
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const bitsOf = v => { F32[0] = v; return U32[0]; };
// the offset of a piece's end, km (never more than PIECE_KM), in 16 bits: steps of 6 cm
export const fixOf = v => Math.max(0, Math.min(65535, Math.round((v / (2 * PIECE_KM) + .5) * 65535)));
// rows: filled with { L0, S0 }, the first rows of the lists and of the pieces; why: km.js chunkSettle().why, when
// the places where nobody can settle are shown (g, bits 16..18)
export function packDivision(ch, div, state = null, facts = null, farm = null, rows = {}, why = null) {
  const geo = div.geo, rd = Math.ceil(div.count / FN), rl = geo ? Math.ceil(geo.list.length / 4 / FN) : 0, rs = geo ? Math.ceil(geo.count / FN) : 0;
  const a = new Uint32Array(FN * (FN + rd + rl + rs) * 4), c = div.colour;
  rows.L0 = FN + rd; rows.S0 = FN + rd + rl;
  for (let t = 0; t < FN * FN; t++) a[t * 4] = districtOfTexel(ch, div, t);
  if (geo) {
    for (let t = 0; t < FN * FN; t++) { if (geo.num[t]) a[t * 4 + 2] = (geo.first[t] | geo.num[t] << 24) >>> 0; a[t * 4 + 3] = Math.max(0, geo.centre[t]); }
    a.set(geo.list, rows.L0 * FN * 4);
    for (let s = 0, o = rows.S0 * FN * 4; s < geo.count; s++, o += 4) {
      const ax = Math.fround(geo.seg[s * 4]), ay = Math.fround(geo.seg[s * 4 + 1]);
      a[o] = bitsOf(ax); a[o + 1] = bitsOf(ay); a[o + 2] = (fixOf(geo.seg[s * 4 + 2] - ax) | fixOf(geo.seg[s * 4 + 3] - ay) << 16) >>> 0; a[o + 3] = geo.lab[s];
    }
  }
  if (facts) for (let t = 0; t < FN * FN; t++) { const k = facts.cls[t]; a[t * 4 + 1] = k | livingOf(k) << 3; }
  if (farm) for (let t = 0; t < FN * FN; t++) a[t * 4 + 1] |= farm[t] << 8;
  if (why) for (let t = 0; t < FN * FN; t++) a[t * 4 + 1] |= why[t] << 16;
  for (let d = 0; d < div.count; d++) {
    const p = div.province[d], r = div.region[p], o = (FN * FN + d) * 4, first = div.chunks[d][0];
    const look = c.district[d] | c.province[p] << 3 | c.region[r] << 6 | div.kinds[d] << 9;
    a[o] = (d | p << 16) >>> 0; a[o + 1] = (r | look << 16) >>> 0;
    a[o + 2] = (Math.round((div.cx[d] + 1000) * 10) | Math.round((div.cy[d] - 3000) * 10) << 16) >>> 0;
    a[o + 3] = (hashOf(first) | (state && state[first] ? 1 << 16 : 0)) >>> 0;
  }
  return a;
}
export const divisionTexture = (ch, div, state, facts = null, farm = null, why = null) => { const rows = {}, a = packDivision(ch, div, state, facts, farm, rows, why), t = utex(a, FN, a.length / 4 / FN); t.userData.rows = rows; return t; };
