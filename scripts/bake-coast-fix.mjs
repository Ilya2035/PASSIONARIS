// Coast fix: one coastline for every zoom level of the globe, as the world was in 5000 BC.
//   node scripts/bake-coast-fix.mjs
//
// The land / water truth (one source): Natural Earth 1:10m countries (admin-0) minus NATURAL lakes, rasterised with
// anti-aliasing on the detail grid (32768 x 16384, ~1.2 km, like scripts/bake-coast-mask.mjs), with two changes for
// the era of the game:
//   - reservoirs are land (Mingachevir, Rybinsk, Nasser, Kariba…: the dams are 20th century). Natural lakes that a
//     dam only raised (Il'men, Zaysan, Saint-Jean, Mjøsa…) stay lakes (KEEP_NATURAL);
//   - the IJsselmeer basin is land: the Zuiderzee is medieval, its polders (Flevoland, Noordoostpolder,
//     Wieringermeer) are 20th century; around 5000 BC the basin was fen and river land (Swifterbant culture).
// The coarse map grid (8192 x 4096, ~4.9 km) takes the same truth averaged over its 4 x 4 detail texels (land where
// half of it is land); an island too small for that keeps its best texel, so no island disappears from afar.
//
// The game's baked rasters (public/assets/map/cells.bin.gz, public/assets/regions/districts.bin.gz,
// public/assets/climate/biome-open.bin.gz, public/assets/terrain/z7m/) stay as they are; this bakes the
// differences, applied when the game loads (src/game/terrain/coast.js):
//   public/assets/coast/cells-fix.bin.gz  coarse texels whose land / water changes: Uint32 n, Uint32 n index deltas,
//                                         Uint16 n natural-district ids (regions raster; 0 = none, the old cell's
//                                         water), Uint8 n biome classes; then texels that only take a biome class
//                                         (water texels with some detail land): Uint32 m, Uint32 m deltas, Uint8 m
//   public/assets/coast/z7m/<tx>_<ty>.bin.gz  detail coverage tiles (Uint8 256 x 256, 255 = land) that replace the
//                                         z7m tile or add one where there was none (islands left out of the z7 set)
//   public/assets/coast/coast.json        tile list, counts, the lakes made land
// Why there are islands to add at all: scripts/bake-map.mjs grows districts only from seeds of the same province
// over connected land, so islands without a seed of their own (most of the Kurils, many Pacific islands, land cut
// off by a lake) stayed "ocean" in cells.bin.gz — and everything baked from it (regions, biomes, the list of z7
// detail tiles) lost them too.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { loadNormals, W as SW, H as SH } from '../src/sim/climate/climatology.js';
import { BIOME, climateStats, classifyBiome, dayLengths, LAPSE_RATE, WETLAND_RELIEF, WETLAND_MAX_ELEV } from '../src/sim/climate/biomes.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'assets', 'coast');
const GW = 32768, GH = 16384, T = 256, TX = GW / T, TY = GH / T;   // detail grid and its tiles
const W = 8192, H = 4096, R = GW / W;                                // map grid: 4 x 4 detail texels per map texel
const SS = 4;                                                        // vertical sub-scanlines per detail row
const SEA = 0x40000000;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// raw Natural Earth files: here, or in the main checkout when this runs in a git worktree
function rawFile(name) {
  const here = path.join(ROOT, 'data', 'raw', name);
  if (fs.existsSync(here)) return here;
  try {
    const main = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
    const there = path.join(main, 'data', 'raw', name);
    if (fs.existsSync(there)) return there;
  } catch { /* not a git checkout */ }
  throw new Error(`${name}: not found in data/raw (scripts/download-data.mjs)`);
}
const readJSON = f => JSON.parse(fs.readFileSync(rawFile(f), 'utf8'));
const gunzip = f => { const b = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, f))); const c = new Uint8Array(b.byteLength); c.set(b); return c; };

