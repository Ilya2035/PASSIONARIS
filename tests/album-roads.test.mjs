// Roads of the album (docs/album/roads.md): the centres of districts, the cheapest way between two of them over the
// relief, the network laid beforehand and kept in a file, the crossings of rivers, the roads at the edge of a
// settlement — everything that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, kmOf, llOf } from '../src/album/chunks.js';
import { KN as FN, KKM as FKM } from '../src/album/division/km.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { loadAlbumData } from '../src/album/division/nodedata.js';
import { roadGround, legBetween, stepCost, roadNetwork, roadLine, provinceTowns, encodeNet, decodeNet, netHead, netSignature,
  STEEP, HIGH, CROSSING, ALONG, HARD, SPAN_MAIN, SPAN_LESSER, POOR, NET_ALGO, PASS, passesOf, fanFrom, fineCache, crossedPairs, walkCost, WALK, chunkKinds, wayToMain, TO_MAIN } from '../src/album/roads/routes.js';
import { INFRA, LEVEL, chunkEase, levelOf, infraLevels, STEEP as STEEP_INFRA, HIGH as HIGH_INFRA } from '../src/album/roads/infra.js';
import { HISTORIC, PASSES } from '../src/album/roads/historic.js';
import { FINE, FW, cellXY, cellChunk, cellGround, fineRivers, climbs, finePoints } from '../src/album/roads/shape.js';
import { riverCrossings, squareBridges, crossingType, fordable, fordSites, cutAtTowns, townIndex, nearIndex, BRIDGE, FORD, FORD_MIN, WEAVE, TOWN_EDGE } from '../src/album/roads/crossings.js';
import { decodeSites, SITE_KINDS } from '../src/album/town/sites.js';
import { LOOK, THIN, roadFar } from '../src/album/layers/roads.js';
import { worksGeometry, WORKS } from '../src/album/roads/works.js';
import { GROUND_LIGHT } from '../src/album/layers/ribbon.js';
import { LIGHT } from '../src/album/light.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS } from '../src/album/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// a made-up island: a steep ridge 2200 m high runs north–south down its middle with one pass in it; a great river runs
// east–west across the western half. Two provinces, west and east of the ridge
const [IX0, IY0] = kmOf(39, -6), [IX1, IY1] = kmOf(42, -1), RX = (IX0 + IX1) / 2, PASS_Y = IY0 + (IY1 - IY0) * .7, RIVER_Y = IY0 + (IY1 - IY0) / 3;
function height(lat, lon) {
  const [x, y] = kmOf(lat, lon);
  if (x < IX0 || x > IX1 || y < IY0 || y > IY1) return -100;
  const gap = Math.min(1, Math.abs(y - PASS_Y) / 12);                             // the ridge sinks to a saddle at the pass
  return 300 + Math.max(0, 1900 - Math.abs(x - RX) * 160) * (.12 + .88 * gap);   // steep: 16 m up for every 100 m
}
const box = (x0, y0, x1, y1) => { const a = llOf(x0, y0), b = llOf(x1, y1); return [[a.lon, a.lat], [b.lon, a.lat], [b.lon, b.lat], [a.lon, b.lat], [a.lon, a.lat]]; };
const at = (x, y) => { const p = llOf(x, y); return [p.lat, p.lon]; };
const lands = { regions: [{ id: 'r', name: 'Остров' }], provinces: [{ id: 'w', name: 'Запад', region: 'r', admin: ['W'], at: [at(IX0 + 100, (IY0 + IY1) / 2)] }, { id: 'e', name: 'Восток', region: 'r', admin: ['E'], at: [at(IX1 - 100, (IY0 + IY1) / 2)] }],
  seas: [{ id: 's', name: 'Море', at: [at(IX0 - 100, IY0 - 100)] }], states: [] };
const admin = { units: { W: { name: 'Запад', rings: [box(IX0 - 30, IY0 - 30, RX, IY1 + 30)] }, E: { name: 'Восток', rings: [box(RX, IY0 - 30, IX1 + 30, IY1 + 30)] } } };
const river = [{ rank: 5, pts: Array.from({ length: 50 }, (_, i) => { const p = llOf(IX0 + 5 + i * (RX - 50 - IX0) / 49, RIVER_Y); return [p.lon, p.lat]; }) }];
const ch = new Chunks(height, river), div = buildDivision(ch, { lands, admin, heightAt: height, lakes: [], size: 30, rivers: river });
const texel = (x, y) => Math.floor((y - 3880) / FKM) * FN + Math.floor((x + 880) / FKM), xyOf = t => [-880 + (t % FN + .5) * FKM, 3880 + (Math.floor(t / FN) + .5) * FKM];
const towns = [{ ...llOf(IX0 + 60, IY1 - 50), pop: 9e5, name: 'Северо-запад' }, { ...llOf(IX1 - 60, IY1 - 50), pop: 8e5, name: 'Северо-восток' }, { ...llOf(IX0 + 70, IY0 + 40), pop: 7e5, name: 'Юго-запад' }, { ...llOf(IX1 - 70, IY0 + 40), pop: 6e5, name: 'Юго-восток' }];
div.centres = districtCentres(div, towns);
const G = roadGround(div), districtOf = t => { const [x, y] = kmOf(t.lat, t.lon); return div.cells[texel(x, y)]; };
// the old highway of the south, from the south-western town to the south-eastern one
const OLD = [{ name: 'Южный тракт', way: [[towns[2].lat, towns[2].lon], [towns[3].lat, towns[3].lon]] }];

test('roads: the centre of a district — on its settlement, or on low level ground by the water, never in it', () => {
  const c = div.centres; let land = 0, onRiver = 0;
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== LAND) { assert.ok(Number.isNaN(c.x[d]) && c.texel[d] < 0, 'water has no centre'); continue; }
    land++; assert.ok(c.texel[d] >= 0, 'district ' + d + ' has a centre');
    assert.equal(div.cells[texel(c.x[d], c.y[d])], d, 'the centre lies in its own district');
    if (c.site[d] < 0 && div.raster.riv[c.texel[d]]) onRiver++;
  }
  assert.ok(land > 30); assert.equal(onRiver, 0, 'a centre chosen by the lie of the land is not on a river');
  for (const [i, t] of towns.entries()) { const [x, y] = kmOf(t.lat, t.lon), d = div.cells[texel(x, y)]; assert.equal(c.site[d], i, t.name + ' is the centre of its district'); assert.ok(Math.hypot(c.x[d] - x, c.y[d] - y) < 1e-6); }
  // with no settlements at all every district still has a centre, low in it
  const bare = districtCentres(div, []); let high = 0, n = 0;
  for (let d = 0; d < div.count; d++) { if (div.kinds[d] !== LAND) continue; assert.ok(bare.texel[d] >= 0 && bare.site[d] < 0); n++;
    let low = 1e9, top = -1e9; for (let t = 0; t < FN * FN; t += 3) if (div.cells[t] === d) { low = Math.min(low, div.raster.hgt[t]); top = Math.max(top, div.raster.hgt[t]); }
    if (top - low > 200 && div.raster.hgt[bare.texel[d]] > low + (top - low) * .6) high++; }
  assert.ok(high / n < .08, high + ' of ' + n + ' centres stand high in their district');
  assert.deepEqual(districtCentres(div, towns).texel, c.texel, 'the same division gives the same centres');
});

