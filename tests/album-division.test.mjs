// The division of the album (docs/album/division.md): chunks → districts → provinces → regions, on land, in lakes and
// at sea, on the graph of natural chunks and their borders (ch.links). On a small made-up world, and on the album's
// real data when public/album-data/ is there (it is not in git: scripts/album/fetch-data.mjs; the worktree setup
// copies it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { buildDivision, districtSummary, districtNames, levelSizes, LAND, SEA, LAKE } from '../src/album/division/build.js';
import { packDivision } from '../src/album/division/gpu.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import division from '../src/album/aspects/division.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// every chunk in exactly one district; every district connected over chunk borders and of one kind
function checkWhole(ch, div) {
  assert.equal(div.district.length, ch.count);
  const seen = new Int32Array(div.count);
  for (let k = 0; k < ch.count; k++) { const d = div.district[k]; assert.ok(d >= 0 && d < div.count, `chunk ${k} has a district`); seen[d]++; }
  for (let d = 0; d < div.count; d++) {
    assert.ok(seen[d] > 0, `district ${d} has chunks`);
    const list = div.chunks[d], inD = new Set(list), q = [list[0]], got = new Set(q);
    for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (inD.has(l.k) && !got.has(l.k)) { got.add(l.k); q.push(l.k); }
    assert.equal(got.size, list.length, `district ${d} hangs together over chunk borders`);
    const kd = div.kinds[d];
    for (const k of list) assert.equal(div.kind[k], kd, `district ${d} is all one kind`);
    assert.ok(Math.abs(list.reduce((s, k) => s + ch.area[k], 0) - div.area[d]) < 1e-6, 'the area of a district is the sum of its chunks');
  }
}
// district areas within limits, except pieces that cannot be bigger (an island, a lake)
function checkSizes(ch, div, kind, lo, hi) {
  const T = div.sizes.district ** 2;
  const piece = new Int32Array(ch.count).fill(-1), pieceArea = [];
  for (let s = 0; s < ch.count; s++) {
    if (piece[s] >= 0 || div.kind[s] !== kind) continue;
    const q = [s]; piece[s] = pieceArea.length; let a = 0;
    for (let h = 0; h < q.length; h++) { a += ch.area[q[h]]; for (const l of ch.links[q[h]]) if (piece[l.k] < 0 && div.kind[l.k] === kind) { piece[l.k] = pieceArea.length; q.push(l.k); } }
    pieceArea.push(a);
  }
  let small = 0, n = 0;
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== kind) continue;
    n++;
    assert.ok(div.area[d] <= hi * T, `district ${d}: ${Math.round(div.area[d])} km² is too big (target ${T})`);
    if (div.area[d] < lo * T && pieceArea[piece[div.chunks[d][0]]] >= lo * T) small++;
  }
  return { n, small };
}
// river borders of chunks (most of the border on a river) that are also district borders
function riverBorders(ch, div, rank) {
  let n = 0, b = 0;
  for (let a = 0; a < ch.count; a++) for (const l of ch.links[a]) if (l.k > a && l.river === rank && l.wet / l.km > .5 && div.kind[a] === LAND && div.kind[l.k] === LAND) { n++; if (div.district[a] !== div.district[l.k]) b++; }
  return { n, b };
}

// ---- a small made-up world: an island with a great river across it, a mountain block, a lake, the sea around
const [IX0, IY0] = kmOf(39, -6), [IX1, IY1] = kmOf(42, -1);
const riverY = (IY0 + IY1) / 2;
function madeUpHeight(lat, lon) {
  const [x, y] = kmOf(lat, lon);
  if (x < IX0 || x > IX1 || y < IY0 || y > IY1) return -100;
  if (Math.hypot(x - (IX0 + 60), y - (IY1 - 60)) < 14) return -5;                 // a lake inside, smaller than a district
  return 200 + (x > IX1 - 120 ? 900 : 0);
}
const madeUpRiver = { name: 'Река', rank: 5, pts: Array.from({ length: 60 }, (_, i) => { const x = IX0 - 5 + (IX1 - IX0 + 10) * i / 59, p = llOf(x, riverY + Math.sin(i / 3) * 6); return [p.lon, p.lat]; }) };
const made = (() => { const ch = new Chunks(madeUpHeight, [madeUpRiver]); return { ch, opts: { heightAt: madeUpHeight, lakes: [] } }; })();

