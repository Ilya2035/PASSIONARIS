// Tracks to the villages (src/album/town/tracks.js, docs/album/settle.md): the tree of ways of a district, the
// tracks drawn for its settled villages. On made-up land, and on the album's real data when public/album-data/ is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf } from '../src/album/chunks.js';
import { KN, KX0, KY0, squareOf, kmFacts } from '../src/album/division/km.js';
import { buildDivision } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { roadNetwork } from '../src/album/roads/routes.js';
import { decodeSites } from '../src/album/town/sites.js';
import { districtSites } from '../src/album/town/villages.js';
import { roadChunks, districtTracks, trackLines, trackIndex, TRACK_SMOOTH, TRACK_STEPS, TRACK_ON_ROAD, TRACK_SNAP, TRACK_UNEVEN, TRACK_BY_PLACE } from '../src/album/town/tracks.js';
import settle from '../src/album/aspects/settle.js';
import { PAGES } from '../src/album/pages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- a made-up division on the lattice of chunks: two land districts of 20 × 20 km side by side, the sea around.
// District 0 is level ground. District 1 rises eastward and has a river down its column 632. A road runs along row
// 610 from the centre of district 0 (column 610) to the centre of district 1 (column 624).
const I0 = 600, J0 = 600, D = 20, ROW = J0 + 10;
const x = k => KX0 + k + .5, y = k => KY0 + k + .5;
function land() {
  const n = KN * KN, cells = new Int32Array(n).fill(2), hgt = new Float32Array(n), riv = new Uint8Array(n), cls = new Uint8Array(n);
  for (let j = J0; j < J0 + D; j++) for (let i = I0; i < I0 + 2 * D; i++) {
    const c = j * KN + i, d = i < I0 + D ? 0 : 1; cells[c] = d; hgt[c] = d ? 400 + (i - I0 - D) * 8 : 200; cls[c] = d ? 2 : 1; if (i === I0 + 32) riv[c] = 2;
  }
  const div = { count: 3, cells, kinds: [0, 0, 1], raster: { hgt, riv },
    centres: { x: Float64Array.of(x(I0 + 10), x(I0 + 24), NaN), y: Float64Array.of(y(ROW), y(ROW), NaN), site: Int32Array.of(0, -1, -1), texel: Int32Array.of(ROW * KN + I0 + 10, ROW * KN + I0 + 24, -1) } };
  const road = { a: 0, b: 1, kind: 2, path: Array.from({ length: 15 }, (_, k) => ROW * KN + I0 + 10 + k) }, none = { a: 0, b: 1, kind: 3, path: Array.from({ length: 15 }, (_, k) => (J0 + 2) * KN + I0 + 10 + k) };
  return { div, facts: { cls }, G: { hgt, riv }, legs: [road, none] };
}
const sitesOf = pts => pts.map(([i, j, pop = 900], k) => ({ x: x(i) + .2, y: y(j) - .15, pop, name: 'Село ' + k }));
// the way of a place: its nodes from the place to the end
const wayOf = (tree, p) => { const out = []; for (let k = tree.start[p], n = 0; k >= 0; k = tree.up[k]) { out.push(k); assert.ok(++n <= tree.n, 'a way never runs in a ring'); } return out; };

