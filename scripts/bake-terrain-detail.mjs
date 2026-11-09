// Bakes detailed heights (AWS terrarium z7, ~1.2 km at the equator) into equirectangular tiles for streaming.
//   node scripts/bake-terrain-detail.mjs
// Output: public/assets/terrain/z7/<tx>_<ty>.bin.gz — Int16 metres, 256x256, rows delta-encoded, gzip
//         public/assets/terrain/z7/index.json — grid size and the list of tiles that exist (land/coast only)
// Grid: 32768 x 16384 texels over the globe (0.010986°), tiles 256 px -> 128 x 64 tiles; row 0 = 90°N, col 0 = 180°W.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'data', 'raw', 'terrarium', '7');
const OUT = path.join(ROOT, 'public', 'assets', 'terrain', 'z7');
const Z = 7, N = 2 ** Z, TS = 256;            // source mercator tiles
const GW = 32768, GH = 16384, T = 256;         // target equirect grid & tile size
const TX = GW / T, TY = GH / T;                // 128 x 64 tiles
fs.mkdirSync(OUT, { recursive: true });

// land mask from the baked map cells (8192x4096): tile kept if any land/lake within it (+1 cell margin)
const cb = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz')));
const cells = new Uint32Array(cb.buffer, cb.byteOffset, cb.byteLength / 4);
const CW = 8192, CH = 4096, RATIO = GW / CW; // 4 detail texels per map cell
function tileHasLand(tx, ty) {
  const x0 = tx * T / RATIO - 1, x1 = (tx + 1) * T / RATIO + 1, y0 = Math.max(0, ty * T / RATIO - 1), y1 = Math.min(CH - 1, (ty + 1) * T / RATIO + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cells[y * CW + ((x % CW) + CW) % CW] >= 1) return true;
  return false;
}

// decoded source tiles, LRU
const cache = new Map();
async function srcTile(x, y) {
  const key = y * N + x;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const f = path.join(SRC, `${x}_${y}.png`);
  let h;
  if (fs.existsSync(f)) {
    const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
    h = new Float32Array(TS * TS);
    for (let i = 0; i < TS * TS; i++) { const o = i * info.channels; h[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768; }
  } else h = null;
  cache.set(key, h);
  if (cache.size > 900) cache.delete(cache.keys().next().value);
  return h;
}
// synchronous bilinear sample in global mercator pixels; tiles must be preloaded with ensureRows()
function mercSample(mx, my) {
  const W = N * TS;
  const y = Math.max(0, Math.min(W - 1.001, my));
  const x0 = Math.floor(mx), y0 = Math.floor(y), fx = mx - x0, fy = y - y0;
  const get = (px, py) => {
    px = ((px % W) + W) % W;
    const t = cache.get(Math.floor(py / TS) * N + Math.floor(px / TS));
    return t ? t[(py % TS) * TS + (px % TS)] : 0;
  };
  const y1 = Math.min(W - 1, y0 + 1);
  return (get(x0, y0) * (1 - fx) + get(x0 + 1, y0) * fx) * (1 - fy) + (get(x0, y1) * (1 - fx) + get(x0 + 1, y1) * fx) * fy;
}
async function ensure(xs, ys) { for (const y of ys) for (const x of xs) await srcTile(((x % N) + N) % N, y); }

const t0 = Date.now();
const LAT_MAX = 85.05112878;
const kept = [];
const out = new Int16Array(T * T);
const delta = new Int16Array(T * T);
for (let ty = 0; ty < TY; ty++) {
  for (let tx = 0; tx < TX; tx++) {
    if (!tileHasLand(tx, ty)) continue;
    // preload source tiles: same column (+neighbours for bilinear at the edges), rows covering the latitude band
    const lat0 = Math.max(-LAT_MAX, Math.min(LAT_MAX, 90 - ty * T * 180 / GH)), lat1 = Math.max(-LAT_MAX, Math.min(LAT_MAX, 90 - (ty + 1) * T * 180 / GH));
    const mY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * N;
    const ry0 = Math.max(0, Math.floor(mY(lat0)) - 1), ry1 = Math.min(N - 1, Math.floor(mY(lat1)) + 1);
    const cx = Math.floor(tx * T / GW * N);
    await ensure([cx - 1, cx, cx + 1], Array.from({ length: ry1 - ry0 + 1 }, (_, i) => ry0 + i));
    for (let y = 0; y < T; y++) {
      const lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, 90 - (ty * T + y + 0.5) * 180 / GH));
      const my = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * N * TS - 0.5;
      for (let x = 0; x < T; x++) {
        const mx = (tx * T + x + 0.5) / GW * N * TS - 0.5;
        out[y * T + x] = Math.max(-11000, Math.min(9000, Math.round(mercSample(mx, my))));
      }
    }
    for (let y = 0; y < T; y++) { let prev = 0; for (let x = 0; x < T; x++) { const i = y * T + x; delta[i] = out[i] - prev; prev = out[i]; } }
    fs.writeFileSync(path.join(OUT, `${tx}_${ty}.bin.gz`), zlib.gzipSync(Buffer.from(delta.buffer), { level: 6 }));
    kept.push(ty * TX + tx);
  }
  if (ty % 4 === 3) console.log(`row ${ty + 1}/${TY}  tiles ${kept.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ grid: [GW, GH], tile: T, tiles: [TX, TY], source: 'AWS Terrain Tiles terrarium z7', encoding: 'Int16 m, rows delta-encoded, gzip', kept }));
console.log(`done: ${kept.length} tiles in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
