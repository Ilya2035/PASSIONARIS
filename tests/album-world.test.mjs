// The plain land and sea of the whole Earth beyond the polygon (docs/album/ground.md, «Вся Земля»): where the
// polygon ends, the heights of the world on the CPU, the file of the world's climate, lakes and ice, and the rules
// the ground shader reads them by.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { BBOX } from '../src/album/geo.js';
import { WORLD_W, WORLD_H, WARM, WARM_WORLD, ICE_STEP, LAPSE, TREE_WARM, TREE_DRY, TREE_SOFT, TREE_SOFT_K, encodeWorldClimate, decodeWorldClimate, snowlineOf, treelineOf, worldTreelineOf, SNOW_WARM, SNOW_DRY, SNOW_TROPIC } from '../src/album/ground/climate.js';
import { WMAP_W, WMAP_H, WMAP_KM, WORLD_LOD0, REGION_FADE, STATE_FADE, FIT_PAD, FIT_FEATHER, FIT_REACH, regionEdge, regionWeight, decodeWorldHeights, worldAt, joinHeights, raiseIce, capSouth, fitWorld, CAP_LAT } from '../src/album/ground/world.js';

const FILE = new URL('../public/assets/album/ground/world.bin.gz', import.meta.url), MAP = new URL('../public/assets/map/height.delta.bin.gz', import.meta.url);
// (a checkout on Windows may give the files its own line ends)
const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\r\n').join('\n');

test('the polygon: its heights are whole inside the border and give way to the world over a fifth of a degree outside', () => {
  const mid = [(BBOX.lat0 + BBOX.lat1) / 2, (BBOX.lon0 + BBOX.lon1) / 2];
  assert.equal(regionWeight(...mid), 1);
  assert.equal(regionWeight(BBOX.lat1, mid[1]), 1, 'on the border itself');
  assert.equal(regionWeight(BBOX.lat1 + REGION_FADE, mid[1]), 0);
  assert.ok(Math.abs(regionWeight(BBOX.lat1 + REGION_FADE / 2, mid[1]) - .5) < 1e-9);
  assert.equal(regionWeight(mid[0], BBOX.lon0 - 1), 0); assert.equal(regionWeight(-30, 150), 0);
  assert.ok(Math.abs(regionEdge(BBOX.lat0 + .3, mid[1]) - .3) < 1e-9 && Math.abs(regionEdge(mid[0], BBOX.lon1 + .4) + .4) < 1e-9, 'degrees inside (+) and outside (−)');
  // the shaders say the same, from the same numbers
  const glsl = read('../src/album/glsl.js');
  assert.ok(glsl.includes('float regionEdge(vec2 ll) { vec2 a = min(ll - vec2(${f(BBOX.lat0)}, ${f(BBOX.lon0)}), vec2(${f(BBOX.lat1)}, ${f(BBOX.lon1)}) - ll); return min(a.x, a.y); }'));
  assert.ok(glsl.includes('float inRegion(vec2 ll) { return smoothstep(${f(-REGION_FADE)}, 0., regionEdge(ll)); }'));
  assert.ok(read('../src/album/terrain.js').includes('#define STATE(ll) smoothstep(${STATE_FADE[0]}, ${STATE_FADE[1]}, regionEdge(ll))') && STATE_FADE[0] > 0 && STATE_FADE[1] > STATE_FADE[0], 'the state of the chunks gives way inside the border');
});

