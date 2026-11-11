// Trees with volume, drawn far larger than life (the album's scale system for objects): small crowns around the
// camera target, standing exactly where the ground is painted as forest and of the kind, age and colour it is painted
// in (FOREST_RULES in aspects/forest.js).
//
// Cheap by construction. What a tree is — does it stand, how high the ground is, conifer or broadleaf, how big, what
// colour — is worked out once per tree, not once per vertex: a small picture (one texel per tree, two layers) is
// drawn whenever the camera moves to another cell or the chunks change, and the vertex shader of a crown only reads
// its texel. A crown is 11 vertices and 15 triangles.
//
// The lattice is a quadtree anchored to the world. Of the four cells under a coarser cell one is chosen to live on in
// it, with the same place, kind and colour. As the camera rises the other three shrink away while the chosen one
// grows, so trees get larger and fewer without ever jumping.
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, Vector2, WebGLRenderTarget, NearestFilter,
  Scene, OrthographicCamera, PlaneGeometry, NoBlending, DataTexture, RedFormat, UnsignedByteType, ClampToEdgeWrapping, LinearFilter, Vector4 } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT, lightUniforms } from '../glsl.js';
import { FOREST_RULES, TREE_DARK } from '../aspects/forest.js';
import { kmOf } from '../chunks.js';

export const G = 384;            // the lattice is G × G cells around the camera target
export const K0 = .0045;         // spacing of the trees, km per km of camera height
export const S0 = K0 * 20;       // cell of the finest lattice, km: the spacing at the lowest camera
export const CROWN = .62;        // width of a full-grown crown as a share of the spacing
const SIZE = [.62, .5, .36, 1.08];   // size of a tree as a share of a full-grown crown: SIZE[0] + SIZE[1] × chance, times SIZE[2] young .. SIZE[3] old
const SPIRE_TOP = 1.5 * 1.25;    // the tallest conifer: height of the spire (crownGeometry) times the tallest of its kind, in crown widths

// How high the tallest crown stands above the ground, km, when the camera is h km up and «Размер деревьев» is size:
// an old conifer of the largest size. For the layers that must cover the trees — the sheets of rivers and lakes write
// their depth this much nearer the eye. The trees fade out between 120 and 170 km.
export function treeTop(h, size = 1) {
  return h < 170 ? K0 * h * CROWN * size * (SIZE[0] + SIZE[1]) * SIZE[3] * SPIRE_TOP * Math.min(1, (170 - h) / 50) : 0;
}

// ---- lakes: no tree stands in a lake. A lake is a chunk of water, but the outlines of the chunks live on a raster of
// 1.25 km, far too coarse for a shore, so the trees ask the true outline of the lake (album.chunks.lakes[i].ring).
// signed distance from a point to a closed ring of [x, y], positive inside
export function shoreDistance(ring, x, y) {
  let d = 1e9, inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], ay = ring[j][1], ex = ring[i][0] - ax, ey = ring[i][1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    if ((ay > y) !== (ay + ey > y) && x < ax + (y - ay) / ey * ex) inside = !inside;
  }
  return inside ? d : -d;
}
// One tile of LAKE_T × LAKE_T bytes per lake: the distance to its shore, −LAKE_PAD .. LAKE_PAD km as 0 .. 255, over the
// box of the lake grown by LAKE_PAD. rects: for every lake the corner of that box in flat km and 1 / its sides.
export const LAKE_T = 64, LAKE_PAD = 1;
export function lakeTiles(lakes) {
  const data = new Uint8Array(Math.max(1, lakes.length) * LAKE_T * LAKE_T), rects = [];
  lakes.forEach((lk, i) => {
    const ring = lk.ring.map(p => kmOf(p[1], p[0]));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    x0 -= LAKE_PAD; y0 -= LAKE_PAD; x1 += LAKE_PAD; y1 += LAKE_PAD;
    for (let b = 0; b < LAKE_T; b++) for (let a = 0; a < LAKE_T; a++) {
      const sd = shoreDistance(ring, x0 + a / (LAKE_T - 1) * (x1 - x0), y0 + b / (LAKE_T - 1) * (y1 - y0));
      data[(i * LAKE_T + b) * LAKE_T + a] = Math.round(Math.max(0, Math.min(1, (sd / LAKE_PAD + 1) / 2)) * 255);
    }
    rects.push([x0, y0, 1 / (x1 - x0), 1 / (y1 - y0)]);
  });
  return { data, rects };
}
// how far from the shore of a lake the nearest tree stands, km: the sheet of the lake is drawn a little wider than
// life from high above (layers/lakes.js), with a beach around it
export const lakeEdge = h => Math.round((.06 + .0012 * h) * 50) / 50;

