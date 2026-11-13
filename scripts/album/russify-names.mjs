// The names of the settlements into Russian, once, when the data is prepared (the lead session, 13.11.2026: «все
// названия поселений на карте и в панели района по-русски… один раз при подготовке данных, не на лету; исходное
// название в данных сохранить»). The rules are in src/album/town/translit.js.
//   • public/assets/album/town/sites.json.gz — the list of real settlements (OpenStreetMap): a name the data has in
//     Latin (or Arabic) letters is transcribed; the record keeps the name of the data as its sixth number.
//   • public/assets/album/town/places-ru.json — Russian names for the places of the album itself (Natural Earth,
//     public/album-data/vectors.json) that the data names in Latin letters: { names: { name of the data: Russian } }.
// Running it again changes nothing: a record already transcribed is transcribed anew from the name it kept.
//   node scripts/album/russify-names.mjs [--list]      (--list prints every name with its transcription)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { russifySites, toRussian, guessLang, langOfUnit, unitFinder, hasLatin, hasCyrillic } from '../../src/album/town/translit.js';

const ROOT = resolve(import.meta.dirname, '..', '..'), TOWN = join(ROOT, 'public', 'assets', 'album', 'town');
const units = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'album', 'division', 'admin.json'), 'utf8')).units;
const file = join(TOWN, 'sites.json.gz'), data = JSON.parse(gunzipSync(readFileSync(file)));
const [sites, stats] = russifySites(data.sites, units);
const latin = sites.filter(s => hasLatin(s[4])), empty = sites.filter(s => !s[4]);
const gz = gzipSync(Buffer.from(JSON.stringify({ v: 2, source: data.source, names: 'Russian; a name transcribed by src/album/town/translit.js keeps the name of the data as the sixth number of its record', sites })), { level: 9 });
writeFileSync(file, gz);
console.log(`${sites.length} sites: ${stats.kept} had a Russian name, transcribed ${Object.entries(stats.byLang).map(([l, n]) => `${l} ${n}`).join(', ')}; still in Latin letters ${latin.length}, without a name ${empty.length} → sites.json.gz ${(gz.length / 1e3).toFixed(0)} KB`);
if (latin.length) console.log('  still Latin: ' + latin.slice(0, 20).map(s => `${s[5]} → ${s[4]}`).join(' | '));
if (process.argv.includes('--list')) for (const s of sites) if (s[5]) console.log(`${s[5]}\t${s[4]}`);

// ---- the places of the album
const vectors = join(ROOT, 'public', 'album-data', 'vectors.json'), out = join(TOWN, 'places-ru.json');
const old = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')).names || {} : {};
if (existsSync(vectors)) {
  const unitAt = unitFinder(units), names = { ...old };
  for (const pl of JSON.parse(readFileSync(vectors, 'utf8')).places || []) {
    const key = String(pl.name || '').replace(/[‎‏]/g, '').trim(); if (!key || hasCyrillic(key)) continue;
    names[key] = toRussian(key, guessLang(langOfUnit(unitAt(pl.lon, pl.lat)), key));
  }
  const sorted = Object.fromEntries(Object.entries(names).sort((a, b) => a[0].localeCompare(b[0])));
  writeFileSync(out, JSON.stringify({ v: 1, about: 'Russian names for the places of the album (Natural Earth) the data names in Latin letters; made by scripts/album/russify-names.mjs', names: sorted }, null, 1) + '\n');
  console.log(`${Object.keys(sorted).length} places of the album named in Russian → places-ru.json: ${Object.entries(sorted).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
} else console.log(`no ${vectors}: places-ru.json left as it is (${Object.keys(old).length} names)`);
