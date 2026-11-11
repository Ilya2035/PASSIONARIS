// ASPECT «Поселения»: what people do to the ground of a chunk — the ground under their houses, the fields around —
// and the houses themselves (layers/towns.js, town/*.js). These files belong to the settlement work; the contract with
// the rest of the album is in docs/ALBUM-CHUNKS.md, the notes of this part in docs/album/settle.md.
//   aspSettle(p, L) → paints the settlement and the fields over the ground colour L.col and clears the forest there
//
// The state comes from the chunks: p.cC = (built, fields, building manner, burnt). A built chunk draws one patch of
// settlement around its site (town/rules.js); the patches of neighbouring chunks join into one town. Near the camera
// blocks stand on the patch (layers/towns.js) and this shader paints only the ground under them: streets, yards,
// gardens, the shade of the houses. From afar there are no blocks, and the same cells are painted as roofs.
import { RULES_GLSL, PALETTE_GLSL } from '../town/rules.js';
import { settleUniforms } from '../town/state.js';

const GLSL = /* glsl */`
uniform sampler2D tSettle; uniform vec4 uSettle;   // cell of the lattice km · blocks standing 0..1 · height of houses × · how much larger than life (0 = hidden)
${RULES_GLSL}
${PALETTE_GLSL}
// The roof over lattice point q of a patch: how much of the pixel it covers. cls = class of the cell, fl = the place
// inside the footprint (−1..1), ang = turn of the building against the lattice, edge = distance out of the footprint.
float setRoof(vec2 q, vec2 site, float r, float rs, float th, float cul, int k, float S, float aa, out float cls, out vec2 fl, out float ang, out vec4 rnd, out float edge) {
  ivec2 id = ivec2(floor(q + .5)); vec2 hs, off;
  cls = setCell(id, site, r, rs, th, cul, k, S, hs, off, ang, rnd);
  fl = vec2(0.); edge = 1.;
  if (cls < .5) return 0.;
  vec2 f = q - vec2(id) - off;
  if (ang != 0.) { float c = cos(ang), s = sin(ang); f = vec2(c * f.x + s * f.y, -s * f.x + c * f.y); }
  fl = f / hs;
  vec2 d = abs(f) - hs; edge = max(d.x, d.y);
  return 1. - smoothstep(-aa, aa, edge);
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
// ---- fields: strips of ploughland, fallow, pasture, groves; terraces on slopes; paths and balks between them
// smooth noise from the integer hash: fine patterns far from the origin, where the float hash of COMMON runs out of bits
float setNoise(vec2 p) {
  vec2 i = floor(p), u = p - i; u = u * u * (3. - 2. * u); ivec2 c = ivec2(i);
  return mix(mix(setHash(c, 7, 31), setHash(c + ivec2(1, 0), 7, 31), u.x), mix(setHash(c + ivec2(0, 1), 7, 31), setHash(c + ivec2(1, 1), 7, 31), u.x), u.y);
}
// the furlong (an irregular piece of ploughland) a point lies in: its id; border = km to its edge, roughly; mid = its middle
vec2 setFurlong(vec2 pk, float fs, out float border, out vec2 mid) {
  vec2 fp = pk / fs, fi = floor(fp), ff = fp - fi, cid = fi, best = vec2(0.); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); ivec2 ci = ivec2(fi + g);
    vec2 rr = g + .22 + .56 * vec2(setHash(ci, 3, 11), setHash(ci, 3, 12)) - ff; float dd = dot(rr, rr);
    if (dd < d1) { d2 = d1; d1 = dd; cid = fi + g; best = rr; } else if (dd < d2) d2 = dd;
  }
  border = (sqrt(d2) - sqrt(d1)) * fs * .5; mid = pk + best * fs;
  return cid;
}
vec3 setFields(Px p, vec3 ground, float atl, vec2 cid, float border, float near) {
  float px = p.px; vec2 pk = p.pk;
  // every colour of a field is a tint of the ground it was ploughed from: the land keeps its own grain and tone
  vec3 tone = mix(ground, mix(mix(vec3(.70, .64, .38), vec3(.56, .59, .31), smoothstep(.42, .7, p.wet)), vec3(.45, .53, .27), atl), .68);
  if (near <= 0.) return tone;                                      // from afar the fields are one calm tone
  ivec2 ic = ivec2(cid);
  float h1 = setHash(ic, 3, 13), h2 = setHash(ic, 3, 14), h3 = setHash(ic, 3, 15);
  float kind = atl > .5 ? (h1 < .3 ? 0. : h1 < .88 ? 2. : 1.) : (h1 < .62 ? 0. : h1 < .74 ? 1. : h1 < .87 ? 2. : 3.);
  vec3 c;
  if (kind < .5) {                                                   // ploughland in strips, each with its own crop
    float a = h2 * 3.14159, sw = mix(.055, .1, h3);
    float sc = dot(pk, vec2(cos(a), sin(a))) / sw, si = floor(sc), sf = sc - si, cr = setHash(ic, int(si) + 200000, 16);
    vec3 green = mix(vec3(.45, .53, .26), vec3(.66, .58, .36), uSeason);
    c = cr < .34 ? vec3(.71, .64, .42) : cr < .56 ? green : cr < .72 ? vec3(.61, .55, .41) : cr < .86 ? vec3(.50, .40, .31) : vec3(.40, .47, .26);
    float vis = smoothstep(.55, .22, px / sw);                       // strips thinner than two pixels melt together
    c = mix(vec3(.61, .57, .37), c, vis);
    c = mix(c, vec3(.44, .46, .28), (1. - smoothstep(0., .07 + px / sw, min(sf, 1. - sf))) * .4 * vis);    // the balk between two strips
  } else if (kind < 1.5) c = vec3(.61, .55, .42) * (.9 + .2 * setNoise(pk / .12));                      // fallow
  else if (kind < 2.5) {                                             // common pasture with bushes
    c = mix(vec3(.50, .53, .30), vec3(.42, .50, .27), atl) * (.92 + .16 * setNoise(pk / .2));
    vec2 bq = pk / .04;
    c = mix(c, vec3(.25, .33, .16), step(.78, setHash(ivec2(floor(bq)), 5, 21)) * smoothstep(.42, .25, length(fract(bq) - .5)) * smoothstep(.05, .02, px) * .8);
  } else {                                                           // a grove: trees in rows on pale earth
    float tv = smoothstep(.04, .015, px);
    c = mix(vec3(.68, .61, .46), vec3(.31, .38, .21), smoothstep(.36, .26, length(fract(pk / .055 + h2) - .5)) * tv + .28 * (1. - tv));
  }
  c = mix(ground, c, mix(.62, .42, atl));
  float bw = max(.005, px * .7);                                     // the edge of a furlong: a balk, or a hedge in the wet lands
  vec3 bc = mix(mix(vec3(.42, .43, .27), vec3(.72, .66, .54), step(.62, h3)), vec3(.26, .32, .18), atl);     // a green balk or a trodden path; a hedge
  c = mix(c, bc, (1. - smoothstep(bw * .5, bw * 1.2, border)) * mix(.5, .3 + .45 * h2, atl) * smoothstep(.3, .1, px));
  float ter = smoothstep(.09, .17, p.slope) * (1. - .5 * atl);       // terraces on a slope: walls along the contours
  if (ter > .003) {
    float tc = p.hl / 14., tf = fract(tc), tw = .014 / max(p.slope, .05);
    vec3 tcol = mix(vec3(.58, .57, .34), vec3(.45, .50, .28), step(.5, fract(floor(tc) * .618)));
    tcol = mix(tcol, vec3(.47, .43, .36), 1. - smoothstep(0., .22, tf));
    c = mix(c, mix(ground, mix(vec3(.54, .54, .33), tcol, smoothstep(.5, .22, px / tw)), .65), ter);
  }
  return mix(tone, c, near);
}

void aspSettle(Px p, inout Land L) {
  float fieldsV = p.cC.g;
  ivec2 c0 = ivec2(floor((p.pk - uChunkRect.xy) * .1));
  float nearA = uSettle.w > .5 && c0.x >= 0 && c0.y >= 0 && c0.x < SET_CN && c0.y < SET_CN ? texelFetch(tSettle, c0, 0).a : 0.;
  if (nearA == 0. && fieldsV < .004) return;
  float S = uSettle.x, px = p.px, dry = smoothstep(.4, 2., p.h), bog = smoothstep(.3, .5, p.cA.a);
  // ---- the patch of settlement that reaches this point: the deepest of the patches of the 3 × 3 chunks around
  float own = -1e3, riv = -1e3, r = 0., rs = 0., th = 0., cul = 1.; vec2 site = vec2(0.); int ck = 0;
  if (nearA > 0.) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = c0 + ivec2(i, j);
    if (c.x < 0 || c.y < 0 || c.x >= SET_CN || c.y >= SET_CN) continue;
    vec4 t = texelFetch(tSettle, c, 0);
    if (t.b <= 0.) continue;
    vec2 b = floor(t.rg * 255. + .5), s = uChunkRect.xy + (vec2(c) + (b + .5) / 256.) * 10.;
    float rr = min(t.b * SET_RMAX * uSettle.w, SET_RVIS), d = rr - distance(p.pk, s);   // drawn larger than life from high up
    if (d > own) { riv = own; own = d; r = rr; rs = t.b * SET_RMAX; site = s; th = mod(b.x * 37. + b.y * 91., 256.) * (1.5707963 / 256.); cul = floor(t.a * 255. + .5) - 200.; ck = c.y * SET_CN + c.x; }
    else if (d > riv) riv = d;
  }
  float atl = cul > 1.5 ? 1. : 0.;
  float m = r > 0. ? own + min(.9, .3 * r) * setWob(p.pk) : -1e3;
  // houses stand on dry, level ground only; a settlement too small for its pixels still shows as a mark
  float tm = smoothstep(-.12, .06, m + max(0., 1.6 * px - r)) * dry * (1. - smoothstep(.26, .44, p.slope)) * (1. - bog);

  // ---- fields: the land next to the houses is ploughed first, then the best of the rest of the chunk
  float able = dry * (1. - bog) * (1. - smoothstep(.42, .6, p.slope)) * (1. - smoothstep(1300., 1700., p.hl)) * (1. - tm);   // land that can be ploughed
  if (fieldsV > .004 && able > .003) {
    float W = 1.2 + 1.6 * r, nz = p.n2 * .45 + vnoise(p.pk / 2.7 + 61.) * .35 + setNoise(p.pk / .8) * .2;
    float want = .12 + .6 * fieldsV + (r > 0. ? .75 * clamp(1. + m / W, 0., 1.) : 0.) - nz;
    if (want > -.3) {                                                // far below the threshold no furlong here can be a field: nothing more to work out
      float atlF = step(1.5, p.cC.b * 255.), fm = smoothstep(-.05, .05, want);
      float near = smoothstep(.5, .16, px), border = 1.; vec2 cid = vec2(0.), mid = p.pk;
      if (near > 0.) {                                               // close by a furlong is ploughed whole or not at all: the edge of the fields is the edge of furlongs
        cid = setFurlong(p.pk, atlF > .5 ? .4 : .78, border, mid);
        float ringC = r > 0. ? clamp(1. + (r - distance(mid, site) + min(.9, .3 * r) * setWob(mid)) / W, 0., 1.) : 0.;
        float nzC = fbm(mid / 7.3 + 5.) * .45 + vnoise(mid / 2.7 + 61.) * .35 + setNoise(mid / .8) * .2;
        fm = mix(fm, step(nzC, .12 + .6 * fieldsV + .75 * ringC), near);
      }
      fm *= able;
      if (fm > .003) { L.col = mix(L.col, setFields(p, L.col, atlF, cid, border, near), fm); L.cover *= 1. - fm; }
    }
  }
  if (tm < .003) return;

  // ---- the settlement itself
  float coarse = clamp((uSettle.x - .7) / .6, 0., 1.);
  vec3 earth = mix(mix(vec3(.68, .61, .48), vec3(.48, .45, .34), atl), L.col, .25 + .3 * atl) * (.93 + .14 * p.n3);
  earth = mix(earth, settleMat(0, atl, .4), .3 * coarse * (1. - uSettle.y));         // from afar the streets are too thin to show their dust
  vec3 col = earth;
  float cs = cos(th), sn = sin(th); vec2 dl = p.pk - site;
  vec2 q = vec2(cs * dl.x + sn * dl.y, -sn * dl.x + cs * dl.y) / S;        // the point in the lattice of the patch
  float aa = clamp(px / S, .002, .5) * .9, seam = smoothstep(.3, .55, (own - riv) / S), blocks = uSettle.y, night = 1. - p.day;
  float cls, ang, edge; vec2 fl; vec4 rnd;
  float cover = setRoof(q, site, r, rs, th, cul, ck, S, aa, cls, fl, ang, rnd, edge) * seam;
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
  if (p.day > .05) {                                                       // the shade of the houses toward the sun
    vec2 sl = vec2(cs * p.sd.x + sn * p.sd.y, -sn * p.sd.x + cs * p.sd.y);
    float len = .1 * uSettle.z / max(uSun.z / max(length(uSun.xy), 1e-3), .35), c2, a2, e2; vec2 f2; vec4 r2;
    float sh = setRoof(q + sl * len * .6, site, r, rs, th, cul, ck, S, aa + .03, c2, f2, a2, r2, e2);
    if (c2 > .5 && c2 < 3.5) col *= 1. - .36 * sh * (1. - cover) * p.day * seam;
  }
  col += vec3(1.4, .9, .45) * night * blocks * (1. - cover) * (1. - smoothstep(-.02, .3, edge)) * step(cls, 3.5) * step(.5, cls) * step(.4, rnd.y) * .42;   // light spills into the street
  col = mix(col, mix(earth, settleMat(0, atl, .3), .5), smoothstep(.25, .5, px / S) * (1. - blocks));   // cells of a pixel or two melt into one tone
  L.col = mix(L.col, col, tm); L.cover *= 1. - tm;
}`;

