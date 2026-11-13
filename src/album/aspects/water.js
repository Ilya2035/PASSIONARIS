// ASPECT «Вода»: the sea, the lakes and the rivers; ice on them, snow on the ice, thaw. This file, layers/rivers.js,
// layers/lakes.js and layers/freeze.js belong to the water work; the contract with the rest of the album is in
// docs/ALBUM-CHUNKS.md, the states and rules of the water are in docs/album/water.md.
//   aspWater(p) → the finished, lit colour of the water at this pixel (linear light, before air and tone curve)
// The state comes from the chunks, p.cB:
//   r  ice         0 open water .. 1 solid ice with pressure ridges
//   g  snow        snow lying on the ice (on the land the ground shader draws it)
//   b  flood       not the water's: water over the land, read by the swamps
//   a  spareB      the state of the sea: 0 calm .. 1 storm with whitecaps
// Melt water on thawing ice has no channel in the chunks, and the ground shader has no texture unit left for a
// texture of the water's own (it uses all 16), so it is worked out from the ice of the chunk and two numbers for the
// whole sea, uWaterThaw, kept by the freeze model (layers/freeze.js).
// One water for everything: WATER_CORE is the same code in the ground shader (the sea), in the lakes and in the rivers.
import { Vector2, DataTexture, RedFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping } from 'three';
import { COAST_N, COAST_X0, COAST_Y0, COAST_KM } from '../water/courses.js';
import { lightUniforms } from '../glsl.js';

// Ice in retreat stands in melt water once it is no longer whole: none at MELT_TOP of ice and more, all of it MELT_SPAN
// lower. The freeze model and the shader use the same two numbers.
export const MELT_TOP = .92, MELT_SPAN = .14;
// uWaterThaw.x: a thaw lies on all the ice, 0..1. uWaterThaw.y: the ice is in retreat, 0..1.
export const WATER_UNIFORMS = { uWaterThaw: { value: new Vector2(0, 0) } };
// The water's one texture in the ground shader: where the shore is a beach (water/courses.js, COAST_*). One empty
// texel until the file is read.
const coastTex = (data, n) => { const t = new DataTexture(data, n, n, RedFormat, UnsignedByteType); t.magFilter = t.minFilter = LinearFilter; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true; return t; };
export const COAST_UNIFORMS = { tCoast: { value: coastTex(new Uint8Array(1), 1) } };
async function loadCoast() {
  try {
    const r = await fetch('assets/album/water/coast.bin.gz'); if (!r.ok) return;
    const u = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if (u.length === COAST_N * COAST_N) COAST_UNIFORMS.tCoast.value = coastTex(u, COAST_N);
  } catch { /* no beaches then: the shore is drawn without them */ }
}

