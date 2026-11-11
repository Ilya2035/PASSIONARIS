// The division of the album into historical lands (docs/album/division.md): chunks → districts → provinces →
// regions, on land, in lakes and at sea, on the graph of chunks (ch.links). On a small made-up world, and on the
// album's real data when public/album-data/ is there (it is not in git: scripts/album/fetch-data.mjs; the worktree
// setup copies it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { BBOX } from '../src/album/geo.js';
import { buildDivision, districtSummary, districtNames, stateMask, linkRelief, LAND, SEA, LAKE } from '../src/album/division/build.js';
import { packDivision } from '../src/album/division/gpu.js';
import { borderLines } from '../src/album/division/lines.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import division, { STATES } from '../src/album/aspects/division.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANDS = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division/lands.json'), 'utf8'));
const ADMIN = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division/admin.json'), 'utf8'));

// every chunk in exactly one district; every district connected over chunk borders, of one kind, inside one province
function checkWhole(ch, div) {
  assert.equal(div.district.length, ch.count);
  const seen = new Int32Array(div.count);
  for (let k = 0; k < ch.count; k++) { const d = div.district[k]; assert.ok(d >= 0 && d < div.count, `chunk ${k} has a district`); seen[d]++; }
  for (let d = 0; d < div.count; d++) {
    assert.ok(seen[d] > 0, `district ${d} has chunks`);
    const list = div.chunks[d], inD = new Set(list), q = [list[0]], got = new Set(q);
    for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (inD.has(l.k) && !got.has(l.k)) { got.add(l.k); q.push(l.k); }
    assert.equal(got.size, list.length, `district ${d} hangs together over chunk borders`);
    for (const k of list) assert.equal(div.kind[k], div.kinds[d], `district ${d} is all one kind`);
    assert.ok(div.province[d] >= 0 && div.province[d] < div.provinceCount, `district ${d} lies in a province`);
    assert.ok(div.region[div.province[d]] >= 0 && div.region[div.province[d]] < div.regionCount);
    assert.ok(Math.abs(list.reduce((s, k) => s + ch.area[k], 0) - div.area[d]) < 1e-6, 'the area of a district is the sum of its chunks');
  }
}
const provinceOfChunk = (div, k) => div.province[div.district[k]];

// ---- a small made-up world: an island cut by a north–south ridge; west of it one land, east of it a unit two lands
// grew from (a northern and a southern one); a lake in the west
const [IX0, IY0] = kmOf(39, -6), [IX1, IY1] = kmOf(42, -1), RX = (IX0 + IX1) / 2;
function madeUpHeight(lat, lon) {
  const [x, y] = kmOf(lat, lon);
  if (x < IX0 || x > IX1 || y < IY0 || y > IY1) return -100;
  if (Math.hypot(x - (IX0 + 60), y - (IY1 - 60)) < 14) return -5;                 // a lake
  return 300 + Math.max(0, 1600 - Math.abs(x - RX) * 40);                        // a ridge along the middle
}
const llBox = (x0, y0, x1, y1) => { const a = llOf(x0, y0), b = llOf(x1, y1); return [[a.lon, a.lat], [b.lon, a.lat], [b.lon, b.lat], [a.lon, b.lat], [a.lon, a.lat]]; };
const madeAdmin = { units: { W: { name: 'Запад', rings: [llBox(IX0 - 30, IY0 - 30, RX + 25, IY1 + 30)] }, E: { name: 'Восток', rings: [llBox(RX + 25, IY0 - 30, IX1 + 30, IY1 + 30)] } } };
const centreLL = (x, y) => { const p = llOf(x, y); return [p.lat, p.lon]; };
const madeLands = {
  regions: [{ id: 'west', name: 'Западная земля' }, { id: 'east', name: 'Восточная земля' }],
  provinces: [
    { id: 'w', name: 'Запад', region: 'west', admin: ['W'], at: [centreLL(IX0 + 100, (IY0 + IY1) / 2)] },
    { id: 'en', name: 'Северо-восток', region: 'east', admin: ['E'], at: [centreLL(IX1 - 80, IY1 - 60)] },
    { id: 'es', name: 'Юго-восток', region: 'east', admin: ['E'], at: [centreLL(IX1 - 80, IY0 + 60)] },
  ],
  seas: [{ id: 's', name: 'Море', at: [centreLL(IX0 - 100, IY0 - 100)] }],
  states: [{ id: 'x', name: 'Восточное королевство', provinces: ['en', 'es'] }],
};
const made = (() => { const ch = new Chunks(madeUpHeight, []); return { ch, opts: { lands: madeLands, admin: madeAdmin, heightAt: madeUpHeight, lakes: [] } }; })();

