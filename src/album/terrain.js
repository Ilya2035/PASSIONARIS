// The land and the sea: nested square grids around the camera target (each level twice as coarse as the one inside
// it), lifted onto the sphere by the height data in the vertex shader. Around them, the rest of the ball of the Earth:
// one grid of latitude and longitude with a point every degree (the globe), drawn by the same program. Everything visible — relief shading, cast
// shadows, vegetation, snow, water — is computed per pixel from the same height data, so the picture does not depend
// on the grid and shapes never change with the camera height.
//
// The pixel shader is assembled from parts. This file owns the frame: heights, light, bare ground and rock, snow, map
// overlays, air. The living and changing things — swamp, fields, forest, water, borders — are aspects
// (src/album/aspects/*.js), each one file with its own owner; they read the state of the chunks (chunks.js) and are
// all lit by the same light (LIGHT in glsl.js). The contract is docs/ALBUM-CHUNKS.md.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, SphereGeometry, BackSide, Color, DataArrayTexture, DataTexture, RGBAFormat, RedFormat,
  UnsignedByteType, FloatType, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT } from './glsl.js';
import { ASPECT_GLSL, ASPECT_UNIFORMS } from './aspects/index.js';
import { R, KM_PER_DEG, COS_REF, wrapLon, LAT_MAX, BBOX, STAGE } from './geo.js';
import { FKM, NONE, SNX, SNY } from './chunks.js';
import { GROUND_TILES } from './data.js';
import { CLIM_KM, climateTexels, WARM, WARM_WORLD, LAPSE, SNOW_WARM, SNOW_DRY, SNOW_TROPIC, TREE_WARM, TREE_DRY, TREE_SOFT, TREE_SOFT_K } from './ground/climate.js';
import { stepTable } from './ground/steps.js';
import { REGION_FADE, STATE_FADE, WORLD_LOD0 } from './ground/world.js';

