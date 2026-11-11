// Real river courses for the graphics album: every way tagged waterway=river in OpenStreetMap inside the region
// (© OpenStreetMap contributors, ODbL 1.0), asked from the public Overpass API one square degree at a time.
// Raw answers are cached in data/album/osm/ (gitignored), so the script can be re-run and resumes where it stopped.
// scripts/album/bake-rivers.mjs turns the cache into public/assets/album/water/rivers.bin.gz.
//   node scripts/album/fetch-rivers.mjs
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..', '..');
export const OSM_CACHE = join(ROOT, 'data', 'album', 'osm');
export const TILES = []; for (let lat = 35; lat < 45; lat++) for (let lon = -11; lon < 5; lon++) TILES.push([lat, lon]);
export const tileFile = (lat, lon) => join(OSM_CACHE, `rivers_${lat}_${lon}.json.gz`);
const HOST = 'https://overpass-api.de/api/interpreter';
const UA = { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)', 'Content-Type': 'application/x-www-form-urlencoded' };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function ask(lat, lon) {
  const q = `[out:json][timeout:240][maxsize:1073741824];way["waterway"="river"](${lat},${lon},${lat + 1},${lon + 1});out tags geom qt;`;
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(HOST, { method: 'POST', headers: UA, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(280000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const j = JSON.parse(text);                                    // an answer cut short does not parse
      if (j.remark && /error|timed out/i.test(j.remark)) throw new Error(j.remark.slice(0, 80));
      return { text, ways: j.elements.length };
    } catch (e) { console.log(`  ${lat},${lon}: ${String(e.message || e).slice(0, 90)}, again`); await wait(5000 + 3000 * Math.min(i, 5)); }
  }
  return null;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/album/fetch-rivers.mjs')) {
  mkdirSync(OSM_CACHE, { recursive: true });
  let done = 0, failed = 0, bytes = 0, next = 0;
  const todo = TILES.filter(([lat, lon]) => { const f = tileFile(lat, lon); if (existsSync(f) && statSync(f).size > 0) { done++; return false; } return true; });
  await Promise.all([0, 1].map(async () => {                        // the public server gives two slots to an address
    while (next < todo.length) {
      const [lat, lon] = todo[next++], a = await ask(lat, lon);
      if (!a) { failed++; console.log(`  ${lat},${lon}: gave up`); continue; }
      writeFileSync(tileFile(lat, lon), gzipSync(Buffer.from(a.text), { level: 6 }));
      bytes += a.text.length; done++;
      console.log(`  ${lat},${lon}: ${a.ways} ways, ${(a.text.length / 1e6).toFixed(1)} MB (${done}/${TILES.length})`);
      await wait(1000);
    }
  }));
  console.log(`done: ${done} squares, ${failed} failed, ${(bytes / 1e6).toFixed(0)} MB asked this run → ${OSM_CACHE}`);
}
