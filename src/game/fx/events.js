// Light map effects for natural events: eruptions, earthquakes, tsunamis, meteorites, landslides, wildfires,
// floods and weather spells (heat, cold, drought, storms).
//
// Two draw calls in total:
//   - decals: an instanced 10x10 grid per effect, draped over the relief through the same unroll morph as the
//     terrain, with the pattern drawn in the fragment shader (rings, glow, ash fall, fire front, ...);
//   - particles: points that rise and drift (ash plumes, smoke, the meteor trail).
// Effects run in "effect seconds" that advance only while the game runs, and every effect has a minimum on-screen
// life, so a two-week eruption does not vanish in half a second at high speed — events are stretched in time.
// Sizes are physical (km) but never smaller than a fraction of the view, so an event is noticeable from orbit.
import * as THREE from 'three';
import { COMMON } from '../shaders.js';

const MAX_DECALS = 96;
const MAX_PARTS = 2048;
const GRID = 10;
const KM = 1 / 6371;

export const FX_KINDS = Object.freeze({
  eruption: 0, earthquake: 1, tsunami: 2, meteorite: 3, landslide: 4, wildfire: 5, flood: 6,
  heatwave: 7, coldwave: 8, drought: 9, storm: 10, snowstorm: 11,
});

// surface point of (lat, lon) after the unroll morph; shared by both shaders
const PLACE = /* glsl */ `
vec3 geoOf(float latD, float lonD) {
  float lat = radians(latD), lon = radians(lonD);
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}
vec3 placeOnMap(vec3 g, float lift, out vec3 up) {
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  float h = heightAt(geoToUV(g), 0.0, 0.0);
  return morphPos(s, T, max(h, 0.0) * uExag + lift, up);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const DECAL_VERT = /* glsl */ `