test('roads: a leg — level ground is cheap, a slope dear, a river is crossed once and never walked along, the ridge at its pass', () => {
  assert.ok(STEEP[1] > STEEP[0] && CROSSING[3] > CROSSING[2] && CROSSING[2] > CROSSING[1] && CROSSING[1] > 0 && HARD > 3 && ALONG > 0);
  const flatA = texel(IX0 + 30, IY1 - 40), flatB = texel(IX0 + 110, IY1 - 40), flat = legBetween(G, flatA, flatB);
  assert.ok(flat && flat.path[0] === flatA && flat.path[flat.path.length - 1] === flatB);
  assert.ok(Math.abs(flat.km - 80) < 4 && flat.cost < flat.km * 1.25, 'over the plain a road is straight: ' + flat.km.toFixed(1) + ' km, cost ' + flat.cost.toFixed(1));
  assert.equal(flat.crossings.length, 0);
  // across the river: one crossing, and it costs
  const over = legBetween(G, texel(IX0 + 80, RIVER_Y - 25), texel(IX0 + 80, RIVER_Y + 25));
  assert.equal(over.crossings.length, 1, 'the river is crossed once'); assert.ok(over.cost > over.km + CROSSING[3] * .9);
  // along the river: the road keeps to the bank, it does not run in the bed
  const along = legBetween(G, texel(IX0 + 40, RIVER_Y + 3), texel(IX0 + 160, RIVER_Y + 3)); let inBed = 0; for (const t of along.path) if (G.riv[t]) inBed++;
  assert.ok(inBed <= 2, inBed + ' chunks of the way lie in the bed of the river');
  const bed = texel(IX0 + 80, RIVER_Y); assert.ok(G.riv[bed] && G.riv[bed + 1] && stepCost(G, bed, bed + 1, false) >= FKM + ALONG, 'a step along the bed is dear');
  // across the ridge: the way goes round by the pass rather than over the top
  const a = texel(RX - 30, PASS_Y - 45), b = texel(RX + 30, PASS_Y - 45), ridge = legBetween(G, a, b);
  assert.ok(ridge, 'a way over the ridge is found'); let top = 0, north = -1e9; for (const t of ridge.path) { top = Math.max(top, G.hgt[t]); north = Math.max(north, xyOf(t)[1]); }
  assert.ok(top < 1100, 'the road keeps under ' + Math.round(top) + ' m: it takes the pass, not the crest at 2200 m');
  assert.ok(north > PASS_Y - 16, 'it goes north to the pass');
  assert.ok(ridge.cost > 1.5 * Math.hypot(60, 0), 'and that way is dear');
  // steps: a slope of one in ten makes a step many times dearer than level ground; water is no ground at all
  const lvl = stepCost(G, flatA, flatA + 1, false); assert.ok(lvl < FKM * 1.2);
  assert.equal(legBetween(G, texel(IX0 - 40, IY0 - 40), flatA), null, 'no road starts in the sea');
  assert.deepEqual(legBetween(G, a, b).path, ridge.path, 'the same ground gives the same way');
});

test('roads: the network — main roads from the town of a province to the next and along the old highway, lesser roads between districts, tracks over hard ground', () => {
  const net = roadNetwork(div, div.centres, towns, G, { historic: OLD }), s = net.stats, legs = net.legs;
  assert.ok(s.main > 6 && s.lesser > 10 && s.legs > s.main + s.lesser + s.track, JSON.stringify(s));
  assert.ok(s.unreached <= 1, s.unreached + ' districts without a road');
  // every line begins and ends at the centre of a district and passes through centres only at the joints of its legs
  const centreAt = new Map(); for (let d = 0; d < div.count; d++) if (div.centres.texel[d] >= 0) centreAt.set(div.centres.x[d].toFixed(3) + ',' + div.centres.y[d].toFixed(3), d);
  const key = p => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  for (const l of net.lines) {
    assert.ok(l.pts.length >= 2 && centreAt.get(key(l.pts[0])) === l.start && centreAt.has(key(l.pts[l.pts.length - 1])), 'a line runs from centre to centre');
    assert.ok(l.pts.filter(p => centreAt.has(key(p))).length === l.legs.length + 1, 'it passes a centre at every joint of its legs');
    for (let i = 1; i < l.pts.length; i++) assert.ok(Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]) < 4, 'no jumps along a line');
    for (const [x, y] of l.pts) assert.ok(G.land[texel(x, y)], 'a road never leaves the land');
    for (const i of l.legs) assert.equal(legs[i].kind, l.kind, 'a line is of one kind');
  }
  // no leg is laid twice, and every laid leg is in a line
  const seen = new Set(); for (const l of net.lines) for (const i of l.legs) { assert.ok(!seen.has(i)); seen.add(i); }
  legs.forEach((L, i) => assert.equal(L.kind !== 3, seen.has(i)));
  // the towns of the two provinces are the largest places in them, and a main road joins them — over the pass
  const cap = net.capitals, pw = div.province[districtOf(towns[0])], pe = div.province[districtOf(towns[1])];
  assert.notEqual(pw, pe); assert.equal(cap[pw], districtOf(towns[0])); assert.equal(cap[pe], districtOf(towns[1]));
  assert.deepEqual([...provinceTowns(div, div.centres, towns)], [...cap]);
  // the division may name the main town of a province itself: the seat of the district (bit 1)
  { const seat = new Uint8Array(div.count); seat[districtOf(towns[2])] = 1; assert.equal(provinceTowns(div, { ...div.centres, seat }, towns)[pw], districtOf(towns[2])); assert.equal(provinceTowns(div, { ...div.centres, seat }, towns)[pe], cap[pe]); }
  const reach = (from, ok) => { const got = new Set([from]), q = [from]; for (const d of q) legs.forEach(L => { if (!ok(L) || (L.a !== d && L.b !== d)) return; const e = L.a === d ? L.b : L.a; if (!got.has(e)) { got.add(e); q.push(e); } }); return got; };
  const byMain = reach(cap[pw], L => L.kind === 0); assert.ok(byMain.has(cap[pe]), 'the towns of the two provinces are joined by main roads');
  assert.ok(byMain.has(districtOf(towns[2])) || reach(districtOf(towns[2]), L => L.kind === 0).has(districtOf(towns[3])), 'the old highway is a main road');
  assert.ok(net.lines.some(l => l.kind === 0 && l.name === 'Южный тракт'), 'and keeps its name');
  let crest = 0; for (const l of net.lines) for (const [x, y] of l.pts) if (Math.abs(x - RX) < 3) crest = Math.max(crest, G.hgt[texel(x, y)]);
  assert.ok(crest > 0 && crest < 1100, 'the ridge is crossed at ' + Math.round(crest) + ' m');
  // lesser roads: a leg left without a road has a way round over the roads no longer than SPAN_LESSER of it
  const way = (a, b, limit) => { const dist = new Map([[a, 0]]), open = [a]; while (open.length) { open.sort((p, q) => dist.get(p) - dist.get(q)); const d = open.shift(); if (d === b) return dist.get(d);
    legs.forEach(L => { if (L.kind === 3 || (L.a !== d && L.b !== d)) return; const e = L.a === d ? L.b : L.a, c = dist.get(d) + L.cost; if (c <= limit && c < (dist.get(e) ?? Infinity)) { dist.set(e, c); if (!open.includes(e)) open.push(e); } }); } return Infinity; };
  let bare = 0; legs.forEach(L => { if (L.kind !== 3) return; bare++; assert.ok(way(L.a, L.b, L.cost * SPAN_LESSER + 1e-6) <= L.cost * SPAN_LESSER + 1e-6, 'a leg without a road has a short way round'); });
  assert.ok(bare > 5 && SPAN_LESSER > SPAN_MAIN && SPAN_MAIN > 1, bare + ' legs are no roads');
  // a leg that climbs is a track, not a road
  for (const L of legs) { if (L.kind === 1) assert.ok(L.cost <= POOR * L.km); if (L.kind === 2) assert.ok(L.cost > POOR * L.km); }
  assert.deepEqual(roadNetwork(div, div.centres, towns, G, { historic: OLD }).stats, s, 'the same division gives the same roads');
  // a line as it is drawn: thinned (the points on a straight are dropped), its ends where they were
  const ll = roadLine(net.lines[0].pts), first = llOf(...net.lines[0].pts[0]); assert.ok(ll.length >= 2 && ll.length <= net.lines[0].pts.length && Math.abs(ll[0][0] - first.lon) < 1e-9 && Math.abs(ll[0][1] - first.lat) < 1e-9);
  // the legs that climb are shaped (roads/shape.js), the level ones keep their way chunk by chunk; without heights nothing is shaped
  { const shaped = legs.filter(L => L.fine); assert.equal(s.shaped, shaped.length); assert.ok(shaped.length > 3 && shaped.length < legs.filter(L => L.kind !== 3).length, shaped.length + ' legs shaped');
    for (const L of legs) { if (L.kind === 3) { assert.ok(!L.fine); continue; } assert.equal(!!L.fine, climbs(G, L.path), 'a leg is shaped when it climbs');
      if (!L.fine) continue; const p = finePoints(L, div.centres);
      assert.ok(p[0][0] === div.centres.x[L.a] && p[p.length - 1][1] === div.centres.y[L.b], 'a shaped leg runs from centre to centre');
      for (let k = 1; k < p.length; k++) assert.ok(Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]) < FINE.step * 2.3 + .2, 'in steps of the fine cells');
      for (const q of p) assert.ok(L.path.some(t => Math.hypot(xyOf(t)[0] - q[0], xyOf(t)[1] - q[1]) <= FINE.wide + FINE.step), 'no farther than FINE.wide from its way chunk by chunk'); }
    const level = net.lines.find(l => l.legs.every(i => !legs[i].fine)); assert.ok(level && level.pts.length === level.legs.reduce((n, i) => n + legs[i].path.length - 1, 1), 'a line of the plains has the points of its chunks');
    const bare = roadNetwork(div, div.centres, towns, G, { historic: OLD, heightAt: null }); assert.ok(bare.stats.shaped === 0 && bare.legs.every(L => !L.fine) && bare.stats.main === s.main && bare.stats.lesser === s.lesser && bare.stats.track === s.track, 'the shape changes no road of the network'); }
  assert.ok(ll[0][0] > -7 && ll[0][0] < 0 && ll[0][1] > 38 && ll[0][1] < 43, 'lines come out as lon, lat');
});

