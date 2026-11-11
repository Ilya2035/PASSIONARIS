// The rules of a settlement, written twice: in JS (the plan of the blocks that stand on the land, the model of
// growth, the tests) and in GLSL (the ground painted by aspSettle). Both must give the same answer for the same cell,
// so everything here is built from numbers that a CPU and a GPU compute alike: bytes, an integer hash, sines.
//
// A chunk with houses draws one PATCH of settlement: a round, slightly wobbly piece of land around the chunk's SITE,
// whose area is the chunk's `built` share of 100 km². Patches of neighbouring chunks join into one large town. Inside
// a patch the blocks stand on a lattice of square cells that is turned by the patch's own angle. The plan is drawn
// larger than life: the cell grows with the camera height, and above 60 km the patch itself grows too (zoomAt).
import { CHUNK_KM, CN, CI0, CJ0 } from '../chunks.js';

export const RMAX = 5.65;        // km: radius of the patch of a chunk that is all built up (π r² ≈ 100 km²)
export const CELL20 = .42;       // km: one block with its street, seen from 20 km
export const RVIS = 9;           // km: the largest radius a patch is ever drawn with (the 3 × 3 chunks around a point reach that far)
// Settlements are drawn larger than life, the more the higher the camera: up to 60 km a patch has the size its chunk
// gives it, above that its radius grows, so a village is still a dot at 200 km and a city a clear mark at 500 km.
export const zoomAt = hKm => Math.max(1, (hKm / 60) ** .45);
export const CULTURES = { med: 1, atl: 2 };                           // manners of building (chunk channel `culture`)
// the cell of the lattice at a camera height, with the «Размер домов» knob
export const cellSize = (hKm, k = 1) => Math.max(.1, CELL20 * (hKm / 20) ** .75 * k);

// ---- steps of growth by the radius of the settlement, km
export const STAGES = [
  { id: 'hamlet', title: 'хутор', r: 0 }, { id: 'village', title: 'деревня', r: .45 }, { id: 'bigvillage', title: 'село', r: .9 },
  { id: 'smalltown', title: 'городок', r: 1.6 }, { id: 'town', title: 'город', r: 3.2 },
];
export const stageOf = r => { let s = 0; for (let i = 0; i < STAGES.length; i++) if (r >= STAGES[i].r) s = i; return s; };

