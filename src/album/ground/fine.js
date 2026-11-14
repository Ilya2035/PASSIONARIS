// Fine heights for the mountains (docs/album/ground.md, «Подробные высоты гор»).
//
// The base of the album has a point every 230 m: every mountain drawn from it alone is rounded. For the mountains of
// Spain there are tiles of Web-Mercator level 11 — a point every 57 m at 42° N — baked by
// scripts/album/fetch-heights-fine.mjs into public/album-data/h11/ and listed in meta.json under `fine`.
//
// A window of them around the camera is joined into one square of heights and given to the ground as its fine heights
// (Terrain.setDetail), the same way as the square of a showcase place: a road, a house and a river ask heightLod()
// and stand on the same ground. This file is the part that needs no browser: which window, and how it is joined.
export const FINE_Z = 11, TILE = 256, WIN = 2048;
// a fine tile leans toward the base over this many of its points where the tile beside it is missing
export const FEATHER = 16;
// land of the base that lies lower than this is lifted to it inside a window, m: the ground shader takes fine heights
// of .6 m and less for water (heightLod), and the flats of a delta, filled in from the base, would turn to sea
export const SHORE = .75;

// One tile as it lies in its file → its heights as the base holds them (metres = v / 4 − 8192), rows from the north.
// In the file every number is stored minus the one before it in its row (the first of a row minus the first of the
// row above), modulo 65536: a slope is small numbers, and gzip packs them well.
export function decodeTile(d) {
  const u = new Uint16Array(TILE * TILE);
  for (let k = 0; k < u.length; k++) u[k] = (d[k] + (k % TILE ? u[k - 1] : k ? u[k - TILE] : 0)) & 65535;
  return u;
}
export function encodeTile(u) {
  const d = new Uint16Array(TILE * TILE);
  for (let k = 0; k < d.length; k++) d[k] = (u[k] - (k % TILE ? u[k - 1] : k ? u[k - TILE] : 0)) & 65535;
  return d;
}

// How fine a window the camera needs, by its height in km: 0 — every point of the tiles (8 × 8 tiles, 116 km a side,
// a point every 57 m); 1 — every other point (16 × 16 tiles, 232 km, a point every 115 m); −1 — none, the base is
// as fine as a pixel. L: the level in use; it is kept a little past its limit, so a camera that hovers at a limit
// does not rebuild the window with every breath.
export function levelFor(h, L = -1) {
  if (h < (L === 0 ? 36 : 32)) return 0;
  if (h < (L >= 0 ? 140 : 125)) return 1;
  return -1;
}
export const tilesOf = L => 8 << L;
// The window the ground should have: { L, x0, y0 } — its level and its north-west tile — or null.
//   cur     the window in use, or null         tx, ty  where the camera looks, in tiles of level 11         h  km
// The window in use is kept while the camera stays within a quarter of its side from its middle (two tiles at the
// finest level); past that a new one is centred on the camera.
export function windowFor(cur, tx, ty, h) {
  const L = levelFor(h, cur ? cur.L : -1);
  if (L < 0) return null;
  const n = tilesOf(L), keep = n / 4;
  if (cur && cur.L === L && Math.abs(tx - (cur.x0 + n / 2)) <= keep && Math.abs(ty - (cur.y0 + n / 2)) <= keep) return cur;
  return { L, x0: Math.round(tx - n / 2), y0: Math.round(ty - n / 2) };
}
// where a window lies, as the ground shader is told (data.js, rectOf): corner in the normalised Mercator plane and
// 1 / its side. (The shader reads the step of the fine heights from this: glsl.js, heightLod.)
export const windowRect = w => { const N = 2 ** FINE_Z, k = N / tilesOf(w.L); return [w.x0 / N, w.y0 / N, k, k]; };

// Joins the tiles of a window into one square of heights: metres, WIN points a side, rows from the north.
//   tile(x, y)      the decoded fine tile, or null where there is none (or it could not be read)
//   has(x, y)       is there a fine tile at all — asked for the neighbours, which may lie outside the window
//   baseAt(mx, my)  the height of the base at a point of the normalised Mercator plane, m
// Where there is no fine tile the base fills the square, so the window has no holes. A fine tile with such a
// neighbour leans toward the base over its last FEATHER points on that side, so there is no step where the fine
// heights end.
export function joinWindow(win, tile, has, baseAt, out = new Float32Array(WIN * WIN)) {
  const n = tilesOf(win.L), q = TILE >> win.L, N = 2 ** FINE_Z, F = FEATHER >> win.L;
  const base = (i, j) => baseAt((win.x0 + (i + .5) / q) / N, (win.y0 + (j + .5) / q) / N);   // i, j: a point of the window
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
    const x = win.x0 + tx, y = win.y0 + ty, t = tile(x, y), ox = tx * q, oy = ty * q;
    if (!t) {
      for (let j = 0; j < q; j++) for (let i = 0; i < q; i++) { const v = base(ox + i, oy + j); out[(oy + j) * WIN + ox + i] = v > 0 && v < SHORE ? SHORE : v; }
      continue;
    }
    if (win.L === 0) for (let j = 0; j < q; j++) { const r = j * TILE, o = (oy + j) * WIN + ox; for (let i = 0; i < q; i++) out[o + i] = t[r + i] / 4 - 8192; }
    else for (let j = 0; j < q; j++) { const r = j * 2 * TILE, o = (oy + j) * WIN + ox; for (let i = 0; i < q; i++) { const k = r + i * 2; out[o + i] = (t[k] + t[k + 1] + t[k + TILE] + t[k + TILE + 1]) / 16 - 8192; } }
    // toward the base at the sides where the fine heights end
    const lean = (i, j, d) => { const o = (oy + j) * WIN + ox + i, b = base(ox + i, oy + j); out[o] = b + (out[o] - b) * (d + .5) / F; };
    if (!has(x - 1, y)) for (let j = 0; j < q; j++) for (let d = 0; d < F; d++) lean(d, j, d);
    if (!has(x + 1, y)) for (let j = 0; j < q; j++) for (let d = 0; d < F; d++) lean(q - 1 - d, j, d);
    if (!has(x, y - 1)) for (let i = 0; i < q; i++) for (let d = 0; d < F; d++) lean(i, d, d);
    if (!has(x, y + 1)) for (let i = 0; i < q; i++) for (let d = 0; d < F; d++) lean(i, q - 1 - d, d);
  }
  return out;
}
