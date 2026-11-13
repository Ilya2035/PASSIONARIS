// The light of the album: one sun, moon, sky, air and finish for the ground and for everything that stands on it,
// and where the sun is at a given hour. Owner: the part «Небо, свет и камера» (docs/album/sky.md). The GLSL here is
// pasted after COMMON of glsl.js (it uses RKM, vnoise and cameraPosition); glsl.js and params.js re-export these names.
//
// The names and arguments of albumDay, albumSunCol, albumSkyCol, albumLit, albumHaze, albumHazeCol, albumAir and
// albumFinish are a contract with every other part: they do not change. New names may be added.
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
#define HAZE_KM ${HAZE_KM.toFixed(3)}
float albumDay() { return smoothstep(-.08, .12, uSun.z); }
vec3 albumSunCol() {
  vec3 c = mix(vec3(1.25, .62, .30), vec3(1.22, 1.15, 1.02), smoothstep(.05, .45, uSun.z)) * albumDay();
  return mix(c, c * vec3(1.06, 1., .9), uWarm);
}
// the Moon is a second, weak and cold light; a moonless night keeps the light of the stars
vec3 albumMoonCol() { return vec3(.085, .115, .185) * uMoon.w; }
vec3 albumMoonLit(vec3 n) { return albumMoonCol() * max(dot(n, uMoon.xyz), 0.) * 1.25; }   // n: unit normal (east, north, up)
vec3 albumSkyCol() { return mix(vec3(.26, .33, .52) * (.5 + .34 * uMoon.w), vec3(.46, .58, .78), albumDay()) * .62; }
// a thing on the land: its colour as seen on screen, its normal (east, north, up), how open it is to the sky (0..1.5)
vec3 albumLit(vec3 seen, vec3 n, float open) {
  vec3 nn = normalize(n);
  return pow(seen, vec3(2.2)) * (albumSunCol() * max(dot(nn, uSun), 0.) * 1.25 + albumMoonLit(nn) + albumSkyCol() * open);
}
// The air between the eye and a point of the world: how much of it there is (0..1). Two parts: a thin air that
// thickens with the way through it (so that a look from any height keeps the same depth), and a low haze, the more
// of it the flatter the look runs over the land — the land sinks into it toward the horizon. A level look cannot
// cross more haze than its own length holds (1.5 / dist), so a mountain near the eye stays clear.
//
// KEEP THIS SHORT. The ground shader stands at a cliff on the built-in AMD card: about a hundred more operations in
// it (the first version of this function counted the height of the haze layer, with two exp and two sqrt) and the
// whole frame is 40–50 % slower, at once, whatever those operations are (measured 13.11.2026, docs/album/sky.md).
float albumHaze(vec3 wpos) {
  vec3 up = normalize(wpos + vec3(0., RKM, 0.)), Vw = normalize(cameraPosition - wpos);
  float dist = length(cameraPosition - wpos), camAlt = length(cameraPosition + vec3(0., RKM, 0.)) - RKM;
  return 1. - exp(-(uHaze * dist / (camAlt * 2.2 + 25.) + .012 / max(dot(Vw, up), max(.004, 1.5 / dist))));
}
vec3 albumHazeCol() {
  if (uStyle == 6) return vec3(.05, .07, .11);
  if (uStyle == 3) return vec3(.84, .86, .86);
  float low = (1. - smoothstep(.05, .5, uSun.z)) * smoothstep(-.3, -.04, uSun.z);      // the Sun low over the horizon: the air warms a little
  return mix(vec3(.55, .70, .92), vec3(.92, .76, .66), low * .42) * (.12 + .05 * uMoon.w + .88 * albumDay());
}
// The colour of the air at the horizon in a direction of the world: albumHazeCol(), and around a low Sun the glow of
// sunrise and sunset — orange toward the Sun, the cool colour staying on the far side of the sky.
vec3 albumHorizon(vec3 dir) {
  vec3 c = albumHazeCol();
  if (uStyle == 0 && uSun.z < .4) {
    float g = (1. - smoothstep(.04, .4, uSun.z)) * smoothstep(-.26, -.01, uSun.z), s = max(dot(dir, uSunW), 0.);
    s *= s; c = mix(c, vec3(1.12, .58, .24) * (.25 + .75 * smoothstep(-.2, .06, uSun.z)), g * (.34 * s + .58 * s * s * s));
  }
  return c;
}
vec3 albumAir(vec3 col, vec3 wpos) { return mix(col, albumHorizon(normalize(wpos - cameraPosition)), albumHaze(wpos)); }
// ---- clouds (layers/clouds.js draws them; their shadows are laid over the finished picture by post.js — not in
// albumAir(): the noise below is what would push the ground shader off its cliff)
// the cloud field over a point of the world, 0 clear sky .. 1 thick cloud: soft, without the small curls
float albumCloudField(vec3 wpos) {
  vec3 P = wpos + vec3(0., RKM, 0.); vec2 q = P.xz / max(P.y, 1.) * RKM + uCloud.yz;   // km on the plane touching the middle of the map
  float n = vnoise(q / 310.) * .46 + vnoise(q / 118. + 7.3) * .32 + vnoise(q / 47. + 3.1) * .22, thr = mix(.80, .30, uCloud.x);
  return smoothstep(thr - .05, thr + .14, n);
}
// how much sunlight the clouds leave at a point of the ground: 1 open .. about .5 under a thick cloud
float albumCloudShade(vec3 wpos) {
  if (uCloud.x <= 0.) return 1.;
  vec3 up = normalize(wpos + vec3(0., RKM, 0.));
  float rise = max(uCloud.w - (length(wpos + vec3(0., RKM, 0.)) - RKM), 0.);
  vec3 L = uSun.z > -.03 ? uSunW : normalize(up + vec3(.3, 0., .2));                   // by night the shade lies under the cloud
  float sh = albumCloudField(wpos + L * rise / max(dot(L, up), .22));
  return 1. - sh * mix(.22, .5, albumDay());
}
// exposure, tone curve, saturation, display gamma: the last step of every pixel
vec3 albumFinish(vec3 col) {
  col *= uExposure;
  if (uStyle != 3 && uStyle != 2) col = (col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14);
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  return pow(clamp(col, 0., 1.), vec3(1. / 2.2));
}
`;
// The uniforms of LIGHT, to spread into a material: ...lightUniforms(album.terrain.u). The Sun as a direction of the
// world, the Moon and the clouds come from the part «Небо» (aspects/sky.js) through the uniforms of the ground.
const NONE = { uSunW: { value: new Vector3(0, 1, 0) }, uMoon: { value: new Vector4(0, 0, 1, 0) }, uCloud: { value: new Vector4(0, 0, 0, 9) } };
export const lightUniforms = T => ({ uSun: T.uSun, uHaze: T.uHaze, uExposure: T.uExposure, uSat: T.uSat, uWarm: T.uWarm, uStyle: T.uStyle,
  uSunW: T.uSunW || NONE.uSunW, uMoon: T.uMoon || NONE.uMoon, uCloud: T.uCloud || NONE.uCloud });

// Sun direction as (east, north, up). hour 0 = the cartographer's light from the north-west, the light every picture
// of the album was taken with. Any other hour is the real Sun of that hour of the local solar time, on the given day
// of the year (172 = 21 June) at the given latitude (sky/astro.js).
export function sunAt(hour, yday = 172, lat = 40) {
  if (!hour) return new Vector3(-.5, .45, .74).normalize();
  return new Vector3(...sunDir(hour, yday, lat));
}
