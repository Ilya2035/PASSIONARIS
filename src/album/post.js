// The finishing pass over the whole picture: ambient occlusion from the depth buffer (soft dark contact around
// trees, houses, cliffs and in gullies), a light sharpening and a vignette. The scene is drawn into a multisampled
// target with a depth texture; this pass puts it on screen.
import { WebGLRenderTarget, DepthTexture, UnsignedIntType, LinearFilter, NearestFilter, ShaderMaterial, Mesh, PlaneGeometry, OrthographicCamera, Scene, Vector2 } from 'three';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new WebGLRenderTarget(4, 4, { samples: 4, minFilter: LinearFilter, magFilter: LinearFilter });
    this.rt.depthTexture = new DepthTexture(4, 4, UnsignedIntType); this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = NearestFilter;
    this.mat = new ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tCol: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uPx: { value: new Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uProj: { value: 1000 }, uRad: { value: .1 }, uAO: { value: .8 }, uSharp: { value: .3 }, uVig: { value: .35 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D tCol, tDepth; uniform vec2 uPx; uniform float uNear, uFar, uProj, uRad, uAO, uSharp, uVig; varying vec2 vUv;
        float vz(vec2 uv) { float z = texture(tDepth, uv).r * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture(tCol, vUv).rgb; float z0 = vz(vUv), ao = 0.;
          if (uAO > 0. && z0 < uFar * .97) {
            float r = clamp(uRad * uProj / z0, 2., 26.), a0 = hash(gl_FragCoord.xy) * 6.283;
            vec2 grad = vec2(vz(vUv + vec2(uPx.x, 0.)) - vz(vUv - vec2(uPx.x, 0.)), vz(vUv + vec2(0., uPx.y)) - vz(vUv - vec2(0., uPx.y))) * .5;   // the surface as a plane
            for (int i = 0; i < 8; i++) {
              float a = a0 + float(i) * .7854; vec2 o = vec2(cos(a), sin(a)) * r * (.4 + .6 * fract(float(i) * .618 + .3));
              float dz = z0 + dot(grad, o) - vz(vUv + o * uPx);                   // above the plane = something stands in the way
              ao += smoothstep(uRad * .05, uRad * .55, dz) * (1. - smoothstep(uRad * 1.6, uRad * 4.5, dz));
            }
            ao /= 8.;
          }
          c *= 1. - uAO * ao * .8;
          vec3 n4 = (texture(tCol, vUv + vec2(uPx.x, 0.)).rgb + texture(tCol, vUv - vec2(uPx.x, 0.)).rgb + texture(tCol, vUv + vec2(0., uPx.y)).rgb + texture(tCol, vUv - vec2(0., uPx.y)).rgb) * .25;
          c = clamp(c + (c - n4) * uSharp, 0., 1.);
          vec2 q = vUv - .5; c *= 1. - uVig * dot(q, q) * 1.5;
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    this.scene = new Scene(); this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat); quad.frustumCulled = false; this.scene.add(quad);
  }
  // fewer samples when the machine is struggling (the album has already halved its picture scale)
  setSamples(n) { if (this.rt.samples !== n) { this.rt.samples = n; this.rt.dispose(); } }
  render(scene, camera, heightKm, ao, sharp) {
    const r = this.renderer, size = r.getDrawingBufferSize(new Vector2()), u = this.mat.uniforms;
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    u.uPx.value.set(1 / size.x, 1 / size.y); u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProj.value = size.y / (2 * Math.tan(camera.fov * Math.PI / 360)); u.uRad.value = heightKm * .0065; u.uAO.value = ao; u.uSharp.value = sharp;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }
}
