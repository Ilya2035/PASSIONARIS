// The light of the album: one sun, sky, air and finish for the ground and for everything that stands on it, and where
// the sun is at a given hour. Owner: the part «Небо и свет» (docs/ALBUM-CHUNKS.md). The GLSL here is pasted after
// COMMON of glsl.js (it uses RKM and cameraPosition); glsl.js and params.js re-export these names.
import { Vector3 } from 'three';

// ---- one light for everything: the ground and anything that stands on it use the same sun, sky, air and finish
export const LIGHT = /* glsl */`
uniform vec3 uSun; uniform float uHaze, uExposure, uSat, uWarm; uniform int uStyle;
float albumDay() { return smoothstep(-.08, .12, uSun.z); }
vec3 albumSunCol() {
  vec3 c = mix(vec3(1.25, .62, .30), vec3(1.22, 1.15, 1.02), smoothstep(.05, .45, uSun.z)) * albumDay();
  return mix(c, c * vec3(1.06, 1., .9), uWarm);
}
vec3 albumSkyCol() { return mix(vec3(.26, .33, .52), vec3(.46, .58, .78), albumDay()) * .62; }   // night keeps a moonlit blue
// a thing on the land: its colour as seen on screen, its normal (east, north, up), how open it is to the sky (0..1.5)
vec3 albumLit(vec3 seen, vec3 n, float open) {
  return pow(seen, vec3(2.2)) * (albumSunCol() * max(dot(normalize(n), uSun), 0.) * 1.25 + albumSkyCol() * open);
}
// the air between the eye and a point of the world: how much of it there is (0..1), its colour, and both applied
float albumHaze(vec3 wpos) {
  vec3 up = normalize(wpos + vec3(0., RKM, 0.)), Vw = normalize(cameraPosition - wpos);
  float dist = length(cameraPosition - wpos), camAlt = length(cameraPosition + vec3(0., RKM, 0.)) - RKM;
  return 1. - exp(-(uHaze * dist / (camAlt * 2.2 + 25.) + .012 / max(dot(Vw, up), .03)));
}
vec3 albumHazeCol() {
  if (uStyle == 6) return vec3(.05, .07, .11);
  if (uStyle == 3) return vec3(.84, .86, .86);
  return mix(vec3(.55, .70, .92), vec3(1., .78, .55), (1. - smoothstep(.05, .5, uSun.z)) * .6) * (.12 + .88 * albumDay());
}
vec3 albumAir(vec3 col, vec3 wpos) { return mix(col, albumHazeCol(), albumHaze(wpos)); }
// exposure, tone curve, saturation, display gamma: the last step of every pixel
vec3 albumFinish(vec3 col) {
  col *= uExposure;
  if (uStyle != 3 && uStyle != 2) col = (col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14);
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  return pow(clamp(col, 0., 1.), vec3(1. / 2.2));
}
`;
// the uniforms of LIGHT, to spread into a material: ...lightUniforms(album.terrain.u)
export const lightUniforms = T => ({ uSun: T.uSun, uHaze: T.uHaze, uExposure: T.uExposure, uSat: T.uSat, uWarm: T.uWarm, uStyle: T.uStyle });

// sun direction as (east, north, up). hour 0 = the cartographer's light from the north-west.
export function sunAt(hour) {
  if (!hour) return new Vector3(-.5, .45, .74).normalize();
  const a = (hour - 12) * 15 * Math.PI / 180, el = Math.max(-.2, Math.sin((hour - 6) / 12 * Math.PI)) * 62 * Math.PI / 180;
  return new Vector3(-Math.sin(a) * Math.cos(el), -Math.cos(a) * Math.cos(el) * .85, Math.sin(el)).normalize();
}
