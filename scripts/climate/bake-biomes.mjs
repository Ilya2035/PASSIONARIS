// Passionaris climate baker, step 2: biome map on the MAP grid (8192x4096).
//
// Input : public/assets/climate/normals-open.bin.gz (bake-normals.mjs; CHELSA V2.1 + ETOPO 2022, CC0),
//         public/assets/map/height.delta.bin.gz (Int16, rows delta-encoded, metres),
//         public/assets/map/cells.bin.gz (Uint32: 0 ocean, 1 lake, >=2 land district).
// Output: public/assets/climate/biome-open.bin.gz  Uint8 8192x4096, ids from src/sim/climate/biomes.js
//         (the old WorldClim-derived biome.bin.gz stays gitignored and is never read any more)
//         public/assets/climate/biomes.json   class table (id, key, nameRu, description, color)
//
// Downscaling: monthly temperature is bilinearly interpolated from the 0.5° normals and
// corrected with a 6.5 °C/km lapse rate for the difference between the map height and the
// interpolated cell elevation; precipitation is bilinear. Classification: biomes.js.
// Ice sheets: the map height is bedrock under the Greenland / Antarctic ice and the Arctic ice
// caps; where the coarse climate is glacial the climate-grid (ice-surface) elevation is used.
// Wetlands: low (< WETLAND_MAX_ELEV = 200 m), flat (local relief <= WETLAND_RELIEF = 35 m over
// ~20 km) and humid (Thornthwaite P/PET >= WETLAND_MOISTURE = 1.1); see biomes.js.
// Deterministic: no timestamps in the outputs.
//
// Run: tools/node/node.exe scripts/climate/bake-biomes.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadNormals, W as SW, H as SH } from '../../src/sim/climate/climatology.js';
import {
  BIOMES, BIOME, climateStats, classifyBiome, dayLengths, LAPSE_RATE, WETLAND_RELIEF, WETLAND_MAX_ELEV,
} from '../../src/sim/climate/biomes.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MAP = path.join(ROOT, 'public', 'assets', 'map');
const OUT = path.join(ROOT, 'public', 'assets', 'climate');
const MW = 8192, MH = 4096, SN = SW * SH;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const smooth01 = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const BIOME_OUT = 'biome-open.bin.gz';
const ICE_TMAX_NONE = 4; // °C: coarse warmest month above which the map height is never replaced
const gunzipTyped = (file, Type) => {
  const b = zlib.gunzipSync(fs.readFileSync(path.join(MAP, file)));
  const copy = new Uint8Array(b.byteLength); copy.set(b);
  return new Type(copy.buffer);
};

// ------------------------------------------------------------------ inputs
const nm = await loadNormals();
const Tn = new Float32Array(12 * SN), Pn = new Float32Array(12 * SN), En = new Float32Array(SN);
for (let i = 0; i < 12 * SN; i++) { Tn[i] = nm.tavg[i] * 0.1; Pn[i] = nm.prec[i]; }
for (let i = 0; i < SN; i++) En[i] = nm.elev[i];
log('normals loaded');

const height = gunzipTyped('height.delta.bin.gz', Int16Array);
if (height.length !== MW * MH) throw new Error('height.delta.bin.gz: unexpected size');
for (let y = 0; y < MH; y++) {
  let acc = 0;
  const row = y * MW;
  for (let x = 0; x < MW; x++) { acc += height[row + x]; height[row + x] = acc; }
}
const cells = gunzipTyped('cells.bin.gz', Uint32Array);
if (cells.length !== MW * MH) throw new Error('cells.bin.gz: unexpected size');
log('map height + cells loaded');

// ------------------------------------------------------------------ interpolation tables
const X0 = new Int32Array(MW), X1 = new Int32Array(MW), TX = new Float32Array(MW);
for (let x = 0; x < MW; x++) {
  const lon = -180 + (x + 0.5) * 360 / MW;
  const fx = (lon + 180) / 0.5 - 0.5;
  const xf = Math.floor(fx);
  X0[x] = ((xf % SW) + SW) % SW; X1[x] = (X0[x] + 1) % SW; TX[x] = fx - xf;
}
const rowT = new Float32Array(12 * SW), rowP = new Float32Array(12 * SW), rowE = new Float32Array(SW);
const T12 = new Float32Array(12), P12 = new Float32Array(12), DL = new Float32Array(12);
const st = {};

