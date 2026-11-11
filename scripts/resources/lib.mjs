// Passionaris — natural resources: shared, browser-safe code (no Node imports).
// Used by the bake (scripts/resources/bake.mjs), the tests and the album's «Ресурсы» mode.
// The resource list and every rule are described in docs/RESOURCES.md.

// ------------------------------------------------------------------ resources
// depth: 0 — на поверхности, видно сразу; 1 — неглубоко, находится простой разведкой; 2 — глубоко, нужна разведка
// с техникой. era: с какой эпохи ресурс можно добывать (годы; отрицательные — до н. э.).
// color: цвет режима карты — средней яркости, чтобы читался и на светлой «бумаге», и на натуральной земле.
export const RESOURCES = [
  { id: 'fish',     name: 'Рыба',                 kind: 'renewable', depth: 0, era: -5000, color: '#2f78b0' },
  { id: 'wood',     name: 'Лес',                  kind: 'renewable', depth: 0, era: -5000, color: '#2e7a34' },
  { id: 'stone',    name: 'Камень',               kind: 'common',    depth: 0, era: -5000, color: '#6c665c' },
  { id: 'rarestone', name: 'Редкий камень',       kind: 'deposit',   depth: 0, era: -5000, color: '#7a5c8c' },
  { id: 'gems',     name: 'Драгоценные камни',    kind: 'deposit',   depth: 1, era: -5000, color: '#b0307e' },
  { id: 'clay',     name: 'Глина',                kind: 'common',    depth: 0, era: -5000, color: '#b0602e' },
  { id: 'salt',     name: 'Соль',                 kind: 'deposit',   depth: 0, era: -5000, color: '#2e9a96' },
  { id: 'coal',     name: 'Уголь',                kind: 'deposit',   depth: 2, era: 1200,  color: '#2c2c30' },
  { id: 'bogiron',  name: 'Болотное железо',      kind: 'deposit',   depth: 0, era: -1200, color: '#8a5a22' },
  { id: 'iron',     name: 'Железная руда',        kind: 'deposit',   depth: 1, era: -1000, color: '#8a3626' },
  { id: 'copper',   name: 'Медь',                 kind: 'deposit',   depth: 1, era: -5000, color: '#c0602a' },
  { id: 'tin',      name: 'Олово',                kind: 'deposit',   depth: 1, era: -3000, color: '#4e7484' },
  { id: 'lead',     name: 'Свинец',               kind: 'deposit',   depth: 1, era: -3500, color: '#4a4e72' },
  { id: 'silver',   name: 'Серебро',              kind: 'deposit',   depth: 1, era: -3000, color: '#5a82aa' },
  { id: 'gold',     name: 'Золото',               kind: 'deposit',   depth: 1, era: -5000, color: '#c8961a' },
  { id: 'mercury',  name: 'Ртуть',                kind: 'deposit',   depth: 1, era: -5000, color: '#b02828' },
  { id: 'oil',      name: 'Нефть',                kind: 'deposit',   depth: 2, era: 1850,  color: '#1c1c26' },
  { id: 'gas',      name: 'Газ',                  kind: 'deposit',   depth: 2, era: 1900,  color: '#2a6ab0' },
];
export const RES_INDEX = Object.fromEntries(RESOURCES.map((r, k) => [r.id, k]));
export const DEPTH_NAMES = ['на поверхности', 'неглубоко', 'глубоко'];

// ------------------------------------------------------------------ chunk grid of the album
// Flat kilometres: x = lon · 111.195 · cos 40°, y = lat · 111.195; chunk (i, j) = (floor(x / 10), floor(y / 10)).
export const KM_PER_DEG = 111.195;
export const COS_REF = Math.cos(40 * Math.PI / 180);
export const CHUNK_KM = 10;
export const chunkI = lon => Math.floor(lon * KM_PER_DEG * COS_REF / CHUNK_KM);
export const chunkJ = lat => Math.floor(lat * KM_PER_DEG / CHUNK_KM);
export const chunkOf = (lat, lon) => ({ i: chunkI(lon), j: chunkJ(lat) });
// centre (or any point with fx, fy ∈ [0, 1) inside) of chunk (i, j)
export const chunkLon = (i, fx = 0.5) => (i + fx) * CHUNK_KM / (KM_PER_DEG * COS_REF);
export const chunkLat = (j, fy = 0.5) => (j + fy) * CHUNK_KM / KM_PER_DEG;
// The album's chunk grid — the same as CN, CI0, CJ0 in src/album/chunks.js (docs/ALBUM-CHUNKS.md):
// 128 × 128 chunks from chunk (−88, 388); chunk number k = (j − 388) · 128 + (i + 88).
export const ALBUM_GRID = { kind: 'chunks', i0: -88, j0: 388, W: 128, H: 128, chunkKm: CHUNK_KM };
// the grid that covers a lon/lat box
export function gridForBox(b) {
  const i0 = chunkI(b.lon0), i1 = chunkI(b.lon1), j0 = chunkJ(b.lat0), j1 = chunkJ(b.lat1);
  return { kind: 'chunks', i0, j0, W: i1 - i0 + 1, H: j1 - j0 + 1, chunkKm: CHUNK_KM };
}

