// Trees with volume, drawn far larger than life (the album's scale system for objects): a lattice of stylised crowns
// around the camera target, placed entirely in the vertex shader from the same forest rules as the ground shader, so a
// tree stands exactly where the ground is painted as forest. The lattice is anchored to the world, not to the camera.
import { InstancedBufferGeometry, InstancedBufferAttribute, IcosahedronGeometry, Mesh, ShaderMaterial, Vector2 } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT, lightUniforms } from '../glsl.js';
import { FOREST_RULES } from '../aspects/forest.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';

const G = 200;
export default async function init(album) {
  const base = new IcosahedronGeometry(.5, 0), geo = new InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('normal', base.getAttribute('normal'));
  const cells = new Float32Array(G * G * 2);
  for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { cells[k++] = i - G / 2; cells[k++] = j - G / 2; }
  geo.setAttribute('aCell', new InstancedBufferAttribute(cells, 2)); geo.instanceCount = G * G;
  const T = album.terrain.u;
  const mat = new ShaderMaterial({
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uForestK: T.uForestK,
      uSnow: T.uSnow, uSeason: T.uSeason, ...lightUniforms(T), ...album.chunks.uniforms,
      uCellBase: { value: new Vector2() }, uS: { value: .25 }, uK: { value: 1 }, uFade: { value: 1 }, uLod: { value: 0 } },
    vertexShader: `${COMMON}
      ${CHUNK_GLSL}
      ${FOREST_RULES}
      attribute vec2 aCell; uniform vec2 uCellBase; uniform float uS, uK, uFade, uForestK, uLod, uSnow;
      varying vec3 vN; varying vec3 vCol; varying float vY; varying vec3 vW;
      void main() {
        vec2 ci = aCell + uCellBase, jit = hash22(ci + 13.7), pk = (ci + .12 + .76 * jit) * uS;
        vec2 ll = vec2(pk.y / KM, pk.x / (KM * COSREF));
        float e = max(uS * .5, .12), cl = cos(radians(ll.x));
        float h = heightLod(ll, uLod), hE = heightLod(ll + vec2(0., e / (KM * cl)), uLod), hN = heightLod(ll + vec2(e / KM, 0.), uLod);
        float slope = length(vec2(hE - h, hN - h)) / (e * 1000.), hl = max(h, 0.);
        float n1 = fbm(pk / 38.), n2 = fbm(pk / 7.3 + 5.), n3 = vnoise(pk / 1.1), r = hash21(ci + 3.1);
        vec2 cuv = chunkUV(pk); vec4 cA = texture(tChunkA, cuv), cC = texture(tChunkC, cuv);     // the state of the chunk the tree stands in
        float wet = albumWet(ll, hl, n1), cover = albumChunkCover(albumForestShare(wet, hl, slope, n1), uForestK, n2, n3, cA.r);
        float snowline = 2980. - (ll.x - 37.) * 55. + uSnow;
        float edge = max(abs(aCell.x), abs(aCell.y)) / ${(G / 2).toFixed(1)};
        float alive = step(.5, cover) * step(1.5, h) * step(hl, snowline - 150.) * smoothstep(1., .82, edge) * uFade * step(r, .35 + .65 * cover);
        alive *= step(max(max(cC.g * 1.15, cC.r * 1.6), cA.a * .65), hash21(ci + 17.3));         // no trees on fields and under houses, few in a swamp
        float conifer = step(.5, smoothstep(1000., 1700., hl) * .8 + (wet < .52 ? .45 : 0.) + (hash21(ci + 9.4) - .5) * .6);
        float size = uS * uK * (.62 + .5 * r) * alive;
        vec3 p = position;
        if (conifer > .5) { p.xz *= 1.05 - (p.y + .5) * .85; p.y = (p.y + .5) * 1.75 - .5; } else { p.y *= .82; p.xz *= 1. + .25 * sin(r * 40.); }
        vec3 up = normalize(worldOf(ll, 0.) + vec3(0., RKM, 0.));
        float dl = radians(ll.y - LON0);
        vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
        float a = r * 6.2832; vec2 xz = vec2(p.x * cos(a) - p.z * sin(a), p.x * sin(a) + p.z * cos(a));
        vec3 w = worldOf(ll, hl * uExag / 1000.) + (east * xz.x + north * xz.y + up * (p.y + .42)) * size;
        vN = normalize(vec3(normal.x * cos(a) - normal.z * sin(a), normal.x * sin(a) + normal.z * cos(a), normal.y * (conifer > .5 ? .6 : 1.)));
        vec3 broad = mix(vec3(.33, .41, .15), vec3(.18, .38, .13), smoothstep(.5, .75, wet));
        float stand = vnoise(pk / 2.6 + 11.) * .6 + n2 * .4;
        broad = mix(broad, vec3(.42, .50, .17), smoothstep(.58, .8, stand) * .55); broad = mix(broad, vec3(.10, .26, .17), smoothstep(.42, .2, stand) * .5);
        broad = mix(broad, vec3(.56, .48, .17), step(.93, hash21(ci + 21.3)) * .6);
        vCol = mix(broad, vec3(.11, .27, .17), conifer) * (.8 + .45 * hash21(ci + 5.5));
        vY = position.y + .5; vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: `${COMMON}
      ${LIGHT}
      uniform float uSeason; varying vec3 vN; varying vec3 vCol; varying float vY; varying vec3 vW;
      void main() {
        vec3 c = mix(vCol, vec3(.50, .30, .09) * (.7 + .6 * vCol.g * 3.), uSeason * .7);
        c = albumLit(c, vN, 1.45 * (.3 + .7 * vY));                // the light every thing on the land shares
        gl_FragColor = vec4(albumFinish(albumAir(c, vW)), 1.);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; album.scene.add(mesh);
  const p = album.params;
  return { id: 'forest', update(dt, t, cam) {
    const h = cam.s.h, on = !!p.get('forest3d') && p.get('trees') > 0 && h < 170 && !['paper', 'atlas', 'night'].includes(p.get('look'));
    mesh.visible = on; if (!on) return;
    const S = 2 ** Math.round(Math.log2(Math.max(.05, h * .0046)));
    const u = mat.uniforms; u.uS.value = S; u.uK.value = p.get('trees') * .66; u.uFade.value = Math.min(1, (170 - h) / 50);
    u.uLod.value = Math.max(0, Math.log2(S / .234));
    u.uCellBase.value.set(Math.round(cam.s.lon * KM_PER_DEG * COS_REF / S), Math.round(cam.s.lat * KM_PER_DEG / S));
  } };
}