// Natural lakes that Natural Earth files as "Reservoir" because a dam regulates or raised them: they existed in
// 5000 BC and stay lakes. Every other reservoir becomes land.
const KEEP_NATURAL = new Set([
  'Lake Zaysan', 'Lake Kovdozero', 'Lake Imandra', 'Ondozero', 'Koitere', 'Rikkavesi', "Lake Il'Men'", 'Oulujärvi',
  'Kemijärvi', 'Umbozero Lake', 'Paduskoye More', 'Akkajaure', 'Stora Lulevatten', 'Mjøsa', 'Southern Indian Lake',
  'Cedar Lake', 'Sipiwesk Lac', 'Umfreville Lake', 'Lac Seul', 'Lake Abitibi', 'Lac Saint-Jean', 'Lake Péribonca',
  'Lower Arrow Lake', 'Upper Arrow Lake', 'Lake Chelan', 'Ozero Kubenskoye', 'Lake Pukaki', 'Lake Manapouri',
  'Lake Te Anau', 'Lake Hawea', 'Lake Coleridge', 'Lake Waikaremoana', 'Lake Monowai', 'Lac Bermen', 'Lake Habbaniyah',
]);
// The IJsselmeer basin (land in 5000 BC). Its north edge follows the Afsluitdijk (Den Oever - Zurich); the other
// edges run over land, so only the water inside changes.
const FEN = [[
  [4.98, 52.93], [5.035, 52.938], [5.335, 53.072], [5.62, 53.0], [5.95, 52.8], [6.02, 52.5], [5.75, 52.25],
  [5.05, 52.25], [4.92, 52.45], [4.95, 52.7], [4.98, 52.93],
]];

// ---------------------------------------------------------------- vectors -> edge lists on the detail grid
// Every edge keeps the number of its polygon (outer ring + holes): the even-odd rule runs per polygon, so where two
// features overlap (Lake Huron and Georgian Bay, both whole polygons in Natural Earth) they add up instead of
// cancelling each other out. scripts/bake-coast-mask.mjs paired the crossings of all features at once, which is
// why Georgian Bay is land in the z7m tiles.
let polyCount = 0;
function edgesOf(features) {
  const E = [];
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const pid = ++polyCount;
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const ax = (ring[i][0] + 180) / 360 * GW, ay = (90 - ring[i][1]) / 180 * GH;
          const bx = (ring[i + 1][0] + 180) / 360 * GW, by = (90 - ring[i + 1][1]) / 180 * GH;
          if (ay === by) continue;
          const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
          E.push({ y0, y1, x0, k: (x1 - x0) / (y1 - y0), pid });
        }
      }
    }
  }
  E.sort((p, q) => p.y0 - q.y0);
  return E;
}
// scanline coverage with an active edge table (as scripts/bake-coast-mask.mjs, but even-odd per polygon: the
// crossings are sorted by polygon, then x — key = polygon * 2^16 + x, exact in a double — and paired within it)
function rasterizer(E) {
  let next = 0, active = [];
  let keys = new Float64Array(1024);
  return function band(row0, rows, acc) {
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < SS; s++) {
        const yc = row0 + r + (s + 0.5) / SS;
        while (next < E.length && E[next].y0 <= yc) active.push(E[next++]);
        if (active.length > 64 && (r & 7) === 0) active = active.filter(e => e.y1 > yc);
        let nx = 0;
        for (const e of active) {
          if (!(e.y0 <= yc && e.y1 > yc)) continue;
          if (nx === keys.length) { const k2 = new Float64Array(keys.length * 2); k2.set(keys); keys = k2; }
          keys[nx++] = e.pid * 65536 + Math.max(0, Math.min(GW, e.x0 + (yc - e.y0) * e.k));
        }
        const xs = keys.subarray(0, nx).sort();
        const base = r * GW;
        for (let k = 0; k + 1 < nx; k += 2) {
          const pa = Math.floor(xs[k] / 65536), pb = Math.floor(xs[k + 1] / 65536);
          if (pa !== pb) { k--; continue; }   // an odd count in a polygon (degenerate ring): resync on the next one
          const xa = xs[k] - pa * 65536, xb = xs[k + 1] - pb * 65536;
          if (xb <= xa) continue;
          const ia = Math.floor(xa), ib = Math.floor(xb);
          if (ia === ib) { acc[base + ia] += (xb - xa) / SS; continue; }
          acc[base + ia] += (ia + 1 - xa) / SS;
          for (let i = ia + 1; i < ib && i < GW; i++) acc[base + i] += 1 / SS;
          if (ib < GW) acc[base + ib] += (xb - ib) / SS;
        }
      }
    }
    active = active.filter(e => e.y1 > row0 + rows);
  };
}

