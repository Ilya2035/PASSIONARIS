// Day and night on the ball (docs/album/sky.md, «День и ночь на шаре»).
//
// The light of the album is one for the whole frame: the Sun of the place under the camera (light.js). Near the
// ground that is right — the Sun stands the same over everything in view. From a height it is not: from 3000 km the
// view holds places where the Sun is high and places where it has set, and from 20 000 km half a planet.
//
// The ground shader cannot count the Sun place by place (it has no room: see light.js). So it is done over the
// finished picture, the way the weather is:
//   1. The frame is drawn with a Sun that is day enough — the «frame Sun». Near the ground, and wherever the place
//      under the camera has day, that is the Sun of the place itself: by day nothing is changed, the picture from a
//      height is the picture from near. Where the place under the camera has evening or night and the view is wide
//      enough to hold day, the frame Sun is lifted as far as FRAME_DAY: the frame is not drawn dark when half of it
//      is lit.
//   2. Every pixel is then dimmed to the light of its own place: globeRelight() gives what the light there is as a
//      share of the frame's. The night side goes dark and blue, a band of low orange light lies along the edge of
//      the day. The finishing pass does it for the land and everything on it (post.js), the sky for the sea it draws
//      and for the air at the edge of the ball (dome.js), the shell of the clouds for itself (layers/clouds.js).
// With the light of the map (hour 0) there is no Sun in the sky and no night: the ball is lit evenly.
import { Vector4 } from 'three';
import { R } from '../geo.js';

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;

// From which height of the eye (km) the light is counted place by place. Below GLOBE_FROM nothing changes. Above
// it two things come in, at different speeds:
//   globeAmount   how far toward the edge of the view the frame Sun is looked for: slowly, in full from GLOBE_FULL
//   globeDim      how much of the dimming of every place is laid: quickly, in full from GLOBE_DIM
// The dimming must be whole wherever the frame Sun has left the Sun of the place: only together do they give each
// place its own light. Just above GLOBE_FROM the frame Sun has hardly moved, so the dimming comes in unseen.
export const GLOBE_FROM = 600, GLOBE_DIM = 900, GLOBE_FULL = 2500;
export const globeAmount = alt => ss(GLOBE_FROM, GLOBE_FULL, alt), globeDim = alt => ss(GLOBE_FROM, GLOBE_DIM, alt);
// How high the frame Sun stands (the sine of its height): z — the Sun of the place under the camera, alt — the
// height of the eye, km. The eye sees the ground as far as the horizon; the place in view nearest to the Sun is that
// much nearer to having it overhead. The frame Sun is lifted toward that place, but no higher than FRAME_DAY — the
// height from which the light is full day (white sunlight, blue sky). A Sun that already stands higher is left
// alone: then the frame is drawn exactly as near the ground, and nothing in it is dimmed that need not be.
// (Lifted all the way, as it was at first, every place was drawn brighter than it is and dimmed back; what the
// ground draws without regard to the Sun — the sea of the world — then came out lighter than the sea of the album:
// the polygon stood on the map as a rectangle by day. The leading session, 15.11.2026.)
export const FRAME_DAY = .5;
export function frameSunUp(z, alt, amount = globeAmount(alt)) {
  if (amount <= 0 || z >= FRAME_DAY) return z;
  const zen = Math.acos(Math.max(-1, Math.min(1, z))), reach = Math.acos(R / (R + Math.max(alt, 0))) * amount;
  return Math.max(z, Math.min(FRAME_DAY, Math.cos(Math.max(0, zen - reach))));
}
// a Sun (east, north, up) lifted to that height on its own bearing
export function raiseSun(sun, up) {
  const [x, y, z] = sun; if (!(up > z)) return [x, y, z];
  const h = Math.hypot(x, y), c = Math.sqrt(Math.max(0, 1 - up * up));
  return h > 1e-6 ? [x / h * c, y / h * c, up] : [0, c, up];
}
// The light that falls on level ground with the Sun at a height (z — its sine): sunlight, the light of the sky, and
// GLOW of the glow that the air has around a low Sun — as lightNumbers() of light.js counts them for the natural
// look (its A, B, and E by C.w). The glow gives the edge of the day its band of warm light. night: how light the
// night sky is (.5 the stars alone .. .84 a full Moon). The GLSL below is the same arithmetic.
// (It is the light of level ground exactly, with nothing added for slopes: so a place drawn with the Sun of the
// place needs no dimming at all by day, and land seen from a height is as bright as land seen from near.)
export const GLOW = .3;
export function levelLight(z, night = .5) {
  const day = ss(-.08, .12, z), high = ss(.05, .45, z), k = day * Math.max(z, 0) * 1.25;
  const g = (1 - ss(.04, .4, z)) * ss(-.26, -.01, z) * (.25 + .75 * ss(-.2, .06, z)) * GLOW;
  return [mix(1.25, 1.22, high) * k + mix(.26 * night, .46, day) * .62 + 1.10 * g, mix(.62, 1.15, high) * k + mix(.33 * night, .58, day) * .62 + .64 * g,
    mix(.30, 1.02, high) * k + mix(.52 * night, .78, day) * .62 + .34 * g];
}
// how much brighter than the frame a place may be made at the most (a place is never brighter than the frame Sun
// allows once the light is counted in full; in between, this keeps a dark frame from being stretched)
export const RELIGHT_MOST = 3;
// what the light of a place is as a share of the frame's (per colour), as the shaders count it
export function relight(zPlace, zFrame, amount, night = .5) {
  const a = levelLight(zPlace, night), b = levelLight(zFrame, night);
  return a.map((v, i) => mix(1, Math.min(v / b[i], RELIGHT_MOST), amount));
}