test('world heights: read between four points, round the Earth and up to the poles', () => {
  const w = 8, rows = 4, h = new Int16Array(w * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) h[j * w + i] = 100 * j + i;             // rows from the north, columns from 180° W
  const lat = j => 90 - (j + .5) * 180 / rows, lon = i => -180 + (i + .5) * 360 / w;
  assert.equal(worldAt(h, lat(1), lon(2), w, rows), 102, 'at a point: its own height');
  assert.equal(worldAt(h, (lat(1) + lat(2)) / 2, lon(2), w, rows), 152, 'half-way between two rows');
  assert.equal(worldAt(h, lat(0), 180, w, rows), 3.5, 'across the line of 180°: between the last column and the first');
  assert.equal(worldAt(h, lat(0), lon(2) + 360, w, rows), worldAt(h, lat(0), lon(2), w, rows), 'any number of turns round the Earth');
  assert.equal(worldAt(h, 90, lon(3), w, rows), 3); assert.equal(worldAt(h, -90, lon(3), w, rows), 303, 'the poles: the last row');
  // the file: rows of differences
  const d = Int16Array.from([5, 1, 1, -3, 7, 0, 2, 2]);
  assert.deepEqual([...decodeWorldHeights(d, 4)], [5, 6, 7, 4, 7, 7, 9, 11]);
  assert.ok(Math.abs(WMAP_KM - 4.886) < .01 && Math.abs(WORLD_LOD0 - Math.log2(WMAP_KM / .234)) < 1e-9 && WMAP_W === 2 * WMAP_H);
});

test('world heights: the polygon and the world are one height for the CPU', () => {
  const w = 8, rows = 4, world = new Int16Array(w * rows).fill(-2000), region = () => 640, mid = (BBOX.lon0 + BBOX.lon1) / 2;
  const at = joinHeights(region, world, w, rows);
  assert.equal(at(40, mid), 640, 'inside: the polygon alone');
  assert.equal(at(BBOX.lat1 + 1, mid), -2000, 'beyond: the world');
  assert.ok(Math.abs(at(BBOX.lat1 + REGION_FADE / 2, mid) + 680) < 1e-6, 'and half-way over the border, half of each');
  assert.equal(at(40, mid + 360), 640, 'the longitude may come unwrapped');
  assert.equal(joinHeights(region, null)(0, 100), -3200, 'no world map: deep sea, as before');
  assert.ok(read('../src/album/data.js').includes('base.at = joinHeights(regionAt, world?.h || null);'), 'data.base.at answers for the whole Earth');
});

test('world heights: the ice sheets are lifted to their surface, and the copied rows of the south are levelled', () => {
  // ice: a grid of 8 × 4 cells, one cell of 2400 m; the heights: 16 × 8 points of rock at −300 m
  const iw = 8, ih = 4, ice = new Uint8Array(iw * ih); ice[1 * iw + 2] = 2400 / ICE_STEP;
  const w = 16, h = new Int16Array(w * 8).fill(-300);
  raiseIce(h, ice, iw, ih, ICE_STEP, w);
  assert.ok(h[2 * w + 5] > 1200 && h[3 * w + 4] > 1200, 'the points inside the cell stand on the ice');
  assert.equal(h[0 * w + 12], -300); assert.equal(h[7 * w + 5], -300, 'nothing else is touched');
  const peak = new Int16Array(w * 8).fill(3000); raiseIce(peak, ice, iw, ih, ICE_STEP, w); assert.ok(peak.every(v => v === 3000), 'rock that stands above the ice stays');
  // the south: rows of copies beyond 85°
  const W2 = 4, R2 = 360, s = new Int16Array(W2 * R2); for (let j = 0; j < R2; j++) for (let i = 0; i < W2; i++) s[j * W2 + i] = [2000, -500, 400, 1200][i];
  capSouth(s, W2);
  const row = lat => Math.round((90 - lat) / 180 * R2 - .5);
  assert.deepEqual([...s.subarray(row(-80) * W2, row(-80) * W2 + 4)], [2000, -500, 400, 1200], 'real land is left as it is');
  assert.deepEqual([...s.subarray(row(-88) * W2, row(-88) * W2 + 4)], [1200, 1200, 1200, 1200], 'past the cap: level, at the mean height of the land of the last real row');
  assert.equal(CAP_LAT, 85);
});

