// Passionaris — natural hazards: raw data downloader.
// Writes ONLY into data/raw/hazards/. Every source is official and open; URLs and
// licences are documented in data/sources/hazards.md.
//
//   tools/node/node.exe scripts/hazards/download.mjs          (cached: skips existing files)
//   HAZ_FORCE=1 tools/node/node.exe scripts/hazards/download.mjs   (re-download)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'hazards');
const FORCE = process.env.HAZ_FORCE === '1';
fs.mkdirSync(RAW, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url, tries = 5, timeoutMs = 180000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Passionaris-hazards-bake/0.1 (open-data research; non-commercial)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`${url}: ${lastErr?.message}`);
}

function writeAtomic(file, text) {
  fs.writeFileSync(file + '.part', text);
  fs.renameSync(file + '.part', file);
}
const have = f => !FORCE && fs.existsSync(f) && fs.statSync(f).size > 0;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// ------------------------------------------------------------- GVP (WFS)
const GVP = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application%2Fjson&typeName=';
async function gvp(typeName, file) {
  const dest = path.join(RAW, file);
  if (have(dest)) return log(file, 'cached');
  const txt = await fetchText(GVP + typeName, 5, 600000);
  const j = JSON.parse(txt);
  if (!Array.isArray(j.features) || !j.features.length) throw new Error(`${typeName}: no features`);
  writeAtomic(dest, txt);
  log(file, j.features.length, 'features', (txt.length / 1e6).toFixed(1), 'MB',
    'numberMatched=', j.numberMatched ?? j.totalFeatures ?? '?');
}

// ------------------------------------------------------------- NOAA NCEI HazEL (paginated)
const NCEI = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/';
async function ncei(endpoint, query, file) {
  const dest = path.join(RAW, file);
  if (have(dest)) return log(file, 'cached');
  const sep = query ? '&' : '';
  const first = JSON.parse(await fetchText(`${NCEI}${endpoint}?${query}${sep}page=1`));
  const pages = first.totalPages || 1;
  const all = new Array(pages);
  all[0] = first.items;
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  await pool(rest, 6, async p => {
    all[p - 1] = JSON.parse(await fetchText(`${NCEI}${endpoint}?${query}${sep}page=${p}`)).items;
  });
  const items = all.flat();
  if (first.totalItems && items.length !== first.totalItems) {
    throw new Error(`${endpoint}: got ${items.length} of ${first.totalItems}`);
  }
  writeAtomic(dest, JSON.stringify({ source: `${NCEI}${endpoint}`, query, downloaded: new Date().toISOString(), totalItems: first.totalItems, items }));
  log(file, items.length, 'items over', pages, 'pages');
}

// ------------------------------------------------------------- USGS ComCat (M>=6 since 1900)
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/';
async function usgs(file) {
  const dest = path.join(RAW, file);
  if (have(dest)) return log(file, 'cached');
  const end = new Date().toISOString().slice(0, 10);
  // split by date so that no single request approaches the 20 000 cap
  const ranges = [['1900-01-01', '1950-01-01'], ['1950-01-01', '1975-01-01'], ['1975-01-01', '1995-01-01'],
    ['1995-01-01', '2010-01-01'], ['2010-01-01', end]];
  const features = [];
  for (const [a, b] of ranges) {
    const q = `format=geojson&starttime=${a}&endtime=${b}&minmagnitude=6&orderby=time-asc&limit=20000`;
    const cnt = JSON.parse(await fetchText(`${USGS}count?${q.replace('&orderby=time-asc&limit=20000', '')}`)).count;
    if (cnt >= 20000) throw new Error(`USGS range ${a}..${b} too large (${cnt})`);
    const j = JSON.parse(await fetchText(`${USGS}query?${q}`, 5, 600000));
    // keep the fields the bake needs; drop the bulky per-feature URLs
    for (const f of j.features) {
      const p = f.properties;
      features.push({ id: f.id, c: f.geometry.coordinates, mag: p.mag, magType: p.magType, time: p.time,
        place: p.place, type: p.type, tsunami: p.tsunami, mmi: p.mmi, alert: p.alert, sig: p.sig });
    }
    log(`USGS ${a}..${b}: ${j.features.length} (count ${cnt})`);
  }
  writeAtomic(dest, JSON.stringify({ source: `${USGS}query`, minmagnitude: 6, downloaded: new Date().toISOString(), features }));
  log(file, features.length, 'events');
}

// ------------------------------------------------------------- NASA Meteorite Landings
// The old Socrata endpoint (data.nasa.gov/resource/gh4g-9sfh.json) was retired when
// data.nasa.gov moved to CKAN; the official dataset files now live under /docs/legacy/.
async function nasa(file) {
  const dest = path.join(RAW, file);
  if (have(dest)) return log(file, 'cached');
  const urls = [
    'https://data.nasa.gov/resource/gh4g-9sfh.json?$limit=50000',
    'https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.csv',
  ];
  for (const u of urls) {
    try {
      const txt = await fetchText(u, 2);
      if (u.endsWith('.csv')) {
        if (!/^name,id,nametype/i.test(txt.trim())) throw new Error('unexpected CSV header');
        writeAtomic(dest, txt);
        log(file, 'from', u, (txt.length / 1e6).toFixed(1), 'MB');
        return;
      }
      // Socrata JSON -> convert to the same CSV layout the bake reads
      const rows = JSON.parse(txt);
      const head = 'name,id,nametype,recclass,mass (g),fall,year,reclat,reclong,GeoLocation';
      const esc = s => (s == null ? '' : /[",]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
      const lines = rows.map(r => [r.name, r.id, r.nametype, r.recclass, r.mass, r.fall,
        r.year ? r.year.slice(0, 4) : '', r.reclat, r.reclong, ''].map(esc).join(','));
      writeAtomic(dest, [head, ...lines].join('\n'));
      log(file, 'from', u, rows.length, 'rows');
      return;
    } catch (e) {
      log('NASA source failed:', u, e.message);
    }
  }
  throw new Error('NASA Meteorite Landings: all sources failed');
}

await gvp('GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes', 'gvp_holocene_volcanoes.geojson');
await gvp('GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions', 'gvp_holocene_eruptions.geojson');
await ncei('earthquakes', 'minYear=-2150&maxYear=2026', 'ncei_earthquakes.json');
await ncei('tsunamis/events', '', 'ncei_tsunami_events.json');
await ncei('tsunamis/runups', '', 'ncei_tsunami_runups.json');
await ncei('volcanoes', '', 'ncei_volcanoes.json');
await usgs('usgs_m6_1900_now.json');
await nasa('nasa_meteorite_landings.csv');

let total = 0;
for (const f of fs.readdirSync(RAW)) total += fs.statSync(path.join(RAW, f)).size;
log(`done; data/raw/hazards = ${(total / 1e6).toFixed(1)} MB`);
