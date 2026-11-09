// Passionaris map baker.
// Turns open data (data/raw) into the game's map assets (public/assets/map):
//   height.bin.gz  Int16 meters, equirectangular W x H (land + bathymetry)
//   cells.bin.gz   Uint32 per cell: 0 = ocean, 1 = lake, >=2 = district id
//   albedo.jpg     surface colour (NASA Blue Marble, June)
//   rivers.bin.gz  Float32 [lon0,lat0,lon1,lat1,...] line segments
//   world.json     countries / provinces / districts tables
//
// Hierarchy: cell (atomic map unit) -> district -> province -> country.
// v0.1 bakes cells at W=8192 (~4.9 km at the equator). The same pipeline is
// meant to run per tile at ~1 km later (see docs/ARCHITECTURE.md).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'assets', 'map');
const W = Number(process.env.MAP_W || 8192);
const H = W / 2;
const TILE_ZOOM = Number(process.env.TILE_ZOOM || 5);
const TARGET_KM2 = Number(process.env.DISTRICT_KM2 || 2000);
const EARTH_KM = 6371.0088;

fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJSON = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

// ---------------------------------------------------------------- helpers
const lonToX = lon => (lon + 180) / 360 * W;
const latToY = lat => (90 - lat) / 180 * H;
const rowLat = y => 90 - (y + 0.5) * 180 / H;
const texelKm2 = new Float64Array(H);
for (let y = 0; y < H; y++) {
  texelKm2[y] = (2 * Math.PI * EARTH_KM / W) * (Math.PI * EARTH_KM / H) * Math.cos(rowLat(y) * Math.PI / 180);
}

function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

// Even-odd scanline fill of one polygon (outer ring + holes). Fills texels whose
// centres are inside. Calls put(rowStartIndex, x0, x1) per span.
function fillPolygon(rings, put) {
  const edges = [];
  let ymin = Infinity, ymax = -Infinity;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      const ax = lonToX(ring[i][0]), ay = latToY(ring[i][1]);
      const bx = lonToX(ring[i + 1][0]), by = latToY(ring[i + 1][1]);
      if (ay === by) continue;
      const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
      edges.push({ y0, y1, x0, k: (x1 - x0) / (y1 - y0) });
      if (y0 < ymin) ymin = y0;
      if (y1 > ymax) ymax = y1;
    }
  }
  if (!edges.length) return 0;
  edges.sort((a, b) => a.y0 - b.y0);
  let count = 0, next = 0;
  let active = [];
  const r0 = Math.max(0, Math.floor(ymin - 0.5)), r1 = Math.min(H - 1, Math.ceil(ymax));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const yc = r + 0.5;
    while (next < edges.length && edges[next].y0 <= yc) active.push(edges[next++]);
    active = active.filter(e => e.y1 > yc);
    xs.length = 0;
    for (const e of active) if (e.y0 <= yc) xs.push(e.x0 + (yc - e.y0) * e.k);
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      if (xb >= xa) { put(r * W, xa, xb); count += xb - xa + 1; }
    }
  }
  return count;
}

function firstPointTexel(geom) {
  const polys = polygonsOf(geom);
  let best = null, bestLen = -1;
  for (const p of polys) if (p[0].length > bestLen) { bestLen = p[0].length; best = p[0]; }
  if (!best) return -1;
  // centroid of the vertices of the largest ring
  let sx = 0, sy = 0;
  for (const [lon, lat] of best) { sx += lon; sy += lat; }
  const x = Math.min(W - 1, Math.max(0, Math.floor(lonToX(sx / best.length))));
  const y = Math.min(H - 1, Math.max(0, Math.floor(latToY(sy / best.length))));
  return y * W + x;
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------------------------------------------------------------- 1. height
log(`height: terrarium z${TILE_ZOOM} -> ${W}x${H}`);
const TN = 2 ** TILE_ZOOM, TS = 256, MW = TN * TS;
const merc = new Int16Array(MW * MW);
const tiles = [];
for (let ty = 0; ty < TN; ty++) for (let tx = 0; tx < TN; tx++) tiles.push([tx, ty]);
await pool(tiles, 8, async ([tx, ty]) => {
  const file = path.join(RAW, 'terrarium', String(TILE_ZOOM), `${tx}_${ty}.png`);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let py = 0; py < TS; py++) {
    const row = (ty * TS + py) * MW + tx * TS;
    for (let px = 0; px < TS; px++) {
      const o = (py * TS + px) * ch;
      const h = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
      merc[row + px] = Math.max(-11500, Math.min(9000, Math.round(h)));
    }
  }
});
const height = new Int16Array(W * H);
{
  const LAT_MAX = 85.05112878;
  for (let y = 0; y < H; y++) {
    const lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, rowLat(y)));
    const my = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * MW - 0.5;
    const y0 = Math.max(0, Math.min(MW - 1, Math.floor(my))), y1 = Math.min(MW - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, my - y0));
    for (let x = 0; x < W; x++) {
      const mx = (x + 0.5) / W * MW - 0.5;
      const xf = Math.floor(mx), fx = mx - xf;
      const x0 = (xf + MW) % MW, x1 = (xf + 1) % MW;
      const a = merc[y0 * MW + x0], b = merc[y0 * MW + x1], c = merc[y1 * MW + x0], d = merc[y1 * MW + x1];
      height[y * W + x] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
    }
  }
}
log('height done');

