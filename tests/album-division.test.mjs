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
import { KN as RASTER, KKM, cellsOfChunks } from '../src/album/division/km.js';
import { districtCells, riverRaster, cellStats, RIVER_TOLL, SMOOTH_KM } from '../src/album/division/cells.js';
import { borderLines } from '../src/album/division/lines.js';
import { nearestPiece, districtByLines, outlineOf, NEAR_KM, PIECE_KM } from '../src/album/division/border.js';
import { seedOf, chunkSettle, kmFacts, SETTLE_WHY, SETTLE_CAN } from '../src/album/division/km.js';
import { districtCentres, MERGE_KM, SEAT } from '../src/album/division/centres.js';
import { nameDistricts, sideName, genderOf, splitBySides } from '../src/album/division/names.js';
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
  const s = districtSummary(div, d, ch), TN = RASTER * RASTER;
  // a district is its chunks of 1 km²: its area is their number; what the natural cells keep goes to it by the share
  // of each cell's chunks that lie in it
  let own = 0; for (let t = 0; t < TN; t++) if (div.cells[t] === d) own++;
  assert.equal(s.chunks, own); assert.equal(s.area, own); assert.equal(s.landArea, own); assert.equal(s.cells, list.length);
  assert.ok(own > 400 && own < 1500, 'a district of 30 km has ' + own + ' chunks');
  assert.equal(s.kind, 'land'); assert.equal(s.provinceName, 'Запад'); assert.equal(s.regionName, 'Западная земля');
  assert.ok(s.share.forest >= .5 - .01 && s.share.forest < .75, 'half of the forest of its cells stands, all of it in the neighbours\' cells its outline takes in: ' + s.share.forest.toFixed(2));
  assert.deepEqual(s.sums.map(x => x.name), ['iron'], 'only layers with sum: true are summed');
  assert.ok(s.sums[0].value > 2 * list.length * .6 && s.sums[0].value <= 2 * list.length + 1e-6, 'iron of the district: ' + s.sums[0].value.toFixed(1) + ' of ' + 2 * list.length);
  let all = 0; for (let dd = 0; dd < div.count; dd++) all += districtSummary(div, dd, ch).sums[0].value;
  assert.ok(Math.abs(all - 2 * list.length) < 1e-6, 'nothing is lost between districts: ' + all);
  assert.equal(s.classes.reduce((x, y) => x + y, 0), own); assert.equal(s.living.reduce((x, y) => x + y, 0), own); assert.equal(s.classes[0], 0, 'a land district has no chunk of water');
  const sea = districtSummary(div, div.district[ch.at(38.5, -8)], ch); assert.equal(sea.kind, 'sea'); assert.equal(sea.classes, null); assert.equal(sea.landArea, 0); assert.ok(sea.chunks > 100);
  ch.reset();
  // the texture: the district of every chunk of 1 km², then a texel per district
  const mask = stateMask(div, madeLands, 'x'), rows = {}, a = packDivision(ch, div, mask, null, null, rows), g = div.geo;
  assert.equal(rows.L0, RASTER + Math.ceil(div.count / RASTER)); assert.equal(rows.S0, rows.L0 + Math.ceil(g.list.length / 4 / RASTER));
  assert.equal(a.length, RASTER * (rows.S0 + Math.ceil(g.count / RASTER)) * 4);
  for (let t = 0; t < TN; t += 4999) assert.equal(a[t * 4], Math.max(0, div.cells[t]));
  // the border pieces near every square, and the pieces themselves: the start as float bits, the end as an offset in
  // steps of 6 cm
  for (let t = 0; t < TN; t += 97) { const b = a[t * 4 + 2]; assert.equal(b & 0xFFFFFF, g.num[t] ? g.first[t] : 0); assert.equal(b >>> 24, g.num[t]); }
  const f32 = new Float32Array(a.buffer);
  for (let s = 0; s < g.count; s += 37) {
    const o = (rows.S0 * RASTER + s) * 4, dx = ((a[o + 2] & 65535) / 65535 - .5) * 2 * PIECE_KM, dy = ((a[o + 2] >>> 16) / 65535 - .5) * 2 * PIECE_KM;
    assert.ok(Math.abs(f32[o] - g.seg[s * 4]) < 1e-3 && Math.abs(f32[o + 1] - g.seg[s * 4 + 1]) < 1e-3, 'the start of a piece');
    assert.ok(Math.abs(f32[o] + dx - g.seg[s * 4 + 2]) < 1e-3 && Math.abs(f32[o + 1] + dy - g.seg[s * 4 + 3]) < 1e-3, 'the end of a piece, within a metre');
    assert.equal(a[o + 3], g.lab[s]);
  }
  for (let dd = 0; dd < div.count; dd++) {
    const o = (TN + dd) * 4, p = div.province[dd], first = div.chunks[dd][0];
    assert.equal(a[o] & 65535, dd); assert.equal(a[o] >>> 16, p); assert.equal(a[o + 1] & 65535, div.region[p]);
    assert.equal((a[o + 1] >>> 16 >> 9) & 3, div.kinds[dd]);
    assert.equal(a[o + 3] >>> 16, mask[first], 'the state bit');
  }
  for (let k = 0; k < ch.count; k += 97) assert.equal(mask[k], div.kind[k] === LAND && div.province[div.district[k]] >= 1 && div.province[div.district[k]] <= 2 ? 1 : 0);
});

