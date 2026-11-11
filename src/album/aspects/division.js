// ASPECT «Деление»: districts, provinces and regions over the map, built from whole chunks. This file and
// src/album/division/ belong to the division work; the contract with the rest of the album is in
// docs/ALBUM-CHUNKS.md, the algorithm in docs/album/division.md.
//   aspDivision(p, col, landA) → tints the finished colour by district, province or region and draws the borders
//                                (map mode «Деление»), lights up the district under the cursor and the chosen one
//   districtAt(pk)             → the district of a point: xy = its centre in flat km, z = a random number of its own
//                                (the earthquake asks it to show what every district felt)
// Every chunk belongs to one district (division/build.js). The drawn border is not a staircase along the chunks:
// the shader reads a finer grid of 1.25 km (division/fine.js), smooths it with a cubic B-spline and draws the line
// where two districts weigh the same — on the river where a river divides them, smoothly between chunks elsewhere.
// With «точно по чанкам» it shows the chunks themselves.
import { Vector3 } from 'three';
import { CN, CHUNK_KM } from '../chunks.js';
import { G, CELL_KM, X0, Y0 } from '../division/fine.js';
import { emptyTextures } from '../division/gpu.js';
import { startDivision } from '../division/runtime.js';

const GLSL = /* glsl */`
uniform int uDivision, uDivChunks, uDivHover, uDivSel, uDivOn;
uniform vec3 uDivSize;                          // district, province, region size, km
uniform highp usampler2D tDivF, tDivC, tDivT;
// tints of the three levels, as seen on screen: land, water
const vec3 DIV_LAND[8] = vec3[8](vec3(.93, .80, .62), vec3(.72, .86, .62), vec3(.92, .88, .56), vec3(.80, .72, .88), vec3(.62, .82, .86), vec3(.94, .70, .64), vec3(.78, .82, .52), vec3(.86, .86, .82));
const vec3 DIV_WATER[8] = vec3[8](vec3(.55, .70, .90), vec3(.45, .62, .86), vec3(.62, .78, .92), vec3(.50, .74, .86), vec3(.42, .56, .82), vec3(.58, .66, .90), vec3(.66, .80, .94), vec3(.48, .68, .80));

uvec4 divT(int d, int part) { return texelFetch(tDivT, ivec2((d & 63) * 2 + part, d >> 6), 0); }
vec4 divB(float t) { float s = 1. - t, t2 = t * t, t3 = t2 * t; return vec4(s * s * s, 3. * t3 - 6. * t2 + 4., -3. * t3 + 3. * t2 + 3. * t + 1., t3) / 6.; }
vec4 divBd(float t) { float s = 1. - t; return vec4(-3. * s * s, 9. * t * t - 12. * t, -9. * t * t + 6. * t + 3., 3. * t * t) / 6.; }

// The districts around a point, joined smoothly: up to four, each with its weight (x) and the weight's change per km
// (yz), and on which side of a river its cells lie (side: + left of the river's course). sd: the signed distance to
// the nearest river, km, read smoothly (1e4 far from rivers). Most points lie well inside one district: one read
// tells so.
int divNear(vec2 pk, bool water, out int id[4], out vec3 w[4], out float side[4], out float sd) {
  vec2 q = (pk - vec2(${X0.toFixed(1)}, ${Y0.toFixed(1)})) / ${CELL_KM.toFixed(4)} - .5, f = floor(q), t = q - f;
  ivec2 i0 = ivec2(f), hi = ivec2(${G - 1});
  for (int i = 0; i < 4; i++) { id[i] = -1; w[i] = vec3(0.); side[i] = 0.; }
  sd = 1e4;
  uvec2 c = texelFetch(tDivF, clamp(i0, ivec2(0), hi), 0).rg;
  uint v = water ? c.y : c.x;
  if (v >= 32768u) { id[0] = int(v - 32768u); w[0] = vec3(1., 0., 0.); return 1; }
  vec4 bx = divB(t.x), by = divB(t.y), dx = divBd(t.x) / ${CELL_KM.toFixed(4)}, dy = divBd(t.y) / ${CELL_KM.toFixed(4)};
  int n = 0; float sdA = 0., sdN = 0.;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    uvec3 cc = texelFetch(tDivF, clamp(i0 + ivec2(x - 1, y - 1), ivec2(0), hi), 0).rgb;
    int d = int((water ? cc.y : cc.x) & 32767u);
    vec3 ww = vec3(bx[x] * by[y], dx[x] * by[y], bx[x] * dy[y]);
    float r = cc.z == 65535u || water ? 0. : (float(cc.z) - 32768.) / 1000.;
    if (x > 0 && x < 3 && y > 0 && y < 3) { float bw = (x == 1 ? 1. - t.x : t.x) * (y == 1 ? 1. - t.y : t.y); sdA += r * bw; sdN += r != 0. ? bw : 0.; }
    int j = 0;
    while (j < n && id[j] != d) j++;
    if (j >= n && n < 4) { id[n] = d; w[n] = vec3(0.); n++; }
    if (j < 4) { w[j] += ww; side[j] += ww.x * sign(r); }
  }
  if (sdN > .999) sd = sdA;
  return n;
}
// The heaviest of the keyed weights (districts, or the provinces or regions they belong to), the runner-up, and how
// far the border between them is, km (weight difference over its slope)
float divEdge(int n, int key[4], vec3 w[4], out int win, out int other) {
  int k2[4]; vec3 w2[4]; int m = 0;
  for (int i = 0; i < 4; i++) { k2[i] = -1; w2[i] = vec3(0.); }
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    int j = 0;
    while (j < m && k2[j] != key[i]) j++;
    if (j < m) w2[j] += w[i]; else { k2[m] = key[i]; w2[m] = w[i]; m++; }
  }
  int a = 0;
  for (int i = 1; i < 4; i++) if (i < m && w2[i].x > w2[a].x) a = i;
  win = k2[a]; other = -1;
  if (m < 2) return 1e4;
  int b = a == 0 ? 1 : 0;
  for (int i = 0; i < 4; i++) if (i < m && i != a && w2[i].x > w2[b].x) b = i;
  other = k2[b];
  vec3 d = w2[a] - w2[b];
  return d.x / max(length(d.yz), 1e-4);
}
// one layer (land or water) at a point: the district and distances (km) to the borders of the three levels
struct DivAt { int d, d2, pv, rg; float eD, eP, eR; };
DivAt divAt(vec2 pk, float px, bool water) {
  DivAt r = DivAt(0, -1, 0, 0, 1e4, 1e4, 1e4);
  if (uDivChunks == 1) {                         // the chunks exactly: straight borders along the grid
    vec2 c = pk / ${CHUNK_KM}. - vec2(${(X0 / CHUNK_KM).toFixed(1)}, ${(Y0 / CHUNK_KM).toFixed(1)}); ivec2 ci = ivec2(floor(c)); vec2 f = fract(c) * ${CHUNK_KM}.;
    r.d = int(texelFetch(tDivC, clamp(ci, ivec2(0), ivec2(${CN - 1})), 0).r);
    uvec4 t0 = divT(r.d, 0); r.pv = int(t0.x); r.rg = int(t0.y);
    r.d2 = -1; r.eD = 1e4; r.eP = 1e4; r.eR = 1e4;
    for (int s = 0; s < 4; s++) {
      ivec2 o = s == 0 ? ivec2(-1, 0) : s == 1 ? ivec2(1, 0) : s == 2 ? ivec2(0, -1) : ivec2(0, 1);
      float e = s == 0 ? f.x : s == 1 ? ${CHUNK_KM}. - f.x : s == 2 ? f.y : ${CHUNK_KM}. - f.y;
      int dn = int(texelFetch(tDivC, clamp(ci + o, ivec2(0), ivec2(${CN - 1})), 0).r);
      if (dn == r.d) continue;
      uvec4 tn = divT(dn, 0);
      if (e < r.eD) { r.eD = e; r.d2 = dn; }
      if (int(tn.x) != r.pv) r.eP = min(r.eP, e);
      if (int(tn.y) != r.rg) r.eR = min(r.eR, e);
    }
    return r;
  }
  int id[4], kp[4], kr[4]; vec3 w[4]; float side[4], sd = 1e4;
  int n = divNear(pk, water, id, w, side, sd);
  for (int i = 0; i < 4; i++) { kp[i] = -1; kr[i] = -1; if (i < n) { uvec4 t = divT(id[i], 0); kp[i] = int(t.x); kr[i] = int(t.y); } }
  int o = 0;
  r.eD = divEdge(n, id, w, r.d, r.d2);
  r.eP = divEdge(n, kp, w, r.pv, o);
  r.eR = divEdge(n, kr, w, r.rg, o);
  // two districts on the two sides of a river: the border is the river itself
  if (r.d2 >= 0 && abs(sd) < 3.5) {
    float sa = 0., sb = 0.;
    for (int i = 0; i < 4; i++) { if (id[i] == r.d) sa = side[i]; if (id[i] == r.d2) sb = side[i]; }
    if (sa * sb < 0.) {
      int win = (sd > 0.) == (sa > 0.) ? r.d : r.d2, oth = win == r.d ? r.d2 : r.d;
      uvec4 tw = divT(win, 0), to = divT(oth, 0);
      // the river ribbon (layers/rivers.js) lies over the middle of the line: the border shows on both its banks
      float e = max(0., abs(sd) - max(1.1 * px, .1));
      r.d = win; r.d2 = oth; r.eD = e; r.pv = int(tw.x); r.rg = int(tw.y);
      if (tw.x != to.x) r.eP = e;
      if (tw.y != to.y) r.eR = e;
    }
  }
  return r;
}
// the look of one layer over the colour col
vec3 divLook(vec3 col, vec2 pk, float px, bool water) {
  DivAt a = divAt(pk, px, water);
  uvec4 info = divT(a.d, 0);
  int kind = int(info.z >> 12u);
  bool wet = kind != 0;
  float lum = dot(col, vec3(.33)), zoom = 1. + .7 * smoothstep(.15, .03, px);
  if (uDivision > 0) {
    int ci = int(uDivision == 1 ? (info.z & 15u) : uDivision == 2 ? ((info.z >> 4u) & 15u) : ((info.z >> 8u) & 15u));
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
  DivAt a = divAt(pk, 1., false);
  uvec4 b = divT(a.d, 1);
  return vec3(float(b.x) / 10. - 1000., float(b.y) / 10. + 3000., float(b.z) / 65535.);
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
export default {
  id: 'division', title: 'Деление', glsl: GLSL,
  uniforms: {
    uDivision: { value: 0 }, uDivChunks: { value: 0 }, uDivHover: { value: -1 }, uDivSel: { value: -1 }, uDivOn: { value: 0 },
    uDivSize: { value: new Vector3(30, 100, 340) },
    ...Object.fromEntries(Object.entries(emptyTextures()).map(([k, t]) => [k, { value: t }])),
  },
  params: [
    { key: 'division', label: 'Деление', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Районы'], [2, 'Провинции'], [3, 'Регионы']], value: 0, uniform: 'uDivision' },
    { key: 'divSize', label: 'Деление: размер района', group: 'modes', type: 'select', options: [[30, 'около 30 км'], [50, 'около 50 км'], [100, 'около 100 км']], value: 30 },
    { key: 'divChunks', label: 'Деление: точно по чанкам', group: 'modes', type: 'toggle', value: 0, uniform: 'uDivChunks' },
    { key: 'divPick', label: 'Район под курсором', group: 'modes', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'mode-districts', group: 'Режимы карты', title: 'Деление: районы около 30 км', note: 'Каждый район — целые чанки. Границы идут по рекам, хребтам и берегу, между чанками — плавно. Море у берега поделено на куски напротив прибрежных районов, открытое море — на ровные куски. Наведите курсор, щёлкните по району.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1 }, cam: { lat: 41.4, lon: -1.0, h: 330, tilt: 10, heading: 0 } },
    { id: 'mode-provinces', group: 'Режимы карты', title: 'Деление: провинции около 100 км', note: 'Провинция — соседние районы вместе, около десятка. Тонкие линии — районы внутри провинций.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 2 }, cam: { lat: 40.6, lon: -3.0, h: 700, tilt: 10, heading: 0 } },
    { id: 'mode-regions', group: 'Режимы карты', title: 'Деление: регионы 300–400 км', note: 'Самый крупный уровень: провинции вместе. На полуостров выходит пять-шесть регионов, море делится так же.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 3 }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'division-chunks', group: 'Режимы карты', title: 'Деление: районы из целых чанков', note: 'Сетка чанков и районы точно по чанкам: каждый чанк целиком в одном районе. Выключите «Деление: точно по чанкам» — та же граница станет плавной и пойдёт по руслу Эбро.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1, divChunks: 1, grid: 1 }, cam: { lat: 41.55, lon: -0.95, h: 160, tilt: 0, heading: 0 } },
    { id: 'division-river', group: 'Режимы карты', title: 'Деление: граница по реке', note: 'Эбро у Сарагосы: районы по обе стороны, линия идёт по руслу. Вдали от рек граница плавно огибает чанки.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1, grid: 1 }, cam: { lat: 41.55, lon: -0.95, h: 160, tilt: 0, heading: 0 } },
    { id: 'division-info', group: 'Режимы карты', title: 'Деление: сведения о районе', note: 'Щелчок по району открывает сведения: площадь, чанки, доля леса, болот, застройки и полей, суммы ресурсов по чанкам. Здесь выбран район Сарагосы.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1 }, divAt: ZARAGOZA, cam: { lat: 41.6, lon: -0.9, h: 260, tilt: 20, heading: 0 } },
    { id: 'division-sea', group: 'Режимы карты', title: 'Деление: море и острова', note: 'Прибрежное море поделено на куски напротив прибрежных районов, чтобы высадиться можно было везде; дальше от берега — ровные куски открытого моря. Балеарские острова — свои районы.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1 }, cam: { lat: 39.6, lon: 1.4, h: 620, tilt: 10, heading: 0 } },
    { id: 'division-50', group: 'Режимы карты', title: 'Деление: районы около 50 км', note: 'Тот же способ с районом крупнее. Провинции и регионы растут вместе с ним.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1, divSize: 50 }, cam: { lat: 41.4, lon: -1.0, h: 500, tilt: 10, heading: 0 } },
    { id: 'division-100', group: 'Режимы карты', title: 'Деление: районы около 100 км', note: 'Самый крупный из вариантов размера района.', p: { look: 'paper', forest3d: 0, roadsOn: 0, division: 1, divSize: 100 }, cam: { lat: 40.4, lon: -3.0, h: 1100, tilt: 0, heading: 0 } },
    { id: 'division-natural', group: 'Режимы карты', title: 'Деление поверх натуральной карты', note: 'Районы и провинции на обычной карте с лесом и рельефом.', p: { look: 'natural', division: 2 }, cam: { lat: 42.4, lon: -1.2, h: 260, tilt: 40, heading: 0 } },
  ],
  async init(album) { return startDivision(album, this.uniforms); },
};