log('vectors');
const lakesAll = readJSON('ne_10m_lakes.geojson').features;
const natural = [], madeLand = [];
for (const f of lakesAll) {
  const p = f.properties;
  if (p.featurecla === 'Reservoir' && !KEEP_NATURAL.has(p.name)) madeLand.push(p.name || p.dam_name || `#${p.ne_id}`);
  else natural.push(f);
}
const land = rasterizer(edgesOf(readJSON('ne_10m_admin_0_countries.geojson').features));
const lakes = rasterizer(edgesOf(natural));
const fen = rasterizer(edgesOf([{ geometry: { type: 'Polygon', coordinates: FEN } }]));
log(`lakes: ${natural.length} natural kept, ${madeLand.length} reservoirs made land`);

// ---------------------------------------------------------------- the game's rasters as they are
const idx7 = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'terrain', 'z7', 'index.json'), 'utf8'));
const kept = new Uint8Array(TX * TY);
for (const k of idx7.kept) kept[k] = 1;
const cellsB = gunzip('public/assets/map/cells.bin.gz');
const cells = new Uint32Array(cellsB.buffer);
const idsB = gunzip('public/assets/regions/districts.bin.gz');
const ids = new Uint16Array(idsB.buffer);
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'regions', 'regions.json'), 'utf8'));
const maxId = meta.districts.reduce((m, d) => Math.max(m, d.id), 0);
const kind = new Uint8Array(maxId + 1);   // 1 land, 2 mountain, 3 lake, 4 sea
for (const d of meta.districts) kind[d.id] = d.type === 'land' ? 1 : d.type === 'mountain' ? 2 : d.type === 'lake' ? 3 : 4;
const biome = gunzip('public/assets/climate/biome-open.bin.gz');
const hB = gunzip('public/assets/map/height.delta.bin.gz');
const height = new Int16Array(hB.buffer);
for (let y = 0; y < H; y++) { let a = 0; for (let x = 0; x < W; x++) { a += height[y * W + x]; height[y * W + x] = a; } }
// land in the game today (src/game/world/regions.js: district ids, else the old cells)
const gameLand = i => { const d = ids[i]; if (d) return kind[d] <= 2; return cells[i] >= 2; };
log('game rasters loaded');

