// Ocean surface currents overlay: soft animated streaks flowing along each current,
// warm = muted rust/ochre, cold = muted steel blue (Victoria 3-like current map layer).
//
// Data: public/assets/ocean/currents.json (see tests/currents-bake.mjs, data/sources/ocean.md).
// Geometry: ONE indexed ribbon mesh for all currents. Each path sample becomes two
// vertices (left/right edge); the vertex shader places the centre on the globe exactly
// like RIVER_VERT (COMMON.morphPos, lifted above sea level) and pushes the edges
// sideways in world space, so the band lies flat on the (morphed) surface. Band width
// follows the real width of the current but is clamped to a pixel range.
// Animation: per-current phase (km) integrated on the CPU in float64 and sent wrapped
// to the GPU (no float32 drift), dash period chosen per zoom octave with a cross-fade.
// Antimeridian: a path step with |dlon| > 180 is split into two strips at +-180 deg.
import * as THREE from 'three';
import { COMMON } from '../shaders.js';
import { getPalette } from '../../shared/palettes.js';

export const CURRENTS_URL = 'assets/ocean/currents.json';
export const KIND_INDEX = { warm: 0, cold: 1, neutral: 2 };
// muted map colours; a palette may override them with map.currentWarm / currentCold / currentNeutral
export const DEFAULT_CURRENT_COLORS = { warm: [0.86, 0.55, 0.32], cold: [0.6, 0.76, 0.9], neutral: [0.86, 0.85, 0.79] };

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;
const P0_KM = 100;          // reference dash period (octaves are P0 * 2^n)
const DASH_PX = 95;         // dash period on screen, px (octave A; B is twice that)
const FLOW_PX = 30;         // on-screen drift, px/s, of a 1 m/s current
const WRAP = 1024;          // phase is sent modulo WRAP periods (pattern hash is periodic in WRAP)
const MIN_PX = 3, MAX_PX = 34;
const WEAK = 0.45;          // strength in seasonal transition months

const smooth01 = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const smoothstep = (a, b, x) => smooth01((x - a) / (b - a));

