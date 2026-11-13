// The place of the town of every land district: where its town stands and its roads meet. One place a district,
// always the same (the owner, 12–13.11.2026: «у района всегда одна точка под город: лучшее место в районе, каждый раз
// одно и то же»; «города должны стоять логично, ближе к морю»; «город всегда в центре района. Если он у воды, то у
// воды. Если район на горах, то на подножьях гор… не на вершине»).
//
// Every chunk of 1 km² of the district is weighed, the lowest score wins (docs/album/division.md, «Точка города»):
//   • only where a town may stand (km.js chunkSettle: not in the water, not on a mountain, not in a bog); if a district
//     has no such ground, where a hamlet may stand; if not even that, its most level ground;
//   • level ground first: class 1 best, class 3 dear;
//   • by the sea or a lake, if the district reaches it: the shore wins over the inland; a sheltered bay and the mouth of
//     a river more, an open cape less;
//   • else by a river: the bigger, the better; where two rivers meet, better still;
//   • never on a top: ground standing above the land around it is dear; low ground of the district is cheaper;
//   • not at the far rim: a little dearer away from the middle of the district;
//   • a real village of the region pulls the place to itself a little, the more the bigger it is;
//   • towns of neighbouring districts do not stand together: within 8 km of a place already chosen the ground is dear.
// A district with a real town (TOWN_POP people or more: town/sites.js, the places of the album) has its town there,
// the biggest of them: real towns stand where the land is good — by the sea, at the ford, at the meeting of valleys —
// and the rule is for the districts that have none. A real town closer than MERGE_KM to the town of a district taken
// before (a bigger one) is part of that town («соседние города сливаются в один»): the district takes its next real
// town, or the rule.
// No randomness: the same division always gives the same places.
//
// Seats: in every province, historical land and region the district whose town is the biggest (a real place by its
// people; where there is none, the best place) holds its seat — «у региона всегда есть свой самый большой город».
// Plain JavaScript without the GPU.
import { kmOf } from '../chunks.js';
import { KN as FN, KKM as FKM, KX0 as X0, KY0 as Y0, seedOf, kmFacts, kmSettle } from './km.js';

const LAND = 0;
export const SEAT = { province: 1, land: 2, region: 4 };
// why a place was chosen, for the notes and the panel
export const PLACE_WHY = ['настоящий город', 'бухта', 'устье реки', 'берег', 'слияние рек', 'река', 'ровное место', 'лучшее, что есть'];
const SPACING_KM = 8;
export const TOWN_POP = 2000;                          // a real place this big is a town: the district's town stands on it
export const MERGE_KM = 5;                             // a real town this near a bigger one is a part of it

// sums over boxes of squares: v(t) summed over the (2r+1)² box around each square, and how many squares counted
function boxSum(val, use, r) {
  const W = FN + 1, S = new Float64Array(W * W), C = new Float64Array(W * W), out = new Float32Array(FN * FN), num = new Float32Array(FN * FN);
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
    const t = j * FN + i, u = use(t), a = (j + 1) * W + i + 1;
    S[a] = (u ? val(t) : 0) + S[a - 1] + S[a - W] - S[a - W - 1]; C[a] = (u ? 1 : 0) + C[a - 1] + C[a - W] - C[a - W - 1];
  }
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
    const i0 = Math.max(0, i - r), i1 = Math.min(FN, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(FN, j + r + 1);
    const q = (A, x0, y0, x1, y1) => A[y1 * W + x1] - A[y0 * W + x1] - A[y1 * W + x0] + A[y0 * W + x0];
    out[j * FN + i] = q(S, i0, j0, i1, j1); num[j * FN + i] = q(C, i0, j0, i1, j1);
  }
  return { out, num };
}

