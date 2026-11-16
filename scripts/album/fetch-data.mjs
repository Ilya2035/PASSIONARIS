// Fetches and bakes the open data of the graphics album (docs/ALBUM.md) into public/album-data/ (gitignored):
//   heights  — AWS Terrain Tiles, "terrarium" PNGs (zoom 9 for the whole region, zoom 12 around the showcase places)
//              → height-base.u16.gz and height-<place>.u16.gz: little-endian Uint16, metres = v / 4 − 8192, Web Mercator
//   vectors  — Natural Earth 10m rivers, lakes (no reservoirs) and populated places clipped to the region → vectors.json
//   textures — tiling ground photos from Poly Haven (CC0) → tex/<id>_diff.jpg, tex/<id>_nor.jpg
//   meta.json — what is where
// (The fine heights of the mountains, zoom 11, are fetched by scripts/album/fetch-heights-fine.mjs after this script.)
// Raw downloads are cached in data/album/ (gitignored), so the script can be re-run and resumes where it stopped.
//   node scripts/album/fetch-data.mjs [--no-textures] [--no-detail] [--stage 3] [--out <folder>]
// --stage: the polygon to bake for (src/album/geo.js: STAGE, BBOXES); by default the one the code stands at.
// --out: where to write instead of public/album-data/ — the data of the next stage are prepared beside the present
//   ones (the leading session: <main>/data/album/stage3/album-data/) and copied over them when the switch is thrown.
// At stage 3 the base is written already mended — the needles and wells of the coast, the pockets of the lagoons, the
// hollows below the sea (ground/despike.js, water/hollows.js, in that order) — and meta.json says "mended": true, so
// the loaders of the page and of Node skip those steps.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { STAGE, BBOXES } from '../../src/album/geo.js';
import { despike, mendPockets, DRY_LAND } from '../../src/album/ground/despike.js';
import { fillHollows } from '../../src/album/water/hollows.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MAIN = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
const RAW = [join(ROOT, 'data', 'raw'), join(MAIN, 'data', 'raw')].find(d => existsSync(join(d, 'ne_10m_lakes.geojson')));
const CACHE = join(ROOT, 'data', 'album');
const flag = f => process.argv.includes(f);
const opt = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = opt('--out') ? resolve(opt('--out')) : join(ROOT, 'public', 'album-data');
const UA = { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)' };

const stage = +(opt('--stage') || STAGE) >= 3 ? 3 : 2;
export const BBOX = BBOXES[stage];
export const PLACES = [
  { id: 'pyrenees', name: 'Пиренеи', lat: 42.63, lon: 0.66 },
  { id: 'ebro', name: 'Дельта Эбро', lat: 40.72, lon: 0.72 },
  { id: 'gibraltar', name: 'Гибралтарский пролив', lat: 36.0, lon: -5.5 },
  { id: 'madrid', name: 'Мадрид и Гвадаррама', lat: 40.6, lon: -3.85 },
  { id: 'nevada', name: 'Сьерра-Невада', lat: 37.05, lon: -3.35 },
  { id: 'toulouse', name: 'Тулуза и Гаронна', lat: 43.6, lon: 1.35 },
  { id: 'picos', name: 'Пикос-де-Эуропа', lat: 43.2, lon: -4.85 },
  { id: 'lisbon', name: 'Лиссабон и устье Тежу', lat: 38.75, lon: -9.15 },
];
const TEXTURES = [ // Poly Haven ids; missing ones are skipped
  ['aerial_grass_rock', true], ['aerial_rocks_02', true], ['aerial_rocks_04', true], ['aerial_ground_rock', true],
  ['aerial_beach_01', false], ['aerial_sand', false], ['aerial_mud_1', false], ['forest_floor', true],
  ['forrest_ground_01', false], ['dry_ground_01', true], ['brown_mud_leaves_01', false], ['snow_02', true],
  ['snow_field_aerial', true], ['rocky_terrain_02', true], ['cliff_side', true], ['coast_sand_rocks_02', false],
];

const tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };

async function get(url, file, tries = 4) {
  if (existsSync(file) && statSync(file).size > 0) return true;
  mkdirSync(dirname(file), { recursive: true });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 404) return false;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) { if (i === tries - 1) { console.log('  failed', url, String(e).slice(0, 80)); return false; } await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
}
async function pool(items, n, fn) { let i = 0, done = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); if (++done % 100 === 0) console.log(`  ${done}/${items.length}`); } })); }