test('world heights: round the polygon the world map says what the polygon says', () => {
  // a world map of 720 × 360 points (half a degree) at 100 m everywhere; the polygon stands at 900 m
  const w = 720, rows = 360, h = new Int16Array(w * rows).fill(100), mid = [(BBOX.lat0 + BBOX.lat1) / 2, (BBOX.lon0 + BBOX.lon1) / 2];
  const n = fitWorld(h, () => 900, w, rows);
  assert.ok(n > 300, 'the points of the map inside the polygon and a little beyond');
  assert.equal(worldAt(h, mid[0], mid[1], w, rows), 900, 'inside: the height of the polygon');
  assert.equal(worldAt(h, BBOX.lat1 + 3, mid[1], w, rows), 100, 'far beyond: the world as it was');
  assert.equal(worldAt(h, -20, 120, w, rows), 100);
  // the mean over a cell: a polygon that is a slope gives every point the height at its own middle
  const s2 = new Int16Array(w * rows); fitWorld(s2, (lat, lon) => (lat - 35) * 1000, w, rows);
  const lat = 90 - (Math.floor((90 - 40) / .5) + .5) * .5;
  assert.ok(Math.abs(s2[Math.floor((90 - lat) / .5) * w + Math.floor((mid[1] + 180) / .5)] - (lat - 35) * 1000) < 2);
  assert.ok(Math.abs(FIT_REACH - (REGION_FADE + FIT_PAD + FIT_FEATHER)) < 1e-12 && FIT_REACH < .29, 'the fit stays inside what the heights of the polygon cover beyond its border');
  const data = read('../src/album/data.js');
  assert.ok(data.includes('if (world) { fitWorld(world.h, regionAt); world.tex = worldHeightTexture(world.h, world.w, world.rows); }'), 'fitted before it becomes a texture');
});

test('world file: the format keeps every number to a byte', () => {
  const w = 8, h = 4, n = w * h, f = k => Float32Array.from({ length: n }, (_, o) => k(o % w, (o / w) | 0));
  const src = { w, h, lake: f((i, j) => (i === 3 && j === 2 ? 1 : 0)), wet: f((i, j) => (i + j) / 11), warm: f((i, j) => -5 + j * 12 + i), summer: f(i => (i % 2 ? .25 : 1)), ice: f((i, j) => (j === 0 ? 3008 : 0)) };
  const back = decodeWorldClimate(encodeWorldClimate(src));
  assert.equal(back.w, w); assert.equal(back.h, h); assert.equal(back.data.length, n * 4); assert.equal(back.ice.length, n);
  for (let o = 0; o < n; o++) {
    assert.equal(back.data[o * 4], src.lake[o] * 255);
    assert.ok(Math.abs(back.data[o * 4 + 1] / 255 - src.wet[o]) < .003);
    assert.ok(Math.abs(WARM_WORLD[0] + back.data[o * 4 + 2] / 255 * (WARM_WORLD[1] - WARM_WORLD[0]) - src.warm[o]) < .11);
    assert.ok(Math.abs(back.data[o * 4 + 3] / 255 - src.summer[o]) < .003);
    assert.equal(back.ice[o] * ICE_STEP, src.ice[o]);
  }
  assert.equal(decodeWorldClimate(new Uint8Array(40)), null, 'not such a file');
});

