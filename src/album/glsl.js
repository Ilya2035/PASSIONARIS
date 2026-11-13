// Shared GLSL of the album: geometry of the sphere patch, height sampling, noise.
import { R, CENTRE, KM_PER_DEG, COS_REF } from './geo.js';
import { FN, FKM } from './chunks.js';
import { WARM, LAPSE, TREE_WARM, TREE_SOFT, TREE_SOFT_K, WET_RISE, WET_RISE_MIN, WET_RISE_MAX } from './ground/climate.js';

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
// (The whole part of p meets only the fraction of each factor: far from the origin — and the album lies 4000 km north
// of it — p × 456.21 has no bits left for a fraction of its own, and every fine noise ran in stripes from north to south.)
float hash21(vec2 p) { vec2 i = floor(p); p = fract((p - i) * vec2(123.34, 456.21) + i * vec2(.34, .21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// The same for whole numbers only — the corners of a cell of noise, which is where nearly every call comes from. One
// multiplication, as the old line had, and small factors, so that the row numbers of the album (tens of thousands)
// keep their fraction.
float hashCell(vec2 i) { vec2 p = fract(i * vec2(.1031, .2137)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), u = fract(p); u = u * u * (3. - 2. * u);
  return mix(mix(hashCell(i), hashCell(i + vec2(1, 0)), u.x), mix(hashCell(i + vec2(0, 1)), hashCell(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// distance to the nearest of a jittered lattice of points (x), and a random value of that point (y)
vec2 worley(vec2 p) {
  vec2 i = floor(p), u = fract(p); float d = 9.; float id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = hash22(i + g), r = g + o - u; float dd = dot(r, r);
    if (dd < d) { d = dd; id = hashCell(i + g + 77.); }
  }
  return vec2(sqrt(d), id);
}
// like worley(), but also where the nearest point lies: xy = vector to it, z = distance, w = its random value
vec4 worleyV(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.); float d = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + hash22(i + g) - u; float dd = dot(r, r);
    if (dd < d) { d = dd; best = r; id = hashCell(i + g + 77.); }
  }
  return vec4(best, sqrt(d), id);
}
// The climate of a place, from the map baked out of open data (ground/climate.js, docs/album/ground.md):
//   r  mean height of the land around, / 4096 m      g  how wet: 0 desert .. .2 steppe .. .34 open woodland .. .58 closed forest .. 1
//   b  mean of the warmest month at sea level, ${WARM[0]} .. ${WARM[1]} °C      a  0 a summer without water .. 1 a green summer
// A shader that asks for it needs tClimate and uClimRect among its uniforms (album.terrain.u has them).
uniform sampler2D tClimate; uniform vec4 uClimRect;
// (textureLod, not texture: a read that needs screen derivatives inside a condition makes the compiler of the video
// card run both sides of every condition around it, and the whole ground shader slowed down by a half)
vec4 albumClimate(vec2 ll) { return textureLod(tClimate, (vec2(ll.y * KM * COSREF, ll.x * KM) - uClimRect.xy) * uClimRect.zw, 0.); }
// how wet a place is, 0 desert .. 1 Atlantic forest: the climate of the country, wetter above it and drier below, and
// a little unevenness (n1: the shared noise of 38 km)
float albumWetOf(vec4 clim, float hl, float n1) {
  return clim.g + clamp((hl - clim.r * 4096.) * ${f(WET_RISE)}, ${f(WET_RISE_MIN)}, ${f(WET_RISE_MAX)}) + (n1 - .5) * .12;
}
float albumWet(vec2 ll, float hl, float n1) { return albumWetOf(albumClimate(ll), hl, n1); }
// the height at which trees stop, m: where the warmest month is no warmer than ${TREE_WARM} °C; in the hot dry mountains
// of the south drought and wind stop them lower than the warmth would (treelineOf() in ground/climate.js is its twin)
float albumTreelineOf(vec4 clim) { float t = (mix(${f(WARM[0])}, ${f(WARM[1])}, clim.b) - ${f(TREE_WARM)}) / ${f(LAPSE)}; return t < ${f(TREE_SOFT)} ? t : ${f(TREE_SOFT)} + (t - ${f(TREE_SOFT)}) * ${f(TREE_SOFT_K)}; }
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
// smoothed inside the fine raster: the nine texels around the point each weigh in with a smooth bell (a quadratic
// B-spline) and the chunk that weighs most wins, so borders run as clean curves, not as steps of the raster.
// One km of distance from a border is 1.6 of y.
float chunkIdTexel(ivec2 i) { vec2 v = texelFetch(tChunkId, clamp(i, ivec2(0), ivec2(${FN - 1})), 0).rg; return floor(v.r * 255. + .5) + floor(v.g * 255. + .5) * 256.; }
vec2 chunkCell(vec2 pk) {
  vec2 t = (pk - uChunkRect.xy) / ${FKM.toFixed(4)}, f = fract(t); ivec2 c = ivec2(floor(t));
  float wx[3] = float[3](.5 * (1. - f.x) * (1. - f.x), .75 - (f.x - .5) * (f.x - .5), .5 * f.x * f.x);
  float wy[3] = float[3](.5 * (1. - f.y) * (1. - f.y), .75 - (f.y - .5) * (f.y - .5), .5 * f.y * f.y);
  float ids[9], ws[9];
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) { ids[j * 3 + i] = chunkIdTexel(c + ivec2(i - 1, j - 1)); ws[j * 3 + i] = wx[i] * wy[j]; }
  float best = ids[4], w1 = 0., w2 = 0.;
  for (int a = 0; a < 9; a++) { float s = 0.; for (int b = 0; b < 9; b++) if (ids[b] == ids[a]) s += ws[b]; if (s > w1) { w1 = s; best = ids[a]; } }
  for (int a = 0; a < 9; a++) if (ids[a] != best) { float s = 0.; for (int b = 0; b < 9; b++) if (ids[b] == ids[a]) s += ws[b]; w2 = max(w2, s); }
  return vec2(best, w1 - w2);
}
// the texel of a square per-chunk texture (uChunkPalW a side) that belongs to a chunk: for texelFetch
uniform float uChunkPalW;
ivec2 chunkTexel(float id) { float row = floor(id / uChunkPalW); return ivec2(int(id - row * uChunkPalW), int(row)); }
`;

// ---- one light for everything lives in light.js (its owner: the part «Небо и свет»); the old names stay here
export { LIGHT, lightUniforms } from './light.js';
