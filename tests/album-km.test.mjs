// The chunk of 1 km² (src/album/division/km.js, docs/ALBUM-CHUNKS.md): the lattice, the outline of a chunk inside its
// district, the classes of ground, the order a district takes up its chunks. On made-up land, and on the album's real
// data when public/album-data/ is there (it is not in git: scripts/album/fetch-data.mjs; the worktree setup copies it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf, FN, FKM, CN, CHUNK_KM, CI0, CJ0 } from '../src/album/chunks.js';
import { KN, KKM, KX0, KY0, JITTER, kmHash, KM_GLSL, seedOf, squareOf, middleOf, chunkAt, cellsOfChunks, chunkFacts, districtBoxes, chunksOfDistrict, cellsOfDistrict, districtOrder,
  kmData, kmFacts, kmOrder, CLASS_SLOPE, CLASS_TITLE, HIGH_M, livingOf, ORDER_WEIGHT } from '../src/album/division/km.js';
import { buildDivision, districtSummary, LAND } from '../src/album/division/build.js';
import { packDivision } from '../src/album/division/gpu.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import division from '../src/album/aspects/division.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('km: the lattice of chunks lies over the whole map; a seed stands in its own square; one hash for JS and GLSL', () => {
  assert.equal(KKM, 1); assert.equal(KN * KKM, FN * FKM); assert.equal(KN * KKM, CN * CHUNK_KM); assert.equal(KX0, CI0 * CHUNK_KM); assert.equal(KY0, CJ0 * CHUNK_KM);
  for (const [i, j] of [[0, 0], [5, 9], [640, 640], [1279, 1279], [311, 1040]]) {
    const [x, y] = seedOf(i, j), [mx, my] = middleOf(j * KN + i);
    assert.ok(Math.abs(x - mx) <= JITTER + 1e-9 && Math.abs(y - my) <= JITTER + 1e-9, 'the seed stands near the middle of its square');
    assert.equal(squareOf(x, y), j * KN + i); assert.equal(squareOf(mx, my), j * KN + i);
    for (const salt of [1, 2]) { const h = kmHash(i, j, salt); assert.ok(h >= 0 && h < 1 && Number.isInteger(h * 16777216), 'a number a float holds exactly'); }
  }
  assert.equal(squareOf(KX0 - .1, KY0 + 5), -1); assert.equal(squareOf(KX0 + 5, KY0 + KN + .1), -1);
  // the seeds do not stand in rows: their places in the squares are spread evenly
  let sx = 0, sy = 0, n = 0; const tenths = new Uint32Array(10);
  for (let j = 300; j < 340; j++) for (let i = 500; i < 540; i++) { const [x, y] = seedOf(i, j), fx = x - KX0 - i, fy = y - KY0 - j; sx += fx; sy += fy; n++; tenths[Math.floor((fx - .5 + JITTER) / (2 * JITTER) * 10)]++; }
  assert.ok(Math.abs(sx / n - .5) < .02 && Math.abs(sy / n - .5) < .02); assert.ok(Math.min(...tenths) > n / 10 * .6, 'no tenth of the square is left empty: ' + [...tenths]);
  // the shader has the same hash and the same reach of the seeds
  assert.match(KM_GLSL, /0x27d4eb2du/); assert.match(KM_GLSL, /0x297a2d39u/); assert.ok(KM_GLSL.includes(`#define KM_JIT ${(2 * JITTER).toFixed(3)}`)); assert.ok(KM_GLSL.includes(`#define KM_N ${KN}`));
});

// a made-up division: two districts of land west and east of column 700, the sea east of column 760
function madeDiv(heightAt = () => 100) {
  const cells = new Int32Array(KN * KN), hgt = new Float32Array(KN * KN);
  for (let c = 0; c < cells.length; c++) { const i = c % KN; cells[c] = i >= 760 ? 2 : i < 700 ? 0 : 1; }
  const div = { count: 3, cells, kinds: [0, 0, 2], cx: [KX0 + 650.5, KX0 + 730.5, KX0 + 900.5], cy: [KY0 + 600.5, KY0 + 600.5, KY0 + 600.5], raster: { hgt } };
  for (let j = 560; j < 640; j++) for (let i = 600; i < 760; i++) { const p = llOf(KX0 + i + .5, KY0 + j + .5); hgt[j * KN + i] = Math.max(0, heightAt(p.lat, p.lon)); }
  return div;
}