// ---------------------------------------------------------------- data
export async function loadCurrents(url = CURRENTS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** display half-width (km) of a band from the physical width of the current */
export const displayHalfWidthKm = widthKm => Math.min(420, Math.max(50, 40 + 0.6 * widthKm)) / 2;
/** relative on-screen drift speed: compresses 0.04..2 m/s into a readable range, order preserved */
export const visualSpeed = ms => Math.min(1.6, Math.max(0.18, Math.pow(Math.max(ms, 0), 0.55)));

// flow direction / strength of a seasonal current in calendar month k (1..12); allocation-free
const monthDir = (s, k) => (s.reverse && s.months.includes(k) ? -1 : 1);
function monthIntensity(s, k) {
  const weak = s.weakMonths ? s.weakMonths.includes(k) : false;
  if (s.reverse) return weak ? WEAK : 1;
  return s.months.includes(k) ? 1 : weak ? WEAK : 0;
}

/**
 * Season state of a current for a (fractional) month: integer m = middle of month m,
 * 1..12, wraps (12.5 is the Dec/Jan boundary). Returns {dir: -1..1, intensity: 0..1}
 * (written into `out` when given, so per-frame callers allocate nothing).
 * A non-finite month is treated as January.
 */
export function seasonalState(seasonal, month, out = { dir: 1, intensity: 1 }) {
  if (!seasonal) { out.dir = 1; out.intensity = 1; return out; }
  if (!Number.isFinite(month)) month = 1;
  const m = ((((month - 1) % 12) + 12) % 12) + 1;   // 1 <= m < 13
  const k0 = Math.floor(m), k1 = k0 === 12 ? 1 : k0 + 1;
  const s = smooth01(m - k0);
  const d0 = monthDir(seasonal, k0), i0 = monthIntensity(seasonal, k0);
  out.dir = d0 + (monthDir(seasonal, k1) - d0) * s;
  out.intensity = i0 + (monthIntensity(seasonal, k1) - i0) * s;
  return out;
}
const _season = { dir: 1, intensity: 1 };
/** strength actually drawn: a reversing current fades out while it turns around */
const drawnStrength = (intensity, dir) => intensity * smoothstep(0.05, 0.45, Math.abs(dir));

const toVec = (lon, lat, o = [0, 0, 0]) => {
  const cl = Math.cos(lat * DEG);
  o[0] = cl * Math.sin(lon * DEG); o[1] = Math.sin(lat * DEG); o[2] = cl * Math.cos(lon * DEG);
  return o;
};
const vecLon = v => Math.atan2(v[0], v[2]) / DEG;
const vecLat = v => Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG;
const angle = (a, b) => {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
};
function slerp(a, b, t) {
  const om = angle(a, b);
  if (om < 1e-12) return [a[0], a[1], a[2]];
  const s = Math.sin(om), ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  const v = [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
// unit tangent at p toward q along the sphere (projection of q - p on the tangent plane)
function tangentTo(p, q) {
  const d = q[0] * p[0] + q[1] * p[1] + q[2] * p[2];
  const t = [q[0] - p[0] * d, q[1] - p[1] * d, q[2] - p[2] * d];
  const l = Math.hypot(t[0], t[1], t[2]) || 1;
  return [t[0] / l, t[1] / l, t[2] / l];
}

/**
 * Pure geometry builder (no THREE, runs in Node). Densifies every path along great
 * circles to <= maxStepDeg, splits it at the antimeridian, and emits a ribbon:
 * 2 vertices per sample (side -1 / +1), 2 triangles per step inside each strip.
 * Attributes: position (lon, lat, side), aTangent (unit flow direction on the sphere),
 * aFlow (distKm, totalKm, currentIndex, kind), aShape (halfWidthKm, fadeInKm, fadeOutKm).
 */
export function buildCurrentsGeometryData(data, { maxStepDeg = 0.5, joinKm = 250 } = {}) {
  const list = data.currents;
  // 1) dense samples per current (unit vectors + along-path distance)
  const dense = list.map(c => {
    const P = c.path.map(p => toVec(p[0], p[1], [0, 0, 0]));
    const vs = [P[0]], ds = [0];
    let dist = 0;
    for (let i = 1; i < P.length; i++) {
      const om = angle(P[i - 1], P[i]);
      const n = Math.max(1, Math.ceil(om / (maxStepDeg * DEG)));
      for (let k = 1; k <= n; k++) {
        vs.push(k === n ? P[i] : slerp(P[i - 1], P[i], k / n));
        ds.push(dist + om * EARTH_KM * k / n);
      }
      dist += om * EARTH_KM;
    }
    return { vs, ds, total: dist };
  });
  // 2) ends that continue into another current are not faded (chains read as one stream)
  const nearOther = (ci, v) => {
    for (let j = 0; j < dense.length; j++) {
      if (j === ci) continue;
      const vs = dense[j].vs;
      for (let k = 0; k < vs.length; k += 2) if (angle(v, vs[k]) * EARTH_KM < joinKm) return true;
    }
    return false;
  };

  // 3) emit strips
  const pos = [], tan = [], flow = [], shape = [], idx = [];
  const sVec = [], sCur = [], sDist = [];
  const currents = [];
  let nv = 0;
  list.forEach((c, ci) => {
    const { vs, ds, total } = dense[ci];
    const kind = KIND_INDEX[c.kind] ?? 2;
    const hw = displayHalfWidthKm(c.widthKm);
    // free end: fade out and narrow over fadeLen; joined end (negative): short partial alpha fade only
    const fadeLen = Math.min(350, total * 0.2);
    const joinLen = -Math.min(150, total * 0.1);
    const fadeIn = nearOther(ci, vs[0]) ? joinLen : fadeLen;
    const fadeOut = nearOther(ci, vs[vs.length - 1]) ? joinLen : fadeLen;
    const first = nv;
    let strips = 0, inStrip = 0;
    const emit = (lon, lat, t, d) => {
      if (inStrip > 0) {
        const a = nv - 2;              // previous sample's left vertex
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      for (const side of [-1, 1]) {
        pos.push(lon, lat, side);
        tan.push(t[0], t[1], t[2]);
        flow.push(d, total, ci, kind);
        shape.push(hw, fadeIn, fadeOut);
      }
      nv += 2; inStrip++;
    };
    const tangentAt = i => (i < vs.length - 1 ? tangentTo(vs[i], vs[i + 1]) : tangentTo(vs[i], vs[i - 1]).map(x => -x));
    const smoothTangent = i => {
      if (i === 0 || i === vs.length - 1) return tangentAt(i);
      const a = tangentTo(vs[i], vs[i + 1]), b = tangentTo(vs[i], vs[i - 1]);
      const t = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const l = Math.hypot(t[0], t[1], t[2]);
      // a hairpin (a == b) has no bisector: fall back to the forward direction
      return l > 1e-6 ? [t[0] / l, t[1] / l, t[2] / l] : a;
    };
    let prevLon = null, prevLat = 0;
    for (let i = 0; i < vs.length; i++) {
      const lon = vecLon(vs[i]), lat = vecLat(vs[i]);
      sVec.push(vs[i][0], vs[i][1], vs[i][2]); sCur.push(ci); sDist.push(ds[i]);
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        // antimeridian: finish this strip exactly at +-180 and start a new one at -+180
        const lonU = lon + (prevLon > 0 ? 360 : -360);
        const f = (Math.sign(prevLon) * 180 - prevLon) / (lonU - prevLon);
        const latX = prevLat + (lat - prevLat) * f;
        const dX = ds[i - 1] + (ds[i] - ds[i - 1]) * f;
        const edge = prevLon > 0 ? 180 : -180;
        const t = tangentTo(toVec(edge, latX), vs[i]);
        emit(edge, latX, t, dX);
        inStrip = 0; strips++;
        emit(-edge, latX, t, dX);
      }
      if (inStrip === 0 && prevLon === null) strips++;
      emit(lon, lat, smoothTangent(i), ds[i]);
      prevLon = lon; prevLat = lat;
    }
    currents.push({
      id: c.id, nameRu: c.nameRu, nameEn: c.nameEn, kind: c.kind, speed: c.speed, widthKm: c.widthKm,
      seasonal: c.seasonal ?? null, lengthKm: total, firstVertex: first, vertexCount: nv - first, strips,
    });
  });
  return {
    position: new Float32Array(pos), tangent: new Float32Array(tan), flow: new Float32Array(flow), shape: new Float32Array(shape),
    index: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    vertexCount: nv, triangleCount: idx.length / 3, currents,
    samples: { vec: new Float32Array(sVec), current: new Uint16Array(sCur), dist: new Float32Array(sDist) },
  };
}

/** THREE.BufferGeometry from buildCurrentsGeometryData() output */
export function createCurrentsGeometry(built) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(built.position, 3));
  g.setAttribute('aTangent', new THREE.BufferAttribute(built.tangent, 3));
  g.setAttribute('aFlow', new THREE.BufferAttribute(built.flow, 4));
  g.setAttribute('aShape', new THREE.BufferAttribute(built.shape, 3));
  g.setIndex(new THREE.BufferAttribute(built.index, 1));
  // positions are lon/lat, not world space: give a fixed bound so nothing computes one
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 64);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-64, -64, -64), new THREE.Vector3(64, 64, 64));
  return g;
}

