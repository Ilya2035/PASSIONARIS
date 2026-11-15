// The rule the climate of the ground is counted by, shared by the two bakes: the polygon (bake-ground.mjs, a cell of
// 5 km over the square of the chunks) and the whole Earth (bake-world-climate.mjs, a cell of 0.18°). One rule for
// both, so the land does not change colour where the polygon ends.
//
// Input: data/raw/climate-open/ of the main checkout (scripts/climate/download-open.mjs):
//   CHELSA V2.1 climatologies 1981–2010, monthly tas and pr, the 4′ overview (CC0 1.0);
//   ETOPO 2022 surface elevation, every 3′ (CC0 1.0) — the height the CHELSA temperatures belong to.
//
// The rule. For every place a water balance of the year is counted month by month: what the air could take up
// (potential evaporation after Thornthwaite, from the temperature and the length of the day), what the rain brings,
// and a soil that holds up to 150 mm between them. The share of the demand that is met, AET / PET, is the moisture
// index α of Cramer and Prentice (Prentice et al., 1992), which the biome models draw the edge of the forest with.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { LAPSE } from '../../src/album/ground/climate.js';

const CW = 5400, CH = 2610, CLAT0 = 84, CPX = 15, ND = 65535;   // CHELSA overview: px per degree, row 0 = 84°N
const EW = 7200, EH = 3600, EPX = 20;                           // ETOPO samples: px per degree, row 0 = 90°N

// the folder of the raw data: given, or data/raw/climate-open of this checkout, or of the main one (a worktree has none)
export function rawFolder(root, given) {
  const mainRoot = () => { try { return execSync('git worktree list --porcelain', { cwd: root, encoding: 'utf8' }).split('\n')[0].replace(/^worktree /, '').trim(); } catch { return root; } };
  return given || [root, mainRoot()].map(r => path.join(r, 'data', 'raw', 'climate-open')).find(d => fs.existsSync(path.join(d, 'chelsa'))) || '';
}
// bilinear sample of a global raster with pixel centres at (i + .5) / px; cells without data are left out
function sampler(a, w, h, px, lat0, nodata) {
  return (lat, lon) => {
    const x = (lon + 180) * px - .5, y = (lat0 - lat) * px - .5, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    let s = 0, wsum = 0;
    for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const jj = Math.max(0, Math.min(h - 1, j + b)), ii = ((i + c) % w + w) % w, v = a[jj * w + ii];
      if (v === nodata) continue;
      const k = (c ? fx : 1 - fx) * (b ? fy : 1 - fy); s += v * k; wsum += k;
    }
    return wsum > 0 ? s / wsum : NaN;
  };
}

// ---- the water balance of a year
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], MID = [15, 46, 75, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const SOIL = 150;   // mm of water the soil holds for the plants
// mean length of the day, hours, at a latitude on a day of the year
function dayLength(lat, doy) {
  const decl = .409 * Math.sin(2 * Math.PI * doy / 365 - 1.39), x = -Math.tan(lat * Math.PI / 180) * Math.tan(decl);
  return 24 / Math.PI * Math.acos(Math.max(-1, Math.min(1, x)));
}
// potential evaporation of every month, mm (Thornthwaite 1948; above 26.5 °C the curve of Willmott et al. 1985)
function thornthwaite(T, lat) {
  let I = 0; for (const t of T) if (t > 0) I += (t / 5) ** 1.514;
  const a = 6.75e-7 * I ** 3 - 7.71e-5 * I * I + 1.792e-2 * I + .49239;
  return T.map((t, m) => {
    if (t <= 0 || I <= 0) return 0;
    const raw = t < 26.5 ? 16 * (10 * t / I) ** a : -415.85 + 32.24 * t - .43 * t * t;
    return raw * dayLength(lat, MID[m]) / 12 * DAYS[m] / 30;
  });
}
// T: °C of the months, P: mm of the months → { alpha, summer, pet, aet } (summer: June–August in the north, December–February in the south)
export function balance(T, P, lat) {
  const pet = thornthwaite(T, lat), aet = new Array(12).fill(0);
  let soil = SOIL;
  for (let pass = 0; pass < 4; pass++) for (let m = 0; m < 12; m++) {
    if (P[m] >= pet[m]) { aet[m] = pet[m]; soil = Math.min(SOIL, soil + P[m] - pet[m]); }
    else { const take = soil * (1 - Math.exp(-(pet[m] - P[m]) / SOIL)); aet[m] = P[m] + take; soil -= take; }
  }
  const sum = a => a.reduce((s, v) => s + v, 0), sm = lat >= 0 ? [5, 6, 7] : [11, 0, 1];
  const petS = sm.reduce((s, m) => s + pet[m], 0), aetS = sm.reduce((s, m) => s + aet[m], 0), petY = sum(pet);
  return { alpha: petY > 1 ? sum(aet) / petY : 1, summer: petS > 1 ? aetS / petS : 1, pet: petY, aet: sum(aet) };
}

// Reads the raw data; the answer is climateAt(lat, lon) → what the rule says of a place, or null where CHELSA has
// no data (north of 84° N):
//   alpha, summer, pet, aet   the water balance (see above)        rain   mm a year
//   warm, year                mean temperature of the warmest month and of the year, °C, brought down to sea level
//   h                         height of the land the temperatures belong to, m
export function openClimate(raw) {
  const read = (rel, Type) => { const b = zlib.gunzipSync(fs.readFileSync(path.join(raw, rel))), c = new Uint8Array(b.byteLength); c.set(b); return new Type(c.buffer); };
  const tas = [], pr = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    tas.push(sampler(read(`chelsa/tas_${mm}.u16.gz`, Uint16Array), CW, CH, CPX, CLAT0, ND));
    pr.push(sampler(read(`chelsa/pr_${mm}.u16.gz`, Uint16Array), CW, CH, CPX, CLAT0, ND));
  }
  const etopo = sampler(read('etopo/surface_3m.i16.gz', Int16Array), EW, EH, EPX, 90, -32768);
  return (lat, lon) => {
    const T = tas.map(f => f(lat, lon) * .1 - 273.15), P = pr.map(f => f(lat, lon) * .1);
    if (T.some(Number.isNaN) || P.some(Number.isNaN)) return null;
    const h = Math.max(0, etopo(lat, lon) || 0), b = balance(T, P, lat);
    return { ...b, rain: P.reduce((s, v) => s + v, 0), warm: Math.max(...T) + LAPSE * h, year: T.reduce((s, v) => s + v, 0) / 12 + LAPSE * h, h };
  };
}
