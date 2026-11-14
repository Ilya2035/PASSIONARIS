// ASPECT «Лес»: where the forest of a chunk stands, what it is made of, how old it is and how it looks. This file
// belongs to the part «Земля и лес»; the contract with the rest of the album is in docs/ALBUM-CHUNKS.md, the rules of
// the forest itself are in docs/album/forest.md.
//   forestCover(p)   → share of the pixel under canopy (the ground shader asks it first)
//   aspForest(p, L)  → paints the canopy over the ground colour L.col
// The state comes from the chunks: p.cA = (forest 0 felled .. 1 natural, share of conifers, age 0 young .. 1 old, swamp).
// The forest is a soft cover with height, painted on the ground: no trees stand on the land as things of their own
// (the owner, 13.11.2026: from the height of the map they were of the wrong size and of another colour than the
// forest under them). A small model here lets a felled chunk grow over again.
import { kmOf } from '../chunks.js';
import { wetAt as climateWet, treelineAt } from '../ground/climate.js';

// ---- the natural state: the world of 5000 BC, before anyone felled anything
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = v => Math.max(0, Math.min(1, v));
const hashK = k => { let x = Math.imul(k + 1, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
// the CPU twin of albumWet() in glsl.js, without its noise: 0 desert .. 1 Atlantic forest (ground/climate.js)
export const wetAt = (lat, lon, h) => climateWet(lat, lon, h);
// What the forest of a chunk is by nature, from its mean height, wetness and latitude. jit −.5 .. .5 varies neighbours.
//   conifer  share of conifers: the mountain belt (fir, mountain pine), the dry interior and the south (pines, juniper)
//   age      0 young .. 1 old: old forest where it is wet and mild; lower, younger wood where fire and drought return
//            and near the tree line
//   speed    how fast a felled chunk grows over again: 1 in mild wet country, slower in the dry and in the heights
export function naturalForest(lat, lon, h, jit = 0) {
  // (the mountain belt of conifers and the thin forest under the tree line follow that line, which is not the same everywhere)
  const wet = wetAt(lat, lon, h), tl = treelineAt(lat, lon), mont = ss(tl - 1250, tl - 400, h), dry = ss(.56, .36, wet), south = ss(42.5, 37.5, lat);
  return {
    conifer: clamp01(.06 + .82 * mont + (.5 * dry + .08 * south) * (1 - mont) + jit * .1),
    age: clamp01(.92 - .3 * ss(.5, .25, wet) - .35 * ss(tl - 550, tl + 50, h) + jit * .1),
    speed: (.55 + .65 * ss(.25, .8, wet)) * (1 - .5 * ss(tl - 750, tl + 50, h)),
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
    // the land chunks a chunk borders, each with its share of the common border: seeds come across the border
    this.nb = Array.from({ length: ch.count }, (_, k) => {
      const land = ch.links[k].filter(l => ch.kind[l.k] === 1), km = land.reduce((s, l) => s + l.km, 0);
      return land.map(l => [l.k, l.km / km]);
    });
    this.live = []; for (let k = 0; k < ch.count; k++) if (ch.kind[k] === 1) this.live.push(k);
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
        let near = 0; for (const [m, share] of nb[k]) near += F[m] * share;
        const seed = .02 + .12 * near;                               // seeds come from the forest around: the edge closes first
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
// A chunk takes the state of the band, the ring or the lot its middle falls in, so every edge runs along the natural
// outlines of the chunks. Distances below are in tens of km from the showcase point.
export function applyDemo(ch, id) {
  if (!DEMOS[id]) return;
  const [ox, oy] = kmOf(DEMO.lat, DEMO.lon), put = (k, forest, conifer, age) => {
    if (forest != null) ch.set('forest', k, forest); if (conifer != null) ch.set('conifer', k, conifer); if (age != null) ch.set('age', k, age);
  };
  const band = (dx, n) => Math.floor((dx + n * 1.5) / 3);            // n bands 30 km wide, west to east
  for (let k = 0; k < ch.count; k++) {
    if (!ch.kind[k]) continue;
    const c = ch.centre(k), dx = (c.x - ox) / 10, dy = (c.y - oy) / 10;
    if (Math.abs(dx) > 9.5 || Math.abs(dy) > 9.5) continue;
    if (id === 'kinds') { const b = band(dx, 3); if (b >= 0 && b < 3) put(k, 1, [0, .5, 1][b], .85); }
    else if (id === 'density') { const b = band(dx, 4); if (b >= 0 && b < 4) put(k, [.2, .45, .7, 1][b], .15, .85); }
    else if (id === 'age') { const b = band(dx, 5); if (b >= 0 && b < 5) put(k, [0, .3, 1, 1, 1][b], .15, [0, .04, .3, .65, 1][b]); }
    else if (id === 'clearing') { const d = Math.hypot(dx, dy); if (d < 4) put(k, ss(2.3, 3.6, d), null, null); }
    else if (id === 'mosaic' && Math.abs(dx) <= 7.5 && Math.abs(dy) <= 7.5) {
      const a = hashK(k), b = hashK(k + 7919), f = hashK(k + 104729);
      put(k, f < .22 ? .3 : f < .4 ? .65 : 1, [0, .5, 1][Math.floor(a * 3)], .2 + .8 * b);
    }
  }
}

// ---- the rules of the forest in GLSL. They read what the ground shader worked out about the place: gRise (the mean
// height of the land around, m) and gTreeline (the height at which trees stop here, m).
export const FOREST_RULES = /* glsl */`
float albumTreeline(float n1) { return gTreeline + (n1 - .5) * 260.; }
// share of the ground under trees before patchiness: closed forest where wet, open woodland where dry
float albumForestShare(float wet, float hl, float slope, float n1) {
  float steep = smoothstep(.62, 1.05, slope), tl = albumTreeline(n1);
  float fc = smoothstep(.34, .58, wet) * (1. - smoothstep(tl - 180., tl + 40., hl)) * (1. - steep);
  return max(fc, smoothstep(.20, .34, wet) * .38 * (1. - steep) * (1. - smoothstep(tl - 650., tl - 250., hl)));
}
// How closed the canopy of a stand is by nature: an open woodland of single trees over grass where it is dry (the
// dehesa of evergreen oak), crown against crown where it is wet.
float albumClosure(float wet) { return mix(.40, 1., smoothstep(.33, .58, wet)); }
// The natural forest is patchy: a noise of two sizes, 7 and 1 km, against the share of the ground the trees take.
float albumPatch(float n2, float n3) { return n2 * .65 + n3 * .35; }
// the edge of a stand is roughened by a finer, turned noise, so that the lattice of the patch noise never shows
float albumRough(vec2 pk) { return (vnoise(mat2(.8, -.6, .6, .8) * pk / .63 + 23.) - .5) * .14; }
// how deep inside the natural forest a place is (> 0) or how far outside (< 0)
float albumMargin(float fc, float k, float pat) { return fc * k - pat * .9 + .05; }
float albumCover(float fc, float k, float pat) { return smoothstep(-.10, .10, albumMargin(fc, k, pat)); }
// From on high a wood has no crisp outline, and the patches of a kilometre must not show at all: the noise of 1 km
// is a lattice of squares, and an open woodland drawn by it speckled the dry plateau with little blocks (the map
// from 150 km up, 14.11.2026). So the edge of a stand widens with the size of a pixel (albumSoft), and the noise of
// 1 km leaves the patches as the camera rises (albumFine): from afar the woods are large soft patches of the 7 km noise.
float albumSoft(float px) { return .10 + min(px * 1.6, .22); }
float albumFine(float n3, float px) { return mix(.5, n3, smoothstep(.09, .03, px)); }
// The order in which a chunk loses its stands as it is felled, 0 last .. 1 first, spread about evenly over the ground.
// The weak stands go first (the patch noise), in shapes of their own that follow no lattice: three noises of 1.9,
// 0.7 and 0.3 km, two of them turned. px: km per pixel, the small noises fade out with distance (0 = keep all).
float albumOrderOwn(vec2 pk, float px) {                           // the three noises of its own
  vec2 q = mat2(.8, -.6, .6, .8) * pk;
  float b = px < .35 ? mix(.5, vnoise(q.yx / .7 + 7.), smoothstep(.35, .15, px)) : .5, c = px < .15 ? mix(.5, vnoise(pk / .31 + 3.), smoothstep(.15, .06, px)) : .5;
  return vnoise(q / 1.9 + 31.) * .275 + b * .165 + c * .11;
}
float albumOrder(float pat, float own) { return smoothstep(.28, .70, pat * .45 + own); }
// Felling. The state of a chunk says how much of its natural forest stands (have, 0 .. 1). Half of a loss is whole
// stands, taken in the order above. The other half is the canopy of what is left opening up. Together the ground
// under canopy is the natural cover times have.
//   x  share of the ground under canopy     y  how deep inside the standing forest (for the age of its edge)
// order: albumOrder() of the place (anything when have is 1); fade: 1 near, 0 where the noises have faded with
// distance and the stands melt into their mean
// soft: half the width of the edge of a stand, in the units of the margin — albumSoft(px)
vec2 albumStand(float fc, float k, float pat, float order, float have, float fade, float soft) {
  float m = albumMargin(fc, k, pat), a = sqrt(have), left = a * 1.12 - .06 - order;
  return vec2(smoothstep(-soft, soft, m) * mix(a, smoothstep(-.06, .06, left), fade) * a, min(m, left + step(.999, have)));
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
  float w = smoothstep(.5, .75, wet), south = smoothstep(42.5, 37.5, lat), mont = smoothstep(gTreeline - 1350., gTreeline - 550., hl);
  // broadleaf: grey-olive evergreen oak where dry, fresh green where wet; cooler in the mountains, warmer in the south
  vec3 broad = mix(vec3(.20, .27, .10), vec3(.105, .235, .085), w);
  broad = mix(broad, vec3(.085, .215, .105), mont * .45);
  broad = mix(broad, broad * vec3(1.14, 1.02, .80), south * .5);
  // conifers: the warm green pine of the dry south, dark blue-green fir and mountain pine higher up and in the wet
  vec3 conif = mix(vec3(.13, .22, .085), vec3(.085, .20, .118), max(mont, w * .8));
  conif = mix(conif, vec3(.07, .165, .115), smoothstep(gTreeline - 450., gTreeline, hl) * .5);
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
uniform float uForestVol;   // the height of the canopy as it is drawn: 0 flat paint, 1 the usual
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
// (roughened where an edge of the natural forest is near), how far the noises of felling have faded, the own noises
// of the felling order, the stand, and how much of the land here is under fields (setFarm; 0 where no forest could stand)
float fFc, fPat, fFade, fOwn, fFarm; vec2 fStand;
// What people and the dryness of the place leave of a stand. No forest on ploughed land and among houses: where the
// chunk of 1 km² is under fields (farm: the state of the part «Поселения», setFarm) the forest is cleared whole, not
// furlong by furlong — fields with trees standing in them are what the owner asked not to see. The edge of a clearing
// is ragged like any edge of the forest: the patch noise moves it in and out. Where the land around is ploughed only
// here and there, the fields are drawn only while their furlongs can be told (aspSettle); the clearing comes and goes
// with them, or every village would be a pale speck in the forest. By nature a dry stand is open: single crowns over grass.
// people: built and ploughed shares of the natural cell (p.cC.rg).
// (These helpers take the few numbers they need, not the pixel as a whole: handing the whole Px to one more function
// was what slowed the ground shader down by a half — see docs/album/ground.md, «Скорость».)
float forestKeep(float farm, float pat, float px, vec2 people, float wet) {
  float seen = people.y >= .12 ? 1. : mix(smoothstep(.075, .045, px), 1., smoothstep(.03, .12, people.y));
  return (1. - smoothstep(.04, .2, farm * (.45 + 1.1 * pat)) * seen) * (1. - smoothstep(.04, .25, people.x)) * albumClosure(wet);
}
// On steep ground a wood opens up: single trees on the ledges among the rock, none on a wall. The slope is that of
// the pixel (its normal), with the ribs and gullies the height data cannot hold: the wood runs up the gullies and
// leaves the ribs bare. (A wood used to end on a line of the smooth slope of the data — a grey oval of rock with a
// crisp rim in the middle of the forest, like a sticker.)
float forestSteep(vec3 n) { return 1. - .92 * smoothstep(.80, 1.35, length(n.xy) / (max(n.z, .05) * uExag * uShade)); }
// The stand at another point near this one — a step toward the sun, or where the eye sees the top of the canopy. The
// patch noise is asked again there; the own noises of the felling order are taken as they are here, which is close
// enough over a fifth of a km. (Reading the change off the screen with dFdx was tried: at close range it speckles
// the edges.)
// farm: how much of the land there is under fields (setFarm); have: p.cA.r; people: p.cC.rg.
float forestNear(vec2 q, float farm, float px, float have, vec2 people, float wet) {
  float ps = albumPatch(mix(.5, fbm(q / 7.3 + 5.), smoothstep(5., 1.5, px)), albumFine(vnoise(q / 1.1), px));
  if (px < .5) ps += albumRough(q) * smoothstep(.5, .2, px) * smoothstep(.3, .16, abs(albumMargin(fFc, uForestK, ps)));
  return albumStand(fFc, uForestK, ps, albumOrder(ps, fOwn), have, fFade, albumSoft(px)).x * forestKeep(farm, ps, px, people, wet);
}
float forestCover(Px p) {
  float have = p.cA.r; fOwn = .275;
  fFc = albumForestShare(p.wet, p.hl, p.slope, p.n1); fPat = albumPatch(p.n2, albumFine(p.n3, p.px)); fFade = smoothstep(1.2, .5, p.px);
  if (p.px < .5) fPat += albumRough(p.pk) * smoothstep(.5, .2, p.px) * smoothstep(.3, .16, abs(albumMargin(fFc, uForestK, fPat)));   // fades in toward the edge: no step in the noise
  if (have < .999 && have > .001 && fFade > 0.) fOwn = albumOrderOwn(p.pk, p.px);
  fStand = albumStand(fFc, uForestK, fPat, albumOrder(fPat, fOwn), have, fFade, albumSoft(p.px));
  fFarm = 0.; if (fStand.x > .003) fFarm = setFarm(p.pk);
  return fStand.x * forestKeep(fFarm, fPat, p.px, p.cC.rg, p.wet) * forestSteep(p.n);
}

void aspForest(Px p, inout Land L) {
  float px = p.px, dens = L.cover, have = p.cA.r, fc = fFc, own = fStand.x * forestKeep(fFarm, fPat, p.px, p.cC.rg, p.wet) * forestSteep(p.n); vec2 pk = p.pk;   // own: what forestCover() answered, before the swamp and the fields
  if (fc < .003 && dens < .003) return;                              // nothing grows here: too dry, too steep, too high

  // ---- felled ground: where the natural forest of the chunk no longer stands. Pale grass and stumps; bare earth and
  // slash where the chunk was cut clean; brush comes up as the forest of the chunk returns
  if (have < .995) {
    float cut = (albumCover(fc, uForestK, fPat) - fStand.x) * (1. - clamp(p.cC.g * 1.6 + p.cC.r * 2., 0., 1.));
    if (cut > .01) {
      vec3 cg = mix(vec3(.55, .50, .29), vec3(.43, .48, .21), smoothstep(.35, .65, p.wet));
      cg = mix(cg, vec3(.50, .42, .30), (1. - smoothstep(0., .3, have)) * (.35 + .4 * p.n3));
      L.col = mix(L.col, cg * (.92 + .16 * p.n3), cut * .6);
      float bf = smoothstep(.05, .012, px);
      if (bf > 0.) { vec4 b = crowns(pk / .028 + 9.); L.col = mix(L.col, vec3(.22, .31, .13), cut * bf * .7 * step(b.w, .1 + .5 * have) * smoothstep(.42, .22, b.z)); }
    }
  }

  // ---- the same question a step toward the sun: a lit rim and cast shade
  // (an edge is near: the margin of the stand itself, or the fields of a clearing)
  float coverS = dens, edgy = step(.02, have) * max(step(abs(fStand.y), .34), step(.004, fFarm) * step(fFarm, .5)), part = (own > .001 ? min(dens / own, 1.) : 1.) * forestSteep(p.n);   // (the stand a step away is taken on the slope of this place)
  if (px < .7 && edgy > 0.) coverS = mix(dens, forestNear(pk + p.sd * .22, fFarm, px, have, p.cC.rg, p.wet) * part, smoothstep(.7, .4, px));   // (the fields as they are here: near enough)
  // ---- the canopy has height. Seen at a slant, its top lies toward the eye from the ground it stands on: it hides
  // the ground behind the far edge of a wood, and at the near edge the flank of the wood shows under it. hc: the
  // height of the canopy as drawn, km; vs: how far toward the eye its top is seen
  float vol = uForestVol * smoothstep(.06, .025, px), flank = 0.;
  vec2 vs = vec2(0.);
  if (vol > 0.) {
    vs = p.V.xy / max(p.V.z, .34) * (.07 * vol * (.45 + .55 * smoothstep(.1, .7, p.cA.b)));
    if (edgy > 0. && dot(vs, vs) > px * px * .25) {
      float top = forestNear(pk + vs, fFarm > .004 ? setFarm(pk + vs) : 0., px, have, p.cC.rg, p.wet) * part;   // the edge of a clearing is an edge too: the fields are asked there
      flank = clamp(dens - top, 0., 1.); dens = top;
    }
  }
  if (dens < .003 && coverS < .003 && flank < .003) return;

  // ---- what stands here: kind and age of the forest at this place, from the state of the chunk
  float st = px < 2.5 ? mix(.5, vnoise(pk / 2.6 + 11.), smoothstep(2.5, 1., px)) : .5, tree = st * .6 + p.n2 * .4;
  vec2 nh = p.n.xy / max(length(p.n.xy), 1e-4);
  float rel = (p.hl - gRise) / 300.;
  float con = albumConifer(p.cA.g, st, p.n2, rel, -nh.y * smoothstep(.05, .3, p.slope), p.slope);
  float age = albumAge(p.cA.b, fStand.y, st), ya = smoothstep(.1, .5, age), oa = smoothstep(.55, 1., age);

  // ---- the forest reads as moss: tufts of three sizes, each lit on its sunny side; they fade out one by one with
  // distance. Young growth is fine and even, old forest has large crowns and an uneven canopy; conifers are sharper
  // and tighter than broadleaf. Where the canopy is not closed — at an edge, in a thinned stand, in brush — the
  // crowns stand one by one with ground between them instead of fading.
  float f1 = smoothstep(.055, .015, px), f2 = smoothstep(.2, .05, px), f3 = smoothstep(.9, .25, px);
  float tuft = 0., tone = .5, litc = 0., k1 = con, k2 = con, m1 = dens, m2 = dens; vec2 pkc = pk + vs; vec4 w1 = vec4(0., 0., 9., 0.);
  if (dens > .01) {
    if (f1 > 0.) {
      vec4 w = crowns(pkc / .045); float a = f1 * mix(1.3, .9, oa); k1 = step(fract(w.w * 7.31), con); w1 = w;
      tuft += a * .45 * mix(1. - w.z, 1.2 - 1.5 * w.z, k1); litc += a * .55 * (dot(normalize(vec3(-w.xy * mix(2.4, 3.6, k1), 1.)), uSun) - uSun.z); tone = mix(tone, w.w, f1 * .5);
      if (dens < .985) m1 = crownMask(w, dens);
    }
    if (f2 > 0.) {
      vec4 w = crowns(pkc / .14 + 3.1); float a = f2 * mix(.25, 1., ya) * (1. + .3 * oa); k2 = step(fract(w.w * 7.31), con);
      tuft += a * .35 * mix(1. - w.z, 1.15 - 1.35 * w.z, k2); litc += a * .4 * (dot(normalize(vec3(-w.xy * mix(2., 3., k2), 1.)), uSun) - uSun.z); tone = mix(tone, w.w, min(a, 1.2) * .42);
      if (dens < .985) m2 = crownMask(w, dens);
    }
    if (f3 > 0.) {
      vec4 w = crowns(pkc / .62 + 7.7); float a = f3 * mix(.12, 1., ya) * (1. + .4 * oa) * (1. - .3 * con);
      // (the tone of a large tuft is strongest at its middle and fades toward its rim: a tone that filled the whole
      // cell showed the cells themselves — polygons of a kilometre with straight borders all over the canopy)
      tuft += a * .3 * (1. - w.z); litc += a * .32 * (dot(normalize(vec3(-w.xy * 1.6, 1.)), uSun) - uSun.z); tone = mix(tone, w.w, min(a, 1.2) * .5 * smoothstep(.62, .25, w.z));
    }
  }
  float kind = mix(mix(con, k2, f2 * .75), k1, f1);                  // the kind of the crown itself where crowns can be told apart
  // Where the canopy is not closed the crowns stand one by one, and near the ground they are always the small ones
  // (45 m). The large tufts (140 m) used to take over in old forest: a thinned old stand then stood as a handful of
  // round balls, which read as the 3D trees that are gone (the lead, on the coast below Barcelona, v0.6.67). The
  // large ones remain where the small can no longer be told, between 40 and 70 km.
  float mask = mix(dens, mix(m2, m1, f1), smoothstep(.07, .03, px));
  vec3 tint = albumForestTint(kind, age, p.wet, p.hl, p.ll.x, tree, uSeason * (.55 + .45 * p.n3));
  tint = mix(tint, vec3(.50, .44, .16), smoothstep(.93, .99, tone) * .4 * (1. - kind) * ya);       // a crown gone yellow here and there
  float ta = mix(.2, .46, ya) * (1. + .25 * oa);                     // how much one crown differs from the next
  vec3 canopy = tint * (1.03 - .5 * ta + ta * tone) * (.86 + .5 * tuft + .9 * litc * p.day);
  // rim and shade grow with the height of the stand; the ground between the crowns of an open stand is mostly in the sun
  float tall = .3 + .7 * ya, rim = clamp(mask - coverS, 0., 1.) * tall, castS = clamp(coverS - mask, 0., 1.) * coverS * tall;
  // every crown of an open stand throws its own shade on the grass, a crown's height away from the sun: the nearest
  // crown is known already (w1), its shade is the same round shape moved off
  if (vol > 0. && f1 > 0. && dens > .01 && dens < .985) {
    vec4 ws = vec4(w1.xy, length(w1.xy + (vs - p.sd * (.06 * vol)) / .045), w1.w);
    castS = max(castS, crownMask(ws, dens) * (1. - mask) * f1 * .8);
  }
  vec3 under = L.col * (1. - .5 * castS * p.day);
  // the flank of a wood: trunks and the dark under the crowns; lighter when the sun stands behind the eye
  if (flank > .003) under = mix(under, tint * mix(.34, .78, clamp(dot(normalize(vs + 1e-5), p.sd) * .5 + .5, 0., 1.) * p.day) * (.9 + .2 * tone), flank * tall);
  L.col = mix(under, canopy * (1. + .35 * rim * p.day), mask);
  L.cover = mask;
}`;

const NEAR = { lat: 43.2, lon: -4.85 };   // Picos de Europa: broadleaf valleys, conifers above, bare summits
const demoCam = (h, tilt = 45, heading = 0, dLat = 0, dLon = 0) => ({ lat: DEMO.lat + dLat, lon: DEMO.lon + dLon, h, tilt, heading });
const PLAIN = { towns: 0, labels: 0, roadsOn: 0 };
export default {
  id: 'forest', title: 'Лес', glsl: GLSL, uniforms: { uForestVol: { value: 1 } },
  params: [
    { key: 'forest', label: 'Густота леса', group: 'scale', min: 0, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uForestK' },
    { key: 'trees', label: 'Высота леса', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×', zero: 'плоский' },
    { key: 'forest3d', label: 'Объём леса', group: 'layers', type: 'toggle', value: 1 },
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
    { id: 'forest-seam', group: 'Лес', title: 'Стык чанков: соседи с разным лесом', note: 'У каждого чанка своё случайное состояние: вид леса, возраст, сколько стоит. Очертаний чанков на картинке не видно: лес меняется куртинами, как в природе.', p: { forestDemo: 'mosaic', ...PLAIN }, cam: demoCam(120, 30) },
    { id: 'forest-seam-grid', group: 'Лес', title: 'Тот же стык с границами чанков', note: 'Те же чанки с их настоящими очертаниями. Наведите курсор на чанк: внизу видно его состояние. Перемена леса идёт не по линиям границ, а куртинами.', p: { forestDemo: 'mosaic', grid: 1, chunkInfo: 1, ...PLAIN }, cam: demoCam(120, 30) },
    { id: 'forest-3d', group: 'Лес', title: 'Лес с 20 км: полог с высотой', note: 'Природный лес Пикос-де-Эуропа. Отдельных деревьев нет: лес — мягкий покров того же цвета, что и издалека. У него есть высота: у ближнего края виден бок леса, дальний край закрывает землю за собой, от крон на траву падает тень.', p: { forest3d: 1 }, cam: { ...NEAR, h: 22, tilt: 55, heading: 150 } },
    { id: 'forest-paint', group: 'Лес', title: 'Лес с 20 км без высоты', note: 'Тот же вид с выключенным «Объёмом леса»: лес лежит на земле плоским рисунком.', p: { forest3d: 0 }, cam: { ...NEAR, h: 22, tilt: 55, heading: 150 } },
    { id: 'forest-open', group: 'Лес', title: 'Редколесье сухого края с 20 км', note: 'Дубравы Эстремадуры: кроны стоят по одной над выгоревшей травой, у каждой своя тень. Чем суше место, тем реже лес; в полях и у домов его нет.', p: {}, cam: { lat: 39.25, lon: -6.3, h: 20, tilt: 45, heading: 0 } },
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
    const model = album.forest = new Regrowth(ch, speed, natAge);
    let pending = true, acc = 0;
    const lay = () => { applyDemo(ch, p.get('forestDemo')); pending = true; };
    ch.onReset(lay);
    // the height of the canopy as drawn: the two knobs that used to turn the 3D trees on and size them
    const vol = () => { this.uniforms.uForestVol.value = p.get('forest3d') && !['paper', 'atlas', 'night'].includes(p.get('look')) ? +p.get('trees') || 0 : 0; };
    vol();
    p.on(key => {
      if (key == null || key === 'forest3d' || key === 'trees' || key === 'look') vol();
      if (key === 'forestDemo') { for (let k = 0; k < ch.count; k++) for (const name of ['forest', 'conifer', 'age']) ch.set(name, k, ch.getNatural(name, k)); lay(); }
      else if (key === 'regrow' && !pending) { model.rewind(); model.step(+p.get('regrow') || 0); }
    });
    lay();
    const time = { id: 'forestTime', update(dt) {
      if (pending) { pending = false; acc = 0; model.restart(); model.sync(); model.step(+p.get('regrow') || 0); return; }
      acc += dt; if (acc < (p.get('play') > 2 ? .1 : .25)) return;   // a few times a second is enough for a forest
      const years = album.shot ? 0 : acc * p.get('play') * YEARS_PER_SECOND; acc = 0;
      model.sync(); model.step(years);
    } };
    // (album.layers.forest stays for those who asked it how high the tallest crown stands: nothing stands now, top is 0)
    return [time, { id: 'forest', top: 0, count: () => 0 }];
  },
};
