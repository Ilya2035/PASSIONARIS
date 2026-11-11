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
  // Bog iron as the swamp aspect sees it (docs/album/swamp.md): the same chunks, heights, rivers and named wetlands,
  // the same natural swamp and the same swampIron() — so the rusty mires on the map and the iron in the table agree.
  async function bogIron() {
    const { Chunks } = await import('../../src/album/chunks.js');
    const { naturalSwamp, swampIron } = await import('../../src/album/aspects/swamp.js');
    const wetlands = JSON.parse(fs.readFileSync(P('public', 'assets', 'album', 'swamp', 'wetlands.json'), 'utf8')).wetlands;
    const ch = new Chunks(baseAt);
    if (ch.count !== g.W * g.H) throw new Error('album chunk grid changed: ' + ch.count);
    const natural = naturalSwamp(ch, baseAt, { rivers: vec.rivers, wetlands });
    const out = new Float32Array(ch.count);
    for (let k = 0; k < ch.count; k++) {
      ch.setNatural('swamp', k, natural[k]);
      const c = ch.centre(k);
      out[k] = swampIron(ch.get('swamp', k), c.lat, c.lon, ch.height[k]);   // album.swamp.ironOf(k)
    }
    return out;
  }
  return {
    name: 'album', W: g.W, H: g.H, N: g.W * g.H, bogIron,
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
  const W = 720, H = 360;
  const world = loadWorldMap();
  return {
    name: 'world', W, H, N: W * H,
    meta: { kind: 'latlon', W, H, resolutionDeg: 0.5, cell: 'row · 720 + col; row 0 = 90°N … 89.5°N, col 0 = 180°W',
      note: 'same grid as public/assets/climate/normals.json' },
    inBox: () => true,
    cellOf(lat, lon) {
      const y = Math.floor((90 - lat) / 0.5), x = Math.floor((lon + 180) / 0.5);
      return y < 0 || y >= H || x < 0 || x >= W ? -1 : y * W + x;
    },
    sample(c, fx, fy) { return { lat: 90 - (Math.floor(c / W) + fy) * 0.5, lon: -180 + (c % W + fx) * 0.5 }; },
    areaKm2(c) { const lat = 90 - (Math.floor(c / W) + 0.5) * 0.5; return (0.5 * 111.195) ** 2 * Math.cos(lat * D); },
    height: world.height, lake: world.lake,
    S: 10, nearKm: 60,
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
    clim: new Array(N), coast: new Float32Array(N),
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

// =================================================================== rules (amounts per 10 × 10 km; × area / 100)
// fish: the sea part by shelf and productivity, plus rivers and lakes
function fishOf(f, c) {
  const chl = isNaN(f.chl[c]) ? 0.3 : f.chl[c];
  const prod = clamp(Math.log10(chl / 0.08) / Math.log10(4 / 0.08), 0.05, 1); // 0.08 mg/m³ desert sea … 4 upwelling
  const sea = f.sea[c] * (f.shelf[c] + 0.12 * (1 - f.shelf[c])) * prod * 100;
  const fresh = Math.min(50, f.river[c] * 3) * (f.clim[c].tAnn > -8 ? 1 : 0.3) + f.lake[c] * 50;
  return Math.min(100, sea + fresh);
}
// wood: natural forest cover of the land part (no fields — the map starts in 5000 BC)
const woodOf = (f, c) => 100 * f.land[c] * f.forest[c] * (f.hMean[c] > 2400 ? 0.3 : 1);
// stone: everywhere on land, more in rugged terrain, less on loose sediments and under ice
function stoneOf(f, c) {
  const lith = byRock(f.glim[c], { su: 0.4, ig: 0.1, ev: 0.6 }, 1);
  return f.land[c] * (1 - 0.9 * f.ice[c]) * (15 + 85 * clamp(f.relief[c] / 120)) * lith;
}
// clay: flat valleys with rivers and loose or soft sediments; none under ice sheets
function clayOf(f, c) {
  const flat = 1 - clamp(f.relief[c] / 80);
  const soft = byRock(f.glim[c], { su: 1, ss: 0.6, sm: 0.6, sc: 0.35 }, 0.2);
  const river = clamp(f.river[c] / 8);
  return f.land[c] * (1 - f.ice[c]) * 100 * clamp(0.08 + 0.45 * flat * river + 0.35 * flat * soft + 0.12 * f.wet[c]);
}
// salt pans on warm dry flat coasts (sea salt by evaporation)
function saltPanOf(f, c) {
  if (!f.coast[c]) return 0;
  const cl = f.clim[c];
  const evap = clamp((cl.tWarm - 21) / 5) * clamp((750 - cl.pAnn) / 400);
  return 40 * evap * (1 - clamp(f.relief[c] / 60));
}
// bog iron: wet flat lowlands of cool humid climates (weight of a field; placed by the world seed)
function bogIronOf(f, c) {
  const cl = f.clim[c];
  const wetGround = clamp(f.wet[c] * 1.5 + clamp(f.river[c] / 10) * 0.5 * (1 - clamp(f.relief[c] / 40)) + f.lake[c] * 0.5);
  const climate = clamp((cl.pAnn - 450) / 350) * clamp((17 - cl.tAnn) / 7) * (cl.tWarm > 8 ? 1 : 0);
  return f.land[c] * wetGround * climate;
}
// rare stone fields by lithology: flint in carbonates and chalk, obsidian in acid volcanics, marble in metamorphics
const RARE_FIELDS = { sc: 0.5, va: 1, py: 0.8, mt: 0.45, ev: 0.25 }; // ev: alabaster (gypsum)

// =================================================================== deposits from the databases
const RES_BY_COMMODITY = [
  [/^iron$/i, 'iron'], [/^copper( oxide| sulfide)?$/i, 'copper'], [/^tin$/i, 'tin'], [/^lead$/i, 'lead'],
  [/^silver$/i, 'silver'], [/^gold$/i, 'gold'], [/^mercury$/i, 'mercury'],
  [/^(salt|halite|potash|potassium)$/i, 'salt'],
  [/^(coal|lignite|bituminous|subbituminous|anthracite)$/i, 'coal'],
  [/^(petroleum \(oil\)|oil shale|oil sands|rock asphalt|gilsonite)$/i, 'oil'], [/^natural gas$/i, 'gas'],
  [/gem|diamond|sapphire|ruby|emerald|jade|opal|turquoise|amber|lapis|topaz|amethyst|agate|tourmaline|aquamarine|beryl|spinel|peridot/i, 'gems'],
  [/^(marble|dimension|travertine|slate|alabaster|flint|obsidian|perlite|onyx)$/i, 'rarestone'],
  [/^(clay|kaolin|ball clay|fire clay \(refractory\)|brick clay|bentonite|fullers earth|high alumina clay)$/i, 'clay'],
];
const resOfCommodity = s => { for (const [re, r] of RES_BY_COMMODITY) if (re.test(s.trim())) return r; return null; };
// Wikidata: class or product label → resource
const RES_BY_WORD = [
  [/coal|lignite|anthracite/i, 'coal'], [/iron|hematite|magnetite|siderite/i, 'iron'], [/copper|malachite|chalcopyrite/i, 'copper'],
  [/\btin\b|cassiterite/i, 'tin'], [/\blead\b|galena/i, 'lead'], [/silver/i, 'silver'], [/\bgold\b/i, 'gold'],
  [/mercury|cinnabar/i, 'mercury'], [/salt|halite|potash|sylvite/i, 'salt'], [/oil|petroleum|bitumen|asphalt/i, 'oil'],
  [/natural gas|\bgas\b/i, 'gas'],
  [/gem|diamond|sapphire|ruby|emerald|jade|opal|turquoise|amber|lapis|topaz|amethyst|agate|garnet|tourmaline|beryl/i, 'gems'],
  [/marble|alabaster|flint|obsidian|slate|travertine|porphyry|jasper|chert|soapstone|onyx|limestone dimension/i, 'rarestone'],
  [/kaolin|clay|bentonite/i, 'clay'],
];
const resOfWord = s => { const out = new Set(); for (const [re, r] of RES_BY_WORD) if (re.test(s)) out.add(r); return out; };

const MRDS_SIZE = { L: 100, M: 30, S: 10, Y: 20, N: 5 };
const MRDS_STAT = { Producer: 20, 'Past Producer': 15, Prospect: 8, Occurrence: 5, Plant: 15, Unknown: 5 };
const NOT_A_DEPOSIT = /smelter|refiner|refinery|foundry|\bworks?\b|\bplant\b|\boper\b|operations|siderurg|hornos|steel|mill\b|\bhq\b/i;
function depthOfMrds(r, res) {
  const w = (r.oper_type + ' ' + r.work_type + ' ' + r.dep_type).toLowerCase();
  if (res === 'oil' || res === 'gas') return 2;
  if (/brine/.test(w) && res === 'salt') return 0;
  if (/placer/.test(w)) return res === 'gold' || res === 'tin' || res === 'gems' ? 0 : 1;
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
    const base = MRDS_SIZE[r.prod_size] ?? MRDS_STAT[r.dev_stat] ?? 5;
    const q = r.score === 'A' || r.score === 'B' ? 1.25 : 1;
    const seen = new Set();
    [[r.commod1, 1], [r.commod2, 0.4], [r.commod3, 0.15]].forEach(([list, k]) => {
      for (const com of (list || '').split(/[,;]/)) {
        const res = resOfCommodity(com);
        if (!res || seen.has(res)) continue;
        seen.add(res);
        out.push({ src: 'MRDS', id: 'mrds:' + r.dep_id, name: r.site_name, country: r.country, lat, lon, res,
          amount: Math.max(2, Math.round(base * q * k)), depth: depthOfMrds(r, res), precise, norm: normName(r.site_name) });
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
    for (const t of twins) if (t.res === d.res) t.amount = Math.max(t.amount, d.amount);
    return false;
  });
  log('MRDS', rows.length, 'records →', kept.length, 'deposit entries,', kept.filter(d => !d.precise).length, 'with unknown place');
  return kept;
}

function majorDeposits() {
  const rows = csvObjects(fs.readFileSync(path.join(RAW, 'major', 'deposit.csv'), 'utf8'));
  const out = [];
  for (const r of rows) {
    const res = resOfCommodity(r.commodity) ?? (/salt|potash/i.test(r.commodity) ? 'salt' : null);
    if (!res) continue;
    out.push({ src: 'USGS major', id: 'major:' + r.gid, name: r.dep_name, lat: +r.latitude, lon: +r.longitude, res,
      amount: 100, depth: RESOURCES[RES_INDEX[res]].depth, precise: true });
  }
  log('major deposits', out.length);
  return out;
}

// VMS deposits: ore tonnage (Mt) and grades → contained metal → units (10 · √kt for base metals)
function vmsDeposits() {
  const rows = csvObjects(fs.readFileSync(path.join(RAW, 'vms', 'main.csv'), 'utf8'));
  const out = [];
  const add = (r, res, units) => {
    if (!(units >= 2)) return;
    out.push({ src: 'USGS VMS', id: 'vms:' + r.rec_id, name: r.depname, lat: +r.latitude, lon: +r.longitude, res,
      amount: Math.min(1000, Math.round(units)), depth: 1, precise: true });
  };
  for (const r of rows) {
    const mt = +r.oreton;
    if (!(mt > 0)) continue;
    add(r, 'copper', 10 * Math.sqrt(mt * 1000 * (+r.cugrd || 0) / 100));
    add(r, 'lead', 10 * Math.sqrt(mt * 1000 * (+r.pbgrd || 0) / 100));
    add(r, 'gold', 10 * Math.sqrt(mt * (+r.augrd || 0)));          // Mt × g/t = t; 100 t → 100 units
    add(r, 'silver', 10 * Math.sqrt(mt * (+r.aggrd || 0) / 10));   // 1000 t → 100 units
  }
  log('VMS', rows.length, 'deposits →', out.length, 'entries');
  return out;
}

function potashDeposits() {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, 'potash', 'potash.geojson'), 'utf8'));
  const out = j.features.filter(f => f.geometry).map(f => ({
    src: 'USGS potash', id: 'potash:' + f.properties.rec_no, name: f.properties.site_name,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], res: 'salt', amount: 30, depth: 2, precise: true,
  }));
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
    let res = resOfWord(words);
    if (roots.has('oil field')) res.add('oil');
    if (roots.has('natural gas field')) res.add('gas');
    if (roots.has('coal deposit')) res.add('coal');
    if (roots.has('salt mine') || roots.has('saltworks') || roots.has('salt evaporation pond')) res.add('salt');
    if (res.has('oil') && /oil and gas|gas condensate/i.test(words)) res.add('gas');
    if (res.has('gas') && !roots.has('natural gas field') && /oil field/i.test(words) && !/gas/i.test(it.products.join())) res.delete('gas');
    const pan = roots.has('saltworks') || roots.has('salt evaporation pond');
    const quarry = roots.has('quarry');
    for (const r of res) {
      out.push({ src: 'Wikidata', id: 'wd:' + it.id, name: /^Q\d+$/.test(it.name) ? `без названия (${it.id})` : it.name, lat: it.lat, lon: it.lon, res: r,
        amount: quarry ? 10 : r === 'oil' || r === 'gas' ? 60 : 30,
        depth: r === 'salt' && pan ? 0 : RESOURCES[RES_INDEX[r]].depth, precise: true });
    }
  }
  log('Wikidata', j.items.length, 'sites →', out.length, 'entries');
  return out;
}

