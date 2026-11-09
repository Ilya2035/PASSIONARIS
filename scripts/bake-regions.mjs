// Passionaris regions bake: natural districts (~100 km, between rivers, mountain
// massifs and lakes separate), sea zones, provinces (~500 km), regions (~1000 km)
// and a preliminary road network. Not based on modern countries or cities.
//
// Inputs : public/assets/map/{cells.bin.gz, height.delta.bin.gz},
//          data/raw/ne_10m_rivers_lake_centerlines.geojson, data/raw/ne_10m_lakes.geojson,
//          data/raw/regions/*.geojson (optional, see scripts/regions/download.mjs)
// Outputs: public/assets/regions/{districts.bin.gz, regions.json, roads.bin.gz, roads.json}
//          data/raw/regions/previews/*.png
//
// Run: tools/node/node.exe --max-old-space-size=8192 scripts/bake-regions.mjs [--no-previews]
import fs from 'node:fs';
import path from 'node:path';
import { makeGrid, readGz, typedOf, loadHeight, writeGz, unitOf, EARTH_KM } from './regions/grid.mjs';
import { rasterRivers, rasterGeography, rasterMarine, rasterLakes } from './regions/features.mjs';
import { mountainMask } from './regions/terrain.mjs';
import { partitionWorld, DEFAULTS } from './regions/stage-partition.mjs';
import { T_LAND, T_MOUNT, T_LAKE, T_SEA, TYPE_NAMES, isLandType, adjacency, UnionFind, mergeSmall, mergeIslets, districtStats, fillFromLand } from './regions/districts.mjs';
import { groupGraph } from './regions/group.mjs';
import { collectEvidence, nameDistricts, nameGroups } from './regions/naming.mjs';
import { featureGender } from './regions/names.mjs';
import { buildCostGrid, buildRoads, ROAD_DEFAULTS } from './regions/roads.mjs';
import { renderPreview } from './regions/preview.mjs';
import { components } from './regions/grid.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const P = (...a) => path.join(ROOT, ...a);
const OUT = P('public', 'assets', 'regions');
const PREV = P('data', 'raw', 'regions', 'previews');
const args = new Set(process.argv.slice(2));
const W = 8192, H = 4096;
const PROVINCE_KM2 = 250000, REGION_KM2 = 1000000;
const SEA_PROVINCE_ZONES = 6, SEA_REGION_PROVINCES = 4;

const t0 = Date.now();
const timings = {};
let tStage = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const stage = name => { timings[name] = +((Date.now() - tStage) / 1000).toFixed(1); tStage = Date.now(); };

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PREV, { recursive: true });
const grid = makeGrid(W, H);
const { N } = grid;

// ------------------------------------------------------------------ 1. inputs
const cells = typedOf(readGz(P('public', 'assets', 'map', 'cells.bin.gz')), Uint32Array);
const height = loadHeight(P('public', 'assets', 'map', 'height.delta.bin.gz'), W, H);
if (cells.length !== N || height.length !== N) throw new Error('unexpected MAP grid size');
log('map loaded');
const rv = rasterRivers(grid, {
  main: P('data', 'raw', 'ne_10m_rivers_lake_centerlines.geojson'),
  extra: [P('data', 'raw', 'regions', 'ne_10m_rivers_europe.geojson'), P('data', 'raw', 'regions', 'ne_10m_rivers_north_america.geojson')],
});
log('rivers', rv.stats);
const geo = rasterGeography(grid, P('data', 'raw', 'regions', 'ne_10m_geography_regions_polys.geojson'));
const isWater = new Uint8Array(N);
for (let i = 0; i < N; i++) isWater[i] = cells[i] < 2 ? 1 : 0;
const marine = rasterMarine(grid, P('data', 'raw', 'regions', 'ne_10m_geography_marine_polys.geojson'), isWater);
const lakes = rasterLakes(grid, P('data', 'raw', 'ne_10m_lakes.geojson'));
log(`named features: geography ${geo.available ? geo.table.length : 'missing'}, marine ${marine.available ? marine.table.length : 'missing'}, lakes ${lakes.table.length}`);
const landMask = new Uint8Array(N);
for (let i = 0; i < N; i++) landMask[i] = cells[i] >= 2 ? 1 : 0;
const mm = mountainMask(grid, landMask, height);
log('mountains', mm.stats);
stage('inputs');

