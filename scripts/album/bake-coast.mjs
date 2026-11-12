// Where the shore of the album's region is a beach: every natural=beach of OpenStreetMap
// (scripts/album/osm-extract.mjs) laid on a raster of 2048 × 2048 cells of 625 m over the album's square of flat km.
// A cell says how much of the shore in it is beach, 0..255. The shore itself is drawn from the heights; this raster
// only tells the ground shader where to put sand at the waterline and where to leave rock.
// → public/assets/album/water/coast.bin.gz (in git; © OpenStreetMap contributors, ODbL 1.0): bytes, row by row from
// the south, west to east.
//   node scripts/album/bake-coast.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { OUT_DIR } from './osm-extract.mjs';
import { COAST_N, COAST_X0, COAST_Y0, COAST_KM } from '../../src/album/water/courses.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const KX = 111.195 * Math.cos(40 * Math.PI / 180) / 1e6, KY = 111.195 / 1e6, N = COAST_N, C = COAST_KM / N;
const len = new Float32Array(N * N); let count = 0, km = 0;
for (const f of readdirSync(OUT_DIR).filter(f => f.endsWith('.beaches.json.gz'))) for (const b of JSON.parse(gunzipSync(readFileSync(join(OUT_DIR, f))))) {
  const p = b.pts; let per = 0, hit = false;
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2] * KX, y0 = p[i - 1] * KY, x1 = p[i] * KX, y1 = p[i + 1] * KY, l = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(l / .15));
    for (let s = 0; s < steps; s++) { const t = (s + .5) / steps, cx = Math.floor((x0 + (x1 - x0) * t - COAST_X0) / C), cy = Math.floor((y0 + (y1 - y0) * t - COAST_Y0) / C); if (cx >= 0 && cy >= 0 && cx < N && cy < N) { len[cy * N + cx] += l / steps; hit = true; } }
    per += l;
  }
  if (hit) { count++; km += per / 2; }
}
// a beach has two long sides, so half of its outline is its length; a cell whose shore is all beach holds about one
// cell's width of it
const v = new Float32Array(N * N); for (let i = 0; i < N * N; i++) v[i] = Math.min(1, len[i] / (2 * C) * 1.2);
// the shore of the heights lies up to a few hundred metres from the real one: a beach reaches its neighbours too
const out = new Uint8Array(N * N); let cells = 0;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let m = v[y * N + x], s = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const q = v[yy * N + xx]; s += q; n++; if (q * .75 > m) m = q * .75; }
  const val = Math.round(Math.min(1, m * .7 + s / n * .9) * 255); out[y * N + x] = val; if (val) cells++;
}
const gz = gzipSync(Buffer.from(out.buffer), { level: 9 });
writeFileSync(join(ROOT, 'public', 'assets', 'album', 'water', 'coast.bin.gz'), gz);
console.log(`${count} beaches, ${Math.round(km)} km of them, in ${cells} cells → coast.bin.gz ${(gz.length / 1e3).toFixed(0)} KB`);
