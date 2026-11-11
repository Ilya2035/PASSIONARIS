// The rules of a settlement, written twice: in JS (the plan of the blocks that stand on the land, the model of
// growth, the tests) and in GLSL (the ground painted by aspSettle). Both must give the same answer for the same cell,
// so everything here is built from numbers that a CPU and a GPU compute alike: bytes, an integer hash, sines.
//
// Everything is drawn at its real size, one to one: a block with its street is 85 m, a hamlet is a hundred metres
// across, a great city three kilometres. A settlement is a PATCH: a round, slightly wobbly piece of land around its
// SITE. Inside it the blocks stand on a lattice of cells that is turned by the patch's own angle and gently bent, so
// streets are never quite straight. The plan does not depend on the camera: what stands in a cell from 20 km stands
// there from 200 km.
//
// The patches live in a grid of the settlement work's own (state.js): squares of 10 km, one patch at most in each.
// It is only a way to find the patches near a point; chunks have natural outlines and are not these squares.
import { CHUNK_KM, CN, CI0, CJ0 } from '../chunks.js';

export const GK = CHUNK_KM, GN = CN, GX0 = CI0 * CHUNK_KM, GY0 = CJ0 * CHUNK_KM;   // the grid of patches: GN × GN squares of GK km from (GX0, GY0)
export const RMAX = 6;           // km: the largest radius a patch can have (a chunk built up from edge to edge)
export const CELL = .085;        // km: one block with its street, as in life
export const BEND = .35;         // how far the lattice is bent, in cells
export const CULTURES = { med: 1, atl: 2 };                           // manners of building (chunk channel `culture`)
// the cell of the lattice; k is the «Размер домов» knob (1 = real size). The camera height changes nothing.
export const cellSize = (hKm, k = 1) => CELL * Math.max(.2, k);

// ---- steps of growth by the radius of the settlement, km
export const STAGES = [
  { id: 'hamlet', title: 'хутор', r: 0 }, { id: 'village', title: 'деревня', r: .1 }, { id: 'bigvillage', title: 'село', r: .22 },
  { id: 'smalltown', title: 'городок', r: .4 }, { id: 'town', title: 'город', r: .7 },
];
export const stageOf = r => { let s = 0; for (let i = 0; i < STAGES.length; i++) if (r >= STAGES[i].r) s = i; return s; };
// how far the fields reach beyond the last houses, km
export const fieldsBeyond = r => .5 + 2.5 * r;

