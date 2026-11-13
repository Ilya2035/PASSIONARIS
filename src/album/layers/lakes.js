// The natural lakes of the region (public/assets/album/water/lakes.json, baked by scripts/album/water-lakes.mjs):
// each a sheet of the same water as the sea, level at the height of its shore, with a shoal along the edge, a beach
// outside it and a depth that grows toward the middle. Lakes freeze with their chunk, with the same ice as the sea.
// The list also holds one shoal of the sea (the delta of the Ebro), drawn by the same mesh: see the shader.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, CustomBlending, SrcAlphaFactor, OneMinusSrcAlphaFactor } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT } from '../glsl.js';
import { SHEET_VERT, SHEET_FRAG, sheetUniforms, sheetPull } from '../aspects/water.js';
import { KM_PER_DEG } from '../geo.js';

const D = Math.PI / 180, GROW = .55;       // km a lake may be drawn wider than life from high above

// signed distance (km, positive inside) from a point to a closed ring of [x, y] km
export function ringDistance(ring, x, y) {
  let d = 1e9, inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], ay = ring[j][1], bx = ring[i][0], by = ring[i][1], ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    if ((ay > y) !== (by > y) && x < ax + (y - ay) / (by - ay) * ex) inside = !inside;
  }
  return inside ? d : -d;
}
// a lake as a grid of points over its outline: positions (lat, lon), distance to the shore, triangles
export function lakeGrid(lake) {
  const c = Math.cos(lake.lat * D), ring = lake.ring.map(p => [(p[0] - lake.lon) * KM_PER_DEG * c, (p[1] - lake.lat) * KM_PER_DEG]);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const pad = GROW + .15, cell = Math.max(.035, Math.min(.3, Math.max(x1 - x0, y1 - y0) / 64));
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, ll = new Float32Array(nx * ny * 2), sd = new Float32Array(nx * ny), idx = [];
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    const x = x0 + i * cell, y = y0 + j * cell;
    ll[k * 2] = lake.lat + y / KM_PER_DEG; ll[k * 2 + 1] = lake.lon + x / (KM_PER_DEG * c); sd[k] = ringDistance(ring, x, y);
  }
  const reach = -(GROW + .1 + cell);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if (Math.max(sd[a], sd[b], sd[d], sd[e]) < reach) continue;      // far outside the shore: nothing to draw
    idx.push(a, b, d, b, e, d);
  }
  return { ll, sd, idx, n: nx * ny };
}

