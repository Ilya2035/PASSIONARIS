// The ground of the album (docs/album/ground.md): the baked climate and its rules, the grain of the ground, the
// aspect «Земля», and the parts of the ground shader that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { CLIM_N, CLIM_MAGIC, WET_OF, wetOfAlpha, encodeClimate, decodeClimate, useClimate, climateAt, wetAt, wetFormula, wetRise, summerAt, warmAt,
  treelineAt, treelineOf, climateTexels, WARM, TREE_SOFT } from '../src/album/ground/climate.js';
import { COMMON } from '../src/album/glsl.js';
import { CHUNK_KM, CN, CI0, CJ0 } from '../src/album/chunks.js';
import { GROUND_TILES } from '../src/album/data.js';
import ground from '../src/album/aspects/ground.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const file = name => new URL(`../public/assets/album/ground/${name}`, import.meta.url);
const baked = () => decodeClimate(zlib.gunzipSync(fs.readFileSync(file('climate.bin.gz'))));
const near = (a, b, e) => Math.abs(a - b) <= e;

test('ground climate: the scale of wetness rises with the moisture index, and its steps stand where the forest rules read them', () => {
  let last = -1;
  for (let a = 0; a <= 1.0001; a += .01) { const w = wetOfAlpha(a); assert.ok(w >= last && w >= 0 && w <= 1, `α ${a}`); last = w; }
  assert.equal(wetOfAlpha(0), 0); assert.equal(wetOfAlpha(1), 1); assert.equal(wetOfAlpha(2), 1);
  assert.ok(wetOfAlpha(.4) <= .2 + 1e-9, 'α .4 and drier: steppe, no trees');
  assert.ok(near(wetOfAlpha(.5), .30, .011) && wetOfAlpha(.82) >= .58, 'open woodland from α .5, closed forest from α .82');
  assert.ok(WET_OF.every((p, i) => !i || (p[0] > WET_OF[i - 1][0] && p[1] > WET_OF[i - 1][1])));
});

test('ground climate: the file is written and read back the same, to a byte', () => {
  const n = 4, N = n * n, mk = f => Float32Array.from({ length: N }, (_, i) => f(i));
  const src = { x0: -880, y0: 3880, km: 5, wet: mk(i => i / 15), summer: mk(i => 1 - i / 15), warm: mk(i => 10 + i * 2), year: mk(i => i - 3) };
  const c = decodeClimate(encodeClimate(src));
  assert.equal(c.n, n); assert.equal(c.x0, -880); assert.equal(c.y0, 3880); assert.equal(c.km, 5);
  assert.equal(c.data[1 * 4], Math.round(1 / 15 * 255)); assert.equal(c.data[15 * 4 + 1], 0);
  assert.equal(c.data[5 * 4 + 2], Math.round((20 - WARM[0]) / (WARM[1] - WARM[0]) * 255));
  assert.equal(decodeClimate(new Uint8Array(40)), null, 'not a climate file');
  assert.equal(decodeClimate(encodeClimate(src).subarray(0, 30)), null, 'a file cut short');
});