test('division: the outlines of districts — texel by texel, inside their province, along the river, rounded', () => {
  // a river runs east–west across the western land, a third of the way up
  const { ch, opts } = made, yR = IY0 + (IY1 - IY0) / 3, TN = RASTER * RASTER;
  const river = [{ rank: 5, pts: Array.from({ length: 60 }, (_, i) => { const p = llOf(IX0 + 10 + i * (RX - 40 - IX0) / 59, yR + Math.sin(i * .4) * 3); return [p.lon, p.lat]; }) }];
  const plain = buildDivision(ch, { ...opts, size: 30 }), div = buildDivision(ch, { ...opts, size: 30, rivers: river });
  assert.equal(div.cells.length, TN); assert.deepEqual(buildDivision(ch, { ...opts, size: 30, rivers: river }).cells, div.cells, 'the same land gives the same outlines');
  // every texel lies in a district of the kind and of the province of its chunk; every district has texels
  const texels = new Int32Array(div.count);
  const kc = cellsOfChunks(ch).cell;
  for (let t = 0; t < TN; t++) {
    const k = kc[t]; if (k >= ch.count) continue;
    const d = div.cells[t], dk = div.district[k];
    assert.ok(d >= 0 && d < div.count); texels[d]++;
    if (d !== dk) assert.equal(div.kinds[d] === LAND, div.kinds[dk] === LAND, 'land stays land, water stays water');
    if (div.kinds[d] === LAND) assert.equal(div.province[d], div.provCells[t], 'a district never leaves its province as it is drawn');
    else assert.equal(div.provCells[t], -1);
  }
  // the borders of the provinces are straightened: a little land changes hands, no province falls apart or shrinks much
  { const parts = P => { const seen = new Uint8Array(TN), out = new Map(); for (let s0 = 0; s0 < TN; s0++) { const p = P[s0]; if (p < 0 || seen[s0]) continue; out.set(p, (out.get(p) || 0) + 1); const st = [s0]; seen[s0] = 1;
        while (st.length) { const t = st.pop(), x = t % RASTER; for (const u of [x > 0 ? t - 1 : -1, x < RASTER - 1 ? t + 1 : -1, t - RASTER, t + RASTER]) if (u >= 0 && u < TN && !seen[u] && P[u] === p) { seen[u] = 1; st.push(u); } } } return out; };
    const a0 = parts(div.provChunks), a1 = parts(div.provCells); for (const [p, c] of a1) assert.ok(c <= a0.get(p), 'province ' + p + ' is in as many pieces as before');
    let land = 0, moved = 0, s0 = 0, s1 = 0; const size0 = new Map(), size1 = new Map();
    for (let t = 0; t < TN; t++) { const p = div.provChunks[t], q = div.provCells[t]; assert.equal(p < 0, q < 0, 'the shore does not move'); if (p < 0) continue; land++; if (p !== q) moved++; size0.set(p, (size0.get(p) || 0) + 1); size1.set(q, (size1.get(q) || 0) + 1);
      if (t % RASTER < RASTER - 1) { const u = t + 1; if (div.provChunks[u] >= 0 && div.provChunks[u] !== p) s0++; if (div.provCells[u] >= 0 && div.provCells[u] !== q) s1++; } }
    assert.ok(moved > 0 && moved / land < .1, (moved / land * 100).toFixed(1) + ' % of the land changed province');
    for (const [p, c] of size0) assert.ok(size1.get(p) > c * .7, 'province ' + p + ' keeps its land');
    assert.ok(s1 <= s0, 'the borders are no longer than the outlines of chunks: ' + s1 + ' against ' + s0);
    assert.ok(SMOOTH_KM >= 3 && SMOOTH_KM <= 7); }
  for (let d = 0; d < div.count; d++) assert.ok(texels[d] > 0, 'district ' + d + ' has land of its own');
  // sizes stay close to those of the chunk partition
  const land = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) land.push(texels[d] * KKM * KKM); land.sort((a, b) => a - b);
  assert.ok(land[land.length >> 1] > 500 && land[land.length >> 1] < 1400, 'a district of 30 km is ' + Math.round(land[land.length >> 1]) + ' km² in the middle');
  // the river is a border: far more of it runs along the outlines than without it, and the outlines are rounded
  const riv = riverRaster(river), along = lab => { let on = 0, all = 0;
    for (let ty = 1; ty < RASTER - 1; ty++) for (let tx = 1; tx < RASTER - 1; tx++) { const t = ty * RASTER + tx; if (!riv[t] || div.kinds[lab[t]] !== LAND) continue; all++;
      let edge = false; for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (lab[t + dy * RASTER + dx] !== lab[t]) { edge = true; break; } if (edge) on++; }
    return on / all; };
  assert.ok(along(div.cells) > .85, 'the river runs along borders for ' + Math.round(along(div.cells) * 100) + ' % of its way');
  assert.ok(along(div.cells) > along(plain.cells) + .2, 'without the river the outlines do not follow its line');
  assert.ok(cellStats(div, div.cells, riv).roundMid > .55, 'rounded outlines');
  assert.ok(RIVER_TOLL[3] > RIVER_TOLL[2] && RIVER_TOLL[2] > RIVER_TOLL[1] && RIVER_TOLL[1] > 5);
  // a border that runs beside the river is drawn on the river itself
  const lines = borderLines(ch, div, null, river); let near = 0, onIt = 0;
  for (const line of lines[0] || []) for (const [x, y] of line) {
    if (x < IX0 + 15 || x > RX - 50 || Math.abs(y - yR) > 4.5) continue; near++;
    let best = 1e9; for (let i = 1; i < river[0].pts.length; i++) { const a = kmOf(river[0].pts[i - 1][1], river[0].pts[i - 1][0]), b = kmOf(river[0].pts[i][1], river[0].pts[i][0]), dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); best = Math.min(best, Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u)); }
    if (best < .7) onIt++;
  }
  assert.ok(near > 20 && onIt / near > .8, onIt + ' of ' + near + ' points of the border by the river lie on it');
});