// The same site under the same name in several databases, up to 75 km apart (old databases round coordinates):
// one record at the coordinates of the most trusted source, the largest amount, the shallowest depth.
const SRC_RANK = { Wikidata: 5, 'USGS VMS': 4, 'USGS major': 3, 'USGS potash': 3, MRDS: 1 };
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
    h.amount = Math.max(h.amount, d.amount);
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

// =================================================================== bake one grid
async function bake(grid, inp, deposits) {
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
  const zones = [];
  const fieldW = { bogiron: new Float32Array(N), rarestone: new Float32Array(N), salt: new Float32Array(N) };
  for (let c = 0; c < N; c++) {
    const a = grid.areaKm2(c) / 100;
    put('fish', c, fishOf(f, c) * a, 0);
    put('wood', c, woodOf(f, c) * a, 0);
    put('stone', c, stoneOf(f, c) * a, 0);
    put('clay', c, clayOf(f, c) * a, 0);
    put('salt', c, saltPanOf(f, c) * a, 0);
    fieldW.bogiron[c] = bogIronOf(f, c);
    fieldW.rarestone[c] = f.land[c] * (1 - f.ice[c]) * byRock(f.glim[c], RARE_FIELDS, 0);
    fieldW.salt[c] = f.land[c] * (f.glim[c].ev ?? 0);
  }
  // fields: chance per 10 × 10 km chunk; a coarse cell gets the expected value instead (see docs)
  const FIELDS = [
    { id: 'field:bogiron', res: 'bogiron', chance: 0.35, amount: 8, depth: 0, about: 'болотная руда в сырых низинах прохладного влажного климата' },
    { id: 'field:rarestone', res: 'rarestone', chance: 0.06, amount: 10, depth: 0, about: 'кремень в известняках и мелу, обсидиан в кислых вулканитах, мрамор в метаморфических породах, алебастр в эвапоритах' },
    { id: 'field:salt', res: 'salt', chance: 0.05, amount: 20, depth: 1, about: 'соляные пласты и источники в толщах эвапоритов' },
  ];
  // album: bog iron follows the swamp aspect — every iron-bearing mire holds some, the world seed decides how much
  if (grid.bogIron) {
    const iron = await grid.bogIron(), cells = [], weights = [];
    for (let c = 0; c < N; c++) if (iron[c] > 0) { cells.push(c); weights.push(Math.max(1, Math.round(clamp(iron[c]) * 255))); }
    zones.push({ id: 'rich:bogiron', res: 'bogiron', kind: 'rich', amount: 15, depth: 0, src: 'часть альбома «Болота»: swampIron()',
      about: 'болотная руда в пресных болотах влажного климата выше досягаемости моря (правило части «Болота»)', cells, weights });
  }
  for (const fd of FIELDS) {
    const w = fieldW[fd.res];
    if (fd.res === 'bogiron' && grid.bogIron) continue;
    if (grid.name === 'album') {
      const cells = [], weights = [];
      for (let c = 0; c < N; c++) if (w[c] > 0.02) { cells.push(c); weights.push(Math.max(1, Math.round(clamp(w[c]) * 255))); }
      if (cells.length) zones.push({ ...fd, kind: 'field', cells, weights });
    } else {
      for (let c = 0; c < N; c++) put(fd.res, c, w[c] * fd.chance * fd.amount * grid.areaKm2(c) / 100, fd.depth);
    }
  }
  // deposits
  const inGrid = deposits.filter(d => grid.inBox(d.lat, d.lon) && grid.cellOf(d.lat, d.lon) >= 0);
  const exact = cluster(mergeByName(inGrid.filter(d => d.precise)), grid.name === 'album' ? 5 : 10);
  const vague = inGrid.filter(d => !d.precise);
  const list = [];
  for (const d of exact) {
    const c = grid.cellOf(d.lat, d.lon);
    put(d.res, c, d.amount, d.depth);
    list.push({ id: d.ids[0], res: d.res, name: d.name, lat: +d.lat.toFixed(4), lon: +d.lon.toFixed(4), cell: c,
      amount: d.amount, depth: d.depth, src: d.srcs.join(', ') });
  }
  // place known only roughly: a zone of land cells within 250 km, one piece
  const landCellsNear = (lat, lon, km, needLand = true) => {
    const cells = [];
    const dLat = km / 111, dLon = km / (111 * Math.max(0.2, Math.cos(lat * D)));
    for (let y = lat - dLat; y <= lat + dLat; y += grid.name === 'album' ? 0.05 : 0.5) {
      for (let x = lon - dLon; x <= lon + dLon; x += grid.name === 'album' ? 0.05 : 0.5) {
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
    zones.push({ id: 'vague:' + v.ids[0] + ':' + v.res, res: v.res, kind: 'zone', pieces: 1, amount: v.amount, depth: v.depth,
      about: `${v.name}: в источнике только условная точка (центр страны или района)`, src: v.src,
      cells, weights: cells.map(() => 255) });
  }
  // basins around known coal, oil and gas: half as much again, not yet found, somewhere within 60 km
  for (const res of ['coal', 'oil', 'gas']) {
    const known = exact.filter(d => d.res === res);
    for (const b of cluster(known.map(d => ({ ...d })), 60)) {
      const members = known.filter(d => kmBetween(d.lat, d.lon, b.lat, b.lon) <= 60);
      const total = members.reduce((s, d) => s + d.amount, 0);
      const cells = landCellsNear(b.lat, b.lon, 60, res === 'coal');
      if (!cells.length) continue;
      zones.push({ id: `basin:${res}:${strHash(b.ids[0]).toString(36)}`, res, kind: 'zone',
        pieces: Math.max(1, Math.round(members.length / 2)), amount: Math.round(total / 2), depth: 2,
        about: `${RESOURCES[RES_INDEX[res]].name}: неразведанная часть бассейна у «${b.name}»`, src: b.srcs.join(', '),
        cells, weights: cells.map(() => 255) });
    }
  }
  // world: zones are counted in as expected values, so the coarse table already shows them
  if (grid.name === 'world') {
    for (const z of zones) {
      const each = z.amount / z.cells.length; // a zone's amount is its whole amount, split among its pieces
      for (const c of z.cells) put(z.res, c, each, z.depth);
    }
  }
  // pack
  const bytes = new Uint8Array(R * N * 3);
  const a16 = new Uint16Array(bytes.buffer, 0, R * N);
  for (let k = 0; k < R * N; k++) {
    a16[k] = Math.min(65535, Math.round(amount[k]));
    if (a16[k] === 0) depth[k] = 255;
  }
  bytes.set(depth, R * N * 2);
  const stats = {};
  RESOURCES.forEach((r, k) => {
    let s = 0, n = 0, mx = 0;
    for (let c = 0; c < N; c++) { const v = a16[k * N + c]; s += v; if (v) n++; if (v > mx) mx = v; }
    stats[r.id] = { total: s, cells: n, max: mx };
  });
  const meta = {
    format: 'passionaris-resources', version: 1, grid: grid.meta,
    file: `${grid.name}.bin.gz`,
    layers: { amount: 'Uint16 little-endian [resource][row][col], units (docs/RESOURCES.md)',
      depth: 'Uint8 [resource][row][col] after the amounts: 0 surface, 1 shallow, 2 deep, 255 nothing' },
    resources: RESOURCES.map(({ id, name, kind, depth: d, era }) => ({ id, name, kind, depth: d, era })),
    stats, baked: new Date().toISOString().slice(0, 10),
    sources: 'data/sources/resources.md',
    zonesNote: grid.name === 'album'
      ? 'zones are NOT in the table: place them with scatterZone()/withZones() from scripts/resources/lib.mjs and the world seed'
      : 'zones are already in the table as expected values (coarse grid); exact placement is done on the chunk grid',
  };
  if (grid.name === 'album') { meta.deposits = list; meta.zones = zones; }
  else {
    meta.deposits = list.filter(d => d.amount >= 100);
    meta.depositsNote = 'only deposits of 100 units and more (large and giant)';
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${grid.name}.bin.gz`), gzip(bytes));
  fs.writeFileSync(path.join(OUT, `${grid.name}.json`), JSON.stringify(meta));
  const kb = f2 => (fs.statSync(path.join(OUT, f2)).size / 1024).toFixed(0) + ' KB';
  log(grid.name, '→', kb(`${grid.name}.bin.gz`), '+', kb(`${grid.name}.json`), '|', list.length, 'deposits,', zones.length, 'zones');
  for (const r of RESOURCES) log('  ', r.id.padEnd(10), JSON.stringify(stats[r.id]));
}

// =================================================================== main
const inp = { climate: loadClimate(), biome: loadBiome(), glim: loadGlim(), rivers: loadRivers() };
const deposits = [...mrdsDeposits(), ...majorDeposits(), ...vmsDeposits(), ...potashDeposits(), ...wikidataDeposits()]
  .filter(d => isFinite(d.lat) && isFinite(d.lon) && Math.abs(d.lat) <= 90 && Math.abs(d.lon) <= 180);
for (const t of TARGETS) {
  const grid = t === 'album' ? albumGrid() : t === 'world' ? worldGrid() : null;
  if (!grid) throw new Error('unknown target ' + t);
  await bake(grid, { ...inp, chl: loadChl(t === 'album' ? 'album-' : 'world') }, deposits);
}
log('done');