test('ground climate: the baked map covers the square of the chunks and says what everyone knows of Iberia', () => {
  const c = baked();
  assert.ok(c, CLIM_MAGIC); assert.equal(c.n, CLIM_N);
  assert.equal(c.x0, CI0 * CHUNK_KM); assert.equal(c.y0, CJ0 * CHUNK_KM); assert.ok(near(c.km * c.n, CN * CHUNK_KM, 1e-6), 'the square of the chunks: bake again when it changes');
  useClimate(c);
  try {
    const wet = (la, lo) => wetAt(la, lo, 0);
    // wet rim, dry heart, desert corner
    assert.ok(wet(42.88, -8.54) > .8 && wet(43.36, -5.85) > .8, 'Galicia and Asturias: Atlantic forest');
    assert.ok(wet(40.42, -3.70) > .24 && wet(40.42, -3.70) < .40, `Madrid: steppe with open woodland, ${wet(40.42, -3.70)}`);
    assert.ok(wet(39.86, -4.02) < .32 && wet(38.99, -1.86) < .32, 'Toledo and Albacete: steppe');
    assert.ok(wet(36.84, -2.46) < .15, `Almería: desert, ${wet(36.84, -2.46)}`);
    assert.ok(wet(41.55, -.20) < .22 && wet(42.20, -1.50) < .22 && wet(37.05, -2.40) < .14, 'the dry lands known by name: Monegros, Bardenas, Tabernas');
    assert.ok(wet(43.95, .45) > .60 && wet(43.95, -.75) > .60 && wet(43.95, 1.65) > .60, 'Gascony, where the pages of the forest lie: closed forest');
    assert.ok(wet(42.63, .66) > .9, 'the Pyrenees');
    assert.ok(wet(42.34, -3.70) > wet(40.42, -3.70) + .12 && wet(42.34, -3.70) < wet(43.36, -5.85), 'Burgos: between the plateau and the coast');
    // the summer
    assert.ok(summerAt(37.39, -5.98) < .3 && summerAt(43.36, -5.85) > .8 && summerAt(43.60, 1.44) > .55, 'Seville burns out in summer, Asturias stays green');
    // warmth and the line of the trees
    assert.ok(warmAt(40.42, -3.70) > 27 && warmAt(43.36, -5.85) < 22 && near(warmAt(40.42, -3.70, 1000), warmAt(40.42, -3.70) - 6.4, 1e-9));
    const tl = { cantabria: treelineAt(43.36, -5.85), pyrenees: treelineAt(42.63, .66), nevada: treelineAt(37.05, -3.35) };
    assert.ok(tl.cantabria > 1450 && tl.cantabria < 1850 && tl.pyrenees > 2150 && tl.pyrenees < 2450 && tl.nevada > 2400 && tl.nevada < 2800, JSON.stringify(tl));
    assert.ok(tl.cantabria < tl.pyrenees && tl.pyrenees < tl.nevada, 'the line of the trees rises to the south');
    // a place above its country is wetter, one below it a little drier, within limits
    assert.ok(wetAt(40.8, -4, 2000, 1000) > wetAt(40.8, -4, 1000, 1000) + .1 && wetAt(40.8, -4, 300, 1000) < wetAt(40.8, -4, 1000, 1000));
    assert.ok(wetRise(1e5) <= .2 && wetRise(-1e5) >= -.06 && wetRise(0) === 0);
    // every cell holds numbers, the sea too
    for (let i = 0; i < c.data.length; i += 4 * 97) assert.ok(c.data[i + 2] > 20 && c.data[i + 2] < 250, 'warmth within its scale');
  } finally { useClimate(null); }
});

test('ground climate: without the file the old formula answers, so nothing breaks', () => {
  useClimate(null);
  assert.equal(climateAt(40, -3), null);
  assert.ok(wetAt(43.3, -4, 0) > .7 && wetAt(37.6, -1.8, 0) < .2, 'the formula: wet north, dry south-east');
  assert.ok(near(wetAt(40, -3, 1000), wetFormula(40, -3) + .16, 1e-9));
  assert.equal(treelineAt(42.6, .7), 2150);
  assert.ok(near(treelineOf(9.5 + 6.4), 1000, 1e-6) && treelineOf(40) > TREE_SOFT && treelineOf(40) < 3200 && treelineOf(30) < treelineOf(34));
});

test('ground climate: the picture the shaders read — the country around, wet, warm, summer', () => {
  const rect = { x0: CI0 * CHUNK_KM, y0: CJ0 * CHUNK_KM, side: CN * CHUNK_KM }, n = 32;
  const flat = climateTexels(() => 800, rect, null, n);
  assert.equal(flat.length, n * n * 4);
  for (let o = 0; o < n * n; o += 37) assert.equal(flat[o * 4], Math.round(800 / 4096 * 255), 'a plateau of 800 m is 800 m around every place');
  const sea = climateTexels(() => -50, rect, null, n);
  assert.equal(sea[0], 0, 'no land around: 0');
  const c = baked(), t = climateTexels(() => 100, rect, c, CLIM_N);
  // the texel of a place holds the bytes of the baked cell
  const cell = (lat, lon) => { const x = Math.floor((lon * 111.195 * Math.cos(40 * Math.PI / 180) - c.x0) / c.km), y = Math.floor((lat * 111.195 - c.y0) / c.km); return (y * c.n + x) * 4; };
  for (const [lat, lon] of [[40.42, -3.70], [42.88, -8.54], [36.84, -2.46]]) { const o = cell(lat, lon); assert.equal(t[o + 1], c.data[o], 'wet'); assert.equal(t[o + 2], c.data[o + 2], 'warm'); assert.equal(t[o + 3], c.data[o + 1], 'summer'); }
  assert.ok(t[cell(42.88, -8.54) + 1] > t[cell(40.42, -3.70) + 1] && t[cell(40.42, -3.70) + 1] > t[cell(36.84, -2.46) + 1]);
});

