// Lines laid on the ground (rivers, roads) as ribbons whose width never falls under a few pixels: the higher the
// camera, the wider they are drawn relative to the land — the album's "scale system" for linear things.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DoubleSide } from 'three';
import { COMMON } from '../glsl.js';
import { KM_PER_DEG } from '../geo.js';

const D = Math.PI / 180;
// Chaikin corner cutting, then resampling to a fixed step in km
export function smoothLine(pts, step = 1.5, rounds = 2) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); }
    q.push(p[p.length - 1]); p = q;
  }
  const out = [p[0]]; let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], c = Math.cos(a[1] * D), dx = (b[0] - a[0]) * KM_PER_DEG * c, dy = (b[1] - a[1]) * KM_PER_DEG, len = Math.hypot(dx, dy);
    let t = step - acc;
    while (t <= len) { out.push([a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len]); t += step; }
    acc = (acc + len) % step;
  }
  out.push(p[p.length - 1]);
  return out;
}

// lines: [{ pts: [[lon, lat], ...], width: km, kind: 0|1 }]
export function makeRibbons(album, lines, { colour = 0x2a6a8a, minPx = 2.2, dash = 0, lift = .004 } = {}) {
  let n = 0; for (const l of lines) n += l.pts.length;
  const ll = new Float32Array(n * 4), dir = new Float32Array(n * 4), side = new Float32Array(n * 2), wk = new Float32Array(n * 4), pos = new Float32Array(n * 6), idx = [];
  let v = 0;
  for (const l of lines) {
    let dist = 0;
    for (let i = 0; i < l.pts.length; i++) {
      const p = l.pts[i], a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)], c = Math.cos(p[1] * D);
      let dx = (b[0] - a[0]) * c, dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      if (i) dist += Math.hypot((p[0] - l.pts[i - 1][0]) * c, p[1] - l.pts[i - 1][1]) * KM_PER_DEG;
      for (let s = 0; s < 2; s++, v++) {
        ll[v * 2] = p[1]; ll[v * 2 + 1] = p[0]; dir[v * 2] = dx; dir[v * 2 + 1] = dy; side[v] = s ? 1 : -1; wk[v * 2] = l.width; wk[v * 2 + 1] = dist;
      }
      if (i) { const k = v - 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('aLL', new BufferAttribute(ll, 2)); geo.setAttribute('aDir', new BufferAttribute(dir, 2));
  geo.setAttribute('aSide', new BufferAttribute(side, 1)); geo.setAttribute('aW', new BufferAttribute(wk, 2)); geo.setIndex(idx);
  const T = album.terrain.u;
  const mat = new ShaderMaterial({
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uSun: T.uSun,
      uPx: { value: .1 }, uK: { value: 1 }, uMinPx: { value: minPx }, uColour: { value: new Color(colour) }, uDash: { value: dash }, uLift: { value: lift }, uAlpha: { value: 1 } },
    transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12,
    vertexShader: `${COMMON}
      attribute vec2 aLL, aDir, aW; attribute float aSide; uniform float uPx, uK, uMinPx, uLift; varying float vSide, vDist, vW;
      void main() {
        float w = max(aW.x, uMinPx * uPx) * uK;
        vec2 off = vec2(-aDir.y, aDir.x) * aSide * w * .5;
        vec2 ll = aLL + vec2(off.y / KM, off.x / (KM * cos(radians(aLL.x))));
        float h = max(heightLod(aLL, 0.), 0.) * uExag / 1000. + uLift + w * .01;
        vSide = aSide; vDist = aW.y; vW = w / max(uPx, 1e-4);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldOf(ll, h), 1.);
      }`,
    fragmentShader: `uniform vec3 uColour, uSun; uniform float uDash, uAlpha; varying float vSide, vDist, vW;
      void main() {
        float edge = 1. - smoothstep(1. - 1.6 / max(vW, 1.6), 1., abs(vSide));
        float a = edge * uAlpha;
        if (uDash > 0.) a *= step(fract(vDist / uDash), .62);
        float day = smoothstep(-.08, .15, uSun.z);
        vec3 c = uColour * (.35 + .65 * day) * (1.08 - .62 * smoothstep(.4, .95, abs(vSide)));
        gl_FragColor = vec4(pow(c, vec3(1. / 2.2)), a);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  album.scene.add(mesh);
  return { mesh, u: mat.uniforms, setPx(cam, dom) { mat.uniforms.uPx.value = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight); } };
}
