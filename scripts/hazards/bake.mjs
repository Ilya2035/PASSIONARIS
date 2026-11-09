// Passionaris — natural hazards bake.
// Reads data/raw/hazards/* (see scripts/hazards/download.mjs) and the baked map
// (public/assets/map/*), writes compact catalogues and SIM-grid hazard levels to
// public/assets/hazards/:
//   volcanoes.json  eruptions.json  earthquakes.json  tsunamis.json  meteorites.json
//   hazardLevels.bin.gz (Uint8 layers 720x360)  hazardLevels.json (layout + method)
//
//   tools/node/node.exe scripts/hazards/bake.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { daysInMonth } from '../../src/sim/hazards/time.js';
import {
  SIM_W, SIM_H, simLat, simLon, distKm, quakeIntensityAt, magnitudeFromIntensity, intensityToLevel,
  tsunamiLevelFromHeight, volcanoLevelAt, meteoriteLevelFromMass, airburstLevel, quakeIntensityObserved,
  MAG_FROM_I0_CAP, SLOPE_CLASS_MKM, landslideSusceptibility,
} from '../../src/sim/hazards/physics.js';
import { createNamer, volcanoTypeRu, transliterate } from './names-ru.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'hazards');
const MAP = path.join(ROOT, 'public', 'assets', 'map');
const OUT = path.join(ROOT, 'public', 'assets', 'hazards');
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJSON = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;
const num = v => (v == null || v === '' || Number.isNaN(+v) ? null : +v);
// NOAA NCEI and Smithsonian GVP write BC years as negative numbers without a year 0.
const bcToAstro = y => (y < 0 ? y + 1 : y);
const validMD = (y, m, d) => {
  const mm = m >= 1 && m <= 12 ? m : 0;
  const dd = mm && d >= 1 && d <= daysInMonth(y, mm) ? d : 0;
  return [mm, dd];
};

const world = JSON.parse(fs.readFileSync(path.join(MAP, 'world.json'), 'utf8'));
const namer = createNamer(world);

// string table shared by the catalogues (places, names)
function stringTable() {
  const list = [], idx = new Map();
  return {
    list,
    id(s) {
      s = s || '';
      let i = idx.get(s);
      if (i === undefined) { i = list.length; list.push(s); idx.set(s, i); }
      return i;
    },
  };
}

// =================================================================== volcanoes + eruptions
const gvpV = readJSON('gvp_holocene_volcanoes.geojson').features.map(f => f.properties)
  .sort((a, b) => a.Volcano_Number - b.Volcano_Number);
const gvpE = readJSON('gvp_holocene_eruptions.geojson').features.map(f => f.properties);
const nceiV = readJSON('ncei_volcanoes.json').items;

const vIndex = new Map(gvpV.map((v, i) => [v.Volcano_Number, i]));
const vMaxVei = new Int8Array(gvpV.length).fill(-1);
const vCount = new Int32Array(gvpV.length);
const vLastGame = new Int32Array(gvpV.length).fill(-99999);
for (const e of gvpE) {
  const i = vIndex.get(e.Volcano_Number);
  if (i === undefined || e.StartDateYear == null) continue;
  if (e.Activity_Type === 'Confirmed Eruption' && e.ExplosivityIndexMax != null) {
    vMaxVei[i] = Math.max(vMaxVei[i], e.ExplosivityIndexMax);
  }
  const y = bcToAstro(e.StartDateYear);
  if (y >= -4999) { vCount[i]++; vLastGame[i] = Math.max(vLastGame[i], y); }
}

const volcanoes = gvpV.map((v, i) => {
  const ly = v.Last_Eruption_Year == null ? null : bcToAstro(v.Last_Eruption_Year);
  return [v.Volcano_Number, namer.volcano(v.Volcano_Name, v.Country), v.Volcano_Name, r3(v.Latitude), r3(v.Longitude),
    v.Elevation ?? null, volcanoTypeRu(v.Primary_Volcano_Type), namer.country(v.Country), vMaxVei[i], vCount[i], ly];
});
log('volcanoes', volcanoes.length);