// hash21 of glsl.js as a 32-bit float machine counts it: the old line, and the line that replaced it
const fr = Math.fround, fract = v => fr(v - Math.floor(v));
const hashOld = (x, y) => { let px = fract(fr(fr(x) * fr(123.34))), py = fract(fr(fr(y) * fr(456.21))); const d = fr(fr(px * fr(px + fr(45.32))) + fr(py * fr(py + fr(45.32)))); px = fr(px + d); py = fr(py + d); return fract(fr(px * py)); };
const hashNew = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let px = fract(fr(fr(fr(x - ix) * fr(123.34)) + fr(ix * fr(.34)))), py = fract(fr(fr(fr(y - iy) * fr(456.21)) + fr(iy * fr(.21))));
  const d = fr(fr(px * fr(px + fr(45.32))) + fr(py * fr(py + fr(45.32)))); px = fr(px + d); py = fr(py + d); return fract(fr(px * py));
};
test('ground shader: the fine noises no longer run in stripes from north to south', () => {
  assert.ok(COMMON.includes('float hash21(vec2 p) { vec2 i = floor(p); p = fract((p - i) * vec2(123.34, 456.21) + i * vec2(.34, .21));'), 'the line this test counts with');
  // cells of 130 m in the Pyrenees: 4740 km north of the origin, the row number is about 36 000
  const row = Math.floor(4740 / .13), col = Math.floor(50 / .13);
  const distinct = f => new Set(Array.from({ length: 24 }, (_, k) => Math.round(f(col, row + k) * 1e4))).size;
  assert.ok(distinct(hashOld) <= 3, `the old hash gave the same number all the way north: ${distinct(hashOld)} of 24`);
  assert.ok(distinct(hashNew) >= 20, `the new one differs from row to row: ${distinct(hashNew)} of 24`);
  // (the numbers themselves are new everywhere: the hash magnifies the last bits of its input, so even near the
  // origin, where the old line was sound, the two do not agree)
  // spread evenly enough over the whole region, and from column to column as well
  let sum = 0, n = 0; for (let j = 0; j < 60; j++) for (let i = 0; i < 60; i++) { sum += hashNew(-6000 + i * 211, 30000 + j * 97); n++; }
  assert.ok(near(sum / n, .5, .04), `mean ${sum / n}`);
  assert.ok(new Set(Array.from({ length: 24 }, (_, k) => Math.round(hashNew(col + k, row) * 1e4))).size >= 20);
});

