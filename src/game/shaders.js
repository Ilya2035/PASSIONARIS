// GLSL for the globe.
//
// Geometry: a polar grid centred on the camera focus F. Ring distance s grows as
// a*sinh(t*b), so detail is concentrated under the camera and the whole planet is
// always drawn (s reaches PI = antipode).
//
// "Unrolling": the globe of radius 1 is re-wrapped onto a bigger sphere of radius
// 1/c that touches it at F. Arc lengths from F are preserved, so near the screen
// centre shapes are undistorted; at c -> 0 it becomes the azimuthal equidistant
// map. c = 1 is the true globe.
import { KOPPEN_GLSL } from '../sim/climate/koppen.js';
import { FERT_GLSL } from '../sim/climate/fertility.js';

export const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
const float PI = 3.141592653589793;
uniform vec3 uF;        // focus (unit vector on the globe)
uniform vec3 uR;        // screen-right tangent at F
uniform vec3 uU;        // screen-up tangent at F
uniform float uCurv;    // curvature 0..1 (1 = globe)
uniform float uExag;    // displacement per metre, in earth radii
uniform sampler2D uHeight;
uniform vec2 uGrid;     // cell grid size (W, H)
uniform sampler2D uDetail;     // streamed detail heights, toroidal 2048x2048 window (8x8 tiles of 256)
uniform vec2 uDetailOrigin;    // window origin in detail tiles
uniform float uDetailOn;
#ifdef V_NODETAIL
#define uDetailOn 0.0          // terrain shader variant for views without the detail window (globe.js)
#endif
uniform sampler2D uDetailMask; // land coverage 0..1 on the same toroidal window (NE 1:10m, anti-aliased)
const vec2 DGRID = vec2(32768.0, 16384.0);
const float DTILE = 256.0;
const float DWIN = 2048.0;
// height in metres at uv; lodG = mip level in global-grid texels, lodD = mip level in detail texels
float heightAt(vec2 uv, float lodG, float lodD) {
  // one return path (the D3D shader compiler warns about early returns here)
  float w = 0.0, hd = 0.0;
  if (uDetailOn >= 0.5) {
    vec2 gt = uv * DGRID;
    vec2 rel = gt / DTILE - uDetailOrigin;
    rel.x = mod(rel.x, DGRID.x / DTILE);
    if (rel.x >= 0.0 && rel.y >= 0.0 && rel.x < 8.0 && rel.y < 8.0) {
      float edge = min(min(rel.x, 8.0 - rel.x), min(rel.y, 8.0 - rel.y));
      hd = textureLod(uDetail, gt / DWIN, lodD).r;
      w = smoothstep(0.3, 1.2, edge) * uDetailOn;
    }
  }
  // deep inside the detail window the global height is not needed
  float hg = w > 0.999 ? hd : textureLod(uHeight, uv, lodG).r;
  return mix(hg, hd, w);
}
// land coverage from the detail window; returns -1 outside it (caller falls back to the coarse cells)
float detailLand(vec2 uv, float lodD, float coarse) {
  if (uDetailOn < 0.5) return -1.0;
  vec2 gt = uv * DGRID;
  vec2 rel = gt / DTILE - uDetailOrigin;
  rel.x = mod(rel.x, DGRID.x / DTILE);
  if (rel.x < 0.0 || rel.y < 0.0 || rel.x >= 8.0 || rel.y >= 8.0) return -1.0;
  float edge = min(min(rel.x, 8.0 - rel.x), min(rel.y, 8.0 - rel.y));
  float cov = textureLod(uDetailMask, gt / DWIN, max(0.0, lodD - 0.5)).r;
  return mix(coarse, cov, smoothstep(0.3, 1.2, edge));
}

vec2 geoToUV(vec3 g) {
  float lon = atan(g.x, g.z);
  float lat = asin(clamp(g.y, -1.0, 1.0));
  return vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
}

vec3 morphPos(float s, vec3 T, float disp, out vec3 up) {
  float c = uCurv;
  float sc = s * c;
  float sn = sin(sc);
  float h2 = sin(0.5 * sc);
  up = uF * cos(sc) + T * sn;
  return uF * (1.0 - 2.0 * h2 * h2 / c) + T * (sn / c) + up * disp;
}
`;

export const TERRAIN_VERT = /* glsl */ `
${COMMON}
uniform float uRingA;
uniform float uRingB;
uniform float uRings;
out vec3 vGeo;
out vec3 vWorld;
out vec3 vUp;

