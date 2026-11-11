// ASPECT «Поселения»: what people do to the ground of a chunk — the ground under their houses, the fields around —
// and the houses themselves (layers/towns.js, town/*.js). These files belong to the settlement work; the contract with
// the rest of the album is in docs/ALBUM-CHUNKS.md, the notes of this part in docs/album/settle.md.
//   aspSettle(p, L) → paints the settlement and the fields over the ground colour L.col and clears the forest there
//
// Everything is at its real size. The state comes from the chunks: p.cC = (built, fields, building manner, burnt).
// A built chunk has a patch of settlement (town/rules.js, town/state.js). Near the camera blocks stand on the patch
// (layers/towns.js) and this shader paints only the ground under them: streets, yards, gardens, the shade of the
// houses, the lanes that run out between the fields. From afar there are no blocks: the same cells are painted as
// roofs, then melt into one tone, and at last the settlement is a mark of a pixel or two.
import { RULES_GLSL, PALETTE_GLSL } from '../town/rules.js';
import { settleUniforms } from '../town/state.js';

const GLSL = /* glsl */`
uniform sampler2D tSettle; uniform vec4 uSettle;   // cell of the lattice km · blocks standing 0..1 · height of houses × · settlements shown 0 / 1
${RULES_GLSL}
${PALETTE_GLSL}
// The roof over point q of the bent lattice of a patch: how much of the pixel it covers. cls = class of the cell,
// fl = the place inside the footprint (−1..1), ang = turn of the building against the lattice, edge = distance out of it.
float setRoof(vec2 q, vec2 site, float r, float cs, float sn, float cul, int k, float S, float aa, out float cls, out vec2 fl, out float ang, out vec4 rnd, out float edge) {
  ivec2 id = ivec2(floor(q + .5)); vec2 hs, off;
  cls = setCell(id, site, r, cs, sn, cul, k, S, hs, off, ang, rnd);
  fl = vec2(0.); edge = 1.;
  if (cls < .5) return 0.;
  vec2 f = q - vec2(id) - off;
  if (ang != 0.) { float c = cos(ang), s = sin(ang); f = vec2(c * f.x + s * f.y, -s * f.x + c * f.y); }
  fl = f / hs;
  vec2 d = abs(f) - hs; edge = max(d.x, d.y);
  return clamp(.5 - edge / (2. * aa), 0., 1.);
}
// the colour of a roof seen from above: a block is many houses, every slope takes the sun its own way
vec3 setRoofCol(float cls, vec2 fl, float turn, vec4 rnd, float atl, float day, out float court) {
  vec2 n2; court = 0.;
  float mx = max(abs(fl.x), abs(fl.y));
  if (cls < 1.5) { vec2 o = abs(fl.x) > abs(fl.y) ? vec2(sign(fl.x), 0.) : vec2(0., sign(fl.y)); n2 = o * (mx > .72 ? 1. : -1.); court = 1. - smoothstep(.40, .47, mx); }
  else if (cls < 2.5) n2 = vec2(0., sin(fl.y * 6.2832) > 0. ? 1. : -1.);
  else n2 = vec2(0., sign(fl.y));
  float c = cos(turn), s = sin(turn);
  float lit = dot(normalize(vec3(vec2(c * n2.x - s * n2.y, s * n2.x + c * n2.y) * .5, 1.)), uSun) - uSun.z;
  float house = hash21(floor(fl * vec2(3., 2.)) + 7. + rnd.z * 57.);
  return settleMat(0, atl, fract(rnd.z * 5.3 + house * .45)) * (.93 + .14 * house) * (1. + 1.2 * lit * day);
}
// ---- fields: strips of ploughland, fallow, pasture, groves; terraces on slopes; balks and paths between them
// smooth noise from the integer hash: fine patterns far from the origin, where the float hash of COMMON runs out of bits
float setNoise(vec2 p) {
  vec2 i = floor(p), u = p - i; u = u * u * (3. - 2. * u); ivec2 c = ivec2(i);
  return mix(mix(setHash(c, 7, 31), setHash(c + ivec2(1, 0), 7, 31), u.x), mix(setHash(c + ivec2(0, 1), 7, 31), setHash(c + ivec2(1, 1), 7, 31), u.x), u.y);
}
// The furlong (a piece of ploughland) a point lies in. Furlongs lie like bricks, longer than wide, every row shifted
// against the next; bend makes their edges not quite straight. Returns its id; f = the place inside it (0..1),
// border = km to its edge.
vec2 setFurlong(vec2 pk, float fs, float bend, out vec2 f, out float border) {
  vec2 q = vec2(.866 * pk.x + .5 * pk.y, -.5 * pk.x + .866 * pk.y) / fs + bend;     // the rows are turned against the compass
  float row = floor(q.y);
  q.x = q.x * .62 + setHash(ivec2(7, int(row)), 3, 11);
  float col = floor(q.x);
  f = q - vec2(col, row);
  border = min(min(f.x, 1. - f.x) * 1.6, min(f.y, 1. - f.y)) * fs;
  return vec2(col, row);
}
// the colour of a field close by. Every colour is a tint of the ground the field was ploughed from, so the land keeps
// its own grain and tone.
vec3 setFields(Px p, vec3 ground, float atl, vec2 cid, vec2 f, float border, float fs) {
  float px = p.px; ivec2 ic = ivec2(cid);
  float h1 = setHash(ic, 3, 13), h2 = fract(h1 * 61.), h3 = fract(h1 * 331.);
  float kind = atl > .5 ? (h1 < .3 ? 0. : h1 < .88 ? 2. : 1.) : (h1 < .62 ? 0. : h1 < .74 ? 1. : h1 < .87 ? 2. : 3.);
  vec3 c;
  if (kind < .5) {                                                   // ploughland in strips along the furlong, each with its own crop
    float n = floor(4. + 4. * h3), sc = h2 > .78 ? f.x * n * 1.6 : f.y * n, si = floor(sc), sf = sc - si, thin = n * px / fs;
    float cr = setHash(ic, int(si) + 64, 16);
    c = cr < .34 ? vec3(.71, .64, .42) : cr < .56 ? mix(vec3(.45, .53, .26), vec3(.66, .58, .36), uSeason) : cr < .72 ? vec3(.61, .55, .41) : cr < .86 ? vec3(.50, .40, .31) : vec3(.40, .47, .26);
    c *= 1. - .22 * clamp(1. - min(sf, 1. - sf) / (.07 + thin), 0., 1.);       // the balk between two strips
    c = mix(vec3(.61, .57, .37), c, clamp(2.2 - 4. * thin, 0., 1.));           // strips thinner than two pixels melt together
  } else if (kind < 1.5) c = vec3(.61, .55, .42) * (.9 + .2 * setNoise(p.pk / .04));                       // fallow
  else if (kind < 2.5) {                                             // common pasture with bushes
    c = (atl > .5 ? vec3(.50, .60, .30) : vec3(.50, .53, .30)) * (.92 + .16 * setNoise(p.pk / .06));
    vec2 bq = p.pk / .022;
    if (px < .012) c = mix(c, vec3(.25, .33, .16), step(.8, setHash(ivec2(floor(bq)), 5, 21)) * smoothstep(.42, .25, length(fract(bq) - .5)) * clamp((.012 - px) * 250., 0., 1.) * .8);
  } else {                                                           // a grove: trees in rows on pale earth
    float tv = clamp((.014 - px) * 200., 0., 1.);
    c = mix(vec3(.68, .61, .46), vec3(.31, .38, .21), smoothstep(.38, .26, length(fract(p.pk / .028 + h2) - .5)) * tv + .32 * (1. - tv));
  }
  c = mix(ground, c, atl > .5 ? .58 : .62);
  // the edge of a furlong: a balk or a trodden path, or a hedge in the wet lands
  vec3 bc = atl > .5 ? vec3(.26, .32, .18) : h3 > .62 ? vec3(.72, .66, .54) : vec3(.42, .43, .27);
  c = mix(c, bc, clamp(1.7 - border / max(.003, px * .6), 0., 1.) * (atl > .5 ? .3 + .45 * h2 : .5));
  if (p.slope > .09) {                                               // terraces on a slope: walls along the contours
    float tc = p.hl / 14., tf = fract(tc), tw = .014 / max(p.slope, .05), ter = smoothstep(.09, .17, p.slope) * (1. - .5 * atl);
    vec3 tcol = mix(fract(floor(tc) * .618) > .5 ? vec3(.45, .50, .28) : vec3(.58, .57, .34), vec3(.47, .43, .36), 1. - smoothstep(0., .22, tf));
    c = mix(c, mix(ground, mix(vec3(.54, .54, .33), tcol, smoothstep(.5, .22, px / tw)), .65), ter);
  }
  return c;
}

// one of the squares of the grid around a point: if it holds a patch that lies deeper over the point than the best so far, it wins
void setTry(ivec2 c, vec2 pk, inout float own, inout float riv, inout vec4 best, inout ivec2 bc) {
  if (c.x < 0 || c.y < 0 || c.x >= SET_GN || c.y >= SET_GN) return;
  vec4 t = texelFetch(tSettle, c, 0);
  if (t.b <= 0.) return;
  float d = t.b * t.b * SET_RMAX - distance(pk, SET_G0 + (vec2(c) + (t.rg * 255. + .5) / 256.) * SET_GK);
  if (d > own) { riv = own; own = d; best = t; bc = c; } else if (d > riv) riv = d;
}
void aspSettle(Px p, inout Land L) {
  float fieldsV = p.cC.g;
  ivec2 c0 = ivec2(floor((p.pk - SET_G0) / SET_GK));
  int code = uSettle.w > .5 && c0.x >= 0 && c0.y >= 0 && c0.x < SET_GN && c0.y < SET_GN ? int(texelFetch(tSettle, c0, 0).a * 255. + .5) : 0;
  if ((code == 0 && fieldsV < .004) || p.h < .4) return;
  // ---- the patch of settlement that reaches this point: the deepest of the patches of the 3 × 3 squares around.
  // The code of the square says which of the nine hold a patch: most often it is one or two, and only those are read.
  float own = -1e3, riv = -1e3, r = 0., th = 0., cul = 1.; vec2 site = vec2(0.); int ck = 0;
  vec4 best = vec4(0.); ivec2 bc = c0;
  if (code == 100 || code >= 210) { for (int n = 0; n < 9; n++) setTry(c0 + ivec2(n % 3 - 1, n / 3 - 1), p.pk, own, riv, best, bc); }
  else if (code > 0) {
    int c1 = code <= 9 ? code - 1 : code < 100 ? (code - 10) / 9 : 4, c2 = code <= 9 || code >= 200 ? -1 : code < 100 ? (code - 10) % 9 : (code - 110) / 2;
    setTry(c0 + ivec2(c1 % 3 - 1, c1 / 3 - 1), p.pk, own, riv, best, bc);
    if (c2 >= 0) setTry(c0 + ivec2(c2 % 3 - 1, c2 / 3 - 1), p.pk, own, riv, best, bc);
  }
  if (best.b > 0.) {
    vec2 b = floor(best.rg * 255. + .5); float ca = floor(best.a * 255. + .5);
    r = best.b * best.b * SET_RMAX; site = SET_G0 + (vec2(bc) + (b + .5) / 256.) * SET_GK;
    th = mod(b.x * 37. + b.y * 91., 256.) * (1.5707963 / 256.); cul = ca >= 200. ? mod(ca - 200., 10.) : mod(ca - 110., 2.) + 1.; ck = bc.y * SET_GN + bc.x;
  }
  float px = p.px, S = uSettle.x, W = .5 + 2.5 * r, m = r > 0. ? own : -1e3;        // W: how far the fields reach beyond the houses
  bool close = m > -W - .3;
  if (!close && fieldsV < .004) return;
  if (m > -.6) m += min(.25, .3 * r) * setWob(p.pk) * min(1., 1. + m / .6);          // the wobble of the edge fades out away from it
  // houses stand on dry, level ground only; a settlement too small for its pixels still shows as a mark
  float tm = 0., mt = m + max(0., 1.6 * px - r);
  if (mt > -.03) tm = smoothstep(-.03, .015, mt) * smoothstep(.4, 2., p.h) * (1. - smoothstep(.26, .44, p.slope)) * (1. - smoothstep(.3, .5, p.cA.a));
  float cs = 1., sn = 0.; vec2 q = vec2(0.);                                         // the point in the bent lattice of the patch
  if (close) { cs = cos(th); sn = sin(th); vec2 dl = p.pk - site; q = setBend(vec2(cs * dl.x + sn * dl.y, -sn * dl.x + cs * dl.y) / S, th); }

  // ---- fields: the land next to the houses is ploughed first, then the best of the rest of the chunk
  if (fieldsV > .004 && tm < .997 && p.slope < .6 && p.hl < 1700.) {
    float want = .04 + .68 * fieldsV + (close ? .75 * clamp(1. + m / W, 0., 1.) : 0.) - p.n2 * .6 - p.n3 * .4;
    if (want > -.25) {                                               // far below the threshold no furlong can be a field: nothing more to work out
      float atlF = step(1.5, p.cC.b * 255.), fs = atlF > .5 ? .14 : .22, near = clamp((.09 - px) * 25., 0., 1.), fm = 0., border = 1.;
      vec2 cid = vec2(0.), ff = vec2(.5);
      if (near < 1.) fm = smoothstep(-.05, .05, want);               // from afar: a soft edge
      if (near > 0.) {                                               // close by a furlong is ploughed whole or not at all: the edge of the fields is the edge of furlongs
        cid = setFurlong(p.pk, fs, (p.n3 - .5) * .5, ff, border);
        fm = mix(fm, step(setHash(ivec2(cid), 3, 14), want * 2.3 + .5), near);
      }
      // the common case, good level land, costs nothing more; only shores, swamps, slopes and heights are weighed
      if (p.h < 2. || p.cA.a > .3 || p.slope > .42 || p.hl > 1300. || tm > 0.) fm *= smoothstep(.4, 2., p.h) * (1. - smoothstep(.3, .5, p.cA.a)) * (1. - smoothstep(.42, .6, p.slope)) * (1. - smoothstep(1300., 1700., p.hl)) * (1. - tm);
      if (fm > .003) {
        vec3 fc = L.col;
        if (near > 0.) fc = setFields(p, L.col, atlF, cid, ff, border, fs);
        if (near < 1.) {                                             // from afar the fields are one calm tone
          vec3 tone = mix(L.col, atlF > .5 ? vec3(.48, .57, .29) : mix(vec3(.70, .64, .38), vec3(.56, .59, .31), smoothstep(.42, .7, p.wet)), .68);
          fc = mix(tone, fc, near);
        }
        L.col = mix(L.col, fc, fm); L.cover *= 1. - fm;
      }
    }
  }
  // ---- lanes: the two streets that cross by the middle of the settlement run on between the fields, toward the road
  if (close && px < .04 && tm < .99) {
    float lane = min(abs(q.x - .5), abs(q.y - .5)) * S, la = clamp(1.5 - lane / max(.003, px * .6), 0., 1.) * clamp(1.15 + m / W, 0., 1.) * (1. - tm) * (1. - smoothstep(.3, .5, p.slope));
    if (la > 0.) { L.col = mix(L.col, vec3(.75, .69, .57), la * .75 * clamp((.04 - px) * 80., 0., 1.)); L.cover *= 1. - la; }
  }
  if (tm < .003) return;

  // ---- the settlement itself
  float atl = cul > 1.5 ? 1. : 0.;
  vec3 earth = mix(mix(vec3(.68, .61, .48), vec3(.48, .45, .34), atl), L.col, .25 + .3 * atl) * (.93 + .14 * p.n3), col = earth;
  float aa = clamp(px / S, .002, .5) * .9, seam = smoothstep(.3, .55, (own - riv) / S), blocks = uSettle.y, night = 1. - p.day;
  float cls, ang, edge; vec2 fl; vec4 rnd;
  float cover = setRoof(q, site, r, cs, sn, cul, ck, S, aa, cls, fl, ang, rnd, edge) * seam;
  if (cls > 2.5 && cls < 3.5) {                                            // a house stands in its plot: a garden, a yard
    vec2 g = abs(q - floor(q + .5)); float plot = (1. - smoothstep(.40, .44, max(g.x, g.y))) * seam;
    vec3 gc = mix(mix(vec3(.47, .52, .27), vec3(.58, .48, .33), step(.5, rnd.x * 1.6)) * (.93 + .1 * step(.5, fract(q.x * 9.))), vec3(.41, .47, .25), atl);
    gc = mix(gc, vec3(.45, .45, .41), atl * smoothstep(.36, .40, max(g.x, g.y)));    // the stone wall of an Atlantic yard
    col = mix(col, gc, plot * smoothstep(.5, .2, px / S));
  }
  if (cls > 3.5) col = mix(col, cls < 4.5 ? vec3(.78, .74, .66) : vec3(.77, .71, .59), cover * (cls < 4.5 ? 1. : .8));   // paved square; cleared plot of a building site
  else if (cls > .5) {
    float paint = cover * (1. - blocks), court;
    if (paint > .003) {                                                    // no block stands here: the roof is painted
      vec3 rc = setRoofCol(cls, fl, th + ang, rnd, atl, p.day, court);
      col = mix(col, mix(rc, earth * .62, court), paint);
      col += vec3(1.5, .9, .4) * night * paint * step(.45, rnd.y) * (1. - court);           // a light in the window
    }
    col = mix(col, earth * .8, cover * blocks);                            // under a standing block the ground is in its shade
  }
  if (p.day > .05 && cover < .99) {                                        // the shade of the houses toward the sun
    vec2 sl = vec2(cs * p.sd.x + sn * p.sd.y, -sn * p.sd.x + cs * p.sd.y);
    float len = .1 * uSettle.z / max(uSun.z / max(length(uSun.xy), 1e-3), .35), c2, a2, e2; vec2 f2; vec4 r2;
    float sh = setRoof(q + sl * len * .6, site, r, cs, sn, cul, ck, S, aa + .03, c2, f2, a2, r2, e2);
    if (c2 > .5 && c2 < 3.5) col *= 1. - .36 * sh * (1. - cover) * p.day * seam;
  }
  if (night > 0.) col += vec3(1.4, .9, .45) * night * blocks * (1. - cover) * (1. - smoothstep(-.02, .3, edge)) * step(cls, 3.5) * step(.5, cls) * step(.4, rnd.y) * .42;   // light spills into the street
  col = mix(col, mix(earth, settleMat(0, atl, .3), .5), smoothstep(.25, .5, px / S) * (1. - blocks));   // cells of a pixel or two melt into one tone
  L.col = mix(L.col, col, tm); L.cover *= 1. - tm;
}`;

