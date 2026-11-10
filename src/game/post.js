import * as THREE from 'three';

// Render-scale upscaler — our stand-in for DLSS, which only works in native DirectX 12 / Vulkan engines.
// The scene is drawn into a smaller multisampled target and brought up to the screen in two passes after AMD
// FidelityFX Super Resolution 1 (EASU + RCAS, MIT — notice below, data/ATTRIBUTION.md):
//  * EASU, edge-adaptive spatial upsampling: per screen pixel a 12-tap Lanczos-like kernel, stretched along the local
//    edge direction and clamped to the 4 nearest scene pixels — coasts, border lines and letters stay crisp, no halos;
//  * RCAS, robust contrast-adaptive sharpening at screen resolution: limited so it never overshoots the 4 neighbours
//    (no ringing) and damped where the pixels look like noise (the stipple keeps its grain, not amplified).
// EASU + RCAS cost a 2-CU integrated GPU ~4.6 ms at 1920x1200 (the old filter 0.84 ms), a discrete one a fraction of
// a millisecond: they run on discrete GPUs; integrated ones get a one-pass light filter (LITE_FRAG, ~1.3 ms there). At scale 1 the scene goes straight to the canvas — no passes; with brightness ≠ 1,
// one pass applies it. ?upscale=0 keeps the old filter (a bilinear stretch with a cross sharpen), ?upscale=fsr|lite
// forces a tier — for before/after comparisons.
//
// Program sharing: three keys a program by its output colour space, which is the renderer's outputColorSpace on the
// canvas and the working (linear) space in a render target. main.js sets outputColorSpace to linear, so both paths
// use the same programs — no shader compiles when the dynamic resolution moves between 100% and below — and they
// also look the same (before, three converted to sRGB on the canvas only: the space around the globe was grey at
// 100% and near-black below it). Nothing in the map relies on that conversion: its shaders write display colours.

/*! @license FidelityFX Super Resolution 1.0 (EASU, RCAS), ported to GLSL in Passionaris src/game/post.js
 * Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS
 * OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */

const VERT = /* glsl */`out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// uTex holds the picture in texels [0, uIn) (bottom-left origin, like gl_FragCoord); fetches are clamped to it
const COMMON = /* glsl */`
  precision highp float; precision highp int;
  uniform sampler2D uTex; uniform vec2 uIn; uniform float uBright;
  in vec2 vUv; layout(location = 0) out vec4 o;
  vec3 tap(ivec2 p) { return texelFetch(uTex, clamp(p, ivec2(0), ivec2(uIn) - 1), 0).rgb; }
  float luma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }   // luma x2, as in FSR`;