// ------------------------------------------------------------------ 2. partition
const part = partitionWorld(grid, { cells, height, barrier: rv.barrier, minor: rv.minor, mountain: mm.mountain }, {}, log);
stage('partition');
let { did, D, type, comp, target } = part;
const dLand = part.dLand;

// any land texel still unassigned (isolated river-only islets): own districts
{
  const cls = new Int8Array(N).fill(-1);
  let n = 0;
  for (let i = 0; i < N; i++) if (did[i] === 0 && cells[i] >= 2) { cls[i] = 0; n++; }
  if (n) {
    const cc = components(grid, cls);
    const nt = new Uint8Array(D + cc.count), nc = new Int32Array(D + cc.count).fill(-1), ng = new Float64Array(D + cc.count);
    nt.set(type); nc.set(comp); ng.set(target);
    for (let c = 0; c < cc.count; c++) { nt[D + c] = T_LAND; ng[D + c] = DEFAULTS.landKm2; }
    for (let i = 0; i < N; i++) if (cls[i] === 0) did[i] = D + cc.comp[i];
    type = nt; comp = nc; target = ng; D += cc.count;
    log(`orphan land texels: ${n} in ${cc.count} components`);
  }
  let water0 = 0;
  for (let i = 0; i < N; i++) if (did[i] === 0) water0++;
  if (water0) {
    // leftover water texels (should not happen): take any neighbouring district
    const all = new Uint8Array(N);
    for (let i = 0; i < N; i++) all[i] = did[i] === 0 ? 1 : 0;
    const anyType = new Uint8Array(D).fill(T_LAND);
    fillFromLand(grid, did, all, anyType);
    log(`leftover unassigned texels filled: ${water0}`);
  }
}

// ------------------------------------------------------------------ 3. merge slivers and islets
{
  const area = new Float64Array(D);
  for (let i = 0; i < N; i++) area[did[i]] += grid.areaKm2[(i - i % W) / W];
  const adj = adjacency(grid, did, rv.barrier);
  const uf = new UnionFind(D);
  const ms = mergeSmall(D, type, comp, area, target, adj, uf, { minShare: 0.25 });
  for (let i = 0; i < N; i++) did[i] = uf.find(did[i]);
  const mi = mergeIslets(grid, did, D, type, area, target, ms.nb, uf);
  for (let i = 0; i < N; i++) did[i] = uf.find(did[i]);
  // single land texels cut off from their district (diagonal-only growth at river
  // crossings) and enclosed by one other land district join that district
  let enclaves = 0;
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x, p = did[i];
      if (!isLandType(type[p])) continue;
      const q = did[row + (x + 1) % W];
      if (q === p || !isLandType(type[q])) continue;
      if (did[row + (x + W - 1) % W] === q && did[i - W] === q && did[i + W] === q) { did[i] = q; enclaves++; }
    }
  }
  log(`merged: ${ms.merged} slivers, ${mi} islets, ${enclaves} single-texel enclaves`);
}
// compact ids 1..K
let K = 0;
const tmpOf = new Int32Array(D);
{
  const present = new Uint8Array(D);
  for (let i = 0; i < N; i++) present[did[i]] = 1;
  for (let s = 1; s < D; s++) if (present[s]) tmpOf[s] = ++K;
  for (let i = 0; i < N; i++) did[i] = tmpOf[did[i]];
}
const KD = K + 1;
const kType = new Uint8Array(KD), kComp = new Int32Array(KD).fill(-1), kTarget = new Float64Array(KD);
for (let s = 1; s < D; s++) if (tmpOf[s]) { kType[tmpOf[s]] = type[s]; kComp[tmpOf[s]] = comp[s]; kTarget[tmpOf[s]] = target[s]; }
stage('merge');
log(`districts after merge: ${K}`);

