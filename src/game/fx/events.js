// Light map effects for natural events: eruptions, earthquakes, tsunamis, meteorites, landslides, wildfires,
// floods and weather spells (heat, cold, drought, storms, snowstorms).
//
// Two draw calls in total (the shaders are in events-glsl.js):
//   - decals: an instanced grid per effect layer, draped over the relief through the same unroll morph as the
//     terrain, with the pattern drawn in the fragment shader (rings, glow, ash fall, fire front, crater, cracks…);
//   - sprites: instanced quads — puffs (ash, smoke, dust, fireballs), glows and flashes, streaks stretched along
//     their motion (meteor head and trail, sparks, ejecta, embers, snow), lightning and lava tongues on the ground.
// Every sprite moves by a closed formula of its age, so the CPU only writes a few numbers when an event starts.
// Effects run in "effect seconds" that advance only while the game runs, and every effect has a minimum on-screen
// life, so a two-week eruption does not vanish in half a second at high speed — events are stretched in time.
// Sizes are physical (km) but never smaller than a fraction of the view, so an event is noticeable from orbit;
// all the parts of one event share that floor, so they stay together at any zoom.
import * as THREE from 'three';
import { DK, SK, NOISE_SIZE, DECAL_VERT, DECAL_FRAG, SPRITE_VERT, SPRITE_FRAG } from './events-glsl.js';

const MAX_DECALS = 128;
const MAX_PARTS = 6144;
const GRID = 12;
const KM = 1 / 6371;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