test('world rules: the snow line of the lands with a winter and of the tropics, the tree line by warmth', () => {
  assert.equal(snowlineOf(24, 46), (24 - SNOW_WARM) / LAPSE);
  assert.equal(snowlineOf(24, -46), snowlineOf(24, 46), 'the south as the north');
  assert.equal(snowlineOf(25, 2), (25 - SNOW_WARM + SNOW_TROPIC) / LAPSE, 'between the tropics: higher, there is no winter');
  assert.ok(snowlineOf(24, 46) > 2300 && snowlineOf(24, 46) < 2700, 'the Alps');
  assert.equal(snowlineOf(40, 31), (40 - SNOW_WARM + SNOW_DRY) / LAPSE + SNOW_TROPIC * 0, 'the dry heat of the great highlands lifts it');
  assert.ok(snowlineOf(40.3, 29.65) > 5700 && snowlineOf(32.8, 39.7) > 4300 && snowlineOf(29, 49) > 3200 && snowlineOf(29, 49) < 3700, 'Tibet, Colorado, the Altai');
  assert.ok(snowlineOf(27.5, 2) > 3900, 'the equator: only the highest volcanoes');
  assert.ok(snowlineOf(5, 78) < 0 && snowlineOf(-3, -70) < -1000, 'the polar lands are white down to the sea');
  // the tree line: the Alps the same by both rules, the high dry lands much higher by the rule of the world
  assert.ok(Math.abs(worldTreelineOf(23.6, 1) - treelineOf(23.6, 1)) < 30);
  assert.equal(worldTreelineOf(40.3, 1), (40.3 - TREE_WARM) / LAPSE);
  assert.ok(worldTreelineOf(40.3, 1) - treelineOf(40.3, 1) > 1500, 'Lhasa: 4800 m, not 3100');
  assert.equal(worldTreelineOf(18, .5), (18 - TREE_WARM) / LAPSE - .5 * TREE_DRY, 'under 2200 m: warmth, less the dryness of the summer');
  for (const [warm, summer] of [[34, .2], [38, 0], [29.5, .3]]) assert.ok(Math.abs(worldTreelineOf(warm, summer) - treelineOf(warm, summer)) < 1e-6, 'a dry summer: the line of the polygon itself — no belt of forest jumps at its border');
  assert.ok(worldTreelineOf(32.8, .62) > 2900 && worldTreelineOf(32.8, .62) < 3300, 'Colorado');
  // the shader counts the same
  const terrain = read('../src/album/terrain.js');
  assert.ok(terrain.includes('float worldSnow(float warm, float lat) { return (warm - ${f1(SNOW_WARM)} + ${f1(SNOW_DRY)} * smoothstep(26., 36., warm) + ${f1(SNOW_TROPIC)} * (1. - smoothstep(10., 30., abs(lat)))) / ${LAPSE}; }'));
  assert.ok(terrain.includes('treeW = (ww - ${f1(TREE_WARM)}) / ${LAPSE};') && terrain.includes('if (treeW > ${f1(TREE_SOFT)}) treeW = ${f1(TREE_SOFT)} + (treeW - ${f1(TREE_SOFT)}) * mix(${TREE_SOFT_K}, 1., smoothstep(.35, .7, cw.a));') && terrain.includes('treeW -= (1. - cw.a) * ${f1(TREE_DRY)};'));
  assert.ok(TREE_SOFT === 2200 && TREE_SOFT_K === .35);
  assert.ok(terrain.includes('float worldWarm(vec4 cw) { return mix(${f1(WARM_WORLD[0])}, ${f1(WARM_WORLD[1])}, cw.b); }') && terrain.includes('cw.b = clamp((ww - ${f1(WARM[0])}) / ${f1(WARM[1] - WARM[0])}, 0., 1.);'), 'the wider scale of the world is brought onto that of the polygon');
});