// ---- heights
// (a tile already fetched may lie in the cache of this folder or of the main one; a new one goes to the main folder,
// where the leading session keeps the raw material)
const tileFile = (z, x, y) => { const here = join(CACHE, 'terrarium', String(z), String(x), `${y}.png`); return existsSync(here) ? here : join(MAIN, 'data', 'album', 'terrarium', String(z), String(x), `${y}.png`); };
// Land that lies below the sea and is not sea. By the heights alone it would be drawn as water, so where the outline
// of a country (Natural Earth) says land, ground lower than LOW_M is lifted to it: flat land a little above the
// water. Only inside these boxes — everywhere else land below the sea is a lagoon or a shore, and there the heights
// know better than an outline. The outlines are laid LOW_FINE times finer than the base, and a point of the base is
// lifted by the share of it that is land: the shore of the lifted ground is a smooth line, without stairs or teeth.
//   the polders of the Low Countries: the dikes and dunes that keep the sea out are thinner than a point of the base;
//     by the heights Holland is sea and Lelystad stands in a lake (found by the division session, 15.11.2026). The
//     lakes of the outline are cut out: the IJsselmeer stays water, Flevoland inside it stays land.
//   the chotts of the Sahara (Melrhir, Merouane, el Gharsa): salt pans down to 40 m below the sea — dry ground, not
//     lakes of blue water.
export const LOWLANDS = [
  // (east to the edge of the rectangle: the marshes of East Frisia and of the Elbe are the same land below the sea —
  // with the box ending at 7.3° the sea stood over Germany along a straight line, seen by the ground session)
  { name: 'the polders of the Low Countries and the marshes of the North Sea', lon0: 1.5, lon1: 11.7, lat0: 50.7, lat1: 53.7, lakes: true, arms: true },
  { name: 'the chotts of the Sahara', lon0: 4.5, lon1: 9.7, lat0: 32.8, lat1: 35.0, lakes: false },
];
// (LOW_M, metres: DRY_LAND of the ground (ground/despike.js) — one number for all, the rule of the swamps knows the
// lifted land by it: dead-level ground at exactly this height. Not below 2 m: by the rules of the shore trees do not
// stand below 1.2 m and the fields of a settlement fade below 2 m — with the polders at 1 m every village of Holland
// stood as a bare pale square on grass without a field or a wood, seen on the assembly of 16.11.2026.)
export const LOW_M = DRY_LAND, LOW_FINE = 4;
// The arms of the sea in the delta of the Rhine, the Maas and the Scheldt (Oosterschelde, Grevelingen, Haringvliet,
// Hollands Diep, …). The outline of the country runs along the dams of the Delta Works, so by it the arms are land
// and were lifted with the polders: the islands of Zeeland and South Holland grew into one piece of land (seen by the
// roads session on the data of stage 3). Their outlines — OpenStreetMap, gathered by the roads session into
// data/album/stage3/sea-arms.json of the main folder — are cut out of the land of a box marked `arms`, and ground
// inside them that stands above ARM_M is lowered to it: shallow water of the sea, by the share of the point that is
// water, like the lift. The other groups of that file (what is left of the Zuiderzee, the Lauwersmeer) are not
// touched: the Zuiderzee is water by the lakes of the outline already.
export const ARM_M = -3, ARM_GROUPS = ['delta'];
function seaArms() {
  const f = join(MAIN, 'data', 'album', 'stage3', 'sea-arms.json');
  if (!existsSync(f)) { console.log('  no outlines of the arms of the sea (data/album/stage3/sea-arms.json of the main folder): the delta stays as the outline of the country has it'); return []; }
  return JSON.parse(readFileSync(f, 'utf8')).arms.filter(a => ARM_GROUPS.includes(a.group)).map(a => [a.ring, ...(a.holes || [])]);
}
function liftLowlands(out, z, x0, y0, W, H) {
  if (!RAW) return 0;
  const px = lon => tx(lon, z) * 256 - x0 * 256, py = lat => ty(lat, z) * 256 - y0 * 256, low = (LOW_M + 8192) * 4, deep = (ARM_M + 8192) * 4;
  const rd = f => JSON.parse(readFileSync(join(RAW, f), 'utf8')).features;
  const polysOf = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const countries = rd('ne_10m_admin_0_countries.geojson').flatMap(f => polysOf(f.geometry));
  const lakes = rd('ne_10m_lakes.geojson').filter(f => f.properties.featurecla !== 'Reservoir').flatMap(f => polysOf(f.geometry));
  const arms = LOWLANDS.some(b => b.arms) ? seaArms() : [];
  let lifted = 0;
  for (const b of LOWLANDS) {
    const i0 = Math.max(0, Math.floor(px(b.lon0))), i1 = Math.min(W - 1, Math.ceil(px(b.lon1))), j0 = Math.max(0, Math.floor(py(b.lat1))), j1 = Math.min(H - 1, Math.ceil(py(b.lat0)));
    if (i1 < i0 || j1 < j0) continue;
    const Q = LOW_FINE, bw = (i1 - i0 + 1) * Q, bh = (j1 - j0 + 1) * Q, land = new Uint8Array(bw * bh), xs = [];
    const sea = b.arms && arms.length ? new Uint8Array(bw * bh) : null;   // the fine points inside an arm of the sea
    // the fine points whose middle lies inside a polygon (even-odd: its holes stay out) are set to v
    const fill = (poly, v, into = land) => {
      const rings = poly.map(r => r.map(p => [(px(p[0]) - i0) * Q, (py(p[1]) - j0) * Q]));
      let ya = 1e9, yb = -1e9, xa = 1e9, xb = -1e9;
      for (const p of rings[0]) { if (p[1] < ya) ya = p[1]; if (p[1] > yb) yb = p[1]; if (p[0] < xa) xa = p[0]; if (p[0] > xb) xb = p[0]; }
      if (yb < 0 || ya > bh || xb < 0 || xa > bw) return;
      for (let j = Math.max(0, Math.floor(ya)); j <= Math.min(bh - 1, Math.ceil(yb)); j++) {
        const y = j + .5; xs.length = 0;
        for (const r of rings) for (let k = 0, c = r.length - 1; k < r.length; c = k++) { const p = r[k], q = r[c]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil(xs[k] - .5)); i <= Math.min(bw - 1, Math.ceil(xs[k + 1] - .5) - 1); i++) into[j * bw + i] = v;
      }
    };
    for (const p of countries) fill(p, 1);
    if (b.lakes) for (const p of lakes) fill(p, 0);
    if (sea) for (const p of arms) { fill(p, 0); fill(p, 1, sea); }
    let n = 0, cut = 0;
    for (let j = 0; j < bh / Q; j++) for (let i = 0; i < bw / Q; i++) {
      const t = (j0 + j) * W + i0 + i, v = out[t]; if (v >= low && !sea) continue;
      let share = 0, wet = 0;
      for (let b2 = 0; b2 < Q; b2++) for (let a2 = 0; a2 < Q; a2++) { const f = (j * Q + b2) * bw + i * Q + a2; share += land[f]; if (sea) wet += sea[f]; }
      let h = v;
      if (v < low && share) { h += (low - v) * share / (Q * Q); n++; }
      if (wet && v > deep) { h += (deep - v) * wet / (Q * Q); cut++; }
      if (h !== v) out[t] = Math.round(h);
    }
    console.log(`  ${b.name}: ${n} points lifted above the sea${sea ? `, ${cut} points of the arms of the sea lowered to ${ARM_M} m` : ''}`);
    lifted += n;
  }
  return lifted;
}
async function mosaic(z, x0, x1, y0, y1, outName, mend = false) {
  const tiles = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
  await pool(tiles, 12, ([x, y]) => get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, tileFile(z, x, y)));
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256, out = new Uint16Array(W * H).fill(8192 * 4);
  let missing = 0;
  for (const [x, y] of tiles) {
    const f = tileFile(z, x, y); if (!existsSync(f)) { missing++; continue; }
    const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = (x - x0) * 256, oy = (y - y0) * 256, c = info.channels;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * c, h = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
      out[(oy + j) * W + ox + i] = Math.max(0, Math.min(65535, Math.round((h + 8192) * 4)));
    }
  }
  if (missing) console.log(`  ${missing} tiles of ${tiles.length} are missing — run again`);
  if (mend) liftLowlands(out, z, x0, y0, W, H);
  if (mend) { despike(out, W, H); mendPockets(out, W, H); fillHollows(out, W, H); }   // the page and Node then take the base as it is
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < out.length; i++) { const h = out[i] / 4 - 8192; if (h < lo) lo = h; if (h > hi) hi = h; }
  const gz = gzipSync(Buffer.from(out.buffer), { level: 6 });
  writeFileSync(join(OUT, outName), gz);
  console.log(`  ${outName}: ${W}×${H}, ${Math.round(lo)}…${Math.round(hi)} m, ${(gz.length / 1e6).toFixed(1)} MB`);
  return { file: outName, z, x0, y0, w: W, h: H, min: Math.round(lo), max: Math.round(hi) };
}

