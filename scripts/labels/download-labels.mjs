// Downloads the open sources used by the zone-label baker into data/raw/labels/.
//   - Natural Earth 1:10m physical labels (public domain)
//   - Alegreya SC font family by Huerta Tipográfica (SIL Open Font License 1.1)
// Usage: tools/node/node.exe scripts/labels/download-labels.mjs
// Sources and licences are recorded in data/sources/labels.md.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'labels');
const FONT_OUT = path.join(ROOT, 'public', 'assets', 'labels', 'fonts');

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/alegreyasc/';

export const SOURCES = [
  [NE + 'ne_10m_geography_regions_polys.geojson', 'ne_10m_geography_regions_polys.geojson'],
  [NE + 'ne_10m_geography_marine_polys.geojson', 'ne_10m_geography_marine_polys.geojson'],
  [NE + 'ne_10m_geography_regions_points.geojson', 'ne_10m_geography_regions_points.geojson'],
  [GF + 'AlegreyaSC-Medium.ttf', 'AlegreyaSC-Medium.ttf'],
  [GF + 'AlegreyaSC-MediumItalic.ttf', 'AlegreyaSC-MediumItalic.ttf'],
  [GF + 'OFL.txt', 'AlegreyaSC-OFL.txt'],
];

async function fetchTo(url, dest, tries = 4) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + '.part', buf);
      fs.renameSync(dest + '.part', dest);
      return buf.length;
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

fs.mkdirSync(RAW, { recursive: true });
for (const [url, name] of SOURCES) {
  try {
    const r = await fetchTo(url, path.join(RAW, name));
    console.log(name, r);
  } catch (e) {
    console.warn('FAILED', name, e.message);
  }
}

// Publish the font files next to the labels (the game loads them with FontFace).
fs.mkdirSync(FONT_OUT, { recursive: true });
for (const f of ['AlegreyaSC-Medium.ttf', 'AlegreyaSC-MediumItalic.ttf', 'AlegreyaSC-OFL.txt']) {
  const src = path.join(RAW, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(FONT_OUT, f));
}
console.log('fonts ->', path.relative(ROOT, FONT_OUT));