test('world file: the baked numbers say what everyone knows of the Earth', { skip: !fs.existsSync(FILE) }, () => {
  const c = decodeWorldClimate(zlib.gunzipSync(fs.readFileSync(FILE)));
  assert.equal(c.w, WORLD_W); assert.equal(c.h, WORLD_H);
  const at = (lat, lon) => { const k = Math.floor((90 - lat) / 180 * c.h) * c.w + Math.floor((lon + 180) / 360 * c.w), o = k * 4, d = c.data;
    return { lake: d[o] / 255, wet: d[o + 1] / 255, warm: WARM_WORLD[0] + d[o + 2] / 255 * (WARM_WORLD[1] - WARM_WORLD[0]), summer: d[o + 3] / 255, ice: c.ice[k] * ICE_STEP }; };
  assert.ok(at(23, 10).wet < .05 && at(-24, -69.5).wet < .05 && at(43, 105).wet < .12, 'the Sahara, the Atacama and the Gobi are deserts');
  assert.ok(at(0, 22).wet > .9 && at(-3.1, -60).wet > .85 && at(1.3, 103.8).wet > .9, 'the Congo, the Amazon and Malaya are rain forest');
  assert.ok(at(48.85, 2.35).wet > .58 && at(55.75, 37.6).wet > .58, 'Paris and Moscow stand in closed forest country');
  assert.ok(at(14, 5).wet < .2 && at(-23.7, 133.9).wet < .2, 'the Sahel and the middle of Australia are steppe at best');
  const alps = at(45.83, 6.86), tl = worldTreelineOf(alps.warm, alps.summer), sl = snowlineOf(alps.warm, 45.83);
  assert.ok(tl > 1900 && tl < 2400 && sl > 2300 && sl < 2800, `the Alps: trees to ${Math.round(tl)} m, snow from ${Math.round(sl)} m`);
  for (const [lat, lon] of [[78.5, 16], [72, -40], [-80, 90], [-70, 0]]) { const p = at(lat, lon); assert.ok(snowlineOf(p.warm, lat) < 0 && worldTreelineOf(p.warm, p.summer) < 0, `ice at ${lat}, ${lon}`); }
  const kili = at(-3.07, 37.35); assert.ok(snowlineOf(kili.warm, -3.07) > 4500 && snowlineOf(kili.warm, -3.07) < 5600, 'Kilimanjaro: snow on the summit only');
  const lhasa = at(29.65, 91.1); assert.ok(worldTreelineOf(lhasa.warm, lhasa.summer) > 4200 && snowlineOf(lhasa.warm, 29.65) > 5600, 'Tibet is not under snow');
  const taymyr = at(74, 100); assert.ok(worldTreelineOf(taymyr.warm, taymyr.summer) < 0 && snowlineOf(taymyr.warm, 74) > 100, 'the tundra of Taymyr: no trees, no lasting snow on the plain');
  // lakes and ice sheets
  assert.ok(at(53.5, 108).lake > .9 && at(-1, 33).lake > .9 && at(44, -87).lake > .9, 'Baikal, Victoria, Michigan');
  assert.ok(at(48.85, 2.35).lake === 0 && at(23, 10).lake === 0 && at(30, -40).lake === 0, 'no lake in Paris, in the Sahara or in the ocean');
  assert.ok(at(72, -40).ice > 2500 && at(-80, 90).ice > 3000, 'the ice of Greenland and of the Antarctic stands 3 km high');
  assert.ok(at(45.83, 6.86).ice === 0 && at(27.99, 86.93).ice === 0 && at(64.15, -21.9).ice === 0, 'a mountain is not an ice sheet');
  // the polygon and the world are baked by one rule: Madrid, Santiago and Almería say the same in both
  const mad = at(40.42, -3.70), san = at(42.88, -8.54), alm = at(36.84, -2.46);
  assert.ok(mad.wet > .2 && mad.wet < .5 && san.wet > .75 && alm.wet < .15, `${mad.wet.toFixed(2)} ${san.wet.toFixed(2)} ${alm.wet.toFixed(2)}`);
});

test('world heights: with the ice, Greenland is a dome and not a bay', { skip: !fs.existsSync(FILE) || !fs.existsSync(MAP) }, () => {
  const b = zlib.gunzipSync(fs.readFileSync(MAP)), h = decodeWorldHeights(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + WMAP_W * WMAP_H * 2)));
  const rock = worldAt(h, 72, -40), c = decodeWorldClimate(zlib.gunzipSync(fs.readFileSync(FILE)));
  raiseIce(h, c.ice, c.w, c.h, ICE_STEP);
  assert.ok(rock < 400 && worldAt(h, 72, -40) > 2700, `the middle of Greenland: rock at ${Math.round(rock)} m, ice at ${Math.round(worldAt(h, 72, -40))} m`);
  assert.ok(worldAt(h, -80, 90) > 3000 && worldAt(h, -89.5, 0) > 2500, 'the Antarctic plateau and the pole');
  assert.ok(Math.abs(worldAt(h, 45.83, 6.86) - 2500) < 1500 && worldAt(h, 30, -40) < -2000, 'the Alps and the Atlantic are as they were');
});