void main() {
  float t = position.x;
  float az = position.y;
  float s = min(uRingA * sinh(t * uRingB), PI); // reaches sMax (horizon) at t = 1
  vec3 T = uR * cos(az) + uU * sin(az);
  vec3 g = uF * cos(s) + T * sin(s);

  float spacing = uRingA * uRingB * cosh(t * uRingB) / uRings;
  float lod = clamp(log2(max(spacing / (PI / uGrid.y), 1.0)), 0.0, 12.0);
  float h = heightAt(geoToUV(g), lod, max(0.0, lod + 2.0));

  vec3 up;
  vec3 p = morphPos(s, T, max(h, 0.0) * uExag, up);
  vGeo = g;
  vWorld = p;
  vUp = up;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uAlbedo;
uniform usampler2D uCells;   // R32UI: 0 ocean, 1 lake, >=2 district
uniform usampler2D uInfo;    // RG16UI per district: province, country
uniform sampler2D uColor;    // RGBA8 per district: map-mode overlay
uniform int uInfoW;
uniform uint uHover;
uniform uint uSelected;
uniform float uOverlay;      // overlay strength (fades when zoomed in)
uniform float uShadeK;       // relief shading strength
uniform float uGlobe;        // 1 = globe look (limb, atmosphere haze)
uniform float uLineProv;     // province border visibility
uniform float uLineDist;     // district border visibility
uniform float uLineCountry;  // country border visibility
uniform float uTime;
uniform vec3 uSunView;       // globe-view light (world space)
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform vec3 uFogColor;
// palette (src/shared/palettes.js)
uniform vec3 uPaper, uPaperDark, uForest, uDesert, uSnow, uShallow, uDeep, uLake, uInk, uSelectC;
uniform float uContour;      // contour interval, metres
uniform float uContourAmt;   // 0..1
uniform int uMode;            // see base colour block
uniform highp usampler2D uBiome; // R8UI biome classes on the MAP grid (1x1 until loaded)
uniform float uHasBiome;
uniform vec3 uBiomeCol[16];
uniform sampler2D uSim;       // 720x360 RGBA per-mode data: R temperature, G precipitation, B hazard level (0..1)
uniform float uHasSim;
uniform sampler2D uWeather;   // 720x360 RGBA: R snow/ice, G clouds/precip, B T anomaly, A drought
uniform float uHasWeather;
uniform float uCloudAmt;      // 0 = no clouds (setting, data map modes), 1 = on
uniform float uCloudVis;      // opacity of cloud bodies vs zoom: 1 from orbit .. ~0.12 up close
uniform float uCloudTone;     // the tone clouds leave up close (overcast dimming): 0 from orbit .. 1 close
uniform float uCloudCrisp;    // edge sharpness: 1 crisp (orbit) .. 0 soft (close)
uniform sampler2D uAero;      // 360x180 RGBA: R ash, G smoke, B dust, A sulphate, each 1 - exp(-k tau) (mipmapped)
uniform sampler2D uAeroGround;// 360x180 RGBA: R ashfall deposit, G volcanic cooling
uniform float uHasAero;       // 1 while any aerosol is visible
uniform float uAeroAmt;       // 0 hidden (setting, data map modes) .. 1
uniform float uAeroVis;       // opacity of aerosol bodies vs zoom: 1 from orbit .. ~0.2 up close
uniform float uAeroLag;       // game days since the field was stepped (the lookup glides with the wind)
uniform float uItcz;          // ITCZ shift, degrees north
uniform float uLineSea;       // sea-zone borders (only up close)
uniform float uNeedInfo;      // 1 only when district/province/country lines are drawn (saves ~10 fetches/pixel)
uniform highp sampler2DArray uClim; // 720x360 x4 RGBA16F era statistics (src/sim/climate/era.js): Köppen, fertility
uniform float uHasClim;
uniform sampler2D uWater;     // 2048x1024 R8 fresh-water proximity: rivers, lakes, coasts (src/sim/climate/waters.js)
uniform float uHasWater;

// Compile-time variants (globe.js compiles one per map mode and layer state in the background and swaps it in when
// ready; until then this generic, uniform-driven version draws the same picture). The uniform names become
// constants, so the compiler drops the blocks that cannot run: fewer registers and no dead texture reads.
#ifdef V_MODE
#define uMode V_MODE
#if V_MODE != 5 && V_MODE != 9
#define uNeedInfo 0.0
#endif
#endif
#ifdef V_WX
#define uHasWeather V_WX
#endif
#ifdef V_CLOUD
#define uCloudAmt V_CLOUD
#define uAeroAmt V_CLOUD
#endif
#ifdef V_AERO
#define uHasAero V_AERO
#endif

in vec3 vGeo;
in vec3 vWorld;
in vec3 vUp;
layout(location = 0) out vec4 fragColor;

int gw() { return int(uGrid.x); }
const uint SEA_BIT = 0x40000000u;   // sea-zone ids (regions module); everything at or above is water
// a grid texel wrapped in longitude, clamped in latitude. Float floor instead of integer % : GPUs emulate integer
// division (~two dozen instructions per %), and a pixel makes up to ~13 cell / biome lookups (exact below 2^24)
ivec2 wrapCell(ivec2 p) {
  p.x -= gw() * int(floor(float(p.x) / uGrid.x));
  p.y = clamp(p.y, 0, int(uGrid.y) - 1);
  return p;
}
uint rawAt(ivec2 p) { return texelFetch(uCells, wrapCell(p), 0).r; }
uint cellAt(ivec2 p) { uint v = rawAt(p); return v >= SEA_BIT ? 0u : v; }
ivec2 infoXY(uint id) { int y = int(float(id) / float(uInfoW)); return ivec2(int(id) - y * uInfoW, y); }   // id < 2^24
uvec2 infoOf(uint id) { return texelFetch(uInfo, infoXY(id), 0).rg; }
vec4 colorOf(uint id) { return texelFetch(uColor, infoXY(id), 0); }

// Value noise (smoothstep-faded lattice of random values) read from a tiling texture of random bytes (uNoise,
// globe.js): the cubic fade is folded into the sample position, so one bilinear fetch blends the four lattice
// values — the same noise as four hashed corners, at a fraction of the cost on weak GPUs (~60 ALU ops per lookup
// before). R and G are two independent noises at the same point (vnoise2: a warp vector in one fetch).
uniform sampler2D uNoise;
const float NOISE_N = 512.0;
vec2 vnoise2(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (mod(i, NOISE_N) + u + 0.5) / NOISE_N, 0.0).rg;
}
float vnoise(vec2 p) { return vnoise2(p).r; }

// distance (px) from the 0.5 iso-line of a bilinear indicator I0..I3 with fractions f
float isoDistPx(float I0, float I1, float I2, float I3, vec2 f, vec2 jx, vec2 jy) {
  float G = mix(mix(I0, I1, f.x), mix(I2, I3, f.x), f.y);
  vec2 gst = vec2(mix(I1 - I0, I3 - I2, f.y), mix(I2 - I0, I3 - I1, f.x));
  vec2 gpx = vec2(dot(gst, jx), dot(gst, jy));
  return abs(G - 0.5) / max(length(gpx), 1e-6);
}
float lineA(float d, float w) { return clamp(0.5 * w + 0.5 - d, 0.0, 1.0); }
vec3 desat(vec3 c) { return mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))), 0.7); }
// hypsometric tints: clear, pleasant, not loud
vec3 hypso(float h) {
  vec3 c = mix(vec3(0.62, 0.71, 0.55), vec3(0.78, 0.79, 0.6), smoothstep(0.0, 350.0, h));
  c = mix(c, vec3(0.84, 0.76, 0.56), smoothstep(350.0, 1200.0, h));
  c = mix(c, vec3(0.72, 0.6, 0.47), smoothstep(1200.0, 2600.0, h));
  c = mix(c, vec3(0.6, 0.55, 0.52), smoothstep(2600.0, 4000.0, h));
  return mix(c, vec3(0.95, 0.94, 0.92), smoothstep(4300.0, 5800.0, h));
}
vec3 tempRamp(float t) { // t: 0..1 maps -40..+40 C
  vec3 c = mix(vec3(0.27, 0.36, 0.62), vec3(0.55, 0.72, 0.84), smoothstep(0.0, 0.42, t));
  c = mix(c, vec3(0.93, 0.9, 0.78), smoothstep(0.42, 0.55, t));
  c = mix(c, vec3(0.9, 0.62, 0.36), smoothstep(0.55, 0.75, t));
  return mix(c, vec3(0.7, 0.25, 0.2), smoothstep(0.75, 1.0, t));
}
vec3 precRamp(float p) { // p: 0..1 maps 0..400 mm/month (sqrt)
  vec3 c = mix(vec3(0.9, 0.84, 0.68), vec3(0.62, 0.78, 0.6), smoothstep(0.05, 0.35, p));
  c = mix(c, vec3(0.3, 0.6, 0.62), smoothstep(0.35, 0.65, p));
  return mix(c, vec3(0.16, 0.32, 0.55), smoothstep(0.65, 1.0, p));
}
vec3 hazardRamp(float h) { // 0..1 = level 0..5
  vec3 c = mix(vec3(0.98, 0.9, 0.62), vec3(0.93, 0.62, 0.3), smoothstep(0.1, 0.5, h));
  return mix(c, vec3(0.62, 0.16, 0.14), smoothstep(0.5, 1.0, h));
}
uint biomeAt(ivec2 p) { return texelFetch(uBiome, wrapCell(p), 0).r; }
vec3 biomeBlend(vec2 uv) {
  vec2 st = uv * uGrid - 0.5;
  ivec2 b = ivec2(floor(st));
  vec2 f = fract(st);
  uint k0 = biomeAt(b), k1 = biomeAt(b + ivec2(1, 0)), k2 = biomeAt(b + ivec2(0, 1)), k3 = biomeAt(b + ivec2(1, 1));
  // water (class 0) never tints land: renormalise the bilinear weights over land classes only
  float w0 = (1.0 - f.x) * (1.0 - f.y) * float(k0 != 0u), w1 = f.x * (1.0 - f.y) * float(k1 != 0u);
  float w2 = (1.0 - f.x) * f.y * float(k2 != 0u), w3 = f.x * f.y * float(k3 != 0u);
  float ws = w0 + w1 + w2 + w3;
  vec3 res = uPaper;   // one return path (D3D compiler warning otherwise)
  if (ws < 1e-4) {
    // land by the fine coast mask but water in the coarse raster: borrow the nearest land class around
    const ivec2 R[12] = ivec2[12](ivec2(-1, 0), ivec2(2, 0), ivec2(0, -1), ivec2(0, 2), ivec2(1, -1), ivec2(-1, 1),
                                  ivec2(2, 1), ivec2(1, 2), ivec2(-1, -1), ivec2(2, 2), ivec2(-1, 2), ivec2(2, -1));
    vec3 found = uPaper;
    bool has = false;
    for (int i = 0; i < 12; i++) {
      if (has) break;
      uint k = biomeAt(b + R[i]);
      if (k != 0u) { found = uBiomeCol[min(k, 15u)]; has = true; }
    }
    res = found;
  } else {
    res = (uBiomeCol[min(k0, 15u)] * w0 + uBiomeCol[min(k1, 15u)] * w1 + uBiomeCol[min(k2, 15u)] * w2 + uBiomeCol[min(k3, 15u)] * w3) / ws;
  }
  return res;
}
// prevailing wind (m/s, u east, v north) at latitude phi (deg): the circulation of src/game/fx/wind.js and
// src/sim/aerosols/core.js (trades, westerlies, polar easterlies; bands shifted by the ITCZ)
vec2 aeroWind(float phi) {
  float p = phi - uItcz * (1.0 - smoothstep(10.0, 45.0, abs(phi)));
  float ap = abs(p), s = sign(p);
  vec2 w;
  if (ap < 30.0) { float k = sin(PI * ap / 30.0); w = vec2(-6.5 * k, -s * 2.2 * k); }
  else if (ap < 60.0) { float k = sin(PI * (ap - 30.0) / 30.0); w = vec2((p < 0.0 ? 13.0 : 9.0) * k, s * 1.2 * k); }
  else { float k = sin(PI * (ap - 60.0) / 30.0); w = vec2(-3.5 * k, -s * 0.8 * k); }
  return w;
}