test('division: a made-up world — whole chunks, districts inside lands, the ridge a border, reproducible', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 });
  checkWhole(ch, div);
  assert.equal(div.provinces.filter(p => p.kind === LAND).length, 3);
  // the ridge divides west from east: every land chunk west of it in the western land, east of it in an eastern one
  let wrong = 0, n = 0;
  for (let k = 0; k < ch.count; k++) {
    if (div.kind[k] !== LAND || Math.abs(ch.cx[k] - RX) < 40) continue;
    n++; const p = provinceOfChunk(div, k);
    if ((ch.cx[k] < RX) !== (p === 0)) wrong++;
  }
  assert.ok(n > 100 && wrong === 0, `the slopes keep to their side of the ridge (${wrong} wrong of ${n})`);
  // the unit two lands grew from is shared between them, each around its anchor
  const at = (i, j) => provinceOfChunk(div, ch.at(...madeLands.provinces[i].at[j]));
  assert.equal(at(1, 0), 1); assert.equal(at(2, 0), 2);
  const lake = new Set(); for (let k = 0; k < ch.count; k++) if (div.kind[k] === LAKE) lake.add(div.district[k]);
  assert.equal(lake.size, 1, 'the lake is one district');
  assert.equal(div.provinces[div.province[[...lake][0]]].kind, LAND, 'a lake lies in a land province');
  const again = buildDivision(ch, { ...opts, size: 30 });
  assert.deepEqual(again.district, div.district, 'the same chunks give the same division');
  assert.deepEqual(again.province, div.province);
});

test('division: what a district holds; the texture with the state of history', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 });
  const k0 = ch.at(...madeLands.provinces[0].at[0]), d = div.district[k0], list = div.chunks[d];
  const iron = ch.layer('iron', { title: 'Железо', unit: 'т', sum: true }), quiet = ch.layer('note', { sum: false });
  for (const k of list) { iron.data[k] = 2; quiet.data[k] = 9; ch.set('forest', k, .5); }
  const s = districtSummary(div, d, ch);
  assert.equal(s.chunks, list.length); assert.equal(s.kind, 'land'); assert.equal(s.provinceName, 'Запад'); assert.equal(s.regionName, 'Западная земля');
  assert.ok(Math.abs(s.share.forest - .5) < .01);
  assert.deepEqual(s.sums.map(x => [x.name, x.value]), [['iron', 2 * list.length]], 'only layers with sum: true are summed');
  ch.reset();
  const mask = stateMask(div, madeLands, 'x'), a = packDivision(ch, div, mask);
  assert.equal(a.length, ch.palW * ch.palW * 4);
  for (let k = 0; k < ch.count; k += 97) {
    const dd = div.district[k], p = div.province[dd];
    assert.equal(a[k * 4] & 65535, dd); assert.equal(a[k * 4] >>> 16, p); assert.equal(a[k * 4 + 1] & 65535, div.region[p]);
    assert.equal((a[k * 4 + 1] >>> 16 >> 9) & 3, div.kinds[dd]);
    assert.equal(a[k * 4 + 3] >>> 16, mask[k], 'the state bit');
    assert.equal(mask[k], div.kind[k] === LAND && p >= 1 && p <= 2 ? 1 : 0);
  }
});