export const WATER_CORE = /* glsl */`
uniform vec2 uWaterThaw;
const vec2 W_WIND = vec2(.83, -.558), W_WINX = vec2(.558, .83);    // the wind blows toward the east-south-east; W_WINX lies across it

// what the water is told about a pixel
struct Wtr {
  vec2 pk; float px;       // flat km (east, north); km per screen pixel
  float depth;             // metres of water under the surface
  float surf;              // km to the waterline of a real shore where surf breaks; large when there is none
  vec3 V;                  // direction to the eye (east, north, up)
  float day, sh;           // 0 night .. 1 day; 0 in the shadow of relief .. 1 lit
  vec3 sunCol, skyCol;     // light of the sun and of the sky
  vec4 cB;                 // the chunk: ice, snow, (flood: not the water's), state of the sea
  int kind;                // 0 sea, 1 lake, 2 river
};

// The water draws fine patterns far from the origin of the km grid, where a hash with large multipliers runs out of
// float precision and repeats itself. These keep their randomness there: use them, not the shared value noise.
float wHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wNoise(vec2 p) {
  vec2 i = floor(p), u = fract(p); u = u * u * (3. - 2. * u);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
float wFbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * wNoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// value noise with its slope: x = value 0..1, yz = d/dp
vec3 wNoiseD(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f), du = 6. * f * (1. - f);
  float a = wHash(i), b = wHash(i + vec2(1, 0)), c = wHash(i + vec2(0, 1)), d = wHash(i + vec2(1, 1)), k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * vec2(b - a + k * u.y, c - a + k * u.x));
}
// cells of a jittered lattice (floes, pancakes): x = 0 on the border between two cells, growing inward; y = a random
// number of the cell; zw = from the pixel to the centre of its cell
vec4 wCells(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.), bi = vec2(0.); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + hash22(i + g) - u; float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; best = r; bi = i + g; } else if (dd < d2) d2 = dd;
  }
  return vec4(sqrt(d2) - sqrt(d1), wHash(bi + 7.7), best);
}
// a train of waves L km long running along dir (in wind coordinates): xy = slope, z = height −1 trough .. 1 crest,
// w = how high the waves of this group are (about 1). Two slow noises bend the crests and gather the waves into
// groups, so the sea never looks ruled.
vec4 wTrain(vec2 wq, vec2 dir, float L, float t, float seed) {
  float n1 = wNoise(wq / vec2(L * 4.6, L * 1.9) + seed), n2 = wNoise(wq / (L * 9.3) + seed + 5.);                // crests are short across the wind
  float ph = dot(wq, dir) * 6.2832 / L - t * 1.1 * sqrt(.05 / L) + n1 * 7. + n2 * 15., amp = .1 + .9 * min(n1 * n2 * 4., 2.2);
  return vec4(dir * cos(ph) * amp, sin(ph), amp);
}
// colour of the water body by depth, as seen on screen: pale over sand, turquoise shallows, deep blue
vec3 waterBody(float depth, int kind) {
  vec3 c;
  if (kind == 0) {
    c = mix(vec3(.16, .47, .50), vec3(.05, .28, .42), smoothstep(0., 15., depth));          // turquoise over the shallows only
    c = mix(c, vec3(.032, .16, .30), smoothstep(10., 90., depth));
    c = mix(c, vec3(.022, .11, .24), smoothstep(80., 1800., depth));
    c = mix(vec3(.44, .61, .53), c, smoothstep(0., 1.5, depth));                            // the bottom shows only in the last metre
  } else {                                                          // fresh water: greener, darker, the bottom shows only at the edge
    if (kind == 1) c = mix(vec3(.13, .42, .42), vec3(.04, .215, .31), smoothstep(0., 16., depth));
    else c = mix(vec3(.27, .37, .30), vec3(.085, .195, .21), smoothstep(0., 5., depth));     // a river carries silt: duller and greener than a lake
    c = mix(kind == 1 ? vec3(.50, .58, .44) : vec3(.47, .49, .37), c, smoothstep(0., kind == 1 ? 3.5 : 1.5, depth));
  }
  return c;
}

vec3 waterLit(Wtr w) {
  vec2 pk = w.pk; float px = w.px, t = uTime;
  float ice = w.cB.r;
  vec2 wq = vec2(dot(pk, W_WIND), dot(pk, W_WINX));                 // km along and across the wind
  float sunUp = max(uSun.z, 0.);

  // ---- the state of the surface: 0 calm .. 1 storm. Gusts and slicks make it uneven; ice calms it.
  float st = w.kind == 0 ? w.cB.a : (w.kind == 1 ? .2 : .1);
  float gust = px < 4. ? mix(.5, wNoise(pk / 6.2 + vec2(t * .012, t * .005)) * .64 + wNoise(pk / 2.3 + vec2(t * .02, -t * .008) + 9.) * .36, smoothstep(4., 1.5, px)) : .5;
  st = clamp(st * (.45 + 1.1 * gust) + (gust - .5) * .1, 0., 1.) * (1. - smoothstep(.03, .4, ice));

  // ---- waves: three sizes drawn out across the wind, each fading into roughness once it is smaller than a pixel
  float s0 = .012 + .075 * smoothstep(0., .5, st), s1 = .11 * smoothstep(.2, .75, st), s2 = .09 * smoothstep(.5, 1., st);
  float f0 = 1. - smoothstep(.008, .019, px), f1 = 1. - smoothstep(.028, .062, px), f2 = 1. - smoothstep(.13, .29, px);
  vec2 wn = vec2(0.), crest = vec2(0.);
  if (f0 > 0.) wn += f0 * s0 * wTrain(wq, vec2(.946, .326), .075, t, 1.3).xy;
  if (f1 > 0. && s1 > .002) { vec4 tr = wTrain(wq, vec2(.978, -.208), .24, t, 7.3); wn += f1 * s1 * tr.xy; crest = tr.zw; }
  if (f2 > 0. && s2 > .002) wn += f2 * s2 * wTrain(wq, vec2(.996, .087), 1.1, t, 3.1).xy;
  float hid = (1. - f0) * s0 + (1. - f1) * s1 + (1. - f2) * s2;      // waves the pixel cannot show: they widen the glint instead
  vec3 nW = normalize(vec3(-(W_WIND * wn.x + W_WINX * wn.y) * 1.5, 1.)), Rv = reflect(-w.V, nW);

  // ---- the water itself, the sky in it, the sun on it
  // the sea charts are coarse: a little unevenness turns their steps into the patchy sandbanks of a real shoal
  float dC = w.depth;
  if (w.kind == 0 && dC < 30. && px < 1.5) dC = max(dC + (wNoise(pk / 1.3 + 3.3) - .5) * 5. * smoothstep(0., 3., dC) * smoothstep(30., 12., dC) * smoothstep(1.5, .5, px), 0.);
  vec3 body = pow(waterBody(dC, w.kind), vec3(2.2)) * 1.6;
  body = mix(body, body * vec3(.74, .92, .9) + vec3(.004, .012, .012), smoothstep(.45, 1., st) * .6);   // a storm sea is duller and greener
  float fres = .02 + .98 * pow(1. - max(dot(nW, w.V), 0.), 5.), sp = max(dot(Rv, uSun), 0.);
  float vz = max(w.V.z, 0.), k1 = 1. - vz;                            // waves too small to see still turn the water toward the sky: the same mean as when they are drawn
  fres += .98 * k1 * k1 * k1 * (10. * (1. - vz * vz) + 2.5 * k1 * vz) * hid * hid * .9;
  vec3 skyRef = mix(vec3(.58, .72, .90), vec3(.22, .40, .70), clamp(Rv.z, 0., 1.)) * (.25 + .75 * w.day);
  vec3 col = body * (w.skyCol * 1.5 + w.sunCol * max(dot(nW, uSun), 0.) * .75);
  float lobe = sqrt(clamp(hid * 3. + st * .2, 0., 1.));
  col = mix(col, skyRef, min(fres + .07 * st, 1.) * .7) + w.sunCol * pow(sp, mix(460., 20., lobe)) * mix(.7, .02, sqrt(lobe)) * w.sh;

  // ---- foam: whitecaps in a strong wind, surf where the bottom rises to a real shore
  float foam = 0., capAmt = smoothstep(.4, 1., st); capAmt *= capAmt;
  if (capAmt > .003) {
    foam = capAmt * .025;                                            // from afar: a sea a little paler
    float fcap = f1 * (1. - smoothstep(.018, .045, px));
    if (fcap > 0.) {                                                 // up close: the crests of the middle waves break, here and there
      float brk = wNoise(vec2(wq.x / .07 - t * .5, wq.y / .13) + 1.7) + (crest.y - 1.) * .16, th = mix(.93, .66, capAmt);
      float cap = smoothstep(.3, .8, crest.x) * smoothstep(th, th + .06, brk);
      cap += smoothstep(-.5, .4, crest.x) * smoothstep(th + .03, th + .2, brk) * .3;                           // foam left behind the crest
      foam = mix(foam, cap, fcap);
    }
  }
  if (w.surf < 2.) {
    float surge = .7 + .9 * st, wd = max(.02 * surge, px * 1.6);      // the white line never thinner than a pixel and a half
    float sf = smoothstep(wd, wd * .15, w.surf) * (.3 + .7 * wNoise(pk / .045 + t * .25)) * (.35 + .65 * smoothstep(.25, .6, wNoise(pk / .3 + t * .04)));
    sf += smoothstep(wd * 5., wd * 1.5, w.surf) * smoothstep(.55, .97, sin(w.surf / wd * 5.5 - t * 1.3 + wNoise(pk / .6) * 6.)) * .32 * smoothstep(.12, .03, px);   // rollers coming in
    foam = max(foam, sf * (1. - smoothstep(.15, .5, ice)));
  }
  col = mix(col, vec3(.94, .97, 1.) * (w.skyCol + w.sunCol * .8), clamp(foam, 0., 1.) * .75);

  // ---- ice. One number of the chunk runs through every stage: grease ice and slush → pancake ice → broken floes
  // with leads → a solid sheet → pressure ridges. The number is compared with slow noise, so in a chunk the weak goes
  // first: thin streaks of slush vanish before the floes, narrow leads close before wide ones.
  // The detail is the detail of the height it is seen from. From space: where the ice lies, the streamers eddies draw
  // out of its edge, great plates tens of km across with long leads between a few of them, and otherwise plain white.
  // From 200 km: floes a few km across in the loose pack. From 20 km: the pieces a floe is welded from, ridges, snow
  // drifts, the grain of pancake ice. Nothing of a finer level is drawn where it would be a mesh of small cracks.
  float iceA = 0.;
  if (ice > .004) {
    float sc = w.kind == 0 ? 1. : (w.kind == 1 ? .4 : .16);          // on lakes and rivers the ice breaks into smaller pieces
    vec2 q = pk / sc, qw = wq / sc, sun2 = normalize(uSun.xy + 1e-4); float pq = px / sc;
    // eddies bend the edge of the ice into streamers and long chains; the same slow field lets one part of a chunk freeze before another
    vec2 ed = (vec2(wNoise(q / 31. + 3.), wNoise(q / 31. + 17.)) - .5) * 36.;
    float big = pq < 30. ? wFbm((q + ed) / 15. + 31.) : .5, room = ice * (1. - ice);
    float a = clamp(ice + (big - .5) * 1.9 * room + (1. - smoothstep(0., 30., w.depth)) * .9 * room, 0., 1.);   // shallows freeze first
    vec3 direct = w.sunCol * sunUp * w.sh * 1.25, amb = w.skyCol;
    // melt water on the ice: a thaw wets all of it, unevenly; ice in retreat stands in water once it is no longer whole
    float melt = min(max(uWaterThaw.x * (.55 + .9 * big), uWaterThaw.y * clamp((${MELT_TOP} - ice) / ${MELT_SPAN}, 0., 1.)), 1.) * smoothstep(.04, .3, ice);

    // 1. grease ice and slush: matt belts drawn out by the wind, long ones from afar, fine streaks up close
    float gz = wNoise(vec2(qw.x / 21., qw.y / 2.8) + (q.yx + ed.yx) / 47. + 6.);
    if (pq < 1.2) gz = mix(gz, wFbm(vec2(qw.x / 3.1, qw.y / .55) + 3. + t * .004), .6 * (1. - smoothstep(.3, 1.2, pq)));
    float grease = smoothstep(-.15, .15, smoothstep(0., .2, a) * 1.3 - gz - .1);
    vec3 gc = mix(vec3(.17, .27, .35), vec3(.40, .50, .57), smoothstep(.3, .95, a)) + .05 * gz;         // dark slush thickens into grey young ice
    col = mix(col, pow(gc, vec3(2.2)) * (direct + amb), grease * .86);
    iceA = grease * .5;

    // 2. pancake ice: from any height a pale grain on the slush; only from the lowest heights the cakes themselves,
    // small, packed close, herded into rows by the wind
    float pA = smoothstep(.1, .36, a);
    if (pA > .002) {
      float fp = 1. - smoothstep(.017, .045, pq), pan = pA * .6, rim = 0., id = .5;
      if (fp > 0.) {
        vec4 c = wCells(q / .075 + 5.3);
        float d = length(c.zw), r = (.33 + .2 * fract(c.y * 7.31)) * (.7 + .3 * pA), aa = pq / .075 * 1.1 + .02;
        float row = wNoise(vec2(qw.x / .7, qw.y / .09) + 2.2);
        float disc = (1. - smoothstep(r - aa, r + aa, d)) * smoothstep(0., .1, pA * 1.6 - .1 - c.y * .5 - row * .7);
        rim = disc * smoothstep(r * .5, r * .92, d) * fp; id = mix(.5, fract(c.y * 3.7), fp);
        pan = mix(pan, disc, fp);
      }
      pan *= grease;
      vec3 pc = mix(vec3(.50, .60, .66), vec3(.66, .75, .80), id) + rim * vec3(.2, .16, .13);
      col = mix(col, pow(min(pc, vec3(.97)), vec3(2.2)) * (direct * (1. + rim * .2) + amb), pan);
      iceA = max(iceA, pan);
    }

    // 3. the pack
    float fA = smoothstep(.3, .64, a);
    if (fA > .002) {
      // great plates: the pack as it is seen from space. Long leads run between some of them — open water in a loose
      // pack, a strip of grey young ice once the cold has closed it.
      vec2 hq = q + (vec2(wNoise(q / 27. + 2.), wNoise(q / 27. + 9.)) - .5) * 26.;
      vec4 H = wCells(hq / 52. + 5.);
      float hKm = H.x * 52., plate = H.y - .5;
      float cracked = smoothstep(.5, .62, wNoise(q / 75. + 14.) + plate * .22);        // leads come in systems; between them the ice is whole
      float lwReal = mix(1.6, .45, smoothstep(.55, 1., a)), lw = max(lwReal, pq * 1.15), la = max(pq * .9, .015);
      float longLead = (1. - smoothstep(lw - la, lw + la, hKm)) * cracked * clamp(lwReal / (pq * 1.15), .45, 1.);  // a lead thinner than a pixel is a faint line
      float frozen = smoothstep(.84, .97, a);

      // floes a few km across, born one at a time; the leads between them narrow as the ice grows, and close
      vec2 fw = q + (vec2(wNoise(q / 2.9 + 5.), wNoise(q / 2.9 + 11.)) - .5) * 2.1;        // ragged outlines
      vec4 F = wCells(fw / 4.6 + 17.);
      float aa = clamp(pq / 4.6 * 1.3, .003, .6), tone = F.y;
      float lead = mix(.4, -.03, smoothstep(.38, .86, a)) + melt * .16;                   // half the width of the water between two floes
      float floe = smoothstep(lead - aa, lead + aa, F.x) * smoothstep(0., .12, fA * 1.3 - .12 - F.y);
      // from low down a young floe is seen to be pieces welded together, with slush between them
      float weld = smoothstep(.45, .82, a), f2 = 1. - smoothstep(.022, .06, pq);
      if (weld < .999) {
        float cake = 1. - (1. - weld) * .3;
        if (f2 > 0.) {
          vec4 G = wCells(fw / .62 + 3.);
          float l2 = mix(.26, -.03, weld) + melt * .1, a2 = clamp(pq / .62 * 1.3, .004, .6);
          cake = mix(cake, smoothstep(l2 - a2, l2 + a2, G.x), f2); tone = mix(tone, G.y, .5 * f2 * (1. - weld));
        }
        floe *= cake;
      }
      floe *= 1. - longLead * (1. - frozen);

      // the solid sheet: plain from afar. Only from low down the healed seams of its floes show, and the ridges
      // where they were driven together.
      float sheet = smoothstep(.76, .9, a), fb = 1. - smoothstep(.03, .075, pq), crack = 0., ridge = 0., side = 0.;
      if (sheet > 0. && fb > 0.) {
        crack = (1. - smoothstep(0., aa * 1.2 + .008, F.x)) * smoothstep(.5, .66, wNoise(q / 2.6 + 9.)) * sheet * fb;
        float rA = smoothstep(.86, 1., a) * fb, wR = .022 + .03 * wNoise(q / 1.1 + 2.);
        ridge = (1. - smoothstep(wR * .25, wR, F.x)) * smoothstep(.56, .74, wNoise(q / 3.7 + 40.) + rA * .1) * rA;   // here and there, never a closed net
        side = dot(normalize(F.zw + 1e-5), sun2);                     // > 0 on the flank of the ridge that faces the sun
      }
      float age = smoothstep(.35, .95, a);
      // bare ice: grey-blue when thin, pale blue when thick; every floe its own tone while the pack is loose, every
      // plate once it is one sheet
      vec3 fc = mix(vec3(.47, .60, .68), vec3(.76, .85, .90), clamp(age * .7 + tone * .34 * (1. - sheet * .8) + plate * .14 * sheet + (big - .5) * .3, 0., 1.));
      if (w.kind != 0) fc = mix(fc, vec3(.50, .70, .74), .3);           // lake and river ice is clearer and greener
      fc = mix(fc, vec3(.42, .55, .64), max(crack * .6, longLead * frozen * .85));
      fc = mix(fc, vec3(.94, .96, .98), ridge * .7);
      float shade = 1. + ridge * side * .5 * w.day;

      // thaw: the ice goes grey and wet, turquoise ponds stand on it, then holes open through it
      if (melt > .01) {
        float pn = pq < .5 ? mix(.5, wFbm(vec2(q.x * .8 + q.y * .6, q.y * .8 - q.x * .6) / .55 + 13.), smoothstep(.5, .12, pq)) : .5;
        float pond = smoothstep(-.05, .05, melt * .78 - pn + .1);
        fc = mix(fc, vec3(.55, .62, .66), melt * .65);
        fc = mix(fc, mix(vec3(.50, .73, .79), vec3(.20, .42, .55), smoothstep(.3, 1., melt) * smoothstep(.5, .25, pn)), pond * .92);
        floe *= 1. - smoothstep(.45, 1., melt) * smoothstep(.36, .26, pn);
      }
      // snow on the ice: from afar broad fields of it with bare ice between, and none on the young ice of a lead;
      // from low down drifts drawn out along the wind and banked against the ridges
      float sn = w.cB.g * (1. - smoothstep(0., .6, melt));
      if (sn > .004) {
        float fs = 1. - smoothstep(.028, .08, pq);
        vec3 d1 = fs > 0. ? wNoiseD(vec2(qw.x / 1.25, qw.y / .19) + 21.) : vec3(.5, 0., 0.);
        float blot = pq < 9. ? mix(.5, wFbm(q / 8.5 + 12.), smoothstep(9., 3., pq)) : .5;
        float snowM = smoothstep(-.12, .12, sn * 1.12 + ridge * .5 - (mix(.5, d1.x, fs * .8) * .48 + blot * .62) - .03 - longLead * frozen * .5) * smoothstep(.3, .52, a);
        fc = mix(fc, vec3(.93, .95, .99) * (.975 + .025 * tone + plate * .02), snowM);
        shade += snowM * (dot(W_WIND * d1.y / 1.25 + W_WINX * d1.z / .19, sun2) * .045 * fs - ridge * .2 * (1. - side)) * w.day;   // sastrugi lit from the sunny side
        shade = mix(shade, 1. + (shade - 1.) * .6, snowM);
      }
      vec3 hard = pow(fc, vec3(2.2)) * (direct * shade + amb) + w.sunCol * pow(max(dot(reflect(-w.V, vec3(0., 0., 1.)), uSun), 0.), 70.) * .12 * w.sh;
      col = mix(col, hard, floe);
      iceA = max(iceA, floe);
    }
  }

  if (uStyle == 2) col = mix(mix(vec3(.72, .84, .90), vec3(.50, .68, .82), smoothstep(0., 2500., w.depth)), vec3(.95, .97, .98), iceA * .85);
  else if (uStyle == 3) col = mix(mix(vec3(.70, .77, .80), vec3(.60, .69, .74), smoothstep(0., 1500., w.depth)), vec3(.93, .94, .93), iceA * .8);
  else if (uStyle == 6) col = mix(mix(vec3(.035, .05, .08), vec3(.02, .03, .05), smoothstep(0., 800., w.depth)) + vec3(.85, .68, .38) * pow(sp, 60.) * .25, vec3(.16, .19, .24), iceA * .8);
  return col;
}
`;

