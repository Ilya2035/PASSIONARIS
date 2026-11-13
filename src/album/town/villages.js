// The places of a district where people settle besides its centre: the villages between the centres of districts
// (the owner, 12.11.2026: «в соседнем районе за счёт города, это центр управления, будут там деревни»; «деревушки
// должны к каким-то местам хорошим тянуться: к побережьям… в горах, в ущельях»; «где-то точки надо заранее отметить…
// где деревни будут делать»; 13.11.2026: «сначала деревни»).
//
// Every land district has a LIST OF PLACES, the same every time for the same division:
//   0       its centre (division/centres.js): the town of the district, the knot of its roads
//   then    the real towns and villages that lie in it, the most populous first (town/sites.js)
//   then    places chosen here on the chunks of 1 km² (division/km.js), the best first: level ground, by a river or
//           the sea, low in its district, never where nobody can live
// The number of a place in this list is what a save keeps for a settlement (save/land.js, `site`).
//
// No two places stand in one square of the fine grid of settlements (rules.js, VK): every village has a square of its
// own in the texture the ground is painted from (state.js). The places the album draws as towns (the first `base` of
// the sites) are the one exception: they lie in the coarse grid.
// Plain JavaScript without the GPU.
import { kmOf, llOf } from '../chunks.js';
import { KN, KKM, KX0, KY0, seedOf, kmHash, kmData } from '../division/km.js';
import { VK, VN, GX0, GY0 } from './rules.js';

const LAND = 0;
export const SITE = { centre: 0, real: 1, made: 2 };
export const PER = 30;                         // km² of good ground to one place besides the centre, at density 1
export const DENSE = 2;                        // the list is made for up to this density (knob «Деревни между центрами»)
export const GAP = 2.6;                        // km: a made place stands no nearer than this to any other place
export const NEAR = 1.2;                       // km: a real place nearer than this to a greater one is the same settlement
export const GOOD = [0, 1, .8, .4, .1, 0];     // how much of a chunk counts as good ground, by its class (km.js)
export const HIGH = 1200, TOO_HIGH = 1800;     // metres: above the first good ground counts half; above the second no place is made
export const MOST = 254;                       // places in a district besides its centre: a save counts them in a byte
export const MADE_R = [.085, .05];             // km: the radius at full growth of the best made place of a district, and of its last
// what makes a chunk a worse place for a village, in the same units (0 = level ground low in its district)
export const WORSE = { cls: [0, 0, .3, 1, 2.6], perM: 1 / 400, onRiver: .6, byRiver: -.55, onBrook: -.3, byBrook: -.2, byWater: -.4, chance: .6 };