// which lattice the camera height asks for: cell size S, how far the thinning toward the next lattice has gone
// (phase 0..1) and the size of the trees that are on their way out (thin 1..0)
export function treeLevel(h) {
  const x = K0 * h, L = Math.max(0, Math.log2(x / S0)), n = Math.min(3, Math.floor(L)), phase = L - n;
  return { x, n, phase, S: S0 * 2 ** n, thin: Math.sqrt(Math.max(0, (4 ** (1 - phase) - 1) / 3)) };
}

// a crown: a dome for broadleaf, a spire for conifers, as two shapes of the same 11 points. Local axes: east, north, up.
export function crownGeometry() {
  const N = 5, DOME = [[0, .80], [.37, .60], [.5, .05]], SPIRE = [[0, 1.5], [.19, .76], [.42, 0]];     // [radius, height]: top, upper ring, lower ring
  const DOME_N = [[0, 1], [.62, .78], [.97, .25]], SPIRE_N = [[0, 1], [.93, .36], [.93, .36]];
  const pos = [], spire = [], nor = [], spireN = [], idx = [];
  const put = (ring, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(DOME[ring][0] * c, DOME[ring][0] * s, DOME[ring][1]); spire.push(SPIRE[ring][0] * c, SPIRE[ring][0] * s, SPIRE[ring][1]);
    nor.push(DOME_N[ring][0] * c, DOME_N[ring][0] * s, DOME_N[ring][1]); spireN.push(SPIRE_N[ring][0] * c, SPIRE_N[ring][0] * s, SPIRE_N[ring][1]);
  };
  put(0, 0);
  for (let i = 0; i < N; i++) put(1, i / N * 2 * Math.PI);
  for (let i = 0; i < N; i++) put(2, (i + .5) / N * 2 * Math.PI);
  const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const tri = (a, b, c) => {                                         // counter-clockwise seen from outside
    const A = P(a), B = P(b), C = P(c), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3 - .2];
    idx.push(a, ...(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0 ? [b, c] : [c, b]));
  };
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri(0, 1 + i, 1 + j); tri(1 + i, 1 + N + i, 1 + j); tri(1 + N + i, 1 + N + j, 1 + j); }
  return { pos, spire, nor, spireN, idx };
}

