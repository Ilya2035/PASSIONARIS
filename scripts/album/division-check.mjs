// The division of the album in Node, for the notes of the division work (docs/album/division.md): builds it as the page
// does (districts of 20 km, along the rivers) and prints what the borders, the chunks and the centres are like.
//   node scripts/album/division-check.mjs [size]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks } from '../../src/album/chunks.js';
import { buildDivision, LAND } from '../../src/album/division/build.js';
import { loadAlbumData } from '../../src/album/division/nodedata.js';
import { KN } from '../../src/album/division/km.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = f => JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division', f), 'utf8'));
const data = loadAlbumData(ROOT); if (!data) { console.log('no album data (public/album-data)'); process.exit(1); }
const lakes = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'public/assets/album/water/lakes.json'), 'utf8')).lakes.filter(l => !l.shoal && l.ring); } catch { return []; } })();
const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
const size = +process.argv[2] || 20, t0 = performance.now();
const div = buildDivision(ch, { lands: json('lands.json'), admin: json('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size });
const g = div.geo;
console.log(`division ${size} km: ${div.count} districts, built in ${(performance.now() - t0).toFixed(0)} ms`);
console.log(`borders: ${g.lines.length} lines, ${g.count} pieces; lists ${g.list.length} entries; squares with a list ${g.num.reduce((s, v) => s + (v > 0), 0)}; most fours ${g.num.reduce((m, v) => Math.max(m, v), 0)}; clipped ${g.over}`);
const hist = new Map(); for (const v of g.num) if (v) hist.set(v, (hist.get(v) || 0) + 1); console.log('fours per square:', [...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + ':' + v).join(' '));
console.log(`chunks moved to the district their seed lies in: ${g.moved}`);
const num = new Int32Array(div.count); for (const d of div.cells) if (d >= 0) num[d]++;
const empty = []; for (let d = 0; d < div.count; d++) if (!num[d]) empty.push(d); console.log('districts without chunks:', empty.length, empty.slice(0, 10).join(' '));
const land = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) land.push(num[d]); land.sort((a, b) => a - b);
console.log(`land district chunks: min ${land[0]}, 10% ${land[land.length * .1 | 0]}, mid ${land[land.length >> 1]}, 90% ${land[land.length * .9 | 0]}, max ${land[land.length - 1]}`);
export { div, ch, data };
if (process.argv.includes('--moved')) {
  const { districtCells } = await import('../../src/album/division/cells.js');
  const c0 = districtCells(ch, div, { heightAt: data.base.at, rivers: data.vectors.rivers || [] }).cells, n0 = new Int32Array(div.count);
  for (const d of c0) if (d >= 0) n0[d]++;
  const rows = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) rows.push([d, n0[d], num[d], (num[d] - n0[d]) / Math.max(1, n0[d])]);
  rows.sort((a, b) => a[3] - b[3]);
  console.log('lost most:', rows.slice(0, 8).map(r => `${r[0]}:${r[1]}→${r[2]}`).join(' '));
  console.log('gained most:', rows.slice(-8).map(r => `${r[0]}:${r[1]}→${r[2]}`).join(' '));
  const small = rows.filter(r => r[1] < 60).map(r => `${r[0]}:${r[1]}→${r[2]}`); console.log('small before:', small.length, small.slice(0, 20).join(' '));
}
if (process.argv.includes('--centres')) {
  const { gunzipSync } = await import('node:zlib');
  const { decodeSites } = await import('../../src/album/town/sites.js');
  const { districtCentres, PLACE_WHY } = await import('../../src/album/division/centres.js');
  const { kmSettle, SETTLE_WHY } = await import('../../src/album/division/km.js');
  const { kmOf } = await import('../../src/album/chunks.js');
  const osm = decodeSites(JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/assets/album/town/sites.json.gz'))).toString()));
  const own = (data.vectors.places || []).map(pl => { const [x, y] = kmOf(pl.lat, pl.lon); return { x, y, pop: pl.pop, name: pl.name }; });
  const sites = [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  const t1 = performance.now(), wetlands = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/swamp/wetlands.json'), 'utf8')).wetlands;
  const settle = kmSettle(div, data.base.at, { wetlands }), cen = districtCentres(div, sites, { settle });
  console.log(`centres in ${(performance.now() - t1).toFixed(0)} ms`);
  const whyN = new Array(PLACE_WHY.length).fill(0); let landN = 0; for (let d = 0; d < div.count; d++) if (cen.texel[d] >= 0) { landN++; whyN[cen.why[d]]++; }
  console.log('places:', landN, PLACE_WHY.map((w, i) => `${w} ${whyN[i]}`).join(', '));
  const sw = new Array(SETTLE_WHY.length).fill(0); for (const w of settle.why) sw[w]++; console.log('settle reasons (chunks):', SETTLE_WHY.map((w, i) => `${w || 'можно'} ${sw[i]}`).join(', '));
  let near = 1e9; const pts = []; for (let d = 0; d < div.count; d++) if (cen.texel[d] >= 0) pts.push([cen.x[d], cen.y[d]]);
  let close = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const dd = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); near = Math.min(near, dd); if (dd < 6) close++; }
  console.log(`nearest two towns ${near.toFixed(1)} km; pairs closer than 6 km: ${close}`);
  { const ds = []; for (let d = 0; d < div.count; d++) if (cen.texel[d] >= 0) ds.push(d); for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) { const a = ds[i], b = ds[j], dd = Math.hypot(cen.x[a] - cen.x[b], cen.y[a] - cen.y[b]); if (dd < 4) console.log("  close", a, b, dd.toFixed(1), PLACE_WHY[cen.why[a]], PLACE_WHY[cen.why[b]], cen.site[a] >= 0 ? sites[cen.site[a]].name : "", cen.site[b] >= 0 ? sites[cen.site[b]].name : ""); } }
  const name = d => cen.site[d] >= 0 ? sites[cen.site[d]].name : `№${d}`;
  console.log('regions:', cen.seats.region.map((d, r) => d === undefined ? null : `${div.regions[r].name} → ${name(d)}`).filter(Boolean).join('; '));
  console.log('lands:', [...cen.seats.land].map(([l, d]) => `${l} → ${name(d)}`).join('; '));
  for (const [lat, lon, label] of [[39.47, -0.38, 'Валенсия'], [41.39, 2.17, 'Барселона'], [36.72, -4.42, 'Малага'], [41.65, -0.89, 'Сарагоса'], [41.0, -0.3, 'Эбро ниже Сарагосы'], [39.4, -3.2, 'Ла-Манча'], [42.6, 0.5, 'Пиренеи, Бенаске'], [40.3, 0.3, 'берег Кастельона'], [41.12, 1.25, 'Таррагона']]) {
    const [x, y] = kmOf(lat, lon), t = Math.floor(y - 3880) * 1280 + Math.floor(x + 880), d = div.cells[t];
    console.log(`${label}: district ${d}, town ${name(d)} at ${(cen.y[d] / 111.32).toFixed(3)}, ${(cen.x[d] / (111.32 * Math.cos(40 * Math.PI / 180))).toFixed(3)} (${PLACE_WHY[cen.why[d]]}${cen.pop[d] ? ', ' + cen.pop[d] + ' жит.' : ''}${cen.seat[d] ? ', seat ' + cen.seat[d] : ''})`);
  }
}
if (process.argv.includes('--names')) {
  const { gunzipSync } = await import('node:zlib');
  const { decodeSites } = await import('../../src/album/town/sites.js');
  const { districtCentres } = await import('../../src/album/division/centres.js');
  const { nameDistricts } = await import('../../src/album/division/names.js');
  const { kmOf } = await import('../../src/album/chunks.js');
  const osm = decodeSites(JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/assets/album/town/sites.json.gz'))).toString()));
  const own = (data.vectors.places || []).map(pl => { const [x, y] = kmOf(pl.lat, pl.lon); return { x, y, pop: pl.pop, name: pl.name }; });
  const sites = [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  div.centres = districtCentres(div, sites);
  const lands = json('lands.json'), nm = nameDistricts(div, sites, lands), kinds = {};
  for (let d = 0; d < div.count; d++) { const k = (div.kinds[d] === LAND ? 'land ' : 'water ') + nm.kind[d]; kinds[k] = (kinds[k] || 0) + 1; }
  console.log('names:', JSON.stringify(kinds), 'empty:', nm.names.filter(n => !n).length, 'numbered:', nm.names.filter(n => /№/.test(n)).length);
  const dup = new Map(); nm.names.forEach((n, d) => { const k = div.province[d] + '|' + n; dup.set(k, (dup.get(k) || 0) + 1); }); console.log('same name twice in a province:', [...dup].filter(([, v]) => v > 1).length);
  const rule = []; for (let d = 0; d < div.count; d++) if (nm.kind[d] === 'rule' && div.kinds[d] === LAND) rule.push(nm.names[d]);
  console.log('rule names, e.g.:', rule.filter((_, i) => i % Math.ceil(rule.length / 24) === 0).join(' | '));
  console.log('longest:', [...rule].sort((a, b) => b.length - a.length).slice(0, 5).join(' | '));
  { const depth = n => (n.split(' ')[0].match(/(Северо|Юго|Восточно|Западно|Центрально|Южно)-/g) || []).length; const h = {}; for (const n of rule) { const k = depth(n); h[k] = (h[k] || 0) + 1; } console.log('rule depth (prefixes):', JSON.stringify(h)); const byP = {}; for (let d = 0; d < div.count; d++) if (nm.kind[d] === 'rule' && div.kinds[d] === LAND) { const p = div.provinces[div.province[d]].name; byP[p] = (byP[p] || 0) + 1; } console.log('rule names by province:', Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, v]) => p + ' ' + v).join(', ')); }
  const hist = []; for (let d = 0; d < div.count; d++) if (nm.kind[d] === 'history') hist.push(nm.names[d]); console.log('historical:', hist.length, hist.join(', '));
  const water = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] !== LAND) water.push(nm.names[d]); console.log('water e.g.:', water.filter((_, i) => i % 60 === 0).join(' | '));
}
if (process.argv.includes('--provinces')) {
  const area = new Float64Array(div.provinceCount), nd = new Int32Array(div.provinceCount);
  for (const d of div.cells) if (d >= 0 && div.kinds[d] === LAND) area[div.province[d]]++;
  for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) nd[div.province[d]]++;
  const rows = []; for (let p = 0; p < div.provinceCount; p++) if (div.provinces[p].kind === LAND) rows.push([div.provinces[p].name, area[p], nd[p], div.regions[div.region[p]].name, div.provinces[p].land]);
  rows.sort((a, b) => b[1] - a[1]); const med = rows[rows.length >> 1][1];
  console.log(`land provinces ${rows.length}, middle ${Math.round(med)} km²`);
  for (const r of rows.slice(0, 22)) console.log(`${r[0]} — ${Math.round(r[1])} km², ${r[2]} districts, ${(r[1] / med).toFixed(1)}× (${r[4]}, ${r[3]})`);
}