test('tracks: every place of a district has its way to the road of the district — over its own land, the cheapest', () => {
  const { div, facts, G, legs } = land(), onRoad = roadChunks(legs);
  // the road is its laid legs only
  let marked = 0; for (const v of onRoad) marked += v; assert.equal(marked, 15); assert.equal(onRoad[ROW * KN + I0 + 12], 1); assert.equal(onRoad[(J0 + 2) * KN + I0 + 12], 0, 'a leg that is no road carries none');
  const sites = [{ x: x(I0 + 10), y: y(ROW), pop: 40000, name: 'Центр' }, ...sitesOf([[I0 + 4, J0 + 3], [I0 + 15, J0 + 17], [I0 + 2, J0 + 16], [I0 + 12, J0 + 10], [I0 + 36, J0 + 4], [I0 + 37, J0 + 15]])];
  const list = districtSites(div, facts, sites), t0 = districtTracks(div, G, list, 0, onRoad), t1 = districtTracks(div, G, list, 1, onRoad);
  assert.equal(districtTracks(div, G, list, 2, onRoad), null, 'the sea has no ways');
  for (const [d, tree] of [[0, t0], [1, t1]]) {
    const s0 = list.first[d], places = list.first[d + 1] - s0; assert.equal(tree.start.length, places); assert.equal(tree.start[0], -1, 'the centre needs no way');
    assert.ok(tree.roads > 0 && tree.n > places);
    for (let p = 1; p < places; p++) {
      assert.ok(tree.start[p] >= 0, `place ${p} of district ${d} has a way`);
      const way = wayOf(tree, p), first = way[0], last = way[way.length - 1];
      // it begins at the place and ends on a chunk the road runs over, and never leaves the district
      assert.ok(Math.abs(tree.x[first] - list.x[s0 + p]) < 1e-3 && Math.abs(tree.y[first] - list.y[s0 + p]) < 1e-3 && tree.site[first] === p);
      assert.equal(tree.up[last], -1); assert.ok(tree.end[last] === 1 || tree.end[last] === 2); assert.equal(onRoad[tree.chunk[last]], 1);
      for (const k of way) assert.equal(div.cells[tree.chunk[k]], d, 'a way never leaves its district');
      for (let q = 1; q < way.length; q++) { const a = tree.chunk[way[q - 1]], b = tree.chunk[way[q]]; assert.ok(Math.abs(a % KN - b % KN) <= 1 && Math.abs(Math.floor(a / KN) - Math.floor(b / KN)) <= 1 && a !== b, 'chunk by chunk'); }
      // about as long as the straight way to the road of the district, never much longer on level ground
      let straight = Infinity; for (let i = d ? I0 + 20 : I0 + 10; i <= (d ? I0 + 24 : I0 + 19); i++) straight = Math.min(straight, Math.hypot(list.x[s0 + p] - x(i), list.y[s0 + p] - y(ROW)));
      assert.ok(tree.km[p] >= straight - 1.2, `${tree.km[p].toFixed(1)} km against ${straight.toFixed(1)}`);
      if (d === 0) assert.ok(tree.km[p] < straight * 1.5 + 2.5, `a way of ${tree.km[p].toFixed(1)} km to a road ${straight.toFixed(1)} km away`);
    }
    // one tree: a node has one step toward the road; ways that meet go on together
    const again = districtTracks(div, G, list, d, onRoad); assert.deepEqual([...again.up], [...tree.up]); assert.deepEqual([...again.x], [...tree.x]); assert.deepEqual([...again.chunk], [...tree.chunk]);
    assert.equal(new Set(tree.chunk).size, tree.n);
  }
  // the centre of district 0 is where the road is: a way that ends there ends at the centre itself
  const atCentre = [...t0.end].map((e, k) => (e === 2 ? k : -1)).filter(k => k >= 0);
  for (const k of atCentre) assert.ok(Math.abs(t0.x[k] - x(I0 + 10)) < 1e-3 && t0.site[k] === 0);
  // a river is crossed once: the ways of the places east of the river of district 1
  const s1 = list.first[1];
  for (let p = 1; p < t1.start.length; p++) { if (list.x[s1 + p] < x(I0 + 33)) continue; const wet = wayOf(t1, p).filter(k => div.raster.riv[t1.chunk[k]] > 0).length; assert.ok(wet <= 1, `the way of place ${p} steps on the river ${wet} times`); }
  assert.ok(TRACK_UNEVEN > 0 && TRACK_UNEVEN < .6 && TRACK_BY_PLACE > .4 && TRACK_BY_PLACE < 1 && TRACK_SMOOTH >= 1);
});

test('tracks: a district without a road — the ways lead to its centre; a place that stands on the road chunk', () => {
  const { div, facts, G } = land(), none = new Uint8Array(KN * KN);
  const sites = [{ x: x(I0 + 10), y: y(ROW), pop: 40000, name: 'Центр' }, ...sitesOf([[I0 + 4, J0 + 3], [I0 + 16, J0 + 16]])];
  const list = districtSites(div, facts, sites), tree = districtTracks(div, G, list, 0, none);
  assert.equal(tree.roads, 0);
  for (let p = 1; p < tree.start.length; p++) { const way = wayOf(tree, p), last = way[way.length - 1]; assert.equal(tree.end[last], 2); assert.equal(tree.chunk[last], ROW * KN + I0 + 10); assert.ok(Math.abs(tree.x[last] - x(I0 + 10)) < 1e-3); }
  // with the road: a village in a chunk the road runs over has no way to walk — a few steps to the road as it is drawn
  const { legs } = land(), onRoad = roadChunks(legs), by = [{ x: x(I0 + 10), y: y(ROW), pop: 40000, name: 'Центр' }, { x: x(I0 + 15) + .1, y: y(ROW) + .35, pop: 900, name: 'У дороги' }];
  const l2 = districtSites(div, facts, by), t2 = districtTracks(div, G, l2, 0, onRoad), k = t2.start[1];
  assert.ok(k >= 0 && t2.up[k] === -1 && t2.end[k] === 1 && t2.km[1] === 0);
  const snap = (px, py) => [px, y(ROW)], lines = trackLines(t2, p => (p === 1 ? .08 : 0), snap);
  assert.equal(lines.length, 1); assert.ok(Math.abs(lines[0].km - (.35 - .08)) < .01, `a stub of ${lines[0].km.toFixed(2)} km`);
  assert.ok(Math.abs(lines[0].pts[lines[0].pts.length - 1][1] - y(ROW)) < 1e-6 && Math.abs(lines[0].pts[0][1] - (y(ROW) + .35 - .08)) < 1e-3, 'from the last houses to the road');
  assert.equal(trackLines(t2, p => (p === 1 ? .08 : 0)).length, 0, 'without the drawn road there is nothing to walk to');
  assert.equal(trackLines(t2, p => (p === 1 ? .4 : 0), snap).length, 0, 'a village that reaches the road needs no track'); assert.ok(TRACK_ON_ROAD < .1 && TRACK_SNAP > 1);
});

