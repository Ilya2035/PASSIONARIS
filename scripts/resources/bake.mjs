// Passionaris — natural resources: bake the table «cell → units of every resource».
//
//   tools/node/node.exe scripts/resources/bake.mjs          album chunks (10 km) and the world (0.5°)
//   tools/node/node.exe scripts/resources/bake.mjs album    only the album
//
// Inputs: data/raw/resources/* (scripts/resources/download.mjs), the game's own open bakes (climate normals and
// natural zones, public/assets/climate; world height, public/assets/map), the album heights (public/album-data,
// scripts/album/fetch-data.mjs) and Natural Earth rivers (data/raw). Rules and units: docs/RESOURCES.md.
// Output: public/assets/resources/<grid>.json (meta, deposits, zones) + <grid>.bin.gz (amounts and depths).
import fs from 'node:fs';
import path from 'node:path';
import { RESOURCES, RES_INDEX, ALBUM_GRID, chunkI, chunkJ, chunkLat, chunkLon, strHash } from './lib.mjs';
import { csvObjects, gzip, gunzip } from './lib-node.mjs';
import { BONUS, SIZE, REF100, DENSITY, CLASSES, KNOWN } from './reference.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const RAW = P('data', 'raw', 'resources');
const OUT = P('public', 'assets', 'resources');
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ['album', 'world'];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const D = Math.PI / 180;
const R_EARTH = 6371;
const kmBetween = (lat1, lon1, lat2, lon2) => {
  const a = Math.sin((lat2 - lat1) * D / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin((lon2 - lon1) * D / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
};
const readGz = f => gunzip(fs.readFileSync(f));
const must = (f, how) => { if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(ROOT, f)} — ${how}`); return f; };

// =================================================================== inputs shared by both grids
// --- climate normals 0.5° (CHELSA V2.1 + ETOPO 2022, CC0): annual mean T, warmest / coldest month, annual P
function loadClimate() {
  const meta = JSON.parse(fs.readFileSync(P('public', 'assets', 'climate', 'normals.json'), 'utf8'));
  const buf = readGz(P('public', 'assets', 'climate', meta.file));
  const { W, H } = meta.grid;
  const tav = new Int16Array(buf.buffer, buf.byteOffset + meta.offsets.tavg, 12 * W * H);
  const pre = new Uint16Array(buf.buffer, buf.byteOffset + meta.offsets.prec, 12 * W * H);
  const cell = (lat, lon) => {
    const y = clamp(Math.floor((90 - lat) / 0.5), 0, H - 1), x = ((Math.floor((lon + 180) / 0.5) % W) + W) % W;
    return y * W + x;
  };
  return (lat, lon) => {
    const c = cell(lat, lon);
    let ta = 0, tw = -99, tc = 99, p = 0;
    for (let m = 0; m < 12; m++) {
      const t = tav[m * W * H + c] / 10;
      ta += t / 12; tw = Math.max(tw, t); tc = Math.min(tc, t); p += pre[m * W * H + c];
    }
    return { tAnn: ta, tWarm: tw, tCold: tc, pAnn: p };
  };
}

// --- natural zones 8192 × 4096 (the game's biome-open bake)
const BIOME = { water: 0, ice: 1, tundra: 2, taiga: 3, temperate_forest: 4, steppe: 5, mediterranean: 6, desert: 7,
  semi_desert: 8, savanna: 9, tropical_forest: 10, wetland: 11, highland: 12 };
// share of the ground under trees in a natural (5000 BC-like, no fields) landscape of that zone
const FOREST_SHARE = [0, 0, 0.05, 0.9, 0.95, 0.15, 0.7, 0, 0.05, 0.3, 0.95, 0.4, 0.15];
function loadBiome() {
  const meta = JSON.parse(fs.readFileSync(P('public', 'assets', 'climate', 'biomes.json'), 'utf8'));
  const buf = readGz(P('public', 'assets', 'climate', meta.file));
  const { W, H } = meta.grid;
  return (lat, lon) => {
    const y = clamp(Math.floor((90 - lat) / 180 * H), 0, H - 1), x = ((Math.floor((lon + 180) / 360 * W) % W) + W) % W;
    return buf[y * W + x];
  };
}

// --- GLiM 0.5° lithology (Hartmann & Moosdorf 2012, CC BY 3.0): dominant rock class of each cell
const GLIM_KEYS = ['', 'su', 'vb', 'ss', 'pb', 'sm', 'sc', 'va', 'mt', 'pa', 'vi', 'wb', 'py', 'pi', 'ev', 'nd', 'ig'];
function loadGlim() {
  const txt = fs.readFileSync(must(path.join(RAW, 'glim', 'glim_wgs84_0point5deg.txt.asc'), 'run download.mjs glim'), 'utf8');
  const lines = txt.split(/\r?\n/);
  const hdr = {};
  let k = 0;
  for (; k < lines.length; k++) {
    const m = /^(\w+)\s+(-?[\d.]+)$/.exec(lines[k].trim());
    if (!m) break;
    hdr[m[1].toLowerCase()] = +m[2];
  }
  const W = hdr.ncols, H = hdr.nrows, cs = hdr.cellsize;
  const top = hdr.yllcorner + H * cs;
  const grid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = lines[k + y].trim().split(/\s+/);
    for (let x = 0; x < W; x++) grid[y * W + x] = +v[x] > 0 ? +v[x] : 0;
  }
  // Shares of rock classes around a point: the four nearest 0.5° cells with bilinear weights (cells without rock —
  // sea, no data — are left out). Smooth, so the coarse grid does not show as squares on 10 km chunks.
  return (lat, lon) => {
    const fy = (top - lat) / cs - 0.5, fx = (lon - hdr.xllcorner) / cs - 0.5;
    const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0;
    const mix = {};
    let sum = 0;
    for (const [dy, dx, w] of [[0, 0, (1 - ty) * (1 - tx)], [0, 1, (1 - ty) * tx], [1, 0, ty * (1 - tx)], [1, 1, ty * tx]]) {
      const y = y0 + dy, x = ((x0 + dx) % W + W) % W;
      if (y < 0 || y >= H || w <= 0) continue;
      const key = GLIM_KEYS[grid[y * W + x]];
      if (!key || key === 'wb' || key === 'nd') continue;
      mix[key] = (mix[key] ?? 0) + w;
      sum += w;
    }
    for (const k in mix) mix[k] /= sum;
    return mix;
  };
}
// weighted value of a rock-class table over a mix; `other` for classes the table does not list
const byRock = (mix, table, other = 0) => {
  let v = 0, s = 0;
  for (const k in mix) { v += mix[k] * (table[k] ?? other); s += mix[k]; }
  return s ? v : other;
};

// --- Natural Earth 10m rivers (public domain): polylines with a size class
function loadRivers() {
  const f = must(P('data', 'raw', 'ne_10m_rivers_lake_centerlines.geojson'), 'npm run data:download');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = [];
  for (const ft of j.features) {
    const g = ft.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    // scalerank 0..10: smaller = bigger river. Size weight of a river 10 km long passing through a cell.
    const sr = ft.properties.scalerank ?? 8;
    const size = sr <= 2 ? 1 : sr <= 4 ? 0.75 : sr <= 6 ? 0.5 : sr <= 8 ? 0.35 : 0.25;
    for (const l of lines) out.push({ size, pts: l, lake: /Lake/.test(ft.properties.featurecla ?? '') });
  }
  return out;
}

// --- ocean chlorophyll (S-NPP VIIRS 2019, NOAA CoastWatch): annual mean of the months that have data
function loadChl(prefix) {
  const dir = path.join(RAW, 'chl');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.csv')) : [];
  if (!files.length) { log('chlorophyll: no files for', prefix, '— fish uses depth only'); return []; }
  const acc = new Map();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    for (let k = 2; k < lines.length; k++) {
      const p = lines[k].split(',');
      if (p.length < 5) continue;
      const v = +p[4];
      if (!(v > 0)) continue;
      const key = p[2] + ',' + p[3];
      const a = acc.get(key);
      if (a) { a[0] += Math.log(v); a[1]++; } else acc.set(key, [Math.log(v), 1]);
    }
  }
  const pts = [];
  for (const [key, [s, n]] of acc) {
    if (n < 3) continue; // polar night months have no data: need at least a season
    const [lat, lon] = key.split(',').map(Number);
    pts.push({ lat, lon, chl: Math.exp(s / n) });
  }
  log('chlorophyll', prefix, files.length, 'months,', pts.length, 'points');
  return pts;
}

// =================================================================== grids
// Every grid gives: W, H, N, cellOf(lat, lon) → index or −1, sample(c, fx, fy) → { lat, lon }, areaKm2(c),
// meta (written to the .json), height(lat, lon) in metres (sea negative), lake(lat, lon) → bool.
// world height and lakes, 8192 × 4096 (the game's map bake)
let worldMap = null;
function loadWorldMap() {
  if (worldMap) return worldMap;
  const MW = 8192, MH = 4096;
  const hb = readGz(must(P('public', 'assets', 'map', 'height.delta.bin.gz'), 'npm run data:bake'));
  const h = new Int16Array(hb.buffer, hb.byteOffset, MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 1; x < MW; x++) h[y * MW + x] += h[y * MW + x - 1];
  const cb = readGz(P('public', 'assets', 'map', 'cells.bin.gz'));
  const cells = new Uint32Array(cb.buffer, cb.byteOffset, MW * MH);
  const px = (lat, lon) => clamp(Math.floor((90 - lat) / 180 * MH), 0, MH - 1) * MW + ((Math.floor((lon + 180) / 360 * MW) % MW) + MW) % MW;
  return (worldMap = { height: (lat, lon) => h[px(lat, lon)], lake: (lat, lon) => cells[px(lat, lon)] === 1 });
}

function albumGrid() {
  const meta = JSON.parse(fs.readFileSync(must(P('public', 'album-data', 'meta.json'),
    'run scripts/album/fetch-data.mjs'), 'utf8'));
  const b = meta.bbox;
  const g = ALBUM_GRID;
  const hb = meta.base, hbuf = readGz(P('public', 'album-data', hb.file));
  const hpx = new Uint16Array(hbuf.buffer, hbuf.byteOffset, hb.w * hb.h);
  const n = 256 * 2 ** hb.z;
  const world = loadWorldMap();
  // album heights (~230 m) where they exist, the world map (~5 km) around them (the grid is larger than the region)
  const height = (lat, lon) => {
    const x = (lon + 180) / 360 * n - hb.x0 * 256;
    const s = Math.sin(lat * D);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - hb.y0 * 256;
    if (x < 0 || y < 0 || x > hb.w - 1 || y > hb.h - 1) return world.height(lat, lon);
    return hpx[Math.round(y) * hb.w + Math.round(x)] / 4 - 8192;
  };
  const vec = JSON.parse(fs.readFileSync(P('public', 'album-data', 'vectors.json'), 'utf8'));
  const lakes = (vec.lakes ?? []).map(l => l.ring);
  const lake = (lat, lon) => lakes.some(r => inRing(r, lon, lat)) || (!(lon >= b.lon0 && lon <= b.lon1 && lat >= b.lat0 && lat <= b.lat1) && world.lake(lat, lon));
  // The album's own CPU height: bilinear, clamped at the edge — data.base.at in src/album/data.js, line for line
  const rect = [hb.x0 / 2 ** hb.z, hb.y0 / 2 ** hb.z, 2 ** hb.z * 256 / hb.w, 2 ** hb.z * 256 / hb.h];
  const mercY = lat => { const r = lat * D; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
  const baseAt = (lat, lon) => {
    const x = Math.max(0, Math.min(hb.w - 1.001, ((lon + 180) / 360 - rect[0]) * rect[2] * hb.w - 0.5));
    const y = Math.max(0, Math.min(hb.h - 1.001, (mercY(lat) - rect[1]) * rect[3] * hb.h - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * hb.w + i;
    const a = hpx[k], bb = hpx[k + 1], c = hpx[k + hb.w], d = hpx[k + hb.w + 1];
    return ((a * (1 - fx) + bb * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 4 - 8192;
  };
  return {
    name: 'album', W: g.W, H: g.H, N: g.W * g.H,
    meta: { ...g, bbox: b, cell: '(j − j0) · W + (i − i0); row 0 = southmost — the same numbering as src/album/chunks.js',
      note: 'x = lon · 111.195 · cos 40°, y = lat · 111.195 (km); chunk (i, j) = (floor(x / 10), floor(y / 10))' },
    inBox: () => true,
    cellOf(lat, lon) {
      const i = chunkI(lon) - g.i0, j = chunkJ(lat) - g.j0;
      return i < 0 || j < 0 || i >= g.W || j >= g.H ? -1 : j * g.W + i;
    },
    sample(c, fx, fy) { return { lat: chunkLat(g.j0 + Math.floor(c / g.W), fy), lon: chunkLon(g.i0 + c % g.W, fx) }; },
    areaKm2: () => 100,
    height, lake, S: 8, nearKm: 30,
  };
}
function worldGrid() {
  const W = 360, H = 180, DEG = 1;   // 1° cells: 52 resources at 0.5° would weigh tens of megabytes
  const world = loadWorldMap();
  return {
    name: 'world', W, H, N: W * H,
    meta: { kind: 'latlon', W, H, resolutionDeg: DEG, cell: 'row · 360 + col; row 0 = 90°N … 89°N, col 0 = 180°W' },
    inBox: () => true,
    cellOf(lat, lon) {
      const y = Math.floor((90 - lat) / DEG), x = Math.floor((lon + 180) / DEG);
      return y < 0 || y >= H || x < 0 || x >= W ? -1 : y * W + x;
    },
    sample(c, fx, fy) { return { lat: 90 - (Math.floor(c / W) + fy) * DEG, lon: -180 + (c % W + fx) * DEG }; },
    areaKm2(c) { const lat = 90 - (Math.floor(c / W) + 0.5) * DEG; return (DEG * 111.195) ** 2 * Math.cos(lat * D); },
    height: world.height, lake: world.lake,
    S: 16, nearKm: 120,
  };
}

function inRing(ring, x, y) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

// =================================================================== per-cell features
function features(grid, inp) {
  const { N, S } = grid;
  const f = {
    land: new Float32Array(N), lake: new Float32Array(N), sea: new Float32Array(N), shelf: new Float32Array(N),
    hMean: new Float32Array(N), relief: new Float32Array(N), forest: new Float32Array(N), wet: new Float32Array(N),
    river: new Float32Array(N), chl: new Float32Array(N).fill(NaN), glim: new Array(N), ice: new Float32Array(N),
    clim: new Array(N), coast: new Float32Array(N), lat: new Float32Array(N),
    biome: new Float32Array(N * 13),   // share of the land of each natural zone (BIOME), 13 per cell
  };
  const hs = new Float32Array(S * S);
  for (let c = 0; c < N; c++) {
    let land = 0, lake = 0, sea = 0, shelf = 0, hsum = 0, forest = 0, wet = 0, ice = 0;
    for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
      const { lat, lon } = grid.sample(c, (u + 0.5) / S, (v + 0.5) / S);
      const h = grid.height(lat, lon);
      hs[v * S + u] = h;
      if (grid.lake(lat, lon)) lake++;
      else if (h > 0) {
        land++; hsum += h;
        const b = inp.biome(lat, lon);
        forest += FOREST_SHARE[b] ?? 0;
        f.biome[c * 13 + b]++;
        if (b === BIOME.wetland) wet++;
        if (b === BIOME.ice) ice++;
      } else { sea++; if (h > -200) shelf++; }
    }
    const n = S * S;
    f.land[c] = land / n; f.lake[c] = lake / n; f.sea[c] = sea / n; f.shelf[c] = sea ? shelf / sea : 0;
    f.hMean[c] = land ? hsum / land : 0;
    f.forest[c] = land ? forest / land : 0;
    f.wet[c] = land ? wet / land : 0;
    f.ice[c] = land ? ice / land : 0;
    if (land) for (let b = 0; b < 13; b++) f.biome[c * 13 + b] /= land;
    // relief: mean height step between neighbouring land samples, scaled to metres per km
    let steps = 0, ns = 0;
    for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
      const a = hs[v * S + u];
      if (a <= 0) continue;
      if (u + 1 < S && hs[v * S + u + 1] > 0) { steps += Math.abs(hs[v * S + u + 1] - a); ns++; }
      if (v + 1 < S && hs[(v + 1) * S + u] > 0) { steps += Math.abs(hs[(v + 1) * S + u] - a); ns++; }
    }
    const stepKm = Math.sqrt(grid.areaKm2(c)) / S;
    f.relief[c] = ns ? steps / ns / stepKm : 0; // m per km ≈ slope ‰
    f.coast[c] = Math.min(land, sea) > 0 ? 1 : 0;
    const ctr = grid.sample(c, 0.5, 0.5);
    f.clim[c] = inp.climate(ctr.lat, ctr.lon);
    f.glim[c] = inp.glim(ctr.lat, ctr.lon);
    f.lat[c] = ctr.lat;
  }
  // rivers: length (km) inside each cell × size weight
  for (const r of inp.rivers) {
    for (let k = 1; k < r.pts.length; k++) {
      const [lon0, lat0] = r.pts[k - 1], [lon1, lat1] = r.pts[k];
      const len = kmBetween(lat0, lon0, lat1, lon1), steps = Math.max(1, Math.ceil(len));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const c = grid.cellOf(lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t);
        if (c >= 0) f.river[c] += (len / steps) * r.size * (r.lake ? 0.5 : 1);
      }
    }
  }
  // chlorophyll: geometric mean of the points in a cell; empty sea cells take the nearest data within a few cells
  const sum = new Float64Array(N), cnt = new Uint16Array(N);
  for (const p of inp.chl) {
    const c = grid.cellOf(p.lat, p.lon);
    if (c >= 0) { sum[c] += Math.log(p.chl); cnt[c]++; }
  }
  for (let c = 0; c < N; c++) if (cnt[c]) f.chl[c] = Math.exp(sum[c] / cnt[c]);
  for (let pass = 0; pass < 4; pass++) {
    const next = f.chl.slice();
    for (let c = 0; c < N; c++) {
      if (!isNaN(f.chl[c]) || f.sea[c] === 0) continue;
      const x = c % grid.W, y = Math.floor(c / grid.W);
      let s = 0, m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= grid.W || yy >= grid.H) continue;
        const v = f.chl[yy * grid.W + xx];
        if (!isNaN(v)) { s += Math.log(v); m++; }
      }
      if (m) next[c] = Math.exp(s / m);
    }
    f.chl = next;
  }
  return f;
}

// =================================================================== rules: real amounts in each resource's unit
// Every rule returns the amount of one cell (scripts/resources/reference.mjs, DENSITY; × area / 100 by the caller).
const DZ = DENSITY;
const BIOME_KEYS = Object.keys(BIOME);
const byBiome = (f, c, table) => { let v = 0; for (let b = 0; b < 13; b++) v += f.biome[c * 13 + b] * (table[BIOME_KEYS[b]] ?? 0); return v; };
const productivity = (f, c) => clamp(Math.log10((isNaN(f.chl[c]) ? 0.3 : f.chl[c]) / 0.08) / Math.log10(4 / 0.08));
// fish (t): an ordinary shelf … the richest upwelling, open sea far poorer; rivers and lakes add fresh-water fish
function fishOf(f, c) {
  const prod = productivity(f, c);
  const shelf = DZ.fish.shelf * Math.pow(DZ.fish.rich / DZ.fish.shelf, prod);
  const sea = f.sea[c] * (f.shelf[c] * shelf + (1 - f.shelf[c]) * DZ.fish.ocean * (0.5 + prod));
  const fresh = Math.min(DZ.fish.shelf * 0.3, f.river[c] * 20) * (f.clim[c].tAnn > -8 ? 1 : 0.3) + f.lake[c] * DZ.fish.shelf * 0.5;
  return sea + fresh;
}
// marine mammals (t): richer in cold productive seas
function seamammalsOf(f, c) {
  if (!f.sea[c]) return 0;
  const cold = clamp((Math.abs(f.lat[c]) - 25) / 40), prod = productivity(f, c);
  const per = f.shelf[c] * DZ.seamammals.shelf + (1 - f.shelf[c]) * DZ.seamammals.ocean;
  return f.sea[c] * per * (0.3 + 0.7 * cold) * (0.4 + 1.2 * prod) * (cold > 0.6 ? DZ.seamammals.rich / DZ.seamammals.shelf / 4 : 1);
}
// game (t): wild herbivores of the natural zones
const gameOf = (f, c) => f.land[c] * byBiome(f, c, DZ.game);
// timber (m³): standing wood of the natural forest (no fields — the map starts in 5000 BC)
const woodOf = (f, c) => f.land[c] * byBiome(f, c, DZ.woodPerHa) * 1e4 * (f.hMean[c] > 2400 ? 0.3 : 1);
// fresh water (m³ a year): runoff = rain − evaporation (Turc), over land and lakes
function waterOf(f, c) {
  const { pAnn: P, tAnn: t } = f.clim[c];
  const L = 300 + 25 * t + 0.05 * t ** 3, et = L > 0 ? P / Math.sqrt(0.9 + (P / L) ** 2) : 0;
  // dry lands keep some runoff in storms and springs: at least 6 % of the rain (Murcia ≈ 44 mm of 300)
  return (f.land[c] + f.lake[c]) * Math.max(0.06 * P, P - et) * DZ.waterPerMm;
}
// building stone (t): everywhere on land, more in rugged terrain, less on loose sediments and under ice
function stoneOf(f, c) {
  const lith = byRock(f.glim[c], { su: 0.4, ig: 0.1, ev: 0.6 }, 1);
  return f.land[c] * (1 - 0.9 * f.ice[c]) * (0.15 + 0.85 * clamp(f.relief[c] / 120)) * lith * DZ.stone;
}
// limestone and chalk (t): carbonate rocks
const limestoneOf = (f, c) => f.land[c] * (1 - f.ice[c]) * byRock(f.glim[c], { sc: 1, sm: 0.35, mt: 0.1 }, 0) * DZ.limestone;
// clay (t): flat valleys with rivers and loose or soft sediments
function clayOf(f, c) {
  const flat = 1 - clamp(f.relief[c] / 80);
  const soft = byRock(f.glim[c], { su: 1, ss: 0.6, sm: 0.6, sc: 0.35 }, 0.2);
  const river = clamp(f.river[c] / 8);
  return f.land[c] * (1 - f.ice[c]) * clamp(0.08 + 0.45 * flat * river + 0.35 * flat * soft + 0.12 * f.wet[c]) * DZ.clay;
}
// sand and gravel (t): river beds, loose sediments, beaches
function sandOf(f, c) {
  const flat = 1 - clamp(f.relief[c] / 100);
  return f.land[c] * (1 - f.ice[c]) * clamp(0.05 + 0.5 * byRock(f.glim[c], { su: 1 }, 0) + 0.3 * flat * clamp(f.river[c] / 8) + 0.2 * f.coast[c]) * DZ.sand;
}
// silica sand (t): clean sandstones and quartz-rich loose sands, coastal dunes
const quartzOf = (f, c) => f.land[c] * (1 - f.ice[c]) * clamp(byRock(f.glim[c], { ss: 0.5, su: 0.2 }, 0) + 0.2 * f.coast[c]) * DZ.quartz;
// sea salt pans (t) on warm dry flat coasts
function saltPanOf(f, c) {
  if (!f.coast[c]) return 0;
  const cl = f.clim[c];
  return clamp((cl.tWarm - 21) / 5) * clamp((750 - cl.pAnn) / 400) * (1 - clamp(f.relief[c] / 60)) * DZ.saltPan;
}
// peat (t): mires of cool wet climates
function peatOf(f, c) {
  const cl = f.clim[c];
  return f.land[c] * f.wet[c] * clamp((15 - cl.tAnn) / 10) * clamp((cl.pAnn - 400) / 400) * DZ.peat;
}
// fields of rare kinds of stone by rock type: flint in chalk and limestone, obsidian in acid volcanics; marble in
// metamorphic rocks; gypsum and alabaster in evaporites — the place inside is known only roughly
const FIELD_ROCK = { flint: { sc: 0.5, va: 1, py: 0.8 }, marble: { mt: 1 }, gypsum: { ev: 1 } };

// =================================================================== deposits from the databases
// commodity names of MRDS and «Major mineral deposits» → resource. MRDS splits names that hold a comma
// («Stone, Dimension», «Sand and Gravel, Construction»), so the parts are matched too.
const RES_BY_COMMODITY = [
  [/^iron$/i, 'iron'], [/^copper( oxide| sulfide)?$/i, 'copper'], [/^tin$/i, 'tin'], [/^lead$/i, 'lead'], [/^zinc$/i, 'zinc'],
  [/^silver$/i, 'silver'], [/^gold$/i, 'gold'], [/^mercury$/i, 'mercury'],
  [/^(platinum|pge|palladium|rhodium|iridium|osmium|ruthenium)$/i, 'platinum'],
  [/^manganese$/i, 'manganese'], [/^chromium|chromite$/i, 'chromium'], [/^nickel( laterite)?$/i, 'nickel'], [/^cobalt$/i, 'cobalt'],
  [/^tungsten$/i, 'tungsten'], [/^molybdenum$/i, 'molybdenum'], [/^(aluminum|aluminium|bauxite)$/i, 'aluminium'],
  [/^titanium(-ilmenite|-rutile|-heavy minerals)?$/i, 'titanium'], [/^(magnesite|magnesium compounds|magnesium)$/i, 'magnesium'],
  [/^lithium$/i, 'lithium'], [/^(ree|cerium|yttrium|lanthanum|neodymium|rare earths?)$/i, 'ree'],
  [/^(tantalum|niobium \(columbium\)|niobium|beryllium|gallium|germanium|indium)$/i, 'raremetals'],
  [/^uranium$/i, 'uranium'], [/^thorium$/i, 'thorium'],
  [/^(salt|halite)$/i, 'salt'], [/^(potash|potassium)$/i, 'potash'], [/^phosphorus-phosphates|phosphate/i, 'phosphate'],
  [/^nitrogen-nitrates|nitrate/i, 'nitrate'], [/^(sulfur|sulfur-pyrite|pyrite)$/i, 'sulfur'],
  [/^(boron-borates|sodium carbonate|soda ash|trona)$/i, 'borates'], [/^fluorine-fluorite|fluorspar/i, 'fluorite'], [/^graphite$/i, 'graphite'],
  [/^kaolin$/i, 'kaolin'], [/^(gypsum-anhydrite|gypsum|alabaster)$/i, 'gypsum'],
  [/^(marble|dimension|travertine|slate|flagstone|onyx)$/i, 'marble'], [/^(flint|obsidian|perlite)$/i, 'flint'],
  [/^(limestone|high calcium|cement rock|dolomite|chalk)$/i, 'limestone'],
  [/^(silica|industrial\/frac sand|quartz|glass sand)$/i, 'quartz'], [/^(sand and gravel|sand|construction|aggregate)$/i, 'sand'],
  [/^(crushed\/broken|granite)$/i, 'stone'],
  [/^(clay|ball clay|fire clay \(refractory\)|brick clay|bentonite|fullers earth|high alumina clay)$/i, 'clay'],
  [/^(gemstone|diamond|sapphire|ruby|emerald)$/i, 'gems'],
  [/^(semiprecious gemstone|jade|amber|turquoise|lapis lazuli|opal|agate|garnet|topaz|beryl)$/i, 'ornamental'],
  [/^peat$/i, 'peat'], [/^(coal|lignite|bituminous|subbituminous|anthracite)$/i, 'coal'],
  [/^(petroleum \(oil\)|oil shale|oil sands|rock asphalt|gilsonite|bitumen)$/i, 'oil'], [/^natural gas$/i, 'gas'], [/^helium$/i, 'helium'],
];
const resOfCommodity = s => { for (const [re, r] of RES_BY_COMMODITY) if (re.test(s.trim())) return r; return null; };
// Wikidata: class or product label → resource
const RES_BY_WORD = [
  [/coal|lignite|anthracite/i, 'coal'], [/\biron\b|hematite|magnetite|siderite/i, 'iron'], [/copper|malachite|chalcopyrite/i, 'copper'],
  [/\btin\b|cassiterite/i, 'tin'], [/\blead\b|galena/i, 'lead'], [/\bzinc\b|sphalerite|calamine/i, 'zinc'], [/silver/i, 'silver'],
  [/\bgold\b/i, 'gold'], [/mercury|cinnabar/i, 'mercury'], [/platinum|palladium/i, 'platinum'], [/manganese/i, 'manganese'],
  [/chrom/i, 'chromium'], [/nickel/i, 'nickel'], [/cobalt/i, 'cobalt'], [/tungsten|wolfram|scheelite/i, 'tungsten'],
  [/molybden/i, 'molybdenum'], [/bauxite|alumin/i, 'aluminium'], [/titan|ilmenite|rutile/i, 'titanium'], [/magnesi/i, 'magnesium'],
  [/lithium|spodumene|lepidolite/i, 'lithium'], [/rare.earth|monazite|bastn/i, 'ree'],
  [/tantal|niobi|coltan|beryllium|gallium|germanium|indium/i, 'raremetals'], [/uranium/i, 'uranium'], [/thorium/i, 'thorium'],
  [/potash|sylvite|potassium/i, 'potash'], [/salt|halite/i, 'salt'], [/phosphat/i, 'phosphate'], [/nitrate|saltpet/i, 'nitrate'],
  [/sulfur|sulphur|pyrite/i, 'sulfur'], [/borax|borate|trona|soda ash/i, 'borates'], [/fluorite|fluorspar/i, 'fluorite'],
  [/graphite/i, 'graphite'], [/kaolin/i, 'kaolin'], [/gypsum|alabaster/i, 'gypsum'],
  [/marble|slate|travertine|porphyry|onyx|dimension stone/i, 'marble'], [/flint|obsidian|chert/i, 'flint'],
  [/limestone|chalk|dolomite/i, 'limestone'], [/silica|quartz/i, 'quartz'], [/gravel|\bsand\b/i, 'sand'], [/granite|basalt|sandstone/i, 'stone'],
  [/clay|bentonite/i, 'clay'], [/diamond|sapphire|ruby|emerald|gemstone/i, 'gems'],
  [/amber|jade|nephrite|turquoise|lapis|opal|agate|garnet|jasper/i, 'ornamental'], [/\bpeat\b|turf/i, 'peat'],
  [/\boil\b|petroleum|bitumen|asphalt|oil shale/i, 'oil'], [/natural gas|\bgas\b/i, 'gas'], [/helium/i, 'helium'],
];
const resOfWord = s => { const out = new Set(); for (const [re, r] of RES_BY_WORD) if (re.test(s)) out.add(r); return out; };

// size class of a deposit: 0 trace … 4 giant (reference.mjs CLASSES); its amount = SIZE[res][class]
const MRDS_CLASS = { L: 3, M: 2, S: 1, Y: 2, N: 0 };
const MRDS_STAT_CLASS = { Producer: 2, 'Past Producer': 2, Plant: 2, Prospect: 1, Occurrence: 0, Unknown: 0 };
const sizeOf = (res, cls) => SIZE[res][Math.max(0, Math.min(4, cls))];
const NOT_A_DEPOSIT = /smelter|refiner|refinery|foundry|\bworks?\b|\bplant\b|\boper\b|operations|siderurg|hornos|steel|mill\b|\bhq\b/i;
function depthOfMrds(r, res) {
  const w = (r.oper_type + ' ' + r.work_type + ' ' + r.dep_type).toLowerCase();
  if (res === 'oil' || res === 'gas' || res === 'helium') return 2;
  if (/brine/.test(w) && (res === 'salt' || res === 'lithium' || res === 'borates' || res === 'potash')) return 0;
  if (/placer/.test(w)) return res === 'gold' || res === 'tin' || res === 'gems' || res === 'titanium' ? 0 : 1;
  if (/underground|well|offshore/.test(w) && !/surface/.test(w)) return 2;
  if (/surface/.test(w)) return 1;
  return RESOURCES[RES_INDEX[res]].depth;
}
function normName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(mines?|minas?|mina|the|de|del|la|el|los|las|les|du|des|deposit|prospect|occurrence|operations?|coto|group|area|district|pit|quarry|cantera)\b/g, ' ')
    .replace(/[^a-z]/g, '');
}

function mrdsDeposits() {
  const rows = csvObjects(fs.readFileSync(must(path.join(RAW, 'mrds', 'mrds.csv'), 'run download.mjs mrds'), 'utf8'));
  // coordinates shared by many different sites are placeholders (country or region centre): the place is unknown
  const byXY = new Map();
  for (const r of rows) {
    const k = (+r.latitude).toFixed(3) + ',' + (+r.longitude).toFixed(3);
    (byXY.get(k) ?? byXY.set(k, new Set()).get(k)).add(normName(r.site_name));
  }
  const out = [];
  const preciseNames = new Map(); // country → Set of names with real coordinates
  for (const r of rows) {
    const lat = +r.latitude, lon = +r.longitude;
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (NOT_A_DEPOSIT.test(r.site_name) || /processing plant/i.test(r.oper_type)) continue;
    const shared = byXY.get(lat.toFixed(3) + ',' + lon.toFixed(3)).size;
    const precise = shared < 8;
    const base = MRDS_CLASS[r.prod_size] ?? MRDS_STAT_CLASS[r.dev_stat] ?? 0;
    const seen = new Set();
    // major commodities at the deposit's class, minor ones one class lower, traces two lower
    [[r.commod1, 0], [r.commod2, 1], [r.commod3, 2]].forEach(([list, down]) => {
      for (const com of (list || '').split(/[,;]/)) {
        const res = resOfCommodity(com);
        if (!res || seen.has(res)) continue;
        seen.add(res);
        const cls = Math.max(0, base - down);
        out.push({ src: 'MRDS', id: 'mrds:' + r.dep_id, name: r.site_name, country: r.country, lat, lon, res, cls,
          amount: sizeOf(res, cls), depth: depthOfMrds(r, res), precise, norm: normName(r.site_name) });
      }
    });
    if (precise) (preciseNames.get(r.country) ?? preciseNames.set(r.country, new Set()).get(r.country)).add(normName(r.site_name));
  }
  // An imprecise record whose site also has a precise record is a duplicate: it gives its size to that record.
  const byName = new Map();
  for (const d of out) if (d.precise) (byName.get(d.country + '|' + d.norm) ?? byName.set(d.country + '|' + d.norm, []).get(d.country + '|' + d.norm)).push(d);
  const kept = out.filter(d => {
    if (d.precise) return true;
    if (d.norm.length < 4) return true;
    let twins = byName.get(d.country + '|' + d.norm);
    if (!twins) {
      const names = preciseNames.get(d.country);
      if (names && names.size < 30000) {
        for (const n of names) if (n.length >= 4 && sameName(n, d.norm)) { twins = byName.get(d.country + '|' + n) ?? []; break; }
      }
    }
    if (!twins) return true;
    for (const t of twins) if (t.res === d.res && d.amount > t.amount) { t.amount = d.amount; t.cls = d.cls; }
    return false;
  });
  log('MRDS', rows.length, 'records →', kept.length, 'deposit entries,', kept.filter(d => !d.precise).length, 'with unknown place');
  return kept;
}

// «Major mineral deposits of the world» are major: class 3 (large)
function majorDeposits() {
  const rows = csvObjects(fs.readFileSync(path.join(RAW, 'major', 'deposit.csv'), 'utf8'));
  const out = [];
  for (const r of rows) {
    const res = resOfCommodity(r.commodity) ?? (/potash/i.test(r.commodity) ? 'potash' : /salt/i.test(r.commodity) ? 'salt' : null);
    if (!res) continue;
    out.push({ src: 'USGS major', id: 'major:' + r.gid, name: r.dep_name, lat: +r.latitude, lon: +r.longitude, res, cls: 3,
      amount: sizeOf(res, 3), depth: RESOURCES[RES_INDEX[res]].depth, precise: true });
  }
  log('major deposits', out.length);
  return out;
}

// VMS deposits: ore tonnage (Mt) and grades → the real contained metal (t; gold and silver kg)
function vmsDeposits() {
  const rows = csvObjects(fs.readFileSync(path.join(RAW, 'vms', 'main.csv'), 'utf8'));
  const out = [];
  const add = (r, res, amount) => {
    if (!(amount > 0)) return;
    const cls = SIZE[res].reduce((c, v, k) => amount >= v ? k : c, 0);
    out.push({ src: 'USGS VMS', id: 'vms:' + r.rec_id, name: r.depname, lat: +r.latitude, lon: +r.longitude, res, cls,
      amount, depth: 1, precise: true, measured: true });
  };
  for (const r of rows) {
    const mt = +r.oreton;
    if (!(mt > 0)) continue;
    add(r, 'copper', mt * 1e6 * (+r.cugrd || 0) / 100);
    add(r, 'zinc', mt * 1e6 * (+r.zngrd || 0) / 100);
    add(r, 'lead', mt * 1e6 * (+r.pbgrd || 0) / 100);
    add(r, 'gold', mt * 1e6 * (+r.augrd || 0) / 1000);      // Mt × g/t = t → kg
    add(r, 'silver', mt * 1e6 * (+r.aggrd || 0) / 1000);
  }
  log('VMS', rows.length, 'deposits →', out.length, 'entries');
  return out;
}

function potashDeposits() {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, 'potash', 'potash.geojson'), 'utf8'));
  const out = [];
  for (const f of j.features.filter(f => f.geometry)) {
    for (const res of ['potash', 'salt']) out.push({ src: 'USGS potash', id: 'potash:' + f.properties.rec_no, name: f.properties.site_name,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], res, cls: 2, amount: sizeOf(res, 2), depth: 2, precise: true });
  }
  log('potash', out.length);
  return out;
}

function wikidataDeposits() {
  const f = path.join(RAW, 'wikidata', 'sites.json');
  if (!fs.existsSync(f)) { log('wikidata: no file — skipped'); return []; }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = [];
  for (const it of j.items) {
    const roots = new Set(it.classes.map(c => j.classes[c]?.root));
    const words = [...it.classes.map(c => j.classes[c]?.label ?? ''), ...it.products].join(' | ');
    const res = resOfWord(words);
    if (roots.has('oil field')) res.add('oil');
    if (roots.has('natural gas field')) res.add('gas');
    if (roots.has('coal deposit')) res.add('coal');
    if (roots.has('salt mine') || roots.has('saltworks') || roots.has('salt evaporation pond')) res.add('salt');
    if (res.has('oil') && /oil and gas|gas condensate/i.test(words)) res.add('gas');
    if (res.has('gas') && !roots.has('natural gas field') && /oil field/i.test(words) && !/gas/i.test(it.products.join())) res.delete('gas');
    const pan = roots.has('saltworks') || roots.has('salt evaporation pond');
    const cls = roots.has('quarry') || pan ? 1 : 2;   // a quarry or a salt pan is small, a mine or a field medium
    const pit = r => r === 'coal' && !roots.has('coal deposit');   // a coal pit is one working of a basin: small
    for (const r of res) {
      out.push({ src: 'Wikidata', id: 'wd:' + it.id, name: /^Q\d+$/.test(it.name) ? `без названия (${it.id})` : it.name, lat: it.lat, lon: it.lon, res: r,
        cls: pit(r) ? 1 : cls, amount: sizeOf(r, pit(r) ? 1 : cls), depth: r === 'salt' && pan ? 0 : RESOURCES[RES_INDEX[r]].depth, precise: true });
    }
  }
  log('Wikidata', j.items.length, 'sites →', out.length, 'entries');
  return out;
}

// The same site under the same name in several databases, up to 75 km apart (old databases round coordinates):
// one record at the coordinates of the most trusted source, the largest amount, the shallowest depth.
const SRC_RANK = { 'литература': 6, Wikidata: 5, 'USGS VMS': 4, 'USGS major': 3, 'USGS potash': 3, MRDS: 1 };
// names match: equal, one inside the other (≥ 5 letters), or one typo apart (≥ 6 letters: «Almanden» = «Almaden»)
function sameName(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function mergeByName(list) {
  const out = [], heads = new Map(); // 1° bucket → heads
  const sorted = list.map(d => ({ ...d, norm: d.norm ?? normName(d.name ?? '') }))
    .sort((a, b) => (SRC_RANK[b.src] ?? 0) - (SRC_RANK[a.src] ?? 0) || b.amount - a.amount);
  for (const d of sorted) {
    if (d.norm.length < 5) { out.push(d); continue; }
    const bx = Math.floor(d.lon), by = Math.floor(d.lat);
    let h = null;
    for (let dy = -1; dy <= 1 && !h; dy++) for (let dx = -1; dx <= 1 && !h; dx++) {
      for (const o of heads.get((bx + dx) + ',' + (by + dy)) ?? []) {
        if (o.res === d.res && sameName(o.norm, d.norm) && kmBetween(o.lat, o.lon, d.lat, d.lon) <= 75) { h = o; break; }
      }
    }
    if (!h) {
      const o = { ...d, srcList: [d.src], idList: [d.id] };
      out.push(o);
      (heads.get(bx + ',' + by) ?? heads.set(bx + ',' + by, []).get(bx + ',' + by)).push(o);
      continue;
    }
    if (d.amount > h.amount) { h.amount = d.amount; h.cls = d.cls; }
    h.depth = Math.min(h.depth, d.depth);
    if (!h.srcList.includes(d.src)) h.srcList.push(d.src);
    h.idList.push(d.id);
  }
  return out;
}

// merge records of one resource that lie within `km` of each other: one deposit, the largest amount, the shallowest
function cluster(list, km) {
  const cellDeg = km / 111;
  const buckets = new Map(), out = [];
  const key = (a, b) => a + ',' + b;
  for (const d of list.sort((a, b) => b.amount - a.amount)) {
    const bx = Math.floor(d.lon / cellDeg), by = Math.floor(d.lat / cellDeg);
    let hit = null;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (const o of buckets.get(key(bx + dx, by + dy)) ?? []) {
        if (o.res === d.res && kmBetween(o.lat, o.lon, d.lat, d.lon) <= km) { hit = o; break; }
      }
    }
    if (hit) {
      hit.depth = Math.min(hit.depth, d.depth);
      for (const s of d.srcList ?? [d.src]) if (!hit.srcs.includes(s)) hit.srcs.push(s);
      hit.ids.push(...(d.idList ?? [d.id]));
      continue;
    }
    const o = { ...d, srcs: [...(d.srcList ?? [d.src])], ids: [...(d.idList ?? [d.id])] };
    out.push(o);
    (buckets.get(key(bx, by)) ?? buckets.set(key(bx, by), []).get(key(bx, by))).push(o);
  }
  return out;
}

// =================================================================== the 0–100 scale
// 100 = the richest chunk (100 km²) of the world for this resource: the literature figure (REF100), the largest deposit
// of the databases or the fullest ground of an area rule — whichever is bigger. With the owner's 15 % on top.
function ref100Of(res, maxDeposit) {
  const z = DENSITY, max = (o) => Math.max(...Object.values(o));
  const area = {
    fish: z.fish.rich, seamammals: z.seamammals.rich, game: max(z.game), wood: max(z.woodPerHa) * 1e4,
    water: 4000 * z.waterPerMm, stone: z.stone, limestone: z.limestone, clay: z.clay, sand: z.sand, quartz: z.quartz,
    salt: z.saltPan, peat: z.peat,
  }[res] ?? 0;
  // the literature figure, when there is one, is the 100; otherwise the richest deposit chunk or the fullest ground
  return (REF100[res]?.amount ?? Math.max(maxDeposit ?? 0, area)) * BONUS;
}

// =================================================================== bake one grid
const AREA_RULES = [['fish', fishOf], ['seamammals', seamammalsOf], ['game', gameOf], ['wood', woodOf], ['water', waterOf],
  ['stone', stoneOf], ['limestone', limestoneOf], ['clay', clayOf], ['sand', sandOf], ['quartz', quartzOf], ['salt', saltPanOf], ['peat', peatOf]];
// fields of rare stone: chance per 10 × 10 km chunk that a suitable one holds a small deposit
const FIELDS = [
  { id: 'field:flint', res: 'flint', chance: 0.06, depth: 0, about: 'кремень в известняках и мелу, обсидиан в кислых вулканитах' },
  { id: 'field:marble', res: 'marble', chance: 0.03, depth: 1, about: 'мрамор в метаморфических породах' },
  { id: 'field:gypsum', res: 'gypsum', chance: 0.05, depth: 1, about: 'гипс и алебастр в толщах эвапоритов' },
];

async function bake(grid, inp, deposits, ref100) {
  log(grid.name, `${grid.W}×${grid.H} cells`);
  const f = features(grid, inp);
  const { N } = grid, R = RESOURCES.length;
  const amount = new Float64Array(R * N), depth = new Uint8Array(R * N).fill(255);
  const put = (res, c, v, d) => {
    if (c < 0 || !(v > 0)) return;
    const k = RES_INDEX[res] * N + c;
    amount[k] += v;
    if (d < depth[k]) depth[k] = d;
  };
  for (let c = 0; c < N; c++) {
    const a = grid.areaKm2(c) / 100 * BONUS;
    for (const [res, rule] of AREA_RULES) put(res, c, rule(f, c) * a, 0);
  }
  // fields: zones on the album; expected values on the coarse world grid
  const zones = [];
  for (const fd of FIELDS) {
    const piece = sizeOf(fd.res, 1) * BONUS;
    const w = c => f.land[c] * (1 - f.ice[c]) * byRock(f.glim[c], FIELD_ROCK[fd.res], 0);
    if (grid.name === 'album') {
      const cells = [], weights = [];
      for (let c = 0; c < N; c++) { const v = w(c); if (v > 0.02) { cells.push(c); weights.push(Math.max(1, Math.round(clamp(v) * 255))); } }
      if (cells.length) zones.push({ ...fd, kind: 'field', amount: Math.round(piece), cells, weights });
    } else {
      for (let c = 0; c < N; c++) put(fd.res, c, w(c) * fd.chance * piece * grid.areaKm2(c) / 100, fd.depth);
    }
  }
  // deposits: known ones in their cell (on the album's natural chunks they spread a little to their neighbours, see
  // spreadToChunks); a place known only roughly and the unfound part of fuel basins are zones
  const inGrid = deposits.filter(d => grid.inBox(d.lat, d.lon) && grid.cellOf(d.lat, d.lon) >= 0);
  const exact = cluster(mergeByName(inGrid.filter(d => d.precise)), grid.name === 'album' ? 5 : 10);
  const vague = inGrid.filter(d => !d.precise);
  const list = [];
  for (const d of exact) {
    const c = grid.cellOf(d.lat, d.lon), v = Math.round(d.amount * BONUS);
    put(d.res, c, v, d.depth);
    list.push({ id: d.ids[0], res: d.res, name: d.name, lat: +d.lat.toFixed(4), lon: +d.lon.toFixed(4), cell: c,
      amount: v, cls: d.cls, depth: d.depth, src: d.srcs.join(', '), ...(d.measured ? { measured: true } : {}) });
  }
  const step = grid.name === 'album' ? 0.05 : 1;
  const landCellsNear = (lat, lon, km, needLand = true) => {
    const cells = [];
    const dLat = km / 111, dLon = km / (111 * Math.max(0.2, Math.cos(lat * D)));
    for (let y = lat - dLat; y <= lat + dLat; y += step) {
      for (let x = lon - dLon; x <= lon + dLon; x += step) {
        const c = grid.cellOf(y, x);
        if (c < 0 || (needLand && f.land[c] < 0.3) || kmBetween(lat, lon, y, x) > km) continue;
        cells.push(c);
      }
    }
    return [...new Set(cells)].sort((a, b) => a - b);
  };
  for (const v of cluster(vague, 1)) {
    const cells = landCellsNear(v.lat, v.lon, 250);
    if (!cells.length) continue;
    zones.push({ id: 'vague:' + v.ids[0] + ':' + v.res, res: v.res, kind: 'zone', pieces: 1, amount: Math.round(v.amount * BONUS),
      depth: v.depth, about: `${v.name}: в источнике только условная точка (центр страны или района)`, src: v.src,
      cells, weights: cells.map(() => 255) });
  }
  // basins around known coal, oil and gas: half as much again, not yet found, somewhere within 60 km
  for (const res of ['coal', 'oil', 'gas']) {
    const known = exact.filter(d => d.res === res);
    for (const b of cluster(known.map(d => ({ ...d })), 60)) {
      const members = known.filter(d => kmBetween(d.lat, d.lon, b.lat, b.lon) <= 60);
      const total = members.reduce((s, d) => s + d.amount * BONUS, 0);
      const cells = landCellsNear(b.lat, b.lon, 60, res === 'coal');
      if (!cells.length) continue;
      zones.push({ id: `basin:${res}:${strHash(b.ids[0]).toString(36)}`, res, kind: 'zone',
        pieces: Math.max(1, Math.round(members.length / 2)), amount: Math.round(total / 2), depth: 2,
        about: `${RESOURCES[RES_INDEX[res]].name}: неразведанная часть бассейна у «${b.name}»`, src: b.srcs.join(', '),
        cells, weights: cells.map(() => 255) });
    }
  }
  if (grid.name === 'world') {
    for (const z of zones) {
      const each = z.amount / z.cells.length; // a zone's amount is its whole amount, split among its pieces
      for (const c of z.cells) put(z.res, c, each, z.depth);
    }
  }
  // pack: whole numbers in each resource's unit; a step (scale) per resource keeps them inside Uint32
  const bytes = new Uint8Array(R * N * 5);
  const u32 = new Uint32Array(bytes.buffer, 0, R * N);
  const scales = RESOURCES.map((r, k) => {
    let mx = 0;
    for (let c = 0; c < N; c++) mx = Math.max(mx, amount[k * N + c]);
    let s = 1;
    while (mx / s > 4e9) s *= 10;
    return s;
  });
  const stats = {};
  RESOURCES.forEach((r, k) => {
    let total = 0, cells = 0, mx = 0;
    for (let c = 0; c < N; c++) {
      const v = Math.round(amount[k * N + c] / scales[k]);
      u32[k * N + c] = v;
      if (!v) depth[k * N + c] = 255;
      else { total += v * scales[k]; cells++; mx = Math.max(mx, v * scales[k]); }
    }
    stats[r.id] = { total, cells, max: mx };
  });
  bytes.set(depth, R * N * 4);
  const meta = {
    format: 'passionaris-resources', version: 2, grid: grid.meta,
    file: `${grid.name}.bin.gz`,
    layers: {
      amount: 'Uint32 little-endian [resource][row][col]; × resources[].scale = the real amount in resources[].unit',
      depth: 'Uint8 [resource][row][col] after the amounts: 0 surface, 1 shallow, 2 deep, 255 nothing',
    },
    resources: RESOURCES.map((r, k) => ({ ...r, scale: scales[k], ref100: Math.round(ref100[r.id]) })),
    classes: CLASSES, bonus: BONUS,
    stats, baked: new Date().toISOString().slice(0, 10),
    sources: 'data/sources/resources.md; numbers: scripts/resources/reference.mjs',
    zonesNote: grid.name === 'album'
      ? 'zones are NOT in the table: place them with scatterZone()/withZones() from scripts/resources/lib.mjs and the world seed'
      : 'zones are already in the table as expected values (coarse grid); exact placement is done on the chunk grid',
  };
  if (grid.name === 'album') { meta.deposits = list; meta.zones = zones; }
  else {
    meta.deposits = list.filter(d => d.cls >= 3);
    meta.depositsNote = 'only large and giant deposits (class 3 and 4)';
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${grid.name}.bin.gz`), gzip(bytes));
  fs.writeFileSync(path.join(OUT, `${grid.name}.json`), JSON.stringify(meta));
  const kb = f2 => (fs.statSync(path.join(OUT, f2)).size / 1024).toFixed(0) + ' KB';
  log(grid.name, '→', kb(`${grid.name}.bin.gz`), '+', kb(`${grid.name}.json`), '|', list.length, 'deposits,', zones.length, 'zones');
  for (const r of RESOURCES) log('  ', r.id.padEnd(11), r.unit.padEnd(3), `cells ${stats[r.id].cells}`, `max ${stats[r.id].max.toExponential(2)}`, `total ${stats[r.id].total.toExponential(2)}`);
}

