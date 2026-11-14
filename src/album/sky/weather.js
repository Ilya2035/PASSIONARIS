// The weather of the album (docs/album/sky.md, «Погода»): where the clouds stand, where it rains under them, and
// where the fog of the morning lies. Nothing of it is counted in the shaders of the land: the clouds are a shell
// drawn over the finished picture (layers/clouds.js), and their shadows, the rain and the fog are laid over the
// finished picture by the finishing pass (post.js), from the depth of every pixel.
//
// Two small textures carry it:
//   tCloud  the field of the clouds: a picture of smooth noise, CLOUD_KM a side, that repeats without a seam and
//           drifts with the wind. Thick places of the field are cloud; the thickest are rain.
//   tFog    for every place of the map, the height of the floor of the land around it (the bottom of the valley, the
//           plain, the sea), how willingly fog gathers there, and how much of the place is sea. Fog fills the land from that floor upward, so it
//           lies in the valleys and over the water and its edge runs along the slopes.
// Both are built on the first frame that needs them; while the weather is off they do not exist.
import { DataTexture, RedFormat, RGBAFormat, UnsignedByteType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, DataUtils, Vector4 } from 'three';
import { R, BBOX, CENTRE, KM_PER_DEG, toWorld, fromWorld } from '../geo.js';

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;

// ---- the plane the weather is laid out on: it touches the globe at the middle of the map; km east and km south
export function planeOf(lat, lon) { const v = toWorld(lat, lon, 0), k = R / (v.y + R); return [v.x * k, v.z * k]; }
export function llOfPlane(x, z) { const s = R / Math.hypot(x, R, z); return fromWorld({ x: x * s, y: R * s - R, z: z * s }); }

// ---- the field of the clouds
export const CLOUD_KM = 8192, CLOUD_N = 1024;
// the wind carries the clouds toward the east-north-east: (east, south) of one km of the way
export const WIND = [.924, -.383];
// how far the wind has carried the field after `drift` km of the way: what uCloud.yz holds
export const cloudOffset = drift => [-drift * WIND[0] - 37, -drift * WIND[1] + 11];
// its three sizes of cloud: how many cells of noise in one side of the picture (cells of about 315, 117 and 47 km), and their weight
const OCTAVES = [[26, .46], [70, .32], [174, .22]];
function mulberry(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// The picture itself, one byte a point: smooth noise (gradient noise, so that no square grain shows) whose left edge
// continues its right one and its top its bottom. Its values are spread around .5 with a deviation of .125 whatever
// the dice say, so that the knob «Облачность» always means the same share of the sky.
export function cloudNoise(N = CLOUD_N, seed = 20261114) {
  const f = new Float32Array(N * N), rnd = mulberry(seed), fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [cells, weight] of OCTAVES) {
    const gx = new Float32Array(cells * cells), gy = new Float32Array(cells * cells);
    for (let i = 0; i < gx.length; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const i0 = new Int32Array(N), i1 = new Int32Array(N), fr = new Float32Array(N), fu = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i + .5) * cells / N, c = Math.floor(x); i0[i] = c % cells; i1[i] = (c + 1) % cells; fr[i] = x - c; fu[i] = fade(x - c); }
    for (let j = 0; j < N; j++) {
      const r0 = i0[j] * cells, r1 = i1[j] * cells, fy = fr[j], v = fu[j];
      for (let i = 0; i < N; i++) {
        const a = i0[i], b = i1[i], fx = fr[i], u = fu[i];
        const p = gx[r0 + a] * fx + gy[r0 + a] * fy, q = gx[r0 + b] * (fx - 1) + gy[r0 + b] * fy;
        const s = gx[r1 + a] * fx + gy[r1 + a] * (fy - 1), t = gx[r1 + b] * (fx - 1) + gy[r1 + b] * (fy - 1);
        f[j * N + i] += weight * mix(mix(p, q, u), mix(s, t, u), v);
      }
    }
  }
  let m = 0, d = 0; for (let i = 0; i < f.length; i++) m += f[i]; m /= f.length;
  for (let i = 0; i < f.length; i++) d += (f[i] - m) ** 2; d = Math.sqrt(d / f.length) || 1;
  const out = new Uint8Array(N * N);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((.5 + (f[i] - m) / d * .125) * 255)));
  return out;
}
// the picture read as a texture reads it: (u, v) in sides of the picture, repeating
function fieldAt(noise, tu, tv) {
  const N = Math.round(Math.sqrt(noise.length)), wrap = k => ((k % N) + N) % N;
  const u = tu * N - .5, v = tv * N - .5, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, at = (a, b) => noise[wrap(b) * N + wrap(a)] / 255;
  return mix(mix(at(i, j), at(i + 1, j), fx), mix(at(i, j + 1), at(i + 1, j + 1), fx), fy);
}
// the field at a point of the plane, 0..1, as the shaders read it (wxCloudN): for the tests and for choosing the pages
export function cloudAt(noise, x, z, drift = 0) { const o = cloudOffset(drift); return fieldAt(noise, (x + o[0]) / CLOUD_KM, (z + o[1]) / CLOUD_KM); }
// the rules the shaders and the tests share
export const cloudThreshold = cover => mix(.80, .30, cover);                 // the field above it is cloud
// With the rain on, the sky is at least this cloudy. Not every cloud rains: the same picture, read larger and from
// another place, says which do — those where it is above rainMask(). A cloud that rains, rains nearly to its edge:
// only so can its curtain of rain be seen under it from the side.
export const rainCover = force => .4 + .2 * force, rainMask = force => mix(.68, .46, force);
export const RAIN_SCALE = .37, RAIN_SHIFT = [.16, .16], RAIN_EDGE = .02;
// how far behind its cloud the rain reaches the ground, km (the cloud moves on while the drops fall)
export const RAIN_LAG = 7;
// how hard it rains on the ground at a place, 0..1 (wxRainAt in the shaders)
export function rainAt(noise, lat, lon, cover, force, drift = 0) {
  const p = planeOf(lat, lon), x = p[0] + WIND[0] * RAIN_LAG, z = p[1] + WIND[1] * RAIN_LAG, o = cloudOffset(drift), t = cloudThreshold(cover) + RAIN_EDGE, m = rainMask(force);
  return ss(t, t + .08, cloudAt(noise, x, z, drift)) * ss(m, m + .08, fieldAt(noise, (x + o[0]) * RAIN_SCALE / CLOUD_KM + RAIN_SHIFT[0], (z + o[1]) * RAIN_SCALE / CLOUD_KM + RAIN_SHIFT[1]));
}

