// ASPECT «Деление»: the historical lands over the map — regions, provinces (public/assets/album/division/lands.json)
// and districts (valleys, comarcas), all built from whole chunks; states of history assembled from them. This file and
// src/album/division/ belong to the division work; the contract with the rest of the album is in
// docs/ALBUM-CHUNKS.md, the algorithm in docs/album/division.md.
//   aspDivision(p, col, landA) → tints the finished colour by district, province or region and draws the borders
//                                (map mode «Деление»), lights up the district under the cursor and the chosen one
//   districtAt(pk)             → the district of a point: xy = its middle in flat km, z = a random number of its own
//                                (the earthquake asks it to show what every district felt)
// Every chunk of 1 km² (division/km.js) belongs to one district (division/cells.js: the outlines run along rivers
// and crests, rounded, inside their province). The shader reads the nine chunks around a point, each with a smooth
// bell, as chunkCell() of glsl.js does with the natural cells; it turns each into its district, province and region
// through the one texture of this aspect (division/gpu.js) and draws the line where two of them weigh the same.
// The chunks themselves are never seen on the map (the owner: «чанки не видим сами по себе… только в dev-режиме»):
// the knob «Чанки 1 км²» draws their outlines and what each is like, for checking.
import { Vector3 } from 'three';
import { KKM as FKM, KN as FN, KM_GLSL } from '../division/km.js';
import { emptyTexture } from '../division/gpu.js';
import { startDivision } from '../division/runtime.js';