test('roads: the network is kept in a file and read back as it was; a file for another division is not used', () => {
  const net = roadNetwork(div, div.centres, towns, G, { historic: OLD }), buf = encodeNet(net, div, div.centres), back = decodeNet(buf, div, div.centres, towns);
  assert.ok(back, 'the file is read'); assert.deepEqual(back.stats, net.stats); assert.deepEqual([...back.capitals], [...net.capitals]);
  assert.equal(back.lines.length, net.lines.length);
  back.lines.forEach((l, i) => { const o = net.lines[i]; assert.equal(l.kind, o.kind); assert.equal(l.name, o.name); assert.deepEqual(l.legs, o.legs); assert.deepEqual(l.pts, o.pts); });
  back.legs.forEach((L, i) => { const o = net.legs[i]; assert.ok(L.a === o.a && L.b === o.b && L.kind === o.kind && Math.abs(L.cost - o.cost) < 1e-3); if (L.kind !== 3) { assert.deepEqual(L.path, o.path); assert.deepEqual(L.crossings, o.crossings); } });
  assert.deepEqual(back.crossings, net.crossings);
  { const src = roadNetwork(div, div.centres, towns, G, { historic: OLD }), back = decodeNet(encodeNet(src, div, div.centres), div, div.centres, towns);
    assert.ok(back && back.stats.shaped === src.stats.shaped && src.stats.shaped > 0);
    src.legs.forEach((L, i) => assert.deepEqual(back.legs[i].fine ? Array.from(back.legs[i].fine) : null, L.fine ? Array.from(L.fine) : null, 'the fine way of leg ' + i + ' comes back from the file'));
    src.lines.forEach((l, i) => assert.deepEqual(back.lines[i].pts, l.pts));
    // the town of one district moves a km: the file is for another division now and is not read — but the shape of every
    // leg that is still the same is taken from it, and comes out as if found anew
    const d0 = districtOf(towns[2]), moved = { ...div.centres, texel: Int32Array.from(div.centres.texel), x: Float64Array.from(div.centres.x), y: Float64Array.from(div.centres.y) };
    assert.ok(div.cells[moved.texel[d0] + 1] === d0); moved.texel[d0] += 1; moved.x[d0] += FKM;
    const stale = encodeNet(src, div, div.centres); assert.equal(decodeNet(stale, div, moved, towns), null);
    const cache = fineCache(stale, div, moved), again = roadNetwork(div, moved, towns, G, { historic: OLD, reuse: cache }), fresh = roadNetwork(div, moved, towns, G, { historic: OLD });
    assert.ok(cache.size > 3 && again.stats.shaped === fresh.stats.shaped && again.stats.reused > 0 && again.stats.reused <= cache.size && again.stats.reused < again.stats.shaped + 1, again.stats.reused + ' of ' + again.stats.shaped + ' shapes from the stale file');
    again.legs.forEach((L, k) => assert.deepEqual(L.fine ? Array.from(L.fine) : null, fresh.legs[k].fine ? Array.from(fresh.legs[k].fine) : null, 'the same shape as found anew'));
    assert.equal(fineCache(new ArrayBuffer(8), div, div.centres).size, 0); assert.equal(src.stats.reused, 0); }
  const head = netHead(buf); assert.ok(head.v === 1 && head.algo === NET_ALGO && head.districts === div.count && head.sig === netSignature(div, div.centres, net.capitals));
  assert.ok(buf.byteLength < net.legs.length * 60, 'a small file: ' + buf.byteLength + ' bytes');
  // the town of one district moves by a chunk: the file is for another division
  const d = districtOf(towns[2]), moved = { ...div.centres, texel: Int32Array.from(div.centres.texel) }; moved.texel[d] += 1;
  assert.equal(decodeNet(buf, div, moved, towns), null, 'another point of a town: the roads are laid anew');
  // the main town of a province is another district now (the division says which: the seat, bit 1)
  const pv = div.province[d], was = net.capitals[pv]; let other = -1;
  for (let e = 0; e < div.count && other < 0; e++) if (e !== was && div.kinds[e] === LAND && div.province[e] === pv && div.centres.texel[e] >= 0) other = e;
  const seat = Uint8Array.from(div.centres.seat || new Uint8Array(div.count)); seat[was] &= ~1; seat[other] |= 1;
  assert.ok(other >= 0); assert.equal(decodeNet(buf, div, { ...div.centres, seat }, towns), null, 'another town of a province: laid anew');
  assert.equal(decodeNet(buf.slice(0, 64), div, div.centres, towns), null, 'a broken file is no file');
});