// ------------------------------------------------------------------ 4. statistics + adjacency
const st = districtStats(grid, did, KD, height, mm.relief);
const adj = adjacency(grid, did, rv.barrier);
const nbList = Array.from({ length: KD }, () => []);
for (let k = 0; k < adj.count; k++) {
  const e = adj.plain[k] + adj.river[k];
  nbList[adj.a[k]].push([adj.b[k], e, adj.river[k]]);
  nbList[adj.b[k]].push([adj.a[k], e, adj.river[k]]);
}
for (const l of nbList) l.sort((p, q) => p[0] - q[0]);
const anchorLon = new Float64Array(KD), anchorLat = new Float64Array(KD);
for (let d = 1; d < KD; d++) {
  const t = st.anchor[d];
  const x = t % W, y = (t - x) / W;
  anchorLon[d] = grid.colLon[x]; anchorLat[d] = grid.rowLat[y];
}
stage('stats');

// ------------------------------------------------------------------ 5. provinces and regions
const angKm = (a, b) => {
  const d = st.vx[a] * st.vx[b] + st.vy[a] * st.vy[b] + st.vz[a] * st.vz[b];
  return Math.acos(Math.max(-1, Math.min(1, d))) * EARTH_KM;
};
const iceDiv = d => Math.max(1, kTarget[d] / DEFAULTS.landKm2);
function buildGraph(ids, weightOf, edgeCost) {
  const idx = new Map(ids.map((d, k) => [d, k]));
  const n = ids.length;
  const g = { n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), weight: new Float64Array(n), adj: Array.from({ length: n }, () => []) };
  ids.forEach((d, k) => {
    g.x[k] = st.vx[d]; g.y[k] = st.vy[d]; g.z[k] = st.vz[d]; g.weight[k] = weightOf(d);
    for (const [e, edges, river] of nbList[d]) {
      const j = idx.get(e);
      if (j === undefined) continue;
      g.adj[k].push([j, edgeCost(d, e, edges, river), edges]);
    }
  });
  return g;
}
const landIds = [], seaIds = [], lakeIds = [];
for (let d = 1; d < KD; d++) {
  if (isLandType(kType[d])) landIds.push(d);
  else if (kType[d] === T_SEA) seaIds.push(d);
  else lakeIds.push(d);
}
const provOf = new Int32Array(KD), regOf = new Int32Array(KD);
let provinces = [], regions = [];
{
  // land provinces
  const g = buildGraph(landIds, d => st.area[d] / iceDiv(d), (a, b, edges, river) => {
    const ma = kType[a] === T_MOUNT, mb = kType[b] === T_MOUNT;
    const pen = ma !== mb ? 2.2 : ma ? 1.3 : 1;
    return Math.max(1, angKm(a, b)) * pen * (river > edges * 0.5 ? 1.15 : 1);
  });
  // islands of >= 30 % of the target (Ireland, Hokkaido) form their own provinces
  // instead of being attached across the sea
  const gp = groupGraph(g, { target: PROVINCE_KM2, attachKm: 500, smallShare: 0.3 });
  const landP = gp.count;
  landIds.forEach((d, k) => { provOf[d] = gp.group[k] + 1; });
  // sea provinces
  const gs = buildGraph(seaIds, () => 1, (a, b) => Math.max(1, angKm(a, b)));
  const sp = groupGraph(gs, { target: SEA_PROVINCE_ZONES, attachKm: 800, smallShare: 0.2, minShare: 0.25 });
  seaIds.forEach((d, k) => { provOf[d] = landP + sp.group[k] + 1; });
  const PC = landP + sp.count;
  // lakes join the province of their main land neighbour
  for (const d of lakeIds) {
    let best = -1, be = -1;
    for (const [e, edges] of nbList[d]) if (isLandType(kType[e]) && edges > be) { be = edges; best = e; }
    if (best < 0) {
      let bd = Infinity;
      for (const e of landIds) { const km = angKm(d, e); if (km < bd) { bd = km; best = e; } }
    }
    provOf[d] = provOf[best];
  }
  // province records
  provinces = Array.from({ length: PC + 1 }, (_, p) => p === 0 ? null : { id: p, type: p <= landP ? 'land' : 'sea', districts: [], area: 0, w: 0, vx: 0, vy: 0, vz: 0, nb: new Map() });
  for (let d = 1; d < KD; d++) {
    const pr = provinces[provOf[d]];
    pr.districts.push(d); pr.area += st.area[d];
    const w = st.area[d];
    pr.vx += w * st.vx[d]; pr.vy += w * st.vy[d]; pr.vz += w * st.vz[d];
    if (isLandType(kType[d])) pr.w += st.area[d] / iceDiv(d);
  }
  for (let k = 0; k < adj.count; k++) {
    const p = provOf[adj.a[k]], q = provOf[adj.b[k]];
    if (p === q) continue;
    const e = adj.plain[k] + adj.river[k];
    provinces[p].nb.set(q, (provinces[p].nb.get(q) || 0) + e);
    provinces[q].nb.set(p, (provinces[q].nb.get(p) || 0) + e);
  }
  // regions: group provinces
  const landProvIds = [], seaProvIds = [];
  for (let p = 1; p <= PC; p++) (provinces[p].type === 'land' ? landProvIds : seaProvIds).push(p);
  const provGraph = (ids, weightOf) => {
    const idx = new Map(ids.map((p, k) => [p, k]));
    const n = ids.length;
    const g = { n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), weight: new Float64Array(n), adj: Array.from({ length: n }, () => []) };
    ids.forEach((p, k) => {
      const pr = provinces[p], r = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
      g.x[k] = pr.vx / r; g.y[k] = pr.vy / r; g.z[k] = pr.vz / r; g.weight[k] = weightOf(p);
    });
    ids.forEach((p, k) => {
      for (const [q, e] of provinces[p].nb) {
        const j = idx.get(q);
        if (j === undefined) continue;
        const dd = g.x[k] * g.x[j] + g.y[k] * g.y[j] + g.z[k] * g.z[j];
        g.adj[k].push([j, Math.max(1, Math.acos(Math.max(-1, Math.min(1, dd))) * EARTH_KM), e]);
      }
    });
    return g;
  };
  // land masses of >= 20 % of the target (Great Britain + Ireland, Honshu) form their
  // own regions instead of joining the nearest mainland region across the sea
  const rg = groupGraph(provGraph(landProvIds, p => provinces[p].w), { target: REGION_KM2, attachKm: 900, iterations: 10, smallShare: 0.2 });
  const rs = groupGraph(provGraph(seaProvIds, () => 1), { target: SEA_REGION_PROVINCES, attachKm: 1500, iterations: 10, smallShare: 0.2, minShare: 0.25 });
  const landR = rg.count;
  landProvIds.forEach((p, k) => { provinces[p].region = rg.group[k] + 1; });
  seaProvIds.forEach((p, k) => { provinces[p].region = landR + rs.group[k] + 1; });
  const RC = landR + rs.count;
  regions = Array.from({ length: RC + 1 }, (_, r) => r === 0 ? null : { id: r, type: r <= landR ? 'land' : 'sea', provinces: [], area: 0, vx: 0, vy: 0, vz: 0, nb: new Map() });
  for (let p = 1; p <= PC; p++) {
    const pr = provinces[p], rr = regions[pr.region];
    rr.provinces.push(p); rr.area += pr.area; rr.vx += pr.vx; rr.vy += pr.vy; rr.vz += pr.vz;
    for (const [q, e] of pr.nb) {
      const r2 = provinces[q].region;
      if (r2 !== pr.region) rr.nb.set(r2, (rr.nb.get(r2) || 0) + e);
    }
  }
  for (let d = 1; d < KD; d++) regOf[d] = provinces[provOf[d]].region;
  log(`provinces: ${landP} land + ${sp.count} sea; regions: ${landR} land + ${rs.count} sea`);
}
stage('grouping');