// ---- snowfall
// What falls from a cloud is snow where the ground stands above the line of snowfall, and rain below it. That line
// is the line of lasting snow of the ground shader (terrain.js: 2980 m at 37° N, 55 m lower with every degree north,
// moved by the look of the map and by the knob «Снеговая линия»), lowered by SNOW_DROP: a snow cloud brings its own
// cold, and fresh snow lies well below the snow that lasts the summer. Over half of SNOW_BAND the snow turns to rain.
export const SNOW_DROP = 900, SNOW_BAND = 120;
export const snowLine = (lat, shift = 0) => 2980 - (lat - 37) * 55 + shift;
export const snowfallLine = (lat, shift = 0) => snowLine(lat, shift) - SNOW_DROP;
// how much of what falls at a place is snow, 0 rain .. 1 snow (wxSnowy in the shaders); height in m
export const snowShare = (lat, height, shift = 0) => ss(-SNOW_BAND, SNOW_BAND, height - snowfallLine(lat, shift));
// the same line for the shaders, on the plane of the weather: its height at the middle of the map, how much it rises
// with every km south, and the band — all in km of the world (heights there are stretched `exag` times)
export const snowNumbers = (shift, exag) => [snowfallLine(CENTRE.lat, shift) * exag / 1000, 55 / KM_PER_DEG * exag / 1000, SNOW_BAND * exag / 1000];

// ---- the fog of the morning
// How much of the fog is left at an hour of the day, 0..1: it gathers through the night, is thickest at dawn, thins
// from an hour and a half after sunrise and is gone by noon. Hour 0 is the light of the map, not midnight: there the
// fog lies as on a morning, so that the switch always shows something.
export function fogByHour(hour, rise = 6) {
  if (!hour) return 1;
  const h = ((hour % 24) + 24) % 24, clear = Math.max(12, rise + 4);
  if (h >= rise - 3 && h <= clear) return 1 - ss(rise + 1.5, clear, h);
  return ss(20.5, 26, h < rise ? h + 24 : h);
}
// the numbers of the fog for the shaders, from how much of it there is (0..1): how thick its layer may be (m of real
// height), from which value of the field of its banks it lies, and how soft its top is (m)
export const fogNumbers = amount => ({ thick: amount * (110 + 190 * amount), bank: mix(.62, .18, amount), soft: 14 + 30 * amount });

