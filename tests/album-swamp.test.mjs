// The swamps of the album (docs/album/swamp.md): the rules that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import swamp, { wetAt, tempAt, swampKind, swampIron, naturalSwamp, SWAMP_RULES, wetlandsOfStage, bogWarmAt, T_BEND, T_BEND_LAT, BOG_WARM, BOG_LOW } from '../src/album/aspects/swamp.js';
import { Chunks } from '../src/album/chunks.js';
import { DEFS } from '../src/album/params.js';
import { BBOX, BBOXES, STAGE, mercX, mercY } from '../src/album/geo.js';
import { decodeWorked } from '../src/album/worked.js';
import { useClimate, decodeClimate } from '../src/album/ground/climate.js';

// ALL: the file; LIST: the wetlands of the polygon of this stage, as the page takes them
const ALL = JSON.parse(fs.readFileSync(new URL('../public/assets/album/swamp/wetlands.json', import.meta.url), 'utf8')).wetlands, LIST = wetlandsOfStage(ALL);
const S3 = STAGE >= 3;
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
  const stage = S3 ? ['17.5 - (ll.x - 38.) * .75 + max(ll.x - 47.5, 0.) * 0.28 - hs * .0062', 'float tb = 9.5 + 2.0 * max(smoothstep(0.86, 0.95, wet), smoothstep(250.0, 450.0, hs));', 'float bq = clamp((tb - t) * .4, 0., 1.), bog = rest * bq * bq * (3. - 2. * bq) * smoothstep(.56, .70, wet);']
    : ['smoothstep(11.5, 9., t)', '17.5 - (ll.x - 38.) * .75 - hs * .0062'];
  for (const s of ['smoothstep(3., 8., hs)', 'smoothstep(.56, .70, wet)', 'smoothstep(.58, .70, wet)', ...stage]) assert.ok(SWAMP_RULES.includes(s), `shader rule: ${s}`);
  const js = swampKind.toString() + tempAt.toString() + bogWarmAt.toString();
  for (const s of ['ss(3, 8, h)', 'ss(tb, tb - 2.5, tempAt(lat, h))', 'ss(.56, .70, wet)', 'ss(.58, .70, wet)', '17.5 - (lat - 38) * .75 + Math.max(lat - T_BEND_LAT, 0) * T_BEND - h * .0062', 'BOG_LOW + (BOG_WARM - BOG_LOW) * Math.max(ss(BOG_WET[0], BOG_WET[1], wet), ss(BOG_HILL[0], BOG_HILL[1], h))']) assert.ok(js.includes(s), `CPU rule: ${s}`);
  for (const f of ['vec4 swampKind(vec2 ll, float hs, float wet)', 'float swampDepth(', 'float swampTreeless(float s, vec2 pk, vec2 ll, float wet, float n2, float n3)', 'float swampTide(vec2 ll)']) assert.ok(SWAMP_RULES.includes(f), f);
  assert.ok(!/uniform|dFdx|fwidth|texDetail/.test(SWAMP_RULES), 'the shared rules need nothing but COMMON: a vertex shader can use them');
  // what the settlements call from the vertex shader of their yards (layers/towns.js, v0.6.140): a contract
  for (const f of ['float swampHeight(vec2 ll)', 'float swampSlope(vec2 ll, float hs)', 'float swampField(vec2 pk, float n2, float n3, float px)', 'float swampDepth(float s, float f, vec2 ll, float hs, float slope, float bog)']) assert.ok(SWAMP_RULES.includes(f), `the settlements call it: ${f}`);
});