// The same for land the ground shader has already lit by the Sun of its own place: the land beyond the album's
// polygon (terrain.js — there the slopes and the shadows of the relief go by uSunW, and the night side has no
// sunlight). Only the colours of the light there are still the frame's: sunA — the colour of the frame's sunlight,
// skyB — of its sky (lightNumbers A and B). The share is what the light of the place is of what the ground drew.
export function relightOwn(zPlace, sunA, skyB, amount, night = .5) {
  // (what the ground drew on level land there: sunlight by the sine of the Sun's height — none under the horizon — and the light of the sky)
  const a = levelLight(zPlace, night), g = Math.max(zPlace, 0) * 1.25;
  return a.map((v, i) => mix(1, Math.min(v / (sunA[i] * g + skyB[i]), RELIGHT_MOST), amount));
}
// A pixel of the land is the land under a share f of air (light.js: albumAir). The air is drawn with the frame's
// light everywhere, whatever Sun the land under it took. So beyond the polygon the two parts of a pixel take
// different shares: the land k (relightOwn), the air kIn (relight). The pixel as drawn is land·(1 − f) + air·f;
// multiplied whole by k, it lacks air·f·(kIn − k) — airShare() is that, to be added.
// (Left out, the air beyond the polygon stayed two to three times lighter than inside it in the evening and at
// night, and from a height the air is as much of a pixel of dark land as the land itself.)
export const airShare = (air, f, k, kIn) => air.map((a, i) => a * f * (kIn[i] - k[i]));

// uGlobe: x how much of the dimming is laid (globeDim: 0 near the ground .. 1 from a height), y how light the night
//         sky is (levelLight's night).
export const GLOBE = { uGlobe: { value: new Vector4(0, .5, 0, 0) } };
// pasted after LIGHT (it uses uSun — the frame Sun — and uSunW, the real Sun as a direction of the world)
export const GLOBE_GLSL = /* glsl */`
uniform vec4 uGlobe;
vec3 globeLight(float z) {
  float day = smoothstep(-.08, .12, z), high = smoothstep(.05, .45, z);
  float glow = (1. - smoothstep(.04, .4, z)) * smoothstep(-.26, -.01, z) * (.25 + .75 * smoothstep(-.2, .06, z)) * ${GLOW.toFixed(2)};
  return vec3(mix(1.25, 1.22, high), mix(.62, 1.15, high), mix(.30, 1.02, high)) * (day * max(z, 0.) * 1.25)
    + mix(vec3(.26, .33, .52) * uGlobe.y, vec3(.46, .58, .78), day) * .62 + vec3(1.10, .64, .34) * glow;
}
// the light of a place as a share of the light the frame was drawn with; up: the unit vector from the centre of the
// Earth to the place. For colours before the finish (albumFinish); a finished colour goes through globeDimmed().
vec3 globeRelight(vec3 up) {
  if (uGlobe.x <= 0.) return vec3(1.);
  return mix(vec3(1.), min(globeLight(dot(up, uSunW)) / globeLight(uSun.z), ${RELIGHT_MOST.toFixed(1)}), uGlobe.x);
}
// the same for land the ground shader has lit by the Sun of its own place — beyond the album's polygon (relightOwn)
vec3 globeRelightOwn(vec3 up) {
  if (uGlobe.x <= 0.) return vec3(1.);
  float z = dot(up, uSunW), g = max(z, 0.) * 1.25;
  return mix(vec3(1.), min(globeLight(z) / (albumSunCol() * g + albumSkyCol()), ${RELIGHT_MOST.toFixed(1)}), uGlobe.x);
}
// A finished colour (what albumFinish gave: tone curve, then gamma) with its light multiplied by k: the finish is
// undone, the light dimmed, the colour finished again. Dimming the screen colour itself would leave the night far
// too light — the tone curve squeezes the dark end much harder than gamma alone.
// add: light to add after the multiplying, as a colour before the tone curve (the exposure counted in) — airShare.
vec3 globeDimmed(vec3 c, vec3 k, vec3 add) {
  vec3 t = min(pow(c, vec3(2.2)), .999), a = 2.51 - 2.43 * t, b = .03 - .59 * t;
  vec3 x = max((sqrt(b * b + .56 * a * t) - b) / (2. * a) * k + add, 0.);
  return pow(clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.), vec3(1. / 2.2));
}
vec3 globeDimmed(vec3 c, vec3 k) { return globeDimmed(c, k, vec3(0.)); }
`;