// ---- water that lies on the land: lakes and rivers. A sheet is a mesh drawn right after the ground and before the
// things that stand on it, with the same water (WATER_CORE), the same light and air. Its depth is written a little
// toward the eye (uPull, km; more where the eye looks at it aslant), so the trees, houses and roads that the land
// layers put where the water is stay hidden.
export const SHEET_VERT = /* glsl */`
uniform float uPull; varying vec2 vLL; varying vec3 vPos; varying vec2 vZW;
void sheetVertex(vec2 ll, float hKm) {
  vLL = ll; vPos = worldOf(ll, hKm);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
  // (a crown of height H hides the ground behind it for H / cos of the angle the eye looks down at: seen aslant, more)
  vec3 eye = normalize(cameraPosition - vPos); float aslant = 1. / max(dot(eye, normalize(vPos + vec3(0., RKM, 0.))), .3);
  vZW = (projectionMatrix * viewMatrix * vec4(vPos + eye * uPull * aslant, 1.)).zw;
}`;
export const SHEET_FRAG = /* glsl */`
uniform float uTime; varying vec2 vLL; varying vec3 vPos; varying vec2 vZW;
${WATER_CORE}
// flat km of this pixel and km per screen pixel: ask for them at the top of main(), before any branch
vec2 sheetPk() { return vec2(vLL.y * KM * COSREF, vLL.x * KM); }
float sheetPx(vec2 pk) { return (length(dFdx(pk)) + length(dFdy(pk))) * .7; }
// what the water must know about this pixel of a sheet, the way the ground shader tells it (depth is left to the
// caller). No screen derivatives in here, so it can be called after the cheap tests that throw a pixel away.
Wtr sheetWater(int kind, vec2 pk, float px) {
  Wtr w;
  vec3 up = normalize(vPos + vec3(0., RKM, 0.)), Vw = normalize(cameraPosition - vPos); float dl = radians(vLL.y - LON0);
  vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
  w.pk = pk; w.px = px; w.V = vec3(dot(Vw, east), dot(Vw, north), dot(Vw, up));
  w.day = albumDay(); w.sh = 1.; w.sunCol = albumSunCol(); w.skyCol = albumSkyCol(); w.cB = textureLod(tChunkB, chunkUV(pk), 0.);
  w.depth = 1.; w.surf = 1e3; w.kind = kind;
  return w;
}
// the ground beside the water (a beach, a bank), lit like the land: its colour as seen on screen
vec3 sheetGround(vec3 seen, vec3 n) { return albumLit(seen, n, .4 + .6 * normalize(n).z); }
// pull: 1 = the depth is written uPull km toward the eye, 0 = where the sheet really lies (a sheet that ends in open
// water fades its pull out there, or the finishing pass would shade the step in depth as a dark line)
void sheetOut(vec3 col, float alpha, float pull) {
  gl_FragColor = vec4(albumFinish(albumAir(col, vPos)), alpha);
  gl_FragDepth = mix(gl_FragCoord.z, clamp(vZW.x / vZW.y * .5 + .5, 0., 1.), pull);
}`;
export const sheetUniforms = album => {
  const T = album.terrain.u;
  return { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uTime: T.uTime, ...lightUniforms(T), ...album.chunks.uniforms, ...WATER_UNIFORMS, uPull: { value: .05 } };
};
// How far toward the eye a sheet writes its depth, km. A little, and more from higher up: the grid the ground is
// drawn with is coarser than the heights a sheet stands on, and the houses and roads must stay under the water.
// Nothing else stands on the land now (the forest is paint on the ground since v0.6.62); should a layer put
// something there again, it says how high in album.layers.forest.top, km, and the sheets are pulled over it.
// No more than needed: a sheet pulled too far would show through a ridge that stands in front of it.
export const SHEET_PULL = [.02, .0005];                            // km, and km for every km of camera height
export function sheetPull(album, cam) {
  const top = album.layers?.forest?.top;
  return Math.max(SHEET_PULL[0] + cam.s.h * SHEET_PULL[1], top > 0 ? top * 1.08 + .004 : 0);
}

