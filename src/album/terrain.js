// The land and the sea: nested square grids around the camera target (each level twice as coarse as the one inside
// it), lifted onto the sphere by the height data in the vertex shader. Everything visible — relief shading, cast
// shadows, vegetation, snow, water — is computed per pixel from the same height data, so the picture does not depend
// on the grid and shapes never change with the camera height.
//
// The pixel shader is assembled from parts. This file owns the frame: heights, light, bare ground and rock, snow, map
// overlays, air. The living and changing things — swamp, fields, forest, water, borders — are aspects
// (src/album/aspects/*.js), each one file with its own owner; they read the state of the chunks (chunks.js) and are
// all lit by the same light (LIGHT in glsl.js). The contract is docs/ALBUM-CHUNKS.md.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, SphereGeometry, BackSide, Color, DataArrayTexture, DataTexture, RGBAFormat,
  UnsignedByteType, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT } from './glsl.js';
import { ASPECT_GLSL, ASPECT_UNIFORMS } from './aspects/index.js';
import { R, KM_PER_DEG, COS_REF } from './geo.js';
import { FKM } from './chunks.js';
import { GROUND_TILES } from './data.js';
import { CLIM_N, climateTexels } from './ground/climate.js';
import { stepTable } from './ground/steps.js';

const M = 160, LEVELS = 9;

const VERT = /* glsl */`
${COMMON}
attribute vec2 grid;
uniform vec2 uCentre; uniform float uCell; uniform vec3 uFine; uniform float uLod;
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
    vec2 d = abs(vec2((ll.y - uFine.y) * KM * COSREF, (ll.x - uFine.x) * KM));
    if (max(d.x, d.y) < uFine.z) h -= uCell * .9;
  }
  vLL = ll; vPos = worldOf(ll, h);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
}`;

