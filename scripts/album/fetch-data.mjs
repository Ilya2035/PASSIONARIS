// Fetches and bakes the open data of the graphics album (docs/ALBUM.md) into public/album-data/ (gitignored):
//   heights  — AWS Terrain Tiles, "terrarium" PNGs (zoom 9 for the whole region, zoom 12 around the showcase places)
//              → height-base.u16.gz and height-<place>.u16.gz: little-endian Uint16, metres = v / 4 − 8192, Web Mercator
//   vectors  — Natural Earth 10m rivers, lakes (no reservoirs) and populated places clipped to the region → vectors.json
//   textures — tiling ground photos from Poly Haven (CC0) → tex/<id>_diff.jpg, tex/<id>_nor.jpg
//   meta.json — what is where
// Raw downloads are cached in data/album/ (gitignored), so the script can be re-run and resumes where it stopped.
//   node scripts/album/fetch-data.mjs [--no-textures] [--no-detail]
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MAIN = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
const RAW = [join(ROOT, 'data', 'raw'), join(MAIN, 'data', 'raw')].find(d => existsSync(join(d, 'ne_10m_lakes.geojson')));
const CACHE = join(ROOT, 'data', 'album');
const OUT = join(ROOT, 'public', 'album-data');
const flag = f => process.argv.includes(f);
const UA = { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)' };

export const BBOX = { lon0: -10.0, lon1: 4.5, lat0: 35.2, lat1: 44.8 };
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
const tileFile = (z, x, y) => join(CACHE, 'terrarium', String(z), String(x), `${y}.png`);
async function mosaic(z, x0, x1, y0, y1, outName) {
  const tiles = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
  await pool(tiles, 12, ([x, y]) => get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, tileFile(z, x, y)));
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256, out = new Uint16Array(W * H).fill(8192 * 4);
  let lo = 1e9, hi = -1e9;
  for (const [x, y] of tiles) {
    const f = tileFile(z, x, y); if (!existsSync(f)) continue;
    const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = (x - x0) * 256, oy = (y - y0) * 256, c = info.channels;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * c, h = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
      if (h < lo) lo = h; if (h > hi) hi = h;
      out[(oy + j) * W + ox + i] = Math.max(0, Math.min(65535, Math.round((h + 8192) * 4)));
    }
  }
  const gz = gzipSync(Buffer.from(out.buffer), { level: 6 });
  writeFileSync(join(OUT, outName), gz);
  console.log(`  ${outName}: ${W}×${H}, ${Math.round(lo)}…${Math.round(hi)} m, ${(gz.length / 1e6).toFixed(1)} MB`);
  return { file: outName, z, x0, y0, w: W, h: H, min: Math.round(lo), max: Math.round(hi) };
}

