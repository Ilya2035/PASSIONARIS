// GLSL for the event effects (see events.js).
//
//   decals  — an instanced grid per effect, draped over the relief; the pattern is drawn in the fragment shader
//             as layers composited "over" each other plus an additive glow (premultiplied output, so one draw call
//             can both cover the map with ash and make lava shine);
//   sprites — instanced quads: soft puffs, glows, streaks stretched along their motion (sparks, meteor, flakes),
//             lightning bolts and flat lava tongues lying on the ground. Every sprite computes its own position
//             from its birth time and a few numbers, so nothing is simulated on the CPU.
//
// Lengths are radians of arc. Each effect keeps its physical size, but never gets smaller than a fraction of the
// view (uMinR * uAlt), and all parts of one event (decals and sprites) scale together, so an impact still reads
// from orbit and its fireball stays on its crater at any zoom.
import { COMMON } from '../shaders.js';

// decal kinds: the first twelve follow FX_KINDS (one per event type), the rest are extra layers of some events.
// (Lasting regional ash and dust belong to the aerosol layer of the globe; these are the events' own moments.)
export const DK = Object.freeze({
  eruption: 0, earthquake: 1, tsunami: 2, impact: 3, landslide: 4, wildfire: 5, flood: 6,
  heatwave: 7, coldwave: 8, drought: 9, storm: 10, snowstorm: 11, scar: 12, pyro: 14,
});

// sprite kinds (the meaning of each kind's aA / aB numbers is documented in events.js where they are spawned)
export const SK = Object.freeze({
  ash: 0, smoke: 1, head: 2, trail: 3, spark: 4, fireball: 5, dust: 6, glow: 7, bolt: 8, flake: 9, ember: 10, lava: 11, debris: 12,
});

// Value noise comes from a small tiling texture of random bytes (bilinear = value noise, one fetch per octave):
// the weak integrated GPUs pay per instruction, and a hashed value noise costs ~70 of them.
export const NOISE_SIZE = 256;
const NOISE = /* glsl */ `
uniform sampler2D uNoise;
float vnoise(vec2 p) { return textureLod(uNoise, (p + 0.5) / ${NOISE_SIZE}.0, 0.0).r; }
`;

// shared by the three map shaders: placement on the (possibly unrolled) map, a hash and the noise
const PLACE = /* glsl */ `
uniform float uNow, uAlt, uMinR, uLift;
vec3 geoOf(float latD, float lonD) {
  float lat = radians(latD), lon = radians(lonD);
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}
vec3 placeOnMap(vec3 g, float lift, out vec3 up) {
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  float h = heightAt(geoToUV(g), 0.0, 0.0);
  return morphPos(s, T, max(h, 0.0) * uExag + lift, up);
}
// the point at a local offset (east, north) from g0, lifted by h above the ground
vec3 placeOff(vec3 g0, vec3 e, vec3 n, vec2 off, float h, out vec3 up) {
  float d = length(off);
  vec3 g = d > 1e-9 ? normalize(g0 * cos(d) + (e * off.x + n * off.y) * (sin(d) / d)) : g0;
  return placeOnMap(g, uLift + h, up);
}
vec2 dirOf(float az) { return vec2(sin(az), cos(az)); }   // azimuth (from north, clockwise) -> (east, north)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
${NOISE}
`;

export const DECAL_VERT = /* glsl */ `
${COMMON}
${PLACE}
in vec4 aGeo;   // lat, lon, base radius (rad), kind
in vec4 aTime;  // birth, life, seed, strength 0..1
in vec4 aExt;   // direction (azimuth, rad), size multiplier, p1, p2
out vec2 vQ;
out vec3 vG;
out float vAge, vKind, vSeed, vStr, vFace, vLife, vH0;
out vec4 vExt;
void main() {
  float age = (uNow - aTime.x) / max(aTime.y, 1e-3);
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec3 g0 = geoOf(aGeo.x, aGeo.y);
  float lon = radians(aGeo.y);
  vec3 e = normalize(vec3(cos(lon), 0.0, -sin(lon)));
  vec3 n = cross(g0, e);
  float R = aExt.y * max(aGeo.z, uMinR * uAlt * (0.6 + 0.4 * aTime.w));
  vec2 q = position.xy;
  vec3 up;
  vec3 p = placeOff(g0, e, n, q * R, 0.0, up);
  float ql = length(q);
  vG = ql > 1e-6 ? normalize(g0 * cos(ql * R) + (e * q.x + n * q.y) / ql * sin(ql * R)) : g0;
  vQ = q; vAge = age; vKind = aGeo.w; vSeed = aTime.z; vStr = aTime.w; vLife = aTime.y; vExt = aExt;
  vH0 = heightAt(geoToUV(g0), 0.0, 0.0);
  vFace = dot(up, normalize(cameraPosition - p));   // < 0 behind the horizon (no depth test: decals drape over chords)
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const DECAL_FRAG = /* glsl */ `
${COMMON}
${PLACE}
uniform float uDot;
in vec2 vQ;
in vec3 vG;
in float vAge, vKind, vSeed, vStr, vFace, vLife, vH0;
in vec4 vExt;
layout(location = 0) out vec4 fragColor;

