import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_FRAG, RIVER_VERT, RIVER_FRAG, ATMO_VERT, ATMO_FRAG } from './shaders.js';
import { makeHeightTexture, makeCellTexture, makeInfoTexture, makeColorTexture, INFO_W } from './data.js';
import { getPalette } from '../shared/palettes.js';

const QUALITY = {
  low: { az: 512, rings: 360 },
  medium: { az: 1024, rings: 600 },
  high: { az: 1536, rings: 900 },
};

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

    const q = QUALITY[settings.quality] || QUALITY.high;
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
      },
    });
    this.terrain = new THREE.Mesh(polarGrid(q.az, q.rings), this.terrainMat);
    this.terrain.frustumCulled = false;
    scene.add(this.terrain);

    // rivers (vector, Natural Earth centre lines)
    const segs = data.rivers, ranks = data.riverRank;
    const n = ranks.length;
    const rp = new Float32Array(n * 2 * 3);
    for (let s = 0; s < n; s++) {
      rp.set([segs[s * 4], segs[s * 4 + 1], ranks[s], segs[s * 4 + 2], segs[s * 4 + 3], ranks[s]], s * 6);
    }
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

    // ring distribution: s(t) = a*sinh(t*b), s(1) = PI, a ~ camera distance
    const a = Math.max(gcam.alt * 0.8, 1e-4);
    const b = Math.asinh(Math.PI / a);
    const u = this.terrainMat.uniforms;
    u.uRingA.value = a; u.uRingB.value = b;
    u.uTime.value = time;
    u.uGlobe.value = p.globe;
    u.uShadeK.value = 3.0 + 1.8 * (1 - p.globe);
    const alt = gcam.alt;
    const fade = (a0, a1) => 1 - Math.min(1, Math.max(0, (Math.log(alt) - Math.log(a0)) / (Math.log(a1) - Math.log(a0))));
    u.uLineProv.value = this.clean ? 0 : fade(0.35, 1.1);
    u.uLineCountry.value = this.clean ? 0 : 1;
    u.uLineDist.value = this.settings.showDistricts && !this.clean ? fade(0.05, 0.16) : 0;
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
    this.riverMat.uniforms.uMaxRank.value = this.settings.showRivers ? (alt < 0.05 ? 12 : alt < 0.2 ? 9 : alt < 0.8 ? 6 : 3) : -1;
    this.riverMat.uniforms.uOpacity.value = 0.55 + 0.35 * (1 - p.globe);

    this.atmoMat.uniforms.uOpacity.value = Math.max(0, (p.curv - 0.8) / 0.2);
    this.atmo.visible = p.curv > 0.8;
  }
}