// ---------------------------------------------------------------- detail truth, tile by tile; coarse means
const M = new Uint8Array(W * H);     // land share of the map texel, 0..255
const Mx = new Uint8Array(W * H);    // 1 = some detail texel of it is land
const Lk = new Uint8Array(W * H);    // 1 = mostly natural lake
const accL = new Float32Array(T * GW), accW = new Float32Array(T * GW), accF = new Float32Array(T * GW);
const tile = new Uint8Array(T * T);
const overrides = [];
let addedTiles = 0, changedTiles = 0;
fs.rmSync(path.join(OUT, 'z7m'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'z7m'), { recursive: true });
// the z7m tile as the game has it (null: none)
function bakedMask(tx, ty) {
  const f = path.join(ROOT, 'public', 'assets', 'terrain', 'z7m', `${tx}_${ty}.bin.gz`);
  return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)) : null;
}
const truth = i => Math.max(0, Math.max(Math.min(1, accL[i]) - Math.min(1, accW[i]), Math.min(1, accF[i])));
for (let ty = 0; ty < TY; ty++) {
  accL.fill(0); accW.fill(0); accF.fill(0);
  land(ty * T, T, accL); lakes(ty * T, T, accW); fen(ty * T, T, accF);
  // coarse statistics for the 64 map rows of this band
  for (let cy = 0; cy < T / R; cy++) {
    const my = ty * (T / R) + cy;
    for (let mx = 0; mx < W; mx++) {
      let s = 0, any = 0, lk = 0;
      for (let j = 0; j < R; j++) for (let k = 0; k < R; k++) {
        const i = (cy * R + j) * GW + mx * R + k;
        const v = truth(i);
        s += v; if (v > 0.5) any = 1;
        lk += Math.min(1, accW[i]);
      }
      const o = my * W + mx;
      M[o] = Math.round(s / (R * R) * 255); Mx[o] = any; Lk[o] = lk / (R * R) >= 0.5 ? 1 : 0;
    }
  }
  // detail tiles that differ from the baked z7m (or have land where no z7m tile exists)
  for (let tx = 0; tx < TX; tx++) {
    let differs = false, hasLand = false;
    const baked = kept[ty * TX + tx] ? bakedMask(tx, ty) : null;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = y * GW + tx * T + x;
      const v = Math.round(truth(i) * 255);
      tile[y * T + x] = v;
      if (v > 127) hasLand = true;
      const old = baked ? baked[y * T + x] : 0;
      if (Math.abs(v - old) > 1) differs = true;
    }
    if (!differs || (!hasLand && !kept[ty * TX + tx])) continue;
    fs.writeFileSync(path.join(OUT, 'z7m', `${tx}_${ty}.bin.gz`), zlib.gzipSync(Buffer.from(tile), { level: 9 }));
    overrides.push(ty * TX + tx);
    if (kept[ty * TX + tx]) changedTiles++; else addedTiles++;
  }
  if (ty % 8 === 7) log(`row ${ty + 1}/${TY}  tiles: ${changedTiles} changed, ${addedTiles} added`);
}

// ---------------------------------------------------------------- coarse truth with every island kept
const C = new Uint8Array(W * H);
let nLand = 0;
for (let i = 0; i < W * H; i++) if (M[i] >= 128) { C[i] = 1; nLand++; }
{
  // 8-connected components of texels touched by land; a component without a coarse land texel gets its best one
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  let saved = 0;
  for (let s = 0; s < W * H; s++) {
    if (!Mx[s] || seen[s]) continue;
    let sp = 0, has = false, best = s;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp];
      if (C[i]) has = true;
      if (M[i] > M[best]) best = i;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const j = yy * W + (x + dx + W) % W;
          if (Mx[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
        }
      }
    }
    if (!has) { C[best] = 1; saved++; }
  }
  log(`coarse land: ${nLand} texels at half coverage, ${saved} islands kept by their best texel`);
}

// ---------------------------------------------------------------- texels to change, nearest districts
const toLand = [], toWater = [];
for (let i = 0; i < W * H; i++) {
  const g = gameLand(i);
  if (C[i] && (!g || !ids[i])) toLand.push(i);          // land missing, or land without a district of its own
  else if (!C[i] && g) toWater.push(i);
}
log(`changes: ${toLand.length} texels become land, ${toWater.length} become water`);
// multi-source BFS over the map grid from every texel of the wanted kinds; returns the nearest district id
function nearest(want, targets) {
  const near = new Uint16Array(W * H), q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) { const d = ids[i]; if (d && want(kind[d]) && C[i] === (kind[d] <= 2 ? 1 : 0)) { near[i] = d; q[qt++] = i; } }
  let left = 0;
  for (const i of targets) if (!near[i]) left++;
  while (qh < qt && left > 0) {
    const i = q[qh++], d = near[i];
    const x = i % W, y = (i - x) / W;
    for (let k = 0; k < 8; k++) {
      const dx = [1, -1, 0, 0, 1, 1, -1, -1][k], dy = [0, 0, 1, -1, 1, -1, 1, -1][k];
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      const j = yy * W + (x + dx + W) % W;
      if (near[j]) continue;
      near[j] = d; q[qt++] = j;
    }
  }
  return near;
}
const nearLand = nearest(k => k === 1 || k === 2, toLand);
const nearLake = nearest(k => k === 3, toWater.filter(i => Lk[i]));
const nearSea = nearest(k => k === 4, toWater.filter(i => !Lk[i]));
log('nearest districts found');