// ---------------------------------------------------------------- shaders
export function currentsVertexShader(maxCurrents) {
  return /* glsl */ `
${COMMON}
#define MAXC ${maxCurrents}
uniform float uLift;
uniform float uPxWorld;    // world units per CSS pixel at unit distance: 2 tan(fov/2) / viewport height
uniform float uMinPx;
uniform float uMaxPx;
uniform vec4 uState[MAXC]; // per current: phase A (km), phase B (km), direction -1..1, strength 0..1
in vec3 aTangent;
in vec4 aFlow;             // along-path km, path length km, current index, kind
in vec3 aShape;            // half width km, fade-in km, fade-out km (negative = joined end: partial fade and taper)
out float vDist;
out float vSide;
out float vIdx;
out float vKind;
out float vFade;
out vec4 vState;

vec3 placeGeo(vec3 g, float disp, out vec3 up) {
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  return morphPos(s, T, disp, up);
}

void main() {
  float lon = radians(position.x), lat = radians(position.y);
  vec3 g = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float h = heightAt(geoToUV(g), 0.0, 0.0);   // same surface as RIVER_VERT (incl. the detail window)
  float disp = max(h, 0.0) * uExag + uLift;
  vec3 up, up2;
  vec3 p = placeGeo(g, disp, up);
  vec3 p2 = placeGeo(normalize(g + aTangent * 1e-3), disp, up2);
  vec3 fwd = p2 - p;
  fwd -= up * dot(fwd, up);
  vec3 sd = cross(up, fwd);
  float sl = length(sd);
  vec3 sideDir = sl > 1e-12 ? sd / sl : uR;

  float dist = aFlow.x, total = aFlow.y;
  float fa = abs(aShape.y), fb = abs(aShape.z);
  float fin = fa > 0.0 ? smoothstep(0.0, fa, dist) : 1.0;
  float fout = fb > 0.0 ? smoothstep(0.0, fb, total - dist) : 1.0;
  bool freeIn = aShape.y > 0.0, freeOut = aShape.z > 0.0;
  float pxW = uPxWorld * length(cameraPosition - p);
  float hw = clamp(aShape.x / 6371.0, uMinPx * 0.5 * pxW, uMaxPx * 0.5 * pxW);
  hw *= mix(freeIn ? 0.35 : 0.6, 1.0, fin) * mix(freeOut ? 0.35 : 0.6, 1.0, fout);

  vDist = dist;
  vSide = position.z;
  vIdx = aFlow.z;
  vKind = aFlow.w;
  vFade = (freeIn ? fin : mix(0.4, 1.0, fin)) * (freeOut ? fout : mix(0.4, 1.0, fout));
  vState = uState[int(aFlow.z + 0.5)];
  gl_Position = projectionMatrix * viewMatrix * vec4(p + sideDir * (position.z * hw), 1.0);
}
`;
}