test('world: the ground shader draws the Earth beyond the polygon by the rules of the polygon', () => {
  const terrain = read('../src/album/terrain.js'), glsl = read('../src/album/glsl.js'), ground = read('../src/album/aspects/ground.js');
  assert.ok(terrain.includes('const VERT = /* glsl */`\n#define ALBUM_WORLD 1\n'), 'the grids of the ground stand on the heights of the whole Earth');
  assert.ok(glsl.includes('#else\n  return mix(-3200., hb, inRegion(ll));\n#endif'), 'whoever does not ask sees deep sea beyond the polygon, as before');
  assert.ok(terrain.includes('if (rg < 1.) hb = mix(worldPix(ll, lw), hb, rg);') && terrain.includes('#if ZONE == 3\n  return worldPix(ll, lw);'), 'the height of a pixel');
  assert.ok(terrain.includes('vec2 sz = vec2(textureSize(tWorld, 0)), t = uv * sz - .5, f = fract(t), i = t - f;') && !terrain.includes('e = max(e, 4.9'), 'the world map is joined as a smooth surface below its own size — in the variants that draw the world');
  assert.ok(terrain.includes('else if (p.h < 0.) p.h = min(p.h, -14.5 * (1. - rgW));'), 'the least depth of the sea is reached evenly across the border');
  assert.ok(terrain.includes('clim = mix(cw, clim, rg);') && terrain.includes('if (rg < 1.) gTreeline = mix(treeW, gTreeline, rg);') && terrain.includes('if (rgS < 1.) snowline = mix(worldSnow(worldWarm(worldClimate(ll)), lat), snowline, rgS);'), 'climate, tree line and snow line');
  assert.ok(terrain.includes('float snowline = 2980. - (lat - 37.) * 55., rgS = REGION(ll);'), 'the snow line of the polygon is as the owner approved it');
  assert.ok(terrain.includes('p.cB *= rs; p.cC *= rs;') && terrain.includes('p.cA = mix(vec4(1., clamp(.06 + .82 * mont + .5 * smoothstep(.56, .36, wet) * (1. - mont), 0., 1.)'), 'no chunks: the natural state');
  assert.ok(terrain.includes('if (rg < 1.) g *= 1. + 2. * (1. - rg);') && terrain.includes('gm += ((fa.yz * RA) * (-.175 * ta / ra) + (fb.yz * RB) * (-.14 * tb / rb) + (fd.yz * RC) * (-.31 * td / rd * fine)) * sw;'), 'the coarse heights of the world: a steeper slope and ridges by rule');
  assert.ok(terrain.includes('lakeA = smoothstep(.5 - lw2, .5 + lw2, worldClimate(ll).r) * (1. - rgW);') && terrain.includes('if (h0 < 25. || lakeA > 0.) sea = aspWater(p);'), 'the lakes of the world');
  assert.ok(terrain.includes('worldSnow(worldWarm(worldClimate(ll)), lat) + (vnoise3(q) + vnoise3(mat3(.36, .48, -.8, -.8, .6, 0., .48, .64, .6) * q * 1.7 + 4.) - 1.) * 420.'), 'the ice of the polar seas: its edge broken by two noises in space, the second on a turned lattice');
  assert.ok(terrain.includes('float sw = smoothstep(.03, .25, slope) * (1. - rg) * smoothstep(1.6, .5, px) * smoothstep(.02, .10, px);'), 'the folds by rule are for the look from a height: gone by 20 km');
  assert.ok(terrain.includes('* (ms * own * uCrisp * smoothstep(.22, .07, px) * rg);'), 'the ribs down the fall line are for the heights of the polygon only');
  assert.ok(terrain.includes('if (lakeA > 0.) p.h = -14.5 - 52. * smoothstep(.5, 1., worldClimate(ll).r);'), 'a lake of the world is no shallower than its sea: no pale rim round it');
  // no noise of a large size is read along the axes of the map: its square cells show as rectangles from afar
  const forest = read('../src/album/aspects/forest.js');
  assert.ok(forest.includes('vnoise(mat2(.8, -.6, .6, .8) * pk / 2.1 + 11.) + vnoise(mat2(.28, .96, -.96, .28) * pk / 3.7 + 47.)') && !forest.includes('vnoise(pk / 2.6 + 11.)'), 'the stands of the forest');
  assert.ok(ground.includes('vnoise(mat2(.83, .56, -.56, .83) * pk / 310. + 11.)') && ground.includes('vnoise(mat2(.37, -.93, .93, .37) * pk / 420. + 57.)'), 'the regions of soil of the deserts');
  assert.ok(ground.includes('vec3 groundBare(vec3 nz, float wet, float summer, float px, float hl, float slope, float conc, vec2 pk, float wild) {') && terrain.includes('conc, pk, 1. - rg);'), 'the bare ground is told that it lies beyond the polygon');
  // nothing of the world is carried through the aspects: how far inside the polygon a pixel lies is counted again where it is needed
  const main = terrain.slice(terrain.lastIndexOf('void main() {')), after = main.slice(main.indexOf('aspForest(p, L);'));
  assert.ok(!/[^a-zA-Z]rg[^a-zA-Z]/.test(after.replace(/\/\/[^\n]*/g, '')), 'rg is not used after the aspects');
  // the grids: a level that would reach a pole is not drawn, the globe draws the rest by the same program
  assert.ok(terrain.includes('shown = shown && (!fine || fine.half < 2600) && Math.abs(lat) + half / KM_PER_DEG < POLE_LAT;'));
  assert.ok(terrain.includes('this.globes = grids(ggeo, { uCentre: { value: new Vector2(0, 0) }, uCell: { value: KM_PER_DEG }'), 'one more «level»: no more programs to compile');
});