const M = 160, LEVELS = 9;
const POLE_LAT = 88;   // a level of the grid is drawn only if it ends short of this latitude
// The variants of the ground shader (ZONE in its text) overlap by this much along their borders, degrees
const ZEPS = .004;
// can the video card cut a grid in the vertex shader (WEBGL_clip_cull_distance)? Without it one variant draws all.
let canClip;
function clipOk() {
  if (canClip === undefined) {
    const gl = typeof document !== 'undefined' ? document.createElement('canvas').getContext('webgl2') : null;
    canClip = !!(gl && gl.getExtension('WEBGL_clip_cull_distance'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return canClip;
}
// the planes a cut grid is clipped by are switched on for its own draw only (three.js does not know of them)
const CLIP0 = 0x3000, clipOn = r => { const gl = r.getContext(); for (let i = 0; i < 5; i++) gl.enable(CLIP0 + i); }, clipOff = r => { const gl = r.getContext(); for (let i = 0; i < 5; i++) gl.disable(CLIP0 + i); };
// does a square of a grid (centre and half-sides in degrees) touch, or lie within, the polygon grown by m degrees
const touches = (lat, lon, hLat, hLon, m) => lat + hLat >= BBOX.lat0 - m && lat - hLat <= BBOX.lat1 + m && [-360, 0, 360].some(k => lon + hLon >= BBOX.lon0 - m + k && lon - hLon <= BBOX.lon1 + m + k);
const within = (lat, lon, hLat, hLon, m) => lat - hLat >= BBOX.lat0 - m && lat + hLat <= BBOX.lat1 + m && lon - hLon >= BBOX.lon0 - m && lon + hLon <= BBOX.lon1 + m;
// which variants have something to draw in a square: [zone 1, zone 2, zone 3]
export const zonesOf = (lat, lon, hLat, hLon) => [
  touches(lat, lon, hLat, hLon, ZEPS - STATE_FADE[1]),
  touches(lat, lon, hLat, hLon, REGION_FADE + ZEPS) && !within(lat, lon, hLat, hLon, -STATE_FADE[1] - ZEPS),
  !within(lat, lon, hLat, hLon, REGION_FADE - ZEPS)];
// The same at stage 3, where the rectangle of the heights holds land without chunks — the plain land of the world on
// detailed heights: the south of England, Germany beyond the Rhine, Switzerland, Italy, the Sahara. A square is
// drawn by ONE of the first two variants, whole: by the fast one (zone 1, which takes every pixel for worked land)
// when all of it is worked land deep enough inside the rectangle, otherwise by the full one (zone 2), which asks
// every pixel whether a chunk lies under it. worked: is every texel of the chunk raster under the square a chunk.
export const zonesOf3 = (lat, lon, hLat, hLon, worked) => {
  const fast = worked && within(lat, lon, hLat, hLon, -STATE_FADE[1] - ZEPS);
  return [fast, !fast && touches(lat, lon, hLat, hLon, REGION_FADE + ZEPS), !within(lat, lon, hLat, hLon, REGION_FADE - ZEPS)];
};
// How many texels of the state raster of the chunks (2.5 km) hold a chunk, summed from the south-west corner: for
// «is every texel under this square a chunk» in a few numbers. cell: ch.stateCell; → Int32Array (nx + 1) × (ny + 1).
export function chunkSums(cell, nx = SNX, ny = SNY) {
  const w = nx + 1, sum = new Int32Array(w * (ny + 1));
  for (let y = 0; y < ny; y++) for (let x = 0, row = 0; x < nx; x++) { row += cell[y * nx + x] !== NONE ? 1 : 0; sum[(y + 1) * w + x + 1] = sum[y * w + x + 1] + row; }
  return sum;
}
// is every texel under the square (centre and half-sides in degrees), and two texels around it, a chunk.
// rect: the lattice of the chunks { x0, y0 } in flat km; km: the side of a texel
export function allChunks(sum, lat, lon, hLat, hLon, rect, nx = SNX, ny = SNY, km = FKM * 2) {
  const x0 = Math.floor(((lon - hLon) * KM_PER_DEG * COS_REF - rect.x0) / km) - 2, x1 = Math.floor(((lon + hLon) * KM_PER_DEG * COS_REF - rect.x0) / km) + 2;
  const y0 = Math.floor(((lat - hLat) * KM_PER_DEG - rect.y0) / km) - 2, y1 = Math.floor(((lat + hLat) * KM_PER_DEG - rect.y0) / km) + 2;
  if (x0 < 0 || y0 < 0 || x1 >= nx || y1 >= ny) return false;
  const w = nx + 1, n = sum[(y1 + 1) * w + x1 + 1] - sum[y0 * w + x1 + 1] - sum[(y1 + 1) * w + x0] + sum[y0 * w + x0];
  return n === (x1 - x0 + 1) * (y1 - y0 + 1);
}
// ---- what stage 3 adds to the text of the shaders (at stage 2 none of it is in them)
// the full variant is not cut on its inner side: it draws whatever the fast one leaves, however deep inside
export const S3_CLIP_INNER = '1.';
// 1 where a chunk lies under the point, 0 where none does (chunks.js, NONE), joined smoothly between the texels of
// the chunk raster — the edge of the worked land is a band of one texel, 1.25 km, along the outlines of the chunks
export const S3_CHUNK_HERE = `
float chunkHere(vec2 pk) {
  vec2 t = (pk - uChunkRect.xy) / ${FKM.toFixed(4)} - .5, f = fract(t); ivec2 c = ivec2(floor(t));
  vec4 id = vec4(chunkIdTexel(c), chunkIdTexel(c + ivec2(1, 0)), chunkIdTexel(c + ivec2(0, 1)), chunkIdTexel(c + ivec2(1, 1)));
  vec4 w = step(id, vec4(${(NONE - .5).toFixed(1)}));
  return mix(mix(w.x, w.y, f.x), mix(w.z, w.w, f.x), f.y);
}`;
// the state of the chunks holds where a chunk lies, and gives way to the natural state at the rim of the rectangle
// as before
export const S3_STATE = `min(smoothstep(${STATE_FADE[0]}, ${STATE_FADE[1]}, regionEdge(ll)), chunkHere(pk))`;
// a texture of one point, for a map that is missing
const flat = (format, data) => { const t = new DataTexture(data, 1, 1, format, data instanceof Float32Array ? FloatType : UnsignedByteType); t.colorSpace = NoColorSpace; t.needsUpdate = true; return t; };
const f1 = n => Number(n).toFixed(1);

const VERT = /* glsl */`
#define ALBUM_WORLD 1
${COMMON}
attribute vec2 grid;
uniform vec2 uCentre; uniform float uCell; uniform vec3 uFine; uniform float uLod; uniform int uZone;
varying vec2 vLL; varying vec3 vPos;
void main() {
  vec2 off = grid * uCell;                                         // km east, north of the level centre
  vec2 ll = uCentre + vec2(off.y / KM, off.x / (KM * COSREF));
  float h = max(heightLod(ll, uLod), 0.) * uExag / 1000.;
  // Under the finer level this level steps down out of its way: that alone keeps the two apart. The levels are not
  // pushed back in depth as well (they were, by polygonOffset): at the border of a level the depth then jumped by half
  // the span of a pixel, and the shading of the finishing pass (post.js) drew that jump as a thin dark line along
  // every border — nested squares on the sea from on high and under a tilted camera.
  // The step begins a cell and a half inside the border of the finer level (uFine.z falls between two rows of
  // vertices, so no rounding decides it): the outer row under the finer level lies at its true height and backs the
  // seam, the wall of the step stands one cell further in, where nothing sees it.
  if (uFine.z > 0.) {
    float dl = ll.y - uFine.y; dl -= 360. * floor((dl + 180.) / 360.);   // (the finer level may lie across the line of 180°)
    vec2 d = abs(vec2(dl * KM * COSREF, (ll.x - uFine.x) * KM));
    if (max(d.x, d.y) < uFine.z) h -= uCell * .9;
  }
  vLL = ll; vPos = worldOf(ll, h);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
#ifdef CLIP_ZONES
  // The pixel shader has three variants (ZONE, below), and each draws its own part of the Earth: the grid is cut
  // along the borders between the parts, each variant keeping its own side — a hair more, so that no pixel on a
  // border is left to nobody; where two variants overlap they paint the same.
  //   1 inside the polygon, from ${STATE_FADE[1]}° inside its border   2 the border, out to ${REGION_FADE}° beyond it   3 the world beyond
  vec4 dz = vec4(ll - vec2(${f1(BBOX.lat0)}, ${f1(BBOX.lon0)}), vec2(${f1(BBOX.lat1)}, ${f1(BBOX.lon1)}) - ll), c4 = vec4(1.);   // degrees inside each side of the polygon
  float dm = min(min(dz.x, dz.y), min(dz.z, dz.w)), c5 = 1.;
  if (uZone == 1) c4 = dz - ${(STATE_FADE[1] - ZEPS).toFixed(4)};
  else if (uZone == 2) { c4 = dz + ${(REGION_FADE + ZEPS).toFixed(4)}; c5 = ${STAGE >= 3 ? S3_CLIP_INNER : `${(STATE_FADE[1] + ZEPS).toFixed(4)} - dm`}; }
  else if (uZone == 3) c5 = ${(ZEPS - REGION_FADE).toFixed(4)} - dm;
  gl_ClipDistance[0] = c4.x; gl_ClipDistance[1] = c4.y; gl_ClipDistance[2] = c4.z; gl_ClipDistance[3] = c4.w; gl_ClipDistance[4] = c5;
#endif
}`;

const FRAG_SRC = /* glsl */`
// ZONE: which part of the Earth this variant of the shader draws (the materials of Terrain define it):
//   1  inside the polygon. Nothing of the world is in it: it is the shader the polygon had before the Earth was
//      added, and adding to the world cannot slow it. (The whole of it stands at an edge of speed — a line more, and
//      a weak video card draws it half as slow again: docs/album/ground.md, «Скорость». With the rules of the world
//      written into the one shader, Spain went from 165 to 253 ms a frame, whichever way they were written.)
//   2  the border: the last ${STATE_FADE[1]}° inside the polygon, where the state of the chunks gives way to the natural
//      state, and ${REGION_FADE}° beyond it, where its heights and climate give way to those of the world. All of the shader.
//   3  the world beyond. Nothing of the polygon is in it: no chunks, no swamp, fields, houses or borders, no heights
//      of its own.
//   0  the whole Earth by one variant (all of the shader), where the video card cannot cut the grids.
// REGION(ll): 1 inside the polygon .. 0 beyond it; STATE(ll): 1 the state of the chunks .. 0 the natural state.
#if ZONE == 1
#define ALBUM_WORLD 0
#define REGION(ll) 1.
#define STATE(ll) 1.
#elif ZONE == 3
#define ALBUM_WORLD 2
#define REGION(ll) 0.
#define STATE(ll) 0.
#else
#define ALBUM_WORLD 1
#define REGION(ll) inRegion(ll)
#define STATE(ll) ${STAGE >= 3 ? S3_STATE : `smoothstep(${STATE_FADE[0]}, ${STATE_FADE[1]}, regionEdge(ll))`}
#endif
${COMMON}
${CHUNK_GLSL}${STAGE >= 3 ? S3_CHUNK_HERE : ''}
${LIGHT}
uniform float uTime, uShade, uSnow, uForestK, uSeason;
uniform int uGrid, uData;
// The grain of the ground: squares of real ground about 10 km across, seen from a satellite, with their broad tones
// taken out (scripts/album/bake-ground-tiles.mjs). They are layers of one texture: a pixel shader may read only 16
// textures, and the aspects need some of them. The names are layer numbers for texDetail():
// wet heath and meadow (the mottle of a forest canopy is the same), dry steppe, stony desert, dunes (and snow shaped by wind).
uniform highp sampler2DArray tGround;
#define tGrass 0
#define tDry 1
#define tRock 2
#define tSand 3
#define tSnow 3
#define tForest 0
uniform sampler2D uFire; uniform vec4 uFireRect; uniform float uFireOn; uniform vec4 uQuake;
uniform sampler2D tChunkPal; uniform float uChunkShow, uChunkHoverId;
varying vec2 vLL; varying vec3 vPos;

// ---- what every aspect is told about the pixel
struct Px {
  vec2 ll;             // latitude, longitude, degrees
  vec2 pk;             // flat km (east, north): the coordinates of every pattern
  vec2 pdx, pdy;       // screen derivatives of pk, for texDetail()
  float px;            // km per screen pixel
  float h, hl;         // height in metres (negative under the sea); the same, not below 0
  float slope;         // rise over run
  vec3 n;              // normal of the ground (east, north, up)
  float wet;           // 0 dry steppe .. 1 Atlantic forest (albumWet)
  float n1, n2, n3;    // shared noises 38, 7 and 1 km across; the small ones fade to .5 when smaller than a pixel
  vec3 V;              // direction to the eye (east, north, up)
  vec2 sd;             // direction toward the sun along the ground
  float day, sh, ao;   // 0 night .. 1 day; 0 in the shadow of relief .. 1 lit; 0 deep hollow .. 1 open
  vec3 sunCol, skyCol; // light of the sun and of the sky
  vec4 cA, cB, cC;     // state of the chunks at this point, joined smoothly (CHANNELS in chunks.js)
};
// ---- what the land aspects build together
struct Land {
  vec3 col;            // colour of the land as seen on screen, before light
  float cover;         // share under forest canopy
  float gloss;         // 0 matt .. 1 open water that mirrors the sky
};

// the warmest month at sea level beyond the polygon, °C (cw: worldClimate()), and the line of lasting snow by it, m
// (snowlineOf() in ground/climate.js is its twin)
float worldWarm(vec4 cw) { return mix(${f1(WARM_WORLD[0])}, ${f1(WARM_WORLD[1])}, cw.b); }
float worldSnow(float warm, float lat) { return (warm - ${f1(SNOW_WARM)} + ${f1(SNOW_DRY)} * smoothstep(26., 36., warm) + ${f1(SNOW_TROPIC)} * (1. - smoothstep(10., 30., abs(lat)))) / ${LAPSE}; }
// The height of the map of the whole Earth for a pixel, m. lw: the level of detail the pixel wants of it, 0 = a point
// of the map (4.9 km), negative = finer than the map has.
// Seen from near, the map is much coarser than a pixel. Joined plainly between its four nearest points, the land
// is a quilt of creased squares 5 km a side; with the slope taken over a whole cell instead, a quilt of square
// bumps (the lead on the border of the polygon in Algeria, 15.11.2026). So below its own size the heights are joined
// as a smooth surface — a cubic B-spline, four reads of the texture; from the size of a point up, plainly.
// (Written into the one shader of the ground this slowed Spain down by a half; the variant of the polygon — ZONE 1
// — has no use for it and never runs it.)
float worldPix(vec2 ll, float lw) {
  vec2 uv = vec2(ll.y / 360. + .5, .5 - ll.x / 180.);
  if (lw >= 1.) return textureLod(tWorld, uv, lw).r;
  vec2 sz = vec2(textureSize(tWorld, 0)), t = uv * sz - .5, f = fract(t), i = t - f;
  vec2 g0 = f * (f * (2. * f - 3.) - 3.) + 5., g1 = f * (f * (3. - 2. * f) + 3.) + 1.;                     // the weights of the two pairs of points, × 6
  vec2 u0 = (i - .5 + (f * f * (3. * f - 6.) + 4.) / g0) / sz, u1 = (i + 1.5 + f * f * f / g1) / sz;
  float hs = ((textureLod(tWorld, u0, 0.).r * g0.x + textureLod(tWorld, vec2(u1.x, u0.y), 0.).r * g1.x) * g0.y
    + (textureLod(tWorld, vec2(u0.x, u1.y), 0.).r * g0.x + textureLod(tWorld, u1, 0.).r * g1.x) * g1.y) / 36.;
  return lw > 0. ? mix(hs, textureLod(tWorld, uv, lw).r, lw) : hs;
}
// rg: inRegion() of the pixel; lw: the level of detail of the world map for it (worldPix)
float heightPix(vec2 ll, float rg, float lw) {
#if ZONE == 3
  return worldPix(ll, lw);
#else
  vec2 m = merc(ll);
  float hb = texture(uBase, (m - uBaseRect.xy) * uBaseRect.zw).r;
  if (uDetOn > .5) { float w = detailWeight(m), hd = texture(uDet, (m - uDetRect.xy) * uDetRect.zw).r; hb = mix(hb, hd > .6 ? hd : min(hb, -1.5), w); }
  if (rg < 1.) hb = mix(worldPix(ll, lw), hb, rg);
  return hb;
#endif
}
// The grain of the ground as detail around 1: keeps our palette, adds the pattern of real ground. A square of real
// ground lies on the land at its true size and nowhere else: 10 km a tile, 10 m a texel. It is fixed to the land and
// nothing is ever switched as the camera rises: there is no layer to see change.
// The grain is for the near and middle heights only. It fades out with the size of a pixel and is gone from about
// 300 km up: seen from there a tile of 10 km repeats every few dozen pixels, and the land must be a calm tone with
// the large patches of nature — soils, valleys, the wet and the dry (the owner on the map from on high: the same
// winding, spotted pattern all over the plateau).
// The same tile laid five times finer and five times coarser was tried and dropped (14.11.2026). Coarser, it drew the
// dry river beds of the tile 50 km long over the whole plateau. Finer, its one river bed came back every 2 km as the
// same little hook, row upon row at 20–50 km. What is finer than the tile is drawn by rule: the mottle and the bushes
// of the bare ground (aspects/ground.js), the gullies of the rock.
// t is one of tGrass, tDry, tRock, tSand, tSnow, tForest: a layer of the ground texture.
// The ground shader itself calls this once for a pixel, last of all, over the bare ground, the rock and the sand
// together, and uses the answer at once (why: aspects/ground.js).
vec3 texDetail(int t, vec2 pk, float px, vec2 dx, vec2 dy) {
  if (px >= .11) return vec3(1.);
  return clamp(1. + (textureGrad(tGround, vec3(pk / 10.24 + .37, float(t)), dx / 10.24, dy / 10.24).rgb - .5) * (1.7 * smoothstep(.11, .035, px)), .55, 1.5);
}
// Ribs and gullies that run down a slope, along the direction d (a unit vector on the ground). A noise drawn out
// along d and folded at its middle, so that the fold is a crease: at the larger size (ribs some 800 m apart, 50 m
// high) the crests are sharp, at the smaller (250 m apart, 12 m) the bottoms of the gullies. A crease is what the
// smooth height data never has, and what the eye reads as a mountain: a line where a lit face meets a shaded one.
//   xy  the slope of this relief toward east and north (rise over run), to add to that of the ground
//   z   its height: −1 the bottom of a gully .. 1 the crest of a rib
// f: how much of the smaller size is still larger than a pixel; w: a shift across the slope, km, that makes the
// lines of the ribs wander.
// (The fold is rounded a little. Folded as sharp as a knife, every flank of a rib was one flat facet, and an open
// slope looked cut out of paper — long triangles all over the alpine meadows of Andorra.)
vec3 ribs(vec2 pk, vec2 d, float f, float w) {
  vec2 q = vec2(dot(pk, vec2(-d.y, d.x)) + w, dot(pk, d));
  vec3 a = vnoiseD(q / vec2(.42, 1.5) + 7.), b = vnoiseD(q / vec2(.14, .45) + 31.);
  float ta = 2. * a.x - 1., tb = 2. * b.x - 1., ra = sqrt(ta * ta + .03), rb = sqrt(tb * tb + .03);
  f *= .35 + 1.3 * a.x;                                             // (the gullies gather on one flank of a rib: no two slopes alike)
  vec2 gq = a.yz / vec2(.42, 1.5) * (-.2 * ta / ra) + b.yz / vec2(.14, .45) * (.05 * f * tb / rb);
  return vec3(vec2(-d.y, d.x) * gq.x + d * gq.y, (1. - 2. * ra) * .75 + (2. * rb - 1.) * .25 * f);
}
// A value noise in space: for a pattern on the ball of the Earth where the flat km of latitude and longitude fold —
// round a pole every pattern of pk is drawn out into a fan.
float vnoise3(vec3 p) {
  vec3 i = floor(p), u = fract(p); u = u * u * (3. - 2. * u);
  vec2 a = i.xy + i.z * vec2(37., 17.), b = a + vec2(37., 17.);
  return mix(mix(mix(hashCell(a), hashCell(a + vec2(1, 0)), u.x), mix(hashCell(a + vec2(0, 1)), hashCell(a + vec2(1, 1)), u.x), u.y),
    mix(mix(hashCell(b), hashCell(b + vec2(1, 0)), u.x), mix(hashCell(b + vec2(0, 1)), hashCell(b + vec2(1, 1)), u.x), u.y), u.z);
}
vec3 hypso(float h) {
  vec3 c = vec3(.62, .76, .56);
  c = mix(c, vec3(.78, .84, .60), smoothstep(100., 350., h)); c = mix(c, vec3(.90, .86, .62), smoothstep(350., 800., h));
  c = mix(c, vec3(.88, .74, .52), smoothstep(800., 1400., h)); c = mix(c, vec3(.76, .58, .43), smoothstep(1400., 2100., h));
  c = mix(c, vec3(.66, .62, .60), smoothstep(2100., 2800., h)); return mix(c, vec3(.97), smoothstep(2800., 3300., h));
}
vec3 idColour(float id) { return .5 + .5 * cos(6.2832 * (id + vec3(0., .33, .67))); }
// What the ground shader worked out about the place before it asked the aspects: the mean height of the land around,
// m (albumClimate), and the height at which trees stop here, m.
// (Two numbers and no more. Whatever must be remembered from here until the last aspect has run is held for every
// pixel in flight; past a certain count a weak video card works on fewer pixels at a time, and the whole ground
// shader runs half as fast. Measured 13.11.2026: thirteen more numbers than before were too many, ten were not.)
// gSummer: 0 a summer without water .. 1 a green one (the forest takes its tint from it).
float gRise, gTreeline, gSummer;

${ASPECT_GLSL}

void main() {
  // (a grid of the ground may run past 180°: the longitude is brought back, so that every pattern is the same from
  // both sides of that line; rg: 1 inside the polygon .. 0 on the plain land of the world)
  vec2 ll = vec2(vLL.x, vLL.y - 360. * floor((vLL.y + 180.) / 360.)); float lat = ll.x, lon = ll.y, cl = max(cos(radians(lat)), .03), rg = REGION(ll);
  // The size of a pixel on the ground, km. Every pattern fades by it once its features are smaller than a pixel, so
  // it must be the same for the same ground however the camera is turned — or the patterns come and go as the view
  // swings round, and a rock wall and the edge of a wood seem to swim (the owner, 15.11.2026).
  // A pixel covers a small parallelogram of ground; its long side grows without limit as the ground is seen edge-on,
  // its short side is the distance to the eye times the angle of a pixel and nothing else. px is the size of the
  // parallelogram as a whole (the root of the sum of the squares of its sides — unlike fwidth(), the same whichever
  // way the window is turned), but no more than twice the short side: a slope keeps its patterns until it is seen
  // at less than 22°, where it is a sliver of the picture anyway.
  vec3 dpx = dFdx(vPos), dpy = dFdy(vPos);
  float pF = dot(dpx, dpx) + dot(dpy, dpy), pA = length(cross(dpx, dpy));
  float px = min(sqrt(pF), 2. * sqrt(max(pF - sqrt(max(pF * pF - 4. * pA * pA, 0.)), 0.)));   // km per pixel
  // (The step is never finer than the height data — 0.23 km a cell, 0.03 km around the showcase places. Inside one
  // cell the slope is that of the cell's own facet, and steep ground turned to rock by whole square cells.)
#if ZONE == 3
  float dw = 0., e = clamp(px * 1.3, .24, 6.);
#else
  vec2 bu = merc(ll);
  float dw = detailWeight(bu), e = clamp(px * 1.3, mix(.24, 17.92 / uDetRect.z, dw), 6.);   // (17.92 / uDetRect.z: .035, .07 or .14 km — a point and a quarter of the fine heights)
  bu = (bu - uBaseRect.xy) * uBaseRect.zw;                           // where the pixel lies in the height texture of the region
#endif
  float lw = log2(max(px, .02) / 6.);                              // (a point of the world map is 4.9 km; px is 1.4 pixels)
  float h0 = heightPix(ll, rg, lw), hE = heightPix(ll + vec2(0., e / (KM * cl)), rg, lw), hN = heightPix(ll + vec2(e / KM, 0.), rg, lw);
  vec2 g = vec2(hE - h0, hN - h0) / (e * 1000.);                    // rise over run toward east and north
  // (Beyond the polygon the heights are means over 5 km. The slope of such a surface is about a third of that of
  // the land itself: the Alps came out as green pillows without a rock on them. So the slope is taken 3 times
  // steeper there — for the light, the rock, the ribs and the forest alike; the height is not touched.)
  if (rg < 1.) g *= 1. + 2. * (1. - rg);
  float slope = length(g), hl = max(h0, 0.);
  vec2 pk = vec2(lon * KM * COSREF, lat * KM);                      // flat km coordinates for patterns
  // ---- the relief the height data cannot hold. The data has a point every 230 m and joins them smoothly: every
  // mountain came out rounded, like wax that has run (the lead on Aneto and the Picos, 14.11.2026). Three things are
  // added to the slope the light and the rock are worked out from; the height itself is not touched, so a road, a
  // river and a house stand where they stood.
  //   1. The forms the data does hold are sharpened: what its slope has beyond the slope of the land smoothed over
  //      700 m is made stronger. The flanks of a ridge grow steeper toward the crest and the crest reads as a line.
  //   2. Ribs and gullies down the fall line (ribs()), the stronger the steeper the ground. The fall line is taken
  //      as the nearest of eight fixed directions — along a direction that turned freely with the slope the pattern
  //      would shear and swirl.
  //   3. A slight unevenness of any ground, 120 m across.
  // Around the showcase places the fine heights hold much of this themselves, so less is added there (own).
  // crest: how far the place stands above the land smoothed over 700 m, 1 = a sharp crest, −1 = the floor of a gully;
  // rib: the height of the added ribs, −1 .. 1. After the block the two are one number, crest (a quarter of the crest
  // and .15 of the rib): the less is held from here to the rock, the faster the whole shader runs.
  // From afar it is the other way round (far: the heights between about 100 and 700 km). A pixel there is as large
  // as a cell of the data, every small valley is a wrinkle of two pixels, and a range read as a flat busy pattern.
  // So the small forms are calmed (the slope leans toward that of the smoothed land) and the light is given more
  // contrast instead (below): the large forms of a range carry the relief, as on a hand-shaded map.
  // (n3: the shared noise of 1 km, counted here because the ribs wander with it — a noise of their own was one more
  // noise for every pixel)
  float n3 = px < .7 && h0 > -25. ? mix(.5, vnoise(pk / 1.1), smoothstep(.7, .25, px)) : .5;
  float mk = smoothstep(.45, .05, px), far = smoothstep(.10, .30, px) * (1. - smoothstep(.7, 1.3, px)), crest = 0., rib = 0., depth = 0.;
  vec2 gm = vec2(0.);
  if (px < 1.3 && h0 > 0.) {
    // (The smoothed land is read straight from the height texture of the region, a step east and a step north of
    // the pixel taken in the texture itself. Asked through heightLod(), every read brought the projection and the
    // test of the borders of the map with it, and four such reads cost a tenth of the frame: 155 → 173 ms.)
    float own = 1. - dw * (.2 * log2(uDetRect.z) - 1.2), ms = smoothstep(.10, .55, slope) * mk;   // (.6, .4 or .2 less: the finer the heights, the less is added)
#if ZONE != 3
    float lb = 1.6 + max(log2(px / .234), 0.), eb = .7 * exp2(lb - 1.6);                 // (the land smoothed over 700 m, or over three pixels)
    float bC = textureLod(uBase, bu, lb).r, bE = textureLod(uBase, bu + vec2(eb / (KM * cl * 360.) * uBaseRect.z, 0.), lb).r, bN = textureLod(uBase, bu - vec2(0., eb / (KM * cl * 360.) * uBaseRect.w), lb).r;
    // (beyond the polygon these three are read off the edge of its texture and mean nothing: rg takes them out)
    crest = clamp((hl - max(bC, 0.)) * uExag / 180., -1., 1.) * mk * rg;
    g += (g - vec2(bE - bC, bN - bC) / (eb * 1000.)) * ((.8 * uCrisp * own * smoothstep(.30, .10, px) - .4 * far) * rg);
    // From afar a range has depth as well: the floors of its valleys, far under the land around them (the land
    // smoothed over 15 km), take less sun, its high ground more — as haze and the open sky make them.
    // (It is worked out here, among the other reads of the relief, and goes into the light of the sun. As one more
    // line on the finished light, after the aspects, it pushed the whole ground shader over the edge of speed:
    // 153 → 242 ms a frame.)
    if (far > 0.) depth = clamp((hl - max(textureLod(uBase, bu, 6.).r, 0.)) / 900., -1., 1.) * .25 * far * rg;
#endif
    if (mk > 0.) gm = vnoiseD(pk / .12 + 3.).yz * (mk * (.012 + .05 * ms));
    if (ms > 0. && px < .22) {
      // (One family of ribs for a pixel: along the nearest of the eight directions, and the line where one family
      // gives way to the next wanders with a noise. Two families joined smoothly were drawn at first; with the code
      // of the other parts that came in since, they cost a tenth of the frame — 155 → 173 ms, 14.11.2026.)
      float w = (n3 - .5) * .5, a0 = floor(atan(g.y, g.x) / .7853982 + .5 + w) * .7853982;
      // (The ribs are for the heights of the polygon. On the smooth swells of the world map the fall line runs one
      // way for kilometres, and its ribs were a comb of parallel streaks across a whole snowfield — Mont Blanc from
      // 20 km, the lead on v0.6.114.)
      vec3 r = ribs(pk, vec2(cos(a0), sin(a0)), smoothstep(.07, .025, px), w) * (ms * own * uCrisp * smoothstep(.22, .07, px) * rg);
      gm += r.xy; rib = r.z;
    }
  }
  // Beyond the polygon a mountain range is a smooth swell: the world map has a point every 5 km. So ridges and
  // valleys are folded into its slopes by rule — a noise folded at its middle, as in ribs(), of two sizes: 7–9 km
  // and 2.6 km from ridge to ridge, some 300 and 100 m high, in no one direction. Hills have them faintly,
  // mountains in full. They are not the real ridges of the place (those come when the region gets its own
  // heights); they make a range read as a range from 200 km and from 2000: rock on the steep flanks, forest in the
  // valleys, light and shade. Like all of this relief they change the slope and never the height.
  // (Ribs down the fall line, five times larger than the ribs of the polygon, were tried first: every summit
  // stood in a ring of straight rays, like a hedgehog.)
  if (rg < 1. && px < 1.6 && h0 > 0.) {
    // (They are for the look from a height. From near — under 100 km, and gone by 20 — they were long smears of
    // light and shade that no ground explains: there the swell stays a plain swell.)
    float sw = smoothstep(.03, .25, slope) * (1. - rg) * smoothstep(1.6, .5, px) * smoothstep(.02, .10, px);
    if (sw > 0.) {
      // (Every noise is read on a grid turned by its own angle, and the larger size is two noises laid together: a
      // noise read along the axes of the map shows its square cells, and the folds stood in rows of square bumps,
      // like stamps — the lead on the border in Algeria, 15.11.2026.)
      mat2 RA = mat2(.83, .56, -.56, .83), RB = mat2(.37, -.93, .93, .37), RC = mat2(.62, .78, -.78, .62);
      vec3 fa = vnoiseD(RA * pk / 3.4 + 13.), fb = vnoiseD(RB * pk / 4.3 + 71.), fd = vnoiseD(RC * pk / 1.3 + 31.);
      float ta = 2. * fa.x - 1., tb = 2. * fb.x - 1., td = 2. * fd.x - 1., ra = sqrt(ta * ta + .04), rb = sqrt(tb * tb + .04), rd = sqrt(td * td + .04), fine = smoothstep(.7, .25, px);
      gm += ((fa.yz * RA) * (-.175 * ta / ra) + (fb.yz * RB) * (-.14 * tb / rb) + (fd.yz * RC) * (-.31 * td / rd * fine)) * sw;
      rib += ((1. - ra - rb) * .7 + (1. - 2. * rd) * .3 * fine) * sw;
    }
  }
  float slopeD = length(g + gm);                                    // the slope with all of that: what is rock, where snow holds
  crest = crest * .25 + rib * .15;
  vec3 n = normalize(vec3(-(g + gm) * uExag * uShade, 1.));         // east, north, up
  vec3 up = normalize(vPos + vec3(0., RKM, 0.));
  float dl = radians(lon - LON0);
  vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
  vec3 Vw = normalize(cameraPosition - vPos), V = vec3(dot(Vw, east), dot(Vw, north), dot(Vw, up));
  vec2 pdx = dFdx(pk), pdy = dFdy(pk);

  // sun: shadows cast by the relief, and how open the sky is above the point
  float lod0 = log2(max(px, .234) / .234);
  // (The Sun is one for the whole frame and the whole Earth, in the polygon and beyond it: uSun, as east, north,
  // up. From a height the sky draws the frame by day and then brings every place to its own light in the finishing
  // pass, by one measure — post.js, sky/globe.js. The ground and the water never count the Sun of a place
  // themselves. In v0.6.114 the land beyond the polygon did: its sea hardly darkened by night, slopes of the night
  // side caught sunlight, and by evening and by night the polygon stood out as a dark rectangle.)
  vec2 sd = normalize(uSun.xy + 1e-4); float tanEl = uSun.z / max(1e-3, length(uSun.xy));
  // Shadows cast by the relief are for the near and middle heights: there a shadow lies in its valley and shows
  // the shape of the mountain. From afar the same shadows are dark blots inside a range that no shape explains (the
  // owner, 15.11.2026: «какие-то тени внутри»; large shadows must go as the camera rises). They fade from 0.3 to
  // 1.1 km a pixel — from about 350 to 1300 km of height; the light of the slopes and the darker valley floors
  // (far, depth) carry the relief there.
  // (The fade is a factor inside the loop. The loop under a condition, skipped where no shadow shows, or the fade
  // laid on after it, cost 30 ms of the 170 of a frame: the same picture, 204 and 197 ms against 169.)
  float sh = 1., d = max(e * 2., .4), shK = 1. - smoothstep(.30, 1.10, px);
  for (int i = 0; i < 5; i++) {
    vec2 q = ll + vec2(sd.y * d / KM, sd.x * d / (KM * cl));
    float occ = (max(heightLod(q, lod0 + float(i) * .8), 0.) - hl) * uExag - d * 1000. * tanEl;
    sh = min(sh, 1. - clamp(occ / (d * 90. + 4.), 0., 1.) * shK);
    d *= 2.2;
  }
  float rad = .234 * exp2(lod0 + 3.5);
  float conc = (max(heightLod(ll, lod0 + 3.5), 0.) - hl) * uExag / (rad * 260.);
  float ao = 1. - clamp(conc, 0., 1.) * .72, ridge = clamp(-conc, 0., 1.);
  float nl = max(dot(n, uSun), 0.), day = albumDay();
  nl = max(uSun.z + (nl - uSun.z) * (1. + .6 * far), 0.) * (1. + depth);   // (from afar the light of a slope differs more from that of level ground)
  vec3 sunCol = albumSunCol(), skyCol = albumSkyCol();

  Px p;
  p.ll = ll; p.pk = pk; p.pdx = pdx; p.pdy = pdy; p.px = px; p.h = h0; p.hl = hl; p.slope = slope; p.n = n;
  p.wet = .5; p.n1 = .5; p.n2 = .5; p.n3 = .5; p.V = V; p.sd = sd; p.day = day; p.sh = sh; p.ao = ao; p.sunCol = sunCol; p.skyCol = skyCol;
#if ZONE == 3
  p.cA = vec4(1., 0., 1., 0.); p.cB = vec4(0.); p.cC = vec4(0.);     // (no chunks: the natural state, filled in below)
#else
  vec2 cuv = chunkUV(pk);
  p.cA = texture(tChunkA, cuv); p.cB = texture(tChunkB, cuv); p.cC = texture(tChunkC, cuv);
#endif

  // ---- land
  vec3 land = vec3(0.);
  float cover = 0.;
  if (h0 > -25.) {
    // noises fade to their mean once their features are smaller than a pixel, so nothing shimmers from afar
    // (the largest, 38 km, fades from 4 km a pixel: the whole ball of the Earth is drawn at 10 and more)
    float n1 = px < 12. ? mix(.5, fbm(pk / 38.), smoothstep(12., 4., px)) : .5, n2 = px < 5. ? mix(.5, fbm(pk / 7.3 + 5.), smoothstep(5., 1.5, px)) : .5;
    // the climate of the place; a slope that faces north and the floor of a valley are wetter than the ridge above
    // Beyond the polygon: the climate of the whole Earth, by the same rule (worldClimate).
    vec4 clim = albumClimate(ll); float treeW = 0.;
    if (rg < 1.) {
      vec4 cw = worldClimate(ll); float ww = worldWarm(cw);
      cw.b = clamp((ww - ${f1(WARM[0])}) / ${f1(WARM[1] - WARM[0])}, 0., 1.);       // (onto the scale of the polygon)
      // (the grass of a savanna is green for the three months of its rains and straw for the rest of the year: a
      // summer counts as green only as far as the year is wet)
      cw.a = min(cw.a, cw.g * 1.6);
      // (The tree line of the polygon rises slowly above 2200 m — the rule of the hot dry sierras of Spain. On the
      // high lands of the world that rule left Tibet, the Altiplano and the Rockies bare grey rock from 3800 m. So
      // the slow rise is kept only where the summer is dry — the Maghreb, Iran: there the line of the world is the
      // line of the polygon, and no belt of forest jumps a kilometre of height at the border. Where the summer is
      // green the line goes by warmth alone, as in the Alps: Alps 2200 m, Colorado 3050, the Andes of Quito 3350,
      // Lhasa 4800. worldTreelineOf() in ground/climate.js is its twin.)
      treeW = (ww - ${f1(TREE_WARM)}) / ${LAPSE};
      if (treeW > ${f1(TREE_SOFT)}) treeW = ${f1(TREE_SOFT)} + (treeW - ${f1(TREE_SOFT)}) * mix(${TREE_SOFT_K}, 1., smoothstep(.35, .7, cw.a));
      treeW -= (1. - cw.a) * ${f1(TREE_DRY)};
      // (the country a place stands in: the world map smoothed over some 20 km — two of its levels up. A place below
      // its country is drier and one above it wetter, in the polygon and beyond it alike. Taken as the height of the
      // place itself, every lowland beyond the polygon was a little wetter than the same lowland inside: greener,
      // with open woodland all over it, right from the border.)
      cw.r = max(worldLod(ll, ${(WORLD_LOD0 + 2).toFixed(2)}), 0.) / 4096.; clim = mix(cw, clim, rg);
    }
    gRise = clim.r * 4096.; gTreeline = albumTreelineOf(clim); gSummer = clim.a;
    if (rg < 1.) gTreeline = mix(treeW, gTreeline, rg);
    float hollow = clamp(conc, 0., 1.), north = -g.y / (slope + .12);
    float wet = albumWetOf(clim, hl, n1) + north * .05 + hollow * .07 - ridge * .05;
    // (in a wet land grass and scrub hold on a slope that would be bare rock in a dry one)
    float humid = smoothstep(.45, .8, wet), treeline = albumTreeline(n1), steep = smoothstep(.55 + .15 * humid, 1.0 + .12 * humid, slopeD);
    p.n1 = n1; p.n2 = n2; p.n3 = n3; p.wet = wet;
    // Beyond the polygon there are no chunks. The land there is in its natural state: all of its forest standing,
    // conifers and the age of the wood by the climate (the twin of naturalForest() in aspects/forest.js), no swamp,
    // no fields, no houses, no ice. The state of the chunks gives way to it over the last 15 km inside the border
    // (rs): past the border the chunks are sea.
    float rs = STATE(ll);
    if (rs < 1.) {
      float mont = smoothstep(gTreeline - 1250., gTreeline - 400., hl);
      p.cA = mix(vec4(1., clamp(.06 + .82 * mont + .5 * smoothstep(.56, .36, wet) * (1. - mont), 0., 1.), clamp(.92 - .3 * smoothstep(.5, .25, wet) - .35 * smoothstep(gTreeline - 550., gTreeline + 50., hl), 0., 1.), 0.), p.cA, rs);
      p.cB *= rs; p.cC *= rs;
    }
    Land L; L.gloss = 0.;
    L.cover = forestCover(p);

    // bare ground: soil and low growth by the climate (aspects/ground.js), rock on steep slopes and summits, sand at the shore
    float rockW = clamp(steep * (.75 + .5 * n3) + smoothstep(treeline + 250., treeline + 700., hl) * .8 + (ridge * .15 + max(crest, 0.) * 1.8) * smoothstep(treeline - 900., treeline - 100., hl), 0., 1.);
    rockW *= 1. - .18 * humid * (1. - smoothstep(treeline - 300., treeline + 100., hl));   // (in wet country grass and bushes hold on the ledges of a wall below the tree line)
    float sandW = (1. - smoothstep(1., 5., hl)) * (1. - smoothstep(.015, .06, slope)) * .7;   // low flats by the sea; the beach itself is the water work's (aspShore)
    vec3 ground = groundBare(vec3(n1, n2, n3), wet, clim.a, px, hl, slope, conc, pk, 1. - rg);
    if (rockW > .004) {
      float rk = px < 1.2 ? mix(.5, vnoise(pk / 2.3 + 3.), smoothstep(1.2, .4, px)) : .5, rk2 = px < 4. ? mix(.5, vnoise(pk / 9. + 17.), smoothstep(4., 1.5, px)) : .5;
      vec3 rockCol = mix(vec3(.47, .45, .43), vec3(.66, .64, .61), n2);                                              // grey limestone and granite
      rockCol = mix(rockCol, vec3(.62, .52, .38), smoothstep(.55, .8, rk2) * (.4 - .28 * humid));                   // ochre limestone (in the wet mountains the limestone is grey)
      rockCol = mix(rockCol, vec3(.52, .34, .27), smoothstep(.62, .9, rk) * smoothstep(.3, .6, rk2) * .5);           // red sandstone
      rockCol = mix(rockCol, vec3(.29, .30, .33), smoothstep(.35, .1, rk2) * .45);                                  // dark slate
      // Solid rock stands in walls and on crests, and lies in beds. Below the walls and down the gullies lies what
      // fell from them — scree: paler, even, at the slope it comes to rest at. (The streaks down a wall are the ribs
      // and gullies of the relief above, lit by the sun; they used to be painted on, all alike.)
      // (The two differ a little, not a lot. Scree much paler than the rock, with moss in it and the grass of the
      // ledges showing through, was a pale yellow face with a brown line down every rib: the owner took the lines
      // for veins of something, 15.11.2026. A steep face is grey rock; its relief is shown by the light.)
      float solid = smoothstep(.55, 1.05, slopeD + crest);
      rockCol *= mix(1.10, .88 + .22 * (.5 + .5 * sin(hl / 38. + rk * 5.)) * smoothstep(.3, .06, px), solid) * (1. - crest * .35);
      rockCol = mix(rockCol, vec3(.36, .41, .29), smoothstep(.5, .75, n3) * .2 * smoothstep(.3, .6, wet));           // lichen and moss
      rockCol = mix(rockCol, vec3(.60, .51, .38) * (.9 + .2 * n2), (1. - smoothstep(.14, .40, wet)) * .65);           // the sun-bleached rock of dry country
      ground = mix(ground, rockCol, rockW);
    }
    if (sandW > .004) ground = mix(ground, mix(vec3(.80, .72, .53), vec3(.27, .37, .20), smoothstep(.45, .62, wet)), sandW);
    // The grain of the ground, one read for the pixel and used at once: the tile of the ground that is mostly here —
    // sand, stone (rock and desert), dry steppe or green land. The line between two tiles wanders with a noise and is
    // never seen: every tile is a pattern around 1.
    // The square of the grain is 10 km and comes again every 10 km. Laid plainly, its own shapes stood in rows from
    // 20–50 km up: the dry lands looked papered. So the land is a patchwork: in patches a few kilometres across the
    // square lies shifted by its own step, and in every other patch turned over its diagonal. The borders of the
    // patches wander with the noises of the ground, like the border between two tiles, and are not seen.
    // (The grain is rills, gullies and scrub: it is at full strength on slopes and weaker on level ground — a plain
    // and the floor of a basin are smoother than the hills around them. On a wall it nearly goes: the square lies
    // flat on the map, so down a wall every spot of it is drawn out into a streak several times its length.)
    float kind = wet + (n3 - .5) * .12, ga = floor(n2 * 7.), gb = floor(fract(n1 * 5. + n2 * 1.5) * 3.);
    vec2 gp = pk + vec2(ga * 3.71 + gb * 1.37, ga * 1.93 + gb * 4.19), gdx = pdx, gdy = pdy;
    if (fract((ga + gb) * .5) > .25) { gp = gp.yx; gdx = gdx.yx; gdy = gdy.yx; }
    ground *= mix(vec3(1.), texDetail(sandW > .35 ? tSand : (rockW > .45 || kind < .10) ? tRock : kind < .46 ? tDry : tGrass, gp, px, gdx, gdy), uGrainK * (.6 + .4 * smoothstep(.015, .10, slope)) * (1. - .7 * smoothstep(.5, .9, slope)));
#if ZONE != 3
    ground = aspShore(p, ground, L.cover);                           // beaches and rocks at the waterline (the water work)
#endif
    L.col = ground;

    // the aspects paint over the bare ground in this order: wet ground, what people did, the forest
#if ZONE != 3
    aspSwamp(p, L);
    aspSettle(p, L);
#endif
    aspForest(p, L);
    land = L.col; cover = L.cover;

    // snow: above the snow line, and wherever the chunk holds snow (thin snow lies in patches, hollows first)
    // (the edge of the snow is roughened by a finer, turned noise: the noise of 1 km alone shows its square lattice there)
    float sr = 0.; if (px < .5) sr = albumRough(pk) * smoothstep(.5, .2, px);
    // (the line of the polygon goes by latitude, and the owner approved the snow it gives; beyond the polygon the
    // climate draws it — Alps 2350 m, Norway 1400, Tibet 5150, the polar lands white to the sea)
    // (How far inside the polygon the pixel lies is counted again here, and for the lakes and the sea ice below: a
    // number carried from the top of the shader through the forest and the fields is one number too many — the
    // weak video card then works on fewer pixels at a time, and Spain was half as slow again.)
    float snowline = 2980. - (lat - 37.) * 55., rgS = REGION(ll);
    if (rgS < 1.) snowline = mix(worldSnow(worldWarm(worldClimate(ll)), lat), snowline, rgS);
    // (On the smooth slopes of the world map a hundred metres of height are kilometres of ground: the noises that
    // roughen the edge of the snow showed their own squares there. Beyond the polygon they are a third as strong.)
    snowline += ((n2 - .5) * 200. + (n3 - .5) * 90. + sr * 900.) * (.3 + .7 * rgS) + uSnow;
    // The edge of the snow is crisp and follows the ground. It used to be a band 200 m of height wide: on gentle
    // ground that is half a kilometre of fading white, and the snow lay like cotton wool. Now the band is 80 m, or the
    // height one pixel spans where that is more (so the edge does not shimmer from afar). A slope that faces north
    // keeps its snow lower, and the slope is taken with the small relief the height data cannot hold (the normal of
    // the pixel): the edge runs into every gully instead of along a smooth curve.
    float gyS = clamp(-n.y / (max(n.z, .2) * uExag * uShade), -1.2, 1.2), sb = max(40., fwidth(hl) * 1.5);
    // Snow has volume. It does not hold on a wall, so the ribs of rock stand out of a snowfield (the slope is that of
    // the pixel, with its ribs and gullies). And it is painted a little under white: full white under a full sun left
    // no room for the light — a snowfield was one flat patch whatever its relief. Now its sunny faces are white and
    // the faces turned away are grey-blue (the light below: snow in the shade is lit by the blue of the sky).
    float bare = 1. - smoothstep(.8, 1.3, length(n.xy) / (max(n.z, .05) * uExag * uShade));
    float snowW = smoothstep(snowline - sb, snowline + sb, hl - gyS * 320.) * bare;
    if (p.cB.g > .003) snowW = max(snowW, smoothstep(-.1, .1, p.cB.g * 1.3 - (n2 * .55 + n3 * .45) - sr * 1.2) * bare * (1. - .3 * cover));
    if (snowW > .004) land = mix(land, vec3(.80, .83, .88) * (.97 + .06 * n3), snowW);
    cover *= 1. - snowW;
    land = pow(max(land, vec3(0.)), vec3(2.2));                     // the palette above is written as seen on screen

    // A forest in the shade is not black: the tops of its crowns face the sky whatever the slope they stand on, and
    // a canopy is open to more of the sky than the ground of a ravine. Snow in the shade is blue.
    float amb = (.4 + .6 * n.z) * ao; amb = mix(amb, .5 + .5 * amb, cover * .7);
    vec3 light = sunCol * nl * sh * 1.25 + skyCol * amb * mix(vec3(1.), vec3(.86, .97, 1.2), snowW) + albumMoonLit(n);   // (the Moon: light.js, the part «Небо»)
    if (uStyle == 2) {                                              // atlas: tints by height, contour lines
      float cw = fwidth(hl) * 1.2, c200 = 1. - smoothstep(0., cw, abs(fract(hl / 200. + .5) - .5) * 200.);
      land = hypso(hl) * (1. - .22 * c200 * smoothstep(.25, .02, px)) * (.62 + .5 * nl * sh + .1 * ao);
    } else if (uStyle == 3) {                                       // paper: pale land, relief only
      land = mix(vec3(.90, .86, .76), vec3(.80, .83, .70), cover * .35) * (.66 + .42 * nl * sh) * (.8 + .2 * ao);
    } else if (uStyle == 6) {                                       // night slate lit by gold
      land = mix(vec3(.07, .09, .13), vec3(.85, .68, .38), pow(nl * sh, 1.6) * .75 + ridge * .1) * (.7 + .3 * ao);
    } else {
      land *= light;
      if (L.gloss > .003) {                                         // open water on the land mirrors the sky
        vec3 Rv = reflect(-V, vec3(0., 0., 1.)); float fres = .03 + .97 * pow(1. - max(V.z, 0.), 5.);
        vec3 skyRef = mix(vec3(.58, .72, .90), vec3(.22, .40, .70), clamp(Rv.z, 0., 1.)) * (.25 + .75 * day);
        land = mix(land, skyRef, L.gloss * (.25 + .6 * fres)) + sunCol * pow(max(dot(Rv, uSun), 0.), 160.) * .7 * L.gloss * sh;
      }
    }
  }

  // ---- sea
  // Beyond the polygon the lakes of the world map are water too (worldClimate().r, the share of a lake in a cell of
  // 20 km): the Great Lakes, Baikal, Victoria. A lake lies at the height of its land — the water is drawn on the
  // ground as it stands, deeper toward the middle of the lake. (Inside the polygon the lakes are the water work's.)
  // (The world map holds the floor of the deepest lakes, and that of Superior and of Baikal lies under the sea: a
  // lake is water whatever the height of its floor, and of one depth by the rule — shallow at the shore.)
  // The roughness of the sea is a state of the chunks too (p.cB.a, the water work: 0 calm .. 1 storm). Beyond them
  // the sea is not becalmed: it has the roughness of an open sea, more over deep water — much what the freeze
  // model gives the sea chunks by nature (layers/freeze.js). A dead calm beyond the polygon was darker and
  // smoother than the sea inside it, and the polygon stood on the sea as a pale rectangle.
  float lakeA = 0., rgW = REGION(ll), rsW = STATE(ll);
  if (rsW < 1.) p.cB = mix(vec4(0., 0., 0., .30 + .13 * smoothstep(200., 3000., -h0)), p.cB, rsW);
  if (rgW < 1.) {
    float lw2 = clamp(px / 28., .004, .25);
    lakeA = smoothstep(.5 - lw2, .5 + lw2, worldClimate(ll).r) * (1. - rgW);
    // (a lake begins at the depth the sea of the world begins at, 14.5 m: begun at 6 m, every lake had a pale rim
    // with a white line of surf in places, and a lake cut off from the sea — the IJsselmeer — was a pale ring in it)
    if (lakeA > 0.) p.h = -14.5 - 52. * smoothstep(.5, 1., worldClimate(ll).r);
    // (The water work smooths the bottom of the shallows from the heights of the polygon; far from it those are
    // read off the edge of their texture, and the bays of the world came out speckled with surf. Beyond the
    // polygon the sea is never shallower than the depth from which that smoothing begins.)
    else if (p.h < 0.) p.h = min(p.h, -14.5 * (1. - rgW));         // (reached evenly across the band of the border: at a line it was a straight edge on the water)
  }
  vec3 sea = vec3(0.);
  if (h0 < 25. || lakeA > 0.) sea = aspWater(p);
  float landA = lakeA >= 1. ? 0. : clamp(h0 / max(fwidth(h0), 1e-3) + .5, 0., 1.) * (1. - lakeA);
  vec3 col = landA <= 0. ? sea : (landA >= 1. ? land : mix(sea, land, landA));   // (a bad number on one side must not leak into the other)

  // ---- the ice of the polar seas, beyond the polygon (inside it the ice is a state of the chunks, drawn by the water).
  // The sea is frozen where the warmest month at sea level is about 5 °C and colder — the line of the snow by the
  // climate (worldSnow) half a kilometre under the sea: the Arctic Ocean north of Svalbard, the east coast of
  // Greenland, the seas round the Antarctic. (At 8 °C, the line of the snow itself, the ice reached Iceland and the
  // North Cape: the pack of early spring.) The edge of the ice is broken by noise taken in space (round a pole the
  // patterns of pk fan out): two noises, of 70 and 41 km, the second on a lattice turned in space — with one, the
  // edge went in square steps of its cells (the lead on v0.6.114). The ice is lit as level snow is.
  if (rgW < 1. && landA < 1. && abs(lat) > 50.) {
    vec3 q = (vPos + vec3(0., RKM, 0.)) / 70.;
    float ice = (1. - smoothstep(-650., -350., worldSnow(worldWarm(worldClimate(ll)), lat) + (vnoise3(q) + vnoise3(mat3(.36, .48, -.8, -.8, .6, 0., .48, .64, .6) * q * 1.7 + 4.) - 1.) * 420.)) * (1. - landA) * (1. - rgW);
    if (ice > .003) col = mix(col, vec3(.61, .66, .75) * (sunCol * max(uSun.z, 0.) * 1.25 + skyCol * vec3(.86, .97, 1.2)) * (.94 + .12 * vnoise3(q * 2.9 + 9.)), ice);
  }

  // ---- map modes drawn on the ground
#if ZONE != 3
  aspDivision(p, col, landA);
#endif
  if (uData > 0 && landA > .5) {
    float temp = 17.5 - (lat - 38.) * .75 - hl * .0062, v = uData == 1 ? clamp((temp + 4.) / 24., 0., 1.) : clamp(hl / 3000., 0., 1.);
    vec3 ramp = uData == 1 ? mix(mix(vec3(.25, .40, .80), vec3(.95, .93, .70), smoothstep(0., .55, v)), vec3(.82, .25, .15), smoothstep(.55, 1., v)) : hypso(hl);
    ramp *= .92 + .08 * step(.5, fract(v * 12.));
    col = ramp * (.62 + .45 * nl * sh);
  }
#if ZONE != 3
  // the chunks themselves: a number of theirs as colour (chunks.show), their outlines, the one under the cursor
  if (uGrid > 0 || uChunkShow > 0. || uChunkHoverId >= 0.) {
    vec2 cc = chunkCell(pk); float edge = cc.y * ${(FKM / 2).toFixed(4)};          // km from the border of the chunk
    if (uChunkShow > 0.) { vec4 dc = texelFetch(tChunkPal, chunkTexel(cc.x), 0); col = mix(col, pow(dc.rgb, vec3(2.2)) * (.5 + .9 * dot(col, vec3(.33))), dc.a * uChunkShow); }
    if (uGrid > 0) { bool pale = uStyle == 3 || uStyle == 2;                // dark lines on the pale maps, light ones on the natural land
      col = mix(col, pale ? vec3(.10, .08, .06) : vec3(1., .95, .8), (1. - smoothstep(px * .7, px * 1.7, edge)) * (pale ? .6 : .26 + .2 * landA) * smoothstep(1.6, .3, px)); }
    if (cc.x == uChunkHoverId) col = mix(col, vec3(1.6, 1.3, .5), .18 + .6 * (1. - smoothstep(px * 1.2, px * 2.8, edge)));
  }
  if (uQuake.z > 0. && landA > .5) {                               // what each district felt, and the rupture
    vec3 cc = districtAt(pk);
    vec2 ep = vec2(uQuake.y * KM * COSREF, uQuake.x * KM);
    float r = length(cc.xy - ep), felt = floor(uQuake.z * 1.45 - 3.4 * log(r / 14. + 1.) / 2.3026 + cc.z * .5);
    float reach = smoothstep(0., 1., uQuake.w * 260. - r) ;         // the shaking spreads outward
    vec3 fcol = mix(vec3(.96, .86, .36), vec3(.72, .10, .08), clamp((felt - 3.) / 5., 0., 1.));
    col = mix(col, fcol * (.45 + .7 * dot(col, vec3(.33))), step(3., felt) * .55 * reach);
    vec2 dq = pk - ep; float along = dq.x * .82 + dq.y * .57, across = -dq.x * .57 + dq.y * .82 + (vnoise(vec2(along / 3.5, 2.)) - .5) * 4.5;
    float rupt = (1. - smoothstep(px * .8, px * 2.2 + .12, abs(across))) * step(abs(along), uQuake.z * 9.);
    col = mix(col, vec3(.05, .035, .03), rupt * .9);
  }
  if (uFireOn > .5) {                                               // burning and burnt chunks
    vec2 fu = (ll.yx - uFireRect.xy) * uFireRect.zw;
    if (fu.x > 0. && fu.x < 1. && fu.y > 0. && fu.y < 1.) {
      vec4 f = texture(uFire, fu);
      col = mix(col, col * vec3(.34, .27, .22) + vec3(.012, .008, .006), f.g * .9 * landA);   // charred
      float fl = f.r * landA * (.4 + .6 * vnoise(pk / .3 + uTime * 1.7)) * smoothstep(.35, .8, vnoise(pk / 1.1 - uTime * .3));
      col = mix(col, col * vec3(.5, .42, .36), f.r * .6 * landA) + vec3(1.5, .46, .08) * fl * .55;
    }
  }

#endif
  // ---- air between the eye and the ground, then the finish shared by everything
  col = albumAir(col, vPos);
  gl_FragColor = vec4(albumFinish(col), 1.);
}`;
// The numbers written as the edges of smoothstep() go into a table (the uniform uStep) before the shader is compiled:
// with them in its code the shader ran 40 % slower on a weak video card. Why and how: ground/steps.js.
export const GROUND_STEPS = stepTable(FRAG_SRC);
const FRAG = GROUND_STEPS.glsl;

// The grain of the ground as layers of one texture, 1024 px a side. The bytes are read as they are (128 = the mean
// = no change); a picture that is missing is a layer of 128, and its ground stays smooth.
function groundArray(photos) {
  const S = 1024, layer = S * S * 4, data = new Uint8Array(layer * photos.length), cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  photos.forEach((t, i) => {
    if (!t?.image) { data.fill(128, i * layer, (i + 1) * layer); return; }
    ctx.drawImage(t.image, 0, 0, S, S); data.set(ctx.getImageData(0, 0, S, S).data, i * layer);
  });
  const a = new DataArrayTexture(data, S, S, photos.length);
  a.format = RGBAFormat; a.type = UnsignedByteType; a.colorSpace = NoColorSpace; a.wrapS = a.wrapT = RepeatWrapping;
  a.minFilter = LinearMipmapLinearFilter; a.magFilter = LinearFilter; a.generateMipmaps = true; a.anisotropy = 8; a.needsUpdate = true;
  return a;
}

export class Terrain {
  constructor(data, scene, chunks) {
    const n = M + 1, grid = new Float32Array(n * n * 2), pos = new Float32Array(n * n * 3), idx = new Uint32Array(M * M * 6);
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) { grid[k * 2] = i - M / 2; grid[k * 2 + 1] = j - M / 2; }
    for (let j = 0, k = 0; j < M; j++) for (let i = 0; i < M; i++) { const a = j * n + i; idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + n; idx[k++] = a + 1; idx[k++] = a + n + 1; idx[k++] = a + n; }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('grid', new BufferAttribute(grid, 2)); geo.setIndex(new BufferAttribute(idx, 1));
    // the climate of the ground as one picture over the square of the chunks (ground/climate.js)
    const cr = chunks.uniforms.uChunkRect.value, climW = Math.round(1 / cr.z / CLIM_KM), climH = Math.round(1 / cr.w / CLIM_KM);   // (the lattice of the chunks in cells of 5 km: 256 × 256 at stage 2, 384 × 560 at stage 3)
    const clim = new DataTexture(climateTexels(data.base.at, { x0: cr.x, y0: cr.y, w: 1 / cr.z, h: 1 / cr.w }, data.climate, climW, climH), climW, climH, RGBAFormat, UnsignedByteType);
    clim.magFilter = clim.minFilter = LinearFilter; clim.wrapS = clim.wrapT = ClampToEdgeWrapping; clim.needsUpdate = true;
    this.u = {
      uBase: { value: data.base.tex }, uBaseRect: { value: new Vector4(...data.base.rect) },
      uDet: { value: data.base.tex }, uDetRect: { value: new Vector4(0, 0, 1, 1) }, uDetOn: { value: 0 },
      uExag: { value: 1.6 }, uShade: { value: 1.6 }, uSun: { value: new Vector3(-.5, .45, .74).normalize() }, uTime: { value: 0 },
      uSat: { value: 1.12 }, uSnow: { value: 0 }, uForestK: { value: 1 }, uHaze: { value: .09 }, uExposure: { value: 1.05 }, uWarm: { value: 0 }, uSeason: { value: 0 },
      uStyle: { value: 0 }, uGrid: { value: 0 }, uData: { value: 0 },
      uFire: { value: null }, uFireRect: { value: new Vector4(0, 0, 1, 1) }, uFireOn: { value: 0 }, uQuake: { value: new Vector4(0, 0, 0, 0) },
      // layers in the order of the names in the shader (GROUND_TILES in data.js): heath, steppe, stone, dunes
      tGround: { value: groundArray(GROUND_TILES.map(id => data.ground?.[id] || null)) },
      tClimate: { value: clim }, uClimRect: { value: new Vector4(cr.x, cr.y, cr.z, cr.w) },
      // the whole Earth beyond the polygon (ground/world.js); without the files: deep sea and a mild climate
      tWorld: { value: data.world?.tex || flat(RedFormat, new Float32Array([-3200])) }, tWorldClim: { value: data.world?.clim || flat(RGBAFormat, new Uint8Array([128, 128, 128, 255])) },
      uStep: { value: GROUND_STEPS.table },
      ...chunks.uniforms, ...ASPECT_UNIFORMS,
    };
    // A grid is drawn by the three variants of the shader (ZONE), each cut to its own part of the Earth — or by the
    // one variant that draws everything, where the video card cannot cut. this.levels: the first of them for
    // every level (the others share its uniforms); this.zoned: all of them, [level][variant].
    const clip = clipOk(), ZONES = clip ? [1, 2, 3] : [0];
    this.clip = clip;
    // stage 3: where the chunks lie (zonesOf3)
    if (STAGE >= 3) { this.chunkSum = chunkSums(chunks.stateCell); this.chunkRect = { x0: cr.x, y0: cr.y }; }
    const grids = (g, own, order) => ZONES.map(z => {
      const mesh = new Mesh(g, new ShaderMaterial({
        uniforms: { ...this.u, ...own, uZone: { value: z } }, defines: clip ? { ZONE: z, CLIP_ZONES: 1 } : { ZONE: z }, extensions: { clipCullDistance: clip },
        vertexShader: VERT, fragmentShader: FRAG,                   // no polygonOffset: see the step in the vertex shader
      }));
      mesh.frustumCulled = false; mesh.renderOrder = order;
      if (clip) { mesh.onBeforeRender = clipOn; mesh.onAfterRender = clipOff; }
      scene.add(mesh);
      return mesh;
    });
    this.levels = []; this.zoned = [];
    for (let l = 0; l < LEVELS; l++) {
      const set = grids(geo, { uCentre: { value: new Vector2() }, uCell: { value: 1 }, uFine: { value: new Vector3() }, uLod: { value: 0 } }, l - 20);
      this.zoned.push(set); this.levels.push(set[0]);
    }
    // ---- the rest of the Earth. The levels are squares of a flat grid of latitude and longitude around the camera:
    // they cannot cross a pole, and the largest of them reaches 5000 km. Whatever they do not cover is drawn by one
    // grid of the whole ball, a point every degree, fixed to the Earth. It is drawn by the same programs (the same
    // shaders, so nothing more is compiled): a «level» whose centre is 0° N 0° E and whose cell is one degree.
    // Under the levels it steps down out of their way as they do under each other. Its relief is coarse and that
    // does not matter: what it draws is thousands of km from the camera, and the picture is made per pixel.
    const GW = 360, GH = 180, gn = (GW + 1) * (GH + 1), ggrid = new Float32Array(gn * 2), gidx = new Uint32Array(GW * GH * 6);
    for (let j = 0, k = 0; j <= GH; j++) for (let i = 0; i <= GW; i++, k++) { ggrid[k * 2] = (i - GW / 2) * COS_REF; ggrid[k * 2 + 1] = j - GH / 2; }
    for (let j = 0, k = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const a = j * (GW + 1) + i; gidx[k++] = a; gidx[k++] = a + 1; gidx[k++] = a + GW + 1; gidx[k++] = a + 1; gidx[k++] = a + GW + 2; gidx[k++] = a + GW + 1; }
    const ggeo = new BufferGeometry();
    ggeo.setAttribute('position', new BufferAttribute(new Float32Array(gn * 3), 3)); ggeo.setAttribute('grid', new BufferAttribute(ggrid, 2)); ggeo.setIndex(new BufferAttribute(gidx, 1));
    this.globes = grids(ggeo, { uCentre: { value: new Vector2(0, 0) }, uCell: { value: KM_PER_DEG }, uFine: { value: new Vector3() }, uLod: { value: Math.log2(KM_PER_DEG / .234) } }, -11);
    this.globe = this.globes[0];
    // (stage 3: the grid of the whole ball is drawn inside the rectangle by the full variant alone — the fast one
    // would take the plain land there for worked land)
    if (STAGE >= 3 && clip) this.globes[0].visible = false;
    // the thin shell of air at the limb
    const air = new Mesh(new SphereGeometry(R + 75, 128, 64), new ShaderMaterial({
      side: BackSide, transparent: true, depthWrite: false, uniforms: { uSun: this.u.uSun },
      vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }',
      fragmentShader: `varying vec3 vW; uniform vec3 uSun; void main(){ vec3 n = normalize(vW + vec3(0., ${R.toFixed(1)}, 0.)), V = normalize(cameraPosition - vW);
        float a = pow(1. - abs(dot(n, V)), 2.6), day = smoothstep(-.08, .15, uSun.z);
        gl_FragColor = vec4(mix(vec3(.16, .34, .78), vec3(.72, .84, 1.), a) * (.15 + .85 * day), a * .95); }`,
    }));
    air.position.set(0, -R, 0); air.frustumCulled = false; scene.add(air);
    scene.background = new Color(0x02040a);
  }
  // uDetOn: 0 no fine heights; with them, 1 + how many times the finest cell of the grid is halved below 230 m
  // (heightLod() in glsl.js reads the fine heights that much finer)
  setDetail(d) {
    this.detail = !!d;
    if (!d) { this.u.uDetOn.value = 0; return; }
    this.u.uDet.value = d.tex; this.u.uDetRect.value.set(...d.rect); this.u.uDetOn.value = 1 + (this.fine || 0);
  }
  // re-centres the levels on the camera target; cell sizes are powers of two, so the grid never swims.
  // The camera may stand over any place of the Earth (s.lon may run past 180°: it is brought back here). A level
  // that would reach a pole is not drawn — past it the flat grid of latitude and longitude folds over itself — and
  // neither is any level coarser than it; the globe draws what they leave.
  update(s) {
    const c0 = 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, s.h * .0042)))), lat0 = Math.max(-LAT_MAX, Math.min(LAT_MAX, s.lat)), lon0 = wrapLon(s.lon);
    this.fine = Math.max(0, Math.min(3, -Math.log2(c0 / .234)));
    if (this.detail) this.u.uDetOn.value = 1 + this.fine;
    let fine = null, cover = null, shown = true;
    for (let l = 0; l < LEVELS; l++) {
      const c = c0 * 2 ** l, u = this.levels[l].material.uniforms, sLat = 2 * c / KM_PER_DEG, sLon = 2 * c / (KM_PER_DEG * COS_REF);
      const lat = Math.round(lat0 / sLat) * sLat, lon = Math.round(lon0 / sLon) * sLon, half = M / 2 * c;
      u.uCentre.value.set(lat, lon); u.uCell.value = c; u.uLod.value = Math.max(0, Math.log2(c / .234));
      u.uFine.value.set(fine ? fine.lat : 0, fine ? fine.lon : 0, fine ? fine.half - c * 1.5 : 0);
      shown = shown && (!fine || fine.half < 2600) && Math.abs(lat) + half / KM_PER_DEG < POLE_LAT;
      // (a variant of the shader that has nothing to draw in this square is not drawn at all)
      const hLat = half / KM_PER_DEG, hLon = half / (KM_PER_DEG * COS_REF);
      const zs = !this.clip ? [true] : STAGE >= 3 ? zonesOf3(lat, lon, hLat, hLon, allChunks(this.chunkSum, lat, lon, hLat, hLon, this.chunkRect)) : zonesOf(lat, lon, hLat, hLon);
      this.zoned[l].forEach((m, k) => { m.visible = shown && zs[k]; });
      fine = { lat, lon, half };
      if (shown) cover = fine;
    }
    // the globe steps down under the largest level that is drawn, a cell and a half of its own inside its border
    const g = this.globe.material.uniforms.uFine.value, in0 = cover ? cover.half - KM_PER_DEG * 1.5 : 0;
    if (in0 > 0) g.set(cover.lat, cover.lon, in0); else g.set(0, 0, 0);
    this.cover = cover;
  }
}
