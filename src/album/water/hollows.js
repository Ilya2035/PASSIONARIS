// Hollows below sea level that the sea cannot reach are not sea. The open heights dip under zero here and there along
// river mouths and behind dunes, and each dip used to be drawn as a pond of sea water. Sea is what the water at the
// edge of the map reaches over water; a hollow it cannot reach, of no more than maxCells cells, is raised to dry
// land half a metre high. Larger ones stay: they are lagoons behind bars too narrow for the heights to show.
// raw: the album's heights, Uint16, metres = v / 4 − 8192 (data.js). Changes raw in place; → cells raised.
// This file has no imports: the page and the Node loader both use it.
export function fillHollows(raw, w, h, maxCells = 60) {
  const SEA = 8192 * 4, n = w * h, seen = new Uint8Array(n), stack = [];
  const push = i => { if (!seen[i] && raw[i] < SEA) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) { const i = stack.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  let raised = 0; const comp = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || raw[s] >= SEA) continue;
    comp.length = 0; comp.push(s); seen[s] = 1;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % w;
      if (x > 0 && !seen[i - 1] && raw[i - 1] < SEA) { seen[i - 1] = 1; comp.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && raw[i + 1] < SEA) { seen[i + 1] = 1; comp.push(i + 1); }
      if (i >= w && !seen[i - w] && raw[i - w] < SEA) { seen[i - w] = 1; comp.push(i - w); }
      if (i < n - w && !seen[i + w] && raw[i + w] < SEA) { seen[i + w] = 1; comp.push(i + w); }
    }
    if (comp.length <= maxCells) { for (const i of comp) raw[i] = SEA + 2; raised += comp.length; }
  }
  return raised;
}

// Far inland a deep basin below sea level is no water at all, whatever its size. The chotts of the Sahara lie below
// the sea — Chott Melrhir, 7 600 km² of it, Chott el Gharsa — and are salt flats, dry for most of the year; by the
// heights alone they would be drawn as a sea in the middle of the desert. A hollow below zero that the sea cannot
// reach is such a basin when
//   • no water of the sea lies within `far` cells of the box it lies in, and
//   • its lowest point is `deep` metres below the sea or more (a true depression, not a fen or a mere a metre or two
//     under the sea — those are left to whoever knows what they are);
// and so is a hollow far from the sea that lies within `far` cells of a basin: the smaller flats beside a chott.
// A basin is raised to dry land half a metre high. A lagoon behind its bar lies by the sea and stays as it is
// (fillHollows above decides about the small ones).
// far: 160 cells are 40 km on the base heights of the album (a cell is about 250 m there).
// For the base heights of a stage when they are put together, after fillHollows. Changes raw in place; → cells raised.
export function dryBasins(raw, w, h, far = 160, deep = 8) {
  const SEA = 8192 * 4, n = w * h, seen = new Uint8Array(n), stack = [];   // seen: 1 the sea, 2 a hollow looked at
  const push = i => { if (!seen[i] && raw[i] < SEA) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) { const i = stack.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  const inland = [];                     // the hollows far from the sea: { cells, box, low, dry }
  for (let s = 0; s < n; s++) {
    if (seen[s] || raw[s] >= SEA) continue;
    const comp = [s]; seen[s] = 2; let x0 = w, x1 = 0, y0 = h, y1 = 0, low = SEA;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (raw[i] < low) low = raw[i];
      if (x > 0 && !seen[i - 1] && raw[i - 1] < SEA) { seen[i - 1] = 2; comp.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && raw[i + 1] < SEA) { seen[i + 1] = 2; comp.push(i + 1); }
      if (i >= w && !seen[i - w] && raw[i - w] < SEA) { seen[i - w] = 2; comp.push(i - w); }
      if (i < n - w && !seen[i + w] && raw[i + w] < SEA) { seen[i + w] = 2; comp.push(i + w); }
    }
    // is there water of the sea within `far` cells of the box of the hollow?
    const ax = Math.max(0, x0 - far), bx = Math.min(w - 1, x1 + far), ay = Math.max(0, y0 - far), by = Math.min(h - 1, y1 + far); let near = false;
    for (let y = ay; y <= by && !near; y++) for (let i = y * w + ax, e = y * w + bx; i <= e; i++) if (seen[i] === 1) { near = true; break; }
    if (!near) inland.push({ cells: comp, x0, x1, y0, y1, dry: low <= SEA - deep * 4 });
  }
  // the flats beside a basin: far from the sea and within `far` cells of a basin (box to box), again and again
  for (let more = true; more;) {
    more = false;
    for (const c of inland) { if (c.dry) continue;
      if (inland.some(b => b.dry && c.x0 - far <= b.x1 && c.x1 + far >= b.x0 && c.y0 - far <= b.y1 && c.y1 + far >= b.y0)) { c.dry = true; more = true; } }
  }
  let raised = 0;
  for (const c of inland) if (c.dry) { for (const i of c.cells) raw[i] = SEA + 2; raised += c.cells.length; }
  return raised;
}