const ZAR = { lat: 41.65, lon: -.89 }, G = 'Города и дороги';
const zar = (h, tilt = 42, heading = 30) => ({ ...ZAR, h, tilt, heading });
export default {
  id: 'settle', title: 'Поселения', glsl: GLSL, uniforms: settleUniforms,
  params: [
    { key: 'houses', label: 'Размер домов', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'houseH', label: 'Высота домов', group: 'scale', min: .5, max: 3, step: .05, value: 1.25, unit: '×' },
    { key: 'growth', label: 'Рост городов', group: 'scale', min: 0, max: 3, step: .01, value: 1, unit: '×' },
    { key: 'towns', label: 'Поселения', group: 'layers', type: 'toggle', value: 1 },
    { key: 'showcase', label: 'Витрина построек', group: 'layers', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'town-kinds', group: G, title: 'Витрина своих построек', note: 'Двенадцать видов построек, сверху в средиземноморской манере (черепица, побелка), снизу в атлантической (камень, тёмные крыши). По рядам слева направо: квартал с двором, ряды домов, дома с плоскими крышами, группа домов, двор-хутор, дом; храм, площадь с рынком, укрепление, мельница, причал, стройка. Облетайте и вращайте.', p: { showcase: 1, forest3d: 0, towns: 0, roadsOn: 0, labels: 0 }, cam: { lat: 39.25, lon: -3.0, h: 20, tilt: 50, heading: 0 } },
    { id: 'grow-1', group: G, title: 'Рост: хутор', note: 'Начало поселения: несколько дворов, огороды и первые поля. «Рост городов» на 0,08; двигайте ползунок и смотрите, как поселение растёт.', p: { growth: .08, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-2', group: G, title: 'Рост: деревня', note: 'Дома с огородами вдоль тропы, дворы на краю, рядом стройки следующих домов. «Рост городов» на 0,16.', p: { growth: .16, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-3', group: G, title: 'Рост: село', note: 'Появился храм, в середине первые ряды домов, за околицей мельница. «Рост городов» на 0,3.', p: { growth: .3, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-4', group: G, title: 'Рост: городок', note: 'Площадь с рынком, вокруг неё кварталы с дворами, дальше ряды и отдельные дома. «Рост городов» на 0,55.', p: { growth: .55, forest3d: 0, labels: 0 }, cam: zar(22) },
    { id: 'grow-5', group: G, title: 'Рост: город', note: 'Полный рост: сотни кварталов, храмы, укрепление на высоком месте, мельницы, поля до горизонта.', p: { forest3d: 0 }, cam: zar(24, 50) },
    { id: 'town-50', group: G, title: 'Город с 50 км', note: 'Кварталы стали крупнее, улицы ещё видны.', p: { forest3d: 0 }, cam: zar(50, 45) },
    { id: 'town-200', group: G, title: 'Город с 200 км', note: 'Обычная игровая высота: построек-объектов уже нет, город нарисован на земле пятном застройки с рисунком кварталов.', p: {}, cam: zar(200, 35, 10) },
    { id: 'town-500', group: G, title: 'Город с 500 км', note: 'Высота больших держав: поселения читаются как отметки, поля вокруг сливаются в спокойный тон.', p: {}, cam: zar(500, 20, 0) },
    { id: 'town-med', group: G, title: 'Манера: средиземноморская', note: 'Плотные кварталы с дворами, черепица и побелка, узкие улицы по сетке, площадь и храм в середине, причалы у воды.', p: { forest3d: 0 }, cam: { lat: 36.725, lon: -4.42, h: 22, tilt: 52, heading: 0 } },
    { id: 'town-atl', group: G, title: 'Манера: атлантическая', note: 'Разбросанные каменные дворы под тёмными крышами, без сетки улиц; дворы обнесены стенами, вокруг выгоны с живыми изгородями.', p: { forest3d: 0 }, cam: { lat: 43.26, lon: -2.93, h: 22, tilt: 52, heading: 160 } },
    { id: 'fields', group: G, title: 'Поля: наделы, пар, выгон, террасы', note: 'Полосы наделов со своими посевами, межи и тропы между ними, пар и выгон; на склонах террасы вдоль горизонталей. Издалека всё сливается в спокойный тон.', p: { forest3d: 0, labels: 0 }, cam: { lat: 36.75, lon: -4.468, h: 20, tilt: 48, heading: 35 } },
    { id: 'town-build', group: G, title: 'Стройка на краю', note: 'На краю растущего поселения стоят стройки: фундаменты, леса, сложенный лес и камень. Двигайте «Рост городов»: стройки уходят дальше, на их месте встают дома.', p: { growth: .42, houses: 1.5, forest3d: 0, labels: 0 }, cam: { lat: 41.662, lon: -.878, h: 20, tilt: 50, heading: 20 } },
    { id: 'town-night', group: G, title: 'Ночь: свет в окнах', note: 'После заката в окнах слабый тёплый свет, он чуть освещает улицы.', p: { hour: 21.5, forest3d: 0 }, cam: zar(22, 50) },
  ],
  async init(album) { return (await import('../layers/towns.js')).default(album); },
};
