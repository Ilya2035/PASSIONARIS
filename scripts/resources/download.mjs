// Passionaris — natural resources: raw data downloader.
// Writes ONLY into data/raw/resources/ (never committed). Every source is open; URLs and licences are listed in
// data/sources/resources.md.
//
//   tools/node/node.exe scripts/resources/download.mjs            cached: skips files that are already there
//   RES_FORCE=1 tools/node/node.exe scripts/resources/download.mjs  download everything again
//   tools/node/node.exe scripts/resources/download.mjs mrds wikidata   only the named sources
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from './lib-node.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'resources');
const FORCE = process.env.RES_FORCE === '1';
const ONLY = process.argv.slice(2);
const UA = 'PassionarisResourcesBake/0.3 (open-data game map; https://github.com/Ilya2035/PASSIONARIS)';
fs.mkdirSync(RAW, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const have = f => !FORCE && fs.existsSync(f) && fs.statSync(f).size > 0;
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', data);
  fs.renameSync(file + '.part', file);
}

async function fetchBuf(url, { tries = 5, timeoutMs = 300000, headers = {}, body } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET', body,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`${url}: ${lastErr?.message}`);
}

// Zip archive → every member into its own folder data/raw/resources/<dir>/ (the folder holds nothing else).
async function zipSource(dir, url, expect) {
  const dest = path.join(RAW, dir);
  if (!FORCE && fs.existsSync(dest) && fs.readdirSync(dest).some(f => expect.test(f))) return log(dir, 'cached');
  const buf = await fetchBuf(url);
  const files = unzipSync(buf);
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    const base = path.basename(name);
    if (!base || name.endsWith('/')) continue;
    writeAtomic(path.join(dest, base), data);
    n++;
  }
  if (!fs.readdirSync(dest).some(f => expect.test(f))) throw new Error(`${dir}: archive has no ${expect}`);
  log(dir, n, 'files,', (buf.length / 1e6).toFixed(1), 'MB zip');
}

// --------------------------------------------------------------- USGS mineral databases (public domain)
const usgs = {
  // Mineral Resources Data System: ~305 000 sites worldwide, flattened table
  mrds: () => zipSource('mrds', 'https://mrdata.usgs.gov/mrds/mrds-csv.zip', /^mrds\.csv$/i),
  // Major mineral deposits of the world (OFR 2005-1294)
  major: () => zipSource('major', 'https://mrdata.usgs.gov/major-deposits/ofr20051294-csv.zip', /\.(csv|dbf)$/i),
  // Volcanogenic massive sulfide deposits of the world (Mosier and others, 2009): tonnage and grade
  vms: () => zipSource('vms', 'https://mrdata.usgs.gov/vms/vms-csv.zip', /\.csv$/i),
};

// Evaporite-related potash resources worldwide (USGS SIR 2010-5090-S), ArcGIS feature service, paged
async function potash() {
  const dest = path.join(RAW, 'potash', 'potash.geojson');
  if (have(dest)) return log('potash cached');
  const base = 'https://energy.usgs.gov/arcgis/rest/services/Hosted/Evaporite_related_potash_resources_worldwide/FeatureServer/0/query';
  const features = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson',
      resultOffset: String(offset), resultRecordCount: '1000', orderByFields: 'fid' });
    const j = JSON.parse((await fetchBuf(`${base}?${q}`)).toString('utf8'));
    if (j.error) throw new Error('potash: ' + JSON.stringify(j.error));
    features.push(...j.features);
    if (j.features.length < 1000) break;
  }
  writeAtomic(dest, JSON.stringify({ type: 'FeatureCollection', features }));
  log('potash', features.length, 'sites');
}