// div: the division with div.cells, div.kinds, div.raster = { hgt, riv }, div.province, div.provinces, div.region;
// sites: [{ x, y } or { lat, lon }, pop, name], the most important first;
// opts: { facts (km.js chunkFacts), settle (km.js chunkSettle) } — worked out from the division when not given
// → { x, y: Float64Array (flat km; NaN for water), site: Int32Array (index into sites, −1 none), texel: Int32Array
//     (the chunk the place is on), why: Uint8Array (PLACE_WHY), pop: Float64Array (people of the real place, 0 none),
//     seat: Uint8Array (SEAT bits), seats: { province: [district], land: Map(name → district), region: [district] } }
export function districtCentres(div, sites = [], opts = {}) {
  const count = div.count, cells = div.cells, { hgt, riv } = div.raster, n = FN * FN;
  const facts = opts.facts || kmFacts(div, div.raster.heightAt), settle = opts.settle || kmSettle(div, div.raster.heightAt);
  const land = t => { const d = cells[t]; return d >= 0 && div.kinds[d] === LAND; };
  const x = new Float64Array(count).fill(NaN), y = new Float64Array(count).fill(NaN), site = new Int32Array(count).fill(-1), texel = new Int32Array(count).fill(-1);
  const why = new Uint8Array(count), pop = new Float64Array(count), seat = new Uint8Array(count);
  // the real places, by the chunk they stand on (the biggest of a chunk)
  const placeAt = new Map();
  sites.forEach((s, i) => {
    const [sx, sy] = s.x !== undefined ? [s.x, s.y] : kmOf(s.lat, s.lon), ti = Math.floor((sx - X0) / FKM), tj = Math.floor((sy - Y0) / FKM);
    if (ti < 0 || tj < 0 || ti >= FN || tj >= FN) return;
    const t = tj * FN + ti; if (!land(t)) return;
    const was = placeAt.get(t); if (!was || (s.pop || 0) > (sites[was].pop || 0)) placeAt.set(t, i);
  });
  // what the land around a square is like: its mean height within 3 km (a top stands above it), the share of water
  // within 4 km (a bay is wrapped by land, a cape juts into the water)
  const around = boxSum(t => hgt[t], land, 3), water = boxSum(() => 1, t => !land(t), 4), all = boxSum(() => 1, () => true, 4);
  const isWater = t => !land(t);
  const nb4 = t => { const i = t % FN; return [i > 0 ? t - 1 : -1, i < FN - 1 ? t + 1 : -1, t >= FN ? t - FN : -1, t < n - FN ? t + FN : -1]; };
  // where two rivers meet: around a river square the ring of its eight neighbours enters a river three times or more
  const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const confluence = t => {
    const i = t % FN, j = Math.floor(t / FN); if (!riv[t] || i < 1 || j < 1 || i >= FN - 1 || j >= FN - 1) return false;
    let runs = 0; for (let k = 0; k < 8; k++) { const a = riv[(j + RING[k][1]) * FN + i + RING[k][0]] > 0, b = riv[(j + RING[(k + 7) % 8][1]) * FN + i + RING[(k + 7) % 8][0]] > 0; if (a && !b) runs++; }
    return runs >= 3;
  };
  // the chunks of every land district, its middle, its lowest ground, whether it reaches the water, its biggest place
  const list = Array.from({ length: count }, () => []), mx = new Float64Array(count), my = new Float64Array(count), low = new Float32Array(count).fill(1e9);
  const coastal = new Uint8Array(count), biggest = new Float64Array(count);
  for (let t = 0; t < n; t++) {
    if (!land(t)) continue;
    const d = cells[t]; list[d].push(t); mx[d] += t % FN; my[d] += Math.floor(t / FN); if (hgt[t] < low[d]) low[d] = hgt[t];
    if (settle.can[t] === 2 && nb4(t).some(u => u >= 0 && isWater(u))) coastal[d] = 1;
    const pi = placeAt.get(t); if (pi !== undefined) biggest[d] = Math.max(biggest[d], sites[pi].pop || 0);
  }
  for (let d = 0; d < count; d++) if (list[d].length) { mx[d] /= list[d].length; my[d] /= list[d].length; }
  // the districts from the biggest real town down; then by number
  const order = []; for (let d = 0; d < count; d++) if (list[d].length) order.push(d);
  order.sort((a, b) => biggest[b] - biggest[a] || a - b);
  const chosen = [], grid = new Map(), G = SPACING_KM, key = (gx, gy) => gx * 100003 + gy;
  const posOf = pi => (sites[pi].x !== undefined ? [sites[pi].x, sites[pi].y] : kmOf(sites[pi].lat, sites[pi].lon));
  const take = (px, py) => { const k = chosen.length / 2; chosen.push(px, py); const gk = key(Math.floor(px / G), Math.floor(py / G)); if (!grid.has(gk)) grid.set(gk, []); grid.get(gk).push(k); };
  const near = (px, py, r) => {
    for (let gy = Math.floor(py / G) - 1; gy <= Math.floor(py / G) + 1; gy++) for (let gx = Math.floor(px / G) - 1; gx <= Math.floor(px / G) + 1; gx++)
      for (const c of grid.get(key(gx, gy)) || []) if (Math.hypot(chosen[c * 2] - px, chosen[c * 2 + 1] - py) < r) return true;
    return false;
  };
  const crowd = (px, py) => {
    let s = 0;
    for (let gy = Math.floor(py / G) - 1; gy <= Math.floor(py / G) + 1; gy++) for (let gx = Math.floor(px / G) - 1; gx <= Math.floor(px / G) + 1; gx++)
      for (const c of grid.get(key(gx, gy)) || []) { const dd = Math.hypot(chosen[c * 2] - px, chosen[c * 2 + 1] - py); if (dd < SPACING_KM) s += 3 * (1 - dd / SPACING_KM); }
    return s;
  };
  for (const d of order) {
    const L = list[d], num = L.length;
    // a real town: the biggest place of the district that is not a part of a bigger town next door
    if (biggest[d] >= TOWN_POP) {
      const towns = [];
      for (const t of L) { const pi = placeAt.get(t); if (pi !== undefined && (sites[pi].pop || 0) >= TOWN_POP) towns.push([sites[pi].pop, t, pi]); }
      towns.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const real = towns.find(([, , pi]) => { const [px, py] = posOf(pi); return !near(px, py, MERGE_KM); });
      if (real) {
        const [P, bt, pi] = real, [px, py] = posOf(pi);
        x[d] = px; y[d] = py; texel[d] = bt; site[d] = pi; why[d] = 0; pop[d] = P; take(px, py);
        continue;
      }
    }
    let need = 2; if (!L.some(t => settle.can[t] === 2)) need = L.some(t => settle.can[t] === 1) ? 1 : 0;
    let best = Infinity, bt = -1, bw = 7, bs = -1;
    for (const t of L) {
      if (settle.can[t] < need) continue;
      const i = t % FN, j = Math.floor(t / FN), c = facts.cls[t] || 5;
      let sc = c === 1 ? 0 : c === 2 ? .3 : c === 3 ? 1 : 2.5, w = 6;
      // by the water
      const shore = nb4(t).some(u => u >= 0 && isWater(u));
      let rv = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const u = t + dj * FN + di; if (u >= 0 && u < n) rv = Math.max(rv, riv[u]); }
      if (coastal[d] && shore) {
        sc -= 2.5; w = 3;
        const wf = water.out[t] / Math.max(1, all.num[t]);
        const bay = Math.min(1, Math.max(0, (.48 - wf) / .22)), cape = Math.min(1, Math.max(0, (wf - .58) / .2));
        sc -= bay; sc += .8 * cape; if (bay > .5) w = 1;
        if (rv) { sc -= .6 + .3 * rv; w = 2; }
      } else if (rv) {
        sc -= .4 + .3 * rv; w = 5;
        if (confluence(t) || (riv[t] && rv > riv[t])) { sc -= .8; w = 4; }
      }
      // never on a top; low ground of the district is cheaper
      const mean = around.num[t] ? around.out[t] / around.num[t] : hgt[t];
      sc += Math.max(0, hgt[t] - mean - 30) / 60 + (hgt[t] - low[d]) / 600;
      // not at the far rim
      const dx = i - mx[d], dy = j - my[d]; sc += .8 * (dx * dx + dy * dy) / (.3 * num);
      // a real village pulls the town to itself a little
      const pi = placeAt.get(t), P = pi !== undefined ? sites[pi].pop || 0 : 0;
      if (P > 300) sc -= Math.min(1.2, 1.2 * Math.log10(P / 300));
      // towns of neighbouring districts do not stand together
      const [sx, sy] = pi !== undefined && (sites[pi].x !== undefined) ? [sites[pi].x, sites[pi].y] : pi !== undefined ? kmOf(sites[pi].lat, sites[pi].lon) : seedOf(i, j);
      sc += crowd(sx, sy) + (near(sx, sy, MERGE_KM) ? 20 : 0);            // (a town closer than MERGE_KM would be a part of the other)
      if (need < 2) w = 7;
      if (sc < best || (sc === best && t < bt)) { best = sc; bt = t; bw = w; bs = pi !== undefined && P > 300 ? pi : -1; }
    }
    if (bt < 0) continue;
    const [px, py] = bs >= 0 ? (sites[bs].x !== undefined ? [sites[bs].x, sites[bs].y] : kmOf(sites[bs].lat, sites[bs].lon)) : seedOf(bt % FN, Math.floor(bt / FN));
    x[d] = px; y[d] = py; texel[d] = bt; site[d] = bs; why[d] = bw; pop[d] = bs >= 0 ? sites[bs].pop || 0 : 0; take(px, py);
  }
  // the seats: the biggest town of every province, historical land and region
  const seats = { province: [], land: new Map(), region: [] }, bestOf = new Map();
  const weigh = d => pop[d] * 1e3 + (site[d] >= 0 ? 1 : 0) - d * 1e-9;     // people first; equal, the lower number
  for (let d = 0; d < count; d++) {
    if (texel[d] < 0) continue;
    const p = div.province[d], r = div.region[p], ld = div.provinces[p]?.land || '';
    for (const [lvl, id] of [['province', p], ['land', ld], ['region', r]]) {
      if (lvl === 'land' && !ld) continue;
      const k = lvl + ':' + id, b = bestOf.get(k); if (b === undefined || weigh(d) > weigh(b)) bestOf.set(k, d);
    }
  }
  for (const [k, d] of bestOf) {
    const [lvl, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    seat[d] |= SEAT[lvl];
    if (lvl === 'land') seats.land.set(id, d); else seats[lvl][+id] = d;
  }
  return { x, y, site, texel, why, pop, seat, seats };
}
