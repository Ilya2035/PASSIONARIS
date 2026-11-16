// The works of a road at a river — small things with volume (the owner, 15.11.2026: «Там должен быть мост… Сразу же
// построю его, чтобы посмотреть, как будут выглядеть малые мосты, как будут выглядеть большие мосты»; «надо
// визуально домик какой-нибудь нарисовать, там переправа»).
//   • a STONE bridge on a main road: a deck with a slight camber on piers, parapets, a ramp on each bank;
//   • a TIMBER bridge on a lesser road: a level deck on pairs of posts, with rails;
//   • a FOOTBRIDGE on a track: a narrow deck on posts;
//   • a FERRY where there is neither bridge nor ford: a landing stage on each bank, a hut on one of them, a boat.
// All of them are one mesh. A bridge is as long as its river is drawn wide — from high up a river is wider than life
// (layers/rivers.js) — and as wide as its road is drawn; its deck is level, a few metres over the water and never
// lower than the lower bank; its piers stand in the water, its ramps come down to the ground of the banks. It is lit
// as the ground is, each face by its own slope to the sun, and lies in the shadow of the mountain with the ground.
// (A ford has no works: it is a pale shallow across the water — layers/roads.js.)
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, DoubleSide, CustomBlending, SrcAlphaFactor, OneMinusSrcAlphaFactor } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT, lightUniforms } from '../glsl.js';
import { GROUND_LIGHT } from '../layers/ribbon.js';
import { tilePieces, visibleRanges, frustumOf, rangeDrawer } from '../layers/linetiles.js';

// metres: how high the deck stands over the water, how thick it is, its camber, the length of a ramp km, a pier or a pair of posts every … km of river
export const WORKS = {
  stone: { H: 5.5, thick: 1.3, camber: 1.3, ramp: .014, every: .016, top: 0xb3a68b, side: 0x8d826d, rail: 0xa39781 },
  timber: { H: 3.2, thick: .45, camber: 0, ramp: .010, every: .007, top: 0x94795a, side: 0x6c553a, rail: 0x57422d },
  foot: { H: 2.4, thick: .3, camber: 0, ramp: .007, every: .006, top: 0x8c7355, side: 0x65503a, rail: 0x57422d, narrow: .45 },
  ferry: { hut: [0xc7bea6, 0x8a5a41], wood: 0x7a6248, boat: 0x4a3a2b, px: 5 },   // px: the least length of the hut on the screen
  abut: .012,                        // km of deck on each bank (crossings.js, BRIDGE.abut)
};
const rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];

