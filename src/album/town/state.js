// What the settlement work keeps for the shaders next to the chunk textures: four bytes per chunk
//   R, G  where in the chunk its site lies (the middle of its patch of houses)
//   B     radius of the patch, from the chunk's `built` share (0 = nothing built)
//   A     which of the 3 × 3 chunks around hold a patch (their places 0..8, row by row; 4 is the chunk itself):
//         not built: 0 none · 1 + a one · 10 + 9 a + b two · 100 more
//         built, m its manner of building: 200 + m alone · 110 + 2 b + (m − 1) with one neighbour b · 210 + m with more
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
    const around = [];                                              // places of the built chunks of the 3 × 3, other than this one
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < n && yy < n && rb[yy * n + xx]) around.push((dy + 1) * 3 + dx + 1);
    }
    if (rb[k]) {
      const [bx, by] = siteOf(k), cul = C[o + 2] === CULTURES.atl ? CULTURES.atl : CULTURES.med;
      set(o, bx); set(o + 1, by); set(o + 2, rb[k]); set(o + 3, around.length === 0 ? 200 + cul : around.length === 1 ? 110 + 2 * around[0] + (cul - 1) : 210 + cul);
      const L = lobeOf(k, bx, by, rb[k], cul); L.rivals = []; lobes.push(L); byK.set(k, L);
      continue;
    }
    set(o, 0); set(o + 1, 0); set(o + 2, 0); set(o + 3, around.length === 0 ? 0 : around.length === 1 ? 1 + around[0] : around.length === 2 ? 10 + 9 * around[0] + around[1] : 100);
  }
  for (const L of lobes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const xx = L.cx + dx, yy = L.cy + dy, R = xx >= 0 && yy >= 0 && xx < n && yy < n ? byK.get(yy * n + xx) : null;
    if (R) L.rivals.push(R);
  }
  return { lobes, changed };
}