// The floor of the land for the fog, on a grid over the map: for every cell the lowest ground around it (smoothed),
// m over the sea, and how willingly fog gathers there: 1 on the land .. 1.25 in a deep valley; over the sea .9 at the
// coast, falling to nothing 40 km out (sea fog lies in banks along the shore, not over the whole sea).
// at(lat, lon) gives the height of the ground in m (under the sea negative).
export function fogFloor(at, cell = 4, sub = 4, box = BBOX) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const la of [box.lat0, (box.lat0 + box.lat1) / 2, box.lat1]) for (const lo of [box.lon0, (box.lon0 + box.lon1) / 2, box.lon1]) {
    const [x, z] = planeOf(la, lo); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell), n = w * h;
  let low = new Float32Array(n), mean = new Float32Array(n), sea = new Float32Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let lo = Infinity, m = 0, s = 0;
    for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
      const ll = llOfPlane(x0 + (i + (a + .5) / sub) * cell, z0 + (j + (b + .5) / sub) * cell), g = at(ll.lat, ll.lon), g0 = Math.max(g, 0);
      if (g0 < lo) lo = g0; m += g0; if (g <= 0) s++;
    }
    low[j * w + i] = lo; mean[j * w + i] = m / (sub * sub); sea[j * w + i] = s / (sub * sub);
  }
  // one pass along the rows and one along the columns: the lowest, or the mean, of the cells within r of each
  const pass = (src, r, min) => {
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (const [a, b, len, lines, stride, step] of [[src, tmp, w, h, w, 1], [tmp, out, h, w, 1, w]]) {
      for (let l = 0; l < lines; l++) for (let k = 0; k < len; k++) {
        let acc = min ? Infinity : 0, c = 0;
        for (let d = -r; d <= r; d++) { const kk = k + d; if (kk < 0 || kk >= len) continue; const v = a[l * stride + kk * step]; if (min) { if (v < acc) acc = v; } else { acc += v; c++; } }
        b[l * stride + k * step] = min ? acc : acc / c;
      }
    }
    return out;
  };
  // (the lowest ground within 24 km: over a wide basin the top of the fog is then nearly level, and the land rising
  // away from the river comes out of it along its own contour — which is what gives fog its shape from above)
  const r8 = Math.max(1, Math.round(8 / cell)), r12 = Math.max(1, Math.round(12 / cell)), r24 = Math.max(1, Math.round(24 / cell));
  const open = pass(sea, Math.max(1, Math.round(40 / cell)), false);          // how much of the 40 km around is sea
  low = pass(pass(pass(low, r24, true), r12, false), r12, false); mean = pass(mean, Math.round(16 / cell) || 1, false); sea = pass(sea, r8, false);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = mix(1 + .25 * Math.max(0, Math.min(1, (mean[i] - low[i] - 60) / 340)), .9 * Math.min(1, (1 - open[i]) * 2.2), sea[i]);
  return { w, h, cell, x0, z0, floor: low, weight, sea, mean };
}
// the floor and the willingness at a place, as the shader reads them (for the tests)
export function fogFloorAt(ff, lat, lon) {
  const [x, z] = planeOf(lat, lon), i = Math.max(0, Math.min(ff.w - 1, Math.floor((x - ff.x0) / ff.cell))), j = Math.max(0, Math.min(ff.h - 1, Math.floor((z - ff.z0) / ff.cell)));
  return { floor: ff.floor[j * ff.w + i], weight: ff.weight[j * ff.w + i], sea: ff.sea[j * ff.w + i], mean: ff.mean[j * ff.w + i] };
}

// ---- what the shaders get
// uRain: x how hard it rains (0 = no rain) .. 1, y which clouds rain (rainMask), z the time for the falling lines (s),
//        w how much of the lines of rain to show (1 near the ground .. 0 from a height).
// uFog:  x 1 while there is fog, y the greatest thickness of its layer (km of the world), z from which value of the
//        field of its banks it lies, w how soft its top is (km of the world).
// uFogRect: where tFog lies on the plane: (x0, z0, 1 / width, 1 / height), km.
// uSnowF: the line of snowfall (snowNumbers): x its height at the middle of the map, y its rise with every km south,
//        z its band, all in km of the world; w 1 while precipitation can be snow.
export const WX = { tCloud: { value: null }, tFog: { value: null }, uFogRect: { value: new Vector4(0, 0, 1, 1) }, uRain: { value: new Vector4(0, .2, 0, 1) }, uFog: { value: new Vector4(0, .3, .5, .05) },
  uSnowF: { value: new Vector4(9, 0, .2, 0) } };
