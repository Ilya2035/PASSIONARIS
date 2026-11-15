// The division in the mountains (docs/album/division.md, «Горы: граница по гребню, стены, город на дне долины»): the
// catchments the districts are cut along, how much of a mountain the land is, the walls where nobody can pass; on the
// album's real data, the borders of the districts on the crests and the towns on the valley floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, llOf, kmOf } from '../src/album/chunks.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { KN as FN } from '../src/album/division/km.js';
import { catchmentUnits, mountainRaster, MOUNTAIN } from '../src/album/division/cells.js';
import { impassablePairs, wallLines } from '../src/album/division/walls.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// a made-up range: land x 100…159, y 100…139, the sea all round; two valleys along x (y 110 and 130) with a ridge
// between them (y 120) and rims at the edges, all falling toward the sea at x 100
const N = FN * FN, land = new Int32Array(N).fill(-1), hgt = new Float32Array(N);
for (let y = 100; y < 140; y++) for (let x = 100; x < 160; x++) { const t = y * FN + x; land[t] = 0; hgt[t] = 5 + 15 * (x - 100) + 1000 * (1 + Math.cos(2 * Math.PI * (y - 100) / 20)); }
const at = (x, y) => y * FN + x;

test('division in the mountains: catchments — a valley with both its slopes, the ridge between two', () => {
  const u = catchmentUnits(hgt, land);
  for (let t = 0; t < N; t++) assert.equal(u.of[t] >= 0, land[t] >= 0);
  let banks = 0, n = 0;
  for (let x = 104; x < 156; x++) {
    assert.notEqual(u.of[at(x, 119)], u.of[at(x, 121)], `the ridge at x ${x} divides`);
    assert.notEqual(u.of[at(x, 112)], u.of[at(x, 128)], `two valleys at x ${x}`);
    n += 2; if (u.of[at(x, 107)] === u.of[at(x, 113)]) banks++; if (u.of[at(x, 127)] === u.of[at(x, 133)]) banks++;
  }
  assert.ok(banks / n > .8, `both slopes of a valley are one catchment: ${banks} of ${n}`);
  // a stream is cut into stretches: a valley 60 km long is more than one catchment
  const along = new Set(); for (let x = 101; x < 159; x++) along.add(u.of[at(x, 110)]);
  assert.ok(along.size >= Math.floor(58 / (MOUNTAIN.run + 1)), `${along.size} stretches along a valley of 60 km`);
  // water runs down or along, never up
  for (let t = 0; t < N; t++) if (u.down[t] >= 0) assert.ok(hgt[u.down[t]] <= hgt[t] + 1e-3, 'downhill');
  // the same land, the same catchments
  assert.deepEqual(catchmentUnits(hgt, land).of, u.of);
});

test('division in the mountains: how much of a mountain the land is', () => {
  const m = mountainRaster(hgt, land);
  assert.equal(m[at(130, 110)], 1, 'a range rising and falling by 690 m within 4 km, and 120 m along it');
  const flat = new Float32Array(N); for (let t = 0; t < N; t++) flat[t] = land[t] >= 0 ? 200 : 0;
  assert.equal(mountainRaster(flat, land)[at(130, 110)], 0, 'a plain');
  assert.equal(m[at(10, 10)], 0, 'the sea');
});

test('division in the mountains: the walls — neighbours with no way between them, along their border', () => {
  const cells = new Int32Array(N).fill(-1);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 40; x++) cells[at(x, y)] = x < 20 ? 0 : x < 30 ? 1 : 2;
  const div = { cells, kinds: [LAND, LAND, LAND], count: 3 }, centres = { texel: Int32Array.from([1, 1, 1]) };
  assert.deepEqual(impassablePairs(div, centres, [{ a: 0, b: 1 }]), [[1, 2]], 'a leg between 0 and 1, none between 1 and 2');
  assert.deepEqual(impassablePairs(div, centres, [{ a: 1, b: 0 }, { a: 2, b: 1 }]), [], 'every pair has its way');
  assert.deepEqual(impassablePairs(div, { texel: Int32Array.from([1, 1, -1]) }, [{ a: 0, b: 1 }]), [], 'a district with no town is not walled');
  assert.deepEqual(impassablePairs(div, centres, [{ a: 0, b: 1 }], new Set([1 * 65536 + 2])), [], 'a road goes over the border of 1 and 2: no wall');
  const geo = { lines: [{ pts: [[0, 0], [1, 0], [2, 0], [3, 0]], labs: [0 | 1 << 16, 2 | 1 << 16, 1 | 2 << 16] }] };
  assert.deepEqual(wallLines(geo, [[1, 2]]), [[[1, 0], [2, 0], [3, 0]]], 'the run of pieces between the two, either side');
  // (the owner, 15.11.2026: not drawn — data only, the roads will show it one day)
  assert.equal(DEFS.find(k => k.key === 'divWalls'), undefined, 'no knob: the walls are not drawn');
});