test('division: border lines for the far view — between lands, never along the shore, smooth', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 }), g = borderLines(ch, div, stateMask(div, madeLands, 'x'));
  assert.ok(g[4]?.length, 'a region border (the ridge)'); assert.ok(g[2]?.length, 'a province border'); assert.ok(g[0]?.length, 'district borders'); assert.ok(g[6]?.length, 'the state');
  // every point of a land border has land chunks of different districts on its two sides, not the sea
  let n = 0, wet = 0;
  for (const key of [0, 2, 4]) for (const line of g[key]) for (const [x, y] of line.filter((_, i) => i % 7 === 3)) {
    const p = llOf(x, y), k = ch.at(p.lat, p.lon);
    if (k >= 0) { n++; if (div.kind[k] === SEA) wet++; }
  }
  assert.ok(n > 50 && wet / n < .02, `land borders run over land (${wet} of ${n} points over the sea, at the shore)`);
  // the region border follows the ridge in the middle of the island
  const xs = g[4].flat().map(([x]) => x), onRidge = xs.filter(x => Math.abs(x - RX) < 20).length;
  assert.ok(onRidge / xs.length > .85, `the region border lies on the ridge (${onRidge} of ${xs.length} points within 20 km)`);
  // smooth: hardly a turn sharper than a right angle along the lines
  let turns = 0, sharp = 0;
  for (const key of [0, 2, 4]) for (const line of g[key]) for (let i = 1; i + 1 < line.length; i++) {
    const [a, b, c] = [line[i - 1], line[i], line[i + 1]], u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    turns++; if (u[0] * v[0] + u[1] * v[1] < 0) sharp++;
  }
  assert.ok(turns > 100 && sharp / turns < .02, `smooth lines (${sharp} sharp turns of ${turns})`);
});

test('division: the list of lands — every land in a region, every unit in admin.json, every anchor in the album', () => {
  const regions = new Set(LANDS.regions.map(r => r.id)), ids = new Set();
  for (const p of LANDS.provinces) {
    assert.ok(!ids.has(p.id), `${p.id} once`); ids.add(p.id);
    assert.ok(regions.has(p.region), `${p.name}: region`);
    assert.ok(p.name && /[а-я]/i.test(p.name), `${p.id}: a Russian name`);
    for (const u of p.admin) assert.ok(ADMIN.units[u], `${p.name}: unit ${u}`);
    for (const [lat, lon] of p.at) assert.ok(lat > BBOX.lat0 && lat < BBOX.lat1 && lon > BBOX.lon0 && lon < BBOX.lon1, `${p.name}: anchor in the album`);
  }
  for (const s of LANDS.states) for (const p of s.provinces) assert.ok(ids.has(p), `${s.name}: ${p}`);
  for (const [id] of STATES) if (id) assert.ok(LANDS.states.find(s => s.id === id), `knob state ${id}`);
});

test('division: the aspect — contract functions, one texture, knobs, pages', () => {
  assert.match(division.glsl, /void aspDivision\(Px p, inout vec3 col, float landA\)/);
  assert.match(division.glsl, /vec3 districtAt\(vec2 pk\)/);
  assert.equal(Object.values(division.uniforms).filter(u => u.value?.isTexture).length, 1, 'one texture of its own');
  assert.equal((division.glsl.match(/sampler2D/g) || []).length, 1);
  for (const k of ['division', 'divSize', 'divState', 'divLabels', 'divPick']) assert.ok(DEFS.find(d => d.key === k), `knob ${k}`);
  const page = id => PAGES.find(p => p.id === id);
  for (const id of ['mode-regions', 'mode-provinces', 'mode-districts', 'division-pyrenees', 'division-cantabrian', 'division-central', 'division-ebro', 'division-state']) assert.ok(page(id), id);
  assert.equal(page('mode-districts').p.division, 1); assert.equal(page('mode-provinces').p.division, 2); assert.equal(page('mode-regions').p.division, 3);
  assert.ok(page('division-state').p.divState, 'a page shows a state assembled from districts');
  assert.ok(Array.isArray(page('division-info').divAt), 'a page opens with a district chosen');
});

