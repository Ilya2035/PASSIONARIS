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
// The fields are the state of the chunks of 1 km² (town/farmland.js): every settlement ploughs the chunks around it,
// and the ground shader draws the fields from the share each chunk keeps (town/state.js, the rows of the chunks).
// From every village a track leads to the roads of its district (town/tracks.js): thin ribbons, like the roads, laid
// around the point the camera looks at and shown while the villages themselves can be told.
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, BufferGeometry, Points, Mesh, ShaderMaterial, DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, Vector4 } from 'three';
import { COMMON, LIGHT, lightUniforms } from '../glsl.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';
import { kmOf, llOf } from '../chunks.js';
import { smoothLine, makeRibbons } from './ribbon.js';
import { roadLine } from '../roads/routes.js';
import { cellSize, cultureAt, rankOf, midOf, wallAt, CELL, PALETTE_GLSL, GX0, GY0, WALL_FROM, passesOfDistrict } from '../town/rules.js';
import { settleTex, settleUniforms, mirrorSettle, mirrorVillages, mirrorGates, mirrorFarm, farmAt, packAtlas } from '../town/state.js';
import { farmGround, farmWithCells, farmOfDistricts, HA_PER_PERSON } from '../town/farmland.js';
import { districtSites, villagePlaces, siteNumbers, madeAllowed, SITE } from '../town/villages.js';
import { loadPlaceNames, namePlaces } from '../town/sites.js';
import { buildShapes, SLOTS, KINDS, KIND } from '../town/shapes.js';
import { growTowns, centrePlaces, townsOfDistricts, placesAllowed, builtChunks, groundCan } from '../town/grow.js';
import { treelineAt } from '../ground/climate.js';
import { planLobe, planShowcase, ROW } from '../town/plan.js';
import { planYards, patchIndex, YARD_KINDS, YARD_TILE, YARD_STEP } from '../town/yards.js';
import { KN, KKM, KX0, KY0, squareOf } from '../division/km.js';
import { roadChunks, districtTracks, trackLines, trackIndex, TRACK_SNAP } from '../town/tracks.js';

