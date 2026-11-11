// The swamps of the album (docs/album/swamp.md): the rules that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import swamp, { wetAt, tempAt, swampKind, swampIron, naturalSwamp, SWAMP_RULES } from '../src/album/aspects/swamp.js';
import { Chunks } from '../src/album/chunks.js';
import { DEFS } from '../src/album/params.js';
import { BBOX, mercX, mercY } from '../src/album/geo.js';

const LIST = JSON.parse(fs.readFileSync(new URL('../public/assets/album/swamp/wetlands.json', import.meta.url), 'utf8')).wetlands;
const top = k => Object.entries(k).sort((a, b) => b[1] - a[1])[0][0];
// a small world for the rules: sea in the west, a level plain at the height of the sea, a level plain inland, steep hills
// in the east; a dead-level "reservoir" inland in the north
const world = (lat, lon) => {
  if (lon < -8) return -50;
  if (lon < -7.2) return 1.5 + .3 * Math.sin(lat * 40) * Math.sin(lon * 40);
  if (lat > 43 && lon < -5) return 300;                                   // exactly level: a reservoir in the height data
  if (lon < -4) return 400 + 3 * Math.sin(lat * 55) * Math.cos(lon * 47);
  return 600 + 500 * Math.abs(Math.sin(lat * 30) * Math.sin(lon * 30));
};

