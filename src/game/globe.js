import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_FRAG, RIVER_VERT, RIVER_FRAG, ATMO_VERT, ATMO_FRAG } from './shaders.js';
import { makeHeightTexture, makeCellTexture, makeInfoTexture, makeColorTexture, INFO_W } from './data.js';
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
function dummyRGBA() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 128, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
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

// map modes: id -> shader index
export const MODE_INDEX = { relief: 0, terrain: 1, temperature: 2, precipitation: 3, hazards: 4, regions: 5, political: 9 };

function polarGrid(nAz, nRings) {
  const pos = new Float32Array((nRings + 1) * (nAz + 1) * 3);
  let o = 0;
  for (let r = 0; r <= nRings; r++) {
    for (let a = 0; a <= nAz; a++) {
      pos[o++] = r / nRings; pos[o++] = (a / nAz) * Math.PI * 2; pos[o++] = 0;
    }
  }
  const idx = new Uint32Array(nRings * nAz * 6);
  o = 0;
  const row = nAz + 1;
  for (let r = 0; r < nRings; r++) {
    for (let a = 0; a < nAz; a++) {
      const i = r * row + a;
      idx[o++] = i; idx[o++] = i + row; idx[o++] = i + 1;
      idx[o++] = i + 1; idx[o++] = i + row; idx[o++] = i + row + 1;
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
    const { W, H, world } = data;

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
        uNeedInfo: { value: 0 },
      },
    });
    this.terrain = new THREE.Mesh(polarGrid(q.az, q.rings), this.terrainMat);
    this.terrain.frustumCulled = false;
    scene.add(this.terrain);

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
    if (u.uHasSim.value && u.uSim.value.image.width === w) { u.uSim.value.image.data.set(rgba); u.uSim.value.needsUpdate = true; }
    else { u.uSim.value = makeLayerTexture(rgba, w, h); u.uHasSim.value = 1; }
  }

  // weather grid from the simulation worker (RGBA8: snow, clouds, T anomaly, drought)
  setWeather(rgba, w, h) {
    const u = this.terrainMat.uniforms;
    if (u.uHasWeather.value && u.uWeather.value.image.width === w) { u.uWeather.value.image.data.set(rgba); u.uWeather.value.needsUpdate = true; }
    else { u.uWeather.value = makeLayerTexture(rgba, w, h); u.uHasWeather.value = 1; }
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
    return cells[y * W + x];
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
    u.uTime.value = time;
    u.uGlobe.value = p.globe;
    // real 1.2 km slopes are steep: soften the shading as the detail window fades in
    u.uShadeK.value = (3.0 + 1.8 * (1 - p.globe)) * (1 - 0.6 * this.shared.uDetailOn.value);
    const alt = gcam.alt;
    const fade = (a0, a1) => 1 - Math.min(1, Math.max(0, (Math.log(alt) - Math.log(a0)) / (Math.log(a1) - Math.log(a0))));
    // no nations yet: political lines only in the legacy political mode; district lines in the regions mode
    const political = this.mode === 'political';
    u.uNeedInfo.value = (political || this.mode === 'regions') && !this.clean ? 1 : 0;
    u.uLineProv.value = this.clean || !political ? 0 : fade(0.35, 1.1);
    u.uLineCountry.value = this.clean || !political ? 0 : 1;
    u.uLineDist.value = this.settings.showDistricts && !this.clean && (political || this.mode === 'regions') ? fade(0.12, 0.6) : 0;
    u.uCloudAmt.value = this.settings.showWeather === false ? 0 : 0.35 + 0.65 * p.globe;
    // political colours are strong from afar and give way to the terrain up close
    u.uOverlay.value = this.overlayBase * (0.3 + 0.7 * Math.min(1, Math.max(0, (Math.log(alt) - Math.log(0.015)) / (Math.log(0.6) - Math.log(0.015)))));
    // contour interval follows the zoom; lines fade out at globe distance
    u.uContour.value = alt < 0.012 ? 100 : alt < 0.03 ? 200 : alt < 0.09 ? 250 : 500;
    u.uContourAmt.value = fade(0.12, 0.45);

    // light for the globe look: upper-left, toward the viewer
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const toCam = camera.position.clone().normalize();
    u.uSunView.value.copy(toCam).multiplyScalar(0.75).addScaledVector(camRight, -0.45).addScaledVector(camUp, 0.5).normalize();

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
  }
}
