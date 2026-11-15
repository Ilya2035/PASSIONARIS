// Broken points of the base heights (docs/album/ground.md, «Выбросы в основе высот»).
//
// The base — a point every 230 m — holds a few dozen points that are plainly wrong, nearly all of them on the
// coast: one to four points standing 250 to 3900 m above a flat shore, or 100 to 1000 m under it, right beside
// an islet, a cape or a harbour (they come with the source tiles). Drawn as they are, they were needles and wells
// on the shore; under the fine heights of the mountains, which know the true shore, a well became a dark blue square
// of deep sea beside the islet of Santa Marina and a needle a white shoal around it (the owner, 15.11.2026: «рябь,
// сетка из голубого и синего»).
//
// They are told from real land by what no real land of this scale does:
//   a needle   a point 250 m and more above at least seven of its eight neighbours, in low country (the middle value
//              of the neighbours below 600 m). A crest runs on — two neighbours of a point on it are as high as it
//              is; and a real summit that sharp stands in the high mountains, which are left alone.
//   a well     a point lower than 40 m under the sea and 80 m and more under at least seven of its eight neighbours.
//              (The floor of a gorge or of a strait runs on as well, and a gorge is not under the sea.)
// Such a point takes the middle value of its eight neighbours. They stand in clusters, so the points around a
// mended one are looked at again until nothing changes.
const RAW = m => (m + 8192) * 4;                                    // metres → the number the base holds
export const NEEDLE = 250, NEEDLE_LAND = 600, WELL = 80, WELL_SEA = -40;

// u: the base as it lies in its file (Uint16, metres = v / 4 − 8192), w × h points. Mends it in place; returns how
// many points were mended.
export function despike(u, w, h) {
  const nb = new Float64Array(8), T1 = NEEDLE * 4, T2 = WELL * 4, SEA = RAW(WELL_SEA), LOW = RAW(NEEDLE_LAND);
  // the middle value of the neighbours of a broken point, or −1 for a sound one
  const mend = k => {
    const v = u[k];
    nb[0] = u[k - w - 1]; nb[1] = u[k - w]; nb[2] = u[k - w + 1]; nb[3] = u[k - 1]; nb[4] = u[k + 1]; nb[5] = u[k + w - 1]; nb[6] = u[k + w]; nb[7] = u[k + w + 1];
    nb.sort();
    const mid = Math.round((nb[3] + nb[4]) / 2), needle = v - nb[6] >= T1 && mid < LOW, well = v < SEA && nb[1] - v >= T2;
    return needle || well ? mid : -1;
  };
  let todo = [], fixed = 0;
  // the whole base once, with a cheap test first: a broken point is far above or far below one of its four nearest
  for (let j = 1; j < h - 1; j++) for (let i = 1, k = j * w + 1; i < w - 1; i++, k++) {
    const v = u[k], a = u[k - 1], b = u[k + 1], c = u[k - w], d = u[k + w];
    if (v - Math.min(a, b, c, d) >= T1 || (v < SEA && Math.max(a, b, c, d) - v >= T2)) todo.push(k);
  }
  for (let pass = 0; pass < 8 && todo.length; pass++) {
    const set = [];
    for (const k of todo) { const m = mend(k); if (m >= 0) set.push(k, m); }
    const next = new Set();
    for (let q = 0; q < set.length; q += 2) {
      const k = set[q]; u[k] = set[q + 1]; fixed++;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const n = k + dj * w + di, i = n % w, j = (n - i) / w;
        if (i > 0 && j > 0 && i < w - 1 && j < h - 1) next.add(n);    // (the mended point too: it may still stand out)
      }
    }
    todo = [...next];
  }
  return fixed;
}
