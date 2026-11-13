// ASPECT «Поселения»: what people do to the ground of a chunk — the ground under their houses, the fields around —
// and the houses themselves (layers/towns.js, town/*.js). These files belong to the settlement work; the contract with
// the rest of the album is in docs/ALBUM-CHUNKS.md, the notes of this part in docs/album/settle.md.
//   aspSettle(p, L) → paints the settlement and the fields over the ground colour L.col and clears the forest there
//
// Everything is at its real size. The state comes from the chunks: p.cC = (built, fields, building manner, burnt).
// A built chunk has a patch of settlement (town/rules.js, town/state.js). Near the camera blocks stand on the patch
// (layers/towns.js) and this shader paints only the ground under them: streets, yards, gardens, the lanes that run
// out between the fields. Houses throw no shade on the ground: shade comes from the relief alone. From afar there are no blocks: the same cells are painted as
// roofs, then melt into one tone, and at last the settlement is a mark of a pixel or two.
// There are two sorts of patches (town/state.js): the towns — the places of the album and the centres of districts —
// in a grid of squares of 10 km, and the villages between them (town/villages.js) in a grid of 2.5 km. A village has
// no mark: from afar it melts into the land.
// The fields are the state of the chunks of 1 km² (town/farmland.js): a chunk keeps how much of it is ploughed, and
// the fields are drawn from that number alone, the same furlongs running on from chunk to chunk. Where only a few
// chunks of the land around are ploughed, the fields are drawn only where their furlongs can be told.
import { RULES_GLSL, PALETTE_GLSL } from '../town/rules.js';
import { settleUniforms } from '../town/state.js';