test('division: a made-up world — whole chunks, connected districts, areas, kinds, rivers, reproducible', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 });
  checkWhole(ch, div);
  const { n, small } = checkSizes(ch, div, LAND, .3, 2.3);
  assert.ok(n > 60, `the island has many districts (${n})`);
  assert.ok(small <= n * .05, `few small districts (${small} of ${n})`);
  assert.ok(div.kinds.includes(SEA));
  const lake = new Set(); for (let k = 0; k < ch.count; k++) if (div.kind[k] === LAKE) lake.add(div.district[k]);
  assert.equal(lake.size, 1, 'the inner water is one lake district');
  const r = riverBorders(ch, div, 2);
  assert.ok(r.n > 20 && r.b / r.n > .9, `the river runs along district borders (${r.b} of ${r.n})`);
  const again = buildDivision(ch, { ...opts, size: 30 });
  assert.deepEqual(again.district, div.district, 'the same chunks give the same division');
  assert.deepEqual(again.province, div.province); assert.deepEqual(again.region, div.region);
});

test('division: provinces and regions group neighbouring districts of one kind', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 });
  for (let d = 0; d < div.count; d++) { assert.ok(div.province[d] >= 0 && div.province[d] < div.provinceCount); assert.ok(div.region[div.province[d]] >= 0 && div.region[div.province[d]] < div.regionCount); }
  assert.ok(div.provinceCount < div.count && div.regionCount <= div.provinceCount && div.regionCount >= 2);
  const cls = new Map();
  for (let d = 0; d < div.count; d++) { const c = div.kinds[d] === SEA ? 1 : 0, p = div.province[d]; if (cls.has(p)) assert.equal(cls.get(p), c, `province ${p} is all land or all sea`); cls.set(p, c); }
  for (let d = 0; d < div.count; d++) for (const e of div.neighbours[d]) assert.notEqual(div.colour.district[d], div.colour.district[e], 'neighbours never share a colour');
  const s = levelSizes(30); assert.equal(s.province, 100); assert.equal(s.region, 340);
  assert.ok(levelSizes(100).province > 100, 'provinces grow with large districts');
});

test('division: what a district holds — area, shares of the chunk state, sums of the layers; the texture', () => {
  const { ch, opts } = made, div = buildDivision(ch, { ...opts, size: 30 });
  const k0 = ch.at(40, -4), d = div.district[k0], list = div.chunks[d];
  const iron = ch.layer('iron', { title: 'Железо', unit: 'т', sum: true }), quiet = ch.layer('note', { sum: false });
  for (const k of list) { iron.data[k] = 2; quiet.data[k] = 9; ch.set('forest', k, .5); }
  const s = districtSummary(div, d, ch);
  assert.equal(s.chunks, list.length); assert.equal(s.kind, 'land');
  assert.ok(Math.abs(s.area - list.reduce((a, k) => a + ch.area[k], 0)) < 1e-6, 'area: the sum of the chunks');
  assert.ok(Math.abs(s.share.forest - .5) < .01);
  assert.deepEqual(s.sums.map(x => [x.name, x.value]), [['iron', 2 * list.length]], 'only layers with sum: true are summed');
  ch.reset();
  // one texel per chunk: district, province, region, kind
  const a = packDivision(ch, div);
  assert.equal(a.length, ch.palW * ch.palW * 4);
  for (const k of [0, k0, ch.count - 1]) {
    const dd = div.district[k], p = div.province[dd];
    assert.equal(a[k * 4] & 65535, dd); assert.equal(a[k * 4] >>> 16, p); assert.equal(a[k * 4 + 1] & 65535, div.region[p]);
    assert.equal((a[k * 4 + 1] >>> 16 >> 9) & 3, div.kinds[dd]);
  }
});

test('division: the aspect — contract functions, one texture, knobs, pages', () => {
  assert.match(division.glsl, /void aspDivision\(Px p, inout vec3 col, float landA\)/);
  assert.match(division.glsl, /vec3 districtAt\(vec2 pk\)/);
  const samplers = Object.values(division.uniforms).filter(u => u.value?.isTexture);
  assert.equal(samplers.length, 1, 'the aspect brings exactly one texture to the ground shader');
  assert.equal((division.glsl.match(/sampler2D/g) || []).length, 1);
  for (const k of ['division', 'divSize', 'divPick']) assert.ok(DEFS.find(d => d.key === k), `knob ${k}`);
  assert.deepEqual(DEFS.find(d => d.key === 'divSize').options.map(o => o[0]), [30, 50, 100]);
  const page = id => PAGES.find(p => p.id === id);
  for (const id of ['mode-districts', 'mode-provinces', 'mode-regions']) assert.equal(page(id).group, 'Режимы карты');
  assert.equal(page('mode-districts').p.division, 1); assert.equal(page('mode-provinces').p.division, 2); assert.equal(page('mode-regions').p.division, 3);
  assert.ok(page('division-chunks').p.grid, 'a page shows the chunks of the districts');
  assert.ok(Array.isArray(page('division-info').divAt), 'a page opens with a district chosen');
});

