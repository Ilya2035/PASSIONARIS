// The places of the towns of the districts (centres.js) as marks on the map, for checking where they stand (knob
// «Деление: места городов районов»): a dot of the same size on the screen at any height; its colour says why the
// place was chosen, a ring marks the seat of a province, a bigger one the seat of a historical land or a region.
// The towns themselves are drawn by the settlement work (layers/towns.js); these marks only show the places.
import { BufferGeometry, BufferAttribute, Points, ShaderMaterial } from 'three';
import { COMMON } from '../glsl.js';
import { llOf } from '../chunks.js';
import { SEAT } from './centres.js';

// by PLACE_WHY: a real town, a bay, a river mouth, the shore, rivers meeting, a river, level ground, the best there is
const COLOUR = [[.98, .97, .92], [.16, .42, .86], [.10, .66, .78], [.44, .74, .96], [.62, .30, .82], [.24, .52, .96], [.36, .74, .30], [.92, .40, .24]];

export function createPlaces(album, div) {
  const c = div.centres, list = [];
  for (let d = 0; d < div.count; d++) if (c && c.texel[d] >= 0) list.push(d);
  const n = list.length, ll = new Float32Array(n * 2), col = new Float32Array(n * 3), size = new Float32Array(n), pos = new Float32Array(n * 3);
  list.forEach((d, i) => {
    const p = llOf(c.x[d], c.y[d]); ll[i * 2] = p.lat; ll[i * 2 + 1] = p.lon;
    col.set(COLOUR[c.why[d]] || COLOUR[7], i * 3);
    size[i] = c.seat[d] & (SEAT.region | SEAT.land) ? 3 : c.seat[d] & SEAT.province ? 2 : 1;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('aLL', new BufferAttribute(ll, 2));
  geo.setAttribute('aCol', new BufferAttribute(col, 3)); geo.setAttribute('aSize', new BufferAttribute(size, 1));
  const T = album.terrain.u;
  const mat = new ShaderMaterial({
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uPx: { value: 1 } },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `${COMMON}
      attribute vec2 aLL; attribute vec3 aCol; attribute float aSize; uniform float uPx; varying vec3 vCol; varying float vSize;
      void main() {
        vec3 w = worldOf(aLL, max(heightLod(aLL, 0.), 0.) * uExag / 1000. + .02);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
        vCol = aCol; vSize = aSize; gl_PointSize = (7. + 4. * aSize) * uPx;
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vSize;
      void main() {
        vec2 q = gl_PointCoord * 2. - 1.; float r = length(q), R = 1. - .9 / (7. + 4. * vSize);
        if (r > 1.) discard;
        float core = 1. - smoothstep(.42, .52, r), ring = vSize > 1.5 ? smoothstep(.62, .7, r) * (1. - smoothstep(R - .12, R, r)) : 0.;
        float edge = (1. - smoothstep(.52, .62, r)) * (1. - core);
        vec3 c = mix(vec3(.05), vCol, core); c = mix(c, vSize > 2.5 ? vec3(.85, .12, .10) : vec3(.10), ring);
        float a = max(max(core, edge), ring * .95);
        gl_FragColor = vec4(pow(c, vec3(1. / 2.2)), a);
      }`,
  });
  const pts = new Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 9; pts.visible = false;
  album.scene.add(pts);
  return {
    update(show) { pts.visible = !!show; mat.uniforms.uPx.value = album.renderer.getPixelRatio(); },
    dispose() { album.scene.remove(pts); geo.dispose(); mat.dispose(); },
  };
}