export const CURRENTS_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uWarm;
uniform vec3 uCold;
uniform vec3 uNeutral;
uniform vec3 uShadow;
uniform float uOpacity;
uniform float uPeriodA;   // km, octave A (octave B = 2 * A)
uniform float uMixB;      // weight of octave B
uniform float uOctave;    // octave index of A, seeds its random pattern
in float vDist;
in float vSide;
in float vIdx;
in float vKind;
in float vFade;
in vec4 vState;
layout(location = 0) out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// four staggered layers of comet-shaped streaks; returns (alpha, head glow, dark rim alpha)
vec3 streaks(float phase, float period, float seed, float dirSign, float pxSide, float dDist) {
  float a = 0.0, head = 0.0, rim = 0.0;
  for (int j = 0; j < 4; j++) {
    float fj = float(j);
    float u = (vDist - phase) / period + fj * 0.37 + hash21(vec2(seed * 7.0 + fj, vIdx * 3.1));
    float cell = mod(floor(u), ${WRAP}.0);
    float x = fract(u);
    if (dirSign < 0.0) x = 1.0 - x;           // head always points downstream
    float r1 = hash21(vec2(cell, seed * 13.0 + fj * 5.0 + vIdx * 0.71));
    float r2 = hash21(vec2(cell + 17.0, seed * 3.0 + fj * 11.0 + vIdx * 1.37));
    float r3 = hash21(vec2(cell + 41.0, seed * 5.0 + fj * 7.0 + vIdx * 2.03));
    float len = mix(0.3, 0.55, r1);
    float aa = max(dDist / period, 1e-5);       // = fwidth(u), taken before any discard
    float t = clamp(x / len, 0.0, 1.0);
    float along = pow(t, 1.4) * (1.0 - smoothstep(len - 2.5 * aa, len + aa, x));
    float c = (r3 * 2.0 - 1.0) * 0.55;         // lateral position inside the band
    float thick = clamp(0.5 / pxSide, 1.6, 4.5) * 0.5 * pxSide * mix(0.45, 1.0, t);
    float d = abs(vSide - c);
    float on = step(0.28, r2);
    float s = along * (1.0 - smoothstep(thick - 0.3 * pxSide, thick + pxSide, d)) * on;
    a = max(a, s);
    head = max(head, s * smoothstep(0.7, 1.0, t));
    // soft dark halo keeps light streaks readable on pale shelf water
    rim = max(rim, along * (1.0 - smoothstep(thick, thick + 2.2 * pxSide, d)) * on);
  }
  return vec3(a, head, rim);
}