test('km: a chunk is the ground of its district nearest to its seed — about 1 km², not a square, never across a district border', () => {
  const div = madeDiv(), cells = div.cells, area = new Map(); let own = 0, n = 0, far = 0;
  for (let y = KY0 + 590.05; y < KY0 + 610; y += .1) for (let x = KX0 + 640.05; x < KX0 + 660; x += .1) {
    const c = chunkAt(cells, x, y), [sx, sy] = seedOf(c % KN, Math.floor(c / KN));
    assert.equal(cells[c], 0); n++; if (c === squareOf(x, y)) own++;
    far = Math.max(far, Math.hypot(sx - x, sy - y)); area.set(c, (area.get(c) || 0) + .01);
  }
  assert.ok(own / n > .6 && own / n < .9, `a chunk is not its square: ${(own / n * 100).toFixed(0)} % of the ground lies in the chunk of its own square`);
  assert.ok(far < 1.3, 'no point is further than ' + far.toFixed(2) + ' km from the seed of its chunk');
  // the chunks that lie wholly inside the window: about a square kilometre each, none a scrap, none a giant
  const whole = [...area].filter(([c]) => { const i = c % KN, j = Math.floor(c / KN); return i > 641 && i < 658 && j > 591 && j < 608; }).map(e => e[1]);
  const mean = whole.reduce((a, b) => a + b, 0) / whole.length;
  assert.ok(whole.length > 200 && Math.abs(mean - 1) < .03, `${whole.length} chunks of ${mean.toFixed(3)} km² in the mean`);
  assert.ok(Math.min(...whole) > .45 && Math.max(...whole) < 1.8, `from ${Math.min(...whole).toFixed(2)} to ${Math.max(...whole).toFixed(2)} km²`);
  // at the border of two districts a chunk ends on the border: a point belongs to a chunk of its own district
  for (let y = KY0 + 600.03; y < KY0 + 606; y += .17) for (const dx of [-.45, -.2, -.02, .02, .2, .45]) {
    const x = KX0 + 700 + dx, c = chunkAt(cells, x, y); assert.equal(cells[c], dx < 0 ? 0 : 1);
  }
  // … and at the shore: a point of land in a square of water goes to a chunk of land when its district is known
  const c = chunkAt(cells, KX0 + 760.2, KY0 + 600.5, 1); assert.equal(cells[c], 1); assert.equal(cells[chunkAt(cells, KX0 + 760.2, KY0 + 600.5)], 2);
  assert.equal(chunkAt(cells, KX0 - 3, KY0 + 5), -1);
});

test('km: five classes of ground by the most level quarter of the chunk; who can live there', () => {
  assert.equal(CLASS_SLOPE.length, 4); assert.equal(CLASS_TITLE.length, 6); assert.ok(CLASS_SLOPE.every((v, i) => !i || v > CLASS_SLOPE[i - 1]));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(livingOf), [0, 2, 2, 2, 1, 0], 'classes 1–3 are lived on freely, 4 barely, 5 and water not at all');
  // strips of land, each 10 km wide and rising eastward at its own rate; then a deep narrow valley; then high ground
  const rise = [.004, .025, .06, .13, .3], x0 = KX0 + 600;
  const h = (lat, lon) => {
    const [x, y] = kmOf(lat, lon), u = x - x0;
    if (u < 0) return 100;
    if (u < 50) { const s = Math.floor(u / 10); return 100 + (u - s * 10) * 1000 * rise[s]; }
    if (u < 60) return 400 + Math.max(0, Math.abs(u - 55) - .6) * 600;               // a valley 1.2 km wide between walls of 60 %
    if (u < 70) return HIGH_M + 100;                                                // a level plateau above the line of bare rock
    return 100 + Math.sin(y * 9) * 40 * (u < 80 ? 1 : 0);
  };
  const div = madeDiv(h), f = chunkFacts(div, h), at = (i, j = 600) => j * KN + 600 + i;
  for (let s = 0; s < 5; s++) for (const i of [2, 5, 7]) assert.equal(f.cls[at(s * 10 + i)], s + 1, `a rise of ${rise[s]} is class ${s + 1}`);
  assert.ok(f.slope[at(25)] > .055 && f.slope[at(25)] < .065, 'the slope of the ground: ' + f.slope[at(25)].toFixed(3));
  assert.ok(f.cls[at(54)] <= 2 && f.cls[at(55)] <= 2, 'the floor of a narrow valley can be lived on: class ' + f.cls[at(54)] + ' and ' + f.cls[at(55)]);
  assert.ok(f.steep[at(54)] > .25, 'though its walls are steep: ' + f.steep[at(54)].toFixed(2));
  assert.equal(f.cls[at(52)], 5, 'the wall itself is mountain'); assert.equal(f.cls[at(65)], 5, 'above ' + HIGH_M + ' m a chunk is mountain however level');
  assert.equal(f.cls[at(165)], 0, 'a chunk of water has no class'); assert.equal(f.num[0], 0);
  assert.equal(f.num.reduce((a, b) => a + b, 0), 160 * 80 + 0 * 0 + (KN * KN - 520 * KN - 160 * 80 - 0), 'every chunk of land is counted once');
  // without the heights between the middles only neighbours are compared: still level and steep are told apart
  const g = chunkFacts(div, null); assert.equal(g.cls[at(5)], 1); assert.ok(g.cls[at(45)] >= 4);
});

