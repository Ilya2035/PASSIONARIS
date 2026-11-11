// What the settlement work keeps for the shaders: its one texture, a grid of squares of 10 km that says which patch
// of settlement lies where (rules.js). Four bytes per square:
//   R, G  where in the square the site of its patch lies
//   B     radius of the patch (radiusByte(); 0 = no patch)
//   A     which of the 3 × 3 squares around hold a patch (their places 0..8, row by row; 4 is the square itself):
//         without a patch: 0 none · 1 + a one · 10 + 9 a + b two · 100 more
//         with a patch, m its manner of building: 200 + m alone · 110 + 2 b + (m − 1) with one neighbour b · 210 + m with more
// It is a mirror of the chunk state: mirrorSettle() rewrites it whenever `built` or `culture` change. A chunk with
// `built` > 0 has a patch: at the site and of the size the model of growth gave it, or, for a chunk built up by
// anything else (a brush), in the middle of the chunk and of the area of its built share.
import { DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, ClampToEdgeWrapping, Vector4 } from 'three';
import { CELL, GN, radiusByte, radiusOfShare, siteBytes, gridOf, lobeOf, CULTURES } from './rules.js';

export const settleBytes = new Uint8Array(GN * GN * 4);
export const settleTex = new DataTexture(settleBytes, GN, GN, RGBAFormat, UnsignedByteType);
settleTex.magFilter = settleTex.minFilter = NearestFilter; settleTex.wrapS = settleTex.wrapT = ClampToEdgeWrapping; settleTex.needsUpdate = true;
// uSettle: x cell of the lattice, km · y how present the blocks are (1 near .. 0 the ground alone paints the roofs) ·
// z height of the houses, × · w 1 settlements shown, 0 hidden
export const settleUniforms = { tSettle: { value: settleTex }, uSettle: { value: new Vector4(CELL, 1, 1.25, 0) } };

// towns: what the model of growth founded, [{ x, y, R, home, byte }] (grow.js); may be empty.
// Returns the patches (each with the patches of the squares around as `rivals`), and whether anything changed.
export function mirrorSettle(ch, towns = [], out = settleBytes) {
  const C = ch.bytes.C, n = GN, at = new Map(), homes = new Set();
  const put = (x, y, r, home) => {                                  // one patch a square: the larger stays
    const g = gridOf(x, y); if (g < 0 || !(r > 0)) return;
    const old = at.get(g); if (old && old.r >= r) return;
    at.set(g, { x, y, r, home, cul: C[home * 4 + 2] === CULTURES.atl ? CULTURES.atl : CULTURES.med });
  };
  for (const t of towns) {
    homes.add(t.home);
    const b = C[t.home * 4]; if (!b) continue;                      // pulled down since
    put(t.x, t.y, b === t.byte ? t.R : radiusOfShare(b / 255, ch.area[t.home]), t.home);
  }
  for (let k = 0; k < ch.count; k++) if (C[k * 4] && !homes.has(k)) put(ch.cx[k], ch.cy[k], radiusOfShare(C[k * 4] / 255, ch.area[k]), k);
  let changed = false; const lobes = [], byG = new Map();
  const set = (o, v) => { if (out[o] !== v) { out[o] = v; changed = true; } };
  for (let g = 0; g < n * n; g++) {
    const x = g % n, y = (g / n) | 0, o = g * 4, p = at.get(g), around = [];
    if (at.size) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < n && yy < n && at.has(yy * n + xx)) around.push((dy + 1) * 3 + dx + 1);
    }
    if (p) {
      const [bx, by] = siteBytes(p.x, p.y), rb = radiusByte(p.r);
      set(o, bx); set(o + 1, by); set(o + 2, rb); set(o + 3, around.length === 0 ? 200 + p.cul : around.length === 1 ? 110 + 2 * around[0] + (p.cul - 1) : 210 + p.cul);
      const L = lobeOf(g, bx, by, rb, p.cul); L.home = p.home; lobes.push(L); byG.set(g, L);
      continue;
    }
    set(o, 0); set(o + 1, 0); set(o + 2, 0); set(o + 3, around.length === 0 ? 0 : around.length === 1 ? 1 + around[0] : around.length === 2 ? 10 + 9 * around[0] + around[1] : 100);
  }
  for (const L of lobes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const xx = L.gx + dx, yy = L.gy + dy, R = xx >= 0 && yy >= 0 && xx < n && yy < n ? byG.get(yy * n + xx) : null;
    if (R) L.rivals.push(R);
  }
  return { lobes, changed };
}