// NCEI significant eruptions -> paroxysm ("climax") dates and deaths for GVP eruptions
// Sortable day key; month*32+day reaches 415, so the year stride must exceed it (416) or
// mid/late-December dates would sort after an unknown-date record of the next year.
const dayKey = (y, m, d) => y * 416 + (m || 0) * 32 + (d || 0);
const erByVolcano = new Map();
const eruptions = [];
for (const e of gvpE) {
  const vi = vIndex.get(e.Volcano_Number);
  if (vi === undefined || e.StartDateYear == null) continue;
  const y = bcToAstro(e.StartDateYear);
  if (y < -4999 || y > 2100) continue;
  const [m, d] = validMD(y, e.StartDateMonth, e.StartDateDay);
  const ey = e.EndDateYear == null ? null : bcToAstro(e.EndDateYear);
  let flags = 0;
  if (e.Activity_Type !== 'Confirmed Eruption') flags |= 1;
  if (e.ExplosivityIndexModifier === '?') flags |= 2;
  if (e.StartDateYearModifier || (e.StartDateYearUncertainty || 0) > 0) flags |= 4;
  const rec = { vi, y, m, d, vei: e.ExplosivityIndexMax ?? -1, flags, yu: e.StartDateYearUncertainty || 0,
    ey, em: e.EndDateMonth || 0, ed: e.EndDateDay || 0, cy: 0, cm: 0, cd: 0, deaths: 0, num: e.Eruption_Number, ncei: [] };
  eruptions.push(rec);
  if (!erByVolcano.has(vi)) erByVolcano.set(vi, []);
  erByVolcano.get(vi).push(rec);
}
for (const list of erByVolcano.values()) list.sort((a, b) => dayKey(a.y, a.m, a.d) - dayKey(b.y, b.m, b.d));
let nceiMatched = 0;
for (const n of nceiV) {
  const vi = vIndex.get(n.volcanoLocationNewNum);
  if (vi === undefined || n.year == null) continue;
  const y = bcToAstro(n.year);
  const [m, d] = validMD(y, n.month, n.day);
  const k = dayKey(y, m, d);
  const list = erByVolcano.get(vi);
  if (!list) continue;
  // the GVP eruption with the latest start not after the NCEI date, still running then
  let best = null;
  for (const r of list) {
    if (dayKey(r.y, r.m, r.d) > k) break;
    const endK = r.ey != null ? dayKey(r.ey, r.em || 12, r.ed || 31) : dayKey(r.y + 5, 12, 31);
    if (k <= Math.max(endK, dayKey(r.y, 12, 31))) best = r;
  }
  // Same-year fallback when the two catalogues disagree on the day (Vesuvius AD 79: GVP
  // 24 Oct, NCEI the traditional 25 Aug): attach to that eruption, but never as a climax.
  if (!best) best = list.find(r => r.y === y) || null;
  if (!best) continue;
  best.ncei.push({ y, m, d, k, deaths: n.deathsTotal ?? n.deaths ?? 0, vei: n.vei ?? -1 });
  nceiMatched++;
}
for (const r of eruptions) {
  if (!r.ncei.length) continue;
  r.deaths = r.ncei.reduce((s, n) => s + (n.deaths || 0), 0);
  const startK = dayKey(r.y, r.m, r.d);
  const top = r.ncei.slice().sort((a, b) => (b.deaths - a.deaths) || (b.vei - a.vei) || (a.k - b.k))[0];
  if (top.k > startK && top.m) { r.cy = top.y; r.cm = top.m; r.cd = top.d; r.flags |= 8; }
}
eruptions.sort((a, b) => dayKey(a.y, a.m, a.d) - dayKey(b.y, b.m, b.d) || a.vi - b.vi);
log('eruptions (5000 BC+)', eruptions.length, 'NCEI matched', nceiMatched,
  'with climax date', eruptions.filter(r => r.flags & 8).length);

// =================================================================== earthquakes (NCEI + USGS)
const places = stringTable();
const nceiEq = readJSON('ncei_earthquakes.json').items.filter(e => e.latitude != null && e.longitude != null);
const usgsEq = readJSON('usgs_m6_1900_now.json').features.filter(f => f.type === 'earthquake' && f.mag != null);

const quakes = [];
// Any recorded consequence (deaths, injuries, damage, houses, tsunami) of an NCEI event.
const IMPACT_FIELDS = ['deaths', 'deathsTotal', 'deathsAmountOrder', 'deathsAmountOrderTotal', 'injuries', 'injuriesAmountOrder',
  'damageAmountOrder', 'damageAmountOrderTotal', 'damageMillionsDollars', 'housesDestroyed', 'housesDestroyedAmountOrder',
  'housesDamaged', 'housesDamagedAmountOrder', 'missing', 'tsunamiEventId', 'volcanoEventId'];
