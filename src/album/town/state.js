// What the settlement work keeps for the shaders: its one texture, which says which patch of settlement lies where
// (rules.js). It holds two grids laid from the same corner of the map: the COARSE one, squares of 10 km, for the towns
// (the places of the album and the centres of districts), and the FINE one, squares of 2.5 km, for the villages
// between them (villages.js). The fine grid fills the first VN rows of the texture, the coarse one the GN rows after
// them (their first GN columns). Four bytes per square, the same in both grids:
//   R, G  where in the square the site of its patch lies
//   B     radius of the patch (radiusByte(); 0 = no patch)
//   A     which of the 3 × 3 squares around hold a patch whose houses or fields reach into this square (their places
//         0..8, row by row; 4 is the square itself):
//         without a patch: 0 none · 1 + a one · 10 + 9 a + b two · 100 more
//         with a patch, m its manner of building: 200 + m alone · 110 + 2 b + (m − 1) with one neighbour b · 210 + m with more
// It is a mirror of the chunk state: mirrorSettle() rewrites it whenever `built` or `culture` change. A chunk with
// `built` > 0 has a patch: at the site and of the size the model of growth gave it, or, for a chunk built up by
// anything else (a brush), in the middle of the chunk and of the area of its built share.
import { DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, ClampToEdgeWrapping, Vector4 } from 'three';
import { CELL, GN, GK, GX0, GY0, VN, VK, radiusByte, radiusOfShare, siteBytes, fineBytes, gridOf, lobeOf, villageLobe, fieldsBeyond, CULTURES } from './rules.js';

export const settleBytes = new Uint8Array(GN * GN * 4);              // the coarse grid
export const atlasBytes = new Uint8Array(VN * (VN + GN) * 4);        // the texture: the fine grid, then the coarse one
export const villageBytes = atlasBytes.subarray(0, VN * VN * 4);     // the fine grid, in its place in the texture
export const settleTex = new DataTexture(atlasBytes, VN, VN + GN, RGBAFormat, UnsignedByteType);
// the coarse grid into its rows of the texture
export function packAtlas(coarse = settleBytes, out = atlasBytes) { for (let r = 0; r < GN; r++) out.set(coarse.subarray(r * GN * 4, (r + 1) * GN * 4), (VN + r) * VN * 4); }
settleTex.magFilter = settleTex.minFilter = NearestFilter; settleTex.wrapS = settleTex.wrapT = ClampToEdgeWrapping; settleTex.needsUpdate = true;
// uSettle: x cell of the lattice, km · y how present the blocks are (1 near .. 0 the ground alone paints the roofs) ·
// z height of the houses, × · w 1 settlements shown, 0 hidden
export const settleUniforms = { tSettle: { value: settleTex }, uSettle: { value: new Vector4(CELL, 1, 1.25, 0) } };

