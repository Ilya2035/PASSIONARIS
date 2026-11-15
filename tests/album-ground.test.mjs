// The ground of the album (docs/album/ground.md): the baked climate and its rules, the grain of the ground, the
// aspect «Земля», and the parts of the ground shader that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { CLIM_N, CLIM_KM, CLIM_MAGIC, CLIM_MAGIC_RECT, WET_OF, wetOfAlpha, encodeClimate, decodeClimate, useClimate, climateAt, wetAt, wetFormula, wetRise, summerAt, warmAt,
  treelineAt, treelineOf, climateTexels, WARM, TREE_SOFT } from '../src/album/ground/climate.js';
import { COMMON } from '../src/album/glsl.js';
import { CHUNK_KM, CN, CNX, CNY, CI0, CJ0 } from '../src/album/chunks.js';
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

test('ground climate: over a rectangle — the lattice of stage 3 — the file, the reading and the picture of the shaders', () => {
  const w = 6, h = 4, N = w * h, mk = f => Float32Array.from({ length: N }, (_, i) => f(i % w, (i / w) | 0));
  const src = { x0: -880, y0: 3240, km: 5, w, h, wet: mk((i, j) => i / (w - 1)), summer: mk((i, j) => j / (h - 1)), warm: mk(() => 25), year: mk(() => 15) };
  const bytes = encodeClimate(src), c = decodeClimate(bytes);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), CLIM_MAGIC_RECT);
  assert.equal(c.w, w); assert.equal(c.h, h); assert.equal(c.n, w); assert.equal(c.data.length, N * 4);
  // a square is written as it always was: the file of stage 2 does not change by a byte
  const sq = encodeClimate({ x0: 0, y0: 0, km: 5, wet: new Float32Array(16), summer: new Float32Array(16), warm: new Float32Array(16), year: new Float32Array(16) });
  assert.equal(String.fromCharCode(...sq.subarray(0, 4)), CLIM_MAGIC); assert.equal(sq[6] + sq[7], 0); assert.equal(decodeClimate(sq).h, 4);
  assert.throws(() => encodeClimate({ ...src, w: 5 }), 'the numbers do not fill the grid');
  // read back at the middles of cells: wet grows to the east, summer to the north — rows are not taken for columns
  const KMD = 111.195, COS = Math.cos(40 * Math.PI / 180), at = (i, j) => climateAt((src.y0 + (j + .5) * 5) / KMD, (src.x0 + (i + .5) * 5) / (KMD * COS), c);
  assert.ok(near(at(5, 0)[0], 1, .01) && near(at(0, 3)[0], 0, .01) && near(at(0, 3)[1], 1, .01) && near(at(5, 0)[1], 0, .01));
  assert.ok(near(at(2, 3)[0], 2 / 5, .01) && near(at(5, 1)[1], 1 / 3, .01));
  // the picture of the shaders over the same rectangle, texel for cell
  const t = climateTexels(() => 400, { x0: src.x0, y0: src.y0, w: w * 5, h: h * 5 }, c, w, h);
  assert.equal(t.length, N * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4; assert.equal(t[o + 1], c.data[o], 'wet'); assert.equal(t[o + 3], c.data[o + 1], 'summer'); assert.equal(t[o], Math.round(400 / 4096 * 255)); }
  // and the ground shader takes the size of its texture from the lattice, not from a side
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8');
  assert.ok(terrain.includes('climW = Math.round(1 / cr.z / CLIM_KM), climH = Math.round(1 / cr.w / CLIM_KM);') && terrain.includes('{ x0: cr.x, y0: cr.y, w: 1 / cr.z, h: 1 / cr.w }, data.climate, climW, climH), climW, climH,'));
  assert.ok(!/CLIM_N/.test(terrain));
});