test('the rule of each stage: stage 2 is the rule Iberia was set by, stage 3 adds what the plains of the north need', () => {
  const src = fs.readFileSync(new URL('../src/album/aspects/swamp.js', import.meta.url), 'utf8').split('\r\n').join('\n');
  // the text of stage 2 stays in the source as it was, and everything new hangs on the switch
  assert.ok(src.includes('const S3 = STAGE >= 3;'));
  assert.ok(src.includes('  float t = 17.5 - (ll.x - 38.) * .75 - hs * .0062, salt = 1. - smoothstep(3., 8., hs), rest = 1. - salt;\n  float bog = rest * smoothstep(11.5, 9., t) * smoothstep(.56, .70, wet); rest -= bog;\`}'), 'the shader of stage 2');
  assert.ok(src.includes("float swampTide(vec2 ll) { return ${S3 ? 'max(smoothstep(46.5, 47.5, ll.x), ' : ''}max(1. - smoothstep(-5.9, -5.3, ll.y), smoothstep(42.9, 43.2, ll.x) * (1. - smoothstep(-.6, .4, ll.y)))${S3 ? ')' : ''}; }"), 'the tide');
  for (const part of ['T_BEND = S3 ? .28 : 0, T_BEND_LAT = 47.5', 'BOG_WARM = 11.5, BOG_LOW = S3 ? 9.5 : BOG_WARM, BOG_WET = [.86, .95], BOG_HILL = [250, 450]', 'const MIRE = S3 ? { wet: [.82, .96], t: [8, 6], share: .06 } : { wet: [.72, .92], t: [9.5, 7], share: .09 };', 'Math.max(coast * .5, flood * .25, humid * .22, mire * MIRE.share) + mouth[k] * .12 * level;',
    'const humid = ss(.56, .74, wet) * level * (S3 ? ss(2, -25, low) : .45 + .55 * basin);']) assert.ok(src.includes(part), part);
  assert.equal(T_BEND_LAT, 47.5); assert.equal(BOG_WARM, 11.5);
  if (!S3) {
    assert.equal(T_BEND, 0); assert.equal(BOG_LOW, BOG_WARM);
    assert.equal(tempAt(52, 100), 17.5 - 14 * .75 - .62); assert.equal(bogWarmAt(.6, 20), 11.5);
    assert.ok(SWAMP_RULES.includes('float swampTide(vec2 ll) { return max(1. - smoothstep(-5.9, -5.3, ll.y), smoothstep(42.9, 43.2, ll.x) * (1. - smoothstep(-.6, .4, ll.y))); }') && !SWAMP_RULES.includes('float tb'));
  } else {
    assert.equal(T_BEND, .28); assert.equal(BOG_LOW, 9.5);
    assert.ok(Math.abs(tempAt(52, 0) - (17.5 - 14 * .75 + 4.5 * .28)) < 1e-9, 'north of 47.5° the year cools more slowly'); assert.equal(tempAt(43.5, 800), 17.5 - 5.5 * .75 - 800 * .0062);
    assert.equal(bogWarmAt(.6, 20), 9.5, 'a lowland of an ordinary wet climate: a raised bog needs a colder year'); assert.equal(bogWarmAt(.96, 20), 11.5, 'the wettest climate'); assert.equal(bogWarmAt(.6, 500), 11.5, 'the uplands: as in Iberia');
    assert.ok(SWAMP_RULES.includes('return max(smoothstep(46.5, 47.5, ll.x), max(1. - smoothstep(-5.9, -5.3, ll.y)'), 'the Channel and the North Sea have a tide');
  }
  // Iberia is south of the bend, and its bogs are of the uplands or of the wettest climate: nothing of it moves
  assert.equal(tempAt(43.47, 800), 17.5 - 5.47 * .75 - 800 * .0062);
  assert.equal(bogWarmAt(.95, 0), 11.5); assert.equal(bogWarmAt(0, 450), 11.5);
});

