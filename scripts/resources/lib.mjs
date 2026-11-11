// Passionaris — natural resources: shared, browser-safe code (no Node imports).
// Used by the bake (scripts/resources/bake.mjs), the tests and the album's «Ресурсы» mode.
// The resource list and every rule are described in docs/RESOURCES.md.

// ------------------------------------------------------------------ resources
// The owner's list of base raw materials (docs/RESOURCES.md, «Список сырья»), 52 kinds, no alloys or refined products.
// unit:  the real unit of the stock — 't' tonnes (metals: tonnes of the metal itself), 'kg', 'l' litres, 'm3';
//        stocks are whole numbers in that unit (metric only).
// group: живое | вода | стройка | драгоценное | древние металлы | промышленные металлы | ядерное | химия | топливо
// kind:  'living' — a stock that moves and breeds: it belongs to a sea or a province, not to a chunk (pool);
//        'flow'   — renews every year (fresh water, timber regrowth); 'common' — ground that is almost everywhere;
//        'deposit' — a finite deposit.
// depth: 0 — на поверхности, видно сразу; 1 — неглубоко, находится простой разведкой; 2 — глубоко, нужна разведка
//        с техникой. era: с какого года ресурс можно добывать (отрицательные — до н. э.).
// color: цвет режима карты — средней яркости, чтобы читался и на светлой «бумаге», и на натуральной земле.
const R = (id, name, en, unit, group, kind, depth, era, color, extra = {}) => ({ id, name, en, unit, group, kind, depth, era, color, ...extra });
export const RESOURCES = [
  // живое и вода
  R('fish', 'Рыба', 'Fish', 't', 'живое', 'living', 0, -5000, '#2f78b0', { pool: 'sea' }),
  R('seamammals', 'Морской зверь', 'Marine mammals', 't', 'живое', 'living', 0, -3000, '#3a5f8a', { pool: 'sea' }),
  R('game', 'Дичь', 'Game', 't', 'живое', 'living', 0, -5000, '#8a6a3a', { pool: 'province' }),
  R('wood', 'Лес', 'Timber', 'm3', 'живое', 'common', 0, -5000, '#2e7a34'),
  R('water', 'Пресная вода', 'Fresh water', 'm3', 'вода', 'flow', 0, -5000, '#3a9ac8'),
  // стройка
  R('stone', 'Камень', 'Building stone', 't', 'стройка', 'common', 0, -5000, '#6c665c'),
  R('limestone', 'Известняк и мел', 'Limestone and chalk', 't', 'стройка', 'common', 0, -5000, '#a8a070'),
  R('clay', 'Глина', 'Clay', 't', 'стройка', 'common', 0, -5000, '#b0602e'),
  R('kaolin', 'Каолин', 'Kaolin', 't', 'стройка', 'deposit', 1, 600, '#c8a0a0'),
  R('sand', 'Песок и гравий', 'Sand and gravel', 't', 'стройка', 'common', 0, -5000, '#c09050'),
  R('quartz', 'Кварцевый песок', 'Silica sand', 't', 'стройка', 'deposit', 0, -2500, '#8ab0b8'),
  R('gypsum', 'Гипс и алебастр', 'Gypsum', 't', 'стройка', 'deposit', 1, -5000, '#b8a8c0'),
  R('marble', 'Мрамор и облицовочный камень', 'Marble and dimension stone', 't', 'стройка', 'deposit', 1, -3000, '#7a5c8c'),
  R('flint', 'Кремень и обсидиан', 'Flint and obsidian', 't', 'стройка', 'deposit', 0, -5000, '#4a4a5a'),
  // драгоценное
  R('gems', 'Драгоценные камни', 'Gemstones', 'kg', 'драгоценное', 'deposit', 1, -5000, '#b0307e'),
  R('ornamental', 'Поделочные камни', 'Ornamental stones', 'kg', 'драгоценное', 'deposit', 1, -5000, '#c07a30'),
  R('gold', 'Золото', 'Gold', 'kg', 'драгоценное', 'deposit', 1, -5000, '#c8961a'),
  R('silver', 'Серебро', 'Silver', 'kg', 'драгоценное', 'deposit', 1, -3000, '#5a82aa'),
  R('platinum', 'Платина и платиноиды', 'Platinum group metals', 'kg', 'драгоценное', 'deposit', 2, 1750, '#7a8a9a'),
  // металлы древности
  R('copper', 'Медь', 'Copper', 't', 'древние металлы', 'deposit', 1, -5000, '#c0602a'),
  R('tin', 'Олово', 'Tin', 't', 'древние металлы', 'deposit', 1, -3000, '#4e7484'),
  R('lead', 'Свинец', 'Lead', 't', 'древние металлы', 'deposit', 1, -3500, '#4a4e72'),
  R('zinc', 'Цинк', 'Zinc', 't', 'древние металлы', 'deposit', 1, -100, '#6a7a6a'),
  R('mercury', 'Ртуть', 'Mercury', 't', 'древние металлы', 'deposit', 1, -5000, '#b02828'),
  R('iron', 'Железо', 'Iron', 't', 'древние металлы', 'deposit', 1, -1200, '#8a3626'),
  // металлы промышленности
  R('manganese', 'Марганец', 'Manganese', 't', 'промышленные металлы', 'deposit', 1, 1850, '#8a4a6a'),
  R('chromium', 'Хром', 'Chromium', 't', 'промышленные металлы', 'deposit', 1, 1890, '#3a7a5a'),
  R('nickel', 'Никель', 'Nickel', 't', 'промышленные металлы', 'deposit', 1, 1850, '#5a8a4a'),
  R('cobalt', 'Кобальт', 'Cobalt', 't', 'промышленные металлы', 'deposit', 1, -1500, '#2a4ab0'),
  R('tungsten', 'Вольфрам', 'Tungsten', 't', 'промышленные металлы', 'deposit', 1, 1900, '#5a5a6a'),
  R('molybdenum', 'Молибден', 'Molybdenum', 't', 'промышленные металлы', 'deposit', 2, 1900, '#6a6a8a'),
  R('aluminium', 'Алюминий (бокситы)', 'Aluminium (bauxite)', 't', 'промышленные металлы', 'deposit', 0, 1890, '#b06a50'),
  R('titanium', 'Титан', 'Titanium', 't', 'промышленные металлы', 'deposit', 0, 1950, '#7a8a8a'),
  R('magnesium', 'Магний', 'Magnesium', 't', 'промышленные металлы', 'deposit', 1, 1900, '#9a9aaa'),
  R('lithium', 'Литий', 'Lithium', 't', 'промышленные металлы', 'deposit', 1, 1950, '#a0a0c8'),
  R('ree', 'Редкоземельные металлы', 'Rare earth elements', 't', 'промышленные металлы', 'deposit', 1, 1950, '#8a6aa8'),
  R('raremetals', 'Редкие металлы', 'Rare metals (Ta, Nb, Be, Ga, Ge, In)', 't', 'промышленные металлы', 'deposit', 1, 1950, '#6a8aa8'),
  // ядерное
  R('uranium', 'Уран', 'Uranium', 't', 'ядерное', 'deposit', 2, 1940, '#6a9a2a'),
  R('thorium', 'Торий', 'Thorium', 't', 'ядерное', 'deposit', 1, 1950, '#8aa04a'),
  // химическое сырьё
  R('salt', 'Соль', 'Salt', 't', 'химия', 'deposit', 0, -5000, '#2e9a96'),
  R('potash', 'Калийные соли', 'Potash', 't', 'химия', 'deposit', 2, 1860, '#c86a8a'),
  R('phosphate', 'Фосфаты', 'Phosphate rock', 't', 'химия', 'deposit', 1, 1850, '#9a8a4a'),
  R('nitrate', 'Селитра', 'Nitrates', 't', 'химия', 'deposit', 0, 1300, '#c8c0a0'),
  R('sulfur', 'Сера', 'Sulfur', 't', 'химия', 'deposit', 1, -1000, '#c8b020'),
  R('borates', 'Бораты и природная сода', 'Borates and soda ash', 't', 'химия', 'deposit', 0, 800, '#a0b8a0'),
  R('fluorite', 'Плавиковый шпат', 'Fluorspar', 't', 'химия', 'deposit', 1, 1500, '#8a5ab0'),
  R('graphite', 'Графит', 'Graphite', 't', 'химия', 'deposit', 1, 1550, '#3a3a3a'),
  // топливо
  R('peat', 'Торф', 'Peat', 't', 'топливо', 'deposit', 0, -1000, '#6a4a2a'),
  R('coal', 'Уголь', 'Coal', 't', 'топливо', 'deposit', 2, 1200, '#2c2c30'),
  R('oil', 'Нефть', 'Oil (with bitumen and oil shale)', 'l', 'топливо', 'deposit', 2, -3000, '#1c1c26'),
  R('gas', 'Газ', 'Natural gas', 'm3', 'топливо', 'deposit', 2, 1900, '#2a6ab0'),
  R('helium', 'Гелий', 'Helium', 'm3', 'топливо', 'deposit', 2, 1910, '#c0a0c8'),
];
export const UNIT_NAMES = { t: 'т', kg: 'кг', l: 'л', m3: 'м³' };
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
// A table: meta (the .json) + bytes (the gunzipped .bin), format 2. Layout of the bytes:
//   amount: Uint32 little-endian [R][H][W]  × meta.resources[r].scale = the real amount in meta.resources[r].unit
//   depth:  Uint8 [R][H][W]                 — 0/1/2 depth of what lies there (255 where nothing)
// Cell index = row · W + col; for the chunk grid row = j − j0, col = i − i0 (row 0 = southmost).
// table.amount holds the real amounts (whole numbers in the resource's unit) as Float64.
export function openTable(meta, bytes) {
  const R = meta.resources.length, N = meta.grid.W * meta.grid.H;
  if (bytes.byteLength !== N * R * 5) throw new Error(`resources table: ${bytes.byteLength} bytes, expected ${N * R * 5}`);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const u32 = new Uint32Array(buf, 0, N * R);
  const depth = new Uint8Array(buf, N * R * 4, N * R);
  const amount = new Float64Array(N * R);
  meta.resources.forEach((r, k) => { const s = r.scale ?? 1; for (let c = 0; c < N; c++) amount[k * N + c] = u32[k * N + c] * s; });
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

// The owner's 0–100 scale (docs/RESOURCES.md): 100 = the richest 100 km² of the world for this resource (ref100);
// a place gets its share of that, a whole number; anything there at all is at least 1.
export function index100(amount, ref100, areaKm2 = 100) {
  if (!(amount > 0)) return 0;
  return Math.max(1, Math.min(100, Math.round(100 * amount / (areaKm2 / 100) / ref100)));
}
// how a whole number reads: 12 300 000 → «12,3 млн»
export function fmtAmount(v, unit) {
  const u = UNIT_NAMES[unit] ?? unit;
  const steps = [[1e12, 'трлн'], [1e9, 'млрд'], [1e6, 'млн'], [1e3, 'тыс.']];
  for (const [d, w] of steps) if (v >= d) return `${(v / d).toFixed(v >= 10 * d ? 0 : 1).replace('.', ',')} ${w} ${u}`;
  return `${Math.round(v)} ${u}`;
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
  // the same kind of array as the table: Uint16 for the baked table, Float32 for the amounts spread over chunks
  const amount = new table.amount.constructor(table.amount), depth = new Uint8Array(table.depth), placed = [];
  const cap = amount instanceof Uint16Array ? 65535 : Infinity;
  for (const z of zones) {
    const r = table.index[z.res];
    if (r === undefined) continue;
    for (const p of scatterZone(z, seed)) {
      const k = r * table.N + p.cell;
      amount[k] = Math.min(cap, amount[k] + p.amount);
      depth[k] = Math.min(depth[k], z.depth);
      placed.push({ zone: z.id, res: z.res, cell: p.cell, amount: p.amount, depth: z.depth });
    }
  }
  return { amount, depth, placed };
}

// ------------------------------------------------------------------ natural chunks of the album
// The table is baked on the 10 km squares of the album grid; the album's chunks have natural outlines
// (src/album/chunks.js, docs/ALBUM-CHUNKS.md «Форма чанков»). g describes them:
//   { count, kind: 1 land / 0 water per chunk, cell: chunk of every texel of the fine raster (row 0 = south),
//     FN: texels per side, sub: texels per square side, at(lat, lon) → chunk or −1 }
// What a square holds besides its known deposits (fish, wood, stone, clay, salt pans) goes to the chunks of its
// texels, split evenly among them: fish among its texels in water chunks (in land chunks when the square has no water —
// river fish), everything else among its texels in land chunks (in water chunks when it has no land). Known deposits go
// to the chunk under their coordinates. Totals are kept. Returns a table-like object for withZones().
// share of a deposit that goes to its neighbours, by size class (trace, small, medium, large, giant)
export const SPREAD = [0, 0, 0.25, 0.4, 0.55];
export function spreadToChunks(table, meta, g) {
  const R = table.R ?? meta.resources.length, N = table.N, SW = meta.grid.W, n = g.count;
  const area = Float32Array.from(table.amount);
  for (const d of meta.deposits) { const k = table.index[d.res] * N + d.cell; area[k] = Math.max(0, area[k] - d.amount); }
  const nL = new Uint16Array(N), nW = new Uint16Array(N), sq = new Int32Array(g.FN * g.FN);
  for (let ty = 0, t = 0; ty < g.FN; ty++) for (let tx = 0; tx < g.FN; tx++, t++) {
    const s = Math.floor(ty / g.sub) * SW + Math.floor(tx / g.sub);
    sq[t] = s;
    if (g.kind[g.cell[t]]) nL[s]++; else nW[s]++;
  }
  const fish = table.index.fish;
  const amount = new Float32Array(R * n), depth = new Uint8Array(R * n).fill(255);
  for (let t = 0; t < sq.length; t++) {
    const s = sq[t], k = g.cell[t], land = !!g.kind[k];
    for (let r = 0; r < R; r++) {
      const v = area[r * N + s];
      if (!v) continue;
      const water = r === fish ? nW[s] > 0 : nL[s] === 0;   // which texels of the square take it
      if (land === water) continue;
      amount[r * n + k] += v / (water ? nW[s] : nL[s]);
      depth[r * n + k] = 0;
    }
  }
  // Known deposits: in the chunk under their coordinates; a medium or bigger one also spreads gently into the
  // neighbouring chunks (by the length of the shared border), so the map has no «100 next to 0» (owner's rule).
  const at = [];
  const add = (r, k, v, d) => { amount[r * n + k] += v; depth[r * n + k] = Math.min(depth[r * n + k], d); };
  for (const d of meta.deposits) {
    const k = g.at(d.lat, d.lon), r = table.index[d.res];
    at.push(k);
    if (k < 0) continue;
    const share = g.links ? SPREAD[d.cls ?? 0] ?? 0 : 0;
    const sea = d.res === 'oil' || d.res === 'gas' || d.res === 'helium';
    const nb = share ? g.links[k].filter(l => sea || g.kind[l.k] === g.kind[k]) : [];
    const border = nb.reduce((t, l) => t + l.km, 0);
    if (!border) { add(r, k, d.amount, d.depth); continue; }
    add(r, k, d.amount * (1 - share), d.depth);
    for (const l of nb) add(r, l.k, d.amount * share * l.km / border, d.depth);
  }
  return { amount, depth, index: table.index, N: n, R, depositChunk: at };
}

// Zones from squares to chunks: a chunk is a candidate when any texel of it lies in a candidate square, with the
// largest weight of those squares. Land resources take land chunks only; oil and gas may lie under the sea.
export function zonesToChunks(zones, meta, g) {
  const SW = meta.grid.W, out = [];
  for (const z of zones) {
    const sea = z.res === 'oil' || z.res === 'gas' || z.res === 'fish', w = new Map();
    z.cells.forEach((s, q) => {
      const x0 = (s % SW) * g.sub, y0 = Math.floor(s / SW) * g.sub;
      for (let y = y0; y < y0 + g.sub; y++) for (let x = x0; x < x0 + g.sub; x++) {
        const k = g.cell[y * g.FN + x];
        if (!sea && !g.kind[k]) continue;
        if ((w.get(k) ?? 0) < z.weights[q]) w.set(k, z.weights[q]);
      }
    });
    const cells = [...w.keys()].sort((a, b) => a - b);
    if (cells.length) out.push({ ...z, cells, weights: cells.map(k => w.get(k)) });
  }
  return out;
}

// Living stocks (fish, marine mammals, game) move and breed: they belong to a sea or a province, not to a chunk
// (docs/RESOURCES.md). The chunks keep where they live; this sums them into their pools.
//   poolOf(resource, k) → a pool key ('sea:3', 'province:12') or null while the chunk has no sea or province yet
// Returns Map(key → { res: tonnes }). The day the division work gives seas and provinces, only poolOf changes.
export function poolStocks(amount, n, poolOf, resources = RESOURCES) {
  const pools = new Map();
  resources.forEach((r, i) => {
    if (r.kind !== 'living') return;
    for (let k = 0; k < n; k++) {
      const v = amount[i * n + k];
      if (!v) continue;
      const key = poolOf(r, k);
      if (key == null) continue;
      let p = pools.get(key);
      if (!p) pools.set(key, p = {});
      p[r.id] = (p[r.id] ?? 0) + v;
    }
  });
  return pools;
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
