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
uniform sampler2D uDetailMask; // land coverage 0..1 on the same toroidal window (NE 1:10m, anti-aliased)
const vec2 DGRID = vec2(32768.0, 16384.0);
const float DTILE = 256.0;
const float DWIN = 2048.0;
// height in metres at uv; lodG = mip level in global-grid texels, lodD = mip level in detail texels
float heightAt(vec2 uv, float lodG, float lodD) {
  float hg = textureLod(uHeight, uv, lodG).r;
  if (uDetailOn < 0.5) return hg;
  vec2 gt = uv * DGRID;
  vec2 rel = gt / DTILE - uDetailOrigin;
  rel.x = mod(rel.x, DGRID.x / DTILE);
  if (rel.x < 0.0 || rel.y < 0.0 || rel.x >= 8.0 || rel.y >= 8.0) return hg;
  float edge = min(min(rel.x, 8.0 - rel.x), min(rel.y, 8.0 - rel.y));
  float hd = textureLod(uDetail, gt / DWIN, lodD).r;
  return mix(hg, hd, smoothstep(0.3, 1.2, edge) * uDetailOn);
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
uniform float uCloudAmt;
uniform float uNeedInfo;      // 1 only when district/province/country lines are drawn (saves ~10 fetches/pixel)

in vec3 vGeo;
in vec3 vWorld;
in vec3 vUp;
layout(location = 0) out vec4 fragColor;

int gw() { return int(uGrid.x); }
uint cellAt(ivec2 p) {
  int w = gw();
  p.x = ((p.x % w) + w) % w;
  p.y = clamp(p.y, 0, int(uGrid.y) - 1);
  return texelFetch(uCells, p, 0).r;
}
uvec2 infoOf(uint id) { return texelFetch(uInfo, ivec2(int(id) % uInfoW, int(id) / uInfoW), 0).rg; }
vec4 colorOf(uint id) { return texelFetch(uColor, ivec2(int(id) % uInfoW, int(id) / uInfoW), 0); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

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
uint biomeAt(ivec2 p) {
  int w = gw();
  p.x = ((p.x % w) + w) % w;
  p.y = clamp(p.y, 0, int(uGrid.y) - 1);
  return texelFetch(uBiome, p, 0).r;
}
vec3 biomeBlend(vec2 uv) {
  vec2 st = uv * uGrid - 0.5;
  ivec2 b = ivec2(floor(st));
  vec2 f = fract(st);
  uint k0 = biomeAt(b), k1 = biomeAt(b + ivec2(1, 0)), k2 = biomeAt(b + ivec2(0, 1)), k3 = biomeAt(b + ivec2(1, 1));
  // water (class 0) never tints land: renormalise the bilinear weights over land classes only
  float w0 = (1.0 - f.x) * (1.0 - f.y) * float(k0 != 0u), w1 = f.x * (1.0 - f.y) * float(k1 != 0u);
  float w2 = (1.0 - f.x) * f.y * float(k2 != 0u), w3 = f.x * f.y * float(k3 != 0u);
  float ws = w0 + w1 + w2 + w3;
  if (ws < 1e-4) return uPaper;
  return (uBiomeCol[min(k0, 15u)] * w0 + uBiomeCol[min(k1, 15u)] * w1 + uBiomeCol[min(k2, 15u)] * w2 + uBiomeCol[min(k3, 15u)] * w3) / ws;
}

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
  float hw = heightAt(uv - vec2(o.x, 0.0), lodH, lodD);
  float hn = heightAt(uv - vec2(0.0, o.y), lodH, lodD);
  float hs = heightAt(uv + vec2(0.0, o.y), lodH, lodD);
  float coslat = max(cos(lat), 0.02);
  float dxm = 2.0 * o.x * 2.0 * PI * 6371000.0 * coslat;
  float dym = 2.0 * o.y * PI * 6371000.0;
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
  vec4 wx = uHasWeather > 0.5 ? texture(uWeather, uv) : vec4(0.0, 0.0, 0.5, 0.0);
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
    float snow = wx.r;
    if (snow > 0.01) {
      float nz = vnoise(uv * uGrid * 1.7) * 0.6 + vnoise(uv * uGrid * 5.3) * 0.4;
      float fadeN = 1.0 - smoothstep(0.8, 3.0, texPerPx);
      float m = smoothstep(0.32, 0.6, snow + (nz - 0.5) * 0.45 * fadeN);
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
    if (uMode == 2) col = mix(desat(col), tempRamp(sim.r), 0.72);
    else if (uMode == 3) col = mix(desat(col), precRamp(sim.g), 0.72);
    else if (uMode == 4) col = mix(desat(col), hazardRamp(sim.b), 0.75 * step(0.02, sim.b));
    else if (uMode == 5 || uMode == 9) {
      vec4 ov = colorOf(win);
      vec3 tint = mix(ov.rgb, vec3(dot(ov.rgb, vec3(0.333))), 0.15);
      col = mix(col, tint * mix(1.0, shade, 0.5), ov.a * uOverlay);
    }
  } else {
    float depth = max(-hc, 0.0);
    vec3 wc = mix(uShallow, uDeep, pow(smoothstep(0.0, 5000.0, depth), 0.55));
    if (win == 1u) wc = uLake;
    float bv = depth / 1000.0;
    float bw = max(fwidth(bv), 1e-4);
    float iso = (1.0 - smoothstep(0.3, 1.1, abs(fract(bv - 0.5) - 0.5) / bw)) * step(500.0, depth);
    float sv = depth / 200.0;
    float sw = max(fwidth(sv), 1e-4);
    float shelf = (1.0 - smoothstep(0.3, 1.2, abs(sv - 1.0) / sw));
    float fadeIso = smoothstep(0.01, 0.05, 1.0 / bw);
    wc = mix(wc, uInk, (iso * 0.08 + shelf * 0.14) * fadeIso * (win == 1u ? 0.0 : 1.0));
    vec2 q = uv * uGrid * 0.35;
    float n = vnoise(q + vec2(uTime * 0.05, uTime * 0.035)) * 0.6 + vnoise(q * 2.7 - vec2(uTime * 0.08, 0.0)) * 0.4;
    wc *= 1.0 + (n - 0.5) * 0.08 * (1.0 - smoothstep(0.6, 3.0, texPerPx));
    // sea ice: from the simulation when running, else from the imagery
    float ice = uHasWeather > 0.5 ? smoothstep(0.25, 0.7, wx.r) : smoothstep(0.55, 0.8, dot(alb, vec3(0.333)));
    col = mix(wc, uSnow * mix(1.0, shade, 0.5), ice * 0.9);
    if (uMode == 2) col = mix(desat(col), tempRamp(sim.r), 0.45);
    else if (uMode == 3) col = mix(desat(col), precRamp(sim.g), 0.3);
    else if (uMode == 4) col = mix(col, hazardRamp(sim.b), 0.6 * step(0.02, sim.b));
  }
  // clouds from the weather simulation (soft, broken edges), strongest at globe distance
  if (uHasWeather > 0.5 && uCloudAmt > 0.0) {
    float cn = vnoise(uv * vec2(900.0, 450.0) + vec2(uTime * 0.02, 0.0)) * 0.55 + vnoise(uv * vec2(2600.0, 1300.0)) * 0.45;
    float cm = smoothstep(0.42, 0.8, wx.g + (cn - 0.5) * 0.5);
    col = mix(col, vec3(0.96, 0.95, 0.93), cm * 0.55 * uCloudAmt);
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
      if (S0 + S1 + S2 + S3 > 0.0 && S0 + S1 + S2 + S3 < 4.0) sel = lineA(isoDistPx(S0, S1, S2, S3, f, jx, jy), 3.0) * aMag;
      float H0 = id0 == uHover ? 1.0 : 0.0, H1 = id1 == uHover ? 1.0 : 0.0, H2 = id2 == uHover ? 1.0 : 0.0, H3 = id3 == uHover ? 1.0 : 0.0;
      if (H0 + H1 + H2 + H3 > 0.0 && H0 + H1 + H2 + H3 < 4.0) hov = lineA(isoDistPx(H0, H1, H2, H3, f, jx, jy), 1.8) * aMag;
    }
    coast = (L0 + L1 + L2 + L3 > 0.0 && L0 + L1 + L2 + L3 < 4.0) ? lineA(dCoast, 1.4) * aMag : 0.0;
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
  col = mix(col, col * 0.7, lineDist * uLineDist * 0.5);
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