const GLSL = /* glsl */`
${WATER_CORE}
uniform sampler2D tCoast;
// The shore: what the land is like where it meets the sea. Where OpenStreetMap knows a beach (tCoast) there is sand:
// wet and dark at the waterline, pale above, and behind a long beach on a low shore dunes with thin grass. On a
// rocky shore the beaches are small coves between headlands. Where there is no beach, dark wet rock at the
// waterline. The band is a few tens of metres wide, as in life; from high up a beachy shore keeps a pale rim.
// cover: the share under the crowns of the forest; no tree stands on the sand or within reach of the surf.
vec3 aspShore(Px p, vec3 ground, inout float cover) {
  if (p.hl > 14. || p.h < -2.) return ground;
  cover *= smoothstep(1.2, 3.8, p.hl);
  float beach = texture(tCoast, (p.pk - vec2(${COAST_X0}., ${COAST_Y0}.)) / ${COAST_KM}.).r;
  float d = p.hl / max(p.slope, .006);                                // metres to the waterline, from the height and the slope
  float near = smoothstep(.13, .035, p.px);                           // the band is drawn while it is about a pixel wide or more
  float rim = (1. - near) * beach * (1. - smoothstep(1., 6., p.hl)) * .55;
  if (near > 0.) {
    float cove = wNoise(p.pk / .42 + 7.) * .6 + wNoise(p.pk / 1.7 + 3.) * .4;
    float has = smoothstep(0., .22, beach * 1.5 + (cove - .56) * .7 * (1. - beach));     // a beachy shore is all beach, a rocky one has coves
    float width = mix(24., 100., beach) * (.7 + .6 * wNoise(p.pk / .9 + 11.));           // metres of sand above the water
    float sandBand = has * (1. - smoothstep(width * .7, width, d)) * (1. - smoothstep(.10, .24, p.slope));
    float dune = has * beach * smoothstep(width * .8, width * 1.3, d) * (1. - smoothstep(width * 2.5, width * 5., d)) * (1. - smoothstep(.02, .06, p.slope));
    float rockBand = (1. - has) * (1. - smoothstep(9., 26., d)) * smoothstep(.03, .09, p.slope);
    if (dune > .003) ground = mix(ground, mix(vec3(.82, .76, .58), vec3(.50, .54, .32), smoothstep(.35, .7, wNoise(p.pk / .045 + 2.) * .6 + wNoise(p.pk / .19 + 5.) * .4)), dune * .8 * near);
    if (rockBand > .003) ground = mix(ground, vec3(.35, .33, .30) * texDetail(tRock, p.pk, p.px, p.pdx, p.pdy), rockBand * .85 * near);
    if (sandBand > .003) ground = mix(ground, mix(vec3(.60, .54, .40), vec3(.93, .87, .70), smoothstep(3., 14., d)) * texDetail(tSand, p.pk, p.px, p.pdx, p.pdy), sandBand * near);
    cover *= 1. - near * max(sandBand, dune * .8);
  }
  return mix(ground, vec3(.84, .78, .60), rim);
}
vec3 aspWater(Px p) {
  Wtr w; w.pk = p.pk; w.V = p.V; w.day = p.day; w.sh = p.sh; w.sunCol = p.sunCol; w.skyCol = p.skyCol; w.cB = p.cB; w.kind = 0;
  w.px = (length(p.pdx) + length(p.pdy)) * .7;                       // measured along the ground: p.px jumps on the skirts between the levels of the grid
  w.depth = max(-p.h, 0.); w.surf = 1e3;
  w.cB.r *= inRegion(p.ll);                                         // the chunks end with the mapped region; no ice beyond it
  if (w.depth < 14.) {
    // Surf breaks only where the bottom, smoothed over half a kilometre, really rises to a shore, and only in a
    // narrow band at the waterline. On a flat floor that the height data fills with noise (the shoals of a delta)
    // the sea stays calm and clean.
    // (the coarse heights of the region alone: three plain look-ups half a km apart, in Mercator both steps are equal)
    float lod = log2(max(w.px, .234) / .234) + 1.6, e = .5;
    vec2 m = merc(p.ll), ub = (m - uBaseRect.xy) * uBaseRect.zw, du = e / (KM * cos(radians(p.ll.x)) * 360.) * uBaseRect.zw;
    float hC = textureLod(uBase, ub, lod).r, hE = textureLod(uBase, ub + vec2(du.x, 0.), lod).r, hN = textureLod(uBase, ub - vec2(0., du.y), lod).r;
    float gs = length(vec2(hE - hC, hN - hC)) / (e * 1000.);          // rise over run of the smoothed bottom
    w.surf = w.depth / (1000. * max(gs, 1e-4)) + 4. * (1. - smoothstep(.0012, .004, gs));
    // the sea charts step from one depth to the next along jagged lines; the smoothed bottom rounds those steps off
    // (where there are fine heights, their smoothed bottom: the same rule as heightLod())
    float hS = hC, wD = detailWeight(m);
    if (wD > 0.) { float hd = textureLod(uDet, (m - uDetRect.xy) * uDetRect.zw, lod + 3.).r; hS = mix(hC, hd > .6 ? hd : min(hC, -1.5), wD); }
    w.depth = mix(w.depth, max(-hS, 0.), .65 * smoothstep(14., 6., w.depth) * smoothstep(0., 1.2, w.depth));
  }
  return waterLit(w);
}`;

