// The division of the album (docs/album/division.md): chunks → districts → provinces → regions, on land, in lakes and
// at sea. On a small made-up world, and on the album's real data when public/album-data/ is there (it is not in git:
// scripts/album/fetch-data.mjs; the worktree setup copies it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, CN, CI0, CJ0, CHUNK_KM, kmOf, llOf } from '../src/album/chunks.js';
import { buildDivision, districtSummary, districtNames, riverCrossings, smoothRivers, levelSizes, LAND, SEA, LAKE } from '../src/album/division/build.js';
import { fineGrids, pick, G, FLAG } from '../src/album/division/fine.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import division from '../src/album/aspects/division.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = CN * CN;
const nbs = k => { const x = k % CN, y = (k / CN) | 0, o = []; if (x > 0) o.push(k - 1); if (x < CN - 1) o.push(k + 1); if (y > 0) o.push(k - CN); if (y < CN - 1) o.push(k + CN); return o; };

// every chunk in exactly one district, every district side-connected and of one kind
function checkWhole(div) {
  assert.equal(div.district.length, N);
  const seen = new Int32Array(div.count);
  for (let k = 0; k < N; k++) { const d = div.district[k]; assert.ok(d >= 0 && d < div.count, `chunk ${k} has a district`); seen[d]++; }
  for (let d = 0; d < div.count; d++) {
    assert.ok(seen[d] > 0, `district ${d} has chunks`);
    assert.equal(div.chunks[d].length, seen[d]);
    const list = div.chunks[d], inD = new Set(list), q = [list[0]], got = new Set(q);
    for (let h = 0; h < q.length; h++) for (const m of nbs(q[h])) if (inD.has(m) && !got.has(m)) { got.add(m); q.push(m); }
    assert.equal(got.size, list.length, `district ${d} is connected`);
    const kd = div.kinds[d];
    for (const k of list) assert.equal(div.kind[k] === SEA ? SEA : div.kind[k] === LAKE ? LAKE : LAND, kd, `district ${d} is all one kind`);
  }
}
// sizes within the limits, except pieces that cannot be bigger (an island, a lake)
function checkSizes(div, kind, lo, hi) {
  const T = (div.sizes.district / CHUNK_KM) ** 2 * (kind === SEA ? 1 : 1);
  // connected pieces of the same kind: a district may be smaller only when its whole piece is small
  const piece = new Int32Array(N).fill(-1), pieceSize = [];
  for (let s = 0; s < N; s++) {
    if (piece[s] >= 0 || div.kind[s] !== kind) continue;
    const q = [s]; piece[s] = pieceSize.length;
    for (let h = 0; h < q.length; h++) for (const m of nbs(q[h])) if (piece[m] < 0 && div.kind[m] === kind) { piece[m] = pieceSize.length; q.push(m); }
    pieceSize.push(q.length);
  }
  let small = 0, n = 0;
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== kind) continue;
    n++;
    const size = div.chunks[d].length, whole = pieceSize[piece[div.chunks[d][0]]];
    assert.ok(size <= hi * T, `district ${d}: ${size} chunks is too big (target ${T})`);
    if (size < lo * T && whole >= lo * T) small++;
  }
  return { n, small };
}

// ---- a small made-up world: an island 60 × 40 chunks with a river across, a ridge, a lake, the sea around
function madeUp() {
  const land = new Float32Array(N), height = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const x = k % CN, y = (k / CN) | 0;
    if (x >= 30 && x < 90 && y >= 40 && y < 80) { land[k] = 1; height[k] = 200 + (x > 70 ? 900 : 0); }
    if (x >= 52 && x < 54 && y >= 62 && y < 64) land[k] = 0;                 // a small lake inside
    if (x >= 34 && x < 44 && y >= 66 && y < 76) land[k] = 0;                 // a big one
  }
  const at = (lat, lon) => { const [x, y] = kmOf(lat, lon), i = Math.floor(x / CHUNK_KM) - CI0, j = Math.floor(y / CHUNK_KM) - CJ0; if (i < 0 || j < 0 || i >= CN || j >= CN) return -100; const k = j * CN + i; return land[k] ? height[k] + (Math.abs(i - 70.5) < .6 ? 800 : 0) : -100; };
  // a river from west to east along chunk row 55.5 (between centres of rows 55 and 56 it never runs: it wanders)
  const pts = []; for (let i = 28; i <= 92; i++) { const p = llOf((CI0 + i) * CHUNK_KM, (CJ0 + 55.6 + Math.sin(i / 4) * .25) * CHUNK_KM); pts.push([p.lon, p.lat]); }
  return { land, height, heightAt: at, rivers: [{ name: 'Река', rank: 5, pts }], lakes: [] };
}

