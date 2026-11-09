// Renders the same views in every palette with the game engine and builds one comparison sheet.
//   node scripts/render-style-sheet.mjs   -> art/drafts/style-palettes.jpg   (needs `npm run build`)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const sharp = require('sharp');
const electron = require('electron');

const PALETTES = [['graphite', 'Графит и бумага'], ['sepia', 'Архивная сепия'], ['lead', 'Холодный свинец']];
const VIEWS = [
  ['Политическая карта', 'lat=49&lon=12&alt=0.42&mode=political'],
  ['Рельеф крупно (Альпы)', 'lat=46.6&lon=9.3&alt=0.05&tilt=44&mode=terrain'],
];
const W = 1280, H = 720, LABEL = 44;
const OUT = path.join(ROOT, 'art', 'drafts');
fs.mkdirSync(OUT, { recursive: true });

const tiles = [];
for (const [vi, [vname, vq]] of VIEWS.entries()) {
  for (const [pi, [pid, pname]] of PALETTES.entries()) {
    const tmp = path.join(os.tmpdir(), `style-${vi}-${pid}.png`);
    const env = { ...process.env, PASSIONARIS_CAPTURE: JSON.stringify({ query: `${vq}&palette=${pid}`, width: W, height: H, out: tmp }) };
    spawnSync(electron, ['--disable-gpu-sandbox', '.'], { cwd: ROOT, env, stdio: 'ignore', timeout: 180000 });
    if (!fs.existsSync(tmp)) throw new Error(`capture failed: ${vname} / ${pname}`);
    const label = Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#151413"/>
      <text x="18" y="29" font-family="Georgia" font-size="22" fill="#e8e3d7">${pname}</text>
      <text x="${W - 18}" y="29" text-anchor="end" font-family="Segoe UI" font-size="16" fill="#9a9488">${vname}</text></svg>`);
    tiles.push({ input: await sharp({ create: { width: W, height: H + LABEL, channels: 3, background: '#151413' } })
      .composite([{ input: label, top: 0, left: 0 }, { input: tmp, top: LABEL, left: 0 }]).png().toBuffer(), left: pi * W, top: vi * (H + LABEL) });
    console.log('rendered', vname, '/', pname);
  }
}
const out = path.join(OUT, 'style-palettes.jpg');
await sharp({ create: { width: W * PALETTES.length, height: (H + LABEL) * VIEWS.length, channels: 3, background: '#151413' } })
  .composite(tiles).jpeg({ quality: 86 }).toFile(out);
console.log('sheet:', path.relative(ROOT, out));
