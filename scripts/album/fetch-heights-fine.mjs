// Fine heights of the mountains of the album: AWS Terrain Tiles ("terrarium" PNGs) of zoom 11 — a point every 57 m at
// 42° N, four times finer than the base of the album (zoom 9, 230 m; scripts/album/fetch-data.mjs).
//
// Only mountain tiles are taken: the whole land in this detail would be 2 600 tiles and 290 MB, the mountains are 890
// tiles and about 100 MB. A tile of zoom 11 (about 14.5 km) is a mountain tile when the base heights inside it span
// RELIEF metres or more, or when STEEP of its ground or more is steeper than 15°. A tile with four or more mountain
// tiles among its eight neighbours is taken too, so that a valley inside a range is not left coarse.
// REGION says where to look (now the Iberian Peninsula with both sides of the Pyrenees and the Balearic Islands).
// Where a tile is missing, the page has only the base heights: it fills the gap from them.
//
// Everything lands in the MAIN checkout, outside git (a worktree gets the baked tiles through worktree-setup.mjs):
//   data/album/terrarium/11/<x>/<y>.png        the downloads, kept so that the script resumes where it stopped
//   public/album-data/h11/<x>_<y>.u16d.gz      one baked tile, 256 × 256
//   public/album-data/meta.json → fine         { z, dir, tile, step, encode, relief, steep, tiles: [[x, y], …], bytes }
//
// A baked tile: gzip of 65 536 little-endian Uint16, rows from the north. Each value is stored minus the value before it
// in its row (the first of a row — minus the first of the row above; the very first — as it is), modulo 65 536.
// Decoded value v: metres = v / 4 − 8192, the same as the base; heights are rounded to half a metre first.
//   const d = new Uint16Array(buffer), u = new Uint16Array(65536);
//   for (let k = 0; k < 65536; k++) u[k] = (d[k] + (k % 256 ? u[k - 1] : k ? u[k - 256] : 0)) & 65535;
//
//   node scripts/album/fetch-heights-fine.mjs --plan [folder]   which tiles and how much; a picture of the choice
//   node scripts/album/fetch-heights-fine.mjs                   download what is missing, bake, write meta.json
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MAIN = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
const CACHE = join(MAIN, 'data', 'album', 'terrarium');
const DATA = join(MAIN, 'public', 'album-data');
const UA = { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)' };

export const Z = 11, RELIEF = 800, STEEP = .15, STEP = .5, DIR = 'h11/';
// where mountains are looked for: not Africa (south of the Strait and of the sea of Alborán) and not France beyond the
// foot of the Pyrenees
export const REGION = (lat, lon) => lat >= 35.95 && !(lon > -1.75 && lat < 37.1) && !(lat > 43.45 && lon > -1.4);

const lonOf = (x, z) => x / 2 ** z * 360 - 180;
const latOf = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
export const tileName = (x, y) => `${x}_${y}.u16d.gz`;

// the mountain tiles, from the base heights of the album
export function chooseTiles(meta, raw) {
  const b = meta.base, k = 2 ** (Z - b.z), n = 256 / k;               // tiles of zoom Z per base tile; base pixels per tile
  const X0 = b.x0 * k, Y0 = b.y0 * k, W = b.w / n, H = b.h / n;
  const relief = new Float32Array(W * H), land = new Float32Array(W * H), steep = new Float32Array(W * H);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const lat = latOf(Y0 + ty + .5, Z), px = 40075016 * Math.cos(lat * Math.PI / 180) / 2 ** b.z / 256;   // metres in a base pixel
    let lo = 1e9, hi = -1e9, dry = 0, st = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = (ty * n + j) * b.w + tx * n + i, h = raw[p] / 4 - 8192;
      if (h > 1) dry++;
      const g = Math.max(0, h); if (g < lo) lo = g; if (g > hi) hi = g;
      if (i < n - 1 && j < n - 1 && Math.hypot(raw[p + 1] - raw[p], raw[p + b.w] - raw[p]) / 4 / px > .268) st++;   // tan 15°
    }
    relief[ty * W + tx] = hi - lo; land[ty * W + tx] = dry / (n * n); steep[ty * W + tx] = st / (n * n);
  }
  const core = new Uint8Array(W * H), take = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) core[i] = land[i] >= .1 && (relief[i] >= RELIEF || steep[i] >= STEEP) ? 1 : 0;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    if (land[ty * W + tx] < .02 || !REGION(latOf(Y0 + ty + .5, Z), lonOf(X0 + tx + .5, Z))) continue;
    let near = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if ((dx || dy) && x >= 0 && y >= 0 && x < W && y < H && core[y * W + x]) near++;
    }
    take[ty * W + tx] = core[ty * W + tx] || near >= 4 ? 1 : 0;
  }
  const tiles = [];
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) if (take[ty * W + tx]) tiles.push([X0 + tx, Y0 + ty]);
  return { tiles, X0, Y0, W, H, relief, land, take, core };
}