// --------------------------------------------------------------- Wikidata (CC0): mines, quarries, oil/gas/coal fields
// Classes and everything below them (subclass of, P279*). Each item: coordinates, class, product (P1056).
const WD_ROOTS = {
  Q820477: 'mine', Q188040: 'quarry', Q211748: 'oil field', Q1349255: 'natural gas field',
  Q12091026: 'coal deposit', Q40551: 'salt mine', Q1880708: 'saltworks', Q244326: 'salt evaporation pond',
};
async function sparql(query) {
  const body = new URLSearchParams({ query, format: 'json' });
  const buf = await fetchBuf('https://query.wikidata.org/sparql', {
    body, timeoutMs: 120000, headers: { Accept: 'application/sparql-results+json' } });
  // some labels carry raw control characters (tabs and the like) that strict JSON refuses
  const txt = buf.toString('utf8').replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f]/g, ' ');
  if (!txt.startsWith('{')) throw new Error('wikidata: ' + txt.slice(0, 200));
  return JSON.parse(txt).results.bindings;
}
const qid = uri => uri.slice(uri.lastIndexOf('/') + 1);
async function wikidata() {
  const dest = path.join(RAW, 'wikidata', 'sites.json');
  if (have(dest)) return log('wikidata cached');
  const classes = new Map();
  for (const [root, name] of Object.entries(WD_ROOTS)) {
    const rows = await sparql(`SELECT ?c ?cLabel WHERE { ?c wdt:P279* wd:${root} .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
    for (const r of rows) if (!classes.has(qid(r.c.value))) classes.set(qid(r.c.value), { label: r.cLabel?.value, root: name });
  }
  log('wikidata', classes.size, 'classes');
  // One class at a time, in pages: the label service and big batches make the server cut the answer.
  const LANGS = ['en', 'es', 'fr', 'pt', 'de', 'it', 'ca', 'ru'];
  const items = new Map(), productIds = new Set();
  const PAGE = 10000;
  for (const c of classes.keys()) {
    for (let offset = 0; ; offset += PAGE) {
      const rows = await sparql(`SELECT ?item ?coord ?p WHERE {
        { SELECT DISTINCT ?item WHERE { ?item wdt:P31 wd:${c} ; wdt:P625 [] . } ORDER BY ?item LIMIT ${PAGE} OFFSET ${offset} }
        ?item wdt:P625 ?coord .
        OPTIONAL { ?item wdt:P1056 ?p } }`);
      const seen = new Set();
      for (const r of rows) {
        const id = qid(r.item.value);
        seen.add(id);
        const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(r.coord.value);
        if (!m || r.coord.value.includes('<')) continue; // coordinates on another globe (Moon, Mars)
        const it = items.get(id) ?? { id, name: id, lon: +m[1], lat: +m[2], classes: [], products: [] };
        if (!it.classes.includes(c)) it.classes.push(c);
        if (r.p) { const p = qid(r.p.value); productIds.add(p); if (!it.products.includes(p)) it.products.push(p); }
        items.set(id, it);
      }
      if (seen.size) log('wikidata', c, classes.get(c).label, offset + seen.size);
      if (seen.size < PAGE) break;
      await sleep(500);
    }
    await sleep(150);
  }
  // names: the first language of LANGS that has a label
  const all = [...items.values()];
  for (let i = 0; i < all.length; i += 400) {
    const rows = await sparql(`SELECT ?item ?l WHERE { VALUES ?item { ${all.slice(i, i + 400).map(it => 'wd:' + it.id).join(' ')} }
      ?item rdfs:label ?l . FILTER(LANG(?l) IN (${LANGS.map(l => `"${l}"`).join(',')})) }`);
    const best = new Map();
    for (const r of rows) {
      const id = qid(r.item.value), li = LANGS.indexOf(r.l['xml:lang']);
      if (!best.has(id) || li < best.get(id)[0]) best.set(id, [li, r.l.value]);
    }
    for (const [id, [, name]] of best) items.get(id).name = name;
    if (i % 8000 === 0) log('wikidata names', i, '/', all.length);
    await sleep(100);
  }
  // product labels (coal, iron ore, gold…)
  const products = {};
  const pids = [...productIds];
  for (let i = 0; i < pids.length; i += 200) {
    const rows = await sparql(`SELECT ?p ?l WHERE { VALUES ?p { ${pids.slice(i, i + 200).map(q => 'wd:' + q).join(' ')} }
      ?p rdfs:label ?l . FILTER(LANG(?l) = "en") }`);
    for (const r of rows) products[qid(r.p.value)] = r.l.value;
  }
  for (const it of items.values()) it.products = it.products.map(p => products[p] ?? p);
  writeAtomic(dest, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), roots: WD_ROOTS,
    classes: Object.fromEntries(classes), items: [...items.values()] }));
  log('wikidata', items.size, 'sites,', pids.length, 'products');
}

// --------------------------------------------------------------- GLiM 0.5° (Hartmann & Moosdorf 2012), CC BY 3.0
const glim = () => zipSource('glim', 'https://hdl.handle.net/10013/epic.39939.d001', /\.(asc|nc|txt|tif|csv)$/i);

// --------------------------------------------------------------- ocean chlorophyll: S-NPP VIIRS monthly 4 km, 2019
// NOAA CoastWatch ERDDAP; NASA Earth science data policy: free use and redistribution.
const CHL = 'https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSSQchlaMonthly.csv';
const CHL_SETS = {
  // album box (lon −10…4.5, lat 35.2…44.8) with a margin, every 2nd pixel (~8 km)
  album: { lat: [46, 34], lon: [-12, 6], stride: 2 },
};
// whole world for the 0.5° table, every 13th pixel (0.49°), in 30° bands (the server refuses one big request)
for (let b = 0; b < 6; b++) {
  // the data cover 89.75625°S … 89.75625°N; the first band starts there, the next ones 30° lower
  CHL_SETS[`world${b}`] = { lat: [Math.min(89.75625, 90 - 30 * b), Math.max(-89.75625, 90 - 30 * (b + 1) + 0.0375)],
    lon: [-179.98125, 179.98125], stride: 13 };
}
async function chlorophyll() {
  for (const [name, s] of Object.entries(CHL_SETS)) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const dest = path.join(RAW, 'chl', `${name}-2019-${mm}.csv`);
      if (have(dest)) continue;
      const q = `chlor_a[(2019-${mm}-01T12:00:00Z)][(0.0)][(${s.lat[0]}):${s.stride}:(${s.lat[1]})][(${s.lon[0]}):${s.stride}:(${s.lon[1]})]`;
      const buf = await fetchBuf(`${CHL}?${encodeURIComponent(q)}`, { timeoutMs: 600000 });
      writeAtomic(dest, buf);
      log('chl', name, mm, (buf.length / 1e6).toFixed(1), 'MB');
    }
  }
}

const SOURCES = { ...usgs, potash, wikidata, glim, chlorophyll };
for (const [name, fn] of Object.entries(SOURCES)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  try { await fn(); } catch (e) { console.error('FAILED', name, e.message); process.exitCode = 1; }
}
log('done →', path.relative(ROOT, RAW));