// The one shape of a border (the owner, 13.11.2026: the outline of a district and the light under the cursor must be
// of one shape): what the shader fills, what the cursor finds and what the chunks hold all follow the lines drawn.
function checkOneShape(div, step = 3) {
  const g = div.geo, by = (x, y, w) => districtByLines(g, div.cells, div.kinds, x, y, w);
  // just off a piece of line, on either side, lies the district the line names on that side
  let n = 0, bad = 0;
  for (let s = 0; s < g.count; s += step) {
    const ax = g.seg[s * 4], ay = g.seg[s * 4 + 1], dx = g.seg[s * 4 + 2] - ax, dy = g.seg[s * 4 + 3] - ay, L = Math.hypot(dx, dy); if (L < .1) continue;
    for (const side of [1, -1]) {
      const x = ax + dx / 2 - dy / L * side * .03, y = ay + dy / 2 + dx / L * side * .03, got = by(x, y, g.key[s] & 1); if (got < 0) continue;
      n++; if (got !== (side > 0 ? g.lab[s] & 0xFFFF : g.lab[s] >>> 16)) bad++;
    }
  }
  assert.ok(n > 400 && bad / n < .01, `the fill follows the lines: ${bad} of ${n} points just off a line are in another district`);
  // every chunk belongs to the district its seed lies in by the lines; no district is left without chunks
  let wrong = 0, all = 0; const num = new Int32Array(div.count);
  for (let t = 0; t < RASTER * RASTER; t++) {
    const d = div.cells[t]; if (d < 0) continue; num[d]++;
    if (!g.num[t]) continue;
    const [sx, sy] = seedOf(t % RASTER, Math.floor(t / RASTER)), r = nearestPiece(g, sx, sy, div.kinds[d] === LAND ? 0 : 1);
    if (!r || r.dist > NEAR_KM || r.lone) continue;
    all++; if (r.d !== d) wrong++;
  }
  assert.equal(wrong, 0, `chunks in the district their seed lies in (${all} near a line)`);
  for (let d = 0; d < div.count; d++) assert.ok(num[d] > 0, `district ${d} keeps chunks`);
  return { n, bad };
}