// ---- the album's real data
const data = loadAlbumData(ROOT);
const real = data ? (() => {
  const ch = new Chunks(data.base.at, data.vectors.rivers), opts = { lands: LANDS, admin: ADMIN, heightAt: data.base.at, lakes: data.vectors.lakes };
  return { ch, opts, div: buildDivision(ch, { ...opts, size: 30 }) };
})() : null;
const skip = !real && 'public/album-data/ is not there';
const provAt = (lat, lon) => LANDS.provinces[provinceOfChunk(real.div, real.ch.at(lat, lon))]?.id;

test('division of the album: whole chunks, connected districts inside historical lands, sizes', { skip }, () => {
  const { ch, div } = real;
  checkWhole(ch, div);
  const area = id => { const i = LANDS.provinces.findIndex(p => p.id === id); let a = 0; for (let d = 0; d < div.count; d++) if (div.province[d] === i) a += div.area[d]; return a; };
  for (const [id, lo, hi] of [['bierzo', 2000, 5500], ['leon', 9000, 15000], ['cerdanya', 300, 2500], ['andorra', 300, 900], ['navarra', 8500, 12000], ['zaragoza', 14000, 20000], ['algarve', 4000, 6000]])
    assert.ok(area(id) > lo && area(id) < hi, `${id}: ${Math.round(area(id))} km²`);
  // a province hangs together, unless it is islands
  for (let i = 0; i < LANDS.provinces.length; i++) {
    const list = []; for (let k = 0; k < ch.count; k++) if (div.kind[k] === LAND && provinceOfChunk(div, k) === i) list.push(k);
    if (!list.length) continue;
    const inP = new Set(list), seen = new Set(), comps = [];
    for (const s of list) { if (seen.has(s)) continue; const q = [s]; seen.add(s); for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (inP.has(l.k) && !seen.has(l.k)) { seen.add(l.k); q.push(l.k); } comps.push(q); }
    for (const c of comps.slice(1)) {
      const touchesOtherLand = c.some(k => ch.links[k].some(l => div.kind[l.k] === LAND && !inP.has(l.k)));
      const biggest = Math.max(...comps.map(x => x.length));
      assert.ok(!touchesOtherLand || c.length === biggest, `${LANDS.provinces[i].name}: a cut-off piece of ${c.length} chunks`);
    }
  }
  // districts are smaller on the lowland than in the mountains
  const med = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const low = [], high = [];
  for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) { const h = div.chunks[d].reduce((s, k) => s + ch.height[k] * ch.area[k], 0) / div.area[d]; (h < 300 ? low : h > 1100 ? high : []).push(div.area[d]); }
  assert.ok(med(low) < med(high), `lowland ${Math.round(med(low))} km² < mountains ${Math.round(med(high))} km²`);
});