test('swamp aspect: the contract function, its uniforms, knobs and pages', () => {
  assert.match(swamp.glsl, /void aspSwamp\(Px p, inout Land L\)/);
  for (const use of ['p.cA.a', 'p.cB.r', 'p.cB.g', 'p.cB.b', 'L.gloss', 'L.cover', 'L.col']) assert.ok(swamp.glsl.includes(use), `uses ${use}`);
  // (stage 3) a flooded forest whose trees are felled is drawn as a reed fen
  assert.equal(swamp.glsl.includes('float felled = kind.w * (1. - smoothstep(.12, .45, L.cover)); kind.w -= felled; kind.y += felled;'), S3);
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

test('swamp from 20 km: an edge of a few pixels, tussocks without a checker', () => {
  const src = fs.readFileSync(new URL('../src/album/aspects/swamp.js', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.ok(src.includes('float swE = clamp(px * 1.2, .012, .07);') && src.includes('float m = mix(smoothstep(-swE, swE, d), clamp(s * 1.05, 0., 1.) * step(slope, .05), far);'), 'the edge is as wide as the pixels allow, never wider than .07');
  assert.ok(src.includes('if (s * 1.05 - f + .3 < -.07 && far <= 0.) return;'), 'the early way out keeps the widest edge');
  assert.ok(src.includes('swampNoise(pk / .085 + 3.)') && !src.includes('vnoise(pk / .085 + 3.)'), 'the tussocks: a noise without the square grain');
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
    if (ch.kind[k] === 0) assert.equal(nat[k], 0, 'a chunk of water holds no swamp');
    const c = ch.centre(k); if (c.lat > BBOX.lat1 + .1 || c.lat < BBOX.lat0 - .1) assert.equal(nat[k], 0, 'nothing outside the region of the album');
  }
});

test('stage 3: land lifted from below the sea holds no swamp by the rule; a wetland of the list still lies on it', () => {
  // the coastal plain of the small world as a polder: dead-level ground at exactly 1 m, as liftDryLand leaves it
  const polder = (lat, lon) => lon >= -8 && lon < -7.2 ? 1 : world(lat, lon);
  const ch = new Chunks(polder), nat = naturalSwamp(ch, polder, {}), k = ch.at(40, -7.6);
  if (S3) assert.equal(nat[k], 0, 'a polder is dry behind its dikes: no marsh of nature');
  else assert.ok(nat[k] >= .3, `stage 2: level ground at the height of the sea, as ever: ${nat[k]}`);
  const named = naturalSwamp(ch, polder, { wetlands: [{ name: 'x', lat: 40, lon: -7.6, km2: 300 }] });
  assert.ok(named[k] > .8, `a wetland known by name lies there in full: ${named[k]}`);
  const src = fs.readFileSync(new URL('../src/album/aspects/swamp.js', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.ok(src.includes('if (S3 && dh < 1e-6 && Math.abs(h - DRY_LAND) < .01) { lifted[k]++; continue; }') && src.includes("import { DRY_LAND } from '../ground/despike.js';"));
});

test('natural swamp: a wetland of the list lays its area over the chunks it covers', () => {
  const ch = new Chunks(world), base = naturalSwamp(ch, world, {});
  const big = { name: 'big', lat: 40, lon: -5.5, km2: 600 }, small = { name: 'small', lat: 41.5, lon: -6, km2: 2 }, hill = { name: 'hill', lat: 38, lon: -2, km2: 600 };
  const poly = { name: 'poly', lat: 37, lon: -5.5, share: .4, poly: [[36.6, -6.2], [36.6, -4.8], [37.4, -4.8], [37.4, -6.2]] };
  const lagoon = { name: 'lagoon', lat: 42, lon: -8.03, km2: 3 };
  const nat = naturalSwamp(ch, world, { wetlands: [big, small, hill, poly, lagoon] });
  const laid = (lat, lon) => { let a = 0; for (let k = 0; k < ch.count; k++) { const c = ch.centre(k); if (Math.hypot((c.lon - lon) * 85.2, (c.lat - lat) * 111.2) < 45) a += (nat[k] - base[k]) * ch.area[k]; } return a; };
  const plain = laid(40, -5.5), steep = laid(38, -2);
  assert.ok(plain > 600 * .8 && plain < 600 * 1.2, `on level ground the area of the wetland is kept: ${plain.toFixed(0)} of 600 km²`);
  assert.ok(steep > 600 * .4 && steep < plain * .95, `steep ground holds less of it: ${steep.toFixed(0)} against ${plain.toFixed(0)} km²`);
  assert.ok(nat[ch.at(40, -5.5)] > .8, 'full in the middle');
  const own = nat[ch.at(41.5, -6)];
  assert.ok(own >= .05 && own < .12, `a small wetland still shows in its own chunk: ${own}`);
  assert.ok(Math.abs(nat[ch.at(37, -5.5)] - .4) < .02 && nat[ch.at(37.8, -5.5)] === base[ch.at(37.8, -5.5)], 'an outline gives its share inside and nothing outside');
  const kw = ch.at(42, -8.03); assert.equal(ch.kind[kw], 0, 'the middle of the lagoon is water');
  assert.equal(nat[kw], 0); assert.ok(ch.links[kw].some(l => ch.kind[l.k] === 1 && nat[l.k] >= .05), 'a wetland in a lagoon goes to its shore');
});

test('natural swamp: a river along the border of a chunk floods its plain, most of all at the mouth', () => {
  const river = { rank: 5, pts: [[-4.5, 39.02], [-7.97, 39.02]] }, ch = new Chunks(world, [river]), nat = naturalSwamp(ch, world, {});
  const onRiver = [], away = [], mouth = [], coast = [];
  for (let k = 0; k < ch.count; k++) {
    if (ch.kind[k] !== 1) continue;
    const c = ch.centre(k), river2 = ch.links[k].some(l => l.river === 2 && l.wet >= 5), sea = ch.links[k].some(l => ch.kind[l.k] === 0);
    if (c.lon > -6.8 && c.lon < -4.6 && c.lat > 37 && c.lat < 42) (river2 ? onRiver : away).push(nat[k]);
    if (c.lon < -7.3 && sea && c.lat > 37 && c.lat < 42) (river2 ? mouth : Math.abs(c.lat - 39.02) > .6 ? coast : []).push(nat[k]);
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(onRiver.length >= 20 && away.length > 200 && mouth.length >= 1 && coast.length > 10, `${onRiver.length} ${away.length} ${mouth.length} ${coast.length}`);
  assert.ok(mean(onRiver) > .15 && mean(away) < .02, `the flood plain: ${mean(onRiver).toFixed(2)} on the river, ${mean(away).toFixed(2)} away from it`);
  assert.ok(mean(mouth) > mean(coast) + .05, `more at the mouth: ${mean(mouth).toFixed(2)} against ${mean(coast).toFixed(2)} on the rest of the coast`);
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
  const first = ALL.filter(w => !w.stage);
  assert.ok(first.length >= 80, `${first.length} wetlands`);
  // an entry of stage 3 says so; the page takes the entries of its own stage and of the stages before it
  assert.deepEqual(wetlandsOfStage(ALL, 2), first); assert.deepEqual(wetlandsOfStage(ALL, 3), ALL); assert.equal(LIST.length, S3 ? ALL.length : first.length);
  assert.ok(ALL.length - first.length >= 40, `${ALL.length - first.length} wetlands of stage 3`);
  const names = new Set();
  for (const w of ALL) {
    assert.ok(w.name && !names.has(w.name), `name: ${w.name}`); names.add(w.name);
    assert.ok(w.stage === undefined || w.stage === 3, `${w.name}: stage`);
    if (w.stage) assert.ok(w.unv === true && w.src, `${w.name}: an entry of stage 3 is an estimate and names an article`);
    const box = BBOXES[w.stage || 2];
    assert.ok(w.lat >= box.lat0 && w.lat <= box.lat1 && w.lon >= box.lon0 && w.lon <= box.lon1, `${w.name}: inside the region of its stage`);
    if (w.poly) for (const [la, lo] of w.poly) assert.ok(la >= box.lat0 && la <= box.lat1 && lo >= box.lon0 && lo <= box.lon1, `${w.name}: the outline inside the region`);
    assert.ok(['bog', 'fen', 'salt', 'carr'].includes(w.type), `${w.name}: type`);
    assert.ok(typeof w.src === 'string', `${w.name}: source`);
    if (w.poly) assert.ok(w.share > 0 && w.share < 1 && w.poly.length >= 3, `${w.name}: outline`); else assert.ok(w.km2 > 0 && w.km2 < 3000, `${w.name}: area`);
  }
  for (const part of ['Гвадалквивир', 'Эбро', 'Альбуфера Валенсии', 'Ланды', 'Даймьель', 'Ла-Ханда', 'Антела', 'Тежу', 'Саду', 'Авейру', 'Нарбонн', 'Шистрал']) assert.ok(first.some(w => w.name.includes(part)), part);
  for (const part of ['Пуатевен', 'Солонь', 'долины Соммы', 'Камарг, восточная', 'Высокие Фани', 'Буртанг', 'Гарба', 'Макта']) assert.ok(ALL.some(w => w.stage === 3 && w.name.includes(part)), part);
  assert.ok(ALL.filter(w => w.src).length >= ALL.length - 3, 'almost every entry names its source');
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
  // the chunks as the album builds them (main.js): the lakes of the water aspect are cut out of the land
  const lakes = (JSON.parse(fs.readFileSync(new URL('../public/assets/album/water/lakes.json', import.meta.url), 'utf8')).lakes || []).filter(l => !l.shoal && l.ring);
  // (stage 3: chunks lie on the worked land only, and the rule reads the baked climate, as on the page — without it
  // the stand-in formula of Iberia answers, and north of the Pyrenees and in the Sahara it knows nothing)
  let worked = null;
  if (S3) {
    const gun = name => { const g = zlib.gunzipSync(fs.readFileSync(new URL('../public/assets/album/' + name, import.meta.url))); return g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength); };
    worked = decodeWorked(gun('worked.bin.gz')); useClimate(decodeClimate(gun('ground/climate.bin.gz')));
  }
  let ch, nat;
  try { ch = worked ? new Chunks(at, rivers, lakes, worked.at) : new Chunks(at, rivers, lakes); nat = naturalSwamp(ch, at, { wetlands: LIST }); } finally { if (S3) useClimate(null); }
  const near = (lat, lon) => { const k = ch.at(lat, lon); return Math.max(nat[k], ...ch.neighbours(k).map(m => nat[m])); };
  for (const [name, lat, lon, min] of [['Guadalquivir', 37, -6.25, .7], ['Daimiel', 39.14, -3.7, .6], ['Ebro delta', 40.7, .75, .5], ['Albufera', 39.33, -.35, .5], ['Landes', 44.2, -.7, .3], ['Xistral', 43.47, -7.6, .25],
    ['Antela', 42.08, -7.75, .25], ['Tagus', 38.92, -8.92, .5], ['La Janda', 36.25, -5.85, .4], ['Aveiro', 40.68, -8.67, .4]]) assert.ok(near(lat, lon) >= min, `${name}: ${near(lat, lon).toFixed(2)}`);
  let land = 0, wet = 0, area = 0, iron = 0, plainLand = 0, plainWet = 0;
  for (let k = 0; k < ch.count; k++) {
    if (ch.kind[k] !== 1) { assert.equal(nat[k], 0); continue; }
    const c = ch.centre(k), plain = c.lat > 47.6 && c.lat < 50.2 && c.lon > .3 && c.lon < 5.2;      // the plains of the north of France
    land++; if (plain) plainLand++;
    if (nat[k] > 0) { wet++; if (plain) plainWet++; area += nat[k] * ch.area[k]; if (swampIron(nat[k], c.lat, c.lon, ch.height[k]) > 0) iron++; }
  }
  // (stage 3: the low lands of the North Sea, the Atlantic marshes and the wet plains of France — the share of the
  // whole polygon is higher than that of Iberia and the south of France)
  const lim = S3 ? { share: [.05, .11], area: [18000, 40000], iron: 150 } : { share: [.03, .09], area: [5000, 14000], iron: 60 };
  assert.ok(wet / land > lim.share[0] && wet / land < lim.share[1], `swamp in ${(100 * wet / land).toFixed(1)} % of the land chunks`);
  assert.ok(area > lim.area[0] && area < lim.area[1], `${area.toFixed(0)} km² of swamp`);
  assert.ok(iron > lim.iron && iron < wet * .6, `${iron} chunks with bog iron`);
  if (S3) {
    for (const [name, lat, lon, min] of [['Marais poitevin', 46.33, -.9, .5], ['Camargue', 43.5, 4.55, .5], ['Sologne', 47.5, 1.9, .1], ['Somme', 50.0, 2.1, .1], ['Hautes Fagnes', 50.52, 6.1, .3], ['Gharb', 34.6, -6.3, .2], ['Macta', 35.65, -.1, .5]]) assert.ok(near(lat, lon) >= min, `${name}: ${near(lat, lon).toFixed(2)}`);
    // by the numbers of Iberia four chunks of ten held swamp here (42.7 %; now 9.0 %) — a veil of brown bog over the Paris basin (16.11.2026)
    assert.ok(plainLand > 800 && plainWet / plainLand < .25, `the plains of the north of France: swamp in ${(100 * plainWet / plainLand).toFixed(1)} % of ${plainLand} chunks`);
    assert.ok(near(48.2, 1.7) < .1, `no marsh on the chalk of the Beauce: ${near(48.2, 1.7)}`);
    const polder = nat[ch.at(52.45, 5.5)]; assert.ok(polder < .05, `no marsh of nature on the polders of Flevoland: ${polder}`);
  }
  for (const [lat, lon] of [[41.3, -6.3], [39.75, -6.9], [38.2, -7.5], [41.3, .2]]) assert.ok(near(lat, lon) < .15, `no marsh on the reservoir at ${lat}, ${lon}: ${near(lat, lon)}`);
});
