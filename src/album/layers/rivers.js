// Rivers of the region (Natural Earth centre lines) as sheets of the same water as the sea and the lakes. The sheet
// is the bed of the river, wider than its water: the channel swings from one side of the bed to the other and leaves
// bars of pale sand and gravel on the inside of every swing; it is deep under the outer bank and shallow over the
// bar; the banks stand a little above it, lit on the side that faces the sun. The bed grows from the source down
// and is never thinner than a few pixels: the higher the camera, the wider the river is drawn against the land.
// A river freezes with its chunk, a little later than still water. Where the height data says sea, it ends.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DoubleSide, CustomBlending, SrcAlphaFactor, OneMinusSrcAlphaFactor } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT } from '../glsl.js';
import { SHEET_VERT, SHEET_FRAG, sheetUniforms, sheetPull } from '../aspects/water.js';
import { smoothLine } from './ribbon.js';
import { KM_PER_DEG } from '../geo.js';

const D = Math.PI / 180;
const FLAT = { atlas: 0x3d78b8, paper: 0x5f8fb5, night: 0x6f8fb0 };          // looks that draw rivers as plain lines
export const riverWidth = rank => (rank <= 5 ? .6 : rank <= 6 ? .52 : rank <= 7 ? .44 : rank <= 8 ? .38 : .32);   // km, the bed from bank to bank at the mouth

// The lines of Natural Earth are drawn for a 1:10 000 000 map: straight runs with sharp corners. A river on open
// ground winds, so the line is rounded and then swung from side to side, by less where the valley is narrow (the
// height data rises close by on either side).
function meander(pts, seed, heightAt) {
  const n = pts.length; if (n < 6) return pts;
  const avg = (src, r) => src.map((p, i) => { if (i < r || i >= n - r) return p; let x = 0, y = 0; for (let k = -r; k <= r; k++) { x += src[i + k][0]; y += src[i + k][1]; } return [x / (2 * r + 1), y / (2 * r + 1)]; });
  const base = avg(pts, 2), out = [], f1 = 1.3 + (seed * .37) % 1.7, f2 = 4.1 + (seed * .61) % 2.3;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = base[i], a = base[Math.max(0, i - 1)], b = base[Math.min(n - 1, i + 1)], c = Math.cos(p[1] * D);
    let dx = (b[0] - a[0]) * c, dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    if (i) dist += Math.hypot((p[0] - base[i - 1][0]) * c, p[1] - base[i - 1][1]) * KM_PER_DEG;
    let amp = .42 * Math.min(1, i / 6, (n - 1 - i) / 6);                                     // km; the ends stay where they are
    if (heightAt) {
      const h0 = heightAt(p[1], p[0]), e = .8 / KM_PER_DEG;
      const rise = Math.max(heightAt(p[1] + dx * e, p[0] - dy * e / c), heightAt(p[1] - dx * e, p[0] + dy * e / c)) - h0;
      amp *= Math.max(.12, Math.min(1, 1 - (rise - 6) / 30));
    }
    const m = (Math.sin(dist / .95 + f1) * .6 + Math.sin(dist / .52 + f2) * .4) * amp / KM_PER_DEG;
    out.push([p[0] - dy * m / c, p[1] + dx * m]);
  }
  return avg(out, 1);
}

