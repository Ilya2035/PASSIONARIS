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
  float s = min(uRingA * sinh(t * uRingB), PI);
  vec3 T = uR * cos(az) + uU * sin(az);
  vec3 g = uF * cos(s) + T * sin(s);

  float spacing = uRingA * uRingB * cosh(t * uRingB) / uRings;
  float lod = clamp(log2(max(spacing / (PI / uGrid.y), 1.0)), 0.0, 12.0);
  float h = textureLod(uHeight, geoToUV(g), lod).r;

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
uniform float uTime;
uniform vec3 uSunView;       // globe-view light (world space)
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform vec3 uFogColor;

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
  vec2 o = exp2(lodH) / uGrid;
  float hc = textureLod(uHeight, uv, lodH).r;
  float he = textureLod(uHeight, uv + vec2(o.x, 0.0), lodH).r;
  float hw = textureLod(uHeight, uv - vec2(o.x, 0.0), lodH).r;
  float hn = textureLod(uHeight, uv - vec2(0.0, o.y), lodH).r;
  float hs = textureLod(uHeight, uv + vec2(0.0, o.y), lodH).r;
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
  uvec2 wi = infoOf(win);
  uvec2 i0 = infoOf(id0), i1 = infoOf(id1), i2 = infoOf(id2), i3 = infoOf(id3);

  // ---------------------------------------------------------------- base colour
  vec3 alb = textureGrad(uAlbedo, uv, duvx, duvy).rgb;
  vec3 col;
  if (land) {
    vec3 c = pow(alb, vec3(0.82));
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.18) * vec3(1.05, 1.0, 0.92);
    col = c * shade;
    vec4 ov = colorOf(win);
    float a = ov.a * uOverlay;
    col = mix(col, ov.rgb * mix(1.0, shade, 0.55), a);
  } else {
    float depth = max(-hc, 0.0);
    vec3 shallow = vec3(0.30, 0.56, 0.58), mid = vec3(0.12, 0.33, 0.45), deep = vec3(0.05, 0.14, 0.25);
    vec3 wc = mix(shallow, mid, smoothstep(0.0, 160.0, depth));
    wc = mix(wc, deep, smoothstep(160.0, 5200.0, depth));
    if (win == 1u) wc = vec3(0.17, 0.40, 0.48);
    // sea ice from the imagery
    float ice = smoothstep(0.55, 0.8, dot(alb, vec3(0.333)));
    // animated ripples, faded out when they would alias
    vec2 q = uv * uGrid * 0.35;
    float n = vnoise(q + vec2(uTime * 0.07, uTime * 0.05)) * 0.6 + vnoise(q * 2.7 - vec2(uTime * 0.11, 0.0)) * 0.4;
    float rip = (n - 0.5) * (1.0 - smoothstep(0.6, 3.0, texPerPx));
    wc *= 1.0 + rip * 0.18;
    col = mix(wc, vec3(0.86, 0.9, 0.93) * shade, ice);
  }

  // ---------------------------------------------------------------- borders
  float lineCountry = 0.0, lineProv = 0.0, lineDist = 0.0, coast = 0.0, sel = 0.0, hov = 0.0;
  {
    // analytic iso-lines in the magnified range
    float L0 = id0 >= 2u ? 1.0 : 0.0, L1 = id1 >= 2u ? 1.0 : 0.0, L2 = id2 >= 2u ? 1.0 : 0.0, L3 = id3 >= 2u ? 1.0 : 0.0;
    float dCoast = isoDistPx(L0, L1, L2, L3, f, jx, jy);
    float aMag = 1.0 - smoothstep(0.7, 1.2, texPerPx);
    if (land) {
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

    // screen-space neighbour test in the minified range (globe view)
    if (aMag < 1.0) {
      vec2 px = duvx * 1.25, py = duvy * 1.25;
      uint c0 = win;
      uint n1 = cellAt(ivec2(floor((uv + px) * uGrid))), n2 = cellAt(ivec2(floor((uv - px) * uGrid)));
      uint n3 = cellAt(ivec2(floor((uv + py) * uGrid))), n4 = cellAt(ivec2(floor((uv - py) * uGrid)));
      uvec2 c0i = infoOf(c0);
      uvec2 a1 = infoOf(n1), a2 = infoOf(n2), a3 = infoOf(n3), a4 = infoOf(n4);
      bool L = c0 >= 2u;
      float cb = 0.0, pb = 0.0, cs = 0.0;
      if (L) {
        cb = float((n1 >= 2u && a1.y != c0i.y) || (n2 >= 2u && a2.y != c0i.y) || (n3 >= 2u && a3.y != c0i.y) || (n4 >= 2u && a4.y != c0i.y));
        pb = float((n1 >= 2u && a1.x != c0i.x) || (n2 >= 2u && a2.x != c0i.x) || (n3 >= 2u && a3.x != c0i.x) || (n4 >= 2u && a4.x != c0i.x));
      }
      cs = float(((n1 >= 2u) != L) || ((n2 >= 2u) != L) || ((n3 >= 2u) != L) || ((n4 >= 2u) != L));
      float k = 1.0 - aMag;
      lineCountry = max(lineCountry, cb * k * 0.9);
      lineProv = max(lineProv, pb * k * 0.6);
      coast = max(coast, cs * k * 0.55);
    }
  }
  col = mix(col, col * 0.55 + vec3(0.02, 0.03, 0.05), coast * 0.8);
  col = mix(col, col * 0.62, lineDist * uLineDist * 0.55);
  col = mix(col, col * 0.42, lineProv * uLineProv * 0.8);
  col = mix(col, vec3(0.07, 0.05, 0.04), lineCountry * 0.92);
  if (land && win == uHover) col = col * 1.12 + 0.03;
  if (land && win == uSelected) col = mix(col, vec3(0.95, 0.78, 0.42), 0.22);
  col = mix(col, vec3(1.0, 0.97, 0.88), hov * 0.75);
  col = mix(col, vec3(1.0, 0.82, 0.38), sel);

  // ---------------------------------------------------------------- globe look + haze
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vUp);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float sphereLight = 0.62 + 0.48 * clamp(dot(N, uSunView), -0.2, 1.0);
  col *= mix(1.0, sphereLight, uGlobe);
  float limb = 1.0 - smoothstep(0.0, 0.55, ndv);
  col = mix(col, vec3(0.42, 0.62, 0.9), limb * 0.45 * uGlobe);

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
  float h = textureLod(uHeight, geoToUV(g), 0.0).r;
  vec3 up;
  vec3 p = morphPos(s, T, max(h, 0.0) * uExag + uLift, up);
  vA = position.z <= uMaxRank ? 1.0 - 0.06 * position.z : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RIVER_FRAG = /* glsl */ `
precision highp float;
uniform float uOpacity;
in float vA;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vA <= 0.0) discard;
  fragColor = vec4(0.16, 0.36, 0.5, vA * uOpacity);
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
in vec3 vN;
in vec3 vP;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 V = normalize(cameraPosition - vP);
  float rim = 1.0 - abs(dot(normalize(vN), V));
  float a = pow(clamp(rim, 0.0, 1.0), 3.0);
  // only the outer halo: fade the part that overlaps the planet disc
  float glow = smoothstep(0.0, 1.0, a) * uOpacity;
  fragColor = vec4(vec3(0.45, 0.66, 1.0) * glow, glow);
}
`;
