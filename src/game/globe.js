import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_FRAG, RIVER_VERT, RIVER_FRAG, ATMO_VERT, ATMO_FRAG } from './shaders.js';
import { makeHeightTexture, makeCellTexture, makeInfoTexture, makeColorTexture, INFO_W } from './data.js';
export { INFO_W };
import { getPalette } from '../shared/palettes.js';

const QUALITY = {
  low: { az: 512, rings: 300 },
  medium: { az: 768, rings: 480 },
  high: { az: 1280, rings: 720 },
};

function dummyU8() {
  const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedIntegerFormat, THREE.UnsignedByteType);
  t.internalFormat = 'R8UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
function dummyHalf() {
  const t = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
  t.internalFormat = 'R16F'; t.needsUpdate = true;
  return t;
}
function dummyRGBA(b = 128) {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, b, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}
// equirectangular data layer (SIM grid etc.), linear filtering, wraps in longitude
export function makeLayerTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

// era climate statistics (src/sim/climate/era.js): an RGBA16F array texture, one layer per group of statistics
function dummyClimate(layers = 4) {
  const t = new THREE.DataArrayTexture(new Uint16Array(4 * layers), 1, 1, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.internalFormat = 'RGBA16F';
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
// value-noise lattice for the terrain shader (shaders.js vnoise): n x n RG8 random bytes, bilinear, tiling.
// Deterministic (xorshift32), so captures and the look do not change between runs.
function makeNoiseTexture(n = 512) {
  const d = new Uint8Array(n * n * 2);
  let s = 0x2545f491;
  for (let i = 0; i < d.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = s >>> 24; }
  const t = new THREE.DataTexture(d, n, n, THREE.RGFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
function dummyR8() {
  const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

// map modes: id -> shader index (6 Köppen climate, 7 fertility, 8 weather today, 10 air, 11 winds and currents)
export const MODE_INDEX = {
  relief: 0, terrain: 1, temperature: 2, precipitation: 3, hazards: 4, regions: 5, koppen: 6, fertility: 7, weather: 8,
  political: 9, air: 10, winds: 11,
};

// Polar grid in (t, azimuth). Ring r keeps n(r) = min(nAz, max(6, ceil(2*PI*r))) azimuthal steps: near the centre
// a ring of nAz steps would be far denser around than the ring spacing (sub-pixel slivers under the camera, where
// the costly terrain shader then runs ~2x per pixel in partly covered 2x2 quads). With n(r) ~ 2*PI*r the cells are
// about square there (ring spacing is ~a*b/nRings near t = 0 at every zoom), the same as or denser than the radial
// resolution, so the relief keeps its detail. Neighbouring rings are joined by a zipper of triangles (no cracks).
function polarGrid(nAz, nRings) {
  const counts = new Int32Array(nRings + 1), start = new Int32Array(nRings + 1);
  let verts = 0, tris = 0;
  for (let r = 0; r <= nRings; r++) {
    counts[r] = Math.min(nAz, Math.max(6, Math.ceil(2 * Math.PI * r)));
    start[r] = verts; verts += counts[r] + 1;   // +1: the closing vertex at az = 2*PI (seam of the azimuth)
    if (r > 0) tris += counts[r - 1] + counts[r];
  }
  const pos = new Float32Array(verts * 3);
  let o = 0;
  for (let r = 0; r <= nRings; r++) {
    const n = counts[r];
    for (let a = 0; a <= n; a++) { pos[o++] = r / nRings; pos[o++] = (a / n) * Math.PI * 2; pos[o++] = 0; }
  }
  const idx = new Uint32Array(tris * 3);
  o = 0;
  for (let r = 0; r < nRings; r++) {
    const n0 = counts[r], n1 = counts[r + 1], s0 = start[r], s1 = start[r + 1];
    // advance on the ring whose next vertex comes first in azimuth; same winding as a regular grid
    // (inner, outer, inner+1) / (inner, outer, outer+1)
    let i = 0, j = 0;
    while (i < n0 || j < n1) {
      if (j >= n1 || (i < n0 && (i + 1) * n1 <= (j + 1) * n0)) { idx[o++] = s0 + i; idx[o++] = s1 + j; idx[o++] = s0 + i + 1; i++; }
      else { idx[o++] = s0 + i; idx[o++] = s1 + j; idx[o++] = s1 + j + 1; j++; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export class Globe {
  constructor(scene, renderer, data, settings) {
    this.data = data;
    this.settings = settings;
    this.renderer = renderer;
    this.scene = scene;
    this.variants = new Map();   // compile-time variants of the terrain shader (pickVariant)
    const { W, H, world } = data;

    this.overlayBase = 0.6;   // strength of the regions / political colour overlay
    this.heightTex = makeHeightTexture(data.height, W, H);
    this.cellTex = makeCellTexture(data.cells, W, H);
    this.infoTex = makeInfoTexture(world);
    this.colorTex = makeColorTexture(world);
    data.albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
    data.albedo.wrapS = THREE.RepeatWrapping;
    data.albedo.flipY = false; // row 0 = north, like every other map layer
    data.albedo.needsUpdate = true;

    const q = QUALITY[settings.qualityResolved || settings.quality] || QUALITY.high;
    this.rings = q.rings;
    const pal = getPalette(settings.palette).map;
    const col = c => new THREE.Color(c[0], c[1], c[2]);

    this.shared = {
      uF: { value: new THREE.Vector3(0, 0, 1) },
      uR: { value: new THREE.Vector3(1, 0, 0) },
      uU: { value: new THREE.Vector3(0, 1, 0) },
      uCurv: { value: 1 },
      uExag: { value: 20 / 6371000 },
      uHeight: { value: this.heightTex },
      uGrid: { value: new THREE.Vector2(W, H) },
      uDetail: { value: dummyHalf() },
      uDetailOrigin: { value: new THREE.Vector2(0, 0) },
      uDetailOn: { value: 0 },
      uDetailMask: { value: dummyRGBA() },
    };

    this.terrainMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: {
        ...this.shared,
        uRingA: { value: 1 }, uRingB: { value: 1 }, uRings: { value: q.rings },
        uAlbedo: { value: data.albedo },
        uCells: { value: this.cellTex },
        uInfo: { value: this.infoTex },
        uColor: { value: this.colorTex },
        uInfoW: { value: INFO_W },
        uHover: { value: 0 },
        uLineSea: { value: 0 },
        uSelected: { value: 0 },
        uOverlay: { value: 1 },
        uShadeK: { value: 6 },
        uGlobe: { value: 1 },
        uLineProv: { value: 1 },
        uLineDist: { value: 1 },
        uLineCountry: { value: 1 },
        uTime: { value: 0 },
        uSunView: { value: new THREE.Vector3(0, 0, 1) },
        uFogNear: { value: 10 }, uFogFar: { value: 20 }, uFogAmt: { value: 0 },
        uFogColor: { value: col(pal.haze) },
        uPaper: { value: col(pal.paper) }, uPaperDark: { value: col(pal.paperDark) },
        uForest: { value: col(pal.forest) }, uDesert: { value: col(pal.desert) }, uSnow: { value: col(pal.snow) },
        uShallow: { value: col(pal.shallow) }, uDeep: { value: col(pal.deep) }, uLake: { value: col(pal.lake) },
        uInk: { value: col(pal.ink) }, uSelectC: { value: col(pal.select) },
        uContour: { value: 500 }, uContourAmt: { value: 0 },
        uMode: { value: 1 },
        uBiome: { value: dummyU8() }, uHasBiome: { value: 0 },
        uBiomeCol: { value: Array.from({ length: 16 }, () => new THREE.Color(0.8, 0.78, 0.7)) },
        uSim: { value: dummyRGBA() }, uHasSim: { value: 0 },
        uWeather: { value: dummyRGBA() }, uHasWeather: { value: 0 },
        uCloudAmt: { value: 1 },
        // zoom response of clouds and aerosols (set in update): bodies crisp from orbit, a tone up close
        uCloudVis: { value: 1 }, uCloudTone: { value: 0 }, uCloudCrisp: { value: 1 },
        // aerosol layer (src/game/world/aerosols.js): 360x180 RGBA ash/smoke/dust/sulphate + ground deposit
        uAero: { value: dummyRGBA(0) }, uAeroGround: { value: dummyRGBA(0) }, uHasAero: { value: 0 },
        uAeroAmt: { value: 0 }, uAeroVis: { value: 1 }, uAeroLag: { value: 0 }, uItcz: { value: 1 },
        // climate / fertility map modes: era statistics (720x360 x4 RGBA16F) and the fresh-water raster (R8)
        uClim: { value: dummyClimate() }, uHasClim: { value: 0 },
        uWater: { value: dummyR8() }, uHasWater: { value: 0 },
        uNeedInfo: { value: 0 },
        uNoise: { value: makeNoiseTexture() },
      },
    });
    this.terrainNear = new THREE.Mesh(polarGrid(q.az, q.rings), this.terrainMat);
    this.terrainNear.frustumCulled = false;
    scene.add(this.terrainNear);
    // at globe distance the dense grid makes ~1 triangle per pixel (GPU quad waste): a 7x lighter grid looks the same
    this.farRings = 200;
    this.terrainFar = new THREE.Mesh(polarGrid(384, this.farRings), this.terrainMat);
    this.terrainFar.frustumCulled = false;
    this.terrainFar.visible = false;
    scene.add(this.terrainFar);
    this.terrain = this.terrainNear;

    // rivers (vector, Natural Earth centre lines)
    const segs = data.rivers, ranks = data.riverRank;
    const n = ranks.length;
    // sorted by rank so that a zoom level draws only a prefix (drawRange) instead of discarding in the shader
    const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => ranks[p] - ranks[q]);
    const rp = new Float32Array(n * 2 * 3);
    this.riverRankEnd = new Int32Array(16).fill(n * 2);
    order.forEach((s, k) => {
      rp.set([segs[s * 4], segs[s * 4 + 1], ranks[s], segs[s * 4 + 2], segs[s * 4 + 3], ranks[s]], k * 6);
    });
    for (let r = 0; r < 16; r++) { let k = 0; while (k < n && ranks[order[k]] <= r) k++; this.riverRankEnd[r] = k * 2; }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.riverMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: RIVER_VERT,
      fragmentShader: RIVER_FRAG,
      uniforms: { ...this.shared, uLift: { value: 0 }, uMaxRank: { value: 6 }, uOpacity: { value: 0.85 }, uRiverC: { value: col(pal.river) } },
      transparent: true,
      depthWrite: false,
    });
    this.rivers = new THREE.LineSegments(rg, this.riverMat);
    this.rivers.frustumCulled = false;
    this.rivers.renderOrder = 2;
    scene.add(this.rivers);

    // atmosphere halo
    this.atmoMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { uOpacity: { value: 1 }, uHaloC: { value: col(pal.haze) } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 48), this.atmoMat);
    scene.add(this.atmo);
  }

  // 'full' | 'simple': simple = 3-tap hillshade, no sea ripples / isobaths, flat cloud edges (weak GPUs)
  setShaders(kind) {
    const simple = kind === 'simple';
    if (!!this.terrainMat.defines.SIMPLE === simple) return;
    if (simple) this.terrainMat.defines.SIMPLE = 1; else delete this.terrainMat.defines.SIMPLE;
    this.terrainMat.needsUpdate = true;
  }

  // ---- terrain shader variants. The generic material (terrainMat) switches its blocks with uniforms; a variant
  // fixes the map mode and which layers are on (weather, clouds, aerosols, detail window) as constants (V_* defines in
  // shaders.js), so the GPU runs only the code that can show — ~10-25% faster on weak GPUs. Variants share
  // terrainMat.uniforms, are compiled in the background (KHR_parallel_shader_compile through compileAsync) and drawn
  // once ready; until then the generic material draws the same picture.
  variantKey() {
    const u = this.terrainMat.uniforms;
    // bits 0-7 the map mode (MODE_INDEX), then: weather, clouds, aerosols, no detail window, simple shaders
    return (u.uMode.value & 255) | (u.uHasWeather.value > 0.5 ? 256 : 0) | (u.uCloudAmt.value > 0 ? 512 : 0)
      | (u.uHasAero.value > 0.5 ? 1024 : 0) | (this.shared.uDetailOn.value < 0.5 ? 2048 : 0) | (this.terrainMat.defines.SIMPLE ? 4096 : 0);
  }
  // without parallel compiles a variant would compile on the main thread (a hitch at every first switch to a mode):
  // the generic material is kept then; noVariants = true also forces it (?novariants, checks)
  useVariants() {
    if (this.noVariants === undefined) this.noVariants = !this.renderer?.extensions?.has?.('KHR_parallel_shader_compile');
    return !this.noVariants;
  }
  variant(key, camera) {
    let v = this.variants.get(key);
    if (v || !this.renderer?.compileAsync || this.compiling >= 2) return v;   // at most two compiles at a time
    const defines = { ...this.terrainMat.defines, V_MODE: key & 255, V_WX: key & 256 ? '1.0' : '0.0', V_CLOUD: key & 512 ? '1.0' : '0.0', V_AERO: key & 1024 ? '1.0' : '0.0' };
    if (key & 2048) defines.V_NODETAIL = 1;
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.terrainMat.uniforms, defines });
    v = { mat, ready: false };
    this.variants.set(key, v);
    this.compiling = (this.compiling || 0) + 1;
    const done = () => { this.compiling--; };
    this.compileAsync(new THREE.Mesh(this.terrainNear.geometry, mat), camera)
      .then(() => { v.ready = this.firstUse(mat); done(); }, e => { console.warn('terrain variant', e); done(); });
    return v;
  }
  // renderer.compileAsync with the render target the scene is drawn into bound (compileTarget, set by main.js:
  // the upscaler's target or null for the canvas), so the program is the one the frame will use
  compileAsync(object, camera) {
    const r = this.renderer, prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.compileTarget?.() ?? null);
      return r.compileAsync(object, camera, this.scene);
    } catch (e) { return Promise.reject(e); } finally { r.setRenderTarget(prev); }
  }
  // three's first use of a program asks the GPU process for its info logs: a blocking round trip that waits behind
  // the frames in flight (~50-180 ms on a busy weak GPU — a visible hitch at the first switch to a mode). Done here,
  // off the frame, with the link status checked instead (the generic material, same source, keeps the full check).
  // A variant that did not link is never drawn.
  firstUse(mat) {
    const r = this.renderer, gl = r.getContext(), prog = r.properties.get(mat).currentProgram;
    if (!prog || !gl.getProgramParameter(prog.program, gl.LINK_STATUS)) { console.warn('terrain variant: link failed', mat.defines); return false; }
    const check = r.debug.checkShaderErrors;
    r.debug.checkShaderErrors = false;
    try { prog.getUniforms(); prog.getAttributes(); } finally { r.debug.checkShaderErrors = check; }
    return true;
  }
  // per frame (end of update): the variant for the current state when it is ready, else the generic material
  pickVariant(camera) {
    const v = this.useVariants() ? this.variant(this.variantKey(), camera) : null;
    const mat = v?.ready ? v.mat : this.terrainMat;
    if (this.terrainNear.material !== mat) { this.terrainNear.material = mat; this.terrainFar.material = mat; }
  }
  // warm-up while the world loads: the generic material and the variants of a typical start (terrain mode with
  // weather and clouds, with and without the detail window) compile in parallel with the loading work
  precompile(camera) {
    if (!this.renderer?.compileAsync) return;
    this.compileAsync(this.terrainNear, camera).catch(() => {});   // the generic material
    if (this.useVariants()) for (const key of [1 | 256 | 512 | 2048, 1 | 256 | 512]) this.variant(key, camera);
  }

  // natural districts from the regions module: new cell raster + per-district info / colours
  setRegions({ cells, info, colors, rows }) {
    const u = this.terrainMat.uniforms;
    this.data.cells = cells;
    this.cellTex.image.data = cells;
    this.cellTex.needsUpdate = true;
    const it = new THREE.DataTexture(info, INFO_W, rows, THREE.RGIntegerFormat, THREE.UnsignedShortType);
    it.internalFormat = 'RG16UI'; it.minFilter = it.magFilter = THREE.NearestFilter; it.generateMipmaps = false; it.needsUpdate = true;
    const ct = new THREE.DataTexture(colors, INFO_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    ct.minFilter = ct.magFilter = THREE.NearestFilter; ct.generateMipmaps = false; ct.needsUpdate = true;
    this.infoTex.dispose(); this.colorTex.dispose();
    this.infoTex = it; this.colorTex = ct;
    u.uInfo.value = it; u.uColor.value = ct;
    this.hasRegions = true;
  }
  setHover(id) { this.terrainMat.uniforms.uHover.value = id >>> 0; }
  setSelected(id) { this.terrainMat.uniforms.uSelected.value = id >>> 0; }

  setMode(id) {
    this.mode = id;
    this.terrainMat.uniforms.uMode.value = MODE_INDEX[id] ?? 1;
  }

  // biome classes on the MAP grid (Uint8 8192x4096) + up to 16 colours ([r,g,b] 0..1)
  setBiomes(classes, W, H, colors) {
    const t = new THREE.DataTexture(classes, W, H, THREE.RedIntegerFormat, THREE.UnsignedByteType);
    t.internalFormat = 'R8UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    const u = this.terrainMat.uniforms;
    u.uBiome.value?.dispose?.();
    u.uBiome.value = t; u.uHasBiome.value = 1;
    colors.slice(0, 16).forEach((c, i) => u.uBiomeCol.value[i].setRGB(c[0], c[1], c[2]));
    this.biomes = { classes, W, H };
  }

  // per-mode data layer on the SIM grid (RGBA8: R temperature, G precipitation, B hazard level)
  setSimLayer(rgba, w, h) {
    const u = this.terrainMat.uniforms;
    if (u.uHasSim.value && u.uSim.value.image.width === w) {
      if (u.uSim.value.image.data !== rgba) u.uSim.value.image.data.set(rgba);   // climate.js hands in the same array
      u.uSim.value.needsUpdate = true;
    }
    else { u.uSim.value = makeLayerTexture(rgba, w, h); u.uHasSim.value = 1; }
  }

  // weather grid from the simulation worker (RGBA8: snow, clouds, T anomaly, drought)
  setWeather(rgba, w, h) {
    const u = this.terrainMat.uniforms;
    if (u.uHasWeather.value && u.uWeather.value.image.width === w) { u.uWeather.value.image.data.set(rgba); u.uWeather.value.needsUpdate = true; }
    else {
      // own copy (the caller may hand its buffer back to a worker); mipmaps give the clouds a cheap wide blur
      const t = makeLayerTexture(new Uint8Array(rgba), w, h);
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
      u.uWeather.value = t; u.uHasWeather.value = 1;
    }
  }

  // aerosol layer (360x180 RGBA8 each): rgba R ash, G smoke, B dust, A sulphate; ground R ashfall, G cooling.
  // `visible` false switches the shader block off (no cost while the sky is clean)
  setAerosols(rgba, ground, w, h, visible = true) {
    const u = this.terrainMat.uniforms;
    const put = (key, data, mip) => {
      const cur = u[key].value;
      if (cur.image.width === w && cur.image.height === h) { cur.image.data.set(data); cur.needsUpdate = true; return; }
      const t = makeLayerTexture(new Uint8Array(data), w, h);
      if (mip) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; }
      cur.dispose?.();
      u[key].value = t;
    };
    put('uAero', rgba, true);
    put('uAeroGround', ground, false);
    u.uHasAero.value = visible ? 1 : 0;
  }

  // era climate statistics (src/sim/climate/era.js): half floats, `layers` layers of w x h RGBA, layer-major.
  // `layer` (optional) uploads just that layer of an existing texture (the monthly part of the weather map)
  setClimateLayers(data, w, h, layers, layer = -1) {
    const u = this.terrainMat.uniforms;
    const cur = u.uClim.value;
    if (u.uHasClim.value && cur.image.width === w && cur.image.height === h && cur.image.depth === layers) {
      if (cur.image.data !== data) cur.image.data.set(data);
      // a full upload sends every layer; a layer update never cuts a full upload still waiting for the next frame
      if (layer < 0) { cur.clearLayerUpdates(); this.climFullPending = true; } else if (!this.climFullPending) cur.addLayerUpdate(layer);
      cur.needsUpdate = true;
      return;
    }
    const t = new THREE.DataArrayTexture(data, w, h, layers);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.internalFormat = 'RGBA16F';
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.needsUpdate = true;
    t.onUpdate = () => { this.climFullPending = false; };
    this.climFullPending = true;
    cur.dispose?.();
    u.uClim.value = t; u.uHasClim.value = 1;
  }

  // fresh-water proximity (rivers, lakes, coasts) for the fertility map: Uint8 w x h, linear filtering
  setWaterRaster(u8, w, h) {
    const u = this.terrainMat.uniforms;
    const t = new THREE.DataTexture(u8, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    u.uWater.value?.dispose?.();
    u.uWater.value = t; u.uHasWater.value = 1;
  }

  // CPU height lookup (metres) at a unit vector
  heightAt(v) {
    const { W, H, height } = this.data;
    const lat = Math.asin(Math.max(-1, Math.min(1, v.y))), lon = Math.atan2(v.x, v.z);
    const x = Math.min(W - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * H)));
    return height[y * W + x];
  }

  cellAt(v) {
    const { W, H, cells } = this.data;
    const lat = Math.asin(Math.max(-1, Math.min(1, v.y))), lon = Math.atan2(v.x, v.z);
    const x = Math.min(W - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * H)));
    const c = cells[y * W + x];
    return c >= 0x40000000 ? 0 : c;
  }

  update(gcam, time, camera) {
    const p = gcam.derived;
    const s = this.shared;
    s.uF.value.copy(gcam.F);
    s.uU.value.copy(gcam.U);
    s.uR.value.copy(gcam.R);
    s.uCurv.value = p.curv;
    s.uExag.value = p.exag / 6371000;
    this.dispMax = 9000 * p.exag / 6371000;

    // ring distribution: s(t) = a*sinh(t*b), s(1) = PI, a ~ camera distance
    // rings reach only a little beyond the visible horizon (on the unrolled sphere of radius 1/c)
    const a = Math.max(gcam.alt * 0.8, 1e-4);
    const rho = 1 / p.curv;
    const horizon = Math.acos(Math.min(1, rho / (rho + gcam.alt + this.dispMax))) / p.curv;
    const sMax = Math.min(Math.PI, horizon * 1.25 + 0.04);
    const b = Math.asinh(sMax / a);
    const u = this.terrainMat.uniforms;
    u.uRingA.value = a; u.uRingB.value = b;
    // mesh LOD: light grid from afar, dense grid close (hysteresis avoids flicker at the threshold)
    if (!this.forceNear) {
      const far = this.terrainFar.visible ? gcam.alt > 0.5 : gcam.alt > 0.62;
      if (far !== this.terrainFar.visible) {
        this.terrainFar.visible = far;
        this.terrainNear.visible = !far;
        this.terrain = far ? this.terrainFar : this.terrainNear;
      }
      u.uRings.value = this.terrainFar.visible ? this.farRings : this.rings;
    }
    u.uTime.value = time;
    u.uGlobe.value = p.globe;
    // real 1.2 km slopes are steep: soften the shading as the detail window fades in
    u.uShadeK.value = (3.0 + 1.8 * (1 - p.globe)) * (1 - 0.6 * this.shared.uDetailOn.value);
    const alt = gcam.alt;
    const fade = (a0, a1) => 1 - Math.min(1, Math.max(0, (Math.log(alt) - Math.log(a0)) / (Math.log(a1) - Math.log(a0))));
    // no nations yet: political lines only in the legacy political mode; district lines in the regions mode
    const political = this.mode === 'political', regions = this.mode === 'regions';
    u.uNeedInfo.value = (political || regions) && !this.clean ? 1 : 0;
    // regions mode: region borders always, provinces from mid zoom, districts up close, sea zones only very close
    u.uLineProv.value = this.clean || !(political || regions) ? 0 : regions ? fade(0.9, 2.2) : fade(0.35, 1.1);
    u.uLineCountry.value = this.clean || !(political || regions) ? 0 : regions ? 0.75 : 1;
    u.uLineDist.value = this.settings.showDistricts && !this.clean && (political || regions) ? fade(0.12, 0.6) : 0;
    u.uLineSea.value = this.clean || !this.hasRegions || this.settings.showDistricts === false ? 0 : regions ? fade(0.1, 0.35) : fade(0.03, 0.09);
    // clouds belong to the landscape views; data maps (temperature, precipitation, hazards, regions) stay readable
    const cloudy = this.mode === 'terrain' || this.mode === 'relief';
    u.uCloudAmt.value = this.settings.showWeather === false || !cloudy ? 0 : 1;
    // zoom response: from orbit (alt >~ 1) cloud bodies are opaque with crisp edges; zooming in (0.3 → 0.03)
    // they turn strongly transparent so the land reads, and leave a tone (overcast dimming, grey under rain,
    // a dark cast under ash) over the area instead
    {
      const k = Math.min(1, Math.max(0, (Math.log(alt) - Math.log(0.035)) / (Math.log(1.1) - Math.log(0.035))));
      const zk = k * k * (3 - 2 * k);   // 0 close-up … 1 orbit
      u.uCloudVis.value = 0.12 + 0.88 * Math.pow(zk, 1.3);
      u.uCloudTone.value = 1 - zk;
      u.uCloudCrisp.value = zk;
      u.uAeroAmt.value = u.uCloudAmt.value;
      u.uAeroVis.value = 0.2 + 0.8 * Math.pow(zk, 1.1);
    }
    // political colours are strong from afar and give way to the terrain up close
    u.uOverlay.value = this.overlayBase * (0.3 + 0.7 * Math.min(1, Math.max(0, (Math.log(alt) - Math.log(0.015)) / (Math.log(0.6) - Math.log(0.015)))));
    // contour interval follows the zoom; lines fade out at globe distance
    u.uContour.value = alt < 0.012 ? 100 : alt < 0.03 ? 200 : alt < 0.09 ? 250 : 500;
    u.uContourAmt.value = fade(0.12, 0.45);

    // light for the globe look: upper-left, toward the viewer
    const tv = this._tmpV ||= [new THREE.Vector3(), new THREE.Vector3()];   // no per-frame allocations
    const camRight = tv[0].setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = tv[1].setFromMatrixColumn(camera.matrixWorld, 1);
    u.uSunView.value.copy(camera.position).normalize().multiplyScalar(0.75).addScaledVector(camRight, -0.45).addScaledVector(camUp, 0.5).normalize();

    // haze toward the horizon when zoomed in and tilted
    u.uFogNear.value = alt * 2.2;
    u.uFogFar.value = alt * 9;
    u.uFogAmt.value = 0.85 * (1 - p.globe) * Math.min(1, p.tilt / 0.5);

    this.riverMat.uniforms.uLift.value = alt * 0.0015;
    const maxRank = this.settings.showRivers ? (alt < 0.05 ? 12 : alt < 0.2 ? 9 : alt < 0.8 ? 6 : 3) : -1;
    this.riverMat.uniforms.uMaxRank.value = maxRank;
    this.rivers.geometry.setDrawRange(0, maxRank < 0 ? 0 : this.riverRankEnd[Math.min(15, maxRank)]);
    this.riverMat.uniforms.uOpacity.value = 0.55 + 0.35 * (1 - p.globe);

    this.atmoMat.uniforms.uOpacity.value = Math.max(0, (p.curv - 0.8) / 0.2);
    this.atmo.visible = p.curv > 0.8;
    this.pickVariant(camera);
  }
}
