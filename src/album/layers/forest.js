// Trees with volume, drawn far larger than life (the album's scale system for objects): a lattice of stylised crowns
// around the camera target, placed entirely in the vertex shader from the same forest rules as the ground shader, so a
// tree stands exactly where the ground is painted as forest. The lattice is anchored to the world, not to the camera.
import { InstancedBufferGeometry, InstancedBufferAttribute, IcosahedronGeometry, Mesh, ShaderMaterial, Vector2 } from 'three';
import { COMMON } from '../glsl.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';

const G = 150;
export default async function init(album) {
  const base = new IcosahedronGeometry(.5, 0), geo = new InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('normal', base.getAttribute('normal'));
  const cells = new Float32Array(G * G * 2);
  for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { cells[k++] = i - G / 2; cells[k++] = j - G / 2; }
  geo.setAttribute('aCell', new InstancedBufferAttribute(cells, 2)); geo.instanceCount = G * G;
  const T = album.terrain.u;
  const mat = new ShaderMaterial({
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uSun: T.uSun, uForestK: T.uForestK,
      uSnow: T.uSnow, uSeason: T.uSeason, uSat: T.uSat, uCellBase: { value: new Vector2() }, uS: { value: .25 }, uK: { value: 1 }, uFade: { value: 1 }, uLod: { value: 0 } },
    vertexShader: `${COMMON}
      attribute vec2 aCell; uniform vec2 uCellBase; uniform float uS, uK, uFade, uForestK, uLod, uSnow;
      varying vec3 vN; varying vec3 vCol; varying float vY;
      void main() {
        vec2 ci = aCell + uCellBase, jit = hash22(ci + 13.7), pk = (ci + .12 + .76 * jit) * uS;
        vec2 ll = vec2(pk.y / KM, pk.x / (KM * COSREF));
        float e = max(uS * .5, .12), cl = cos(radians(ll.x));
        float h = heightLod(ll, uLod), hE = heightLod(ll + vec2(0., e / (KM * cl)), uLod), hN = heightLod(ll + vec2(e / KM, 0.), uLod);
        float slope = length(vec2(hE - h, hN - h)) / (e * 1000.), hl = max(h, 0.);
        float n1 = fbm(pk / 38.), n2 = fbm(pk / 7.3 + 5.), n3 = vnoise(pk / 1.1), r = hash21(ci + 3.1);
        float wet = albumWet(ll, hl, n1), cover = albumCover(albumForestShare(wet, hl, slope, n1), uForestK, n2, n3);
        float snowline = 2980. - (ll.x - 37.) * 55. + uSnow;
        float edge = max(abs(aCell.x), abs(aCell.y)) / ${(G / 2).toFixed(1)};
        float alive = step(.5, cover) * step(1.5, h) * step(hl, snowline - 150.) * smoothstep(1., .82, edge) * uFade * step(r, .35 + .65 * cover);
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
        vCol = mix(broad, vec3(.11, .27, .17), conifer) * (.8 + .45 * hash21(ci + 5.5));
        vY = position.y + .5;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: `uniform vec3 uSun; uniform float uSeason, uSat; varying vec3 vN; varying vec3 vCol; varying float vY;
      void main() {
        float day = smoothstep(-.08, .12, uSun.z), nl = max(dot(normalize(vN), uSun), 0.);
        vec3 c = mix(vCol, vec3(.50, .30, .09) * (.7 + .6 * vCol.g * 3.), uSeason * .7);
        c = pow(c, vec3(2.2)) * (vec3(1.22, 1.15, 1.02) * nl * 1.25 * day + mix(vec3(.10, .13, .22), vec3(.46, .58, .78), day) * .9 * (.3 + .7 * vY));
        c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14);
        c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, uSat);
        gl_FragColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / 2.2)), 1.);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; album.scene.add(mesh);
  const p = album.params;
  return { id: 'forest', update(dt, t, cam) {
    const h = cam.s.h, on = !!p.get('forest3d') && p.get('trees') > 0 && h < 170 && !['paper', 'atlas', 'night'].includes(p.get('look'));
    mesh.visible = on; if (!on) return;
    const S = 2 ** Math.round(Math.log2(Math.max(.1, h * .0085)));
    const u = mat.uniforms; u.uS.value = S; u.uK.value = p.get('trees') * .74; u.uFade.value = Math.min(1, (170 - h) / 50);
    u.uLod.value = Math.max(0, Math.log2(S / .234));
    u.uCellBase.value.set(Math.round(cam.s.lon * KM_PER_DEG * COS_REF / S), Math.round(cam.s.lat * KM_PER_DEG / S));
  } };
}
