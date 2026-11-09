// Fast terrarium tile downloader.
//   node scripts/download-tiles.mjs <zoom> [--concurrency 64] [--reverse] [--land-only]
// --land-only skips tiles with no land in the baked cell map (deep-ocean detail is not needed above z7).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const Z = Number(argv[0]);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const CONC = Number(opt('concurrency', 64));
const REVERSE = argv.includes('--reverse');
const LAND_ONLY = argv.includes('--land-only');
const DIR = path.join(ROOT, 'data', 'raw', 'terrarium', String(Z));
fs.mkdirSync(DIR, { recursive: true });

const N = 2 ** Z;
let land = null, LW = 0, LH = 0;
if (LAND_ONLY) {
  const b = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz')));
  land = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  LW = 8192; LH = 4096;
}
const tileHasLand = (x, y) => {
  if (!land) return true;
  const lon0 = x / N * 360 - 180, lon1 = (x + 1) / N * 360 - 180;
  const merc = t => Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180 / Math.PI;
  const lat0 = merc(y / N), lat1 = merc((y + 1) / N);
  const x0 = Math.floor((lon0 + 180) / 360 * LW) - 1, x1 = Math.ceil((lon1 + 180) / 360 * LW) + 1;
  const y0 = Math.floor((90 - lat0) / 180 * LH) - 1, y1 = Math.ceil((90 - lat1) / 180 * LH) + 1;
  for (let yy = Math.max(0, y0); yy <= Math.min(LH - 1, y1); yy++)
    for (let xx = x0; xx <= x1; xx++) if (land[yy * LW + ((xx % LW) + LW) % LW] >= 1) return true; // land or lake
  return false;
};

const todo = [];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  if (fs.existsSync(path.join(DIR, `${x}_${y}.png`))) continue;
  if (!tileHasLand(x, y)) continue;
  todo.push([x, y]);
}
if (REVERSE) todo.reverse();
console.log(`z${Z}: ${todo.length} tiles to fetch, concurrency ${CONC}`);

let done = 0, bytes = 0, fail = 0;
const t0 = Date.now();
async function get([x, y]) {
  const dest = path.join(DIR, `${x}_${y}.png`);
  if (fs.existsSync(dest)) return;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const part = `${dest}.${process.pid}.part`;
      fs.writeFileSync(part, buf);
      fs.renameSync(part, dest);
      bytes += buf.length;
      return;
    } catch (e) {
      if (i === 4) { fail++; console.log('fail', x, y, e.message); }
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < todo.length) {
    await get(todo[next++]);
    if (++done % 500 === 0) {
      const s = (Date.now() - t0) / 1000;
      console.log(`  ${done}/${todo.length}  ${(done / s).toFixed(1)} tiles/s  ${(bytes / 1e6 / s).toFixed(2)} MB/s`);
    }
  }
}));
console.log(`done z${Z}: ${done} tiles, ${fail} failed, ${(bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