test('tracks: drawn for the settled villages only — from the last houses, every piece of the tree once, village to village', () => {
  const { div, facts, G, legs } = land(), onRoad = roadChunks(legs);
  // three villages in a row north of the road: the way of the farthest passes the chunks of the nearer ones
  const sites = [{ x: x(I0 + 10), y: y(ROW), pop: 40000, name: 'Центр' }, ...sitesOf([[I0 + 14, J0 + 13], [I0 + 14, J0 + 16], [I0 + 14, J0 + 19], [I0 + 4, J0 + 2]])];
  const list = districtSites(div, facts, sites.slice(0, 5)), s0 = list.first[0], tree = districtTracks(div, G, list, 0, onRoad);
  const real = [1, 2, 3, 4], R = .09, way = p => wayOf(tree, p);
  assert.ok(way(3).includes(tree.start[2]) && way(3).includes(tree.start[1]), 'the way of the far village passes through the two nearer ones'); assert.ok(way(2).includes(tree.start[1]));
  assert.ok(tree.km[3] > tree.km[2] && tree.km[2] > tree.km[1]);
  // nobody settled: no tracks
  assert.equal(trackLines(tree, () => 0).length, 0);
  // only the far village settled: one track, its whole way, from its last houses to the road
  const one = trackLines(tree, p => (p === 3 ? R : 0));
  assert.equal(one.length, 1); assert.equal(one[0].place, 3); assert.ok(Math.abs(one[0].km - (tree.km[3] - R)) < .1 + .05 * tree.km[3], `${one[0].km.toFixed(2)} km of a way of ${tree.km[3].toFixed(2)}`);
  assert.ok(Math.abs(Math.hypot(one[0].pts[0][0] - list.x[s0 + 3], one[0].pts[0][1] - list.y[s0 + 3]) - R) < .01, 'it begins at the last houses');
  const end = one[0].pts[one[0].pts.length - 1]; assert.ok(Math.abs(end[1] - y(ROW)) < 1e-3, 'and ends in the chunk of the road');
  for (const q of one[0].pts) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]));
  assert.ok(one[0].pts.length >= (way(3).length - 1) * TRACK_STEPS, 'a smooth line through the chunks of the way');
  // all three settled: three pieces, village to village; no piece of the tree is drawn twice
  const all = trackLines(tree, p => (p <= 3 ? R : 0));
  assert.equal(all.length, 3); assert.deepEqual(all.map(l => l.place).sort(), [1, 2, 3]);
  const total = all.reduce((a, l) => a + l.km, 0); assert.ok(Math.abs(total - (tree.km[3] - 5 * R)) < .1 + .05 * tree.km[3], `${total.toFixed(2)} km of track for a way of ${tree.km[3].toFixed(2)} km through two villages`);
  const far = all.find(l => l.place === 3), last = far.pts[far.pts.length - 1];
  assert.ok(Math.abs(Math.hypot(last[0] - list.x[s0 + 2], last[1] - list.y[s0 + 2]) - R) < .01, 'the track stops at the first houses of the next village');
  // the snap: the last point of the track that reaches the road is the point of the road as drawn
  const snapped = trackLines(tree, p => (p <= 3 ? R : 0), (px, py) => [px + .2, py - .1]), near = snapped.find(l => l.place === 1), e = near.pts[near.pts.length - 1], rootK = way(1)[way(1).length - 1];
  assert.ok(Math.abs(e[0] - (tree.x[rootK] + .2)) < 1e-4 && Math.abs(e[1] - (tree.y[rootK] - .1)) < 1e-4);
  // a village elsewhere has its own track; the index finds the tracks near a point
  const four = trackLines(tree, p => (real.includes(p) ? R : 0)); assert.equal(four.length, 4);
  const nearTrack = trackIndex(four), mid = far.pts[far.pts.length >> 1];
  assert.ok(nearTrack(mid[0], mid[1]) < 1e-6 && nearTrack(mid[0] + .05, mid[1]) < .06 && nearTrack(mid[0] + .05, mid[1]) > .01); assert.equal(nearTrack(x(I0 + 18), y(J0 + 18)), 1e9, 'far from every track');
  // a town at the centre: a way that ends there stops at its first houses
  const none = new Uint8Array(KN * KN), toCentre = districtTracks(div, G, list, 0, none), town = trackLines(toCentre, p => (p === 0 ? .8 : p === 4 ? R : 0));
  assert.equal(town.length, 1); const te = town[0].pts[town[0].pts.length - 1]; assert.ok(Math.abs(Math.hypot(te[0] - x(I0 + 10), te[1] - y(ROW)) - .8) < .02);
});