// ------------------------------------------------------------------ table
// A table: meta (the .json) + bytes (the gunzipped .bin). Layout of the bytes, per meta.layers:
//   amount: Uint16 little-endian [R][H][W]   — units of each resource in each cell (see docs/RESOURCES.md)
//   depth:  Uint8 [R][H][W]                  — 0/1/2 depth of what lies there (255 where nothing)
// Cell index = row · W + col; for the chunk grid row = j − j0, col = i − i0 (row 0 = southmost).
export function openTable(meta, bytes) {
  const R = meta.resources.length, N = meta.grid.W * meta.grid.H;
  if (bytes.byteLength !== N * R * 3) throw new Error(`resources table: ${bytes.byteLength} bytes, expected ${N * R * 3}`);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const amount = new Uint16Array(buf, 0, N * R);
  const depth = new Uint8Array(buf, N * R * 2, N * R);
  const ri = Object.fromEntries(meta.resources.map((r, k) => [r.id, k]));
  const g = meta.grid;
  const cell = (i, j) => (i < g.i0 || j < g.j0 || i >= g.i0 + g.W || j >= g.j0 + g.H) ? -1 : (j - g.j0) * g.W + (i - g.i0);
  return {
    meta, amount, depth, R, N, index: ri, cell,
    get(res, i, j) { const c = cell(i, j); return c < 0 ? 0 : amount[ri[res] * N + c]; },
    getDepth(res, i, j) { const c = cell(i, j); return c < 0 ? 255 : depth[ri[res] * N + c]; },
    layer(res) { return amount.subarray(ri[res] * N, (ri[res] + 1) * N); },
  };
}

// ------------------------------------------------------------------ reproducible randomness
// 32-bit hash of integers (seed, a, b, c) → uint32; pure function, same on every machine.
export function hash32(seed, a = 0, b = 0, c = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h;
}
export const hash01 = (seed, a, b, c) => hash32(seed, a, b, c) / 4294967296;
// stable number for a string id
export function strHash(s) {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

// ------------------------------------------------------------------ «место известно неточно»
// A zone lists candidate cells and their weights (0..255). Three kinds:
//   rich  — every candidate holds the resource; the seed decides how rich: amount · weight / 255 · (0.25 … 1.75),
//           1 on average (bog iron: every iron-bearing mire of the swamp aspect has some, but which is richer is unknown);
//   field — every candidate independently becomes a deposit with chance · weight / 255 (flint in chalk, obsidian…);
//   zone  — exactly `pieces` deposits among the candidates, chosen with probability ∝ weight (a deposit known only by
//           its region: imprecise coordinates, a basin around known fields…). The zone's amount is split evenly.
// Placement depends only on (world seed, zone id, cell), so it is the same on every run for the same seed.
export function scatterZone(zone, seed) {
  const zh = strHash(zone.id), out = [];
  if (zone.kind === 'rich') {
    for (let k = 0; k < zone.cells.length; k++) {
      const f = 0.25 + 1.5 * hash01(seed, zh, zone.cells[k], 3);
      out.push({ cell: zone.cells[k], amount: Math.max(1, Math.round(zone.amount * zone.weights[k] / 255 * f)) });
    }
  } else if (zone.kind === 'field') {
    for (let k = 0; k < zone.cells.length; k++) {
      const p = zone.chance * zone.weights[k] / 255;
      if (hash01(seed, zh, zone.cells[k], 1) < p) out.push({ cell: zone.cells[k], amount: zone.amount });
    }
  } else {
    // weighted sampling without replacement: key = u^(1/w), take the largest (Efraimidis & Spirakis)
    const keyed = [];
    for (let k = 0; k < zone.cells.length; k++) {
      const w = zone.weights[k];
      if (w <= 0) continue;
      const u = Math.max(1e-12, hash01(seed, zh, zone.cells[k], 2));
      keyed.push([Math.log(u) / w, zone.cells[k]]);
    }
    keyed.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const n = Math.min(zone.pieces, keyed.length);
    const each = n ? Math.max(1, Math.round(zone.amount / n)) : 0;
    for (let k = 0; k < n; k++) out.push({ cell: keyed[k][1], amount: each });
  }
  return out;
}

// Table amounts plus every zone placed with this seed. Returns a new Uint16Array [R][N] and the placed list.
export function withZones(table, zones, seed) {
  const amount = new Uint16Array(table.amount), depth = new Uint8Array(table.depth), placed = [];
  for (const z of zones) {
    const r = table.index[z.res];
    if (r === undefined) continue;
    for (const p of scatterZone(z, seed)) {
      const k = r * table.N + p.cell;
      amount[k] = Math.min(65535, amount[k] + p.amount);
      depth[k] = Math.min(depth[k], z.depth);
      placed.push({ zone: z.id, res: z.res, cell: p.cell, amount: p.amount, depth: z.depth });
    }
  }
  return { amount, depth, placed };
}

// Sum of every resource over a set of cells (a district). Returns { res: units }.
export function sumCells(amount, N, cells, resources = RESOURCES) {
  const out = {};
  resources.forEach((r, k) => {
    let s = 0;
    for (const c of cells) s += amount[k * N + c];
    out[r.id] = s;
  });
  return out;
}
