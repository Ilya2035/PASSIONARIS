// Stage 1 of the regions bake: classify texels, build compartments and run the
// land and water partitions. Returns the raw district map (Int32 ids, 0 = none)
// plus per-id metadata, before merging and naming.
import { components, mulberry32 } from './grid.mjs';
import { lloyd, jitteredPoints, regionStats } from './partition.mjs';
import { iceZone } from './terrain.mjs';
import { distanceKm, seaSideKm } from './water.mjs';
import { T_LAND, T_MOUNT, T_LAKE, T_SEA, fillFromLand } from './districts.mjs';

export const DEFAULTS = {
  seed: 20261110,
  landKm2: 10000,          // district target ~100 x 100 km
  antarcticaFactor: 4,     // ice sheets: larger districts
  greenlandFactor: 2.5,
  mountainChunkKm: 140,    // ranges are cut into chunks ~100-150 km along their length
  lakeMinKm2: 400,         // smaller lakes are absorbed by the surrounding land district
  lakeZoneKm2: 40000,      // big lakes are split like coastal seas
  pocketMaxKm2: 300,       // isolated ocean pockets smaller than this are absorbed by land
  slopeK: 22,              // km of extra cost per km of climb
  crossKm: 9,              // crossing a minor river
  landIterations: 5,
  seaIterations: 3,
};

function iceFactor(o, lon, lat) {
  if (lat < -60) return o.antarcticaFactor;
  if (iceZone(lon, lat)) return o.greenlandFactor;
  return 1;
}

// Principal extent (km) of each component from area-weighted 3D second moments.
function componentLengths(grid, comp, count) {
  const { W, N, areaKm2, cosLat, sinLat, cosLon, sinLon } = grid;
  const S = new Float64Array(count * 10); // a, sx, sy, sz, xx, yy, zz, xy, xz, yz
  for (let i = 0; i < N; i++) {
    const c = comp[i];
    if (c < 0) continue;
    const x = i % W, y = (i - x) / W, a = areaKm2[y];
    const vx = cosLat[y] * sinLon[x], vy = sinLat[y], vz = cosLat[y] * cosLon[x];
    const o = c * 10;
    S[o] += a; S[o + 1] += a * vx; S[o + 2] += a * vy; S[o + 3] += a * vz;
    S[o + 4] += a * vx * vx; S[o + 5] += a * vy * vy; S[o + 6] += a * vz * vz;
    S[o + 7] += a * vx * vy; S[o + 8] += a * vx * vz; S[o + 9] += a * vy * vz;
  }
  const L = new Float64Array(count);
  for (let c = 0; c < count; c++) {
    const o = c * 10, a = S[o];
    if (!a) continue;
    const mx = S[o + 1] / a, my = S[o + 2] / a, mz = S[o + 3] / a;
    const C = [
      S[o + 4] / a - mx * mx, S[o + 7] / a - mx * my, S[o + 8] / a - mx * mz,
      S[o + 7] / a - mx * my, S[o + 5] / a - my * my, S[o + 9] / a - my * mz,
      S[o + 8] / a - mx * mz, S[o + 9] / a - my * mz, S[o + 6] / a - mz * mz,
    ];
    // power iteration for the largest eigenvalue
    let v = [1, 0.7, 0.3], lam = 0;
    for (let k = 0; k < 40; k++) {
      const w = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
      lam = Math.hypot(w[0], w[1], w[2]);
      if (!lam) break;
      v = [w[0] / lam, w[1] / lam, w[2] / lam];
    }
    L[c] = Math.sqrt(12 * Math.max(0, lam)) * 6371.0088;
  }
  return L;
}

