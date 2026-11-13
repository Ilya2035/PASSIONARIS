// The light of the album: one sun, moon, sky, air and finish for the ground and for everything that stands on it,
// and where the sun is at a given hour. Owner: the part «Небо, свет и камера» (docs/album/sky.md). The GLSL here is
// pasted after COMMON of glsl.js (it uses RKM, vnoise and cameraPosition); glsl.js and params.js re-export these names.
//
// The names and arguments of albumDay, albumSunCol, albumSkyCol, albumLit, albumHaze, albumHazeCol, albumAir and
// albumFinish are a contract with every other part: they do not change. New names may be added.
//
// KEEP WHAT THE GROUND CALLS SHORT. The ground shader stands at a cliff on the built-in AMD card: a few dozen more
// operations in it and the whole frame is 40–50 % slower, at once, whatever those operations are (measured
// 13.11.2026, docs/album/sky.md). So everything that is the same for the whole frame — the colour of the Sun, of the
// sky, of the haze, how much day there is — is counted once a frame on the processor (lightFrame below) and comes to
// the shaders ready; albumHaze and albumAir are a few operations; the weather (clouds and their shadows, rain, fog)
// is laid over the finished picture by post.js, with the GLSL of sky/weather.js.
import { Vector3, Vector4 } from 'three';
import { sunDir } from './sky/astro.js';

// the low haze of the air lies in a layer this many km thick (the sky of sky/dome.js counts it by its height; the
// ground's albumHaze() only keeps a level look from crossing more of it than this thickness allows)
export const HAZE_KM = 1.5;

// ---- one light for everything: the ground and anything that stands on it use the same sun, sky, air and finish
export const LIGHT = /* glsl */`
uniform vec3 uSun; uniform float uHaze, uExposure, uSat, uWarm; uniform int uStyle;
// uSunW: the Sun as a direction of the world (uSun is the same direction as east, north, up).
// uMoon: the Moon as (east, north, up), and in w how strong its light is now: 0 by day, under the horizon and at new
//        moon .. 1 a full moon high in a dark sky.
// uCloud: x how much of the sky the clouds cover (0 = no clouds at all), yz how far the wind has carried them (km),
//         w the height of the cloud layer over the sea (km).
uniform vec3 uSunW; uniform vec4 uMoon, uCloud;
// The light of the frame, counted by lightFrame() of light.js: uLightA = colour of the sunlight, and how much day
// there is (0 night .. 1 day); uLightB = colour of the light of the sky, and the thin air crossed in one km of the
// way; uLightC = colour of the haze, and how strong the glow of sunrise and sunset is; uLightD = colour of the
// moonlight; uLightE = colour of that glow.
uniform vec4 uLightA, uLightB, uLightC; uniform vec3 uLightD, uLightE;
float albumDay() { return uLightA.w; }
vec3 albumSunCol() { return uLightA.rgb; }
// the Moon is a second, weak and cold light; a moonless night keeps the light of the stars
vec3 albumMoonCol() { return uLightD; }
vec3 albumMoonLit(vec3 n) { return uLightD * max(dot(n, uMoon.xyz), 0.) * 1.25; }   // n: unit normal (east, north, up)
vec3 albumSkyCol() { return uLightB.rgb; }
// a thing on the land: its colour as seen on screen, its normal (east, north, up), how open it is to the sky (0..1.5)
vec3 albumLit(vec3 seen, vec3 n, float open) {
  vec3 nn = normalize(n);
  return pow(seen, vec3(2.2)) * (albumSunCol() * max(dot(nn, uSun), 0.) * 1.25 + albumMoonLit(nn) + albumSkyCol() * open);
}
// The air between the eye and a point of the world: how much of it there is (0..1). Two parts: a thin air that
// thickens with the way through it (so that a look from any height keeps the same depth), and a low haze, the more
// of it the flatter the look runs over the land — the land sinks into it toward the horizon. A level look cannot
// cross more haze than its own length holds (the 1.5 km), so a mountain near the eye stays clear.
float albumHaze(vec3 wpos) {
  vec3 Vw = cameraPosition - wpos; float dist = length(Vw);
  return 1. - exp(-dist * (uLightB.w + .012 / max(dot(Vw, normalize(wpos + vec3(0., RKM, 0.))), max(.004 * dist, 1.5))));
}
vec3 albumHazeCol() { return uLightC.rgb; }
// The colour of the air at the horizon in a direction of the world: albumHazeCol(), and around a low Sun the glow of
// sunrise and sunset — orange toward the Sun, the cool colour staying on the far side of the sky.
vec3 albumHorizon(vec3 dir) {
  float s = max(dot(dir, uSunW), 0.); s *= s;
  return mix(uLightC.rgb, uLightE, uLightC.w * (.24 * s + .46 * s * s * s));
}
vec3 albumAir(vec3 col, vec3 wpos) { return mix(col, albumHorizon(normalize(wpos - cameraPosition)), albumHaze(wpos)); }
// (The clouds, the rain and the fog are not here: sky/weather.js. They are laid over the finished picture by post.js
// and never counted in the shaders of the land.)
// exposure, tone curve, saturation, display gamma: the last step of every pixel
vec3 albumFinish(vec3 col) {
  col *= uExposure;
  if (uStyle != 3 && uStyle != 2) col = (col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14);
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  return pow(clamp(col, 0., 1.), vec3(1. / 2.2));
}
`;

