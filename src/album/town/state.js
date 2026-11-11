// What the settlement work keeps for the shaders next to the chunk textures: four bytes per chunk
//   R, G  where in the chunk its site lies (the middle of its patch of houses)
//   B     radius of the patch, from the chunk's `built` share (0 = nothing built)
//   A     0 nothing near · 255 a neighbour is built · 200 + manner of building for a built chunk
// It is a mirror of the chunk state: mirrorSettle() rewrites it whenever `built` or `culture` change.
import { DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, ClampToEdgeWrapping, Vector4 } from 'three';
import { CN } from '../chunks.js';
import { CELL20, radiusByte, lobeOf, CULTURES } from './rules.js';

export const settleBytes = new Uint8Array(CN * CN * 4);
export const settleTex = new DataTexture(settleBytes, CN, CN, RGBAFormat, UnsignedByteType);
settleTex.magFilter = settleTex.minFilter = NearestFilter; settleTex.wrapS = settleTex.wrapT = ClampToEdgeWrapping; settleTex.needsUpdate = true;
// uSettle: x cell of the lattice, km · y how present the blocks are (1 near .. 0 the ground alone paints the roofs) ·
// z height of the houses, × · w free
export const settleUniforms = { tSettle: { value: settleTex }, uSettle: { value: new Vector4(CELL20, 1, 1.25, 0) } };

// Rewrites `out` (CN × CN × 4 bytes) from the chunk state. siteOf(k) → [bx, by], the site of chunk k.
// Returns the patches (one per built chunk, each with its built neighbours as `rivals`), and whether anything changed.
export function mirrorSettle(ch, siteOf, out = settleBytes) {
  const C = ch.bytes.C, n = CN, rb = new Uint8Array(n * n), lobes = [];
  let changed = false;
  for (let k = 0; k < n * n; k++) rb[k] = radiusByte(C[k * 4] / 255);
  const set = (o, v) => { if (out[o] !== v) { out[o] = v; changed = true; } };
  const byK = new Map();
  for (let k = 0; k < n * n; k++) {
    const x = k % n, y = (k / n) | 0, o = k * 4;
    if (rb[k]) {
      const [bx, by] = siteOf(k), cul = C[o + 2] === CULTURES.atl ? CULTURES.atl : CULTURES.med;
      set(o, bx); set(o + 1, by); set(o + 2, rb[k]); set(o + 3, 200 + cul);
      const L = lobeOf(k, bx, by, rb[k], cul); L.rivals = []; lobes.push(L); byK.set(k, L);
      continue;
    }
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n && rb[yy * n + xx]) { near = true; break; }
    }
    set(o, 0); set(o + 1, 0); set(o + 2, 0); set(o + 3, near ? 255 : 0);
  }
  for (const L of lobes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const xx = L.cx + dx, yy = L.cy + dy, R = xx >= 0 && yy >= 0 && xx < n && yy < n ? byK.get(yy * n + xx) : null;
    if (R) L.rivals.push(R);
  }
  return { lobes, changed };
}