test('division: a made-up world — whole chunks, connected districts, sizes, kinds, reproducible', () => {
  const w = madeUp(), div = buildDivision({ ...w, size: 30 });
  checkWhole(div);
  const { n, small } = checkSizes(div, LAND, .3, 2.3);
  assert.ok(n > 10, `the island has many districts (${n})`);
  assert.ok(small <= n * .05, `few small districts (${small} of ${n})`);
  assert.ok(div.kinds.includes(LAKE), 'the inner water is a lake district');
  assert.ok(div.kinds.includes(SEA));
  const lakeOf = k => div.district[k];
  assert.equal(new Set([62 * CN + 52, 62 * CN + 53, 63 * CN + 52, 63 * CN + 53].map(lakeOf)).size, 1, 'a small lake is one district');
  const big = new Set(); for (let y = 66; y < 76; y++) for (let x = 34; x < 44; x++) big.add(lakeOf(y * CN + x));
  assert.ok(big.size >= 5 && [...big].every(d => div.kinds[d] === LAKE), `a big lake is cut into several lake districts (${big.size})`);
  // the river: chunks on its two sides belong to different districts
  const rr = riverCrossings(smoothRivers(w.rivers));
  let crossed = 0, border = 0;
  for (let e = 0; e < rr.length; e++) if (rr[e] < 99) { const k = e >> 1, m = e & 1 ? k + CN : k + 1; if (div.kind[k] !== LAND || div.kind[m] !== LAND) continue; crossed++; if (div.district[k] !== div.district[m]) border++; }
  assert.ok(crossed > 40 && border / crossed > .9, `the river runs along borders (${border} of ${crossed})`);
  const again = buildDivision({ ...w, size: 30 });
  assert.deepEqual(again.district, div.district, 'the same data give the same division');
  assert.deepEqual(again.province, div.province); assert.deepEqual(again.region, div.region);
});

test('division: provinces and regions group neighbouring districts of one kind', () => {
  const w = madeUp(), div = buildDivision({ ...w, size: 30 });
  assert.equal(div.province.length, div.count);
  for (let d = 0; d < div.count; d++) { assert.ok(div.province[d] >= 0 && div.province[d] < div.provinceCount); assert.ok(div.region[div.province[d]] >= 0 && div.region[div.province[d]] < div.regionCount); }
  assert.ok(div.provinceCount < div.count && div.regionCount <= div.provinceCount && div.regionCount >= 2);
  // a province never mixes the sea with land
  const cls = new Map();
  for (let d = 0; d < div.count; d++) { const c = div.kinds[d] === SEA ? 1 : 0, p = div.province[d]; if (cls.has(p)) assert.equal(cls.get(p), c, `province ${p} is all land or all sea`); cls.set(p, c); }
  // neighbours never share a colour
  for (let d = 0; d < div.count; d++) for (const e of div.neighbours[d]) assert.notEqual(div.colour.district[d], div.colour.district[e]);
  const s = levelSizes(30); assert.equal(s.province, 100); assert.equal(s.region, 340);
  assert.ok(levelSizes(100).province > 100, 'provinces grow with large districts');
});

test('division: what a district holds — shares of the chunk state and sums of the layers', () => {
  const w = madeUp(), div = buildDivision({ ...w, size: 30 }), ch = new Chunks();
  ch.land.set(w.land);
  const d = div.district[60 * CN + 40], list = div.chunks[d];
  const iron = ch.layer('iron', { title: 'Железо', unit: 'т', sum: true }), quiet = ch.layer('note', { sum: false });
  for (const k of list) { iron.data[k] = 2; quiet.data[k] = 9; ch.set('forest', k, .5); }
  ch.set('fields', list[0], 1);
  const s = districtSummary(div, d, ch);
  assert.equal(s.chunks, list.length); assert.equal(s.area, list.length * 100); assert.equal(s.kind, 'land');
  assert.ok(Math.abs(s.share.forest - .5) < .01);
  assert.ok(Math.abs(s.share.fields - 1 / list.length) < .01);
  assert.deepEqual(s.sums.map(x => [x.name, x.value]), [['iron', 2 * list.length]], 'only layers with sum: true are summed');
});

