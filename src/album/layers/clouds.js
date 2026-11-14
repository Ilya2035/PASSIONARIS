// Clouds seen from a height (docs/album/sky.md, «Погода»): one thin shell around the globe at the height of the
// cloud layer. Where the field of the clouds (sky/weather.js) is thick there is cloud: white on the side of the
// Sun, grey-blue on the far side, with ragged edges. A cloud that rains is a storm cloud seen from a satellite: it
// stands tall, so its lumps are bright where the Sun reaches them and deep blue-grey behind, and nothing shows through
// it. (Grey and heavy it is from below: that is the sky of the finishing pass, post.js.) The same field
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
import { WEATHER, WX, CLOUD_KM, CLOUD_N } from '../sky/weather.js';
import { R } from '../geo.js';

const VERT = /* glsl */`
varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;

// The lumps of a cloud top are the picture of the clouds itself, read much smaller, twice, each time turned so that
// nothing lines up: lumps of 24, 9 and 3.6 km, then of 6, 2 and 1 km. A read of the picture is several times cheaper
// than noise counted in the pixel (four noises a read replaced here, and the shell is counted twice a pixel), and
// it has no square grain. Each is read at a level of detail by the size of the pixel: lumps smaller than a pixel
// fade by themselves.
export const LUMPS = [[620, .34], [150, .16]];
const FRAG = /* glsl */`
${COMMON}
${LIGHT}
${WEATHER}
uniform float uShow, uShowRain, uVig; uniform vec2 uRes;
varying vec3 vW;
// the field of the clouds with its lumps; lod: for the larger and for the smaller lumps, by the size of the pixel
// (The picture is read smoothly here: between its points the value turns without a kink. A plain read runs straight
// from point to point, and the light of a cloud, which is counted from the slope of the field, then shows every
// point of the picture as a flat patch with a hard edge.)
float cloudTex(vec2 uv, float lod) { uv = uv * ${CLOUD_N.toFixed(1)} + .5; vec2 i = floor(uv), f = uv - i; return textureLod(tCloud, (i + f * f * (3. - 2. * f) - .5) / ${CLOUD_N.toFixed(1)}, lod).r; }
float cloudN(vec2 q, vec2 lod) {
  vec2 p = q + uCloud.yz;
  return cloudTex(p / ${CLOUD_KM.toFixed(1)}, 0.) + (cloudTex(mat2(.8, .6, -.6, .8) * p / ${LUMPS[0][0].toFixed(1)} + .23, lod.x) - .5) * ${LUMPS[0][1]}
    + (cloudTex(mat2(.6, -.8, .8, .6) * p / ${LUMPS[1][0].toFixed(1)} + .61, lod.y) - .5) * ${LUMPS[1][1]};
}
void main() {
  if (uCloud.x <= 0. || uShow + uShowRain <= 0.) discard;
  vec3 C = normalize(vW + vec3(0., RKM, 0.)) * (RKM + uCloud.w), P = C - vec3(0., RKM, 0.);   // (the triangles of the shell are flat: back onto the sphere)
  // behind the globe: the way from the eye to this point of the shell goes through the ground
  vec3 E = cameraPosition + vec3(0., RKM, 0.), d = C - E; float reach = length(d); d /= reach;
  float b = dot(E, d), disc = b * b - (dot(E, E) - RKM * RKM);
  if (disc > 0. && b < 0. && -b - sqrt(disc) < reach) discard;
  vec2 q = C.xz / max(C.y, 1.) * RKM; float px = length(fwidth(q)); vec2 lod = log2(max(px / vec2(${(LUMPS[0][0] / 1024).toFixed(3)}, ${(LUMPS[1][0] / 1024).toFixed(3)}), 1.));
  float thr = wxThr(), n = cloudN(q, lod), dens = smoothstep(thr - .04, thr + .16, n);
  if (dens <= .003) discard;
  // The side toward the Sun is bright: there is less cloud between it and the Sun than on the far side. The step
  // toward the Sun is a few pixels (not less than 2.5 km, not more than 7): from near, every lump has its lit side.
  vec2 s2 = normalize(uSunW.xz + 1e-4); float off = clamp(px * 3., 2.5, 7.), slope = n - cloudN(q + s2 * off, lod), lit = smoothstep(-.07, .09, slope);
  float day = albumDay(), body = smoothstep(thr + .05, thr + .32, n);              // the thick middle of a cloud is a little greyer
  // a cloud that rains stands tall: deeper shade behind its lumps, whiter tops, and nothing shows through it
  float rains = uRain.x > 0. ? wxRainMask(q) : 0., tall = rains * smoothstep(thr - .02, thr + .12, n);
  vec3 col = albumSunCol() * mix((.34 + .86 * lit) * (1. - .2 * body), .24 + 1.02 * smoothstep(-.075, .05, slope), tall) + albumSkyCol() * mix(1.2, 1.05, tall) + albumMoonCol() * (.5 + .7 * lit);
  col = albumFinish(mix(col * .93, albumHorizon(d), albumHaze(P)));
  vec2 v = gl_FragCoord.xy / uRes - .5; col *= 1. - uVig * dot(v, v) * 1.5;         // the vignette of the finishing pass, which this shell is drawn after
  // a cloud that rains is shown from nearer than the others: the rain must hang from something
  float show = mix(uShow, max(uShow, uShowRain), rains);
  gl_FragColor = vec4(col, min(dens * (.42 + .52 * dens) + .6 * tall, 1.) * show * mix(.8, 1., day));
}`;

// (for the tests: the text of the shader of the shell)
export const cloudShader = FRAG;
// how much of the clouds to draw from a distance h (km to the place the camera looks at): the ordinary ones, and the
// ones that rain. Nearer than 60 km the clouds are not drawn at all; from 350 km they are drawn in full. The clouds
// that rain come in sooner — from 30 to 120 km half seen, so that the map under the rain can be read — and from
// 200 km they are whole: a storm cloud as a satellite sees it.
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const cloudShow = h => ss(60, 350, h), rainCloudShow = h => Math.max(ss(30, 120, h) * .55, ss(110, 200, h) * .97);

export default async function init(album) {
  const T = album.terrain.u, p = album.params;
  // a cap of the sphere around the middle of the map, wide enough for the view from 2000 km
  const mesh = new Mesh(new SphereGeometry(1, 192, 72, 0, Math.PI * 2, 0, 1.05), new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...lightUniforms(T), ...WX, uExag: T.uExag, uShow: { value: 0 }, uShowRain: { value: 0 }, uVig: { value: .35 }, uRes: { value: new Vector2(1, 1) } },
  }));
  mesh.position.set(0, -R, 0); mesh.frustumCulled = false; mesh.visible = false;
  (album.overlay || album.scene).add(mesh);
  return { id: 'clouds', mesh, update(dt, t, cam) {
    // None are drawn once the eye itself is down at the height of the clouds. (How much of the sky they cover — and
    // whether there are any — is set by the sky layer: uCloud.x.)
    const on = T.uCloud.value.x > 0 && !!WX.tCloud.value, h = cam.s.h, top = T.uCloud.value.w, above = ss(top + 2, top + 14, cam.alt ?? h), u = mesh.material.uniforms;
    const show = on ? cloudShow(h) * above : 0, showRain = on && WX.uRain.value.x > 0 ? rainCloudShow(h) * above : 0;
    mesh.visible = show + showRain > 0; u.uShow.value = show; u.uShowRain.value = showRain;
    if (mesh.visible) { mesh.scale.setScalar(R + T.uCloud.value.w); album.renderer.getDrawingBufferSize(u.uRes.value); u.uVig.value = p.get('fx') ? .35 : 0; }
  } };
}
