// The climate of the ground of the whole Earth, baked from the same open data and by the same rule as the climate of
// the polygon (climate-rule.mjs, bake-ground.mjs): how wet a place is, how dry its summer, how warm its warmest month
// and its year. Beyond the polygon the ground shader paints the land from it — forest and desert, tundra, the line
// of the trees and of the snow, the ice of the polar seas (docs/album/ground.md, «Вся Земля»).
//
// Output: public/assets/album/ground/world.bin.gz — WORLD_W × WORLD_H cells of 0.18° (a cell of 20 km at the
//         equator), rows from the north. Format and reading: src/album/ground/climate.js.
// A cell is the mean of four places inside it. North of 84° N CHELSA has no data: those cells (ocean, all of them)
// take the numbers of the nearest row that has.
//
//   node scripts/album/bake-world-climate.mjs [--raw <folder of climate-open>] [--png <folder for check pictures>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WORLD_W, WORLD_H, WORLD_MAGIC, wetOfAlpha, encodeWorldClimate, decodeWorldClimate, treelineOf, snowlineOf, WARM, YEAR } from '../../src/album/ground/climate.js';
import { rawFolder, openClimate } from './climate-rule.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const RAW = rawFolder(ROOT, arg('--raw'));
if (!RAW) { console.error('no data/raw/climate-open: run scripts/climate/download-open.mjs in the main checkout'); process.exit(1); }
const OUT = path.join(ROOT, 'public', 'assets', 'album', 'ground');
console.log('reading', RAW);
const climateAt = openClimate(RAW);

const W = WORLD_W, H = WORLD_H, N = W * H, dLon = 360 / W, dLat = 180 / H;
const wet = new Float32Array(N), summer = new Float32Array(N), warm = new Float32Array(N), year = new Float32Array(N), has = new Uint8Array(N);
const t0 = Date.now();
for (let j = 0, o = 0; j < H; j++) {
  for (let i = 0; i < W; i++, o++) {
    let n = 0, a = 0, s = 0, w = 0, y = 0;
    for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const q = climateAt(90 - (j + .25 + .5 * b) * dLat, -180 + (i + .25 + .5 * c) * dLon);
      if (!q) continue;
      n++; a += wetOfAlpha(q.alpha); s += q.summer; w += q.warm; y += q.year;
    }
    if (n) { has[o] = 1; wet[o] = Math.max(.02, a / n); summer[o] = s / n; warm[o] = w / n; year[o] = y / n; }
  }
  if (j % 128 === 127) console.log(`row ${j + 1} of ${H}, ${Math.round((Date.now() - t0) / 1000)} s`);
}
// cells without data take the nearest row that has some (the ocean north of 84° N)
let filled = 0;
for (let i = 0; i < W; i++) {
  let first = 0; while (first < H && !has[first * W + i]) first++;
  if (first === H) continue;
  for (let j = 0; j < H; j++) { const o = j * W + i; if (has[o]) continue; let k = j < first ? first : j; while (k > 0 && !has[k * W + i]) k--; const q = k * W + i; wet[o] = wet[q]; summer[o] = summer[q]; warm[o] = warm[q]; year[o] = year[q]; filled++; }
}
fs.mkdirSync(OUT, { recursive: true });
const bytes = encodeWorldClimate({ w: W, h: H, year, wet, warm, summer }), gz = zlib.gzipSync(bytes, { level: 9 });
fs.writeFileSync(path.join(OUT, 'world.bin.gz'), gz);
console.log(`world.bin.gz: ${W} × ${H} cells of ${dLon.toFixed(4)}°, ${gz.length} bytes (${WORLD_MAGIC}); ${filled} cells filled from their neighbours`);

// ---- what the rule says of places everyone knows (from the file, as the shader will read it)
const back = decodeWorldClimate(bytes);
const at = (lat, lon) => { const i = Math.min(W - 1, Math.floor((lon + 180) / dLon)), j = Math.min(H - 1, Math.floor((90 - lat) / dLat)), o = (j * W + i) * 4, d = back.data;
  return { year: YEAR[0] + d[o] / 255 * (YEAR[1] - YEAR[0]), wet: d[o + 1] / 255, warm: WARM[0] + d[o + 2] / 255 * (WARM[1] - WARM[0]), summer: d[o + 3] / 255 }; };
const PLACES = { 'Париж': [48.85, 2.35], 'Альпы (Монблан)': [45.83, 6.86], 'Осло': [59.9, 10.75], 'Тромсё': [69.65, 18.95], 'Шпицберген': [78.5, 16], 'Рейкьявик': [64.15, -21.9],
  'Гренландия, щит': [72, -40], 'Москва': [55.75, 37.6], 'Якутск': [62, 129.7], 'Таймыр': [74, 100], 'Каир': [30.05, 31.25], 'Сахара': [23, 10], 'Сахель': [14, 5],
  'Конго': [0, 22], 'Килиманджаро': [-3.07, 37.35], 'Кейптаун': [-33.9, 18.4], 'Лхаса': [29.65, 91.1], 'Эверест': [27.99, 86.93], 'Дели': [28.6, 77.2], 'Гоби': [43, 105],
  'Токио': [35.7, 139.7], 'Сингапур': [1.3, 103.8], 'Алис-Спрингс': [-23.7, 133.9], 'Сидней': [-33.9, 151.2], 'Манаус': [-3.1, -60], 'Кито': [-0.2, -78.5], 'Атакама': [-24, -69.5],
  'Патагония': [-49.5, -73], 'Нью-Йорк': [40.7, -74], 'Денвер': [39.74, -105], 'Аляска, хребет': [63.1, -151], 'Антарктида, берег': [-70, 0], 'Антарктида, купол': [-80, 90], 'Северный полюс': [89, 0] };
console.log('\nplace               wet  summer  warm0  year0  trees to  snow from');
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const c = at(lat, lon);
  console.log(`${name.padEnd(18)} ${c.wet.toFixed(2)}   ${c.summer.toFixed(2)}   ${c.warm.toFixed(1).padStart(5)}  ${c.year.toFixed(1).padStart(5)}  ${String(Math.round(treelineOf(c.warm, c.summer))).padStart(6)} m  ${String(Math.round(snowlineOf(c.warm, c.year))).padStart(6)} m`);
}

// ---- check pictures: the baked numbers as grey maps
const png = arg('--png');
if (png) {
  const sharp = (await import('sharp')).default;
  for (const [p, name] of ['year', 'wet', 'warm', 'summer'].entries()) {
    const buf = Buffer.alloc(N); for (let o = 0; o < N; o++) buf[o] = back.data[o * 4 + p];
    await sharp(buf, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(png, `world-${name}.png`));
  }
  console.log('check pictures in', png);
}