test('division: the drawing grid keeps every chunk middle in its own district (away from rivers) and follows the river', () => {
  const w = madeUp(), div = buildDivision({ ...w, size: 30 }), fine = fineGrids(div, { rivers: w.rivers });
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== LAND) continue;
    for (const k of div.chunks[d]) {
      const c = { x: (k % CN + CI0 + .5) * CHUNK_KM, y: (((k / CN) | 0) + CJ0 + .5) * CHUNK_KM };
      const u = Math.floor((c.x - CI0 * CHUNK_KM) / (CHUNK_KM / 8)), v = Math.floor((c.y - CJ0 * CHUNK_KM) / (CHUNK_KM / 8));
      if (Math.abs(fine.river[v * G + u]) < 4000) continue;            // by a river the drawing follows the river
      const near = []; for (let b = -2; b <= 1; b++) for (let a = -2; a <= 1; a++) near.push(fine.rawLand[(v + b) * G + u + a]);
      assert.ok(near.includes(d), `the middle of chunk ${k} shows its district ${d}`);
    }
  }
  for (let t = 0; t < G * G; t += 997) assert.equal(fine.land[t] & (FLAG - 1), fine.rawLand[t]);
  // 1.5 km to either side of the river the drawn districts differ
  const pts = smoothRivers(w.rivers)[0].pts.map(([lon, lat]) => kmOf(lat, lon));
  let n = 0, diff = 0;
  for (let i = 4; i + 1 < pts.length - 4; i += 3) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if (!L) continue;
    const nx = -(by - ay) / L, ny = (bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
    const a = pick(fine.land, mx + nx * 1.5, my + ny * 1.5, fine.river), b = pick(fine.land, mx - nx * 1.5, my - ny * 1.5, fine.river);
    n++; if (a !== b) diff++;
  }
  assert.ok(n > 20 && diff / n > .9, `drawn border on the river (${diff} of ${n})`);
});

test('division: the aspect — contract functions, knobs, pages', () => {
  assert.match(division.glsl, /void aspDivision\(Px p, inout vec3 col, float landA\)/);
  assert.match(division.glsl, /vec3 districtAt\(vec2 pk\)/);
  for (const k of ['division', 'divSize', 'divChunks', 'divPick']) assert.ok(DEFS.find(d => d.key === k), `knob ${k}`);
  assert.deepEqual(DEFS.find(d => d.key === 'divSize').options.map(o => o[0]), [30, 50, 100]);
  const page = id => PAGES.find(p => p.id === id);
  for (const id of ['mode-districts', 'mode-provinces', 'mode-regions']) assert.equal(page(id).group, 'Режимы карты');
  assert.equal(page('mode-districts').p.division, 1); assert.equal(page('mode-provinces').p.division, 2); assert.equal(page('mode-regions').p.division, 3);
  assert.ok(page('division-chunks').p.grid && page('division-chunks').p.divChunks, 'a page shows the chunks of districts');
  assert.ok(Array.isArray(page('division-info').divAt), 'a page opens with a district chosen');
  for (const k of ['tDivF', 'tDivC', 'tDivT', 'uDivision', 'uDivHover', 'uDivSel', 'uDivOn']) assert.ok(division.uniforms[k], `uniform ${k}`);
});

// ---- the album's real data
const data = loadAlbumData(ROOT);
const real = data ? (() => { const ch = new Chunks(data.base.at); return { ch, input: { land: ch.land, height: ch.height, heightAt: data.base.at, rivers: data.vectors.rivers, lakes: data.vectors.lakes } }; })() : null;

test('division of the album: every chunk in one connected district, sizes in their limits', { skip: !real && 'public/album-data/ is not there' }, () => {
  for (const size of [30, 50, 100]) {
    const div = buildDivision({ ...real.input, size });
    checkWhole(div);
    const l = checkSizes(div, LAND, .35, 2.3), s = checkSizes(div, SEA, .25, 9);
    const T = (size / CHUNK_KM) ** 2, landChunks = div.kind.reduce((n, k) => n + (k === LAND), 0);
    assert.ok(Math.abs(l.n - landChunks / T) < landChunks / T * .35, `${size} km: ${l.n} land districts for ${landChunks} land chunks`);
    assert.ok(l.small <= Math.max(2, l.n * .04), `${size} km: few too small land districts (${l.small})`);
    assert.ok(s.n > 0 && div.provinceCount > 5 && div.regionCount >= 4, `${size} km: sea districts, provinces, regions`);
    // every coastal land district faces at least one sea district
    for (let d = 0; d < div.count; d++) {
      if (div.kinds[d] !== LAND) continue;
      const coastal = div.chunks[d].some(k => nbs(k).some(m => div.kind[m] === SEA));
      if (coastal) assert.ok(div.neighbours[d].some(e => div.kinds[e] === SEA), `${size} km: coastal district ${d} touches the sea`);
    }
  }
});