// ---- vectors
const RU = { Madrid: 'Мадрид', Barcelona: 'Барселона', Lisbon: 'Лиссабон', Valencia: 'Валенсия', Seville: 'Севилья', Sevilla: 'Севилья', Zaragoza: 'Сарагоса', Málaga: 'Малага', Bilbao: 'Бильбао', Porto: 'Порту', Toulouse: 'Тулуза', Bordeaux: 'Бордо', Marseille: 'Марсель', Montpellier: 'Монпелье', Granada: 'Гранада', Córdoba: 'Кордова', Murcia: 'Мурсия', Valladolid: 'Вальядолид', Vigo: 'Виго', 'A Coruña': 'Ла-Корунья', 'La Coruña': 'Ла-Корунья', Gijón: 'Хихон', Oviedo: 'Овьедо', Santander: 'Сантандер', Pamplona: 'Памплона', 'San Sebastián': 'Сан-Себастьян', Alicante: 'Аликанте', Almería: 'Альмерия', Cádiz: 'Кадис', Cartagena: 'Картахена', Toledo: 'Толедо', Salamanca: 'Саламанка', Burgos: 'Бургос', León: 'Леон', Badajoz: 'Бадахос', Mérida: 'Мерида', Tarragona: 'Таррагона', Lleida: 'Льейда', Girona: 'Жирона', Perpignan: 'Перпиньян', Narbonne: 'Нарбонна', Bayonne: 'Байонна', Pau: 'По', Tangier: 'Танжер', Ceuta: 'Сеута', Gibraltar: 'Гибралтар', Coimbra: 'Коимбра', Faro: 'Фару', Braga: 'Брага', Évora: 'Эвора', Palma: 'Пальма', Andorra: 'Андорра', 'Andorra la Vella': 'Андорра-ла-Велья', Huelva: 'Уэльва', Jaén: 'Хаэн', Albacete: 'Альбасете', Logroño: 'Логроньо', Vitoria: 'Витория', Nîmes: 'Ним', Avignon: 'Авиньон', Agen: 'Ажен', Tétouan: 'Тетуан', Santiago: 'Сантьяго', 'Santiago de Compostela': 'Сантьяго-де-Компостела', Setúbal: 'Сетубал', Castellón: 'Кастельон', Huesca: 'Уэска', Teruel: 'Теруэль', Cuenca: 'Куэнка', Soria: 'Сория', Segovia: 'Сеговия', Ávila: 'Авила', Cáceres: 'Касерес', Lugo: 'Луго', Ourense: 'Оренсе', Tarbes: 'Тарб', Carcassonne: 'Каркасон', Béziers: 'Безье' };
const RIV = { Ebro: 'Эбро', Tajo: 'Тахо', Tagus: 'Тахо', Tejo: 'Тежу', Duero: 'Дуэро', Douro: 'Дору', Guadiana: 'Гвадиана', Guadalquivir: 'Гвадалквивир', Garonne: 'Гаронна', Júcar: 'Хукар', Segura: 'Сегура', Miño: 'Миньо', Minho: 'Миньо', Dordogne: 'Дордонь', Rhône: 'Рона', Adour: 'Адур', Lot: 'Ло', Tarn: 'Тарн', Genil: 'Хениль', Jalón: 'Халон', Segre: 'Сегре', Cinca: 'Синка', Esla: 'Эсла', Pisuerga: 'Писуэрга', Aude: 'Од', Hérault: 'Эро', Mondego: 'Мондегу', Sado: 'Саду', Turia: 'Турия', Aragón: 'Арагон', Gállego: 'Гальего', Ariège: 'Арьеж' };
// The outline of a lake with its islands cut in. A lake goes into vectors.json as ONE ring, and whoever asks "is this
// point in the lake" counts crossings of that ring. So a large island must not be lost: Flevoland is a hole of 930 km²
// in the outline of the IJsselmeer, and without it Lelystad stood in the lake (found by the division session on the
// data of stage 3). The ring runs round the lake, goes to the island by the shortest way, round it, and back by the
// same way: the two passes of the cut cancel in the count, the island is outside. poly: [outline, hole, …].
export function keyhole(poly) {
  let ring = poly[0].slice();
  for (const hole of poly.slice(1)) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < ring.length; i++) for (let j = 0; j < hole.length; j++) { const d = (ring[i][0] - hole[j][0]) ** 2 + (ring[i][1] - hole[j][1]) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } }
    ring = [...ring.slice(0, bi + 1), ...hole.slice(bj), ...hole.slice(0, bj + 1), ...ring.slice(bi)];
  }
  return ring;
}
function vectors() {
  const B = BBOX, inside = ([lo, la]) => lo >= B.lon0 - 0.5 && lo <= B.lon1 + 0.5 && la >= B.lat0 - 0.5 && la <= B.lat1 + 0.5;
  const rd = f => JSON.parse(readFileSync(join(RAW, f), 'utf8')).features;
  const r5 = v => Math.round(v * 1e5) / 1e5;
  const rivers = [];
  for (const f of rd('ne_10m_rivers_lake_centerlines.geojson')) {
    const g = f.geometry; if (!g) continue;
    for (const line of g.type === 'LineString' ? [g.coordinates] : g.coordinates) {
      let run = [];
      const flush = () => { if (run.length > 1) rivers.push({ name: RIV[f.properties.name] || f.properties.name || '', rank: f.properties.scalerank ?? 9, pts: run.map(p => [r5(p[0]), r5(p[1])]) }); run = []; };
      for (const p of line) inside(p) ? run.push(p) : flush();
      flush();
    }
  }
  const lakes = [];
  for (const f of rd('ne_10m_lakes.geojson')) {
    if (f.properties.featurecla === 'Reservoir' || !f.geometry) continue;
    for (const poly of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      if (poly[0].some(inside)) lakes.push({ name: f.properties.name_ru || f.properties.name || '', ring: keyhole(poly).map(p => [r5(p[0]), r5(p[1])]) });
  }
  const places = rd('ne_10m_populated_places_simple.geojson').map(f => f.properties)
    .filter(p => inside([p.longitude, p.latitude])).sort((a, b) => b.pop_max - a.pop_max).slice(0, 140)
    .map(p => ({ name: RU[p.name] || p.name, lat: r5(p.latitude), lon: r5(p.longitude), pop: p.pop_max }));
  writeFileSync(join(OUT, 'vectors.json'), JSON.stringify({ rivers, lakes, places }));
  console.log(`  vectors.json: ${rivers.length} river lines, ${lakes.length} lakes, ${places.length} places`);
  return { rivers: rivers.length, lakes: lakes.length, places: places.length };
}

// ---- textures
async function textures() {
  const got = [];
  for (const [id, withNormal] of TEXTURES) {
    const meta = join(CACHE, 'polyhaven', `${id}.json`);
    if (!await get(`https://api.polyhaven.com/files/${id}`, meta)) { console.log('  no such texture:', id); continue; }
    const j = JSON.parse(readFileSync(meta, 'utf8'));
    const diff = j.Diffuse?.['2k']?.jpg?.url, nor = j.nor_gl?.['2k']?.jpg?.url;
    if (!diff || !await get(diff, join(OUT, 'tex', `${id}_diff.jpg`))) continue;
    const n = withNormal && nor ? await get(nor, join(OUT, 'tex', `${id}_nor.jpg`)) : false;
    got.push({ id, normal: !!n });
  }
  console.log(`  textures: ${got.length} of ${TEXTURES.length}`);
  return got;
}

mkdirSync(OUT, { recursive: true }); mkdirSync(CACHE, { recursive: true });
const meta = { stage, mended: stage >= 3, bbox: BBOX, encode: 'metres = v / 4 - 8192', sources: {
  heights: 'AWS Terrain Tiles (terrarium), https://registry.opendata.aws/terrain-tiles/',
  vectors: 'Natural Earth 10m, public domain', textures: 'Poly Haven, CC0' } };
console.log(`heights: region of stage ${stage}, zoom 9${meta.mended ? ', mended' : ''} → ${OUT}`);
const Z = 9;
meta.base = await mosaic(Z, Math.floor(tx(BBOX.lon0, Z)), Math.floor(tx(BBOX.lon1, Z)), Math.floor(ty(BBOX.lat1, Z)), Math.floor(ty(BBOX.lat0, Z)), 'height-base.u16.gz', meta.mended);
meta.places = [];
if (!flag('--no-detail')) for (const p of PLACES) {
  console.log('heights:', p.id, 'zoom 12');
  const z = 12, cx = Math.floor(tx(p.lon, z)), cy = Math.floor(ty(p.lat, z));
  meta.places.push({ ...p, detail: await mosaic(z, cx - 4, cx + 3, cy - 4, cy + 3, `height-${p.id}.u16.gz`) });
} else meta.places = PLACES;
console.log('vectors'); meta.vectors = vectors();
if (!flag('--no-textures')) { console.log('textures'); meta.textures = await textures(); }
// the fine heights of the mountains are another script's (fetch-heights-fine.mjs): keep what it wrote
try { const old = JSON.parse(readFileSync(join(OUT, 'meta.json'), 'utf8')); if (old.fine) meta.fine = old.fine; } catch { /* first run */ }
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log('done →', OUT);