// towns: what the model of growth founded, [{ x, y, R, home, byte }] (grow.js); may be empty.
// Returns the patches (each with the patches of the squares around as `rivals`), and whether anything changed.
export function mirrorSettle(ch, towns = [], out = settleBytes) {
  const C = ch.bytes.C, n = GN, at = new Map(), homes = new Set(), hamlets = new Set();
  const put = (x, y, r, home) => {                                  // one patch a square: the larger stays
    const g = gridOf(x, y); if (g < 0 || !(r > 0)) return;
    const old = at.get(g); if (old && old.r >= r) return;
    at.set(g, { x, y, r, home, cul: C[home * 4 + 2] === CULTURES.atl ? CULTURES.atl : CULTURES.med });
  };
  for (const t of towns) {
    if (t.village) { hamlets.add(t.home); continue; }               // a village lies in the fine grid (mirrorVillages)
    homes.add(t.home);
    const b = C[t.home * 4]; if (!b) continue;                      // pulled down since
    put(t.x, t.y, b === t.byte ? t.R : radiusOfShare(b / 255, ch.area[t.home]), t.home);
  }
  // (a cell whose only houses are those of its villages has the least share there is, and no patch of its own)
  for (let k = 0; k < ch.count; k++) if (C[k * 4] && !homes.has(k) && !(hamlets.has(k) && C[k * 4] <= 1)) put(ch.cx[k], ch.cy[k], radiusOfShare(C[k * 4] / 255, ch.area[k]), k);
  let changed = false; const lobes = [], byG = new Map();
  const set = (o, v) => { if (out[o] !== v) { out[o] = v; changed = true; } };
  for (let g = 0; g < n * n; g++) {
    const x = g % n, y = (g / n) | 0, o = g * 4, p = at.get(g), around = [];
    if (at.size) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!(dx || dy) || xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const q = at.get(yy * n + xx); if (!q) continue;
      // only a neighbour whose houses or fields can reach into this square: a village in the middle of its own square
      // is no business of the squares around, and their pixels need not look at it
      const x0 = GX0 + x * GK, y0 = GY0 + y * GK, ex = Math.max(x0 - q.x, 0, q.x - x0 - GK), ey = Math.max(y0 - q.y, 0, q.y - y0 - GK);
      if (Math.hypot(ex, ey) < q.r + fieldsBeyond(q.r) + .7) around.push((dy + 1) * 3 + dx + 1);
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

// The villages into the fine grid. towns: what the model of growth founded (those with .village and .fine, the square
// of the fine grid each stands in); coarse: the patches of the towns (mirrorSettle), so that a village knows the
// towns beside it. A village whose natural cell has lost all its houses (a brush) is gone with them.
// Returns the patches of the villages and whether anything changed.
const scratch = new Uint8Array(VN * VN * 4);
export function mirrorVillages(ch, towns = [], coarse = [], out = villageBytes) {
  const C = ch.bytes.C, at = new Map(), around = new Map();
  for (const t of towns) {
    if (!t.village || !(t.fine >= 0) || !C[t.home * 4]) continue;
    at.set(t.fine, { x: t.x, y: t.y, r: t.R, home: t.home, cul: C[t.home * 4 + 2] === CULTURES.atl ? CULTURES.atl : CULTURES.med });
  }
  // which of the 3 × 3 squares around a square hold a village whose houses or fields reach into it
  for (const [v, q] of at) {
    const vx = v % VN, vy = (v / VN) | 0, reach = q.r + fieldsBeyond(q.r) + .32;   // nothing of a village is drawn farther from its site (aspSettle)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = vx + dx, yy = vy + dy; if (!(dx || dy) || xx < 0 || yy < 0 || xx >= VN || yy >= VN) continue;
      const x0 = GX0 + xx * VK, y0 = GY0 + yy * VK, ex = Math.max(x0 - q.x, 0, q.x - x0 - VK), ey = Math.max(y0 - q.y, 0, q.y - y0 - VK);
      if (Math.hypot(ex, ey) < reach) { const g = yy * VN + xx; (around.get(g) || around.set(g, []).get(g)).push((1 - dy) * 3 + 1 - dx); }
    }
  }
  scratch.fill(0);
  const lobes = [], byV = new Map();
  for (const [v, q] of at) {
    const o = v * 4, [bx, by] = fineBytes(q.x, q.y), rb = radiusByte(q.r), a = around.get(v) || [];
    scratch[o] = bx; scratch[o + 1] = by; scratch[o + 2] = rb; scratch[o + 3] = a.length === 0 ? 200 + q.cul : a.length === 1 ? 110 + 2 * a[0] + (q.cul - 1) : 210 + q.cul;
    const L = villageLobe(v, bx, by, rb, q.cul); L.home = q.home; lobes.push(L); byV.set(v, L);
  }
  for (const [g, a] of around) if (!at.has(g)) { a.sort((p, q) => p - q); scratch[g * 4 + 3] = a.length === 1 ? 1 + a[0] : a.length === 2 ? 10 + 9 * a[0] + a[1] : 100; }
  let changed = false;
  for (let i = 0; i < scratch.length; i++) if (out[i] !== scratch[i]) { changed = true; break; }
  if (changed) out.set(scratch);
  // the patches a village must keep clear of: the villages of the squares around, and the towns near it
  const towny = new Map(); for (const T of coarse) { const g = gridOf(T.x, T.y); if (g >= 0) (towny.get(g) || towny.set(g, []).get(g)).push(T); }
  for (const L of lobes) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = L.vx + dx, yy = L.vy + dy; if (!(dx || dy) || xx < 0 || yy < 0 || xx >= VN || yy >= VN) continue;
      const R = byV.get(yy * VN + xx); if (R) L.rivals.push(R);
    }
    const gx = Math.floor((L.x - GX0) / GK), gy = Math.floor((L.y - GY0) / GK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = gx + dx, yy = gy + dy; if (xx < 0 || yy < 0 || xx >= GN || yy >= GN) continue;
      for (const T of towny.get(yy * GN + xx) || []) if (Math.hypot(T.x - L.x, T.y - L.y) < T.r + L.r + 1) L.rivals.push(T); }
  }
  return { lobes, changed };
}