// ---- numbers shared with the shader
export const wob = (x, y) => Math.sin(x * 1.7 + 1.3 * Math.sin(y * 1.1));
// a random number 0..1 of a lattice cell: integer arithmetic only, the same bits in JS and in GLSL
export function cellHash(i, j, k, salt) {
  let h = (Math.imul(i + 4096, 0x27d4eb2d) ^ Math.imul(j + 4096, 0x165667b1) ^ Math.imul(k * 16 + salt, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}
// share of a chunk under houses (0..1) → the byte that holds the radius of its patch
export const radiusByte = built => { const b = Math.round(Math.sqrt(Math.max(0, Math.min(1, built))) * 255); return built > 0 ? Math.max(1, b) : 0; };
// where in its chunk a point lies, as the two bytes of a site
export function siteBytes(x, y) {
  const fx = x / CHUNK_KM - Math.floor(x / CHUNK_KM), fy = y / CHUNK_KM - Math.floor(y / CHUNK_KM);
  return [Math.min(255, Math.floor(fx * 256)), Math.min(255, Math.floor(fy * 256))];
}
// the patch of chunk k from the four bytes kept for it (state.js): site x, site y, radius, manner
export function lobeOf(k, bx, by, rb, cul) {
  const cx = k % CN, cy = (k / CN) | 0, r = rb / 255 * RMAX;
  return { k, cx, cy, bx, by, rb, cul, r, re: r, amp: Math.min(.9, .3 * r), th: ((bx * 37 + by * 91) % 256) / 256 * Math.PI / 2,
    x: (CI0 + cx + (bx + .5) / 256) * CHUNK_KM, y: (CJ0 + cy + (by + .5) / 256) * CHUNK_KM };
}
// the radius a patch is drawn with at a camera height: L.r is what the chunk holds, L.re what is drawn
export function zoomLobe(L, zoom) { L.re = Math.min(L.r * zoom, RVIS); L.amp = Math.min(.9, .3 * L.re); return L; }
// how deep a point lies inside a patch, km (negative outside)
export const depthAt = (L, x, y) => L.re - Math.hypot(x - L.x, y - L.y) + L.amp * wob(x, y);

// What stands in cell (i, j) of patch L when the lattice cell is S km: null, or
//   cls   1 block around a court · 2 solid block · 3 separate houses · 4 open square · 5 building site
//   hx hy half-size of the footprint, ox oy its shift inside the cell (cell units), rot its turn, h1..h4 random numbers
export function cellRule(i, j, L, S) {
  const centre = i === 0 && j === 0, atl = L.cul === CULTURES.atl, R = L.re;   // R: the radius drawn; L.r: the size that decides what is built
  if (R < .6 * S) {                                                // a patch smaller than a cell is a single mark
    if (!centre) return null;
    const hs = Math.max(.12, Math.min(.45, .9 * R / S));
    return { cls: atl || L.r < .45 ? 3 : 2, hx: hs, hy: hs, ox: 0, oy: 0, rot: 0, m: R, h1: .5, h2: .5, h3: .5, h4: .5, mark: true };
  }
  const cs = Math.cos(L.th), sn = Math.sin(L.th);
  const m = R - Math.hypot(i, j) * S + L.amp * wob(L.x + (cs * i - sn * j) * S, L.y + (sn * i + cs * j) * S) + (L.r < .45 ? .12 : 0);   // a hamlet keeps its few farmsteads
  if (m <= -.05) {                                                  // just outside: the next houses are being built
    if (m > -Math.min(.9 * S, .6) && cellHash(i, j, L.k, 5) < .22) return { cls: 5, hx: .36, hy: .36, ox: 0, oy: 0, rot: 0, m, h1: 0, h2: 0, h3: cellHash(i, j, L.k, 3), h4: 0 };
    return null;
  }
  const h1 = cellHash(i, j, L.k, 1), h2 = cellHash(i, j, L.k, 2), h3 = cellHash(i, j, L.k, 3), h4 = cellHash(i, j, L.k, 4), o = { m, h1, h2, h3, h4 };
  // from high up a cell stands for many houses: single houses grow into groups that fill their cell
  const coarse = Math.max(0, Math.min(1, (S - .7) / .6)), grow = (v, to = .36) => v + (to - v) * coarse;
  if (atl) {                                                        // Atlantic: loose farmsteads, no streets
    const dense = m > .6;
    if (!centre && h1 > (dense ? .72 : .5)) return null;
    const big = h2 < (dense ? .5 : .3);
    return { cls: 3, hx: grow(big ? .26 + .06 * h3 : .19 + .06 * h3), hy: grow(big ? .22 + .05 * h3 : .10 + .03 * h3), ox: (h3 - .5) * .2 * (1 - coarse), oy: ((h4 * 7) % 1 - .5) * .2 * (1 - coarse), rot: h4 * 6.2831853, big: big || coarse > .5, group: coarse > .5, ...o };
  }
  if (centre && L.r >= 1.6 && S * 3 <= R) return { cls: 4, hx: .5, hy: .5, ox: 0, oy: 0, rot: 0, ...o };
  // three belts from the edge inward: houses with gardens, rows of houses, blocks around courts
  const rimW = .25 + .12 * R, hamlet = L.r < .45, core = !hamlet && m > rimW + .35 + .2 * R, mid = !hamlet && m > rimW;
  if (!centre && h1 > (core ? .94 : mid ? .86 : hamlet ? .9 : .7)) return null;
  if (core) return { cls: h2 > .35 ? 1 : 2, hx: .41 + .04 * h3, hy: .41 + .04 * h4, ox: (h4 - .5) * .04, oy: (h3 - .5) * .04, rot: 0, core, ...o };
  if (mid) return { cls: 2, hx: grow(.33 + .09 * h3, .43), hy: grow(.33 + .09 * h4, .43), ox: (h4 - .5) * .1 * (1 - coarse), oy: (h3 - .5) * .1 * (1 - coarse), rot: 0, ...o };
  const big = h2 < .35 || hamlet;                                   // the rim: a farmstead or a house with its garden
  return { cls: 3, hx: grow(big ? .32 + .06 * h3 : .2 + .05 * h3), hy: grow(big ? .27 + .05 * h4 : .12 + .04 * h4), ox: (h3 - .5) * .24 * (1 - coarse), oy: (h4 - .5) * .24 * (1 - coarse), rot: h4 > .5 ? 1.5707963 : 0, big: big || coarse > .5, group: coarse > .5 && !hamlet, ...o };
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
#define SET_RVIS ${RVIS.toFixed(4)}
#define SET_CN ${CN}
float setWob(vec2 pk) { return sin(pk.x * 1.7 + 1.3 * sin(pk.y * 1.1)); }
float setHash(ivec2 id, int k, int salt) {
  uint h = uint(id.x + 4096) * 0x27d4eb2du ^ uint(id.y + 4096) * 0x165667b1u ^ uint(k * 16 + salt) * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float(h >> 8) / 16777216.;
}
// what stands in lattice cell id of a patch (twin of cellRule() in town/rules.js): returns the class 0..5.
// r is the radius the patch is drawn with, rs the radius its chunk holds (the size that decides what is built),
// cs sn the cosine and sine of the turn of its lattice
float setCell(ivec2 id, vec2 site, float r, float rs, float cs, float sn, float cul, int k, float S, out vec2 hs, out vec2 off, out float rot, out vec4 rnd) {
  hs = vec2(0.); off = vec2(0.); rot = 0.; rnd = vec4(.5);
  bool centre = id.x == 0 && id.y == 0, atl = cul > 1.5;
  if (r < .6 * S) {
    if (!centre) return 0.;
    hs = vec2(clamp(.9 * r / S, .12, .45));
    return atl || rs < .45 ? 3. : 2.;
  }
  vec2 ij = vec2(id);
  float m = r - length(ij) * S + min(.9, .3 * r) * setWob(site + vec2(cs * ij.x - sn * ij.y, sn * ij.x + cs * ij.y) * S) + (rs < .45 ? .12 : 0.);
  if (m <= -.05) {
    if (m > -min(.9 * S, .6) && setHash(id, k, 5) < .22) { hs = vec2(.36); rnd.z = setHash(id, k, 3); return 5.; }
    return 0.;
  }
  rnd = vec4(setHash(id, k, 1), setHash(id, k, 2), setHash(id, k, 3), setHash(id, k, 4));
  float coarse = clamp((S - .7) / .6, 0., 1.);
  if (atl) {
    bool dense = m > .6;
    if (!centre && rnd.x > (dense ? .72 : .5)) return 0.;
    bool big = rnd.y < (dense ? .5 : .3);
    hs = mix(big ? vec2(.26 + .06 * rnd.z, .22 + .05 * rnd.z) : vec2(.19 + .06 * rnd.z, .10 + .03 * rnd.z), vec2(.36), coarse);
    off = vec2(rnd.z - .5, fract(rnd.w * 7.) - .5) * .2 * (1. - coarse); rot = rnd.w * 6.2831853;
    return 3.;
  }
  if (centre && rs >= 1.6 && S * 3. <= r) { hs = vec2(.5); return 4.; }
  float rimW = .25 + .12 * r; bool hamlet = rs < .45, core = !hamlet && m > rimW + .35 + .2 * r, mid = !hamlet && m > rimW;
  if (!centre && rnd.x > (core ? .94 : mid ? .86 : hamlet ? .9 : .7)) return 0.;
  if (core) { hs = vec2(.41 + .04 * rnd.z, .41 + .04 * rnd.w); off = vec2(rnd.w - .5, rnd.z - .5) * .04; return rnd.y > .35 ? 1. : 2.; }
  if (mid) { hs = mix(vec2(.33 + .09 * rnd.z, .33 + .09 * rnd.w), vec2(.43), coarse); off = vec2(rnd.w - .5, rnd.z - .5) * .1 * (1. - coarse); return 2.; }
  bool big = rnd.y < .35 || hamlet;
  hs = mix(big ? vec2(.32 + .06 * rnd.z, .27 + .05 * rnd.w) : vec2(.2 + .05 * rnd.z, .12 + .04 * rnd.w), vec2(.36), coarse);
  off = vec2(rnd.z - .5, rnd.w - .5) * .24 * (1. - coarse); rot = rnd.w > .5 ? 1.5707963 : 0.;
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