// Natural Earth lines → what the sheet is built from: smooth points, the width at each, which end is the source.
// heightAt(lat, lon) → metres decides which way the water runs; without it the line keeps its order.
export function riverLines(rivers, heightAt) {
  const lines = rivers.filter(r => r.pts.length > 2).map((r, li) => ({ name: r.name, rank: r.rank, pts: meander(smoothLine(r.pts, .7, 3), li, heightAt) }));
  const ends = lines.flatMap(l => [l.pts[0], l.pts[l.pts.length - 1]]);
  const km = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos(a[1] * D), a[1] - b[1]) * KM_PER_DEG;
  for (const l of lines) {
    const a = l.pts[0], b = l.pts[l.pts.length - 1];
    if (heightAt && heightAt(a[1], a[0]) < heightAt(b[1], b[0])) l.pts.reverse();          // from the source down
    // the river ends where it first meets the sea for good (2 km of it under water) and does not come out again on
    // the shoals and islands beyond; its last kilometre fades into the sea
    l.mouth = false;
    if (heightAt) for (let i = 0, wet = 0; i < l.pts.length; i++) {
      wet = heightAt(l.pts[i][1], l.pts[i][0]) < -.3 ? wet + 1 : 0;
      if (wet === 3) { l.pts.length = i; l.mouth = true; break; }
    }
    const src = l.pts[0], spring = !ends.some(e => e !== a && e !== b && km(e, src) < 4);   // no other piece ends here: a real source
    let len = 0; const at = [0];
    for (let i = 1; i < l.pts.length; i++) at.push(len += km(l.pts[i], l.pts[i - 1]));
    const W = riverWidth(l.rank);
    l.width = at.map(d => W * (spring ? .42 + .58 * Math.min(1, d / Math.min(len, 160)) ** .7 : 1));
    l.dist = at; l.spring = spring;
    l.fade = at.map(d => (l.mouth ? Math.min(1, (len - d) / 1.2) : 1));
  }
  return lines.filter(l => l.pts.length > 2);
}

