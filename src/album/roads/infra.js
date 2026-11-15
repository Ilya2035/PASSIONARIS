// What can be laid through a chunk: a main road, a lesser road, a track, or nothing (the owner, 15.11.2026:
// «прописать все уровни в чанки инфраструктур»; the lead: the limits are those of the laying of the roads, so that
// the state of a chunk and the roads never disagree).
//   • The roads are laid chunk by chunk (roads/routes.js): a step from the middle of one chunk to the middle of the
//     next costs its length, 1 + 28 s + 520 s² times more on a slope s (rise over run), and a little more high up.
//   • A way through a chunk comes in by one side and leaves by another. The EASE of a chunk is how many times
//     dearer than level ground its second cheapest step is: both the way in and the way out are at least that easy.
//   • The limits are the ones the network is laid by. A leg that costs more than POOR (2.1) times its length is a
//     track, not a road; a leg dearer than HARD (5.5) times its length is no way at all. A main road is a road
//     that the network needs — it is told from a lesser one by its place in the network, not by the ground — but
//     it is laid at will only over easy ground: INFRA.main. Through harder ground it goes as a mountain road, where
//     a great road of history takes its pass.
// This file has no imports: the division, the roads and the tests all read it.
export const INFRA = { main: 1.5, lesser: 2.1, track: 5.5 };            // the ease of a chunk up to which a main road, a lesser road, a track can be laid
export const STEEP = [28, 520], HIGH = .00012;                           // the price of a slope and of height (the same numbers as routes.js)
export const LEVEL = { none: 0, track: 1, lesser: 2, main: 3 };
const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

// hgt: metres at the middle of every chunk; land: 1 where a chunk is land; n: chunks across (and the step from a
// row to the next); km: the side of a chunk; ny: rows of chunks from south to north (a square lattice: n);
// sx: how long a step east–west truly is, in sides of a chunk — the plane of the album keeps the east–west scale of
// latitude 40°, so it is cos(lat)/cos 40° (division/km.js, rowScale of the row of the chunk; 1 on the polygon of today)
// → the ease of chunk t (1: level ground; Infinity: no two ways out of it over land)
export function chunkEase(hgt, land, n, t, km = 1, ny = n, sx = 1) {
  const tx = t % n, ty = (t - tx) / n, dd = sx === 1 ? 1.4142 : 1.4142 * Math.sqrt((1 + sx * sx) / 2); let a = Infinity, b = Infinity;
  for (let q = 0; q < 16; q += 2) {
    const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= n || uy >= ny) continue;
    const u = uy * n + ux; if (!land[u]) continue;
    const s = Math.abs(hgt[u] - hgt[t]) / ((q >= 8 ? dd : q < 4 ? sx : 1) * km * 1000), f = (1 + STEEP[0] * s + STEEP[1] * s * s) * (1 + Math.max(hgt[u], hgt[t]) * HIGH);
    if (f < a) { b = a; a = f; } else if (f < b) b = f;
  }
  return b;
}
// the level of a chunk by its ease: LEVEL.main | lesser | track | none
export const levelOf = ease => (ease <= INFRA.main ? 3 : ease <= INFRA.lesser ? 2 : ease <= INFRA.track ? 1 : 0);
// → Uint8Array, a level for every chunk (0 for water). roads: Uint8Array of the kinds of road that really run
// through the chunks (0 none, 1 track, 2 lesser, 3 main) or null — a chunk is never below the road that crosses it;
// ny: rows of chunks (a square lattice: n); scale: row → the true length of a step east–west there, in sides of a
// chunk (rowScale of division/km.js), or null — 1 everywhere
export function infraLevels(hgt, land, n, km = 1, roads = null, ny = n, scale = null) {
  const out = new Uint8Array(n * ny);
  for (let t = 0; t < out.length; t++) { if (!land[t]) continue; out[t] = levelOf(chunkEase(hgt, land, n, t, km, ny, scale ? scale((t / n) | 0) : 1)); if (roads && roads[t] > out[t]) out[t] = roads[t]; }
  return out;
}
