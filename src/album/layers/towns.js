// Settlements that stand on the land. The picture comes from the chunks: a chunk with `built` > 0 draws a patch of
// settlement (town/rules.js), and this layer puts blocks on the cells of that patch (town/plan.js). The blocks are the
// album's own (town/shapes.js): a few flat faces each, all kinds in one small texture, every block of every kind an
// instance of one strip of corners — the whole built world is one draw call. The model of growth (town/grow.js) turns
// the places of the map and the «Рост городов» knob into the state of the chunks: houses, fields, felled forest.
// Places are today's cities (Natural Earth) as stand-ins: the game has no peoples yet.
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, DataTexture, RGBAFormat, UnsignedByteType, NearestFilter } from 'three';
import { COMMON, LIGHT, lightUniforms } from '../glsl.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';
import { CHUNK_KM, kmOf } from '../chunks.js';
import { smoothLine } from './ribbon.js';
import { cellSize, cultureAt, zoomAt, zoomLobe, CELL20, PALETTE_GLSL } from '../town/rules.js';
import { settleTex, settleUniforms, mirrorSettle } from '../town/state.js';
import { buildShapes, SLOTS, KINDS } from '../town/shapes.js';
import { growTowns, sampleLand } from '../town/grow.js';
import { planLobe, planShowcase, ROW } from '../town/plan.js';

const MAX_BLOCKS = 40000;
const VERT = /* glsl */`${COMMON}
  attribute vec4 aA, aB, aC;        // site x, y (flat km), turn of the lattice, kind · cell i, j, own turn, flags · size x, y, tint, height
  uniform sampler2D tShapes; uniform float uS, uH, u3D, uLod;
  varying vec3 vN, vW, vL; varying vec4 vM;
  void main() {
    int slot = int(position.x + .5), kind = int(aA.w + .5);
    vec4 sa = floor(texelFetch(tShapes, ivec2(slot, kind * 2), 0) * 255. + .5), sb = texelFetch(tShapes, ivec2(slot, kind * 2 + 1), 0);
    vec3 lp = vec3((sa.xy - 128.) / 200., (sa.z - 16.) / 400.), ln = sb.xyz * (255. / 127.) - 128. / 127.;
    float cs = cos(aA.z), sn = sin(aA.z), ra = aA.z + aB.z, cr = cos(ra), sr = sin(ra);
    vec2 centre = aA.xy + vec2(cs * aB.x - sn * aB.y, sn * aB.x + cs * aB.y) * uS;        // the lattice grows with the camera height
    vec2 lxy = lp.xy * aC.xy * uS, pkv = centre + vec2(cr * lxy.x - sr * lxy.y, sr * lxy.x + cr * lxy.y);
    vec2 llc = vec2(centre.y / KM, centre.x / (KM * COSREF)), llv = vec2(pkv.y / KM, pkv.x / (KM * COSREF));
    float show = max(step(1.5, aB.w), step(.6, heightLod(llc, 0.)));                    // never on water (a pier may reach over it)
    float hv = max(heightLod(llv, uLod), 0.) * uExag / 1000.;                            // every corner stands on the relief
    vW = worldOf(llv, hv + lp.z * uS * uH * aC.w * (lp.z > 0. ? u3D : 1.) + .0015);
    vN = vec3(cr * ln.x - sr * ln.y, sr * ln.x + cr * ln.y, ln.z);
    vM = vec4(mod(sa.w, 16.), floor(sa.w / 16.), sb.a * 1.5, aC.z);
    vL = vec3(abs(ln.x) > abs(ln.y) ? lp.y : lp.x, lp.z, mod(aB.w, 2.));
    gl_Position = show > .5 ? projectionMatrix * viewMatrix * vec4(vW, 1.) : vec4(0., 0., 2., 1.);
  }`;