// EASU. Taps around the 2x2 quad f g / j k nearest to the output pixel's position in the input:
//      b c
//    e f g h
//    i j k l
//      n o
const EASU_FRAG = /* glsl */`${COMMON}
  uniform vec2 uOut;
  // edge direction and strength from the '+' around one quad corner (C), weighted by its bilinear weight w
  void easuSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
    float dirX = lD - lB, dirY = lE - lA;
    float lenX = clamp(abs(dirX) / max(max(abs(lD - lC), abs(lC - lB)), 1e-5), 0.0, 1.0);
    float lenY = clamp(abs(dirY) / max(max(abs(lE - lC), abs(lC - lA)), 1e-5), 0.0, 1.0);
    dir += vec2(dirX, dirY) * w;
    len += (lenX * lenX + lenY * lenY) * w;
  }
  // one tap of the rotated, anisotropic Lanczos-2 approximation (no sin / sqrt): base * window
  void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len2;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
    wB *= wB; wA *= wA;
    float w = (1.5625 * wB - 0.5625) * wA;
    aC += c * w; aW += w;
  }
  void main() {
    vec2 pp = (floor(gl_FragCoord.xy) + 0.5) * (uIn / uOut) - 0.5;
    vec2 fp = floor(pp); pp -= fp;
    ivec2 p = ivec2(fp);
    vec3 bC = tap(p + ivec2(0, -1)), cC = tap(p + ivec2(1, -1));
    vec3 eC = tap(p + ivec2(-1, 0)), fC = tap(p), gC = tap(p + ivec2(1, 0)), hC = tap(p + ivec2(2, 0));
    vec3 iC = tap(p + ivec2(-1, 1)), jC = tap(p + ivec2(0, 1)), kC = tap(p + ivec2(1, 1)), lC = tap(p + ivec2(2, 1));
    vec3 nC = tap(p + ivec2(0, 2)), oC = tap(p + ivec2(1, 2));
    float bL = luma(bC), cL = luma(cC), eL = luma(eC), fL = luma(fC), gL = luma(gC), hL = luma(hC);
    float iL = luma(iC), jL = luma(jC), kL = luma(kC), lL = luma(lC), nL = luma(nC), oL = luma(oC);
    vec2 dir = vec2(0.0); float len = 0.0;
    easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    easuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    easuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    easuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
    float dirR = dot(dir, dir);
    dir = dirR < 1.0 / 32768.0 ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);
    len = len * 0.5; len *= len;   // {0..2} -> {0..1}, shaped
    // stretch along the edge: 1 on axis-aligned edges, sqrt(2) on diagonals; squeeze across it
    float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;   // the window widens from sqrt(2) to ~2 on edges
    float clp = 1.0 / lob;
    vec3 aC = vec3(0.0); float aW = 0.0;
    easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
    easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
    easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, iC);
    easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
    easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
    easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
    easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
    easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, lC);
    easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
    easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
    easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
    easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, nC);
    // dering: stay within the 4 nearest input pixels
    vec3 mn = min(min(fC, gC), min(jC, kC)), mx = max(max(fC, gC), max(jC, kC));
    o = vec4(clamp(clamp(aC / max(aW, 1e-4), mn, mx) * uBright, 0.0, 1.0), 1.0);
  }`;

// RCAS on the '+' around each pixel:   b
//                                    d e f
//                                      h
const RCAS_FRAG = /* glsl */`${COMMON}
  uniform float uSharp;   // 0..1 (FSR's exp2(-stops))
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 b = tap(p + ivec2(0, -1)), d = tap(p + ivec2(-1, 0)), e = tap(p), f = tap(p + ivec2(1, 0)), h = tap(p + ivec2(0, 1));
    vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
    // the strongest negative lobe that keeps the result within [min, max] of the ring
    vec3 hitMin = min(mn4, e) / max(4.0 * mx4, 1e-4);
    vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * min(mn4, e) - 4.0, -1e-4);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;
    // noise: a centre unlike its whole ring is grain (stipple, dither), sharpened half as much
    float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
    float range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
    float nz = clamp(abs(0.25 * (bL + dL + fL + hL) - eL) / max(range, 1e-4), 0.0, 1.0);
    lobe *= 1.0 - 0.5 * nz;
    vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
    o = vec4(clamp(c * uBright, 0.0, 1.0), 1.0);
  }`;