const hasImpact = e => IMPACT_FIELDS.some(k => e[k] != null);
let droppedI0 = 0;
for (const e of nceiEq) {
  const y = bcToAstro(e.year);
  const [m, d] = validMD(y, e.month, e.day);
  const mag = num(e.eqMagnitude) ?? num(e.eqMagMw) ?? num(e.eqMagMs) ?? num(e.eqMagMb) ?? num(e.eqMagMl) ?? num(e.eqMagUnk) ?? num(e.eqMagMfa);
  let I0 = num(e.intensity);
  // NCEI carries a series of ~60 entries (mostly "ITALY: N / CENTRAL / S / SICILY", 1450 BC–1963)
  // with intensity 12 but no magnitude and no recorded deaths, damage or tsunami. Intensity XII
  // means total destruction, so these values are not credible; their size is treated as unknown.
  let flagI0 = 0;
  if (I0 != null && I0 >= 12 && mag == null && !hasImpact(e)) { I0 = null; flagI0 = 32; droppedI0++; }
  quakes.push({
    y, m, d, h: e.hour ?? -1, mi: e.minute ?? -1, s: e.second ?? 0,
    lat: e.latitude, lon: e.longitude, mag, dep: num(e.eqDepth), I0,
    deaths: e.deathsTotal ?? e.deaths ?? 0, ts: e.tsunamiEventId || 0, ncei: e.id, usgs: null,
    name: namer.nceiLocation(e.locationName, e.country), usgsTsunami: 0, flagI0,
  });
}
// index USGS by UTC day for matching
const usgsRows = usgsEq.map(f => {
  const dt = new Date(f.time);
  return {
    y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(),
    s: dt.getUTCSeconds(), ms: f.time, lat: f.c[1], lon: f.c[0], dep: f.c[2] ?? null, mag: f.mag, id: f.id,
    place: f.place, tsunami: f.tsunami || 0, used: false,
  };
});
const DAY_MS = 86400000;
const byDay = new Map();
for (const u of usgsRows) {
  const k = Math.floor(u.ms / DAY_MS);
  if (!byDay.has(k)) byDay.set(k, []);
  byDay.get(k).push(u);
}
let matched = 0;
// Pass 1: close in time, space and magnitude. Pass 2: an origin time within 15 min and 300 km
// identifies the same event even when the magnitudes differ by more than one unit (early
// 20th-century NCEI Ms/Mw vs. reassessed ISC-GEM Mw, e.g. Alaska 1903: NCEI 8.3, USGS 6.9).
for (const pass of [1, 2]) {
  for (const q of quakes) {
    if (q.usgs || q.y < 1900 || !q.m || !q.d) continue;
    if (pass === 2 && (q.h < 0 || q.mi < 0)) continue;
    const ms = Date.UTC(q.y, q.m - 1, q.d, Math.max(0, q.h), Math.max(0, q.mi), q.s || 0);
    const k = Math.floor(ms / DAY_MS);
    let best = null, bestScore = Infinity;
    for (let dk = k - 1; dk <= k + 1; dk++) {
      for (const u of byDay.get(dk) || []) {
        if (u.used) continue;
        const dist = distKm(q.lat, q.lon, u.lat, u.lon);
        if (dist > 300) continue;
        const dtH = Math.abs(u.ms - ms) / 3600000;
        const dm = q.mag != null ? Math.abs(q.mag - u.mag) : 0;
        if (pass === 1) {
          if (q.h >= 0 ? dtH > 3 : dtH > 36) continue;
          if (dm > 1.0) continue;
        } else if (dtH > 0.25) continue;
        const score = dist / 100 + (q.h >= 0 ? dtH / 3 : dtH / 36) + dm;
        if (score < bestScore) { bestScore = score; best = u; }
      }
    }
    if (best) {
      best.used = true; matched++;
      Object.assign(q, { y: best.y, m: best.m, d: best.d, h: best.h, mi: best.mi, s: best.s, lat: best.lat, lon: best.lon,
        mag: best.mag, dep: best.dep ?? q.dep, usgs: best.id, usgsTsunami: best.tsunami });
    }
  }
}
for (const u of usgsRows) {
  if (u.used) continue;
  quakes.push({ y: u.y, m: u.m, d: u.d, h: u.h, mi: u.mi, s: u.s, lat: u.lat, lon: u.lon, mag: u.mag, dep: u.dep, I0: null,
    deaths: 0, ts: 0, ncei: null, usgs: u.id, name: namer.usgsPlace(u.place), usgsTsunami: u.tsunami });
}
// sizes: magnitude estimated from intensity where missing; unknown size -> assumed damaging (I0 = 7):
// every NCEI "significant" event caused damage, deaths, a tsunami or MMI >= X by definition.
const I0_ASSUMED = 7;
for (const q of quakes) {
  q.flags = (q.ncei ? 1 : 0) | (q.usgs ? 2 : 0) | (q.ts || q.usgsTsunami ? 16 : 0) | (q.flagI0 || 0);
  const h = q.dep ?? 15;
  if (q.mag == null) {
    if (q.I0 != null) { q.mag = magnitudeFromIntensity(q.I0, h); q.flags |= 4; }
    else { q.I0 = I0_ASSUMED; q.mag = magnitudeFromIntensity(I0_ASSUMED, h); q.flags |= 4 | 8; }
  }
  const Ipred = quakeIntensityAt(q.mag, 0, h);
  q.Iepi = q.I0 != null ? Math.max(q.I0, Ipred) : Ipred;
  q.level = intensityToLevel(q.Iepi);
}
quakes.sort((a, b) => dayKey(a.y, a.m, a.d) - dayKey(b.y, b.m, b.d) || (a.h - b.h) || (a.mi - b.mi));
log('earthquakes: NCEI', nceiEq.length, 'USGS', usgsEq.length, 'matched', matched, 'merged', quakes.length);

// =================================================================== tsunamis
const tsEvents = readJSON('ncei_tsunami_events.json').items;
const runups = readJSON('ncei_tsunami_runups.json').items;
const runupMax = new Map();
for (const r of runups) {
  const H = num(r.runupHt);
  if (H != null && H > 0) runupMax.set(r.tsunamiEventId, Math.max(runupMax.get(r.tsunamiEventId) || 0, H));
}
const tsunamis = [];
for (const e of tsEvents) {
  if (e.latitude == null || e.longitude == null) continue;
  if (!(e.eventValidity >= 2)) continue;                      // drop erroneous / very doubtful / seiche
  if ([9, 10, 11].includes(e.causeCode)) continue;            // meteorological, explosion, astronomical tide
  const y = bcToAstro(e.year);
  const [m, d] = validMD(y, e.month, e.day);
  const H = num(e.maxWaterHeight) ?? runupMax.get(e.id) ?? null;
  let level;
  if (H != null && H > 0) level = tsunamiLevelFromHeight(H);
  else if (e.tsIntensity != null) level = Math.max(1, Math.min(5, Math.floor(e.tsIntensity) + 1));
  else level = 1;
  tsunamis.push([e.id, y, m, d, e.hour ?? -1, e.minute ?? -1, r3(e.latitude), r3(e.longitude), e.causeCode ?? 0,
    e.eventValidity, H == null ? -1 : r1(H), level, e.deathsTotal ?? e.deaths ?? 0,
    places.id(namer.nceiLocation(e.locationName, e.country)), e.earthquakeEventId || 0, e.volcanoEventId || 0]);
}
tsunamis.sort((a, b) => dayKey(a[1], a[2], a[3]) - dayKey(b[1], b[2], b[3]));
log('tsunamis', tsunamis.length, 'runups', runups.length);