// inputs: { cells (Uint32), height, barrier, minor, mountain }
export function partitionWorld(grid, inputs, opts = {}, log = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  const { W, H, N, colLon, rowLat, areaKm2 } = grid;
  const { cells, height, barrier, minor, mountain } = inputs;
  const rng = mulberry32(o.seed);

  // ------------------------------------------------------------ land compartments
  const cls = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (cells[i] >= 2 && !barrier[i]) cls[i] = mountain[i] ? 1 : 0;
  const lc = components(grid, cls);
  log(`land compartments: ${lc.count}`);
  const compIsMount = new Uint8Array(lc.count);
  for (let c = 0; c < lc.count; c++) compIsMount[c] = cls[lc.first[c]] === 1 ? 1 : 0;
  const lens = componentLengths(grid, lc.comp, lc.count);
  const compTarget = new Float64Array(lc.count);
  for (let c = 0; c < lc.count; c++) {
    const f = lc.first[c], fx = f % W, fy = (f - fx) / W;
    const base = o.landKm2 * iceFactor(o, colLon[fx], rowLat[fy]);
    if (compIsMount[c]) {
      const kLen = Math.max(1, Math.round(lens[c] / o.mountainChunkKm));
      const kArea = Math.max(1, Math.round(lc.area[c] / base));
      compTarget[c] = lc.area[c] / Math.max(kLen, kArea);
      compTarget[c] = Math.max(compTarget[c], base * 0.35);
    } else compTarget[c] = base;
  }
  // seeds: jittered grids per target class + one seed for every seedless compartment
  const seedSet = new Set();
  const addPts = (side, accept) => {
    const pts = jitteredPoints(side, rng);
    for (let k = 0; k < pts.length; k += 2) {
      const t = grid.texelOf(pts[k], pts[k + 1]);
      const c = lc.comp[t];
      if (c >= 0 && accept(pts[k], pts[k + 1], c)) seedSet.add(t);
    }
  };
  addPts(Math.sqrt(o.landKm2), (lon, lat) => iceFactor(o, lon, lat) === 1);
  addPts(Math.sqrt(o.landKm2 * o.greenlandFactor), (lon, lat) => iceFactor(o, lon, lat) === o.greenlandFactor);
  addPts(Math.sqrt(o.landKm2 * o.antarcticaFactor), (lon, lat) => iceFactor(o, lon, lat) === o.antarcticaFactor);
  // thin ranges need denser seeds: add points of a finer grid inside mountain compartments
  addPts(Math.sqrt(o.landKm2 * 0.45), (lon, lat, c) => compIsMount[c] && compTarget[c] < o.landKm2 * 0.6 && iceFactor(o, lon, lat) === 1);
  const hasSeed = new Uint8Array(lc.count);
  for (const t of seedSet) hasSeed[lc.comp[t]] = 1;
  {
    const lab = new Int32Array(N);
    for (let i = 0; i < N; i++) lab[i] = lc.comp[i];
    const st = regionStats(grid, lab, new Float32Array(N), lc.count);
    for (let c = 0; c < lc.count; c++) if (!hasSeed[c] && st.best[c] >= 0) seedSet.add(st.best[c]);
  }
  const landSeeds = Int32Array.from([...seedSet].sort((a, b) => a - b));
  log(`land seeds: ${landSeeds.length}`);
  // Float64 distances: a Float32 store would round below the heap key and make
  // the "stale entry" test skip valid expansions.
  const label = new Int32Array(N), dist = new Float64Array(N);
  // Natural-looking borders where no river or ridge decides: growth on the 8-connected grid makes the border
  // between two seeds a straight line at 0/45/90 degrees (blocky region outlines). A smooth deterministic noise
  // on the travel cost (+-28 %, blobs ~45 km and ~110 km) bends those lines into gentle curves.
  const landSpeed = new Float32Array(N);
  {
    const hash = (ix, iy) => {
      let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const vn = (u, v) => {
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const p = hash(ix, iy), q = hash(ix + 1, iy), r = hash(ix, iy + 1), t = hash(ix + 1, iy + 1);
      return p + (q - p) * sx + (r - p) * sy + (p - q - r + t) * sx * sy;
    };
    for (let y = 0; y < H; y++) {
      const lat = grid.rowLat[y], cl = Math.max(0.2, Math.cos(lat * Math.PI / 180));
      for (let x = 0; x < W; x++) {
        const u = grid.colLon[x] * cl * 111 / 45, v = lat * 111 / 45;
        const n = 0.62 * vn(u, v) + 0.38 * vn(u * 0.4 + 17.3, v * 0.4 - 9.1);
        landSpeed[y * W + x] = 0.72 + 0.56 * n;
      }
    }
  }
  const landRun = lloyd(grid, label, dist, {
    comp: lc.comp, seeds: landSeeds, height, slopeK: o.slopeK, cross: minor, crossKm: o.crossKm, speed: landSpeed,
    targetOf: (t, c) => compTarget[c], iterations: o.landIterations, splitK: 1.8, dropK: 0.3, log,
  });
  const S_land = landRun.seeds.length;
  // raw district ids: land 1..S_land
  const did = new Int32Array(N);
  for (let i = 0; i < N; i++) if (label[i] >= 0) did[i] = label[i] + 1;
  const landSeedTexel = landRun.seeds;

  // ------------------------------------------------------------ water compartments
  const wcls = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (cells[i] === 0) wcls[i] = 0; else if (cells[i] === 1) wcls[i] = 1;
  const wc = components(grid, wcls);
  const absorb = new Uint8Array(N);
  const wcomp = new Int32Array(N).fill(-1);
  const wIsLake = new Uint8Array(wc.count), wKeep = new Uint8Array(wc.count);
  let lakesAbsorbed = 0, pocketsAbsorbed = 0;
  for (let c = 0; c < wc.count; c++) {
    wIsLake[c] = wcls[wc.first[c]] === 1 ? 1 : 0;
    const thr = wIsLake[c] ? o.lakeMinKm2 : o.pocketMaxKm2;
    if (wc.area[c] >= thr) wKeep[c] = 1; else if (wIsLake[c]) lakesAbsorbed++; else pocketsAbsorbed++;
  }
  for (let i = 0; i < N; i++) {
    if (cells[i] >= 2) { if (barrier[i]) absorb[i] = 1; continue; }
    const c = wc.comp[i];
    if (wKeep[c]) wcomp[i] = c; else absorb[i] = 1;
  }
  log(`water compartments: ${wc.count} (lakes absorbed ${lakesAbsorbed}, ocean pockets absorbed ${pocketsAbsorbed})`);
  // distance from land for sea-zone sizing
  const landSrc = new Uint8Array(N);
  for (let i = 0; i < N; i++) landSrc[i] = cells[i] >= 2 ? 1 : 0;
  const dLand = distanceKm(grid, landSrc);
  const near = 200;
  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (wcomp[i] < 0) continue;
    speed[i] = wIsLake[wcomp[i]] ? 1 : near / seaSideKm(dLand[i]);
  }
  const wSeedSet = new Set();
  {
    const pts = jitteredPoints(near, rng);
    for (let k = 0; k < pts.length; k += 2) {
      const t = grid.texelOf(pts[k], pts[k + 1]);
      const c = wcomp[t];
      if (c < 0) continue;
      if (wIsLake[c]) { wSeedSet.add(t); continue; }
      const s = seaSideKm(dLand[t]);
      if (rng() < (near / s) ** 2) wSeedSet.add(t);
    }
    const hasW = new Uint8Array(wc.count);
    for (const t of wSeedSet) hasW[wcomp[t]] = 1;
    const st = regionStats(grid, wcomp, new Float32Array(N), wc.count);
    for (let c = 0; c < wc.count; c++) if (wKeep[c] && !hasW[c] && st.best[c] >= 0) wSeedSet.add(st.best[c]);
  }
  const waterSeeds = Int32Array.from([...wSeedSet].sort((a, b) => a - b));
  log(`water seeds: ${waterSeeds.length}`);
  const waterTarget = t => wIsLake[wcomp[t]] ? o.lakeZoneKm2 : seaSideKm(dLand[t]) ** 2;
  const waterRun = lloyd(grid, label, dist, {
    comp: wcomp, seeds: waterSeeds, speed, targetOf: t => waterTarget(t), iterations: o.seaIterations,
    splitK: 1.9, dropK: 0.3, log, heap: landRun.heap,
  });
  const S_water = waterRun.seeds.length;
  for (let i = 0; i < N; i++) if (label[i] >= 0) did[i] = S_land + 1 + label[i];
  const D = S_land + S_water + 1;

  // ------------------------------------------------------------ per-id metadata
  const type = new Uint8Array(D), comp = new Int32Array(D).fill(-1), target = new Float64Array(D);
  for (let s = 0; s < S_land; s++) {
    const t = landSeedTexel[s], c = lc.comp[t];
    type[s + 1] = compIsMount[c] ? T_MOUNT : T_LAND;
    const tx = t % W, ty = (t - tx) / W;
    target[s + 1] = compIsMount[c] ? compTarget[c] : o.landKm2 * iceFactor(o, colLon[tx], rowLat[ty]);
  }
  for (let s = 0; s < S_water; s++) {
    const t = waterRun.seeds[s], c = wcomp[t];
    const id = S_land + 1 + s;
    type[id] = wIsLake[c] ? T_LAKE : T_SEA;
    comp[id] = c;
    target[id] = waterTarget(t);
  }
  // absorb river texels, small lakes and ocean pockets into neighbouring land districts
  const filled = fillFromLand(grid, did, absorb, type);
  log(`absorbed texels: ${filled}`);
  return { did, D, type, comp, target, dLand, absorb, stats: { landCompartments: lc.count, landSeeds: S_land, waterSeeds: S_water, lakesAbsorbed, pocketsAbsorbed, absorbedTexels: filled } };
}