test('division: one shape — the fill, the cursor and the chunks follow the border lines; the outline of a district', () => {
  const { ch, opts } = made, yR = IY0 + (IY1 - IY0) / 3;
  const river = [{ rank: 5, pts: Array.from({ length: 60 }, (_, i) => { const p = llOf(IX0 + 10 + i * (RX - 40 - IX0) / 59, yR + Math.sin(i * .4) * 3); return [p.lon, p.lat]; }) }];
  const div = buildDivision(ch, { ...opts, size: 30, rivers: river });
  checkOneShape(div, 1);
  // the outline of an inland district is one closed line, made of the very points of the border lines
  const d = div.cells[Math.floor((kmOf(41, -4.5)[1] - 3880)) * RASTER + Math.floor(kmOf(41, -4.5)[0] + 880)], ol = outlineOf(div.geo, d);
  assert.ok(div.kinds[d] === LAND && ol.length === 1, 'one outline, ' + ol.length);
  const o = ol[0]; assert.ok(o.length > 20 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1], 'it closes on itself');
  const pts = new Set(div.geo.lines.flatMap(L => L.pts.map(p => p.join(','))));
  assert.ok(o.every(p => pts.has(p.join(','))), 'every point of the outline is a point of a border line');
  // a district under the cursor at a point inside its outline
  const x = o.reduce((s, p) => s + p[0], 0) / o.length, y = o.reduce((s, p) => s + p[1], 0) / o.length;
  assert.equal(districtByLines(div.geo, div.cells, div.kinds, x, y, 0), d);
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
  checkOneShape(div, 7);
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
    [42.51, 1.52, 'andorra'], [39.72, 2.91, 'mallorca'], [35.77, -5.80, 'tangier'], [36.75, 3.06, 'alger']]) {
    assert.equal(provAt(lat, lon), id, `${lat}, ${lon}`);
    const [x, y] = kmOf(lat, lon), t = Math.floor((y - 3880) / KKM) * RASTER + Math.floor((x + 880) / KKM);      // … and as the province is drawn, chunk by chunk
    assert.equal(LANDS.provinces[real.div.provCells[t]]?.id, id, `${lat}, ${lon}: the straightened border keeps the place`);
  }
  // across the crests: Gavarnie (north) and Torla (south) of the Pyrenees, Covadonga and Riaño of the Cantabrian
  // range, Cercedilla and El Espinar of the Guadarrama
  for (const [lat, lon, land, region] of [[42.73, -0.01, 'guyenne', 'westeurope'], [42.62, -0.11, 'ebro', 'iberia'], [43.31, -5.06, 'galicia', 'iberia'], [42.97, -5.02, 'duero', 'iberia'], [40.74, -4.06, 'newcastile', 'iberia'], [40.72, -4.25, 'duero', 'iberia']]) {
    const p = provinceOfChunk(real.div, real.ch.at(lat, lon));
    assert.equal(LANDS.provinces[p].land, land, `${lat}, ${lon}`);
    assert.equal(LANDS.regions[real.div.region[p]].id, region, `${lat}, ${lon}: region`);
  }
  // the regions are the great lands: Iberia whole, the south of Western Europe, the Maghreb
  assert.deepEqual(LANDS.regions.map(r => r.id), ['iberia', 'westeurope', 'maghreb']);
  for (const [lat, lon, region] of [[38.72, -9.14, 'iberia'], [39.72, 2.91, 'iberia'], [42.51, 1.52, 'iberia'], [43.60, 1.44, 'westeurope'], [35.77, -5.80, 'maghreb']])
    assert.equal(LANDS.regions[real.div.region[provinceOfChunk(real.div, real.ch.at(lat, lon))]].id, region, `${lat}, ${lon}`);
  // districts of about 20 km: 400–500 km² in the middle
  { const d20 = buildDivision(real.ch, { ...real.opts, size: 20 }), a = []; for (let d = 0; d < d20.count; d++) if (d20.kinds[d] === LAND) a.push(d20.area[d]);
    a.sort((x, y) => x - y); const mid = a[a.length >> 1];
    assert.ok(mid > 330 && mid < 520, `a district of the 20 km division is ${Math.round(mid)} km² in the middle`);
    assert.ok(a[Math.floor(a.length * .9)] / a[Math.floor(a.length * .1)] < 3.2, 'districts are all of about one size'); }
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
      n++; if (LANDS.provinces[provinceOfChunk(div, k1)].land === LANDS.provinces[provinceOfChunk(div, k2)].land) same++;
    }
    assert.ok(n > 20 && same / n > .9, `${name}: both banks in one historical land at ${same} of ${n} points`);
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