// ------------------------------------------------------------------ 6. names
const ev = collectEvidence(grid, did, kType, rv, geo, marine, lakes);
const info = [];
for (let d = 1; d < KD; d++) {
  const landNb = [], waterNb = [];
  for (const [e, edges] of nbList[d]) (isLandType(kType[e]) ? landNb : waterNb).push([e, edges]);
  waterNb.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  info[d] = { type: kType[d], lon: anchorLon[d], lat: anchorLat[d], area: st.area[d], meanH: st.meanH[d], meanR: st.meanR[d], count: st.count[d], landNb, waterNb };
}
const dNames = nameDistricts(KD, info, ev, rv, geo, marine, lakes);
// group names from member votes
const riverByEn = new Map();
for (const r of rv.names) if (!riverByEn.has(r.en)) riverByEn.set(r.en, r);
const votesOfDistrict = d => {
  const it = dNames[d], a = st.area[d] / iceDiv(d);
  const out = [];
  const key = it.key;
  if (kType[d] === T_SEA) {
    const tp = ev.sea.get(d)?.[0];
    const m = tp && marine.table[tp[0]];
    out.push([m && m.ru ? { ru: m.ru, en: m.en, kind: 'sea' } : null, 1]);
    return out;
  }
  const ft = ev.feature.get(d)?.[0];
  const f = ft && geo.table[ft[0]];
  const share = ft ? ft[1] / st.count[d] : 0;
  if (f && f.ru && share >= 0.3) out.push([{ ru: f.ru, en: f.en, kind: 'feature', gender: featureGender(f.ru, f.cls) }, a * share]);
  const rgt = ev.range.get(d)?.[0];
  const r = rgt && geo.table[rgt[0]];
  const rshare = rgt ? rgt[1] / st.count[d] : 0;
  // a named range is more specific than the plateau / geoarea polygons around it
  if (r && r.ru && rshare >= 0.15) out.push([{ ru: r.ru, en: r.en, kind: 'range', gender: featureGender(r.ru, r.cls) }, a * Math.min(1, rshare * 1.6)]);
  const m = /^(interfluve|valley):([^:#]+)(?::([^#]+))?/.exec(key);
  if (m) {
    const riv = [m[2], m[3]].filter(Boolean);
    for (const en of riv) {
      const rn = riverByEn.get(en);
      if (rn) out.push([{ ru: `Поречье ${rn.gen}`, en: rn.en, kind: 'river', gender: 'n', commonHead: true }, a * (riv.length === 2 ? 0.45 : 0.7)]);
    }
  }
  const used = out.reduce((s, v) => s + v[1], 0);
  if (used < a) out.push([null, a - Math.min(a, used)]);
  return out;
};
{
  // Label point of a group: the anchor of the member district closest to the
  // area-weighted centroid, so it always lies inside the group (a plain centroid
  // falls outside crescent-shaped groups and island chains).
  const aU = new Float64Array(KD * 3);
  for (let d = 1; d < KD; d++) { const u = unitOf(anchorLon[d], anchorLat[d]); aU[3 * d] = u[0]; aU[3 * d + 1] = u[1]; aU[3 * d + 2] = u[2]; }
  const groupAnchor = (members, vx, vy, vz) => {
    let best = -1, bd = -Infinity;
    for (const d of members) {
      if (kType[d] === T_LAKE) continue;
      const dot = vx * aU[3 * d] + vy * aU[3 * d + 1] + vz * aU[3 * d + 2];
      if (dot > bd || (dot === bd && d < best)) { bd = dot; best = d; }
    }
    if (best < 0) best = members[0];
    return [anchorLon[best], anchorLat[best]];
  };
  const pg = provinces.slice(1).map(pr => {
    const [lon, lat] = groupAnchor(pr.districts, pr.vx, pr.vy, pr.vz);
    return { lon, lat, votes: pr.districts.filter(d => kType[d] !== T_LAKE).flatMap(votesOfDistrict) };
  });
  const landPg = pg.filter((_, k) => provinces[k + 1].type === 'land'), seaPg = pg.filter((_, k) => provinces[k + 1].type === 'sea');
  const ln = nameGroups(landPg, null, 'Провинция', 'province', { minShare: 0.3, riverShare: 0.12, fallbackGender: 'f' });
  const sn = nameGroups(seaPg, null, 'Морская провинция', 'seaprovince', { minShare: 0.3, fallbackGender: 'f' });
  let li = 0, si = 0;
  for (let p = 1; p < provinces.length; p++) {
    const nm = provinces[p].type === 'land' ? ln[li++] : sn[si++];
    provinces[p].nameRu = nm.nameRu; provinces[p].nameKey = nm.nameKey;
    provinces[p].lon = pg[p - 1].lon; provinces[p].lat = pg[p - 1].lat;
  }
  const rgp = regions.slice(1).map(rr => {
    const members = rr.provinces.flatMap(p => provinces[p].districts);
    const [lon, lat] = groupAnchor(members, rr.vx, rr.vy, rr.vz);
    return { lon, lat, votes: members.filter(d => kType[d] !== T_LAKE).flatMap(votesOfDistrict) };
  });
  const lr = nameGroups(rgp.filter((_, k) => regions[k + 1].type === 'land'), null, 'Регион', 'region', { minShare: 0.22, riverShare: 0.1, looseShare: 0.12, fallbackGender: 'm' });
  const sr = nameGroups(rgp.filter((_, k) => regions[k + 1].type === 'sea'), null, 'Морской регион', 'searegion', { minShare: 0.22, looseShare: 0.12, fallbackGender: 'm' });
  li = 0; si = 0;
  for (let r = 1; r < regions.length; r++) {
    const nm = regions[r].type === 'land' ? lr[li++] : sr[si++];
    regions[r].nameRu = nm.nameRu; regions[r].nameKey = nm.nameKey;
    regions[r].lon = rgp[r - 1].lon; regions[r].lat = rgp[r - 1].lat;
  }
}
stage('names');
log('names done');

// ------------------------------------------------------------------ 7. final ids (type -> region -> province -> north-west first)
const typeRank = t => t === T_SEA ? 2 : t === T_LAKE ? 1 : 0;
const order = [];
for (let d = 1; d < KD; d++) order.push(d);
order.sort((a, b) => typeRank(kType[a]) - typeRank(kType[b]) || regOf[a] - regOf[b] || provOf[a] - provOf[b] || anchorLat[b] - anchorLat[a] || anchorLon[a] - anchorLon[b] || a - b);
if (order.length > 65535) throw new Error(`too many districts for Uint16: ${order.length}`);
const finalOf = new Int32Array(KD);
order.forEach((d, k) => { finalOf[d] = k + 1; });
const map16 = new Uint16Array(N);
for (let i = 0; i < N; i++) map16[i] = finalOf[did[i]];
const r3 = v => Math.round(v * 1000) / 1000;
const districts = order.map(d => ({
  id: finalOf[d],
  type: TYPE_NAMES[kType[d]],
  lon: r3(anchorLon[d]), lat: r3(anchorLat[d]),
  areaKm2: Math.round(st.area[d]),
  elevM: Math.round(st.meanH[d]),
  neighbors: nbList[d].map(([e]) => finalOf[e]).sort((p, q) => p - q),
  province: provOf[d], region: regOf[d],
  nameRu: dNames[d].nameRu, nameKey: dNames[d].nameKey,
  ...(dNames[d].reservoir ? { reservoir: true } : {}),
}));
const provOut = provinces.slice(1).map(pr => ({
  id: pr.id, type: pr.type, lon: r3(pr.lon), lat: r3(pr.lat), areaKm2: Math.round(pr.area),
  districts: pr.districts.map(d => finalOf[d]).sort((p, q) => p - q),
  neighbors: [...pr.nb.keys()].sort((p, q) => p - q), region: pr.region, nameRu: pr.nameRu, nameKey: pr.nameKey,
}));
const regOut = regions.slice(1).map(rr => ({
  id: rr.id, type: rr.type, lon: r3(rr.lon), lat: r3(rr.lat), areaKm2: Math.round(rr.area),
  provinces: rr.provinces.slice().sort((p, q) => p - q), neighbors: [...rr.nb.keys()].sort((p, q) => p - q),
  nameRu: rr.nameRu, nameKey: rr.nameKey,
}));
stage('ids');

// ------------------------------------------------------------------ 8. roads
const isLandFinal = new Uint8Array(order.length + 1), isMountFinal = new Uint8Array(order.length + 1);
for (const d of order) { isLandFinal[finalOf[d]] = isLandType(kType[d]) ? 1 : 0; isMountFinal[finalOf[d]] = kType[d] === T_MOUNT ? 1 : 0; }
const cg = buildCostGrid(grid, map16, id => isLandFinal[id] === 1, id => isMountFinal[id] === 1, height, rv.barrier, ROAD_DEFAULTS);
const fLon = new Float64Array(order.length + 1), fLat = new Float64Array(order.length + 1);
for (const d of order) { fLon[finalOf[d]] = anchorLon[d]; fLat[finalOf[d]] = anchorLat[d]; }
const pairs = [];
for (let k = 0; k < adj.count; k++) {
  const a = adj.a[k], b = adj.b[k];
  if (!isLandType(kType[a]) || !isLandType(kType[b])) continue;
  if (adj.plain[k] + adj.river[k] < ROAD_DEFAULTS.minBorder) continue;
  const fa = finalOf[a], fb = finalOf[b];
  pairs.push(fa < fb ? [fa, fb] : [fb, fa]);
}
pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
const OPEN_KM = 6;
const segmentOk = (lon0, lat0, lon1, lat1, limitKm = OPEN_KM) => {
  let dl = lon1 - lon0; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  const km = Math.hypot(dl * Math.cos((lat0 + lat1) * Math.PI / 360), lat1 - lat0) * 111.2;
  const n = Math.max(1, Math.ceil(km / 2));
  for (let s = 0; s <= n; s++) {
    let lo = lon0 + dl * s / n; if (lo >= 180) lo -= 360; if (lo < -180) lo += 360;
    const t = grid.texelOf(lo, lat0 + (lat1 - lat0) * s / n);
    if (!isLandFinal[map16[t]] && dLand[t] > limitKm) return false;
  }
  return true;
};
const roadRes = buildRoads(grid, map16, order.length + 1, pairs, fLon, fLat, cg, segmentOk, ROAD_DEFAULTS, log);
stage('roads');

// ------------------------------------------------------------------ 9. write
const sizes = {};
sizes['districts.bin.gz'] = writeGz(path.join(OUT, 'districts.bin.gz'), map16, 9);
{
  let total = 0;
  for (const r of roadRes.roads) total += r.coords.length;
  const buf = new Float32Array(total);
  const index = [];
  let o = 0;
  for (const r of roadRes.roads) {
    buf.set(r.coords, o);
    index.push({ a: r.a, b: r.b, lengthKm: Math.round(r.lengthKm * 10) / 10, offset: o / 2, count: r.coords.length / 2 });
    o += r.coords.length;
  }
  sizes['roads.bin.gz'] = writeGz(path.join(OUT, 'roads.bin.gz'), buf, 9);
  fs.writeFileSync(path.join(OUT, 'roads.json'), JSON.stringify(index));
  sizes['roads.json'] = fs.statSync(path.join(OUT, 'roads.json')).size;
}
const pct = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]); };
const byType = {};
for (const d of districts) (byType[d.type] ||= []).push(d.areaKm2);
const stats = {
  districts: districts.length,
  byType: Object.fromEntries(Object.entries(byType).map(([t, a]) => [t, { count: a.length, p5: pct(a, 0.05), p50: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) }])),
  provinces: { land: provOut.filter(p => p.type === 'land').length, sea: provOut.filter(p => p.type === 'sea').length },
  regions: { land: regOut.filter(r => r.type === 'land').length, sea: regOut.filter(r => r.type === 'sea').length },
  roads: { count: roadRes.roads.length, pairs: pairs.length, failed: roadRes.failed, dropped: roadRes.dropped, unstraightened: roadRes.repaired, fallback: roadRes.fallback, totalKm: Math.round(roadRes.roads.reduce((s, r) => s + r.lengthKm, 0)) },
  partition: part.stats, mountains: mm.stats, rivers: rv.stats,
  params: { ...DEFAULTS, provinceKm2: PROVINCE_KM2, regionKm2: REGION_KM2, seaProvinceZones: SEA_PROVINCE_ZONES, seaRegionProvinces: SEA_REGION_PROVINCES, roads: ROAD_DEFAULTS },
};
// no timestamps / timings in the output: identical inputs give a byte-identical file
const json = {
  version: 1,
  grid: { width: W, height: H, projection: 'equirectangular', origin: 'row 0 = 90N, column 0 = 180W' },
  files: { districts: 'districts.bin.gz (Uint16 W*H, gzip; 0 = unassigned)', roads: 'roads.bin.gz (Float32 lon,lat pairs) + roads.json [{a,b,lengthKm,offset,count}] (offset/count in points)' },
  types: ['land', 'mountain', 'lake', 'sea'],
  districts, provinces: provOut, regions: regOut, stats,
};
fs.writeFileSync(path.join(OUT, 'regions.json'), JSON.stringify(json));
sizes['regions.json'] = fs.statSync(path.join(OUT, 'regions.json')).size;
stage('write');
log('written', Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, `${(v / 1e6).toFixed(2)} MB`])));