// ---- vectors
const RU = { Madrid: 'Мадрид', Barcelona: 'Барселона', Lisbon: 'Лиссабон', Valencia: 'Валенсия', Seville: 'Севилья', Sevilla: 'Севилья', Zaragoza: 'Сарагоса', Málaga: 'Малага', Bilbao: 'Бильбао', Porto: 'Порту', Toulouse: 'Тулуза', Bordeaux: 'Бордо', Marseille: 'Марсель', Montpellier: 'Монпелье', Granada: 'Гранада', Córdoba: 'Кордова', Murcia: 'Мурсия', Valladolid: 'Вальядолид', Vigo: 'Виго', 'A Coruña': 'Ла-Корунья', 'La Coruña': 'Ла-Корунья', Gijón: 'Хихон', Oviedo: 'Овьедо', Santander: 'Сантандер', Pamplona: 'Памплона', 'San Sebastián': 'Сан-Себастьян', Alicante: 'Аликанте', Almería: 'Альмерия', Cádiz: 'Кадис', Cartagena: 'Картахена', Toledo: 'Толедо', Salamanca: 'Саламанка', Burgos: 'Бургос', León: 'Леон', Badajoz: 'Бадахос', Mérida: 'Мерида', Tarragona: 'Таррагона', Lleida: 'Льейда', Girona: 'Жирона', Perpignan: 'Перпиньян', Narbonne: 'Нарбонна', Bayonne: 'Байонна', Pau: 'По', Tangier: 'Танжер', Ceuta: 'Сеута', Gibraltar: 'Гибралтар', Coimbra: 'Коимбра', Faro: 'Фару', Braga: 'Брага', Évora: 'Эвора', Palma: 'Пальма', Andorra: 'Андорра', 'Andorra la Vella': 'Андорра-ла-Велья', Huelva: 'Уэльва', Jaén: 'Хаэн', Albacete: 'Альбасете', Logroño: 'Логроньо', Vitoria: 'Витория', Nîmes: 'Ним', Avignon: 'Авиньон', Agen: 'Ажен', Tétouan: 'Тетуан', Santiago: 'Сантьяго', 'Santiago de Compostela': 'Сантьяго-де-Компостела', Setúbal: 'Сетубал', Castellón: 'Кастельон', Huesca: 'Уэска', Teruel: 'Теруэль', Cuenca: 'Куэнка', Soria: 'Сория', Segovia: 'Сеговия', Ávila: 'Авила', Cáceres: 'Касерес', Lugo: 'Луго', Ourense: 'Оренсе', Tarbes: 'Тарб', Carcassonne: 'Каркасон', Béziers: 'Безье' };
const RIV = { Ebro: 'Эбро', Tajo: 'Тахо', Tagus: 'Тахо', Tejo: 'Тежу', Duero: 'Дуэро', Douro: 'Дору', Guadiana: 'Гвадиана', Guadalquivir: 'Гвадалквивир', Garonne: 'Гаронна', Júcar: 'Хукар', Segura: 'Сегура', Miño: 'Миньо', Minho: 'Миньо', Dordogne: 'Дордонь', Rhône: 'Рона', Adour: 'Адур', Lot: 'Ло', Tarn: 'Тарн', Genil: 'Хениль', Jalón: 'Халон', Segre: 'Сегре', Cinca: 'Синка', Esla: 'Эсла', Pisuerga: 'Писуэрга', Aude: 'Од', Hérault: 'Эро', Mondego: 'Мондегу', Sado: 'Саду', Turia: 'Турия', Aragón: 'Арагон', Gállego: 'Гальего', Ariège: 'Арьеж' };
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
      if (poly[0].some(inside)) lakes.push({ name: f.properties.name_ru || f.properties.name || '', ring: poly[0].map(p => [r5(p[0]), r5(p[1])]) });
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
const meta = { bbox: BBOX, encode: 'metres = v / 4 - 8192', sources: {
  heights: 'AWS Terrain Tiles (terrarium), https://registry.opendata.aws/terrain-tiles/',
  vectors: 'Natural Earth 10m, public domain', textures: 'Poly Haven, CC0' } };
console.log('heights: region, zoom 9');
const Z = 9;
meta.base = await mosaic(Z, Math.floor(tx(BBOX.lon0, Z)), Math.floor(tx(BBOX.lon1, Z)), Math.floor(ty(BBOX.lat1, Z)), Math.floor(ty(BBOX.lat0, Z)), 'height-base.u16.gz');
meta.places = [];
if (!flag('--no-detail')) for (const p of PLACES) {
  console.log('heights:', p.id, 'zoom 12');
  const z = 12, cx = Math.floor(tx(p.lon, z)), cy = Math.floor(ty(p.lat, z));
  meta.places.push({ ...p, detail: await mosaic(z, cx - 4, cx + 3, cy - 4, cy + 3, `height-${p.id}.u16.gz`) });
} else meta.places = PLACES;
console.log('vectors'); meta.vectors = vectors();
if (!flag('--no-textures')) { console.log('textures'); meta.textures = await textures(); }
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log('done →', OUT);
