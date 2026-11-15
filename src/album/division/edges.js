// Borders by chunks (the owner, 15.11.2026: «Мне нужно, чтобы мы показывали визуально чанки границы, чтобы можно было
// по чанкам границы видеть. Именно не все чанки, а просто границы по чанкам, которые отрисовываются. Чтобы можно было
// понять: вот этот город строится вот по таким чанкам… и там разделение границ»). On the map as it is, thin lines:
// the outlines of the chunks of 1 km² where something runs along them, not of every chunk —
//   • the chunks a settlement is built on (layers/towns.js townOfChunk): the outline of the settlement bolder, the
//     sides between its own chunks thinner;
//   • the chunks under fields (town/farmland.js);
//   • the row of chunks on either side of a border of a district, province or region: the border is their outer side.
// What every chunk is for this goes into the texture of the division (gpu.js, g):
//   bit 5          the chunk touches a border (a chunk of another district of its own kind among the eight around it)
//   bit 19         some of it is under fields
//   bits 20 .. 31  the settlement built on it: 1 + its number modulo 4095 (0 none), enough to tell neighbours apart
import { KN as FN, KNY as FNY } from './km.js';

export const EDGE = { border: 1 << 5, fields: 1 << 19, town: 20 };
const MOD = 4095;

// div: the division (cells, kinds); ownerOf(c) → the number of the settlement chunk c is built on, or undefined; farm:
// the share of every chunk under fields, a byte (or null) → Uint32Array, the bits of every chunk
export function chunkEdges(div, ownerOf = null, farm = null) {
  const n = FN * FNY, out = new Uint32Array(n), cells = div.cells, kinds = div.kinds;
  for (let j = 0; j < FNY; j++) for (let i = 0; i < FN; i++) {
    const t = j * FN + i, d = cells[t]; if (d < 0) continue;
    const wet = kinds[d] !== 0; let b = 0;
    for (let dj = -1; dj <= 1 && !b; dj++) for (let di = -1; di <= 1; di++) {
      const u = i + di, v = j + dj; if (u < 0 || v < 0 || u >= FN || v >= FNY || (!di && !dj)) continue;
      const e = cells[v * FN + u]; if (e >= 0 && e !== d && (kinds[e] !== 0) === wet) { b = EDGE.border; break; }
    }
    out[t] = b;
  }
  if (farm) for (let t = 0; t < n; t++) if (farm[t] > 0) out[t] |= EDGE.fields;
  if (ownerOf) for (let t = 0; t < n; t++) { const o = ownerOf(t); if (o !== undefined && o >= 0) out[t] = (out[t] | ((o % MOD) + 1) << EDGE.town) >>> 0; }
  return out;
}

// the same as the shader reads it back: { border, fields, town (0 none) }
export const edgeOf = g => ({ border: !!(g & EDGE.border), fields: !!(g & EDGE.fields), town: g >>> EDGE.town });
