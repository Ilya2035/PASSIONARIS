// Unit tests for the regions bake library (no baked data needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, Heap, components, mulberry32 } from '../scripts/regions/grid.mjs';
import { grow, lloyd, jitteredPoints } from '../scripts/regions/partition.mjs';
import { genitive, translit, qualify, compassLabels, disambiguate, buildRiverNamer, genderOf } from '../scripts/regions/names.mjs';
import { simplifyDP, polylineKm } from '../scripts/regions/roads.mjs';
import { groupGraph } from '../scripts/regions/group.mjs';
import { distanceKm, seaSideKm } from '../scripts/regions/water.mjs';
import { rasterLine } from '../scripts/regions/raster.mjs';

test('heap pops in key order with deterministic ties', () => {
  const h = new Heap(2);
  const rng = mulberry32(7);
  const keys = [];
  for (let i = 0; i < 500; i++) { const k = Math.floor(rng() * 50); keys.push([k, i]); h.push(k, i); }
  keys.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [k, v] of keys) { assert.equal(h.pop(), v); assert.equal(h.topKey, k); }
  assert.equal(h.size, 0);
});

test('Russian genitive of geographic names', () => {
  const cases = {
    'Волга': 'Волги', 'Дон': 'Дона', 'Рейн': 'Рейна', 'Луара': 'Луары', 'Обь': 'Оби', 'Енисей': 'Енисея', 'Ока': 'Оки',
    'Конго': 'Конго', 'Миссисипи': 'Миссисипи', 'Белая': 'Белой', 'Северная Двина': 'Северной Двины', 'Нижний Рейн': 'Нижнего Рейна',
    'Чёрное море': 'Чёрного моря', 'Тихий океан': 'Тихого океана', 'Бенгальский залив': 'Бенгальского залива',
    'Ладожское озеро': 'Ладожского озера', 'море Лаптевых': 'моря Лаптевых', 'Колумбия': 'Колумбии', 'Омолой': 'Омолоя',
    'Арагуая': 'Арагуаи', 'Сырдарья': 'Сырдарьи', 'Баренцево море': 'Баренцева моря',
  };
  for (const [nom, gen] of Object.entries(cases)) assert.equal(genitive(nom), gen, nom);
});

test('river namer: dictionary, aliases, canals and transliteration', () => {
  const name = buildRiverNamer(new Map([['Sukhona', 'Сухона']]));
  assert.equal(name('Rhein').ru, 'Рейн');
  assert.equal(name('Rhine').key, name('Rhin').key);
  assert.equal(name('Volga').gen, 'Волги');
  assert.equal(name('Suez Canal'), null);
  assert.equal(name('Sukhona').ru, 'Сухона');
  assert.match(translit('Shishhid'), /^[А-Яа-яЁё]+$/);
  assert.equal(translit('Zhuk'), 'Жук');
});

test('compass qualifiers agree in gender and stay unique', () => {
  assert.equal(qualify('Альпы', 'W'), 'Западные Альпы');
  assert.equal(qualify('Долина Луары', 'N'), 'Северная долина Луары');
  assert.equal(qualify('Междуречье Волги и Дона', 'SE'), 'Юго-Восточное междуречье Волги и Дона');
  assert.equal(qualify('Кавказ', 'C'), 'Центральный Кавказ');
  assert.equal(genderOf('Горы Лебомбо'), 'p');
  const pts = [];
  for (let k = 0; k < 7; k++) pts.push({ lon: 10 + Math.cos(k) * 3, lat: 45 + Math.sin(k) * 2 });
  const labs = compassLabels(pts);
  assert.ok(labs);
  assert.equal(new Set(labs).size, labs.length);
  const items = Array.from({ length: 14 }, (_, k) => ({ base: 'Равнина', key: 'plain', lon: k, lat: 0, gender: 'f', commonHead: true }));
  items.push({ base: 'Альпы', key: 'range:Alps', lon: 7, lat: 46 }, { base: 'Альпы', key: 'range:Alps', lon: 13, lat: 47 });
  disambiguate(items);
  const names = items.map(i => i.nameRu);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('Западные Альпы') && names.includes('Восточные Альпы'));
  assert.ok(names.includes('Равнина №1') && names.includes('Равнина №14'));
});

// Synthetic world: a small grid, land band split by a vertical "river" line.
function synthetic() {
  const grid = makeGrid(512, 256); // ~78 km texels at the equator
  const { W, H, N } = grid;
  const comp = new Int32Array(N).fill(-1);
  for (let y = 80; y < 176; y++) for (let x = 100; x < 400; x++) comp[y * W + x] = 0;
  // river: diagonal line from (250,80) to (230,175) -> barrier
  const barrier = new Uint8Array(N);
  rasterLine(grid, [[grid.colLon[250], grid.rowLat[80]], [grid.colLon[230], grid.rowLat[175]]], t => { barrier[t] = 1; });
  const cls = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (comp[i] === 0 && !barrier[i]) cls[i] = 0;
  return { grid, cls, barrier };
}

