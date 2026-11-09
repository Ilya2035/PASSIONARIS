// Bakes EU4-style natural-zone labels (deserts, ranges, plateaus, seas, ...) into
// public/assets/labels/zones.json. No countries.
//
// Input : data/raw/labels/ne_10m_geography_regions_polys.geojson, ne_10m_geography_marine_polys.geojson
//         (Natural Earth, public domain; fetch with scripts/labels/download-labels.mjs)
//         public/assets/map/height.delta.bin.gz (optional, terrain height under labels)
// Output: public/assets/labels/zones.json
// Usage : tools/node/node.exe scripts/labels/bake-labels.mjs
//
// Deterministic: same input -> byte-identical output (no timestamps, no randomness).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { partsOf, ringAreaKm2, toVec, toLonLat, norm, R_KM } from './geom.mjs';
import { rasterZone, mainAxis, fitText, toGeoPath, orientPath, sliverAxis, spacingFor } from './centerline.mjs';
import {
  keyOf, LAND_CLASS, GEOAREA_ALLOW, SKIP, KIND_OVERRIDE, ALIAS, MARINE_CLASS, MARINE_SKIP, MARINE_KIND_OVERRIDE, RU, EN, cleanRu,
  MANUAL_PATH, isCapePoint,
} from './zone-table.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'labels');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'labels');
const OUT = path.join(OUT_DIR, 'zones.json');
const HEIGHT = path.join(ROOT, 'public', 'assets', 'map', 'height.delta.bin.gz');

// camera reference (src/game/camera.js / main.js): vertical fov 34°, 1080 px viewport
export const KM_PER_PX_PER_ALT = R_KM * 2 * Math.tan(17 * Math.PI / 180) / 1080;
export const WATER_KINDS = new Set(['ocean', 'sea', 'gulf', 'bay', 'strait']);

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJSON = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const r4 = x => Math.round(x * 1e4) / 1e4;
const r1 = x => Math.round(x * 10) / 10;
const sig = (x, n = 3) => (x === 0 ? 0 : Number(x.toPrecision(n)));

// ------------------------------------------------------------------ select features
function collect() {
  const zones = [];
  const land = readJSON('ne_10m_geography_regions_polys.geojson');
  for (const f of land.features) {
    const p = f.properties;
    const key = ALIAS[keyOf(p.NAME)] ?? keyOf(p.NAME);
    if (SKIP.has(key)) continue;
    let kind = LAND_CLASS[p.FEATURECLA];
    if (p.FEATURECLA === 'Geoarea') kind = GEOAREA_ALLOW[key] ?? null;
    if (kind === undefined) { console.warn('unknown class', p.FEATURECLA, p.NAME); continue; }
    if (!kind) continue;
    if (isCapePoint(p.NAME_EN || p.NAME)) continue;
    kind = KIND_OVERRIDE[key] ?? kind;
    zones.push({
      key, src: 'land', neClass: p.FEATURECLA, neId: p.NE_ID, kind,
      neName: p.NAME, nameEn: EN[key] ?? (p.NAME_EN || p.NAME), nameRuNE: p.NAME_RU, scalerank: p.SCALERANK, minLabel: p.MIN_LABEL,
      parts: partsOf(f.geometry),
    });
  }
  const sea = readJSON('ne_10m_geography_marine_polys.geojson');
  for (const f of sea.features) {
    const p = f.properties;
    if (!p.name) continue;
    const key = keyOf(p.name);
    if (MARINE_SKIP.has(key)) continue;
    let kind = MARINE_CLASS[p.featurecla];
    if (kind === undefined) { console.warn('unknown class', p.featurecla, p.name); continue; }
    if (!kind) continue;
    kind = MARINE_KIND_OVERRIDE[key] ?? kind;
    zones.push({
      key, src: 'sea', neClass: p.featurecla, neId: p.ne_id, kind,
      neName: p.name, nameEn: EN[key] ?? (p.name_en || p.name), nameRuNE: p.name_ru, scalerank: p.scalerank, minLabel: p.min_label,
      parts: partsOf(f.geometry),
    });
  }
  return zones;
}