// ---------------------------------------------------------------- map modes «Климат», «Плодородие», «Погода»,
// «Воздух», «Ветры и течения». Köppen classes and fertility come from src/sim/climate (koppen.js, fertility.js
// generate the GLSL and the palettes); the colours below have JS copies in src/game/ui/legend.js — keep in sync.
${KOPPEN_GLSL}
${FERT_GLSL}
const vec3 WX_WARM = vec3(0.85, 0.42, 0.3), WX_COLD = vec3(0.32, 0.5, 0.78), WX_DROUGHT = vec3(0.6, 0.38, 0.19);
const vec3 WX_CLOUD = vec3(0.94, 0.94, 0.93), WX_SNOW = vec3(0.975, 0.98, 0.995);
vec3 rainWx(float r) {   // 0 drizzle .. 1 downpour (>= 60 mm/day): radar greens, a downpour turns violet
  vec3 c = mix(vec3(0.6, 0.78, 0.6), vec3(0.2, 0.52, 0.38), smoothstep(0.0, 0.55, r));
  return mix(c, vec3(0.38, 0.24, 0.5), smoothstep(0.6, 1.0, r));
}
vec3 snowfallWx(float r) { return mix(vec3(0.84, 0.84, 0.95), vec3(0.58, 0.54, 0.83), smoothstep(0.0, 1.0, r)); }
const vec3 AIR_ASH = vec3(0.22, 0.21, 0.21), AIR_SMOKE = vec3(0.52, 0.38, 0.27), AIR_DUST = vec3(0.85, 0.62, 0.32);
const vec3 AIR_SULF = vec3(0.6, 0.55, 0.76), AIR_FALL = vec3(0.35, 0.33, 0.32), AIR_COOL = vec3(0.42, 0.58, 0.82);
const vec3 WIND_EAST = vec3(0.88, 0.72, 0.5), WIND_WEST = vec3(0.52, 0.66, 0.8);
// a quiet base for the data maps whose content is drawn on top (weather, air, winds)
vec3 quietBase(vec3 c, vec3 paper) { return mix(desat(c), paper, 0.32); }
// diagonal screen-space hatching (drought, ashfall): crisp at any zoom
float hatch(float period) { return step(0.58, fract((gl_FragCoord.x + gl_FragCoord.y) / period)); }