// local relief (max - min of land heights) in a ~20 km window, only for candidate pixels
function relief(x, y, rx) {
  let mn = 32767, mx = -32768;
  for (let dy = -2; dy <= 2; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= MH) continue;
    const row = yy * MW;
    for (let dx = -rx; dx <= rx; dx++) {
      const xx = (x + dx + MW) % MW, i = row + xx;
      if (cells[i] < 2) continue;
      const h = height[i];
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  return mx - mn;
}

// ------------------------------------------------------------------ classify
const biome = new Uint8Array(MW * MH);
for (let y = 0; y < MH; y++) {
  const lat = 90 - (y + 0.5) * 180 / MH;
  const fy = (90 - lat) / 0.5 - 0.5;
  const y0 = Math.max(0, Math.min(SH - 1, Math.floor(fy))), y1 = Math.min(SH - 1, y0 + 1);
  const ty = Math.max(0, Math.min(1, fy - y0));
  for (let m = 0; m < 12; m++) {
    const a = m * SN + y0 * SW, b = m * SN + y1 * SW, o = m * SW;
    for (let x = 0; x < SW; x++) {
      rowT[o + x] = Tn[a + x] + (Tn[b + x] - Tn[a + x]) * ty;
      rowP[o + x] = Pn[a + x] + (Pn[b + x] - Pn[a + x]) * ty;
    }
  }
  for (let x = 0; x < SW; x++) rowE[x] = En[y0 * SW + x] + (En[y1 * SW + x] - En[y0 * SW + x]) * ty;
  dayLengths(lat, DL);
  const ICE_LAT = Math.abs(lat) > 58;
  const rx = Math.min(12, Math.max(2, Math.round(2 / Math.max(Math.cos(lat * Math.PI / 180), 0.15))));
  const row = y * MW;

  for (let x = 0; x < MW; x++) {
    const i = row + x;
    if (cells[i] < 2) { biome[i] = BIOME.WATER; continue; }
    const x0 = X0[x], x1 = X1[x], tx = TX[x];
    const eB = rowE[x0] + (rowE[x1] - rowE[x0]) * tx;
    // The map height is bedrock under the Greenland / Antarctic ice sheets and the Arctic ice
    // caps (e.g. -20 m at 72N 40W vs ~3000 m ice surface): there the climate elevation is the
    // surface. Only where the coarse climate itself is glacial (warmest month <= 0 °C, fading out
    // by 4 °C) — ice-free valleys and fjords (Alaska, Yukon, Norway, Siberia) are genuinely
    // lower than the 0.5° cell mean and keep their own height. Both weights are smooth.
    let h = Math.max(-450, height[i]);
    if (ICE_LAT && eB - h > 150) {
      let tMaxC = -Infinity;
      for (let m = 0; m < 12; m++) {
        const o = m * SW, t = rowT[o + x0] + (rowT[o + x1] - rowT[o + x0]) * tx;
        if (t > tMaxC) tMaxC = t;
      }
      const w = smooth01((ICE_TMAX_NONE - tMaxC) / ICE_TMAX_NONE) * smooth01((eB - h - 150) / 300);
      h += w * (eB - h);
    }
    const dT = -LAPSE_RATE * (h - eB);
    for (let m = 0; m < 12; m++) {
      const o = m * SW;
      T12[m] = rowT[o + x0] + (rowT[o + x1] - rowT[o + x0]) * tx + dT;
      const p = rowP[o + x0] + (rowP[o + x1] - rowP[o + x0]) * tx;
      P12[m] = p > 0 ? p : 0;
    }
    climateStats(T12, P12, lat, st);
    let b = classifyBiome(st, h);
    if (h < WETLAND_MAX_ELEV && (b === BIOME.TUNDRA || b === BIOME.TAIGA || b === BIOME.TEMPERATE_FOREST
      || b === BIOME.STEPPE || b === BIOME.SAVANNA) && relief(x, y, rx) <= WETLAND_RELIEF) {
      b = classifyBiome(st, h, true, T12, DL);
    }
    biome[i] = b;
  }
  if (y % 512 === 511) log(`row ${y + 1}/${MH}`);
}

// ------------------------------------------------------------------ speckle cleanup
// a land pixel whose 4 neighbours all differ from it, with >= 3 of them agreeing, takes their class
{
  const src = biome.slice();
  let changed = 0;
  for (let y = 1; y < MH - 1; y++) {
    const row = y * MW;
    for (let x = 0; x < MW; x++) {
      const i = row + x, c = src[i];
      if (c === BIOME.WATER) continue;
      const n0 = src[row + (x + 1) % MW], n1 = src[row + (x + MW - 1) % MW], n2 = src[i - MW], n3 = src[i + MW];
      if (n0 === c || n1 === c || n2 === c || n3 === c) continue;
      let best = -1;
      for (const k of [n0, n1, n2]) {
        if (k === BIOME.WATER) continue;
        const cnt = (n0 === k) + (n1 === k) + (n2 === k) + (n3 === k);
        if (cnt >= 3) { best = k; break; }
      }
      if (best >= 0) { biome[i] = best; changed++; }
    }
  }
  log(`speckle cleanup: ${changed} pixels`);
}

// ------------------------------------------------------------------ write + report
const gz = zlib.gzipSync(Buffer.from(biome.buffer), { level: 9 });
fs.writeFileSync(path.join(OUT, BIOME_OUT), gz);
log(`${BIOME_OUT} ${(gz.length / 1e6).toFixed(2)} MB`);

const area = new Float64Array(BIOMES.length);
for (let y = 0; y < MH; y++) {
  const w = Math.cos((90 - (y + 0.5) * 180 / MH) * Math.PI / 180);
  const row = y * MW;
  for (let x = 0; x < MW; x++) area[biome[row + x]] += w;
}
const landArea = area.reduce((s, v, k) => s + (k ? v : 0), 0);
const json = {
  format: 'passionaris-biomes',
  version: 1,
  file: BIOME_OUT,
  compression: 'gzip',
  type: 'Uint8',
  grid: { W: MW, H: MH, note: 'MAP grid: row 0 = 90°N, col 0 = 180°W, same as public/assets/map/cells.bin.gz' },
  method: 'Open 1970–2000 normals (CHELSA V2.1 + ETOPO 2022, CC0; normals.json), lapse-rate (6.5 °C/km) temperature downscaling to the map height (climate-grid ice-surface height over ice sheets), bilinear precipitation; Köppen aridity / temperature thresholds + Whittaker-style rules and a GDD5 tree line (src/sim/climate/biomes.js); wetlands = flat humid lowlands',
  classes: BIOMES.map(c => ({ ...c, landShare: c.id ? +(area[c.id] / landArea).toFixed(4) : undefined })),
};
fs.writeFileSync(path.join(OUT, 'biomes.json'), JSON.stringify(json, null, 2));
for (const c of BIOMES) if (c.id) log(`${c.key.padEnd(17)} ${(100 * area[c.id] / landArea).toFixed(2)}% of land`);

const at = (lat, lon) => biome[Math.min(MH - 1, Math.floor((90 - lat) / 180 * MH)) * MW + Math.floor(((lon + 180) / 360 * MW) % MW)];
for (const [n, la, lo] of [['Sahara', 23, 10], ['Amazon', -3, -60], ['Yakutia', 62, 125], ['Greenland', 72, -40], ['Moscow', 55.75, 37.6],
  ['Kazakh steppe', 50, 70], ['Rome', 41.9, 12.5], ['Congo', 0, 22], ['Serengeti', -2.5, 35], ['Tibet', 33, 88], ['W Siberia bog', 58, 78], ['Pripyat', 52, 27],
  ['Baker Lake', 64.3, -96.1], ['Taimyr', 72, 100], ['Sognefjord', 61.2, 7.1]]) {
  log(`spot ${n.padEnd(14)} -> ${BIOMES[at(la, lo)].key}`);
}
log('done');
