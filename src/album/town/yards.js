// Farmsteads among the fields: single yards that stand outside the settlements, where the land is ploughed (the
// owner, 12.11.2026: «если это чанк, в котором у нас угодья, то это поля в основном и маленькие редкие домики,
// по-разному находящиеся»; then «да, нарисовать»).
//
// A square kilometre of land has sixteen places for a yard, a lattice of 250 m — the same places the save keeps a bit
// for (save/land.js: two bytes say which of the sixteen are taken). Whether a place is taken is worked out here, the
// same every time, from the number of the place, from how much of its chunk of 1 km² is under fields (farmland.js),
// from how near the houses of a settlement are, and from the ground itself: a yard never stands on water, on a river,
// in a swamp, on a steep slope, on a road or a lane, or among the houses of a settlement.
//
// A yard is drawn as a block of its own (layers/towns.js), like the blocks of a settlement. The ground shader knows
// nothing of yards, so they cost the land nothing; the price is that the fine noise of the fields cannot be read
// here, and now and then a yard stands on the rough pasture beside a field instead of on the field.
import { FKM, FN } from '../chunks.js';
import { KN, KKM, KX0, KY0 } from '../division/km.js';
import { GK, GN, GX0, GY0, CELL, CULTURES, FARM_SHARP, cellHash, fieldsBeyond, lanesBeyond, bend } from './rules.js';
import { KIND } from './shapes.js';
import { FLAG_ATL } from './plan.js';

export const YARD_STEP = .25, YARD_SIDE = 4;     // km between two places · places along a side of a square kilometre
export const YARD_TILE = 16;                     // places along a side of a tile of the plan: 4 km
// yards on a square kilometre of fully ploughed land, by the manner of building: Mediterranean people live in
// villages and yards are few; Atlantic people live in yards scattered over the land
export const YARDS_PER_KM2 = [0, 2.5, 5];
export const YARD_KINDS = ['cot', 'yard', 'longyard'];             // the blocks a yard may be: light ones, each with its own plot
// A yard stands only in a chunk of farmland: a chunk of 1 km² ploughed for the greater part. So a save knows which
// chunks can carry yards from the fields alone, and keeps its two bytes for those chunks only (save/land.js).
export const YARD_FARM = .5;
const JITTER = .14;                              // km: a yard stands within 70 m of the middle of its place
const KEEP = .18;                                // km: and no nearer than this to the last houses of a settlement
const MAX_SLOPE = .2, MAX_HEIGHT = 1500;         // metre for metre · metres above the sea

// the patches of settlement, towns and villages alike, by the square of 10 km they lie in.
// list: [{ x, y, r }] with r in km; th, the turn of the lattice, if the lanes of the patch are known
export function patchIndex(list) {
  const at = new Map();
  for (const L of list) {
    if (!(L.r > 0)) continue;
    const gx = Math.floor((L.x - GX0) / GK), gy = Math.floor((L.y - GY0) / GK); if (gx < 0 || gy < 0 || gx >= GN || gy >= GN) continue;
    const key = gy * GN + gx; (at.get(key) || at.set(key, []).get(key)).push(L);
  }
  return at;
}
// the patch that lies deepest over a point and how deep (negative outside it), as the ground shader finds it
const hit = { L: null, m: 0 };
function nearest(patches, x, y) {
  const gx = Math.floor((x - GX0) / GK), gy = Math.floor((y - GY0) / GK); hit.L = null; hit.m = -1e3;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = gx + dx, yy = gy + dy; if (xx < 0 || yy < 0 || xx >= GN || yy >= GN) continue;
    for (const L of patches.get(yy * GN + xx) || []) { const d = L.r - Math.hypot(x - (L.cx ?? L.x), y - (L.cy ?? L.y)); if (d > hit.m) { hit.m = d; hit.L = L; } }   // (the houses lie around the middle of the patch)
  }
  return hit.L ? hit : null;
}
// How surely the land at a point is ploughed, 0..1: the fields of aspSettle without their fine noise. farm: how much
// of the chunk of 1 km² there is under fields (state.js farmAt); m: how deep the point lies in the nearest patch
// (negative outside), r: the radius of that patch (0 when no patch is near) — in a chunk ploughed in part the land
// next to the houses is ploughed first
export function ploughed(farm, m = -1e3, r = 0) {
  const W = fieldsBeyond(r), beside = r > 0 && m > -W - .3 ? Math.max(0, Math.min(1, 1 + m / W)) * Math.min(1, farm * 5) : 0;
  return farm > .004 ? Math.max(0, Math.min(1, (farm + .45 * beside - .5) * FARM_SHARP + .5)) : 0;
}
// the ground a yard can stand on. env: at(x, y) → metres · river(x, y) → km to the bank of the nearest river ·
// swamp(x, y) → 0..1 · road(x, y) → km to the nearest road (may be left out)
function soundGround(env, x, y, half) {
  const h = env.at(x, y); if (h <= 2 || h > MAX_HEIGHT) return false;
  const e = .06, hE = env.at(x + e, y), hW = env.at(x - e, y), hN = env.at(x, y + e), hS = env.at(x, y - e);
  if (Math.min(hE, hW, hN, hS) <= 1 || Math.hypot(hE - hW, hN - hS) / (2 * e * 1000) > MAX_SLOPE) return false;
  if (env.river(x, y) < half + .03 || env.swamp(x, y) >= .3) return false;
  return !env.road || env.road(x, y) >= half + .03;
}

