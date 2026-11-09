import * as THREE from 'three';

// "Render scale" upscaler (our stand-in for DLSS/FSR in a WebGL engine):
// renders the scene into a smaller multisampled target, then upsamples it to the screen with a
// contrast-adaptive sharpening filter (RCAS-like) and applies brightness. At scale 1 it renders directly.
export class Upscaler {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = null;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0.35 }, uBright: { value: 1 } },
      vertexShader: /* glsl */`out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uTex; uniform vec2 uTexel; uniform float uSharpen; uniform float uBright;
        in vec2 vUv; layout(location = 0) out vec4 o;
        void main() {
          vec3 c = texture(uTex, vUv).rgb;
          vec3 n = texture(uTex, vUv + vec2(0.0, uTexel.y)).rgb, s = texture(uTex, vUv - vec2(0.0, uTexel.y)).rgb;
          vec3 e = texture(uTex, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture(uTex, vUv - vec2(uTexel.x, 0.0)).rgb;
          vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
          // contrast-adaptive weight: sharpen less where the neighbourhood already has strong contrast
          vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
          float wgt = -uSharpen * 0.2 * sqrt(dot(amp, vec3(1.0 / 3.0)));
          vec3 r = (c + wgt * (n + s + e + w)) / (1.0 + 4.0 * wgt);
          o = vec4(clamp(r * uBright, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const quad = new THREE.Mesh(g, this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  render(scene, camera, { renderScale = 1, sharpen = 0.35, brightness = 1 } = {}) {
    const r = this.renderer;
    const scale = Math.max(0.5, Math.min(1, renderScale));
    if (scale >= 0.999 && Math.abs(brightness - 1) < 0.01) { r.setRenderTarget(null); r.render(scene, camera); return; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(size.x * scale)), h = Math.max(1, Math.round(size.y * scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.UnsignedByteType, depthBuffer: true });
      this.target.texture.minFilter = THREE.LinearFilter; this.target.texture.magFilter = THREE.LinearFilter;
    }
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.uTex.value = this.target.texture;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uSharpen.value = scale < 0.999 ? sharpen : sharpen * 0.4;
    u.uBright.value = brightness;
    r.render(this.quadScene, this.quadCam);
  }
}
