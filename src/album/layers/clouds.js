// Clouds seen from a height (docs/album/sky.md, «Погода»): one thin shell around the globe at the height of the
// cloud layer. Where the field of the clouds (sky/weather.js) is thick there is cloud: white on the side of the
// Sun, grey-blue on the far side, with ragged edges. A cloud that rains is a dark storm cloud: grey and heavy, its
// lumps lighter where the Sun reaches them, and nothing shows through it. The same field darkens the ground under it
// (albumCloudShade, laid over the finished picture by post.js), so every cloud has its shadow. Near the ground the
// clouds melt away and only the shadows and the rain stay: the map under them must be readable. Switched by the knobs
// «Облака», «Облачность» and «Дождь» (aspects/sky.js).
//
// The clouds cover the whole Earth: how much of them a place has goes by its climate, and they are born, grow and
// melt as the wind carries them (sky/weather.js).
//
// The shell is not part of the scene of the map: it is drawn over the finished picture (album.overlay, main.js),
// after the pass that lays the shadows — otherwise a cloud would be darkened by its own shadow on the land below.
// It is hidden behind the globe by its own arithmetic, not by the depth buffer. It is the half of a sphere that
// faces the eye: it turns with the camera.
import { Mesh, SphereGeometry, ShaderMaterial, DoubleSide, Vector2, Vector3 } from 'three';
import { COMMON } from '../glsl.js';
import { LIGHT, lightUniforms } from '../light.js';
import { WEATHER, WX, CLOUD_KM, GROW_KM, GROW, GROW_LOD, CLOUD_N, MAP_ROUND } from '../sky/weather.js';
import { GLOBE, GLOBE_GLSL } from '../sky/globe.js';
import { R, COS_REF } from '../geo.js';

