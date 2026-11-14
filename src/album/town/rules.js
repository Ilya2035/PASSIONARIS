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
import { KN, KKM, KX0, KY0 } from '../division/km.js';

export const GK = CHUNK_KM, GN = CN, GX0 = CI0 * CHUNK_KM, GY0 = CJ0 * CHUNK_KM;   // the grid of patches: GN × GN squares of GK km from (GX0, GY0)
// The villages between the centres of districts (villages.js) lie in a finer grid of their own, laid from the same
// corner: VN × VN squares of VK km, one village at most in each. A village and its fields never reach farther than
// one square, so a point of the ground looks at the 3 × 3 squares around it, as in the coarse grid.
export const VK = 2.5, VN = GN * GK / VK;
// km: the largest radius of a village. A village is a village by its people too — under a thousand (TOWN_R below is
// .2523 km): the owner, 13.11.2026: «в районе один город, деревень может быть много». The town of a district that has
// to lie in the fine grid (grow.js: a second town in one natural cell) may be as large as FINE_RMAX.
export const VILLAGE_RMAX = .25, FINE_RMAX = .39;
// The one texture of the settlement work (state.js) holds three things. Its first KN rows are the chunks of 1 km²
// (division/km.js), a texel a chunk: what the chunk holds — its fields. Below them lie the fine grid of villages and,
// beside it, the coarse grid of towns.
export const TEX_W = KN, TEX_H = KN + VN;
export const FINE_AT = [0, KN], COARSE_AT = [VN, KN];              // the corner of each grid in the texture: column, row
// Two more blocks of the coarse grid lie beside it, a texel a square each: MORE — how far the middle of the patch lies
// from its site (two bytes); GATES — where the main streets of the town leave it (four bytes, a direction each).
export const MORE_AT = [VN + GN, KN], GATES_AT = [VN + 2 * GN, KN];
// How soft the step from the fields of one chunk to the next is: the weight of a chunk falls as exp(−FARM_SOFT · d²)
// with the distance d to its seed, km. At 4 the fields of a chunk thin out over some five hundred metres around its
// side — two or three furlongs, so the edge of the fields is an edge of furlongs and no straight line.
export const FARM_SOFT = 4;
export const FARM_WARP = .6;      // km: how far, at most, a point is moved by a smooth noise before its chunk is looked for (half of it each way)
export const FARM_UNEVEN = .5;    // how much the share of ploughed land wanders from place to place inside a chunk (a quarter each way)
export const FARM_SHARP = 2;      // fields keep together: the share of furlongs ploughed runs from none to all twice as fast as the share of the chunk
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
// ---- classes of settlements, for the mark on the map (the owner's table of 12.11.2026). The people decide; the area
// only raises the class of a place that sprawls. Later the class will come from what stands in the settlement.
export const DENSITY = 5000;     // people on a km² of built-up land
export const CLASSES = [
  { id: 'village', title: 'деревня', people: 0, area: 0, mark: 'circle' },
  { id: 'smalltown', title: 'малый городок', people: 1000, area: 10, mark: 'triangle' },
  { id: 'midtown', title: 'средний город', people: 20000, area: 50, mark: 'diamond' },
  { id: 'city', title: 'город', people: 60000, area: 300, mark: 'square' },
  { id: 'megapolis', title: 'мегаполис', people: 1e6, area: 1500, mark: 'pentagon' },
];
export const peopleOf = r => Math.round(Math.PI * r * r * DENSITY);
// the radius at which a settlement stops being a village by its people (CLASSES[1]): from here on it has a mark on
// the map from afar; a village has none (the owner: «деревня до 1000 человек не показывается на карте»)
export const TOWN_R = Math.sqrt(1000 / (Math.PI * DENSITY));
export const classOf = (people, areaKm2 = 0) => { let c = 0; for (let i = 0; i < CLASSES.length; i++) if (people >= CLASSES[i].people || areaKm2 >= CLASSES[i].area) c = i; return c; };
// ---- how long a settlement stays marked as the camera rises (the owner, 13.11.2026: «совсем далеко — ничего; около
// 500 км — точки самых крупных городов и столиц; 200 км — города поменьше; 100 км — ещё меньше; ближе — отметки разной
// формы у города и деревни. Деревни пропадают первыми, столицы видны дольше всех»). `to`: the greatest camera height,
// km, from which a settlement of that rank is still marked; `name`: the greatest height its name is written from.
export const RANKS = [
  { id: 'village', title: 'деревня', to: 45, name: 45 },
  { id: 'town', title: 'город района', to: 110, name: 75 },
  { id: 'bigtown', title: 'город', to: 230, name: 110 },
  { id: 'province', title: 'главный город провинции', to: 560, name: 150 },
  { id: 'land', title: 'главный город земли', to: 760, name: 180 },
  { id: 'region', title: 'главный город региона', to: 900, name: 180 },
];
// t: { town (the town of its district; a village is not), cls (CLASSES), capital ('province', 'land', 'region' or nothing) }.
// The greatest cities (a middling town and more) stay as long as the chief towns of provinces.
export const rankOf = t => (t.capital === 'region' ? 5 : t.capital === 'land' ? 4 : t.capital === 'province' || (t.town && t.cls >= 2) ? 3 : !t.town ? 0 : t.cls >= 1 ? 2 : 1);
// Names (the owner: «на 20 км их не показывать — там смотрят на сам город; показывать около 50 км, дальше убирать»):
// they come in between these two heights, km, and go at the height of their rank (RANKS[].name)
export const NAME_FROM = [25, 32];
export const SHAPES_TO = 85;     // km: below this height a mark is a shape that tells the class; above it, a dot that tells the rank
// ---- The passes of the mountains (the owner, second step of the third wave: «горы, перевалы, дороги в горах»). The
// list is laid by the roads: album.roadNet.passes, [{ x, y (flat km), h (m), name, kind (0 main road, 1 lesser, 2 track),
// a, b (the districts on either side), rank }]. A pass is marked by the height of the camera as a settlement is:
// `to` — the greatest height, km, it is still marked from; `name` — the greatest height its name is written from;
// `order` — whose turn it is to take the room on the screen, in the ranks of the settlements (RANKS): a great pass
// goes before the town of a district, a pass of a main road before a village, the rest after the villages.
export const PASS_RANKS = [
  { id: 'great', title: 'большой исторический перевал', to: 230, name: 110, order: 2.5 },
  { id: 'main', title: 'перевал главной дороги', to: 110, name: 75, order: .5 },
  { id: 'lesser', title: 'перевал', to: 45, name: 45, order: -.5 },
];
export const PASS_ROAD = ['главная дорога', 'малая дорога', 'тропа'];
export const passRank = p => Math.max(0, Math.min(PASS_RANKS.length - 1, p.rank | 0));
// what is written beside the mark of a pass: its name and its height in metres («Сомпорт, 1632 м»); a pass without a
// name carries its height alone
export const passText = p => { const m = `${Math.round(p.h)} м`; return p.name ? `${p.name}, ${m}` : m; };
// The passes on the border of district d, for its panel: the greater first, then the higher. passes: the list of the
// roads (or nothing); nameOf(district) → its name; ll(x, y) → { lat, lon } of a point of the flat km plane
// → [{ name, h, kind, rank, text, to (the name of the district beyond the pass), lat, lon }]
export function passesOfDistrict(passes, d, nameOf = () => '', ll = null) {
  return (Array.isArray(passes) ? passes : []).filter(q => q && (q.a === d || q.b === d) && Number.isFinite(q.x) && Number.isFinite(q.y))
    .map(q => ({ name: q.name || '', h: Math.round(q.h), kind: Math.max(0, Math.min(2, q.kind | 0)), rank: passRank(q), text: passText(q), to: nameOf(q.a === d ? q.b : q.a) || '', ...(ll ? ll(q.x, q.y) : {}) }))
    .sort((a, b) => a.rank - b.rank || b.h - a.h || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
// ---- a town grows from its site toward the water (the owner, 13.11.2026: «город должен стоять логично, ближе к морю»;
// the site itself is the district's and is not moved). The SITE of a patch is the knot of its roads and its market
// square; the MIDDLE of the patch — of its round outline, its belts and its wall — lies off the site by a SHIFT, kept
// as two bytes beside the patch (state.js). Twin of SET_SHIFT in the shader.
export const SHIFT_MAX = 1.5;    // km: the farthest the middle of a patch lies from its site
export const SHIFT_SHARE = .5;   // …and no farther than this share of its radius: the site stays among the houses
export const SHIFT_FROM = .15;   // km: a smaller settlement stands where it is
export const SHORE_AT = .82;     // the middle of a town on the shore lies this share of its radius inland
export const shiftByte = s => Math.max(1, Math.min(255, 128 + Math.round(s / SHIFT_MAX * 127)));
export const shiftOf = b => (b - 128) / 127 * SHIFT_MAX;
// ---- the wall, the gates and the main streets of a town (the owner: «внутри — улицы, построена стена или замок»).
// A town of a thousand people and more has MAIN STREETS: from its site straight out along its roads, to where each
// leaves the town. A town from WALL_FROM km has a WALL: a ring around the middle of the patch, a little out of round,
// with a GATE where every main street crosses it; the suburbs lie outside. A smaller town has a castle instead, a
// greater one (KEEP_FROM) a castle besides its wall (plan.js).
export const STREETS_FROM = TOWN_R, CASTLE_FROM = TOWN_R, WALL_FROM = .4, KEEP_FROM = .7;
export const WALL_SHARE = .62;   // the wall runs at this share of the radius
export const WALL_W = .006, WALL_CLEAR = .016, STREET_W = .014, GATE_W = .034;   // km: the wall, the open strip on either side of it, a main street, a gateway
export const WALL_SEG = .05;     // km: a piece of the wall from tower to tower
const TAU = 6.283185307179586;
// how far from the middle of patch L its wall runs in direction a (radians from the east), km
export const wallAt = (L, a) => WALL_SHARE * L.r * (1 + .07 * Math.sin(3 * a + L.th * 5) + .05 * Math.sin(5 * a + L.th * 11));
// the direction of a gate ↔ the byte that holds it (0: no gate)
export const gateByte = a => 1 + Math.round((((a % TAU) + TAU) % TAU) / TAU * 254);
export const gateOf = b => (b - 1) / 254 * TAU;
// how far the fields reach beyond the last houses, km
export const fieldsBeyond = r => .5 + 2.5 * r;
// how far the lanes of a settlement run on past its last houses, km (twin of laneOut in aspects/settle.js): beyond
// that the tracks to the villages and the roads lead on
export const lanesBeyond = r => .1 + .45 * r;

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
// (sbx, sby: the two bytes of its shift; cx, cy: the middle of the patch; gates: the directions of its main streets)
export function lobeOf(g, bx, by, rb, cul, sbx = 128, sby = 128) {
  const gx = g % GN, gy = (g / GN) | 0, r = radiusOf(rb), x = GX0 + (gx + (bx + .5) / 256) * GK, y = GY0 + (gy + (by + .5) / 256) * GK, sx = shiftOf(sbx), sy = shiftOf(sby);
  return { k: g, gx, gy, bx, by, rb, cul, r, re: r, amp: Math.min(.25, .3 * r), th: ((bx * 37 + by * 91) % 256) / 256 * Math.PI / 2,
    x, y, sx, sy, cx: x + sx, cy: y + sy, gates: [], rivals: [] };
}
// the middle of a patch (a patch made by hand, without a shift, has it at its site)
export const midOf = L => [L.cx ?? L.x, L.cy ?? L.y];
// the same for a village: the square v of the fine grid it lies in, and the patch of that square. Its number k goes
// on from the numbers of the coarse grid, so no two patches share one.
export const fineOf = (x, y) => { const vx = Math.floor((x - GX0) / VK), vy = Math.floor((y - GY0) / VK); return vx >= 0 && vy >= 0 && vx < VN && vy < VN ? vy * VN + vx : -1; };
export function fineBytes(x, y) {
  const fx = (x - GX0) / VK - Math.floor((x - GX0) / VK), fy = (y - GY0) / VK - Math.floor((y - GY0) / VK);
  return [Math.min(255, Math.floor(fx * 256)), Math.min(255, Math.floor(fy * 256))];
}
export function villageLobe(v, bx, by, rb, cul) {
  const vx = v % VN, vy = (v / VN) | 0, r = radiusOf(rb);
  const x = GX0 + (vx + (bx + .5) / 256) * VK, y = GY0 + (vy + (by + .5) / 256) * VK;
  return { k: GN * GN + v, fine: v, vx, vy, bx, by, rb, cul, r, re: r, amp: Math.min(.25, .3 * r), th: ((bx * 37 + by * 91) % 256) / 256 * Math.PI / 2,
    x, y, sx: 0, sy: 0, cx: x, cy: y, gates: [], rivals: [] };
}
// how deep a point lies inside a patch, km (negative outside)
export const depthAt = (L, x, y) => L.re - Math.hypot(x - (L.cx ?? L.x), y - (L.cy ?? L.y)) + L.amp * wob(x, y);
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
  const cs = Math.cos(L.th), sn = Math.sin(L.th), sx = L.sx || 0, sy = L.sy || 0;
  // (how deep the cell lies in the patch is told from the middle of the patch: the shift, turned into the lattice)
  const m = R - Math.hypot(i * S - (cs * sx + sn * sy), j * S - (-sn * sx + cs * sy)) + L.amp * wob(L.x + (cs * i - sn * j) * S, L.y + (sn * i + cs * j) * S) + (hamlet ? .03 : 0);   // a hamlet keeps its few farmsteads
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
#define SET_VN ${VN}
#define SET_VK ${VK.toFixed(2)}
#define SET_FINE ivec2(${FINE_AT[0]}, ${FINE_AT[1]})
#define SET_COARSE ivec2(${COARSE_AT[0]}, ${COARSE_AT[1]})
#define SET_MORE ivec2(${MORE_AT[0]}, ${MORE_AT[1]})
#define SET_GATES ivec2(${GATES_AT[0]}, ${GATES_AT[1]})
#define SET_SHIFT ${SHIFT_MAX.toFixed(3)}
#define SET_STREETS_FROM ${STREETS_FROM.toFixed(4)}
#define SET_WALL_FROM ${WALL_FROM.toFixed(3)}
#define SET_WALL_W ${WALL_W.toFixed(4)}
#define SET_WALL_CLEAR ${WALL_CLEAR.toFixed(4)}
#define SET_STREET_W ${STREET_W.toFixed(4)}
#define SET_GATE_W ${GATE_W.toFixed(4)}
#define SET_KN ${KN}
#define SET_KKM ${KKM.toFixed(1)}
#define SET_K0 vec2(${KX0.toFixed(1)}, ${KY0.toFixed(1)})
#define SET_SOFT ${FARM_SOFT.toFixed(1)}
#define SET_WARP ${(FARM_WARP / KKM).toFixed(3)}
#define SET_UNEVEN ${FARM_UNEVEN.toFixed(3)}
#define SET_SHARP ${FARM_SHARP.toFixed(2)}
#define SET_TOWN_R ${TOWN_R.toFixed(4)}
#define SET_BEND ${BEND.toFixed(3)}
float setWob(vec2 pk) { return sin(pk.x * 9. + 1.3 * sin(pk.y * 7.)); }
float setHash(ivec2 id, int k, int salt) {
  uint h = uint(id.x + 4096) * 0x27d4eb2du ^ uint(id.y + 4096) * 0x165667b1u ^ uint(k * 16 + salt) * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float(h >> 8) / 16777216.;
}
// the lattice of a patch is bent (twin of bend() in town/rules.js): q in cells of the straight lattice → the bent one
vec2 setBend(vec2 q, float th) { return q + SET_BEND * vec2(sin(q.y * .55 + th * 7.), sin(q.x * .47 + th * 13.)); }
// how far from the middle of a patch its wall runs in direction a (twin of wallAt() in town/rules.js)
float setWall(float r, float th, float a) { return ${WALL_SHARE.toFixed(3)} * r * (1. + .07 * sin(3. * a + th * 5.) + .05 * sin(5. * a + th * 11.)); }
// What stands in lattice cell id of a patch (twin of cellRule() in town/rules.js): returns the class 0..5.
// r is the radius of the patch, cs sn the cosine and sine of the turn of its lattice, sh the shift of its middle from
// its site, turned into the lattice, km.
float setCell(ivec2 id, vec2 site, vec2 sh, float r, float cs, float sn, float cul, int k, float S, out vec2 hs, out vec2 off, out float rot, out vec4 rnd) {
  hs = vec2(0.); off = vec2(0.); rot = 0.; rnd = vec4(.5);
  bool centre = id.x == 0 && id.y == 0, atl = cul > 1.5, hamlet = r < ${STAGES[1].r.toFixed(3)};
  if (r < .6 * S) {
    if (!centre) return 0.;
    hs = vec2(clamp(.9 * r / S, .12, .45));
    return atl || hamlet ? 3. : 2.;
  }
  vec2 ij = vec2(id);
  float m = r - length(ij * S - sh) + min(.25, .3 * r) * setWob(site + vec2(cs * ij.x - sn * ij.y, sn * ij.x + cs * ij.y) * S) + (hamlet ? .03 : 0.);
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
// 7 dark opening · 8 yard wall · 9 boat · 10 the plot of a yard among the fields. atl: 0 Mediterranean (tile, whitewash)
// .. 1 Atlantic (slate, thatch, granite)
export const MAT = { roof: 0, flat: 1, wall: 2, stone: 3, timber: 4, cloth: 5, hay: 6, dark: 7, fence: 8, hull: 9, plot: 10 };
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
  if (m == 10) {                                                                             // beds of a kitchen garden, trodden earth between them
    float bed = fract(t * 2.7);
    return mix(bed < .45 ? vec3(.47, .53, .28) : bed < .7 ? vec3(.60, .52, .36) : vec3(.66, .60, .46), bed < .6 ? vec3(.40, .49, .25) : vec3(.50, .49, .36), atl) * (.95 + .08 * fract(t * 7.));
  }
  return vec3(.38, .30, .23);
}
`;
