// ASPECT «Лес»: where the forest of a chunk stands, what it is made of, how old it is and how it looks. This file and
// layers/forest.js belong to the forest work; the contract with the rest of the album is in docs/ALBUM-CHUNKS.md, the
// rules of the forest itself are in docs/album/forest.md.
//   forestCover(p)   → share of the pixel under canopy (the ground shader asks it first)
//   aspForest(p, L)  → paints the canopy over the ground colour L.col
// The state comes from the chunks: p.cA = (forest 0 felled .. 1 natural, share of conifers, age 0 young .. 1 old, swamp).
// The same rules place the 3D trees (layers/forest.js), and a small model here lets a felled chunk grow over again.
import { Vector4, DataTexture, RedFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping } from 'three';

// ---- the natural state: the world of 5000 BC, before anyone felled anything
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = v => Math.max(0, Math.min(1, v));
const hashK = k => { let x = Math.imul(k + 1, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
// the CPU twin of albumWet() in glsl.js, without its noise: 0 dry steppe .. 1 Atlantic forest
export function wetAt(lat, lon, h) {
  const g = (la, lo, s) => Math.exp(-((lat - la) ** 2 + (lon - lo) ** 2) / s);
  return .42 + .34 * ss(42.2, 43.4, lat) * ss(-.5, -2.5, lon) + .30 * ss(-6.2, -8.6, lon) * ss(38.2, 41.8, lat)
    + .22 * ss(42, 43.2, lat) * ss(3.5, .5, lon) + .25 * ss(43, 44.5, lat)
    - .24 * g(41.6, -.6, 1.7) - .30 * g(37.6, -1.8, 2.2) - .12 * g(39.3, -3, 2.6) + h * .00016;
}
// What the forest of a chunk is by nature, from its mean height, wetness and latitude. jit −.5 .. .5 varies neighbours.
//   conifer  share of conifers: the mountain belt (fir, mountain pine), the dry interior and the south (pines, juniper)
//   age      0 young .. 1 old: old forest where it is wet and mild; lower, younger wood where fire and drought return
//            and near the tree line
//   speed    how fast a felled chunk grows over again: 1 in mild wet country, slower in the dry and in the heights
export function naturalForest(lat, lon, h, jit = 0) {
  const wet = wetAt(lat, lon, h), mont = ss(900, 1750, h), dry = ss(.56, .36, wet), south = ss(42.5, 37.5, lat);
  return {
    conifer: clamp01(.06 + .82 * mont + (.5 * dry + .08 * south) * (1 - mont) + jit * .1),
    age: clamp01(.92 - .3 * ss(.5, .25, wet) - .35 * ss(1600, 2200, h) + jit * .1),
    speed: (.55 + .65 * ss(.25, .8, wet)) * (1 - .5 * ss(1400, 2200, h)),
  };
}

// ---- growing over: a felled chunk fills with brush, then young forest, and the forest that stands grows old.
// The model keeps its own exact numbers (a byte of chunk state is too coarse for one frame of growth) and works over
// any source of felling: whatever changes the `forest` byte of a chunk — the settlements, the brush tool, a
// demonstration — is taken in at the next sync().
export const YEARS_PER_SECOND = 1;     // at «Ход времени» 1×
export const CLOSE_RATE = .11;         // logistic rate of the canopy closing, per year, at speed 1
export const OLD_AFTER = 140;          // years for a seedling to become old forest, at speed 1
export class Regrowth {
  constructor(ch, speed, natAge) {
    this.ch = ch; this.speed = speed; this.natAge = natAge;
    this.F = new Float32Array(ch.count); this.A = new Float32Array(ch.count);
    this.F0 = new Float32Array(ch.count); this.A0 = new Float32Array(ch.count);
    this.nb = Array.from({ length: ch.count }, (_, k) => ch.neighbours(k));
    this.live = []; for (let k = 0; k < ch.count; k++) if (ch.land[k] > 0) this.live.push(k);
    this.years = 0; this.fresh = true;
  }
  // after chunks.reset(): forget everything, the next sync() takes the state as it is
  restart() { this.fresh = true; this.years = 0; }
  // take in what others did to the chunks since the model last wrote them
  sync() {
    const { ch, F, A } = this, fresh = this.fresh;
    for (const k of this.live) {
      const f = ch.get('forest', k), a = ch.get('age', k);
      if (fresh || Math.round(A[k] * 255) !== Math.round(a * 255)) A[k] = a;
      if (fresh) F[k] = f;
      else if (Math.round(F[k] * 255) !== Math.round(f * 255)) {
        if (f > F[k] && f > 0) A[k] *= F[k] / f;                    // forest added by hand is young: the mean age drops
        F[k] = f;
      }
    }
    if (fresh) { this.F0.set(F); this.A0.set(A); this.fresh = false; }
  }
  // back to the state of the last restart (the «Зарастание» knob starts from it)
  rewind() { this.F.set(this.F0); this.A.set(this.A0); this.years = 0; this.write(); }
  step(years) {
    if (!(years > 0)) return;
    const n = Math.max(1, Math.ceil(years / 2)), dt = years / n;
    for (let s = 0; s < n; s++) this.tick(dt);
    this.years += years; this.write();
  }
  tick(dt) {
    const { ch, F, A, nb, speed, natAge } = this;
    for (const k of this.live) {
      const f = F[k]; let a = A[k];
      const cap = Math.max(0, 1 - ch.get('fields', k) - ch.get('built', k));   // farmed and built land stays open
      if (f < cap - 1e-4) {
        let near = 0; for (const m of nb[k]) near += F[m];
        const seed = .02 + .12 * near / 4;                           // seeds come from the forest around: the edge closes first
        const df = Math.min(cap - f, CLOSE_RATE * speed[k] * (f + seed) * (1 - f / cap) * dt);
        a *= f / (f + df); F[k] = f + df;                            // what has just come up is young
      }
      if (a < natAge[k]) a = Math.min(natAge[k], a + dt * Math.sqrt(speed[k]) / OLD_AFTER);
      A[k] = a;
    }
  }
  write() { const { ch, F, A } = this; for (const k of this.live) { ch.set('forest', k, F[k]); ch.set('age', k, A[k]); } }
}

// ---- states laid over the natural one to show the forest at work (the «Показ леса» knob). All of them sit in the
// closed lowland forest of Gascony, on plain ground, so that nothing but the state of the chunks differs.
export const DEMO = { lat: 43.95, lon: .45 };
export const DEMOS = {
  kinds: 'Виды: лиственный, смешанный, хвойный', density: 'Густота: от редколесья до сомкнутого', age: 'Возраст: от вырубки до старого леса',
  clearing: 'Большая вырубка', mosaic: 'Пёстрые соседние чанки',
};
export function applyDemo(ch, id) {
  if (!DEMOS[id]) return;
  const c = ch.ij(ch.at(DEMO.lat, DEMO.lon)), put = (k, forest, conifer, age) => {
    if (forest != null) ch.set('forest', k, forest); if (conifer != null) ch.set('conifer', k, conifer); if (age != null) ch.set('age', k, age);
  };
  const band = (di, n) => Math.floor((di + n * 1.5) / 3);            // n bands of three chunks, west to east
  for (let dj = -9; dj <= 9; dj++) for (let di = -9; di <= 9; di++) {
    const k = ch.k(c.i + di, c.j + dj); if (k < 0) continue;
    if (id === 'kinds') { const b = band(di, 3); if (b >= 0 && b < 3) put(k, 1, [0, .5, 1][b], .85); }
    else if (id === 'density') { const b = band(di, 4); if (b >= 0 && b < 4) put(k, [.2, .45, .7, 1][b], .15, .85); }
    else if (id === 'age') { const b = band(di, 5); if (b >= 0 && b < 5) put(k, [0, .3, 1, 1, 1][b], .15, [0, .04, .3, .65, 1][b]); }
    else if (id === 'clearing') { const d = Math.hypot(di, dj); if (d < 4) put(k, ss(2.3, 3.6, d), null, null); }
    else if (id === 'mosaic' && Math.abs(di) <= 7 && Math.abs(dj) <= 7) {
      const a = hashK(k), b = hashK(k + 7919), f = hashK(k + 104729);
      put(k, f < .22 ? .3 : f < .4 ? .65 : 1, [0, .5, 1][Math.floor(a * 3)], .2 + .8 * b);
    }
  }
}

// ---- rules shared with the 3D trees (layers/forest.js): a tree stands exactly where the ground is painted as forest,
// and is of the kind, the age and the colour the ground is painted in
export const FOREST_RULES = /* glsl */`
float albumTreeline(float n1) { return 2150. + (n1 - .5) * 260.; }
// share of the ground under trees before patchiness: closed forest where wet, open woodland where dry
float albumForestShare(float wet, float hl, float slope, float n1) {
  float steep = smoothstep(.40, .82, slope), tl = albumTreeline(n1);
  float fc = smoothstep(.34, .58, wet) * (1. - smoothstep(tl - 180., tl + 40., hl)) * (1. - steep);
  return max(fc, smoothstep(.20, .34, wet) * .38 * (1. - steep) * (1. - smoothstep(1500., 1900., hl)));
}
// The natural forest is patchy: a noise of two sizes, 7 and 1 km, against the share of the ground the trees take.
float albumPatch(float n2, float n3) { return n2 * .65 + n3 * .35; }
// the edge of a stand is roughened by a finer, turned noise, so that the lattice of the patch noise never shows
float albumRough(vec2 pk) { return (vnoise(mat2(.8, -.6, .6, .8) * pk / .63 + 23.) - .5) * .14; }
// how deep inside the natural forest a place is (> 0) or how far outside (< 0)
float albumMargin(float fc, float k, float pat) { return fc * k - pat * .9 + .05; }
float albumCover(float fc, float k, float pat) { return smoothstep(-.10, .10, albumMargin(fc, k, pat)); }
// The order in which a chunk loses its stands as it is felled, 0 last .. 1 first, spread about evenly over the ground.
// The weak stands go first (the patch noise), in shapes of their own that follow no lattice: three noises of 1.9,
// 0.7 and 0.3 km, two of them turned. px: km per pixel, the small noises fade out with distance (0 = keep all).
float albumOrder(vec2 pk, float pat, float px) {
  vec2 q = mat2(.8, -.6, .6, .8) * pk;
  float b = px < .35 ? mix(.5, vnoise(q.yx / .7 + 7.), smoothstep(.35, .15, px)) : .5, c = px < .15 ? mix(.5, vnoise(pk / .31 + 3.), smoothstep(.15, .06, px)) : .5;
  return smoothstep(.28, .70, pat * .45 + vnoise(q / 1.9 + 31.) * .275 + b * .165 + c * .11);
}
// Felling. The state of a chunk says how much of its natural forest stands (have, 0 .. 1). Half of a loss is whole
// stands, taken in the order above. The other half is the canopy of what is left opening up. Together the ground
// under canopy is the natural cover times have.
//   x  share of the ground under canopy     y  how deep inside the standing forest (for the age of its edge)
// order: albumOrder() of the place (anything when have is 1); fade: 1 near, 0 where the noises have faded with
// distance and the stands melt into their mean
vec2 albumStand(float fc, float k, float pat, float order, float have, float fade) {
  float m = albumMargin(fc, k, pat), a = sqrt(have), left = a * 1.12 - .06 - order;
  return vec2(smoothstep(-.10, .10, m) * mix(a, smoothstep(-.06, .06, left), fade) * a, min(m, left + step(.999, have)));
}
// The conifers of a chunk are not an even mix: they take the higher, steeper and sunnier ground first, in stands.
//   share  conifer share of the chunk        st, n2  noises of the stands, 2.6 and 7 km
//   rel    height above the country around, in units of 300 m      south  how much the slope faces south, −1 .. 1
// Returns 0 broadleaf .. 1 conifer; in between the two stand mixed, crown by crown.
float albumConifer(float share, float st, float n2, float rel, float south, float slope) {
  float site = (.5 - st) * .75 + (n2 - .47) * .55 + clamp(rel, -1., 1.) * .2 + south * .1 + (smoothstep(.15, .6, slope) - .2) * .08;
  float s = 2. * share - 1., s2 = s * s;
  return smoothstep(-.2, .2, site + .2 * s * (1.25 + 1.6 * s2 * s2)) * smoothstep(0., .04, share);
}
// age of the forest at a place: the age of the chunk, younger toward the edge of the forest, where it advances
float albumAge(float age, float inside, float st) { return clamp(age * (.6 + .4 * smoothstep(0., .3, inside) + (st - .5) * .16), 0., 1.); }
// Colour of the canopy as seen from above, before the shading of the crowns.
//   con 0 broadleaf .. 1 conifer; age 0 .. 1; stand: noise of the stands; autumn: 0 .. 1, turns the broadleaf of wet country
vec3 albumForestTint(float con, float age, float wet, float hl, float lat, float stand, float autumn) {
  float w = smoothstep(.5, .75, wet), south = smoothstep(42.5, 37.5, lat), mont = smoothstep(800., 1600., hl);
  // broadleaf: grey-olive evergreen oak where dry, fresh green where wet; cooler in the mountains, warmer in the south
  vec3 broad = mix(vec3(.20, .27, .10), vec3(.105, .235, .085), w);
  broad = mix(broad, vec3(.085, .215, .105), mont * .45);
  broad = mix(broad, broad * vec3(1.14, 1.02, .80), south * .5);
  // conifers: the warm green pine of the dry south, dark blue-green fir and mountain pine higher up and in the wet
  vec3 conif = mix(vec3(.13, .22, .085), vec3(.085, .20, .118), max(mont, w * .8));
  conif = mix(conif, vec3(.07, .165, .115), smoothstep(1700., 2150., hl) * .5);
  conif = mix(conif, conif * vec3(1.10, 1.02, .84), south * .35);
  // stands of different trees
  broad = mix(broad, vec3(.36, .44, .14), smoothstep(.58, .8, stand) * .55);
  broad = mix(broad, vec3(.07, .20, .14), smoothstep(.42, .2, stand) * .5);
  conif = mix(conif, vec3(.15, .26, .12), smoothstep(.62, .85, stand) * .3);
  conif = mix(conif, vec3(.06, .15, .105), smoothstep(.4, .2, stand) * .35);
  broad = mix(broad, vec3(.42, .26, .08), autumn * smoothstep(.45, .7, wet));
  vec3 c = mix(broad, conif, con);
  // age: brush first, then young growth lighter and yellower, old forest darker
  float ya = smoothstep(.1, .5, age), oa = smoothstep(.55, 1., age);
  c = mix(c * 1.2 + vec3(.035, .04, .01), c, ya);
  c = mix(mix(vec3(.34, .36, .19), vec3(.24, .34, .14), w), c, .3 + .7 * smoothstep(0., .14, age));
  return c * (1.06 - .12 * oa);
}
`;

const GLSL = /* glsl */`
${FOREST_RULES}
uniform vec4 uTreeZone;   // where the 3D trees stand: centre x, y and radius in km, and how much lighter the canopy under them must come out on screen
uniform sampler2D tForestRise;   // mean height of the land of every chunk, / 4096 m: the country around a place
// crowns: a jittered lattice of points like worleyV() — xy = vector to the nearest point, z = distance to it, w = its
// random number. The number is taken from the hash that places the point, which stays good far from the origin.
// (A cheaper lattice of four cells with less jitter was tried: its regular rows show from above.)
vec4 crowns(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.); float d = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = hash22(i + g), r = g + o - u; float dd = dot(r, r);
    if (dd < d) { d = dd; best = r; id = fract(o.x * 13.7 + o.y * 5.3); }
  }
  return vec4(best, sqrt(d), id);
}
// 1 on the crowns that stand when the canopy is closed by the share g, 0 between them; its mean over the ground is g
float crownMask(vec4 w, float g) { return 1. - smoothstep(g * 1.14 - .14, g * 1.14, smoothstep(.12, 1.08, w.z * .9 + w.w * .45)); }
// what forestCover() worked out about the pixel, kept for aspForest(): share of trees by nature, the patch noise
// (roughened where an edge of the natural forest is near), how far the noises of felling have faded, the stand
float fFc, fPat, fFade; vec2 fStand;
// The colour that comes out gain times lighter on the screen than seen would, under this light and behind this much
// air: the end of the ground shader (light, air, albumFinish in glsl.js) run forward, lifted, and run back — gamma,
// saturation, tone curve, exposure, air, light.
vec3 forestLift(vec3 seen, vec3 light, float gain, float haze) {
  vec3 air = albumHazeCol() * haze;
  vec3 c = pow(min(albumFinish(pow(seen, vec3(2.2)) * light * (1. - haze) + air) * gain, vec3(.97)), vec3(2.2));
  float l = dot(c, vec3(.2126, .7152, .0722)); c = max(l + (c - l) / uSat, 0.);
  vec3 a = 2.51 - 2.43 * c, b = .03 - .59 * c;
  c = (-b + sqrt(b * b + .56 * a * c)) / (2. * a) / uExposure;
  return pow(max(c - air, 0.) / ((1. - haze) * max(light, vec3(.02))), vec3(1. / 2.2));
}
float forestCover(Px p) {
  float have = p.cA.r, order = 0.;
  fFc = albumForestShare(p.wet, p.hl, p.slope, p.n1); fPat = albumPatch(p.n2, p.n3); fFade = smoothstep(1.2, .5, p.px);
  if (p.px < .5 && abs(albumMargin(fFc, uForestK, fPat)) < .22) fPat += albumRough(p.pk) * smoothstep(.5, .2, p.px);
  if (have < .999 && have > .001 && fFade > 0.) order = albumOrder(p.pk, fPat, p.px);
  fStand = albumStand(fFc, uForestK, fPat, order, have, fFade);
  return fStand.x;
}

void aspForest(Px p, inout Land L) {
  float px = p.px, dens = L.cover, have = p.cA.r, fc = fFc, own = fStand.x; vec2 pk = p.pk;   // own: what forestCover() answered, before swamp and people
  if (fc < .003 && dens < .003) return;                              // nothing grows here: too dry, too steep, too high

  // ---- felled ground: where the natural forest of the chunk no longer stands. Pale grass and stumps; bare earth and
  // slash where the chunk was cut clean; brush comes up as the forest of the chunk returns
  if (have < .995) {
    float cut = (albumCover(fc, uForestK, fPat) - own) * (1. - clamp(p.cC.g * 1.6 + p.cC.r * 2., 0., 1.));
    if (cut > .01) {
      vec3 cg = mix(vec3(.55, .50, .29), vec3(.43, .48, .21), smoothstep(.35, .65, p.wet));
      cg = mix(cg, vec3(.50, .42, .30), (1. - smoothstep(0., .3, have)) * (.35 + .4 * p.n3));
      L.col = mix(L.col, cg * (.92 + .16 * p.n3), cut * .6);
      float bf = smoothstep(.05, .012, px);
      if (bf > 0.) { vec4 b = crowns(pk / .028 + 9.); L.col = mix(L.col, vec3(.22, .31, .13), cut * bf * .7 * step(b.w, .1 + .5 * have) * smoothstep(.42, .22, b.z)); }
    }
  }

  // ---- the same question a step toward the sun: a lit rim and cast shade. Only an edge of the forest can answer it
  // differently, so deep inside and far outside it is not asked.
  float coverS = dens;
  if (px < .7 && abs(fStand.y) < .34 && have > .02) {
    vec2 pks = pk + p.sd * .22;
    float ps = albumPatch(mix(.5, fbm(pks / 7.3 + 5.), smoothstep(5., 1.5, px)), mix(.5, vnoise(pks / 1.1), smoothstep(.7, .25, px)));
    if (px < .5) ps += albumRough(pks) * smoothstep(.5, .2, px);
    float s = albumStand(fc, uForestK, ps, have < .999 && fFade > 0. ? albumOrder(pks, ps, px) : 0., have, fFade).x;
    coverS = mix(dens, s * (own > .001 ? min(dens / own, 1.) : 1.), smoothstep(.7, .4, px));
  }
  if (dens < .003 && coverS < .003) return;

  // ---- what stands here: kind and age of the forest at this place, from the state of the chunk
  float st = px < 2.5 ? mix(.5, vnoise(pk / 2.6 + 11.), smoothstep(2.5, 1., px)) : .5, tree = st * .6 + p.n2 * .4;
  vec2 nh = p.n.xy / max(length(p.n.xy), 1e-4);
  float rel = (p.hl - textureLod(tForestRise, (pk - uChunkRect.xy) * uChunkRect.zw, 0.).r * 4096.) / 300.;
  float con = albumConifer(p.cA.g, st, p.n2, rel, -nh.y * smoothstep(.05, .3, p.slope), p.slope);
  float age = albumAge(p.cA.b, fStand.y, st), ya = smoothstep(.1, .5, age), oa = smoothstep(.55, 1., age);

  // ---- the forest reads as moss: tufts of three sizes, each lit on its sunny side; they fade out one by one with
  // distance. Young growth is fine and even, old forest has large crowns and an uneven canopy; conifers are sharper
  // and tighter than broadleaf. Where the canopy is not closed — at an edge, in a thinned stand, in brush — the
  // crowns stand one by one with ground between them instead of fading.
  float f1 = smoothstep(.055, .015, px), f2 = smoothstep(.2, .05, px), f3 = smoothstep(.9, .25, px);
  float tuft = 0., tone = .5, litc = 0., k1 = con, k2 = con, m1 = dens, m2 = dens;
  if (dens > .01) {
    if (f1 > 0.) {
      vec4 w = crowns(pk / .045); float a = f1 * mix(1.3, .9, oa); k1 = step(fract(w.w * 7.31), con);
      tuft += a * .45 * mix(1. - w.z, 1.2 - 1.5 * w.z, k1); litc += a * .55 * (dot(normalize(vec3(-w.xy * mix(2.4, 3.6, k1), 1.)), uSun) - uSun.z); tone = mix(tone, w.w, f1 * .5);
      if (dens < .985) m1 = crownMask(w, dens);
    }
    if (f2 > 0.) {
      vec4 w = crowns(pk / .14 + 3.1); float a = f2 * mix(.25, 1., ya) * (1. + .3 * oa); k2 = step(fract(w.w * 7.31), con);
      tuft += a * .35 * mix(1. - w.z, 1.15 - 1.35 * w.z, k2); litc += a * .4 * (dot(normalize(vec3(-w.xy * mix(2., 3., k2), 1.)), uSun) - uSun.z); tone = mix(tone, w.w, min(a, 1.2) * .42);
      if (dens < .985) m2 = crownMask(w, dens);
    }
    if (f3 > 0.) {
      vec4 w = crowns(pk / .62 + 7.7); float a = f3 * mix(.12, 1., ya) * (1. + .4 * oa) * (1. - .3 * con);
      tuft += a * .3 * (1. - w.z); litc += a * .32 * (dot(normalize(vec3(-w.xy * 1.6, 1.)), uSun) - uSun.z); tone = mix(tone, w.w, min(a, 1.2) * .5);
    }
  }
  float kind = mix(mix(con, k2, f2 * .75), k1, f1);                  // the kind of the crown itself where crowns can be told apart
  float mask = mix(dens, mix(m2, m1, (1. - ya) * f1), smoothstep(.07, .03, px));   // brush and young growth: small crowns; older: large ones
  vec3 tint = albumForestTint(kind, age, p.wet, p.hl, p.ll.x, tree, uSeason * (.55 + .45 * p.n3));
  tint = mix(tint, vec3(.50, .44, .16), smoothstep(.93, .99, tone) * .4 * (1. - kind) * ya);       // a crown gone yellow here and there
  float ta = mix(.2, .46, ya) * (1. + .25 * oa);                     // how much one crown differs from the next
  vec3 canopy = tint * (1.03 - .5 * ta + ta * tone) * (.86 + .5 * tuft + .9 * litc * p.day) * (dens > .01 ? mix(vec3(1.), texDetail(tForest, pk, px, p.pdx, p.pdy), .35) : vec3(1.));
  // the finishing pass (post.js) darkens the ground between 3D trees: under them the canopy is painted lighter by as much
  float zone = smoothstep(1., .78, length(pk - uTreeZone.xy) / uTreeZone.z); zone *= zone * uTreeZone.w * (1. + .04 * kind);
  if (zone > .002) canopy = forestLift(canopy, p.sunCol * max(dot(p.n, uSun), 0.) * p.sh * 1.25 + p.skyCol * (.4 + .6 * p.n.z) * p.ao, 1. + zone, albumHaze(worldOf(p.ll, p.hl * uExag / 1000.)));
  // rim and shade grow with the height of the stand; the ground between the crowns of an open stand is mostly in the sun
  float tall = .3 + .7 * ya, rim = clamp(mask - coverS, 0., 1.) * tall, castS = clamp(coverS - mask, 0., 1.) * coverS * tall;
  L.col = mix(L.col * (1. - .5 * castS * p.day), canopy * (1. + .35 * rim * p.day), mask);
  L.cover = mask;
}`;

const NEAR = { lat: 43.2, lon: -4.85 };   // Picos de Europa: broadleaf valleys, conifers above, bare summits
const demoCam = (h, tilt = 45, heading = 0, dLat = 0, dLon = 0) => ({ lat: DEMO.lat + dLat, lon: DEMO.lon + dLon, h, tilt, heading });
const PLAIN = { towns: 0, labels: 0, roadsOn: 0 };
export default {
  id: 'forest', title: 'Лес', glsl: GLSL, uniforms: { uTreeZone: { value: new Vector4(0, 0, 1, 0) }, tForestRise: { value: null } },
  params: [
    { key: 'forest', label: 'Густота леса', group: 'scale', min: 0, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uForestK' },
    { key: 'trees', label: 'Размер деревьев', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'forest3d', label: 'Объёмные деревья', group: 'layers', type: 'toggle', value: 1 },
    { key: 'forestDemo', label: 'Показ леса', group: 'modes', type: 'select', value: '', options: [['', 'нет'], ...Object.entries(DEMOS)] },
    { key: 'regrow', label: 'Зарастание: прошло лет', group: 'modes', min: 0, max: 300, step: 5, value: 0, unit: ' лет' },
  ],
  pages: [
    { id: 'forest-kinds', group: 'Лес', title: 'Виды леса: лиственный, смешанный, хвойный', note: 'Три полосы чанков с запада на восток: доля хвойных 0, 0,5 и 1. Лиственный светлее, кроны круглые и крупные; хвойный темнее, с синевой, кроны мелкие и острые. В смешанном хвойные стоят куртинами на буграх и южных склонах, а не ровной смесью.', p: { forestDemo: 'kinds', ...PLAIN }, cam: demoCam(75, 50) },
    { id: 'forest-density', group: 'Лес', title: 'Густота: от редколесья до сомкнутого леса', note: 'Четыре полосы чанков: стоит 20, 45, 70 и 100 % леса. Сначала уходят самые слабые рощи, а в оставшихся полог редеет: кроны стоят по одной, между ними трава.', p: { forestDemo: 'density', ...PLAIN }, cam: demoCam(95, 48) },
    { id: 'forest-age', group: 'Лес', title: 'Возраст: вырубка, кустарник, молодняк, зрелый и старый лес', note: 'Пять полос чанков с запада на восток. Вырубка — бледная трава и голая земля; потом кусты; молодняк светлый, ровный и мелкий; старый лес тёмный, с крупными кронами и неровным пологом.', p: { forestDemo: 'age', ...PLAIN }, cam: demoCam(110, 45) },
    { id: 'forest-regrow', group: 'Лес', title: 'Зарастание: свежая вырубка', note: 'Лес сведён на 60 км в поперечнике. Время идёт (ползунок «Ход времени», раздел «Система»): вырубка зарастает от краёв к середине. Ползунок «Зарастание: прошло лет» сразу показывает нужный год.', p: { forestDemo: 'clearing', play: 6, ...PLAIN }, cam: demoCam(100, 42) },
    { id: 'forest-regrow-40', group: 'Лес', title: 'Зарастание: через 40 лет', note: 'Та же вырубка. Края сомкнулись молодняком, в середине кусты и первые рощи.', p: { forestDemo: 'clearing', regrow: 40, play: 0, ...PLAIN }, cam: demoCam(100, 42) },
    { id: 'forest-regrow-150', group: 'Лес', title: 'Зарастание: через 150 лет', note: 'Лес вернулся и почти сравнялся со старым вокруг; середина ещё моложе и светлее.', p: { forestDemo: 'clearing', regrow: 150, play: 0, ...PLAIN }, cam: demoCam(100, 42) },
    { id: 'forest-seam', group: 'Лес', title: 'Стык чанков: соседи с разным лесом', note: 'У каждого чанка своё случайное состояние: вид леса, возраст, сколько стоит. Сетки на картинке нет: границы идут неровно, как в природе.', p: { forestDemo: 'mosaic', ...PLAIN }, cam: demoCam(120, 30) },
    { id: 'forest-seam-grid', group: 'Лес', title: 'Тот же стык с сеткой чанков', note: 'Те же чанки с сеткой 10 км. Наведите курсор на чанк: внизу видно его состояние.', p: { forestDemo: 'mosaic', grid: 1, chunkInfo: 1, ...PLAIN }, cam: demoCam(120, 30) },
    { id: 'forest-3d', group: 'Лес', title: 'Лес с 20 км: объёмные кроны', note: 'Природный лес Пикос-де-Эуропа. Поверх краски стоят мелкие деревья: лиственные круглые, хвойные острые, молодые меньше старых.', p: { forest3d: 1 }, cam: { ...NEAR, h: 22, tilt: 55, heading: 150 } },
    { id: 'forest-paint', group: 'Лес', title: 'Лес с 20 км только краской', note: 'Тот же вид без объёмных деревьев: лес показан цветом и рисунком крон на земле.', p: { forest3d: 0 }, cam: { ...NEAR, h: 22, tilt: 55, heading: 150 } },
    { id: 'forest-moss', group: 'Лес', title: 'Лес как мох с 200 км', note: 'Обычная игровая высота. Лес — мягкий ворс из пучков трёх размеров; хвойные пояса гор темнее и ровнее лиственных долин.', p: {}, cam: { ...NEAR, h: 200, tilt: 40, heading: 170 } },
    { id: 'forest-500', group: 'Лес', title: 'Лес с 500 км', note: 'Высота больших держав. Видны оттенки по месту: свежая зелень атлантического севера, тёмные хвойные горы, оливковый дуб и светлая сосна сухой середины.', p: {}, cam: { lat: 42.3, lon: -3.6, h: 500, tilt: 30, heading: 0 } },
  ],
  async init(album) {
    const ch = album.chunks, p = album.params;
    // the natural state of the forest channels, and how fast each chunk grows over
    const speed = new Float32Array(ch.count), natAge = new Float32Array(ch.count);
    for (let k = 0; k < ch.count; k++) {
      const c = ch.centre(k), n = naturalForest(c.lat, c.lon, ch.height[k], hashK(k) - .5);
      ch.setNatural('conifer', k, n.conifer); ch.setNatural('age', k, n.age);
      speed[k] = n.speed; natAge[k] = ch.getNatural('age', k);
    }
    // the country around a place, for the conifers that take the higher ground: mean land height of every chunk
    const rise = new Uint8Array(ch.count); for (let k = 0; k < ch.count; k++) rise[k] = Math.max(0, Math.min(255, Math.round(ch.height[k] / 4096 * 255)));
    const riseTex = new DataTexture(rise, ch.n, ch.n, RedFormat, UnsignedByteType);
    riseTex.magFilter = riseTex.minFilter = LinearFilter; riseTex.wrapS = riseTex.wrapT = ClampToEdgeWrapping; riseTex.needsUpdate = true;
    this.uniforms.tForestRise.value = riseTex;
    const model = album.forest = new Regrowth(ch, speed, natAge);
    let pending = true, acc = 0;
    const lay = () => { applyDemo(ch, p.get('forestDemo')); pending = true; };
    ch.onReset(lay);
    p.on(key => {
      if (key === 'forestDemo') { for (let k = 0; k < ch.count; k++) for (const name of ['forest', 'conifer', 'age']) ch.set(name, k, ch.getNatural(name, k)); lay(); }
      else if (key === 'regrow' && !pending) { model.rewind(); model.step(+p.get('regrow') || 0); }
    });
    lay();
    const time = { id: 'forestTime', update(dt) {
      if (pending) { pending = false; acc = 0; model.restart(); model.sync(); model.step(+p.get('regrow') || 0); return; }
      acc += dt; if (acc < .1) return;
      const years = album.shot ? 0 : acc * p.get('play') * YEARS_PER_SECOND; acc = 0;
      model.sync(); model.step(years);
    } };
    let trees = null;
    try { trees = await (await import('../layers/forest.js')).default(album); } catch (e) { console.warn('[album] trees failed:', e.message); }
    return [time, trees];
  },
};