// ---- the light of a frame, counted on the processor
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;
// The numbers behind uLightA..uLightE, from: sun — the Sun as (east, north, up); moon — how strong the moonlight is
// (0..1, uMoon.w); style — the look (0 natural, 2 atlas, 3 paper, 6 night slate); warm — the warmth of the look
// (0..1); haze — the knob «Дымка воздуха»; alt — the height of the eye over the sea, km. Returns plain arrays, so the
// tests can read them.
export function lightNumbers({ sun, moon = 0, style = 0, warm = 0, haze = .09, alt = 500 }) {
  const z = sun.z, day = ss(-.08, .12, z), high = ss(.05, .45, z);
  // sunlight: orange when the Sun is low, nearly white when it is high, nothing at night; a warm look reddens it
  const sr = mix(1.25, 1.22, high) * day, sg = mix(.62, 1.15, high) * day, sb = mix(.30, 1.02, high) * day;
  // the light of the sky: blue by day; at night the stars, and the more the stronger the Moon
  const n = .5 + .34 * moon, sky = [mix(.26 * n, .46, day) * .62, mix(.33 * n, .58, day) * .62, mix(.52 * n, .78, day) * .62];
  // the haze: its colour by the look; in the natural one a low Sun warms it a little, and night dims it
  let hz;
  if (style === 6) hz = [.05, .07, .11];
  else if (style === 3) hz = [.84, .86, .86];
  else { const low = (1 - ss(.05, .5, z)) * ss(-.3, -.04, z) * .42, f = .12 + .05 * moon + .88 * day; hz = [mix(.55, .92, low) * f, mix(.70, .76, low) * f, mix(.92, .66, low) * f]; }
  // the glow of sunrise and sunset, in the natural look only: strongest with the Sun at the horizon
  const glow = style === 0 && z < .4 ? (1 - ss(.04, .4, z)) * ss(-.26, -.01, z) : 0, gb = .25 + .75 * ss(-.2, .06, z);
  return { A: [mix(sr, sr * 1.06, warm), sg, mix(sb, sb * .9, warm), day], B: [...sky, haze / (alt * 2.2 + 25)], C: [...hz, glow],
    D: [.085 * moon, .115 * moon, .185 * moon], E: [1.10 * gb, .64 * gb, .34 * gb] };
}
// the uniforms themselves: one set for the whole album (the ground gets them with the uniforms of the sky aspect,
// everything else through lightUniforms)
export const FRAME = { uLightA: { value: new Vector4() }, uLightB: { value: new Vector4() }, uLightC: { value: new Vector4() }, uLightD: { value: new Vector3() }, uLightE: { value: new Vector3() } };
// sets the light of the frame (the sky layer calls it every frame: aspects/sky.js)
export function lightFrame(o) {
  const v = lightNumbers(o);
  FRAME.uLightA.value.set(...v.A); FRAME.uLightB.value.set(...v.B); FRAME.uLightC.value.set(...v.C); FRAME.uLightD.value.set(...v.D); FRAME.uLightE.value.set(...v.E);
  return FRAME;
}

// The uniforms of LIGHT, to spread into a material: ...lightUniforms(album.terrain.u). The Sun as a direction of the
// world, the Moon and the clouds come from the part «Небо» (aspects/sky.js) through the uniforms of the ground.
const NONE = { uSunW: { value: new Vector3(0, 1, 0) }, uMoon: { value: new Vector4(0, 0, 1, 0) }, uCloud: { value: new Vector4(0, 0, 0, 9) } };
export const lightUniforms = T => ({ uSun: T.uSun, uHaze: T.uHaze, uExposure: T.uExposure, uSat: T.uSat, uWarm: T.uWarm, uStyle: T.uStyle,
  uSunW: T.uSunW || NONE.uSunW, uMoon: T.uMoon || NONE.uMoon, uCloud: T.uCloud || NONE.uCloud, ...FRAME });

// Sun direction as (east, north, up). hour 0 = the cartographer's light from the north-west, the light every picture
// of the album was taken with. Any other hour is the real Sun of that hour of the local solar time, on the given day
// of the year (172 = 21 June) at the given latitude (sky/astro.js).
export function sunAt(hour, yday = 172, lat = 40) {
  if (!hour) return new Vector3(-.5, .45, .74).normalize();
  return new Vector3(...sunDir(hour, yday, lat));
}
// (until the sky layer has run: the light of the map, by day)
lightFrame({ sun: sunAt(0) });