const GLSL = /* glsl */`
uniform int uDivision, uDivHover, uDivSel, uDivOn, uDivState, uDivKm;
uniform vec3 uDivSize;                          // district, province, region size, km
uniform float uDivFar;                          // 0 up close .. 1 high up: the borders are lines on the ground (division/lines.js)
uniform highp usampler2D tDiv;                  // the district of every texel of the fine raster, then a texel per district: see division/gpu.js
// tints of the three levels, as seen on screen: land, water
const vec3 DIV_LAND[8] = vec3[8](vec3(.93, .80, .62), vec3(.72, .86, .62), vec3(.92, .88, .56), vec3(.80, .72, .88), vec3(.62, .82, .86), vec3(.94, .70, .64), vec3(.78, .82, .52), vec3(.86, .86, .82));
const vec3 DIV_WATER[8] = vec3[8](vec3(.55, .70, .90), vec3(.45, .62, .86), vec3(.62, .78, .92), vec3(.50, .74, .86), vec3(.42, .56, .82), vec3(.58, .66, .90), vec3(.66, .80, .94), vec3(.48, .68, .80));

uvec4 divOf(float d) { int i = int(d + .5); return texelFetch(tDiv, ivec2(i % ${FN}, ${FN} + i / ${FN}), 0); }
// the district of a chunk of 1 km² (the outline of a district runs chunk by chunk: division/cells.js)
float divTexel(ivec2 i) { return float(texelFetch(tDiv, clamp(i, ivec2(0), ivec2(${FN - 1})), 0).r); }
${KM_GLSL}
// The chunk of 1 km² a point of district d lies in (twin of chunkAt() in division/km.js): among the nine squares
// around the point, those of the district; the nearest seed wins. xy = the square of the chunk, z = km to the nearest
// side it shares with another chunk of the district (1e4 when it has none near).
vec3 kmChunk(vec2 pk, int d) {
  vec2 t = (pk - uChunkRect.xy) / ${FKM.toFixed(4)}, f = fract(t), v1 = vec2(0.); ivec2 c = ivec2(floor(t)), best = c; float d1 = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = c + ivec2(i, j); if (int(divTexel(q) + .5) != d) continue;
    vec2 v = vec2(float(i), float(j)) + kmSeed(q) - f; float dd = dot(v, v);
    if (dd < d1) { d1 = dd; v1 = v; best = q; }
  }
  float e = 1e4;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = c + ivec2(i, j); if (q == best || int(divTexel(q) + .5) != d) continue;
    vec2 v = vec2(float(i), float(j)) + kmSeed(q) - f, w = v - v1;
    e = min(e, dot(.5 * (v1 + v), w) / max(length(w), 1e-4));
  }
  return vec3(vec2(best), e * ${FKM.toFixed(4)});
}
// what a chunk is like (division/gpu.js): the class of its ground 1..5 (0 water, or not worked out), who can live there
ivec3 kmFacts(ivec2 q) { uint g = texelFetch(tDiv, clamp(q, ivec2(0), ivec2(${FN - 1})), 0).g; return ivec3(int(g & 7u), int((g >> 3u) & 3u), int((g >> 8u) & 255u)); }   // z: its share under fields, a byte
// the five classes of ground, as seen on screen: level, rolling, hilly, steep, mountain
const vec3 KM_CLASS[6] = vec3[6](vec3(.55, .66, .82), vec3(.30, .62, .30), vec3(.62, .78, .36), vec3(.96, .85, .36), vec3(.93, .56, .22), vec3(.62, .24, .22));
// A vote among the chunks around a point, the way chunkCell() of glsl.js weighs them: the nine cells of the chunk
// raster around the point, each with a smooth bell (a quadratic B-spline). Up to four keys (districts, provinces or
// regions) with their weights; no arrays (on some GPUs an array read at a varying place goes through slow memory).
struct DivAcc { ivec4 k; vec4 w; };
DivAcc divNone() { return DivAcc(ivec4(-1), vec4(0.)); }
void divAdd(inout DivAcc a, int key, float w) {
  if (key == a.k.x) a.w.x += w; else if (key == a.k.y) a.w.y += w; else if (key == a.k.z) a.w.z += w; else if (key == a.k.w) a.w.w += w;
  else if (a.k.x < 0) { a.k.x = key; a.w.x = w; } else if (a.k.y < 0) { a.k.y = key; a.w.y = w; }
  else if (a.k.z < 0) { a.k.z = key; a.w.z = w; } else if (a.k.w < 0) { a.k.w = key; a.w.w = w; }
}
// the winner, the runner-up and the margin between them; the weight of samples of the other kind (foreign) goes to
// the winner, so they never make a border (no line along the coast). 1e4 when there is no runner-up
float divWin(DivAcc a, float foreign, out int win, out int other) {
  float best = a.w.x; win = a.k.x;
  if (a.k.y >= 0 && a.w.y > best) { best = a.w.y; win = a.k.y; }
  if (a.k.z >= 0 && a.w.z > best) { best = a.w.z; win = a.k.z; }
  if (a.k.w >= 0 && a.w.w > best) { best = a.w.w; win = a.k.w; }
  vec4 rest = mix(vec4(-1.), a.w, vec4(notEqual(a.k, ivec4(win))) * vec4(greaterThanEqual(a.k, ivec4(0))));
  float sec = max(max(rest.x, rest.y), max(rest.z, rest.w));
  other = sec < 0. ? -1 : rest.x == sec ? a.k.x : rest.y == sec ? a.k.y : rest.z == sec ? a.k.z : a.k.w;
  return sec < 0. ? 1e4 : best + foreign - sec;
}
// one layer (land or water) at a point: the district, province, region, the look bits and the texel of the district,
// and how far the borders of the three levels and of the state are, km (the margin grows by 1.6 per km)
struct DivAt { int d, d2, pv, rg, look, st; uvec4 u; float eD, eP, eR, eS; };
DivAt divAt(vec2 pk, float px, bool water) {
  DivAt r = DivAt(0, -1, 0, 0, 0, 0, uvec4(0u), 1e4, 1e4, 1e4, 1e4);
  vec2 t = (pk - uChunkRect.xy) / ${FKM.toFixed(4)}, f = fract(t); ivec2 c = ivec2(floor(t));
  vec3 wx = vec3(.5 * (1. - f.x) * (1. - f.x), .75 - (f.x - .5) * (f.x - .5), .5 * f.x * f.x);
  vec3 wy = vec3(.5 * (1. - f.y) * (1. - f.y), .75 - (f.y - .5) * (f.y - .5), .5 * f.y * f.y);
  DivAcc ad = divNone(), ap = divNone(), ar = divNone();
  float foreign = 0., stw = 0., last = -1., first = -1.; bool one = true;
  uvec4 u = uvec4(0u), u0 = uvec4(0u), u1 = uvec4(0u), u2 = uvec4(0u), u3 = uvec4(0u);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    float id = divTexel(c + ivec2(i - 1, j - 1)), w = wx[i] * wy[j];
    if (first < 0.) first = id; else if (id != first) one = false;
    if (id != last) { u = divOf(id); last = id; }
    stw += float((u.w >> 16u) & 1u) * w;
    int kind = int((u.y >> 25u) & 3u);
    if (water ? kind == 0 : kind != 0) { foreign += w; continue; }
    int d = int(u.x & 65535u);
    if (d != ad.k.x && d != ad.k.y && d != ad.k.z && d != ad.k.w) { if (ad.k.x < 0) u0 = u; else if (ad.k.y < 0) u1 = u; else if (ad.k.z < 0) u2 = u; else if (ad.k.w < 0) u3 = u; }
    divAdd(ad, d, w); divAdd(ap, int(u.x >> 16u), w); divAdd(ar, int(u.y & 65535u), w);
  }
  if (ad.k.x < 0) { ad.k.x = int(u.x & 65535u); ad.w.x = 1.; u0 = u; foreign = 0.; ap = DivAcc(ivec4(int(u.x >> 16u), -1, -1, -1), vec4(1., 0., 0., 0.)); ar = DivAcc(ivec4(int(u.y & 65535u), -1, -1, -1), vec4(1., 0., 0., 0.)); }
  int o = 0;
  float km = ${(FKM / 2).toFixed(4)};                                             // the margin grows by two for every chunk crossed
  r.eD = one ? 1e4 : divWin(ad, foreign, r.d, r.d2) * km;
  if (one) r.d = ad.k.x;
  r.u = r.d == ad.k.x ? u0 : r.d == ad.k.y ? u1 : r.d == ad.k.z ? u2 : u3;
  r.look = int(r.u.y >> 16u);
  r.eP = one ? 1e4 : divWin(ap, foreign, r.pv, o) * km; if (one) r.pv = ap.k.x;
  r.eR = one ? 1e4 : divWin(ar, foreign, r.rg, o) * km; if (one) r.rg = ar.k.x;
  r.st = stw > .5 ? 1 : 0;
  if (uDivState == 1) r.eS = abs(2. * stw - 1.) * km;
  return r;
}
// the look of one layer over the colour col
vec3 divLook(vec3 col, vec2 pk, float px, bool water) {
  DivAt a = divAt(pk, px, water);
  bool wet = ((a.look >> 9) & 3) != 0;
  float lum = dot(col, vec3(.33)), zoom = 1. + .7 * smoothstep(.15, .03, px);
  if (uDivision > 0) {
    int ci = uDivision == 1 ? a.look & 7 : uDivision == 2 ? (a.look >> 3) & 7 : (a.look >> 6) & 7;
    vec3 tint = wet ? DIV_WATER[ci] : DIV_LAND[ci];
    // (on the natural map the land shows through; where the chunks are coloured by what they are, the land keeps no tint of its district)
    col = mix(col, tint * (.55 + .5 * lum), (wet ? .42 : .6) * (uStyle == 0 ? .5 : 1.) * (uDivKm >= 2 && !wet ? 0. : 1.));
    // borders: the higher the level, the thicker (half widths in pixels); the level of the mode is the boldest; a
    // level is shown only while its pieces are big enough on screen
    vec3 ink = wet ? vec3(.04, .09, .20) : vec3(.10, .06, .07);
    if (uStyle == 0) ink = wet ? vec3(.75, .85, 1.) : vec3(1.15, 1.02, .78);   // over the natural land a light line reads, a dark one sinks into the relief
    float sD = uDivSize.x / px, sP = uDivSize.y / px;
    vec3 hw = uDivision == 1 ? vec3(.55, 1., 1.5) : uDivision == 2 ? vec3(.45, 1.25, 1.9) : vec3(.4, .55, 2.2);
    vec3 al = uDivision == 1 ? vec3(.5, .8, .95) : uDivision == 2 ? vec3(.22, .9, .95) : vec3(0., .35, 1.);
    al *= vec3(smoothstep(9., 24., sD), smoothstep(9., 24., sP), 1.) * (wet ? .45 : 1.);
    hw *= zoom * (wet ? .7 : 1.);
    float lD = 1. - smoothstep(hw.x - .6, hw.x + .6, a.eD / px);
    float lP = 1. - smoothstep(hw.y - .6, hw.y + .6, a.eP / px);
    float lR = 1. - smoothstep(hw.z - .6, hw.z + .6, a.eR / px);
    col = mix(col, ink, max(max(lD * al.x, lP * al.y), lR * al.z) * (1. - uDivFar));
  }
  // a state of history assembled from provinces: bright inside, the rest of the map dimmed, a bold border
  if (uDivState == 1) {
    if (a.st == 0) col = mix(col, vec3(dot(col, vec3(.3, .55, .15))), .6) * .62;
    else col = mix(col, vec3(.98, .80, .42) * (.6 + .5 * lum), .35);
    float e = a.eS / px, w = 2.2 * zoom;
    col = mix(col, vec3(.42, .05, .04), (1. - smoothstep(w - .6, w + .6, e)) * (1. - uDivFar));
  }
  // the chunks of 1 km², for checking: what each is like and its outline. Shown while a chunk is a few pixels wide.
  if (uDivKm > 0 && px < .2) {
    vec3 kc = kmChunk(pk, a.d); ivec3 kf = kmFacts(ivec2(kc.xy));
    float seen = 1. - smoothstep(.1, .2, px);
    if (!wet && uDivKm == 2 && kf.x > 0) col = mix(col, KM_CLASS[kf.x] * (.72 + .34 * lum), .82 * seen);
    if (!wet && uDivKm == 3 && kf.x > 0) col = mix(col, (kf.y == 2 ? vec3(.34, .66, .34) : kf.y == 1 ? vec3(.96, .82, .34) : vec3(.78, .28, .24)) * (.72 + .34 * lum), .82 * seen);
    // by its fields: the more of the chunk is ploughed, the deeper the colour (town/farmland.js)
    if (!wet && uDivKm == 4 && kf.z > 0) col = mix(col, mix(vec3(.98, .90, .52), vec3(.86, .50, .12), float(kf.z) / 255.) * (.72 + .34 * lum), (.35 + .5 * float(kf.z) / 255.) * seen);
    float e = min(kc.z, a.eD) / px, w = .5 * zoom;                                    // the side of a chunk, or the edge of its district
    vec3 ink = uStyle == 0 ? vec3(1., .98, .9) : vec3(.12, .10, .12);
    col = mix(col, ink, (1. - smoothstep(w - .5, w + .6, e)) * (wet ? .3 : uDivKm == 1 ? .55 : .2) * seen * smoothstep(.2, .09, px));
  }
  // the district under the cursor and the chosen one
  if (uDivHover >= 0 && a.d == uDivHover) col = mix(col, vec3(1.), .16);
  if (uDivSel >= 0 && a.d == uDivSel) col = mix(col, vec3(1., .97, .88), .26);
  bool onSel = uDivSel >= 0 && (a.d == uDivSel || a.d2 == uDivSel), onHov = uDivHover >= 0 && (a.d == uDivHover || a.d2 == uDivHover);
  if (onSel || onHov) {
    float e = a.eD / px, w = (onSel ? 1.5 : 1.0) * zoom;
    col = mix(col, vec3(.02), (1. - smoothstep(w + .9, w + 1.9, e)) * .55);           // a dark edge under the light line
    col = mix(col, onSel ? vec3(1., .96, .82) : vec3(.95), 1. - smoothstep(w - .5, w + .5, e));
  }
  return col;
}
// before the division is worked out the earthquake falls back on a plain lattice of districts of 30 km
vec3 divLattice(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.); float d1 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = .15 + .7 * hash22(i + g), r = g + o - u; float dd = dot(r, r);
    if (dd < d1) { d1 = dd; best = i + g + o; id = hash21(i + g + 3.3); }
  }
  return vec3(best, id);
}
vec3 districtAt(vec2 pk) {
  if (uDivOn == 0) { vec3 c = divLattice(pk / 30.); return vec3(c.xy * 30., c.z); }
  DivAt a = divAt(pk, 0., false);
  return vec3(float(a.u.z & 65535u) / 10. - 1000., float(a.u.z >> 16u) / 10. + 3000., float(a.u.w) / 65535.);
}

void aspDivision(Px p, inout vec3 col, float landA) {
  if (uDivOn == 0 || (uDivision == 0 && uDivHover < 0 && uDivSel < 0 && uDivKm == 0)) return;
  float inR = inRegion(p.ll);                     // nothing is divided beyond the album's region
  if (inR < .002) return;
  vec3 cl = landA > .02 ? divLook(col, p.pk, p.px, false) : col;
  vec3 cw = landA < .98 ? divLook(col, p.pk, p.px, true) : col;
  col = mix(col, mix(cw, cl, landA), inR);
}`;

