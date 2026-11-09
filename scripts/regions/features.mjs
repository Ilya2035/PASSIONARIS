// Natural Earth vector layers -> rasters on the MAP grid:
//  rivers (hard barriers = major rivers, crossing cost = minor rivers, names),
//  geography regions (ranges, deserts, plains... with Russian names), marine
//  polygons (sea names) and lake names.
import fs from 'node:fs';
import { polygonsOf, linesOf, fillPolygon, rasterLine } from './raster.mjs';
import { buildRiverNamer, cap, genitive } from './names.mjs';

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = f => { try { return fs.statSync(f).size > 0; } catch { return false; } };

// files: { main, extra: [..] }. Returns
// { barrier: Uint8, majorName: Int16, minorName: Int16, minor: Uint8, names: [{key,en,ru,gen}], stats, majorLines }
export function rasterRivers(grid, files, { barrierRank = 6 } = {}) {
  const { N } = grid;
  const main = readJSON(files.main).features;
  const extra = [];
  for (const f of files.extra || []) if (exists(f)) extra.push(...readJSON(f).features);
  // Russian names from the regional layers (they carry name_ru)
  const pairs = new Map();
  for (const ft of [...main, ...extra]) {
    const p = ft.properties || {};
    const en = p.name || p.name_en;
    if (en && p.name_ru && !pairs.has(en)) pairs.set(en, p.name_ru);
  }
  const namer = buildRiverNamer(pairs);
  const names = [], nameIdx = new Map();
  const idxOf = en => {
    const r = namer(en);
    if (!r) return -1;
    let k = nameIdx.get(r.key);
    if (k === undefined) { k = names.length; names.push(r); nameIdx.set(r.key, k); }
    return k;
  };
  const barrier = new Uint8Array(N), minor = new Uint8Array(N);
  const majorName = new Int16Array(N).fill(-1), minorName = new Int16Array(N).fill(-1);
  const majorRank = new Uint8Array(N).fill(255), minorRank = new Uint8Array(N).fill(255);
  const majorLines = []; // [{name, nameIdx, coords}] for tests / previews
  let nMajor = 0, nMinor = 0;
  const isCanal = p => /canal|csatorna|kanal/i.test(p.name || '') || /canal/i.test(p.featurecla || '');
  for (const ft of main) {
    const p = ft.properties || {};
    if (p.featurecla !== 'River' || isCanal(p)) continue;
    const rank = Number(p.scalerank ?? 10);
    const ni = idxOf(fixRiverName(p.name || p.name_en, ft.geometry));
    const isMajor = rank <= barrierRank;
    for (const line of linesOf(ft.geometry)) {
      if (isMajor) {
        majorLines.push({ name: p.name, nameIdx: ni, rank, coords: line });
        rasterLine(grid, line, t => {
          barrier[t] = 1;
          if (rank < majorRank[t]) { majorRank[t] = rank; majorName[t] = ni; }
        });
      } else {
        rasterLine(grid, line, t => {
          minor[t] = 1;
          if (rank < minorRank[t]) { minorRank[t] = rank; minorName[t] = ni; }
        });
      }
    }
    if (isMajor) nMajor++; else nMinor++;
  }
  for (const ft of extra) {
    const p = ft.properties || {};
    if (!/River/.test(p.featurecla || '') || isCanal(p)) continue;
    const rank = Number(p.scalerank ?? 12);
    const ni = idxOf(p.name || p.name_en);
    for (const line of linesOf(ft.geometry)) {
      rasterLine(grid, line, t => {
        if (barrier[t]) return;
        minor[t] = 1;
        if (rank < minorRank[t]) { minorRank[t] = rank; minorName[t] = ni; }
      });
    }
    nMinor++;
  }
  return { barrier, minor, majorName, minorName, names, majorLines, stats: { majorFeatures: nMajor, minorFeatures: nMinor, riverNames: names.length } };
}

// Known misnamed NE river features: an Icelandic river (upper Thjórsá basin,
// 64-65N 18-20W) carries the name "Drau" of the Austrian Drava.
function fixRiverName(name, geom) {
  if (name === 'Drau') {
    const first = linesOf(geom)[0]?.[0];
    if (first && first[0] < -10) return 'Thjórsá';
  }
  return name;
}

// Polygon layers -> Int16 raster of feature index (-1 = none). Larger polygons
// are painted first so smaller (more specific) ones win.
function paintPolys(grid, feats, raster) {
  const withArea = feats.map((f, idx) => {
    let a = 0;
    for (const poly of polygonsOf(f.geometry)) {
      const ring = poly[0];
      for (let i = 0; i + 1 < ring.length; i++) a += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    }
    return { f, idx, a: Math.abs(a) };
  }).sort((p, q) => q.a - p.a || p.idx - q.idx);
  for (const { f, idx } of withArea) {
    for (const poly of polygonsOf(f.geometry)) fillPolygon(grid, poly, (row, x0, x1) => raster.fill(idx, row + x0, row + x1 + 1));
  }
}

const prop = (p, k) => p[k] ?? p[k.toUpperCase()] ?? p[k.toLowerCase()];