const MAX_BLOCKS = 40000, MAX_YARDS = 24000;
// a track to a village: width on the ground km, least width in pixels, colour on the natural land and on paper — a
// step below the track that joins two districts (layers/roads.js)
// (the owner, 13.11.2026: around a town «хорошо видны малые дороги» — a little wider and lighter than they were)
const TRACK = { w: .009, px: 2, light: 0xbfa477, ink: 0x8f7354, alpha: 1 };
const TRACK_FADE = [.045, .085];                                    // km to a pixel: the tracks go as the villages themselves melt into the land
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
  // Every name on the map is Russian: the places of the album the data names in Latin letters get their Russian names
  // here, before the division and the marks read them (the list was made when the data was prepared: town/translit.js)
  namePlaces(album.data.vectors.places, await loadPlaceNames());
  // the places the model founds: the places of the album to begin with; once the land is divided into districts, also
  // the centre of every other district (grow.js, centrePlaces) and the villages between them (villages.js)
  let places = album.data.vectors.places, divSeen = -1, villSeen = -1, siteList = null, siteOfBase = new Map(), founded = new Uint8Array(0), perDistrict = new Map();
  let siteR = new Float32Array(0), grownN = 0;                      // the radius of the settlement on every place of the lists (0: nobody there) · changes with every run of the model
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
  let model = null, grown = -1, haSeen = -1, ground = null, groundOf = -2, farmN = 0;
  function applyGrowth(fresh) {
    if (!fresh) for (const [k, w] of written) {                     // take back what the model wrote, unless someone changed it since
      if (byteOf('built', k) === w.built) ch.set('built', k, ch.getNatural('built', k));
      if (byteOf('fields', k) === w.fields) ch.set('fields', k, ch.getNatural('fields', k));
      if (byteOf('forest', k) === w.forest) ch.set('forest', k, w.forest0);
    }
    written.clear(); grown = p.get('growth'); haSeen = p.get('farmHa') ?? HA_PER_PERSON;
    // what the chunks of 1 km² can give: from the division once the land is divided, from the relief before that
    const dv = album.division, dvN = dv ? dv.version : -1;
    // (the chunks the division marks as bog are never ploughed: its reason № 4, km.js SETTLE_WHY)
    if (groundOf !== dvN) { groundOf = dvN; const why = dv?.settleFacts?.()?.why; ground = farmGround(ch, at, dv ? { cls: dv.chunkFacts().cls, hgt: dv.data.raster.hgt, bog: why ? why.map(w => (w === 4 ? 1 : 0)) : null } : null, k => ch.getNatural('swamp', k)); }
    model = growTowns(ch, places, grown, at, (x, y) => bank(x, y, 0, 1), { ground, ha: haSeen }); farmN++;
    for (let k = 0; k < ch.count; k++) {
      const b = model.built[k], f = model.fields[k], keep = model.keep[k];
      if (!(b > 0 || f > 0 || keep < 1)) continue;
      const forest0 = ch.get('forest', k);
      if (b > 0) ch.set('built', k, Math.max(ch.get('built', k), b));
      if (f > 0) ch.set('fields', k, Math.max(ch.get('fields', k), f));
      if (keep < 1) ch.set('forest', k, Math.min(forest0, keep));   // people fell the forest around them
      written.set(k, { built: byteOf('built', k), fields: byteOf('fields', k), forest: byteOf('forest', k), forest0 });
    }
    crown();
    // which places of the lists are settled now, and what every district holds
    perDistrict = new Map(); grownN++;
    const held = d => perDistrict.get(d) || perDistrict.set(d, { settlements: 0, villages: 0, people: 0, list: [] }).get(d);
    if (siteList) {
      founded = new Uint8Array(siteList.x.length); siteR = new Float32Array(siteList.x.length);
      for (const t of model.towns) {
        const s = siteOfTown(t); if (!s) continue;
        founded[siteList.first[s.district] + s.site] = 1; siteR[siteList.first[s.district] + s.site] = t.R;
        const q = held(s.district);
        q.settlements++; q.people += t.people; if (!t.town) q.villages++; q.list.push(t);
        // a town that has grown into this one: its district has no town of its own, and says whose houses stand there
        for (const index of t.merged || []) { const m = siteOfPlace(index); if (m && m.district !== s.district) held(m.district).list.push({ index, part: t }); }
      }
    }
    sitesDrawn = false;
  }
  // ---- every chunk of 1 km² a settlement is built on knows that settlement; the settlements get their names, and the
  // chief towns of the lands are told apart: they stay marked from higher up (layers/labels.js)
  let own = { owner: new Map(), chunks: new Int32Array(0) };
  const siteOfPlace = index => { const pl = places[index]; return !pl ? null : pl.site !== undefined ? { district: pl.district, site: pl.site } : pl.district !== undefined ? { district: pl.district, site: 0 } : siteOfBase.get(index) || null; };
  function nameOf(t) {
    const nm = places[t.index].name; if (nm || !t.town) return nm || '';
    // the town of a district that has no name of its own is called after its district — when the district is itself
    // called after a settlement (the division says so: nameKind 'place'), not after a land or by the points of the compass
    const s = siteOfPlace(t.index), dv = album.division, dn = s ? dv?.districtName?.(s.district) : '';
    return dn && (dv.nameKind ? dv.nameKind(s.district) === 'place' : !/№/.test(dn)) ? dn : '';
  }
  function crown() {
    const dv = album.division, cells = dv?.data?.cells;
    own = builtChunks(model.towns, cells ? c => { const d = cells[c]; return d >= 0 && dv.data.kinds[d] === 0; } : null);
    for (const t of model.towns) { t.name = nameOf(t); t.capital = undefined; }
    if (dv) {
      // The chief town of a province, of a land (Кастилия, Арагон…) and of a region: the one the division names
      // (dv.capitalOf(level, id) → { district }); where it names none, the most populous town there.
      const best = [new Map(), new Map(), new Map()], greater = (a, b) => a.people - b.people || places[a.index].pop - places[b.index].pop, townOf = new Map();
      for (const t of model.towns) {
        if (!t.town) continue; const s = siteOfPlace(t.index); if (!s) continue;
        townOf.set(s.district, t);
        const pv = dv.provinceOf(s.district); if (!(pv >= 0)) continue;
        [pv, dv.data.provinces?.[pv]?.land || '', dv.regionOf(pv)].forEach((k, l) => { if (k === '' || k < 0) return; const o = best[l].get(k); if (!o || greater(t, o) > 0) best[l].set(k, t); });
      }
      // (the division answers with the district whose town it is: { district })
      ['province', 'land', 'region'].forEach((level, l) => { for (const [k, t] of best[l]) { const said = dv.capitalOf?.(level, k); ((said && townOf.get(said.district)) || t).capital = level; } });
    }
    for (const t of model.towns) t.rank = rankOf(t);
  }
  // a settlement as the panel of a district and the marks of the map show it
  const rowOf = t => { const q = llOf(t.x, t.y); return { index: t.index, name: t.name, cls: t.cls, rank: t.rank, capital: t.capital || '', town: !!t.town, people: t.people, areaKm2: t.chunks || 0, radius: t.R, lat: q.lat, lon: q.lon, merged: (t.merged || []).length }; };
  // which place of which district a settlement stands on: { district, site } (site 0 is the centre), or null
  const siteOfTown = t => siteOfPlace(t.index);
  let sitesDrawn = false;
  ch.onReset(() => applyGrowth(true));
  p.on(key => { if (key === 'growth' || key === 'farmHa' || (key == null && (grown !== p.get('growth') || haSeen !== (p.get('farmHa') ?? HA_PER_PERSON)))) applyGrowth(false); });
  applyGrowth(true);

  // ---- the mirror of the chunk state for the shaders, and the patches for the plan
  let lobes = [], seen = -1, mirrorN = 0, farmSig = '', farmSeen = -1, farmShown = null, farmV = 0, farmPer = null;
  function mirror() {
    const r = mirrorSettle(ch, model.towns), v = mirrorVillages(ch, model.towns, r.lobes), gatesNew = mirrorGates(r.lobes, gatesFor);
    // the fields of the chunks of 1 km²: what the model ploughed; a natural cell whose share of fields someone has
    // changed since (the brush, the demonstrations of the album) gives that share to every chunk in it
    const over = new Map();
    for (let k = 0; k < ch.count; k++) { if (ch.kind[k] !== 1) continue; const b = byteOf('fields', k); if (b !== Math.round(model.fields[k] * 255)) over.set(k, b / 255); }
    const sig = farmN + '|' + [...over].map(e => e[0] + ':' + Math.round(e[1] * 255)).join(','), farmNew = sig !== farmSig;
    if (farmNew) { farmSig = sig; farmShown = farmWithCells(model.ground, model.farm, over); mirrorFarm(farmShown); farmV++; farmPer = null; yctx.farmList = farmShown.list; }
    if (!r.changed && !v.changed && !gatesNew && !farmNew && mirrorN) return;
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
  let roadSeen = null, roadN = 0, roadMirrored = -1, rsegs = [], rkind = [], rgrid = new Map(); const RC = 2;
  function indexRoads() {
    rsegs = []; rkind = []; rgrid = new Map(); roadSeen = album.roadNet || null; roadN++;
    for (const l of roadSeen?.lines || []) {
      const pts = smoothLine(roadLine(l.pts), .35, 2).map(q => kmOf(q[1], q[0]));       // the line as the road layer draws it
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], id = rsegs.length / 4; rsegs.push(a[0], a[1], b[0], b[1]); rkind.push(l.kind || 0);
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
  // ---- the gates of a town: the directions in which its main streets leave its site — toward where every road
  // crosses its wall (or, in a town without a wall, the ring six tenths of its radius out). At most four, the main
  // roads first, well apart. Where fewer roads come, the town has streets of its own besides, along its lattice. (Stitch with the road work: a road enters the town through a gate and runs to its site along a main
  // street; album.layers.towns.gates(index) tells where.)
  function gatesFor(L) {
    const [mx, my] = midOf(L), ring = a => (L.r >= WALL_FROM ? wallAt(L, a) : .6 * L.r), reach = L.r * .75 + .1, seen = new Set(), found = [];
    const f = (x, y) => Math.hypot(x - mx, y - my) - ring(Math.atan2(y - my, x - mx));
    for (let gy = Math.floor((my - reach) / RC); gy <= Math.floor((my + reach) / RC); gy++) for (let gx = Math.floor((mx - reach) / RC); gx <= Math.floor((mx + reach) / RC); gx++)
      for (const id of rgrid.get(gx * 100000 + gy) || []) {
        if (seen.has(id)) continue; seen.add(id);
        const o = id * 4, fa = f(rsegs[o], rsegs[o + 1]), fb = f(rsegs[o + 2], rsegs[o + 3]); if (!(fa * fb < 0)) continue;
        const t = fa / (fa - fb), x = rsegs[o] + (rsegs[o + 2] - rsegs[o]) * t, y = rsegs[o + 1] + (rsegs[o + 3] - rsegs[o + 1]) * t;
        found.push({ a: Math.atan2(y - L.y, x - L.x), kind: rkind[id] });
      }
    found.sort((p, q) => p.kind - q.kind || p.a - q.a);
    const out = [];
    for (const g of found) { if (out.length >= 4) break; if (out.every(a => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) > .6)) out.push(g.a); }
    // a town has more streets than roads: up to four in a walled town, three in a lesser one — along its lattice,
    // where no road runs already
    for (let k = 0, want = L.r >= WALL_FROM ? 4 : 3; k < 4 && out.length < want; k++) { const c = L.th + .3 + k * 1.5707963; if (out.every(a => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) > .9)) out.push(c); }
    return out;
  }
  // ---- tracks to the villages (town/tracks.js): the ways of a district are worked out when the district is first
  // looked at, the tracks of its settled villages again whenever the model has run
  let trackBase = null, trackKey = '', trackRibbon = null, trackShown = 0;
  const roadSnap = (x, y) => {                                      // the nearest point of a road as it is drawn, within TRACK_SNAP km
    let best = TRACK_SNAP, at = null; const gx = Math.floor(x / RC), gy = Math.floor(y / RC);
    for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) for (const id of rgrid.get(i * 100000 + j) || []) {
      const o = id * 4, ax = rsegs[o], ay = rsegs[o + 1], dx = rsegs[o + 2] - ax, dy = rsegs[o + 3] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t); if (d < best) { best = d; at = [ax + dx * t, ay + dy * t]; }
    }
    return at;
  };
  function tracksReady() {
    const dv = album.division, net = album.roadNet; if (!dv || !net?.legs || !siteList) return false;
    if (net !== roadSeen) indexRoads();
    if (!trackBase || trackBase.net !== net || trackBase.div !== dv.version || trackBase.list !== siteList)
      trackBase = { net, div: dv.version, list: siteList, G: { hgt: dv.data.raster.hgt, riv: dv.data.raster.riv }, onRoad: roadChunks(net.legs), trees: new Map(), drawn: new Map() };
    return true;
  }
  // the tracks of district d: { lines, km, near(x, y) → km to the nearest }. all: also to the places nobody lives on yet
  // (for checking, knob «Места поселений»)
  function tracksOf(d, all = false) {
    const key = d * 2 + (all ? 1 : 0), stamp = `${grownN}|${villSeen}`; let r = trackBase.drawn.get(key); if (r && r.stamp === stamp) return r;
    let tree = trackBase.trees.get(d); if (tree === undefined) { tree = districtTracks(album.division.data, trackBase.G, siteList, d, trackBase.onRoad); trackBase.trees.set(d, tree); }
    const s0 = siteList.first[d], allow = all ? madeAllowed(siteList, d, villSeen) : 0; let made = 0; const open = new Uint8Array(siteList.first[d + 1] - s0);
    if (all) for (let s = s0; s < siteList.first[d + 1]; s++) open[s - s0] = siteList.kind[s] !== SITE.made || made++ < allow ? 1 : 0;
    const lines = trackLines(tree, q => siteR[s0 + q] || (open[q] ? .03 : 0), roadSnap);
    r = { stamp, lines, km: lines.reduce((a, l) => a + l.km, 0), near: trackIndex(lines) }; trackBase.drawn.set(key, r);
    return r;
  }
  // km from a point to the track of a village (only tracks nearer than 200 m are found): for the yards
  const trackAt = (x, y) => {
    if (!trackBase) return 1e9;
    const i = Math.floor((x - KX0) / KKM), j = Math.floor((y - KY0) / KKM); if (i < 0 || j < 0 || i >= KN || j >= KN) return 1e9;
    const d = album.division.data.cells[j * KN + i]; return d >= 0 && siteList.first[d + 1] > siteList.first[d] ? tracksOf(d).near(x, y) : 1e9;
  };
  function layTracks(tx, ty, D, all) {
    const near = new Set();
    for (const t of model.towns) { if (Math.hypot(t.x - tx, t.y - ty) > D + 12) continue; const s = siteOfTown(t); if (s) near.add(s.district); }
    const lines = []; trackShown = 0;
    for (const d of near) for (const l of tracksOf(d, all).lines) { lines.push({ pts: l.pts.map(q => { const g = llOf(q[0], q[1]); return [g.lon, g.lat]; }), width: TRACK.w }); trackShown += l.km; }
    const old = trackRibbon;
    trackRibbon = lines.length ? makeRibbons(album, lines, { colour: TRACK.light, minPx: TRACK.px, lift: .005 }) : null;
    if (old) { album.scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
  }
  const yctx = { cell: ch.cell, land: c => ch.kind[c] === 1, farm: (x, y) => farmAt(x, y), farmList: null, culture: c => Math.round(ch.get('culture', c) * 255),
    farmSquare: (kx, ky) => (farmShown && kx >= 0 && ky >= 0 && kx < KN && ky < KN ? farmShown.km[ky * KN + kx] / 255 : 0),
    patches: new Map(), env: { ...env, road: (x, y) => Math.min(roadAt(x, y), trackAt(x, y)) }, density: 1, S: CELL,
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
  let planKey = '', cacheKey = ''; const cache = new Map(), planEnv = { ...env, road: (x, y) => roadAt(x, y) };   // no block stands on a road
  function rebuild(tx, ty, D, S, ck) {
    if (ck !== cacheKey) { cache.clear(); cacheKey = ck; }           // plans of another cell size or another state are of no use
    const near = lobes.filter(L => Math.hypot(L.x - tx, L.y - ty) < D + L.r).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
    const parts = []; let total = 0;
    for (const L of near) {
      let rows = cache.get(L.k); if (!rows) { rows = planLobe(L, S, planEnv); cache.set(L.k, rows); }
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
      farmChunks: farmShown ? farmShown.list.length : 0, farmKm2: farmShown ? farmShown.list.reduce((a, c) => a + farmShown.km[c] / 255, 0) : 0,
      yards: yard.mesh.visible ? yard.count : 0, yardTriangles: yard.mesh.visible ? yard.real : 0, yardCorners: yard.mesh.visible ? yard.count * ySlots : 0,
      trackKm: trackRibbon?.mesh.visible ? trackShown : 0,
      shapeTexBytes: shapes.data.length, settleTexBytes: settleTex.image.data.length, instanceBytes: (town.cap + yard.cap) * 48, trisPerKind: Object.fromEntries(KINDS.map((k, i) => [k, shapes.tris[i]])) }),
    yardContext: () => yctx,
    model: () => model,
    places: () => places,
    // the lists of places of the districts (villages.js), which of them are settled, and where a settlement stands
    sites: () => siteList, founded: () => founded, siteOfTown,
    // the fields of the chunks of 1 km² as they are drawn: { km (a byte a chunk), list (the chunks that have fields) };
    // farmVersion changes whenever they do; farmAt(x, y) → the share of fields at a point of the flat km plane
    farm: () => farmShown, farmVersion: () => farmV, farmAt,
    // the tracks to the villages of district d as they are drawn: { lines: [{ pts (flat km), place, km }], km }, or null
    // before the roads are laid; trackAt(x, y) → km to the nearest track (within 200 m)
    tracks: (d, all = false) => (tracksReady() && d >= 0 && siteList.first[d + 1] > siteList.first[d] ? tracksOf(d, all) : null), trackAt,
    // what a district holds: { places (in its list at this density), settlements, villages, people, fieldsKm2, tracksKm }
    districtInfo(d) {
      if (!siteList || !(d >= 0) || siteList.first[d + 1] === siteList.first[d]) return null;
      let made = 0, n = 0; const allow = madeAllowed(siteList, d, villSeen), dv = album.division;
      for (let s = siteList.first[d]; s < siteList.first[d + 1]; s++) if (siteList.kind[s] !== SITE.made || made++ < allow) n++;
      if (!farmPer && farmShown && dv) farmPer = farmOfDistricts(farmShown, dv.data.cells, dv.data.count);
      const q = perDistrict.get(d), list = (q?.list || []).map(t => (t.part ? { index: t.index, name: places[t.index].name || '', partOf: t.part.name || 'соседнего города', town: true, people: 0, areaKm2: 0, cls: 0, rank: 0 } : rowOf(t)));
      // the town of the district first, then its villages, the most populous first
      list.sort((a, b) => (b.town ? 1 : 0) - (a.town ? 1 : 0) || (a.partOf ? 1 : 0) - (b.partOf ? 1 : 0) || b.people - a.people || a.index - b.index);
      // the passes on its border (the list is laid by the roads; none until then)
      const passes = passesOfDistrict(album.roadNet?.passes, d, o => album.districts?.name?.(o) || '', llOf);
      return { places: n, settlements: 0, villages: 0, people: 0, fieldsKm2: farmPer ? farmPer[d] : 0, tracksKm: tracksReady() ? tracksOf(d).km : 0, ...q, list, passes };
    },
    // the settlements that stand now, as the marks of the map need them: [{ index, name, cls, rank, capital, town,
    // people, areaKm2, radius, lat, lon }]; version() changes whenever they do
    marks: () => model.towns.map(rowOf), version: () => grownN,
    // where the roads enter the town of place `index`: { x, y (its site, flat km), streets: [radians from the east] —
    // the directions of its main streets from its site }, or null. A road should run in along one of them.
    gates: index => { const t = model.towns.find(x => x.index === index), L = t && lobes.find(o => o.fine === undefined && Math.hypot(o.x - t.x, o.y - t.y) < .05); return L ? { x: L.x, y: L.y, streets: L.gates.slice() } : null; },
    // «чанк города такого-то»: the settlement chunk c of 1 km² is built up by (the number of the chunk: division/km.js),
    // or null; chunksOfTown(index of the place) → the numbers of its chunks
    townOfChunk: c => { const n = own.owner.get(c); return n === undefined ? null : rowOf(model.towns[n]); },
    chunksOfTown: index => { const n = model.towns.findIndex(t => t.index === index), out = []; if (n >= 0) for (const [c, o] of own.owner) if (o === n) out.push(c); return out; },
    update(dt, t, cam) {
      // the land has been divided (or divided anew): a settlement stands at the centre of every district
      const dv = album.division, vk = p.get('villages') ?? 1;
      if (dv && (dv.version !== divSeen || vk !== villSeen)) {
        const t0 = performance.now(), nb = album.data.vectors.places.length;
        // every district gets its list of places (the same every time), and the knob says how many of them are used
        if (dv.version !== divSeen || !siteList) { siteList = districtSites(dv.data, dv.chunkFacts(), dv.sites, { base: nb, at, swamp: (x, y) => { const q = llOf(x, y), k = ch.at(q.lat, q.lon); return k < 0 ? 0 : ch.getNatural('swamp', k); } }); siteOfBase = siteNumbers(siteList); }
        divSeen = dv.version; villSeen = vk;
        const t1 = performance.now();
        // one town to a district: a place of the album that is not the centre of its district is a village of it
        places = townsOfDistricts([...centrePlaces(album.data.vectors.places, dv.data, dv.sites), ...villagePlaces(siteList, dv.sites, { base: nb, density: vk })], (pl, i) => (i < nb ? siteOfBase.get(i) || null : null));
        // where the division says nobody can settle no village is founded; where only a hamlet can stand it stays one
        // (a place on a chunk of water is a place on the shore: the model moves it to dry land)
        const st = dv.settleFacts?.();
        // …and the very ground of a village is asked too (grow.js groundCan): not on a steep slope, not above the trees
        if (st?.can) places = placesAllowed(places, pl => { const [x, y] = kmOf(pl.lat, pl.lon), c = squareOf(x, y); return Math.min(c < 0 || st.why?.[c] === 1 ? 2 : st.can[c], groundCan(at, x, y, treelineAt(pl.lat, pl.lon))); });
        indexRivers(); applyGrowth(false);
        console.log(`[album] settlements: ${places.length} places (${siteList.x.length} in the lists of the districts, ${(t1 - t0).toFixed(0)} ms), ${model.towns.length} founded at growth ${grown}, ${model.towns.filter(t => t.village).length} of them villages, ${model.farm.area.toFixed(0)} km² of fields in ${model.farm.list.length} chunks (${(performance.now() - t1).toFixed(0)} ms, ${segs.length / 5} stretches of river near them)`); }
      spts.visible = !!p.get('sitesShow') && !!siteList;
      if (spts.visible) { if (!sitesDrawn) drawSites(); smat.uniforms.uPx.value = Math.max(5, Math.min(13, 900 / cam.s.h)) * (album.renderer.getPixelRatio?.() || 1); }
      if ((album.roadNet || null) !== roadSeen) indexRoads();        // the roads have been laid (or laid anew): the gates of the towns follow them
      if (ch.version !== seen || farmN !== farmSeen || roadN !== roadMirrored) { seen = ch.version; farmSeen = farmN; roadMirrored = roadN; mirror(); }
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
        u.uS.value = Ss; u.u3D.value = 1; mesh.visible = true; yard.mesh.visible = false; U.set(S, 0, u.uH.value, 0); if (trackRibbon) trackRibbon.mesh.visible = false;
        return;
      }
      const blocks = on && kH > 0 && stand > 0;
      U.set(S, blocks ? stand * stand * (3 - 2 * stand) : 0, u.uH.value, on ? 1 : 0);
      // ---- the tracks to the villages: laid as far as the picture reaches, shown with the roads, gone from high up
      {
        const pxKm = view / Math.max(1, dom.clientHeight), fade = 1 - Math.max(0, Math.min(1, (pxKm - TRACK_FADE[0]) / (TRACK_FADE[1] - TRACK_FADE[0])));
        const want = on && !!p.get('roadsOn') && p.get('roadTracks') !== 0 && p.get('roads') > 0 && fade > 0 && tracksReady();   // (roadTracks: the «Тропы» switch of the part «Дороги и реки», aspects/roads.js)
        if (want) {
          const hb = Math.ceil(h / 8) * 8, tb = Math.min(78, Math.ceil(cam.s.tilt / 6) * 6), all = !!p.get('sitesShow');
          const key = `${grownN}|${villSeen}|${all}|${roadN}|${divSeen}|${Math.round(tx / 8)},${Math.round(ty / 8)}|${hb}|${tb}`;
          if (key !== trackKey) { trackKey = key; layTracks(tx, ty, Math.min(Math.max(25, hb * 2.5), viewReach(hb, tb, cam.cam.fov, dom.width / Math.max(1, dom.height)) + 14), all); }
        }
        if (trackRibbon) {
          trackRibbon.mesh.visible = want;
          if (want) { const crown = typeof album.layers.forest?.top === 'number' ? album.layers.forest.top : 0;
            trackRibbon.setPx(cam, dom); trackRibbon.u.uK.value = p.get('roads'); trackRibbon.u.uLift.value = Math.max(.005, crown * 1.08 + .003); trackRibbon.u.uAlpha.value = TRACK.alpha * fade * fade * (3 - 2 * fade);
            trackRibbon.u.uColour.value.set(flat && p.get('look') !== 'night' ? TRACK.ink : TRACK.light); }
        }
      }
      const yk = p.get('yards') ?? 1, yards = blocks && yk > 0;
      mesh.visible = blocks; yard.mesh.visible = yards; if (!blocks) return;
      u.uS.value = S; u.u3D.value = U.y;
      riverK = p.get('riversOn') === 0 ? 0 : p.get('rivers') ?? 1; riverMin = 1.5 * view / Math.max(1, dom.clientHeight);
      // the blocks are planned as far as the picture reaches (and a little farther: until the camera has moved 8 km
      // or risen or tilted a step, the plan stays)
      const hb = Math.ceil(h / 8) * 8, tb = Math.min(78, Math.ceil(cam.s.tilt / 6) * 6);
      const ck = `${S}|${mirrorN}|${roadN}|${riverK}|${Math.round(Math.max(0, riverMin - .07) * 40)}`, key = `${ck}|${Math.round(tx / 8)},${Math.round(ty / 8)}|${hb}|${tb}`;
      if (key !== planKey) { planKey = key; rebuild(tx, ty, Math.min(Math.max(25, hb * 2.5), viewReach(hb, tb, cam.cam.fov, dom.width / Math.max(1, dom.height)) + 14), S, ck); }
      if (!yards) return;
      // yards stand around the point the camera looks at, as far as they can be told from the ground; as the camera
      // rises they shrink to nothing together with the blocks of the settlements
      if ((album.roadNet || null) !== roadSeen) indexRoads();
      const D = Math.min(72, Math.max(20, 4 * Math.ceil(h * 1.5 / 4))), ax = Math.round(tx / 4) * 4, ay = Math.round(ty / 4) * 4;
      yctx.density = yk; yctx.S = S;
      tracksReady();                                               // a yard keeps off the tracks to the villages too
      const yck = `${ck}|${seen}|${farmV}|${grownN}|${yk}|${roadN}|${divSeen}`, ykey = `${yck}|${ax},${ay}|${D}`;
      if (ykey !== yKey) { yKey = ykey; rebuildYards(ax, ay, D, yck); }
      ymat.uniforms.uYard.value.set(tx, ty, D - 5.7, U.y);
    } };
  return layer;
}