// =================================================================== meteorites
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
// Precise dates of well-known witnessed falls (the NASA table carries the year only).
// Ensisheim fell on 7 Nov 1492 (the table lists 1491). Dates are as recorded (Julian before 1582).
const FALL_DATES = {
  'Chelyabinsk': [2013, 2, 15, 500], 'Sikhote-Alin': [1947, 2, 12], 'Ensisheim': [1492, 11, 7], "L'Aigle": [1803, 4, 26],
  'Allende': [1969, 2, 8], 'Murchison': [1969, 9, 28], 'Peekskill': [1992, 10, 9], 'Almahata Sitta': [2008, 10, 7],
  'Carancas': [2007, 9, 15], 'Kunya-Urgench': [1998, 6, 20], 'Jilin': [1976, 3, 8], 'Nogata': [861, 5, 19],
};
const METEORITE_RU = { 'Chelyabinsk': 'Челябинский', 'Sikhote-Alin': 'Сихотэ-Алинский', 'Tunguska': 'Тунгусский',
  'Ensisheim': 'Энсисхайм', 'Allende': 'Альенде', 'Murchison': 'Мурчисон', 'Hoba': 'Гоба', 'Willamette': 'Уилламетт',
  'Kunya-Urgench': 'Куня-Ургенч', 'Jilin': 'Гирин', "L'Aigle": "Л'Эгль", 'Almahata Sitta': 'Альмахата-Ситта', 'Carancas': 'Каранкас' };
const csv = parseCSV(fs.readFileSync(path.join(RAW, 'nasa_meteorite_landings.csv'), 'utf8'));
const head = csv[0].map(s => s.trim().toLowerCase());
const col = name => head.indexOf(name);
const C = { name: col('name'), nametype: col('nametype'), cls: col('recclass'), mass: col('mass (g)'), fall: col('fall'),
  year: col('year'), lat: col('reclat'), lon: col('reclong') };
const meteorites = [];
for (const r of csv.slice(1)) {
  if (r.length < 9 || r[C.nametype] !== 'Valid') continue;
  const lat = num(r[C.lat]), lon = num(r[C.lon]);
  let y = num(String(r[C.year]).slice(0, 4).replace(/[^0-9-]/g, '') || null);
  const g = num(r[C.mass]);
  if (lat == null || lon == null || (lat === 0 && lon === 0) || y == null) continue;
  const fell = r[C.fall] === 'Fell';
  if (!fell && !(g >= 1000)) continue;
  if (y > 2026) continue;
  const name = r[C.name];
  let m = 0, d = 0, E = -1;
  const fd = FALL_DATES[name];
  if (fd && fell && Math.abs(fd[0] - y) <= 1) { [y, m, d] = fd; E = fd[3] ?? -1; }
  const kg = g == null ? -1 : r3(g / 1000);
  let level = meteoriteLevelFromMass(kg);
  if (E > 0) level = Math.max(level, airburstLevel(E));
  meteorites.push([METEORITE_RU[name] || transliterate(name), name, r3(lat), r3(lon), kg, y, m, d, fell ? 1 : 0, E, level, r[C.cls]]);
}
// Tunguska airburst, 30 June 1908 ~00:14 UTC; 60.886N 101.894E; ~3–15 Mt (adopted 12 Mt).
meteorites.push(['Тунгусский', 'Tunguska', 60.886, 101.894, -1, 1908, 6, 30, 2, 12000, airburstLevel(12000), 'airburst']);
meteorites.sort((a, b) => dayKey(a[5], a[6], a[7]) - dayKey(b[5], b[6], b[7]));
log('meteorites', meteorites.length, 'falls', meteorites.filter(m => m[8] === 1).length, 'finds>=1kg', meteorites.filter(m => m[8] === 0).length);

// =================================================================== SIM-grid inputs from the map
const N = SIM_W * SIM_H;
const gunzip = f => zlib.gunzipSync(fs.readFileSync(path.join(MAP, f)));
const { width: MW, height: MH } = world.grid;
const cellsBuf = gunzip('cells.bin.gz');
const cells = new Uint32Array(cellsBuf.buffer, cellsBuf.byteOffset, MW * MH);
const hBuf = gunzip('height.delta.bin.gz');
const height = new Int16Array(hBuf.buffer, hBuf.byteOffset, MW * MH);
for (let y = 0; y < MH; y++) {
  let acc = 0; const row = y * MW;
  for (let x = 0; x < MW; x++) { acc += height[row + x]; height[row + x] = acc; }
}
log('map grids loaded', MW, 'x', MH);

const provCountry = new Int32Array(world.provinces.length + 1);
for (const p of world.provinces) if (p && p.id != null) provCountry[p.id] = p.country || 0;
const distProv = world.districts.province;

const landFrac = new Float32Array(N), oceanFrac = new Float32Array(N), slope = new Float32Array(N);
const country = new Uint16Array(N);
{
  const sx0 = new Int32Array(SIM_W + 1);
  for (let x = 0; x <= SIM_W; x++) sx0[x] = Math.round(x * MW / SIM_W);
  const KM_PER_PX = Math.PI * 6371.0088 / MH;
  const counts = new Map();
  for (let y = 0; y < SIM_H; y++) {
    const ya = Math.round(y * MH / SIM_H), yb = Math.round((y + 1) * MH / SIM_H);
    for (let x = 0; x < SIM_W; x++) {
      let land = 0, ocean = 0, n = 0, gsum = 0, gn = 0;
      counts.clear();
      for (let py = ya; py < yb; py++) {
        const lat = 90 - (py + 0.5) * 180 / MH;
        const dx = 2 * KM_PER_PX * Math.max(0.05, Math.cos(lat * Math.PI / 180));
        const row = py * MW;
        for (let px = sx0[x]; px < sx0[x + 1]; px++) {
          const c = cells[row + px]; n++;
          if (c === 0) { ocean++; continue; }
          if (c === 1) continue;
          land++;
          const cn = provCountry[distProv[c] || 0] || 0;
          counts.set(cn, (counts.get(cn) || 0) + 1);
          if (py > 0 && py < MH - 1) {
            const xl = px > 0 ? px - 1 : MW - 1, xr = px < MW - 1 ? px + 1 : 0;
            const gx = (height[row + xr] - height[row + xl]) / dx;
            const gy = (height[row + MW + px] - height[row - MW + px]) / (2 * KM_PER_PX);
            gsum += Math.sqrt(gx * gx + gy * gy); gn++;
          }
        }
      }
      const i = y * SIM_W + x;
      landFrac[i] = land / n; oceanFrac[i] = ocean / n; slope[i] = gn ? gsum / gn : 0;
      let bestC = 0, bestN = 0;
      for (const [c, k] of counts) if (k > bestN && c) { bestN = k; bestC = c; }
      country[i] = bestC;
    }
  }
}
log('land/slope/country per SIM cell done');