export default async function init(album) {
  const lines = riverLines(album.data.vectors.rivers, album.data.base.at);
  let n = 0; for (const l of lines) n += l.pts.length;
  const ll = new Float32Array(n * 4), dir = new Float32Array(n * 4), side = new Float32Array(n * 2), end = new Float32Array(n * 2), wk = new Float32Array(n * 6), idx = [];
  let v = 0;
  lines.forEach((l, li) => {
    for (let i = 0; i < l.pts.length; i++) {
      const p = l.pts[i], a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)], c = Math.cos(p[1] * D);
      let dx = (b[0] - a[0]) * c, dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      for (let s = 0; s < 2; s++, v++) {
        ll[v * 2] = p[1]; ll[v * 2 + 1] = p[0]; dir[v * 2] = dx; dir[v * 2 + 1] = dy; side[v] = s ? 1 : -1; end[v] = l.fade[i];
        wk[v * 3] = l.width[i]; wk[v * 3 + 1] = l.dist[i]; wk[v * 3 + 2] = li * 3.7 + 1.3;
      }
      if (i) { const k = v - 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3)); geo.setAttribute('aLL', new BufferAttribute(ll, 2)); geo.setAttribute('aDir', new BufferAttribute(dir, 2));
  geo.setAttribute('aSide', new BufferAttribute(side, 1)); geo.setAttribute('aW', new BufferAttribute(wk, 3)); geo.setAttribute('aEnd', new BufferAttribute(end, 1)); geo.setIndex(idx);
  const mat = new ShaderMaterial({
    uniforms: { ...sheetUniforms(album), uPx: { value: .1 }, uK: { value: 1 }, uMinPx: { value: 3.4 }, uFlat: { value: new Color(FLAT.atlas) } },
    transparent: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, side: DoubleSide,
    vertexShader: `${COMMON}
      ${SHEET_VERT}
      attribute vec2 aLL, aDir; attribute vec3 aW; attribute float aSide, aEnd; uniform float uPx, uK, uMinPx;
      varying float vSide, vEnd; varying vec3 vRiv; varying vec2 vAcross;
      void main() {
        float w = max(aW.x * uK, uMinPx * uPx * (.6 + .4 * aW.x / .6));                 // the whole bed, bank to bank
        vec2 across = vec2(-aDir.y, aDir.x) * aSide, off = across * w * .5;
        vSide = aSide; vEnd = aEnd; vRiv = vec3(w, aW.y, aW.z); vAcross = across;
        sheetVertex(aLL + vec2(off.y / KM, off.x / (KM * cos(radians(aLL.x)))), max(heightLod(aLL, 0.), 0.) * uExag / 1000. + .002);
      }`,
    fragmentShader: `${COMMON}
      ${CHUNK_GLSL}
      ${LIGHT}
      ${SHEET_FRAG}
      uniform vec3 uFlat; varying float vSide, vEnd; varying vec3 vRiv; varying vec2 vAcross;
      void main() {
        Wtr w = sheetWater(2);
        float wKm = vRiv.x, s = vSide, far = smoothstep(.2, .07, w.px / wKm);               // 0 when the bed is only a few pixels wide
        // the channel swings across the bed; its edges wander a little
        float sw = (wNoise(vec2(vRiv.y / (wKm * 3.2), vRiv.z + 9.)) - .5) * 4.5, c = clamp(sw, -1., 1.) * .4 * far;
        float hw = mix(.8, .56 + .14 * wNoise(vec2(vRiv.y / (wKm * 1.9), vRiv.z + 4.)), far);       // half of the channel, in halves of the bed
        float x = (s - c) / hw, aa = max(w.px / wKm * 2. / hw, .012);
        float edge = 1. - abs(x) + (wNoise(vec2(vRiv.y / (wKm * .7), vRiv.z + s * 2.)) - .5) * .22 * far;
        float water = smoothstep(-aa, aa, edge), bed = (1. - smoothstep(.74, .97, abs(s) + (wNoise(vec2(vRiv.y / (wKm * .9), vRiv.z + s * 3. + 5.)) - .5) * .3)) * far;
        // the river ends where the height data says sea (the coarse data only, so it ends at the same place from any height)
        float sea = 1. - vEnd * smoothstep(-2.2, -.4, mix(-3200., textureLod(uBase, (merc(vLL) - uBaseRect.xy) * uBaseRect.zw, 1.5).r, inRegion(vLL)));
        float alpha = max(water, bed) * (1. - sea);
        if (alpha < .004) discard;
        vec3 col;
        if (uStyle == 2 || uStyle == 3 || uStyle == 6) { col = uFlat * (.35 + .65 * albumDay()) * (1.05 - .5 * smoothstep(.3, .74, abs(s))); alpha = (1. - smoothstep(.7, .8, abs(s))) * (1. - sea); }
        else {
          float deep = 1.4 + 5. * smoothstep(.2, .6, wKm), t = x - sign(c) * .35 * far;       // the deep thread hugs the outer bank
          w.depth = mix(deep * .6, deep * clamp(1. - t * t * .75, 0., 1.) * smoothstep(0., .3, edge), far);
          w.cB.r = clamp(w.cB.r * 1.25 - .25, 0., 1.);                                       // running water freezes later than still water
          col = waterLit(w);
          // the bed beside the water: pale sand and gravel bars, darker and wet at the waterline; the banks at the rim of
          // the bed stand above it, one lit by the sun, the other in its own shade
          float rim = smoothstep(.62, .9, abs(s)) * far;
          vec3 sand = mix(vec3(.47, .44, .33), vec3(.74, .69, .53), smoothstep(-.02, -.25, edge)) * (.9 + .2 * wNoise(w.pk / .04 + 2.));
          sand = mix(sand, vec3(.33, .34, .20), rim * .8);                                     // the bank: earth and scrub
          col = mix(sheetGround(sand, vec3(-vAcross * rim * 1.1, 1.)), col, water);
        }
        sheetOut(col, alpha, 1.);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -5;        // after the ground and the lakes, before trees and houses
  album.scene.add(mesh);
  const p = album.params, u = mat.uniforms;
  const sync = () => { mesh.visible = !!p.get('riversOn') && p.get('rivers') > 0; u.uK.value = p.get('rivers'); u.uFlat.value.set(FLAT[p.get('look')] || FLAT.atlas); };
  p.on(sync); sync();
  return { id: 'rivers', update(dt, t, cam) {
    u.uPx.value = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, album.renderer.domElement.clientHeight);
    u.uPull.value = sheetPull(album, cam);
  } };
}
