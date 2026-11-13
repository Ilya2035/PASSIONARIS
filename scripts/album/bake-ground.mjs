// The climate of the ground of the album, baked from open data: how wet a place is, how dry its summer is and how
// warm it is. The ground, the forest and the swamps read it instead of a formula fitted to Iberia by hand
// (docs/album/ground.md), so the picture follows the real climate wherever the map is carried next.
//
// Input : data/raw/climate-open/ of the main checkout (scripts/climate/download-open.mjs):
//           CHELSA V2.1 climatologies 1981–2010, monthly tas and pr, the 4′ overview (CC0 1.0);
//           ETOPO 2022 surface elevation, every 3′ (CC0 1.0) — the height the CHELSA temperatures belong to.
// Output: public/assets/album/ground/climate.bin.gz — over the square of the chunks (chunks.js), a cell of 5 km.
//         Format and reading: src/album/ground/climate.js.
//
// The rule. For every cell a water balance of the year is counted month by month: what the air could take up
// (potential evaporation after Thornthwaite, from the temperature and the length of the day), what the rain brings,
// and a soil that holds up to 150 mm between them. The share of the demand that is met, AET / PET, is the moisture
// index α of Cramer and Prentice (Prentice et al., 1992), which the biome models draw the edge of the forest with.
//   wet     α turned into the scale the album paints with: 0 desert .. .2 steppe .. .34 open woodland .. .58 closed
//           forest .. 1 Atlantic forest (WET_OF below)
//   summer  the same share over June, July and August alone: 0 a summer without water (the grass burns out, the
//           trees are evergreen and grey) .. 1 a green summer
//   warm    mean temperature of the warmest month brought down to sea level: trees stop where it falls to 10 °C,
//           so the tree line is a height of its own at every place
//   year    mean temperature of the year at sea level
//
//   node scripts/album/bake-ground.mjs [--raw <folder of climate-open>] [--png <folder for check pictures>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { CHUNK_KM, CN, CI0, CJ0, llOf } from '../../src/album/chunks.js';
import { CLIM_N, CLIM_MAGIC, WET_OF, wetOfAlpha, encodeClimate, LAPSE } from '../../src/album/ground/climate.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
// the raw data lives in the main checkout; a worktree has none of its own
const mainRoot = () => { try { return execSync('git worktree list --porcelain', { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].replace(/^worktree /, '').trim(); } catch { return ROOT; } };
const RAW = arg('--raw') || [ROOT, mainRoot()].map(r => path.join(r, 'data', 'raw', 'climate-open')).find(d => fs.existsSync(path.join(d, 'chelsa'))) || '';
if (!RAW) { console.error('no data/raw/climate-open: run scripts/climate/download-open.mjs in the main checkout'); process.exit(1); }
const OUT = path.join(ROOT, 'public', 'assets', 'album', 'ground');

const CW = 5400, CH = 2610, CLAT0 = 84, CPX = 15, ND = 65535;   // CHELSA overview: px per degree, row 0 = 84°N
const EW = 7200, EH = 3600, EPX = 20;                           // ETOPO samples: px per degree, row 0 = 90°N
const read = (rel, Type) => { const b = zlib.gunzipSync(fs.readFileSync(path.join(RAW, rel))), c = new Uint8Array(b.byteLength); c.set(b); return new Type(c.buffer); };
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
console.log('reading', RAW);
const tas = [], pr = [];
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  tas.push(sampler(read(`chelsa/tas_${mm}.u16.gz`, Uint16Array), CW, CH, CPX, CLAT0, ND));
  pr.push(sampler(read(`chelsa/pr_${mm}.u16.gz`, Uint16Array), CW, CH, CPX, CLAT0, ND));
}
const etopo = sampler(read('etopo/surface_3m.i16.gz', Int16Array), EW, EH, EPX, 90, -32768);

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
export function climateAt(lat, lon) {
  const T = tas.map(f => f(lat, lon) * .1 - 273.15), P = pr.map(f => f(lat, lon) * .1);
  if (T.some(Number.isNaN) || P.some(Number.isNaN)) return null;
  const h = Math.max(0, etopo(lat, lon) || 0), b = balance(T, P, lat);
  return { ...b, rain: P.reduce((s, v) => s + v, 0), warm: Math.max(...T) + LAPSE * h, year: T.reduce((s, v) => s + v, 0) / 12 + LAPSE * h, h };
}

