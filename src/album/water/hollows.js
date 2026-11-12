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