test('partition respects river barriers, covers compartments and is deterministic', () => {
  const { grid, cls, barrier } = synthetic();
  const cc = components(grid, cls);
  assert.equal(cc.count, 2, 'the river splits the band into two compartments');
  const run = () => {
    const rng = mulberry32(1);
    const pts = jitteredPoints(400, rng);
    const seeds = [];
    for (let k = 0; k < pts.length; k += 2) { const t = grid.texelOf(pts[k], pts[k + 1]); if (cc.comp[t] >= 0) seeds.push(t); }
    for (let c = 0; c < cc.count; c++) if (!seeds.some(t => cc.comp[t] === c)) seeds.push(cc.first[c]);
    const label = new Int32Array(grid.N), dist = new Float64Array(grid.N);
    const res = lloyd(grid, label, dist, { comp: cc.comp, seeds, targetOf: () => 400 * 400, iterations: 3 });
    return { label, seeds: res.seeds };
  };
  const a = run(), b = run();
  assert.deepEqual(a.seeds, b.seeds);
  assert.deepEqual(a.label, b.label);
  const { W, N } = grid;
  // every compartment texel is labelled; no region spans both compartments
  const compOfLabel = new Map();
  for (let i = 0; i < N; i++) {
    if (cc.comp[i] < 0) { assert.equal(a.label[i], -1); continue; }
    assert.ok(a.label[i] >= 0);
    const c = compOfLabel.get(a.label[i]);
    if (c === undefined) compOfLabel.set(a.label[i], cc.comp[i]); else assert.equal(c, cc.comp[i]);
  }
  assert.ok(compOfLabel.size >= 6, `expected several regions, got ${compOfLabel.size}`);
  // texels left and right of the river belong to different regions
  for (let y = 85; y < 170; y += 5) {
    let xr = -1;
    for (let x = 200; x < 280; x++) if (barrier[y * W + x]) { xr = x; break; }
    if (xr < 0) continue;
    assert.notEqual(a.label[y * W + xr - 2], a.label[y * W + xr + 3]);
  }
});

test('grow: diagonal moves cannot cut through a thin barrier', () => {
  const grid = makeGrid(64, 32);
  const { W, N } = grid;
  const comp = new Int32Array(N).fill(0);
  // 8-connected diagonal barrier (separate compartment id 1) + a wall at x = 63
  // so the lower-left triangle is only reachable by cutting diagonal corners
  for (let k = 0; k < 32; k++) { comp[k * W + k] = 1; comp[k * W + 63] = 1; }
  const label = new Int32Array(N), dist = new Float64Array(N);
  grow(grid, label, dist, { comp, seeds: [5 * W + 20] });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 63; x++) {
    const i = y * W + x;
    if (x < y) assert.equal(label[i], -1, `leak at ${x},${y}`);
    else if (x > y) assert.equal(label[i], 0, `unreached ${x},${y}`);
    else assert.equal(label[i], -1);
  }
});

test('Douglas-Peucker keeps endpoints and removes collinear points', () => {
  const pts = [];
  for (let k = 0; k <= 20; k++) pts.push(10 + k * 0.05, 50);
  const s = simplifyDP(Float64Array.from(pts), 2);
  assert.equal(s.length, 4);
  // a parallel is not a great circle: lengths agree to a few metres over ~70 km
  assert.ok(Math.abs(polylineKm(s) - polylineKm(Float64Array.from(pts))) < 0.05);
  const zig = Float64Array.from([0, 0, 0.5, 0.3, 1, 0]);
  assert.equal(simplifyDP(zig, 2).length, 6);
});

test('graph grouping yields contiguous balanced groups', () => {
  // 20 x 10 lattice of unit-weight nodes
  const nx = 20, ny = 10, n = nx * ny;
  const g = { n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), weight: new Float64Array(n).fill(1), adj: Array.from({ length: n }, () => []) };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, lon = i * 0.5 * Math.PI / 180, lat = j * 0.5 * Math.PI / 180;
    g.x[k] = Math.cos(lat) * Math.sin(lon); g.y[k] = Math.sin(lat); g.z[k] = Math.cos(lat) * Math.cos(lon);
    if (i + 1 < nx) { g.adj[k].push([k + 1, 1, 1]); g.adj[k + 1].push([k, 1, 1]); }
    if (j + 1 < ny) { g.adj[k].push([k + nx, 1, 1]); g.adj[k + nx].push([k, 1, 1]); }
  }
  const r = groupGraph(g, { target: 25 });
  assert.ok(r.count >= 6 && r.count <= 10, `groups: ${r.count}`);
  for (let c = 0; c < r.count; c++) {
    const members = [];
    for (let k = 0; k < n; k++) if (r.group[k] === c) members.push(k);
    assert.ok(members.length >= 8, `group ${c} size ${members.length}`);
    // contiguity
    const seen = new Set([members[0]]), q = [members[0]];
    while (q.length) { const k = q.pop(); for (const [j] of g.adj[k]) if (r.group[j] === c && !seen.has(j)) { seen.add(j); q.push(j); } }
    assert.equal(seen.size, members.length);
  }
});

test('distance transform and sea-zone sizing', () => {
  const grid = makeGrid(256, 128);
  const src = new Uint8Array(grid.N);
  src[64 * 256 + 128] = 1;
  const d = distanceKm(grid, src);
  assert.equal(d[64 * 256 + 128], 0);
  const one = d[64 * 256 + 129];
  assert.ok(Math.abs(one - grid.dxKm[64]) < 1e-3);
  assert.ok(d[64 * 256 + 140] > d[64 * 256 + 135]);
  assert.equal(seaSideKm(0), 200);
  assert.equal(seaSideKm(5000), 800);
  assert.ok(seaSideKm(600) > 200 && seaSideKm(600) < 800);
});