// NE geography regions: { range: Int16, feature: Int16, table: [{en, ru, cls}] }
export function rasterGeography(grid, file) {
  const { N } = grid;
  const range = new Int16Array(N).fill(-1), feature = new Int16Array(N).fill(-1);
  const table = [];
  if (!exists(file)) return { range, feature, table, available: false };
  const feats = readJSON(file).features;
  const ranges = [], others = [];
  feats.forEach(f => {
    const p = f.properties || {};
    const cls = prop(p, 'featurecla');
    const en = prop(p, 'name');
    const ru = prop(p, 'name_ru');
    if (!en || cls === 'Continent' || cls === 'Dragons-be-here') { table.push(null); return; }
    table.push({ en: String(en), ru: GEO_FIX[en] || cleanRu(ru) || null, cls });
    if (cls === 'Range/mtn') ranges.push(f); else others.push(f);
  });
  // indices refer to the full feature list
  const idx = new Map(feats.map((f, i) => [f, i]));
  const paint = (list, raster) => {
    const sub = list.map(f => ({ geometry: f.geometry }));
    const tmp = new Int16Array(N).fill(-1);
    paintPolys(grid, sub, tmp);
    for (let i = 0; i < N; i++) if (tmp[i] >= 0) raster[i] = idx.get(list[tmp[i]]);
  };
  paint(ranges, range);
  paint(others, feature);
  return { range, feature, table, available: true };
}

// NE marine polygons: { marine: Int16 (filled to every ocean texel), table }
export function rasterMarine(grid, file, isWater) {
  const { N, W, H } = grid;
  const marine = new Int16Array(N).fill(-1);
  const table = [];
  if (!exists(file)) return { marine, table, available: false };
  const feats = readJSON(file).features;
  for (const f of feats) {
    const p = f.properties || {};
    const en = String(p.name || p.name_en || '');
    table.push({ en, ru: marineRu(cleanRu(p.name_ru), p.featurecla, en), cls: p.featurecla });
  }
  paintPolys(grid, feats, marine);
  // fill uncovered water texels with the nearest label (BFS through water)
  let q = new Int32Array(N), qn = 0;
  for (let i = 0; i < N; i++) if (isWater[i] && marine[i] >= 0) q[qn++] = i;
  for (let i = 0; i < N; i++) if (!isWater[i]) marine[i] = -1;
  let head = 0;
  while (head < qn) {
    const i = q[head++];
    const x = i % W, y = (i - x) / W;
    const nb = [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const j of nb) if (j >= 0 && isWater[j] && marine[j] < 0) { marine[j] = marine[i]; q[qn++] = j; }
  }
  q = null;
  return { marine, table, available: true };
}

// NE lakes: Int16 raster of lake feature index + table of names.
export function rasterLakes(grid, file) {
  const { N } = grid;
  const lake = new Int16Array(N).fill(-1);
  const table = [];
  if (!exists(file)) return { lake, table };
  const feats = readJSON(file).features;
  for (const f of feats) {
    const p = f.properties || {};
    // NE marks dammed lakes and artificial reservoirs as 'Reservoir' (modern water bodies)
    const ru = cleanRu(p.name_ru);
    table.push({ en: String(p.name || p.name_en || ''), ru: ru ? (hasWaterHead(ru) ? ru : `Озеро ${ru}`) : null, reservoir: p.featurecla === 'Reservoir' });
  }
  paintPolys(grid, feats, lake);
  return { lake, table };
}

// Known wrong Russian names in NE geography_regions_polys (checked by hand).
const GEO_FIX = {
  'CENTRAL LOWLAND': 'Центральная низменность', 'CORD. CENTRAL': 'Центральная Кордильера', 'BAJA CALIFORNIA': 'Нижняя Калифорния',
  'Tatra Mts.': 'Татры', 'Gregory Ra.': 'Хребет Грегори', 'Chukchi Range': 'Чукотское нагорье', 'Sea Islands': 'Морские острова',
  'S. do Cachimbo': 'Серра-ду-Кашимбу', 'Darien Gap': 'Дарьен', 'El Gezira': 'Эль-Гезира', 'King Christian IX Land': 'Земля Кристиана IX',
  'Nyeboe Land': 'Земля Нюбо',
};

// NE Russian names of seas and lakes are often bare proper names ("Сулавеси",
// "Виктория", "Джеймс") that clash with islands and land districts of the same
// name. Give them the generic head noun Russian maps use ("Море Сулавеси",
// "Озеро Виктория", "Залив Джеймс").
const WATER_HEADS = /^(море|залив|океан|пролив|проливы|бухта|губа|лагуна|лиман|фьорд|фьерд|канал|проход|зунд|шхеры|риф|рифы|банка|устье|дельта|рукав|озеро|озёра|водохранилище|река|бассейн|залива|моря)$/i;
export function hasWaterHead(ru) {
  return ru.split(/\s+/).some(w => WATER_HEADS.test(w)) || /-саунд$/i.test(ru);
}
const MARINE_HEAD = { sea: 'Море', bay: 'Залив', gulf: 'Залив', inlet: 'Залив', strait: 'Пролив', channel: 'Пролив', sound: 'Пролив', fjord: 'Фьорд', reef: 'Риф', ocean: 'Океан' };
const MARINE_FIX = { Kattegat: 'Пролив Каттегат', Skagerrak: 'Пролив Скагеррак', 'Foxe Basin': 'Бассейн Фокса' };
export function marineRu(ru, cls, en) {
  if (!ru) return null;
  if (MARINE_FIX[en]) return MARINE_FIX[en];
  if (hasWaterHead(ru)) return ru;
  if (cls === 'river') return `Устье ${genitive(ru)}`;
  if (cls === 'lagoon') return /lake|lago|ozero|lagoa/i.test(en) ? `Озеро ${ru}` : `Лагуна ${ru}`;
  return MARINE_HEAD[cls] ? `${MARINE_HEAD[cls]} ${ru}` : ru;
}

// Natural Earth Russian names sometimes carry stress marks or odd casing.
function cleanRu(s) {
  if (!s) return null;
  const t = String(s).replace(/́/g, '').replace(/\s+/g, ' ').trim();
  return t ? cap(t) : null;
}