test('division of the album: places lie in their historical lands; mountains divide, slopes go with their valleys', { skip }, () => {
  for (const [lat, lon, id] of [[41.65, -0.88, 'zaragoza'], [42.55, -6.60, 'bierzo'], [42.60, -5.57, 'leon'], [43.30, -0.37, 'bearn'], [43.49, -1.47, 'labourd'],
    [42.43, 1.93, 'cerdanya'], [43.60, 1.44, 'toulousain'], [43.11, 0.72, 'comminges'], [38.72, -9.14, 'lisboa'], [37.02, -7.93, 'algarve'], [37.39, -5.98, 'sevilla'],
    [42.51, 1.52, 'andorra'], [39.72, 2.91, 'mallorca'], [35.77, -5.80, 'tangier'], [36.75, 3.06, 'alger']]) assert.equal(provAt(lat, lon), id, `${lat}, ${lon}`);
  // across the crests: Gavarnie (north) and Torla (south) of the Pyrenees, Covadonga and Riaño of the Cantabrian
  // range, Cercedilla and El Espinar of the Guadarrama
  for (const [lat, lon, region] of [[42.73, -0.01, 'guyenne'], [42.62, -0.11, 'ebro'], [43.31, -5.06, 'galicia'], [42.97, -5.02, 'duero'], [40.74, -4.06, 'newcastile'], [40.72, -4.25, 'duero']]) {
    const p = provinceOfChunk(real.div, real.ch.at(lat, lon));
    assert.equal(LANDS.regions[real.div.region[p]].id, region, `${lat}, ${lon}`);
  }
  // no slope is left cut off from its own land by a ridge while it drains into another
  const { ch, div } = real, rel = linkRelief(ch, data.base.at), rel2 = (a, b) => rel.get(a < b ? a + ',' + b : b + ',' + a)?.ridge || 0;
  let stray = 0;
  for (let k = 0; k < ch.count; k++) {
    if (div.kind[k] !== LAND) continue;
    let d = -1, bh = ch.height[k] - 40;
    for (const l of ch.links[k]) if (div.kind[l.k] === LAND && ch.height[l.k] < bh) { bh = ch.height[l.k]; d = l.k; }
    if (d < 0 || provinceOfChunk(div, d) === provinceOfChunk(div, k)) continue;
    let rOwn = Infinity; for (const l of ch.links[k]) if (div.kind[l.k] === LAND && provinceOfChunk(div, l.k) === provinceOfChunk(div, k)) rOwn = Math.min(rOwn, rel2(k, l.k));
    if (rOwn >= Math.max(150, rel2(k, d) + 120) && rOwn < Infinity) stray++;
  }
  assert.ok(stray <= 2, `${stray} slopes left on the wrong side of a ridge`);
});

test('division of the album: a big lowland river is the axis of its land, not its border', { skip }, () => {
  const { ch, div } = real;
  for (const [name, lat0, lat1, lon0, lon1] of [['Эбро', 41.2, 41.9, -1.6, 0.0], ['Гвадалквивир', 37.3, 38.1, -5.9, -3.8]]) {
    let n = 0, same = 0;
    for (const r of data.vectors.rivers.filter(x => x.name === name)) for (let i = 0; i + 1 < r.pts.length; i++) {
      const [lon, lat] = r.pts[i]; if (lat < lat0 || lat > lat1 || lon < lon0 || lon > lon1) continue;
      const [ax, ay] = kmOf(lat, lon), [bx, by] = kmOf(r.pts[i + 1][1], r.pts[i + 1][0]), L = Math.hypot(bx - ax, by - ay); if (L < .5) continue;
      const nx = -(by - ay) / L * 3, ny = (bx - ax) / L * 3, p = llOf(ax + nx, ay + ny), q = llOf(ax - nx, ay - ny);
      const k1 = ch.at(p.lat, p.lon), k2 = ch.at(q.lat, q.lon); if (k1 < 0 || k2 < 0 || div.kind[k1] !== LAND || div.kind[k2] !== LAND) continue;
      n++; if (div.region[provinceOfChunk(div, k1)] === div.region[provinceOfChunk(div, k2)]) same++;
    }
    assert.ok(n > 20 && same / n > .9, `${name}: both banks in one region at ${same} of ${n} points`);
  }
});

test('division of the album: reproducible; seas named; names of districts', { skip }, () => {
  const { ch, opts, div } = real, b = buildDivision(ch, { ...opts, size: 30 });
  assert.deepEqual(div.district, b.district); assert.deepEqual(div.province, b.province);
  const seaNames = new Set(div.regions.filter(r => r.kind === SEA).map(r => r.name));
  for (const s of LANDS.seas) assert.ok(seaNames.has(s.name), s.name);
  assert.equal(div.regions[div.region[provinceOfChunk(div, ch.at(36.0, -4.0))]].name, 'Море Альборан');
  const names = districtNames(ch, div, data.vectors.places);
  assert.equal(names[div.district[ch.at(40.40, -3.69)]], 'Мадрид');
  assert.equal(new Set(names).size, names.length, 'no two districts share a name');
  for (const id of ['aragon', 'crown', 'portugal']) assert.ok(stateMask(div, LANDS, id).some(Boolean), id);
});