// ------------------------------------------------------------------ 10. previews
if (!args.has('--no-previews')) {
  const fType = new Array(order.length + 1), fProv = new Int32Array(order.length + 1), fReg = new Int32Array(order.length + 1);
  for (const d of districts) { fType[d.id] = d.type; fProv[d.id] = d.province; fReg[d.id] = d.region; }
  const layers = {
    did: map16, typeOf: id => fType[id], provOf: id => fProv[id], regOf: id => fReg[id], height, barrier: rv.barrier,
    roads: roadRes.roads.map(r => ({ coords: r.coords })),
  };
  const provLabels = provOut.filter(p => p.type === 'land').map(p => ({ lon: p.lon, lat: p.lat, text: p.nameRu }));
  const distLabels = districts.filter(d => d.type !== 'sea').map(d => ({ lon: d.lon, lat: d.lat, text: d.nameRu }));
  await renderPreview(grid, { ...layers, roads: [], labels: provLabels }, { lon0: -12, lon1: 45, lat0: 34, lat1: 62, scale: 1.5, title: 'Европа — районы (оттенки провинций), регионы (красные границы), реки-границы (синие)' }, path.join(PREV, 'europe.png'));
  await renderPreview(grid, layers, { lon0: -6, lon1: 24, lat0: 42, lat1: 56, scale: 3, title: 'Западная и Центральная Европа — дороги между соседними районами' }, path.join(PREV, 'europe-roads.png'));
  await renderPreview(grid, { ...layers, labels: distLabels }, { lon0: 27.5, lon1: 34.5, lat0: 28.5, lat1: 32.2, scale: 8, title: 'Дельта Нила — районы' }, path.join(PREV, 'nile-delta.png'));
  await renderPreview(grid, { ...layers, roads: [], labels: provLabels }, { lon0: 70, lon1: 100, lat0: 22, lat1: 40, scale: 2, title: 'Гималаи и Тибет — горные районы (оттенки провинций)' }, path.join(PREV, 'himalaya.png'));
  await renderPreview(grid, { ...layers, roads: [] }, { lon0: -180, lon1: 180, lat0: -90, lat1: 90, scale: 0.25, title: 'Мир — районы и морские зоны' }, path.join(PREV, 'world.png'));
  stage('previews');
  log('previews written to', PREV);
}
log('DONE', JSON.stringify({ districts: stats.districts, byType: stats.byType, provinces: stats.provinces, regions: stats.regions, roads: stats.roads, timings }));
