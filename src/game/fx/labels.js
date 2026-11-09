// Natural-zone labels in the spirit of EU4: one big curved name per desert,
// mountain range, plateau, sea, gulf... (no countries). Data: public/assets/labels/zones.json
// (scripts/labels/bake-labels.mjs).
//
// Rendering: a 2D-canvas glyph atlas (Cyrillic + Latin, R = ink, G = soft paper halo),
// one THREE.Mesh of glyph quads laid out along each label's curve on the sphere.
// The vertex shader morphs every vertex exactly like the rivers (COMMON.morphPos),
// so labels follow the globe -> map "unrolling". Each glyph quad is stored twice:
// reading along the curve and reading backwards; the CPU picks the one that reads
// left-to-right on screen, so text is never upside down or mirrored.
// Per label the CPU computes a fade (altitude range, on-screen letter size 9..120 px,
// facing the camera) and a greedy screen-space declutter; results go to a small
// float texture read in the vertex shader. No allocations per frame.
import * as THREE from 'three';
import { COMMON } from '../shaders.js';
import { getPalette } from '../../shared/palettes.js';

export const R_KM = 6371;
export const DEFAULT_FONT = 'Alegreya SC, Georgia, serif';
export const WATER_KINDS = new Set(['ocean', 'sea', 'gulf', 'bay', 'strait']);
const SAMPLES = 5;          // screen-space samples along a label (declutter / flip)
const SUB = 2;              // glyph quad subdivision (SUB x SUB cells) — keeps big letters on the morphed surface
const Y_MID = 0.3;          // em: vertical centre of small-caps text above the baseline
const LABEL_TEX_W = 256;

// ------------------------------------------------------------------ pure helpers (testable in node)

export const labelText = (zone, lang = 'ru') => (lang === 'en' ? zone.nameEn : zone.nameRu) || zone.nameEn || '';
export const isWater = zone => (zone.water ?? WATER_KINDS.has(zone.kind)) === true;

// Characters needed by the atlas, per style (sea labels are italic).
export function collectGlyphs(zones, lang = 'ru') {
  const regular = new Set(), italic = new Set();
  for (const z of zones) {
    const set = isWater(z) ? italic : regular;
    for (const ch of labelText(z, lang)) if (!/\s/.test(ch)) set.add(ch);
  }
  return { regular, italic };
}

export const glyphKey = (ch, italic) => (italic ? 'i' : 'r') + ch;

// Build the glyph atlas. createCanvas(w, h) must return an HTMLCanvasElement-like object.
// Channels: R = glyph coverage, G = halo coverage (drawn additively on opaque black).
export function buildGlyphAtlas({ regular, italic, fontFamily = DEFAULT_FONT, emPx = 72, createCanvas, maxWidth = 2048 }) {
  const haloPx = Math.max(2, Math.round(emPx * 0.085));
  const pad = Math.ceil(haloPx * 2 + 3);
  const fontOf = it => `${it ? 'italic ' : ''}500 ${emPx}px ${fontFamily}`;
  const mctx = createCanvas(16, 16).getContext('2d');
  const styles = [];
  const entries = [];
  for (const [set, it] of [[regular, false], [italic, true]]) {
    mctx.font = fontOf(it);
    const fm = mctx.measureText('ЁЙQgjpрду|');
    const ascent = Math.ceil(fm.fontBoundingBoxAscent ?? fm.actualBoundingBoxAscent ?? emPx * 0.82);
    const descent = Math.ceil(fm.fontBoundingBoxDescent ?? fm.actualBoundingBoxDescent ?? emPx * 0.26);
    const space = mctx.measureText(' ').width / emPx || 0.25;
    styles.push({ italic: it, ascent, descent, space });
    for (const ch of [...set].sort()) {
      const m = mctx.measureText(ch);
      const l = Math.ceil(Math.max(0, m.actualBoundingBoxLeft ?? 0));
      const r = Math.ceil(Math.max(m.actualBoundingBoxRight ?? m.width, 1));
      entries.push({ ch, it, adv: m.width, l, r, ascent, descent, w: l + r + 2 * pad, h: ascent + descent + 2 * pad });
    }
  }
  // shelf packing
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const e of entries) {
    if (x + e.w > maxWidth) { x = 0; y += rowH; rowH = 0; }
    e.x = x; e.y = y;
    x += e.w; rowH = Math.max(rowH, e.h); W = Math.max(W, x);
  }
  const H = Math.max(4, y + rowH);
  W = Math.max(4, W);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const glyphs = new Map();
  for (const e of entries) {
    const ox = e.x + pad + e.l, oy = e.y + pad + e.ascent;
    ctx.font = fontOf(e.it);
    // soft halo (green): blurred wide stroke + crisp core
    if ('filter' in ctx) ctx.filter = `blur(${(haloPx * 0.55).toFixed(1)}px)`;
    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.lineWidth = haloPx * 2;
    ctx.strokeText(e.ch, ox, oy);
    ctx.fillText(e.ch, ox, oy);
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.lineWidth = haloPx * 1.1;
    ctx.strokeText(e.ch, ox, oy);
    // ink (red)
    ctx.fillStyle = '#ff0000';
    ctx.fillText(e.ch, ox, oy);
    glyphs.set(glyphKey(e.ch, e.it), {
      ch: e.ch, italic: e.it,
      adv: e.adv / emPx,
      // quad in em, origin = left end of the baseline, y up
      x0: -(e.l + pad) / emPx, x1: (e.r + pad) / emPx,
      y0: -(e.descent + pad) / emPx, y1: (e.ascent + pad) / emPx,
      // texture coords (flipY = false: v = 0 is the canvas top)
      u0: e.x / W, u1: (e.x + e.w) / W, v0: (e.y + e.h) / H, v1: e.y / H,
    });
  }
  return { canvas, width: W, height: H, emPx, glyphs, space: { regular: styles[0].space, italic: styles[1].space } };
}