test('ground shader: the grain lies on the land at fixed sizes, nothing is switched with the height of the camera', () => {
  const src = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('vec3 texDetail(int t, vec2 pk, float px, vec2 dx, vec2 dy) {'), src.indexOf('vec3 hypso(float h)'));
  assert.ok(body.length > 200, 'texDetail keeps its name and arguments: the aspects call it');
  assert.equal(body.split('textureGrad(tGround').length - 1, 3, 'three sizes of the same tile');
  assert.ok(!/floor\(L\)|pow\(5\.2/.test(body), 'no level that steps with the size of a pixel (that step was the layer the owner saw change)');
  for (const name of ['tGrass', 'tDry', 'tRock', 'tSand', 'tSnow', 'tForest']) assert.match(src, new RegExp(`#define ${name} \\d`), name);
  assert.ok(Math.max(...[...src.matchAll(/#define t(?:Grass|Dry|Rock|Sand|Snow|Forest) (\d)/g)].map(m => +m[1])) < GROUND_TILES.length, 'every name is a layer that exists');
  // the climate comes from the baked map; the wetness of a place also knows its slope and its hollow
  for (const need of ['albumClimate(ll)', 'albumWetOf(clim, hl, n1)', 'groundBare(vec3(n1, n2, n3), wet, clim.a, px, hl, slope, pk)', 'gTreeline = albumTreelineOf(clim)']) assert.ok(src.includes(need), need);
  for (const need of ['uniform sampler2D tClimate', 'vec4 albumClimate(vec2 ll)', 'float albumWet(vec2 ll, float hl, float n1)', 'float albumTreelineOf(vec4 clim)']) assert.ok(COMMON.includes(need), need);
  // the grain of the ground: every tile is there, 1024 px, and its mean is the middle grey that changes nothing
  assert.deepEqual(GROUND_TILES, ['heath', 'steppe', 'stone', 'dunes']);
  for (const id of GROUND_TILES) assert.ok(fs.statSync(file(`${id}.webp`)).size > 20000, id);
});

test('ground tiles: 1024 px a side, mean at the middle grey', async () => {
  const sharp = (await import('sharp')).default;
  for (const id of GROUND_TILES) {
    const { data, info } = await sharp(fs.readFileSync(file(`${id}.webp`))).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1024); assert.equal(info.height, 1024);
    let sum = 0, sq = 0; for (let i = 0; i < data.length; i += 7) { sum += data[i]; sq += data[i] * data[i]; }
    const n = Math.ceil(data.length / 7), mean = sum / n, dev = Math.sqrt(sq / n - mean * mean);
    assert.ok(near(mean, 128, 2.5), `${id}: mean ${mean}`);
    assert.ok(dev > 8 && dev < 26, `${id}: a pattern of the agreed strength, ${dev}`);
  }
});

test('ground aspect: pages of the group «Земля», knobs, and the rules in GLSL', () => {
  const mine = ground.pages, keys = new Set(DEFS.map(d => d.key));
  for (const id of ['ground-meseta', 'ground-meseta-200', 'ground-desert', 'ground-desert-200', 'ground-atlantic', 'ground-rif', 'ground-far']) assert.ok(mine.some(p => p.id === id), id);
  for (const pg of mine) { assert.equal(pg.group, 'Земля'); assert.ok(PAGES.includes(pg)); for (const k of Object.keys(pg.p || {})) assert.ok(keys.has(k), `${pg.id}: ${k}`); assert.ok(pg.cam.h >= 20 && pg.cam.h <= 2000); }
  for (const key of ['dry', 'grain']) { const d = DEFS.find(x => x.key === key); assert.ok(d && ground.uniforms[d.uniform], key); assert.equal(ground.uniforms[d.uniform].value, d.value); }
  assert.ok(ground.glsl.includes('vec3 groundBare(vec3 nz, float wet, float summer, float px, float hl, float slope, vec2 pk)'));
  // the ground shader is kept short: the grain is read once for a pixel and shared, the bare ground asks for no texture of its own
  assert.ok(!ground.glsl.includes('texDetail(') && !ground.glsl.includes('worley('), 'the bare ground reads no texture: the grain is laid on afterwards');
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8'), main = terrain.slice(terrain.lastIndexOf('void main() {'));   // the pixel shader's
  assert.equal(main.split('texDetail(').length - 1, 1, 'one read of the grain for a pixel');
  // what is remembered from the ground shader until the last aspect: two numbers (more of them slowed the whole shader down)
  assert.ok(terrain.includes('float gRise, gTreeline;') && !/\bvec[34] g[A-Z]\w* *[;=]/.test(terrain), 'no vector kept for the aspects');
  const code = ground.glsl.replace(/\/\/[^\n]*/g, '');
  for (const word of ['patch', 'sample', 'filter', 'input', 'output', 'common', 'active', 'smooth', 'flat']) assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `reserved word ${word}`);
  for (const [o, c] of ['()', '{}', '[]']) assert.equal(code.split(o).length, code.split(c).length, `balanced ${o}${c}`);
});