// ---- the album's real data
const data = loadAlbumData(ROOT);
const real = data ? { ch: new Chunks(data.base.at, data.vectors.rivers), opts: { heightAt: data.base.at, lakes: data.vectors.lakes } } : null;
const skip = !real && 'public/album-data/ is not there';

test('division of the album: every chunk in one connected district, areas in their limits, every coast faces the sea', { skip }, () => {
  const { ch, opts } = real;
  for (const size of [30, 50, 100]) {
    const div = buildDivision(ch, { ...opts, size });
    checkWhole(ch, div);
    const l = checkSizes(ch, div, LAND, .35, 2.3), s = checkSizes(ch, div, SEA, .25, 9);
    let landArea = 0; for (let k = 0; k < ch.count; k++) if (div.kind[k] === LAND) landArea += ch.area[k];
    const want = landArea / size ** 2;
    assert.ok(Math.abs(l.n - want) < want * .35, `${size} km: ${l.n} land districts for ${Math.round(landArea)} km² of land`);
    assert.ok(l.small <= Math.max(2, l.n * .04), `${size} km: few too small land districts (${l.small})`);
    assert.ok(s.n > 0 && div.provinceCount > 5 && div.regionCount >= 4, `${size} km: sea districts, provinces, regions`);
    for (let d = 0; d < div.count; d++) {
      if (div.kinds[d] !== LAND) continue;
      const coastal = div.chunks[d].some(k => ch.links[k].some(x => div.kind[x.k] === SEA));
      if (coastal) assert.ok(div.neighbours[d].some(e => div.kinds[e] === SEA), `${size} km: coastal district ${d} touches the sea`);
    }
  }
});

test('division of the album: rivers run along district borders, the Ebro, the Tagus and the Douro too', { skip }, () => {
  const { ch, opts } = real, div = buildDivision(ch, { ...opts, size: 30 });
  const great = riverBorders(ch, div, 2), lesser = riverBorders(ch, div, 1);
  assert.ok(great.n > 200 && great.b / great.n >= .9, `great rivers on chunk borders are district borders (${great.b} of ${great.n})`);
  assert.ok(lesser.n > 100 && lesser.b / lesser.n >= .8, `lesser rivers (${lesser.b} of ${lesser.n})`);
  // 2 km to either side of the river the districts differ, nearly wherever the chunks themselves differ
  for (const name of ['Эбро', 'Тахо', 'Дуэро']) {
    let n = 0, dc = 0, dd = 0;
    for (const r of data.vectors.rivers.filter(x => x.name === name)) for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, ay] = kmOf(r.pts[i][1], r.pts[i][0]), [bx, by] = kmOf(r.pts[i + 1][1], r.pts[i + 1][0]), L = Math.hypot(bx - ax, by - ay); if (L < .5) continue;
      const nx = -(by - ay) / L, ny = (bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2, p = llOf(mx + nx * 2, my + ny * 2), q = llOf(mx - nx * 2, my - ny * 2);
      const k1 = ch.at(p.lat, p.lon), k2 = ch.at(q.lat, q.lon); if (k1 < 0 || k2 < 0 || !ch.kind[k1] || !ch.kind[k2]) continue;
      n++; if (k1 !== k2) dc++; if (div.district[k1] !== div.district[k2]) dd++;
    }
    assert.ok(n > 150, name);
    assert.ok(dd / n >= .8 && dd >= dc * .9, `${name}: districts differ across the river at ${dd} of ${n} points (chunks at ${dc})`);
  }
});

test('division of the album: reproducible, lakes and the sea apart, islands linked, names', { skip }, () => {
  const { ch, opts } = real, a = buildDivision(ch, { ...opts, size: 30 }), b = buildDivision(ch, { ...opts, size: 30 });
  assert.deepEqual(a.district, b.district); assert.deepEqual(a.province, b.province); assert.deepEqual(a.region, b.region);
  const d = a.district[ch.at(39.6, 2.95)];
  assert.equal(a.kinds[d], LAND, 'Mallorca is land');
  const members = [...a.province.keys()].filter(e => a.province[e] === a.province[d]);
  assert.ok(members.length >= 2, 'the Balearic province has several districts');
  const open = a.district[ch.at(40.5, -9.7)];
  assert.equal(a.kinds[open], SEA); assert.ok(a.area[open] >= 900, `an open sea piece of ${Math.round(a.area[open])} km²`);
  const names = districtNames(ch, a, data.vectors.places);
  assert.equal(names.length, a.count);
  for (const pl of data.vectors.places.filter(q => ['Мадрид', 'Сарагоса', 'Севилья', 'Барселона'].includes(q.name))) assert.equal(names[a.district[ch.at(pl.lat, pl.lon)]], pl.name);
  assert.match(names[open], /^Морской район № \d+$/);
  assert.equal(new Set(names).size, names.length, 'no two districts share a name');
});
