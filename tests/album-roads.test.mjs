// Roads of the album (docs/album/roads.md): the centres of districts, the cheapest way between two of them over the
// relief, the network — everything that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Chunks, kmOf, llOf, FN, FKM } from '../src/album/chunks.js';
import { buildDivision, LAND } from '../src/album/division/build.js';
import { districtCentres } from '../src/album/division/centres.js';
import { roadGround, legBetween, stepCost, roadNetwork, roadLine, STEEP, CROSSING, HARD } from '../src/album/roads/routes.js';
import { decodeSites, SITE_KINDS } from '../src/album/town/sites.js';
import { PAGES } from '../src/album/pages.js';

// a made-up island: a steep ridge 2200 m high runs north–south down its middle with one pass in it; a great river runs
// east–west across the western half
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
const G = roadGround(div);

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

test('roads: a leg — level ground is cheap, a slope dear, a river is crossed once, the ridge at its pass', () => {
  assert.ok(STEEP[1] > STEEP[0] && CROSSING[3] > CROSSING[2] && CROSSING[2] > CROSSING[1] && CROSSING[1] > 0 && HARD > 3);
  const flatA = texel(IX0 + 30, IY1 - 40), flatB = texel(IX0 + 110, IY1 - 40), flat = legBetween(G, flatA, flatB);
  assert.ok(flat && flat.path[0] === flatA && flat.path[flat.path.length - 1] === flatB);
  assert.ok(Math.abs(flat.km - 80) < 4 && flat.cost < flat.km * 1.25, 'over the plain a road is straight: ' + flat.km.toFixed(1) + ' km, cost ' + flat.cost.toFixed(1));
  assert.equal(flat.crossings.length, 0);
  // across the river: one crossing, and it costs
  const over = legBetween(G, texel(IX0 + 80, RIVER_Y - 25), texel(IX0 + 80, RIVER_Y + 25));
  assert.equal(over.crossings.length, 1, 'the river is crossed once'); assert.ok(over.cost > over.km + CROSSING[3] * .9);
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

test('roads: the network — through the centres of districts, main roads between the towns, a track to every district', () => {
  const net = roadNetwork(div, div.centres, towns, G), s = net.stats;
  assert.ok(s.main > 6 && s.track > 10 && s.legs > s.main + s.track, JSON.stringify(s));
  assert.ok(s.unreached <= 1, s.unreached + ' districts without a road');
  // every line begins and ends at the centre of a district and passes through centres only at the joints of its legs
  const centreAt = new Map(); for (let d = 0; d < div.count; d++) if (div.centres.texel[d] >= 0) centreAt.set(div.centres.x[d].toFixed(3) + ',' + div.centres.y[d].toFixed(3), d);
  const key = p => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  for (const l of net.lines) {
    assert.ok(l.pts.length >= 2 && centreAt.has(key(l.pts[0])) && centreAt.has(key(l.pts[l.pts.length - 1])), 'a line runs from centre to centre');
    assert.ok(l.pts.filter(p => centreAt.has(key(p))).length === l.legs.length + 1, 'it passes a centre at every joint of its legs');
    for (let i = 1; i < l.pts.length; i++) assert.ok(Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]) < 4, 'no jumps along a line');
    for (const [x, y] of l.pts) assert.ok(G.land[texel(x, y)], 'a road never leaves the land');
  }
  // no leg is laid twice; the four towns are joined by main roads
  const seen = new Set(); for (const l of net.lines) for (const i of l.legs) { assert.ok(!seen.has(i)); seen.add(i); }
  const mainEnds = new Set(net.lines.filter(l => l.kind === 0).flatMap(l => l.legs.flatMap(i => [net.legs[i].a, net.legs[i].b])));
  for (const t of towns) { const [x, y] = kmOf(t.lat, t.lon); assert.ok(mainEnds.has(div.cells[texel(x, y)]), t.name + ' stands on a main road'); }
  // east and west are joined over the pass, not over the high crest
  let crest = 0; for (const l of net.lines) for (const [x, y] of l.pts) if (Math.abs(x - RX) < 3) crest = Math.max(crest, G.hgt[texel(x, y)]);
  assert.ok(crest > 0 && crest < 1100, 'the ridge is crossed at ' + Math.round(crest) + ' m');
  assert.deepEqual(roadNetwork(div, div.centres, towns, G).stats, s, 'the same division gives the same roads');
  const ll = roadLine(net.lines[0].pts); assert.equal(ll.length, net.lines[0].pts.length); assert.ok(ll[0][0] > -7 && ll[0][0] < 0 && ll[0][1] > 38 && ll[0][1] < 43, 'lines come out as lon, lat');
});

test('roads: the real settlement sites and the pages of the album', () => {
  const f = new URL('../public/assets/album/town/sites.json.gz', import.meta.url), sites = decodeSites(JSON.parse(gunzipSync(readFileSync(f))));
  assert.ok(statSync(f).size < 4e5, 'the file stays small'); assert.ok(sites.length > 5000, sites.length + ' sites');
  assert.deepEqual(SITE_KINDS, ['city', 'town', 'village']);
  for (let i = 0; i < sites.length; i++) { const s = sites[i]; assert.ok(s.lat > 35.2 && s.lat < 44.8 && s.lon > -10 && s.lon < 4.5 && s.pop >= 400 && s.kind >= 0 && s.kind <= 2); if (i) assert.ok(s.pop <= sites[i - 1].pop, 'the most populous first'); }
  assert.ok(sites.slice(0, 40).some(s => /Madrid|Мадрид/.test(s.name)) && sites.slice(0, 40).some(s => /Barcelona|Барселона/.test(s.name)));
  for (const id of ['roads', 'roads-centres', 'roads-pass', 'roads-20']) assert.ok(PAGES.some(p => p.id === id && p.group === 'Города и дороги'), id);
});
