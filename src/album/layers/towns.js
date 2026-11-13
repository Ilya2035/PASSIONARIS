// Settlements that stand on the land, at their real size. The picture comes from the chunks: a chunk with `built` > 0
// has a patch of settlement (town/rules.js, town/state.js), and this layer puts blocks on the cells of that patch
// (town/plan.js). The blocks are the album's own (town/shapes.js): a few flat faces each, all kinds in one small
// texture, every block of every kind an instance of one strip of corners — the whole built world is one draw call,
// drawn before the land so that under a roof the costly ground is never worked out. The model of growth
// (town/grow.js) turns the places of the map and the «Рост городов» knob into the state of the chunks: houses,
// fields, felled forest. Places are today's cities (Natural Earth) as stand-ins: the game has no peoples yet.
// Among the fields stand single yards (town/yards.js): the same blocks in a second mesh, one more draw call.
// Between the centres of districts stand villages (town/villages.js): every district has its list of places, and the
// model founds a village on each as the «Рост городов» knob rises. They are patches like the towns, in a finer grid.
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, BufferGeometry, Points, Mesh, ShaderMaterial, DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, Vector4 } from 'three';
import { COMMON, LIGHT, lightUniforms } from '../glsl.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';
import { kmOf, llOf } from '../chunks.js';
import { smoothLine } from './ribbon.js';
import { roadLine } from '../roads/routes.js';
import { cellSize, cultureAt, CELL, PALETTE_GLSL, GX0, GY0 } from '../town/rules.js';
import { settleTex, settleUniforms, mirrorSettle, mirrorVillages, packAtlas } from '../town/state.js';
import { districtSites, villagePlaces, siteNumbers, madeAllowed, SITE } from '../town/villages.js';
import { buildShapes, SLOTS, KINDS, KIND } from '../town/shapes.js';
import { growTowns, centrePlaces } from '../town/grow.js';
import { planLobe, planShowcase, ROW } from '../town/plan.js';
import { planYards, patchIndex, YARD_KINDS, YARD_TILE, YARD_STEP } from '../town/yards.js';
import { KN } from '../division/km.js';