${COMMON}
${PLACE}
in vec4 aGeo;   // lat, lon, radius (rad), kind
in vec4 aTime;  // birth, life, seed, strength
uniform float uNow, uMinR, uAlt, uLift;
out vec2 vQ;
out vec3 vG;
out float vAge, vKind, vSeed, vStr, vFace;
void main() {
  float age = (uNow - aTime.x) / max(aTime.y, 1e-3);
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec3 g0 = geoOf(aGeo.x, aGeo.y);
  float lon = radians(aGeo.y);
  vec3 e = normalize(vec3(cos(lon), 0.0, -sin(lon)));
  vec3 n = cross(g0, e);
  float R = max(aGeo.z, uMinR * uAlt * (0.6 + 0.4 * aTime.w));
  vec2 q = position.xy;
  float ql = length(q);
  vec3 g = ql > 1e-6 ? normalize(g0 * cos(ql * R) + (e * q.x + n * q.y) / ql * sin(ql * R)) : g0;
  vec3 up;
  vec3 p = placeOnMap(g, uLift, up);
  vQ = q; vG = g; vAge = age; vKind = aGeo.w; vSeed = aTime.z; vStr = aTime.w;
  vFace = dot(up, normalize(cameraPosition - p));   // < 0 behind the horizon (no depth test: decals drape over chords)
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const DECAL_FRAG = /* glsl */ `
${COMMON}
${PLACE}
uniform float uNow, uDot;
in vec2 vQ;
in vec3 vG;
in float vAge, vKind, vSeed, vStr, vFace;
layout(location = 0) out vec4 fragColor;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.3 + 7.1) + 0.15 * vnoise(p * 5.1 + 3.7); }
float ring(float r, float at, float w) { float d = (r - at) / w; return exp(-d * d); }

void main() {
  int kind = int(vKind + 0.5);
  float r = length(vQ);
  float age = vAge;
  float env = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.78, 1.0, age));
  float edge = 1.0 - smoothstep(0.9, 1.0, r);
  vec2 sp = vQ * 3.0 + vSeed * 17.0;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float flick = 0.8 + 0.2 * sin(uNow * 13.0 + vSeed * 40.0) * sin(uNow * 7.3 + vSeed * 11.0);

  if (kind == 0) {                       // eruption: glowing vent, lava tongues, ash fall drifting east
    float core = exp(-r * r * 45.0) * flick;
    float halo = exp(-r * r * 9.0) * 0.5 * (1.0 - smoothstep(0.3, 0.8, age)) * (0.75 + 0.25 * sin(uNow * 3.0 + vSeed * 9.0));
    float lava = smoothstep(0.5, 0.72, fbm(vQ * 7.0 + vSeed * 9.0)) * (1.0 - smoothstep(0.12, 0.32, r));
    float grow = 0.35 + 0.6 * smoothstep(0.0, 0.7, age);
    vec2 c = (vQ - vec2(0.38 * grow, 0.04)) / vec2(grow, 0.45 * grow);
    float ash = (1.0 - smoothstep(0.45, 1.0, length(c))) * (0.55 + 0.45 * fbm(sp + uNow * 0.15));
    ash *= 0.5 * (0.4 + 0.6 * vStr) * (1.0 - smoothstep(0.55, 1.0, age));
    col = mix(vec3(0.29, 0.27, 0.25), vec3(1.0, 0.42, 0.14), clamp(lava + core, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.86, 0.5), core * 0.8);
    col = mix(col, vec3(1.0, 0.5, 0.2), halo * (1.0 - ash) * step(core + lava, 0.05));
    a = max(max(ash, halo), max(lava * 0.85 * flick, core));
  } else if (kind == 1) {                // earthquake: three ink-red rings and an epicentre mark
    float rr = 0.0;
    for (int k = 0; k < 3; k++) {
      float at = clamp(age * 1.35 - float(k) * 0.17, 0.0, 1.0);
      rr += ring(r, at * 0.95, 0.025 + 0.02 * at) * (1.0 - at) * step(0.001, at);
    }
    float star = exp(-r * r * 260.0) + 0.6 * exp(-pow(abs(vQ.x) * 60.0, 2.0)) * step(r, 0.09) + 0.6 * exp(-pow(abs(vQ.y) * 60.0, 2.0)) * step(r, 0.09);
    col = vec3(0.48, 0.16, 0.11);
    a = clamp(rr * 0.85 + star * 0.9 * (1.0 - age), 0.0, 1.0);
  } else if (kind == 2) {                // tsunami: white-teal front racing over the sea only
    float h = heightAt(geoToUV(normalize(vG)), 0.0, 0.0);
    if (h > 1.0) discard;
    float at = smoothstep(0.0, 1.0, age);
    float front = ring(r, at * 0.96, 0.03);
    float wake = (1.0 - smoothstep(0.0, at * 0.96, r)) * 0.18 * (0.6 + 0.4 * fbm(sp * 2.0 - uNow));
    col = mix(vec3(0.5, 0.72, 0.78), vec3(0.95, 0.99, 1.0), front);
    a = (front * 0.9 + wake * step(r, at)) * (1.0 - 0.6 * at);
  } else if (kind == 3) {                // meteorite: flash, shock ring, scorch mark
    float flash = exp(-r * r * 30.0) * pow(1.0 - smoothstep(0.08, 0.45, age), 2.0) * step(0.12, age);
    float shock = ring(r, smoothstep(0.12, 0.6, age) * 0.9, 0.04) * (1.0 - smoothstep(0.3, 0.7, age)) * step(0.12, age);
    float scorch = exp(-r * r * 160.0) * smoothstep(0.15, 0.3, age);
    col = mix(vec3(0.22, 0.16, 0.13), vec3(1.0, 0.95, 0.82), clamp(flash * 2.0 + shock, 0.0, 1.0));
    a = clamp(flash * 1.4 + shock * 0.7 + scorch * 0.7, 0.0, 1.0);
  } else if (kind == 4) {                // landslide: brown smear down-slope
    vec2 c = vQ / vec2(0.35, 0.7);
    a = (1.0 - smoothstep(0.4, 1.0, length(c))) * smoothstep(0.4, 0.7, fbm(sp * 2.0)) * 0.8;
    col = vec3(0.5, 0.38, 0.26);
  } else if (kind == 5) {                // wildfire: flickering front, charred land inside
    float n = fbm(sp * 1.6 + vec2(0.0, uNow * 0.4));
    float front = 0.28 + 0.62 * smoothstep(0.0, 0.85, age) + (n - 0.5) * 0.25;
    float band = smoothstep(front - 0.16, front - 0.02, r) * (1.0 - smoothstep(front - 0.02, front + 0.03, r));
    float burnt = (1.0 - smoothstep(front - 0.1, front, r)) * (0.45 + 0.4 * n);
    vec3 fire = mix(vec3(0.85, 0.16, 0.05), vec3(1.0, 0.78, 0.3), n * flick);
    col = mix(vec3(0.17, 0.14, 0.12), fire, clamp(band * 1.5, 0.0, 1.0));
    a = max(band * flick * (1.0 - smoothstep(0.7, 1.0, age)), burnt * 0.55);
  } else if (kind == 6) {                // flood: blue wash over low land
    float h = heightAt(geoToUV(normalize(vG)), 0.0, 0.0);
    if (h < 0.0) discard;
    a = (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.35, 0.6, fbm(sp * 1.2)) * 0.6 * (1.0 - smoothstep(150.0, 600.0, h));
    col = vec3(0.3, 0.52, 0.66);
  } else if (kind <= 9) {                // heat / cold / drought spell: a soft breathing haze
    vec3 hc = kind == 7 ? vec3(0.9, 0.5, 0.2) : kind == 8 ? vec3(0.55, 0.72, 0.9) : vec3(0.78, 0.6, 0.32);
    float n = fbm(sp * 0.8 + uNow * 0.05);
    a = (1.0 - smoothstep(0.25, 1.0, r)) * (0.26 + 0.14 * n) * (0.6 + 0.4 * vStr) + ring(r, 0.8, 0.07) * 0.22;
    col = hc;
  } else {                               // storm / snowstorm: spiral cloud band
    float ang = atan(vQ.y, vQ.x);
    float sw = sin(ang * 2.0 + r * 11.0 - uNow * 1.4 + vSeed * 6.0);
    float n = fbm(sp * 1.5 + uNow * 0.2);
    a = smoothstep(0.1, 0.9, sw * 0.5 + 0.5) * (1.0 - smoothstep(0.2, 1.0, r)) * (0.35 + 0.35 * n) + exp(-r * r * 40.0) * 0.1;
    col = kind == 11 ? vec3(0.97, 0.98, 1.0) : vec3(0.93, 0.93, 0.9);
  }

  a *= env * edge * smoothstep(0.0, 0.06, vFace);
  if (a < 0.01) discard;
  // stipple: the edge of every effect breaks into ink dots, like the rest of the map
  float dots = hash12(floor(gl_FragCoord.xy / uDot) + floor(vSeed * 97.0));
  a *= mix(1.0, step(dots, a * 1.6), 0.5);
  fragColor = vec4(col, a);
}
`;

const PART_VERT = /* glsl */ `
${COMMON}
${PLACE}
in vec4 aGeo;   // lat, lon, kind, seed
in vec4 aTime;  // birth, life, path 0..1, physical size (rad)
uniform float uNow, uAlt, uPx, uMinR, uLift;
out float vA, vKind, vU;
void main() {
  float age = (uNow - aTime.x) / max(aTime.y, 1e-3);
  vU = 0.0;
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
  int kind = int(aGeo.z + 0.5);
  vec3 g = geoOf(aGeo.x, aGeo.y);
  float lon = radians(aGeo.y);
  vec3 e = normalize(vec3(cos(lon), 0.0, -sin(lon)));
  vec3 n = cross(g, e);
  float sd = aGeo.w;
  vec3 up;
  vec3 p = placeOnMap(g, uLift, up);
  float L = max(aTime.w, uMinR * uAlt);           // plume height / trail length, never too small to see
  float size = L * 0.18;
  float a = 1.0;
  if (kind == 3) {                                  // meteor trail: born along a slanted path, fades fast
    float u = aTime.z;
    p += (up * 1.0 + e * 0.7 + n * 0.25) * u * L * 3.6;
    size = L * (0.1 + 0.16 * (1.0 - u)) * (1.0 - age * 0.6);
    a = (1.0 - age) * (1.0 - age);
    vU = u;
  } else {                                          // ash / smoke puff: rises, then drifts downwind in a widening plume
    float big = kind == 0 ? 1.0 : 0.6;
    float rise = big * 0.5 * L * sqrt(age);
    float ang = (fract(sd * 13.7) - 0.5) * 0.9 + sin(aGeo.x * 3.1 + aGeo.y) * 0.5;   // wind direction ± spread
    vec3 wind = e * cos(ang) + n * sin(ang);
    float drift = (0.08 + 2.2 * age) * L * big * (0.7 + 0.6 * fract(sd * 71.3));
    p += up * rise + wind * drift;
    size = L * big * (0.22 + 0.85 * age);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age));
    vU = age;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(size * uPx / max(-mv.z, 1e-4), 1.5, 90.0);
  vA = a * smoothstep(-0.02, 0.08, dot(up, normalize(cameraPosition - p)));
  vKind = float(kind);
  gl_Position = projectionMatrix * mv;
}
`;

const PART_FRAG = /* glsl */ `
precision highp float;
uniform float uDot;
in float vA, vKind, vU;
layout(location = 0) out vec4 fragColor;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  int kind = int(vKind + 0.5);
  vec3 col;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA;
  if (kind == 3) {
    col = mix(vec3(1.0, 0.97, 0.86), vec3(1.0, 0.62, 0.25), vU);
    a *= 1.2;
  } else if (kind == 0) {
    col = mix(vec3(0.33, 0.3, 0.28), vec3(0.62, 0.58, 0.54), vU);   // ash: dark at the vent, paler aloft
    a *= 0.6;
  } else {
    col = mix(vec3(0.42, 0.38, 0.35), vec3(0.7, 0.68, 0.65), vU);   // smoke
    a *= 0.3;
  }
  float dots = hash12(floor(gl_FragCoord.xy / uDot));
  a *= mix(1.0, step(dots, a * 1.7), 0.45);
  if (a < 0.01) discard;
  fragColor = vec4(col, min(a, 1.0));
}
`;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class EventFx {
  constructor(scene, globe) {
    this.globe = globe;
    this.now = 0;
    this.lastT = null;
    this.visible = true;
    this.rand = mulberry(20260611);
    this.heightPx = 900;
    this.fov = 34;

    // ---- decals
    const grid = new THREE.PlaneGeometry(2, 2, GRID, GRID);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = grid.index;
    geo.setAttribute('position', grid.getAttribute('position'));
    this.dGeo = new Float32Array(MAX_DECALS * 4);
    this.dTime = new Float32Array(MAX_DECALS * 4);
    this.dGeoAttr = new THREE.InstancedBufferAttribute(this.dGeo, 4);
    this.dTimeAttr = new THREE.InstancedBufferAttribute(this.dTime, 4);
    this.dGeoAttr.setUsage(THREE.DynamicDrawUsage);
    this.dTimeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGeo', this.dGeoAttr);
    geo.setAttribute('aTime', this.dTimeAttr);
    geo.instanceCount = 0;
    this.decalGeo = geo;
    this.decalEnd = new Float32Array(MAX_DECALS);     // effect-time when each slot frees up
    this.decalMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: { ...globe.shared, uNow: { value: 0 }, uMinR: { value: 0.022 }, uAlt: { value: 1 }, uLift: { value: 0 }, uDot: { value: 2 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.decals = new THREE.Mesh(geo, this.decalMat);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 3;
    this.decals.visible = false;
    scene.add(this.decals);

    // ---- particles
    this.pGeo = new Float32Array(MAX_PARTS * 4);
    this.pTime = new Float32Array(MAX_PARTS * 4);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTS * 3), 3));
    this.pGeoAttr = new THREE.BufferAttribute(this.pGeo, 4).setUsage(THREE.DynamicDrawUsage);
    this.pTimeAttr = new THREE.BufferAttribute(this.pTime, 4).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aGeo', this.pGeoAttr);
    pg.setAttribute('aTime', this.pTimeAttr);
    pg.setDrawRange(0, 0);
    this.partGeo = pg;
    this.partNext = 0;
    this.partUsed = 0;
    this.partEnd = 0;
    this.partMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      uniforms: { ...globe.shared, uNow: { value: 0 }, uAlt: { value: 1 }, uPx: { value: 900 }, uMinR: { value: 0.03 }, uLift: { value: 0 }, uDot: { value: 2 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.parts = new THREE.Points(pg, this.partMat);
    this.parts.frustumCulled = false;
    this.parts.renderOrder = 4;
    this.parts.visible = false;
    scene.add(this.parts);
  }

  get active() { return this.decals.visible || this.parts.visible; }

  // ev: {type, lat, lon, level 1..5, vei 0..8, severity 1..5, magnitude}
  spawn(ev) {
    const kind = FX_KINDS[ev.type];
    if (kind === undefined || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) return false;
    const lvl = Math.max(1, Math.min(5, ev.level ?? ev.severity ?? 2));
    const vei = Math.max(0, Math.min(8, ev.vei ?? lvl));
    let rKm, life, str;
    switch (ev.type) {
      case 'eruption': rKm = 18 + vei * 26; life = 7 + vei * 2.2; str = vei / 7; break;
      case 'earthquake': rKm = [0, 25, 60, 140, 320, 650][lvl]; life = 3.5 + lvl * 0.9; str = lvl / 5; break;
      case 'tsunami': rKm = 350 + lvl * 450; life = 9 + lvl; str = lvl / 5; break;
      case 'meteorite': rKm = 10 + lvl * 8; life = 4.5; str = lvl / 5; break;
      case 'landslide': rKm = 6 + lvl * 4; life = 4; str = lvl / 5; break;
      case 'wildfire': rKm = 18 + lvl * 26; life = 8 + lvl * 1.6; str = lvl / 5; break;
      case 'flood': rKm = 50 + lvl * 45; life = 8 + lvl; str = lvl / 5; break;
      case 'storm': case 'snowstorm': rKm = 220 + lvl * 90; life = 6 + lvl; str = lvl / 5; break;
      default: rKm = 380 + lvl * 90; life = 9 + lvl; str = lvl / 5; break; // heat / cold / drought
    }
    const seed = this.rand();
    // decal slot: a free one, else the one that ends soonest
    let slot = -1, soonest = Infinity;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this.decalEnd[i] <= this.now) { slot = i; break; }
      if (this.decalEnd[i] < soonest) { soonest = this.decalEnd[i]; slot = i; }
    }
    this.dGeo.set([ev.lat, ev.lon, rKm * KM, kind], slot * 4);
    this.dTime.set([this.now, life, seed, str], slot * 4);
    this.decalEnd[slot] = this.now + life;
    this.dGeoAttr.needsUpdate = true;
    this.dTimeAttr.needsUpdate = true;
    this.decalGeo.instanceCount = Math.max(this.decalGeo.instanceCount, slot + 1);

    if (ev.type === 'eruption') this.#puffs(ev, 0, 40 + vei * 20, life * 0.85, (6 + vei * 8) * KM, 3.2);
    else if (ev.type === 'wildfire') this.#puffs(ev, 5, 20 + lvl * 8, life * 0.8, (3 + lvl * 2) * KM, 2.6);
    else if (ev.type === 'meteorite') {
      const n = 26;
      for (let i = 0; i < n; i++) {
        const u = 1 - i / (n - 1);                  // from high up down to the ground
        this.#part(ev.lat, ev.lon, 3, this.rand(), this.now + (i / (n - 1)) * 0.55, 0.7, u, (25 + lvl * 10) * KM);
      }
    }
    this.decals.visible = this.visible;
    return true;
  }

  #puffs(ev, kind, n, span, sizeRad, lifeSec) {
    for (let i = 0; i < n; i++) {
      this.#part(ev.lat, ev.lon, kind, this.rand(), this.now + (i / n) * span, lifeSec * (0.8 + 0.4 * this.rand()), 0, sizeRad);
    }
  }

  #part(lat, lon, kind, seed, birth, life, path, size) {
    const i = this.partNext;
    this.partNext = (i + 1) % MAX_PARTS;
    this.partUsed = Math.max(this.partUsed, i + 1);
    this.pGeo.set([lat, lon, kind, seed], i * 4);
    this.pTime.set([birth, life, path, size], i * 4);
    this.partEnd = Math.max(this.partEnd, birth + life);
    this.pGeoAttr.needsUpdate = true;
    this.pTimeAttr.needsUpdate = true;
    this.partGeo.setDrawRange(0, this.partUsed);
    this.parts.visible = this.visible;
  }

  // timeSec: wall-clock seconds; opts.running: false freezes the effects (game paused); opts.heightPx: render height in pixels; opts.fov: vertical field of view, degrees
  update(gcam, timeSec, opts = {}) {
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, timeSec - this.lastT));
    this.lastT = timeSec;
    if (opts.running !== false) this.now += dt;
    if (opts.heightPx) this.heightPx = opts.heightPx;
    const alt = gcam.alt;
    const lift = alt * 0.0012;
    for (const u of [this.decalMat.uniforms, this.partMat.uniforms]) {
      u.uNow.value = this.now;
      u.uAlt.value = Math.min(alt, 3);
      u.uLift.value = lift;
      u.uDot.value = Math.max(1.5, this.heightPx / 640);
    }
    if (opts.fov) this.fov = opts.fov;
    this.partMat.uniforms.uPx.value = this.heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(this.fov / 2)));
    if (this.decals.visible) {
      let last = -1;
      for (let i = 0; i < MAX_DECALS; i++) if (this.decalEnd[i] > this.now) last = i;
      this.decalGeo.instanceCount = last + 1;
      if (last < 0) this.decals.visible = false;
    }
    if (this.parts.visible && this.now > this.partEnd) {
      this.parts.visible = false;
      this.partUsed = 0;
      this.partNext = 0;
      this.partGeo.setDrawRange(0, 0);
    }
  }

  clear() {
    this.decalEnd.fill(0);
    this.decalGeo.instanceCount = 0;
    this.decals.visible = false;
    this.partEnd = 0; this.partUsed = 0; this.partNext = 0;
    this.partGeo.setDrawRange(0, 0);
    this.parts.visible = false;
  }

  setVisible(v) {
    this.visible = !!v;
    if (!v) { this.decals.visible = false; this.parts.visible = false; }
    else {
      this.decals.visible = this.decalEnd.some(e => e > this.now);
      this.parts.visible = this.now < this.partEnd;
    }
  }

  dispose() {
    this.decals.removeFromParent();
    this.parts.removeFromParent();
    this.decalGeo.dispose();
    this.partGeo.dispose();
    this.decalMat.dispose();
    this.partMat.dispose();
  }
}
