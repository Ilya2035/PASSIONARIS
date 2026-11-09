// Downloads the supplementary Natural Earth layers used by the regions bake
// into data/raw/regions/. Natural Earth is public domain (see data/sources/regions.md).
// Run: tools/node/node.exe scripts/regions/download.mjs
// The bake works without these files (fewer river/feature names, no sea names).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIR = path.join(ROOT, 'data', 'raw', 'regions');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const SOURCES = [
  'ne_10m_rivers_europe.geojson',
  'ne_10m_rivers_north_america.geojson',
  'ne_10m_geography_regions_polys.geojson',
  'ne_10m_geography_marine_polys.geojson',
];

async function fetchTo(url, dest, tries = 4) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest + '.part', buf);
      fs.renameSync(dest + '.part', dest);
      return buf.length;
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

fs.mkdirSync(DIR, { recursive: true });
for (const name of SOURCES) {
  try {
    const r = await fetchTo(NE + name, path.join(DIR, name));
    console.log(name, r);
  } catch (e) {
    console.warn('FAILED (bake will run without it):', e.message);
  }
}