// wetness proxy: vegetation greenness of NASA Blue Marble (June composite) — see method notes
const wet = new Float32Array(N);
{
  const img = sharp(path.join(MAP, 'albedo-2k.jpg'));
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const AW = info.width, AH = info.height, ch = info.channels;
  for (let y = 0; y < SIM_H; y++) {
    const ya = Math.floor(y * AH / SIM_H), yb = Math.max(ya + 1, Math.floor((y + 1) * AH / SIM_H));
    for (let x = 0; x < SIM_W; x++) {
      const xa = Math.floor(x * AW / SIM_W), xb = Math.max(xa + 1, Math.floor((x + 1) * AW / SIM_W));
      let s = 0, n = 0;
      for (let py = ya; py < yb; py++) for (let px = xa; px < xb; px++) {
        const o = (py * AW + px) * ch;
        const R = data[o], G = data[o + 1], B = data[o + 2];
        const ndi = (G - R) / (G + R + 1);              // greenness
        const bright = (R + G + B) / 765;
        s += Math.max(0, Math.min(1, (ndi + 0.04) / 0.22)) * (bright > 0.75 ? 0.2 : 1); n++;
      }
      wet[y * SIM_W + x] = n ? s / n : 0;
    }
  }
}
log('wetness proxy done');

// =================================================================== helpers for footprints
const cellLat = new Float64Array(SIM_H), cellLon = new Float64Array(SIM_W);
for (let y = 0; y < SIM_H; y++) cellLat[y] = simLat(y);
for (let x = 0; x < SIM_W; x++) cellLon[x] = simLon(x);
/** Calls fn(cellIndex, distanceKm) for every SIM cell centre within rKm of (lat, lon). */
function forCellsWithin(lat, lon, rKm, fn) {
  const dLat = rKm / 111.2 + 0.5;
  const y0 = Math.max(0, Math.floor((90 - (lat + dLat)) / 0.5)), y1 = Math.min(SIM_H - 1, Math.floor((90 - (lat - dLat)) / 0.5));
  for (let y = y0; y <= y1; y++) {
    const cl = Math.cos(cellLat[y] * Math.PI / 180);
    const dLon = cl < 1e-3 ? 360 : rKm / (111.2 * cl) + 0.5;
    if (dLon >= 180) {
      for (let x = 0; x < SIM_W; x++) { const d = distKm(lat, lon, cellLat[y], cellLon[x]); if (d <= rKm) fn(y * SIM_W + x, d); }
    } else {
      const xc = Math.floor((lon + 180) / 0.5), nx = Math.ceil(dLon / 0.5);
      for (let k = -nx; k <= nx; k++) {
        const x = (((xc + k) % SIM_W) + SIM_W) % SIM_W;
        const d = distKm(lat, lon, cellLat[y], cellLon[x]);
        if (d <= rKm) fn(y * SIM_W + x, d);
      }
    }
  }
}
const CELL_SLACK_KM = 30;     // half a cell + epicentre location uncertainty

// =================================================================== earthquake level
const quakeI = new Float32Array(N);
for (const q of quakes) {
  const h = q.dep ?? 15;
  const I0 = q.I0;
  // footprint radius where intensity drops below 2
  let lo = 0, hi = 3000;
  if (quakeIntensityObserved(q.mag, hi, h, I0) >= 2) lo = hi;
  else for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (quakeIntensityObserved(q.mag, mid, h, I0) >= 2) lo = mid; else hi = mid; }
  const R = lo + CELL_SLACK_KM;
  forCellsWithin(q.lat, q.lon, R, (c, d) => {
    const I = quakeIntensityObserved(q.mag, Math.max(0, d - CELL_SLACK_KM), h, I0);
    if (I > quakeI[c]) quakeI[c] = I;
  });
}
const quakeLevel = new Uint8Array(N), quakeI10 = new Uint8Array(N);
for (let i = 0; i < N; i++) { quakeLevel[i] = intensityToLevel(quakeI[i]); quakeI10[i] = Math.min(255, Math.round(quakeI[i] * 10)); }
log('earthquake levels done');