test('division of the album: the seas are real seas, divided into zones and districts', { skip }, () => {
  const { ch, div } = real, seaName = k => LANDS.seas[div.seaOf[k]]?.name;
  for (const [lat, lon, name] of [[43.6, -3.8, 'Бискайский залив'], [43.0, -9.6, 'Атлантический океан у Галисии и Португалии'], [38.5, -9.6, 'Атлантический океан у Галисии и Португалии'],
    [36.6, -7.0, 'Кадисский залив'], [35.97, -5.6, 'Гибралтарский пролив'], [36.1, -4.0, 'Море Альборан'], [40.5, 1.5, 'Балеарское море'], [43.0, 4.0, 'Лионский залив'], [37.5, 2.0, 'Алжиро-Прованский бассейн']]) {
    const k = ch.at(lat, lon);
    assert.equal(div.kind[k], SEA, `${lat}, ${lon} is sea`); assert.equal(seaName(k), name, `${lat}, ${lon}`);
  }
  // every sea hangs together; a sea district lies in one sea; its zone and region are that sea's
  for (let s = 0; s < LANDS.seas.length; s++) {
    const list = []; for (let k = 0; k < ch.count; k++) if (div.seaOf[k] === s) list.push(k);
    assert.ok(list.length, LANDS.seas[s].name);
    const inS = new Set(list), q = [list[0]], got = new Set(q);
    for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (inS.has(l.k) && !got.has(l.k)) { got.add(l.k); q.push(l.k); }
    assert.equal(got.size, list.length, `${LANDS.seas[s].name} hangs together`);
  }
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== SEA) continue;
    const seasOf = new Set(div.chunks[d].map(k => div.seaOf[k]));
    assert.equal(seasOf.size, 1, `sea district ${d} lies in one sea`);
    const s = [...seasOf][0], p = div.provinces[div.province[d]];
    assert.equal(p.sea, s); assert.equal(div.regions[div.region[div.province[d]]].name, LANDS.seas[s].name);
    assert.ok(p.name === LANDS.seas[s].name || (p.name.startsWith(`${LANDS.seas[s].name}, зона `) && /\d$/.test(p.name)), p.name);
  }
  for (let k = 0; k < ch.count; k++) if (div.kind[k] !== SEA) assert.equal(div.seaOf[k], -1, 'land and lakes have no sea');
});

