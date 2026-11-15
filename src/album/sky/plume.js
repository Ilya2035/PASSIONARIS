// Plumes (docs/album/sky.md, «Извержение и песчаная буря»): the ash of an erupting volcano and the dust of a sand
// storm. A plume starts at a place, is carried by the wind of the weather and widens as it goes: a long fan, torn at
// its edges, with billows that travel along it. From space it is a streak hundreds of km long; it darkens the land
// under it, and what falls out of it lies on the land — grey ash, pale dust.
//
// Like the weather, nothing of it is counted in the shaders of the land. Three things draw it:
//   the shell    a half of a sphere at the height of the plume, facing the eye, drawn over the finished picture
//                (layers/plumes.js) — the plume seen from above and from afar
//   the pass     the finishing pass (post.js) lays its shadow and what has fallen out of it on the ground, and, for
//                dust, the haze of the storm between the eye and the land
//   the column   over a volcano, puffs of smoke that rise from the crater and bend downwind (layers/plumes.js) —
//                the eruption seen from near
// The picture of its billows is the picture of the clouds (sky/weather.js, tCloud).
import { Vector3, Vector4 } from 'three';
import { R, toWorld, frame, distKm } from '../geo.js';
import { WIND } from './weather.js';

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The two kinds. reach: how long the plume grows, km; half: its half-width at the source, km; spread: how much wider
// it gets with every km of the way (the tangent of half its fan); top: the height it travels at, km over the sea
// (real km: the map stretches them like its relief); speed: how fast its billows travel, km a second of the map's
// time; grow: in how many seconds it reaches two thirds of its length; fall: how much of it lies on the ground
// under it (ash) or hangs in the air down to the ground (dust).
// billow: how much its billows thin it and thicken it (ash is all billows, dust an even veil).
export const KINDS = {
  ash: { id: 1, billow: 1, reach: 1500, half: 5, spread: .16, top: 13, speed: 1.4, grow: 45, colour: [.20, .185, .18], pale: [.44, .42, .41], ground: [.36, .35, .35] },
  dust: { id: 2, billow: .3, reach: 900, half: 70, spread: .34, top: 3.2, speed: 1.1, grow: 30, colour: [.60, .45, .26], pale: [.70, .57, .38], ground: [.74, .60, .40] },
};
// how long the plume is t seconds after it began
export const plumeReach = (kind, t) => KINDS[kind].reach * (1 - Math.exp(-Math.max(t, 0) / KINDS[kind].grow));
// the plume over a place: its density 0..1 without the billows, and how far along it the place is (0 at the source ..
// 1 at its end); u: km downwind of the source, v: km across the wind, reach: its length now (the shaders: plumeAt)
export function plumeShape(kind, u, v, reach) {
  const k = KINDS[kind]; if (reach <= 0 || u < -2 * k.half || u > reach) return { density: 0, along: 0 };
  const w = k.half + k.spread * Math.max(u, 0), along = u / reach;
  return { density: (1 - ss(.55, 1.15, Math.abs(v) / w)) * ss(-k.half, k.half * .5, u) * (1 - ss(.72, 1, along)) * (1 - .65 * Math.max(along, 0)), along: Math.max(0, along) };
}
// the nearest volcano of the list to a place: rows of public/assets/hazards/volcanoes.json ({ fields, rows })
export function nearestVolcano(list, lat, lon) {
  const f = list.fields, ia = f.indexOf('lat'), io = f.indexOf('lon'), ie = f.indexOf('elev'), inm = f.indexOf('name'); let best = null, bd = Infinity;
  for (const r of list.rows) { if (r[ie] < 0) continue; const d = distKm({ lat, lon }, { lat: r[ia], lon: r[io] }); if (d < bd) { bd = d; best = r; } }
  return best && { name: best[inm], lat: best[ia], lon: best[io], elev: best[ie], km: bd };
}
// the frame of a plume that starts at a place: the source, the way the wind carries it and the way across, as unit
// directions of the world (from the centre of the Earth for the source)
export function plumeFrame(lat, lon) {
  const f = frame(lat, lon), o = toWorld(lat, lon, 0).add(new Vector3(0, R, 0)).normalize();
  // WIND is (east, south) of one km of the way
  const w = new Vector3().addScaledVector(f.east, WIND[0]).addScaledVector(f.north, -WIND[1]).normalize();
  return { o, w, c: new Vector3().crossVectors(o, w).normalize() };
}

// uPlO, uPlW, uPlC: the frame of the plume. uPl: x how long it is now (km; 0 = no plume), y its half-width at the
// source, z its spread, w the time of its billows (km they have travelled). uPlK: x the kind (1 ash, 2 dust), y its
// height (km of the world over the sea), z how much its billows thin and thicken it.
export const PLUME = { uPlO: { value: new Vector3(0, 1, 0) }, uPlW: { value: new Vector3(1, 0, 0) }, uPlC: { value: new Vector3(0, 0, 1) }, uPl: { value: new Vector4(0, 5, .2, 0) }, uPlK: { value: new Vector4(1, 20, 1, 0) } };
// pasted after WEATHER (it reads tCloud)
export const PLUME_GLSL = /* glsl */`
uniform vec3 uPlO, uPlW, uPlC; uniform vec4 uPl, uPlK;
// The plume over a point of the world (P: from the centre of the Earth). x: how thick it is there, 0..1; y: how far
// along the plume the point is, 0 at the source .. 1 at its end; z: its billows there, around .5 (for its light).
// (the picture read smoothly: the light of the billows is counted from their slope, and a plain read would show
// every point of the picture as a flat patch — see layers/clouds.js)
float plumeTex(vec2 uv) { uv = uv * 1024. + .5; vec2 i = floor(uv), f = uv - i; return textureLod(tCloud, (i + f * f * (3. - 2. * f) - .5) / 1024., 0.).r; }
vec3 plumeAt(vec3 P) {
  vec3 e = normalize(P); if (uPl.x <= 0. || dot(e, uPlO) < .93) return vec3(0.);
  vec3 d = e - uPlO; float u = dot(d, uPlW) * RKM, v = dot(d, uPlC) * RKM;
  if (u < -2. * uPl.y || u > uPl.x) return vec3(0.);
  float w = uPl.y + uPl.z * max(u, 0.), k = max(u, 0.) / uPl.x;
  // the billows: the picture of the clouds at two sizes, travelling down the plume; they tear its edge and its end
  vec2 q = vec2(u - uPl.w, v);
  float n = plumeTex(q / 760. + .13) + (plumeTex(q / 170. + .57) - .5) * .5;
  float side = 1. - smoothstep(.55, 1.15, abs(v) / w + (n - .5) * 1.2);
  float along = smoothstep(-uPl.y, uPl.y * .5, u) * (1. - smoothstep(.72, 1., k + (n - .5) * .3));
  return vec3(clamp(side * along * (1. - .65 * k) * mix(.85, .5 + 1.4 * (n - .15), uPlK.z), 0., 1.), k, n);
}
`;
