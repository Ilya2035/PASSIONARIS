// Renders main-menu art with the game's own engine (no paid generation):
//   node scripts/render-menu-art.mjs            -> public/assets/ui/menu-nile-delta.jpg
// Requires `npm run build` first (Electron serves dist/ + public/).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const sharp = require('sharp');
const electron = require('electron'); // path to the binary

const SHOTS = [
  {
    name: 'menu-nile-delta',
    // looking north over the delta: the fan, the coast, the Mediterranean beyond
    query: 'lat=31.9&lon=31.6&alt=0.13&tilt=52&clean=1&mode=terrain&palette=graphite',
    caption: 'Дельта Нила · 30°45′ с.ш. 31°03′ в.д.',
  },
];

fs.mkdirSync(path.join(ROOT, 'public', 'assets', 'ui'), { recursive: true });
for (const s of SHOTS) {
  const tmp = path.join(os.tmpdir(), `${s.name}.png`);
  const env = { ...process.env, PASSIONARIS_CAPTURE: JSON.stringify({ query: s.query, width: 2560, height: 1440, out: tmp }) };
  // --disable-gpu-sandbox: some sandboxed shells cannot start Chromium's GPU sandbox; harmless for a one-off render
  const r = spawnSync(electron, ['--disable-gpu-sandbox', '.'], { cwd: ROOT, env, stdio: 'inherit', timeout: 180000 });
  if (r.status !== 0 && !fs.existsSync(tmp)) throw new Error(`capture failed for ${s.name}`);
  const out = path.join(ROOT, 'public', 'assets', 'ui', `${s.name}.jpg`);
  await sharp(tmp).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  fs.writeFileSync(out.replace(/\.jpg$/, '.json'), JSON.stringify({ caption: s.caption, query: s.query }, null, 2));
  console.log('menu art:', path.relative(ROOT, out));
}