// --- tiny vec3 helpers on arrays (layout runs once at load; allocation is fine here)
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vnorm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function geoToVec(lon, lat) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, c = Math.cos(la);
  return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)];
}

// Smooth curve through the label's path points (centripetal Catmull-Rom on the sphere), densely sampled.
export function sampleCurve(path, perSeg = 24) {
  const P = path.map(([lon, lat]) => geoToVec(lon, lat));
  const n = P.length;
  const at = i => {
    if (i < 0) return P[0].map((v, k) => 2 * v - P[1][k]);
    if (i >= n) return P[n - 1].map((v, k) => 2 * v - P[n - 2][k]);
    return P[i];
  };
  const pts = [];
  for (let s = 0; s < n - 1; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    const d = (a, b) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg;
      const lerp = (a, b, ta, tb) => a.map((v, i) => (v * (tb - t) + b[i] * (t - ta)) / (tb - ta));
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      pts.push(vnorm(lerp(B1, B2, t1, t2)));
    }
  }
  pts.push(P[n - 1]);
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    const c = vcross(pts[i - 1], pts[i]);
    cum[i] = cum[i - 1] + Math.atan2(Math.hypot(c[0], c[1], c[2]), vdot(pts[i - 1], pts[i])) * R_KM;
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

// position + unit tangent at arc length s (km)
export function curveAt(curve, s) {
  const { pts, cum } = curve;
  const L = curve.length;
  s = Math.max(0, Math.min(L, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]);
  const a = pts[lo], b = pts[hi];
  const p = vnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const k = vdot(d, p);
  const tan = vnorm([d[0] - p[0] * k, d[1] - p[1] * k, d[2] - p[2] * k]);
  return { p, t: tan };
}