// ---- the places of towns, where nobody can settle, the names (13.11.2026, the owner's review of the new map)
test('division: the names by the rule of the sides of the world — gender, nesting', () => {
  assert.equal(sideName(['N'], 'Дакота', 'f'), 'Северная Дакота');
  assert.equal(sideName(['N', 'SE'], 'Дакота', 'f'), 'Юго-Восточно-Северная Дакота', 'the example of the owner');
  assert.equal(sideName(['C'], 'Арагон', genderOf('Арагон')), 'Центральный Арагон');
  assert.equal(sideName(['S'], 'Толедо', genderOf('Толедо')), 'Южное Толедо');
  assert.equal(sideName(['W'], 'Урхель и Пальярс', genderOf('Урхель и Пальярс')), 'Западные Урхель и Пальярс');
  assert.equal(genderOf('Ла-Манча'), 'f'); assert.equal(genderOf('Сердань', 'cerdanya'), 'f'); assert.equal(genderOf('Ланды', 'landes'), 'p');
  // a part that holds several is split again from its own middle; every point gets a way of its own
  const pts = Array.from({ length: 40 }, (_, i) => ({ d: i, x: Math.cos(i * 2.4) * (5 + i), y: Math.sin(i * 2.4) * (5 + i) })), m = splitBySides(pts, 0, 0, 25);
  assert.equal(new Set([...m.values()].map(s => s.join('-'))).size, 40, 'forty different names');
});

const settleOf = real ? (() => {
  const wetlands = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/swamp/wetlands.json'), 'utf8')).wetlands;
  return chunkSettle(real.div, kmFacts(real.div, data.base.at), { wetlands });
})() : null;
const squareAt = (div, lat, lon) => { const [x, y] = kmOf(lat, lon); return Math.floor(y - 3880) * RASTER + Math.floor(x + 880); };

test('division of the album: where nobody can settle — the sea, mountains, high ground, bogs; with the reason', { skip }, () => {
  const { div } = real, why = (lat, lon) => SETTLE_WHY[settleOf.why[squareAt(div, lat, lon)]];
  assert.equal(why(40.0, 1.5), 'вода');
  assert.equal(why(42.631, .657), 'высокогорье: скалы, снег и лёд', 'Aneto');
  assert.equal(why(37.0, -6.3), 'болото', 'the marshes of the Guadalquivir');
  for (const [lat, lon, name] of [[41.65, -.88, 'Zaragoza'], [39.47, -.376, 'Valencia'], [40.0, -3.4, 'La Mancha'], [37.39, -5.98, 'Seville']]) assert.equal(settleOf.can[squareAt(div, lat, lon)], 2, name);
  // the high Pyrenees: most of it nobody can live on
  let no = 0, n = 0; for (let lat = 42.55; lat <= 42.75; lat += .02) for (let lon = 0; lon <= 1; lon += .02) { n++; if (settleOf.can[squareAt(div, lat, lon)] === 0) no++; }
  assert.ok(no / n > .4, `the high Pyrenees: ${no} of ${n} chunks nobody can live on`);
  for (let c = 0; c < settleOf.why.length; c += 101) assert.equal(settleOf.can[c], SETTLE_CAN[settleOf.why[c]]);
});