float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.3 + 7.1) + 0.15 * vnoise(p * 5.1 + 3.7); }
float ring(float r, float at, float w) { float d = (r - at) / w; return exp(-d * d); }
// a layer of colour c and coverage x laid "over" the premultiplied accumulator
void over(inout vec4 acc, vec3 c, float x) { x = clamp(x, 0.0, 1.0); acc = vec4(c * x, x) + acc * (1.0 - x); }
// distances to the nearest and the second nearest cell point (cracks, crystals)
vec2 voro(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = texelFetch(uNoise, ivec2(mod(i + o, ${NOISE_SIZE}.0)), 0).gb;   // the cell's point
    float d = length(o + h - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
// spiral cloud bands of a storm: arms, tightness, rotation sense (+1 counter-clockwise seen from above); the arms
// wind inward in the sense of the rotation and the whole pattern turns that way
float spiral(vec2 q, float r, float arms, float tight, float spin, float speed) {
  float ang = atan(q.y, q.x);
  return 0.5 + 0.5 * sin(arms * (spin * ang - uNow * speed + tight * log(max(r, 0.015))) + vSeed * 6.0);
}

void main() {
  float r = length(vQ);
  if (r > 1.0 || vFace <= 0.0) discard;   // the square's corners and the far side of the globe: nothing to draw
  int kind = int(vKind + 0.5);
  float age = vAge, Ts = vAge * vLife;
  float env = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.78, 1.0, age));
  float edge = 1.0 - smoothstep(0.9, 1.0, r);
  vec2 sp = vQ * 3.0 + vSeed * 17.0;
  vec2 dir = dirOf(vExt.x);
  vec2 qr = vec2(dot(vQ, dir), dot(vQ, vec2(dir.y, -dir.x)));   // along the event's direction, and across it
  float flick = 0.8 + 0.2 * sin(uNow * 13.0 + vSeed * 40.0) * sin(uNow * 7.3 + vSeed * 11.0);
  float far = smoothstep(0.06, 0.8, uAlt);                       // 0 up close .. 1 seen from afar
  vec4 acc = vec4(0.0);
  vec3 glow = vec3(0.0);

  if (kind == 0) {                       // eruption: glowing vent, lava tongues, ash fall drifting downwind
    // up close the broad glow steps back so the vent, the lava tongues and the fountains read on their own
    float near = 1.0 - far;
    float core = exp(-r * r * mix(45.0, 160.0, near)) * flick;
    float halo = exp(-r * r * 9.0) * 0.5 * (1.0 - smoothstep(0.3, 0.8, age)) * (0.75 + 0.25 * sin(uNow * 3.0 + vSeed * 9.0)) * (1.0 - 0.55 * near);
    float lava = smoothstep(0.5, 0.72, fbm(vQ * 7.0 + vSeed * 9.0)) * (1.0 - smoothstep(0.12, 0.32, r)) * (1.0 - 0.45 * near);
    float grow = 0.35 + 0.6 * smoothstep(0.0, 0.7, age);
    float heavy = smoothstep(0.6, 0.9, vStr);
    vec2 c = (qr - vec2(0.38 * grow, 0.0)) / vec2(grow, (0.45 + 0.1 * heavy) * grow);
    float ash = (1.0 - smoothstep(0.45, 1.0, length(c))) * (0.55 + 0.45 * fbm(sp + uNow * 0.15));
    ash *= 0.5 * (0.4 + 0.6 * vStr) * (1.0 + 0.45 * heavy) * (1.0 - smoothstep(0.55, 1.0, age)) * mix(0.8, 1.0, far);
    vec3 col = mix(mix(vec3(0.29, 0.27, 0.25), vec3(0.19, 0.18, 0.17), heavy), vec3(1.0, 0.42, 0.14), clamp(lava + core, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.86, 0.5), core * 0.8);
    col = mix(col, vec3(1.0, 0.5, 0.2), halo * (1.0 - ash) * step(core + lava, 0.05));
    over(acc, col, max(max(ash, halo), max(lava * 0.85 * flick, core)));
    glow += vec3(1.0, 0.5, 0.18) * (core * 0.4 + lava * 0.22 * flick + halo * 0.15);
  } else if (kind == 14) {               // pyroclastic flow: a dark turbulent ring racing down the slopes, pale deposit behind
    float n = fbm(sp * 1.4 + vec2(uNow * 0.25, 0.0));
    float lobes = 0.62 + 0.38 * fbm(vQ / max(r, 1e-4) * 2.5 + vSeed * 13.0);   // flows run further down some valleys
    float front = 0.92 * (1.0 - pow(1.0 - smoothstep(0.0, 0.6, age), 2.0)) * (0.86 + 0.28 * n) * lobes;
    float band = smoothstep(front - 0.22, front - 0.03, r) * (1.0 - smoothstep(front - 0.03, front + 0.03, r));
    // the deposit stays off the vent, so its glow and lava show through
    float deposit = (1.0 - smoothstep(front - 0.12, front, r)) * smoothstep(0.3, 0.6, r) * (0.3 + 0.35 * n);
    float live = 1.0 - smoothstep(0.55, 0.9, age);
    over(acc, vec3(0.6, 0.57, 0.53), deposit * 0.4);
    over(acc, mix(vec3(0.22, 0.2, 0.19), vec3(0.46, 0.43, 0.41), n), band * 0.8 * live);
    glow += vec3(0.95, 0.38, 0.1) * band * (1.0 - smoothstep(front - 0.14, front - 0.04, r)) * live * exp(-Ts * 0.5) * 0.3;
  } else if (kind == 1) {                // earthquake: ripple trains running out of the epicentre, the rupture, the mark
    float light = 0.0, dark = 0.0, ink = 0.0;
    for (int k = 0; k < 3; k++) {
      float at = clamp(age * 1.35 - float(k) * 0.17, 0.0, 1.0);
      if (at <= 0.001) continue;
      float d = r - at * 0.95;
      float pk = exp(-d * d / (0.0025 + 0.01 * at)) * (1.0 - at);
      float rip = sin(d * 75.0) * pk;
      light += max(rip, 0.0); dark += max(-rip, 0.0);
      ink += ring(r, at * 0.95, 0.012 + 0.012 * at) * (1.0 - at);
    }
    float len = 0.14 + 0.3 * vStr;
    float fy = qr.y + 0.025 * sin(qr.x * 37.0 + vSeed * 20.0) + 0.02 * (vnoise(vec2(qr.x * 26.0, vSeed * 9.0)) - 0.5);
    float fault = exp(-fy * fy * 6000.0) * (1.0 - smoothstep(len * 0.7, len, abs(qr.x))) * smoothstep(0.0, 0.08, age);
    float shake = (1.0 - smoothstep(0.0, 0.75, r)) * (1.0 - smoothstep(0.2, 0.9, age));
    float star = exp(-r * r * 260.0) + 0.6 * exp(-pow(abs(vQ.x) * 60.0, 2.0)) * step(r, 0.09) + 0.6 * exp(-pow(abs(vQ.y) * 60.0, 2.0)) * step(r, 0.09);
    over(acc, vec3(0.55, 0.22, 0.14), shake * 0.16);
    over(acc, vec3(0.25, 0.16, 0.12), dark * 0.5);
    over(acc, vec3(0.98, 0.93, 0.84), light * 0.55);
    over(acc, vec3(0.48, 0.16, 0.11), ink * 0.75);
    over(acc, vec3(0.2, 0.1, 0.08), fault * 0.85);
    over(acc, vec3(0.48, 0.16, 0.11), star * 0.9 * (1.0 - age));
  } else if (kind == 2) {                // tsunami: a train of crests with white foam over the sea, steepening near shore
    float at = pow(smoothstep(0.0, 1.0, age), 0.85);
    if (r > at * 0.96 + 0.05) discard;    // ahead of the leading crest the sea is untouched
    float h = heightAt(geoToUV(normalize(vG)), 0.0, 0.0);
    if (h > 1.0) discard;
    float shoal = smoothstep(-900.0, -40.0, h);
    float foamN = smoothstep(0.38, 0.62, fbm(vQ / max(r, 1e-4) * 14.0 + vec2(r * 40.0, 0.0) + vSeed * 7.0 - uNow * 0.3)) * (0.6 + 0.8 * shoal);
    for (int k = 0; k < 3; k++) {
      float fk = at * 0.96 - float(k) * 0.045;
      if (fk <= 0.0) continue;
      float d = r - fk;
      float amp = (1.0 - 0.32 * float(k)) * (1.0 - 0.55 * fk);
      float crest = exp(-d * d / (0.00015 + 0.0002 * shoal));
      float trough = exp(-(d + 0.02) * (d + 0.02) / 0.0004);
      float foam = crest * foamN;
      over(acc, vec3(0.16, 0.32, 0.38), trough * 0.45 * amp);
      over(acc, vec3(0.75, 0.9, 0.94), crest * (0.55 + 0.3 * shoal) * amp);
      over(acc, vec3(1.0), foam * 0.9 * amp);
    }
    float wake = (1.0 - smoothstep(0.0, at * 0.96, r)) * 0.14 * (0.6 + 0.4 * fbm(sp * 2.0 - uNow));
    over(acc, vec3(0.45, 0.66, 0.72), wake * (1.0 - 0.6 * at));
  } else if (kind == 3) {                // meteorite, the impact moment: the ground lit by the flash, shock rings
    float L = vStr * 5.0, rm = r * vExt.y;                        // rm: distance in units of the event radius
    float fl = exp(-Ts * 4.5);
    glow += vec3(1.0, 0.82, 0.55) * exp(-rm * rm * 0.8) * fl * 1.1;
    glow += vec3(1.0, 0.95, 0.85) * exp(-rm * rm * 14.0) * exp(-Ts * 1.6);
    for (int k = 0; k < 2; k++) {
      float t = Ts - 0.15 * float(k);
      if (t <= 0.0 || (k == 1 && L < 3.5)) continue;
      float front = (vExt.y - 0.15) * (1.0 - exp(-t * 1.5));
      float d = rm - front;
      float fade = (1.0 - front / vExt.y) * (k == 0 ? 1.0 : 0.6);
      float line = exp(-d * d / (0.0015 + 0.004 * front));
      float band = exp(-(d + 0.14) * (d + 0.14) / (0.01 + 0.01 * front)) * step(d, 0.0);
      over(acc, vec3(0.45, 0.38, 0.3), band * 0.38 * fade);
      over(acc, vec3(0.98, 0.95, 0.88), line * 0.85 * fade);
      glow += vec3(1.0, 0.8, 0.55) * line * fade * 0.4 * exp(-t * 1.2);
    }
    env = 1.0 - smoothstep(0.7, 1.0, age);
  } else if (kind == 12) {               // meteorite scar: crater cooling from white heat, ejecta and rays (or a felled forest)
    float L = vStr * 5.0, rm = r * vExt.y;
    float ang = atan(qr.y, qr.x);
    float fwd = dot(vQ / max(r, 1e-5), dir);
    // the shadow of the fireball and its dust, cast to the south-east while the cloud stands
    vec2 so = vQ * vExt.y - vec2(0.3, -0.25);
    float cloudT = smoothstep(0.3, 1.6, Ts) * (1.0 - smoothstep(3.0, 7.0 + 2.0 * L, Ts)) * (0.4 + 0.15 * L);
    over(acc, vec3(0.12, 0.11, 0.1), exp(-dot(so, so) / (0.1 + 0.035 * L)) * cloudT * 0.45);
    if (vExt.z < 0.5) {
      float rc = 0.12 + 0.025 * L;
      float cr = rm / rc;
      float bowl = 1.0 - smoothstep(0.82, 1.0, cr);
      float rt = (cr - 1.02) / 0.2;
      float rim = exp(-rt * rt);
      float shade = dot(vQ / max(r, 1e-5), vec2(-0.6, 0.8));       // lit from the north-west
      float forbid = smoothstep(-0.97, -0.55, fwd);                 // oblique entry: the uprange sector stays clean
      float blanket = (1.0 - smoothstep(rc * 1.1, rc * (2.5 + 0.7 * fwd), rm)) * step(rc * 0.9, rm) * (0.5 + 0.5 * fbm(sp * 3.0));
      float rays = pow(vnoise(vQ / max(r, 1e-4) * 11.0 + vSeed * 30.0), 2.5) * (1.0 - smoothstep(rc, 0.95, rm)) * step(rc, rm) * (0.4 + 0.6 * fbm(vQ / max(r, 1e-4) * 30.0 + vec2(rm * 4.0, 0.0)));
      over(acc, vec3(0.42, 0.34, 0.27), blanket * 0.6 * forbid);
      over(acc, vec3(0.36, 0.28, 0.22), rays * 0.6 * forbid);
      // the bowl: its north-west inner wall in shadow, the south-east one lit; a lit outer rim on the north-west
      over(acc, mix(vec3(0.12, 0.1, 0.09), vec3(0.42, 0.36, 0.3), clamp(0.45 - 0.55 * shade * cr, 0.0, 1.0)), bowl * 0.88);
      over(acc, mix(vec3(0.26, 0.21, 0.17), vec3(0.86, 0.8, 0.7), 0.5 + 0.5 * shade), rim * 0.8);
      // still molten: a crust of dark plates with glowing seams, cooling from white heat through red
      float cool = exp(-Ts / (1.4 + 0.7 * L));
      vec3 hot = mix(vec3(0.75, 0.12, 0.03), mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.94, 0.78), cool * cool), cool);
      vec2 pv = voro(vQ * vExt.y / rc * 4.5 + vSeed * 11.0 + 0.25 * vec2(vnoise(sp * 9.0), vnoise(sp * 9.0 + 5.0)));
      float seams = (1.0 - smoothstep(0.0, 0.05 + 0.4 * cool, pv.y - pv.x)) * (0.45 + 0.55 * vnoise(sp * 14.0 + uNow * 0.3));
      glow += hot * bowl * (0.3 * cool + seams * (0.15 + 0.9 * cool)) * (1.0 - 0.5 * smoothstep(0.5, 1.0, cr)) * smoothstep(0.0, 0.05, cool - 0.03) * 1.2;
    } else {
      // airburst: no crater; trees felled radially in a butterfly-shaped zone, a scorched centre
      float rb = 0.9 * (0.68 + 0.32 * cos(2.0 * ang + 0.35)) * (1.0 + 0.15 * fwd);
      float zone = 1.0 - smoothstep(rb * 0.85, rb, rm);
      float lines = smoothstep(0.5, 0.85, vnoise(vQ / max(r, 1e-4) * 45.0 + vec2(rm * 1.5, vSeed * 9.0))) * smoothstep(0.08, 0.3, rm);   // radial tree-fall
      float scorch = 1.0 - smoothstep(0.0, 0.32, rm + 0.08 * fbm(sp * 4.0));
      over(acc, vec3(0.46, 0.37, 0.28), zone * 0.42);
      over(acc, vec3(0.34, 0.27, 0.21), zone * lines * 0.35);
      over(acc, vec3(0.16, 0.13, 0.11), scorch * 0.55 * (0.6 + 0.4 * fbm(sp * 6.0)));
      glow += vec3(1.0, 0.42, 0.12) * scorch * smoothstep(0.55, 0.8, fbm(sp * 7.0 + uNow * 0.5)) * exp(-Ts * 0.5) * 0.6;
    }
    env = smoothstep(0.0, 0.01, age) * (1.0 - smoothstep(0.7, 1.0, age));
  } else if (kind == 4) {                // landslide: material sliding down the slope, a scarp at its head, dust over it
    float grow = smoothstep(0.0, 0.45, age);
    vec2 c = (qr - vec2(0.05, 0.0)) / vec2(0.78, 0.34 * (0.8 + 0.25 * (qr.x + 0.6)));
    float body = (1.0 - smoothstep(0.45, 1.0, length(c))) * (1.0 - smoothstep(-0.65 + 1.5 * grow - 0.1, -0.65 + 1.5 * grow, qr.x));
    float streak = vnoise(vec2(qr.x * 5.0 - Ts * 0.9, qr.y * 26.0 + vSeed * 10.0));
    float st = (length((qr - vec2(-0.32, 0.0)) / vec2(0.32, 0.36)) - 1.0) / 0.09;
    float scarp = exp(-st * st) * step(qr.x, -0.34);
    float dust = body * fbm(sp * 2.0 - dir * Ts * 0.5) * (1.0 - smoothstep(0.3, 0.9, age));
    over(acc, vec3(0.52, 0.4, 0.28), body * (0.4 + 0.45 * streak));
    over(acc, vec3(0.3, 0.21, 0.14), scarp * 0.75 * smoothstep(0.0, 0.1, age));
    over(acc, vec3(0.78, 0.7, 0.6), dust * 0.35);
  } else if (kind == 5) {                // wildfire: flickering front that runs faster downwind, charred land, smouldering
    float n = fbm(sp * 1.6 + vec2(0.0, uNow * 0.4));
    float fwd = dot(vQ / max(r, 1e-5), dir);
    float front = (0.22 + 0.68 * smoothstep(0.0, 0.85, age)) * (0.85 + 0.3 * fwd) * 0.9 + (n - 0.5) * 0.22;
    float band = smoothstep(front - 0.15, front - 0.02, r) * (1.0 - smoothstep(front - 0.02, front + 0.03, r));
    float burnt = 1.0 - smoothstep(front - 0.1, front, r);
    float alive = 1.0 - smoothstep(0.72, 0.92, age);
    vec3 scarC = mix(vec3(0.15, 0.13, 0.11), vec3(0.44, 0.42, 0.4), smoothstep(0.55, 0.8, fbm(sp * 4.0)));
    over(acc, scarC, burnt * (0.5 + 0.25 * n));
    float smoulder = burnt * smoothstep(0.6, 0.78, fbm(sp * 9.0 + vec2(uNow * 0.2, 0.0))) * smoothstep(front - 0.4, front - 0.05, r);
    glow += vec3(1.0, 0.33, 0.07) * smoulder * 0.55 * (0.3 + 0.7 * alive);
    vec3 fire = mix(vec3(0.85, 0.16, 0.05), vec3(1.0, 0.78, 0.3), n * flick);
    over(acc, fire, band * 0.8 * alive * flick);
    glow += fire * band * 0.45 * alive * flick;
    env = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.88, 1.0, age));
  } else if (kind == 6) {                // flood: water spreading over the low ground, with moving glints
    float h = heightAt(geoToUV(normalize(vG)), 0.0, 0.0);
    if (h < 0.0) discard;
    float n = fbm(sp * 1.2);
    float reach = 0.3 + 0.7 * smoothstep(0.0, 0.5, age);
    float h0 = max(vH0, 0.0), rise = 25.0 + 70.0 * vStr * smoothstep(0.0, 0.4, age);
    float low = (1.0 - smoothstep(h0 + rise * 0.5, h0 + rise + 60.0, h)) * (1.0 - smoothstep(250.0, 800.0, h));
    float water = (1.0 - smoothstep(reach * 0.75, reach, r + (n - 0.5) * 0.25)) * max(low, smoothstep(0.5, 0.72, n) * 0.5);
    float sheen = smoothstep(0.62, 0.92, vnoise(vec2(vQ.x * 13.0 + uNow * 0.22, vQ.y * 36.0 + sin(vQ.x * 9.0) * 1.6)));
    over(acc, vec3(0.32, 0.47, 0.57), water * 0.62);
    over(acc, vec3(0.88, 0.94, 0.97), water * sheen * 0.4);
  } else if (kind == 7) {                // heatwave: warm wash with shimmering bands of hot air
    float n = fbm(sp * 0.8 + uNow * 0.05);
    float base = (1.0 - smoothstep(0.25, 1.0, r)) * (0.18 + 0.1 * n) * (0.6 + 0.4 * vStr);
    float wav = sin(vQ.y * 58.0 + sin(vQ.x * 9.0 + uNow * 1.6 + vSeed * 9.0) * 2.4 + 1.2 * vnoise(vQ * 12.0 + uNow * 0.5) - uNow * 2.2);
    float shimmer = smoothstep(0.55, 1.0, wav) * (1.0 - smoothstep(0.1, 0.85, r)) * (0.4 + 0.6 * n);
    over(acc, vec3(0.9, 0.5, 0.2), base);
    over(acc, vec3(1.0, 0.78, 0.48), shimmer * 0.32);
    over(acc, vec3(0.75, 0.38, 0.16), smoothstep(0.55, 1.0, -wav) * (1.0 - smoothstep(0.1, 0.85, r)) * 0.08);
    over(acc, vec3(0.9, 0.5, 0.2), ring(r, 0.8, 0.07) * 0.2);
  } else if (kind == 8) {                // cold wave: icy wash, frost rime feathering in from the rim, glints
    float n = fbm(sp * 0.8 + uNow * 0.04);
    float base = (1.0 - smoothstep(0.25, 1.0, r)) * (0.18 + 0.1 * n) * (0.6 + 0.4 * vStr);
    float zone = smoothstep(0.3 + 0.25 * n, 0.85, r) * (1.0 - smoothstep(0.9, 1.0, r)) * smoothstep(0.0, 0.3, age);
    float crystal = 0.0;
    if (zone > 0.01) { vec2 v = voro(vQ * 16.0 + vSeed * 31.0); crystal = 1.0 - smoothstep(0.0, 0.07, v.y - v.x); }
    float feather = pow(1.0 - abs(2.0 * vnoise(vQ / max(r, 1e-4) * 18.0 + vec2(r * 9.0, 0.0) + vSeed) - 1.0), 5.0) * zone;
    over(acc, vec3(0.55, 0.7, 0.88), base * 1.2);
    over(acc, vec3(0.93, 0.97, 1.0), feather * 0.55);
    over(acc, vec3(0.42, 0.58, 0.78), crystal * zone * 0.45);   // frost drawn in blue ink, readable on snow too
    float glint = step(0.993, hash12(floor(gl_FragCoord.xy / (uDot * 1.5)) + floor(uNow * 2.0 + vSeed * 7.0)));
    glow += vec3(0.8, 0.9, 1.0) * glint * (1.0 - smoothstep(0.2, 0.95, r)) * 0.5;
  } else if (kind == 9) {                // drought: ochre wash, the earth cracking from the centre outward
    float h = heightAt(geoToUV(normalize(vG)), 0.0, 0.0);
    if (h < 0.0) discard;
    float n = fbm(sp * 0.8 + uNow * 0.03);
    float base = (1.0 - smoothstep(0.25, 1.0, r)) * (0.2 + 0.1 * n) * (0.6 + 0.4 * vStr);
    float spread = 1.0 - smoothstep(-0.1, 0.0, r - (0.2 + 0.75 * smoothstep(0.0, 0.6, age)));
    float crackZone = spread * (1.0 - smoothstep(0.35, 0.95, r));
    float crack = 0.0;
    if (crackZone > 0.01) {
      vec2 wq = vQ + 0.05 * vec2(vnoise(sp * 4.0) - 0.5, vnoise(sp * 4.0 + 9.0) - 0.5);   // wobbly, not a net
      vec2 v1 = voro(wq * 11.0 + vSeed * 13.0);
      vec2 v2 = voro(wq * 27.0 + vSeed * 7.0);
      crack = (1.0 - smoothstep(0.0, 0.05 + 0.04 * vnoise(sp * 7.0), v1.y - v1.x)) * (0.5 + 0.5 * vnoise(sp * 5.0)) + (1.0 - smoothstep(0.0, 0.05, v2.y - v2.x)) * 0.3;
    }
    over(acc, vec3(0.78, 0.6, 0.32), base);
    over(acc, vec3(0.38, 0.25, 0.14), crack * crackZone * 0.55);
    over(acc, vec3(0.78, 0.6, 0.32), ring(r, 0.8, 0.07) * 0.18);
  } else {                               // storm (10) / snowstorm (11): rotating spiral bands; a cyclone has an eye
    float spin = vExt.z < 0.0 ? -1.0 : 1.0;
    float n = fbm(sp * 1.5 + uNow * 0.2);
    float dens;
    if (kind == 10 && vExt.w > 0.5) {
      float arms = spiral(vQ, r, 2.0, 2.4, spin, 0.3);
      float bands = smoothstep(0.3, 0.85, arms + (n - 0.5) * 0.5) * (1.0 - smoothstep(0.45, 1.0, r)) * (0.55 + 0.35 * n);
      float cdo = exp(-r * r * 14.0) * 0.95;
      float eye = smoothstep(0.035, 0.06, r);
      float wall = ring(r, 0.075, 0.025);
      dens = max(max(bands, cdo), wall * 0.95) * eye;
      // thick tops are bright, the thin edges and the gaps between the bands grey; the eye wall casts a ring of shade
      over(acc, vec3(0.3, 0.33, 0.37), ring(r, 0.05, 0.02) * 0.35);
      over(acc, mix(vec3(0.58, 0.61, 0.66), vec3(0.98, 0.98, 0.96), clamp(dens * 1.2, 0.0, 1.0)), dens * 0.88);
    } else {
      bool snow = kind == 11;
      // a snowstorm swirls in three loose arms; a mid-latitude storm is a comma: a cloud head and one long tail
      float arms = spiral(vQ, r, snow ? 3.0 : 1.0, snow ? 1.2 : 1.1, spin, 0.2);
      float body = snow ? 0.0 : exp(-r * r * 10.0) * (0.45 + 0.3 * n);
      dens = max(smoothstep(snow ? 0.15 : 0.2, snow ? 0.85 : 0.7, arms + (n - 0.5) * 0.35) * (1.0 - smoothstep(0.3, 1.0, r)) * (0.48 + 0.4 * n), body)
           + exp(-r * r * 30.0) * 0.15;
      vec3 lo = snow ? vec3(0.6, 0.68, 0.8) : vec3(0.5, 0.53, 0.58), hi = snow ? vec3(0.96, 0.97, 1.0) : vec3(0.96, 0.96, 0.94);
      if (!snow) over(acc, vec3(0.34, 0.37, 0.42), smoothstep(0.35, 0.8, dens) * 0.3);   // rain under the thick cloud
      over(acc, mix(lo, hi, clamp(dens * 1.6 - 0.2, 0.0, 1.0)), min(dens, 0.9));
    }
  }

  float m = env * edge * smoothstep(0.0, 0.06, vFace);
  acc *= m; glow *= m;
  float lum = acc.a + dot(glow, vec3(0.33));
  if (lum < 0.008) discard;
  // stipple: the edge of every effect breaks into ink dots, like the rest of the map
  float dots = hash12(floor(gl_FragCoord.xy / uDot) + floor(vSeed * 97.0));
  fragColor = vec4(acc.rgb + glow, acc.a) * mix(1.0, step(dots, lum * 1.6), 0.5);
}
`;

export const SPRITE_VERT = /* glsl */ `
${COMMON}
${PLACE}
in vec4 aGeo;   // lat, lon, kind, seed
in vec4 aTime;  // birth, life, base radius of the event (rad), strength 0..1
in vec4 aA;     // kind-specific
in vec4 aB;     // kind-specific
uniform float uPx, uH;   // pixels per unit of tan(view angle); render height in pixels
out vec2 vUV;
out vec4 vCol;
out float vAdd, vShape, vK, vSeed, vFlick;