// the quadtree of trees, shared by the picture of the trees and by the crowns that read it
const TREE_GLSL = /* glsl */`
#define TREE_S0 ${S0.toFixed(6)}
// which of its four children a cell of this level hands on: (0|1, 0|1)
vec2 treePick(vec2 cell, float level) { return floor(hash22(cell + 31.7 + level * 7.3) * 1.999); }
// a cell of the lattice of this level → the cell of the finest lattice its tree comes from, and whether the tree lives on in the next level
void treeCell(vec2 ci, float level, out vec2 c0, out float surv) {
  vec2 par = floor(ci * .5);
  surv = all(equal(ci - par * 2., treePick(par, level + 1.))) ? 1. : 0.;
  c0 = ci;
  for (int i = 0; i < 4; i++) { float l = level - float(i); if (l < .5) break; c0 = c0 * 2. + treePick(c0, l); }
}
vec2 treeSpot(vec2 c0) { return (c0 + .12 + .76 * hash22(c0 + 13.7)) * TREE_S0; }
`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params, ch = album.chunks, renderer = album.renderer, H = G / 2;
  // ---- the crowns: instances ordered from the middle of the lattice outward, so only those in reach are drawn
  const cg = crownGeometry(), geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(cg.pos), 3)); geo.setAttribute('normal', new BufferAttribute(new Float32Array(cg.nor), 3));
  geo.setAttribute('aSpire', new BufferAttribute(new Float32Array(cg.spire), 3)); geo.setAttribute('aSpireN', new BufferAttribute(new Float32Array(cg.spireN), 3));
  geo.setIndex(cg.idx);
  const order = []; for (let j = -H; j < H; j++) for (let i = -H; i < H; i++) order.push([i, j, Math.hypot(i, j)]);
  order.sort((a, b) => a[2] - b[2]);
  const cells = new Float32Array(G * G * 2), reach = new Float32Array(G * G);
  order.forEach((c, k) => { cells[k * 2] = c[0]; cells[k * 2 + 1] = c[1]; reach[k] = c[2]; });
  geo.setAttribute('aCell', new InstancedBufferAttribute(cells, 2)); geo.instanceCount = 0;
  const within = r => { let a = 0, b = reach.length; while (a < b) { const m = (a + b) >> 1; if (reach[m] <= r) a = m + 1; else b = m; } return a; };

  // ---- the shores of the lakes, a tile per lake
  const lakes = (ch.lakes || []).filter(l => l.ring && l.ring.length > 2), NLAKE = lakes.length, tiles = lakeTiles(lakes);
  const lakeTex = new DataTexture(tiles.data, LAKE_T, LAKE_T * Math.max(1, NLAKE), RedFormat, UnsignedByteType);
  lakeTex.magFilter = lakeTex.minFilter = LinearFilter; lakeTex.wrapS = lakeTex.wrapT = ClampToEdgeWrapping; lakeTex.needsUpdate = true;
  const lakeRects = tiles.rects.length ? tiles.rects.map(r => new Vector4(...r)) : [new Vector4(0, 0, 0, 0)];

  // ---- the picture of the trees: texel = one tree. A: height of the ground (16 bits), size, kind. B: colour, age.
  const rt = new WebGLRenderTarget(G, G, { count: 2, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, generateMipmaps: false });
  const uCellBase = { value: new Vector2() }, uLevel = { value: 0 };
  const pre = new ShaderMaterial({
    depthTest: false, depthWrite: false, blending: NoBlending,
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uForestK: T.uForestK, uSnow: T.uSnow, uSeason: T.uSeason,
      ...ch.uniforms, tForestRise: T.tForestRise, tTreeLake: { value: lakeTex }, uLakeRect: { value: lakeRects }, uLakeEdge: { value: .1 }, uCellBase, uLevel, uLod: { value: 0 }, uEps: { value: .12 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `${COMMON}
      ${CHUNK_GLSL}
      ${FOREST_RULES}
      ${TREE_GLSL}
      uniform vec2 uCellBase; uniform float uLevel, uForestK, uSnow, uSeason, uLod, uEps; uniform sampler2D tForestRise, tTreeLake;
      layout(location = 1) out highp vec4 oTint;
      uniform vec4 uLakeRect[${Math.max(1, NLAKE)}]; uniform float uLakeEdge;
      // distance to the shore of a lake, km: positive in the water, −${LAKE_PAD} far from any lake
      float lakeShore(vec2 pk) {
        float sd = -1.;
        for (int i = 0; i < ${NLAKE}; i++) {
          vec2 uv = (pk - uLakeRect[i].xy) * uLakeRect[i].zw;
          if (uv.x > 0. && uv.x < 1. && uv.y > 0. && uv.y < 1.)
            sd = max(sd, textureLod(tTreeLake, vec2((uv.x * ${LAKE_T - 1}. + .5) / ${LAKE_T}., (float(i) + (uv.y * ${LAKE_T - 1}. + .5) / ${LAKE_T}.) / ${Math.max(1, NLAKE)}.), 0.).r * 2. - 1.);
        }
        return sd * ${LAKE_PAD.toFixed(1)};
      }
      void main() {
        vec2 c0; float surv; treeCell(floor(gl_FragCoord.xy) - ${H.toFixed(1)} + uCellBase, uLevel, c0, surv);
        vec2 pk = treeSpot(c0), ll = vec2(pk.y / KM, pk.x / (KM * COSREF));
        float cl = cos(radians(ll.x));
        float h = heightLod(ll, uLod), hE = heightLod(ll + vec2(0., uEps / (KM * cl)), uLod), hN = heightLod(ll + vec2(uEps / KM, 0.), uLod);
        vec2 g = vec2(hE - h, hN - h) / (uEps * 1000.); float slope = length(g), hl = max(h, 0.);
        float n1 = fbm(pk / 38.), n2 = fbm(pk / 7.3 + 5.), n3 = vnoise(pk / 1.1), st = vnoise(pk / 2.6 + 11.);
        vec2 cuv = chunkUV(pk); vec4 cA = texture(tChunkA, cuv), cC = texture(tChunkC, cuv);       // the state of the chunk the tree stands in
        float wet = albumWet(ll, hl, n1), fc = albumForestShare(wet, hl, slope, n1);
        float pat = albumPatch(n2, n3); pat += albumRough(pk) * smoothstep(.3, .16, abs(albumMargin(fc, uForestK, pat)));
        vec2 stand = albumStand(fc, uForestK, pat, albumOrder(pat, albumOrderOwn(pk, 0.)), cA.r, 1.);            // x: share under canopy, y: how deep inside
        vec2 r = hash22(c0 + 3.1), q = hash22(c0 + 17.3), v = hash22(c0 + 5.5);
        float snowline = 2980. - (ll.x - 37.) * 55. + uSnow;
        float age = albumAge(cA.b, stand.y, st);
        // a tree for every share of canopy: all of them in closed forest, one here and there in a thinned stand; brush has none
        float alive = step(r.y, stand.x) * step(.1, stand.x) * step(.06, age) * step(1.5, h) * step(hl, snowline - 150.);
        alive *= step(max(max(cC.g * 1.15, cC.r * 1.6), cA.a * .65), q.x);                           // no trees on fields and under houses, few in a swamp
        alive *= step(lakeShore(pk), -uLakeEdge);                                                    // and none in a lake or on its beach
        float rel = (hl - textureLod(tForestRise, (pk - uChunkRect.xy) * uChunkRect.zw, 0.).r * 4096.) / 300.;
        float con = albumConifer(cA.g, st, n2, rel, g.y / max(slope, 1e-4) * smoothstep(.05, .3, slope), slope);
        float kind = step(q.y, con);
        vec3 tint = albumForestTint(kind, age, wet, hl, ll.x, st * .6 + n2 * .4, uSeason * (.55 + .45 * n3));
        float size = (${SIZE[0]} + ${SIZE[1]} * r.x) * mix(${SIZE[2]}, ${SIZE[3]}, age) * alive;                               // young trees are small
        float hh = floor(clamp(hl / 4096., 0., 1.) * 65535. + .5), hi = floor(hh / 256.);
        gl_FragColor = vec4(hi / 255., (hh - hi * 256.) / 255., size / 1.5, kind);
        oTint = vec4(clamp(tint * vec3(1.42, 1.32, 1.44) * (.85 + .3 * v.x), 0., 1.), age);    // lighter than the paint: a crown is lit on one side only
      }`,
  });
  const preScene = new Scene(), preCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), pre); quad.frustumCulled = false; preScene.add(quad);

  const mat = new ShaderMaterial({
    uniforms: { uExag: T.uExag, ...lightUniforms(T), tTreeA: { value: rt.textures[0] }, tTreeB: { value: rt.textures[1] }, uCellBase, uLevel,
      uEye: { value: new Vector2() }, uThin: { value: 1 }, uSize: { value: .05 }, uRad: { value: 10 }, uFade: { value: 1 }, uGain: { value: 0 } },
    vertexShader: `${COMMON}
      ${LIGHT}
      ${TREE_GLSL}
      ${TREE_DARK}
      attribute vec2 aCell; attribute vec3 aSpire, aSpireN;
      uniform highp sampler2D tTreeA, tTreeB;
      uniform vec2 uCellBase, uEye; uniform float uLevel, uThin, uSize, uRad, uFade, uGain;
      varying vec3 vN, vCol; varying float vOpen, vHaze, vGain;
      void main() {
        gl_Position = vec4(2., 2., 2., 1.); vN = vec3(0., 0., 1.); vCol = vec3(0.); vOpen = 0.; vHaze = 0.; vGain = 1.;
        ivec2 tc = ivec2(aCell) + ${H};
        vec4 A = texelFetch(tTreeA, tc, 0);
        if (A.b < .004) return;                                      // nothing stands in this cell
        vec2 c0; float surv; treeCell(aCell + uCellBase, uLevel, c0, surv);
        vec2 pk = treeSpot(c0);
        float edge = smoothstep(1., .66, length(pk - uEye) / uRad), size = A.b * 1.5 * uSize * mix(uThin, 1., surv) * edge * uFade;
        if (size < 1e-5) return;
        vec4 B = texelFetch(tTreeB, tc, 0);
        vec2 ll = vec2(pk.y / KM, pk.x / (KM * COSREF)), r = hash22(c0 + 3.1);
        float hl = (floor(A.r * 255. + .5) * 256. + floor(A.g * 255. + .5)) / 65535. * 4096., kind = A.a;
        float a = r.x * 6.2832, ca = cos(a), sa = sin(a);
        vec3 q = mix(position, aSpire, kind), n = mix(normal, aSpireN, kind);
        q.xy *= mix(.88 + .3 * r.y, 1., kind); q.z *= mix(1.12 - .28 * r.y, .85 + .4 * r.y, kind);          // no two crowns alike
        q.xy = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca); n.xy = vec2(n.x * ca - n.y * sa, n.x * sa + n.y * ca);
        vec3 base = worldOf(ll, hl * uExag / 1000.), up = normalize(base + vec3(0., RKM, 0.));
        float dl = radians(ll.y - LON0);
        vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
        vec3 w = base + (east * q.x + north * q.y + up * (q.z - .03)) * size;
        vN = n; vCol = B.rgb; vGain = albumTreeGain(uGain * edge * edge * (1. + .04 * kind), dot(normalize(cameraPosition - w), up)); vOpen = 1.45 * (.45 + .55 * mix(position.z / .8, aSpire.z / 1.5, kind)); vHaze = albumHaze(w);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: `${COMMON}
      ${LIGHT}
      varying vec3 vN, vCol; varying float vOpen, vHaze, vGain;
      void main() {
        vec3 c = albumLit(vCol, vN, vOpen);                          // the light, the air and the finish every thing on the land shares
        gl_FragColor = vec4(albumFinish(mix(c, albumHazeCol(), vHaze)) * vGain, 1.);   // lighter by what the finishing pass takes away among trees
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false; album.scene.add(mesh);

  let drawn = '';
  // layer.top: how high the tallest crown stands above the ground right now, km (0 while no trees are drawn)
  const layer = { id: 'forest', top: 0, count: () => geo.instanceCount, update(dt, t, cam) {
    const h = cam.s.h, on = !!p.get('forest3d') && p.get('trees') > 0 && h < 170 && !['paper', 'atlas', 'night'].includes(p.get('look'));
    mesh.visible = on; layer.top = on ? treeTop(h, p.get('trees')) : 0;
    if (!on) { T.uTreeZone.value.w = 0; return; }
    const lv = treeLevel(h), [ex, ey] = kmOf(cam.s.lat, cam.s.lon), u = mat.uniforms, v = pre.uniforms, rad = (H - 2) * lv.x / 2;
    const size = p.get('trees'), fade = Math.min(1, (170 - h) / 50);
    uCellBase.value.set(Math.round(ex / lv.S), Math.round(ey / lv.S)); uLevel.value = lv.n;
    u.uEye.value.set(ex, ey); u.uThin.value = lv.thin; u.uSize.value = lv.x * CROWN * size; u.uRad.value = rad; u.uFade.value = fade;
    geo.instanceCount = within(rad / lv.S + 1.5);
    // strength of the darkening the finishing pass lays among the trees; the ground under them and the crowns are
    // shown lighter by as much (TREE_DARK in aspects/forest.js)
    const ao = p.get('fx') ? p.get('ao') : 0;
    T.uTreeZone.value.set(ex, ey, rad, ao / .8 * Math.min(1.5, size * size) * fade * fade); u.uGain.value = T.uTreeZone.value.w;
    // heights as the ground mesh under the camera takes them (terrain.js), so the trees stand on it
    const c0 = 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, h * .0042))));
    v.uLod.value = Math.max(0, Math.log2(c0 / .234)); v.uEps.value = Math.max(c0 * .5, .12); v.uLakeEdge.value = lakeEdge(h);
    // the picture of the trees is drawn again only when something it shows has changed
    const key = [uCellBase.value.x, uCellBase.value.y, lv.n, c0, v.uLakeEdge.value, ch.version, T.uForestK.value, T.uSnow.value, T.uSeason.value, T.uDetOn.value, T.uDet.value?.uuid, T.uDetRect.value.x].join();
    if (key === drawn) return;
    drawn = key; ch.flush();
    const back = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(preScene, preCam); renderer.setRenderTarget(back);
  } };
  return layer;
}
