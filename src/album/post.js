// The finishing pass over the whole picture: ambient occlusion from the depth buffer (soft dark contact around
// cliffs and in gullies), a light sharpening, the shadows of the clouds and a vignette. The scene is drawn into a
// multisampled target with a depth texture; this pass puts it on screen.
//
// The shadows of the clouds are laid here, from the depth of every pixel, and not in the shaders of the land: the
// ground shader has no room left for their noise (see albumHaze in light.js), and here the shadow falls on
// everything alike — land, water, trees, houses, roads.
import { WebGLRenderTarget, DepthTexture, UnsignedIntType, LinearFilter, NearestFilter, ShaderMaterial, Mesh, PlaneGeometry, OrthographicCamera, Scene, Vector2, Vector3, Matrix4 } from 'three';
import { COMMON } from './glsl.js';
import { LIGHT, lightUniforms } from './light.js';

// (this pass is drawn with its own flat camera: the eye of the map comes as uEye, under the name LIGHT knows)
const CLOUD_HEAD = `#define cameraPosition uEye\n${COMMON}\n${LIGHT}`;
// the shadows of the clouds: the point of the world behind the pixel, and how much sun the clouds leave it; the air
// in front of the point is not shaded (the picture here is already in screen colours: hence the root)
const CLOUD_SHADE = /* glsl */`
          if (uCloud.x > 0. && z0 < uFar * .97) {
            vec4 v = uInvProj * vec4(vUv * 2. - 1., 1., 1.); vec3 dv = normalize(v.xyz / v.w);
            vec3 wpos = uEye + normalize(mat3(uCamWorld) * dv) * (z0 / max(-dv.z, 1e-4));
            c *= mix(1., sqrt(albumCloudShade(wpos)), 1. - albumHaze(wpos));
          }`;
const frag = clouds => /* glsl */`uniform vec3 uEye;
        ${clouds ? CLOUD_HEAD : ''}
        uniform sampler2D tCol, tDepth; uniform vec2 uPx; uniform float uNear, uFar, uProj, uRad, uAO, uSharp, uVig; uniform mat4 uInvProj, uCamWorld; varying vec2 vUv;
        float vz(vec2 uv) { float z = texture(tDepth, uv).r * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture(tCol, vUv).rgb; float z0 = vz(vUv), ao = 0.;
          if (uAO > 0. && z0 < uFar * .97) {
            float r = clamp(uRad * uProj / z0, 2., 26.), a0 = hash(gl_FragCoord.xy) * 6.283;
            vec2 grad = vec2(vz(vUv + vec2(uPx.x, 0.)) - vz(vUv - vec2(uPx.x, 0.)), vz(vUv + vec2(0., uPx.y)) - vz(vUv - vec2(0., uPx.y))) * .5;   // the surface as a plane
            // Toward the horizon one pixel spans kilometres of depth, and the depth written there is not exact: it is
            // off by a small part of that span from one triangle to the next, and the levels of the land's grid lie
            // half such a span apart (they are pushed back in depth so as not to flicker). So only what stands out
            // of the plane by more than the span of a pixel counts as standing in the way, and where that span
            // outgrows the reach of the shade there is no shade at all. Without this the horizon was all grain, with
            // dark lines along the borders of the grid's levels.
            // And nothing lower than 40 m counts at all: a house, a town wall, the bank of a river have no shade around
            // them (the owner, 13.11.2026: shadows come from mountains and relief only); cliffs and gullies keep theirs.
            float span = length(grad), lo = max(max(uRad * .05, span * .8), .04), keep = 1. - smoothstep(uRad * .5, uRad * 1.6, span);
            if (keep > 0.) {
              for (int i = 0; i < 8; i++) {
                float a = a0 + float(i) * .7854; vec2 o = vec2(cos(a), sin(a)) * r * (.4 + .6 * fract(float(i) * .618 + .3));
                float dz = z0 + dot(grad, o) - vz(vUv + o * uPx);                 // above the plane = something stands in the way
                ao += smoothstep(lo, lo + uRad * .5, dz) * (1. - smoothstep(uRad * 1.6, uRad * 4.5, dz));
              }
              ao *= keep / 8.;
            }
          }
          c *= 1. - uAO * ao * .8;
          vec3 n4 = (texture(tCol, vUv + vec2(uPx.x, 0.)).rgb + texture(tCol, vUv - vec2(uPx.x, 0.)).rgb + texture(tCol, vUv + vec2(0., uPx.y)).rgb + texture(tCol, vUv - vec2(0., uPx.y)).rgb) * .25;
          c = clamp(c + (c - n4) * uSharp, 0., 1.);${clouds ? CLOUD_SHADE : ''}
          vec2 q = vUv - .5; c *= 1. - uVig * dot(q, q) * 1.5;
          gl_FragColor = vec4(c, 1.);
        }`;

export class Post {
  // T: the uniforms of the ground (album.terrain.u), for the light the shadows of the clouds are counted with
  constructor(renderer, T) {
    this.renderer = renderer; this.T = T;
    this.rt = new WebGLRenderTarget(4, 4, { samples: 4, minFilter: LinearFilter, magFilter: LinearFilter });
    this.rt.depthTexture = new DepthTexture(4, 4, UnsignedIntType); this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = NearestFilter;
    const uniforms = { ...(T ? lightUniforms(T) : {}), tCol: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uPx: { value: new Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uProj: { value: 1000 },
      uRad: { value: .1 }, uAO: { value: .8 }, uSharp: { value: .3 }, uVig: { value: .35 }, uEye: { value: new Vector3() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() } };
    // Two shaders of the one pass, with the same uniforms: the plain one, and the one that also lays the shadows of
    // the clouds. With no clouds the plain one is used, so the clouds cost nothing while they are off.
    const make = clouds => new ShaderMaterial({ depthTest: false, depthWrite: false, uniforms, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: frag(clouds) });
    this.mat = make(false); this.matClouds = make(true);
    this.scene = new Scene(); this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false; this.scene.add(this.quad);
  }
  // fewer samples when the machine is struggling (the album has already halved its picture scale)
  setSamples(n) { if (this.rt.samples !== n) { this.rt.samples = n; this.rt.dispose(); } }
  render(scene, camera, heightKm, ao, sharp) {
    const r = this.renderer, size = r.getDrawingBufferSize(new Vector2()), u = this.mat.uniforms;
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    u.uPx.value.set(1 / size.x, 1 / size.y); u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProj.value = size.y / (2 * Math.tan(camera.fov * Math.PI / 360)); u.uRad.value = heightKm * .0065; u.uAO.value = ao; u.uSharp.value = sharp;
    u.uEye.value.copy(camera.position); u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    this.quad.material = this.T?.uCloud?.value.x > 0 ? this.matClouds : this.mat;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }
}