export default async function init(album) {
  const res = await fetch('assets/album/water/lakes.json');
  if (!res.ok) throw new Error(`lakes.json: ${res.status}`);
  const lakes = album.lakes = (await res.json()).lakes;
  let n = 0; const grids = lakes.map(l => { const g = lakeGrid(l); n += g.n; return g; });
  const ll = new Float32Array(n * 2), sd = new Float32Array(n), info = new Float32Array(n * 4), index = [];
  let v = 0;
  lakes.forEach((l, li) => {
    const g = grids[li];
    ll.set(g.ll, v * 2); sd.set(g.sd, v);
    for (let k = 0; k < g.n; k++) { const o = (v + k) * 4; info[o] = l.level; info[o + 1] = l.depth; info[o + 2] = li * 7.31 + 1.7; info[o + 3] = l.shoal ? 2 : l.salt ? 1 : 0; }
    for (const i of g.idx) index.push(v + i);
    v += g.n;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('aLL', new BufferAttribute(ll, 2));
  geo.setAttribute('aSd', new BufferAttribute(sd, 1)); geo.setAttribute('aLake', new BufferAttribute(info, 4)); geo.setIndex(index);
  const mat = new ShaderMaterial({
    // (no depth is written: the depth of a sheet is pulled toward the eye, and the finishing pass shaded that step as a dark rim; see layers/rivers.js)
    uniforms: sheetUniforms(album), transparent: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, depthWrite: false,
    vertexShader: `${COMMON}
      ${SHEET_VERT}
      attribute vec2 aLL; attribute float aSd; attribute vec4 aLake; varying float vSd; varying vec4 vLake;
      void main() { vSd = aSd; vLake = aLake; sheetVertex(aLL, aLake.x * uExag / 1000. + .002); }`,
    fragmentShader: `${COMMON}
      ${CHUNK_GLSL}
      ${LIGHT}
      ${SHEET_FRAG}
      varying float vSd; varying vec4 vLake;
      void main() {
        vec2 pk = sheetPk(); float px = sheetPx(pk);
        if (vLake.w > 1.5) {
          // A shoal of the sea, not a lake: wherever the coarse heights of the region say sea, there is sea, whatever
          // the fine heights say — the same sea the ground shader draws beside it (same depth, same water), so the
          // noise of the fine heights on a flat delta is covered by one clean sheet and the join does not show.
          vec2 m = merc(vLL); float wD = detailWeight(m);
          float hb = textureLod(uBase, (m - uBaseRect.xy) * uBaseRect.zw, 0.).r;
          float sea = smoothstep(vLake.x + .12, vLake.x - .18, hb) * smoothstep(0., .4, vSd);
          // The colour is needed only where the fine heights put land on that sea; elsewhere the ground has already
          // drawn the same water.
          float hd = wD > 0. ? textureLod(uDet, (m - uDetRect.xy) * uDetRect.zw, max(0., log2(px / .029))).r : 0.;
          float cover = sea * smoothstep(.2, .5, hd) * smoothstep(0., .05, wD);
          // The depth is written toward the eye all over the shoal, islands included, which hides the trees of the
          // specks. It comes on gently, over a couple of km, away from the mainland and from the outline, and has no
          // step anywhere: the finishing pass would shade a step in depth as if it were relief.
          float hs = textureLod(uBase, (m - uBaseRect.xy) * uBaseRect.zw, 3.2).r;
          float pull = smoothstep(.2, 2.6, vLake.x - hs) * smoothstep(.5, 3., vSd);
          if (cover < .004) {                                        // nothing to paint: the depth alone
            if (pull < .004) discard;
            gl_FragColor = vec4(0.); gl_FragDepth = mix(gl_FragCoord.z, clamp(vZW.x / vZW.y * .5 + .5, 0., 1.), pull);
            return;
          }
          Wtr s = sheetWater(0, pk, px); s.depth = max(-hb, 1.5);
          sheetOut(waterLit(s), cover, pull);
          return;
        }
        float grow = clamp(px * .9 - .012, 0., ${GROW.toFixed(2)});                       // a small lake stays a few pixels wide from any height
        float sd = vSd + grow + (wNoise(pk / .16 + vLake.z) - .5) * .05 * smoothstep(.12, .02, px);   // the shore is never a ruled line
        float aa = max(px * .8, .003), water = smoothstep(-aa, aa, sd);
        float bw = max(.03, px * 1.6), beach = smoothstep(-bw, -bw * .2, sd) * (1. - smoothstep(.5, 1.6, px));
        if (max(water, beach) < .004) discard;
        Wtr w = sheetWater(1, pk, px);
        // the bottom: a shelf along the shore, then down to the deep middle; shallow lagoons stay pale all over
        float shelf = .05 + vLake.y * .0042;
        w.depth = vLake.y * (1. - exp(-max(sd, 0.) / shelf)) * (.85 + .3 * wNoise(w.pk / .6 + vLake.z));
        vec3 col = waterLit(w);
        vec3 sand = mix(vec3(.60, .55, .40), vec3(.80, .80, .76), vLake.w) * (.92 + .16 * wNoise(w.pk / .05 + 3.));   // a salt lagoon has a white rim
        col = mix(sheetGround(sand * mix(.82, 1., smoothstep(-bw * .5, -bw, sd)), vec3(0., 0., 1.)), col, water);       // wet at the waterline
        if (uStyle == 2 || uStyle == 3) col = mix(uStyle == 2 ? vec3(.50, .68, .82) : vec3(.60, .69, .74), col, .25);
        sheetOut(col, max(water, beach * .85), 1.);
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -6;       // after the ground (−20 … −12), before trees and houses
  album.scene.add(mesh);
  const p = album.params;
  return { id: 'lakes', update(dt, t, cam) {
    mesh.visible = !!p.get('lakesOn');
    mat.uniforms.uPull.value = sheetPull(album, cam);
  } };
}