test('division of the album: the Ebro, the Tagus and the Douro run along borders, not through districts', { skip: !real && 'public/album-data/ is not there' }, () => {
  const div = buildDivision({ ...real.input, size: 30 }), fine = fineGrids(div, { rivers: real.input.rivers });
  for (const name of ['Эбро', 'Тахо', 'Дуэро']) {
    const rv = smoothRivers(real.input.rivers.filter(r => r.name === name)), rr = riverCrossings(rv);
    assert.ok(rv.length, name);
    let n = 0, border = 0;
    for (let e = 0; e < rr.length; e++) if (rr[e] < 99) { const k = e >> 1, m = e & 1 ? k + CN : k + 1; if (div.kind[k] !== LAND || div.kind[m] !== LAND) continue; n++; if (div.district[k] !== div.district[m]) border++; }
    assert.ok(n > 30 && border / n >= .85, `${name}: ${border} of ${n} chunk pairs across the river are in different districts`);
    // and on the map: 1.5 km to either side of the river the districts differ
    let pn = 0, pd = 0;
    for (const r of rv) for (let i = 0; i + 1 < r.pts.length; i += 2) {
      const [ax, ay] = kmOf(r.pts[i][1], r.pts[i][0]), [bx, by] = kmOf(r.pts[i + 1][1], r.pts[i + 1][0]), L = Math.hypot(bx - ax, by - ay); if (!L) continue;
      const nx = -(by - ay) / L, ny = (bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2, p = llOf(mx + nx * 1.5, my + ny * 1.5), q = llOf(mx - nx * 1.5, my - ny * 1.5);
      if (data.base.at(p.lat, p.lon) <= 0 || data.base.at(q.lat, q.lon) <= 0) continue;
      pn++; if (pick(fine.land, mx + nx * 1.5, my + ny * 1.5, fine.river) !== pick(fine.land, mx - nx * 1.5, my - ny * 1.5, fine.river)) pd++;
    }
    assert.ok(pn > 100 && pd / pn >= .85, `${name}: the drawn border lies on the river at ${pd} of ${pn} points`);
  }
});

test('division of the album: reproducible, lakes and the sea apart, islands linked, names', { skip: !real && 'public/album-data/ is not there' }, () => {
  let open;
  const a = buildDivision({ ...real.input, size: 30 }), b = buildDivision({ ...real.input, size: 30 });
  assert.deepEqual(a.district, b.district); assert.deepEqual(a.province, b.province); assert.deepEqual(a.region, b.region);
  const fa = fineGrids(a, { rivers: real.input.rivers }), fb = fineGrids(b, { rivers: real.input.rivers });
  assert.deepEqual(fa.land, fb.land); assert.deepEqual(fa.water, fb.water);
  // Mallorca is land of its own; its province reaches over the water to other land
  const k = real.ch.at(39.6, 2.95), d = a.district[k];
  assert.equal(a.kinds[d], LAND, 'Mallorca is land');
  const p = a.province[d], members = [...a.province.keys()].filter(e => a.province[e] === p);
  assert.ok(members.length >= 2, 'the Balearic province has several districts');
  // names: the largest settlement of a land district, a number for the rest
  const names = districtNames(a, data.vectors.places);
  assert.equal(names.length, a.count);
  assert.equal(names[a.district[real.ch.at(40.40, -3.69)]], 'Мадрид');
  // as drawn: the district the player sees around the town has its name
  const drawnAt = (lat, lon) => { const [x, y] = kmOf(lat, lon); return pick(fa.land, x, y, fa.river); };
  const drawn = districtNames(a, data.vectors.places, drawnAt);
  for (const pl of data.vectors.places.filter(q => ['Мадрид', 'Сарагоса', 'Севилья', 'Барселона'].includes(q.name))) assert.equal(drawn[drawnAt(pl.lat, pl.lon)], pl.name);
  assert.match(names[a.district[real.ch.at(40.5, -11.5 + 1.8)]], /^Морской район № \d+$/);
  assert.equal(new Set(names).size, names.length, 'no two districts share a name');
  // a sea district at the open Atlantic is bigger than a coastal one
  open = a.district[real.ch.at(40.5, -11.5 + 1.8)]; const size = a.chunks[open].length;
  assert.equal(a.kinds[open], SEA); assert.ok(size >= 9, `open sea piece of ${size} chunks`);
});