// ---- the dry lands known by name. The climate alone does not tell them from the steppe around them: they are what
// they are for their ground too — gypsum and marl that hold no water, bare badlands, salt. Each is a round patch that
// lowers the wetness: by `dry` in the middle, by nothing at `km` from it. (The same is done for the swamps with the
// wetlands known by name, public/assets/album/swamp/wetlands.json.) Deserts of climate — the Sahara — need no entry.
export const DRYLANDS = [
  { name: 'Барденас-Реалес', lat: 42.20, lon: -1.50, km: 26, dry: .14 },
  { name: 'Монегрос', lat: 41.55, lon: -.20, km: 48, dry: .13 },
  { name: 'Бельчите и Нижний Арагон', lat: 41.28, lon: -.72, km: 34, dry: .10 },
  { name: 'Степи Льейды', lat: 41.52, lon: .72, km: 22, dry: .08 },
  { name: 'Пустыня Табернас', lat: 37.05, lon: -2.40, km: 24, dry: .10 },
  { name: 'Котловина Гуадикса и Басы (Горафе)', lat: 37.50, lon: -2.95, km: 36, dry: .12 },
  { name: 'Кабо-де-Гата и Нихар', lat: 36.88, lon: -2.12, km: 22, dry: .05 },
  { name: 'Степи Альмансоры и Лорки', lat: 37.55, lon: -1.75, km: 34, dry: .05 },
];
const KMD = 111.195;
function dryland(lat, lon) {
  let d = 0;
  for (const p of DRYLANDS) { const r = Math.hypot((lat - p.lat) * KMD, (lon - p.lon) * KMD * Math.cos(lat * Math.PI / 180)) / p.km; if (r < 1) { const t = 1 - r * r; d = Math.max(d, p.dry * t * t); } }
  return d;
}

// ---- the grid of the album: the square of the chunks, CLIM_N cells a side
const SIDE = CN * CHUNK_KM, X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM, cell = SIDE / CLIM_N;
const N = CLIM_N * CLIM_N, wet = new Float32Array(N), summer = new Float32Array(N), warm = new Float32Array(N), year = new Float32Array(N), alpha = new Float32Array(N);
let missing = 0;
for (let j = 0, o = 0; j < CLIM_N; j++) for (let i = 0; i < CLIM_N; i++, o++) {
  const q = llOf(X0 + (i + .5) * cell, Y0 + (j + .5) * cell), c = climateAt(q.lat, q.lon);
  if (!c) { missing++; wet[o] = NaN; continue; }
  alpha[o] = c.alpha; wet[o] = Math.max(.02, wetOfAlpha(c.alpha) - dryland(q.lat, q.lon)); summer[o] = c.summer; warm[o] = c.warm; year[o] = c.year;
}
if (missing) {   // (CHELSA covers land and sea alike; a hole would be filled from its neighbours)
  for (let pass = 0; pass < 64 && missing; pass++) for (let o = 0; o < N; o++) if (Number.isNaN(wet[o])) {
    let s = [0, 0, 0, 0, 0], n = 0; const i = o % CLIM_N, j = (o / CLIM_N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= CLIM_N || jj >= CLIM_N) continue; const k = jj * CLIM_N + ii; if (Number.isNaN(wet[k])) continue; s[0] += wet[k]; s[1] += summer[k]; s[2] += warm[k]; s[3] += year[k]; s[4] += alpha[k]; n++; }
    if (n) { wet[o] = s[0] / n; summer[o] = s[1] / n; warm[o] = s[2] / n; year[o] = s[3] / n; alpha[o] = s[4] / n; missing--; }
  }
}
fs.mkdirSync(OUT, { recursive: true });
const bytes = encodeClimate({ x0: X0, y0: Y0, km: cell, wet, summer, warm, year });
const gz = zlib.gzipSync(bytes, { level: 9 });
fs.writeFileSync(path.join(OUT, 'climate.bin.gz'), gz);
console.log(`climate.bin.gz: ${CLIM_N} × ${CLIM_N} cells of ${cell} km from (${X0}, ${Y0}) km, ${gz.length} bytes (${CLIM_MAGIC})`);

