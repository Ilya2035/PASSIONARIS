// ASPECT «Деление»: districts, provinces and regions over the map, built from whole chunks. This file and
// src/album/division/ belong to the division work; the contract with the rest of the album is in
// docs/ALBUM-CHUNKS.md, the algorithm in docs/album/division.md.
//   aspDivision(p, col, landA) → tints the finished colour by district, province or region and draws the borders
//                                (map mode «Деление»), lights up the district under the cursor and the chosen one
//   districtAt(pk)             → the district of a point: xy = its middle in flat km, z = a random number of its own
//                                (the earthquake asks it to show what every district felt)
// Every chunk belongs to one district (division/build.js), so a district's border is a chunk's border. The shader
// reads the chunks around a point the way chunkCell() of glsl.js does (four cells of the chunk raster, joined
// linearly, after the same small shift), turns each chunk into its district, province and region through the one
// texture of this aspect (division/gpu.js) and draws the line where two of them weigh the same — exactly on the
// outline of the chunks.
import { Vector3 } from 'three';
import { FKM } from '../chunks.js';
import { emptyTexture } from '../division/gpu.js';
import { startDivision } from '../division/runtime.js';

const GLSL = /* glsl */`
uniform int uDivision, uDivHover, uDivSel, uDivOn;
uniform vec3 uDivSize;                          // district, province, region size, km
uniform highp usampler2D tDiv;                  // a texel per chunk (chunkTexel): see division/gpu.js
// tints of the three levels, as seen on screen: land, water
const vec3 DIV_LAND[8] = vec3[8](vec3(.93, .80, .62), vec3(.72, .86, .62), vec3(.92, .88, .56), vec3(.80, .72, .88), vec3(.62, .82, .86), vec3(.94, .70, .64), vec3(.78, .82, .52), vec3(.86, .86, .82));
const vec3 DIV_WATER[8] = vec3[8](vec3(.55, .70, .90), vec3(.45, .62, .86), vec3(.62, .78, .92), vec3(.50, .74, .86), vec3(.42, .56, .82), vec3(.58, .66, .90), vec3(.66, .80, .94), vec3(.48, .68, .80));

uvec4 divOf(float chunk) { return texelFetch(tDiv, chunkTexel(chunk), 0); }
// the weighted vote of four samples by a key (district, province or region). Only the samples of the pixel's own
// kind (own: land or water) may win, and the others never make a border, so no line runs along the coast. → the
// margin of the winner over the runner-up as a share of the weight (1e4 when there is no runner-up)
float divVote(ivec4 key, vec4 w, vec4 own, out int win, out int other, out int at) {
  vec4 kw = w * own;
  vec4 s = vec4(dot(kw, vec4(equal(key, ivec4(key.x)))), dot(kw, vec4(equal(key, ivec4(key.y)))),
                dot(kw, vec4(equal(key, ivec4(key.z)))), dot(kw, vec4(equal(key, ivec4(key.w)))));
  s = mix(vec4(-1.), s, own);
  at = 0; float best = s.x; win = key.x;
  if (s.y > best) { best = s.y; win = key.y; at = 1; }
  if (s.z > best) { best = s.z; win = key.z; at = 2; }
  if (s.w > best) { best = s.w; win = key.w; at = 3; }
  vec4 rest = mix(vec4(-1.), s, vec4(notEqual(key, ivec4(win))) * own);
  float sec = max(max(rest.x, rest.y), max(rest.z, rest.w));
  other = sec < 0. ? -1 : rest.x == sec ? key.x : rest.y == sec ? key.y : rest.z == sec ? key.z : key.w;
  return sec < 0. ? 1e4 : best + dot(w, 1. - own) - sec;
}
// one layer (land or water) at a point: the district, province, region, the look bits and the texel of the district,
// and how far the borders of the three levels are, km
struct DivAt { int d, d2, pv, rg, look; uvec4 u; float eD, eP, eR; };
DivAt divAt(vec2 pk, float px, bool water) {
  DivAt r = DivAt(0, -1, 0, 0, 0, uvec4(0u), 1e4, 1e4, 1e4);
  vec2 q = pk + (vec2(vnoise(pk / 1.7 + 5.3), vnoise(pk / 1.7 + 17.9)) - .5) * .5;    // the shift of chunkCell (glsl.js)
  // the four samples are one raster cell apart; seen from high up they spread to a few pixels, so lines keep their width
  float s = max(${FKM.toFixed(3)}, 4. * px), sc = s / ${FKM.toFixed(3)};
  vec2 t = (q - uChunkRect.xy) / s - .5, f = fract(t), c0 = (floor(t) + .5) * sc;
  float a = chunkIdTexel(ivec2(floor(c0))), b = chunkIdTexel(ivec2(floor(c0 + vec2(sc, 0.)))),
        c = chunkIdTexel(ivec2(floor(c0 + vec2(0., sc)))), d = chunkIdTexel(ivec2(floor(c0 + vec2(sc))));
  if (a == b && a == c && a == d) {               // inside one chunk: no border near
    uvec4 u = divOf(a);
    r.d = int(u.x & 65535u); r.pv = int(u.x >> 16u); r.rg = int(u.y & 65535u); r.look = int(u.y >> 16u); r.u = u;
    return r;
  }
  uvec4 ua = divOf(a), ub = divOf(b), uc = divOf(c), ud = divOf(d);
  ivec4 kd = ivec4(uvec4(ua.x, ub.x, uc.x, ud.x) & 65535u), kp = ivec4(uvec4(ua.x, ub.x, uc.x, ud.x) >> 16u);
  ivec4 kr = ivec4(uvec4(ua.y, ub.y, uc.y, ud.y) & 65535u), lk = ivec4(uvec4(ua.y, ub.y, uc.y, ud.y) >> 16u);
  ivec4 kind = (lk >> 9) & 3;
  vec4 w = vec4((1. - f.x) * (1. - f.y), f.x * (1. - f.y), (1. - f.x) * f.y, f.x * f.y);
  vec4 own = water ? vec4(notEqual(kind, ivec4(0))) : vec4(equal(kind, ivec4(0)));
  if (dot(own, vec4(1.)) < .5) own = vec4(1.);
  int at = 0, o = 0, o2 = 0;
  float km = s * .5;                              // the margin grows by 2 / s per km across a border
  r.eD = divVote(kd, w, own, r.d, r.d2, at) * km;
  r.u = at == 0 ? ua : at == 1 ? ub : at == 2 ? uc : ud;
  r.look = int(r.u.y >> 16u);
  r.eP = divVote(kp, w, own, r.pv, o, o2) * km;
  r.eR = divVote(kr, w, own, r.rg, o, o2) * km;
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
    col = mix(col, tint * (.55 + .5 * lum), wet ? .42 : .6);
    // borders: the higher the level, the thicker (half widths in pixels); the level of the mode is the boldest; a
    // level is shown only while its pieces are big enough on screen
    vec3 ink = wet ? vec3(.04, .09, .20) : vec3(.10, .06, .07);
    float sD = uDivSize.x / px, sP = uDivSize.y / px;
    vec3 hw = uDivision == 1 ? vec3(.55, 1., 1.5) : uDivision == 2 ? vec3(.45, 1.25, 1.9) : vec3(.4, .55, 2.2);
    vec3 al = uDivision == 1 ? vec3(.5, .8, .95) : uDivision == 2 ? vec3(.22, .9, .95) : vec3(0., .35, 1.);
    al *= vec3(smoothstep(9., 24., sD), smoothstep(9., 24., sP), 1.) * (wet ? .7 : 1.);
    hw *= zoom;
    float lD = 1. - smoothstep(hw.x - .6, hw.x + .6, a.eD / px);
    float lP = 1. - smoothstep(hw.y - .6, hw.y + .6, a.eP / px);
    float lR = 1. - smoothstep(hw.z - .6, hw.z + .6, a.eR / px);
    col = mix(col, ink, max(max(lD * al.x, lP * al.y), lR * al.z));
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
  if (uDivOn == 0 || (uDivision == 0 && uDivHover < 0 && uDivSel < 0)) return;
  float inR = inRegion(p.ll);                     // nothing is divided beyond the album's region
  if (inR < .002) return;
  vec3 cl = landA > .02 ? divLook(col, p.pk, p.px, false) : col;
  vec3 cw = landA < .98 ? divLook(col, p.pk, p.px, true) : col;
  col = mix(col, mix(cw, cl, landA), inR);
}`;