test('roads: where a road meets a river — a bridge, a ford or a ferry by the road and the width of the water', () => {
  assert.equal(crossingType(0, .15), 'bridge'); assert.equal(crossingType(1, .05), 'bridge'); assert.equal(crossingType(1, .2), 'ferry');
  // a track: a ford where the river can be forded, else a footbridge over narrow water, else a ferry (the owner, 15.11.2026)
  assert.equal(crossingType(2, .02, true), 'ford'); assert.equal(crossingType(2, .02), 'bridge'); assert.equal(crossingType(2, .06, true), 'ferry'); assert.equal(crossingType(2, .1), 'ferry'); for (const k of [0, 1, 2]) assert.equal(crossingType(k, .006), 'ford');
  assert.equal(crossingType(1, .12), 'bridge', 'a lesser road has its bridge'); assert.equal(crossingType(1, .03, true), 'bridge'); assert.equal(crossingType(0, .03, true), 'bridge');
  // a river can be forded where it is not wide and both banks are low; a river dry for a part of the year — anywhere
  { const low = () => 100, gorge = (x, y) => 100 + Math.abs(x) * 300;
    assert.ok(fordable(.03, 0, 0, 1, 0, low) && !fordable(.03, 0, 0, 1, 0, gorge) && !fordable(.06, 0, 0, 1, 0, low) && fordable(.2, 0, 0, 1, 0, gorge, true) && fordable(.03, 0, 0, 1, 0, null));
    assert.ok(FORD.max > BRIDGE.footMax && FORD.max < BRIDGE.lesserMax && FORD.every > FORD.clear); }
  assert.ok(FORD_MIN < BRIDGE.min && BRIDGE.min < BRIDGE.lesserMax && BRIDGE.fade[0] < BRIDGE.fade[1] && WEAVE > 1);
  // a road running east; rivers running north across it: 60 m wide at x = 10, a brook of 2 m at x = 14, 200 m at x = 20
  const X = -200, Y = 4400, riverAt = (x, w, name) => { const n = 9, ll = new Float64Array(n * 2); for (let i = 0; i < n; i++) { const p = llOf(X + x, Y - 2 + i * .5); ll[i * 2] = p.lon; ll[i * 2 + 1] = p.lat; } return { n, ll, w: new Float32Array(n).fill(w), name, ru: '' }; };
  const road = kind => ({ kind, km: Array.from({ length: 101 }, (_, i) => [X + i * .3, Y]) });
  const courses = { rivers: [riverAt(10, .06, 'Река'), riverAt(14, .002, 'Ручей'), riverAt(20, .2, 'Большая')] };
  const main = riverCrossings([road(0)], courses), lesser = riverCrossings([road(1)], courses), track = riverCrossings([road(2)], courses);
  assert.equal(main.length, 2, 'the brook is stepped over'); const m = main.find(c => c.river === 'Река');
  assert.ok(Math.abs(m.x - (X + 10)) < .02 && Math.abs(m.y - Y) < .02 && Math.abs(m.at - 10) < .05 && Math.abs(m.dx - 1) < 1e-6 && Math.abs(m.width - .06) < 1e-3);
  assert.ok(Math.abs(m.span - (.06 + 2 * BRIDGE.abut)) < 2e-3, 'the deck reaches from bank to bank and a little onto each');
  assert.deepEqual(main.map(c => c.type).sort(), ['bridge', 'bridge']); assert.deepEqual(lesser.map(c => c.type).sort(), ['bridge', 'ferry']); assert.deepEqual(track.map(c => c.type).sort(), ['ferry', 'ferry']);
  // a track over a river 30 m wide: a ford between low banks, a footbridge in a gorge
  { const small = { rivers: [riverAt(10, .03, 'Малая')] }, level = () => 200, walls = (x, y) => 200 + Math.abs(x - (X + 10)) * 400;
    assert.deepEqual(riverCrossings([road(2)], small, 1, level).map(c => c.type), ['ford']); assert.deepEqual(riverCrossings([road(2)], small, 1, walls).map(c => c.type), ['bridge']);
    assert.deepEqual(riverCrossings([road(1)], small, 1, level).map(c => c.type), ['bridge'], 'a lesser road keeps its bridge at a ford');
    // the fords of the rivers no road comes to: one in every stretch of FORD.every km where the banks are low, none by a crossing that is there, none in a gorge
    const long = n => { const ll = new Float64Array(n * 2); for (let i = 0; i < n; i++) { const p = llOf(X + 10, Y - 10 + i * .1); ll[i * 2] = p.lon; ll[i * 2 + 1] = p.lat; } return { rivers: [{ n, ll, w: new Float32Array(n).fill(.03), name: 'Долгая', ru: '' }] }; };
    const free = fordSites(long(201), level), taken = fordSites(long(201), level, [{ x: X + 10, y: Y }]);
    assert.ok(free.length >= 3 && free.length <= 5, free.length + ' fords on 20 km'); for (const s of free) assert.ok(Math.abs(s.x - (X + 10)) < .01 && Math.abs(s.dx) > .99 && Math.abs(s.ry) > .99 && Math.abs(s.width - .03) < 1e-3);
    for (let k = 1; k < free.length; k++) assert.ok(Math.hypot(free[k].x - free[k - 1].x, free[k].y - free[k - 1].y) > FORD.clear);
    assert.ok(taken.every(s => Math.hypot(s.x - (X + 10), s.y - Y) >= FORD.clear), 'no ford by a crossing that is there');
    assert.equal(fordSites(long(201), walls).length, 0, 'no ford in a gorge'); assert.equal(fordSites({ rivers: [{ ...long(201).rivers[0], w: new Float32Array(201).fill(.2) }] }, level).length, 0, 'none on a great river'); }
  // a road that touches a bend of the river it runs beside: over and straight back — two shallows, no bridges
  const bend = { n: 5, ll: Float64Array.from([[10, -3], [10, -.2], [10.6, .4], [10, 1], [10, 4]].flatMap(([x, y]) => { const p = llOf(X + 10 + (x - 10) * 1, Y + y); return [p.lon, p.lat]; })), w: new Float32Array(5).fill(.05), name: 'Излучина', ru: '' };
  const beside = { kind: 0, km: Array.from({ length: 41 }, (_, i) => [X + 10.3, Y - 4 + i * .2]) }, w = riverCrossings([beside], { rivers: [bend] });
  assert.equal(w.length, 2); assert.ok(w.every(c => c.type === 'ford' && c.weave), 'no bridge where the road only touches a bend');
  // a bridge stands square across its river and the road turns to it: a road that meets two rivers aslant
  const slant = (x, w0, name) => { const n = 9, l2 = new Float64Array(n * 2); for (let i = 0; i < n; i++) { const p = llOf(X + x + (i - 4) * .5, Y - 2 + i * .5); l2[i * 2] = p.lon; l2[i * 2 + 1] = p.lat; } return { n, ll: l2, w: new Float32Array(n).fill(w0), name, ru: '' }; };
  const way = road(0), before = way.km.length, first = way.km[0].slice(), end = way.km[before - 1].slice();
  const two = squareBridges([way], riverCrossings([way], { rivers: [slant(8, .08, 'Первая'), slant(21, .05, 'Вторая')] }));
  assert.equal(two.filter(c => c.type === 'bridge' && c.square).length, 2);
  assert.deepEqual(way.km[0], first); assert.deepEqual(way.km[way.km.length - 1], end); assert.ok(Math.abs(way.km.length - before) <= 4, 'the road keeps its points but those at the bridges');
  for (let i = 1; i < way.km.length; i++) assert.ok(Math.hypot(way.km[i][0] - way.km[i - 1][0], way.km[i][1] - way.km[i - 1][1]) < 1.2, 'no stretch of the road is thrown away');
  for (const c of two) {
    assert.ok(Math.abs(c.dx * c.rx + c.dy * c.ry) < 1e-9 && c.sin === 1 && Math.abs(c.span - (c.width + 2 * BRIDGE.abut)) < 1e-9, 'the deck is square to the river');
    const ends = [-1, 1].map(s => [c.x + s * c.dx * c.span / 2, c.y + s * c.dy * c.span / 2]);
    for (const e of ends) assert.ok(way.km.some(q => Math.hypot(q[0] - e[0], q[1] - e[1]) < 1e-9), 'the road comes to each end of the deck');
  }
});

test('roads: a road stops at the first houses of a settlement, and whoever asks is told how near a road is', () => {
  const line = Array.from({ length: 41 }, (_, i) => [100 + i * .35, 4400]), town = { x: 107, y: 4400.1, r: .6 }, hamlet = { x: 103.1, y: 4400.02, r: .06 };
  const pieces = cutAtTowns(line, [town, hamlet]);
  assert.equal(pieces.length, 3, 'the road is cut at the hamlet and at the town');
  for (const pc of pieces) {
    assert.equal(pc.pts.length, pc.fade.length);
    pc.pts.forEach((q, i) => { for (const t of [town, hamlet]) { const d = Math.hypot(q[0] - t.x, q[1] - t.y); if (pc.fade[i] > 0) assert.ok(d > t.r * TOWN_EDGE - 1e-6, 'no stretch of road among the houses'); } });
  }
  assert.equal(pieces[0].fade[0], 1); assert.equal(pieces[0].fade[pieces[0].fade.length - 1], 0, 'the road fades out at the edge');
  const last = pieces[1].pts[pieces[1].pts.length - 1]; assert.ok(Math.abs(Math.hypot(last[0] - town.x, last[1] - town.y) - town.r * TOWN_EDGE) < .06, 'it ends at the edge of the town');
  assert.deepEqual(cutAtTowns(line, []).map(pc => pc.pts.length), [41], 'no settlement, no cut');
  const outside = townIndex([town]); assert.ok(outside(107, 4400.1) < 0 && outside(109, 4400.1) > 1 && outside(500, 4000) > 1e8);
  const near = nearIndex([line], 2, .3);
  assert.ok(Math.abs(near(104.2, 4400.12) - .12) < 1e-6 && near(104.2, 4400.5) === 1e9 && near(300, 4400) === 1e9);
});