const ZAR = { lat: 41.65, lon: -.89 }, G = 'Города и дороги';
const zar = (h, tilt = 35, heading = 30) => ({ ...ZAR, h, tilt, heading });
export default {
  id: 'settle', title: 'Поселения', glsl: GLSL, uniforms: settleUniforms,
  params: [
    { key: 'houses', label: 'Размер домов', group: 'scale', min: 0, max: 4, step: .05, value: 1, unit: '×', zero: 'только рисунок на земле' },
    { key: 'houseH', label: 'Высота домов', group: 'scale', min: .5, max: 3, step: .05, value: 1.25, unit: '×' },
    { key: 'growth', label: 'Рост городов', group: 'scale', min: 0, max: 3, step: .01, value: 1, unit: '×' },
    { key: 'towns', label: 'Поселения', group: 'layers', type: 'toggle', value: 1 },
    { key: 'showcase', label: 'Витрина построек', group: 'layers', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'town-kinds', group: G, title: 'Витрина своих построек', note: 'Восемнадцать видов построек, увеличены для показа: в игре они стоят в настоящую величину. Два верхних ряда в средиземноморской манере (черепица, побелка), два нижних в атлантической (камень, тёмные крыши). По рядам: кварталы с двором, покоем, углом, большой дом с башней, ряды домов, ряды с переулками, дома с плоскими крышами, группа домов, двор-хутор; усадьба, дом, дом-башня, храм, площадь с рынком, укрепление, мельница, причал, стройка.', p: { showcase: 1, forest3d: 0, towns: 0, roadsOn: 0, labels: 0 }, cam: { lat: 39.25, lon: -3.0, h: 20, tilt: 50, heading: 0 } },
    { id: 'grow-1', group: G, title: 'Рост: хутор', note: 'Всё в настоящую величину, один к одному. Хутор — несколько дворов на сотню метров, вокруг первые поля. «Рост городов» на 0,08; двигайте ползунок и смотрите, как поселение растёт.', p: { growth: .082, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-2', group: G, title: 'Рост: деревня', note: 'Три сотни метров в поперечнике: дома с огородами, дворы на краю, стройки следующих домов, дорожки к полям. «Рост городов» на 0,18.', p: { growth: .176, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-3', group: G, title: 'Рост: село', note: 'Появился храм, в середине первые ряды домов, за околицей мельница. «Рост городов» на 0,33.', p: { growth: .33, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-4', group: G, title: 'Рост: городок', note: 'Километр в поперечнике: площадь с рынком, вокруг неё кварталы с дворами, дальше ряды и отдельные дома. «Рост городов» на 0,59.', p: { growth: .59, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-5', group: G, title: 'Рост: город', note: 'Полный рост: меньше двух километров в поперечнике, сотни кварталов, храмы, укрепление на высоком месте, мельницы, поля вокруг.', p: { forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'town-50', group: G, title: 'Город с 50 км', note: 'Тот же город, тот же план. Кварталы стали мельче пары пикселей, поэтому вместо объектов город нарисован на земле.', p: { forest3d: 0 }, cam: zar(50, 30) },
    { id: 'town-200', group: G, title: 'Город с 200 км', note: 'Обычная игровая высота: город — небольшое пятно застройки среди полей.', p: {}, cam: zar(200, 25, 10) },
    { id: 'town-500', group: G, title: 'Город с 500 км', note: 'Высота больших держав: поселение читается как отметка в пиксель-другой, заметнее пятно полей и вырубки вокруг.', p: {}, cam: zar(500, 15, 0) },
    { id: 'town-med', group: G, title: 'Манера: средиземноморская', note: 'Плотные кварталы с дворами, черепица и побелка, узкие гнутые улицы, площадь и храм в середине, причал у воды.', p: { forest3d: 0, labels: 0 }, cam: { lat: 36.722, lon: -4.42, h: 20, tilt: 35, heading: 0 } },
    { id: 'town-atl', group: G, title: 'Манера: атлантическая', note: 'Разбросанные каменные дворы под тёмными крышами, без сетки улиц; дворы обнесены стенами, вокруг выгоны с живыми изгородями.', p: { forest3d: 0, labels: 0 }, cam: { lat: 43.25, lon: -2.93, h: 20, tilt: 35, heading: 160 } },
    { id: 'fields', group: G, title: 'Поля: наделы, пар, выгон, террасы', note: 'Наделы лежат рядами, в каждом полосы со своими посевами, между ними межи и тропы, пар и выгон; на склонах террасы вдоль горизонталей. От поселения к полям расходятся дорожки. Издалека всё сливается в спокойный тон.', p: { forest3d: 0, labels: 0 }, cam: { lat: 36.735, lon: -4.44, h: 20, tilt: 40, heading: 35 } },
    { id: 'town-build', group: G, title: 'Стройка на краю', note: 'На краю растущего поселения стоят стройки: фундаменты, леса, сложенный лес и камень. Двигайте «Рост городов»: стройки уходят дальше, на их месте встают дома.', p: { growth: .42, forest3d: 0, labels: 0 }, cam: zar(20, 45, 20) },
    { id: 'town-night', group: G, title: 'Ночь: свет в окнах', note: 'После заката в окнах слабый тёплый свет, он чуть освещает улицы.', p: { hour: 21.5, forest3d: 0, labels: 0 }, cam: zar(20, 40) },
  ],
  async init(album) { return (await import('../layers/towns.js')).default(album); },
};