// one tile: terrarium PNG → the delta-coded Uint16 of the header
export function encodeTile(rgb, channels) {
  const u = new Uint16Array(65536), d = new Uint16Array(65536);
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 65536; k++) {
    const h = rgb[k * channels] * 256 + rgb[k * channels + 1] + rgb[k * channels + 2] / 256 - 32768;
    if (h < lo) lo = h; if (h > hi) hi = h;
    u[k] = Math.max(0, Math.min(65535, Math.round((Math.round(h / STEP) * STEP + 8192) * 4)));
  }
  for (let k = 0; k < 65536; k++) d[k] = (u[k] - (k % 256 ? u[k - 1] : k ? u[k - 256] : 0)) & 65535;
  return { d, u, lo, hi };
}
export function decodeTile(buffer) {
  const d = new Uint16Array(buffer.buffer, buffer.byteOffset, 65536), u = new Uint16Array(65536);
  for (let k = 0; k < 65536; k++) u[k] = (d[k] + (k % 256 ? u[k - 1] : k ? u[k - 256] : 0)) & 65535;
  return u;
}

async function get(url, file, tries = 4) {
  if (existsSync(file) && statSync(file).size > 0) return true;
  mkdirSync(dirname(file), { recursive: true });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 404) return false;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) { if (i === tries - 1) { console.log('  failed', url, String(e).slice(0, 80)); return false; } await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
}
async function pool(items, n, fn) { let i = 0, done = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); if (++done % 100 === 0) console.log(`  ${done}/${items.length}`); } })); }

if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8'));
  const gz = gunzipSync(readFileSync(join(DATA, meta.base.file)));
  const raw = new Uint16Array(gz.buffer, gz.byteOffset, gz.length / 2);
  const c = chooseTiles(meta, raw), tiles = c.tiles;
  console.log(`zoom ${Z}: ${tiles.length} mountain tiles of ${c.W * c.H} (relief ≥ ${RELIEF} m or ${STEEP * 100} % of steep ground, holes filled), about ${(tiles.length * .11).toFixed(0)} MB to download`);

  if (process.argv.includes('--plan')) {
    const out = process.argv[process.argv.indexOf('--plan') + 1];
    if (out && !out.startsWith('--')) {      // the choice as a picture: relief in grey, the tiles taken in red, their core brighter
      const S = 10, img = Buffer.alloc(c.W * S * c.H * S * 3);
      for (let y = 0; y < c.H * S; y++) for (let x = 0; x < c.W * S; x++) {
        const t = (y / S | 0) * c.W + (x / S | 0), g = c.land[t] < .02 ? 30 : Math.min(255, 70 + c.relief[t] / 8), o = (y * c.W * S + x) * 3;
        img[o] = c.take[t] ? (c.core[t] ? 235 : 190) : g; img[o + 1] = c.take[t] ? g * .45 : g; img[o + 2] = c.land[t] < .02 ? 60 : c.take[t] ? g * .4 : g;
      }
      mkdirSync(out, { recursive: true });
      await sharp(img, { raw: { width: c.W * S, height: c.H * S, channels: 3 } }).png().toFile(join(out, 'fine-heights-plan.png'));
      console.log('picture →', join(out, 'fine-heights-plan.png'));
    }
    process.exit(0);
  }

  const file = ([x, y]) => join(CACHE, String(Z), String(x), `${y}.png`);
  await pool(tiles, 12, t => get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${t[0]}/${t[1]}.png`, file(t)));
  mkdirSync(join(DATA, DIR), { recursive: true });
  const kept = []; let bytes = 0, lo = 1e9, hi = -1e9, checked = 0;
  for (const t of tiles) {
    if (!existsSync(file(t))) continue;
    const { data, info } = await sharp(file(t)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 256 || info.height !== 256) { console.log('  not 256 × 256, skipped:', t.join('/')); continue; }
    const e = encodeTile(data, info.channels), packed = gzipSync(Buffer.from(e.d.buffer), { level: 9 });
    if (kept.length % 97 === 0) {            // read a few back: the file must give the same heights
      const back = decodeTile(gunzipSync(packed));
      for (let k = 0; k < 65536; k++) if (back[k] !== e.u[k]) throw new Error(`tile ${t.join('/')} does not decode back`);
      checked++;
    }
    writeFileSync(join(DATA, DIR, tileName(t[0], t[1])), packed);
    kept.push(t); bytes += packed.length; lo = Math.min(lo, e.lo); hi = Math.max(hi, e.hi);
  }
  meta.fine = { z: Z, dir: DIR, tile: 256, step: STEP, relief: RELIEF, steep: STEEP,
    encode: 'gzip of 65536 little-endian Uint16, rows from the north; each value minus the one before it in its row (the first of a row minus the first of the row above), modulo 65536; decoded v: metres = v / 4 - 8192',
    name: '<x>_<y>.u16d.gz', min: Math.round(lo), max: Math.round(hi), bytes, tiles: kept };
  writeFileSync(join(DATA, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`baked ${kept.length} tiles, ${(bytes / 1e6).toFixed(1)} MB, ${Math.round(lo)}…${Math.round(hi)} m (${checked} read back) → ${join(DATA, DIR)}`);
  if (kept.length < tiles.length) console.log(`  ${tiles.length - kept.length} tiles are missing — run again`);
}