// div: the division with div.cells, div.kinds, div.centres and div.raster = { hgt, riv }; facts: chunkFacts() of km.js;
// sites: [{ lat, lon, pop, name }] or [{ x, y, pop, name }], the most important first; base: how many of the first
// sites the album draws as towns anyway; at(x, y) → metres at a point of the flat km plane (may be left out: a made
// place then stands on the seed of its chunk); swamp(x, y) → the share of swamp there by nature, 0..1 (may be left
// out): no place is made in wet land (SWAMP)
// → { count, first: Uint32Array (count + 1: where the places of a district begin), x, y: Float64Array (flat km),
//     kind: Uint8Array (SITE), src: Int32Array (index into sites, −1 none), chunk: Int32Array (the chunk of 1 km² it
//     stands in), size: Float32Array (km, the radius of a made place at full growth), good: Float32Array (count: km²
//     of good ground), real: Uint16Array (count: real places besides the centre) }
export const SWAMP = .1;                        // the share of swamp by nature from which no place is made
export function districtSites(div, facts, sites = [], { base = 0, at = null, swamp = null } = {}) {
  const count = div.count, cells = div.cells, kinds = div.kinds, cen = div.centres, { hgt, riv } = div.raster, n = KN * KN;
  const landAt = c => { const d = cells[c]; return d >= 0 && kinds[d] === LAND; };
  const X = [], Y = [], per = Array.from({ length: count }, () => []), held = new Map();
  const fine = (x, y) => { const i = Math.floor((x - GX0) / VK), j = Math.floor((y - GY0) / VK); return i < 0 || j < 0 || i >= VN || j >= VN ? -1 : j * VN + i; };
  const nearer = (x, y, gap) => {                                  // does a place stand nearer than gap?
    const i0 = Math.floor((x - GX0) / VK), j0 = Math.floor((y - GY0) / VK), R = Math.ceil(gap / VK);
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) for (const s of held.get(j * VN + i) || []) if (Math.hypot(X[s] - x, Y[s] - y) < gap) return true;
    return false;
  };
  const add = (d, x, y, kind, src, chunk, size = 0) => {
    const s = X.length, v = fine(x, y); X.push(x); Y.push(y);
    (held.get(v) || held.set(v, []).get(v)).push(s);
    per[d].push({ x, y, kind, src, chunk, size });
  };
  const square = (x, y) => { const i = Math.floor((x - KX0) / KKM), j = Math.floor((y - KY0) / KKM); return i < 0 || j < 0 || i >= KN || j >= KN ? -1 : j * KN + i; };
  // ---- the centres, then the real places
  if (cen) for (let d = 0; d < count; d++) if (kinds[d] === LAND && cen.texel[d] >= 0) add(d, cen.x[d], cen.y[d], SITE.centre, cen.site[d], square(cen.x[d], cen.y[d]));
  const real = new Uint16Array(count);
  sites.forEach((s, i) => {
    const [x, y] = s.x !== undefined ? [s.x, s.y] : kmOf(s.lat, s.lon), c = square(x, y); if (c < 0 || !landAt(c)) return;
    const d = cells[c]; if (!per[d].length || (cen && cen.site[d] === i) || real[d] >= MOST) return;
    if (i >= base && (held.has(fine(x, y)) || nearer(x, y, NEAR))) return;      // the square is taken, or it is a part of a greater place
    add(d, x, y, SITE.real, i, c); real[d]++;
  });
  // ---- the made places: the best chunks of every district, well apart
  const good = new Float32Array(count), low = new Float32Array(count).fill(1e9), key = new Float32Array(n);
  for (let c = 0; c < n; c++) { if (!landAt(c)) continue; const d = cells[c]; good[d] += GOOD[facts.cls[c]] * (hgt[c] < HIGH ? 1 : .5); if (hgt[c] < low[d]) low[d] = hgt[c]; }
  const NB = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1], W = WORSE;
  // the most level spot of a chunk: its seed or the middle of one of its quarters
  const spot = c => {
    const i = c % KN, j = (c - i) / KN, seed = seedOf(i, j); if (!at) return seed;
    let best = seed, bs = Infinity;
    for (let q = 0; q < 5; q++) {
      const x = q ? KX0 + (i + (q & 1 ? .25 : .75)) * KKM : seed[0], y = q ? KY0 + (j + (q & 2 ? .25 : .75)) * KKM : seed[1], h = at(x, y); if (h <= 2) continue;
      const e = .06, hE = at(x + e, y), hW = at(x - e, y), hN = at(x, y + e), hS = at(x, y - e); if (Math.min(hE, hW, hN, hS) <= 1) continue;
      const sl = Math.hypot(hE - hW, hN - hS) / (2 * e * 1000) + (q ? .004 : 0); if (sl < bs) { bs = sl; best = [x, y]; }
    }
    return best;
  };
  const box = kmData(div).box;
  for (let d = 0; d < count; d++) {
    if (kinds[d] !== LAND || !per[d].length) continue;
    let want = Math.min(MOST, Math.round(DENSE * good[d] / PER)) - real[d]; if (want <= 0) continue;
    const list = [];
    for (let j = box.y0[d]; j <= box.y1[d]; j++) for (let i = box.x0[d], c = j * KN + i; i <= box.x1[d]; i++, c++) {
      if (cells[c] !== d) continue;
      const cls = facts.cls[c]; if (cls < 1 || cls > 4 || hgt[c] > TOO_HIGH) continue;
      let river = false, brook = false, water = false;
      for (let q = 0; q < 16; q += 2) { const u = i + NB[q], v = j + NB[q + 1]; if (u < 0 || v < 0 || u >= KN || v >= KN) { water = true; continue; } const t = v * KN + u; if (!landAt(t)) water = true; else if (riv[t] > 1) river = true; else if (riv[t] === 1) brook = true; }
      key[c] = W.cls[cls] + (hgt[c] - low[d]) * W.perM + (riv[c] > 1 ? W.onRiver : river ? W.byRiver : riv[c] === 1 ? W.onBrook : brook ? W.byBrook : 0) + (water ? W.byWater : 0) + (kmHash(i, j, 11) - .5) * W.chance;
      list.push(c);
    }
    list.sort((a, b) => key[a] - key[b] || a - b);
    const usual = Math.max(1, Math.round(good[d] / PER) - real[d]); let made = 0;      // how many stand at density 1
    for (const c of list) {
      if (made >= want) break;
      const [x, y] = spot(c); if (held.has(fine(x, y)) || nearer(x, y, GAP) || (swamp && swamp(x, y) >= SWAMP)) continue;
      add(d, x, y, SITE.made, -1, c, MADE_R[0] + (MADE_R[1] - MADE_R[0]) * Math.min(1, made / usual)); made++;
    }
  }
  // ---- one list after another
  const first = new Uint32Array(count + 1); for (let d = 0; d < count; d++) first[d + 1] = first[d] + per[d].length;
  const N = first[count], x = new Float64Array(N), y = new Float64Array(N), kind = new Uint8Array(N), src = new Int32Array(N), chunk = new Int32Array(N), size = new Float32Array(N);
  for (let d = 0, s = 0; d < count; d++) for (const p of per[d]) { x[s] = p.x; y[s] = p.y; kind[s] = p.kind; src[s] = p.src; chunk[s] = p.chunk; size[s] = p.size; s++; }
  return { count, first, x, y, kind, src, chunk, size, good, real };
}