// ---------------------------------------------------------------- 2. countries
log('countries');
const ne0 = readJSON('ne_10m_admin_0_countries.geojson');
const countries = [{ id: 0, code: '---', name: '—', color: '#000000' }];
const countryByA3 = new Map();
const countryMap = new Uint16Array(W * H);
for (const f of ne0.features) {
  const p = f.properties;
  const code = p.ADM0_A3 || p.adm0_a3 || p.ISO_A3 || `C${countries.length}`;
  const id = countries.length;
  const mc = Number(p.MAPCOLOR9 || p.mapcolor9 || 1);
  const h = hash32(code);
  // own palette: 9 hue families (keeps neighbours apart via NE map colouring) + per-country jitter
  const hue = ((mc - 1) * 40 + (h % 23) - 11 + 360) % 360;
  const sat = 0.38 + ((h >>> 8) % 20) / 100;
  const lig = 0.46 + ((h >>> 16) % 16) / 100;
  const c = {
    id, code,
    name: p.NAME_RU || p.name_ru || p.NAME || p.name,
    nameEn: p.NAME || p.name,
    color: hslToHex(hue, sat, lig),
    continent: p.CONTINENT || '',
    pixels: 0,
  };
  countries.push(c);
  if (!countryByA3.has(code)) countryByA3.set(code, id);
  for (const poly of polygonsOf(f.geometry)) {
    c.pixels += fillPolygon(poly, (row, x0, x1) => countryMap.fill(id, row + x0, row + x1 + 1));
  }
  if (c.pixels === 0) { const t = firstPointTexel(f.geometry); if (t >= 0) { countryMap[t] = id; c.pixels = 1; } }
}
log(`countries: ${countries.length - 1}`);

// ---------------------------------------------------------------- 3. provinces (admin-1)
log('provinces');
const ne1 = readJSON('ne_10m_admin_1_states_provinces.geojson');
const provinces = [{ id: 0, name: '—', country: 0 }];
const provMap = new Uint16Array(W * H);
for (const f of ne1.features) {
  const p = f.properties;
  const id = provinces.length;
  let country = countryByA3.get(p.adm0_a3) ?? countryByA3.get(p.sov_a3) ?? 0;
  const pr = { id, name: p.name_ru || p.name || p.name_en || `#${id}`, nameEn: p.name_en || p.name || '', country, pixels: 0, type: p.type_en || p.type || '' };
  provinces.push(pr);
  for (const poly of polygonsOf(f.geometry)) {
    pr.pixels += fillPolygon(poly, (row, x0, x1) => provMap.fill(id, row + x0, row + x1 + 1));
  }
  if (pr.pixels === 0) { const t = firstPointTexel(f.geometry); if (t >= 0) { provMap[t] = id; pr.pixels = 1; } }
}
// fix province -> country by majority of the country map under it, when unknown
{
  const votes = new Map();
  for (let i = 0; i < W * H; i++) {
    const pv = provMap[i]; if (!pv || provinces[pv].country) continue;
    const c = countryMap[i]; if (!c) continue;
    const key = pv * 65536 + c; votes.set(key, (votes.get(key) || 0) + 1);
  }
  const best = new Map();
  for (const [key, n] of votes) {
    const pv = Math.floor(key / 65536), c = key % 65536;
    if (!best.has(pv) || best.get(pv)[1] < n) best.set(pv, [c, n]);
  }
  for (const [pv, [c]] of best) provinces[pv].country = c;
}
log(`provinces: ${provinces.length - 1}`);