test('division of the album: one place of a town a district — real towns where they are, the rest by the rule; seats', { skip }, () => {
  const { div } = real, sites = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const cen = districtCentres(div, sites, { settle: settleOf }), of = (lat, lon) => div.cells[squareAt(div, lat, lon)];
  for (const [lat, lon, name] of [[39.47, -.376, 'Валенсия'], [41.385, 2.18, 'Барселона'], [36.72, -4.42, 'Малага'], [41.65, -.88, 'Сарагоса'], [37.39, -5.98, 'Севилья']])
    assert.equal(sites[cen.site[of(lat, lon)]]?.name, name, `the town of the district of ${name}`);
  // every land district has its place, on a chunk of its own, where people can live
  let n = 0, onOwn = 0, close = 0; const pts = [];
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== LAND) { assert.equal(cen.texel[d], -1); continue; }
    n++; assert.ok(cen.texel[d] >= 0, 'district ' + d + ' has a place'); if (div.cells[cen.texel[d]] === d) onOwn++;
    if (cen.site[d] < 0 && cen.why[d] < 7) assert.ok(settleOf.can[cen.texel[d]] > 0, 'a place by the rule stands where people can live');
    pts.push([cen.x[d], cen.y[d]]);
  }
  assert.equal(onOwn, n, 'every place on a chunk of its district');
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < MERGE_KM) close++;
  assert.ok(close <= 3, `towns of neighbouring districts do not stand together: ${close} pairs closer than ${MERGE_KM} km`);
  assert.deepEqual(districtCentres(div, sites, { settle: settleOf }).texel, cen.texel, 'the same places every time');
  // the districts with no real town: low in the district, never on a top (this division has no rivers: the place by the
  // water and the river is looked at in scripts/album/division-check.mjs)
  const hs = Array.from({ length: div.count }, () => []); for (let t = 0; t < div.cells.length; t++) { const d = div.cells[t]; if (d >= 0 && div.kinds[d] === LAND) hs[d].push(div.raster.hgt[t]); }
  let rule = 0, low = 0; for (let d = 0; d < div.count; d++) if (cen.texel[d] >= 0 && cen.why[d] > 0) { rule++; const h = hs[d].sort((a, b) => a - b); if (div.raster.hgt[cen.texel[d]] <= h[h.length >> 1]) low++; }
  assert.ok(rule > 100 && low / rule > .8, `${low} of ${rule} places by the rule lie in the lower half of their district`);
  // seats: the biggest town of a region, a historical land, a province
  const name = d => sites[cen.site[d]]?.name;
  assert.equal(name(cen.seats.region[LANDS.regions.findIndex(r => r.id === 'iberia')]), 'Мадрид');
  assert.equal(name(cen.seats.land.get('Каталония')), 'Барселона');
  assert.ok(cen.seat[of(41.65, -.88)] & SEAT.province, 'Zaragoza holds the seat of its province');
  for (let p = 0; p < LANDS.provinces.length; p++) assert.ok(cen.seats.province[p] >= 0, 'a seat for ' + LANDS.provinces[p].name);
});

test('division of the album: every district and province has a name; historical first, then the sides of the world', { skip }, () => {
  const { div } = real, sites = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const d0 = { ...div, centres: districtCentres(div, sites, { settle: settleOf }) }, nm = nameDistricts(d0, sites, LANDS);
  for (let d = 0; d < div.count; d++) { assert.ok(nm.names[d] && !/№/.test(nm.names[d]), 'district ' + d + ': ' + nm.names[d]); assert.ok(['history', 'place', 'village', 'shore', 'rule'].includes(nm.kind[d])); }
  for (let p = 0; p < div.provinceCount; p++) assert.ok(div.provinces[p].name, 'province ' + p);
  const key = new Map(); nm.names.forEach((nmd, d) => { const k = div.province[d] + '|' + nmd; assert.ok(!key.has(k), 'one name once in a province: ' + nmd); key.set(k, d); });
  // a rule name is a side of the world and the name of its province
  for (let d = 0; d < div.count; d++) if (nm.kind[d] === 'rule' && div.kinds[d] === LAND) assert.ok(nm.names[d].includes(div.provinces[div.province[d]].name), nm.names[d]);
  const of = (lat, lon) => div.cells[squareAt(div, lat, lon)];
  assert.equal(nm.names[of(41.55, -.25)], 'Монегрос'); assert.equal(nm.kind[of(41.55, -.25)], 'history');
  assert.equal(nm.names[of(39.47, -.376)], 'Валенсия', 'a district of a big city is called after it');
});