// ---- what the rule says of places everyone knows
const PLACES = { 'Сантьяго': [42.88, -8.54], 'Овьедо': [43.36, -5.85], 'Бильбао': [43.26, -2.93], 'Бургос': [42.34, -3.70], 'Леон': [42.60, -5.57], 'Вальядолид': [41.65, -4.72],
  'Саламанка': [40.96, -5.66], 'Мадрид': [40.42, -3.70], 'Толедо': [39.86, -4.02], 'Альбасете': [38.99, -1.86], 'Сьюдад-Реаль': [38.99, -3.93], 'Бадахос': [38.88, -6.97],
  'Севилья': [37.39, -5.98], 'Кордова': [37.88, -4.78], 'Гранада': [37.18, -3.60], 'Альмерия': [36.84, -2.46], 'Табернас': [37.05, -2.39], 'Мурсия': [37.99, -1.13],
  'Аликанте': [38.35, -0.48], 'Валенсия': [39.47, -0.38], 'Сарагоса': [41.65, -0.89], 'Монегрос': [41.6, -0.2], 'Барденас': [42.15, -1.45], 'Льейда': [41.62, 0.62],
  'Барселона': [41.39, 2.17], 'Жирона': [41.98, 2.82], 'Сория': [41.76, -2.47], 'Теруэль': [40.34, -1.11], 'Куэнка': [40.07, -2.13], 'Гвадаррама': [40.85, -3.95],
  'Пиренеи': [42.63, 0.66], 'Лиссабон': [38.72, -9.14], 'Порту': [41.15, -8.61], 'Фару': [37.02, -7.93], 'Тулуза': [43.60, 1.44], 'Гасконь': [43.95, 0.45],
  'Бордо': [44.84, -0.58], 'Монпелье': [43.61, 3.88], 'Перпиньян': [42.70, 2.90], 'Танжер': [35.77, -5.80], 'Риф': [35.2, -5.2] };
console.log('\nplace            rain  PET   α    summer  wet   warm0 year0');
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const c = climateAt(lat, lon); if (!c) continue;
  console.log(`${name.padEnd(15)} ${String(Math.round(c.rain)).padStart(5)} ${String(Math.round(c.pet)).padStart(5)}  ${c.alpha.toFixed(2)}  ${c.summer.toFixed(2)}   ${wetOfAlpha(c.alpha).toFixed(2)}  ${c.warm.toFixed(1)}  ${c.year.toFixed(1)}`);
}
void WET_OF;

// ---- check pictures: the baked numbers as grey maps, north up
const png = arg('--png');
if (png) {
  const sharp = (await import('sharp')).default;
  const map = async (name, a, lo, hi) => {
    const buf = Buffer.alloc(N);
    for (let j = 0; j < CLIM_N; j++) for (let i = 0; i < CLIM_N; i++) buf[(CLIM_N - 1 - j) * CLIM_N + i] = Math.max(0, Math.min(255, Math.round((a[j * CLIM_N + i] - lo) / (hi - lo) * 255)));
    await sharp(buf, { raw: { width: CLIM_N, height: CLIM_N, channels: 1 } }).resize(768, 768, { kernel: 'nearest' }).png().toFile(path.join(png, `climate-${name}.png`));
  };
  await map('wet', wet, 0, 1); await map('summer', summer, 0, 1); await map('warm', warm, 10, 35); await map('alpha', alpha, 0, 1);
  console.log('check pictures in', png);
}
