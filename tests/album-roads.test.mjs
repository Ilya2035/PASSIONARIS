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
  STEEP, CROSSING, ALONG, HARD, SPAN_MAIN, SPAN_LESSER, POOR, NET_ALGO } from '../src/album/roads/routes.js';
import { HISTORIC } from '../src/album/roads/historic.js';
import { riverCrossings, squareBridges, crossingType, cutAtTowns, townIndex, nearIndex, BRIDGE, FORD_MIN, WEAVE, TOWN_EDGE } from '../src/album/roads/crossings.js';
import { decodeSites, SITE_KINDS } from '../src/album/town/sites.js';
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
  const ll = roadLine(net.lines[0].pts); assert.equal(ll.length, net.lines[0].pts.length); assert.ok(ll[0][0] > -7 && ll[0][0] < 0 && ll[0][1] > 38 && ll[0][1] < 43, 'lines come out as lon, lat');
});

test('roads: the network is kept in a file and read back as it was; a file for another division is not used', () => {
  const net = roadNetwork(div, div.centres, towns, G, { historic: OLD }), buf = encodeNet(net, div, div.centres), back = decodeNet(buf, div, div.centres, towns);
  assert.ok(back, 'the file is read'); assert.deepEqual(back.stats, net.stats); assert.deepEqual([...back.capitals], [...net.capitals]);
  assert.equal(back.lines.length, net.lines.length);
  back.lines.forEach((l, i) => { const o = net.lines[i]; assert.equal(l.kind, o.kind); assert.equal(l.name, o.name); assert.deepEqual(l.legs, o.legs); assert.deepEqual(l.pts, o.pts); });
  back.legs.forEach((L, i) => { const o = net.legs[i]; assert.ok(L.a === o.a && L.b === o.b && L.kind === o.kind && Math.abs(L.cost - o.cost) < 1e-3); if (L.kind !== 3) { assert.deepEqual(L.path, o.path); assert.deepEqual(L.crossings, o.crossings); } });
  assert.deepEqual(back.crossings, net.crossings);
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
  assert.equal(crossingType(2, .02), 'ford'); assert.equal(crossingType(2, .1), 'ferry'); for (const k of [0, 1, 2]) assert.equal(crossingType(k, .006), 'ford');
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
  for (const r of HISTORIC) { assert.ok(r.name && !names.has(r.name) && r.way.length >= 2); names.add(r.name); for (const [lat, lon] of r.way) assert.ok(lat > 35.2 && lat < 44.9 && lon > -10 && lon < 4.5, r.name); }
  const f = join(ROOT, 'public/assets/album/roads/roads.bin.gz'); assert.ok(existsSync(f), 'public/assets/album/roads/roads.bin.gz: node scripts/album/bake-roads.mjs');
  assert.ok(statSync(f).size < 3e5, 'the file stays small');
  const u = gunzipSync(readFileSync(f)), head = netHead(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
  assert.ok(head.v === 1 && head.legs > 3000 && head.lines.length > 500 && head.capitals.length > 50 && /^[0-9a-f]{8}$/.test(head.sig), 'a network of the whole album');
  assert.equal(head.algo, NET_ALGO, 'the file was laid by the rules as they are now: node scripts/album/bake-roads.mjs');
  assert.ok(head.names.includes('Августова дорога') && head.lines.some(l => l[0] === 0) && head.lines.some(l => l[0] === 1) && head.lines.some(l => l[0] === 2));
});

const data = loadAlbumData(ROOT), skip = !data && 'public/album-data/ is not there';
test('roads of the album: main roads reach the towns of the provinces, lesser roads every district', { skip }, () => {
  const rd = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const lakes = rd('public/assets/album/water/lakes.json').lakes.filter(l => !l.shoal && l.ring), osm = decodeSites(JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/assets/album/town/sites.json.gz')))));
  const world = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const real = buildDivision(world, { lands: rd('public/assets/album/division/lands.json'), admin: rd('public/assets/album/division/admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], size: 20, rivers: data.vectors.rivers });
  const own = data.vectors.places.map(p => { const [x, y] = kmOf(p.lat, p.lon); return { x, y, pop: p.pop, name: p.name }; });
  real.centres = districtCentres(real, [...own, ...osm.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })]);
  const t0 = Date.now(), net = roadNetwork(real, real.centres, data.vectors.places), ms = Date.now() - t0, s = net.stats;
  assert.ok(ms < 8000, 'laid in ' + ms + ' ms');
  assert.ok(s.km[0] > 12000 && s.km[0] < 32000 && s.km[1] > s.km[0] && s.track > 100 && s.unreached < 50, JSON.stringify(s));
  const onMain = new Set(); for (const L of net.legs) if (L.kind === 0) { onMain.add(L.a); onMain.add(L.b); }
  let caps = 0, joined = 0; for (const d of net.capitals) if (d >= 0) { caps++; if (onMain.has(d)) joined++; }
  assert.ok(caps > 60 && joined / caps > .85, joined + ' of ' + caps + ' towns of provinces stand on a main road');
  const km = name => net.lines.filter(l => l.name === name).reduce((a, l) => a + l.legs.reduce((b, i) => b + net.legs[i].km, 0), 0);
  assert.ok(km('Августова дорога') > 1000 && km('Серебряный путь') > 500, 'the great roads of history are laid');
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