const FRAG = /* glsl */`${COMMON}
  ${LIGHT}
  ${PALETTE_GLSL}
  varying vec3 vN, vW, vL; varying vec4 vM;   // vM: material, variant, openness to the sky, tint · vL: place along the ridge, height, manner
  void main() {
    int mat = int(vM.x + .5); vec3 n = normalize(vN);
    // one roof is many houses: every few steps along the ridge the tint changes
    float house = floor(vL.x * 7. + vM.y * 3.3), hr = hash21(vec2(house * .37 + 1.3, vM.w * 9.1 + vM.y * .71));
    vec3 c = settleMat(mat, vL.z, mat == 5 ? fract(vM.y * .31 + vM.w) : fract(vM.w * 5.3 + vM.y * .37 + hr * .45));
    if (mat == 0 || mat == 2) c *= .94 + .12 * hr;
    vec3 lin;
    if (uStyle == 6) lin = mix(vec3(.07, .09, .13), vec3(.85, .68, .38), pow(max(dot(n, uSun), 0.), 1.6) * .75 + .08);
    else {
      if (uStyle == 2 || uStyle == 3) c = mix(c, vec3(.45, .36, .28), .75);
      lin = albumLit(c, n, vM.z);                                   // the light every thing on the land shares
      float night = 1. - albumDay();                                // a weak warm light in some windows
      if (night > 0. && (mat == 2 || mat == 3) && n.z < .5) lin += vec3(1., .6, .25) * night * step(.45, hash21(vec2(house + 3.7, floor(vL.y * 26.) + vM.w * 31.))) * 1.5;
    }
    gl_FragColor = vec4(albumFinish(albumAir(lin, vW)), 1.);
  }`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params, ch = album.chunks, places = album.data.vectors.places, base = album.data.base;
  const at = (x, y) => base.at(y / KM_PER_DEG, x / (KM_PER_DEG * COS_REF));        // height in metres at a point of the flat km plane
  for (let k = 0; k < ch.count; k++) { const c = ch.centre(k); ch.setNatural('culture', k, cultureAt(c.lat, c.lon) / 255); }

  // ---- rivers as the blocks must know them: nothing stands on the ribbon of a river
  const segs = [], grid = new Map(), GC = 4;
  for (const rv of album.data.vectors.rivers || []) {
    if (rv.pts.length <= 2) continue;
    const w = rv.rank <= 6 ? .2 : rv.rank <= 8 ? .12 : .07, pts = smoothLine(rv.pts, 1.2, 2).map(q => kmOf(q[1], q[0]));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], id = segs.length; segs.push([a[0], a[1], b[0], b[1], w]);
      for (let gy = Math.floor((Math.min(a[1], b[1]) - 2) / GC); gy <= Math.floor((Math.max(a[1], b[1]) + 2) / GC); gy++)
        for (let gx = Math.floor((Math.min(a[0], b[0]) - 2) / GC); gx <= Math.floor((Math.max(a[0], b[0]) + 2) / GC); gx++) { const key = gx * 100000 + gy; (grid.get(key) || grid.set(key, []).get(key)).push(id); }
    }
  }
  let riverMin = 0, riverK = 1;                                     // least width of a ribbon in km, and the «Ширина рек» knob
  const river = (x, y) => {
    if (riverK <= 0) return 1e9;
    let best = 1e9;
    for (const id of grid.get(Math.floor(x / GC) * 100000 + Math.floor(y / GC)) || []) {
      const s = segs[id], dx = s[2] - s[0], dy = s[3] - s[1], t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) - Math.max(s[4], riverMin) * riverK * .5);
    }
    return best;
  };
  const env = { at, river, swamp: (x, y) => { const k = ch.k(Math.floor(x / CHUNK_KM), Math.floor(y / CHUNK_KM)); return k < 0 ? 0 : ch.get('swamp', k); } };

  // ---- growth: the places and the knob become the state of the chunks; after a reset of the chunks, again
  const land = sampleLand(ch, at), written = new Map(), byteOf = (name, k) => Math.round(ch.get(name, k) * 255);
  let model = null, grown = -1;
  function applyGrowth(fresh) {
    if (!fresh) for (const [k, w] of written) {                     // take back what the model wrote, unless someone changed it since
      if (byteOf('built', k) === w.built) ch.set('built', k, ch.getNatural('built', k));
      if (byteOf('fields', k) === w.fields) ch.set('fields', k, ch.getNatural('fields', k));
      if (byteOf('forest', k) === w.forest) ch.set('forest', k, w.forest0);
    }
    written.clear(); grown = p.get('growth');
    model = growTowns(ch, places, grown, at, land);
    for (let k = 0; k < ch.count; k++) {
      const b = model.built[k], f = model.fields[k], keep = model.keep[k];
      if (!(b > 0 || f > 0 || keep < 1)) continue;
      const forest0 = ch.get('forest', k);
      if (b > 0) ch.set('built', k, Math.max(ch.get('built', k), b, 1 / 255));
      if (f > 0) ch.set('fields', k, Math.max(ch.get('fields', k), f));
      if (keep < 1) ch.set('forest', k, Math.min(forest0, keep));   // people fell the forest around them
      written.set(k, { built: byteOf('built', k), fields: byteOf('fields', k), forest: byteOf('forest', k), forest0 });
    }
  }
  ch.onReset(() => applyGrowth(true));
  p.on(key => { if (key === 'growth' || (key == null && grown !== p.get('growth'))) applyGrowth(false); });
  applyGrowth(true);

  // ---- the mirror of the chunk state for the shaders, and the patches for the plan
  const defSites = new Map();
  function defaultSite(k) {                                         // a chunk built up by something else than the model: its best dry spot
    let s = defSites.get(k); if (s) return s;
    let bs = -1; s = [128, 128];
    for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) {
      const f = land[k * 25 + b * 5 + a]; if (!(f & 1)) continue;
      const sc = (f & 2 ? 2 : 1) - Math.hypot(a - 2, b - 2) * .2 + ((k * 31 + a * 7 + b * 13) % 10) * .01;
      if (sc > bs) { bs = sc; s = [Math.floor((a + .5) / 5 * 256), Math.floor((b + .5) / 5 * 256)]; }
    }
    defSites.set(k, s); return s;
  }
  let lobes = [], seen = -1, mirrorN = 0;
  function mirror() {
    const r = mirrorSettle(ch, k => model.sites.get(k) || defaultSite(k));
    if (!r.changed && mirrorN) return;
    lobes = r.lobes; mirrorN++; settleTex.needsUpdate = true;
  }

  // ---- the blocks: one geometry, one material, one draw call
  const shapes = buildShapes(), tShapes = new DataTexture(shapes.data, shapes.width, shapes.height, RGBAFormat, UnsignedByteType);
  tShapes.magFilter = tShapes.minFilter = NearestFilter; tShapes.needsUpdate = true;
  const slots = new Float32Array(SLOTS * 3); for (let i = 0; i < SLOTS; i++) slots[i * 3] = i;
  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, ...lightUniforms(T),
      tShapes: { value: tShapes }, uS: { value: CELL20 }, uH: { value: 1.25 }, u3D: { value: 1 }, uLod: { value: 0 } } });
  const mesh = new Mesh(new InstancedBufferGeometry(), mat); mesh.frustumCulled = false; mesh.visible = false; album.scene.add(mesh);
  let cap = 0, count = 0, real = 0;
  function fill(rows) {
    const n = Math.min(MAX_BLOCKS, rows.length / ROW);
    if (n > cap || !cap) {                                          // the buffers grow by doubling; a small map never pays for a big one
      cap = Math.max(1024, 2 ** Math.ceil(Math.log2(n)));
      mesh.geometry.dispose();
      const g = mesh.geometry = new InstancedBufferGeometry();
      g.setAttribute('position', new BufferAttribute(slots, 3));
      for (const name of ['aA', 'aB', 'aC']) g.setAttribute(name, new InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    }
    const g = mesh.geometry, A = g.attributes.aA.array, B = g.attributes.aB.array, C = g.attributes.aC.array;
    real = 0;
    for (let i = 0; i < n; i++) { const o = i * ROW, q = i * 4;
      A[q] = rows[o]; A[q + 1] = rows[o + 1]; A[q + 2] = rows[o + 2]; A[q + 3] = rows[o + 3]; B[q] = rows[o + 4]; B[q + 1] = rows[o + 5]; B[q + 2] = rows[o + 6]; B[q + 3] = rows[o + 7];
      C[q] = rows[o + 8]; C[q + 1] = rows[o + 9]; C[q + 2] = rows[o + 10]; C[q + 3] = rows[o + 11]; real += shapes.tris[rows[o + 3]]; }
    g.instanceCount = count = n; for (const name of ['aA', 'aB', 'aC']) g.attributes[name].needsUpdate = true;
  }
  let planKey = '', cacheKey = ''; const cache = new Map();
  function rebuild(tx, ty, D, band, zoom) {
    const ck = `${band}|${mirrorN}|${riverK}|${zoom.toFixed(3)}`; if (ck !== cacheKey) { cache.clear(); cacheKey = ck; }   // plans of another cell size or another state are of no use
    for (const L of lobes) zoomLobe(L, zoom);
    const Sb = 1.04 ** band, near = lobes.filter(L => Math.hypot(L.x - tx, L.y - ty) < D + L.r).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
    const parts = []; let total = 0;
    for (const L of near) {
      let rows = cache.get(L.k); if (!rows) { rows = planLobe(L, Sb, env); cache.set(L.k, rows); }
      parts.push(rows); total += rows.length; if (total >= MAX_BLOCKS * ROW) break;
    }
    const all = new Float32Array(total); let o = 0; for (const r of parts) { all.set(r, o); o += r.length; }
    fill(all);
  }
  const U = settleUniforms.uSettle.value, u = mat.uniforms;
  const layer = { id: 'towns', kinds: KINDS,
    // numbers for the notes of this part (docs/album/settle.md)
    stats: () => ({ blocks: count, triangles: real, slots: count * SLOTS / 3, drawCalls: mesh.visible ? 1 : 0, patches: lobes.length, towns: model.towns.length,
      shapeTexBytes: shapes.data.length, settleTexBytes: settleTex.image.data.length, instanceBytes: cap * 48, trisPerKind: Object.fromEntries(KINDS.map((k, i) => [k, shapes.tris[i]])) }),
    model: () => model,
    update(dt, t, cam) {
      if (ch.version !== seen) { seen = ch.version; mirror(); }
      const h = cam.s.h, kH = p.get('houses'), on = !!p.get('towns'), flat = ['paper', 'atlas', 'night'].includes(p.get('look'));
      const S = cellSize(h, kH || 1), stand = flat ? 1 : 1 - Math.min(1, Math.max(0, (h - 95) / 30));
      const c0 = 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, h * .0042))));
      u.uH.value = p.get('houseH'); u.uLod.value = Math.max(0, Math.log2(c0 / .234));
      const [tx, ty] = kmOf(cam.s.lat, cam.s.lon);
      if (p.get('showcase')) {                                      // every kind in rows around the point the camera looks at
        const Ss = h * .088, key = `show|${Ss.toFixed(3)}|${tx.toFixed(1)},${ty.toFixed(1)}`;
        if (key !== planKey) { planKey = key; fill(planShowcase(tx, ty, Ss * 1.5)); }
        u.uS.value = Ss; u.u3D.value = 1; mesh.visible = true; U.set(S, 0, u.uH.value, 0);
        return;
      }
      const blocks = on && kH > 0 && stand > 0 && h < 900;
      U.set(S, blocks ? stand * stand * (3 - 2 * stand) : 0, u.uH.value, on ? zoomAt(h) : 0);
      mesh.visible = blocks; if (!blocks) return;
      u.uS.value = S; u.u3D.value = U.y;
      riverK = p.get('riversOn') === 0 ? 0 : p.get('rivers') ?? 1; riverMin = 2.2 * 2 * h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, album.renderer.domElement.clientHeight);
      const band = Math.round(Math.log(S) / Math.log(1.04)), key = `${band}|${kH}|${mirrorN}|${Math.round(tx / 15)},${Math.round(ty / 15)}|${riverK}`;
      if (key !== planKey) { planKey = key; rebuild(tx, ty, Math.max(60, h * 4.5), band, zoomAt(20 * (1.04 ** band / (CELL20 * kH)) ** (1 / .75))); }   // the plan is made for the height its cell size belongs to
    } };
  return layer;
}