test('roads: the great roads of history are chains of towns inside the album; the file of the network is small', () => {
  assert.ok(HISTORIC.length >= 25); const names = new Set();
  for (const r of HISTORIC) { assert.ok(r.name && !names.has(r.name) && r.way.length >= 2); names.add(r.name); for (const [lat, lon, pass] of r.way) assert.ok(lat > 35.2 && lat < 44.9 && lon > -10 && lon < 4.5 && (pass === undefined || (typeof pass === 'string' && pass.length > 2)), r.name);
    assert.ok(r.way[0].length === 2 && r.way[r.way.length - 1].length === 2, r.name + ' begins and ends at a town'); }
  // the passes the lead asked for (14.11.2026) are all there, each once
  for (const n of ['Сомпорт', 'Ибаньета', 'Пертюс', 'Пахарес', 'Сомосьерра', 'Гвадаррама', 'Деспеньяперрос', 'Бехар']) assert.equal(PASSES.filter(p => p.name === n).length, 1, n);
  assert.equal(new Set(PASSES.map(p => p.name)).size, PASSES.length); assert.ok(PASSES.every(p => p.road && Number.isFinite(p.lat + p.lon)));
  const f = join(ROOT, 'public/assets/album/roads/roads.bin.gz'); assert.ok(existsSync(f), 'public/assets/album/roads/roads.bin.gz: node scripts/album/bake-roads.mjs');
  assert.ok(statSync(f).size < 3e5, 'the file stays small');
  const u = gunzipSync(readFileSync(f)), head = netHead(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
  assert.ok(head.v === 1 && head.legs > 3000 && head.lines.length > 500 && head.capitals.length > 50 && /^[0-9a-f]{8}$/.test(head.sig), 'a network of the whole album');
  assert.equal(head.algo, NET_ALGO, 'the file was laid by the rules as they are now: node scripts/album/bake-roads.mjs');
  assert.ok(head.names.includes('Августова дорога') && head.lines.some(l => l[0] === 0) && head.lines.some(l => l[0] === 1) && head.lines.some(l => l[0] === 2));
  // the passes are kept with the network: every pass of history by its name, and the passes of the other roads
  assert.ok(Array.isArray(head.passes) && head.passes.length > 100 && head.passes.every(q => q.length === 5 && q[0] < head.legs && q[3] > 0 && q[3] < 3500));
  for (const p of PASSES) assert.ok(head.passes.some(q => q[4] && head.names[q[4] - 1] === p.name), p.name + ' is in the file');
});

test('roads: a pass of history — the great road is led over that very point; every road over a crest has its pass in the list', () => {
  const c = div.centres, HIGH_Y = IY0 + (IY1 - IY0) * .3, P = at(RX + .5, HIGH_Y), pt = texel(RX + .5, HIGH_Y);      // on the crest, far from the saddle
  const way = [{ name: 'Южный тракт', way: [[towns[2].lat, towns[2].lon], [P[0], P[1], 'Высокий'], [towns[3].lat, towns[3].lon]] }];
  const net = roadNetwork(div, c, towns, G, { historic: way }), plain = roadNetwork(div, c, towns, G, { historic: OLD });
  const named = net.passes.filter(p => p.rank === 0); assert.equal(named.length, 1); assert.equal(net.stats.passes[0], 1);
  const p = named[0], L = net.legs[p.leg];
  assert.ok(p.name === 'Высокий' && p.kind === 0 && L.kind === 0 && L.pass.t === pt && p.a === L.a && p.b === L.b && p.h > 1800, JSON.stringify(p));
  assert.ok(L.fine && Math.hypot(p.x - (RX + .5), p.y - HIGH_Y) <= PASS.top + .15, 'the pass stands by its own point: the top of the shaped way there');
  assert.ok(L.path.includes(pt) && L.path[0] === c.texel[L.a] && L.path[L.path.length - 1] === c.texel[L.b], 'the leg: centre, the pass, centre');
  assert.ok((c.x[L.a] - RX) * (c.x[L.b] - RX) < 0, 'its districts lie on both sides of the ridge');
  for (const d of [L.a, L.b]) assert.ok(Math.hypot(c.x[d] - RX, c.y[d] - HIGH_Y) <= PASS.reach, 'and near the pass');
  for (let j = 1; j < L.path.length; j++) { const e = Math.abs(L.path[j] - L.path[j - 1]); assert.ok(e === 1 || e === FN || e === FN - 1 || e === FN + 1, 'the way of the leg has no jumps'); }
  const line = net.lines.find(l => l.legs.includes(p.leg)); assert.ok(line && line.name === 'Южный тракт' && line.kind === 0, 'the leg of the pass is the old highway');
  assert.ok(line.pts.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) < 1e-6), 'the line runs through the pass');
  // unshaped (no heights), the pass is the very chunk of its point
  { const flat = roadNetwork(div, c, towns, G, { historic: way, heightAt: null }), q = flat.passes[0]; assert.ok(q.name === 'Высокий' && Math.hypot(q.x - xyOf(pt)[0], q.y - xyOf(pt)[1]) < 1e-6 && q.h === Math.round(G.hgt[pt])); }
  // without the name the highway takes the range where it is low: no pass 1800 m high on a main road
  assert.ok(!plain.passes.some(q => q.kind === 0 && q.h > 1200) && plain.stats.passes[0] === 0);
  // the other passes: the top of a leg that stands PASS.rise over both its ends; the list is in the order of the ranks
  let other = 0;
  for (const net2 of [net, plain]) {
    assert.deepEqual(net2.passes, passesOf(G, net2.legs, div.raster.heightAt));
    const prof = M => (M.fine ? Array.from(M.fine, cl => { const q = cellXY(cl), g = llOf(q[0], q[1]); return [q[0], q[1], div.raster.heightAt(g.lat, g.lon)]; }) : M.path.map(t => [...xyOf(t), G.hgt[t]]));
    net2.passes.forEach((q, i) => {
      const M = net2.legs[q.leg], pr = prof(M), ends = Math.max(pr[0][2], pr[pr.length - 1][2]);
      assert.ok(M.kind !== 3 && q.kind === M.kind && q.a === M.a && q.b === M.b && Number.isInteger(q.h));
      assert.ok(pr.some(v => Math.hypot(v[0] - q.x, v[1] - q.y) < 1e-6), 'a pass is a point of its leg');
      if (q.rank) { other++; assert.ok(q.name === '' && q.rank === (M.kind === 0 ? 1 : 2) && q.h - ends >= PASS.rise - 1 && q.h >= Math.max(...pr.slice(1, -1).map(v => v[2])) - 1); }
      if (i) assert.ok(net2.passes[i - 1].rank <= q.rank);
    });
    for (const M of net2.legs) if (M.kind !== 3 && !M.pass && !net2.passes.some(q => net2.legs[q.leg] === M)) { const pr = prof(M); assert.ok(Math.max(...pr.slice(1, -1).map(v => v[2]), -1e9) - Math.max(pr[0][2], pr[pr.length - 1][2]) < PASS.rise, 'a leg without a pass climbs no crest'); }
  }
  assert.ok(other > 0, 'the roads over the ridge have their passes');
  // the passes go into the file and come back
  const back = decodeNet(encodeNet(net, div, c), div, c, towns);
  assert.ok(back) ; assert.equal(back.passes.length, net.passes.length);
  net.passes.forEach((q, i) => { const r = back.passes[i]; assert.ok(Math.abs(r.x - q.x) < .011 && Math.abs(r.y - q.y) < .011 && r.h === q.h && r.name === q.name && r.kind === q.kind && r.a === q.a && r.b === q.b && r.rank === q.rank && r.leg === q.leg); });
  assert.deepEqual(back.stats, net.stats);
  // a road marked `after` is laid when the towns of the provinces are joined: it takes no main road from the network
  const late = roadNetwork(div, c, towns, G, { historic: [...OLD, { name: 'Высокая дорога', after: true, way: [[towns[0].lat, towns[0].lon], [P[0], P[1], 'Высокий'], [towns[1].lat, towns[1].lon]] }] });
  const mainOf = n => new Set(n.legs.filter(M => M.kind === 0).map(M => M.a * 65536 + M.b)), was = mainOf(plain), now = mainOf(late);
  for (const k of was) assert.ok(now.has(k), 'a main road stays a main road');
  assert.ok(now.size > was.size && late.passes.some(q => q.name === 'Высокий' && q.kind === 0));
  // the boundaries the roads cross: every change of district along a road as it is drawn, and nothing else
  { const crossed = crossedPairs(div, net.legs), want = new Set();
    for (const M of net.legs) { if (M.kind === 3) continue; const ds = (M.fine ? Array.from(M.fine, cellChunk) : M.path).map(t => div.cells[t]).filter(d => d >= 0); for (let k = 1; k < ds.length; k++) if (ds[k] !== ds[k - 1]) want.add(Math.min(ds[k], ds[k - 1]) * 65536 + Math.max(ds[k], ds[k - 1])); }
    assert.deepEqual([...crossed].sort((p, q) => p - q), [...want].sort((p, q) => p - q)); assert.ok(crossed.size > 20);
    for (const k of crossed) { const a = Math.floor(k / 65536), b = k % 65536; assert.ok(a < b && div.kinds[a] === LAND && div.kinds[b] === LAND, 'a road crosses from land to land'); }
    // the road of the pass crosses the ridge between two districts on its two sides — whichever districts its leg joins
    const ds = Array.from(L.fine, cellChunk).map(t => div.cells[t]), over = []; for (let k = 1; k < ds.length; k++) if (ds[k] !== ds[k - 1]) over.push([ds[k - 1], ds[k]]);
    assert.ok(over.length >= 1 && over.every(([a, b]) => crossed.has(Math.min(a, b) * 65536 + Math.max(a, b))));
    assert.equal(crossedPairs(div, net.legs.map(M => ({ ...M, kind: 3 }))).size, 0, 'no roads, no boundary crossed'); }
  // the fan of cheapest ways from a point agrees with the way found between two points
  { const a = c.texel[L.a], stamp = fanFrom(G, pt, 60), cost = G.done[a] === stamp ? G.g[a] : NaN, leg = legBetween(G, pt, a); assert.ok(Math.abs(cost - leg.cost) < 1e-6 * leg.cost, cost + ' against ' + leg.cost); }
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('roads of the album: main roads reach the towns of the provinces, lesser roads every district', { skip }, () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), osm = decodeSites(JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/assets/album/town/sites.json.gz')))));
  const world = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const real = buildDivision(world, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  real.centres = districtCentres(real, [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })]);
  const t0 = Date.now(), net = roadNetwork(real, real.centres, data.vectors.places, undefined, { courses: data.courses }), ms = Date.now() - t0, s = net.stats;
  assert.ok(ms < 20000, 'laid in ' + ms + ' ms');
  // the legs of the mountains are shaped — and the legs with a gully or a canyon in their way: a third of the roads or so; the rest are the plains as they were
  { const roads = net.legs.filter(L => L.kind !== 3), shaped = roads.filter(L => L.fine); assert.equal(s.shaped, shaped.length);
    assert.ok(shaped.length > 250 && shaped.length < roads.length * .45 && roads.filter(L => !L.fine && climbs({ hgt: real.raster.hgt }, L.path)).length < 5, shaped.length + ' of ' + roads.length + ' legs shaped'); }
  assert.ok(s.km[0] > 12000 && s.km[0] < 32000 && s.km[1] > s.km[0] && s.track > 100 && s.unreached < 50, JSON.stringify(s));
  const onMain = new Set(); for (const L of net.legs) if (L.kind === 0) { onMain.add(L.a); onMain.add(L.b); }
  let caps = 0, joined = 0; for (const d of net.capitals) if (d >= 0) { caps++; if (onMain.has(d)) joined++; }
  assert.ok(caps > 60 && joined / caps > .85, joined + ' of ' + caps + ' towns of provinces stand on a main road');
  const km = name => net.lines.filter(l => l.name === name).reduce((a, l) => a + l.legs.reduce((b, i) => b + net.legs[i].km, 0), 0);
  assert.ok(km('Августова дорога') > 1000 && km('Серебряный путь') > 500, 'the great roads of history are laid');
  // every pass of history is on a main road, at its own point and height (the lead, 14.11.2026)
  for (const P of PASSES) { const q = net.passes.find(v => v.name === P.name), [px, py] = kmOf(P.lat, P.lon);
    assert.ok(q && q.rank === 0 && q.kind === 0 && Math.hypot(q.x - px, q.y - py) < 1.6 && Math.abs(q.h - data.base.at(P.lat, P.lon)) < 250, P.name + ': ' + JSON.stringify(q)); }
  const hOf = n => net.passes.find(v => v.name === n).h;
  assert.ok(hOf('Сомпорт') > 1400 && hOf('Сомпорт') < 1800 && hOf('Пертюс') < 500 && hOf('Пахарес') > 1200 && hOf('Гвадаррама') > 1300 && hOf('Деспеньяперрос') < 900, 'the heights are those of the real passes');
  assert.ok(s.passes[0] === PASSES.length && s.passes[1] > 30 && s.passes[2] > 100 && net.passes.length < 800, JSON.stringify(s.passes));
  // the road of Somport keeps to its own valleys: from Jaca up the Aragón, down the Aspe — never over a crest higher than the pass
  { const L = net.legs[net.passes.find(v => v.name === 'Сомпорт').leg], top = Math.max(...L.path.map(t => real.raster.hgt[t])); assert.ok(top < hOf('Сомпорт') + 150 && L.km < 70, 'Somport: ' + Math.round(top) + ' m, ' + L.km.toFixed(0) + ' km');
    // … and its shaped way never climbs above the pass, and keeps to the grade a main road likes on nine tenths of its length
    // (by the ground as a road sees it: the lowest ground of a cell; beside the river, its bank — cellGround)
    const pts = finePoints(L, real.centres), gr = cellGround((x, y) => { const g = llOf(x, y); return data.base.at(g.lat, g.lon); }, fineRivers(data.courses)), hs = Array.from(L.fine, c => gr(c % FW, Math.floor(c / FW))); let all = 0, steep = 0;
    for (let k = 1; k < pts.length; k++) { const run = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); all += run; if (Math.abs(hs[k] - hs[k - 1]) / (run * 1000) > FINE.grade[0] * 1.3) steep += run; }
    assert.ok(Math.max(...hs) < hOf('Сомпорт') + 30 && steep < all * .1, 'the shaped road of Somport: top ' + Math.round(Math.max(...hs)) + ' m, ' + (100 * steep / all).toFixed(0) + ' % of it steep'); }
  // some boundaries between districts that have no leg of their own are crossed by a road all the same (the road of a pass
  // joins districts that do not touch; a leg cuts the corner of a third district): crossedPairs() names them
  { const crossed = crossedPairs(real, net.legs), has = new Set(net.legs.map(L => L.a * 65536 + L.b)); let bare = 0; for (const k of crossed) if (!has.has(k)) bare++;
    assert.ok(crossed.size > 2000 && bare > 10 && bare < crossed.size * .5, crossed.size + ' boundaries crossed, ' + bare + ' of them between districts without a leg'); }
  // the network of the plains is the one the owner approved: against the ways without their passes nearly every leg is of the same kind
  { const bare = HISTORIC.filter(r => !r.after).map(r => ({ name: r.name, way: r.way.filter(p => p.length === 2) })), old = roadNetwork(real, real.centres, data.vectors.places, undefined, { historic: bare, heightAt: null });
    const kinds = new Map(old.legs.map(L => [L.a * 65536 + L.b, L.kind])); let same = 0, lost = 0;
    for (const L of net.legs) { const k = kinds.get(L.a * 65536 + L.b) ?? 3; if (k === L.kind) same++; else if (k === 0 && Math.max(...L.path.map(t => real.raster.hgt[t])) - Math.min(...L.path.map(t => real.raster.hgt[t])) < 150) lost++; }
    assert.ok(same / net.legs.length > .975 && lost < 12, same + ' of ' + net.legs.length + ' legs as they were; ' + lost + ' level main legs are main no more'); }
  let land = 0, served = 0; const on = new Set(); for (const L of net.legs) if (L.kind !== 3) { on.add(L.a); on.add(L.b); }
  for (let d = 0; d < real.count; d++) if (real.kinds[d] === LAND && real.centres.texel[d] >= 0) { land++; if (on.has(d)) served++; }
  assert.ok(served / land > .97, served + ' of ' + land + ' districts have a road');
});

