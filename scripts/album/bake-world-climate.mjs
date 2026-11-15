// The whole Earth beyond the polygon, baked from open data (docs/album/ground.md, «Вся Земля»):
//   the climate of the ground by the same rule as in the polygon (climate-rule.mjs, bake-ground.mjs): how wet a place
//   is, how dry its summer, how warm its warmest month — from them the ground shader paints forest and desert,
//   tundra, the line of the trees and of the snow, the ice of the polar seas;
//   the lakes of the world map (public/assets/map/cells.bin.gz: the cell number 1 is a lake);
//   the surface of the ice sheets (ETOPO 2022, surface): the height map of the world (height.delta.bin.gz) holds the
//   rock under the ice of Greenland and of the Antarctic.
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
import { WORLD_W, WORLD_H, WORLD_MAGIC, WARM_WORLD, ICE_STEP, wetOfAlpha, encodeWorldClimate, decodeWorldClimate, worldTreelineOf, snowlineOf } from '../../src/album/ground/climate.js';
import { WMAP_W, WMAP_H, decodeWorldHeights, worldAt } from '../../src/album/ground/world.js';
import { rawFolder, openClimate } from './climate-rule.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const RAW = rawFolder(ROOT, arg('--raw'));
if (!RAW) { console.error('no data/raw/climate-open: run scripts/climate/download-open.mjs in the main checkout'); process.exit(1); }
const OUT = path.join(ROOT, 'public', 'assets', 'album', 'ground'), MAP = path.join(ROOT, 'public', 'assets', 'map');
console.log('reading', RAW);
const climateAt = openClimate(RAW);
const gun = f => { const b = zlib.gunzipSync(fs.readFileSync(f)), c = new Uint8Array(b.byteLength); c.set(b); return c.buffer; };
// the world map of the album: heights (rock under the ice sheets) and cells (1 = a lake)
const dem = decodeWorldHeights(new Int16Array(gun(path.join(MAP, "height.delta.bin.gz"))), WMAP_W);
const cells = new Uint32Array(gun(path.join(MAP, 'cells.bin.gz')));

const W = WORLD_W, H = WORLD_H, N = W * H, dLon = 360 / W, dLat = 180 / H, K = WMAP_W / W;
const wet = new Float32Array(N), summer = new Float32Array(N), warm = new Float32Array(N), lake = new Float32Array(N), ice = new Float32Array(N), has = new Uint8Array(N);
const t0 = Date.now();
for (let j = 0, o = 0; j < H; j++) {
  for (let i = 0; i < W; i++, o++) {
    let n = 0, a = 0, s = 0, w = 0, top = 0, rock = 0;
    for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const lat = 90 - (j + .25 + .5 * b) * dLat, lon = -180 + (i + .25 + .5 * c) * dLon, q = climateAt(lat, lon);
      rock += Math.max(0, worldAt(dem, lat, lon)) / 4;
      if (!q) continue;
      n++; a += wetOfAlpha(q.alpha); s += q.summer; w += q.warm; top += q.h;
    }
    if (n) { has[o] = 1; wet[o] = Math.max(.02, a / n); summer[o] = s / n; warm[o] = w / n; }
    // an ice sheet: land under lasting snow whose surface stands well above the rock of the world map
    const lat = 90 - (j + .5) * dLat;
    if (n && top / n - rock > 150 && snowlineOf(w / n, lat) < top / n) ice[o] = top / n;
    // the lakes: the share of the cell's points of the world map that are lake
    let lk = 0; for (let b = 0; b < K; b++) for (let c = 0; c < K; c++) if (cells[(j * K + b) * WMAP_W + i * K + c] === 1) lk++;
    lake[o] = lk / (K * K);
  }
  if (j % 256 === 255) console.log(`row ${j + 1} of ${H}, ${Math.round((Date.now() - t0) / 1000)} s`);
}
// cells without data take the nearest row that has some (the ocean north of 84° N)
let filled = 0;
for (let i = 0; i < W; i++) {
  let first = 0; while (first < H && !has[first * W + i]) first++;
  if (first === H) continue;
  for (let j = 0; j < H; j++) { const o = j * W + i; if (has[o]) continue; let k = j < first ? first : j; while (k > 0 && !has[k * W + i]) k--; const q = k * W + i; wet[o] = wet[q]; summer[o] = summer[q]; warm[o] = warm[q]; filled++; }
}
// A lake of a cell or two is drawn from its share between the cells, and a single high cell is a diamond there: the
// shares are smoothed over the eight cells around (1 2 1 / 2 4 2 / 1 2 1), which rounds the small lakes off.
{
  const src = lake.slice();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0;
    for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) sum += src[Math.max(0, Math.min(H - 1, j + b)) * W + (i + c + W) % W] * (2 - Math.abs(b)) * (2 - Math.abs(c));
    lake[j * W + i] = Math.min(1, sum / 16 * 1.25);             // (× 1.25: a lake of four cells is water, one of a cell or two is not — it would be a square pond)
  }
}
// (single cells of «ice» on a mountain here and there are the difference of two maps, not ice sheets: an ice sheet
// is many cells together)
const sheet = new Uint8Array(N); let iceCells = 0;
for (let j = 1; j < H - 1; j++) for (let i = 0; i < W; i++) { const o = j * W + i; if (!ice[o]) continue; let near = 0; for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) if (ice[Math.max(0, Math.min(H - 1, j + b)) * W + (i + c + W) % W]) near++; if (near >= 18) { sheet[o] = 1; iceCells++; } }
for (let o = 0; o < N; o++) if (!sheet[o]) ice[o] = 0;
fs.mkdirSync(OUT, { recursive: true });
const bytes = encodeWorldClimate({ w: W, h: H, lake, wet, warm, summer, ice }), gz = zlib.gzipSync(bytes, { level: 9 });
fs.writeFileSync(path.join(OUT, 'world.bin.gz'), gz);
console.log(`world.bin.gz: ${W} × ${H} cells of ${dLon.toFixed(4)}°, ${gz.length} bytes (${WORLD_MAGIC}); ${filled} cells filled from their neighbours; ${lake.reduce((s, v) => s + (v >= .5), 0)} cells of lake, ${iceCells} of ice sheet`);