const MAX_BLOCKS = 40000, MAX_YARDS = 24000;
// How far from the point the camera looks at the ground is in the picture, km: out to the far corners. h: the
// distance of the camera from that point, tilt: from straight down, degrees, fov: of the picture's height, degrees.
// With villages everywhere, the blocks are planned no farther than this: what lies outside the picture costs nothing.
export function viewReach(h, tilt, fov, aspect) {
  const ti = tilt * Math.PI / 180, vf = fov * Math.PI / 360, up = h * Math.cos(ti), far = Math.min(ti + vf, 1.45);
  return Math.hypot(up * (Math.tan(far) - Math.tan(ti)), up / Math.cos(far) * Math.tan(vf) * aspect);
}
const VERT = /* glsl */`${COMMON}
  attribute vec4 aA, aB, aC;        // site x, y (flat km), turn of the lattice, kind · cell i, j, own turn, flags · size x, y, tint, height
  uniform sampler2D tShapes; uniform float uS, uH, u3D, uLod;
  uniform vec4 uYard;               // yards among the fields: the point the camera looks at (flat km), how far from it they stand (0 = everywhere), their size ×
  varying vec3 vN, vW, vL; varying vec4 vM;
  void main() {
    int slot = int(position.x + .5), kind = int(aA.w + .5);
    vec4 sa = floor(texelFetch(tShapes, ivec2(slot, kind * 2), 0) * 255. + .5), sb = texelFetch(tShapes, ivec2(slot, kind * 2 + 1), 0);
    vec3 lp = vec3((sa.xy - 128.) / 200., (sa.z - 16.) / 400.), ln = sb.xyz * (255. / 127.) - 128. / 127.;
    float cs = cos(aA.z), sn = sin(aA.z), ra = aA.z + aB.z, cr = cos(ra), sr = sin(ra);
    vec2 centre = aA.xy + vec2(cs * aB.x - sn * aB.y, sn * aB.x + cs * aB.y) * uS;        // the lattice grows with the camera height
    float grow = uYard.w * (uYard.z > 0. ? 1. - smoothstep(.75 * uYard.z, uYard.z, distance(centre, uYard.xy)) : 1.);   // far yards shrink to nothing: no ring where they end
    vec2 lxy = lp.xy * aC.xy * uS * grow, pkv = centre + vec2(cr * lxy.x - sr * lxy.y, sr * lxy.x + cr * lxy.y);
    vec2 llc = vec2(centre.y / KM, centre.x / (KM * COSREF)), llv = vec2(pkv.y / KM, pkv.x / (KM * COSREF));
    float show = max(step(1.5, aB.w), step(.6, heightLod(llc, 0.))) * step(.02, grow);  // never on water (a pier may reach over it)
    float hv = max(heightLod(llv, uLod), 0.) * uExag / 1000.;                            // every corner stands on the relief
    vW = worldOf(llv, hv + lp.z * uS * uH * aC.w * (lp.z > 0. ? u3D : 1.) * grow + .0015);
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

// the places of the districts, for checking (knob «Места поселений»): a dot at every place of every list
const SITES_VERT = /* glsl */`${COMMON}
  uniform float uPx;                // position: x, y (flat km), kind + 4 × founded
  varying vec2 vK;
  void main() {
    vec2 ll = vec2(position.y / KM, position.x / (KM * COSREF));
    gl_Position = projectionMatrix * viewMatrix * vec4(worldOf(ll, max(heightLod(ll, 2.), 0.) * uExag / 1000. + .02), 1.);
    vK = vec2(mod(position.z, 4.), floor(position.z / 4.));
    gl_PointSize = uPx * (vK.x < .5 ? 1.7 : 1.);
  }`;
const SITES_FRAG = /* glsl */`
  varying vec2 vK;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard;
    vec3 c = vK.x < .5 ? vec3(.86, .14, .12) : vK.x < 1.5 ? vec3(1., .82, .16) : vec3(.20, .56, .96);      // centre · real place · made place
    gl_FragColor = vec4(mix(vK.y > .5 ? c : vec3(.97), vec3(.06, .05, .05), smoothstep(.66, .76, r)), 1.);   // founded: filled; empty: white
  }`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params, ch = album.chunks, base = album.data.base;
  // the places the model founds: the places of the album to begin with; once the land is divided into districts, also
  // the centre of every other district (grow.js, centrePlaces) and the villages between them (villages.js)
  let places = album.data.vectors.places, divSeen = -1, villSeen = -1, siteList = null, siteOfBase = new Map(), founded = new Uint8Array(0), perDistrict = new Map();
  const at = (x, y) => base.at(y / KM_PER_DEG, x / (KM_PER_DEG * COS_REF));        // height in metres at a point of the flat km plane
  for (let k = 0; k < ch.count; k++) { const c = ch.centre(k); ch.setNatural('culture', k, cultureAt(c.lat, c.lon) / 255); }

  // ---- rivers as the settlements must know them: nothing stands on the ribbon of a river
  // (stretches of river as five numbers each: x, y of both ends and the width; a grid of 4 km says which lie near a point)
  let segs = [], grid = new Map(); const GC = 4, REACH = 2.6;
  const seg = (a, b, w) => {
    const id = segs.length / 5; segs.push(a[0], a[1], b[0], b[1], w);
    for (let gy = Math.floor((Math.min(a[1], b[1]) - REACH) / GC); gy <= Math.floor((Math.max(a[1], b[1]) + REACH) / GC); gy++)
      for (let gx = Math.floor((Math.min(a[0], b[0]) - REACH) / GC); gx <= Math.floor((Math.max(a[0], b[0]) + REACH) / GC); gx++) { const key = gx * 100000 + gy; (grid.get(key) || grid.set(key, []).get(key)).push(id); }
  };
  function indexRivers() {
    segs = []; grid = new Map();
    if (album.data.courses) {                                       // the real courses, every bend of them, within reach of the places
      // (a village and its fields reach far less than a town)
      const nearPlace = new Set(); for (const pl of places) { const [x, y] = kmOf(pl.lat, pl.lon), e = pl.village ? 1.7 : GC; for (let gy = Math.floor((y - e) / GC); gy <= Math.floor((y + e) / GC); gy++) for (let gx = Math.floor((x - e) / GC); gx <= Math.floor((x + e) / GC); gx++) nearPlace.add(gx * 100000 + gy); }
      for (const rv of album.data.courses.rivers) {
        let a = null;
        for (let i = 0; i < rv.n; i++) { const b = kmOf(rv.ll[i * 2 + 1], rv.ll[i * 2]); if (a && rv.w[i] >= .004 && nearPlace.has(Math.floor(b[0] / GC) * 100000 + Math.floor(b[1] / GC))) seg(a, b, Math.max(rv.w[i], rv.w[i - 1])); a = b; }
      }
    } else for (const rv of album.data.vectors.rivers || []) {      // the coarse lines of Natural Earth: only a rank, not a width
      if (rv.pts.length <= 2) continue;
      const w = rv.rank <= 6 ? .2 : rv.rank <= 8 ? .12 : .07, pts = smoothLine(rv.pts, 1.2, 2).map(q => kmOf(q[1], q[0]));
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], w);
    }
  }
  indexRivers();
  let riverMin = 0, riverK = 1;                                     // least width of a ribbon in km, and the «Ширина рек» knob
  const bank = (x, y, least, k) => {                                // km to the bank of the nearest river (negative on the water)
    let best = 1e9;
    for (const id of grid.get(Math.floor(x / GC) * 100000 + Math.floor(y / GC)) || []) {
      const o = id * 5, ax = segs[o], ay = segs[o + 1], dx = segs[o + 2] - ax, dy = segs[o + 3] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t) - Math.max(segs[o + 4], least) * k * .5);
    }
    return best;
  };
  const env = { at, river: (x, y) => (riverK <= 0 ? 1e9 : bank(x, y, riverMin, riverK)),
    swamp: (x, y) => { const q = llOf(x, y), k = ch.at(q.lat, q.lon); return k < 0 ? 0 : ch.get('swamp', k); } };

  // ---- growth: the places and the knob become the state of the chunks; after a reset of the chunks, again
  const written = new Map(), byteOf = (name, k) => Math.round(ch.get(name, k) * 255);
  let model = null, grown = -1;
  function applyGrowth(fresh) {
    if (!fresh) for (const [k, w] of written) {                     // take back what the model wrote, unless someone changed it since
      if (byteOf('built', k) === w.built) ch.set('built', k, ch.getNatural('built', k));
      if (byteOf('fields', k) === w.fields) ch.set('fields', k, ch.getNatural('fields', k));
      if (byteOf('forest', k) === w.forest) ch.set('forest', k, w.forest0);
    }
    written.clear(); grown = p.get('growth');
    model = growTowns(ch, places, grown, at, (x, y) => bank(x, y, 0, 1));
    for (let k = 0; k < ch.count; k++) {
      const b = model.built[k], f = model.fields[k], keep = model.keep[k];
      if (!(b > 0 || f > 0 || keep < 1)) continue;
      const forest0 = ch.get('forest', k);
      if (b > 0) ch.set('built', k, Math.max(ch.get('built', k), b));
      if (f > 0) ch.set('fields', k, Math.max(ch.get('fields', k), f));
      if (keep < 1) ch.set('forest', k, Math.min(forest0, keep));   // people fell the forest around them
      written.set(k, { built: byteOf('built', k), fields: byteOf('fields', k), forest: byteOf('forest', k), forest0 });
    }
    // which places of the lists are settled now, and what every district holds
    perDistrict = new Map();
    if (siteList) {
      founded = new Uint8Array(siteList.x.length);
      for (const t of model.towns) {
        const s = siteOfTown(t); if (!s) continue;
        founded[siteList.first[s.district] + s.site] = 1;
        const q = perDistrict.get(s.district) || perDistrict.set(s.district, { settlements: 0, villages: 0, people: 0 }).get(s.district);
        q.settlements++; q.people += t.people; if (t.village) q.villages++;
      }
    }
    sitesDrawn = false;
  }
  // which place of which district a settlement stands on: { district, site } (site 0 is the centre), or null
  const siteOfTown = t => { const pl = places[t.index]; return pl.site !== undefined ? { district: pl.district, site: pl.site } : pl.district !== undefined ? { district: pl.district, site: 0 } : siteOfBase.get(t.index) || null; };
  let sitesDrawn = false;
  ch.onReset(() => applyGrowth(true));
  p.on(key => { if (key === 'growth' || (key == null && grown !== p.get('growth'))) applyGrowth(false); });
  applyGrowth(true);

  // ---- the mirror of the chunk state for the shaders, and the patches for the plan
  let lobes = [], seen = -1, mirrorN = 0;
  function mirror() {
    const r = mirrorSettle(ch, model.towns), v = mirrorVillages(ch, model.towns, r.lobes);
    if (!r.changed && !v.changed && mirrorN) return;
    packAtlas();
    lobes = r.lobes.concat(v.lobes); mirrorN++; settleTex.needsUpdate = true; yctx.patches = patchIndex(lobes);
  }

  // ---- the blocks: one geometry, one material, one draw call
  const shapes = buildShapes(), tShapes = new DataTexture(shapes.data, shapes.width, shapes.height, RGBAFormat, UnsignedByteType);
  tShapes.magFilter = tShapes.minFilter = NearestFilter; tShapes.needsUpdate = true;
  const slots = new Float32Array(SLOTS * 3); for (let i = 0; i < SLOTS; i++) slots[i * 3] = i;
  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, ...lightUniforms(T),
      tShapes: { value: tShapes }, uS: { value: CELL }, uH: { value: 1.25 }, u3D: { value: 1 }, uLod: { value: 0 }, uYard: { value: new Vector4(0, 0, 0, 1) } } });
  // a set of blocks: one mesh, every block an instance of the same strip of corners. Yards are light, so their strip is shorter.
  function blockSet(material, strip, most) {
    const mesh = new Mesh(new InstancedBufferGeometry(), material); mesh.frustumCulled = false; mesh.visible = false; album.scene.add(mesh);
    mesh.renderOrder = -100;                                        // before the land: under a roof the costly ground shader is never run
    const set = { mesh, cap: 0, count: 0, real: 0,
      fill(rows) {
        const n = Math.min(most, rows.length / ROW);
        if (n > set.cap || !set.cap) {                              // the buffers grow by doubling; a small map never pays for a big one
          set.cap = Math.max(1024, 2 ** Math.ceil(Math.log2(n)));
          mesh.geometry.dispose();
          const g = mesh.geometry = new InstancedBufferGeometry();
          g.setAttribute('position', new BufferAttribute(strip, 3));
          for (const name of ['aA', 'aB', 'aC']) g.setAttribute(name, new InstancedBufferAttribute(new Float32Array(set.cap * 4), 4));
        }
        const g = mesh.geometry, A = g.attributes.aA.array, B = g.attributes.aB.array, C = g.attributes.aC.array;
        set.real = 0;
        for (let i = 0; i < n; i++) { const o = i * ROW, q = i * 4;
          A[q] = rows[o]; A[q + 1] = rows[o + 1]; A[q + 2] = rows[o + 2]; A[q + 3] = rows[o + 3]; B[q] = rows[o + 4]; B[q + 1] = rows[o + 5]; B[q + 2] = rows[o + 6]; B[q + 3] = rows[o + 7];
          C[q] = rows[o + 8]; C[q + 1] = rows[o + 9]; C[q + 2] = rows[o + 10]; C[q + 3] = rows[o + 11]; set.real += shapes.tris[rows[o + 3]]; }
        g.instanceCount = set.count = n; for (const name of ['aA', 'aB', 'aC']) g.attributes[name].needsUpdate = true;
      } };
    return set;
  }
  const town = blockSet(mat, slots, MAX_BLOCKS), mesh = town.mesh, fill = town.fill;
  // ---- yards among the fields (town/yards.js): the same blocks, the same shader, a mesh of their own
  const ySlots = Math.max(...YARD_KINDS.map(k => shapes.tris[KIND[k]])) * 3;
  const ymat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...mat.uniforms, uYard: { value: new Vector4(0, 0, 0, 1) } } });
  const yard = blockSet(ymat, slots.subarray(0, ySlots * 3), MAX_YARDS);
  // roads as the yards must know them: no yard stands on a road
  let roadSeen = null, roadN = 0, rsegs = [], rgrid = new Map(); const RC = 2;
  function indexRoads() {
    rsegs = []; rgrid = new Map(); roadSeen = album.roadNet || null; roadN++;
    for (const l of roadSeen?.lines || []) {
      const pts = smoothLine(roadLine(l.pts), .35, 2).map(q => kmOf(q[1], q[0]));       // the line as the road layer draws it
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], id = rsegs.length / 4; rsegs.push(a[0], a[1], b[0], b[1]);
        for (let gy = Math.floor((Math.min(a[1], b[1]) - .2) / RC); gy <= Math.floor((Math.max(a[1], b[1]) + .2) / RC); gy++)
          for (let gx = Math.floor((Math.min(a[0], b[0]) - .2) / RC); gx <= Math.floor((Math.max(a[0], b[0]) + .2) / RC); gx++) { const key = gx * 100000 + gy; (rgrid.get(key) || rgrid.set(key, []).get(key)).push(id); } }
    }
  }
  const roadAt = (x, y) => {                                        // km to the nearest road (only roads within 200 m are found)
    let best = 1e9;
    for (const id of rgrid.get(Math.floor(x / RC) * 100000 + Math.floor(y / RC)) || []) {
      const o = id * 4, ax = rsegs[o], ay = rsegs[o + 1], dx = rsegs[o + 2] - ax, dy = rsegs[o + 3] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return best;
  };
  const yctx = { cell: ch.cell, land: c => ch.kind[c] === 1, fields: c => ch.get('fields', c), culture: c => Math.round(ch.get('culture', c) * 255),
    patches: new Map(), env: { ...env, road: roadAt }, density: 1, S: CELL,
    // a yard stands at one of the sixteen places of a chunk of 1 km² of land (once the land is divided)
    landSquare: (kx, ky) => { const dv = album.division?.data; if (!dv?.cells) return true; const d = kx >= 0 && ky >= 0 && kx < KN && ky < KN ? dv.cells[ky * KN + kx] : -1; return d >= 0 && dv.kinds[d] === 0; } };
  let yKey = '', yCacheKey = ''; const yCache = new Map(), TKM = YARD_TILE * YARD_STEP;
  function rebuildYards(tx, ty, D, ck) {
    if (ck !== yCacheKey) { yCache.clear(); yCacheKey = ck; }
    const ci = Math.floor((tx - GX0) / TKM), cj = Math.floor((ty - GY0) / TKM), n = Math.ceil(D / TKM) + 1, tiles = [];
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
      const d = Math.hypot(GX0 + (ci + di + .5) * TKM - tx, GY0 + (cj + dj + .5) * TKM - ty);
      if (d < D) tiles.push([d, ci + di, cj + dj]);
    }
    tiles.sort((a, b) => a[0] - b[0]);                              // the nearest first: if there are too many yards, the far ones are left out
    const parts = []; let total = 0;
    for (const [, ti, tj] of tiles) {
      const key = tj * 100000 + ti; let rows = yCache.get(key); if (!rows) { rows = planYards(yctx, ti, tj); yCache.set(key, rows); }
      if (rows.length) { parts.push(rows); total += rows.length; if (total >= MAX_YARDS * ROW) break; }
    }
    const all = new Float32Array(total); let o = 0; for (const r of parts) { all.set(r, o); o += r.length; }
    yard.fill(all);
  }
  // ---- the places of the districts shown for checking: one mesh of points
  const smat = new ShaderMaterial({ vertexShader: SITES_VERT, fragmentShader: SITES_FRAG, depthTest: false, depthWrite: false,
    uniforms: { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uPx: { value: 8 } } });
  const spts = new Points(new BufferGeometry(), smat); spts.frustumCulled = false; spts.visible = false; spts.renderOrder = 7; album.scene.add(spts);
  function drawSites() {
    sitesDrawn = true; if (!siteList) return;
    const L = siteList, a = new Float32Array(L.x.length * 3); let n = 0;
    for (let d = 0; d < L.count; d++) { const allow = madeAllowed(L, d, villSeen); let made = 0;
      for (let s = L.first[d]; s < L.first[d + 1]; s++) { if (L.kind[s] === SITE.made && made++ >= allow) continue; a[n++] = L.x[s]; a[n++] = L.y[s]; a[n++] = L.kind[s] + 4 * founded[s]; } }
    spts.geometry.dispose(); spts.geometry = new BufferGeometry(); spts.geometry.setAttribute('position', new BufferAttribute(a.subarray(0, n), 3));
  }
  let planKey = '', cacheKey = ''; const cache = new Map();
  function rebuild(tx, ty, D, S, ck) {
    if (ck !== cacheKey) { cache.clear(); cacheKey = ck; }           // plans of another cell size or another state are of no use
    const near = lobes.filter(L => Math.hypot(L.x - tx, L.y - ty) < D + L.r).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
    const parts = []; let total = 0;
    for (const L of near) {
      let rows = cache.get(L.k); if (!rows) { rows = planLobe(L, S, env); cache.set(L.k, rows); }
      parts.push(rows); total += rows.length; if (total >= MAX_BLOCKS * ROW) break;
    }
    const all = new Float32Array(total); let o = 0; for (const r of parts) { all.set(r, o); o += r.length; }
    fill(all);
  }
  const U = settleUniforms.uSettle.value, u = mat.uniforms;
  const layer = { id: 'towns', kinds: KINDS,
    // numbers for the notes of this part (docs/album/settle.md)
    stats: () => ({ blocks: town.count, triangles: town.real, slots: town.count * SLOTS / 3, drawCalls: (mesh.visible ? 1 : 0) + (yard.mesh.visible ? 1 : 0), patches: lobes.length, towns: model.towns.length,
      villages: model.towns.filter(t => t.village).length, places: places.length, sites: siteList ? siteList.x.length : 0,
      yards: yard.mesh.visible ? yard.count : 0, yardTriangles: yard.mesh.visible ? yard.real : 0, yardCorners: yard.mesh.visible ? yard.count * ySlots : 0,
      shapeTexBytes: shapes.data.length, settleTexBytes: settleTex.image.data.length, instanceBytes: (town.cap + yard.cap) * 48, trisPerKind: Object.fromEntries(KINDS.map((k, i) => [k, shapes.tris[i]])) }),
    yardContext: () => yctx,
    model: () => model,
    places: () => places,
    // the lists of places of the districts (villages.js), which of them are settled, and where a settlement stands
    sites: () => siteList, founded: () => founded, siteOfTown,
    // what a district holds: { places (in its list at this density), settlements, villages, people }
    districtInfo(d) {
      if (!siteList || !(d >= 0) || siteList.first[d + 1] === siteList.first[d]) return null;
      let made = 0, n = 0; const allow = madeAllowed(siteList, d, villSeen);
      for (let s = siteList.first[d]; s < siteList.first[d + 1]; s++) if (siteList.kind[s] !== SITE.made || made++ < allow) n++;
      return { places: n, settlements: 0, villages: 0, people: 0, ...perDistrict.get(d) };
    },
    update(dt, t, cam) {
      // the land has been divided (or divided anew): a settlement stands at the centre of every district
      const dv = album.division, vk = p.get('villages') ?? 1;
      if (dv && (dv.version !== divSeen || vk !== villSeen)) {
        const t0 = performance.now(), nb = album.data.vectors.places.length;
        // every district gets its list of places (the same every time), and the knob says how many of them are used
        if (dv.version !== divSeen || !siteList) { siteList = districtSites(dv.data, dv.chunkFacts(), dv.sites, { base: nb, at, swamp: (x, y) => { const q = llOf(x, y), k = ch.at(q.lat, q.lon); return k < 0 ? 0 : ch.getNatural('swamp', k); } }); siteOfBase = siteNumbers(siteList); }
        divSeen = dv.version; villSeen = vk;
        const t1 = performance.now();
        places = [...centrePlaces(album.data.vectors.places, dv.data, dv.sites), ...villagePlaces(siteList, dv.sites, { base: nb, density: vk })];
        indexRivers(); applyGrowth(false);
        console.log(`[album] settlements: ${places.length} places (${siteList.x.length} in the lists of the districts, ${(t1 - t0).toFixed(0)} ms), ${model.towns.length} founded at growth ${grown}, ${model.towns.filter(t => t.village).length} of them villages (${(performance.now() - t1).toFixed(0)} ms, ${segs.length / 5} stretches of river near them)`); }
      spts.visible = !!p.get('sitesShow') && !!siteList;
      if (spts.visible) { if (!sitesDrawn) drawSites(); smat.uniforms.uPx.value = Math.max(5, Math.min(13, 900 / cam.s.h)) * (album.renderer.getPixelRatio?.() || 1); }
      if (ch.version !== seen) { seen = ch.version; mirror(); }
      const h = cam.s.h, kH = p.get('houses'), on = !!p.get('towns'), flat = ['paper', 'atlas', 'night'].includes(p.get('look')), dom = album.renderer.domElement;
      const S = cellSize(h, kH || 1), view = 2 * h * Math.tan(cam.cam.fov * Math.PI / 360), cells = S / (view / Math.max(1, dom.height));   // a block in pixels of the picture
      // blocks stand while a block is a few pixels wide; smaller than that the ground alone shows the settlement
      const stand = Math.max(0, Math.min(1, flat ? (cells - .8) / .7 : (cells - 2.5) / 1.5));
      const c0 = 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, h * .0042))));
      u.uH.value = p.get('houseH'); u.uLod.value = Math.max(0, Math.log2(c0 / .234));
      const [tx, ty] = kmOf(cam.s.lat, cam.s.lon);
      if (p.get('showcase')) {                                      // every kind in rows around the point the camera looks at, far larger than life
        const Ss = h * .05, key = `show|${Ss.toFixed(3)}|${tx.toFixed(1)},${ty.toFixed(1)}`;
        if (key !== planKey) { planKey = key; fill(planShowcase(tx, ty, Ss * 1.45)); }
        u.uS.value = Ss; u.u3D.value = 1; mesh.visible = true; yard.mesh.visible = false; U.set(S, 0, u.uH.value, 0);
        return;
      }
      const blocks = on && kH > 0 && stand > 0;
      U.set(S, blocks ? stand * stand * (3 - 2 * stand) : 0, u.uH.value, on ? 1 : 0);
      const yk = p.get('yards') ?? 1, yards = blocks && yk > 0;
      mesh.visible = blocks; yard.mesh.visible = yards; if (!blocks) return;
      u.uS.value = S; u.u3D.value = U.y;
      riverK = p.get('riversOn') === 0 ? 0 : p.get('rivers') ?? 1; riverMin = 1.5 * view / Math.max(1, dom.clientHeight);
      // the blocks are planned as far as the picture reaches (and a little farther: until the camera has moved 8 km
      // or risen or tilted a step, the plan stays)
      const hb = Math.ceil(h / 8) * 8, tb = Math.min(78, Math.ceil(cam.s.tilt / 6) * 6);
      const ck = `${S}|${mirrorN}|${riverK}|${Math.round(Math.max(0, riverMin - .07) * 40)}`, key = `${ck}|${Math.round(tx / 8)},${Math.round(ty / 8)}|${hb}|${tb}`;
      if (key !== planKey) { planKey = key; rebuild(tx, ty, Math.min(Math.max(25, hb * 2.5), viewReach(hb, tb, cam.cam.fov, dom.width / Math.max(1, dom.height)) + 14), S, ck); }
      if (!yards) return;
      // yards stand around the point the camera looks at, as far as they can be told from the ground; as the camera
      // rises they shrink to nothing together with the blocks of the settlements
      if ((album.roadNet || null) !== roadSeen) indexRoads();
      const D = Math.min(72, Math.max(20, 4 * Math.ceil(h * 1.5 / 4))), ax = Math.round(tx / 4) * 4, ay = Math.round(ty / 4) * 4;
      yctx.density = yk; yctx.S = S;
      const yck = `${ck}|${seen}|${yk}|${roadN}|${divSeen}`, ykey = `${yck}|${ax},${ay}|${D}`;
      if (ykey !== yKey) { yKey = ykey; rebuildYards(ax, ay, D, yck); }
      ymat.uniforms.uYard.value.set(tx, ty, D - 5.7, U.y);
    } };
  return layer;
}