void main() {
  vUV = position.xy; vCol = vec4(0.0); vAdd = 0.0; vShape = 0.0; vK = 1.0; vSeed = aGeo.w; vFlick = 0.0;
  float life = max(aTime.y, 1e-3);
  float age = (uNow - aTime.x) / life;
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  int kind = int(aGeo.z + 0.5);
  float sd = aGeo.w, Ts = age * life;
  vec3 g0 = geoOf(aGeo.x, aGeo.y);
  float lon = radians(aGeo.y);
  vec3 e = normalize(vec3(cos(lon), 0.0, -sin(lon)));
  vec3 n = cross(g0, e);
  float zs = max(1.0, uMinR * uAlt * (0.6 + 0.4 * aTime.w) / max(aTime.z, 1e-7));   // the same floor as the decals
  float ashK = mix(0.72, 1.0, smoothstep(0.06, 0.7, uAlt));  // ash and dust: dense from afar, thinner up close

  if (kind == 11) {
    // lava tongue lying on the ground along the flow: aA = x0, y0, azimuth, half length; aB = half width, cooling s, fed s
    vec2 ax = dirOf(aA.z), pp = vec2(ax.y, -ax.x);
    vec3 up0;
    vec3 pc = placeOff(g0, e, n, aA.xy * zs, 0.0, up0);
    float z = max(-(viewMatrix * vec4(pc, 1.0)).z, 1e-5);
    float hw = max(aB.x * zs, 0.9 * z / uPx);                // never thinner than about two pixels
    float hl = max(aA.w * zs, hw);
    vec3 up;
    vec3 p = placeOff(g0, e, n, aA.xy * zs + ax * position.x * hl + pp * position.y * hw, 0.0, up);
    float hot = exp(-max(Ts - aB.z, 0.0) / aB.y);
    float young = exp(-Ts * 0.7);                            // the advancing front burns white-yellow
    vec3 c = mix(vec3(0.15, 0.1, 0.08), mix(vec3(0.78, 0.13, 0.03), vec3(1.0, 0.6, 0.18), clamp(hot * 0.35 + young * 0.65, 0.0, 1.0)), clamp(hot * 1.3 + 0.12, 0.0, 1.0));
    vCol = vec4(c, 0.95 * smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.85, 1.0, age)) * smoothstep(-0.02, 0.06, dot(up0, normalize(cameraPosition - pc))));
    vAdd = 0.45 * hot; vShape = 4.0; vK = hl / hw;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    return;
  }

  vec2 off = vec2(0.0), offT = vec2(0.0);   // position (east, north) and the streak's tail, already scaled
  float h = 0.0, hT = 0.0, size = 0.0, a = 1.0, add = 0.0;
  float maxPx = 0.06 * uH, minPx = 1.5;
  vec3 col = vec3(1.0);
  int shape = 0;            // 0 puff, 1 glow, 2 streak (hot head), 3 lightning, 6 even streak, 7 meteor head, 8 snowflake
  bool streak = false;

  if (kind == 0) {                       // ash puff: rises, then drifts downwind in a widening plume
    float L = aA.y, k = max(zs, 0.03 * uAlt / L);
    float rise = 0.5 * L * sqrt(age) * (0.8 + 0.4 * fract(sd * 5.37));
    float ang = aA.x + (fract(sd * 13.7) - 0.5) * aB.x;
    float drift = (0.08 + 2.2 * age) * L * (0.7 + 0.6 * fract(sd * 71.3));
    off = dirOf(ang) * drift * k; h = rise * k;
    size = 0.5 * L * (0.22 + 0.85 * age) * aA.w * k;
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age)) * 0.7 * (0.85 + 0.35 * aA.z) * ashK;
    col = mix(vec3(0.27, 0.245, 0.225) * (1.0 - 0.3 * aA.z), vec3(0.58, 0.545, 0.5) * (1.0 - 0.2 * aA.z), age);
  } else if (kind == 1) {                // wildfire smoke: columns from points on the fire front streaming downwind
    float L = aA.y, k = max(zs, 0.018 * uAlt / L);
    float rise = 0.5 * L * sqrt(age);
    float ang = aA.x + (fract(sd * 13.7) - 0.5) * 0.6;
    float drift = (0.05 + 3.5 * age) * L * (0.7 + 0.6 * fract(sd * 71.3));   // streams far downwind of the fire
    off = aB.xy * zs + dirOf(ang) * drift * k; h = rise * k;
    size = 0.55 * L * (0.35 + 1.4 * age) * k;
    a = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.4, 1.0, age)) * 0.8 * ashK;
    col = mix(vec3(0.4, 0.36, 0.31), vec3(0.7, 0.68, 0.64), smoothstep(0.0, 0.7, age));   // warm grey: reads over forest and snow
    maxPx = 0.05 * uH;
  } else if (kind == 2 || kind == 3) {   // meteor: aA = heading, path length, entry height, end height
    vec2 hd = dirOf(aA.x);
    if (kind == 2) {                     // the incandescent head; aB.x = size
      float s = age, s2 = max(age - 0.07, 0.0);
      off = -hd * aA.y * (1.0 - s) * zs;  h = (aA.w + (aA.z - aA.w) * (1.0 - s)) * zs;
      offT = -hd * aA.y * (1.0 - s2) * zs; hT = (aA.w + (aA.z - aA.w) * (1.0 - s2)) * zs;
      size = aB.x * (0.6 + 0.7 * s) * zs * 2.6;             // the quad carries a glow around the core
      col = mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.7, 0.4), s);   // orange glow; the core burns white (fragment shader)
      a = smoothstep(0.0, 0.15, age) * 1.2;
      add = 1.0; streak = true; shape = 7; maxPx = 0.05 * uH; minPx = 6.0;
    } else {                             // its trail; aB = path position, drift x, y, width
      float s = aB.x, s2 = s - 0.05;
      vec2 dr = aB.yz * pow(age, 0.7);
      float sink = 1.0 - 0.12 * age;
      off = (-hd * aA.y * (1.0 - s) + dr) * zs;  h = (aA.w + (aA.z - aA.w) * (1.0 - s)) * sink * zs;
      offT = (-hd * aA.y * (1.0 - s2) + dr * 0.85) * zs; hT = (aA.w + (aA.z - aA.w) * (1.0 - s2)) * sink * zs;
      float hot = exp(-Ts * 1.5), ion = exp(-Ts * 5.0);
      vec3 glowC = mix(vec3(1.0, 0.48, 0.16), vec3(0.88, 0.94, 1.0), ion);
      col = mix(mix(vec3(0.48, 0.46, 0.44), vec3(0.7, 0.68, 0.65), age), glowC, hot);
      size = aB.w * (1.0 + 3.5 * sqrt(age)) * zs;
      a = max(hot * 0.85, 0.5 * pow(1.0 - age, 1.3) * ashK) * smoothstep(0.0, 0.015, age);
      add = hot * 0.75; streak = true; shape = 6; maxPx = 0.04 * uH; minPx = 1.2;
    }
  } else if (kind == 4 || kind == 12) {  // ballistic sparks (hot) / debris (dark): aA = x0, y0, h0, azimuth; aB = distance, up, gravity, size
    float u = age, u2 = max(age - 0.07, 0.0);
    vec2 dd = dirOf(aA.w);
    float du = 1.0 - pow(1.0 - u, 1.6), du2 = 1.0 - pow(1.0 - u2, 1.6);   // air drag slows them sideways
    off = (aA.xy + dd * aB.x * du) * zs;  h = max(aA.z + aB.y * u - aB.z * u * u, 0.0) * zs;
    offT = (aA.xy + dd * aB.x * du2) * zs; hT = max(aA.z + aB.y * u2 - aB.z * u2 * u2, 0.0) * zs;
    size = aB.w * zs; streak = true; shape = 2; minPx = 1.2; maxPx = 0.012 * uH;
    if (kind == 4) {
      float hot = exp(-Ts * 1.5);
      col = mix(vec3(0.85, 0.22, 0.05), mix(vec3(1.0, 0.6, 0.2), vec3(1.0, 0.95, 0.8), hot * hot), hot);
      a = pow(1.0 - age, 1.2); add = 0.9;
    } else {
      float hot = exp(-Ts * 2.5);
      col = mix(vec3(0.24, 0.19, 0.16), vec3(1.0, 0.62, 0.25), hot);
      a = 0.75 * (1.0 - smoothstep(0.75, 1.0, age)); add = hot * 0.8;   // a rock (bright end) trailing dust
    }
  } else if (kind == 5) {                // fireball / mushroom puff: aA = azimuth, r end, h end, size0; aB = size1, cooling rate, base h
    float e1 = 1.0 - pow(1.0 - age, 2.4);
    off = dirOf(aA.x) * aA.y * e1 * zs;
    h = (aB.z + aA.z * (1.0 - pow(1.0 - age, 1.7))) * zs;
    size = mix(aA.w, aB.x, sqrt(age)) * zs;
    float hot = exp(-Ts * aB.y);
    float tw = vnoise(vec2(sd * 40.0, Ts * 3.0));            // turbulent flicker: puffs burn unevenly
    vec3 fire = mix(vec3(0.82, 0.24, 0.07), mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.9, 0.66), hot * hot * (0.6 + 0.4 * tw)), hot);
    vec3 smoke = mix(vec3(0.36, 0.32, 0.29), vec3(0.6, 0.56, 0.52), age);
    col = mix(smoke, fire, smoothstep(0.1, 0.6, hot));
    a = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.55, 1.0, age)) * mix(0.65 * ashK, 1.0, hot);
    add = smoothstep(0.3, 0.9, hot) * 0.5; maxPx = 0.1 * uH;
  } else if (kind == 6) {                // dust / pyroclastic puff hugging the ground: aA = azimuth, r end, h max, size0; aB = size1, tone, x0, y0
    float e1 = 1.0 - pow(1.0 - age, 2.5);
    off = (aB.zw + dirOf(aA.x) * aA.y * e1) * zs; h = aA.z * sqrt(age) * zs;
    size = mix(aA.w, aB.x, sqrt(age)) * zs;
    int tone = int(aB.y + 0.5);
    col = tone == 0 ? vec3(0.5, 0.43, 0.36) : tone == 1 ? vec3(0.3, 0.28, 0.27) : tone == 2 ? vec3(0.72, 0.64, 0.52) : vec3(0.58, 0.47, 0.35);
    col = mix(col, col * 0.55 + vec3(0.3), age * 0.6);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age)) * (tone == 1 ? 0.7 : 0.45) * ashK;
    if (tone == 1) { float hot = exp(-Ts * 1.2); col = mix(col, vec3(0.95, 0.45, 0.15), hot * 0.45); add = hot * 0.35; }
    maxPx = 0.075 * uH;
  } else if (kind == 7) {                // glow / flash: aA = x0, y0, h0, size0; aB = size1, tone, decay power
    off = aA.xy * zs; h = aA.z * zs;
    size = mix(aA.w, aB.x, sqrt(age)) * zs;
    int tone = int(aB.y + 0.5);
    float f = tone == 1 ? 0.75 + 0.25 * sin(uNow * 17.0 + sd * 40.0) * sin(uNow * 5.3 + sd * 9.0) : 1.0;
    col = tone == 0 ? vec3(1.0, 0.93, 0.8) : tone == 1 ? vec3(1.0, 0.52, 0.18) : vec3(0.82, 0.86, 1.0);
    a = smoothstep(0.0, 0.03, age) * pow(1.0 - age, aB.z) * f;
    add = 1.0; shape = 1; maxPx = 0.45 * uH; minPx = 3.0;
  } else if (kind == 8) {                // lightning: aA = x0, y0, h0, length; aB = flashes per second, width, plume scale
    float k = aB.z > 0.0 ? max(zs, 0.03 * uAlt / aB.z) : zs;
    off = aA.xy * k; h = aA.z * k; offT = off; hT = (aA.z + aA.w) * k;
    float slot = floor(uNow * aB.x + sd * 31.0);
    float on = step(0.7, hash12(vec2(slot, sd * 91.0)));
    vFlick = fract(slot * 0.137) * 50.0;
    size = aB.y * k; col = vec3(0.86, 0.88, 1.0);
    a = on * (1.0 - smoothstep(0.85, 1.0, age)); add = 1.0; streak = true; shape = 3; minPx = 3.0; maxPx = 0.03 * uH;
  } else if (kind == 9) {                // snowflake circling the storm: aA = angle0, radius, height, size; aB.x = angular speed
    float ang = aA.x + aB.x * Ts, ang2 = ang - aB.x * 0.08;
    float br = 1.0 + 0.06 * sin(Ts * 1.3 + sd * 20.0);
    off = vec2(cos(ang), sin(ang)) * aA.y * br * zs; h = aA.z * zs;
    offT = vec2(cos(ang2), sin(ang2)) * aA.y * br * zs; hT = h;
    size = aA.w * zs; col = vec3(0.97, 0.98, 1.0);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.8, 1.0, age)) * 0.95;
    streak = true; shape = 8; minPx = 1.4; maxPx = 0.008 * uH;
  } else if (kind == 10) {               // ember rising from a fire front: aA = x0, y0, h max, size; aB = drift x, y
    float u2 = max(age - 0.1, 0.0);
    off = (aA.xy + aB.xy * age) * zs; h = aA.z * age * zs;
    offT = (aA.xy + aB.xy * u2) * zs; hT = aA.z * u2 * zs;
    float f = 0.6 + 0.4 * sin(uNow * 21.0 + sd * 60.0);
    size = aA.w * zs; col = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.8, 0.4), f);
    a = (1.0 - age) * f * smoothstep(0.0, 0.08, age); add = 1.0; streak = true; shape = 2; minPx = 1.2; maxPx = 0.008 * uH;
  }

  // when the zoom floor blows an event up, heights grow much less than distances: from orbit a meteor's path
  // stays a ground track instead of climbing off the planet's limb (the plume kinds keep their own floor)
  if (kind != 0 && kind != 1 && kind != 8) { float zh = (1.0 + 0.25 * (zs - 1.0)) / zs; h *= zh; hT *= zh; }
  vec3 up;
  vec3 P = placeOff(g0, e, n, off, h, up);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  float z = max(-mv.z, 1e-5);
  float hw = clamp(size * uPx / z, minPx, maxPx) / uPx;   // half width, in units of tan(view angle)
  vec2 s = mv.xy / z;
  vec2 c = position.xy;
  vec2 vs;
  if (streak) {
    vec3 upT;
    vec4 mt = viewMatrix * vec4(placeOff(g0, e, n, offT, hT, upT), 1.0);
    vec2 st = mt.xy / max(-mt.z, 1e-5);
    vec2 dv = s - st;
    float L = length(dv);
    vec2 dx = L > 1e-7 ? dv / L : vec2(1.0, 0.0);
    vec2 dy = vec2(-dx.y, dx.x);
    float hl = 0.5 * L + hw;
    vs = (s + st) * 0.5 + dx * c.x * hl + dy * c.y * hw;
    vK = hl / hw;
  } else {
    vs = s + c * hw;
  }
  a *= smoothstep(-0.02, 0.08, dot(up, normalize(cameraPosition - P)));
  vCol = vec4(col, a); vAdd = add; vShape = float(shape);
  gl_Position = projectionMatrix * vec4(vs * z, -z, 1.0);
}
`;

export const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform float uDot;
in vec2 vUV;
in vec4 vCol;
in float vAdd, vShape, vK, vSeed, vFlick;
layout(location = 0) out vec4 fragColor;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
${NOISE}
void main() {
  int shape = int(vShape + 0.5);
  vec2 c = vUV;
  float a, core = 0.0;
  vec3 col = vCol.rgb;
  if (shape == 0) {                      // soft lumpy puff, lit from the upper left so the clouds get volume
    float r = length(c);
    if (r > 1.0) discard;
    float lump = vnoise(c * 2.3 + vSeed * 41.0);
    a = (1.0 - smoothstep(0.05 + 0.4 * lump, 1.0, r)) * (0.85 + 0.15 * lump);
    col *= 0.88 + 0.26 * clamp(dot(c, vec2(-0.55, 0.65)) + 0.3 * (lump - 0.5), -1.0, 1.0) * (1.0 - vAdd);
  } else if (shape == 7) {               // meteor head: a white-hot core trailing back, inside a wide glow
    float d = length(vec2(max(abs(c.x) * vK - (vK - 1.0), 0.0), c.y));
    if (d > 1.0) discard;
    float along = clamp(0.5 + 0.5 * c.x, 0.0, 1.0);
    core = (1.0 - smoothstep(0.08, 0.32, d)) * mix(0.3, 1.0, along);
    a = core + exp(-d * d * 8.0) * 0.4 * (1.0 - d);
    col = mix(col, vec3(1.0, 0.98, 0.92), core);
  } else if (shape == 1) {               // glow
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    core = exp(-r2 * 30.0);
    a = exp(-r2 * 4.0) * (1.0 - r2) + 0.7 * core;
  } else if (shape == 2 || shape == 6 || shape == 8) {
    // streak: a capsule along x; shape 2 burns brightest at its newest end (+x); 8 (snow) has a grey-blue rim
    float d = length(vec2(max(abs(c.x) * vK - (vK - 1.0), 0.0), c.y));
    if (d > 1.0) discard;
    float along = clamp(0.5 + 0.5 * c.x, 0.0, 1.0);
    a = 1.0 - smoothstep(0.15, 1.0, d);
    if (shape == 2) { a *= mix(0.2, 1.0, along * along); core = (1.0 - smoothstep(0.0, 0.5, d)) * along; }
    else core = 1.0 - smoothstep(0.0, 0.5, d);
    if (shape == 8) { a = 1.0 - smoothstep(0.6, 1.0, d); col *= mix(vec3(0.62, 0.7, 0.82), vec3(1.0), 1.0 - smoothstep(0.25, 0.7, d)); }
  } else if (shape == 3) {               // lightning: a jagged line along x with a soft halo
    float t = c.x * 0.5 + 0.5;
    float j = (vnoise(vec2(t * 6.0, vSeed * 53.0 + vFlick)) - 0.5) * 0.9 + (vnoise(vec2(t * 21.0, vSeed * 7.0 + vFlick)) - 0.5) * 0.35;
    float d = abs(c.y - j * (1.0 - abs(c.x) * 0.5));
    core = exp(-d * d * 700.0);
    a = core + exp(-d * d * 6.0) * 0.3 * (1.0 - abs(c.x));
  } else if (shape == 4) {               // lava tongue: an elongated lens with a ragged edge
    float d = length(vec2(max(abs(c.x) * vK - (vK - 1.0), 0.0), c.y));
    float rag = vnoise(c * vec2(vK * 2.0, 2.0) + vSeed * 13.0);
    a = 1.0 - smoothstep(0.45 + 0.35 * rag, 1.0, d);
    core = (1.0 - smoothstep(0.0, 0.55, d)) * (0.55 + 0.45 * rag);
  } else {                               // dot
    float r = length(c);
    if (r > 1.0) discard;
    a = 1.0 - smoothstep(0.4, 1.0, r);
  }
  a *= vCol.a;
  col = mix(col, vec3(1.0, 0.97, 0.9), core * vAdd * 0.6);   // hot cores burn whiter
  float dots = hash12(floor(gl_FragCoord.xy / uDot) + floor(vSeed * 61.0));
  a *= mix(1.0, step(dots, a * 1.7), 0.45 * (1.0 - vAdd));
  if (a < 0.006) discard;
  fragColor = vec4(col * a, a * (1.0 - vAdd));
}
`;