// =================================================================== coast + tsunami exposure
const coast = new Uint8Array(N);
for (let y = 0; y < SIM_H; y++) for (let x = 0; x < SIM_W; x++) {
  const i = y * SIM_W + x;
  if (landFrac[i] <= 0) continue;
  let sea = oceanFrac[i] > 0;
  for (let dy = -1; dy <= 1 && !sea; dy++) for (let dx = -1; dx <= 1 && !sea; dx++) {
    const yy = y + dy; if (yy < 0 || yy >= SIM_H) continue;
    const xx = (x + dx + SIM_W) % SIM_W;
    if (oceanFrac[yy * SIM_W + xx] > 0.3) sea = true;
  }
  if (sea) coast[i] = 1;
}
const tsunamiLevel = new Uint8Array(N), tsunamiH = new Float32Array(N);
const raiseTs = (c, L, H) => { if (coast[c] && L > tsunamiLevel[c]) tsunamiLevel[c] = L; if (coast[c] && H > tsunamiH[c]) tsunamiH[c] = H; };
let runupUsed = 0;
for (const r of runups) {
  if (r.latitude == null || r.longitude == null || r.doubtful === 'y') continue;
  if (!(r.sourceEventValidity >= 2) || [9, 10, 11].includes(r.sourceCauseCode)) continue;
  const H = num(r.runupHt);
  const L = H != null && H > 0 ? tsunamiLevelFromHeight(H) : 1;
  runupUsed++;
  forCellsWithin(r.latitude, r.longitude, 400, (c, d) => {
    const Lc = d <= 75 ? L : d <= 200 ? Math.max(1, L - 1) : L - 2;
    if (Lc >= 1) raiseTs(c, Lc, d <= 75 ? (H || 0) : 0);
  });
}
for (const t of tsunamis) {
  const [, , , , , , lat, lon, , validity, H] = t;
  if (validity < 3 || !(H > 0)) continue;
  const L = tsunamiLevelFromHeight(H);
  forCellsWithin(lat, lon, 150, (c, d) => raiseTs(c, d <= 50 ? L : Math.max(1, L - 1), 0));
}
// seismic-source proxy: shallow great offshore earthquakes expose nearby coasts
for (const q of quakes) {
  if (q.mag < 7.5 || (q.dep != null && q.dep > 70)) continue;
  const ci = Math.min(SIM_H - 1, Math.max(0, Math.floor((90 - q.lat) / 0.5))) * SIM_W + ((Math.floor((q.lon + 180) / 0.5) % SIM_W) + SIM_W) % SIM_W;
  if (landFrac[ci] > 0.6) continue;
  const R = 150 * Math.pow(2, q.mag - 7.5);
  const L = q.mag >= 8.5 ? 3 : 2;
  forCellsWithin(q.lat, q.lon, R, c => raiseTs(c, L, 0));
}
log('tsunami exposure done; runups used', runupUsed);

// =================================================================== volcanic hazard
const volcanoLevel = new Uint8Array(N);
for (let i = 0; i < gvpV.length; i++) {
  const v = gvpV[i];
  if (v.Latitude == null || v.Longitude == null) continue;
  const vei = vMaxVei[i];
  const active = vLastGame[i] >= -4999 || (v.Last_Eruption_Year != null && bcToAstro(v.Last_Eruption_Year) >= -4999);
  const R = (vei >= 7 ? 1000 : vei >= 6 ? 1000 : vei >= 4 ? 300 : vei >= 2 ? 300 : 100) + CELL_SLACK_KM;
  forCellsWithin(v.Latitude, v.Longitude, R, (c, d) => {
    let L = volcanoLevelAt(Math.max(0, d - CELL_SLACK_KM), vei);
    if (!active) L -= 1;
    if (L > volcanoLevel[c]) volcanoLevel[c] = L;
  });
}
log('volcanic levels done');

// =================================================================== landslide susceptibility
// slope classes on the mean gradient (m/km) of the ~5 km map relief inside each SIM cell
const SLOPE_CLASS = SLOPE_CLASS_MKM;
const landslideLevel = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (landFrac[i] < 0.05) continue;
  landslideLevel[i] = landslideSusceptibility(slope[i], wet[i], quakeLevel[i]);
}
log('landslide levels done');

// =================================================================== place names per SIM cell
const placeNames = stringTable();
placeNames.id('');
const countryPlace = new Int32Array(world.countries.length + 1).fill(-1);
function seaName(lat, lon) {
  const box = (la0, la1, lo0, lo1) => lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1;
  if (box(40.5, 47, 27, 42)) return 'Чёрное море';
  if (box(36, 47.5, 46, 55.5)) return 'Каспийское море';
  if (box(12, 30, 32, 44)) return 'Красное море';
  if (box(23, 30.5, 47.5, 57)) return 'Персидский залив';
  if (box(53, 66, 9, 31)) return 'Балтийское море';
  if (box(51, 61, -4, 9)) return 'Северное море';
  if (box(30, 46, -6, 36.5)) return 'Средиземное море';
  if (box(18, 31, -98, -80)) return 'Мексиканский залив';
  if (box(8, 22, -89, -60)) return 'Карибское море';
  if (box(33, 52, 127, 142)) return 'Японское море';
  if (box(43, 62, 135, 163)) return 'Охотское море';
  if (box(51, 66.5, 162, 180) || box(51, 66.5, -180, -157)) return 'Берингово море';
  if (box(0, 23, 99, 121)) return 'Южно-Китайское море';
  if (lat > 66) return 'Северный Ледовитый океан';
  if (lat < -60) return 'Южный океан';
  if (lon >= 20 && lon <= 147 && lat < 31 && !(lon > 100 && lat > -9) && !(lon > 128 && lat > -30)) return 'Индийский океан';
  if ((lon >= -70 && lon <= 20 && lat < 0) || (lon > -100 && lon <= 30 && lat >= 0 && !(lon < -77 && lat < 9))) return 'Атлантический океан';
  return 'Тихий океан';
}
const placeIdx = new Uint16Array(N);
for (let y = 0; y < SIM_H; y++) for (let x = 0; x < SIM_W; x++) {
  const i = y * SIM_W + x;
  const c = country[i];
  if (c && landFrac[i] > 0) {
    if (countryPlace[c] < 0) countryPlace[c] = placeNames.id(world.countries[c]?.name || '');
    placeIdx[i] = countryPlace[c];
  } else placeIdx[i] = placeNames.id(seaName(cellLat[y], cellLon[x]));
}