void main() {
  vec3 g = normalize(vGeo);
  float lat = asin(clamp(g.y, -1.0, 1.0));
  vec2 uv = geoToUV(g);

  // seam-safe derivatives (Tarini): pick the continuous one of two parametrisations
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  vec2 duvx = abs(dxA.x) <= abs(dxB.x) ? dxA : dxB;
  vec2 duvy = abs(dyA.x) <= abs(dyB.x) ? dyA : dyB;
  vec2 jx = duvx * uGrid, jy = duvy * uGrid;           // texels per screen pixel
  float texPerPx = max(length(jx), length(jy));

  // ---------------------------------------------------------------- relief
  float lodH = max(0.0, log2(max(texPerPx, 1e-4)));
  float lodD = max(0.0, log2(max(texPerPx * 4.0, 1e-4)));
  vec2 o = uDetailOn > 0.5 ? exp2(lodD) / DGRID : exp2(lodH) / uGrid;
  float hc = heightAt(uv, lodH, lodD);
  float he = heightAt(uv + vec2(o.x, 0.0), lodH, lodD);
  float hn = heightAt(uv - vec2(0.0, o.y), lodH, lodD);
#ifdef SIMPLE
  float hw = hc, hs = hc;                 // "simple shaders": forward differences, 3 height taps instead of 5
  const float SPAN = 1.0;
#else
  // minified (globe distance): forward differences are indistinguishable, save two height taps
  float hw = hc, hs = hc, SPAN = 1.0;
  if (texPerPx < 1.5) {
    hw = heightAt(uv - vec2(o.x, 0.0), lodH, lodD);
    hs = heightAt(uv + vec2(0.0, o.y), lodH, lodD);
    SPAN = 2.0;
  }
#endif
  float coslat = max(cos(lat), 0.02);
  float dxm = SPAN * o.x * 2.0 * PI * 6371000.0 * coslat;
  float dym = SPAN * o.y * PI * 6371000.0;
  vec3 nLocal = normalize(vec3(-(max(he, 0.0) - max(hw, 0.0)) / dxm * uShadeK, -(max(hn, 0.0) - max(hs, 0.0)) / dym * uShadeK, 1.0));
  const vec3 SUN = vec3(-0.55, 0.62, 0.56);            // from the north-west, cartographic style
  float lambert = dot(nLocal, normalize(SUN));
  float shade = clamp(lambert / normalize(SUN).z, 0.0, 1.4);
  shade = mix(1.0, 0.42 + 0.58 * shade, 0.85);   // soft, painterly relief (no black shadows)

  // ---------------------------------------------------------------- cells (bilinear majority)
  vec2 st = uv * uGrid - 0.5;
  vec2 fl = floor(st);
  vec2 f = st - fl;
  ivec2 b = ivec2(fl);
  uint id0 = cellAt(b), id1 = cellAt(b + ivec2(1, 0)), id2 = cellAt(b + ivec2(0, 1)), id3 = cellAt(b + ivec2(1, 1));
  float w0 = (1.0 - f.x) * (1.0 - f.y), w1 = f.x * (1.0 - f.y), w2 = (1.0 - f.x) * f.y, w3 = f.x * f.y;
  float s0 = w0 + (id1 == id0 ? w1 : 0.0) + (id2 == id0 ? w2 : 0.0) + (id3 == id0 ? w3 : 0.0);
  float s1 = w1 + (id0 == id1 ? w0 : 0.0) + (id2 == id1 ? w2 : 0.0) + (id3 == id1 ? w3 : 0.0);
  float s2 = w2 + (id0 == id2 ? w0 : 0.0) + (id1 == id2 ? w1 : 0.0) + (id3 == id2 ? w3 : 0.0);
  float s3 = w3 + (id0 == id3 ? w0 : 0.0) + (id1 == id3 ? w1 : 0.0) + (id2 == id3 ? w2 : 0.0);
  uint win = id0; float best = s0;
  if (s1 > best) { best = s1; win = id1; }
  if (s2 > best) { best = s2; win = id2; }
  if (s3 > best) { best = s3; win = id3; }
  // when texels are smaller than pixels, use the plain nearest cell (stable)
  if (texPerPx > 1.0) win = cellAt(ivec2(floor(uv * uGrid)));

  bool land = win >= 2u;
  // crisp coasts from the 1.2 km coverage mask when the detail window is active
  float cov = detailLand(uv, lodD, land ? 1.0 : 0.0);
  if (cov >= 0.0) land = cov > 0.5;
  // fine-mask land on a coarse water cell: take a land neighbour's district (colour, borders, info)
  if (land && win < 2u) win = id0 >= 2u ? id0 : id1 >= 2u ? id1 : id2 >= 2u ? id2 : id3 >= 2u ? id3 : win;
  uvec2 wi = uvec2(0u), i0 = uvec2(0u), i1 = uvec2(0u), i2 = uvec2(0u), i3 = uvec2(0u);
  if (uNeedInfo > 0.5) { wi = infoOf(win); i0 = infoOf(id0); i1 = infoOf(id1); i2 = infoOf(id2); i3 = infoOf(id3); }

  // ---------------------------------------------------------------- base colour
  // Modes: 0 relief (hypsometric), 1 terrain (biomes), 2 temperature, 3 precipitation, 4 hazards, 5 regions, 9 political.
  // Style: clear pleasant tones, quiet relief, ink lines, procedural contours (crisp at any zoom).
  vec3 alb = textureGrad(uAlbedo, uv, duvx, duvy).rgb;
  float albL = dot(alb, vec3(0.299, 0.587, 0.114));
  vec3 col;
  float hLand = max(hc, 0.0);
  vec4 sim = uHasSim > 0.5 ? texture(uSim, uv) : vec4(0.0);
  vec4 wx = vec4(0.0, 0.0, 0.5, 0.0);
  vec4 wxS = wx;   // softened (4-tap) weather for snow and cloud edges: the 0.5 degree grid never shows as steps
  if (uHasWeather > 0.5) {
    wx = texture(uWeather, uv);
    vec2 tx = vec2(1.0 / 720.0, 1.0 / 360.0);
    wxS = 0.5 * (texture(uWeather, uv + tx * vec2(0.62, 0.45)) + texture(uWeather, uv - tx * vec2(0.62, 0.45)));
  }
  if (land) {
    vec3 c;
    if (uMode == 0) {
      c = hypso(hLand);
    } else if (uHasBiome > 0.5) {
      c = biomeBlend(uv);
      // river valleys, deltas and oases: where the imagery is clearly vegetated, green the climate biome
      float veg = smoothstep(0.42, 0.26, albL) * smoothstep(0.0, 0.06, alb.g - alb.b);
      c = mix(c, vec3(0.5, 0.62, 0.38), veg * 0.65);
    } else {
      float sat = max(alb.r, max(alb.g, alb.b)) - min(alb.r, min(alb.g, alb.b));
      float ice = smoothstep(0.78, 0.92, albL) * (1.0 - smoothstep(0.08, 0.2, sat));
      c = mix(uForest, uPaper, smoothstep(0.1, 0.36, albL));
      c = mix(c, uDesert, smoothstep(0.42, 0.66, albL));
      c = mix(c, uSnow, ice);
    }
    // paleoclimate: wetter than today greens arid land (green Sahara), drier pushes towards desert
    if (uHasSim > 0.5 && uMode == 1) {
      float gr = (sim.a - 0.5) * 2.0;
      float arid = smoothstep(0.55, 0.8, dot(c, vec3(0.333)));
      c = mix(c, vec3(0.62, 0.66, 0.42), clamp(gr, 0.0, 1.0) * arid * 0.85);
      c = mix(c, vec3(0.88, 0.8, 0.6), clamp(-gr, 0.0, 1.0) * 0.6);
    }
    c = mix(c, uPaperDark, smoothstep(1400.0, 4800.0, hLand) * (uMode == 0 ? 0.0 : 0.22));
    c = mix(c, uSnow, smoothstep(4300.0, 5800.0, hLand) * 0.8);
    // seasonal snow from the weather simulation, broken into crisp dense patches
    float snow = wxS.r;
    if (snow > 0.01) {
      float fadeN = 1.0 - smoothstep(0.8, 3.0, texPerPx);
      float nz = 0.5;   // the fine octaves only where they show
      if (fadeN > 0.0) nz = vnoise(uv * uGrid * 1.7) * 0.6 + vnoise(uv * uGrid * 5.3) * 0.4;
      float nm = vnoise(uv * vec2(2200.0, 1100.0)) * 0.65 + vnoise(uv * vec2(5100.0, 2550.0)) * 0.35;  // 0.1-0.2 deg blobs
      float m = smoothstep(0.3, 0.62, snow + (nm - 0.5) * 0.34 + (nz - 0.5) * 0.4 * fadeN);
      // more snow on heights and on the shaded side of slopes
      m = clamp(m + smoothstep(0.15, 0.5, snow) * smoothstep(800.0, 2500.0, hLand) * 0.3, 0.0, 1.0);
      c = mix(c, uSnow, m * 0.92);
    }
    // drought tints the land warmer and paler
    c = mix(c, c * vec3(1.08, 0.98, 0.82) + 0.04, smoothstep(0.35, 0.9, wx.a) * 0.5);
    col = c * mix(1.0, shade, uMode == 0 ? 1.0 : 0.85);
    if (uContourAmt > 0.0) {
      float cv = hLand / uContour;
      float fw = max(fwidth(cv), 1e-4);
      float dl = abs(fract(cv - 0.5) - 0.5) / fw;
      float idx = abs(fract(cv / 5.0 - 0.5) - 0.5) * 5.0 / fw;
      float line = (1.0 - smoothstep(0.35, 1.1, dl)) * 0.55 + (1.0 - smoothstep(0.6, 1.5, idx)) * 0.45;
      line *= smoothstep(0.02, 0.08, 1.0 / fw) * step(1.0, hLand);
      col = mix(col, uInk, line * (uMode == 0 ? 0.3 : 0.16) * uContourAmt);
    }
    // data overlays
    if (uMode == 2) col = mix(desat(col), tempRamp(sim.r + (uHasWeather > 0.5 ? (wx.b * 255.0 - 128.0) / 640.0 : 0.0)), 0.72);
    else if (uMode == 3) col = mix(desat(col), precRamp(sim.g), 0.72);
    else if (uMode == 4) col = mix(desat(col), hazardRamp(sim.b), 0.75 * step(0.02, sim.b));
    else if (uMode == 5 || uMode == 9) {
      vec4 ov = colorOf(win);
      vec3 tint = mix(ov.rgb, vec3(dot(ov.rgb, vec3(0.333))), 0.15);
      col = mix(col, tint * mix(1.0, shade, 0.5), ov.a * uOverlay);
    }
    else if ((uMode == 6 || uMode == 7) && uHasClim > 0.5) {
      // the era's statistics of the 0.5 degree cell (bilinear), moved to the local height by the lapse rate:
      // class borders stay crisp at any zoom and follow the relief (snow-line tundra on the peaks)
      if (uMode == 6) {
        // four rotated-grid samples per pixel (the height follows its local gradient): anti-aliased class borders
        // and a fine ink seam where the samples disagree (faded out when minified, where it would be noise)
        vec2 gH = vec2((he - hw) / (SPAN * o.x), (hs - hn) / (SPAN * o.y));   // dh / duv
        const vec2 RG[4] = vec2[4](vec2(0.125, 0.375), vec2(-0.375, 0.125), vec2(-0.125, -0.375), vec2(0.375, -0.125));
        vec3 kcol = vec3(0.0);
        int k0 = 0;
        float seam = 0.0;
        for (int i = 0; i < 4; i++) {
          vec2 d = duvx * RG[i].x + duvy * RG[i].y;
          vec3 us = vec3(uv + d, 0.0);
          vec4 a = textureLod(uClim, us, 0.0), c = textureLod(uClim, us + vec3(0.0, 0.0, 2.0), 0.0);
          int k = koppenClass(a, textureLod(uClim, us + vec3(0.0, 0.0, 1.0), 0.0), c, climLapse(hc + dot(gH, d), c.z, a.y, degrees(lat)));
          kcol += KCOL[k];
          if (i == 0) k0 = k; else if (k != k0) seam = 1.0;
        }
        col = mix(desat(col), kcol * 0.25 * mix(1.0, shade, 0.6), 0.86);
        col = mix(col, col * 0.7, seam * 0.4 * (1.0 - smoothstep(0.6, 2.5, texPerPx)));
      } else {
        vec4 kA = textureLod(uClim, vec3(uv, 0.0), 0.0), kC = textureLod(uClim, vec3(uv, 2.0), 0.0);
        float dTl = climLapse(hc, kC.z, kA.y, degrees(lat));
        float slope = length(vec2((max(he, 0.0) - max(hw, 0.0)) / dxm, (max(hn, 0.0) - max(hs, 0.0)) / dym));
        float irr = uHasWater > 0.5 ? textureLod(uWater, uv, 0.0).r : 0.0;
        float fe = fertilityAt(kC, textureLod(uClim, vec3(uv, 3.0), 0.0), dTl, slope, hLand, irr);
        col = mix(desat(col), fertRamp(fe) * mix(1.0, shade, 0.55), 0.86);
      }
    }
    else if (uMode == 8 || uMode == 10 || uMode == 11) col = quietBase(col, uPaper);
  } else {
    float depth = max(-hc, 0.0);
    vec3 wc = mix(uShallow, uDeep, pow(smoothstep(0.0, 5000.0, depth), 0.55));
    if (win == 1u) wc = uLake;
#ifndef SIMPLE
    float bv = depth / 1000.0;
    float bw = max(fwidth(bv), 1e-4);
    float iso = (1.0 - smoothstep(0.3, 1.1, abs(fract(bv - 0.5) - 0.5) / bw)) * step(500.0, depth);
    float sv = depth / 200.0;
    float sw = max(fwidth(sv), 1e-4);
    float shelf = (1.0 - smoothstep(0.3, 1.2, abs(sv - 1.0) / sw));
    float fadeIso = smoothstep(0.01, 0.05, 1.0 / bw);
    wc = mix(wc, uInk, (iso * 0.08 + shelf * 0.14) * fadeIso * (win == 1u ? 0.0 : 1.0));
    float rip = 1.0 - smoothstep(0.6, 3.0, texPerPx);   // ripples only where they show
    if (rip > 0.0) {
      vec2 q = uv * uGrid * 0.35;
      float n = vnoise(q + vec2(uTime * 0.05, uTime * 0.035)) * 0.6 + vnoise(q * 2.7 - vec2(uTime * 0.08, 0.0)) * 0.4;
      wc *= 1.0 + (n - 0.5) * 0.08 * rip;
    }
#endif
    // sea ice: from the simulation when running, else from the imagery
    float ice = uHasWeather > 0.5 ? smoothstep(0.15, 0.55, wxS.r + (vnoise(uv * vec2(2200.0, 1100.0)) - 0.5) * 0.25) : smoothstep(0.55, 0.8, dot(alb, vec3(0.333)));
    col = mix(wc, uSnow * mix(1.0, shade, 0.5), ice * 0.9);
    if (uMode == 2) col = mix(desat(col), tempRamp(sim.r), 0.45);
    else if (uMode == 3) col = mix(desat(col), precRamp(sim.g), 0.3);
    else if (uMode == 4) col = mix(col, hazardRamp(sim.b), 0.6 * smoothstep(0.03, 0.25, sim.b));
    else if (uMode >= 6 && uMode != 9) {
      // a pale, quiet sea under the new data maps: the land (or the weather drawn on top) carries the map
      vec3 seaQ = mix(mix(uShallow, uDeep, pow(smoothstep(0.0, 5000.0, depth), 0.55) * 0.55), uPaper, 0.55);
      seaQ = mix(seaQ, desat(seaQ), 0.4);
      col = uMode == 8 ? mix(seaQ, uSnow, ice * 0.9) : seaQ;
    }
  }

  // ---------------------------------------------------------------- «Погода»: what is happening today
  // temperature anomaly against the era's norm of the month (layer 3 .w = the paleo dT of the month: the weather's
  // B channel is measured against today's normals), snow cover and sea ice, drought, clouds, rain and snowfall
  if (uMode == 8 && uHasWeather > 0.5) {
    float mdT = uHasClim > 0.5 ? textureLod(uClim, vec3(uv, 3.0), 0.0).w : 0.0;
    // the anomaly field is coarse (synoptic boxes): read ~2 degrees wide through a gentle warp, so no box edges show
    vec2 aq = uv * vec2(120.0, 60.0);
    vec2 awp = (vnoise2(aq) - 0.5) * vec2(3.0 / 360.0, 3.0 / 180.0);
    float an = (textureLod(uWeather, uv + awp, 2.3).b * 255.0 - 128.0) / 8.0 - mdT;
    float ak = clamp(an / 8.0, -1.0, 1.0);
    col = mix(col, ak > 0.0 ? WX_WARM : WX_COLD, pow(abs(ak), 0.85) * 0.6);
    col = mix(col, WX_SNOW * mix(1.0, shade, land ? 0.5 : 0.0), smoothstep(0.12, 0.55, wxS.r) * 0.85);
    if (land) col = mix(col, WX_DROUGHT, smoothstep(0.3, 0.85, wx.a) * hatch(7.0) * 0.7);
    // cloud share and rain from a mip ~3 cells wide, like the cloud layer of the landscape views
    float gC = textureLod(uWeather, uv, 1.6).g;
    float cloudF = gC < 0.5 ? gC * 2.0 : 1.0, rain = clamp(gC * 2.0 - 1.0, 0.0, 1.0);
    col = mix(col, WX_CLOUD, smoothstep(0.35, 1.0, cloudF) * 0.32);
    // rain or snowfall by today's temperature (the month's norm of the era + the anomaly)
    float tNow = sim.r * 80.0 - 40.0 + an;
    vec3 pc = mix(rainWx(rain), snowfallWx(rain), 1.0 - smoothstep(-1.5, 1.5, tNow));
    col = mix(col, pc, smoothstep(0.02, 0.22, rain) * (0.5 + 0.4 * rain));
  }

  // ---------------------------------------------------------------- «Воздух»: ash, smoke, dust, volcanic haze
  if (uMode == 10 && uHasAero > 0.5) {
    vec2 wnd = aeroWind(degrees(lat)) * (1.4 * uAeroLag * 86.4 / 111.2);   // glide with the wind between steps
    vec2 auv = uv + vec2(-wnd.x / max(cos(lat), 0.15) / 360.0, wnd.y / 180.0);
    vec4 ae = textureLod(uAero, auv, max(0.0, log2(max(texPerPx * 360.0 / uGrid.x, 1e-4))));
    vec4 tau = -log(max(vec4(1.0) - ae, vec4(0.004))) / vec4(0.9, 1.2, 1.0, 3.0);   // aerosols.js ENC_K
    vec4 a = vec4(1.0) - exp(-tau * vec4(2.2, 1.6, 1.3, 5.0));
    vec4 gr = texture(uAeroGround, uv);
    col = mix(col, AIR_COOL, smoothstep(0.05, 2.0, gr.g * 255.0 / 25.0) * 0.42);   // volcanic winter (per latitude)
    if (land) col = mix(col, AIR_FALL, smoothstep(0.03, 0.4, gr.r) * hatch(6.0) * 0.75);
    col = mix(col, AIR_SULF, a.a * 0.75);
    col = mix(col, AIR_DUST, a.b * 0.85);
    col = mix(col, AIR_SMOKE, a.g * 0.85);
    col = mix(col, AIR_ASH, a.r * 0.9);
  }

  // ---------------------------------------------------------------- «Ветры и течения»: the belts under the streaks
  // trades and polar easterlies warm, westerlies cool, the calms (doldrums, horse latitudes) left as paper
  if (uMode == 11) {
    vec2 wv = aeroWind(degrees(lat));
    col = mix(col, wv.x < 0.0 ? WIND_EAST : WIND_WEST, smoothstep(0.8, 8.0, length(wv)) * 0.32);
  }
  // ---------------------------------------------------------------- ashfall, clouds, aerosols
  // Zoom response (globe.js): from orbit the bodies of clouds and aerosol clouds are opaque with crisp edges; zooming
  // in they turn strongly transparent (uCloudVis / uAeroVis) so the land reads, and leave a tone instead
  // (uCloudTone): overcast dims the land and rain greys it, ash makes it dark and colourless, smoke brown, dust
  // ochre, the volcanic haze milky — the province reads as "under ash" without hiding it.

  // ashfall: the ground under a big eruption's cloud stays grey for a few months (landscape modes)
  if (land && uHasAero > 0.5 && uMode <= 1) {
    float dep = texture(uAeroGround, uv).r;
    if (dep > 0.01) {
      float nd = vnoise(uv * vec2(2200.0, 1100.0));
      float m = smoothstep(0.05, 0.75, dep + (nd - 0.5) * 0.3 * smoothstep(0.03, 0.25, dep));
      col = mix(col, desat(col) * 0.5 + vec3(0.035, 0.032, 0.03), m * 0.78);
    }
  }

  // clouds from the weather simulation: broken multi-scale edges (octaves fade before they alias), white tops,
  // grey rain clouds, and a faint shadow on the ground offset toward the south-east for volume
  if (uHasWeather > 0.5 && uCloudAmt > 0.0) {
    vec2 tx = vec2(1.0 / 720.0, 1.0 / 360.0);
#ifdef SIMPLE
    float cn = 0.5, cvar = 0.5, cfine = 0.0;
    vec2 cuv = uv;
#else
    vec2 q = uv * vec2(720.0, 360.0);
    float f1 = 1.0 - smoothstep(3.0, 6.0, texPerPx), f2 = 1.0 - smoothstep(1.2, 2.5, texPerPx), f3 = 1.0 - smoothstep(0.5, 1.0, texPerPx);
    // octaves are only evaluated where they show (faded ones cost nothing)
    float cn = 0.5;
    if (f1 > 0.0) cn += (vnoise(q * 1.3 + vec2(uTime * 0.02, 0.0)) - 0.5) * 0.6 * f1;
    if (f2 > 0.0) cn += (vnoise(q * 3.1 - vec2(uTime * 0.035, uTime * 0.01)) - 0.5) * 0.34 * f2;
    if (f3 > 0.0) cn += (vnoise(q * 7.7 + vec2(0.0, uTime * 0.02)) - 0.5) * 0.18 * f3;
    // domain warp (two scales, up to ~2 degrees): crisp edges must not trace the straight lines of the coarse
    // synoptic grid and its 5-degree boxes (not needed up close, where the bodies are faint and soft)
    vec2 wq = q * 0.09;
    vec2 cw = vnoise2(wq + vec2(3.1, uTime * 0.002));
    float cvar = cw.x;                                     // also the large-scale thickness of the cloud body
    vec2 cuv = uv;
    if (uCloudCrisp > 0.3) {
      cuv += ((cw - 0.5) * 7.0 + (vnoise2(wq * 3.3 + vec2(41.2, 0.0)) - 0.5) * 2.6) * tx * smoothstep(0.3, 0.6, uCloudCrisp);
    }
    float cfine = (cn - 0.5) * 0.4 * f2;                     // fine thickness only where it cannot alias
#endif
    // the simulator marks wet cells one by one (salt-and-pepper at 0.5 degrees): the share of wet cells around is the
    // cloud cover, so the field is read from a mip level ~3 cells wide (mipmapped weather texture)
    float gC = textureLod(uWeather, cuv, 1.6).g;
    float cloudF = gC < 0.5 ? gC * 2.0 : 1.0;
    float rain = clamp(gC * 2.0 - 1.0, 0.0, 1.0);
    float dens = cloudF + (cn - 0.5) * 0.5;
    // crisp edges from orbit, soft ones up close
    float cm = smoothstep(mix(0.5, 0.63, uCloudCrisp), mix(0.95, 0.77, uCloudCrisp), dens);
    vec4 wsh = textureLod(uWeather, cuv + tx * vec2(0.9, 0.7), 1.6);
    float shF = wsh.g < 0.5 ? wsh.g * 2.0 : 1.0;
    float shadowM = smoothstep(0.5, 0.95, shF + (cn - 0.5) * 0.5) * (1.0 - cm);
    col *= 1.0 - 0.12 * shadowM * uCloudAmt * uCloudVis;
    // the tone kept up close: the wider cloud cover (coarse mip) dims the land and makes it cooler and greyer,
    // more so under rain; the local density keeps soft structure in it
    if (uCloudTone > 0.0) {
      float gW = textureLod(uWeather, uv, 3.0).g;
      float cov = smoothstep(0.18, 0.5, gW) * (0.55 + 0.45 * smoothstep(0.35, 0.95, dens));
      float wet = clamp(gW * 2.0 - 1.0, 0.0, 1.0) * (0.6 + 0.4 * cm);
      vec3 ov = col * (1.0 - 0.15 * cov - 0.14 * wet);
      ov = mix(ov, vec3(dot(ov, vec3(0.3, 0.55, 0.15))) * vec3(0.97, 0.985, 1.02), 0.28 * cov + 0.3 * wet);
      col = mix(col, ov, uCloudTone * uCloudAmt);
    }
    vec3 cc = mix(vec3(0.99, 0.985, 0.975), vec3(0.8, 0.81, 0.83), rain * 0.6);
    cc = mix(cc, vec3(1.0), smoothstep(0.9, 1.15, dens) * 0.4 * (1.0 - rain));
    // thin parts let the map through, thick cores and rain clouds are nearly opaque
    float thick = smoothstep(0.62, 1.12, cloudF + (cvar - 0.5) * 0.55 + cfine);
    col = mix(col, cc, cm * (mix(0.46, 0.76, thick) + 0.12 * rain) * uCloudAmt * uCloudVis);
  }

  // aerosols (src/game/world/aerosols.js): volcanic ash, wildfire smoke, dust, sulphate haze. From orbit they are
  // masses of their own colour with crisp edges and some volume (lit north-west rims, darker south-east sides, a
  // shadow on the ground); up close they become transparent and tint the provinces under them.
  if (uHasAero > 0.5 && uAeroAmt > 0.0) {
    // the field is stepped every few game hours: between steps the lookup glides with the prevailing wind
    vec2 wnd = aeroWind(degrees(lat)) * (1.4 * uAeroLag * 86.4 / 111.2);   // degrees moved since the last step
    vec2 auv = uv + vec2(-wnd.x / max(cos(lat), 0.15) / 360.0, wnd.y / 180.0);
#ifndef SIMPLE
    // from orbit, a large-scale warp (~1.5 degrees) gives the masses natural lobes instead of the straight
    // edges that a wind depending on latitude alone would leave
    if (uCloudCrisp > 0.3) {
      vec2 wa = auv * vec2(60.0, 30.0);
      auv += (vnoise2(wa + vec2(7.3, uTime * 0.003)) - 0.5) * vec2(3.2 / 360.0, 3.2 / 180.0) * smoothstep(0.3, 0.6, uCloudCrisp);
    }
#endif
    float ap = texPerPx * 360.0 / uGrid.x;                                    // aerosol cells per pixel
    float lodA = max(0.0, log2(max(ap, 1e-4)));
    vec4 ae = textureLod(uAero, auv, lodA);
    vec4 aw = textureLod(uAero, auv, max(lodA, 2.3));                         // ~5 cells wide: the tone
    if (dot(ae + aw, vec4(1.0)) > 0.004) {
      const vec4 EK = vec4(0.9, 1.2, 1.0, 3.0);
      vec4 tau = -log(max(vec4(1.0) - ae, vec4(0.004))) / EK;
      // billows: one broad octave reads from orbit, finer ones fade in as the view closes (never under ~3 px)
      vec2 q = auv * vec2(360.0, 180.0);
      float tt = uTime * 0.02;
#ifdef SIMPLE
      float n = 0.5 + (vnoise(q * 0.9 + vec2(tt, 0.0)) - 0.5) * 0.7;
#else
      float n = 0.5 + (vnoise(q * 0.9 + vec2(tt, 0.0)) - 0.5) * 0.6;
      float o2 = 1.0 - smoothstep(0.12, 0.3, ap * 2.6), o3 = 1.0 - smoothstep(0.12, 0.3, ap * 7.3);
      if (o2 > 0.0) n += (vnoise(q * 2.6 - vec2(tt * 1.6, tt)) - 0.5) * 0.38 * o2;
      if (o3 > 0.0) n += (vnoise(q * 7.3 + vec2(0.0, tt * 2.0)) - 0.5) * 0.26 * o3;
#endif
      vec4 tn = tau * max(vec4(0.0), 1.0 + (n - 0.5) * vec4(1.3, 1.2, 1.0, 0.5));
      vec4 a = vec4(1.0) - exp(-tn * vec4(2.4, 1.7, 1.1, 0.9));
      // from orbit: a sharp rim where the cloud starts, dense inside
      a = mix(a, smoothstep(vec4(0.2, 0.2, 0.16, 0.1), vec4(0.36, 0.38, 0.45, 0.5), a) * (0.64 + 0.36 * a), uCloudCrisp * vec4(1.0, 1.0, 0.85, 0.3));
      a.a *= 0.45;                                                             // the haze never hides the map
      float A = 1.0 - (1.0 - a.r) * (1.0 - a.g) * (1.0 - a.b) * (1.0 - a.a);
      const vec3 C_ASH = vec3(0.17, 0.16, 0.155), C_SMOKE = vec3(0.47, 0.41, 0.35);
      const vec3 C_DUST = vec3(0.77, 0.59, 0.37), C_SULF = vec3(0.93, 0.92, 0.88);   // dust: warm enough to read over deserts
      float wsum = a.r + a.g + a.b + a.a + 1e-4;
      vec3 body = (a.r * C_ASH + a.g * C_SMOKE + a.b * C_DUST + a.a * C_SULF) / wsum;
#ifndef SIMPLE
      // volume: the field one cell toward the sun (north-west) — lit rims, shaded far sides, a shadow on the ground
      // (only while the bodies are dense enough to show it)
      if (uAeroVis > 0.55) {
      vec4 anw = textureLod(uAero, auv - vec2(1.4 / 360.0, 1.2 / 180.0), max(lodA, 0.5));
      vec4 bn = vec4(1.0) - exp(-(-log(max(vec4(1.0) - anw, vec4(0.004))) / EK) * vec4(2.4, 1.7, 1.1, 0.0));
      float Anw = 1.0 - (1.0 - bn.r) * (1.0 - bn.g) * (1.0 - bn.b);
      float vk = smoothstep(0.55, 0.8, uAeroVis);
      float rim = clamp((A - Anw) * 3.0, -1.0, 1.0) * vk;
      body = mix(body, mix(body, vec3(0.78, 0.76, 0.72), 0.5), max(rim, 0.0) * 0.85);
      body *= 1.0 - 0.3 * max(-rim, 0.0);
      col *= 1.0 - 0.3 * clamp(Anw - A, 0.0, 1.0) * vk * uAeroAmt;
      }
#endif
      // the tone up close (wide field, soft structure from the billows — not a flat fill)
      if (uCloudTone > 0.0) {
        vec4 b = vec4(1.0) - exp(-(-log(max(vec4(1.0) - aw, vec4(0.004))) / EK) * vec4(2.6, 1.9, 1.3, 2.5));
        b = clamp(b * (0.7 + 0.6 * n), 0.0, 1.0);
        vec3 c = col;
        float g = dot(c, vec3(0.3, 0.55, 0.15));
        c = mix(c, vec3(g) * vec3(0.46, 0.45, 0.44), b.r * 0.9);                   // ash: dark, colourless
        c = mix(c, c * vec3(0.78, 0.68, 0.56) + vec3(0.03, 0.02, 0.0), b.g * 0.8);  // smoke: brown dimming
        c = mix(c, mix(c, C_DUST, 0.5) * 0.96, b.b * 0.75);                         // dust: ochre haze
        c = mix(c, mix(c, C_SULF, 0.35), b.a * 0.7);                                // sulphate: milky
        col = mix(col, c, uCloudTone * uAeroAmt);
      }
      col = mix(col, body, A * uAeroVis * uAeroAmt);
    }
  }

  // ---------------------------------------------------------------- borders
  float lineCountry = 0.0, lineProv = 0.0, lineDist = 0.0, coast = 0.0, sel = 0.0, hov = 0.0;
  {
    // analytic iso-lines in the magnified range
    float L0 = id0 >= 2u ? 1.0 : 0.0, L1 = id1 >= 2u ? 1.0 : 0.0, L2 = id2 >= 2u ? 1.0 : 0.0, L3 = id3 >= 2u ? 1.0 : 0.0;
    float dCoast = isoDistPx(L0, L1, L2, L3, f, jx, jy);
    float aMag = 1.0 - smoothstep(0.7, 1.2, texPerPx);
    if (land && uNeedInfo > 0.5) {
      // water samples count as "same" so coasts don't get political borders
      float C0 = (id0 < 2u || i0.y == wi.y) ? 1.0 : 0.0, C1 = (id1 < 2u || i1.y == wi.y) ? 1.0 : 0.0;
      float C2 = (id2 < 2u || i2.y == wi.y) ? 1.0 : 0.0, C3 = (id3 < 2u || i3.y == wi.y) ? 1.0 : 0.0;
      float P0 = (id0 < 2u || i0.x == wi.x) ? 1.0 : 0.0, P1 = (id1 < 2u || i1.x == wi.x) ? 1.0 : 0.0;
      float P2 = (id2 < 2u || i2.x == wi.x) ? 1.0 : 0.0, P3 = (id3 < 2u || i3.x == wi.x) ? 1.0 : 0.0;
      float D0 = (id0 < 2u || id0 == win) ? 1.0 : 0.0, D1 = (id1 < 2u || id1 == win) ? 1.0 : 0.0;
      float D2 = (id2 < 2u || id2 == win) ? 1.0 : 0.0, D3 = (id3 < 2u || id3 == win) ? 1.0 : 0.0;
      float dC = (C0 + C1 + C2 + C3 < 4.0) ? isoDistPx(C0, C1, C2, C3, f, jx, jy) : 1e4;
      float dP = (P0 + P1 + P2 + P3 < 4.0) ? isoDistPx(P0, P1, P2, P3, f, jx, jy) : 1e4;
      float dD = (D0 + D1 + D2 + D3 < 4.0) ? isoDistPx(D0, D1, D2, D3, f, jx, jy) : 1e4;
      lineCountry = lineA(dC, 2.6) * aMag;
      lineProv = lineA(dP, 1.3) * aMag;
      lineDist = lineA(dD, 0.9) * aMag;
      float S0 = id0 == uSelected ? 1.0 : 0.0, S1 = id1 == uSelected ? 1.0 : 0.0, S2 = id2 == uSelected ? 1.0 : 0.0, S3 = id3 == uSelected ? 1.0 : 0.0;
      if (uSelected >= 2u && S0 + S1 + S2 + S3 > 0.0 && S0 + S1 + S2 + S3 < 4.0) sel = lineA(isoDistPx(S0, S1, S2, S3, f, jx, jy), 3.0) * aMag;
      float H0 = id0 == uHover ? 1.0 : 0.0, H1 = id1 == uHover ? 1.0 : 0.0, H2 = id2 == uHover ? 1.0 : 0.0, H3 = id3 == uHover ? 1.0 : 0.0;
      if (uHover >= 2u && H0 + H1 + H2 + H3 > 0.0 && H0 + H1 + H2 + H3 < 4.0) hov = lineA(isoDistPx(H0, H1, H2, H3, f, jx, jy), 1.8) * aMag;
    }
    coast = (L0 + L1 + L2 + L3 > 0.0 && L0 + L1 + L2 + L3 < 4.0) ? lineA(dCoast, 1.4) * aMag : 0.0;
    // sea zones: faint dotted ink where two zones meet (land and lakes count as "same", so coasts stay clean)
    if (!land && uLineSea > 0.0 && aMag > 0.0) {
      uint rw = rawAt(ivec2(floor(uv * uGrid)));
      if (rw >= SEA_BIT) {
        uint r0 = rawAt(b), r1 = rawAt(b + ivec2(1, 0)), r2 = rawAt(b + ivec2(0, 1)), r3 = rawAt(b + ivec2(1, 1));
        float Z0 = (r0 < SEA_BIT || r0 == rw) ? 1.0 : 0.0, Z1 = (r1 < SEA_BIT || r1 == rw) ? 1.0 : 0.0;
        float Z2 = (r2 < SEA_BIT || r2 == rw) ? 1.0 : 0.0, Z3 = (r3 < SEA_BIT || r3 == rw) ? 1.0 : 0.0;
        if (Z0 + Z1 + Z2 + Z3 < 4.0) {
          float dS = isoDistPx(Z0, Z1, Z2, Z3, f, jx, jy);
          float dash = step(0.45, fract(dot(uv * uGrid, vec2(1.7, 1.3))));
          col = mix(col, uInk, lineA(dS, 1.0) * aMag * uLineSea * 0.32 * mix(0.35, 1.0, dash));
        }
      }
    }
    if (cov >= 0.0) coast = lineA(abs(cov - 0.5) / max(fwidth(cov), 1e-5), 1.4);

    // screen-space neighbour test in the minified range (globe view)
    if (aMag < 1.0) {
      vec2 px = duvx * 1.25, py = duvy * 1.25;
      uint c0 = win;
      uint n1 = cellAt(ivec2(floor((uv + px) * uGrid))), n2 = cellAt(ivec2(floor((uv - px) * uGrid)));
      uint n3 = cellAt(ivec2(floor((uv + py) * uGrid))), n4 = cellAt(ivec2(floor((uv - py) * uGrid)));
      bool L = c0 >= 2u;
      float cb = 0.0, pb = 0.0, cs = 0.0;
      if (L && uNeedInfo > 0.5) {
        uvec2 c0i = infoOf(c0);
        uvec2 a1 = infoOf(n1), a2 = infoOf(n2), a3 = infoOf(n3), a4 = infoOf(n4);
        cb = float((n1 >= 2u && a1.y != c0i.y) || (n2 >= 2u && a2.y != c0i.y) || (n3 >= 2u && a3.y != c0i.y) || (n4 >= 2u && a4.y != c0i.y));
        pb = float((n1 >= 2u && a1.x != c0i.x) || (n2 >= 2u && a2.x != c0i.x) || (n3 >= 2u && a3.x != c0i.x) || (n4 >= 2u && a4.x != c0i.x));
      }
      cs = float(((n1 >= 2u) != L) || ((n2 >= 2u) != L) || ((n3 >= 2u) != L) || ((n4 >= 2u) != L));
      float k = 1.0 - aMag;
      lineCountry = max(lineCountry, cb * k * 0.9);
      lineProv = max(lineProv, pb * k * 0.6);
      if (cov < 0.0) coast = max(coast, cs * k * 0.55);
    }
  }
  col = mix(col, uInk, coast * 0.75);
  col = mix(col, mix(col * 0.62, uInk, 0.25), lineDist * uLineDist * 0.6);
  col = mix(col, mix(col, uInk, 0.55), lineProv * uLineProv * 0.75);
  col = mix(col, uInk, lineCountry * 0.9 * uLineCountry);
  if (land && win == uHover) col = col * 1.08 + 0.03;
  if (land && win == uSelected) col = mix(col, uSelectC, 0.2);
  col = mix(col, vec3(1.0, 0.98, 0.93), hov * 0.7);
  col = mix(col, uSelectC, sel);

  // ---------------------------------------------------------------- globe look + haze
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vUp);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float sphereLight = 0.62 + 0.48 * clamp(dot(N, uSunView), -0.2, 1.0);
  col *= mix(1.0, sphereLight, uGlobe);
  float limb = 1.0 - smoothstep(0.0, 0.55, ndv);
  col = mix(col, uFogColor, limb * 0.5 * uGlobe);

  float dist = length(cameraPosition - vWorld);
  float fog = smoothstep(uFogNear, uFogFar, dist) * uFogAmt;
  col = mix(col, uFogColor, fog);

  fragColor = vec4(col, 1.0);
}
`;

export const RIVER_VERT = /* glsl */ `
${COMMON}
uniform float uLift;
uniform float uMaxRank;
out float vA;
void main() {
  float lon = radians(position.x), lat = radians(position.y);
  vec3 g = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  float h = heightAt(geoToUV(g), 0.0, 0.0);
  vec3 up;
  vec3 p = morphPos(s, T, max(h, 0.0) * uExag + uLift, up);
  vA = position.z <= uMaxRank ? 1.0 - 0.06 * position.z : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RIVER_FRAG = /* glsl */ `
precision highp float;
uniform float uOpacity;
uniform vec3 uRiverC;
in float vA;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vA <= 0.0) discard;
  fragColor = vec4(uRiverC, vA * uOpacity);
}
`;

export const ATMO_VERT = /* glsl */ `
out vec3 vN;
out vec3 vP;
void main() {
  vN = normalize(position);
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const ATMO_FRAG = /* glsl */ `
precision highp float;
uniform float uOpacity;
uniform vec3 uHaloC;
in vec3 vN;
in vec3 vP;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 V = normalize(cameraPosition - vP);
  float rim = 1.0 - abs(dot(normalize(vN), V));
  float a = pow(clamp(rim, 0.0, 1.0), 3.0);
  // only the outer halo: fade the part that overlaps the planet disc
  float glow = smoothstep(0.0, 1.0, a) * uOpacity;
  fragColor = vec4(uHaloC * glow, glow);
}
`;