// =================================================================== main
const inp = { climate: loadClimate(), biome: loadBiome(), glim: loadGlim(), rivers: loadRivers() };
const deposits = [...mrdsDeposits(), ...majorDeposits(), ...vmsDeposits(), ...potashDeposits(), ...wikidataDeposits()]
  .filter(d => isFinite(d.lat) && isFinite(d.lon) && Math.abs(d.lat) <= 90 && Math.abs(d.lon) <= 180);
// the literature's amount for well-known deposits (reference.mjs KNOWN) replaces the rough size class
for (const k of KNOWN) {
  let hit = 0;
  for (const d of deposits) {
    if (d.res !== k.res || !k.name.test(d.name ?? '') || kmBetween(d.lat, d.lon, k.lat, k.lon) > 60) continue;
    d.amount = k.amount; d.area = k.area; d.cls = SIZE[k.res].reduce((c, v, i) => k.amount >= v ? i : c, 0); d.measured = true; d.precise = true; hit++;
  }
  if (!hit) deposits.push({ src: 'литература', id: 'lit:' + k.res + ':' + strHash(k.label).toString(36), name: k.label, lat: k.lat, lon: k.lon,
    res: k.res, cls: SIZE[k.res].reduce((c, v, i) => k.amount >= v ? i : c, 0), amount: k.amount, area: k.area,
    depth: RESOURCES[RES_INDEX[k.res]].depth, precise: true, measured: true });
}
log('known deposits from the literature:', KNOWN.length);
const maxDeposit = {};
// a deposit bigger than one chunk counts by its amount per chunk (its area in whole chunks, reference.mjs KNOWN)
for (const d of deposits) if (d.precise) maxDeposit[d.res] = Math.max(maxDeposit[d.res] ?? 0, d.amount / Math.max(1, Math.ceil((d.area ?? 100) / 100)));
const ref100 = Object.fromEntries(RESOURCES.map(r => [r.id, ref100Of(r.id, maxDeposit[r.id])]));
for (const t of TARGETS) {
  const grid = t === 'album' ? albumGrid() : t === 'world' ? worldGrid() : null;
  if (!grid) throw new Error('unknown target ' + t);
  await bake(grid, { ...inp, chl: loadChl(t === 'album' ? 'album-' : 'world') }, deposits, ref100);
}
log('done');