const FRAG_SRC = /* glsl */`
${COMMON}
${CHUNK_GLSL}
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

float heightPix(vec2 ll) {
  vec2 m = merc(ll);
  float hb = texture(uBase, (m - uBaseRect.xy) * uBaseRect.zw).r;
  if (uDetOn > .5) { float w = detailWeight(m), hd = texture(uDet, (m - uDetRect.xy) * uDetRect.zw).r; hb = mix(hb, hd > .6 ? hd : min(hb, -1.5), w); }
  return mix(-3200., hb, inRegion(ll));
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
float gRise, gTreeline;

${ASPECT_GLSL}

void main() {
  vec2 ll = vLL; float lat = ll.x, lon = ll.y, cl = cos(radians(lat));
  float px = length(fwidth(vPos));                                  // km per pixel
  // (The step is never finer than the height data — 0.23 km a cell, 0.03 km around the showcase places. Inside one
  // cell the slope is that of the cell's own facet, and steep ground turned to rock by whole square cells.)
  float e = clamp(px * 1.3, mix(.24, .035, detailWeight(merc(ll))), 6.);
  float h0 = heightPix(ll), hE = heightPix(ll + vec2(0., e / (KM * cl))), hN = heightPix(ll + vec2(e / KM, 0.));
  vec2 g = vec2(hE - h0, hN - h0) / (e * 1000.);                    // rise over run toward east and north
  float slope = length(g), hl = max(h0, 0.);
  vec2 pk = vec2(lon * KM * COSREF, lat * KM);                      // flat km coordinates for patterns
  float mk = smoothstep(.45, .05, px);                              // small relief the data cannot hold
  vec2 gm = vec2(0.);
  if (mk > 0. && h0 > 0.) { float ma = vnoise(pk / .13), mb = vnoise(pk / .43 + 9.);
  gm = (vec2(vnoise(pk / .13 + vec2(.2, 0.)) - ma, vnoise(pk / .13 + vec2(0., .2)) - ma) * 1.3
    + vec2(vnoise(pk / .43 + 9. + vec2(.2, 0.)) - mb, vnoise(pk / .43 + 9. + vec2(0., .2)) - mb)) * mk * (.04 + .55 * smoothstep(.15, .8, slope)); }
  vec3 n = normalize(vec3(-(g + gm) * uExag * uShade, 1.));         // east, north, up
  vec3 up = normalize(vPos + vec3(0., RKM, 0.));
  float dl = radians(lon - LON0);
  vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
  vec3 Vw = normalize(cameraPosition - vPos), V = vec3(dot(Vw, east), dot(Vw, north), dot(Vw, up));
  vec2 pdx = dFdx(pk), pdy = dFdy(pk);

  // sun: shadows cast by the relief, and how open the sky is above the point
  float lod0 = log2(max(px, .234) / .234);
  vec2 sd = normalize(uSun.xy + 1e-4); float tanEl = uSun.z / max(1e-3, length(uSun.xy));
  float sh = 1., d = max(e * 2., .4);
  for (int i = 0; i < 5; i++) {
    vec2 q = ll + vec2(sd.y * d / KM, sd.x * d / (KM * cl));
    float occ = (max(heightLod(q, lod0 + float(i) * .8), 0.) - hl) * uExag - d * 1000. * tanEl;
    sh = min(sh, 1. - clamp(occ / (d * 90. + 4.), 0., 1.));
    d *= 2.2;
  }
  float rad = .234 * exp2(lod0 + 3.5);
  float conc = (max(heightLod(ll, lod0 + 3.5), 0.) - hl) * uExag / (rad * 260.);
  float ao = 1. - clamp(conc, 0., 1.) * .72, ridge = clamp(-conc, 0., 1.);
  float nl = max(dot(n, uSun), 0.), day = albumDay();
  vec3 sunCol = albumSunCol(), skyCol = albumSkyCol();

  Px p;
  p.ll = ll; p.pk = pk; p.pdx = pdx; p.pdy = pdy; p.px = px; p.h = h0; p.hl = hl; p.slope = slope; p.n = n;
  p.wet = .5; p.n1 = .5; p.n2 = .5; p.n3 = .5; p.V = V; p.sd = sd; p.day = day; p.sh = sh; p.ao = ao; p.sunCol = sunCol; p.skyCol = skyCol;
  vec2 cuv = chunkUV(pk);
  p.cA = texture(tChunkA, cuv); p.cB = texture(tChunkB, cuv); p.cC = texture(tChunkC, cuv);

  // ---- land
  vec3 land = vec3(0.);
  float cover = 0.;
  if (h0 > -25.) {
    // noises fade to their mean once their features are smaller than a pixel, so nothing shimmers from afar
    float n1 = fbm(pk / 38.), n2 = px < 5. ? mix(.5, fbm(pk / 7.3 + 5.), smoothstep(5., 1.5, px)) : .5, n3 = px < .7 ? mix(.5, vnoise(pk / 1.1), smoothstep(.7, .25, px)) : .5;
    // the climate of the place; a slope that faces north and the floor of a valley are wetter than the ridge above
    vec4 clim = albumClimate(ll); gRise = clim.r * 4096.; gTreeline = albumTreelineOf(clim);
    float hollow = clamp(conc, 0., 1.), north = -g.y / (slope + .12);
    float wet = albumWetOf(clim, hl, n1) + north * .05 + hollow * .07 - ridge * .05;
    // (in a wet land grass and scrub hold on a slope that would be bare rock in a dry one)
    float humid = smoothstep(.45, .8, wet), treeline = albumTreeline(n1), steep = smoothstep(.40 + .12 * humid, .82 + .14 * humid, slope);
    p.n1 = n1; p.n2 = n2; p.n3 = n3; p.wet = wet;
    Land L; L.gloss = 0.;
    L.cover = forestCover(p);

    // bare ground: soil and low growth by the climate (aspects/ground.js), rock on steep slopes and summits, sand at the shore
    float rockW = clamp(steep * (.75 + .5 * n3) + smoothstep(treeline + 250., treeline + 700., hl) * .8 + ridge * .25 * smoothstep(treeline - 900., treeline - 100., hl), 0., 1.);
    float sandW = (1. - smoothstep(1., 5., hl)) * (1. - smoothstep(.015, .06, slope)) * .7;   // low flats by the sea; the beach itself is the water work's (aspShore)
    vec3 ground = groundBare(vec3(n1, n2, n3), wet, clim.a, px, hl, slope, pk);
    if (rockW > .004) {
      float rk = vnoise(pk / 2.3 + 3.), rk2 = vnoise(pk / 9. + 17.);
      vec3 rockCol = mix(vec3(.44, .42, .40), vec3(.61, .59, .56), n2);                                              // grey limestone and granite
      rockCol = mix(rockCol, vec3(.62, .52, .38), smoothstep(.55, .8, rk2) * .4);                                   // ochre limestone
      rockCol = mix(rockCol, vec3(.52, .34, .27), smoothstep(.62, .9, rk) * smoothstep(.3, .6, rk2) * .5);           // red sandstone
      rockCol = mix(rockCol, vec3(.29, .30, .33), smoothstep(.35, .1, rk2) * .45);                                  // dark slate
      rockCol *= .86 + .24 * (.5 + .5 * sin(hl / 38. + rk * 5.)) * smoothstep(.3, .06, px);                          // beds of rock
      // Gullies and scree run down the slope: a noise drawn out along the fall line. The fall line is taken as the two
      // of eight fixed directions nearest to it, joined smoothly — along a direction that turned freely with the slope
      // the pattern would shear and swirl.
      if (px < .1 && slope > .2) {
        float ang = atan(g.y, g.x) / .7853982, k = floor(ang), a0 = k * .7853982, a1 = a0 + .7853982;
        vec2 d0 = vec2(cos(a0), sin(a0)), d1 = vec2(cos(a1), sin(a1));
        float gul = mix(vnoise(vec2(dot(pk, vec2(-d0.y, d0.x)), dot(pk, d0)) / vec2(.07, .9) + 7.), vnoise(vec2(dot(pk, vec2(-d1.y, d1.x)), dot(pk, d1)) / vec2(.07, .9) + 7.), smoothstep(0., 1., ang - k)) - .5;
        rockCol *= 1. + gul * .8 * smoothstep(.1, .03, px) * smoothstep(.2, .55, slope);
      }
      rockCol = mix(rockCol, vec3(.38, .43, .25), smoothstep(.5, .75, n3) * .34 * smoothstep(.3, .6, wet));          // lichen and moss
      rockCol = mix(rockCol, vec3(.60, .51, .38) * (.9 + .2 * n2), (1. - smoothstep(.14, .40, wet)) * .65);           // the sun-bleached rock of dry country
      ground = mix(ground, rockCol, rockW);
    }
    if (sandW > .004) ground = mix(ground, mix(vec3(.80, .72, .53), vec3(.27, .37, .20), smoothstep(.45, .62, wet)), sandW);
    // The grain of the ground, one read for the pixel and used at once: the tile of the ground that is mostly here —
    // sand, stone (rock and desert), dry steppe or green land. The line between two tiles wanders with a noise and is
    // never seen: every tile is a pattern around 1.
    float kind = wet + (n3 - .5) * .12;
    ground *= mix(vec3(1.), texDetail(sandW > .35 ? tSand : (rockW > .45 || kind < .10) ? tRock : kind < .46 ? tDry : tGrass, pk, px, pdx, pdy), uGrainK);
    ground = aspShore(p, ground, L.cover);                           // beaches and rocks at the waterline (the water work)
    L.col = ground;

    // the aspects paint over the bare ground in this order: wet ground, what people did, the forest
    aspSwamp(p, L);
    aspSettle(p, L);
    aspForest(p, L);
    land = L.col; cover = L.cover;

    // snow: above the snow line, and wherever the chunk holds snow (thin snow lies in patches, hollows first)
    // (the edge of the snow is roughened by a finer, turned noise: the noise of 1 km alone shows its square lattice there)
    float sr = 0.; if (px < .5) sr = albumRough(pk) * smoothstep(.5, .2, px);
    float snowline = 2980. - (lat - 37.) * 55. + (n2 - .5) * 200. + (n3 - .5) * 90. + sr * 900. + uSnow;
    float snowW = smoothstep(snowline - 90., snowline + 110., hl - g.y * 260.) * (1. - smoothstep(.85, 1.4, slope));
    if (p.cB.g > .003) snowW = max(snowW, smoothstep(-.1, .1, p.cB.g * 1.3 - (n2 * .55 + n3 * .45) - sr * 1.2) * (1. - smoothstep(.85, 1.4, slope)) * (1. - .3 * cover));
    if (snowW > .004) land = mix(land, vec3(.93, .95, .99) * (.97 + .06 * n3), snowW);
    cover *= 1. - snowW;
    land = pow(max(land, vec3(0.)), vec3(2.2));                     // the palette above is written as seen on screen

    vec3 light = sunCol * nl * sh * 1.25 + skyCol * (.4 + .6 * n.z) * ao + albumMoonLit(n);   // (the Moon: light.js, the part «Небо»)
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
  vec3 sea = vec3(0.);
  if (h0 < 25.) sea = aspWater(p);
  float landA = clamp(h0 / max(fwidth(h0), 1e-3) + .5, 0., 1.);
  vec3 col = landA <= 0. ? sea : (landA >= 1. ? land : mix(sea, land, landA));   // (a bad number on one side must not leak into the other)

  // ---- map modes drawn on the ground
  aspDivision(p, col, landA);
  if (uData > 0 && landA > .5) {
    float temp = 17.5 - (lat - 38.) * .75 - hl * .0062, v = uData == 1 ? clamp((temp + 4.) / 24., 0., 1.) : clamp(hl / 3000., 0., 1.);
    vec3 ramp = uData == 1 ? mix(mix(vec3(.25, .40, .80), vec3(.95, .93, .70), smoothstep(0., .55, v)), vec3(.82, .25, .15), smoothstep(.55, 1., v)) : hypso(hl);
    ramp *= .92 + .08 * step(.5, fract(v * 12.));
    col = ramp * (.62 + .45 * nl * sh);
  }
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

  // ---- air between the eye and the ground, then the finish shared by everything
  gl_FragColor = vec4(albumFinish(albumAir(col, vPos)), 1.);
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
    const cr = chunks.uniforms.uChunkRect.value, clim = new DataTexture(climateTexels(data.base.at, { x0: cr.x, y0: cr.y, side: 1 / cr.z }, data.climate), CLIM_N, CLIM_N, RGBAFormat, UnsignedByteType);
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
      uStep: { value: GROUND_STEPS.table },
      ...chunks.uniforms, ...ASPECT_UNIFORMS,
    };
    this.levels = [];
    for (let l = 0; l < LEVELS; l++) {
      const mat = new ShaderMaterial({
        uniforms: { ...this.u, uCentre: { value: new Vector2() }, uCell: { value: 1 }, uFine: { value: new Vector3() }, uLod: { value: 0 } },
        vertexShader: VERT, fragmentShader: FRAG,                   // no polygonOffset: see the step in the vertex shader
      });
      const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = l - 20;
      scene.add(mesh); this.levels.push(mesh);
    }
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
  setDetail(d) {
    if (!d) { this.u.uDetOn.value = 0; return; }
    this.u.uDet.value = d.tex; this.u.uDetRect.value.set(...d.rect); this.u.uDetOn.value = 1;
  }
  // re-centres the levels on the camera target; cell sizes are powers of two, so the grid never swims
  update(s) {
    const c0 = 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, s.h * .0042))));
    let fine = null;
    for (let l = 0; l < LEVELS; l++) {
      const c = c0 * 2 ** l, u = this.levels[l].material.uniforms, sLat = 2 * c / KM_PER_DEG, sLon = 2 * c / (KM_PER_DEG * COS_REF);
      const lat = Math.round(s.lat / sLat) * sLat, lon = Math.round(s.lon / sLon) * sLon;
      u.uCentre.value.set(lat, lon); u.uCell.value = c; u.uLod.value = Math.max(0, Math.log2(c / .234));
      u.uFine.value.set(fine ? fine.lat : 0, fine ? fine.lon : 0, fine ? fine.half - c * 1.5 : 0);
      this.levels[l].visible = !fine || fine.half < 2600;
      fine = { lat, lon, half: M / 2 * c };
    }
  }
}