// ---------------------------------------------------------------- 4. water + land
log('lakes');
const LAKE = 1;
const water = new Uint8Array(W * H); // 0 land/unknown, 1 lake
const neL = readJSON('ne_10m_lakes.geojson');
for (const f of neL.features) for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, (row, x0, x1) => water.fill(LAKE, row + x0, row + x1 + 1));

// land = covered by a country or a province and not a lake
const isLand = i => (countryMap[i] || provMap[i]) && !water[i];

// cells without province (gaps between admin-0 and admin-1) take the nearest
// province of the same country (BFS); leftovers get a synthetic province.
{
  let frontier = [];
  for (let i = 0; i < W * H; i++) if (provMap[i] && !water[i]) frontier.push(i);
  let rounds = 0;
  while (frontier.length && rounds < 64) {
    const nextF = [];
    for (const i of frontier) {
      const x = i % W, y = (i - x) / W, pv = provMap[i], pc = provinces[pv].country;
      const nb = [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j < 0 || provMap[j] || water[j] || !countryMap[j]) continue;
        if (pc && countryMap[j] !== pc) continue;
        provMap[j] = pv; nextF.push(j);
      }
    }
    frontier = nextF; rounds++;
  }
  const synth = new Map();
  for (let i = 0; i < W * H; i++) {
    if (provMap[i] || water[i] || !countryMap[i]) continue;
    const c = countryMap[i];
    if (!synth.has(c)) {
      const id = provinces.length;
      provinces.push({ id, name: countries[c].name, nameEn: countries[c].nameEn, country: c, pixels: 0, type: 'synthetic' });
      synth.set(c, id);
    }
    provMap[i] = synth.get(c);
  }
  if (provinces.length > 65535) throw new Error('too many provinces for Uint16');
  log(`gap fill: ${rounds} rounds, ${synth.size} synthetic provinces`);
}

// ---------------------------------------------------------------- 5. rivers
log('rivers');
const neR = readJSON('ne_10m_rivers_lake_centerlines.geojson');
const riverMask = new Uint8Array(W * H);
const riverSegs = [];
for (const f of neR.features) {
  const g = f.geometry; if (!g) continue;
  const rank = Number(f.properties.scalerank ?? 10);
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [lo0, la0] = line[i], [lo1, la1] = line[i + 1];
      if (Math.abs(lo1 - lo0) > 180) continue;
      riverSegs.push(lo0, la0, lo1, la1, rank);
      if (rank > 9) continue;
      // mark mask (DDA)
      const ax = lonToX(lo0), ay = latToY(la0), bx = lonToX(lo1), by = latToY(la1);
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor(ax + (bx - ax) * s / steps), y = Math.floor(ay + (by - ay) * s / steps);
        if (x >= 0 && x < W && y >= 0 && y < H) riverMask[y * W + x] = 1;
      }
    }
  }
}
log(`river segments: ${riverSegs.length / 5}`);

// ---------------------------------------------------------------- 6. districts
log('districts: seeds');
const provArea = new Float64Array(provinces.length);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x; if (isLand(i)) provArea[provMap[i]] += texelKm2[y];
}
const targetFor = pv => {
  const code = countries[provinces[pv].country]?.code;
  if (code === 'ATA') return TARGET_KM2 * 15;
  if (code === 'GRL') return TARGET_KM2 * 6;
  return TARGET_KM2;
};
const seeds = []; // {cell, prov, city}
const seedAt = new Map();
const addSeed = (cell, prov, city = null) => {
  if (seedAt.has(cell)) { const s = seeds[seedAt.get(cell)]; if (city && !s.city) s.city = city; return; }
  seedAt.set(cell, seeds.length); seeds.push({ cell, prov, city });
};
// cities first (they become district centres and names)
const places = readJSON('ne_10m_populated_places_simple.geojson').features
  .map(f => ({ name: f.properties.name_ru || f.properties.name, nameEn: f.properties.name, pop: Number(f.properties.pop_max || 0), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], cap: Number(f.properties.adm0cap || 0) }))
  .sort((a, b) => b.pop - a.pop);