// What a yard needs to know of the world:
//   cell      the natural cell of every texel of the fine raster (chunks.js)
//   land(c)   is natural cell c land · culture(c) its manner of building
//   farm(x, y) how much of the chunk of 1 km² at a point is under fields, 0..1 (state.js farmAt)
//   farmSquare(kx, ky)  how much of the chunk of that square is under fields, 0..1: no yard stands in a chunk with
//             less than YARD_FARM. When left out, any chunk will do
//   farmList  the chunks of 1 km² that have fields (farmland.js; for allYards)
//   patches   patchIndex() of the settlements · env  the ground (see soundGround)
//   density   the «Дворы среди полей» knob, × · S  the cell of the lattice of blocks, km
//   landSquare(kx, ky)  is the chunk of 1 km² of that square land (division/km.js)? When given, no yard stands in a
//             chunk of water: its sixteen places are those of a chunk of some district of land
// The yard at place (i, j) of the lattice of 250 m: a row for the blocks (plan.js, ROW numbers), or null
export function yardAt(ctx, i, j) {
  const K = ctx.density ?? 1, h0 = cellHash(i, j, 0, 21);
  if (h0 * 16 >= K * YARDS_PER_KM2[2]) return null;                 // no manner of building is that dense: most places end here
  const x = GX0 + (i + .5) * YARD_STEP + (cellHash(i, j, 0, 22) - .5) * JITTER, y = GY0 + (j + .5) * YARD_STEP + (cellHash(i, j, 0, 23) - .5) * JITTER;
  const tx = Math.floor((x - GX0) / FKM), ty = Math.floor((y - GY0) / FKM); if (tx < 0 || ty < 0 || tx >= FN || ty >= FN) return null;
  const c = ctx.cell[ty * FN + tx]; if (!ctx.land(c)) return null;
  const kx = Math.floor(i / YARD_SIDE), ky = Math.floor(j / YARD_SIDE);
  if (ctx.farmSquare && !(ctx.farmSquare(kx, ky) >= YARD_FARM)) return null;
  if (ctx.landSquare && !ctx.landSquare(kx, ky)) return null;
  const atl = ctx.culture(c) === CULTURES.atl, p = K * YARDS_PER_KM2[atl ? CULTURES.atl : CULTURES.med] / 16;
  if (h0 >= p) return null;
  const farm = ctx.farm(x, y); if (!(farm > .004)) return null;      // a yard stands in a chunk of farmland
  const n = nearest(ctx.patches, x, y), L = n ? n.L : null, m = n ? n.m : -1e3;
  if (L && m > -KEEP - Math.min(.25, .3 * L.r)) return null;        // among the houses, or where the next houses are being built
  const f = ploughed(farm, m, L ? L.r : 0), g = Math.max(0, Math.min(1, (f - .3) / .4));
  if (h0 >= p * g * g * (3 - 2 * g)) return null;                   // the less surely the land is ploughed, the fewer yards
  const v = cellHash(i, j, 0, 24), s = cellHash(i, j, 0, 25), S = ctx.S ?? CELL;
  let kind, sx, sy;
  const s2 = (s * 13) % 1;                                          // sizes are those of the plot, in cells of the lattice of blocks
  if (v < .4) { kind = KIND.cot; sx = .62 + .14 * s; sy = .52 + .14 * s2; }             // a house alone in its garden
  else if (v < .75) { kind = KIND.yard; sx = .8 + .14 * s; sy = .7 + .14 * s2; }         // a house, a shed, a haystack
  else { kind = KIND.longyard; sx = .82 + .14 * s; sy = .62 + .12 * s2; }               // people and cattle under one long roof
  const half = Math.max(sx, sy) * .5 * S;
  if (!soundGround(ctx.env, x, y, half)) return null;
  if (L && L.th != null && m > -lanesBeyond(L.r) - half - .02) {   // not on the lanes that run out of the settlement a little way
    const cs = Math.cos(L.th), sn = Math.sin(L.th), dx = x - L.x, dy = y - L.y, q = bend(L, (cs * dx + sn * dy) / S, (-sn * dx + cs * dy) / S);
    if (Math.min(Math.abs(q[0] - .5), Math.abs(q[1] - .5)) * S < half + .012) return null;
  }
  // Mediterranean yards stand along the furlongs (their rows are turned 30° against the compass); Atlantic ones any way
  const t = cellHash(i, j, 0, 26), turn = atl ? t * 6.2831853 : .5236 + Math.floor(t * 4) * 1.5707963 + (cellHash(i, j, 0, 27) - .5) * .3;
  return [x, y, turn, kind, 0, 0, 0, atl ? FLAG_ATL : 0, sx, sy, cellHash(i, j, 0, 28), 1];
}
// the yards of one tile of the plan (ti, tj: its number on the lattice of tiles of 4 km): rows for the blocks
export function planYards(ctx, ti, tj) {
  const out = [];
  for (let j = tj * YARD_TILE; j < (tj + 1) * YARD_TILE; j++) for (let i = ti * YARD_TILE; i < (ti + 1) * YARD_TILE; i++) { const r = yardAt(ctx, i, j); if (r) for (const v of r) out.push(v); }
  return out;
}
// every yard of the map, for the save and the notes: [{ i, j, x, y, kind }]. Only the tiles where a yard can stand
// are looked at: those of the chunks that have fields.
export function allYards(ctx) {
  const tiles = new Set(), T = YARD_TILE * YARD_STEP, TN = Math.ceil(FN * FKM / T), out = [];
  const add = (x0, y0, x1, y1) => { for (let tj = Math.max(0, Math.floor((y0 - GY0) / T)); tj <= Math.min(TN - 1, Math.floor((y1 - GY0) / T)); tj++) for (let ti = Math.max(0, Math.floor((x0 - GX0) / T)); ti <= Math.min(TN - 1, Math.floor((x1 - GX0) / T)); ti++) tiles.add(tj * TN + ti); };
  // (without farmSquare a yard may stand in the chunk next to a ploughed one: the fields of a chunk reach a little
  // into the chunks around it — state.js farmAt)
  const e = ctx.farmSquare ? 0 : KKM;
  for (const c of ctx.farmList || []) { const x = KX0 + (c % KN) * KKM, y = KY0 + Math.floor(c / KN) * KKM; add(x - e, y - e, x + KKM + e, y + KKM + e); }
  for (const key of [...tiles].sort((a, b) => a - b)) {
    const ti = key % TN, tj = Math.floor(key / TN);
    for (let j = tj * YARD_TILE; j < (tj + 1) * YARD_TILE; j++) for (let i = ti * YARD_TILE; i < (ti + 1) * YARD_TILE; i++) { const r = yardAt(ctx, i, j); if (r) out.push({ i, j, x: r[0], y: r[1], kind: r[3] }); }
  }
  return out;
}
// the place of a yard as the save keeps it: its chunk of 1 km² — the square (kx, ky) of the lattice that begins at
// the corner of the map (division/km.js) — and one of the sixteen places in it
export const yardPlace = (i, j) => ({ kx: Math.floor(i / YARD_SIDE), ky: Math.floor(j / YARD_SIDE), slot: (j % YARD_SIDE) * YARD_SIDE + i % YARD_SIDE });