test('the base written already mended is not mended again by the page', () => {
  const data = fs.readFileSync(new URL('../src/album/data.js', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.ok(data.includes('  if (!(meta.mended || meta.base.mended)) {\n    despike(raw, meta.base.w, meta.base.h);') && data.includes('    fillHollows(raw, meta.base.w, meta.base.h);'));
});

test('ground climate: the baked map covers the square of the chunks and says what everyone knows of Iberia', () => {
  const c = baked();
  assert.ok(c, CLIM_MAGIC); assert.equal(c.km, CLIM_KM);
  assert.equal(c.w, CNX * CHUNK_KM / CLIM_KM, 'the lattice of the chunks in cells of 5 km: bake again when it changes (node scripts/album/bake-ground.mjs)'); assert.equal(c.h, CNY * CHUNK_KM / CLIM_KM);
  assert.equal(c.x0, CI0 * CHUNK_KM); assert.equal(c.y0, CJ0 * CHUNK_KM);
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
    const tl = { cantabria: treelineAt(43.36, -5.85), pyrenees: treelineAt(42.63, .66), nevada: treelineAt(37.05, -3.35), guadarrama: treelineAt(40.79, -4) };
    assert.ok(tl.cantabria > 1450 && tl.cantabria < 1850 && tl.pyrenees > 2150 && tl.pyrenees < 2450 && tl.nevada > 2000 && tl.nevada < 2450, JSON.stringify(tl));
    assert.ok(tl.cantabria < tl.pyrenees && tl.guadarrama > 1950 && tl.guadarrama < 2200, 'the line of the trees rises from the ocean inland; a dry summer, not the cold, stops the pines of the Guadarrama under its summits (2428 m)');
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
  assert.equal(body.split('textureGrad(tGround').length - 1, 1, 'the tile lies on the land once, at its true size');
  assert.ok(body.includes('if (px >= .11) return vec3(1.);'), 'no grain from on high: it fades out with the size of a pixel');
  assert.ok(!/floor\(L\)|pow\(5\.2/.test(body), 'no level that steps with the size of a pixel (that step was the layer the owner saw change)');
  for (const name of ['tGrass', 'tDry', 'tRock', 'tSand', 'tSnow', 'tForest']) assert.match(src, new RegExp(`#define ${name} \\d`), name);
  assert.ok(Math.max(...[...src.matchAll(/#define t(?:Grass|Dry|Rock|Sand|Snow|Forest) (\d)/g)].map(m => +m[1])) < GROUND_TILES.length, 'every name is a layer that exists');
  // the climate comes from the baked map; the wetness of a place also knows its slope and its hollow
  for (const need of ['albumClimate(ll)', 'albumWetOf(clim, hl, n1)', 'groundBare(vec3(n1, n2, n3), wet, clim.a, px, hl, slope, conc, pk, 1. - rg)', 'gTreeline = albumTreelineOf(clim)']) assert.ok(src.includes(need), need);
  // the square of the grain is laid as a patchwork — shifted from patch to patch, turned over in every other one —
  // so that its own shapes do not stand in rows; and it is weaker on level ground than on slopes
  for (const need of ['vec2 gp = pk + vec2(ga * 3.71 + gb * 1.37, ga * 1.93 + gb * 4.19), gdx = pdx, gdy = pdy;', '{ gp = gp.yx; gdx = gdx.yx; gdy = gdy.yx; }', 'gp, px, gdx, gdy), uGrainK * (.6 + .4 * smoothstep(.015, .10, slope)) * (1. - .7 * smoothstep(.5, .9, slope)));']) assert.ok(src.includes(need), need);
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
  assert.ok(ground.glsl.includes('vec3 groundBare(vec3 nz, float wet, float summer, float px, float hl, float slope, float conc, vec2 pk, float wild)'));
  // the desert: mineral soils that follow the relief — pale fill in the basins and on the floors of valleys
  for (const need of ['float arid = 1. - smoothstep(.11 * uDryK, .25 * uDryK, wet), low = clamp((gRise - hl) / 140., -1., 1.);', 'arid * clamp(conc, 0., 1.) * .6']) assert.ok(ground.glsl.includes(need), need);
  // the ground shader is kept short: the grain is read once for a pixel and shared, the bare ground asks for no texture of its own
  assert.ok(!ground.glsl.includes('texDetail(') && !ground.glsl.includes('worley('), 'the bare ground reads no texture: the grain is laid on afterwards');
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8'), main = terrain.slice(terrain.lastIndexOf('void main() {'));   // the pixel shader's
  assert.equal(main.split('texDetail(').length - 1, 1, 'one read of the grain for a pixel');
  // what is remembered from the ground shader until the last aspect: two numbers (more of them slowed the whole shader down)
  assert.ok(terrain.includes('float gRise, gTreeline, gSummer;') &&!/\bvec[34] g[A-Z]\w* *[;=]/.test(terrain), 'no vector kept for the aspects');
  const code = ground.glsl.replace(/\/\/[^\n]*/g, '');
  for (const word of ['patch', 'sample', 'filter', 'input', 'output', 'common', 'active', 'smooth', 'flat']) assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `reserved word ${word}`);
  for (const [o, c] of ['()', '{}', '[]']) assert.equal(code.split(o).length, code.split(c).length, `balanced ${o}${c}`);
});

test('ground grid: the levels are kept apart by a step under the finer one, never by a shift in depth', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  // (the finishing pass shades by depth: a level pushed back in depth drew a thin dark line along its whole border)
  assert.ok(!/polygonOffset/.test(terrain), 'no level is pushed back in depth');
  assert.ok(/if \(max\(d\.x, d\.y\) < uFine\.z\) h -= uCell \* \.9;/.test(terrain), 'the step under the finer level');
  assert.ok(/fine \? fine\.half - c \* 1\.5 : 0/.test(terrain), 'the step begins between two rows of vertices: no rounding decides which row steps down');
});

test('ground shader: the edge of the snow is crisp, follows the small relief and is never thinner than a pixel', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8');
  assert.ok(terrain.includes('sb = max(40., fwidth(hl) * 1.5);'), 'a band of 80 m of height, or what one pixel spans');
  assert.ok(terrain.includes('float snowW = smoothstep(snowline - sb, snowline + sb, hl - gyS * 320.) * bare;'), 'the slope with the small relief of the pixel; no snow on a wall');
  assert.ok(terrain.includes('land = mix(land, vec3(.80, .83, .88) * (.97 + .06 * n3), snowW);') && terrain.includes('mix(vec3(1.), vec3(.86, .97, 1.2), snowW)'), 'snow is painted under white, so its lit and shaded faces differ; in the shade it is blue');
  assert.ok(terrain.includes('amb = mix(amb, .5 + .5 * amb, cover * .7);'), 'a forest in the shade is not black');
  assert.ok(!terrain.includes('smoothstep(snowline - 90., snowline + 110.'), 'not the band of 200 m: the snow lay like cotton wool');
});

test('mountains: relief the height data cannot hold is added to the slope, never to the height', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8');
  const glsl = fs.readFileSync(new URL('../src/album/glsl.js', import.meta.url), 'utf8');
  const vert = terrain.slice(terrain.indexOf('const VERT'), terrain.indexOf('const FRAG_SRC'));
  assert.ok(!vert.includes('ribs(') && !vert.includes('vnoise'), 'the grid of the ground is lifted by the height data alone: roads and houses stand on it');
  assert.ok(glsl.includes('vec3 vnoiseD(vec2 p) {'), 'a noise that gives its slope in one call');
  assert.ok(terrain.includes('vec3 ribs(vec2 pk, vec2 d, float f, float w) {') && terrain.includes('ra = sqrt(ta * ta + .03)'), 'ribs and gullies down the fall line; their fold is rounded, or every flank is a flat facet');
  assert.ok(terrain.includes('g += (g - vec2(bE - bC, bN - bC) / (eb * 1000.)) * ((.8 * uCrisp * own * smoothstep(.30, .10, px) - .4 * far) * rg);'), 'near, the forms of the data are sharpened against the land smoothed over 700 m; from afar the small forms are calmed');
  assert.ok(terrain.includes('nl = max(uSun.z + (nl - uSun.z) * (1. + .6 * far), 0.) * (1. + depth);') && terrain.includes('depth = clamp((hl - max(textureLod(uBase, bu, 6.).r, 0.)) / 900., -1., 1.) * .25 * far * rg;') && !terrain.includes('light *= 1. + clamp('), 'from afar the light carries the relief: more contrast, darker valley floors, lighter high ground');
  assert.ok(terrain.includes('float slopeD = length(g + gm);'), 'the slope with the added relief');
  assert.ok(/steep = smoothstep\([^;]*slopeD\);/.test(terrain), 'rock goes by the slope of the pixel, with its ribs');
  assert.ok(terrain.includes('float solid = smoothstep(.55, 1.05, slopeD + crest);') && terrain.includes('crest = crest * .25 + rib * .15;'), 'solid rock on walls and crests, scree below them; one number is kept for it');
  assert.equal(terrain.slice(terrain.lastIndexOf('void main() {')).split('ribs(pk, ').length - 1, 1, 'one family of ribs for a pixel');
  assert.ok(terrain.includes('float bC = textureLod(uBase, bu, lb).r,') && !/b[CEN] = heightLod\(/.test(terrain), 'the smoothed land is read straight from the height texture: through heightLod() four reads cost a tenth of the frame');
  assert.ok(!terrain.includes('float gul = '), 'no streaks painted on the rock: they are the ribs, lit by the sun');
});

test('mountains: the fine heights of a showcase place are in the grid of the ground itself', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8');
  const glsl = fs.readFileSync(new URL('../src/album/glsl.js', import.meta.url), 'utf8');
  assert.ok(glsl.includes('max(0., lod + log2(uDetRect.z) - 6. - (uDetOn - 1.) * (1. - min(lod * 8., 1.)))'), 'lod 0 reads the fine heights as fine as the grid is; from cells of 250 m up nothing changes');
  assert.ok(terrain.includes('this.fine = Math.max(0, Math.min(3, -Math.log2(c0 / .234)));') && terrain.includes('if (this.detail) this.u.uDetOn.value = 1 + this.fine;'), 'uDetOn carries how fine the grid is');
  assert.ok(glsl.includes('if (uDetOn < .5) return 0.;'), 'and still says whether there are fine heights at all');
});

test('the size of a pixel does not depend on how the camera is turned: a rock wall keeps its pattern', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8'), main = terrain.slice(terrain.lastIndexOf('void main() {')).replace(/\/\/[^\n]*/g, '');
  assert.ok(!main.includes('fwidth(vPos)'), 'fwidth() of the position is 1.41 to 2 pixels for the same ground, by the turn of the window alone');
  assert.ok(main.includes('float pF = dot(dpx, dpx) + dot(dpy, dpy), pA = length(cross(dpx, dpy));'), 'the two sides of the patch of ground a pixel covers');
  assert.ok(main.includes('float px = min(sqrt(pF), 2. * sqrt(max(pF - sqrt(max(pF * pF - 4. * pA * pA, 0.)), 0.)));'), 'the whole patch, but no more than twice its short side');
  // the numbers of that line: looking straight down both sides are s — the old value, s·√2; seen at 10° the long side is s / sin 10°
  const px = (a, b) => { const F = a * a + b * b, A = a * b; return Math.min(Math.sqrt(F), 2 * Math.sqrt(Math.max(F - Math.sqrt(Math.max(F * F - 4 * A * A, 0)), 0))); };
  assert.ok(Math.abs(px(1, 1) - Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(px(1 / Math.sin(10 * Math.PI / 180), 1) - 2 * Math.SQRT2) < 1e-6, 'edge-on: capped at twice the value seen from above');
  assert.ok(Math.abs(px(1 / Math.sin(30 * Math.PI / 180), 1) - Math.sqrt(5)) < 1e-9, 'at 30° not yet capped');
  // the grain nearly leaves a wall, and a steep face is rock, not pale scree with the grass of the ledges showing through
  assert.ok(terrain.includes('uGrainK * (.6 + .4 * smoothstep(.015, .10, slope)) * (1. - .7 * smoothstep(.5, .9, slope))'));
  assert.ok(terrain.includes('steep = smoothstep(.55 + .15 * humid, 1.0 + .12 * humid, slopeD)') && terrain.includes('rockW *= 1. - .18 * humid *'));
  assert.ok(terrain.includes('rockCol *= mix(1.10, .88 + .22 * (.5 + .5 * sin(hl / 38. + rk * 5.))'), 'scree a tenth lighter than the rock, not a third');
});

test('shadows cast by the relief fade with the height of the camera', () => {
  const terrain = fs.readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.ok(terrain.includes('float sh = 1., d = max(e * 2., .4), shK = 1. - smoothstep(.30, 1.10, px);'), 'from 0.3 to 1.1 km a pixel: about 350 to 1300 km of height');
  assert.ok(terrain.includes('sh = min(sh, 1. - clamp(occ / (d * 90. + 4.), 0., 1.) * shK);') && !terrain.includes('if (shK > 0.)') && !terrain.includes('sh = mix(1., sh, shK)'), 'the fade is a factor inside the loop: under a condition or laid on after it, it cost 30 ms a frame');
  // one Sun for the frame: the sky dims every place in the finishing pass (sky/globe.js)
  const main = terrain.slice(terrain.lastIndexOf('void main() {')).replace(/\/\/[^\n]*/g, '');
  assert.ok(main.includes('vec2 sd = normalize(uSun.xy + 1e-4); float tanEl = uSun.z / max(1e-3, length(uSun.xy));') && main.includes('float nl = max(dot(n, uSun), 0.), day = albumDay();'), 'slopes and shadows go by the Sun of the frame, in the polygon and beyond it');
  // the light of the place is the sky's work alone: one measure for the whole Earth in its finishing pass
  assert.ok(!terrain.includes('uSunW') && !terrain.includes('globeRelight') && !terrain.includes('GLOBE'), 'the ground does not count the Sun of a place, and takes nothing of the day and night of the ball');
  assert.ok(main.includes('col = albumAir(col, vPos);\n  gl_FragColor = vec4(albumFinish(col), 1.);'));
  const post = fs.readFileSync(new URL('../src/album/post.js', import.meta.url), 'utf8');
  assert.ok(post.includes('if (ground) c = globeDimmed(c, globeRelight(normalize(wpos + vec3(0., RKM, 0.))));') && !post.includes('globeRelightOwn'), 'the finishing pass of the sky dims the polygon and the land beyond it alike (if it takes them apart again, the ground must hand the land over accordingly — v0.6.124)');
});