test('roads: the real settlement sites, the pages and the switches of the map', () => {
  const f = new URL('../public/assets/album/town/sites.json.gz', import.meta.url), sites = decodeSites(JSON.parse(gunzipSync(readFileSync(f))));
  assert.ok(statSync(f).size < 4e5, 'the file stays small'); assert.ok(sites.length > 5000, sites.length + ' sites');
  assert.deepEqual(SITE_KINDS, ['city', 'town', 'village']);
  for (let i = 0; i < sites.length; i++) { const s = sites[i]; assert.ok(s.lat > 35.2 && s.lat < 44.8 && s.lon > -10 && s.lon < 4.5 && s.pop >= 400 && s.kind >= 0 && s.kind <= 2); if (i) assert.ok(s.pop <= sites[i - 1].pop, 'the most populous first'); }
  assert.ok(sites.slice(0, 40).some(s => /Madrid|Мадрид/.test(s.name)) && sites.slice(0, 40).some(s => /Barcelona|Барселона/.test(s.name)));
  for (const id of ['roads', 'roads-centres', 'roads-pass', 'roads-20', 'roads-main', 'roads-minor', 'roads-slope', 'roads-bridge']) assert.ok(PAGES.some(p => p.id === id && p.group === 'Города и дороги'), id);
  // the owner turns the kinds of roads on and off on the panel of the map: a knob with `map` is a switch there
  const sw = Object.fromEntries(DEFS.filter(d => d.map).map(d => [d.key, d]));
  for (const [key, name] of [['roadMain', 'Главные дороги'], ['roadMinor', 'Малые дороги'], ['roadTracks', 'Тропы']]) assert.ok(sw[key] && sw[key].map === name && sw[key].type === 'toggle' && sw[key].value === 1, key);
  assert.ok(DEFS.some(d => d.key === 'roadsOn'), 'the one switch for all roads stays');
  assert.equal(PAGES.find(p => p.id === 'roads-main').p.roadMinor, 0);
});

