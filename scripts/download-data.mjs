// Downloads open map sources into data/raw.
// Sources (all open):
//  - Natural Earth (public domain)              https://www.naturalearthdata.com
//  - NASA Blue Marble Next Generation (public domain, NASA)
//  - AWS Terrain Tiles / Mapzen "terrarium" (open data, see data/ATTRIBUTION.md)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const TILE_ZOOM = Number(process.env.TILE_ZOOM || 5);

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const files = [
  [NE + 'ne_10m_admin_0_countries.geojson', 'ne_10m_admin_0_countries.geojson'],
  [NE + 'ne_10m_admin_1_states_provinces.geojson', 'ne_10m_admin_1_states_provinces.geojson'],
  [NE + 'ne_10m_lakes.geojson', 'ne_10m_lakes.geojson'],
  [NE + 'ne_10m_rivers_lake_centerlines.geojson', 'ne_10m_rivers_lake_centerlines.geojson'],
  [NE + 'ne_10m_populated_places_simple.geojson', 'ne_10m_populated_places_simple.geojson'],
  ['https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/june/world.topo.200406.3x21600x10800.jpg', 'bluemarble_june_21600.jpg'],
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

async function pool(items, n, fn) {
  let i = 0, done = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
      if (++done % 64 === 0) console.log(`  tiles ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

fs.mkdirSync(RAW, { recursive: true });
for (const [url, name] of files) {
  const r = await fetchTo(url, path.join(RAW, name));
  console.log(name, r);
}

const n = 2 ** TILE_ZOOM;
const tiles = [];
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tiles.push([x, y]);
console.log(`terrarium z${TILE_ZOOM}: ${tiles.length} tiles`);
await pool(tiles, 24, ([x, y]) =>
  fetchTo(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_ZOOM}/${x}/${y}.png`,
    path.join(RAW, 'terrarium', String(TILE_ZOOM), `${x}_${y}.png`)));
console.log('done');
