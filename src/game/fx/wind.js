// Prevailing winds: thin streaks that run with the global circulation — easterly trade winds (with their drift
// toward the equator), the westerlies of the mid-latitudes (stronger in the Roaring Forties), polar easterlies.
// The bands follow the season: the ITCZ moves north in the northern summer and south in winter. Rossby-like
// meanders keep the westerlies from looking like rails.
//
// One draw call: every streak is a short line (head and tail) computed in the vertex shader from its seed and the
// time, so nothing is simulated on the CPU. Screen speed is tied to the zoom; streaks fade up close (the map stays
// clean) and live only in the landscape modes.
import * as THREE from 'three';
import { COMMON } from '../shaders.js';

const COUNT = 7000;

const VERT = /* glsl */ `
${COMMON}
in vec4 aSeed;     // lon0 (deg), lat0 (deg), phase 0..1, jitter 0..1
uniform float uTime, uRate, uAlt, uLift, uItcz, uTrail;
out float vA;

// zonal (u) and meridional (v) wind in m/s at latitude phi (degrees), bands shifted by the ITCZ
vec2 windAt(float phi) {
  float p = phi - uItcz * (1.0 - smoothstep(10.0, 45.0, abs(phi)));
  float ap = abs(p), s = sign(p);
  float u, v;
  if (ap < 30.0) { u = -6.5 * sin(3.14159 * ap / 30.0); v = -s * 2.2 * sin(3.14159 * ap / 30.0); }
  else if (ap < 60.0) { float k = sin(3.14159 * (ap - 30.0) / 30.0); u = (p < 0.0 ? 13.0 : 9.0) * k; v = s * 1.2 * k; }
  else { float k = sin(3.14159 * (ap - 60.0) / 30.0); u = -3.5 * k; v = -s * 0.8 * k; }
  return vec2(u, v);
}

vec3 geoOf(float latD, float lonD) {
  float lat = radians(latD), lon = radians(lonD);
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}

// position of a streak point at age a (seconds of its life)
vec2 posAt(float a) {
  float lat0 = aSeed.y;
  vec2 w = windAt(lat0);
  float sp = uRate * (0.75 + 0.5 * aSeed.w);
  float lat = lat0 + w.y * sp * a * 0.35;
  float lon = aSeed.x + w.x * sp * a / max(0.15, cos(radians(lat)));
  // meanders: stronger in the westerlies
  float mean = smoothstep(28.0, 45.0, abs(lat0)) * (1.0 - smoothstep(60.0, 75.0, abs(lat0)));
  lat += (0.6 + 2.2 * mean) * sin(radians(lon) * 4.0 + aSeed.z * 6.2831);
  return vec2(lon, clamp(lat, -84.0, 84.0));
}

void main() {
  const float LIFE = 7.0;
  float t = uTime + aSeed.z * LIFE;
  float age = mod(t, LIFE);
  float cycle = floor(t / LIFE);
  // every life starts somewhere new along the same band (no visible looping)
  float a = position.x > 0.5 ? age : max(0.0, age - uTrail);
  vec2 ll = posAt(a);
  ll.x += fract(sin(cycle * 12.9898 + aSeed.z * 78.233) * 43758.5453) * 360.0;
  vec3 g = geoOf(ll.y, ll.x);
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  float h = heightAt(geoToUV(g), 3.0, 4.0);
  vec3 up;
  vec3 p = morphPos(s, T, max(h, 0.0) * uExag + uLift, up);
  float life = sin(3.14159 * age / LIFE);
  float face = smoothstep(0.0, 0.15, dot(up, normalize(cameraPosition - p)));
  vA = life * face * (position.x > 0.5 ? 1.0 : 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uOpacity;
uniform vec3 uColor;
in float vA;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vA <= 0.003) discard;
  fragColor = vec4(uColor, vA * uOpacity);
}
`;

export class Winds {
  constructor(scene, globe) {
    const pos = new Float32Array(COUNT * 2 * 3);
    const seed = new Float32Array(COUNT * 2 * 4);
    let s = 1234567;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < COUNT; i++) {
      // uniform on the sphere (area-true), a little denser in the storm belts
      let lat = Math.asin(rnd() * 2 - 1) * 180 / Math.PI;
      if (rnd() < 0.25) lat = (rnd() < 0.5 ? -1 : 1) * (38 + rnd() * 20);
      const lon = rnd() * 360 - 180, ph = rnd(), j = rnd();
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = k;                       // 0 = tail, 1 = head
        seed.set([lon, lat, ph, j], (i * 2 + k) * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...globe.shared,
        uTime: { value: 0 }, uRate: { value: 1 }, uAlt: { value: 1 }, uLift: { value: 0 }, uItcz: { value: 0 }, uTrail: { value: 0.6 },
        uOpacity: { value: 0.3 }, uColor: { value: new THREE.Color(0.97, 0.97, 0.95) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    this.visible = true;
    this.mode = 'terrain';
    this.month = 1;
  }

  setVisible(v) { this.visible = !!v; }
  setMode(m) { this.mode = m; }
  // fractional month 1..12: the ITCZ sits ~7 deg north in July/August, ~5 deg south in January/February
  setMonth(m) { this.month = m; this.material.uniforms.uItcz.value = 1 + 6 * Math.cos(2 * Math.PI * (m - 7.6) / 12); }

  update(gcam, timeSec) {
    const alt = gcam.alt;
    const landscape = this.mode === 'terrain' || this.mode === 'relief';
    const show = this.visible && landscape && alt > 0.12;
    this.lines.visible = show;
    if (!show) return;
    const u = this.material.uniforms;
    u.uTime.value = timeSec;
    // degrees per second per m/s: about the same screen speed at every zoom
    u.uRate.value = 0.25 * Math.pow(Math.min(2.5, alt), 1.3);
    u.uTrail.value = 1.5;
    u.uAlt.value = alt;
    u.uLift.value = alt * 0.004;
    u.uOpacity.value = 0.45 * Math.min(1, (Math.log(alt) - Math.log(0.12)) / (Math.log(0.6) - Math.log(0.12)));
  }

  dispose() { this.lines.removeFromParent(); this.lines.geometry.dispose(); this.material.dispose(); }
}
