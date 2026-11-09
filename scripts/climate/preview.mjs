// Debug previews of the climate assets (PNG). Not used by the game.
// Usage: tools/node/node.exe scripts/climate/preview.mjs <outDir>
//   normals-jan.png / normals-jul.png  temperature (blue -40 °C .. red +40 °C)
//   normals-pann.png                   annual precipitation (log scale)
//   biome.png                          biome classes at 2048x1024 (colours from biomes.json)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { loadNormals, W, H, N } from '../../src/sim/climate/climatology.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const outDir = path.resolve(process.argv[2] || '.');
fs.mkdirSync(outDir, { recursive: true });

const nm = await loadNormals();
const png = (rgb, w, h, f) => sharp(Buffer.from(rgb.buffer), { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(outDir, f));

function tempRGB(t) {
  const u = Math.max(0, Math.min(1, (t + 40) / 80));
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.6 * u - 0.3)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.3 - 1.6 * u)));
  const g = Math.round(255 * (1 - Math.abs(u - 0.5) * 1.6));
  return [r, Math.max(0, g), b];
}
for (const [m, name] of [[0, 'jan'], [6, 'jul']]) {
  const rgb = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) rgb.set(tempRGB(nm.tavg[m * N + i] / 10), i * 3);
  await png(rgb, W, H, `normals-${name}.png`);
}
{
  const rgb = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) {
    let p = 0;
    for (let m = 0; m < 12; m++) p += nm.prec[m * N + i];
    const u = Math.max(0, Math.min(1, Math.log10(Math.max(p, 10)) / 3.6 - 0.25));
    rgb.set([Math.round(230 - 200 * u), Math.round(220 - 90 * u), Math.round(180 + 60 * u)], i * 3);
  }
  await png(rgb, W, H, 'normals-pann.png');
}
const bf = path.join(ROOT, 'public', 'assets', 'climate', 'biome.bin.gz');
if (fs.existsSync(bf)) {
  const bio = zlib.gunzipSync(fs.readFileSync(bf));
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'climate', 'biomes.json'), 'utf8')).classes;
  const cols = table.map(c => [1, 3, 5].map(k => parseInt(c.color.slice(k, k + 2), 16)));
  const MW = 8192, S = 4, w = MW / S, h = 4096 / S;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(cols[bio[(y * S + 2) * MW + x * S + 2]] || [255, 0, 255], (y * w + x) * 3);
  await png(rgb, w, h, 'biome.png');
}
console.log('previews written to', outDir);