const ZARAGOZA = [41.65, -0.88];
const PAPER = { look: 'paper', forest3d: 0, roadsOn: 0 };      // no roads on these pages: their dark lines read as borders
export default {
  id: 'division', title: 'Деление', glsl: GLSL,
  uniforms: {
    uDivision: { value: 0 }, uDivHover: { value: -1 }, uDivSel: { value: -1 }, uDivOn: { value: 0 },
    uDivSize: { value: new Vector3(30, 100, 340) }, tDiv: { value: emptyTexture() },
  },
  params: [
    { key: 'division', label: 'Деление', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Районы'], [2, 'Провинции'], [3, 'Регионы']], value: 0, uniform: 'uDivision' },
    { key: 'divSize', label: 'Деление: размер района', group: 'modes', type: 'select', options: [[30, 'около 30 км'], [50, 'около 50 км'], [100, 'около 100 км']], value: 30 },
    { key: 'divPick', label: 'Район под курсором', group: 'modes', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'mode-districts', group: 'Режимы карты', title: 'Деление: районы около 30 км', note: 'Район — несколько целых чанков, около 900 км². Границы идут по очертаниям чанков: по рекам, подножиям склонов, хребтам и берегу. Море у берега поделено на куски напротив прибрежных районов, открытое море — на ровные куски. Наведите курсор, щёлкните по району.', p: { ...PAPER, division: 1 }, cam: { lat: 41.4, lon: -1.0, h: 330, tilt: 10, heading: 0 } },
    { id: 'mode-provinces', group: 'Режимы карты', title: 'Деление: провинции около 100 км', note: 'Провинция — соседние районы вместе, около десятка. Тонкие линии — районы внутри провинций.', p: { ...PAPER, division: 2 }, cam: { lat: 40.6, lon: -3.0, h: 700, tilt: 10, heading: 0 } },
    { id: 'mode-regions', group: 'Режимы карты', title: 'Деление: регионы 300–400 км', note: 'Самый крупный уровень: провинции вместе. На полуостров выходит пять-шесть регионов, море делится так же.', p: { ...PAPER, division: 3 }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'division-chunks', group: 'Режимы карты', title: 'Деление: районы из целых чанков', note: 'Светлые линии — очертания чанков, тёмные — границы районов. Граница района всегда идёт по краю чанка: каждый чанк целиком в одном районе.', p: { ...PAPER, division: 1, grid: 1 }, cam: { lat: 41.55, lon: -0.95, h: 160, tilt: 0, heading: 0 } },
    { id: 'division-river', group: 'Режимы карты', title: 'Деление: граница по реке', note: 'Эбро у Сарагосы: чанки сами ложатся по реке, поэтому и районы по обе стороны реки разные, а граница идёт по руслу.', p: { ...PAPER, division: 1 }, cam: { lat: 41.55, lon: -0.95, h: 160, tilt: 0, heading: 0 } },
    { id: 'division-info', group: 'Режимы карты', title: 'Деление: сведения о районе', note: 'Щелчок по району открывает сведения: площадь, чанки, доля леса, болот, застройки и полей, суммы ресурсов по чанкам. Здесь выбран район Сарагосы.', p: { ...PAPER, division: 1 }, divAt: ZARAGOZA, cam: { lat: 41.6, lon: -0.9, h: 260, tilt: 20, heading: 0 } },
    { id: 'division-sea', group: 'Режимы карты', title: 'Деление: море и острова', note: 'Прибрежное море поделено на куски напротив прибрежных районов, чтобы высадиться можно было везде; дальше от берега — ровные куски открытого моря. Балеарские острова — свои районы.', p: { ...PAPER, division: 1 }, cam: { lat: 39.6, lon: 1.4, h: 620, tilt: 10, heading: 0 } },
    { id: 'division-50', group: 'Режимы карты', title: 'Деление: районы около 50 км', note: 'Тот же способ с районом крупнее. Провинции и регионы растут вместе с ним.', p: { ...PAPER, division: 1, divSize: 50 }, cam: { lat: 41.4, lon: -1.0, h: 500, tilt: 10, heading: 0 } },
    { id: 'division-100', group: 'Режимы карты', title: 'Деление: районы около 100 км', note: 'Самый крупный из вариантов размера района.', p: { ...PAPER, division: 1, divSize: 100 }, cam: { lat: 40.4, lon: -3.0, h: 1100, tilt: 0, heading: 0 } },
    { id: 'division-natural', group: 'Режимы карты', title: 'Деление поверх натуральной карты', note: 'Районы и провинции на обычной карте с лесом и рельефом.', p: { look: 'natural', division: 2 }, cam: { lat: 42.4, lon: -1.2, h: 260, tilt: 40, heading: 0 } },
  ],
  async init(album) { return startDivision(album, this.uniforms); },
};