test('roads: from high up — below 300 km a road is as it is near the ground; higher it thins; tracks go by 135 km, lesser roads by 300, main roads between 1000 and 1200', () => {
  const pxOf = h => 2 * h * Math.tan(16 * Math.PI / 180) / 900, [TRUNK, MAIN, LESSER, TRACK] = [0, 1, 2, 3];
  assert.deepEqual(LOOK.map(l => l.id), ['trunk', 'main', 'lesser', 'track']);
  // the main roads up to 300 km, the lesser up to 200 km, the tracks up to 90 km: whole, at their near width
  for (const [set, top] of [[TRUNK, 300], [MAIN, 300], [LESSER, 200], [TRACK, 90]]) for (const h of [20, 50, 90, 200, 300]) { if (h > top) continue; const f = roadFar(set, pxOf(h), h); assert.ok(f.alpha > .99 && Math.abs(f.minPx - LOOK[set].px[0]) < .02, LOOK[set].id + ' from ' + h + ' km'); }
  // higher: never stronger, never wider, without a jump
  for (let set = 0; set < 4; set++) { let last = roadFar(set, .01, 16); for (let px = .012; px < 1.4; px *= 1.02) { const f = roadFar(set, px, px / pxOf(1)); assert.ok(f.alpha <= last.alpha + 1e-9 && f.minPx <= last.minPx + 1e-9 && last.alpha - f.alpha < .3 && f.alpha >= 0 && f.alpha <= 1); last = f; } }
  // the kinds go one after another: tracks by 135 km, lesser roads by 300 km
  assert.equal(roadFar(TRACK, pxOf(135), 135).alpha, 0); assert.ok(roadFar(TRACK, pxOf(100), 100).alpha > .9);
  assert.equal(roadFar(LESSER, pxOf(300), 300).alpha, 0); assert.ok(roadFar(LESSER, pxOf(215), 215).alpha > .95);
  // the main roads (the owner, 15.11.2026): whole from 1000 km, a thin thread; gone by 1200 km — by the height of the
  // camera, whatever the window: a pixel twice as large or half as large changes nothing
  for (const set of [TRUNK, MAIN]) for (const k of [.5, 1, 2]) {
    for (const h of [400, 600, 820, 1000]) assert.equal(roadFar(set, pxOf(h) * k, h).alpha, 1, LOOK[set].id + ' from ' + h + ' km');
    const mid = roadFar(set, pxOf(1100) * k, 1100).alpha; assert.ok(mid > .3 && mid < .7);
    for (const h of [1200, 1500, 2600]) assert.equal(roadFar(set, pxOf(h) * k, h).alpha, 0, LOOK[set].id + ' from ' + h + ' km');
  }
  const open = roadFar(TRUNK, pxOf(820), 820); assert.ok(Math.abs(open.minPx - LOOK[TRUNK].px[1]) < 1e-9 && open.minPx <= 1.3 && THIN[0] >= pxOf(295));
});

test('roads: a road takes the light of the ground — the sun, the sky, and the Moon once the light of the album knows it', () => {
  assert.ok(GROUND_LIGHT.includes('albumSunCol()') && GROUND_LIGHT.includes('albumSkyCol()') && GROUND_LIGHT.includes('vec3 groundLight(vec2 ll, float px)'));
  assert.equal(GROUND_LIGHT.includes('albumMoonLit(n)'), LIGHT.includes('albumMoonLit('), 'the moonlight is added to a road exactly when the ground has it');
});