test('km: the chunks of a district, the cells under them, and the order a district takes up its land', () => {
  const div = madeDiv(), box = districtBoxes(div);
  assert.deepEqual([...box.num], [700 * KN, 60 * KN, 520 * KN]); assert.deepEqual([box.x0[1], box.x1[1], box.y0[1], box.y1[1]], [700, 759, 0, KN - 1]);
  assert.equal(kmData(div).box.num[1], 60 * KN); assert.equal(chunksOfDistrict(div, 1).length, 60 * KN); assert.ok(chunksOfDistrict(div, 1).every(c => div.cells[c] === 1));
  // level ground near the centre first; where nobody can live comes last
  assert.ok(ORDER_WEIGHT[1] === 1 && ORDER_WEIGHT.slice(1).every((v, i, a) => !i || v > a[i - 1]));
  const cls = new Uint8Array(KN * KN).fill(1), centre = squareOf(div.cx[1], div.cy[1]); cls[centre + 2] = 5;
  const o = districtOrder(div, { cls });
  assert.equal(o.list.length, 760 * KN); assert.deepEqual([o.first[0], o.first[1], o.first[2], o.first[3]], [0, 700 * KN, 760 * KN, 760 * KN]);
  assert.equal(o.rank[centre], 0); assert.equal(o.list[o.first[1]], centre); assert.equal(o.rank[squareOf(KX0 + 900, KY0 + 600)], -1);
  assert.ok(o.rank[centre + 2] > o.rank[centre + 9], 'a mountain chunk two km from the centre waits until the level ground nine km away is taken');
  const part = o.list.subarray(o.first[1], o.first[2]); assert.equal(new Set(part).size, part.length);
  let last = -1; for (let r = 0; r < 4000; r++) { const c = part[r], [x, y] = middleOf(c), d = Math.hypot(x - div.cx[1], y - div.cy[1]) * ORDER_WEIGHT[cls[c]]; assert.ok(d >= last - 1e-4); last = d; assert.equal(o.rank[c], r); }
  // the centre of a district, when it has one, is where the order begins
  const moved = districtOrder({ ...div, centres: { texel: [1, 1, -1], x: [div.cx[0], div.cx[1] + 20, 0], y: [div.cy[0], div.cy[1] + 30, 0] } }, { cls });
  assert.equal(moved.rank[squareOf(div.cx[1] + 20, div.cy[1] + 30)], 0);
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('km of the album: a district is about four hundred whole chunks; the plains are level, the ranges mountain, their valleys lived in', { skip }, () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring);
  const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const div = buildDivision(ch, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  assert.equal(div.cells.length, KN * KN);
  // every chunk has a district; a land district is its chunks
  const num = kmData(div).box.num, land = []; let all = 0, landChunks = 0;
  for (let d = 0; d < div.count; d++) { all += num[d]; if (div.kinds[d] === LAND) { land.push(num[d]); landChunks += num[d]; } }
  assert.equal(all, KN * KN, 'every chunk lies in a district'); land.sort((a, b) => a - b);
  const mid = land[land.length >> 1], q = p => land[Math.floor(p * (land.length - 1))];
  assert.ok(mid > 370 && mid < 430, `a district has ${mid} chunks in the middle`); assert.ok(q(.05) > 220 && q(.95) < 620, `nine districts in ten have ${q(.05)} to ${q(.95)} chunks`);
  // the natural cells under the chunks: every chunk lies in one, and the cells of a district carry all its chunks
  const kc = cellsOfChunks(ch); assert.equal(kc.cell.length, KN * KN); assert.equal(kc.count.reduce((a, b) => a + b, 0), KN * KN);
  const zar = div.cells[squareOf(...kmOf(41.65, -.89))], parts = cellsOfDistrict(div, ch, zar);
  assert.equal(parts.reduce((s, e) => s + e[1], 0), num[zar]); assert.ok(parts.length >= 3 && parts.length < 30);
  // what the chunks are like
  const f = kmFacts(div, data.base.at), share = [...f.num].map(v => v / landChunks);
  assert.equal(f.num.reduce((a, b) => a + b, 0), landChunks); assert.equal(f.num[0], 0);
  assert.ok(share[1] > .2 && share[1] < .36 && share[2] > .28 && share[5] > .02 && share[5] < .09, 'shares of the classes: ' + share.map(v => (v * 100).toFixed(1)).join(' '));
  const clsAt = (lat, lon) => f.cls[chunkAt(div.cells, ...kmOf(lat, lon))];
  assert.equal(clsAt(41.65, -.89), 1, 'Zaragoza, the plain of the Ebro'); assert.equal(clsAt(39.2, -3), 1, 'La Mancha'); assert.equal(clsAt(37.19, -3.7), 1, 'the vega of Granada');
  assert.equal(clsAt(42.631, .657), 5, 'Aneto'); assert.equal(clsAt(37.053, -3.311), 5, 'Mulhacén');
  assert.ok(clsAt(42.604, .523) <= 3, 'the valley of Benasque can be lived in'); assert.ok(clsAt(42.432, 1.928) <= 2, 'the Cerdanya is level ground among the mountains');
  // a district of the plain and a district of the high Pyrenees
  const s = districtSummary(div, zar, ch), high = districtSummary(div, div.cells[squareOf(...kmOf(42.631, .657))], ch);
  assert.equal(s.chunks, num[zar]); assert.equal(s.area, num[zar]); assert.ok(s.classes[1] / s.chunks > .4 && s.living[2] / s.chunks > .95, 'Zaragoza: ' + s.classes);
  assert.ok(high.classes[5] / high.chunks > .3 && high.living[2] > 20, 'the district of Aneto: ' + high.classes + '; lived on freely: ' + high.living[2]);
  // the order a district takes up its land begins at its centre
  div.centres = districtCentres(div, data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; }));
  const o = kmOrder(div, data.base.at); assert.equal(o.list.length, landChunks);
  const first = o.list[o.first[zar]], [fx, fy] = middleOf(first); assert.ok(Math.hypot(fx - div.centres.x[zar], fy - div.centres.y[zar]) < 2.5, 'the first chunk of the district of Zaragoza lies at its centre');
  // the texture of the division carries the district of every chunk and, when asked, what the chunk is like
  const a = packDivision(ch, div, null, f);
  for (let c = 0; c < KN * KN; c += 7919) { assert.equal(a[c * 4], div.cells[c]); assert.equal(a[c * 4 + 1] & 7, f.cls[c]); assert.equal(a[c * 4 + 1] >> 3 & 3, livingOf(f.cls[c])); }
  assert.equal(packDivision(ch, div)[squareOf(...kmOf(41.65, -.89)) * 4 + 1], 0, 'without the facts the texture says nothing of the chunks');
});

test('km in the album: the chunks are shown only for checking — a knob and its pages', () => {
  const knob = DEFS.find(d => d.key === 'km'); assert.ok(knob && knob.value === 0 && knob.uniform === 'uDivKm' && knob.options.length === 5);   // outlines, class, living, fields
  assert.equal(division.uniforms.uDivKm.value, 0);
  for (const fn of ['kmHash(', 'kmSeed(', 'kmChunk(', 'kmFacts(']) assert.ok(division.glsl.includes(fn), fn);
  const ids = division.pages.map(p => p.id); for (const id of ['km-chunks', 'km-chunks-natural', 'km-class', 'km-class-plain', 'km-living', 'km-farm', 'km-farm-natural']) assert.ok(ids.includes(id), id);
  for (const p of division.pages.filter(p => p.id.startsWith('km-'))) { assert.ok(p.p.km >= 1 && p.cam.h <= 140, 'a chunk is a few pixels wide on its pages'); assert.match(p.note, /чанк/i); }
  // the tools that show the natural cells of 100 km² no longer call them chunks
  for (const key of ['grid', 'chunkInfo', 'chunkData']) assert.match(DEFS.find(d => d.key === key).label, /яче[йе]к/);
});