test('world file: the two bakes share one rule', () => {
  for (const f of ['../scripts/album/bake-ground.mjs', '../scripts/album/bake-world-climate.mjs']) assert.ok(read(f).includes("import { rawFolder, openClimate } from './climate-rule.mjs';"), f);
  assert.ok(read('../scripts/album/climate-rule.mjs').includes('export function balance(T, P, lat)'));
});

test('world: three variants of the ground shader, and the polygon keeps the one it had', async () => {
  const terrain = read('../src/album/terrain.js'), glsl = read('../src/album/glsl.js'), forest = read('../src/album/aspects/forest.js');
  // what each variant knows of the polygon
  assert.ok(terrain.includes('#if ZONE == 1\n#define ALBUM_WORLD 0\n#define REGION(ll) 1.\n#define STATE(ll) 1.\n#elif ZONE == 3\n#define ALBUM_WORLD 2\n#define REGION(ll) 0.\n#define STATE(ll) 0.\n#else\n#define ALBUM_WORLD 1\n#define REGION(ll) inRegion(ll)'));
  const main = terrain.slice(terrain.lastIndexOf('void main() {'), terrain.indexOf('// The numbers written as the edges of smoothstep()')).replace(/\/\/[^\n]*/g, '');
  assert.ok(!main.includes('inRegion(') && !main.includes('regionEdge('), 'the shader asks REGION() and STATE() only: inside the polygon and beyond it they are numbers, and the rules of the other side fall out when it is compiled');
  assert.equal(main.split('REGION(ll)').length - 1, 3, 'at the top, at the snow and at the lakes: never carried through the aspects');
  assert.ok(terrain.includes('cw.r = max(worldLod(ll, ${(WORLD_LOD0 + 2).toFixed(2)}), 0.) / 4096.; clim = mix(cw, clim, rg);'), 'the country round a place beyond the polygon: the world map smoothed over 20 km');
  assert.ok(main.includes('if (rsW < 1.) p.cB = mix(vec4(0., 0., 0., .30 + .13 * smoothstep(200., 3000., -h0)), p.cB, rsW);'), 'the sea beyond the chunks is not becalmed');
  // inside the polygon heightLod() is the polygon's own, beyond it the world's alone
  assert.ok(glsl.includes('#if defined(ALBUM_WORLD) && ALBUM_WORLD == 2\n  return worldLod(ll, lod);\n#else') && glsl.includes('#if defined(ALBUM_WORLD) && ALBUM_WORLD == 1\n  float rg = inRegion(ll);'));
  // beyond the polygon nothing of it is read or called
  for (const call of ['aspShore(p, ground, L.cover);', 'aspSwamp(p, L);', 'aspSettle(p, L);', 'aspDivision(p, col, landA);', 'vec2 cuv = chunkUV(pk);', 'float bC = textureLod(uBase, bu, lb).r', 'if (uGrid > 0 || uChunkShow > 0. || uChunkHoverId >= 0.) {', 'if (uFireOn > .5) {']) {
    const k = main.indexOf(call); assert.ok(k > 0, call);
    const before = main.slice(0, k), open = before.lastIndexOf('#if ZONE != 3'), alt = before.lastIndexOf('#if ZONE == 3'), close = before.lastIndexOf('#endif');
    assert.ok(Math.max(open, alt) > close, call + ' is left out of the variant of the world');
  }
  const farmAt = forest.indexOf('  if (fStand.x > .003) fFarm = setFarm(p.pk) * clamp('), zoneAt = forest.lastIndexOf('#if ZONE != 3\n', farmAt);
  assert.ok(farmAt > 0 && zoneAt > 0 && !forest.slice(zoneAt, farmAt).includes('#endif') && !forest.slice(zoneAt, farmAt).replace(/\/\/[^\n]*\n/g, '').trim().replace('#if ZONE != 3', ''), 'nobody ploughs beyond the polygon');
  // the grids are cut between the variants, with a small overlap, and a variant with nothing to draw is not drawn
  assert.ok(terrain.includes('gl_ClipDistance[0] = c4.x; gl_ClipDistance[1] = c4.y; gl_ClipDistance[2] = c4.z; gl_ClipDistance[3] = c4.w; gl_ClipDistance[4] = c5;'));
  assert.ok(terrain.includes("defines: clip ? { ZONE: z, CLIP_ZONES: 1 } : { ZONE: z }, extensions: { clipCullDistance: clip },") && terrain.includes('const clip = clipOk(), ZONES = clip ? [1, 2, 3] : [0];'), 'where the video card cannot cut, one variant draws the whole Earth');
  const { zonesOf } = await import('../src/album/terrain.js').catch(() => ({}));
  if (zonesOf) {
    const mid = [(BBOX.lat0 + BBOX.lat1) / 2, (BBOX.lon0 + BBOX.lon1) / 2];
    assert.deepEqual(zonesOf(mid[0], mid[1], .5, .5), [true, false, false], 'a small square in the middle of Spain: the polygon alone');
    assert.deepEqual(zonesOf(0, 100, 5, 5), [false, false, true], 'the Indian Ocean: the world alone');
    assert.deepEqual(zonesOf(BBOX.lat1, mid[1], 1, 1), [true, true, true], 'across the border: all three');
    assert.deepEqual(zonesOf(mid[0], mid[1], 40, 60), [true, true, true], 'a large square round the polygon');
    assert.deepEqual(zonesOf(BBOX.lat1 + .1, mid[1], .05, .05), [false, true, false], 'inside the band of the border');
    assert.deepEqual(zonesOf(40, mid[1] + 360 - 170, 20, 175), [true, true, true], 'a square that reaches the polygon across the line of 180°');
  }
});

test('the copies of the heights made for textures are let go once the video card has them', () => {
  const data = read('../src/album/data.js');
  assert.ok(data.includes('export const sentOnce = t => { t.onUpdate = () => { t.image.data = null; t.onUpdate = null; }; return t; };'));
  // the base, the detail and the world map: all three go through it; the climate of the world does not — the weather reads its bytes (sky/weather.js)
  assert.equal(data.split('return sentOnce(t);').length - 1, 2, 'heightTexture() and worldHeightTexture()');
  const clim = data.slice(data.indexOf('function worldClimateTexture'), data.indexOf('function worldClimateTexture') + 500);
  assert.ok(clim.length > 100 && !clim.includes('sentOnce'), 'the climate of the world keeps its array');
});

test('stage 3: the loader hands the mask of the worked land to the chunks; at stage 2 there is none', () => {
  const data = read('../src/album/data.js');
  assert.ok(data.includes("import { loadWorked } from './worked.js';") && data.includes('let worked = null;') && data.includes('if (STAGE >= 3) { try { worked = (await loadWorked()).at; }'));
  assert.ok(data.includes('return { meta, base, world, worked, vectors,'), 'data.worked: (lat, lon) → 0, 1, 2 — or null');
});