// ---- numbers shared with the shader
export const wob = (x, y) => Math.sin(x * 9 + 1.3 * Math.sin(y * 7));
// a random number 0..1 of a lattice cell: integer arithmetic only, the same bits in JS and in GLSL
export function cellHash(i, j, k, salt) {
  let h = (Math.imul(i + 4096, 0x27d4eb2d) ^ Math.imul(j + 4096, 0x165667b1) ^ Math.imul(k * 16 + salt, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}
// a radius in km ↔ the byte that holds it (finer steps for small settlements)
export const radiusByte = r => (r > 0 ? Math.max(1, Math.round(Math.sqrt(Math.min(r, RMAX) / RMAX) * 255)) : 0);
export const radiusOf = b => (b / 255) ** 2 * RMAX;
// the radius of the patch of a chunk from its `built` share and its area
export const radiusOfShare = (built, areaKm2) => Math.min(RMAX, Math.sqrt(Math.max(0, built) * areaKm2 / Math.PI));
// the square of the grid a point lies in, and where in it, as two bytes
export const gridOf = (x, y) => { const gx = Math.floor((x - GX0) / GK), gy = Math.floor((y - GY0) / GK); return gx >= 0 && gy >= 0 && gx < GN && gy < GN ? gy * GN + gx : -1; };
export function siteBytes(x, y) {
  const fx = (x - GX0) / GK - Math.floor((x - GX0) / GK), fy = (y - GY0) / GK - Math.floor((y - GY0) / GK);
  return [Math.min(255, Math.floor(fx * 256)), Math.min(255, Math.floor(fy * 256))];
}
// the patch of square g of the grid from the four bytes kept for it (state.js): site x, site y, radius, manner
export function lobeOf(g, bx, by, rb, cul) {
  const gx = g % GN, gy = (g / GN) | 0, r = radiusOf(rb);
  return { k: g, gx, gy, bx, by, rb, cul, r, re: r, amp: Math.min(.25, .3 * r), th: ((bx * 37 + by * 91) % 256) / 256 * Math.PI / 2,
    x: GX0 + (gx + (bx + .5) / 256) * GK, y: GY0 + (gy + (by + .5) / 256) * GK, rivals: [] };
}
// how deep a point lies inside a patch, km (negative outside)
export const depthAt = (L, x, y) => L.re - Math.hypot(x - L.x, y - L.y) + L.amp * wob(x, y);
// The lattice is bent: a point q of the straight lattice (cell units) lies at bend(q) of the bent one, in which the
// cells are counted. unbend() goes back: where in the straight lattice the middle of a bent cell lies.
export const bend = (L, qx, qy) => [qx + BEND * Math.sin(qy * .55 + L.th * 7), qy + BEND * Math.sin(qx * .47 + L.th * 13)];
export function unbend(L, tx, ty) {
  let qx = tx, qy = ty;
  for (let n = 0; n < 6; n++) { const nx = tx - BEND * Math.sin(qy * .55 + L.th * 7), ny = ty - BEND * Math.sin(qx * .47 + L.th * 13); qx = nx; qy = ny; }
  return [qx, qy];
}
// how much the bent lattice is turned at a point of the straight one, radians
export const bendTurn = (L, qx, qy) => (BEND * .55 * Math.cos(qy * .55 + L.th * 7) - BEND * .47 * Math.cos(qx * .47 + L.th * 13)) / 2;

// What stands in cell (i, j) of patch L when the lattice cell is S km: null, or
//   cls   1 block around a court · 2 solid block · 3 separate houses · 4 open square · 5 building site
//   hx hy half-size of the footprint, ox oy its shift inside the cell (cell units), rot its turn, h1..h4 random numbers
export function cellRule(i, j, L, S) {
  const centre = i === 0 && j === 0, atl = L.cul === CULTURES.atl, R = L.re, hamlet = L.r < STAGES[1].r;
  if (R < .6 * S) {                                                 // a patch smaller than a cell is a single house
    if (!centre) return null;
    const hs = Math.max(.12, Math.min(.45, .9 * R / S));
    return { cls: atl || hamlet ? 3 : 2, hx: hs, hy: hs, ox: 0, oy: 0, rot: 0, m: R, h1: .5, h2: .5, h3: .5, h4: .5, mark: true };
  }
  const cs = Math.cos(L.th), sn = Math.sin(L.th);
  const m = R - Math.hypot(i, j) * S + L.amp * wob(L.x + (cs * i - sn * j) * S, L.y + (sn * i + cs * j) * S) + (hamlet ? .03 : 0);   // a hamlet keeps its few farmsteads
  if (m <= -.012) {                                                 // just outside: the next houses are being built
    if (m > -Math.min(1.5 * S, .15) && cellHash(i, j, L.k, 5) < .2) return { cls: 5, hx: .36, hy: .36, ox: 0, oy: 0, rot: 0, m, h1: 0, h2: 0, h3: cellHash(i, j, L.k, 3), h4: 0 };
    return null;
  }
  const h1 = cellHash(i, j, L.k, 1), h2 = cellHash(i, j, L.k, 2), h3 = cellHash(i, j, L.k, 3), h4 = cellHash(i, j, L.k, 4), o = { m, h1, h2, h3, h4 };
  if (atl) {                                                        // Atlantic: loose farmsteads, no streets
    const dense = m > .15;
    if (!centre && h1 > (dense ? .72 : .5)) return null;
    const big = h2 < (dense ? .5 : .3);
    return { cls: 3, hx: big ? .26 + .06 * h3 : .19 + .06 * h3, hy: big ? .22 + .05 * h3 : .10 + .03 * h3, ox: (h3 - .5) * .2, oy: ((h4 * 7) % 1 - .5) * .2, rot: h4 * 6.2831853, big, ...o };
  }
  if (centre && L.r >= STAGES[3].r && S * 3 <= R) return { cls: 4, hx: .5, hy: .5, ox: 0, oy: 0, rot: 0, ...o };
  // three belts from the edge inward: houses with gardens, rows of houses, blocks around courts
  const rimW = .05 + .12 * R, core = !hamlet && m > rimW + .07 + .2 * R, mid = !hamlet && m > rimW, turn = (h4 - .5) * .14;
  if (!centre && h1 > (core ? .94 : mid ? .86 : hamlet ? .9 : .7)) return null;
  if (core) return { cls: h2 > .35 ? 1 : 2, hx: .39 + .05 * h3, hy: .39 + .05 * h4, ox: (h4 - .5) * .04, oy: (h3 - .5) * .04, rot: turn, core, ...o };
  if (mid) return { cls: 2, hx: .31 + .1 * h3, hy: .31 + .1 * h4, ox: (h4 - .5) * .1, oy: (h3 - .5) * .1, rot: turn, ...o };
  const big = h2 < .35 || hamlet;                                   // the rim: a farmstead or a house with its garden
  return { cls: 3, hx: big ? .32 + .06 * h3 : .2 + .05 * h3, hy: big ? .27 + .05 * h4 : .12 + .04 * h4, ox: (h3 - .5) * .24, oy: (h4 - .5) * .24, rot: (h4 > .5 ? 1.5707963 : 0) + turn, big, ...o };
}

// which manner of building a land has before anyone decides otherwise: the wet Atlantic north and west build loose
// stone farmsteads under dark roofs, the rest dense tiled blocks around courts
export function cultureAt(lat, lon) {
  const atl = (lat > 41.9 && lon < -1.4) || (lat > 43.0 && lon < .2) || (lat > 40.6 && lon < -7.6);
  return atl ? CULTURES.atl : CULTURES.med;
}

// ---- the same in GLSL
export const RULES_GLSL = /* glsl */`
#define SET_RMAX ${RMAX.toFixed(4)}
#define SET_GN ${GN}
#define SET_GK ${GK.toFixed(1)}
#define SET_G0 vec2(${GX0.toFixed(1)}, ${GY0.toFixed(1)})
#define SET_BEND ${BEND.toFixed(3)}
float setWob(vec2 pk) { return sin(pk.x * 9. + 1.3 * sin(pk.y * 7.)); }
float setHash(ivec2 id, int k, int salt) {
  uint h = uint(id.x + 4096) * 0x27d4eb2du ^ uint(id.y + 4096) * 0x165667b1u ^ uint(k * 16 + salt) * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float(h >> 8) / 16777216.;
}
// the lattice of a patch is bent (twin of bend() in town/rules.js): q in cells of the straight lattice → the bent one
vec2 setBend(vec2 q, float th) { return q + SET_BEND * vec2(sin(q.y * .55 + th * 7.), sin(q.x * .47 + th * 13.)); }
// What stands in lattice cell id of a patch (twin of cellRule() in town/rules.js): returns the class 0..5.
// r is the radius of the patch, cs sn the cosine and sine of the turn of its lattice.
float setCell(ivec2 id, vec2 site, float r, float cs, float sn, float cul, int k, float S, out vec2 hs, out vec2 off, out float rot, out vec4 rnd) {
  hs = vec2(0.); off = vec2(0.); rot = 0.; rnd = vec4(.5);
  bool centre = id.x == 0 && id.y == 0, atl = cul > 1.5, hamlet = r < ${STAGES[1].r.toFixed(3)};
  if (r < .6 * S) {
    if (!centre) return 0.;
    hs = vec2(clamp(.9 * r / S, .12, .45));
    return atl || hamlet ? 3. : 2.;
  }
  vec2 ij = vec2(id);
  float m = r - length(ij) * S + min(.25, .3 * r) * setWob(site + vec2(cs * ij.x - sn * ij.y, sn * ij.x + cs * ij.y) * S) + (hamlet ? .03 : 0.);
  if (m <= -.012) {
    if (m > -min(1.5 * S, .15) && setHash(id, k, 5) < .2) { hs = vec2(.36); rnd.z = setHash(id, k, 3); return 5.; }
    return 0.;
  }
  rnd = vec4(setHash(id, k, 1), setHash(id, k, 2), setHash(id, k, 3), setHash(id, k, 4));
  if (atl) {
    bool dense = m > .15;
    if (!centre && rnd.x > (dense ? .72 : .5)) return 0.;
    bool big = rnd.y < (dense ? .5 : .3);
    hs = big ? vec2(.26 + .06 * rnd.z, .22 + .05 * rnd.z) : vec2(.19 + .06 * rnd.z, .10 + .03 * rnd.z);
    off = vec2(rnd.z - .5, fract(rnd.w * 7.) - .5) * .2; rot = rnd.w * 6.2831853;
    return 3.;
  }
  if (centre && r >= ${STAGES[3].r.toFixed(3)} && S * 3. <= r) { hs = vec2(.5); return 4.; }
  float rimW = .05 + .12 * r, turn = (rnd.w - .5) * .14; bool core = !hamlet && m > rimW + .07 + .2 * r, mid = !hamlet && m > rimW;
  if (!centre && rnd.x > (core ? .94 : mid ? .86 : hamlet ? .9 : .7)) return 0.;
  if (core) { hs = vec2(.39 + .05 * rnd.z, .39 + .05 * rnd.w); off = vec2(rnd.w - .5, rnd.z - .5) * .04; rot = turn; return rnd.y > .35 ? 1. : 2.; }
  if (mid) { hs = vec2(.31 + .1 * rnd.z, .31 + .1 * rnd.w); off = vec2(rnd.w - .5, rnd.z - .5) * .1; rot = turn; return 2.; }
  bool big = rnd.y < .35 || hamlet;
  hs = big ? vec2(.32 + .06 * rnd.z, .27 + .05 * rnd.w) : vec2(.2 + .05 * rnd.z, .12 + .04 * rnd.w);
  off = vec2(rnd.z - .5, rnd.w - .5) * .24; rot = (rnd.w > .5 ? 1.5707963 : 0.) + turn;
  return 3.;
}
`;

// ---- the colours of buildings, one list for the blocks and for the roofs painted on the ground. As seen on screen,
// before light. m: 0 pitched roof · 1 flat roof · 2 wall · 3 dressed stone · 4 timber · 5 cloth · 6 hay and sand ·
// 7 dark opening · 8 yard wall · 9 boat. atl: 0 Mediterranean (tile, whitewash) .. 1 Atlantic (slate, thatch, granite)
export const MAT = { roof: 0, flat: 1, wall: 2, stone: 3, timber: 4, cloth: 5, hay: 6, dark: 7, fence: 8, hull: 9 };
export const PALETTE_GLSL = /* glsl */`
vec3 settleMat(int m, float atl, float t) {
  if (m == 0) {
    vec3 tile = mix(vec3(.77, .51, .36), vec3(.65, .45, .34), smoothstep(.1, .7, t));        // new tile .. weathered
    tile = mix(tile, vec3(.79, .63, .47), step(.8, t));                                      // bleached by the sun
    vec3 dark = mix(vec3(.37, .38, .39), vec3(.49, .44, .33), step(.5, t)) * (.88 + .3 * fract(t * 3.));   // slate, thatch
    return mix(tile, dark, atl);
  }
  if (m == 1) return mix(mix(vec3(.72, .64, .52), vec3(.64, .57, .47), t), vec3(.47, .47, .43), atl);
  if (m == 2) return mix(vec3(.85, .81, .73) * (.94 + .08 * t), vec3(.60, .58, .54) * (.9 + .16 * t), atl);
  if (m == 3) return mix(vec3(.73, .67, .56), vec3(.52, .51, .49), atl) * (.94 + .1 * t);
  if (m == 4) return vec3(.47, .38, .28) * (.85 + .3 * t);
  if (m == 5) return t < .34 ? vec3(.80, .73, .56) : t < .67 ? vec3(.63, .38, .30) : vec3(.52, .56, .58);
  if (m == 6) return vec3(.74, .65, .42);
  if (m == 7) return vec3(.22, .19, .17);
  if (m == 8) return mix(vec3(.67, .61, .51), vec3(.46, .46, .43), atl);
  return vec3(.38, .30, .23);
}
`;
