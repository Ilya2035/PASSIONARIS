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

// Pockets (docs/album/ground.md, «Ямы в лагунах»). The base also holds pits of another kind: a few dozen to a few
// hundred points 15 to 40 m under the sea in the middle of a lagoon a metre deep, or of the land beside it — the
// lagoons of the Camargue are full of them. They are too wide for despike() and the sea reaches them over the
// shallows, so fillHollows() of the water leaves them. Drawn, they were dark blue squares in pale water (the lead
// on v0.6.114, at the mouth of the Rhône).
// A pocket is water deeper than POCKET that the open sea — the deep water touching the edge of the base — does not
// reach through water as deep and wide enough (the neck, below). A pocket of no more than POCKET_MAX points takes the middle height of the ring of
// points around it — the depth of its lagoon — and is never left shallower than POCKET_FLOOR: where land is what
// lies around (the pit IS the lagoon, as the heights hold it), it stays water, a metre and a half deep. Whether such
// a patch of water is a pond to be dried or a lagoon is the water's own rule, fillHollows(), which runs next; what
// is land and what is water this function never changes. A real basin behind a shallow sill (a lagoon 10 m deep)
// becomes level at 5 m, which is how it is seen from above anyway; larger ones (none in the polygon of Iberia)
// are left.
// (The neck. On the base of stage 3 the largest pit of the Camargue — 324 points down to −54 m in the shallows of the
// Gulf of Beauduc — hangs on the open sea by a thread of deep points one or two wide, so the sea «reached» it and
// it stayed: a dark blue square at the shore (w3-roads, 16.11.2026). The sea now reaches only through deep water at
// least 2 · POCKET_NECK + 1 points wide — 670 m. What it cannot reach so is a pocket: the pits, and with them the
// deep of a narrow harbour or of a cove two points wide, which becomes as shallow as the water around it.)
export const POCKET = -5, POCKET_FLOOR = -1.5, POCKET_MAX = 3000, POCKET_NECK = 1;
// u, w, h: as for despike(). Mends in place; returns how many points were mended.
export function mendPockets(u, w, h, maxPoints = POCKET_MAX, neck = POCKET_NECK) {
  const D = RAW(POCKET), FLOOR = RAW(POCKET_FLOOR), n = w * h, seen = new Uint8Array(n), stack = [];
  // wide: a deep point with nothing but deep points within `neck` of it (beyond the edge of the base lies the sea).
  // The open sea is what the edge of the base reaches over such points, and `neck` points of deep water around that.
  let wide = null;
  if (neck > 0) {
    const row = new Uint8Array(n); wide = new Uint8Array(n);
    for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) { let ok = 1; for (let d = -neck; d <= neck; d++) { const X = x + d; if (X >= 0 && X < w && u[k + d] >= D) { ok = 0; break; } } row[k] = ok; }
    for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) { let ok = 1; for (let d = -neck; d <= neck; d++) { const Y = y + d; if (Y >= 0 && Y < h && !row[k + d * w]) { ok = 0; break; } } wide[k] = ok; }
  }
  const push = i => { if (!seen[i] && (wide ? wide[i] : u[i] < D)) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) { const i = stack.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  // (the sea takes back its own rim of deep water: step by step, each step from the points of the steps before it)
  for (let step = 1; step <= neck; step++) for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) {
    if (seen[k] || u[k] >= D) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) { const Y = y + dy; if (Y < 0 || Y >= h) continue; for (let dx = -1; dx <= 1; dx++) { const X = x + dx; if (X < 0 || X >= w) continue; const v = seen[Y * w + X]; if (v && v <= step) { near = true; break; } } }
    if (near) seen[k] = step + 1;
  }
  let mended = 0; const comp = [], rim = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || u[s] >= D) continue;
    comp.length = 0; rim.length = 0; comp.push(s); seen[s] = 1;
    const look = m => { if (u[m] >= D) rim.push(u[m]); else if (!seen[m]) { seen[m] = 1; comp.push(m); } };
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % w;
      if (x > 0) look(i - 1); if (x < w - 1) look(i + 1); if (i >= w) look(i - w); if (i < n - w) look(i + w);
    }
    if (comp.length > maxPoints || !rim.length) continue;
    rim.sort((a, b) => a - b);
    const mid = Math.min(rim[rim.length >> 1], FLOOR);
    for (const i of comp) u[i] = mid;
    mended += comp.length;
  }
  return mended;
}

// Dry land below the sea (docs/album/ground.md, «Суша ниже моря»). The shaders and the chunks take whatever lies
// below zero for water. But there is land below the sea: the chotts of the Maghreb (Melrhir, 40 m under it), the
// polders of Holland. Drawn from the heights alone, a chott was a blue lake in the desert and Holland a bay.
// What is land is not in the heights; it is in the mask of the worked land (worked.js: 1 land, 2 its water).
// So this step is for the script that bakes the base, which has the mask: every point at or below the sea that the
// mask calls land is raised to DRY_LAND metres. It is asked of INNER land only — a square of the mask all of whose
// eight neighbours are land too: the mask is drawn by squares of a kilometre, and on the coast itself the shore
// stays where the heights put it, or it would run in steps of the mask.
//   u, w, h: as for despike();  innerLand(k, i, j) → true for a point (index k, column i, row j) on inner land
// Mends in place; returns how many points were raised. Run it after mendPockets() and before fillHollows(): a pit
// in a chott is a pocket first, and what is left below zero inside the land after this step is a real lake.
// DRY_LAND is 2.5 m and not lower (16.11.2026; it was 1 m): lifted land must be land like any other, and two rules of
// the map take low ground for the edge of the water. The shore lets no tree stand below 1.2 m (aspects/water.js,
// aspShore), the fields of a settlement fade out below 2 m (aspects/settle.js) — at 1 m every village of Holland,
// Flanders and the marshes stood as a bare pale square of 1 km² on level grass, with no field and no wood about it.
// A multiple of .25 m, the step of the base: the number is stored exactly, and the swamps know lifted land by it
// (aspects/swamp.js, naturalSwamp). Whoever lifts land takes the number from here — one height for all of it.
export const DRY_LAND = 2.5;
export function liftDryLand(u, w, h, innerLand) {
  const SEA = RAW(0), UP = RAW(DRY_LAND); let n = 0;
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) if (u[k] <= SEA && innerLand(k, i, j)) { u[k] = UP; n++; }
  return n;
}
// innerLand for a mask of the worked land: at(lat, lon) → 0 the world, 1 land, 2 water (worked.js), stepKm the side of
// its squares; llOf(i, j) → [lat, lon] of a point of the base. A point is on inner land when its square of the mask
// and the eight around it are all land.
export function innerLandOf(at, llOf, stepKm = 1) {
  const dLat = stepKm / 111.195;
  return (k, i, j) => {
    const [lat, lon] = llOf(i, j), dLon = stepKm / (111.195 * Math.cos(40 * Math.PI / 180));   // (the plane of the chunks: the scale of 40° N)
    if (at(lat, lon) !== 1) return false;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if ((a || b) && at(lat + b * dLat, lon + a * dLon) !== 1) return false;
    return true;
  };
}
