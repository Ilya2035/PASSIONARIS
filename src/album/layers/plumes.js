// The plume of an eruption or of a sand storm as it is drawn (sky/plume.js says where it is): a shell at its height —
// the plume from above and from afar — and, over a volcano, a column of smoke puffs that rise from the crater and
// bend downwind — the eruption from near. The shell is drawn over the finished picture, like the clouds; its shadow
// and what falls out of it are laid on the land by the finishing pass (post.js).
import { Mesh, SphereGeometry, ShaderMaterial, DoubleSide, Vector2, Vector3, BufferGeometry, BufferAttribute, Points, NormalBlending } from 'three';
import { COMMON } from '../glsl.js';
import { LIGHT, lightUniforms } from '../light.js';
import { WEATHER, WX, needClouds } from '../sky/weather.js';
import { GLOBE, GLOBE_GLSL } from '../sky/globe.js';
import { PLUME, PLUME_GLSL, KINDS } from '../sky/plume.js';
import { SHELL_REACH } from './clouds.js';
import { R, fromWorld } from '../geo.js';

const v3 = a => `vec3(${a.map(x => x.toFixed(3)).join(', ')})`;
const FRAG = /* glsl */`
${COMMON}
${LIGHT}
${WEATHER}
${GLOBE_GLSL}
${PLUME_GLSL}
uniform float uShow, uVig; uniform vec2 uRes;
varying vec3 vW;
void main() {
  if (uPl.x <= 0. || uShow <= 0.) discard;
  vec3 U = normalize(vW + vec3(0., RKM, 0.)), C = U * (RKM + uPlK.y), P = C - vec3(0., RKM, 0.);
  // behind the globe: the way from the eye to this point of the shell goes through the ground
  vec3 E = cameraPosition + vec3(0., RKM, 0.), d = C - E; float reach = length(d); d /= reach;
  float b = dot(E, d), disc = b * b - (dot(E, E) - RKM * RKM);
  if (disc > 0. && b < 0. && -b - sqrt(disc) < reach) discard;
  vec3 pl = plumeAt(C); if (pl.x <= .004) discard;
  // its billows are lit from the side of the Sun: the plume asked again a little way toward it
  vec3 sunT = normalize(uSunW - U * dot(uSunW, U) + 1e-4), pl2 = plumeAt(C + sunT * mix(4., 14., pl.y));
  float lit = smoothstep(-.25, .3, pl.z - pl2.z + (pl.x - pl2.x) * .5), day = albumDay();
  // dark and dense by the source, paler and thinner as it goes
  bool dust = uPlK.x > 1.5;
  vec3 tint = dust ? mix(${v3(KINDS.dust.colour)}, ${v3(KINDS.dust.pale)}, pl.y) : mix(${v3(KINDS.ash.colour)}, ${v3(KINDS.ash.pale)}, smoothstep(0., .7, pl.y));
  // (smoke and dust take little of the blue of the sky: ash is grey-brown, dust is yellow)
  vec3 col = tint * (albumSunCol() * (dust ? .45 + .5 * lit : .2 + .5 * lit) + albumSkyCol() * (dust ? .35 : .5) + albumMoonCol() * .5);
  col = albumFinish(mix(col, albumHorizon(d), albumHaze(P) * .8) * globeRelight(U));
  vec2 v = gl_FragCoord.xy / uRes - .5; col *= 1. - uVig * dot(v, v) * 1.5;
  float thick = dust ? .62 : mix(.97, .7, pl.y);
  gl_FragColor = vec4(col, min(pl.x * 1.5, 1.) * thick * uShow * mix(.85, 1., day));
}`;
export const plumeShader = FRAG;
const VERT = /* glsl */`
varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// how much of the shell to draw from a distance h, km: the ash from 40 km (nearer, the column of puffs is the eruption)
// and whole from 160; the dust from 25 km and whole from 120
export const plumeShow = (kind, h) => (kind === 'dust' ? ss(25, 120, h) : ss(40, 160, h));
// the column over a volcano: how many puffs, how long one lives (s of the map's time), how wide the crater is (km)
export const PUFFS = 700, PUFF_LIFE = 26, CRATER_KM = 1.2;

export default function initPlumes(album) {
  const T = album.terrain.u, p = album.params;
  const mesh = new Mesh(new SphereGeometry(1, 192, 96, 0, Math.PI * 2, 0, SHELL_REACH), new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...lightUniforms(T), ...WX, ...GLOBE, ...PLUME, uExag: T.uExag, uShow: { value: 0 }, uVig: { value: .35 }, uRes: { value: new Vector2(1, 1) } },
  }));
  mesh.position.set(0, -R, 0); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  (album.overlay || album.scene).add(mesh);

  // ---- the column: soft puffs, each rising from the crater, slowing at the height of the plume and going downwind
  const pos = new Float32Array(PUFFS * 3), aux = new Float32Array(PUFFS * 3), life = new Float32Array(PUFFS), seedOf = new Float32Array(PUFFS * 3);
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('aAux', new BufferAttribute(aux, 3));
  const puffs = new Points(geo, new ShaderMaterial({
    transparent: true, depthWrite: false, blending: NormalBlending, uniforms: { uScale: { value: 1 }, uSun: T.uSun, uGlow: { value: 0 } },
    // aAux: x the size of the puff (km), y how much of it shows, z its age 0..1
    vertexShader: `attribute vec3 aAux; uniform float uScale; varying vec2 vA;
      void main() { vec4 mv = viewMatrix * vec4(position, 1.); vA = aAux.yz; gl_PointSize = min(320., aAux.x * uScale / max(1., -mv.z)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uGlow; varying vec2 vA;
      void main() {
        vec2 q = gl_PointCoord - .5; float d = length(q) * 2., a = (1. - smoothstep(.2, 1., d)) * vA.x;
        float day = smoothstep(-.08, .15, uSun.z);
        // dark at the crater, paler as it rises and thins; lit from above; by night the fire of the crater glows in the young smoke
        vec3 c = mix(vec3(.13, .12, .12), vec3(.56, .54, .52), smoothstep(0., .8, vA.y)) * mix(1.2, .75, smoothstep(-.4, .3, q.y)) * (.22 + .78 * day);
        c += vec3(1.5, .5, .12) * uGlow * (1. - smoothstep(0., .12, vA.y)) * (1. - d);
        gl_FragColor = vec4(c, a * .5);
      }`,
  }));
  puffs.frustumCulled = false; puffs.renderOrder = 9; puffs.visible = false; album.scene.add(puffs);
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const o = new Vector3(), up = new Vector3(), w = new Vector3(), c = new Vector3(), v = new Vector3(), Y = new Vector3(0, 1, 0), eye = new Vector3();
  let warm = false;
  // one step of the column, dt seconds of the map's time; top: the height of the plume over the crater, km of the world
  function column(dt, cam, base, top) {
    for (let i = 0; i < PUFFS; i++) {
      if (life[i] <= 0) { life[i] = 1; seedOf[i * 3] = rnd(); seedOf[i * 3 + 1] = rnd(); seedOf[i * 3 + 2] = rnd(); if (!warm) life[i] = rnd(); }
      life[i] -= dt / PUFF_LIFE; const age = 1 - Math.max(life[i], 0), a = seedOf[i * 3] * 6.2832, r = seedOf[i * 3 + 1], s = seedOf[i * 3 + 2];
      // it shoots up fast and slows toward the top; from a third of its life the wind has it
      const rise = top * (1 - Math.exp(-age * 5.5)) * (.82 + .3 * s), drift = Math.max(0, age - .22) * (60 + 70 * r), wide = CRATER_KM * (.4 + r) + rise * .22 * (.4 + r) + drift * .1;
      v.copy(o).multiplyScalar(R + base + rise).addScaledVector(w, drift + Math.cos(a) * wide).addScaledVector(c, Math.sin(a) * wide * (1 + drift * .01));
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y - R; pos[i * 3 + 2] = v.z;
      aux[i * 3] = (1.6 + 5 * age + 2 * r) * (1 + drift * .012); aux[i * 3 + 1] = Math.min(1, age * 9) * Math.min(1, life[i] * 3.5); aux[i * 3 + 2] = age;
    }
    warm = true; geo.attributes.position.needsUpdate = true; geo.attributes.aAux.needsUpdate = true;
    puffs.material.uniforms.uScale.value = album.renderer.domElement.height / (2 * Math.tan(cam.cam.fov * Math.PI / 360));
  }
  return { id: 'plumes', mesh, puffs, update(dt, t, cam) {
    const on = PLUME.uPl.value.x > 0, kind = PLUME.uPlK.value.x > 1.5 ? 'dust' : 'ash', u = mesh.material.uniforms;
    const show = on ? plumeShow(kind, cam.s.h) : 0;
    mesh.visible = show > 0; u.uShow.value = show;
    if (mesh.visible) {
      needClouds(); mesh.scale.setScalar(R + PLUME.uPlK.value.y); album.renderer.getDrawingBufferSize(u.uRes.value); u.uVig.value = p.get('fx') ? .35 : 0;
      mesh.quaternion.setFromUnitVectors(Y, up.copy(cam.cam.position).add(eye.set(0, R, 0)).normalize());
    }
    // the column stands over a volcano, and is worth its puffs only from near
    const col = on && kind === 'ash' && cam.s.h < 900;
    puffs.visible = col;
    if (col) {
      o.copy(PLUME.uPlO.value); w.copy(PLUME.uPlW.value); c.copy(PLUME.uPlC.value);
      const ll = fromWorld(v.copy(o).multiplyScalar(R).sub(eye.set(0, R, 0))), base = Math.max(0, album.data.base.at(ll.lat, ll.lon) || 0) * T.uExag.value / 1000;
      puffs.material.uniforms.uGlow.value = 1 - ss(-.1, .12, T.uSun.value.z);
      if (album.shot && !warm) for (let i = 0; i < 40; i++) column(.5, cam, base, PLUME.uPlK.value.y - base);
      column(album.shot ? 0 : dt * p.get('play'), cam, base, PLUME.uPlK.value.y - base);
    } else warm = false;
  } };
}
