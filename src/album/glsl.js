// Shared GLSL of the album: geometry of the sphere patch, height sampling, noise.
import { R, CENTRE, KM_PER_DEG, COS_REF } from './geo.js';
import { FN, FKM } from './chunks.js';

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
`;

// ---- chunks: the state of the natural cells of the world (chunks.js), read the same way by the ground, the trees,
// the houses
export const CHUNK_GLSL = /* glsl */`
uniform sampler2D tChunkA, tChunkB, tChunkC, tChunkId; uniform vec4 uChunkRect;
// Where a point of the flat km plane falls in the state rasters. The rasters already hold every chunk in its own
// outline with the step to its neighbours softened; a slight wobble of the point hides the raster itself, so the
// change from one chunk to the next runs along a natural, uneven line.
vec2 chunkUV(vec2 pk) {
  vec2 w = vec2(vnoise(pk / 3.1 + 3.7), vnoise(pk / 3.1 + 41.3)) - .5;
  return (pk + w * 3.2 - uChunkRect.xy) * uChunkRect.zw;
}
vec4 chunkA(vec2 pk) { return texture(tChunkA, chunkUV(pk)); }   // forest, conifer share, forest age, swamp
vec4 chunkB(vec2 pk) { return texture(tChunkB, chunkUV(pk)); }   // ice, snow, flood, spare
vec4 chunkC(vec2 pk) { return texture(tChunkC, chunkUV(pk)); }   // built, fields, building manner, burnt
// Which chunk a point lies in: x = the number of the chunk, y = 0 on its border .. 1 deep inside. The outline is
// smoothed inside the fine raster (the chunk that holds most of the four texels around the point wins), so borders
// run as slanting, rounded lines, not as steps. One km of distance from a border is 1.6 of y.
float chunkIdTexel(ivec2 i) { vec2 v = texelFetch(tChunkId, clamp(i, ivec2(0), ivec2(${FN - 1})), 0).rg; return floor(v.r * 255. + .5) + floor(v.g * 255. + .5) * 256.; }
vec2 chunkCell(vec2 pk) {
  vec2 q = pk + (vec2(vnoise(pk / 1.7 + 5.3), vnoise(pk / 1.7 + 17.9)) - .5) * .5;
  vec2 t = (q - uChunkRect.xy) / ${FKM.toFixed(4)} - .5, f = fract(t); ivec2 i = ivec2(floor(t));
  float a = chunkIdTexel(i), b = chunkIdTexel(i + ivec2(1, 0)), c = chunkIdTexel(i + ivec2(0, 1)), d = chunkIdTexel(i + ivec2(1, 1));
  float wa = (1. - f.x) * (1. - f.y), wb = f.x * (1. - f.y), wc = (1. - f.x) * f.y, wd = f.x * f.y;
  float sa = wa + (b == a ? wb : 0.) + (c == a ? wc : 0.) + (d == a ? wd : 0.), sb = wb + (a == b ? wa : 0.) + (c == b ? wc : 0.) + (d == b ? wd : 0.);
  float sc = wc + (a == c ? wa : 0.) + (b == c ? wb : 0.) + (d == c ? wd : 0.), sd = wd + (a == d ? wa : 0.) + (b == d ? wb : 0.) + (c == d ? wc : 0.);
  float best = a, w1 = sa;
  if (sb > w1) { best = b; w1 = sb; } if (sc > w1) { best = c; w1 = sc; } if (sd > w1) { best = d; w1 = sd; }
  float w2 = 0.;
  if (a != best) w2 = max(w2, sa); if (b != best) w2 = max(w2, sb); if (c != best) w2 = max(w2, sc); if (d != best) w2 = max(w2, sd);
  return vec2(best, w1 - w2);
}
// the texel of a square per-chunk texture (uChunkPalW a side) that belongs to a chunk: for texelFetch
uniform float uChunkPalW;
ivec2 chunkTexel(float id) { float row = floor(id / uChunkPalW); return ivec2(int(id - row * uChunkPalW), int(row)); }
`;

// ---- one light for everything: the ground and anything that stands on it use the same sun, sky, air and finish
export const LIGHT = /* glsl */`
uniform vec3 uSun; uniform float uHaze, uExposure, uSat, uWarm; uniform int uStyle;
float albumDay() { return smoothstep(-.08, .12, uSun.z); }
vec3 albumSunCol() {
  vec3 c = mix(vec3(1.25, .62, .30), vec3(1.22, 1.15, 1.02), smoothstep(.05, .45, uSun.z)) * albumDay();
  return mix(c, c * vec3(1.06, 1., .9), uWarm);
}
vec3 albumSkyCol() { return mix(vec3(.26, .33, .52), vec3(.46, .58, .78), albumDay()) * .62; }   // night keeps a moonlit blue
// a thing on the land: its colour as seen on screen, its normal (east, north, up), how open it is to the sky (0..1.5)
vec3 albumLit(vec3 seen, vec3 n, float open) {
  return pow(seen, vec3(2.2)) * (albumSunCol() * max(dot(normalize(n), uSun), 0.) * 1.25 + albumSkyCol() * open);
}
// the air between the eye and a point of the world: how much of it there is (0..1), its colour, and both applied
float albumHaze(vec3 wpos) {
  vec3 up = normalize(wpos + vec3(0., RKM, 0.)), Vw = normalize(cameraPosition - wpos);
  float dist = length(cameraPosition - wpos), camAlt = length(cameraPosition + vec3(0., RKM, 0.)) - RKM;
  return 1. - exp(-(uHaze * dist / (camAlt * 2.2 + 25.) + .012 / max(dot(Vw, up), .03)));
}
vec3 albumHazeCol() {
  if (uStyle == 6) return vec3(.05, .07, .11);
  if (uStyle == 3) return vec3(.84, .86, .86);
  return mix(vec3(.55, .70, .92), vec3(1., .78, .55), (1. - smoothstep(.05, .5, uSun.z)) * .6) * (.12 + .88 * albumDay());
}
vec3 albumAir(vec3 col, vec3 wpos) { return mix(col, albumHazeCol(), albumHaze(wpos)); }
// exposure, tone curve, saturation, display gamma: the last step of every pixel
vec3 albumFinish(vec3 col) {
  col *= uExposure;
  if (uStyle != 3 && uStyle != 2) col = (col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14);
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  return pow(clamp(col, 0., 1.), vec3(1. / 2.2));
}
`;
// the uniforms of LIGHT, to spread into a material: ...lightUniforms(album.terrain.u)
export const lightUniforms = T => ({ uSun: T.uSun, uHaze: T.uHaze, uExposure: T.uExposure, uSat: T.uSat, uWarm: T.uWarm, uStyle: T.uStyle });