export const FX_KINDS = Object.freeze({
  eruption: 0, earthquake: 1, tsunami: 2, meteorite: 3, landslide: 4, wildfire: 5, flood: 6,
  heatwave: 7, coldwave: 8, drought: 9, storm: 10, snowstorm: 11,
});

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Prevailing wind at a latitude, as the azimuth it blows toward (radians from north, clockwise): easterly trades
// below ~30°, westerlies up to ~60°, polar easterlies beyond — the same belts as the wind layer.
export function windAzimuth(lat) {
  const ap = Math.abs(lat), s = Math.sign(lat) || 1;
  let u, v;
  if (ap < 30) { const k = Math.sin(Math.PI * ap / 30); u = -(3 + 4 * k); v = -s * 2 * k; }
  else if (ap < 60) { const k = Math.sin(Math.PI * (ap - 30) / 30); u = 5 + 7 * k; v = s * 1.2 * k; }
  else { const k = Math.sin(Math.PI * (ap - 60) / 30); u = -(2 + 2 * k); v = -s * 0.8 * k; }
  return Math.atan2(u, v);
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// a tiling texture of random bytes: R is read bilinearly as value noise, G and B as the points of Voronoi cells
function makeNoise() {
  const n = NOISE_SIZE, data = new Uint8Array(n * n * 4), r = mulberry(77031);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// premultiplied output: one draw can lay ash "over" the map (alpha) and make lava glow (alpha 0 = additive)
const BLEND = {
  transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

export class EventFx {
  constructor(scene, globe) {
    this.globe = globe;
    this.now = 0;
    this.lastT = null;
    this.visible = true;
    this.rand = mulberry(20260611);
    this.heightPx = 900;
    this.fov = 34;
    this.noise = makeNoise();

    // ---- decals
    const grid = new THREE.PlaneGeometry(2, 2, GRID, GRID);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = grid.index;
    geo.setAttribute('position', grid.getAttribute('position'));
    this.dGeo = new Float32Array(MAX_DECALS * 4);   // lat, lon, base radius, kind
    this.dTime = new Float32Array(MAX_DECALS * 4);  // birth, life, seed, strength
    this.dExt = new Float32Array(MAX_DECALS * 4);   // direction, size multiplier, p1, p2
    this.dAttrs = [['aGeo', this.dGeo], ['aTime', this.dTime], ['aExt', this.dExt]].map(([name, arr]) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    });
    geo.instanceCount = 0;
    this.decalGeo = geo;
    this.decalEnd = new Float32Array(MAX_DECALS);     // effect-time when each slot frees up
    this.decalMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: { ...globe.shared, uNow: { value: 0 }, uMinR: { value: 0.022 }, uAlt: { value: 1 }, uLift: { value: 0 }, uDot: { value: 2 }, uNoise: { value: this.noise } },
      side: THREE.DoubleSide,
      ...BLEND,
    });
    this.decals = new THREE.Mesh(geo, this.decalMat);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 3;
    this.decals.visible = false;
    scene.add(this.decals);

    // ---- sprites (a ring buffer of instanced quads)
    const quad = new THREE.InstancedBufferGeometry();
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.sGeo = new Float32Array(MAX_PARTS * 4);    // lat, lon, kind, seed
    this.sTime = new Float32Array(MAX_PARTS * 4);   // birth, life, event radius, strength
    this.sA = new Float32Array(MAX_PARTS * 4);      // kind-specific
    this.sB = new Float32Array(MAX_PARTS * 4);      // kind-specific
    this.sAttrs = [['aGeo', this.sGeo], ['aTime', this.sTime], ['aA', this.sA], ['aB', this.sB]].map(([name, arr]) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      quad.setAttribute(name, a);
      return a;
    });
    quad.instanceCount = 0;
    this.partGeo = quad;
    this.partNext = 0;
    this.partUsed = 0;
    this.partEnd = 0;
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
    this.partMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: { ...globe.shared, uNow: { value: 0 }, uAlt: { value: 1 }, uPx: { value: 900 }, uH: { value: 900 }, uMinR: { value: 0.022 }, uLift: { value: 0 }, uDot: { value: 2 }, uNoise: { value: this.noise } },
      side: THREE.DoubleSide,
      ...BLEND,
    });
    this.parts = new THREE.Mesh(quad, this.partMat);
    this.parts.frustumCulled = false;
    this.parts.renderOrder = 4;
    this.parts.visible = false;
    scene.add(this.parts);
  }

  get active() { return this.decals.visible || this.parts.visible; }

  // ev: {type, lat, lon, level 1..5, vei 0..8, severity 1..5, magnitude, kind ('airburst' for meteorites), tropical}
  spawn(ev) {
    const kind = FX_KINDS[ev.type];
    if (kind === undefined || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) return false;
    const lvl = Math.max(1, Math.min(5, Math.round(ev.level ?? ev.severity ?? 2) || 2));
    const vei = Math.max(0, Math.min(8, Number.isFinite(ev.vei) ? ev.vei : lvl));
    const e = { lat: ev.lat, lon: ev.lon, lvl, vei, seed: this.rand(), t0: this.now };
    switch (ev.type) {
      case 'eruption': this.#eruption(e); break;
      case 'meteorite': this.#meteorite(e, ev.kind === 'airburst' || ev.airburst === true || this.#height(ev.lat, ev.lon) < 0); break;
      case 'earthquake': this.#earthquake(e); break;
      case 'tsunami': this.#simple(e, DK.tsunami, [0, 500, 800, 1300, 2400, 4000][lvl], 9 + lvl * 1.5); break;
      case 'landslide': this.#landslide(e); break;
      case 'wildfire': this.#wildfire(e); break;
      case 'flood': this.#simple(e, DK.flood, 50 + lvl * 45, 8 + lvl); break;
      case 'storm': case 'snowstorm': this.#storm(e, ev.type === 'snowstorm', !!ev.tropical || ev.subtype === 'tropical'); break;
      default: this.#simple(e, kind, 380 + lvl * 90, 9 + lvl); break; // heat / cold / drought
    }
    this.#flush();
    this.decals.visible = this.visible;
    this.parts.visible = this.visible && this.partUsed > 0;
    return true;
  }

  // ---------------------------------------------------------------- events

  #simple(e, kind, rKm, life) {
    this.#decal(e.lat, e.lon, kind, rKm * KM, 1, e.t0, life, e.seed, e.lvl / 5);
  }

  // eruption: the vent and its lava (kept as it was), lava tongues running down the real slopes, fountains of
  // sparks, an ash plume leaning downwind, lightning in the column and a pyroclastic ring from VEI 4
  #eruption(e) {
    const { lat, lon, vei, seed, t0 } = e, r = this.rand;
    const R = (18 + vei * 26) * KM, str = vei / 7, life = 7 + vei * 2.2;
    const S = (kind, birth, lf, ...p) => this.#sprite(lat, lon, kind, birth, lf, R, str, ...p);
    const wind = windAzimuth(lat) + (r() - 0.5) * 0.6;
    this.#decal(lat, lon, DK.eruption, R, 1, t0, life, seed, str, wind);
    // pyroclastic flows reach ~10 km (VEI 4) to ~30 km (VEI 7) around the vent
    const pyro = 0.18 + 0.03 * (vei - 4);
    if (vei >= 4) this.#decal(lat, lon, DK.pyro, R, pyro, t0 + 0.6, life * 0.6, seed, str, wind);
    this.#lavaFlows(e, life, S);
    // pyroclastic puffs rolling down all sides (under the plume)
    if (vei >= 4) {
      for (let i = 0, m = 10 + 6 * (vei - 4); i < m; i++) {
        // dust: aA = azimuth, reach, height, size0; aB = size1, tone (1 = pyroclastic), origin x, y
        S(SK.dust, t0 + 0.6 + 0.5 * r(), life * 0.45, r() * TAU, R * pyro * (0.55 + 0.35 * r()), R * pyro * 0.06, R * pyro * 0.08, R * pyro * (0.22 + 0.1 * r()), 1, 0, 0);
      }
    }
    // the ash plume: as before, now leaning downwind, heavier and darker from VEI 5
    const heavy = Math.max(0, Math.min(1, (vei - 4) / 3));
    const n = Math.round((40 + vei * 20) * (1 + 0.35 * heavy)), L = (6 + vei * 8) * KM, span = life * 0.85;
    // ash: aA = wind azimuth, plume scale, heaviness, size factor; aB.x = spread of directions
    for (let i = 0; i < n; i++) S(SK.ash, t0 + (i / n) * span, 3.2 * (0.8 + 0.4 * r()), wind, L, heavy, 1 + 0.3 * heavy, 0.9, 0, 0, 0);
    // lava fountains: pulses of glow and ballistic sparks at the vent
    const pulses = 3 + Math.min(vei, 5);
    for (let k = 0; k < pulses; k++) {
      const tk = t0 + ((k + 0.8 * r()) / pulses) * life * 0.8;
      // glow: aA = x, y, height, size0; aB = size1, tone (1 = lava), decay
      S(SK.glow, tk, 1.1, 0, 0, R * 0.01, R * 0.05, R * 0.13, 1, 1.3);
      for (let j = 0, m = 7 + 2 * Math.min(vei, 6); j < m; j++) {
        const V = R * (0.05 + 0.05 * r()) * (1 + vei / 8), h0 = R * 0.004;
        // spark: aA = x, y, height, azimuth; aB = reach, up speed, gravity, size
        S(SK.spark, tk + 0.25 * r(), 0.7 + 0.5 * r(), 0, 0, h0, r() * TAU, R * 0.07 * r(), V, V + h0, R * 0.005);
      }
    }
    // lightning flickers inside the ash column
    if (vei >= 4) {
      const sx = Math.sin(wind), sy = Math.cos(wind);
      for (let i = 0, m = 3 + 3 * (vei - 4); i < m; i++) {
        const d = L * (0.25 + 0.9 * r()), j = (r() - 0.5) * L * 0.3;
        // bolt: aA = x, y, height, length; aB = flashes per second, width, plume scale (same zoom floor as the ash)
        S(SK.bolt, t0 + r() * life * 0.6, 1.2 + 1.5 * r(), sx * d + sy * j, sy * d - sx * j, L * (0.12 + 0.2 * r()), L * (0.12 + 0.1 * r()), 7 + 5 * r(), L * 0.03, L, 0);
      }
    }
  }

  // lava tongues that follow the slope down from the vent (traced on the height grid), advancing over the
  // eruption, glowing while they are fed and cooling to a dark crust afterwards
  #lavaFlows(e, life, S) {
    const { lat, lon, vei, t0 } = e, r = this.rand;
    const H = (x, y) => this.#heightLocal(lat, lon, x, y);
    const nFlows = vei <= 2 ? 3 : vei <= 4 ? 2 + (r() < 0.5 ? 1 : 0) : 2;
    const lenKm = 6 + 3 * Math.min(vei, 5) + 6 * r();
    const probe = 6 * KM;
    const dirs = [];
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5 * r()) / 16) * TAU;
      dirs.push([a, H(Math.sin(a) * probe, Math.cos(a) * probe)]);
    }
    dirs.sort((p, q) => p[1] - q[1]);
    const starts = [];
    for (const [a] of dirs) {
      if (starts.every(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.8)) starts.push(a);
      if (starts.length >= nFlows) break;
    }
    for (const a0 of starts) {
      const pts = this.#traceDown(H, a0, 3 * KM, lenKm * KM);
      const segs = pts.length - 1;
      if (segs < 1) continue;
      const width = (0.35 + 0.07 * vei) * KM * (0.8 + 0.4 * r());
      const t1 = t0 + 0.4 + 0.6 * r(), adv = life * (0.45 + 0.25 * r());
      for (let i = 0; i < segs; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        const birth = t1 + (i / segs) * adv;
        const feed = Math.max(0.5, t0 + life * 0.9 - birth);
        // lava: aA = x, y, azimuth, half length; aB = half width, cooling time, fed time
        S(SK.lava, birth, feed + 8 + 4 * r(), (x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(x1 - x0, y1 - y0), Math.hypot(x1 - x0, y1 - y0) * 0.65,
          width * (1 - 0.45 * i / segs), 2.5 + 1.5 * r(), feed, 0);
      }
    }
  }

  // steepest descent with a little inertia and meander; stops in a basin or at the sea
  #traceDown(H, a0, step, maxLen) {
    const pts = [[0, 0]];
    let x = 0, y = 0, az = a0, h = H(0, 0), up = 0;
    const n = Math.max(2, Math.round(maxLen / step));
    for (let i = 0; i < n; i++) {
      // near the vent a tongue keeps its own bearing (so tongues fan out), further down it follows the slope
      let best = az, bh = Infinity;
      const kMax = i < 3 ? 1 : 2, pen = i < 3 ? 25 : 6;
      for (let k = -kMax; k <= kMax; k++) {
        const a = az + k * 0.4 + (this.rand() - 0.5) * 0.3;
        const hh = H(x + Math.sin(a) * step, y + Math.cos(a) * step) + Math.abs(k) * pen;
        if (hh < bh) { bh = hh; best = a; }
      }
      if (bh > h + 15) { if (++up > 1) break; } else up = 0;
      az = best;
      x += Math.sin(az) * step; y += Math.cos(az) * step;
      pts.push([x, y]);
      h = Math.min(h, bh);
      if (bh < 0) break;
    }
    return pts;
  }

  // meteorite: an incandescent head on a shallow path with a widening ionised trail that cools into drifting
  // smoke, break-up sparks, the flash that lights the ground, a fireball (a mushroom for levels 4–5), shock rings,
  // ejecta arcs, a dust cloud and a crater cooling from white heat to a dark scar. Airbursts explode aloft: no
  // crater, but a butterfly of felled forest under the blast.
  #meteorite(e, airburst) {
    const { lat, lon, lvl: L, seed, t0 } = e, r = this.rand;
    const R = (18 + 16 * L) * KM, str = L / 5;
    const S = (kind, birth, life, ...p) => this.#sprite(lat, lon, kind, birth, life, R, str, ...p);
    const az = r() * TAU;                                     // heading
    const slope = (16 + 20 * r()) * D2R;                     // shallow entry
    const D = R * (5.5 + 0.6 * L), H = D * Math.tan(slope);
    const hEnd = airburst ? R * (0.35 + 0.08 * L) : 0;
    const tE = 0.9 + 0.16 * L, tI = t0 + tE;                 // flight time, moment of impact
    const wind = windAzimuth(lat) + (r() - 0.5) * 0.8, wx = Math.sin(wind), wy = Math.cos(wind);
    const path = s => { const k = 1 - s; return [-Math.sin(az) * D * k, -Math.cos(az) * D * k, hEnd + (H - hEnd) * k]; };

    // decals: the scar (long) and the impact moment (flash on the ground, shock rings)
    this.#decal(lat, lon, DK.scar, R, 1.4, tI, 16 + 5 * L, seed, str, az, airburst ? 1 : 0);
    this.#decal(lat, lon, DK.impact, R, 2.6, tI, 2.6 + 0.5 * L, seed, str, az, airburst ? 1 : 0);
    // the trail — trail: aA = heading, path length, entry height, end height; aB = path position, drift x, y, width
    const nT = 16 + 8 * L;
    for (let i = 0; i < nT; i++) {
      const s = (i + 0.5) / nT, dr = R * (0.25 + 0.35 * r()) * (0.3 + s);
      S(SK.trail, t0 + s * tE, 4 + 1.3 * L + 1.5 * r(), az, D, H, hEnd, s, wx * dr, wy * dr, R * (0.025 + 0.006 * L) * (0.5 + 0.8 * s));
    }
    // dust thrown up by the blast, drifting downwind (a wide cloud for big impacts)
    if (L >= 2) {
      const big = L >= 4 ? 1 : 0;
      for (let i = 0, m = (airburst ? 3 : 4) + 4 * L + 8 * big; i < m; i++) {
        const a = r() * TAU, rr = R * (0.15 + 1.1 * Math.sqrt(r())) * (1 + 0.4 * big);
        const dx = Math.sin(a) * rr + wx * R * 0.8 * r(), dy = Math.cos(a) * rr + wy * R * 0.8 * r();
        S(SK.dust, tI + 0.1 + 0.6 * r(), 6 + 1.8 * L + 2 * r(), Math.atan2(dx, dy), Math.hypot(dx, dy), R * (0.04 + 0.12 * r()) * (1 + big),
          R * 0.14, R * (0.42 + 0.06 * L) * (0.7 + 0.6 * r()), 0, 0, 0);
      }
    }
    // the fireball — fireball: aA = azimuth, reach, rise, size0; aB = size1, cooling rate, base height
    const nF = 8 + 6 * L, Hc = R * (0.9 + 0.3 * L);
    for (let i = 0; i < nF; i++) {
      const life = 3.5 + 0.9 * L + r();
      if (L >= 4) {
        const f = i / nF;
        if (f < 0.4) {                                       // the stem
          const k = f / 0.4;
          S(SK.fireball, tI + 0.05 + 0.5 * k, life, r() * TAU, R * 0.07 * r(), Hc * (0.1 + 0.75 * k), R * 0.1, R * (0.16 + 0.08 * r()), 1.1, hEnd, 0);
        } else {                                             // the rolling cap
          S(SK.fireball, tI + 0.25 + 0.5 * r(), life, r() * TAU, R * (0.25 + 0.4 * r()), Hc * (0.92 + 0.2 * r()), R * 0.14, R * (0.36 + 0.14 * r()), 0.9, hEnd, 0);
        }
      } else {
        S(SK.fireball, tI + 0.1 * r(), life, r() * TAU, R * 0.28 * r(), R * (0.25 + 0.15 * L) * (0.6 + 0.4 * r()), R * 0.12,
          R * (0.26 + 0.05 * L) * (0.7 + 0.5 * r()), 1.6 - 0.15 * L, hEnd, 0);
      }
    }
    // ejecta: dark debris arcs (none behind the entry — the uprange sector of an oblique impact) and hot sparks
    if (!airburst) {
      for (let i = 0, m = 8 + 7 * L; i < m; i++) {
        const a = az + (r() - 0.5) * TAU * 0.85, V = R * (0.5 + 0.7 * r());
        S(SK.debris, tI + 0.03 * r(), 1.1 + 0.15 * L + 0.4 * r(), 0, 0, 0, a, R * (0.35 + 0.9 * r()), V, V, R * (0.005 + 0.0012 * L));
      }
      for (let i = 0, m = 6 + 4 * L; i < m; i++) {
        const a = az + (r() - 0.5) * TAU * 0.9, V = R * (0.4 + 0.4 * r());
        S(SK.spark, tI + 0.02 * r(), 0.6 + 0.4 * r(), 0, 0, 0, a, R * (0.2 + 0.6 * r()), V, V, R * 0.008);
      }
    }
    // break-up: fragments shed sparks along the last part of the path, with small flashes
    if (L >= 2) {
      for (let i = 0, m = 4 + 5 * L; i < m; i++) {
        const sb = 0.68 + 0.27 * r(), [x, y, h] = path(sb);
        const a = az + (r() - 0.5) * 0.9, d = R * (0.4 + 0.9 * r());
        S(SK.spark, t0 + sb * tE, 0.5 + 0.5 * r(), x, y, h, a, d, -d * (H - hEnd) / D * 0.6 + R * 0.15 * (r() - 0.3), R * 0.25 * r(), R * 0.01);
      }
      for (let i = 0, m = L >= 3 ? 2 : 1; i < m; i++) {
        const sb = 0.75 + 0.18 * r(), [x, y, h] = path(sb);
        S(SK.glow, t0 + sb * tE, 0.35, x, y, h, R * 0.06, R * 0.28, 0, 2);
      }
    }
    // the head (aB.x = size), and the flash on top of everything
    S(SK.head, t0, tE, az, D, H, hEnd, R * (0.05 + 0.012 * L), 0, 0, 0);
    S(SK.glow, tI, 0.45 + 0.1 * L, 0, 0, hEnd + R * 0.04, R * 0.3, R * (1.3 + 0.35 * L) * (airburst ? 1.4 : 1), 0, 2.6);
  }

  // earthquake: ripple trains and the rupture on the decal; dust puffs where the shaking reaches hillsides
  #earthquake(e) {
    const { lat, lon, lvl, seed, t0 } = e, r = this.rand;
    const R = [0, 25, 60, 140, 320, 650][lvl] * KM, life = 3.5 + lvl * 0.9, str = lvl / 5;
    this.#decal(lat, lon, DK.earthquake, R, 1, t0, life, seed, str, r() * Math.PI);
    for (let i = 0, m = 3 + 3 * lvl; i < m; i++) {
      const rr = R * 0.7 * Math.sqrt(r()), a = r() * TAU;
      const birth = t0 + (rr / R / 0.95 / 1.35) * life;      // when the first ripple gets there
      this.#sprite(lat, lon, SK.dust, birth, 2 + r(), R, str, r() * TAU, R * 0.06, R * 0.015, R * 0.02, R * (0.05 + 0.03 * r()), 2, Math.sin(a) * rr, Math.cos(a) * rr);
    }
  }

  // landslide: a tongue of material down the steepest side, with dust sliding along it
  #landslide(e) {
    const { lat, lon, lvl, seed, t0 } = e, r = this.rand;
    const R = (6 + lvl * 4) * KM, life = 4 + lvl * 0.6, str = lvl / 5;
    let az = r() * TAU, low = Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU, hh = this.#heightLocal(lat, lon, Math.sin(a) * R * 0.8, Math.cos(a) * R * 0.8);
      if (hh < low) { low = hh; az = a; }
    }
    az += (r() - 0.5) * 0.4;
    this.#decal(lat, lon, DK.landslide, R, 1, t0, life, seed, str, az);
    const sx = Math.sin(az), sy = Math.cos(az);
    for (let i = 0, m = 4 + 2 * lvl; i < m; i++) {
      const j = (r() - 0.5) * R * 0.3;
      this.#sprite(lat, lon, SK.dust, t0 + 0.1 + r() * life * 0.4, 2 + r(), R, str, az + (r() - 0.5) * 0.5, R * (0.4 + 0.4 * r()), R * 0.04, R * 0.05,
        R * 0.14, 3, -sx * R * 0.3 + sy * j, -sy * R * 0.3 - sx * j);
    }
  }

  // wildfire: the decal draws the front and the scar; smoke columns rise from points on the front, embers fly
  #wildfire(e) {
    const { lat, lon, lvl, seed, t0 } = e, r = this.rand;
    const R = (18 + lvl * 26) * KM, life = 8 + lvl * 1.6, str = lvl / 5;
    const wind = windAzimuth(lat) + (r() - 0.5) * 1.2, wx = Math.sin(wind), wy = Math.cos(wind);
    this.#decal(lat, lon, DK.wildfire, R, 1, t0, life, seed, str, wind);
    // where the front is at a given age and bearing (the decal's formula without its noise)
    const front = (age, a) => R * (0.22 + 0.68 * smooth(0, 0.85, age)) * (0.85 + 0.3 * Math.cos(a - wind)) * 0.85;
    const L = (8 + lvl * 5) * KM, cols = 2 + lvl, per = Math.round((40 + lvl * 16) / cols);
    for (let c = 0; c < cols; c++) {
      const a = r() * TAU;
      for (let i = 0; i < per; i++) {
        const birth = t0 + ((i + 0.5 * r()) / per) * life * 0.8, f = front((birth - t0) / life, a);
        // smoke: aA = wind azimuth, plume scale; aB = origin x, y
        this.#sprite(lat, lon, SK.smoke, birth, 3.4 * (0.8 + 0.4 * r()), R, str, wind, L, 0, 0, Math.sin(a) * f, Math.cos(a) * f, 0, 0);
      }
    }
    for (let i = 0, m = 10 + 6 * lvl; i < m; i++) {
      const a = r() * TAU, birth = t0 + r() * life * 0.75, f = front((birth - t0) / life, a);
      // ember: aA = x, y, rise, size; aB = drift x, y
      this.#sprite(lat, lon, SK.ember, birth, 1.2 + r(), R, str, Math.sin(a) * f, Math.cos(a) * f, R * (0.05 + 0.08 * r()), R * 0.006, wx * R * 0.15, wy * R * 0.15, 0, 0);
    }
  }

  // storm: spiral cloud bands (a cyclone with an eye in the tropics) and lightning; snowstorm: swirling flakes
  #storm(e, snow, tropical) {
    const { lat, lon, lvl, seed, t0 } = e, r = this.rand;
    const R = (220 + lvl * 90) * KM, life = 6 + lvl, str = lvl / 5;
    const spin = lat >= 0 ? 1 : -1;                          // counter-clockwise in the north
    const cyc = !snow && (tropical || (Math.abs(lat) < 30 && lvl >= 3)) ? 1 : 0;
    this.#decal(lat, lon, snow ? DK.snowstorm : DK.storm, R, 1, t0, life, seed, str, r() * TAU, spin, cyc);
    if (!snow && lvl >= 3) {
      for (let i = 0; i < lvl; i++) {
        const rr = R * (0.12 + 0.5 * r()), a = r() * TAU;
        this.#sprite(lat, lon, SK.bolt, t0 + r() * life * 0.75, 1 + r(), R, str, Math.sin(a) * rr, Math.cos(a) * rr, R * 0.015, R * 0.04, 5 + 4 * r(), R * 0.006, 0, 0);
      }
    }
    if (snow) {
      for (let i = 0, m = 30 + 18 * lvl; i < m; i++) {
        const rad = R * (0.08 + 0.82 * Math.sqrt(r())), w = spin * (0.12 + 0.2 / (0.25 + rad / R));
        // flake: aA = start angle (from east), radius, height, size; aB.x = angular speed
        this.#sprite(lat, lon, SK.flake, t0 + 0.3 * r(), life - 0.3, R, str, r() * TAU, rad, R * 0.01 * r(), R * 0.005, w, 0, 0, 0);
      }
    }
  }

  // ---------------------------------------------------------------- buffers

  #decal(lat, lon, kind, R, mult, birth, life, seed, str, az = 0, p1 = 0, p2 = 0) {
    // a free slot, else the one that ends soonest
    let slot = -1, soonest = Infinity;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this.decalEnd[i] <= this.now) { slot = i; break; }
      if (this.decalEnd[i] < soonest) { soonest = this.decalEnd[i]; slot = i; }
    }
    const o = slot * 4;
    this.dGeo[o] = lat; this.dGeo[o + 1] = lon; this.dGeo[o + 2] = R; this.dGeo[o + 3] = kind;
    this.dTime[o] = birth; this.dTime[o + 1] = life; this.dTime[o + 2] = seed; this.dTime[o + 3] = str;
    this.dExt[o] = az; this.dExt[o + 1] = mult; this.dExt[o + 2] = p1; this.dExt[o + 3] = p2;
    this.decalEnd[slot] = birth + life;
    for (const a of this.dAttrs) a.needsUpdate = true;
    this.decalGeo.instanceCount = Math.max(this.decalGeo.instanceCount, slot + 1);
  }

  #sprite(lat, lon, kind, birth, life, R, str, a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0) {
    const i = this.partNext;
    this.partNext = (i + 1) % MAX_PARTS;
    this.partUsed = Math.max(this.partUsed, i + 1);
    const o = i * 4, G = this.sGeo, T = this.sTime, A = this.sA, B = this.sB;
    G[o] = lat; G[o + 1] = lon; G[o + 2] = kind; G[o + 3] = this.rand();
    T[o] = birth; T[o + 1] = life; T[o + 2] = R; T[o + 3] = str;
    A[o] = a0; A[o + 1] = a1; A[o + 2] = a2; A[o + 3] = a3;
    B[o] = b0; B[o + 1] = b1; B[o + 2] = b2; B[o + 3] = b3;
    this.partEnd = Math.max(this.partEnd, birth + life);
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  // upload only the sprites written since the last flush
  #flush() {
    if (this.dirtyHi >= this.dirtyLo) {
      for (const a of this.sAttrs) {
        a.addUpdateRange(this.dirtyLo * 4, (this.dirtyHi - this.dirtyLo + 1) * 4);
        a.needsUpdate = true;
      }
    }
    this.dirtyLo = Infinity; this.dirtyHi = -1;
    this.partGeo.instanceCount = this.partUsed;
  }

  // metres at (lat, lon), bilinear on the global height grid
  #height(lat, lon) {
    const d = this.globe?.data;
    if (!d?.height || !d.W) return 0;
    const { W, H, height } = d;
    const fx = (lon / 360 + 0.5) * W - 0.5, fy = (0.5 - lat / 180) * H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const X = x => ((x % W) + W) % W, Y = y => Math.max(0, Math.min(H - 1, y));
    const r0 = Y(y0) * W, r1 = Y(y0 + 1) * W, a = X(x0), b = X(x0 + 1);
    return (height[r0 + a] * (1 - tx) + height[r0 + b] * tx) * (1 - ty) + (height[r1 + a] * (1 - tx) + height[r1 + b] * tx) * ty;
  }

  // x east, y north: radians of arc from (lat, lon)
  #heightLocal(lat, lon, x, y) {
    return this.#height(lat + y / D2R, lon + x / D2R / Math.max(0.05, Math.cos(lat * D2R)));
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
    const pu = this.partMat.uniforms;
    pu.uPx.value = this.heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(this.fov / 2)));
    pu.uH.value = this.heightPx;
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
      this.partGeo.instanceCount = 0;
    }
  }

  clear() {
    this.decalEnd.fill(0);
    this.decalGeo.instanceCount = 0;
    this.decals.visible = false;
    this.partEnd = 0; this.partUsed = 0; this.partNext = 0;
    this.partGeo.instanceCount = 0;
    this.parts.visible = false;
  }

  setVisible(v) {
    this.visible = !!v;
    if (!v) { this.decals.visible = false; this.parts.visible = false; }
    else {
      this.decals.visible = this.decalEnd.some(e => e > this.now);
      this.parts.visible = this.now < this.partEnd && this.partUsed > 0;
    }
  }

  dispose() {
    this.decals.removeFromParent();
    this.parts.removeFromParent();
    this.decalGeo.dispose();
    this.partGeo.dispose();
    this.decalMat.dispose();
    this.partMat.dispose();
    this.noise.dispose();
  }
}