// Lay a label's text along its curve. Returns per-glyph quads (corner unit vectors for the
// forward and the reversed reading direction) plus screen-test sample points.
export function layoutLabel(zone, text, atlas) {
  const italic = isWater(zone);
  const curve = sampleCurve(zone.path);
  const L = curve.length;
  const chars = [...text];
  const n = chars.length;
  const space = italic ? atlas.space.italic : atlas.space.regular;
  const adv = chars.map(ch => (/\s/.test(ch) ? space : atlas.glyphs.get(glyphKey(ch, italic))?.adv ?? 0.5));
  const advSum = adv.reduce((a, b) => a + b, 0);
  let h = zone.letterHeightKm;
  if (advSum * h > L * 0.98) h = L * 0.98 / Math.max(advSum, 1e-6);
  // gaps between glyphs; word gaps get a bigger share of the tracking
  const gw = [];
  for (let i = 0; i < n - 1; i++) gw.push(/\s/.test(chars[i]) || /\s/.test(chars[i + 1]) ? 1.4 : 1);
  const gwSum = gw.reduce((a, b) => a + b, 0);
  let track = gwSum > 0 ? (L - advSum * h) / gwSum : 0;
  track = Math.max(0, Math.min(track, 2.2 * h));
  const textLen = advSum * h + track * gwSum;
  const start = (L - textLen) / 2;

  const quads = [];
  let s = start;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const sc = s + adv[i] * h / 2;
    s += adv[i] * h + (i < n - 1 ? track * gw[i] : 0);
    if (/\s/.test(ch)) continue;
    const g = atlas.glyphs.get(glyphKey(ch, italic));
    if (!g) continue;
    const corners = dir => {
      const { p, t } = curveAt(curve, dir > 0 ? sc : L - sc);
      const T = dir > 0 ? t : [-t[0], -t[1], -t[2]];
      const U = vcross(p, T);                     // text "up": left of the reading direction, seen from outside
      const out = [];
      for (let iy = 0; iy <= SUB; iy++) {
        for (let ix = 0; ix <= SUB; ix++) {
          const ex = g.x0 + (g.x1 - g.x0) * ix / SUB - adv[i] / 2;
          const ey = g.y0 + (g.y1 - g.y0) * iy / SUB - Y_MID;
          const dx = ex * h / R_KM, dy = ey * h / R_KM;
          out.push(vnorm([p[0] + T[0] * dx + U[0] * dy, p[1] + T[1] * dx + U[1] * dy, p[2] + T[2] * dx + U[2] * dy]));
        }
      }
      return out;
    };
    quads.push({ glyph: g, fwd: corners(1), rev: corners(-1) });
  }
  // samples along the text (forward reading direction) for screen-space tests
  const samples = [];
  for (let k = 0; k < SAMPLES; k++) samples.push(curveAt(curve, start + textLen * k / (SAMPLES - 1)).p);
  const mid = curveAt(curve, L / 2);
  const offset = (p, d) => vnorm([p[0] + d[0] * h / R_KM, p[1] + d[1] * h / R_KM, p[2] + d[2] * h / R_KM]);
  return {
    quads, samples, letterHeightKm: h, textLenKm: textLen, curveLenKm: L,
    center: mid.p, centerUp: offset(mid.p, vcross(mid.p, mid.t)), centerAlong: offset(mid.p, mid.t),
  };
}

// ------------------------------------------------------------------ shaders

const LABEL_VERT = /* glsl */ `
${COMMON}
uniform sampler2D uLabels;   // per label: alpha, flip, base height (m), water
uniform float uLift;
uniform float uHLod;
in vec3 aPosB;
in float aLabel;
out vec2 vUv;
out float vA;
out float vWater;
void main() {
  int li = int(aLabel + 0.5);
  int tw = textureSize(uLabels, 0).x;
  vec4 L = texelFetch(uLabels, ivec2(li % tw, li / tw), 0);
  vUv = uv;
  vWater = L.w;
  vA = L.x;
  if (L.x < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // hidden: outside the clip volume
  vec3 g = normalize(L.y > 0.5 ? aPosB : position);
  float d = dot(g, uF);
  vec3 Tv = g - uF * d;
  float tl = length(Tv);
  float s = atan(tl, d);
  vec3 T = tl > 1e-12 ? Tv / tl : uR;
  float h = textureLod(uHeight, geoToUV(g), uHLod).r;
  vec3 up;
  vec3 p = morphPos(s, T, max(max(h, 0.0), L.z) * uExag + uLift, up);
  vA *= smoothstep(0.0, 0.12, dot(up, normalize(cameraPosition - p)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const LABEL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform vec3 uInk, uHalo, uSeaInk, uSeaHalo;
uniform float uOpacity;
uniform float uHaloAmt;
in vec2 vUv;
in float vA;
in float vWater;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 t = texture(uAtlas, vUv).rg;
  float fill = t.r;
  float halo = t.g * uHaloAmt * mix(1.0, 0.6, vWater);
  float a = fill + halo * (1.0 - fill);
  float alpha = a * vA * uOpacity * mix(0.94, 0.86, vWater);
  if (alpha < 0.004) discard;
  vec3 ink = mix(uInk, uSeaInk, vWater);
  vec3 hc = mix(uHalo, uSeaHalo, vWater);
  fragColor = vec4((ink * fill + hc * halo * (1.0 - fill)) / max(a, 1e-4), alpha);
}
`;