// ---- the album's real data
const data = loadAlbumData(ROOT);
const skip = !data && 'public/album-data/ is not there';
const real = data ? (() => {
  const json = f => JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division', f), 'utf8'));
  const ch = new Chunks(data.base.at, data.vectors.rivers);
  return { div: buildDivision(ch, { lands: json('lands.json'), admin: json('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size: 20 }) };
})() : null;
// the share of the length of the district borders in a box that runs within 750 m of a crest (a top of the heights
// across the line, ±3 km, with the land 60 m lower on both sides within 1.5 km); the lines moved by (dx, dy) km show
// what a line that does not look for crests gets
function onCrest(div, box, dx = 0, dy = 0) {
  const H = (x, y) => { const p = llOf(x, y); return data.base.at(p.lat, p.lon); };
  let all = 0, crest = 0;
  for (const L of div.geo.lines) {
    if (L.key !== 0) continue;
    for (let i = 1; i < L.pts.length; i++) {
      const [ax, ay] = L.pts[i - 1], [bx, by] = L.pts[i], len = Math.hypot(bx - ax, by - ay); if (!len) continue;
      const x = (ax + bx) / 2 + dx, y = (ay + by) / 2 + dy, p = llOf(x, y);
      if (p.lat < box[0] || p.lat > box[1] || p.lon < box[2] || p.lon > box[3]) continue;
      const nx = -(by - ay) / len, ny = (bx - ax) / len, prof = []; for (let q = -12; q <= 12; q++) prof.push(H(x + nx * q * .25, y + ny * q * .25));
      if (Math.max(...prof) - Math.min(...prof) < 200) continue;
      all += len;
      for (let c = 9; c <= 15; c++) if (prof[c] >= prof[c - 1] && prof[c] >= prof[c + 1] && prof[c] - Math.min(...prof.slice(c - 6, c)) >= 60 && prof[c] - Math.min(...prof.slice(c + 1, c + 7)) >= 60) { crest += len; break; }
    }
  }
  return crest / all;
}

test('division of the album in the mountains: the borders of the districts run on the crests', { skip }, () => {
  for (const [name, box] of [['the Pyrenees', [42.25, 43.25, -2.0, 3.3]], ['the Cantabrian range', [42.6, 43.45, -7.3, -3.4]], ['the Sierra Nevada', [36.85, 37.3, -3.75, -2.5]]]) {
    const on = onCrest(real.div, box), by = onCrest(real.div, box, 3.1, 2.3);
    assert.ok(on > .42 && on > by + .12, `${name}: ${(on * 100).toFixed(0)} % of the district borders on a crest, ${(by * 100).toFixed(0)} % for the same lines moved`);
  }
});

test('division of the album in the mountains: a town by the rule stands on the valley floor', { skip }, () => {
  const { div } = real, sites = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  const cen = districtCentres(div, sites), hgt = div.raster.hgt, mtn = div.raster.mtn;
  let n = 0, up = 0;
  for (let d = 0; d < div.count; d++) {
    const t = cen.texel[d]; if (t < 0 || cen.why[d] === 0 || mtn[t] < .8) continue;
    let lo = hgt[t], hi = hgt[t];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const u = t + dj * FN + di, e = div.cells[u]; if (e >= 0 && div.kinds[e] === LAND) { lo = Math.min(lo, hgt[u]); hi = Math.max(hi, hgt[u]); } }
    n++; if ((hgt[t] - lo) / Math.max(1, hi - lo) > .35) up++;
  }
  assert.ok(n > 100, `${n} districts with a town by the rule in the mountains`);
  assert.ok(up <= n * .02, `${up} of ${n} stand up a slope`);
});
