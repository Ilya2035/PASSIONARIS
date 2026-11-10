// Settlements as small schematic towns built from blocks (drawn larger than life and growing with the camera height),
// placed at the Natural Earth populated places of the region as stand-ins: the game has no peoples yet. Two ways of
// building show how culture changes the look: a regular grid in the south and east, loose rings in the Atlantic north.
import { InstancedBufferGeometry, InstancedBufferAttribute, BoxGeometry, Mesh, ShaderMaterial } from 'three';
import { COMMON } from '../glsl.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export default async function init(album) {
  const places = album.data.vectors.places, ll = [], off = [], size = [], tint = [];
  places.forEach((pl, pi) => {
    const R = rng(pi * 7919 + 17), count = Math.max(5, Math.min(240, Math.round(1.15 * pl.pop ** .33))), ringy = pl.lat > 41.6 && pl.lon < -1.5;
    const rad = Math.sqrt(count) * .78;
    for (let i = 0; i < count; i++) {
      let x, y, rot;
      if (ringy) { const r = rad * Math.sqrt((i + .5) / count), a = i * 2.39996 + R() * .5; x = r * Math.cos(a); y = r * Math.sin(a); rot = R() * 6.28; }
      else { const side = Math.ceil(Math.sqrt(count * 1.25)), gx = (i % side) - side / 2, gy = Math.floor(i / side) - side / 2; x = gx * 1.32 + (R() - .5) * .25; y = gy * 1.32 + (R() - .5) * .25; rot = (R() - .5) * .12; if (Math.hypot(x, y) > rad * 1.25) continue; }
      const c = 1 - Math.min(1, Math.hypot(x, y) / (rad + .01)), big = i < 3 ? 1.7 : 1;
      ll.push(pl.lat, pl.lon); off.push(x, y, rot, i / count);
      size.push((.75 + R() * .5) * big, (.75 + R() * .5) * big, (.38 + R() * .45 + c * .5) * big); tint.push(R(), ringy ? 1 : 0);
    }
  });
  const box = new BoxGeometry(1, 1, 1), geo = new InstancedBufferGeometry();
  geo.index = box.index; geo.setAttribute('position', box.getAttribute('position')); geo.setAttribute('normal', box.getAttribute('normal'));
  geo.setAttribute('aLL', new InstancedBufferAttribute(new Float32Array(ll), 2)); geo.setAttribute('aOff', new InstancedBufferAttribute(new Float32Array(off), 4));
  geo.setAttribute('aSize', new InstancedBufferAttribute(new Float32Array(size), 3)); geo.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(tint), 2));
  geo.instanceCount = ll.length / 2;
  const T = album.terrain.u;
  const mat = new ShaderMaterial({
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uSun: T.uSun, uUnit: { value: .05 }, uGrowth: { value: 1 }, uPaper: { value: 0 } },
    vertexShader: `${COMMON}
      attribute vec2 aLL, aTint; attribute vec4 aOff; attribute vec3 aSize; uniform float uUnit, uGrowth;
      varying vec3 vN; varying vec2 vT; varying float vY;
      void main() {
        float show = step(aOff.w, uGrowth), cr = cos(aOff.z), sr = sin(aOff.z), cl = cos(radians(aLL.x));
        vec2 o = aOff.xy * uUnit * min(1., .6 + .4 * uGrowth);
        vec2 ll = aLL + vec2(o.y / KM, o.x / (KM * cl));
        float h = max(heightLod(ll, 0.), 0.) * uExag / 1000.;
        vec3 p = position * aSize.xzy * uUnit * show; p.y += aSize.z * uUnit * .5 * show;
        vec2 xz = vec2(p.x * cr - p.z * sr, p.x * sr + p.z * cr);
        vec3 up = normalize(worldOf(ll, 0.) + vec3(0., RKM, 0.)); float dl = radians(ll.y - LON0);
        vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
        vN = vec3(normal.x * cr - normal.z * sr, normal.x * sr + normal.z * cr, normal.y); vT = aTint; vY = position.y + .5;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldOf(ll, h) + east * xz.x + north * xz.y + up * p.y, 1.);
      }`,
    fragmentShader: `uniform vec3 uSun; uniform float uPaper; varying vec3 vN; varying vec2 vT; varying float vY;
      void main() {
        float day = smoothstep(-.08, .12, uSun.z), roof = step(.5, vN.z), nl = max(dot(normalize(vN), uSun), 0.);
        vec3 wall = mix(vec3(.80, .72, .58), vec3(.70, .64, .55), vT.x), top = mix(mix(vec3(.62, .50, .30), vec3(.52, .42, .27), vT.x), vec3(.45, .40, .30), vT.y);
        vec3 c = mix(wall, top, roof); c = mix(c, vec3(.36, .28, .22), uPaper);
        c = pow(c, vec3(2.2)) * (vec3(1.22, 1.15, 1.02) * nl * 1.25 * day + mix(vec3(.10, .13, .22), vec3(.46, .58, .78), day) * .62 * (.45 + .55 * vY));
        c += vec3(1., .62, .25) * (1. - day) * (1. - roof) * step(.72, vT.x) * .9;                  // a few lit windows at night
        c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14);
        gl_FragColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / 2.2)), 1.);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; album.scene.add(mesh);
  const p = album.params;
  return { id: 'towns', update(dt, t, cam) {
    const on = !!p.get('towns') && p.get('houses') > 0 && cam.s.h < 900;
    mesh.visible = on; if (!on) return;
    mat.uniforms.uUnit.value = .078 * (cam.s.h / 20) ** .8 * p.get('houses');
    mat.uniforms.uGrowth.value = p.get('growth'); mat.uniforms.uPaper.value = ['paper', 'atlas'].includes(p.get('look')) ? 1 : 0;
  } };
}