// ------------------------------------------------------------------ font loading

async function loadFonts(base, family) {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return;
  const faces = [];
  if (/Alegreya SC/i.test(family)) {
    faces.push(new FontFace('Alegreya SC', `url(${base}AlegreyaSC-Medium.ttf)`, { weight: '500', style: 'normal' }));
    faces.push(new FontFace('Alegreya SC', `url(${base}AlegreyaSC-MediumItalic.ttf)`, { weight: '500', style: 'italic' }));
  }
  const timeout = new Promise(r => setTimeout(r, 6000));
  await Promise.race([
    Promise.all(faces.map(f => f.load().then(ff => document.fonts.add(ff)).catch(() => {}))),
    timeout,
  ]);
  try {
    await Promise.race([Promise.all([document.fonts.load(`500 32px ${family}`, 'АаZz'), document.fonts.load(`italic 500 32px ${family}`, 'АаZz')]), timeout]);
  } catch { /* fall back to whatever the browser has */ }
}

function resolvePalette(p) {
  if (!p) return getPalette().map;
  if (typeof p === 'string') return getPalette(p).map;
  return p.map ?? p;
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wallSeconds = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;

// ------------------------------------------------------------------ the layer

export class ZoneLabels {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../globe.js').Globe} globe
   * @param {{fontFamily?: string, palette?: string|object, lang?: 'ru'|'en', url?: string, fontBase?: string,
   *          zones?: object, renderer?: THREE.WebGLRenderer, opacity?: number}} opts
   */
  constructor(scene, globe, opts = {}) {
    this.scene = scene;
    this.globe = globe;
    // explicit `undefined` options must not wipe the defaults (e.g. fontFamily: settings.x that is unset)
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    this.opts = {
      fontFamily: DEFAULT_FONT, lang: 'ru', url: 'assets/labels/zones.json', fontBase: 'assets/labels/fonts/',
      palette: globe?.settings?.palette, ...given,
    };
    // ENGINE.md two-argument form `new ZoneLabels(scene, globe)` still follows the game settings
    this.visible = globe?.settings?.showLabels !== false;
    this.ready = false;
    this.disposed = false;
    this.mesh = null;
    this.lastT = null;
    this.lastWall = null;
    this._now = typeof this.opts.now === 'function' ? this.opts.now : wallSeconds;
    this.ready$ = this._init().catch(e => { console.error('[labels]', e); });
  }

  async _init() {
    const data = this.opts.zones ?? await fetch(this.opts.url).then(r => {
      if (!r.ok) throw new Error(`${this.opts.url}: HTTP ${r.status}`);
      return r.json();
    });
    const zones = (data.zones ?? data).filter(z => Array.isArray(z.path) && z.path.length >= 2);
    await loadFonts(this.opts.fontBase, this.opts.fontFamily);
    if (this.disposed) return;
    const { regular, italic } = collectGlyphs(zones, this.opts.lang);
    const atlas = buildGlyphAtlas({
      regular, italic, fontFamily: this.opts.fontFamily,
      createCanvas: this.opts.createCanvas ?? ((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })),
    });
    this._build(zones, atlas);
  }

  _build(zones, atlas) {
    const n = zones.length;
    const layouts = zones.map(z => layoutLabel(z, labelText(z, this.opts.lang), atlas));
    const nQuads = layouts.reduce((s, l) => s + l.quads.length, 0);
    const VPQ = (SUB + 1) * (SUB + 1);
    const pos = new Float32Array(nQuads * VPQ * 3);
    const posB = new Float32Array(nQuads * VPQ * 3);
    const uv = new Float32Array(nQuads * VPQ * 2);
    const lab = new Float32Array(nQuads * VPQ);
    const idx = new Uint32Array(nQuads * SUB * SUB * 6);
    let v = 0, o = 0;
    layouts.forEach((lay, li) => {
      for (const q of lay.quads) {
        const g = q.glyph;
        for (let k = 0; k < VPQ; k++) {
          const ix = k % (SUB + 1), iy = (k / (SUB + 1)) | 0;
          pos.set(q.fwd[k], (v + k) * 3);
          posB.set(q.rev[k], (v + k) * 3);
          uv[(v + k) * 2] = g.u0 + (g.u1 - g.u0) * ix / SUB;
          uv[(v + k) * 2 + 1] = g.v0 + (g.v1 - g.v0) * iy / SUB;
          lab[v + k] = li;
        }
        for (let iy = 0; iy < SUB; iy++) for (let ix = 0; ix < SUB; ix++) {
          const a = v + iy * (SUB + 1) + ix, b = a + 1, c = a + SUB + 1, d = c + 1;
          idx[o++] = a; idx[o++] = b; idx[o++] = c;
          idx[o++] = b; idx[o++] = d; idx[o++] = c;
        }
        v += VPQ;
      }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aPosB', new THREE.BufferAttribute(posB, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setAttribute('aLabel', new THREE.BufferAttribute(lab, 1));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);

    const atlasTex = new THREE.CanvasTexture(atlas.canvas);
    atlasTex.flipY = false;
    atlasTex.colorSpace = THREE.NoColorSpace;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.anisotropy = 4;
    atlasTex.needsUpdate = true;

    const rows = Math.max(1, Math.ceil(n / LABEL_TEX_W));
    this.labelData = new Float32Array(LABEL_TEX_W * rows * 4);
    this.labelTex = new THREE.DataTexture(this.labelData, LABEL_TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.labelTex.minFilter = this.labelTex.magFilter = THREE.NearestFilter;
    this.labelTex.generateMipmaps = false;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: LABEL_VERT,
      fragmentShader: LABEL_FRAG,
      uniforms: {
        ...this.globe.shared,
        uLabels: { value: this.labelTex },
        uAtlas: { value: atlasTex },
        uLift: { value: 0 },
        uHLod: { value: 5 },
        uInk: { value: new THREE.Color() },
        uHalo: { value: new THREE.Color() },
        uSeaInk: { value: new THREE.Color() },
        uSeaHalo: { value: new THREE.Color() },
        uOpacity: { value: this.opts.opacity ?? 1 },
        uHaloAmt: { value: 0.85 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.setPalette(this.opts.palette);
    this.atlasTex = atlasTex;
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = this.visible;
    this.scene.add(this.mesh);

    // per-label CPU state (typed arrays, reused every frame)
    this.n = n;
    this.zones = zones;
    this.layouts = layouts;
    const S3 = (SAMPLES + 3) * 3;
    this.lpts = new Float64Array(n * S3);    // samples..., center, centerUp, centerAlong
    this.lbase = new Float32Array(n);
    this.lnMin = new Float32Array(n);
    this.lnMax = new Float32Array(n);
    this.lenEm = new Float32Array(n);       // text length in letter heights (screen margin for long labels)
    this.prio = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.target = new Float32Array(n);
    this.flip = new Uint8Array(n);
    layouts.forEach((lay, i) => {
      const z = zones[i];
      const all = [...lay.samples, lay.center, lay.centerUp, lay.centerAlong];
      all.forEach((p, k) => this.lpts.set(p, i * S3 + k * 3));
      this.lbase[i] = z.baseM ?? 0;
      this.lnMin[i] = Math.log(Math.max(1e-5, z.minAltitude ?? 1e-5));
      this.lnMax[i] = Math.log(Math.max(1e-5, z.maxAltitude ?? 100));
      this.lenEm[i] = lay.textLenKm / Math.max(1e-6, lay.letterHeightKm);
      this.prio[i] = z.priority ?? z.scalerank ?? 5;
      this.labelData[i * 4 + 2] = this.lbase[i];
      this.labelData[i * 4 + 3] = isWater(z) ? 1 : 0;
    });
    this.labelTex.needsUpdate = true;
    // scratch for the per-frame pass
    this.scr = new Float32Array(n * SAMPLES * 2);   // screen samples (px)
    this.rad = new Float32Array(n);                 // capsule radius (px)
    this.box = new Float32Array(n * 4);             // screen AABB
    this.cand = new Int32Array(n);
    this.acc = new Int32Array(n);
    this._vp = new THREE.Matrix4();
    this._out = new Float64Array(4);
    this._F = new THREE.Vector3(0, 0, 1);
    this._R = new THREE.Vector3(1, 0, 0);
    this._c = 1;
    this.ready = true;
  }

  setVisible(b) {
    this.visible = !!b;
    if (this.mesh) this.mesh.visible = this.visible;
  }

  // palette id ('graphite' | 'sepia' | 'lead') or a palette / palette.map object (src/shared/palettes.js)
  setPalette(palette) {
    this.opts.palette = palette;
    if (!this.material) return;
    const pal = resolvePalette(palette);
    const ink = pal.ink ?? [0.13, 0.12, 0.11], paper = pal.paper ?? [0.79, 0.78, 0.7];
    const deep = pal.deep ?? [0.33, 0.37, 0.39], shallow = pal.shallow ?? [0.62, 0.66, 0.66];
    const seaInk = mix3(deep, ink, 0.3).map((c, i) => Math.min(1, c * [0.88, 0.97, 1.14][i]));
    const u = this.material.uniforms;
    u.uInk.value.setRGB(...ink);
    u.uHalo.value.setRGB(...mix3(paper, [1, 1, 1], 0.35));
    u.uSeaInk.value.setRGB(...seaInk);
    u.uSeaHalo.value.setRGB(...mix3(shallow, [1, 1, 1], 0.3));
  }

  // CPU twin of the vertex shader: unit vector -> screen px; returns facing (cos) or -2 if behind the camera
  // (or if the camera is degenerate, e.g. a zero-size viewport gives a NaN projection).
  // F / R / curvature come from the camera of this frame (see update), not from globe.shared,
  // so the result does not depend on whether globe.update() already ran this frame.
  _project(lp, o, disp, vw, vh) {
    const F = this._F, R = this._R, c = this._c;
    const gx = lp[o], gy = lp[o + 1], gz = lp[o + 2];
    const d = gx * F.x + gy * F.y + gz * F.z;
    let tx = gx - F.x * d, ty = gy - F.y * d, tz = gz - F.z * d;
    const tl = Math.hypot(tx, ty, tz);
    const s = Math.atan2(tl, d);
    if (tl > 1e-12) { tx /= tl; ty /= tl; tz /= tl; } else { tx = R.x; ty = R.y; tz = R.z; }
    const sc = s * c, sn = Math.sin(sc), cs = Math.cos(sc), h2 = Math.sin(0.5 * sc);
    const ux = F.x * cs + tx * sn, uy = F.y * cs + ty * sn, uz = F.z * cs + tz * sn;
    const k0 = 1 - 2 * h2 * h2 / c, k1 = sn / c;
    const px = F.x * k0 + tx * k1 + ux * disp, py = F.y * k0 + ty * k1 + uy * disp, pz = F.z * k0 + tz * k1 + uz * disp;
    const m = this._vp.elements;
    const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (!(cw > 1e-6)) return -2;                     // behind the camera, or NaN
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const sx = (cx / cw * 0.5 + 0.5) * vw, sy = (cy / cw * 0.5 + 0.5) * vh;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return -2;
    this._out[0] = sx;
    this._out[1] = sy;
    const cp = this._camPos;
    const vx = cp.x - px, vy = cp.y - py, vz = cp.z - pz, vl = Math.hypot(vx, vy, vz) || 1;
    const face = (ux * vx + uy * vy + uz * vz) / vl;
    return Number.isFinite(face) ? face : -2;
  }

  _viewport() {
    const el = this.opts.renderer?.domElement;
    this._vw = el?.clientWidth || globalThis.innerWidth || 1920;
    this._vh = el?.clientHeight || globalThis.innerHeight || 1080;
  }

  // focus, screen-right and curvature for this frame: straight from the camera when it has them
  // (GlobeCamera: F, U, derived.curv/exag), otherwise from the globe's shared uniforms
  _frameState(gcam) {
    const sh = this.globe.shared;
    const d = gcam.derived;
    if (gcam.F && gcam.U) {
      this._F.copy(gcam.F);
      this._R.crossVectors(gcam.U, gcam.F);          // = GlobeCamera.R, without its allocation
      if (this._R.lengthSq() < 1e-12) this._R.copy(sh.uR.value);
      else this._R.normalize();
    } else {
      this._F.copy(sh.uF.value);
      this._R.copy(sh.uR.value);
    }
    const c = d && Number.isFinite(d.curv) && d.curv > 0 ? d.curv : sh.uCurv.value;
    this._c = Math.max(1e-6, c);
    return d && Number.isFinite(d.exag) ? d.exag / 6371000 : sh.uExag.value;
  }

  // declutter order: lower = more important; labels already shown get a bonus (no flicker)
  _key(j) { return this.prio[j] - (this.alpha[j] > 0.5 ? 0.75 : 0); }

  // timeSec: real seconds (any monotonic clock). If it is missing or does not advance (a paused or
  // constant time passed by mistake), the fades fall back to the wall clock instead of freezing.
  update(gcam, timeSec) {
    if (!this.ready || !this.visible || this.disposed) return;
    const wall = this._now();
    let dt;
    if (this.lastT === null) dt = 1;                 // first frame: snap to the targets
    else {
      dt = Number.isFinite(timeSec) ? timeSec - this.lastT : NaN;
      if (!(dt > 0)) dt = wall - this.lastWall;
      dt = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
    }
    this.lastT = Number.isFinite(timeSec) ? timeSec : wall;
    this.lastWall = wall;
    const cam = gcam.cam;
    const alt = gcam.alt, lnAlt = Math.log(alt);
    if (!(alt > 0)) return;
    this._viewport();
    const vw = this._vw, vh = this._vh;
    cam.updateMatrixWorld();
    this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._camPos = cam.position;
    const exag = this._frameState(gcam);
    const lift = alt * 0.003;
    this.material.uniforms.uLift.value = lift;
    this.material.uniforms.uHLod.value = alt < 0.05 ? 3 : alt < 0.3 ? 4 : 5;

    const S3 = (SAMPLES + 3) * 3;
    const lp = this.lpts, out = this._out;
    let nc = 0;
    for (let i = 0; i < this.n; i++) {
      this.target[i] = 0;
      // altitude window (soft, log space)
      const aAlt = smoothstep(this.lnMax[i] + 0.12, this.lnMax[i] - 0.12, lnAlt) * smoothstep(this.lnMin[i] - 0.4, this.lnMin[i] - 0.1, lnAlt);
      if (aAlt <= 0.001) continue;
      const disp = this.lbase[i] * exag + lift;
      const o = i * S3;
      const face = this._project(lp, o + SAMPLES * 3, disp, vw, vh);
      if (face < 0.05) continue;
      const cx = out[0], cy = out[1];
      let lpx = 0;
      if (this._project(lp, o + (SAMPLES + 1) * 3, disp, vw, vh) > -2) lpx = Math.hypot(out[0] - cx, out[1] - cy);
      if (this._project(lp, o + (SAMPLES + 2) * 3, disp, vw, vh) > -2) lpx = Math.max(lpx, Math.hypot(out[0] - cx, out[1] - cy));
      // off-screen test on the label centre, with a margin of half the text length:
      // a long label can still cross the screen while its centre is far outside
      const mx = Math.max(0.5 * vw, 0.55 * lpx * this.lenEm[i]), my = Math.max(0.5 * vh, 0.55 * lpx * this.lenEm[i]);
      if (cx < -mx || cx > vw + mx || cy < -my || cy > vh + my) continue;
      const maxPx = this.opts.maxLetterPx ?? 125;   // letters bigger than this fade out (smaller zones take over)
      const aSize = smoothstep(7, 10, lpx) * (1 - smoothstep(maxPx * 0.82, maxPx, lpx));
      const t = aAlt * aSize * smoothstep(0.05, 0.2, face);
      if (!(t > 0.01)) continue;
      // screen samples along the text
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, okAll = true;
      for (let k = 0; k < SAMPLES; k++) {
        if (this._project(lp, o + k * 3, disp, vw, vh) <= -2) { okAll = false; break; }
        const x = out[0], y = out[1];
        this.scr[(i * SAMPLES + k) * 2] = x; this.scr[(i * SAMPLES + k) * 2 + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (!okAll) continue;
      const r = lpx * 0.62;
      this.rad[i] = r;
      this.box[i * 4] = x0 - r; this.box[i * 4 + 1] = y0 - r; this.box[i * 4 + 2] = x1 + r; this.box[i * 4 + 3] = y1 + r;
      // reading direction: flip when the text would run right-to-left (hysteresis around vertical)
      const dx = this.scr[(i * SAMPLES + SAMPLES - 1) * 2] - this.scr[i * SAMPLES * 2];
      const dy = this.scr[(i * SAMPLES + SAMPLES - 1) * 2 + 1] - this.scr[i * SAMPLES * 2 + 1];
      const ang = Math.abs(Math.atan2(dy, dx));                     // 0 = left-to-right
      const wantFlip = ang > 1.75 ? 1 : ang < 1.4 ? 0 : this.flip[i];
      if (wantFlip !== this.flip[i]) { this.flip[i] = wantFlip; this.alpha[i] = 0; }
      this.target[i] = t;
      this.cand[nc++] = i;
    }
    // priority order (insertion sort: few candidates, nearly sorted from frame to frame)
    for (let a = 1; a < nc; a++) {
      const v = this.cand[a], kv = this._key(v);
      let b = a - 1;
      while (b >= 0 && this._key(this.cand[b]) > kv) { this.cand[b + 1] = this.cand[b]; b--; }
      this.cand[b + 1] = v;
    }
    // greedy declutter with capsules along the text
    let na = 0;
    for (let a = 0; a < nc; a++) {
      const i = this.cand[a];
      let hit = false;
      for (let b = 0; b < na && !hit; b++) {
        const j = this.acc[b];
        if (this.box[i * 4] > this.box[j * 4 + 2] || this.box[j * 4] > this.box[i * 4 + 2] ||
            this.box[i * 4 + 1] > this.box[j * 4 + 3] || this.box[j * 4 + 1] > this.box[i * 4 + 3]) continue;
        hit = this._capsHit(i, j);
      }
      if (hit) this.target[i] = 0; else this.acc[na++] = i;
    }
    // ease alphas, publish to the GPU
    const k = 1 - Math.exp(-dt * 7);
    let dirty = false;
    const D = this.labelData;
    for (let i = 0; i < this.n; i++) {
      let a = this.alpha[i] + (this.target[i] - this.alpha[i]) * k;
      if (!Number.isFinite(a)) a = 0;               // never let a bad frame poison the fades for good
      if (Math.abs(a - this.target[i]) < 0.004) a = this.target[i];
      this.alpha[i] = a;
      if (D[i * 4] !== a || D[i * 4 + 1] !== this.flip[i]) { D[i * 4] = a; D[i * 4 + 1] = this.flip[i]; dirty = true; }
    }
    if (dirty) this.labelTex.needsUpdate = true;
  }

  _capsHit(i, j) {
    const s = this.scr, lim = this.rad[i] + this.rad[j], lim2 = lim * lim;
    for (let a = 0; a < SAMPLES - 1; a++) {
      const ai = (i * SAMPLES + a) * 2;
      for (let b = 0; b < SAMPLES - 1; b++) {
        const bj = (j * SAMPLES + b) * 2;
        if (segDist2(s[ai], s[ai + 1], s[ai + 2], s[ai + 3], s[bj], s[bj + 1], s[bj + 2], s[bj + 3]) < lim2) return true;
      }
    }
    return false;
  }

  dispose() {
    this.disposed = true;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material.dispose();
      this.atlasTex.dispose();
      this.labelTex.dispose();
      this.mesh = null;
    }
    this.ready = false;
  }
}

// squared distance between segments p1p2 and q1q2 (2D), after Eberly / softSurfer
function segDist2(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
  const ux = p2x - p1x, uy = p2y - p1y, vx = q2x - q1x, vy = q2y - q1y, wx = p1x - q1x, wy = p1y - q1y;
  const a = ux * ux + uy * uy, b = ux * vx + uy * vy, c = vx * vx + vy * vy, d = ux * wx + uy * wy, e = vx * wx + vy * wy;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; } else {
    sN = b * e - c * d; tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    const m = b - d;
    if (m < 0) sN = 0; else if (m > a) sN = sD; else { sN = m; sD = a; }
  }
  const sc = sD > 0 && Math.abs(sN) > 1e-12 ? sN / sD : 0;
  const tc = tD > 0 && Math.abs(tN) > 1e-12 ? tN / tD : 0;
  const dx = wx + sc * ux - tc * vx, dy = wy + sc * uy - tc * vy;
  return dx * dx + dy * dy;
}
export { segDist2 as _segDist2 };
