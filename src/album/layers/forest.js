// The trees with volume that used to stand here are gone (13.11.2026). The owner, 13.11.2026: from the height of the map
// single trees were of the wrong size and of another colour than the forest painted under them. The forest is now one
// soft cover with height, painted by the ground shader (aspects/forest.js, docs/album/forest.md), and it costs less.
//
// What other parts asked of this file stays answered:
//   album.layers.forest.top    how high the tallest crown stands above the ground right now, km. Nothing stands on the
//                              land any more, so it is always 0 (set in aspects/forest.js). Ask this one.
//   treeTop(h, size)           the old rule of the 3D trees, kept as it was for those who still count with it (the
//                              sheets of water fall back on it before the layers run). It no longer describes
//                              anything that is drawn.
export const K0 = .0045;         // spacing of the old trees, km per km of camera height
export const CROWN = .62;        // width of a full-grown crown as a share of the spacing
const SIZE = [.62, .5, .36, 1.08], SPIRE_TOP = 1.5 * 1.25;
export function treeTop(h, size = 1) {
  return h < 170 ? K0 * h * CROWN * size * (SIZE[0] + SIZE[1]) * SIZE[3] * SPIRE_TOP * Math.min(1, (170 - h) / 50) : 0;
}