test('swamp kinds: the four shares add up to 1 and follow height, wetness and the sea', () => {
  for (const [lat, lon, h] of [[43.47, -7.6, 800], [39.14, -3.7, 610], [37, -6.25, 1], [44.2, -0.7, 80], [40.3, -7.6, 1700], [36.5, -2, 5], [42, 1, 2200]]) {
    const k = swampKind(lat, lon, h), sum = k.bog + k.fen + k.salt + k.carr;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${lat},${lon},${h}: sum ${sum}`);
    for (const v of Object.values(k)) assert.ok(v >= -1e-9 && v <= 1 + 1e-9);
  }
  assert.equal(top(swampKind(43.47, -7.6, 800)), 'bog', 'the cold wet plateau of Xistral is a raised bog');
  assert.equal(top(swampKind(40.33, -7.62, 1700)), 'bog', 'Serra da Estrela');
  assert.equal(top(swampKind(39.14, -3.7, 610)), 'fen', 'the dry plain of La Mancha keeps a reed fen');
  assert.equal(top(swampKind(37, -6.25, 1)), 'salt', 'the mouth of the Guadalquivir is salt marsh');
  assert.equal(top(swampKind(40.7, .75, 1)), 'salt', 'the delta of the Ebro');
  assert.equal(top(swampKind(44.2, -0.7, 80)), 'carr', 'the warm wet plain of the Landes is flooded forest');
  assert.equal(top(swampKind(41.6, -5, 700)), 'fen', 'a flood plain of the cold dry plateau is not a bog');
  assert.ok(wetAt(43.4, -8, 300) > .9 && wetAt(37.6, -1.8, 100) < .3, 'wet north-west, dry south-east');
  assert.ok(tempAt(38, 0) > tempAt(44, 0) && tempAt(40, 0) > tempAt(40, 2000));
});

test('swamp rules: the numbers on the CPU are the numbers of the shader', () => {
  for (const s of ['smoothstep(3., 8., hs)', 'smoothstep(11.5, 9., t)', 'smoothstep(.56, .70, wet)', 'smoothstep(.58, .70, wet)', '17.5 - (ll.x - 38.) * .75 - hs * .0062']) assert.ok(SWAMP_RULES.includes(s), `shader rule: ${s}`);
  const js = swampKind.toString() + tempAt.toString();
  for (const s of ['ss(3, 8, h)', 'ss(11.5, 9,', 'ss(.56, .70, wet)', 'ss(.58, .70, wet)', '17.5 - (lat - 38) * .75 - h * .0062']) assert.ok(js.includes(s), `CPU rule: ${s}`);
  for (const f of ['vec4 swampKind(vec2 ll, float hs, float wet)', 'float swampDepth(', 'float swampTreeless(float s, vec2 pk, vec2 ll, float wet, float n2, float n3)', 'float swampTide(vec2 ll)']) assert.ok(SWAMP_RULES.includes(f), f);
  assert.ok(!/uniform|dFdx|fwidth|texDetail/.test(SWAMP_RULES), 'the shared rules need nothing but COMMON: a vertex shader can use them');
});

test('swamp aspect: the contract function, its uniforms, knobs and pages', () => {
  assert.match(swamp.glsl, /void aspSwamp\(Px p, inout Land L\)/);
  for (const use of ['p.cA.a', 'p.cB.r', 'p.cB.g', 'p.cB.b', 'L.gloss', 'L.cover', 'L.col']) assert.ok(swamp.glsl.includes(use), `uses ${use}`);
  const declared = [...swamp.glsl.matchAll(/uniform float ([^;]+);/g)].flatMap(m => m[1].split(',').map(s => s.trim()));
  assert.ok(declared.length > 0);
  for (const u of declared) assert.ok(swamp.uniforms[u], `uniform ${u} has a value`);
  for (const d of swamp.params) if (d.uniform) assert.ok(swamp.uniforms[d.uniform], `knob ${d.key} drives ${d.uniform}`);
  assert.match(swamp.glsl, /if \(s < \.004/, 'chunks without swamp cost nothing');
  const pages = swamp.pages, ids = pages.map(p => p.id), keys = new Set(DEFS.map(d => d.key));
  assert.ok(pages.length >= 9 && pages.every(p => p.group === 'Болота'));
  for (const id of ['swamp-salt', 'swamp-fen', 'swamp-bog', 'swamp-carr', 'swamp-200', 'swamp-winter', 'swamp-seam', 'swamp-seam-grid', 'swamp-map']) assert.ok(ids.includes(id), id);
  for (const pg of pages) for (const k of Object.keys(pg.p)) assert.ok(keys.has(k), `${pg.id}: unknown knob ${k}`);
  const a = pages.find(p => p.id === 'swamp-seam').cam, b = pages.find(p => p.id === 'swamp-seam-grid').cam;
  assert.deepEqual(a, b, 'the seam is shown from the same place with and without the grid');
});

test('natural swamp: level ground at the sea and in the wet takes it; hills, the sea and reservoirs do not', () => {
  const ch = new Chunks(world), nat = naturalSwamp(ch, world, {});
  assert.equal(nat.length, ch.count);
  const at = (lat, lon) => nat[ch.at(lat, lon)];
  assert.ok(at(40, -7.6) >= .3, `level ground at the height of the sea: ${at(40, -7.6)}`);
  assert.equal(at(40, -9), 0, 'no swamp in the sea');
  assert.equal(at(40, -2), 0, 'no swamp on steep hills');
  assert.equal(at(43.6, -6), 0, 'a dead-level surface inland is a reservoir, not a marsh');
  assert.ok(at(44.2, -6.5) === 0 && at(40, -6) < .25, 'a dry level plain keeps little');
  for (let k = 0; k < ch.count; k++) {
    assert.ok(nat[k] >= 0 && nat[k] <= .95);
    if (ch.land[k] === 0) assert.equal(nat[k], 0);
    const c = ch.centre(k); if (c.lat > 44.9 || c.lat < 35.1) assert.equal(nat[k], 0, 'nothing outside the region of the album');
  }
});

test('natural swamp: a wetland of the list lays its area over the rule; a river floods its plain', () => {
  const ch = new Chunks(world), base = naturalSwamp(ch, world, {});
  const big = { name: 'big', lat: 40, lon: -5.5, km2: 600 }, small = { name: 'small', lat: 41.5, lon: -6, km2: 2 }, hill = { name: 'hill', lat: 38, lon: -2, km2: 300 };
  const poly = { name: 'poly', lat: 37, lon: -5.5, share: .4, poly: [[36.6, -6.2], [36.6, -4.8], [37.4, -4.8], [37.4, -6.2]] };
  const nat = naturalSwamp(ch, world, { wetlands: [big, small, hill, poly] });
  let area = 0; for (let k = 0; k < ch.count; k++) { const c = ch.centre(k); if (Math.hypot((c.lon + 5.5) * 85, (c.lat - 40) * 111) < 40) area += (nat[k] - base[k]) * 100; }
  assert.ok(area > 600 * .6 && area < 600 * 1.4, `the area of the wetland is kept: ${area.toFixed(0)} of 600 km²`);
  assert.ok(nat[ch.at(40, -5.5)] > .8, 'full in the middle');
  assert.ok(nat[ch.at(41.5, -6)] >= .05 && nat[ch.at(41.5, -6)] < .12, 'a small wetland still shows in its own chunk');
  const onHill = nat[ch.at(38, -2)], around = nat[ch.at(38.1, -1.9)];
  assert.ok(onHill > .5 && around < .5, `steep ground holds less of a listed wetland: ${onHill} ${around}`);
  assert.ok(Math.abs(nat[ch.at(37, -5.5)] - .4) < .02 && nat[ch.at(37.8, -5.5)] === base[ch.at(37.8, -5.5)], 'an outline gives its share inside and nothing outside');
  const river = { rank: 5, pts: [[-4.5, 39], [-7.95, 39]] }, flooded = naturalSwamp(ch, world, { rivers: [river] });
  assert.ok(flooded[ch.at(39, -5.5)] > base[ch.at(39, -5.5)] && flooded[ch.at(39, -5.5)] >= .1, 'the flood plain of a large river');
  assert.ok(flooded[ch.at(39, -7.9)] > base[ch.at(39, -7.9)], 'more at the mouth');
});

test('bog iron: fresh mires of a humid climate hold it; salt marsh, dry fens and thin swamps do not', () => {
  assert.equal(swampIron(.05, 44.2, -0.7, 80), 0, 'too little swamp');
  assert.equal(swampIron(.9, 37, -6.25, 1), 0, 'salt marsh');
  assert.equal(swampIron(.8, 39.14, -3.7, 610), 0, 'a fen of the dry plain');
  const landes = swampIron(.4, 44.2, -0.7, 80), bog = swampIron(.4, 43.47, -7.6, 800);
  assert.ok(landes > .3 && landes <= .4, `the Landes: ${landes}`);
  assert.ok(bog > 0 && bog < landes * .6, `the dome of a raised bog holds less: ${bog}`);
  assert.ok(swampIron(.8, 44.2, -0.7, 80) > landes, 'more swamp, more iron');
});

test('the list of wetlands: every entry is complete and inside the region; the named ones are there', () => {
  assert.ok(LIST.length >= 80, `${LIST.length} wetlands`);
  const names = new Set();
  for (const w of LIST) {
    assert.ok(w.name && !names.has(w.name), `name: ${w.name}`); names.add(w.name);
    assert.ok(w.lat >= BBOX.lat0 && w.lat <= BBOX.lat1 && w.lon >= BBOX.lon0 && w.lon <= BBOX.lon1, `${w.name}: inside the region`);
    assert.ok(['bog', 'fen', 'salt', 'carr'].includes(w.type), `${w.name}: type`);
    assert.ok(typeof w.src === 'string', `${w.name}: source`);
    if (w.poly) assert.ok(w.share > 0 && w.share < 1 && w.poly.length >= 3, `${w.name}: outline`); else assert.ok(w.km2 > 0 && w.km2 < 3000, `${w.name}: area`);
  }
  for (const part of ['Гвадалквивир', 'Эбро', 'Альбуфера Валенсии', 'Ланды', 'Даймьель', 'Ла-Ханда', 'Антела', 'Тежу', 'Саду', 'Авейру', 'Нарбонн', 'Шистрал']) assert.ok(LIST.some(w => w.name.includes(part)), part);
  assert.ok(LIST.filter(w => w.src).length >= LIST.length - 3, 'almost every entry names its source');
});

test('swamp init: lays the natural state, the frost demonstration and the map of swamps over the chunks', async () => {
  const ch = new Chunks(world), values = Object.fromEntries(DEFS.map(d => [d.key, d.value])), subs = [];
  const params = { get: k => values[k], on: f => subs.push(f), setMany(o) { Object.assign(values, o); for (const f of subs) f(null); }, set(k, v) { values[k] = v; for (const f of subs) f(k, v); } };
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ wetlands: [{ name: 'x', lat: 40, lon: -5.5, km2: 300, type: 'fen', src: '' }] }) });
  try {
    subs.push(key => { if (key == null) ch.reset(); });                // what chunktool.js does on every change of the page
    const album = { chunks: ch, params, data: { base: { at: world }, vectors: { rivers: [] } } };
    const layer = await swamp.init(album);
    const k = ch.at(40, -5.5), sea = ch.at(40, -9);
    assert.ok(ch.get('swamp', k) > .8 && ch.getNatural('swamp', k) > .8 && album.swamp.natural[k] > .8);
    ch.set('swamp', k, 0); ch.reset(); assert.ok(ch.get('swamp', k) > .8, 'reset() returns the swamp');
    assert.equal(ch.get('ice', k), 0);
    params.set('swampFrost', .8);
    assert.ok(Math.abs(ch.get('ice', k) - .8) < .01 && ch.get('snow', k) > .2, 'frost: ice on the swamp, snow on the land');
    assert.equal(ch.get('ice', sea), 0); assert.equal(ch.get('snow', sea), 0);
    assert.ok(ch.get('snow', ch.at(40, -2)) > 0 && ch.get('ice', ch.at(40, -2)) === 0, 'dry land gets snow but no ice');
    params.set('swampFrost', 0); assert.equal(ch.get('ice', k), 0, 'and thaws');
    for (const id of ['share', 'kind', 'iron']) { params.set('swampMap', id); assert.ok(ch.uniforms.uChunkShow.value > 0, `map ${id}`); assert.equal(ch.bytes.D[sea * 4 + 3], 0); }
    assert.equal(ch.bytes.D[k * 4 + 3], 0, 'no bog iron in a dry fen'); params.set('swampMap', 'share'); assert.equal(ch.bytes.D[k * 4 + 3], 255);
    ch.set('swamp', sea + 5, .5); layer.update(); assert.equal(typeof layer.id, 'string');
    params.set('swampMap', ''); assert.equal(ch.uniforms.uChunkShow.value, 0);
    assert.ok(album.swamp.kindOf(k).fen > .9 && album.swamp.ironOf(k) === 0);
  } finally { globalThis.fetch = real; }
});

// with the real heights of the album (not in git; scripts/worktree-setup.mjs copies them)
const META = new URL('../public/album-data/meta.json', import.meta.url);
test('natural swamp on the real heights: the known swamps are where they should be', { skip: !fs.existsSync(META) }, () => {
  const b = JSON.parse(fs.readFileSync(META, 'utf8')).base, gz = zlib.gunzipSync(fs.readFileSync(new URL('../public/album-data/' + b.file, import.meta.url)));
  const raw = new Uint16Array(gz.buffer, gz.byteOffset, gz.byteLength / 2), n = 2 ** b.z, rect = [b.x0 / n, b.y0 / n, n * 256 / b.w, n * 256 / b.h];
  const at = (lat, lon) => {
    const x = Math.max(0, Math.min(b.w - 1.001, (mercX(lon) - rect[0]) * rect[2] * b.w - .5)), y = Math.max(0, Math.min(b.h - 1.001, (mercY(lat) - rect[1]) * rect[3] * b.h - .5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * b.w + i;
    return ((raw[k] * (1 - fx) + raw[k + 1] * fx) * (1 - fy) + (raw[k + b.w] * (1 - fx) + raw[k + b.w + 1] * fx) * fy) / 4 - 8192;
  };
  const rivers = JSON.parse(fs.readFileSync(new URL('../public/album-data/vectors.json', import.meta.url), 'utf8')).rivers;
  const ch = new Chunks(at), nat = naturalSwamp(ch, at, { rivers, wetlands: LIST });
  const near = (lat, lon) => { const k = ch.at(lat, lon); return Math.max(nat[k], ...ch.neighbours(k).map(m => nat[m])); };
  for (const [name, lat, lon, min] of [['Guadalquivir', 37, -6.25, .7], ['Daimiel', 39.14, -3.7, .6], ['Ebro delta', 40.7, .75, .5], ['Albufera', 39.33, -.35, .5], ['Landes', 44.2, -.7, .3], ['Xistral', 43.47, -7.6, .25],
    ['Antela', 42.08, -7.75, .25], ['Tagus', 38.92, -8.92, .5], ['La Janda', 36.25, -5.85, .4], ['Aveiro', 40.68, -8.67, .4]]) assert.ok(near(lat, lon) >= min, `${name}: ${near(lat, lon).toFixed(2)}`);
  let land = 0, wet = 0, area = 0, iron = 0;
  for (let k = 0; k < ch.count; k++) {
    if (!(ch.land[k] > 0)) { assert.equal(nat[k], 0); continue; }
    land++; if (nat[k] > 0) { wet++; area += nat[k] * ch.land[k] * 100; const c = ch.centre(k); if (swampIron(nat[k], c.lat, c.lon, ch.height[k]) > 0) iron++; }
  }
  assert.ok(wet / land > .03 && wet / land < .09, `swamp in ${(100 * wet / land).toFixed(1)} % of the land chunks`);
  assert.ok(area > 5000 && area < 14000, `${area.toFixed(0)} km² of swamp`);
  assert.ok(iron > 60 && iron < wet * .6, `${iron} chunks with bog iron`);
  for (const [lat, lon] of [[41.3, -6.3], [39.75, -6.9], [38.2, -7.5], [41.3, .2]]) assert.ok(near(lat, lon) < .15, `no marsh on the reservoir at ${lat}, ${lon}: ${near(lat, lon)}`);
});