const VERT = /* glsl */`
varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;

// The lumps of a cloud top are the picture of the clouds itself, read much smaller, twice: lumps of 24, 9 and 3.6 km,
// then of 6, 2 and 1 km. A read of the picture is several times cheaper than noise counted in the pixel, and it has
// no square grain. Each is read at a level of detail by the size of the pixel: lumps smaller than a pixel fade by
// themselves. [how many times the read repeats around the Earth — a whole number, so that the map of the weather
// closes without a seam — and the weight of the read]
export const LUMPS = [[49, .34], [204, .16]];
const LUMP_KM = LUMPS.map(l => MAP_ROUND / l[0]);
// how far toward the Sun the neighbour stands that a whole cloud is shaded by, km: its side away from the Sun is darker
export const BANK_STEP = 26;
const FRAG = /* glsl */`
${COMMON}
${LIGHT}
${WEATHER}
${GLOBE_GLSL}
uniform float uShow, uShowRain, uVig; uniform vec2 uRes;
varying vec3 vW;
// (The picture is read smoothly here: between its points the value turns without a kink. A plain read runs straight
// from point to point, and the light of a cloud, which is counted from the slope of the field, then shows every
// point of the picture as a flat patch with a hard edge.)
float cloudTex(vec2 uv, float lod) { uv = uv * ${CLOUD_N.toFixed(1)} + .5; vec2 i = floor(uv), f = uv - i; return textureLod(tCloud, (i + f * f * (3. - 2. * f) - .5) / ${CLOUD_N.toFixed(1)}, lod).r; }
// the lumps of the clouds over a place of the map; lod: for the larger and the smaller ones, by the size of the pixel
float cloudLumps(vec2 q, vec2 lod) {
  vec2 p = q + uCloud.yz;
  return (cloudTex(p / ${LUMP_KM[0].toFixed(3)} + .23, lod.x) - .5) * ${LUMPS[0][1]} + (cloudTex(p / ${LUMP_KM[1].toFixed(3)} + .61, lod.y) - .5) * ${LUMPS[1][1]};
}
void main() {
  if (uCloud.x <= 0. || uShow + uShowRain <= 0.) discard;
  vec3 U = normalize(vW + vec3(0., RKM, 0.)), C = U * (RKM + uCloud.w), P = C - vec3(0., RKM, 0.);   // (the triangles of the shell are flat: back onto the sphere)
  // behind the globe: the way from the eye to this point of the shell goes through the ground
  vec3 E = cameraPosition + vec3(0., RKM, 0.), d = C - E; float reach = length(d); d /= reach;
  float b = dot(E, d), disc = b * b - (dot(E, E) - RKM * RKM);
  if (disc > 0. && b < 0. && -b - sqrt(disc) < reach) discard;
  vec4 m = wxMap(C); vec2 q = m.xy, clim = wxClim(m);
  // km of the map in one pixel (the map is stretched toward the poles), and the levels of detail by it
  float polar = wxPolar(m.w), px = length(fwidth(C)) * exp2(polar) * ${COS_REF.toFixed(5)};
  vec2 lod = log2(max(px / vec2(${(LUMP_KM[0] / 1024).toFixed(4)}, ${(LUMP_KM[1] / 1024).toFixed(4)}), 1.)) + polar, qb = (q + uCloud.yz) / ${CLOUD_KM.toFixed(3)};
  // the field: the clouds themselves (read smoothly), what makes them grow and melt, and the lumps
  float base = cloudTex(qb, polar), lumps = cloudLumps(q, lod), thr = wxThr(clim.x), n = base + wxGrow(q, polar) + lumps, dens = smoothstep(thr - .04, thr + .16, n);
  if (dens <= .003) discard;
  // The side toward the Sun is bright: there is less cloud between it and the Sun than on the far side. The step
  // toward the Sun is a few pixels (not less than 2.5 km, not more than 7): from near, every lump has its lit side.
  // (which way the Sun is on the map: one direction for the frame, that of the place the camera looks at — where the
  // Sun stands otherwise, the view is so wide that the lit sides of the clouds are smaller than a pixel)
  vec2 s2 = uSunMap;
  // (The clouds themselves are asked once more, softly, BANK_STEP km toward the Sun: that gives the slope of the
  // whole cloud. The lumps are asked again at the step itself. What makes the clouds grow is the same at all three.)
  float toSun = textureLod(tCloud, qb + s2 * ${(BANK_STEP / CLOUD_KM).toFixed(6)}, polar + 2.).r - base, off = clamp(px * 3., 2.5, 7.);
  float slope = lumps - cloudLumps(q + s2 * off, lod) - toSun * off * ${(1 / BANK_STEP).toFixed(5)}, lit = smoothstep(-.07, .09, slope);
  // And a whole cloud has a lit side and a far side: where more cloud stands toward the Sun, this place is in its
  // shade. That, more than the lumps, is what makes a bank of cloud a body and not a flat patch.
  float bank = smoothstep(-.008, .06, toSun);
  float day = albumDay(), body = smoothstep(thr + .05, thr + .32, n);              // the thick middle of a cloud is a little greyer
  // a cloud that rains is dark and heavy: grey, with lighter lumps on the side of the Sun, and nothing shows through it
  float rains = uRain.x > 0. ? wxRainMask(q, clim.y) : 0., tall = rains * smoothstep(thr - .02, thr + .12, n);
  vec3 col = albumSunCol() * mix((.30 + .92 * lit) * (1. - .22 * body) * (1. - .30 * bank), (.02 + .13 * smoothstep(-.075, .05, slope)) * (1. - .25 * bank), tall)
    + albumSkyCol() * mix(1.2 - .12 * bank, .32, tall) + albumMoonCol() * (.5 + .7 * lit);
  // (from a height a cloud is lit by the Sun of its own place: day and night on the ball, sky/globe.js)
  // Lightning lights the storm cloud from inside: a blue-white flash, whatever the hour.
  col = albumFinish(mix(col * .93, albumHorizon(d), albumHaze(P)) * globeRelight(U) + vec3(.62, .74, 1.) * (wxFlash(q) * tall * 1.5));
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
// 200 km they are whole.
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const cloudShow = h => ss(60, 350, h), rainCloudShow = h => Math.max(ss(30, 120, h) * .55, ss(110, 200, h) * .97);
// how much of a sphere the shell is: from the point under the eye out to this angle (the whole ball seen from the
// greatest height of the camera reaches 76°, and the shell stands a little above the ground)
export const SHELL_REACH = 1.5;

export default async function init(album) {
  const T = album.terrain.u, p = album.params;
  const mesh = new Mesh(new SphereGeometry(1, 192, 96, 0, Math.PI * 2, 0, SHELL_REACH), new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...lightUniforms(T), ...WX, ...GLOBE, uExag: T.uExag, uShow: { value: 0 }, uShowRain: { value: 0 }, uVig: { value: .35 }, uRes: { value: new Vector2(1, 1) } },
  }));
  mesh.position.set(0, -R, 0); mesh.frustumCulled = false; mesh.visible = false;
  (album.overlay || album.scene).add(mesh);
  const Y = new Vector3(0, 1, 0), up = new Vector3();
  return { id: 'clouds', mesh, update(dt, t, cam) {
    // None are drawn once the eye itself is down at the height of the clouds. (How much of the sky they cover — and
    // whether there are any — is set by the sky layer: uCloud.x.)
    const on = T.uCloud.value.x > 0 && !!WX.tCloud.value, h = cam.s.h, top = T.uCloud.value.w, above = ss(top + 2, top + 14, cam.alt ?? h), u = mesh.material.uniforms;
    const show = on ? cloudShow(h) * above : 0, showRain = on && WX.uRain.value.x > 0 ? rainCloudShow(h) * above : 0;
    mesh.visible = show + showRain > 0; u.uShow.value = show; u.uShowRain.value = showRain;
    if (mesh.visible) {
      mesh.scale.setScalar(R + T.uCloud.value.w); album.renderer.getDrawingBufferSize(u.uRes.value); u.uVig.value = p.get('fx') ? .35 : 0;
      // the half of the sphere that faces the eye
      mesh.quaternion.setFromUnitVectors(Y, up.copy(cam.cam.position).add(Y.clone().multiplyScalar(R)).normalize());
    }
  } };
}