// Features sharing a name: merge the ones that touch (e.g. split at the antimeridian),
// keep separate clusters that are far apart (two branches of the Rift), drop tiny leftovers.
function mergeSameName(zones) {
  const groups = new Map();
  for (const z of zones) {
    const g = `${z.src}:${z.key}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(z);
  }
  const out = [];
  const touch = (a, b) => {
    const tol = 0.15;
    for (const pa of a.parts) for (const pb of b.parts) for (const u of pa[0]) for (const v of pb[0]) {
      let dl = Math.abs(u[0] - v[0]) % 360;
      if (dl > 180) dl = 360 - dl;
      if (dl < tol && Math.abs(u[1] - v[1]) < tol) return true;
    }
    return false;
  };
  for (const list of groups.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const clusters = [];
    for (const z of list) {
      const hit = clusters.find(c => c.some(y => touch(y, z)));
      if (hit) hit.push(z); else clusters.push([z]);
    }
    const merged = clusters.map(c => {
      const base = { ...c[0] };
      base.parts = c.flatMap(z => z.parts);
      base.scalerank = Math.min(...c.map(z => z.scalerank));
      base.minLabel = Math.min(...c.map(z => z.minLabel));
      return base;
    });
    const area = z => z.parts.reduce((s, p) => s + ringAreaKm2(p[0]), 0);
    const maxA = Math.max(...merged.map(area));
    for (const m of merged) if (area(m) >= 0.05 * maxA) out.push(m);
  }
  return out;
}

function russianName(z) {
  if (z.key === 'greatriftvalley') {
    const maxLon = Math.max(...z.parts.flatMap(p => p[0].map(v => v[0])));
    return maxLon > 40 ? 'Восточно-Африканский рифт' : 'Западный рифт';
  }
  let ru = RU[z.key] ?? z.nameRuNE;
  if (!ru) return null;
  ru = cleanRu(ru);
  return ru;
}

function slug(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ø/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
}

// ------------------------------------------------------------------ terrain height
function loadHeight() {
  if (!fs.existsSync(HEIGHT)) { console.warn('no height map, baseM = 0'); return null; }
  const buf = zlib.gunzipSync(fs.readFileSync(HEIGHT));
  const W = 8192, H = 4096;
  const ab = new ArrayBuffer(W * H * 2);
  new Uint8Array(ab).set(buf.subarray(0, W * H * 2));
  const h = new Int16Array(ab);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) { acc = (acc + h[row + x]) << 16 >> 16; h[row + x] = acc; }
  }
  return { W, H, h };
}
function heightAt(hm, lon, lat) {
  const x = Math.min(hm.W - 1, Math.max(0, Math.floor((lon + 180) / 360 * hm.W)));
  const y = Math.min(hm.H - 1, Math.max(0, Math.floor((90 - lat) / 180 * hm.H)));
  return hm.h[y * hm.W + x];
}

// ------------------------------------------------------------------ main
export function bakeZone(z, hm) {
  const nameRu = russianName(z);
  if (!nameRu) return { error: 'no russian name' };
  const nChars = [...nameRu].length;
  const water = z.src === 'sea';
  let kind = z.kind;
  if (kind === 'sound') kind = /пролив/i.test(nameRu) ? 'strait' : 'bay';

  let geo, h, widthKm, areaKm2, fallback = null, debug = {};
  const manual = MANUAL_PATH[z.key];
  const sliver = manual ? null : sliverAxis(z.parts);
  if (manual || sliver) {
    // degenerate source polygon: hand-placed or vertex-traced line (see data/sources/labels.md)
    geo = orientPath(manual ? manual.map(([lon, lat]) => toVec(lon, lat)) : sliver.vecs);
    h = Math.min(geo.lengthKm / (nChars * spacingFor(nChars)), geo.lengthKm * 0.12);
    widthKm = manual ? 3 * h : sliver.widthKm;
    areaKm2 = z.parts.reduce((s, p) => s + ringAreaKm2(p[0]), 0);
    fallback = manual ? 'manual' : 'sliver';
  } else {
    const g = rasterZone(z.parts);
    const ax = mainAxis(g);
    const fit = fitText(g, ax, nChars);
    geo = toGeoPath(g, fit.pts);
    h = fit.letterHeightKm;
    widthKm = fit.widthKm;
    areaKm2 = g.areaKm2;
    debug = { aspect: ax.aspect, elongated: ax.elongated, turn: fit.turnDeg, inside: fit.inside, grid: [g.W, g.H, g.px] };
  }

  // terrain under the text: 75th percentile of land height along the label line
  let baseM = 0;
  if (hm && !water) {
    const hs = [];
    const vs = geo.vecs, dense = 48;
    for (let i = 0; i < dense; i++) {
      const s = i / (dense - 1) * (vs.length - 1);
      const a = vs[Math.floor(s)], b = vs[Math.min(vs.length - 1, Math.floor(s) + 1)], t = s - Math.floor(s);
      const [lon, lat] = toLonLat(norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
      hs.push(Math.max(0, heightAt(hm, lon, lat)));
    }
    hs.sort((a, b) => a - b);
    baseM = Math.round(hs[Math.floor(hs.length * 0.75)] / 10) * 10;
  }

  // visibility: letters between ~9 and ~120 px at the reference viewport, and NE importance
  const altForPx = px => h / (px * KM_PER_PX_PER_ALT);
  const importanceAlt = 43.4 * 2 ** (-(Math.max(0, z.minLabel ?? 5) - 1.5));
  const minAltitude = altForPx(120);
  const maxAltitude = Math.max(minAltitude * 1.6, Math.min(altForPx(9), importanceAlt));
  const priority = (z.scalerank ?? 5) - 0.25 * Math.log2(Math.max(1, h));

  return {
    zone: {
      id: '', nameRu, nameEn: z.nameEn, kind, water,
      scalerank: z.scalerank, minLabel: z.minLabel, priority: Math.round(priority * 100) / 100,
      path: geo.path.map(([lon, lat]) => [r4(lon), r4(lat)]),
      lengthKm: r1(geo.lengthKm), letterHeightKm: r1(Math.max(0.1, h)), widthKm: r1(widthKm),
      baseM, minAltitude: sig(minAltitude), maxAltitude: sig(maxAltitude),
      areaKm2: Math.round(areaKm2), neId: z.neId, neName: z.neName, neClass: z.neClass,
      ...(fallback ? { fallback } : {}),
    },
    debug,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(RAW, 'ne_10m_geography_regions_polys.geojson'))) {
    console.error('Missing data/raw/labels — run: tools/node/node.exe scripts/labels/download-labels.mjs');
    process.exit(1);
  }
  const only = process.env.LABELS_ONLY ? new Set(process.env.LABELS_ONLY.split(',').map(keyOf)) : null;
  let zones = mergeSameName(collect());
  if (only) zones = zones.filter(z => only.has(z.key));
  log('zones to bake:', zones.length);
  const hm = loadHeight();
  log('height map', hm ? 'loaded' : 'missing');

  const out = [];
  const ids = new Set();
  const stats = { byKind: {}, notInside: [], errors: [], fallback: [] };
  // stable order: importance, then name
  zones.sort((a, b) => (a.scalerank - b.scalerank) || a.nameEn.localeCompare(b.nameEn, 'en') || (a.neId - b.neId));
  for (const z of zones) {
    let r;
    try { r = bakeZone(z, hm); } catch (e) { stats.errors.push(`${z.nameEn}: ${e.message}`); continue; }
    if (r.error) { stats.errors.push(`${z.nameEn}: ${r.error}`); continue; }
    const zone = r.zone;
    let id = slug(z.nameEn), k = 2;
    while (ids.has(id)) id = `${slug(z.nameEn)}-${k++}`;
    ids.add(id);
    zone.id = id;
    out.push(zone);
    stats.byKind[zone.kind] = (stats.byKind[zone.kind] || 0) + 1;
    if (r.debug.inside === false) stats.notInside.push(zone.id);
    if (zone.fallback) stats.fallback.push(`${zone.id} (${zone.fallback})`);
    if (process.env.LABELS_DEBUG) console.log(zone.id, zone.nameRu, JSON.stringify(r.debug), zone.lengthKm, zone.letterHeightKm);
  }
  const doc = {
    version: 1,
    source: 'Natural Earth 1:10m physical labels (public domain); names reviewed in scripts/labels/zone-table.mjs',
    units: { length: 'km', altitude: 'earth radii above the focus (GlobeCamera.alt)', baseM: 'm' },
    count: out.length,
    zones: out,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const body = JSON.stringify(doc).replace('"zones":[', '"zones":[\n').replace(/\},\{"id"/g, '},\n{"id"');
  fs.writeFileSync(OUT, body.replace(/\]\}$/, '\n]}\n'));
  log('wrote', path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB', out.length, 'labels');
  log('by kind', JSON.stringify(stats.byKind));
  if (stats.notInside.length) log('curve fallback (snapped):', stats.notInside.join(', '));
  if (stats.fallback.length) log('degenerate polygons:', stats.fallback.join(', '));
  if (stats.errors.length) log('skipped:', stats.errors.join('; '));
}