// ---------------------------------------------------------------- biome classes for new land (scripts/climate/bake-biomes.mjs)
const nm = await loadNormals();
const SN = SW * SH;
const st = {}, T12 = new Float32Array(12), P12 = new Float32Array(12), DL = new Float32Array(12);
function biomeAt(i) {
  const x = i % W, y = (i - x) / W;
  const lat = 90 - (y + 0.5) * 180 / H, lon = -180 + (x + 0.5) * 360 / W;
  const fy = (90 - lat) / 0.5 - 0.5, fx = (lon + 180) / 0.5 - 0.5;
  const y0 = Math.max(0, Math.min(SH - 1, Math.floor(fy))), y1 = Math.min(SH - 1, y0 + 1), ty = Math.max(0, Math.min(1, fy - y0));
  const xf = Math.floor(fx), x0 = ((xf % SW) + SW) % SW, x1 = (x0 + 1) % SW, tx = fx - xf;
  const bil = (arr, off) => {
    const a = arr[off + y0 * SW + x0], b = arr[off + y0 * SW + x1], c = arr[off + y1 * SW + x0], d = arr[off + y1 * SW + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const eB = bil(nm.elev, 0), h = Math.max(1, height[i]);
  const dT = -LAPSE_RATE * (h - eB);
  for (let m = 0; m < 12; m++) { T12[m] = bil(nm.tavg, m * SN) * 0.1 + dT; P12[m] = Math.max(0, bil(nm.prec, m * SN)); }
  climateStats(T12, P12, lat, st);
  let b = classifyBiome(st, h);
  if (h < WETLAND_MAX_ELEV && (b === BIOME.TUNDRA || b === BIOME.TAIGA || b === BIOME.TEMPERATE_FOREST || b === BIOME.STEPPE || b === BIOME.SAVANNA)) {
    const rx = Math.min(12, Math.max(2, Math.round(2 / Math.max(Math.cos(lat * Math.PI / 180), 0.15))));
    let mn = 32767, mx = -32768;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -rx; dx <= rx; dx++) { const j = yy * W + (x + dx + W) % W; if (!C[j]) continue; const hh = height[j]; if (hh < mn) mn = hh; if (hh > mx) mx = hh; }
    }
    if (mx - mn <= WETLAND_RELIEF) { dayLengths(lat, DL); b = classifyBiome(st, h, true, T12, DL); }
  }
  return b;
}

