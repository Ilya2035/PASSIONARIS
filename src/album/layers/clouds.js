// Clouds seen from a height (docs/album/sky.md, «Погода»): one thin shell around the globe at the height of the
// cloud layer. Where the field of the clouds (sky/weather.js) is thick there is cloud: white on the side of the
// Sun, grey-blue on the far side, with ragged edges; where it rains the cloud is heavy and grey. The same field
// darkens the ground under it (albumCloudShade, laid over the finished picture by post.js), so every cloud has its
// shadow. Near the ground the clouds melt away and only the shadows and the rain stay: the map under them must be
// readable. Switched by the knobs «Облака», «Облачность» and «Дождь» (aspects/sky.js).
//
// The shell is not part of the scene of the map: it is drawn over the finished picture (album.overlay, main.js),
// after the pass that lays the shadows — otherwise a cloud would be darkened by its own shadow on the land below.
// It is hidden behind the globe by its own arithmetic, not by the depth buffer.
import { Mesh, SphereGeometry, ShaderMaterial, DoubleSide, Vector2 } from 'three';
import { COMMON } from '../glsl.js';
import { LIGHT, lightUniforms } from '../light.js';
import { WEATHER, WX } from '../sky/weather.js';
import { R } from '../geo.js';

const VERT = /* glsl */`
varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;

const FRAG = /* glsl */`
${COMMON}
${LIGHT}
${WEATHER}
uniform float uShow, uShowRain, uVig; uniform vec2 uRes;
varying vec3 vW;
// the field of the clouds with its curls: the soft field of the weather plus smaller noise that fades once it is
// smaller than a pixel
// (each smaller noise is turned against the one before, so that the square grain of the noise never lines up)
float curls(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.1; a *= .5; } return s; }
float cloudN(vec2 q, float px) {
  float n = wxCloudN(q, 0.);
  if (px < 12.) n += (curls(mat2(.8, .6, -.6, .8) * (q + uCloud.yz) / 21. + 5.) - .47) * .30 * smoothstep(12., 4., px);
  return n;
}
void main() {
  if (uCloud.x <= 0. || uShow + uShowRain <= 0.) discard;
  vec3 C = normalize(vW + vec3(0., RKM, 0.)) * (RKM + uCloud.w), P = C - vec3(0., RKM, 0.);   // (the triangles of the shell are flat: back onto the sphere)
  // behind the globe: the way from the eye to this point of the shell goes through the ground
  vec3 E = cameraPosition + vec3(0., RKM, 0.), d = C - E; float reach = length(d); d /= reach;
  float b = dot(E, d), disc = b * b - (dot(E, E) - RKM * RKM);
  if (disc > 0. && b < 0. && -b - sqrt(disc) < reach) discard;
  vec2 q = C.xz / max(C.y, 1.) * RKM; float px = length(fwidth(q));
  float thr = wxThr(), n = cloudN(q, px), dens = smoothstep(thr - .04, thr + .16, n);
  if (dens <= .003) discard;
  // the side toward the Sun is bright: there is less cloud between it and the Sun than on the far side
  vec2 s2 = normalize(uSunW.xz + 1e-4); float n2 = cloudN(q + s2 * 7., px), lit = smoothstep(-.06, .09, n - n2);
  float day = albumDay(), body = smoothstep(thr + .05, thr + .32, n);              // the thick middle of a cloud is a little greyer
  float rains = uRain.x > 0. ? wxRainMask(q) : 0., wet = rains * smoothstep(thr - .02, thr + .12, n);   // and a cloud that rains is heavy and dark
  vec3 col = albumSunCol() * (.34 + .86 * lit) * (1. - .2 * body) + albumSkyCol() * 1.2 + albumMoonCol() * (.5 + .7 * lit);
  col = albumFinish(mix(col * .93 * (1. - .6 * wet) * mix(vec3(1.), vec3(.93, .97, 1.06), wet), albumHorizon(d), albumHaze(P)));
  vec2 v = gl_FragCoord.xy / uRes - .5; col *= 1. - uVig * dot(v, v) * 1.5;         // the vignette of the finishing pass, which this shell is drawn after
  // a cloud that rains is shown from nearer than the others: the rain must hang from something
  float show = mix(uShow, max(uShow, uShowRain), rains);
  gl_FragColor = vec4(col, min(dens * (.42 + .52 * dens) + .25 * wet, 1.) * show * mix(.8, 1., day));
}`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params;
  // a cap of the sphere around the middle of the map, wide enough for the view from 2000 km
  const mesh = new Mesh(new SphereGeometry(1, 192, 72, 0, Math.PI * 2, 0, 1.05), new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...lightUniforms(T), ...WX, uExag: T.uExag, uShow: { value: 0 }, uShowRain: { value: 0 }, uVig: { value: .35 }, uRes: { value: new Vector2(1, 1) } },
  }));
  mesh.position.set(0, -R, 0); mesh.frustumCulled = false; mesh.visible = false;
  (album.overlay || album.scene).add(mesh);
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return { id: 'clouds', mesh, update(dt, t, cam) {
    // With the camera nearer than 60 km to the place it looks at, the clouds are not drawn at all; from 350 km they
    // are drawn in full. The clouds that rain come in sooner, from 30 to 120 km, half seen. And none are drawn once the eye
    // itself is down at the height of the clouds. (How much of the sky they cover — and whether there are any — is
    // set by the sky layer: uCloud.x.)
    const on = T.uCloud.value.x > 0 && !!WX.tCloud.value, h = cam.s.h, top = T.uCloud.value.w, above = ss(top + 2, top + 14, cam.alt ?? h), u = mesh.material.uniforms;
    const show = on ? ss(60, 350, h) * above : 0, showRain = on && WX.uRain.value.x > 0 ? ss(30, 120, h) * above * .55 : 0;
    mesh.visible = show + showRain > 0; u.uShow.value = show; u.uShowRain.value = showRain;
    if (mesh.visible) { mesh.scale.setScalar(R + T.uCloud.value.w); album.renderer.getDrawingBufferSize(u.uRes.value); u.uVig.value = p.get('fx') ? .35 : 0; }
  } };
}