// list: [{ lat, lon (the middle of the crossing), dx, dy (the way the road runs: a unit vector, east and north), width
// (km of water; negative: of the sea — roads/crossings.js, SEA — which is as wide as the heights have it whatever
// the rivers are drawn like), sin (of the angle between road and river), kind: 'stone' | 'timber' | 'foot' | 'ferry',
// road (km: the width of the road), minPx (the least width of that road on the screen) }]
// → BufferGeometry. A corner: aC the middle of the crossing; aD the way of the road, the water, 1 / sin; aP its place —
// along (in halves of the span), across (in halves of the deck), up (metres), from what (0 the deck · 1 the water ·
// 2 the ground under it); aQ km added along and across; aR the road, its least pixels, the height of the deck.
// geo.userData.items: where the triangles of every work begin in the index, and where the last one ends.
export function worksGeometry(list) {
  const C = [], D = [], P = [], Q = [], R = [], Nn = [], Col = [], idx = []; let n = 0, cur = null, H = 0;
  const vert = (c, nrm, col) => { C.push(cur.lat, cur.lon); D.push(cur.dx, cur.dy, cur.width, 1 / Math.max(.5, cur.sin || 1)); P.push(c[0], c[2], c[4], c[5]); Q.push(c[1], c[3]); R.push(cur.road, cur.minPx, H); Nn.push(nrm[0], nrm[1], nrm[2]); Col.push(col[0], col[1], col[2]); return n++; };
  const quad = (a, b, c, d, nrm, col) => { const i = vert(a, nrm, col); vert(b, nrm, col); vert(c, nrm, col); vert(d, nrm, col); idx.push(i, i + 1, i + 2, i, i + 2, i + 3); };
  // a block between two corners [s, a, t, b, z, from]: its top and its four sides (no floor)
  const block = (lo, hi, top, side) => {
    const c = (u, v, w) => [u ? hi[0] : lo[0], u ? hi[1] : lo[1], v ? hi[2] : lo[2], v ? hi[3] : lo[3], w ? hi[4] : lo[4], w ? hi[5] : lo[5]];
    quad(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1), [0, 0, 1], top);
    quad(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1), [0, -1, 0], side); quad(c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), [0, 1, 0], side);
    quad(c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), [-1, 0, 0], side); quad(c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1), [1, 0, 0], side);
  };
  const items = [];
  for (const f of list) {
    cur = f; items.push(idx.length);
    if (f.kind === 'ferry') {
      H = 0; const F = WORKS.ferry, wall = rgb(F.hut[0]), roof = rgb(F.hut[1]), wood = rgb(F.wood), dark = rgb(F.wood).map(v => v * .7);
      // a landing stage on each bank, from the bank a few metres out over the water
      for (const e of [-1, 1]) block([e, -e * (WORKS.abut + .006), 0, -.0013, -.8, 1], [e, -e * (WORKS.abut - .004), 0, .0013, .55, 1], wood, dark);
      // the hut of the ferryman beside the road on the first bank: walls, a roof of two slopes, its gables
      const a0 = -(WORKS.abut * .2 + .003), a1 = a0 - .009, b0 = .009, b1 = .016, bm = (b0 + b1) / 2, zw = 3.1, zr = 5.3, g = (a, b, z) => [-1, a, 0, b, z, 2];
      block(g(a1, b0, 0), g(a0, b1, zw), wall, wall.map(v => v * .86));
      quad(g(a1, b0, zw), g(a0, b0, zw), g(a0, bm, zr), g(a1, bm, zr), [0, -.62, .78], roof); quad(g(a0, b1, zw), g(a1, b1, zw), g(a1, bm, zr), g(a0, bm, zr), [0, .62, .78], roof);
      quad(g(a0, b0, zw), g(a0, b1, zw), g(a0, bm, zr), g(a0, bm, zr), [1, 0, 0], wall); quad(g(a1, b1, zw), g(a1, b0, zw), g(a1, bm, zr), g(a1, bm, zr), [-1, 0, 0], wall);
      // the boat by the stage
      block([-1, WORKS.abut + .001, 0, .0022, -.25, 1], [-1, WORKS.abut + .0062, 0, .004, .5, 1], rgb(F.boat), rgb(F.boat).map(v => v * .75));
      continue;
    }
    const W = WORKS[f.kind], top = rgb(W.top), side = rgb(W.side), rail = rgb(W.rail), tw = W.narrow || 1, span = Math.abs(f.width) / Math.max(.5, f.sin || 1), cam = s => W.camber * (1 - s * s);
    H = W.H;
    // the deck, in pieces along the road; a stone one rises a little to its middle
    const SEG = W.camber ? 6 : 1;
    for (let k = 0; k < SEG; k++) {
      const sa = -1 + 2 * k / SEG, sb = -1 + 2 * (k + 1) / SEG, za = cam(sa), zb = cam(sb), tilt = (zb - za) / 6;
      quad([sa, 0, -tw, 0, za, 0], [sb, 0, -tw, 0, zb, 0], [sb, 0, tw, 0, zb, 0], [sa, 0, tw, 0, za, 0], [-tilt, 0, 1], top);
      for (const e of [-1, 1]) quad([sa, 0, e * tw, 0, za - W.thick, 0], [sb, 0, e * tw, 0, zb - W.thick, 0], [sb, 0, e * tw, 0, zb, 0], [sa, 0, e * tw, 0, za, 0], [0, e, 0], side);
      // parapets of stone, rails of timber: along both edges (a footbridge has none)
      if (f.kind !== 'foot') for (const e of [-1, 1]) { const t0 = e * tw * (f.kind === 'stone' ? .84 : .93), t1 = e * tw, hi = f.kind === 'stone' ? 1.1 : .9;
        quad([sa, 0, t0, 0, za + hi, 0], [sb, 0, t0, 0, zb + hi, 0], [sb, 0, t1, 0, zb + hi, 0], [sa, 0, t1, 0, za + hi, 0], [0, 0, 1], rail);
        quad([sa, 0, t1, 0, za, 0], [sb, 0, t1, 0, zb, 0], [sb, 0, t1, 0, zb + hi, 0], [sa, 0, t1, 0, za + hi, 0], [0, e, 0], rail); quad([sa, 0, t0, 0, za, 0], [sb, 0, t0, 0, zb, 0], [sb, 0, t0, 0, zb + hi, 0], [sa, 0, t0, 0, za + hi, 0], [0, -e, 0], rail.map(v => v * .8)); }
    }
    // piers of stone in the water; pairs of posts under timber
    const np = Math.max(f.kind === 'stone' ? 0 : 1, Math.min(f.kind === 'stone' ? 7 : 12, Math.round(span / W.every) - (f.kind === 'stone' ? 1 : 0)));
    for (let k = 1; k <= np; k++) {
      const s = -1 + 2 * k / (np + 1), zt = cam(s) - W.thick;
      if (f.kind === 'stone') block([s, -.0017, -.92, 0, -1.6, 1], [s, .0017, .92, 0, zt, 0], side, side.map(v => v * .88));
      else for (const e of f.kind === 'foot' ? [-.7, .7] : [-.8, .8]) block([s, -.0004, e * tw, -.0004, -1.2, 1], [s, .0004, e * tw, .0004, zt, 0], rail, rail.map(v => v * .85));
    }
    // on each bank: the wall of the abutment toward the water, the ramp down to the ground, its two sides
    for (const e of [-1, 1]) {
      quad([e, 0, -tw, 0, -1.6, 1], [e, 0, tw, 0, -1.6, 1], [e, 0, tw, 0, -W.thick, 0], [e, 0, -tw, 0, -W.thick, 0], [-e, 0, 0], side.map(v => v * .9));
      quad([e, 0, -tw, 0, 0, 0], [e, e * W.ramp, -tw, 0, 0, 2], [e, e * W.ramp, tw, 0, 0, 2], [e, 0, tw, 0, 0, 0], [e * .25, 0, .97], top);
      for (const v of [-1, 1]) quad([e, 0, v * tw, 0, 0, 2], [e, e * W.ramp, v * tw, 0, 0, 2], [e, e * W.ramp, v * tw, 0, 0, 2], [e, 0, v * tw, 0, 0, 0], [0, v, 0], side);
    }
  }
  const geo = new BufferGeometry(), f32 = (a, k, name) => geo.setAttribute(name, new BufferAttribute(new Float32Array(a), k));
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  f32(C, 2, 'aC'); f32(D, 4, 'aD'); f32(P, 4, 'aP'); f32(Q, 2, 'aQ'); f32(R, 3, 'aR'); f32(Nn, 3, 'aN'); f32(Col, 3, 'aCol'); geo.setIndex(idx);
  items.push(idx.length); geo.userData.items = items;
  return geo;
}