// ---------------------------------------------------------------- write
// biome: a land class wherever some detail texel is land, also on map texels that stay water (the narrow parts of
// thin islands and spits, the coastal fringe): the terrain shader colours detail land from the classes around it
// (shaders.js biomeBlend) and would fall back to plain paper where it finds only water
const landBiome = i => (biome[i] !== BIOME.WATER ? biome[i] : biomeAt(i));
const patches = [];
for (const i of toLand) patches.push([i, nearLand[i], landBiome(i)]);
// water: where the old cells already have water (small lakes the regions bake merged into land districts) no
// district — the game falls back to the old cell (0 ocean, 1 lake); else the nearest lake or sea zone
for (const i of toWater) patches.push([i, cells[i] < 2 ? 0 : Lk[i] ? nearLake[i] : nearSea[i], Mx[i] ? landBiome(i) : BIOME.WATER]);
patches.sort((a, b) => a[0] - b[0]);
const patched = new Uint8Array(W * H);
for (const p of patches) patched[p[0]] = 1;
const biomeOnly = [];
for (let i = 0; i < W * H; i++) if (Mx[i] && !patched[i] && biome[i] === BIOME.WATER) biomeOnly.push([i, biomeAt(i)]);
log(`biome classes for ${biomeOnly.length} coastal water texels with detail land`);
// file: Uint32 n | Uint32 n index deltas | Uint16 n district ids | Uint8 n biomes | Uint32 m | Uint32 m deltas | Uint8 m biomes
const n = patches.length, m = biomeOnly.length;
const size = 4 + n * 7 + 4 + m * 5;
const buf = Buffer.alloc(size);
let o = 0, prev = 0;
buf.writeUInt32LE(n, o); o += 4;
for (const [i] of patches) { buf.writeUInt32LE(i - prev, o); o += 4; prev = i; }
for (const p of patches) { buf.writeUInt16LE(p[1], o); o += 2; }
for (const p of patches) buf[o++] = p[2];
buf.writeUInt32LE(m, o); o += 4; prev = 0;
for (const [i] of biomeOnly) { buf.writeUInt32LE(i - prev, o); o += 4; prev = i; }
for (const p of biomeOnly) buf[o++] = p[1];
const fixGz = zlib.gzipSync(buf, { level: 9 });
fs.writeFileSync(path.join(OUT, 'cells-fix.bin.gz'), fixGz);
overrides.sort((a, b) => a - b);
const coast = {
  format: 'passionaris-coast-fix', version: 1,
  note: 'scripts/bake-coast-fix.mjs: one coastline (Natural Earth 1:10m countries minus natural lakes; reservoirs and the IJsselmeer basin are land, as in 5000 BC) for the map grid and the detail tiles',
  grid: { width: W, height: H }, detail: { grid: [GW, GH], tile: T, tiles: [TX, TY] },
  regions: { districts: meta.districts.length, maxId },
  cells: { file: 'cells-fix.bin.gz', count: n, toLand: toLand.length, toWater: toWater.length, biomeOnly: m },
  tiles: overrides,
  reservoirsMadeLand: madeLand.sort(),
};
fs.writeFileSync(path.join(OUT, 'coast.json'), JSON.stringify(coast));
log(`cells-fix.bin.gz: ${n} texels, ${(fixGz.length / 1e3).toFixed(0)} kB; z7m tiles: ${changedTiles} changed + ${addedTiles} added`);
// spot checks: the map texel after the fix (district kind, biome)
const byIdx = new Map(patches.map(p => [p[0], p]));
const KIND = ['-', 'land', 'mountain', 'lake', 'sea'];
for (const [name, la, lo] of [['Iturup', 45.2, 148.0], ['Urup', 45.9, 150.0], ['Simushir', 46.95, 152.0], ['Onekotan', 49.4, 154.8],
  ['Niihau', 21.9, -160.15], ['Kahoolawe', 20.55, -156.6], ['Tahiti', -17.65, -149.45], ['Moorea', -17.53, -149.83], ['Rangiroa', -15.1, -147.7],
  ['Pohnpei', 6.88, 158.22], ['Chuuk Weno', 7.45, 151.85], ['Flevoland', 52.45, 5.5], ['IJsselmeer', 52.8, 5.3], ['Markermeer', 52.55, 5.2],
  ['Mingachevir res.', 40.85, 46.95], ['Sevan', 40.35, 45.3], ['Rybinsk res.', 58.4, 38.4], ['Lake Nasser', 22.5, 31.9], ['Lake Ilmen', 58.27, 31.3]]) {
  const i = Math.min(H - 1, Math.floor((90 - la) / 180 * H)) * W + Math.floor((lo + 180) / 360 * W);
  const p = byIdx.get(i), d = p ? p[1] : ids[i];
  log(`spot ${name.padEnd(17)} truth ${C[i] ? 'land ' : 'water'} share ${(M[i] / 255).toFixed(2)}  game ${gameLand(i) ? 'land ' : 'water'} -> ${p ? 'FIXED' : 'same '} ${KIND[kind[d]] || '-'} #${d} biome ${p ? p[2] : biome[i]}`);
}
log('done');