test('tracks in the album: the lanes of a settlement end by its houses, the pages are there', () => {
  const g = settle.glsl;
  assert.match(g, /float laneOut = \.1 \+ \.45 \* r;/); assert.match(g, /m > -laneOut/, 'past its last houses the tracks lead on, not the lanes');
  for (const id of ['tracks', 'tracks-hills', 'tracks-60', 'tracks-check']) { const pg = PAGES.find(p => p.id === id); assert.ok(pg && pg.group === 'Города и дороги' && pg.note.length > 60, id); }
  assert.equal(PAGES.find(p => p.id === 'tracks-check').p.sitesShow, 1);
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('tracks of the album: every place has a way to the roads of its district, some six kilometres long', { skip }, () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), sitesFile = join(ROOT, 'public/assets/album/town/sites.json.gz');
  const osm = existsSync(sitesFile) ? decodeSites(JSON.parse(gunzipSync(readFileSync(sitesFile)))) : [];
  const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const div = buildDivision(ch, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [px, py] = kmOf(p.lat, p.lon); return { x: px, y: py, pop: p.pop, name: p.name }; });
  const sites = [...own, ...osm.filter(s => { const [px, py] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - px, o.y - py) < 6); })];
  div.centres = districtCentres(div, sites);
  const at = (px, py) => data.base.at(py / 111.195, px / (111.195 * Math.cos(40 * Math.PI / 180))), facts = kmFacts(div, data.base.at);
  const list = districtSites(div, facts, sites, { base: own.length, at }), net = roadNetwork(div, div.centres, data.vectors.places), onRoad = roadChunks(net.legs), G = { hgt: div.raster.hgt, riv: div.raster.riv };
  const t0 = Date.now(), lens = []; let trees = 0, ways = 0, none = 0, km = 0, pieces = 0, sum = 0;
  for (let d = 0; d < div.count; d++) {
    const tree = districtTracks(div, G, list, d, onRoad); if (!tree) continue; trees++;
    for (let p = 1; p < tree.start.length; p++) {
      if (tree.start[p] < 0) { none++; continue; }
      ways++; if (tree.up[tree.start[p]] >= 0) lens.push(tree.km[p]); sum += tree.km[p];
    }
    for (let k = 0; k < tree.n; k++) if (div.cells[tree.chunk[k]] !== d) assert.fail('a way of district ' + d + ' leaves it');
    // every place settled: the tracks of the district, each piece once
    const lines = trackLines(tree, p => (p ? .06 : .3)); pieces += lines.length; for (const l of lines) km += l.km;
  }
  const ms = Date.now() - t0; lens.sort((a, b) => a - b);
  assert.ok(trees > 1800 && ways > 30000 && none < ways * .01, `${ways} places with a way, ${none} without`);
  const mid = lens[lens.length >> 1]; assert.ok(mid > 3 && mid < 10, `a way is ${mid.toFixed(1)} km in the middle`);
  assert.ok(km < sum * .75 && km > sum * .2, `${Math.round(km)} km of track for ${Math.round(sum)} km of ways: the ways of a district share their tracks`);
  assert.ok(pieces > ways * .8 && pieces <= ways, `${pieces} pieces for ${ways} places`);
  assert.ok(ms < 6000, `the trees and tracks of every district: ${ms} ms`);
});