// The light tier, one pass: on a 2-CU integrated GPU EASU + RCAS cost ~4.6 ms at 1920x1200 (EASU alone 3.5), this
// ~1.3 ms (the old filter 0.84). A sharp Keys cubic (Catmull-Rom at uSharp 0, tighter above) through 5 bilinear
// taps, clamped to the 2x2 input pixels around the point as EASU does — crisp lines and letters, no halos, no
// overshoot. Not edge-directed: a trustworthy edge direction needs EASU's 12-tap analysis, which is the cost.
// (Steepening the bilinear across 2x2 steps was tried: cheaper, 0.7 ms, but it turns coasts and letters into
// pixel stairs.)
const LITE_FRAG = /* glsl */`${COMMON}
  uniform vec2 uOut; uniform vec2 uSize; uniform float uSharp;   // output size; allocated texture size; 0..1
  void main() {
    vec2 tx = 1.0 / uSize, lo = vec2(0.5), hi = uIn - 0.5;
    vec2 uv = (floor(gl_FragCoord.xy) + 0.5) * (uIn / uOut);   // in input texels, texel centres at +0.5
    vec2 b = floor(uv - 0.5), tc = b + 0.5, t = uv - tc;       // the 2x2's lower-left texel and centre; position in it
    float a = -0.5 - 0.5 * uSharp;
    vec2 t2 = t * t, t3 = t2 * t;
    vec2 w0 = a * (t3 - 2.0 * t2 + t), w1 = (a + 2.0) * t3 - (a + 3.0) * t2 + 1.0;
    vec2 w2 = (2.0 * a + 3.0) * t2 - (a + 2.0) * t3 - a * t, w3 = a * (t2 - t3);
    vec2 w12 = w1 + w2;
    vec2 p12 = clamp(tc + w2 / w12, lo, hi) * tx, p0 = clamp(tc - 1.0, lo, hi) * tx, p3 = clamp(tc + 2.0, lo, hi) * tx;
    float k0 = w12.x * w0.y, k1 = w0.x * w12.y, k2 = w12.x * w12.y, k3 = w3.x * w12.y, k4 = w12.x * w3.y;
    vec3 c = (texture(uTex, vec2(p12.x, p0.y)).rgb * k0 + texture(uTex, vec2(p0.x, p12.y)).rgb * k1 + texture(uTex, p12).rgb * k2
      + texture(uTex, vec2(p3.x, p12.y)).rgb * k3 + texture(uTex, vec2(p12.x, p3.y)).rgb * k4) / (k0 + k1 + k2 + k3 + k4);
    ivec2 p = clamp(ivec2(b), ivec2(0), max(ivec2(uIn) - 2, ivec2(0)));   // one clamp for the 2x2 (shifts at the rim)
    vec3 f = texelFetch(uTex, p, 0).rgb, g = texelFetch(uTex, p + ivec2(1, 0), 0).rgb;
    vec3 j = texelFetch(uTex, p + ivec2(0, 1), 0).rgb, k = texelFetch(uTex, p + ivec2(1, 1), 0).rgb;
    c = clamp(c, min(min(f, g), min(j, k)), max(max(f, g), max(j, k)));
    o = vec4(clamp(c * uBright, 0.0, 1.0), 1.0);
  }`;

// 1:1 with brightness (scale 100%, brightness ≠ 1, light tier)
const COPY_FRAG = /* glsl */`${COMMON}
  void main() { o = vec4(clamp(tap(ivec2(gl_FragCoord.xy)) * uBright, 0.0, 1.0), 1.0); }`;

// the old filter (?upscale=0): bilinear stretch + a contrast-adaptive cross sharpen at the input's texel size
const LEGACY_FRAG = /* glsl */`${COMMON}
  uniform vec2 uSize; uniform float uSharpen;   // allocated texture size; strength
  void main() {
    vec2 tx = 1.0 / uSize, lo = 0.5 * tx, hi = (uIn - 0.5) * tx;
    vec2 uv = vUv * uIn * tx;
    vec3 c = texture(uTex, clamp(uv, lo, hi)).rgb;
    vec3 n = texture(uTex, clamp(uv + vec2(0.0, tx.y), lo, hi)).rgb, s = texture(uTex, clamp(uv - vec2(0.0, tx.y), lo, hi)).rgb;
    vec3 e = texture(uTex, clamp(uv + vec2(tx.x, 0.0), lo, hi)).rgb, w = texture(uTex, clamp(uv - vec2(tx.x, 0.0), lo, hi)).rgb;
    vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
    vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
    float wgt = -uSharpen * 0.2 * sqrt(dot(amp, vec3(1.0 / 3.0)));
    vec3 r = (c + wgt * (n + s + e + w)) / (1.0 + 4.0 * wgt);
    o = vec4(clamp(r * uBright, 0.0, 1.0), 1.0);
  }`;