const GLSL = /* glsl */`
uniform sampler2D tSettle; uniform vec4 uSettle;   // cell of the lattice km · blocks standing 0..1 · height of houses × · settlements shown 0 / 1
${RULES_GLSL}
${PALETTE_GLSL}
// The roof over point q of the bent lattice of a patch: how much of the pixel it covers. cls = class of the cell,
// fl = the place inside the footprint (−1..1), ang = turn of the building against the lattice, edge = distance out of it.
float setRoof(vec2 q, vec2 site, vec2 sh, float r, float cs, float sn, float cul, int k, float S, float aa, out float cls, out vec2 fl, out float ang, out vec4 rnd, out float edge) {
  ivec2 id = ivec2(floor(q + .5)); vec2 hs, off;
  cls = setCell(id, site, sh, r, cs, sn, cul, k, S, hs, off, ang, rnd);
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

// One of the squares of a grid around a point: if it holds a patch that lies deeper over the point than the best so
// far, it wins. fine: the grid of villages, else the grid of towns (where each lies in the texture: town/rules.js).
// (sh: how far the middle of the winning patch lies from its site — a town grows toward the water)
void setTry(ivec2 c, bool fine, vec2 pk, inout float own, inout float riv, inout vec4 best, inout ivec3 bc, inout vec2 sh) {
  int n = fine ? SET_VN : SET_GN;
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return;
  vec4 t = texelFetch(tSettle, c + (fine ? SET_FINE : SET_COARSE), 0);
  if (t.b <= 0.) return;
  vec2 s = fine ? vec2(0.) : (floor(texelFetch(tSettle, c + SET_MORE, 0).rg * 255. + .5) - 128.) * (SET_SHIFT / 127.);
  float r = t.b * t.b * SET_RMAX, d = r - distance(pk, SET_G0 + (vec2(c) + (t.rg * 255. + .5) / 256.) * (fine ? SET_VK : SET_GK) + s);
  if (d > own) { riv = own; own = d; best = t; bc = ivec3(c, fine ? 1 : 0); sh = s; } else if (d > riv) riv = d;
}
// the squares a code names (town/state.js): all nine around, or one or two of them
void setSquares(int code, ivec2 c0, bool fine, vec2 pk, inout float own, inout float riv, inout vec4 best, inout ivec3 bc, inout vec2 sh) {
  if (code == 100 || code >= 210) { for (int n = 0; n < 9; n++) setTry(c0 + ivec2(n % 3 - 1, n / 3 - 1), fine, pk, own, riv, best, bc, sh); }
  else if (code > 0) {
    int c1 = code <= 9 ? code - 1 : code < 100 ? (code - 10) / 9 : 4, c2 = code <= 9 || code >= 200 ? -1 : code < 100 ? (code - 10) % 9 : (code - 110) / 2;
    setTry(c0 + ivec2(c1 % 3 - 1, c1 / 3 - 1), fine, pk, own, riv, best, bc, sh);
    if (c2 >= 0) setTry(c0 + ivec2(c2 % 3 - 1, c2 / 3 - 1), fine, pk, own, riv, best, bc, sh);
  }
}
// How much of the land at a point is under fields, 0..1: the state of the chunk of 1 km² the point lies in (the first
// rows of the texture, a texel a chunk: town/state.js). The chunk of a point is the one whose seed is nearest, as in
// the division (division/km.js); the step from a chunk to the next is softened, so the edge of the fields runs along
// furlongs and the chunks themselves are never seen. Twin of farmAt() in town/state.js.
float setFarm(vec2 pk) {
  vec2 t = (pk - SET_K0) / SET_KKM; ivec2 c = ivec2(floor(t));
  if (c.x < 0 || c.y < 0 || c.x >= SET_KN || c.y >= SET_KN) return 0.;
  vec4 o = texelFetch(tSettle, c, 0);
  if (o.a < .25 || o.a > .75) return o.r;                              // no fields anywhere near, or the nine chunks around hold the same: by far the commonest
  // (the side of a chunk is a straight piece half-way between two seeds; the fields do not end on a straight line,
  // so the point is moved by a few hundred metres, this way and that, before its chunk is looked for)
  vec2 f = t - vec2(c) + (vec2(vnoise(pk * .83 + 3.1), vnoise(pk * .83 + 57.9)) - .5) * SET_WARP; float sum = 0., all = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 q = texelFetch(tSettle, clamp(c + ivec2(i, j), ivec2(0), ivec2(SET_KN - 1)), 0);
    vec2 v = vec2(float(i), float(j)) + q.gb - f; float w = exp(-SET_SOFT * dot(v, v));
    sum += w * q.r; all += w;
  }
  return sum / all;
}
void aspSettle(Px p, inout Land L) {
  if (uSettle.w < .5 || p.h < .4) return;
  vec2 gp = p.pk - SET_G0;
  ivec2 c0 = ivec2(floor(gp / SET_GK)), v0 = ivec2(floor(gp / SET_VK));
  if (c0.x < 0 || c0.y < 0 || c0.x >= SET_GN || c0.y >= SET_GN) return;
  vec4 t0 = texelFetch(tSettle, c0 + SET_COARSE, 0), tv = texelFetch(tSettle, v0 + SET_FINE, 0);
  int code = int(t0.a * 255. + .5), vcode = int(tv.a * 255. + .5);
  float farm = setFarm(p.pk);
  bool tilled = farm > .004, search = code != 0 || vcode != 0;
  if (!search && !tilled) return;
  // the commonest case by far: the only patches near are the town and the village of these very squares, and the
  // pixel is nowhere near either
  if (search && (code == 0 || (code > 200 && code < 210)) && (vcode == 0 || (vcode > 200 && vcode < 210))) {
    // (on ploughed land the lanes of a patch run out 3.5 r + 0.8 km from its site; where nothing is ploughed only its
    // houses matter. From very high up the mark of a town, a couple of pixels wide, reaches farther than that)
    vec2 reach = tilled ? vec2(3.5, .85) : vec2(1.3, .45); bool away = true;
    // (the middle of a town may lie half its radius off its site)
    if (code != 0) { float r0 = t0.b * t0.b * SET_RMAX; away = distance(p.pk, SET_G0 + (vec2(c0) + (t0.rg * 255. + .5) / 256.) * SET_GK) > max((reach.x + .5) * r0 + reach.y, 2.3 * p.px + .1); }
    if (away && vcode != 0) { float r0 = tv.b * tv.b * SET_RMAX; away = distance(p.pk, SET_G0 + (vec2(v0) + (tv.rg * 255. + .5) / 256.) * SET_VK) > reach.x * r0 + reach.y; }
    if (away) { if (!tilled) return; search = false; }
  }
  // ---- the patch of settlement that reaches this point: the deepest of the patches of the 3 × 3 squares around, in
  // the grid of towns and in the grid of villages. The code of a square says which of the nine hold a patch: most
  // often it is one or two, and only those are read.
  float own = -1e3, riv = -1e3, r = 0., th = 0., cul = 1.; vec2 site = vec2(0.); int ck = 0;
  vec4 best = vec4(0.); ivec3 bc = ivec3(c0, 0); vec2 sh = vec2(0.);
  if (search) { setSquares(code, c0, false, p.pk, own, riv, best, bc, sh); setSquares(vcode, v0, true, p.pk, own, riv, best, bc, sh); }
  bool village = bc.z == 1;
  if (best.b > 0.) {
    vec2 b = floor(best.rg * 255. + .5); float ca = floor(best.a * 255. + .5);
    r = best.b * best.b * SET_RMAX; site = SET_G0 + (vec2(bc.xy) + (b + .5) / 256.) * (village ? SET_VK : SET_GK);
    th = mod(b.x * 37. + b.y * 91., 256.) * (1.5707963 / 256.); cul = ca >= 200. ? mod(ca - 200., 10.) : mod(ca - 110., 2.) + 1.;
    ck = village ? SET_GN * SET_GN + bc.y * SET_VN + bc.x : bc.y * SET_GN + bc.x;
  }
  float px = p.px, S = uSettle.x, W = .5 + 2.5 * r, m = r > 0. ? own : -1e3;        // W: how far the fields reach beyond the houses
  bool close = m > -W - .3;                                                         // near a patch: its houses, its lanes
  if (!tilled && !close) return;
  if (m > -.6) m += min(.25, .3 * r) * setWob(p.pk) * min(1., 1. + m / .6);          // the wobble of the edge fades out away from it
  // in a chunk that is ploughed in part, the land next to the houses is ploughed first
  float beside = close ? clamp(1. + m / W, 0., 1.) * min(1., farm * 5.) : 0.;
  // houses stand on dry, level ground only; a town too small for its pixels still shows as a mark, a village melts
  // into the land once it is a pixel or so across (the owner: «деревня не показывается на карте… при близком
  // приближении она слегка видна»)
  // (a village by its people — under a thousand, whichever grid it lies in: the hamlet at the centre of a district as
  // much as a village between the centres)
  bool small = village || r < SET_TOWN_R;
  float tm = 0., mt = m + (small ? 0. : max(0., 2.2 * px - r));
  if (mt > -.03) tm = smoothstep(-.03, .015, mt) * smoothstep(.4, 2., p.h) * (1. - smoothstep(.26, .44, p.slope)) * (1. - smoothstep(.3, .5, p.cA.a));
  if (small) tm *= 1. - smoothstep(.6, 1.6, px / max(r, .02));
  float cs = 1., sn = 0.; vec2 q = vec2(0.);                                         // the point in the bent lattice of the patch
  if (close) { cs = cos(th); sn = sin(th); vec2 dl = p.pk - site; q = setBend(vec2(cs * dl.x + sn * dl.y, -sn * dl.x + cs * dl.y) / S, th); }

  // ---- fields: as much of the chunk as its state says, the land next to the houses first. Where the land around is
  // ploughed only here and there (the share of the natural cell, p.cC.g), the fields are a picture only while their
  // furlongs can be told: from higher up they would be pale specks, one by every village. So they come in as the
  // camera comes down; a land that is ploughed in earnest keeps its fields at any height.
  float seen = p.cC.g >= .12 ? 1. : mix(smoothstep(.075, .045, px), 1., smoothstep(.03, .12, p.cC.g));
  if (tilled && seen > .003 && tm < .997 && p.slope < .6 && p.hl < 1700.) {
    // how much of the land here is ploughed: the share of the chunk, more beside the houses, a little more or less
    // from place to place. Fields keep together: a chunk ploughed for the most part is ploughed whole, one ploughed
    // for the lesser part has its fields in a few clumps, and the edge of the fields is a furlong or two wide
    float want = (farm + .45 * beside + (.5 - p.n2 * .6 - p.n3 * .4) * SET_UNEVEN - .5) * SET_SHARP + .5;
    if (want > 0.) {
      float atlF = step(1.5, p.cC.b * 255.), fs = atlF > .5 ? .14 : .22, near = clamp((.09 - px) * 25., 0., 1.), fm = 0., border = 1.;
      vec2 cid = vec2(0.), ff = vec2(.5);
      if (near < 1.) fm = clamp(want, 0., 1.);                       // from afar: the tone of the fields, as strong as the land is ploughed
      if (near > 0.) {                                               // close by a furlong is ploughed whole or not at all: that share of the furlongs
        cid = setFurlong(p.pk, fs, (p.n3 - .5) * .5, ff, border);
        fm = mix(fm, step(setHash(ivec2(cid), 3, 14), want), near);
      }
      // the common case, good level land, costs nothing more; only shores, swamps, slopes and heights are weighed
      if (p.h < 2. || p.cA.a > .3 || p.slope > .42 || p.hl > 1300. || tm > 0.) fm *= smoothstep(.4, 2., p.h) * (1. - smoothstep(.3, .5, p.cA.a)) * (1. - smoothstep(.42, .6, p.slope)) * (1. - smoothstep(1300., 1700., p.hl)) * (1. - tm);
      fm *= seen;
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
  // ---- lanes: the two streets that cross by the middle of the settlement run on a little way between the fields.
  // Past that the tracks to the villages lead on (town/tracks.js, layers/towns.js), and the roads.
  float laneOut = .1 + .45 * r;                                      // km past the last houses
  if (close && tilled && px < .04 && tm < .99 && m > -laneOut) {
    float lane = min(abs(q.x - .5), abs(q.y - .5)) * S, la = clamp(1.5 - lane / max(.003, px * .6), 0., 1.) * clamp(1. + m / laneOut, 0., 1.) * (1. - tm) * (1. - smoothstep(.3, .5, p.slope)) * min(1., farm * 4.);
    if (la > 0.) { L.col = mix(L.col, vec3(.75, .69, .57), la * .75 * clamp((.04 - px) * 80., 0., 1.)); L.cover *= 1. - la; }
  }
  if (tm < .003) return;

  // ---- the settlement itself
  float atl = cul > 1.5 ? 1. : 0.;
  vec3 earth = mix(mix(vec3(.68, .61, .48), vec3(.48, .45, .34), atl), L.col, .25 + .3 * atl) * (.93 + .14 * p.n3), col = earth;
  float aa = clamp(px / S, .002, .5) * .9, seam = smoothstep(.3, .55, (own - riv) / S), blocks = uSettle.y, night = 1. - p.day;
  float cls, ang, edge; vec2 fl; vec4 rnd;
  vec2 shl = vec2(cs * sh.x + sn * sh.y, -sn * sh.x + cs * sh.y);               // the shift of the middle, in the lattice
  float cover = setRoof(q, site, shl, r, cs, sn, cul, ck, S, aa, cls, fl, ang, rnd, edge) * seam;
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
  }
  // (no shade of the houses on the ground, neither under a block nor beside it — the owner, 13.11.2026: «тени только
  // от гор и рельефа, у домов теней нет»)
  if (night > 0.) col += vec3(1.4, .9, .45) * night * blocks * (1. - cover) * (1. - smoothstep(-.02, .3, edge)) * step(cls, 3.5) * step(.5, cls) * step(.4, rnd.y) * .42;   // light spills into the street
  // cells of a pixel or two melt into one tone; from high up, where a whole settlement is a few pixels, the tone is
  // that of its roofs, so the mark stands out from the land
  float far = smoothstep(.6, 2.5, px / S);
  col = mix(col, mix(earth, settleMat(0, atl, .3) * mix(.9, .68, far), mix(.5, .9, far)), smoothstep(.25, .5, px / S) * (1. - blocks));
  // ---- a town: its main streets, from its site straight out along its roads, and its wall around its middle, with a
  // gate where a street crosses it (town/plan.js keeps the blocks off both). A line thinner than a pixel is kept a
  // pixel wide while it can be told; from higher up it melts into the tone of the town.
  if (!village && r >= SET_STREETS_FROM && px < .07) {
    vec4 gt = floor(texelFetch(tSettle, bc.xy + SET_GATES, 0) * 255. + .5);
    vec2 dl = p.pk - site; float street = 1e3, told = 1. - smoothstep(.03, .07, px);
    for (int g = 0; g < 4; g++) {
      if (gt[g] < .5) continue;
      float a = (gt[g] - 1.) * (6.2831853 / 254.); vec2 u = vec2(cos(a), sin(a));
      if (dot(dl, u) > -.006) street = min(street, abs(dl.x * u.y - dl.y * u.x));
    }
    float sa = clamp(1.5 - street / max(SET_STREET_W * .5, px * .8), 0., 1.) * told;
    col = mix(col, vec3(.85, .81, .71) * (.95 + .08 * p.n3), sa * .95);                     // paved
    if (r >= SET_WALL_FROM) {
      vec2 dc = dl - sh; float dw = abs(length(dc) - setWall(r, th, atan(dc.y, dc.x)));
      col = mix(col, earth, (1. - smoothstep(SET_WALL_CLEAR, SET_WALL_CLEAR + .012, dw)) * (1. - sa) * told * .85);   // the open strip along the wall
      col = mix(col, vec3(.47, .45, .42), clamp(1.5 - dw / max(SET_WALL_W * .5, px * .65), 0., 1.) * step(SET_GATE_W * .5, street) * told);   // grey stone, as the wall that stands on it
    }
  }
  L.col = mix(L.col, col, tm); L.cover *= 1. - tm;
}`;