const ZARAGOZA = [41.65, -0.89];                    // the town of the album data (vectors.places)
const PAPER = { look: 'paper', forest3d: 0, roadsOn: 0 };      // no roads on these pages: their dark lines read as borders
const NATURAL = { look: 'natural', roadsOn: 0 };
// the states of history the knob offers: ids of lands.json "states"
export const STATES = [['', 'нет'], ['aragon', 'Королевство Арагон, XIII в.'], ['crown', 'Арагонская корона, XIV в.'], ['barcelona', 'Графство Барселона, XI в.'],
  ['navarre', 'Королевство Наварра, XII в.'], ['portugal', 'Королевство Португалия, 1250 г.'], ['granada', 'Гранадский эмират, XV в.']];
export default {
  id: 'division', title: 'Деление', glsl: GLSL,
  uniforms: {
    uDivision: { value: 0 }, uDivHover: { value: -1 }, uDivSel: { value: -1 }, uDivOn: { value: 0 }, uDivState: { value: 0 }, uDivKm: { value: 0 },
    uDivSize: { value: new Vector3(20, 100, 900) }, uDivFar: { value: 0 }, tDiv: { value: emptyTexture() },
  },
  params: [
    { key: 'division', label: 'Деление', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Районы'], [2, 'Провинции'], [3, 'Регионы']], value: 0, uniform: 'uDivision' },
    { key: 'divSize', label: 'Деление: размер района', group: 'modes', type: 'select', options: [[20, 'около 20 км'], [30, 'около 30 км'], [50, 'около 50 км'], [100, 'около 100 км']], value: 20 },
    { key: 'divState', label: 'Деление: собрать государство', group: 'modes', type: 'select', options: STATES, value: '' },
    { key: 'divLabels', label: 'Деление: названия земель', group: 'modes', type: 'toggle', value: 1 },
    { key: 'divPick', label: 'Район под курсором', group: 'modes', type: 'toggle', value: 0 },
    { key: 'km', label: 'Чанки 1 км² (проверка)', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'очертания'], [2, 'класс земли'], [3, 'жилые и нежилые'], [4, 'угодья']], value: 0, uniform: 'uDivKm' },
  ],
  pages: [
    { id: 'mode-regions', group: 'Режимы карты', title: 'Деление: регионы', note: 'Регион — большая культурно-географическая земля: Иберия (весь полуостров с Балеарскими островами), Западная Европа (в альбоме её юг, до Пиренеев), Магриб. На воде регион — настоящее море со своим именем. Границы идут по гребням и берегам.', p: { ...PAPER, division: 3 }, cam: { lat: 40.3, lon: -2.4, h: 1650, tilt: 0, heading: 0 } },
    { id: 'mode-provinces', group: 'Режимы карты', title: 'Деление: провинции', note: 'Провинция — политическая и историческая единица: Риоха, Ла-Манча, Бьерсо, Сердань, Беарн, Алгарве… Она тянется к нынешним провинциям, округам и департаментам. Граница ровная, без мелких изгибов, и идёт по реке или гребню, если они рядом. Из провинций собираются государства.', p: { ...PAPER, division: 2 }, cam: { lat: 40.9, lon: -2.6, h: 950, tilt: 0, heading: 0 } },
    { id: 'mode-districts', group: 'Режимы карты', title: 'Деление: районы около 20 км', note: 'Район — около 20 км в поперечнике, 400–500 км². Его граница идёт по реке или по гребню: река чаще всего край района, а не его середина. Очертания округлые. Район состоит из целых чанков по 1 км², их в нём около четырёхсот. Район не выходит за свою провинцию. С районом работает игрок; ручка «Деление: размер района» показывает и прежние размеры.', p: { ...PAPER, division: 1 }, cam: { lat: 41.5, lon: -0.9, h: 380, tilt: 10, heading: 0 } },
    { id: 'division-pyrenees', group: 'Режимы карты', title: 'Деление: Пиренеи — гребень как граница', note: 'Пиренеи не провинция: по гребню идёт граница. Южные склоны принадлежат Верхнему Арагону, Урхелю, Андорре, Сердани, северные — Беарну, Бигорру, Комменжу, Фуа, Руссильону. Каждая долина — свой район и целиком на своей стороне.', p: { ...NATURAL, division: 1 }, cam: { lat: 42.15, lon: 0.6, h: 300, tilt: 48, heading: 0 } },
    { id: 'division-cantabrian', group: 'Режимы карты', title: 'Деление: Кантабрийские горы', note: 'Гребень делит Астурию и Кантабрию на севере и Леон с Паленсией на юге. Северные склоны Пикос-де-Эуропа отошли к Астурии и Кантабрии: туда они стекают.', p: { ...NATURAL, division: 1 }, cam: { lat: 42.55, lon: -5.0, h: 260, tilt: 48, heading: 0 } },
    { id: 'division-central', group: 'Режимы карты', title: 'Деление: Центральная Кордильера', note: 'Сьерра-де-Гвадаррама и Гредос — граница Старой и Новой Кастилии: к северу Сеговия и Авила (бассейн Дуэро), к югу Мадрид и Толедо (бассейн Тахо).', p: { ...NATURAL, division: 1 }, cam: { lat: 40.05, lon: -4.3, h: 260, tilt: 48, heading: 330 } },
    { id: 'division-ebro', group: 'Режимы карты', title: 'Деление: Эбро — ось Арагона, граница районов', note: 'Провинция лежит по обе стороны большой реки: Сарагоса — на обоих берегах Эбро, граница Арагона идёт по водоразделам. Районы же делятся по рекам: Эбро, Гальего, Халон и Уэрва — их края.', p: { ...PAPER, division: 2 }, cam: { lat: 41.5, lon: -0.8, h: 560, tilt: 10, heading: 0 } },
    { id: 'division-guadalquivir', group: 'Режимы карты', title: 'Деление: Гвадалквивир — ось Андалусии', note: 'Севилья, Кордова и Хаэн лежат вдоль Гвадалквивира по обоим берегам; с севера Андалусию закрывает Сьерра-Морена, с юга — Бетские горы.', p: { ...PAPER, division: 2 }, cam: { lat: 37.6, lon: -4.6, h: 620, tilt: 10, heading: 0 } },
    { id: 'division-state', group: 'Режимы карты', title: 'Деление: собрано государство — Арагон', note: 'Королевство Арагон XIII века собрано из районов: Верхний Арагон, Сарагоса, Теруэль. Другие государства — ручка «Деление: собрать государство».', p: { ...PAPER, division: 2, divState: 'aragon' }, cam: { lat: 41.3, lon: -0.6, h: 720, tilt: 0, heading: 0 } },
    { id: 'division-crown', group: 'Режимы карты', title: 'Деление: собрано государство — Арагонская корона', note: 'Арагон, Каталония, Валенсия, Балеарские острова и Руссильон XIV века — из тех же районов.', p: { ...PAPER, division: 3, divState: 'crown' }, cam: { lat: 40.6, lon: 0.6, h: 1250, tilt: 0, heading: 0 } },
    { id: 'km-chunks', group: 'Режимы карты', title: 'Чанки 1 км²: район делится на чанки', note: 'Проверочный вид: в игре чанки не видны. Тонкие линии — чанки по одному квадратному километру, толстые — границы районов. Чанк не квадрат: внутри района его стороны идут посередине между соседними чанками, у края района его очертание — край района (река, гребень, берег). Район состоит из целых чанков; у Сарагосы их 511. Суша и вода в одном чанке не лежат.', p: { ...PAPER, division: 1, km: 1, divLabels: 0 }, cam: { lat: 41.66, lon: -0.9, h: 36, tilt: 0, heading: 0 } },
    { id: 'km-chunks-natural', group: 'Режимы карты', title: 'Чанки 1 км² на натуральной карте', note: 'Те же чанки поверх обычной картины, с 20 км: видно, что чанк — это несколько полей или квартал города. Наведите курсор: внизу написано, что это за чанк.', p: { ...NATURAL, division: 1, km: 1, divLabels: 0, growth: 1.6 }, cam: { lat: 41.66, lon: -0.9, h: 20, tilt: 25, heading: 0 } },
    { id: 'km-class', group: 'Режимы карты', title: 'Чанки: пять классов земли', note: 'У каждого чанка заранее посчитано, насколько ровная его земля. Зелёный — ровная земля, жёлто-зелёный — пологие холмы, жёлтый — холмы и склоны, рыжий — крутые склоны, серо-лиловый — горы. Класс берётся по самой ровной четверти чанка: дно узкой долины между крутыми стенами — место для жилья. Здесь долины Пиренеев: Валь-д’Аран, Бенаске, Рибагорса.', p: { ...PAPER, division: 1, km: 2, divLabels: 0 }, cam: { lat: 42.6, lon: 0.62, h: 110, tilt: 0, heading: 0 } },
    { id: 'km-class-plain', group: 'Режимы карты', title: 'Чанки: классы земли на равнине Эбро', note: 'Долина Эбро у Сарагосы почти вся первого класса; к краям долины — холмы второго и третьего. Границы классов не видны в игре: это числа чанков, по которым потом расселяются люди.', p: { ...PAPER, division: 1, km: 2, divLabels: 0 }, cam: { lat: 41.6, lon: -0.9, h: 110, tilt: 0, heading: 0 } },
    { id: 'km-living', group: 'Режимы карты', title: 'Чанки: жилые, едва жилые и нежилые', note: 'Зелёный — жить можно (классы 1–3), жёлтый — едва: на крутых склонах встанет разве что хутор (класс 4), красный — нежилой чанк (класс 5: горы и всё выше 2 400 м). В горах жилые чанки идут цепочками по долинам. Здесь Пиренеи от Андорры до Сердани.', p: { ...PAPER, division: 1, km: 3, divLabels: 0 }, cam: { lat: 42.5, lon: 1.7, h: 130, tilt: 0, heading: 0 } },
    { id: 'km-farm', group: 'Режимы карты', title: 'Чанки: угодья', note: 'Проверочный вид: у каждого чанка одно число — какая его доля под полями. Чем гуще цвет, тем больше распахано: тёмно-рыжий — чанк угодий целиком, светло-жёлтый — несколько наделов. Поселение распахивает чанки вокруг себя, сколько нужно его жителям; ровную землю раньше холмов. Рисунок полей на обычной карте берётся только из этого числа. Здесь «Рост городов» на 1,6.', p: { ...PAPER, division: 1, km: 4, divLabels: 0, growth: 1.6 }, cam: { lat: 41.66, lon: -0.9, h: 60, tilt: 0, heading: 0 } },
    { id: 'km-farm-natural', group: 'Режимы карты', title: 'Чанки: угодья на натуральной карте', note: 'Те же числа поверх обычной картины: видно, что поля нарисованы там, где чанки распаханы, а край полей идёт по наделам и не повторяет прямые стороны чанков.', p: { ...NATURAL, division: 1, km: 4, divLabels: 0, growth: 1.6, forest3d: 0 }, cam: { lat: 41.74, lon: -1.08, h: 24, tilt: 20, heading: 0 } },
    { id: 'division-chunks', group: 'Режимы карты', title: 'Деление: район и природные ячейки', note: 'Светлые линии — очертания природных ячеек около 100 км²: по ним пока считаются лес, лёд и болота. Тёмные — границы районов. Район состоит из чанков по 1 км², а не из этих ячеек, поэтому линии совпадают не везде. Числа района суммируются по его чанкам; число ячейки делится между районами по тому, сколько её чанков в каждом.', p: { ...PAPER, division: 1, grid: 1 }, cam: { lat: 41.55, lon: -0.95, h: 160, tilt: 0, heading: 0 } },
    { id: 'division-info', group: 'Режимы карты', title: 'Деление: сведения о районе', note: 'Щелчок по району открывает сведения: провинция и регион, площадь, число чанков по 1 км², доля леса, болот, застройки и полей, сколько чанков какого класса земли и сколько жилых, суммы ресурсов. Здесь выбран район Сарагосы.', p: { ...PAPER, division: 1 }, divAt: ZARAGOZA, cam: { lat: 41.6, lon: -0.9, h: 260, tilt: 20, heading: 0 } },
    { id: 'division-sea', group: 'Режимы карты', title: 'Деление: море и острова', note: 'Моря названы: Бискайский залив, Атлантика, Кадисский залив, море Альборан, Балеарское море, Лионский залив. Прибрежное море поделено на куски напротив прибрежных районов, чтобы высадиться можно было везде.', p: { ...PAPER, division: 3 }, cam: { lat: 39.6, lon: 0.6, h: 900, tilt: 0, heading: 0 } },
    { id: 'division-50', group: 'Режимы карты', title: 'Деление: районы около 50 км', note: 'Тот же способ с районом крупнее. Провинции и регионы — те же исторические земли.', p: { ...PAPER, division: 1, divSize: 50 }, cam: { lat: 41.4, lon: -1.0, h: 560, tilt: 10, heading: 0 } },
  ],
  async init(album) { return startDivision(album, this.uniforms); },
};