const cityCell = c => Math.min(H - 1, Math.max(0, Math.floor(latToY(c.lat)))) * W + Math.min(W - 1, Math.max(0, Math.floor(lonToX(c.lon))));
const citiesPerProv = new Map();
for (const c of places) {
  const cell = cityCell(c); if (!isLand(cell)) continue;
  const pv = provMap[cell];
  const n = citiesPerProv.get(pv) || 0;
  const allowed = Math.max(1, Math.round(provArea[pv] / targetFor(pv)));
  if (n >= allowed && c.pop < 1_000_000) continue;
  citiesPerProv.set(pv, n + 1);
  addSeed(cell, pv, c);
}
// jittered equal-area grid for the rest
{
  let rnd = 1234567;
  const rand = () => ((rnd = Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
  const latStepFor = km2 => Math.sqrt(km2) / EARTH_KM * 180 / Math.PI;
  for (const tgt of [TARGET_KM2, TARGET_KM2 * 6, TARGET_KM2 * 15]) {
    const dLat = latStepFor(tgt);
    for (let lat = -90 + dLat / 2; lat < 90; lat += dLat) {
      const dLon = dLat / Math.max(0.02, Math.cos(lat * Math.PI / 180));
      const off = rand() * dLon;
      for (let lon = -180 + off; lon < 180; lon += dLon) {
        const la = lat + (rand() - 0.5) * dLat * 0.7, lo = lon + (rand() - 0.5) * dLon * 0.7;
        const cell = Math.min(H - 1, Math.max(0, Math.floor(latToY(la)))) * W + Math.min(W - 1, Math.max(0, Math.floor(lonToX(lo))));
        if (!isLand(cell)) continue;
        const pv = provMap[cell];
        if (targetFor(pv) !== tgt) continue;
        // keep away from city seeds of the same province
        addSeed(cell, pv);
      }
    }
  }
}
// every province gets at least one seed
{
  const has = new Uint8Array(provinces.length);
  for (const s of seeds) has[s.prov] = 1;
  for (let i = 0; i < W * H; i++) if (isLand(i) && !has[provMap[i]]) { has[provMap[i]] = 1; addSeed(i, provMap[i]); }
}
log(`seeds: ${seeds.length}`);

log('districts: geography-aware growth (multi-source Dijkstra)');
const cells = new Uint32Array(W * H);
for (let i = 0; i < W * H; i++) if (water[i]) cells[i] = LAKE;
const dist = new Float32Array(W * H).fill(Infinity);
// binary heap on typed arrays
let hk = new Float32Array(1 << 22), hv = new Int32Array(1 << 22), hn = 0;
const push = (k, v) => {
  if (hn >= hk.length) { const nk = new Float32Array(hk.length * 2); nk.set(hk); hk = nk; const nv = new Int32Array(hv.length * 2); nv.set(hv); hv = nv; }
  let i = hn++;
  while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
  hk[i] = k; hv[i] = v;
};
const pop = () => {
  const v = hv[0], k = hk[0]; hn--;
  if (hn > 0) {
    const lk = hk[hn], lv = hv[hn]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = lk; hv[i] = lv;
  }
  popK = k; return v;
};
let popK = 0;
seeds.forEach((s, n) => { cells[s.cell] = n + 2; dist[s.cell] = 0; push(0, s.cell); });
const dyKm = Math.PI * EARTH_KM / H;
const SLOPE_K = 25;       // how strongly steep terrain resists district growth
const RIVER_KM = dyKm * 3; // crossing a major river costs ~3 cells
while (hn > 0) {
  const i = pop();
  if (popK > dist[i]) continue;
  const x = i % W, y = (i - x) / W, pv = provMap[i], id = cells[i];
  const dxKm = dyKm * Math.cos(rowLat(y) * Math.PI / 180);
  for (let k = 0; k < 8; k++) {
    const ox = [1, -1, 0, 0, 1, 1, -1, -1][k], oy = [0, 0, 1, -1, 1, -1, 1, -1][k];
    const ny = y + oy; if (ny < 0 || ny >= H) continue;
    const j = ny * W + (x + ox + W) % W;
    if (!isLand(j) || provMap[j] !== pv) continue;
    const dxk = ox * dxKm, dyk = oy * dyKm;
    const step = Math.sqrt(dxk * dxk + dyk * dyk);
    const slope = Math.abs(height[j] - height[i]) / 1000 / step; // km/km
    let cost = step * (1 + SLOPE_K * slope);
    if (riverMask[j] && !riverMask[i]) cost += RIVER_KM;
    const nd = dist[i] + cost;
    if (nd < dist[j]) { dist[j] = nd; cells[j] = id; push(nd, j); }
  }
}
log('districts grown');

// ---------------------------------------------------------------- 7. tables
const D = seeds.length + 2;
const dProv = new Uint16Array(D), dCountry = new Uint16Array(D), dArea = new Float32Array(D);
const sx = new Float64Array(D), sy = new Float64Array(D), sz = new Float64Array(D);
for (let y = 0; y < H; y++) {
  const lat = rowLat(y) * Math.PI / 180, cl = Math.cos(lat), sl = Math.sin(lat);
  for (let x = 0; x < W; x++) {
    const i = y * W + x, id = cells[i]; if (id < 2) continue;
    const lon = ((x + 0.5) / W * 360 - 180) * Math.PI / 180;
    const a = texelKm2[y];
    dArea[id] += a; sx[id] += a * cl * Math.cos(lon); sy[id] += a * cl * Math.sin(lon); sz[id] += a * sl;
  }
}
const dLat = new Float32Array(D), dLon = new Float32Array(D), dName = {};
seeds.forEach((s, n) => {
  const id = n + 2;
  dProv[id] = s.prov; dCountry[id] = provinces[s.prov].country;
  const r = Math.hypot(sx[id], sy[id], sz[id]) || 1;
  dLat[id] = Math.asin(sz[id] / r) * 180 / Math.PI;
  dLon[id] = Math.atan2(sy[id], sx[id]) * 180 / Math.PI;
  if (s.city) dName[id] = s.city.name;
});
// name the remaining districts after the largest city that fell inside them
for (const c of places) {
  const cell = cityCell(c); const id = cells[cell];
  if (id >= 2 && !dName[id]) dName[id] = c.name;
}
for (const pr of provinces) pr.area = Math.round(provArea[pr.id] || 0);

const round2 = a => Array.from(a, v => Math.round(v * 100) / 100);
const world = {
  version: 1,
  generated: new Date().toISOString(),
  grid: { width: W, height: H, projection: 'equirectangular', cellKmAtEquator: +(2 * Math.PI * EARTH_KM / W).toFixed(3) },
  ids: { ocean: 0, lake: 1, firstDistrict: 2 },
  countries: countries.map(c => ({ id: c.id, code: c.code, name: c.name, nameEn: c.nameEn, color: c.color, continent: c.continent })),
  provinces: provinces.map(p => ({ id: p.id, name: p.name, nameEn: p.nameEn, country: p.country, area: p.area, type: p.type })),
  districts: {
    count: D,
    province: Array.from(dProv),
    area: Array.from(dArea, v => Math.round(v)),
    lat: round2(dLat), lon: round2(dLon),
    names: dName,
  },
  capitals: places.filter(p => p.cap).map(p => ({ name: p.name, lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) })),
};

// ---------------------------------------------------------------- 8. write
log('writing');
const gz = (name, typed) => {
  const buf = zlib.gzipSync(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), { level: 6 });
  fs.writeFileSync(path.join(OUT, name), buf);
  log(`  ${name} ${(buf.length / 1e6).toFixed(1)} MB`);
};
// rows are delta-encoded (h[x] - h[x-1]) — compresses ~3x better; the game integrates them back
{
  const delta = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    let prev = 0;
    for (let x = 0; x < W; x++) { const i = y * W + x; delta[i] = height[i] - prev; prev = height[i]; }
  }
  gz('height.delta.bin.gz', delta);
}
gz('cells.bin.gz', cells);
const rv = new Float32Array(riverSegs.length / 5 * 4);
const rr = new Uint8Array(riverSegs.length / 5);
for (let s = 0, n = riverSegs.length / 5; s < n; s++) {
  rv.set(riverSegs.slice(s * 5, s * 5 + 4), s * 4); rr[s] = riverSegs[s * 5 + 4];
}
gz('rivers.bin.gz', rv);
gz('rivers-rank.bin.gz', rr);
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(world));
log(`  world.json ${(fs.statSync(path.join(OUT, 'world.json')).size / 1e6).toFixed(1)} MB`);

sharp.cache(false);
await sharp(path.join(RAW, 'bluemarble_june_21600.jpg'), { limitInputPixels: false })
  .resize(W, H, { kernel: 'lanczos3' }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(OUT, 'albedo.jpg'));
await sharp(path.join(RAW, 'bluemarble_june_21600.jpg'), { limitInputPixels: false })
  .resize(2048, 1024, { kernel: 'lanczos3' }).jpeg({ quality: 88 }).toFile(path.join(OUT, 'albedo-2k.jpg'));
log('albedo done');

const stats = { countries: countries.length - 1, provinces: provinces.length - 1, districts: seeds.length, grid: `${W}x${H}` };
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
log('DONE', stats);
