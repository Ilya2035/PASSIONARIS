// Where people really settled: the cities, towns and larger villages of OpenStreetMap inside the album's region
// (scripts/album/osm-extract.mjs). The centre of a district stands on the largest of them (division/centres.js): a
// real town site is by its water, in its valley, at the foot of its hills — the place the owner asks a district's
// centre to be. → public/assets/album/town/sites.json.gz (in git; © OpenStreetMap contributors, ODbL 1.0):
//   { sites: [[lon × 1e4, lat × 1e4, people, kind (0 city, 1 town, 2 village), name, name of the data], …] }, the most
//   populous first. The name is Russian: the Russian name of the data or, where it has none, the local name
//   transcribed (src/album/town/translit.js); such a record keeps the name of the data as its sixth number.
//   node scripts/album/bake-sites.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { OUT_DIR } from './osm-extract.mjs';
import { russifySites } from '../../src/album/town/translit.js';
import { BBOX } from '../../src/album/geo.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
// (the rectangle of the album's region is the one of src/album/geo.js: it grows with the polygon, nothing is written here)
const BOX = BBOX, KIND = { city: 0, town: 1, village: 2 }, GUESS = [60000, 6000, 0];
const seen = new Set(), sites = [];
for (const f of readdirSync(OUT_DIR).filter(f => f.endsWith('.places.json.gz'))) for (const p of JSON.parse(gunzipSync(readFileSync(join(OUT_DIR, f))))) {
  const kind = KIND[p.t]; if (kind === undefined) continue;
  const lat = p.lat / 1e6, lon = p.lon / 1e6; if (lat <= BOX.lat0 || lat >= BOX.lat1 || lon <= BOX.lon0 || lon >= BOX.lon1) continue;
  const pop = p.pop || GUESS[kind]; if (pop < 400) continue;                       // a village of unknown size is left out
  const key = `${Math.round(lon * 500)},${Math.round(lat * 500)},${p.name}`; if (seen.has(key)) continue; seen.add(key);
  sites.push([Math.round(lon * 1e4), Math.round(lat * 1e4), pop, kind, p.ru || p.name || '']);
}
sites.sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1]);
const units = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'album', 'division', 'admin.json'), 'utf8')).units;
// (a place the data gives no name — at stage 3 there are five, in Morocco and in the Sahara — is left out: a
// settlement nobody named cannot be told on the map, and the list is of names)
const [named, stats] = russifySites(sites, units), nameless = named.filter(s => !s[4]).length; sites.length = 0; sites.push(...named.filter(s => s[4]));
if (nameless) console.log(`left out: ${nameless} places without a name`);
console.log(`names: ${stats.kept} Russian in the data, transcribed ${Object.entries(stats.byLang).map(([l, n]) => `${l} ${n}`).join(', ')}`);
const gz = gzipSync(Buffer.from(JSON.stringify({ v: 2, source: '© OpenStreetMap contributors, ODbL 1.0', sites })), { level: 9 });
mkdirSync(join(ROOT, 'public', 'assets', 'album', 'town'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'assets', 'album', 'town', 'sites.json.gz'), gz);
console.log(`${sites.length} sites: ${sites.filter(s => s[3] === 0).length} cities, ${sites.filter(s => s[3] === 1).length} towns, ${sites.filter(s => s[3] === 2).length} villages of 400 people and more → sites.json.gz ${(gz.length / 1e3).toFixed(0)} KB`);