// =================================================================== write outputs
const writeJSON = (name, obj) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(path.join(OUT, name), s);
  log('wrote', name, (s.length / 1e3).toFixed(0), 'kB');
};
const generated = new Date().toISOString();
const DATE_NOTE = 'Years are astronomical (0 = 1 BC, -4999 = 5000 BC). Month/day 0 = unknown. Dates are kept as recorded by the source (Julian before 1582-10-15, as is conventional in the catalogues); the game calendar is proleptic Gregorian.';

writeJSON('volcanoes.json', {
  version: 1, generated, source: 'Smithsonian GVP Volcanoes of the World v5 (Holocene volcanoes, WFS)',
  fields: ['gvp', 'name', 'nameEn', 'lat', 'lon', 'elev', 'type', 'country', 'maxVei', 'eruptions', 'lastYear'],
  notes: 'maxVei: largest VEI of a confirmed Holocene eruption (-1 unknown). eruptions: count since 5000 BC. lastYear astronomical (null unknown).',
  rows: volcanoes,
});
writeJSON('eruptions.json', {
  version: 1, generated, source: 'Smithsonian GVP Holocene eruptions (WFS) + NOAA NCEI significant volcanic eruptions (paroxysm dates, deaths)',
  fields: ['v', 'y', 'm', 'd', 'vei', 'flags', 'yu', 'cy', 'cm', 'cd', 'deaths'],
  notes: `v = row index in volcanoes.json. vei -1 = unknown. flags: 1 uncertain eruption, 2 VEI uncertain, 4 start year uncertain/approximate, 8 climax date (cy/cm/cd) from NCEI. yu = year uncertainty (years). ${DATE_NOTE}`,
  rows: eruptions.map(r => [r.vi, r.y, r.m, r.d, r.vei, r.flags, r.yu, r.cy, r.cm, r.cd, r.deaths]),
});
// earthquakes.json and tsunamis.json share one place table, stored in earthquakes.json
const quakeRows = quakes.map(q => [q.y, q.m, q.d, q.h, q.mi, r3(q.lat), r3(q.lon), r1(q.mag), q.dep == null ? -1 : Math.round(q.dep),
  r1(q.Iepi), q.level, q.deaths || 0, q.flags, places.id(q.name), q.ts || 0]);
writeJSON('earthquakes.json', {
  version: 1, generated,
  source: 'NOAA NCEI Global Significant Earthquake Database (2150 BC–present) merged with USGS ComCat M>=6 (1900–present)',
  fields: ['y', 'm', 'd', 'h', 'mi', 'lat', 'lon', 'mag', 'dep', 'I0', 'level', 'deaths', 'flags', 'place', 'ts'],
  notes: `h/mi -1 = unknown (UTC). mag: preferred magnitude (estimated from intensity when flags&4). dep km (-1 unknown). I0 = epicentral intensity (reported MMI, or predicted by Allen et al. 2012 when larger/missing). level = user scale 0-5 of I0. flags: 1 NCEI, 2 USGS, 4 magnitude estimated, 8 size assumed (no magnitude/intensity: I0=7), 16 tsunami reported. place = index into places[] (shared with tsunamis.json). ts = NCEI tsunami event id. ${DATE_NOTE}`,
  places: places.list,
  rows: quakeRows,
});
writeJSON('tsunamis.json', {
  version: 1, generated, source: 'NOAA NCEI Global Historical Tsunami Database (events + run-ups)',
  fields: ['id', 'y', 'm', 'd', 'h', 'mi', 'lat', 'lon', 'cause', 'validity', 'maxH', 'level', 'deaths', 'place', 'eq', 'vol'],
  notes: `cause: NCEI cause code (1 earthquake, 2 questionable eq, 3 eq+landslide, 4 volcano+eq, 5 volcano+eq+landslide, 6 volcano, 7 volcano+landslide, 8 landslide, 0 unknown). validity 2 questionable, 3 probable, 4 definite. maxH = max water height m (-1 unknown). level 0-5 from Soloviev–Imamura intensity of maxH. place = index into earthquakes.json places[]. eq/vol = NCEI linked event ids. ${DATE_NOTE}`,
  rows: tsunamis,
});
writeJSON('meteorites.json', {
  version: 1, generated, source: 'NASA Open Data Portal: Meteorite Landings (The Meteoritical Society); Tunguska airburst added by hand',
  fields: ['name', 'nameEn', 'lat', 'lon', 'massKg', 'y', 'm', 'd', 'fall', 'energyKt', 'level', 'class'],
  notes: 'fall: 1 observed fall, 0 find (mass >= 1 kg; y = year found, not fallen), 2 airburst. energyKt -1 unknown. Only falls/airbursts are scheduled as events. m/d 0 = unknown (precise dates added for famous falls).',
  rows: meteorites,
});