// builds the textures when they are first needed
export function needClouds() {
  if (WX.tCloud.value) return;
  const t = new DataTexture(cloudNoise(), CLOUD_N, CLOUD_N, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  WX.tCloud.value = t;
}
export function needFog(at) {
  if (WX.tFog.value) return;
  const ff = fogFloor(at), hf = new Uint16Array(ff.w * ff.h * 4), one = DataUtils.toHalfFloat(1);
  for (let i = 0; i < ff.w * ff.h; i++) { hf[i * 4] = DataUtils.toHalfFloat(ff.floor[i]); hf[i * 4 + 1] = DataUtils.toHalfFloat(ff.weight[i]); hf[i * 4 + 2] = DataUtils.toHalfFloat(ff.sea[i]); hf[i * 4 + 3] = DataUtils.toHalfFloat(ff.mean[i]); }
  const t = new DataTexture(hf, ff.w, ff.h, RGBAFormat, HalfFloatType);
  t.internalFormat = 'RGBA16F'; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.magFilter = t.minFilter = LinearFilter; t.needsUpdate = true;
  WX.tFog.value = t; WX.uFogRect.value.set(ff.x0, ff.z0, 1 / (ff.w * ff.cell), 1 / (ff.h * ff.cell));
}

// ---- the GLSL of the weather: pasted after COMMON and LIGHT (it uses RKM, uExag, uCloud, uSun, uSunW, albumDay)
export const WEATHER = /* glsl */`
uniform sampler2D tCloud, tFog; uniform vec4 uRain, uFog, uFogRect, uSnowF;
const vec2 WX_WIND = vec2(${WIND[0].toFixed(4)}, ${WIND[1].toFixed(4)});
#define RAIN_LAG ${RAIN_LAG.toFixed(1)}
// km on the plane that touches the globe at the middle of the map: the weather is laid out on it
vec2 wxPlane(vec3 wpos) { vec3 P = wpos + vec3(0., RKM, 0.); return P.xz / max(P.y, 1.) * RKM; }
// the field of the clouds over a point of that plane, 0..1 around .5; a higher lod is a softer field
float wxCloudN(vec2 q, float lod) { return textureLod(tCloud, (q + uCloud.yz) / ${CLOUD_KM.toFixed(1)}, lod).r; }
float wxThr() { return mix(.80, .30, uCloud.x); }
// the clouds over a point of the world, 0 clear sky .. 1 thick cloud
float albumCloudField(vec3 wpos) { float thr = wxThr(); return smoothstep(thr - .05, thr + .14, wxCloudN(wxPlane(wpos), 0.)); }
// how much sunlight the clouds leave at a point of the ground: 1 open .. about .5 under a thick cloud
float albumCloudShade(vec3 wpos) {
  if (uCloud.x <= 0.) return 1.;
  vec3 up = normalize(wpos + vec3(0., RKM, 0.));
  float rise = max(uCloud.w - (length(wpos + vec3(0., RKM, 0.)) - RKM), 0.);
  vec3 L = uSun.z > -.03 ? uSunW : normalize(up + vec3(.3, 0., .2));                   // by night the shade lies under the cloud
  float sh = albumCloudField(wpos + L * rise / max(dot(L, up), .22));
  return 1. - sh * mix(.22, .5, albumDay());
}
// which clouds rain, 0..1 (the same picture, read larger and from another place)
float wxRainMask(vec2 q) { return smoothstep(uRain.y, uRain.y + .08, textureLod(tCloud, (q + uCloud.yz) * ${(RAIN_SCALE / CLOUD_KM).toFixed(9)} + vec2(${RAIN_SHIFT[0]}, ${RAIN_SHIFT[1]}), 0.).r); }
// rain over a point of the plane, 0..1: under a cloud that rains, nearly to its edge
// (wxRainCloud: is there cloud enough over the point for rain; whether that cloud rains at all is wxRainMask)
float wxRainCloud(vec2 q, float lod) { float t = wxThr() + ${RAIN_EDGE.toFixed(3)}; return smoothstep(t, t + .08, wxCloudN(q, lod)); }
float wxRainAt(vec2 q, float lod) { return wxRainCloud(q, lod) * wxRainMask(q); }
// how much of what falls is snow, 0 rain .. 1 snow: at a height (km of the world over the sea) over a point of the plane
float wxSnowy(vec2 q, float alt) { return smoothstep(-uSnowF.z, uSnowF.z, alt - uSnowF.x - q.y * uSnowF.y); }
// the same in the air over a point of the plane: by the height of the land around it (the mean of 16 km)
float wxSnowAir(vec2 q) { return wxSnowy(q, textureLod(tFog, (q - uFogRect.xy) * uFogRect.zw, 0.).a * uExag * .001); }
// the top of the fog over a point of the plane, km over the sea: the floor of the land there, and over it a layer
// whose thickness goes by the place and by the banks the fog lies in (over the sea the banks are fewer: sea fog
// stands off a stretch of the coast here and there, not along all of it)
float wxFogTop(vec2 q) {
  vec3 f = textureLod(tFog, (q - uFogRect.xy) * uFogRect.zw, 0.).rgb;
  float lo = uFog.z + .22 * f.b, bank = smoothstep(lo, lo + .2, textureLod(tCloud, q / ${CLOUD_KM.toFixed(1)} * 2.3 + .37, 1.).r);
  return f.r * uExag * .001 + uFog.y * f.g * bank;
}
`;
