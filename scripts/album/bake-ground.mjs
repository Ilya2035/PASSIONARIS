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
import { CHUNK_KM, CNX, CNY, CI0, CJ0, llOf } from '../../src/album/chunks.js';
import { CLIM_KM, CLIM_MAGIC, CLIM_MAGIC_RECT, WET_OF, wetOfAlpha, encodeClimate } from '../../src/album/ground/climate.js';
import { rawFolder, openClimate } from './climate-rule.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
// the raw data lives in the main checkout; a worktree has none of its own
const RAW = rawFolder(ROOT, arg('--raw'));
if (!RAW) { console.error('no data/raw/climate-open: run scripts/climate/download-open.mjs in the main checkout'); process.exit(1); }
const OUT = path.join(ROOT, 'public', 'assets', 'album', 'ground');
console.log('reading', RAW);
// the rule itself — the water balance of a year — is shared with the bake of the whole Earth: climate-rule.mjs
const climateAt = openClimate(RAW);

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

// ---- the grid of the album: the lattice of the chunks (a square at stage 2, 192 × 280 cells at stage 3) in cells of
// CLIM_KM — CW in a row, CH rows
const CW = CNX * CHUNK_KM / CLIM_KM, CH = CNY * CHUNK_KM / CLIM_KM, X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM, cell = CLIM_KM;
const N = CW * CH, wet = new Float32Array(N), summer = new Float32Array(N), warm = new Float32Array(N), year = new Float32Array(N), alpha = new Float32Array(N);
let missing = 0;
for (let j = 0, o = 0; j < CH; j++) for (let i = 0; i < CW; i++, o++) {
  const q = llOf(X0 + (i + .5) * cell, Y0 + (j + .5) * cell), c = climateAt(q.lat, q.lon);
  if (!c) { missing++; wet[o] = NaN; continue; }
  alpha[o] = c.alpha; wet[o] = Math.max(.02, wetOfAlpha(c.alpha) - dryland(q.lat, q.lon)); summer[o] = c.summer; warm[o] = c.warm; year[o] = c.year;
}
if (missing) {   // (CHELSA covers land and sea alike; a hole would be filled from its neighbours)
  for (let pass = 0; pass < 64 && missing; pass++) for (let o = 0; o < N; o++) if (Number.isNaN(wet[o])) {
    let s = [0, 0, 0, 0, 0], n = 0; const i = o % CW, j = (o / CW) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= CW || jj >= CH) continue; const k = jj * CW + ii; if (Number.isNaN(wet[k])) continue; s[0] += wet[k]; s[1] += summer[k]; s[2] += warm[k]; s[3] += year[k]; s[4] += alpha[k]; n++; }
    if (n) { wet[o] = s[0] / n; summer[o] = s[1] / n; warm[o] = s[2] / n; year[o] = s[3] / n; alpha[o] = s[4] / n; missing--; }
  }
}
fs.mkdirSync(OUT, { recursive: true });
const bytes = encodeClimate({ x0: X0, y0: Y0, km: cell, w: CW, h: CH, wet, summer, warm, year });
const gz = zlib.gzipSync(bytes, { level: 9 });
fs.writeFileSync(path.join(OUT, 'climate.bin.gz'), gz);
console.log(`climate.bin.gz: ${CW} × ${CH} cells of ${cell} km from (${X0}, ${Y0}) km, ${gz.length} bytes (${CW === CH ? CLIM_MAGIC : CLIM_MAGIC_RECT})`);

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
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) buf[(CH - 1 - j) * CW + i] = Math.max(0, Math.min(255, Math.round((a[j * CW + i] - lo) / (hi - lo) * 255)));
    await sharp(buf, { raw: { width: CW, height: CH, channels: 1 } }).resize(768, Math.round(768 * CH / CW), { kernel: 'nearest' }).png().toFile(path.join(png, `climate-${name}.png`));
  };
  await map('wet', wet, 0, 1); await map('summer', summer, 0, 1); await map('warm', warm, 10, 35); await map('alpha', alpha, 0, 1);
  console.log('check pictures in', png);
}