// GPU time of each frame through EXT_disjoint_timer_query_webgl2: one query from the frame's start to the end of the
// scene, one for the upscale passes (queries cannot nest). Results come 2-3 frames later; frames the driver flags as
// disjoint (clock change, power state) are dropped. Without the extension, or with ?gputimer=0, it stays silent.
class GpuTimer {
  constructor(gl, enabled = true) {
    this.gl = gl;
    this.ext = enabled ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.free = []; this.pending = []; this.frame = null; this.open = false;
    this.scene = 0; this.post = 0; this.total = 0;   // ms, the last finished frame
    this.fresh = 0;                                  // finished frames read by the last poll
  }
  // at a frame's start: read what finished, open this frame's scene query
  begin() {
    this.poll();
    if (!this.ext) return;
    if (this.open) this.end();                       // a frame cut short (an exception): close it
    if (this.pending.length > 8) return;             // results stopped coming: do not pile up queries
    this.frame = [];
    this.next();
  }
  // close the open query and open the next section's
  next() {
    if (!this.frame) return;
    const gl = this.gl;
    if (this.open) gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const q = this.free.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.frame.push(q); this.open = true;
  }
  end() {
    if (!this.frame) return;
    if (this.open) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.frame);
    this.frame = null; this.open = false;
  }
  poll() {
    this.fresh = 0;
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl, disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const f = this.pending[0];
      if (!gl.getQueryParameter(f[f.length - 1], gl.QUERY_RESULT_AVAILABLE)) break;   // queries finish in order
      this.pending.shift();
      const ms = f.map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      this.free.push(...f);
      if (disjoint) continue;
      this.scene = ms[0]; this.post = ms[1] || 0; this.total = this.scene + this.post;
      this.log?.push(ms);   // checks: an array set from outside collects every frame
      this.fresh++;
    }
  }
}

