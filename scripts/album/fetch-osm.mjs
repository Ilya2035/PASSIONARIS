// OpenStreetMap extracts of the album's region (© OpenStreetMap contributors, ODbL 1.0) from download.geofabrik.de,
// the server meant for bulk downloads. About 7 GB go to data/album/osm/pbf/ (gitignored); files already there are
// kept, and a download that was cut off goes on from where it stopped. scripts/album/osm-extract.mjs reads the
// files; the big files may be deleted afterwards.
//   node scripts/album/fetch-osm.mjs
import { mkdirSync, existsSync, statSync, createWriteStream, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(import.meta.dirname, '..', '..');
// (PASSIONARIS_OSM: another folder with pbf/ in it — a worktree reads the raw files of the main folder instead of copying them)
export const OSM_DIR = process.env.PASSIONARIS_OSM || join(ROOT, 'data', 'album', 'osm');
export const PBF_DIR = join(OSM_DIR, 'pbf');
// Spain, Portugal, Andorra, the north of Morocco and Algeria, and all of France by its regions (Geofabrik keeps the
// regions of before 2016). What lies outside the region of the album (geo.js, BBOX) is cut away by osm-extract.mjs.
const FRANCE = ['alsace', 'aquitaine', 'auvergne', 'basse-normandie', 'bourgogne', 'bretagne', 'centre', 'champagne-ardenne', 'corse', 'franche-comte', 'haute-normandie', 'ile-de-france', 'languedoc-roussillon', 'limousin',
  'lorraine', 'midi-pyrenees', 'nord-pas-de-calais', 'pays-de-la-loire', 'picardie', 'poitou-charentes', 'provence-alpes-cote-d-azur', 'rhone-alpes'];
// (stage 3, the worked land: Iberia; France with Monaco and the Channel Islands; Belgium, the Netherlands,
// Luxembourg and Germany left of the Rhine — the Rhineland-Palatinate, the Saarland and the districts of Cologne and
// Düsseldorf; the Maghreb — Morocco, Algeria, Tunisia. What of an extract lies beyond the worked land — the right
// bank of the Rhine, the Sahara, Corsica — is cut by the mask of the worked land, src/album/worked.js.)
const BENELUX = ['europe/belgium', 'europe/netherlands', 'europe/luxembourg', 'europe/monaco', 'europe/guernsey-jersey'];
const RHINE = ['europe/germany/rheinland-pfalz', 'europe/germany/saarland', 'europe/germany/nordrhein-westfalen/koeln-regbez', 'europe/germany/nordrhein-westfalen/duesseldorf-regbez'];
export const EXTRACTS = ['europe/andorra', 'europe/portugal', ...FRANCE.map(r => 'europe/france/' + r), ...BENELUX, ...RHINE, 'africa/morocco', 'africa/algeria', 'africa/tunisia', 'europe/spain'];
export const pbfFile = e => join(PBF_DIR, e.split('/').pop() + '.osm.pbf');
const UA = { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)' };

async function get(e) {
  const f = pbfFile(e), part = f + '.part';
  if (existsSync(f) && statSync(f).size > 1e6) return console.log(`have ${e}`);
  for (let i = 0; i < 6; i++) {
    const have = existsSync(part) ? statSync(part).size : 0, t = Date.now();
    try {
      const r = await fetch(`https://download.geofabrik.de/${e}-latest.osm.pbf`, { headers: have ? { ...UA, Range: `bytes=${have}-` } : UA });
      if (r.status === 416) { renameSync(part, f); return console.log(`got ${e}`); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(part, { flags: r.status === 206 ? 'a' : 'w' }));
      renameSync(part, f);
      return console.log(`got ${e}: ${(statSync(f).size / 1e6).toFixed(0)} MB, the last ${((statSync(f).size - have) / 1e6).toFixed(0)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } catch (err) { console.log(`  ${e}: ${String(err.message || err).slice(0, 80)}, again`); await new Promise(s => setTimeout(s, 4000)); }
  }
  console.log(`failed ${e}`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/album/fetch-osm.mjs')) {
  mkdirSync(PBF_DIR, { recursive: true });
  let next = 0;
  await Promise.all([0, 1, 2].map(async () => { while (next < EXTRACTS.length) await get(EXTRACTS[next++]); }));
  console.log('done →', PBF_DIR);
}