const G = 'Вода и свет';
// a camera over the open Bay of Biscay, where the rows of states of «Показ воды» are laid out
const bay = (lon, h, tilt = 0) => ({ lat: 44.1, lon, h, tilt, heading: 0 });

export default {
  id: 'water', title: 'Вода', glsl: GLSL, uniforms: { ...WATER_UNIFORMS, ...COAST_UNIFORMS },
  params: [
    { key: 'rivers', label: 'Ширина рек', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'cold', label: 'Холод: лёд на воде', group: 'land', min: 0, max: 1, step: .02, value: 0, zero: 'льда нет' },
    { key: 'thaw', label: 'Оттепель: лёд тает', group: 'land', min: 0, max: 1, step: .02, value: 0, zero: 'нет' },
    { key: 'iceSnow', label: 'Снег на льду', group: 'land', min: 0, max: 1, step: .02, value: 0, zero: 'нет' },
    { key: 'seaState', label: 'Волнение моря', group: 'land', min: 0, max: 1, step: .02, value: 0, zero: 'как в чанках' },
    { key: 'riversOn', label: 'Реки', group: 'layers', type: 'toggle', value: 1 },
    { key: 'lakesOn', label: 'Озёра', group: 'layers', type: 'toggle', value: 1 },
    { key: 'waterShow', label: 'Показ воды: состояния рядами', group: 'modes', type: 'select', value: '', options: [['', 'нет'], ['sea', 'Состояния моря'], ['ice', 'Стадии льда'], ['snow', 'Снег на льду'], ['melt', 'Тающий лёд']] },
    { key: 'winterCycle', label: 'Зима идёт по кругу', group: 'modes', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'sea-delta', group: G, title: 'Берег и отмели: дельта Эбро', note: 'Глубина видна цветом: песок под водой, бирюза отмелей, синяя глубина. Прибой только у настоящего берега.', p: {}, cam: { lat: 40.72, lon: .72, h: 60, tilt: 40, heading: -40 } },
    // ---- the open sea
    { id: 'water-sea', group: G, title: 'Море: от штиля до шторма', note: 'Состояния открытого моря рядами с запада на восток: штиль, рябь, волнение, сильное волнение, шторм. Состояние хранит чанк, соседние чанки сливаются без шва. Ручка «Волнение моря» (раздел «Земля») задаёт одно состояние всему морю.', p: { waterShow: 'sea' }, cam: bay(-4.17, 150) },
    { id: 'water-sea-waves', group: G, title: 'Волнение вблизи', note: 'С 22 км видны гряды волн и первые барашки. Волны идут по ветру, группами, гребни короткие и неровные.', p: { waterShow: 'sea' }, cam: bay(-3.815, 22, 35) },
    { id: 'water-sea-storm', group: G, title: 'Шторм вблизи: барашки', note: 'Гребни ломаются, за ними остаётся пена; вода темнее и зеленее.', p: { waterShow: 'sea' }, cam: bay(-3.463, 22, 35) },
    // ---- ice
    { id: 'water-ice', group: G, title: 'Лёд: от сала до торосов', note: 'Стадии льда рядами с запада на восток: сало и шуга, блинчатый лёд, блины смерзаются в льдины, битый лёд с разводьями, сплошное поле, торосы. Одно число чанка проходит все стадии; слабое уходит первым.', p: { waterShow: 'ice' }, cam: bay(-4.58, 140) },
    { id: 'water-ice-pancake', group: G, title: 'Блинчатый лёд вблизи', note: 'С 22 км блинчатый лёд — мелкое зерно: круглые льдины чуть крупнее настоящих, ветер сгоняет их в ряды. Между ними тёмная шуга. С большей высоты зерно сливается в ровный серо-голубой тон.', p: { waterShow: 'ice' }, cam: bay(-5.048, 22, 30) },
    { id: 'water-ice-floes', group: G, title: 'Битый лёд с разводьями вблизи', note: 'Льдины в несколько километров; с этой высоты видно, что молодая льдина собрана из смёрзшихся кусков. В разводьях шуга и блины. Чем больше льда в чанке, тем уже разводья.', p: { waterShow: 'ice' }, cam: bay(-4.579, 22, 30) },
    { id: 'water-ice-ridges', group: G, title: 'Сплошное поле и торосы вблизи', note: 'Поле ровное. Кое-где остались швы старых разводий, а там, где льдины сдавило, стоят гряды торосов: одна сторона на свету, другая в тени. Сплошной сетки трещин нет.', p: { waterShow: 'ice' }, cam: bay(-3.874, 22, 30) },
    { id: 'water-snow', group: G, title: 'Снег на льду: от голого льда до сплошного снега', note: 'Голый лёд голубой, снег белый, в тон снегу на суше. Снега в чанке больше — полосы намётов шире, голый лёд остаётся только на выдувах.', p: { waterShow: 'snow' }, cam: bay(-5.048, 100) },
    { id: 'water-snow-near', group: G, title: 'Снег на льду вблизи: намёты и выдувы', note: 'Намёты вытянуты по ветру и лежат у торосов; между ними голый лёд.', p: { waterShow: 'snow' }, cam: bay(-5.19, 22, 30) },
    { id: 'water-thaw', group: G, title: 'Оттепель: тающий лёд', note: 'Лёд сереет, на нём стоят бирюзовые проталины; дальше проталины темнеют и лёд рвётся. Ручка «Оттепель: лёд тает».', p: { waterShow: 'melt' }, cam: bay(-5.048, 100) },
    { id: 'water-thaw-near', group: G, title: 'Проталины вблизи', note: 'Талая вода стоит на льдинах; в разводьях блины и шуга.', p: { waterShow: 'melt' }, cam: bay(-5.048, 22, 30) },
    // ---- the freeze model: ice from the shore and from the north, chunk by chunk
    { id: 'water-edge', group: G, title: 'Кромка льда: чанки сливаются без шва', note: 'Лёд пришёл от берега, от чанка к чанку. Кромка неровная, как в природе: у берега припай под снегом, дальше битый лёд, блины и шуга. Двигайте «Холод: лёд на воде» (раздел «Земля»): лёд нарастает и тает на глазах, скорость — «Ход времени».', p: { cold: .5, iceSnow: .4 }, cam: { lat: 44.0, lon: -4.6, h: 150, tilt: 0, heading: 0 } },
    { id: 'water-edge-grid', group: G, title: 'Та же кромка с границами чанков', note: 'Границы чанков поверх той же картины: водные чанки — округлые ячейки около 10 км. Лёд хранит чанк, но кромка не повторяет его очертаний. Наведите курсор: внизу видно, сколько льда и снега в чанке. Числа цветом по чанкам — «Показать по чанкам: Лёд» (раздел «Режимы и бедствия»).', p: { cold: .5, iceSnow: .4, grid: 1, chunkInfo: 1 }, cam: { lat: 44.0, lon: -4.6, h: 150, tilt: 0, heading: 0 } },
    { id: 'water-20', group: G, title: 'Край припая с 20 км', note: 'Самая близкая высота: припай под снегом, перед ним битый лёд и блины.', p: { cold: .5, iceSnow: .4 }, cam: { lat: 43.76, lon: -4.5, h: 20, tilt: 48, heading: 180 } },
    { id: 'water-200', group: G, title: 'Замёрзший берег с 200 км', note: 'Обычная игровая высота: лёд вдоль Кантабрийского берега.', p: { cold: .5, iceSnow: .4 }, cam: { lat: 43.9, lon: -4.6, h: 200, tilt: 35, heading: 180 } },
    { id: 'water-500', group: G, title: 'Зима с 500 км', note: 'Высота больших держав: лёд у северного берега, реки и озёра подо льдом.', p: { cold: .5, iceSnow: .4 }, cam: { lat: 42.5, lon: -4.0, h: 500, tilt: 20, heading: 0 } },
    { id: 'water-pack-500', group: G, title: 'Сплошной лёд с 500 км: поля и длинные трещины', note: 'Море замёрзло целиком. С высоты видно только крупное: белые поля под снегом, пятна голого льда и редкие длинные трещины, которые идут на десятки километров. Мелких трещин с такой высоты не видно.', p: { cold: .97, iceSnow: .5 }, cam: { lat: 44.0, lon: -5.5, h: 500, tilt: 0, heading: 0 } },
    { id: 'water-pack-far', group: G, title: 'Замёрзшее море из космоса', note: 'С 1100 км лёд — ровное белое поле с едва заметными большими трещинами. Подробности появляются по мере спуска: с 200 км — льдины у кромки, с 20 км — торосы, намёты и блинчатый лёд.', p: { cold: .97, iceSnow: .6 }, cam: { lat: 41.5, lon: -3.5, h: 1100, tilt: 0, heading: 0 } },
    { id: 'water-winter', group: G, title: 'Зима приходит и уходит', note: 'Лёд нарастает от берегов и с севера, от чанка к чанку, сначала на мелкой воде; потом тает обратно, с проталинами. Скорость — «Ход времени» (раздел «Система»).', p: { cold: .62, iceSnow: .5, winterCycle: 1 }, cam: { lat: 43.3, lon: -4.5, h: 420, tilt: 25, heading: 0 } },
    // ---- lakes and rivers
    { id: 'water-lake', group: G, title: 'Озёра летом', note: 'Озёра Ландов: та же вода, что в море, только пресная. У берега отмель и полоска пляжа, к середине глубже.', p: {}, cam: { lat: 44.42, lon: -1.16, h: 45, tilt: 40, heading: 0 } },
    { id: 'water-lake-ice', group: G, title: 'Те же озёра подо льдом', note: 'Озеро замерзает вместе со своим чанком, тем же льдом, что и море. По льду можно будет пройти.', p: { cold: .3, iceSnow: .35 }, cam: { lat: 44.42, lon: -1.16, h: 45, tilt: 40, heading: 0 } },
    { id: 'water-lake-20', group: G, title: 'Горное озеро с 20 км: Санабрия', note: 'Ледниковое озеро в лесу. На воде не растут деревья и не стоят дома.', p: {}, cam: { lat: 42.123, lon: -6.716, h: 20, tilt: 50, heading: 0 } },
    { id: 'water-river', group: G, title: 'Река: настоящее русло и ширина', note: 'Эбро у Сарагосы, как он течёт на самом деле: русло взято из открытой карты OpenStreetMap, ширина — настоящая, около 150 м. Слева впадает Гальего, справа Уэрва. Вода лежит ниже берегов; берег, обращённый к солнцу, светлее. Ручка «Ширина рек» (раздел «Масштаб объектов») умножает ширину.', p: { labels: 0 }, cam: { lat: 41.66, lon: -.93, h: 20, tilt: 42, heading: 20 } },
    { id: 'water-river-bends', group: G, title: 'Излучины: Тахо у Толедо', note: 'Каждая излучина настоящая. На внутренней стороне поворота светлая отмель, под внешним берегом глубже и темнее.', p: { labels: 0, forest3d: 0 }, cam: { lat: 39.86, lon: -4.03, h: 20, tilt: 35, heading: 0 } },
    { id: 'water-river-ice', group: G, title: 'Река подо льдом', note: 'Текущая вода замерзает позже стоячей, но тем же льдом.', p: { cold: .42, iceSnow: .3, labels: 0 }, cam: { lat: 41.66, lon: -.93, h: 20, tilt: 42, heading: 20 } },
    { id: 'water-river-50', group: G, title: 'Реки с 50 км: притоки и ручьи', note: 'С 50 км видна вся сеть: большая река, притоки, ручьи. Всё в настоящую величину; ручей не тоньше пикселя.', p: { labels: 0 }, cam: { lat: 42.1, lon: -1.5, h: 50, tilt: 30, heading: 0 } },
    { id: 'water-river-200', group: G, title: 'Реки с 200 км', note: 'Обычная игровая высота. Большая река не тоньше двух-трёх пикселей, ручьи тоньше пикселя уже не рисуются: остаются реки, которые видно из космоса.', p: {}, cam: { lat: 41.65, lon: -.9, h: 200, tilt: 40, heading: 0 } },
    { id: 'water-river-500', group: G, title: 'Реки с 500 км', note: 'Высота больших держав: Эбро, Дуэро, Тахо, Гвадиана, Гвадалквивир и их главные притоки.', p: {}, cam: { lat: 40.4, lon: -3.6, h: 500, tilt: 15, heading: 0 } },
    // ---- the shore
    { id: 'coast-beach', group: G, title: 'Берег: пляжи', note: 'Малага с 20 км. Песок лежит там, где пляжи есть на самом деле (открытая карта OpenStreetMap): полоса в несколько десятков метров, у воды мокрая и тёмная, выше светлая. Море синее от самого берега, бирюза только над настоящей отмелью.', p: { labels: 0 }, cam: { lat: 36.70, lon: -4.42, h: 20, tilt: 38, heading: 0 } },
    { id: 'coast-coves', group: G, title: 'Скалистый берег: бухты', note: 'Коста-Брава с 20 км. На скалистом берегу пляжи малые — бухты между мысами; у воды тёмный мокрый камень и узкая полоса прибоя.', p: { labels: 0 }, cam: { lat: 41.75, lon: 3.0, h: 20, tilt: 38, heading: -60 } },
    { id: 'coast-dunes', group: G, title: 'Низкий берег: длинный пляж и дюны', note: 'Ланды с 25 км: сплошной пляж на сотни километров, за ним дюны с редкой травой.', p: { labels: 0 }, cam: { lat: 44.3, lon: -1.25, h: 25, tilt: 38, heading: 90 } },
    { id: 'coast-200', group: G, title: 'Берег с 200 км', note: 'С высоты песчаный берег остаётся светлой каймой, скалистый — тёмным.', p: {}, cam: { lat: 37.0, lon: -6.6, h: 200, tilt: 30, heading: 0 } },
  ],
  async init(album) {
    const layers = []; await loadCoast();
    for (const mod of [() => import('../layers/freeze.js'), () => import('../layers/lakes.js'), () => import('../layers/rivers.js')]) {
      try { layers.push(await (await mod()).default(album)); } catch (e) { console.warn('[album] water layer failed:', e.message); }
    }
    return layers;
  },
};