// how many made places of district d stand at a density (the knob «Деревни между центрами»): the first so many of its list
export const madeAllowed = (list, d, density) => Math.max(0, Math.min(MOST, Math.round(density * list.good[d] / PER)) - list.real[d]);

// The villages the model of growth is given (town/grow.js), after its towns: the real places of every district that
// are not drawn as towns already, and the made places the density allows.
// → [{ lat, lon, pop, name, district, site, village: true, r (a made place: its radius at full growth, km) }]
export const MADE_POP = 240;                   // a made place is founded after every real one
export function villagePlaces(list, sites = [], { base = 0, density = 1 } = {}) {
  const out = []; if (!(density > 0)) return out;
  for (let d = 0; d < list.count; d++) {
    const allow = madeAllowed(list, d, density); let made = 0;
    for (let s = list.first[d] + 1; s < list.first[d + 1]; s++) {
      const site = s - list.first[d], q = llOf(list.x[s], list.y[s]);
      if (list.kind[s] === SITE.real) { if (list.src[s] >= base) { const r = sites[list.src[s]]; out.push({ lat: q.lat, lon: q.lon, pop: r.pop, name: r.name || '', district: d, site, village: true }); } }
      else if (made++ < allow) out.push({ lat: q.lat, lon: q.lon, pop: MADE_POP - Math.min(made, 200), name: '', district: d, site, village: true, r: list.size[s] });
    }
  }
  return out;
}
// which place of which district a site of the list of real places is: Map(index into sites → { district, site })
export function siteNumbers(list) {
  const m = new Map();
  for (let d = 0; d < list.count; d++) for (let s = list.first[d]; s < list.first[d + 1]; s++) if (list.src[s] >= 0) m.set(list.src[s], { district: d, site: s - list.first[d] });
  return m;
}
