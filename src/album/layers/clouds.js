// Clouds seen from a height (docs/album/sky.md, «Погода»): one thin shell around the globe at the height of the
// cloud layer. Where the cloud field (albumCloudField in light.js) is thick there is cloud: white on the side of the
// Sun, grey-blue on the far side, with ragged edges. The same field darkens the ground under it (albumCloudShade,
// laid over the finished picture by post.js), so every cloud has its shadow. Near the ground the clouds melt away
// and only the shadows stay: the map under them must be readable. Switched by the knobs «Облака» and «Облачность»
// (aspects/sky.js).
//
// The shell is not part of the scene of the map: it is drawn over the finished picture (album.overlay, main.js),
// after the pass that lays the shadows — otherwise a cloud would be darkened by its own shadow on the land below.
// It is hidden behind the globe by its own arithmetic, not by the depth buffer.
import { Mesh, SphereGeometry, ShaderMaterial, DoubleSide, Vector2 } from 'three';
import { COMMON } from '../glsl.js';
import { LIGHT, lightUniforms } from '../light.js';
import { R } from '../geo.js';

const VERT = /* glsl */`
varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;

const FRAG = /* glsl */`
${COMMON}
${LIGHT}
uniform float uShow, uVig; uniform vec2 uRes;
varying vec3 vW;
// the cloud field with its curls: the soft field of light.js (the same numbers) plus smaller noise that fades once
// it is smaller than a pixel
// (each smaller noise is turned against the one before, so that the square grain of the noise never lines up)
float curls(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.1; a *= .5; } return s; }
float cloudN(vec2 q, float px) {
  float n = vnoise(q / 310.) * .46 + vnoise(q / 118. + 7.3) * .32 + vnoise(q / 47. + 3.1) * .22;
  if (px < 12.) n += (curls(mat2(.8, .6, -.6, .8) * q / 21. + 5.) - .47) * .30 * smoothstep(12., 4., px);
  return n;
}
void main() {
  if (uCloud.x <= 0. || uShow <= 0.) discard;
  vec3 C = normalize(vW + vec3(0., RKM, 0.)) * (RKM + uCloud.w), P = C - vec3(0., RKM, 0.);   // (the triangles of the shell are flat: back onto the sphere)
  // behind the globe: the way from the eye to this point of the shell goes through the ground
  vec3 E = cameraPosition + vec3(0., RKM, 0.), d = C - E; float reach = length(d); d /= reach;
  float b = dot(E, d), disc = b * b - (dot(E, E) - RKM * RKM);
  if (disc > 0. && b < 0. && -b - sqrt(disc) < reach) discard;
  vec2 q = C.xz / max(C.y, 1.) * RKM + uCloud.yz; float px = length(fwidth(q));
  float thr = mix(.80, .30, uCloud.x), n = cloudN(q, px), dens = smoothstep(thr - .04, thr + .16, n);
  if (dens <= .003) discard;
  // the side toward the Sun is bright: there is less cloud between it and the Sun than on the far side
  vec2 s2 = normalize(uSunW.xz + 1e-4); float n2 = cloudN(q + s2 * 7., px), lit = smoothstep(-.06, .09, n - n2);
  float day = albumDay(), body = smoothstep(thr + .05, thr + .32, n);              // the thick middle of a cloud is a little greyer
  vec3 col = albumSunCol() * (.34 + .86 * lit) * (1. - .2 * body) + albumSkyCol() * 1.2 + albumMoonCol() * (.5 + .7 * lit);
  col = albumFinish(mix(col * .93, albumHorizon(d), albumHaze(P)));
  vec2 v = gl_FragCoord.xy / uRes - .5; col *= 1. - uVig * dot(v, v) * 1.5;         // the vignette of the finishing pass, which this shell is drawn after
  gl_FragColor = vec4(col, dens * (.42 + .52 * dens) * uShow * mix(.8, 1., day));
}`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params;
  // a cap of the sphere around the middle of the map, wide enough for the view from 2000 km
  const mesh = new Mesh(new SphereGeometry(1, 192, 72, 0, Math.PI * 2, 0, 1.05), new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...lightUniforms(T), uShow: { value: 0 }, uVig: { value: .35 }, uRes: { value: new Vector2(1, 1) } },
  }));
  mesh.position.set(0, -R, 0); mesh.frustumCulled = false; mesh.visible = false;
  (album.overlay || album.scene).add(mesh);
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return { id: 'clouds', mesh, update(dt, t, cam) {
    // from under 60 km over the ground the clouds are not drawn at all; from 350 km they are drawn in full
    const show = p.get('clouds') && T.uStyle.value === 0 ? ss(60, 350, cam.alt ?? cam.s.h) : 0, u = mesh.material.uniforms;
    mesh.visible = show > 0; u.uShow.value = show;
    if (show > 0) { mesh.scale.setScalar(R + T.uCloud.value.w); album.renderer.getDrawingBufferSize(u.uRes.value); u.uVig.value = p.get('fx') ? .35 : 0; }
  } };
}