test('roads: a walker sees the canyon between two chunks; the way of a place to the nearest main road; what can be laid through a chunk', () => {
  // ---- walkCost: the price of stepCost on an even slope, far dearer across a canyon that the middles of the chunks do not show
  const a = texel(IX0 + 30, IY1 - 40), [ax, ay] = xyOf(a), even = (x, y) => 300 + (x - ax) * 20;
  assert.ok(Math.abs(walkCost(G, a, a + 1, false, even) - stepCost(G, a, a + 1, false)) < 1e-9, 'an even slope: the same price');
  const canyon = (x, y) => 300 - 150 * Math.max(0, 1 - Math.abs(x - ax - .5) / .3), over = walkCost(G, a, a + 1, false, canyon);
  assert.ok(over > stepCost(G, a, a + 1, false) + 150 * 2 * WALK.climb * .9 && over > 10, 'down 150 m and up again in one step: ' + over.toFixed(1) + ' km of way');
  assert.ok(walkCost(G, a, a + FN, false, canyon) < 1.3, 'along the rim nothing is paid');
  // ---- the network of the island: which chunks carry which road
  const net = roadNetwork(div, div.centres, towns, undefined, { historic: OLD, heightAt: null }), on = chunkKinds(net.legs);
  { let main = 0, lesser = 0; for (const L of net.legs) { if (L.kind === 3) continue; for (const t of L.path) assert.ok(on[t] >= 3 - L.kind); if (L.kind === 0) main += L.path.length; else lesser += L.path.length; }
    assert.ok(main > 100 && lesser > 100 && on.reduce((s, v) => s + (v === 3 ? 1 : 0), 0) <= main); }
  // ---- the way to a main road: from a chunk off the roads — to the nearest road, then along the roads; on a main road it is no way at all
  const mainLeg = net.legs.find(L => L.kind === 0 && L.path.every(t => G.hgt[t] < 320 && !G.riv[t])), onMain = mainLeg.path[Math.floor(mainLeg.path.length / 2)];
  assert.deepEqual(wayToMain(G, onMain, on), { km: 0, cost: 0, road: 0, path: [onMain] });
  let off = -1; for (let k = 4; k < 40 && off < 0; k++) for (const u of [onMain + k * FN, onMain - k * FN, onMain + k, onMain - k]) if (G.land[u] && !on[u] && !G.riv[u] && G.hgt[u] < 320 && [1, -1, FN, -FN, 2, -2, 2 * FN, -2 * FN].every(e => !on[u + e] && !G.riv[u + e])) { off = u; break; }
  assert.ok(off >= 0, 'a chunk off the roads is there');
  const w = wayToMain(G, off, on), end = w.path[w.path.length - 1], far = Math.hypot(xyOf(off)[0] - xyOf(end)[0], xyOf(off)[1] - xyOf(end)[1]);   // (far: straight to where the way ends — a river may lie between the place and the road it was picked by)
  assert.ok(w && w.path[0] === off && on[w.path[w.path.length - 1]] === 3 && w.km > 1.9 && w.km >= far - 1e-6 && w.km <= far * 1.5 + 2 && w.cost > 0 && w.road <= w.km, JSON.stringify(w && { km: w.km, cost: w.cost, road: w.road }));
  for (let k = 1; k < w.path.length; k++) { const e = Math.abs(w.path[k] - w.path[k - 1]); assert.ok(e === 1 || e === FN || e === FN + 1 || e === FN - 1, 'the way goes from chunk to chunk'); }
  assert.deepEqual(wayToMain(G, off, on).path, w.path, 'the same place, the same way');
  // a way that follows a lesser road is cheaper than its length over open ground would be
  { const lesser = net.legs.find(L => L.kind === 1 && L.path.length > 12 && L.path.every(t => on[t] === 2)); if (lesser) { const v = wayToMain(G, lesser.path[Math.floor(lesser.path.length / 2)], on); assert.ok(v && v.road > 0 && v.cost < v.km, 'along a road: ' + JSON.stringify(v && { km: v.km, cost: v.cost, road: v.road })); } }
  assert.equal(wayToMain(G, texel(IX0 - 40, IY0 - 40), on), null, 'the sea is no place');
  assert.equal(wayToMain(G, off, new Uint8Array(FN * FN)), null, 'no main road anywhere: no way');
  // the top of the ridge, 2200 m, a slope of 16 %: a walker who sees the ground pays for it; the way is no shorter and no cheaper than by the heights of the chunks
  { const crest = texel(RX + 2, PASS_Y - 60), by = wayToMain(G, crest, on), seen = wayToMain(G, crest, on, (x, y) => { const g = llOf(x, y); return height(g.lat, g.lon); });
    assert.ok(!by || !seen || seen.cost >= by.cost - 1e-6, 'the ground itself is never cheaper than the heights of the chunks'); }
  assert.ok(TO_MAIN.road < 1 && TO_MAIN.reach > 30);
  // ---- what can be laid through a chunk: the limits the network is laid by
  assert.deepEqual([INFRA.lesser, INFRA.track], [POOR, HARD]); assert.deepEqual([STEEP_INFRA[0], STEEP_INFRA[1], HIGH_INFRA], [STEEP[0], STEEP[1], HIGH]);
  { const n = 40, hgt = new Float32Array(n * n), land = new Uint8Array(n * n).fill(1), at = (i, j) => j * n + i;
    // four bands of rough ground — the easiest step out of a chunk climbs or falls 0, 3, 6, 12 m in 141 (2 %, 4 %, 8.5 %); a strip of sea in the last columns
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const D = [0, 3, 6, 12][Math.floor(j / 10)]; hgt[at(i, j)] = 100 + D * (i % 2) + 2 * D * (j % 2); if (i >= 36) land[at(i, j)] = 0; }
    const lv = infraLevels(hgt, land, n, .1), mid = j => lv[at(18, j)];
    assert.deepEqual([mid(5), mid(15), mid(25), mid(35)], [LEVEL.main, LEVEL.lesser, LEVEL.track, LEVEL.none], 'level, 2 %, 4 %, 8.5 %');
    assert.equal(lv[at(38, 5)], 0, 'water'); assert.equal(levelOf(1), 3); assert.equal(levelOf(INFRA.main + .01), 2); assert.equal(levelOf(INFRA.track + .01), 0);
    assert.ok(chunkEase(hgt, land, n, at(18, 5), .1) < 1.02 && chunkEase(hgt, land, n, at(18, 35), .1) > INFRA.track);
    const roads = new Uint8Array(n * n); roads[at(18, 35)] = 3; assert.equal(infraLevels(hgt, land, n, .1, roads)[at(18, 35)], 3, 'a chunk is never below the road that crosses it'); }
});

test('roads: the works at a river — a bridge of stone, of timber, a footbridge, a ferry: one mesh, every corner told where it stands', () => {
  const at = (kind, width, road = .011) => ({ lat: 41.65, lon: -.86, dx: .8, dy: .6, width, sin: 1, kind, road, minPx: 2.1 });
  const count = list => worksGeometry(list).attributes.aP.count;
  const geo = worksGeometry([at('stone', .08), at('timber', .04, .008), at('foot', .02, .005), at('ferry', .2, .008)]), A = geo.attributes, n = A.aP.count;
  for (const [name, size] of [['aC', 2], ['aD', 4], ['aP', 4], ['aQ', 2], ['aR', 3], ['aN', 3], ['aCol', 3], ['position', 3]]) { assert.equal(A[name].count, n, name); assert.equal(A[name].itemSize, size, name); }
  const idx = geo.index.array; assert.ok(n > 300 && idx.length % 6 === 0 && Math.max(...idx) < n && Math.min(...idx) >= 0);
  for (let v = 0; v < n; v++) {
    const from = A.aP.getW(v), s = A.aP.getX(v), t = A.aP.getY(v), nl = Math.hypot(A.aN.getX(v), A.aN.getY(v), A.aN.getZ(v));
    assert.ok(from === 0 || from === 1 || from === 2, 'a corner stands on the deck, on the water or on the ground');
    assert.ok(Math.abs(s) <= 1 + 1e-6 && Math.abs(t) <= 1 + 1e-6 && nl > .9 && nl < 1.1 && Math.abs(A.aQ.getX(v)) < .03 && Math.abs(A.aQ.getY(v)) < .03, 'within its span and its deck, a few metres beyond at most');
    assert.ok(Math.abs(A.aD.getX(v) - .8) < 1e-6 && Math.abs(A.aD.getW(v) - 1) < 1e-6 && A.aCol.getX(v) > 0 && A.aCol.getX(v) <= 1);
  }
  // a wider river — more piers under the stone, more posts under the timber; a ferry has no deck: nothing of it stands on one
  assert.ok(count([at('stone', .12)]) > count([at('stone', .03)]) && count([at('timber', .08, .008)]) > count([at('timber', .02, .008)]));
  { const f = worksGeometry([at('ferry', .2, .008)]).attributes; let deck = 0, ground = 0, water = 0; for (let v = 0; v < f.aP.count; v++) { const w = f.aP.getW(v); if (w === 0) deck++; else if (w === 1) water++; else ground++; }
    assert.ok(deck === 0 && ground > 20 && water > 20, 'a hut on the ground, stages and a boat on the water'); }
  // the deck of a stone bridge stands higher than that of timber, a footbridge lowest; a stone deck rises to its middle
  assert.ok(WORKS.stone.H > WORKS.timber.H && WORKS.timber.H > WORKS.foot.H && WORKS.stone.camber > 0 && WORKS.timber.camber === 0 && WORKS.abut === BRIDGE.abut);
  { const st = worksGeometry([at('stone', .08)]).attributes; let top = -1e9; for (let v = 0; v < st.aP.count; v++) if (st.aP.getW(v) === 0 && st.aN.getZ(v) > .9 && Math.abs(st.aP.getX(v)) < .01) top = Math.max(top, st.aP.getZ(v)); assert.ok(top >= WORKS.stone.camber, 'the middle of the deck: ' + top); }
  assert.equal(worksGeometry([]).attributes.aP.count, 0);
});