// How few works are left as one mesh drawn whole; works with no more than NEAR of them between two ranges are drawn as one.
export const WORKS_TILES = { min: 300, near: 12 };
// The works by squares (layers/linetiles.js): the triangles of each work stay together, the works are put in the
// index square by square. → { index, starts } or null when there are too few
export function worksTiles(geo, list) {
  const items = geo.userData.items; if (!items || list.length < WORKS_TILES.min) return null;
  const t = tilePieces(list.length, list.map(f => f.lat), list.map(f => f.lon)), old = geo.index.array, index = new Uint32Array(old.length), starts = new Uint32Array(list.length + 1); let q = 0;
  t.order.forEach((i, k) => { starts[k] = q; for (let a = items[i]; a < items[i + 1]; a++) index[q++] = old[a]; }); starts[list.length] = q;
  return { index, starts, root: t.root, leaves: t.leaves };
}
// the mesh of the works, added to the scene: { mesh, u, cull(camera, pad km) — the squares of a frame }
export function makeWorks(album, list, { wide = 2 } = {}) {
  const T = album.terrain.u;
  const uniforms = { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uShade: T.uShade, ...lightUniforms(T), ...album.chunks.uniforms,
    ...(T.tClimate ? { tClimate: T.tClimate, uClimRect: T.uClimRect } : {}),
    uPx: { value: .01 }, uK: { value: 1 }, uWide: { value: wide }, uAlpha: { value: 1 }, uPull: { value: .02 }, uRiver: { value: [0, 0, 1] }, uRiverLeast: { value: [.42, 1.3] } };
  const mat = new ShaderMaterial({
    uniforms, transparent: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, side: DoubleSide,
    vertexShader: `${COMMON}
      attribute vec2 aC, aQ; attribute vec4 aD, aP; attribute vec3 aR, aN, aCol; uniform float uPx, uK, uWide, uPull; uniform vec3 uRiver; uniform vec2 uRiverLeast;
      varying vec3 vWorld, vN, vCol; varying vec2 vLL, vZW;
      void main() {
        // the water as it is drawn (the same sums as the sheet of the river): the works reach from bank to bank of that
        float real = aD.z * uRiver.z, s2 = clamp(real / .16, 0., 1.);
        float water = max(real, uRiver.x * mix(mix(.42, 1., sqrt(s2)), mix(uRiverLeast.x, uRiverLeast.y, s2), uRiver.y));
        if (aD.z < 0.) water = -aD.z;                                                       // the sea: from shore to shore as the heights have it
        float reach = water * .5 * aD.w + ${WORKS.abut.toFixed(3)} + uPx * .5;
        float roadReal = aR.x * uK, road = max(roadReal, aR.y * uPx), grow = clamp(road / max(roadReal, 1e-6), 1., 6.);                     // drawn wider than life from high up, and a little taller
        if (aR.z < .5) grow = clamp(uPx * ${WORKS.ferry.px.toFixed(1)} / .009, grow, 8.);                                                   // the hut of a ferry (9 m long) is never under a few pixels
        float zk = pow(grow, .6);
        vec2 al = aD.xy, ac = vec2(-aD.y, aD.x), p = al * (aP.x * reach + aQ.x * grow) + ac * (aP.y * road * uWide * .5 + aQ.y * grow);
        float cl = cos(radians(aC.x)); vec2 ll = aC + vec2(p.y / KM, p.x / (KM * cl)), e = al * reach;
        float hw = max(heightLod(aC, 0.), 0.);                                              // the water: the ground at the middle of the river
        float hb = min(max(heightLod(aC + vec2(e.y / KM, e.x / (KM * cl)), 0.), 0.), max(heightLod(aC - vec2(e.y / KM, e.x / (KM * cl)), 0.), 0.));
        float deck = max(hw + aR.z * zk, hb + .8);                                          // level, and never lower than the lower bank
        float h = (aP.w < .5 ? deck : aP.w < 1.5 ? hw : max(heightLod(ll, 0.), 0.)) + aP.z * zk;
        vLL = ll; vCol = aCol; vN = vec3(al * aN.x + ac * aN.y, aN.z);
        vWorld = worldOf(ll, h * uExag / 1000. + .0012);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
        vec3 eye = normalize(cameraPosition - vWorld);                                      // the grid of the ground is coarser than its heights: pulled toward the eye a little, as a road is
        vZW = (projectionMatrix * viewMatrix * vec4(vWorld + eye * uPull / max(dot(eye, normalize(vWorld + vec3(0., RKM, 0.))), .3), 1.)).zw;
      }`,
    fragmentShader: `${COMMON}
      ${CHUNK_GLSL}
      ${LIGHT}
      ${GROUND_LIGHT}
      uniform float uAlpha; varying vec3 vWorld, vN, vCol; varying vec2 vLL, vZW;
      void main() {
        if (uAlpha < .004) discard;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; if (n.z < -.2) n = -n;
        float px = length(fwidth(vWorld));
        vec3 col = uStyle == 2 || uStyle == 3 || uStyle == 6 ? mix(pow(vCol * (.35 + .65 * albumDay()) * (.7 + .3 * n.z), vec3(1. / 2.2)), albumFinish(albumHazeCol()), albumHaze(vWorld))
          : albumFinish(albumAir(vCol * groundLightOn(vLL, max(px, .004), n), vWorld));
        gl_FragColor = vec4(col, uAlpha);
        gl_FragDepth = clamp(vZW.x / vZW.y * .5 + .5, 0., 1.);
      }`,
  });
  const geo = worksGeometry(list), tiles = worksTiles(geo, list); if (tiles) geo.setIndex(new BufferAttribute(tiles.index, 1));
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -3;   // … bridges −4 · their works −3
  album.scene.add(mesh);
  const draw = tiles ? rangeDrawer(mesh, tiles.starts) : null;
  return { mesh, u: uniforms, squares: tiles ? tiles.leaves : 0, cull(camera, pad = 10) { if (draw) draw(visibleRanges(tiles.root, frustumOf(camera), pad, undefined, WORKS_TILES.near)); } };
}