// ---- what the rule says of places everyone knows (from the file, as the shader will read it)
const back = decodeWorldClimate(bytes);
const at = (lat, lon) => { const i = Math.min(W - 1, Math.floor((lon + 180) / dLon)), j = Math.min(H - 1, Math.floor((90 - lat) / dLat)), o = (j * W + i) * 4, d = back.data;
  return { lake: d[o] / 255, wet: d[o + 1] / 255, warm: WARM_WORLD[0] + d[o + 2] / 255 * (WARM_WORLD[1] - WARM_WORLD[0]), summer: d[o + 3] / 255, ice: back.ice[j * W + i] * ICE_STEP }; };
const PLACES = { 'Париж': [48.85, 2.35], 'Альпы (Монблан)': [45.83, 6.86], 'Осло': [59.9, 10.75], 'Тромсё': [69.65, 18.95], 'Шпицберген': [78.5, 16], 'Рейкьявик': [64.15, -21.9],
  'Гренландия, щит': [72, -40], 'Москва': [55.75, 37.6], 'Якутск': [62, 129.7], 'Таймыр': [74, 100], 'Каир': [30.05, 31.25], 'Сахара': [23, 10], 'Сахель': [14, 5],
  'Конго': [0, 22], 'Килиманджаро': [-3.07, 37.35], 'Кейптаун': [-33.9, 18.4], 'Лхаса': [29.65, 91.1], 'Эверест': [27.99, 86.93], 'Дели': [28.6, 77.2], 'Гоби': [43, 105],
  'Токио': [35.7, 139.7], 'Сингапур': [1.3, 103.8], 'Алис-Спрингс': [-23.7, 133.9], 'Сидней': [-33.9, 151.2], 'Манаус': [-3.1, -60], 'Кито': [-0.2, -78.5], 'Атакама': [-24, -69.5],
  'Патагония': [-49.5, -73], 'Нью-Йорк': [40.7, -74], 'Денвер': [39.74, -105], 'Аляска, хребет': [63.1, -151], 'Антарктида, берег': [-70, 0], 'Антарктида, купол': [-80, 90], 'Северный полюс': [89, 0],
  'Байкал': [53.5, 108], 'Виктория': [-1, 33], 'Мичиган': [44, -87] };
console.log('\nplace               wet  summer  warm0  trees to  snow from  lake  ice');
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const c = at(lat, lon);
  console.log(`${name.padEnd(18)} ${c.wet.toFixed(2)}   ${c.summer.toFixed(2)}   ${c.warm.toFixed(1).padStart(5)}  ${String(Math.round(worldTreelineOf(c.warm, Math.min(c.summer, c.wet * 1.6)))).padStart(6)} m  ${String(Math.round(snowlineOf(c.warm, lat))).padStart(6)} m  ${c.lake.toFixed(2)}  ${c.ice || ''}`);
}

// ---- check pictures: the baked numbers as grey maps
const png = arg('--png');
if (png) {
  const sharp = (await import('sharp')).default;
  for (const [p, name] of ['lake', 'wet', 'warm', 'summer', 'ice'].entries()) {
    const buf = Buffer.alloc(N); for (let o = 0; o < N; o++) buf[o] = p < 4 ? back.data[o * 4 + p] : back.ice[o];
    await sharp(buf, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(png, `world-${name}.png`));
  }
  console.log('check pictures in', png);
}