const layers = [
  ['quake', quakeLevel, 'Earthquake level 0-5 (user scale of the max plausible intensity)'],
  ['tsunami', tsunamiLevel, 'Tsunami exposure 0-5 (coastal cells only)'],
  ['volcano', volcanoLevel, 'Volcanic hazard 0-5'],
  ['landslide', landslideLevel, 'Landslide susceptibility 0-5'],
  ['quakeI10', quakeI10, 'Max plausible MMI x10'],
  ['tsunamiH', Uint8Array.from(tsunamiH, h => Math.min(255, Math.round(h * 2))), 'Max recorded run-up within 75 km, metres x2 (capped 127.5 m)'],
  ['slope', Uint8Array.from(slope, g => Math.min(255, Math.round(g))), 'Mean terrain gradient of land, m/km (~5 km relief)'],
  ['land', Uint8Array.from(landFrac, f => Math.round(f * 255)), 'Land fraction x255'],
  ['coast', coast, 'Coastal cell flag'],
  ['wet', Uint8Array.from(wet, w => Math.round(w * 255)), 'Wetness proxy x255 (Blue Marble greenness)'],
  ['placeLo', Uint8Array.from(placeIdx, p => p & 255), 'Place-name index, low byte (places[])'],
  ['placeHi', Uint8Array.from(placeIdx, p => p >> 8), 'Place-name index, high byte'],
];
const bin = new Uint8Array(N * layers.length);
layers.forEach(([, arr], k) => bin.set(arr, k * N));
fs.writeFileSync(path.join(OUT, 'hazardLevels.bin.gz'), zlib.gzipSync(bin, { level: 9 }));
log('wrote hazardLevels.bin.gz', (fs.statSync(path.join(OUT, 'hazardLevels.bin.gz')).size / 1e3).toFixed(0), 'kB');

const hist = arr => { const h = [0, 0, 0, 0, 0, 0]; for (const v of arr) h[Math.min(5, v)]++; return h; };
writeJSON('hazardLevels.json', {
  version: 1, generated,
  grid: { width: SIM_W, height: SIM_H, step: 0.5, cell: 'y*720+x', row0: '90N', col0: '180W', center: 'lon=-180+(x+0.5)*0.5, lat=90-(y+0.5)*0.5' },
  file: 'hazardLevels.bin.gz', type: 'Uint8', layerBytes: N,
  layers: layers.map(([name, , desc], k) => ({ name, index: k, offset: k * N, desc })),
  scales: {
    quake: 'level 1 = intensity 2–4, 2 = 4–6, 3 = 6–8, 4 = 8–10, 5 = >10 (MMI/MSK-64 points, half-open bins)',
    tsunami: 'Soloviev–Imamura intensity I = log2(√2·H): level 1 = I<1 (H<1.4 m), 2 = 1–2 (<2.8 m), 3 = 2–3 (<5.7 m), 4 = 3–4 (<11.3 m), 5 = I≥4',
    volcano: 'by distance to Holocene volcanoes and their max VEI: ≤30 km / ≤100 km / ≤300 km / ≤1000 km bands (see method)',
    landslide: 'slope class 1–5 (gradient thresholds ' + SLOPE_CLASS.join('/') + ' m/km) × trigger factor (0.45 + 0.35·wet + 0.25·min(1, quake/4))',
  },
  method: {
    quake: 'For every catalogued epicentre (NCEI significant 2150 BC–present + USGS M>=6 1900–present, merged): intensity at each cell centre by the Allen, Wald & Worden (2012) hypocentral IPE for active crustal regions (J. Seismol. 16:409–433), with distance measured to the nearest point of a rupture of length L(M) from Wells & Coppersmith (1994, subsurface rupture length), an anelastic far-field term −0.0012·(R − 300 km) beyond 300 km (model assumption, form as in Atkinson & Wald 2007), and reduced by 30 km for cell size/location uncertainty; when NCEI reports a higher epicentral intensity the excess is added near the source and tapered as 25/(25+r) with rupture distance r. Magnitudes of pre-instrumental events without one are estimated from I0 by Shebalin (1968): I0 = 1.5M − 3.5·lg h + 3 (capped at M ' + MAG_FROM_I0_CAP + '). Cell value = max over all events ("max plausible intensity").',
    tsunami: 'Coastal cells only. Run-ups (NCEI, non-doubtful): level of the run-up height within 75 km, minus 1 within 200 km, minus 2 within 400 km. Source events with max water height: full level within 50 km, minus 1 within 150 km. Shallow (<=70 km) offshore M>=7.5 epicentres: at least level 2 (3 for M>=8.5) within 150·2^(M−7.5) km.',
    volcano: 'For each GVP Holocene volcano with max Holocene VEI v (unknown -> treated as VEI 1): ≤30 km: 5 if v≥4, 4 if v≥2, else 3; ≤100 km: 4 if v≥5, 3 if v≥3, else 2; ≤300 km: 3 if v≥6, 2 if v≥4, 1 if v≥2; ≤1000 km: 2 if v≥7, 1 if v≥6. Minus 1 for volcanoes without eruptions since 5000 BC. Distance bands after the 10/30/100 km Volcano Population Exposure Index radii (Brown et al. 2015) extended for far-field tephra.',
    landslide: 'Mean gradient of the ~5 km map relief (public/assets/map/height) on land in each cell -> slope class; trigger factor from the earthquake level and a wetness proxy (vegetation greenness of the NASA Blue Marble June composite; replace with climate precipitation when available, see scheduler option annualPrecip).',
  },
  stats: {
    volcanoes: volcanoes.length, eruptions: eruptions.length, earthquakes: quakes.length, tsunamis: tsunamis.length,
    meteorites: meteorites.length, histQuake: hist(quakeLevel), histTsunami: hist(tsunamiLevel),
    histVolcano: hist(volcanoLevel), histLandslide: hist(landslideLevel),
    slopePercentiles: (() => { const a = Array.from(slope).filter((g, i) => landFrac[i] > 0.05).sort((p, q) => p - q); return [50, 75, 90, 95, 99].map(p => r1(a[Math.floor(a.length * p / 100)])); })(),
  },
  places: placeNames.list,
});
log('done');
