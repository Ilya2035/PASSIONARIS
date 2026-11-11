// Shared GLSL of the album: geometry of the sphere patch, height sampling, noise.
import { R, CENTRE, KM_PER_DEG, COS_REF } from './geo.js';

const f = n => Number(n).toFixed(8);
const D = Math.PI / 180;
export const COMMON = /* glsl */`
#define PI 3.14159265359
#define RKM ${f(R)}
#define KM ${f(KM_PER_DEG)}
#define COSREF ${f(COS_REF)}
#define S0 ${f(Math.sin(CENTRE.lat * D))}
#define C0 ${f(Math.cos(CENTRE.lat * D))}
#define LON0 ${f(CENTRE.lon)}
uniform sampler2D uBase; uniform vec4 uBaseRect;
uniform sampler2D uDet; uniform vec4 uDetRect; uniform float uDetOn;
uniform float uExag;

// (lat, lon) in degrees, height in km → world position (see geo.js)
vec3 worldOf(vec2 ll, float hKm) {
  float fi = radians(ll.x), dl = radians(ll.y - LON0), cf = cos(fi), sf = sin(fi), cd = cos(dl), r = RKM + hKm;
  return vec3(r * cf * sin(dl), r * (sf * S0 + cf * cd * C0) - RKM, -r * (sf * C0 - cf * cd * S0));
}
vec2 merc(vec2 ll) { float fi = radians(ll.x); return vec2((ll.y + 180.) / 360., (1. - log(tan(fi) + 1. / cos(fi)) / PI) * .5); }
// 1 inside the mapped region, fading to 0 just outside it
float inRegion(vec2 ll) {
  vec2 a = smoothstep(vec2(35.05, -10.15), vec2(35.25, -9.95), ll) * (1. - smoothstep(vec2(44.75, 4.45), vec2(44.95, 4.65), ll));
  return a.x * a.y;
}
float detailWeight(vec2 m) {
  if (uDetOn < .5) return 0.;
  vec2 ud = (m - uDetRect.xy) * uDetRect.zw, e = min(ud, 1. - ud);
  return smoothstep(0., .07, min(e.x, e.y));
}
// height in metres at an explicit level of detail of the region mosaic (lod 0 = 230 m per texel)
float heightLod(vec2 ll, float lod) {
  vec2 m = merc(ll);
  float hb = textureLod(uBase, (m - uBaseRect.xy) * uBaseRect.zw, lod).r, w = detailWeight(m);
  if (w > 0.) { float hd = textureLod(uDet, (m - uDetRect.xy) * uDetRect.zw, max(0., lod + 3.)).r; hb = mix(hb, hd > .6 ? hd : min(hb, -1.5), w); }
  return mix(-3200., hb, inRegion(ll));
}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), u = fract(p); u = u * u * (3. - 2. * u);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// distance to the nearest of a jittered lattice of points (x), and a random value of that point (y)
vec2 worley(vec2 p) {
  vec2 i = floor(p), u = fract(p); float d = 9.; float id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = hash22(i + g), r = g + o - u; float dd = dot(r, r);
    if (dd < d) { d = dd; id = hash21(i + g + 7.7); }
  }
  return vec2(sqrt(d), id);
}
// like worley(), but also where the nearest point lies: xy = vector to it, z = distance, w = its random value
vec4 worleyV(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.); float d = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + hash22(i + g) - u; float dd = dot(r, r);
    if (dd < d) { d = dd; best = r; id = hash21(i + g + 7.7); }
  }
  return vec4(best, sqrt(d), id);
}
// ---- the living cover of the land, shared by the ground shader and the 3D trees
// how wet a place is, 0 dry steppe .. 1 Atlantic forest (a stand-in for the climate data of the game)
float albumWet(vec2 ll, float hl, float n1) {
  float lat = ll.x, lon = ll.y;
  return .42 + .34 * smoothstep(42.2, 43.4, lat) * smoothstep(-.5, -2.5, lon)
    + .30 * smoothstep(-6.2, -8.6, lon) * smoothstep(38.2, 41.8, lat)
    + .22 * smoothstep(42., 43.2, lat) * smoothstep(3.5, .5, lon) + .25 * smoothstep(43., 44.5, lat)
    - .24 * exp(-dot(ll - vec2(41.6, -.6), ll - vec2(41.6, -.6)) / 1.7)
    - .30 * exp(-dot(ll - vec2(37.6, -1.8), ll - vec2(37.6, -1.8)) / 2.2)
    - .12 * exp(-dot(ll - vec2(39.3, -3.), ll - vec2(39.3, -3.)) / 2.6)
    + hl * .00016 + (n1 - .5) * .18;
}
float albumTreeline(float n1) { return 2150. + (n1 - .5) * 260.; }
// share of the ground under trees before patchiness: closed forest where wet, open woodland where dry
float albumForestShare(float wet, float hl, float slope, float n1) {
  float steep = smoothstep(.40, .82, slope), tl = albumTreeline(n1);
  float fc = smoothstep(.34, .58, wet) * (1. - smoothstep(tl - 180., tl + 40., hl)) * (1. - steep);
  return max(fc, smoothstep(.20, .34, wet) * .38 * (1. - steep) * (1. - smoothstep(1500., 1900., hl)));
}
float albumCover(float fc, float k, float n2, float n3) { return smoothstep(-.10, .10, fc * k - (n2 * .65 + n3 * .35) * .9 + .05); }
`;