const ZAR = { lat: 41.65, lon: -.89 }, G = 'Города и дороги';
// the views the owner's scheme of marks is checked on: over Madrid and over the coast from Barcelona to Valencia
const MAD = { lat: 40.4168, lon: -3.7038 }, TAR = { lat: 41.118, lon: 1.245 }, COAST = { lat: 40.55, lon: .95 };
const MARK_NOTES = {
  20: 'С 20 км смотрят на сам город: ни отметок, ни названий. Дома в настоящую величину; внизу слева линейка масштаба.',
  50: 'Около 50 км стоят названия: у города района — отметка по классу и имя сбоку, у деревень отметок уже нет (они пропадают первыми, выше 45 км).',
  100: 'Со 100 км отметки — точки: города районов и всё, что крупнее. Названия остались только у городов покрупнее.',
  200: 'С 200 км: города от тысячи жителей и главные города провинций. Названий нет.',
  500: 'С 500 км: точки главных городов провинций и самых крупных городов. У главного города земли и региона — кольцо.',
  1000: 'С 1000 км на карте нет ни одной отметки: совсем далеко — ничего.',
};
const markPages = (id, where, far, title) => [20, 50, 100, 200, 500, 1000].map(h => ({ id: `${id}-${h}`, group: G, title: `Отметки по высоте: ${title} с ${h} км`, note: MARK_NOTES[h], p: {}, cam: { ...(h >= 200 ? far : where), h, tilt: 15, heading: 0 } }));
const zar = (h, tilt = 35, heading = 30) => ({ ...ZAR, h, tilt, heading });
export default {
  id: 'settle', title: 'Поселения', glsl: GLSL, uniforms: settleUniforms,
  params: [
    { key: 'houses', label: 'Размер домов', group: 'scale', min: 0, max: 4, step: .05, value: 1, unit: '×', zero: 'только рисунок на земле' },
    { key: 'houseH', label: 'Высота домов', group: 'scale', min: .5, max: 3, step: .05, value: 1.25, unit: '×' },
    { key: 'growth', label: 'Рост городов', group: 'scale', min: 0, max: 3, step: .01, value: 1, unit: '×' },
    { key: 'yards', label: 'Дворы среди полей', group: 'scale', min: 0, max: 3.2, step: .05, value: 1, unit: '×', zero: 'нет' },
    { key: 'villages', label: 'Деревни между центрами', group: 'scale', min: 0, max: 2, step: .05, value: 1, unit: '×', zero: 'нет' },
    { key: 'farmHa', label: 'Угодья на жителя', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: ' га', zero: 'нет полей' },
    { key: 'towns', label: 'Поселения', group: 'layers', type: 'toggle', value: 1 },
    { key: 'labelsFar', label: 'Названия столиц издалека', group: 'layers', type: 'toggle', value: 0, map: 'Имена столиц' },
    { key: 'scaleBar', label: 'Линейка масштаба', group: 'layers', type: 'toggle', value: 1, map: 'Линейка масштаба' },
    { key: 'sitesShow', label: 'Места поселений (проверка)', group: 'layers', type: 'toggle', value: 0 },
    { key: 'showcase', label: 'Витрина построек', group: 'layers', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'town-kinds', group: G, title: 'Витрина своих построек', note: 'Двадцать три вида построек (три — дворы среди полей, каждый со своим участком; последние два — кусок городской стены с башней и ворота), увеличены для показа: в игре они стоят в настоящую величину. Два верхних ряда в средиземноморской манере (черепица, побелка), два нижних в атлантической (камень, тёмные крыши). По рядам: кварталы с двором, покоем, углом, большой дом с башней, ряды домов, ряды с переулками, дома с плоскими крышами, группа домов, двор-хутор; усадьба, дом, дом-башня, храм, площадь с рынком, укрепление, мельница, причал, стройка.', p: { showcase: 1, forest3d: 0, towns: 0, roadsOn: 0, labels: 0 }, cam: { lat: 39.25, lon: -3.0, h: 20, tilt: 50, heading: 0 } },
    { id: 'grow-1', group: G, title: 'Рост: хутор', note: 'Всё в настоящую величину, один к одному. Хутор — несколько дворов на сотню метров, вокруг первые поля. «Рост городов» на 0,08; двигайте ползунок и смотрите, как поселение растёт.', p: { growth: .082, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-2', group: G, title: 'Рост: деревня', note: 'Три сотни метров в поперечнике: дома с огородами, дворы на краю, стройки следующих домов, дорожки к полям. «Рост городов» на 0,18.', p: { growth: .176, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-3', group: G, title: 'Рост: село', note: 'Появился храм, в середине первые ряды домов, за околицей мельница. «Рост городов» на 0,33.', p: { growth: .33, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-4', group: G, title: 'Рост: городок', note: 'Километр в поперечнике: площадь с рынком, вокруг неё кварталы с дворами, дальше ряды и отдельные дома. «Рост городов» на 0,59.', p: { growth: .59, forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'grow-5', group: G, title: 'Рост: город', note: 'Полный рост: меньше двух километров в поперечнике, сотни кварталов, храмы, укрепление на высоком месте, мельницы, поля вокруг.', p: { forest3d: 0, labels: 0 }, cam: zar(20) },
    { id: 'town-50', group: G, title: 'Город с 50 км', note: 'Тот же город, тот же план. Кварталы стали мельче пары пикселей, поэтому вместо объектов город нарисован на земле.', p: { forest3d: 0 }, cam: zar(50, 30) },
    { id: 'town-200', group: G, title: 'Город с 200 км', note: 'Обычная игровая высота: город — небольшое пятно застройки среди полей.', p: {}, cam: zar(200, 25, 10) },
    { id: 'town-500', group: G, title: 'Город с 500 км', note: 'Высота больших держав: поселение читается как отметка в пиксель-другой, заметнее пятно полей и вырубки вокруг.', p: {}, cam: zar(500, 15, 0) },
    { id: 'city-sea', group: G, title: 'Город у моря: Барселона с 20 км', note: 'Город растёт от своей точки к воде: его середина сдвинута к берегу, крайние дома стоят у моря, на берегу причалы гавани. Главные улицы идут от рыночной площади прямо по дорогам; где улица пересекает стену — ворота. Стена обходит плотную середину города, предместья лежат снаружи. На высоком месте замок. Всё в настоящую величину: внизу слева линейка масштаба.', p: { forest3d: 0 }, cam: { lat: 41.39, lon: 2.178, h: 20, tilt: 35, heading: 0 } },
    { id: 'city-inland', group: G, title: 'Город внутри страны: Сарагоса с 20 км', note: 'Город у реки: его середина сдвинута к берегу, дома доходят до воды и на реку не встают. Стена, ворота на дорогах, главные улицы к рыночной площади. Вокруг поля, деревни и тропы к ним.', p: { forest3d: 0 }, cam: zar(20) },
    { id: 'city-capital', group: G, title: 'Самый большой город: Мадрид с 20 км', note: 'Мадрид — три с небольшим километра в поперечнике, 41 тысяча жителей, 13 чанков по 1 км². Шесть дорог входят в город через ворота и сходятся на рыночной площади.', p: { forest3d: 0 }, cam: { ...MAD, h: 20, tilt: 35, heading: 0 } },
    { id: 'city-small', group: G, title: 'Малый городок с замком', note: 'Городку меньше 400 м радиусом стена не по силам: у него замок на высоком месте и главные улицы по дорогам.', p: { forest3d: 0 }, cam: { lat: 40.6328, lon: -3.1602, h: 20, tilt: 35, heading: 0 } },
    { id: 'city-village', group: G, title: 'Деревня с 20 км', note: 'Деревня — до тысячи жителей: несколько десятков дворов, без стены и замка. К дороге от неё ведёт тропа. С 20 км нет ни отметок, ни названий: видны сами дома.', p: { forest3d: 0 }, cam: { lat: 41.79, lon: -1.13, h: 20, tilt: 35, heading: 20 } },
    { id: 'city-45', group: G, title: 'Город с 45 км: стена и улицы', note: 'С этой высоты кварталы — два-три пикселя, но кольцо стены и главные улицы ещё читаются; выше они сливаются с тоном города.', p: { forest3d: 0 }, cam: { ...MAD, h: 45, tilt: 25, heading: 0 } },
    ...markPages('marks', MAD, MAD, 'Мадрид'),
    ...markPages('marks-coast', TAR, COAST, 'берег от Барселоны до Валенсии'),
    { id: 'town-marks', group: G, title: 'Отметки: класс поселения по форме', note: 'Ниже 85 км отметка — фигура, по ней виден класс: кружок — деревня (до 1 000 жителей), треугольник — малый городок (до 20 000), ромб — средний город (до 60 000), квадрат — город (до миллиона), пятиугольник — мегаполис. У главного города провинции в середине тёмная точка, у главного города земли и региона ещё и кольцо. Здесь «Рост городов» на 1,6.', p: { growth: 1.6 }, cam: { lat: 40.9, lon: -1.2, h: 70, tilt: 12, heading: 0 } },
    { id: 'town-marks-near', group: G, title: 'Отметки вблизи: имя рядом с домами', note: 'Между 25 и 45 км: дома уже различимы, отметка гаснет, а имя стоит сбоку и поселение не закрывает. Деревня отмечена точкой и малой подписью. Ниже 25 км названий нет.', p: { forest3d: 0 }, cam: zar(34, 30, 0) },
    { id: 'marks-names-far', group: G, title: 'Отметки: названия столиц издалека', note: 'Переключатель «Названия столиц издалека» (на панели карты и в слоях): главные города провинций, земель и регионов подписаны, пока видны их точки. По умолчанию выключен: названия стоят только около 50 км.', p: { labelsFar: 1 }, cam: { ...MAD, h: 500, tilt: 15, heading: 0 } },
    { id: 'town-districts', group: G, title: 'Поселение в каждом районе', note: 'В центре каждого района стоит поселение: настоящий город или село этого места, а где их нет — хутор в низине у воды. К нему сходятся дороги. Размер взят из сегодняшнего числа жителей: большинство — деревни в несколько дворов. Двигайте «Рост городов»: на малом росте стоят только большие места, деревни появляются позже.', p: {}, cam: { lat: 41.3, lon: -1.6, h: 45, tilt: 25, heading: 0 } },
    { id: 'town-districts-map', group: G, title: 'Поселения, дороги и районы', note: 'То же поверх границ районов: поселение в центре района, дороги от центра к центру.', p: { division: 1, look: 'paper', forest3d: 0 }, cam: { lat: 41.4, lon: -1.4, h: 110, tilt: 10, heading: 0 } },
    { id: 'villages', group: G, title: 'Деревни между центрами районов', note: 'В районе, кроме центра, есть места под деревни: сначала настоящие сёла этой земли, потом лучшие свободные места — ровная земля у реки или моря, внизу. Деревня — несколько дворов на сотню-другую метров, вокруг её поля и отдельные дворы. Всё в настоящую величину. Ручка «Деревни между центрами» меняет густоту, «Рост городов» поднимает деревни по очереди: лучшие места заселяются первыми.', p: { forest3d: 0 }, cam: { lat: 41.79, lon: -1.13, h: 22, tilt: 35, heading: 20 } },
    { id: 'villages-45', group: G, title: 'Деревни с 45 км', note: 'С этой высоты деревня — несколько пикселей; у настоящих сёл появляется точка и малая подпись. Выше деревни не отмечаются и сливаются с землёй: видны только их поля.', p: { forest3d: 0 }, cam: { lat: 41.79, lon: -1.13, h: 45, tilt: 30, heading: 0 } },
    { id: 'villages-grown', group: G, title: 'Деревни: рост 3', note: '«Рост городов» на 3: хутора стали деревнями, деревни — сёлами с храмом и мельницей, а земля между ними распахана сплошь. Деревня между центрами городом не становится: её радиус не больше 390 м.', p: { growth: 3, forest3d: 0, labels: 0 }, cam: { lat: 41.79, lon: -1.13, h: 22, tilt: 35, heading: 20 } },
    { id: 'villages-dense', group: G, title: 'Деревни: густо', note: '«Деревни между центрами» на 2: мест вдвое больше, до соседней деревни около трёх километров. Прежние деревни стоят на своих местах.', p: { villages: 2, forest3d: 0, labels: 0 }, cam: { lat: 41.79, lon: -1.13, h: 30, tilt: 30, heading: 20 } },
    { id: 'villages-atl', group: G, title: 'Деревни: атлантический северо-запад', note: 'Здесь настоящих сёл много, и почти все места района — настоящие. Дворы под тёмными крышами стоят без улиц, между деревнями — отдельные дворы.', p: { forest3d: 0 }, cam: { lat: 41.5, lon: -8.38, h: 26, tilt: 35, heading: 0 } },
    { id: 'villages-valley', group: G, title: 'Деревни в горной долине', note: 'В горах места под деревни — только на ровных чанках долин: на крутых склонах и выше 1 800 м мест нет.', p: { forest3d: 0 }, cam: { lat: 42.62, lon: .75, h: 40, tilt: 35, heading: 0 } },
    { id: 'villages-sites', group: G, title: 'Места поселений района (проверка)', note: 'Перечень мест каждого района, показан точками: красная — центр района, жёлтая — настоящее село, синяя — подобранное место. Закрашенная точка — место заселено, белая — пока пусто. Перечень постоянен: он считается из рельефа и деления одинаково каждый раз, и сохранение хранит только номер места в районе. В игре точек нет.', p: { sitesShow: 1, division: 1, look: 'paper', forest3d: 0, labels: 0 }, cam: { lat: 41.4, lon: -1.4, h: 110, tilt: 10, heading: 0 } },
    { id: 'villages-sites-near', group: G, title: 'Места поселений вблизи (проверка)', note: 'Те же точки над обычной картой с 45 км: видно, что место стоит на ровной земле у воды, а деревня — на своём месте.', p: { sitesShow: 1, forest3d: 0, labels: 0 }, cam: { lat: 41.79, lon: -1.13, h: 45, tilt: 20, heading: 0 } },
    { id: 'tracks', group: G, title: 'Тропы к деревням', note: 'От каждой деревни к дороге своего района ведёт тропа: самый дешёвый путь по рельефу, той же ценой шага, что у дорог. Тропы района сходятся: путь дальней деревни идёт через ближнюю, и к дороге они выходят одной тропой. Тропа начинается у крайних домов и кончается на дороге; за границу района не выходит. Где в районе дороги нет, тропы ведут к его центру. Здесь «Рост городов» на 2.', p: { growth: 2, forest3d: 0, labels: 0 }, cam: { lat: 41.74, lon: -1.1, h: 26, tilt: 30, heading: 0 } },
    { id: 'tracks-hills', group: G, title: 'Тропы в предгорьях', note: 'В холмах тропа идёт долиной и обходит склоны: шаг вверх стоит дороже ровного, реку тропа пересекает один раз. Деревни одной долины выходят к дороге одной тропой.', p: { growth: 2, forest3d: 0, labels: 0 }, cam: { lat: 42.08, lon: .05, h: 28, tilt: 35, heading: 0 } },
    { id: 'tracks-60', group: G, title: 'Тропы с 60 км', note: 'С этой высоты тропы — тонкие линии между деревнями и дорогой. Выше они гаснут вместе с деревнями: на экране в 1600 строк — между 100 и 190 км.', p: { growth: 2, forest3d: 0 }, cam: { lat: 41.74, lon: -1.1, h: 60, tilt: 25, heading: 0 } },
    { id: 'tracks-check', group: G, title: 'Тропы ко всем местам района (проверка)', note: 'Проверочный вид: тропы ко всем местам перечня, а не только к заселённым. У района одно дерево путей — оно считается из деления, рельефа и дорог одинаково каждый раз и не зависит от того, какие места заселены. Красная точка — центр района, жёлтая — настоящее село, синяя — подобранное место; закрашенная — место заселено.', p: { sitesShow: 1, division: 1, look: 'paper', forest3d: 0, labels: 0 }, cam: { lat: 41.6, lon: -1.2, h: 60, tilt: 0, heading: 0 } },
    { id: 'farm', group: G, title: 'Угодья: поля по чанкам', note: 'Поля — это состояние чанков по одному квадратному километру. У чанка одно число: какая его доля распахана. Поселение распахивает чанки вокруг себя — гектар на жителя, ровную землю раньше холмов; ближние чанки целиком, дальние частью. Рисунок полей берётся только из этого числа: наделы идут из чанка в чанк без шва, край полей идёт по наделам, самих чанков не видно. Здесь «Рост городов» на 2. Ручка «Угодья на жителя» меняет, сколько земли нужно человеку. Числа чанков видны на странице «Чанки: угодья».', p: { growth: 2, forest3d: 0, labels: 0 }, cam: { lat: 41.74, lon: -1.1, h: 32, tilt: 30, heading: 0 } },
    { id: 'farm-hills', group: G, title: 'Угодья в предгорьях', note: 'Ровное дно долин распахано, склоны нет: чанк холмов можно распахать меньше чем наполовину, крутой склон — на десятую часть, горы — нисколько. Выше 1 700 м полей нет. В лесу поля лежат вырубками у деревень.', p: { growth: 2, forest3d: 0, labels: 0 }, cam: { lat: 42.08, lon: .05, h: 36, tilt: 35, heading: 0 } },
    { id: 'farm-200', group: G, title: 'Угодья с 200 км', note: '«Рост городов» на 3. С этой высоты поля — спокойный тон там, где земля распахана всерьёз. Там, где распаханы отдельные чанки у деревень, поля с высоты не показаны и проступают, когда камера опускается.', p: { growth: 3 }, cam: { lat: 41.5, lon: -1.0, h: 200, tilt: 20, heading: 0 } },
    { id: 'town-med', group: G, title: 'Манера: средиземноморская', note: 'Плотные кварталы с дворами, черепица и побелка, узкие гнутые улицы, площадь и храм в середине, причал у воды.', p: { forest3d: 0, labels: 0 }, cam: { lat: 36.722, lon: -4.42, h: 20, tilt: 35, heading: 0 } },
    { id: 'town-atl', group: G, title: 'Манера: атлантическая', note: 'Разбросанные каменные дворы под тёмными крышами, без сетки улиц; дворы обнесены стенами, вокруг выгоны с живыми изгородями.', p: { forest3d: 0, labels: 0 }, cam: { lat: 43.25, lon: -2.93, h: 20, tilt: 35, heading: 160 } },
    { id: 'fields', group: G, title: 'Поля: наделы, пар, выгон, террасы', note: 'Наделы лежат рядами, в каждом полосы со своими посевами, между ними межи и тропы, пар и выгон; на склонах террасы вдоль горизонталей. От поселения к полям расходятся дорожки. Издалека всё сливается в спокойный тон.', p: { forest3d: 0, labels: 0 }, cam: { lat: 36.735, lon: -4.44, h: 20, tilt: 40, heading: 35 } },
    { id: 'yards', group: G, title: 'Дворы среди полей', note: 'За околицей, среди полей, стоят отдельные дворы: дом, двор с сараем и стогом, длинный дом. У каждого свой участок: грядки и утоптанная земля. Всё в настоящую величину, двор — 50–80 м. Мест под двор — шестнадцать на квадратный километр, решёткой через 250 м; какие заняты, считается каждый раз одинаково. Дворы не встают на воду, реку, болото, крутой склон, дорогу и дорожку. Ручка «Дворы среди полей» меняет густоту.', p: { growth: 1.6, forest3d: 0, labels: 0 }, cam: { lat: 41.672, lon: -.905, h: 20, tilt: 35, heading: 0 } },
    { id: 'yards-dense', group: G, title: 'Дворы: густо', note: 'Та же земля, «Дворы среди полей» на 3: в средиземноморской манере это семь-восемь дворов на квадратный километр пашни. Прежние дворы стоят на своих местах, между ними встали новые.', p: { growth: 1.6, yards: 3, forest3d: 0, labels: 0 }, cam: { lat: 41.672, lon: -.905, h: 20, tilt: 35, heading: 0 } },
    { id: 'yards-atl', group: G, title: 'Дворы: атлантическая манера', note: 'На влажном северо-западе люди живут не сёлами, а дворами, разбросанными по земле: их вдвое больше, стоят они как придётся, под тёмными крышами.', p: { growth: 1.6, forest3d: 0, labels: 0 }, cam: { lat: 41.58, lon: -8.424, h: 20, tilt: 35, heading: 0 } },
    { id: 'yards-50', group: G, title: 'Дворы с 50 км', note: 'Двор отсюда — три-четыре пикселя. Выше дворы уменьшаются и пропадают вместе с кварталами поселений: с 60–70 км двор меньше двух пикселей, и остаётся один тон полей.', p: { growth: 1.6, forest3d: 0, labels: 0 }, cam: { lat: 41.672, lon: -.905, h: 50, tilt: 30, heading: 0 } },
    { id: 'town-build', group: G, title: 'Стройка на краю', note: 'На краю растущего поселения стоят стройки: фундаменты, леса, сложенный лес и камень. Двигайте «Рост городов»: стройки уходят дальше, на их месте встают дома.', p: { growth: .42, forest3d: 0, labels: 0 }, cam: zar(20, 45, 20) },
    { id: 'town-night', group: G, title: 'Ночь: свет в окнах', note: 'После заката в окнах слабый тёплый свет, он чуть освещает улицы.', p: { hour: 21.5, forest3d: 0, labels: 0 }, cam: zar(20, 40) },
  ],
  async init(album) { return (await import('../layers/towns.js')).default(album); },
};