export class Upscaler {
  // samples: MSAA of the internal target. 4 costs a weak integrated GPU ~4 ms more per frame than 2 (every pass
  // writes and blends 4 samples per pixel) for a hardly visible difference: the map's lines and coasts are
  // anti-aliased in the shaders, MSAA only smooths mesh silhouettes, rivers and roads.
  constructor(renderer, { samples = 4, mode = 'auto', gpuTimer = true } = {}) {
    this.renderer = renderer;
    this.samples = samples;
    // 'auto' (autoTier: set by main.js from the GPU class) | 'fsr' (EASU + RCAS) | 'lite' (one pass, see LITE_FRAG) |
    // 'legacy' (?upscale=0: the filter before v0.2.2)
    this.mode = mode;
    this.autoTier = 'fsr';
    this.target = null;          // the scene's MSAA target; the scene draws into its lower-left view (w x h)
    this.alloc = 0;              // the share of the screen the target is allocated for (steps of 0.1)
    this.mid = null;             // EASU's output at screen size, read by RCAS
    this.view = new THREE.Vector2();
    this.size = new THREE.Vector2();
    this.path = 'canvas';        // what the last frame did: 'canvas' | 'easu+rcas' | 'easu' | 'rcas' | 'lite' | 'copy' | 'legacy'
    this.timer = new GpuTimer(renderer.getContext(), gpuTimer);
    const mat = (frag, extra = {}) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: null }, uIn: { value: new THREE.Vector2(1, 1) }, uBright: { value: 1 }, ...extra },
    });
    this.easu = mat(EASU_FRAG, { uOut: { value: new THREE.Vector2(1, 1) } });
    this.rcas = mat(RCAS_FRAG, { uSharp: { value: 0.5 } });
    this.lite = mat(LITE_FRAG, { uOut: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.35 } });
    this.copy = mat(COPY_FRAG);
    this.legacy = mat(LEGACY_FRAG, { uSize: { value: new THREE.Vector2(1, 1) }, uSharpen: { value: 0.35 } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const quad = m => { const q = new THREE.Mesh(g, m); q.frustumCulled = false; return q; };
    this.quad = quad(this.easu);
    this.quadScene = new THREE.Scene().add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // every pass's material, for compileAsync while the world loads (main.js warmUp)
    this.compileScene = new THREE.Scene().add(...this.materials().map(quad));
  }

  // renderScale: share of the drawing buffer actually rendered, 0.25..1 (a chosen resolution below the screen's
  // times the dynamic / fixed render scale — see main.js); never above 1 (no supersampling).
  // The target the scene is drawn into for these settings, or null when it goes straight to the canvas.
  prepare(renderScale = 1, brightness = 1) {
    const scale = Math.max(0.25, Math.min(1, renderScale));
    if (scale >= 0.999 && Math.abs(brightness - 1) < 0.01) return null;
    return this.reserve(scale);
  }

  // The target for a scale, (re)made when needed. It is allocated in steps of 1/10 of the screen and the scene draws
  // into a view of it, so the dynamic resolution's small steps do not reallocate ~30-130 MB of MSAA buffers each time:
  // it grows at once (one step ahead), shrinks only once it is two steps too large (its MSAA resolve covers it all).
  reserve(scale) {
    const r = this.renderer, size = r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(size.x * scale)), h = Math.max(1, Math.round(size.y * scale));
    const want = Math.min(1, Math.ceil(scale * 10 - 1e-6) / 10);
    const t = this.target;
    const stale = !t || t.samples !== this.samples || this.bufW !== size.x || this.bufH !== size.y;
    if (stale || t.width < w || t.height < h || this.alloc - want > 0.15) {
      const grow = !stale && this.alloc < want;
      this.alloc = grow ? Math.min(1, want + 0.1) : want;
      this.bufW = size.x; this.bufH = size.y;
      const W = Math.max(w, Math.round(size.x * this.alloc)), H = Math.max(h, Math.round(size.y * this.alloc));
      t?.dispose();
      // the depth is never read back: no depth resolve after the MSAA pass (saves a full-screen copy per frame)
      this.target = new THREE.WebGLRenderTarget(W, H, {
        samples: this.samples, type: THREE.UnsignedByteType, depthBuffer: true,
        resolveDepthBuffer: false, storeMultisampledDepthBuffer: false,
      });
      this.target.texture.minFilter = THREE.LinearFilter; this.target.texture.magFilter = THREE.LinearFilter;
      this.target.texture.generateMipmaps = false;
    }
    this.target.viewport.set(0, 0, w, h);
    this.view.set(w, h);
    return this.target;
  }

  // EASU's output at screen size
  midTarget(W, H) {
    if (!this.mid || this.mid.width !== W || this.mid.height !== H) {
      this.mid?.dispose();
      this.mid = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, type: THREE.UnsignedByteType });
      this.mid.texture.minFilter = this.mid.texture.magFilter = THREE.NearestFilter;
      this.mid.texture.generateMipmaps = false;
    }
    return this.mid;
  }

  materials() { return [this.easu, this.rcas, this.lite, this.copy, this.legacy]; }

  // the filter in use ('auto' resolved)
  tier() { return this.mode === 'auto' ? this.autoTier : this.mode; }

  // sharpen setting (0..1, default 0.35) → RCAS strength
  static rcasAmount(sharpen) { return Math.max(0, Math.min(1, (Number(sharpen) || 0) * 1.6)); }

  // GPU timing of the frame (call at the frame's start, before anything draws)
  beginFrame() { this.timer.begin(); }

  pass(mat, src, w, h, dst) {
    const r = this.renderer;
    mat.uniforms.uTex.value = src.texture;
    mat.uniforms.uIn.value.set(w, h);
    this.quad.material = mat;
    r.setRenderTarget(dst);
    r.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, { renderScale = 1, sharpen = 0.35, brightness = 1 } = {}) {
    const r = this.renderer;
    const target = this.prepare(renderScale, brightness);
    if (!target) {
      r.setRenderTarget(null); r.render(scene, camera);
      this.path = 'canvas'; this.timer.end();
      return;
    }
    r.setRenderTarget(target);
    r.render(scene, camera);
    this.timer.next();
    const { x: w, y: h } = this.view, out = r.getDrawingBufferSize(this.size), W = out.x, H = out.y;
    const upscaling = w < W || h < H, amount = Upscaler.rcasAmount(sharpen), tier = this.tier();
    const autoClear = r.autoClear;
    r.autoClear = false;   // every pass covers the whole output
    if (tier === 'lite') {
      const m = upscaling ? this.lite : this.copy;
      if (upscaling) {
        m.uniforms.uOut.value.set(W, H); m.uniforms.uSize.value.set(target.width, target.height);
        m.uniforms.uSharp.value = Math.max(0, Math.min(1, Number(sharpen) || 0));
      }
      m.uniforms.uBright.value = brightness;
      this.pass(m, target, w, h, null);
      this.path = upscaling ? 'lite' : 'copy';
    } else if (tier === 'legacy') {
      const u = this.legacy.uniforms;
      u.uSize.value.set(target.width, target.height);
      u.uSharpen.value = upscaling ? sharpen : sharpen * 0.4;
      u.uBright.value = brightness;
      this.pass(this.legacy, target, w, h, null);
      this.path = 'legacy';
    } else if (!upscaling) {
      this.rcas.uniforms.uSharp.value = amount * 0.4; this.rcas.uniforms.uBright.value = brightness;
      this.pass(this.rcas, target, w, h, null);
      this.path = 'rcas';
    } else {
      this.easu.uniforms.uOut.value.set(W, H);
      if (amount < 0.01) {
        this.easu.uniforms.uBright.value = brightness;
        this.pass(this.easu, target, w, h, null);
        this.path = 'easu';
      } else {
        const mid = this.midTarget(W, H);
        this.easu.uniforms.uBright.value = 1;
        this.pass(this.easu, target, w, h, mid);
        this.rcas.uniforms.uSharp.value = amount; this.rcas.uniforms.uBright.value = brightness;
        this.pass(this.rcas, mid, W, H, null);
        this.path = 'easu+rcas';
      }
    }
    r.autoClear = autoClear;
    this.timer.end();
  }

  // Behind the loading screen: allocate the targets for the expected scale (or for a first step below 100%) and draw
  // every pass once. Besides the compile (main.js warmUp), three's first use of a program asks the GPU process for its
  // logs — a blocking round trip; and a new MSAA target's memory is committed at its first draw. Done here, neither
  // lands on the frame where the dynamic resolution first leaves 100%.
  warm(scale = 1) {
    const r = this.renderer, prev = r.getRenderTarget(), autoClear = r.autoClear;
    try {
      const t = this.reserve(Math.min(0.95, Math.max(0.25, scale)));
      r.setRenderTarget(t); r.clear();
      if (this.tier() === 'fsr') {   // EASU's output target: only the FSR filter has two passes
        const out = r.getDrawingBufferSize(this.size);
        r.setRenderTarget(this.midTarget(out.x, out.y)); r.clear();
      }
      const tiny = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
      r.autoClear = false;
      this.easu.uniforms.uOut.value.set(4, 4);
      this.lite.uniforms.uOut.value.set(4, 4); this.lite.uniforms.uSize.value.set(t.width, t.height);
      for (const m of this.materials()) this.pass(m, t, 2, 2, tiny);
      tiny.dispose();
    } catch (e) { console.warn('upscaler warm-up', e); }
    r.autoClear = autoClear;
    r.setRenderTarget(prev);
  }
}