void main() {
  // screen-space derivatives first: they are undefined after a non-uniform discard
  float pxSide = max(length(vec2(dFdx(vSide), dFdy(vSide))), 1e-4);   // band units per pixel
  float dDist = fwidth(vDist);                                         // km per pixel along the flow
  float strength = vState.w * vFade;
  if (strength * uOpacity <= 0.002) discard;
  float dirSign = vState.z < 0.0 ? -1.0 : 1.0;
  vec3 A = streaks(vState.x, uPeriodA, uOctave, dirSign, pxSide, dDist);
  vec3 B = streaks(vState.y, uPeriodA * 2.0, uOctave + 1.0, dirSign, pxSide, dDist);
  vec3 S = mix(A, B, uMixB);
  float edge = 1.0 - smoothstep(0.45, 1.0, abs(vSide));
  vec3 base = vKind < 0.5 ? uWarm : (vKind < 1.5 ? uCold : uNeutral);
  vec3 streakC = mix(base, vec3(1.0, 0.97, 0.9), S.y * 0.3);
  // layers, back to front: faint band tint, dark halo, coloured streak
  float core = 0.92 * S.x;
  float halo = 0.3 * S.z;
  float tint = 0.12 * edge;
  float a = max(max(core, halo), tint);
  vec3 under = mix(base, uShadow, halo / max(halo + tint, 1e-4));
  vec3 col = mix(under, streakC, core / max(a, 1e-4));
  fragColor = vec4(col, min(1.0, a) * strength * uOpacity);
}
`;

// ---------------------------------------------------------------- colours
function resolveColors(palette) {
  let map = null;
  if (typeof palette === 'string') map = getPalette(palette).map;
  else if (palette?.map) map = palette.map;
  else if (palette && typeof palette === 'object') map = palette;
  const pick = (key, def) => (Array.isArray(map?.[key]) ? map[key] : def);
  return {
    warm: pick('currentWarm', DEFAULT_CURRENT_COLORS.warm),
    cold: pick('currentCold', DEFAULT_CURRENT_COLORS.cold),
    neutral: pick('currentNeutral', DEFAULT_CURRENT_COLORS.neutral),
    // halo under the streaks: the palette's ink, a little lifted
    shadow: (Array.isArray(map?.ink) ? map.ink : [0.12, 0.12, 0.12]).map(v => Math.min(1, v * 1.1 + 0.02)),
  };
}

// ---------------------------------------------------------------- the layer
export class Currents {
  /**
   * @param {THREE.Scene} scene
   * @param {{shared: object}} globe  Globe (its `shared` morph uniforms are reused live)
   * @param {object|string} [palette] palette id, getPalette() result or its .map
   *   (default: the globe's settings.palette, as Globe itself uses)
   * @param {object} [data] parsed currents.json; fetched from CURRENTS_URL when omitted
   */
  constructor(scene, globe, palette, data = null) {
    this.scene = scene;
    this.globe = globe;
    this.colors = resolveColors(palette ?? globe?.settings?.palette);
    this.mesh = null;
    this.visible = true;
    this.fade = 1;             // eased visibility
    this.month = 1;
    this._seasonSet = false;
    this._lastT = null;
    this._viewH = 900;
    this._size = new THREE.Vector2();
    this._disposed = false;
    this.ready = data ? Promise.resolve(this._build(data)) : loadCurrents().then(d => this._build(d));
    this.ready.catch(err => console.warn('[currents] not loaded:', err));
  }

  _build(data) {
    if (this._disposed) return this;
    const built = buildCurrentsGeometryData(data);
    const n = built.currents.length;
    const maxc = Math.max(16, Math.ceil(n / 16) * 16);
    this.data = data;
    this.built = built;
    this.list = built.currents;
    this.count = n;
    this._phase = new Float64Array(n);
    this._speed = new Float32Array(n);
    this._dir = new Float32Array(n);
    this._int = new Float32Array(n);
    this._dirT = new Float32Array(n);
    this._intT = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this._speed[i] = visualSpeed(this.list[i].speed);
      // deterministic start offsets so neighbouring currents do not pulse in sync
      this._phase[i] = ((Math.imul(i + 1, 2654435761) >>> 0) % 997) * 0.37;
    }
    const col = c => new THREE.Color(c[0], c[1], c[2]);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: currentsVertexShader(maxc),
      fragmentShader: CURRENTS_FRAG,
      uniforms: {
        ...this.globe.shared,
        uLift: { value: 0.003 },
        uPxWorld: { value: 2 * Math.tan(17 * DEG) / this._viewH },
        uMinPx: { value: MIN_PX },
        uMaxPx: { value: MAX_PX },
        uState: { value: new Float32Array(maxc * 4) },
        uWarm: { value: col(this.colors.warm) },
        uCold: { value: col(this.colors.cold) },
        uNeutral: { value: col(this.colors.neutral) },
        uShadow: { value: col(this.colors.shadow) },
        uOpacity: { value: 1 },
        uPeriodA: { value: P0_KM },
        uMixB: { value: 0 },
        uOctave: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometry = createCurrentsGeometry(built);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'currents';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = this.visible;
    // CSS-pixel scale of the real viewport, read right before drawing (no allocations)
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getSize(this._size);
      if (this._size.y > 0) this._viewH = this._size.y;
      const fov = camera && camera.isPerspectiveCamera ? camera.fov : 34;
      this.material.uniforms.uPxWorld.value = 2 * Math.tan(fov * DEG * 0.5) / this._viewH;
    };
    this.scene.add(this.mesh);
    this._seasonSet = false;
    this.setMonth(this.month);
    // start in the current season (no easing from zero before the first frame)
    this._dir.set(this._dirT);
    this._int.set(this._intT);
    return this;
  }

  /**
   * month 1..12 (fractional allowed: integer = middle of the month); seasonal currents fade / reverse.
   * Cheap and allocation-free, so it may be called every frame; non-finite values are ignored.
   */
  setMonth(m) {
    if (!Number.isFinite(m)) return;
    if (m === this.month && this._seasonSet) return;
    this.month = m;
    if (!this.list) return;
    for (let i = 0; i < this.count; i++) {
      seasonalState(this.list[i].seasonal, m, _season);
      this._dirT[i] = _season.dir;
      this._intT[i] = _season.intensity;
    }
    this._seasonSet = true;
  }

  setVisible(b) {
    this.visible = !!b;
    if (this.mesh && this.visible) this.mesh.visible = true;
  }

  /** per frame: gcam = GlobeCamera, timeSec = seconds (monotonic) */
  update(gcam, timeSec) {
    // a NaN here would poison the float64 phases for good (and THREE cannot upload a NaN-led uniform array)
    if (!this.mesh || !Number.isFinite(timeSec) || !gcam || !Number.isFinite(gcam.alt)) return;
    const first = this._lastT === null;
    const dt = first ? 0 : Math.min(0.1, Math.max(0, timeSec - this._lastT));
    this._lastT = timeSec;
    const u = this.material.uniforms;
    const alt = Math.max(1e-4, gcam.alt);

    // visibility fade
    const kv = first ? 1 : 1 - Math.exp(-dt / 0.25);
    this.fade += ((this.visible ? 1 : 0) - this.fade) * kv;
    this.mesh.visible = this.visible || this.fade > 0.003;
    // strong at globe and mid zoom, subtle close to the ground
    const zoomK = smoothstep(Math.log(0.03), Math.log(0.6), Math.log(alt));
    u.uOpacity.value = this.fade * (0.3 + 0.7 * zoomK);
    u.uLift.value = alt * 0.0015 + 2e-5;

    // dash period ~DASH_PX on screen, in power-of-two octaves cross-faded
    const fov = gcam.cam && gcam.cam.fov ? gcam.cam.fov : 34;
    const kmPerPx = alt * EARTH_KM * 2 * Math.tan(fov * DEG * 0.5) / this._viewH;
    const L = Math.log2(DASH_PX * kmPerPx / P0_KM);
    const oct = Math.floor(L);
    const pA = P0_KM * Math.pow(2, oct);
    u.uPeriodA.value = pA;
    u.uMixB.value = L - oct;
    u.uOctave.value = oct;

    // flow: phase advances in km; seasons ease toward their targets
    const flowKm = FLOW_PX * kmPerPx * dt;
    const ks = first ? 1 : 1 - Math.exp(-dt / 0.8);
    const st = u.uState.value;
    const mA = WRAP * pA, mB = 2 * WRAP * pA;
    for (let i = 0; i < this.count; i++) {
      this._dir[i] += (this._dirT[i] - this._dir[i]) * ks;
      this._int[i] += (this._intT[i] - this._int[i]) * ks;
      const d = this._dir[i];
      this._phase[i] += flowKm * this._speed[i] * d;
      const ph = this._phase[i];
      st[i * 4] = ph - Math.floor(ph / mA) * mA;
      st[i * 4 + 1] = ph - Math.floor(ph / mB) * mB;
      st[i * 4 + 2] = d;
      // a reversing current fades out while it turns around
      st[i * 4 + 3] = drawnStrength(this._int[i], d);
    }
  }

  /**
   * Nearest drawn current to a point (degrees) within maxKm, for tooltips; null if none.
   * Skips currents that are out of season / mid-reversal (drawn strength < minStrength)
   * and returns null while the layer is hidden, so a tooltip never names an invisible current.
   */
  nearest(lonDeg, latDeg, maxKm = 150, minStrength = 0.15) {
    if (!this.built || !this.visible || !Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) return null;
    const v = toVec(lonDeg, latDeg);
    const { vec, current, dist } = this.built.samples;
    let best = -1, bestDot = Math.cos(Math.min(Math.PI, maxKm / EARTH_KM));
    for (let k = 0, n = current.length; k < n; k++) {
      const d = vec[k * 3] * v[0] + vec[k * 3 + 1] * v[1] + vec[k * 3 + 2] * v[2];
      if (d > bestDot) {
        const ci = current[k];
        if (drawnStrength(this._int[ci], this._dir[ci]) < minStrength) continue;
        bestDot = d; best = k;
      }
    }
    if (best < 0) return null;
    const i = current[best];
    const c = this.list[i];
    return {
      id: c.id, nameRu: c.nameRu, nameEn: c.nameEn, kind: c.kind, speed: c.speed,
      reversed: this._dir[i] < 0, strength: drawnStrength(this._int[i], this._dir[i]),
      distanceKm: Math.acos(Math.min(1, bestDot)) * EARTH_KM, alongKm: dist[best],
    };
  }

  dispose() {
    this._disposed = true;
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.onBeforeRender = () => {};
    this.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
  }
}
