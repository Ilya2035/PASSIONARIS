// How settlements grow, as numbers of chunks. A place has a size; the size times the «Рост городов» knob is the radius
// of its settlement, at its real size: хутор → деревня → село → городок → город (STAGES in rules.js). From the radius
// come its people, and from the people the fields they live from: the settlement ploughs the chunks of 1 km² around
// it (farmland.js), the nearest and most level first. The model returns numbers only — the layer writes them into
// the chunks: the share of every chunk of 1 km² under fields (`farm`), and for the natural cells of about 100 km²
// (docs/ALBUM-CHUNKS.md) the share under houses (`built`), under fields (`fields`, the sum of their chunks) and how
// much of the natural forest still stands.
//
// Fields and felling spread over land: the natural cells have outlines along the rivers, the model walks from cell
// to cell by their links, and a great river stops it.
// A settlement by a river stands on one bank: its site is moved off the water until its houses touch the bank.
//
// Two sorts of places are grown. A TOWN — a place of the album or the centre of a district — may grow into a city;
// there is one to a natural cell, and its patch lies in the coarse grid (state.js). A VILLAGE — a place between the
// centres (villages.js; place.village) — stays a village: its radius stops at VILLAGE_RMAX, there is one to a square
// of the fine grid, and where a town has grown over its place it is not founded at all.
//
// The owner, 13.11.2026: «в районе один город, деревень может быть много; соседние города сливаются в один; чанки
// города помечены: чанк города такого-то». So a district has one town — the place at its centre (townsOfDistricts());
// two towns whose houses have grown together are one town with one centre, the greater of the two; and every chunk of
// 1 km² a settlement is built on knows that settlement (builtChunks()): the area of a town is the number of its chunks.
import { kmOf, llOf } from '../chunks.js';
import { GX0, GY0, GK, VK, VN, VILLAGE_RMAX, FINE_RMAX, SHIFT_MAX, SHIFT_SHARE, SHIFT_FROM, SHORE_AT, shiftByte, shiftOf, stageOf, peopleOf, classOf } from './rules.js';
import { KN, KKM, KX0, KY0 } from '../division/km.js';
import { farmGround, farmRun, HA_PER_PERSON, FARM_REACH } from './farmland.js';

export const RCAP = 2.2;                                            // km: the largest settlement the album founds
// radius of a place at full growth, km, from the people who live there today: a hamlet of a few yards (300 people
// and fewer), a village (15 000: what is a small town today was a village then), up to a great city
export function fullRadius(pop) {
  if (pop < 15000) return .05 + .07 * Math.max(0, Math.min(1, Math.log(Math.max(pop, 1) / 300) / Math.log(50)));
  const l = Math.max(0, Math.min(1, Math.log(pop / 15000) / Math.log(5.6e6 / 15000)));
  return .12 + 1.5 * l ** 1.6;
}
// The places the model founds once the land is divided into districts (the owner, 12.11.2026: «город всегда в центре
// района»): the places of the album first, their numbers unchanged, then the centre of every other land district —
// the real town or village that stands there (division/centres.js, town/sites.js), or a hamlet where none does.
// base: [{ lat, lon, pop, name }]; div: the division with div.centres; sites: the list the centres were chosen from,
// which begins with the places of base
export const HAMLET_POP = 250;
export function centrePlaces(base, div, sites = []) {
  const out = base.slice(), c = div?.centres; if (!c) return out;
  for (let d = 0; d < div.count; d++) {
    if (div.kinds[d] !== 0 || c.texel[d] < 0) continue;
    const s = c.site[d]; if (s >= 0 && s < base.length) continue;            // a place of the album: in the list already
    const q = llOf(c.x[d], c.y[d]);
    out.push({ lat: q.lat, lon: q.lon, pop: s >= 0 ? sites[s].pop : HAMLET_POP, name: s >= 0 ? sites[s].name || '' : '', district: d });
  }
  return out;
}
// A hamlet and a village clear only the ground of their houses and fields (the picture of the fields does that); from
// this radius on a settlement also thins the forest of the natural cells its fields lie in: for every km² it ploughs
// it fells FELL km² of the forest around
export const FELL_FROM = .15, FELL = 1.2;
// a natural cell that holds any fields holds at least this share of them: the forest and the far view read the share
// of the cell, and a byte must not round a few fields down to none
export const FIELD_FLOOR = .006;
export const KEEP_OFF = .25;                                        // km of open ground between the last houses of a town and a village
export const MERGE_GAP = .3;                                        // km: two towns whose last houses are nearer than this are one town
export const RMERGED = 3;                                           // km: the largest radius of towns grown together

// A town grows from its site toward the water (the owner, 13.11.2026: «город должен стоять логично, ближе к морю… у
// моря — гавань»; the site itself belongs to the district and is not moved). The middle of the town lies off its
// site: toward the sea, if the shore is near, until the last houses stand on it — and a town whose site is on the
// very shore grows inland, along its harbour; else toward a river that runs near, until the houses reach its bank.
//   at(x, y) → metres · river(x, y) → km to the bank of the nearest river · x, y: the site · R: the radius, km
// → [sx, sy], km: the shift as the two bytes of the texture hold it (rules.js shiftByte), so that the plan and the
//   shader place the middle alike
export function towardWater(at, river, x, y, R) {
  if (R < SHIFT_FROM) return [0, 0];
  const most = Math.min(SHIFT_MAX, SHIFT_SHARE * R), held = (dx, dy, d) => [shiftOf(shiftByte(dx * d)), shiftOf(shiftByte(dy * d))];
  let near = 1e9, nx = 0, ny = 0;
  for (let a = 0; a < 24; a++) {                                    // the sea: the nearest shore along twenty-four rays
    const dx = Math.cos(a * .2617994), dy = Math.sin(a * .2617994);
    for (let d = .05; d < Math.min(near, 1.5 * R + .5); d += .05) if (at(x + dx * d, y + dy * d) <= 0) { near = d; nx = dx; ny = dy; break; }
  }
  if (near < 1e8) return held(nx, ny, Math.max(-most, Math.min(most, near - SHORE_AT * R)));
  const d = river(x, y); if (!(d < 1.5 * R + .3) || d <= R * 1.1 + .03) return [0, 0];   // (a site too near a river was moved off it already)
  const e = .05, gx = river(x + e, y) - river(x - e, y), gy = river(x, y + e) - river(x, y - e), gl = Math.hypot(gx, gy); if (gl < 1e-6) return [0, 0];
  return held(-gx / gl, -gy / gl, Math.min(most, d - R * 1.05));
}

// Where nobody can settle, no village is founded; where only a hamlet can stand, a village stays a hamlet (the owner,
// 13.11.2026: «отметить все места, где поселиться нельзя»; the division marks the chunks: km.js chunkSettle). The
// town of a district stands where the division put it. The places keep their numbers: a village that may not be
// founded stays in the list with no size.
//   canAt(place) → 2 a town or a village may stand there · 1 a hamlet only · 0 nobody
export const HAMLET_ONLY_R = .095;                                  // km: under the radius of a village (STAGES)
export function placesAllowed(places, canAt) {
  return places.map(pl => {
    if (!pl.village) return pl;
    const can = canAt(pl); if (can >= 2) return pl;
    return { ...pl, r: can === 1 ? Math.min(pl.r ?? fullRadius(pl.pop), HAMLET_ONLY_R) : 0 };
  });
}

// One town to a district: of the places given as towns, only the one at the centre of its district stays a town; any
// other becomes a village of that district (it keeps its number, its name and its people, and stops at VILLAGE_RMAX).
//   places      [{ lat, lon, pop, village, district, site }]
//   districtOf  (place, index) → { district, site } (site 0 is the centre of the district) or null: a place that lies
//               in no district of land stays as it is
// → a new list, the places in the same order
export function townsOfDistricts(places, districtOf) {
  return places.map((pl, i) => {
    if (pl.village) return pl;
    const s = districtOf(pl, i); if (!s || !(s.site > 0)) return pl;
    return { ...pl, village: true, district: s.district, site: s.site };
  });
}

// the nearest dry point to (x, y) within 4 km, or null
export function landNear(at, x, y) {
  if (at(x, y) > 2) return [x, y];
  for (let r = .2; r <= 4; r += .2) for (let a = 0; a < 12; a++) {
    const px = x + r * Math.cos(a * .5236), py = y + r * Math.sin(a * .5236);
    if (at(px, py) > 2) return [px, py];
  }
  return null;
}
// the chunks that can be reached from `home` over land in `steps` steps without crossing a river greater than `ford`
export function reachOf(ch, home, steps, ford) {
  const seen = new Map([[home, 0]]), q = [home];
  for (let n = 0; n < q.length; n++) {
    const c = q[n], d = seen.get(c); if (d >= steps) continue;
    for (const l of ch.links[c]) if (!seen.has(l.k) && ch.kind[l.k] === 1 && l.river <= ford) { seen.set(l.k, d + 1); q.push(l.k); }
  }
  return seen;
}

// places: [{ lat, lon, pop, village (true for a village), r (its radius at full growth, km, when not from pop) }];
// growth: the knob; at(xKm, yKm) → metres; river(xKm, yKm) → km to the nearest river bank;
// farm: { ground (farmland.js farmGround(): what the chunks of 1 km² can give; made here when left out),
//         ha (hectares of fields a person lives from) }
// → { built, fields, keep (share of the forest left) — for the natural cells;
//     farm: { km (the share of every chunk of 1 km² under fields, a byte), list, area, … } (farmland.js),
//     towns: [{ index, x, y (its site), R, sx, sy (where its middle lies from its site: towardWater()), stage, home,
//               byte, people, cls, ploughed (km² of its fields),
//               town (true: the town of its district), merged (the places of the towns it has taken in),
//               village (true: it lies in the fine grid), fine (its square of the fine grid) }] }
export function growTowns(ch, places, growth, at, river = () => 1e9, farm = {}) {
  const n = ch.count, built = new Float32Array(n), fields = new Float32Array(n), keep = new Float32Array(n).fill(1), taken = new Set(), takenFine = new Set(), byGrid = new Map(), towns = [];
  const ground = farm.ground || farmGround(ch, at), run = farmRun(ground), perPerson = (farm.ha ?? HA_PER_PERSON) / 100;
  const order = places.map((_, i) => i).sort((a, b) => places[b].pop - places[a].pop), coarse = new Set();
  const byteOf = (R, home) => Math.max(1, Math.min(255, Math.round(Math.PI * R * R / ch.area[home] * 255)));
  // town T takes in the town of place `index`, whose radius would have been R: the built-up land of both, one centre
  const absorb = (T, index, R) => {
    const R2 = Math.min(RMERGED, Math.hypot(T.R, R)), more = peopleOf(R2) - T.people;
    T.R = R2; T.stage = stageOf(R2); T.byte = byteOf(R2, T.home); built[T.home] = Math.max(built[T.home], T.byte / 255);
    [T.sx, T.sy] = towardWater(at, river, T.x, T.y, R2);
    (T.merged || (T.merged = [])).push(index);
    if (more > 0) { T.people += more; if (perPerson > 0) T.ploughed += run.claim(T.x, T.y, more * perPerson, FARM_REACH[1], reachOf(ch, T.home, 4, 1), FELL); }
    T.cls = classOf(T.people, Math.PI * R2 * R2);
  };
  for (const index of order) {
    const pl = places[index]; let vil = !!pl.village, R = Math.min(vil ? VILLAGE_RMAX : RCAP, (pl.r ?? fullRadius(pl.pop)) * growth);
    if (R < .04) continue;
    const dry = landNear(at, ...kmOf(pl.lat, pl.lon)); if (!dry) continue;
    let [x, y] = dry;
    for (let pass = 0; pass < 3; pass++) {                          // off the river: the houses reach the bank and stop there
      const d = river(x, y), need = R * 1.1 + .03; if (d >= need) break;
      const e = .05, gx = river(x + e, y) - river(x - e, y), gy = river(x, y + e) - river(x, y - e), gl = Math.hypot(gx, gy); if (gl < 1e-6) break;
      const nx = x + gx / gl * (need - d), ny = y + gy / gl * (need - d); if (at(nx, ny) <= 2) break;
      x = nx; y = ny;
    }
    const p = llOf(x, y), home = ch.at(p.lat, p.lon);
    if (home < 0 || ch.kind[home] !== 1) continue;
    const gi = Math.floor((x - GX0) / GK), gj = Math.floor((y - GY0) / GK); let fine = -1, sx = 0, sy = 0;
    if (!vil) {
      [sx, sy] = towardWater(at, river, x, y, R);                   // where the middle of the town lies: toward the water
      // two towns grown together are one town: the greater was founded first, keeps its centre and takes the people
      // of this one
      let into = null;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const T of byGrid.get((gj + dj) * 4096 + gi + di) || []) if (Math.hypot(T.x + T.sx - x - sx, T.y + T.sy - y - sy) < T.R + R + MERGE_GAP && (!into || T.R > into.R)) into = T;
      if (into) { absorb(into, index, R); continue; }
      // one town a natural cell and a square of the coarse grid (the texture holds no more): a second one, the town of
      // another district, lies in the fine grid as a village does, and is no larger than that grid allows
      if (taken.has(home) || coarse.has(gj * 4096 + gi)) { vil = true; R = Math.min(R, FINE_RMAX); sx = sy = 0; }
      else { taken.add(home); coarse.add(gj * 4096 + gi); }
    }
    if (vil) {                                                      // one village a square of the fine grid, and none where a town stands
      const vi = Math.floor((x - GX0) / VK), vj = Math.floor((y - GY0) / VK); if (vi < 0 || vj < 0 || vi >= VN || vj >= VN) continue;
      fine = vj * VN + vi; if (takenFine.has(fine)) continue;
      let inTown = false;
      for (let dj = -1; dj <= 1 && !inTown; dj++) for (let di = -1; di <= 1; di++) for (const T of byGrid.get((gj + dj) * 4096 + gi + di) || []) if (Math.hypot(T.x + T.sx - x, T.y + T.sy - y) < T.R + R + KEEP_OFF) inTown = true;
      if (inTown) continue;
      takenFine.add(fine);
    }
    const byte = vil ? 1 : byteOf(R, home);
    built[home] = Math.max(built[home], byte / 255);
    // its fields: the chunks of 1 km² nearest to the houses, over land, not across a great river
    const people = peopleOf(R), ploughed = perPerson > 0 ? run.claim(x, y, people * perPerson, FARM_REACH[vil ? 0 : 1], reachOf(ch, home, vil ? 2 : 4, 1), R >= FELL_FROM ? FELL : 0) : 0;
    const town = { index, x, y, R, sx, sy, stage: stageOf(R), home, byte, people, cls: classOf(people, Math.PI * R * R), ploughed };
    if (!pl.village) town.town = true;                              // the town of its district, whichever grid it lies in
    if (vil) { town.village = true; town.fine = fine; }
    else { const key = gj * 4096 + gi; (byGrid.get(key) || byGrid.set(key, []).get(key)).push(town); }
    towns.push(town);
  }
  // what the natural cells hold: the fields of their chunks, and the forest that had to make room
  const state = run.done();
  for (let k = 0; k < n; k++) {
    const a = state.cellArea[k]; if (!(a > 0)) continue;
    const all = Math.max(1, ground.count[k]);                       // chunks of 1 km² in the cell
    fields[k] = Math.max(FIELD_FLOOR, Math.min(1, a / all));
    keep[k] = Math.max(0, 1 - state.cellFelled[k] / all);
  }
  return { built, fields, keep, towns, farm: state, ground };
}

// Which settlement every chunk of 1 km² is built up by (the owner, 13.11.2026: «чанк города такого-то»). A chunk
// belongs to the settlement whose houses cover the most of it (sixteen points of the square of the chunk are looked
// at; a settlement needs two of them); a settlement always holds the chunk its own site lies in, unless a greater one
// stands there. The area of a settlement is the number of its chunks.
//   towns    growTowns().towns
//   land(c)  is the chunk of square c land? (may be left out: then every square counts)
// → { owner: Map(chunk → index into towns), chunks: Int32Array (towns.length: how many chunks each holds) };
//   every town gets .chunks, and its class is raised if it sprawls (rules.js classOf)
export function builtChunks(towns, land = null) {
  const owner = new Map(), share = new Map(), chunks = new Int32Array(towns.length);
  const take = (c, n, sh) => { if (land && !land(c)) return; const old = share.get(c); if (old !== undefined && old >= sh) return; share.set(c, sh); owner.set(c, n); };
  const order = towns.map((_, n) => n).sort((a, b) => towns[b].R - towns[a].R || a - b);
  for (const n of order) {
    const t = towns[n], mx = t.x + (t.sx || 0), my = t.y + (t.sy || 0);   // the houses lie around the middle of the settlement
    const i0 = Math.floor((mx - t.R - KX0) / KKM), i1 = Math.floor((mx + t.R - KX0) / KKM), j0 = Math.floor((my - t.R - KY0) / KKM), j1 = Math.floor((my + t.R - KY0) / KKM);
    const si = Math.floor((t.x - KX0) / KKM), sj = Math.floor((t.y - KY0) / KKM);
    for (let j = Math.max(0, j0); j <= Math.min(KN - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(KN - 1, i1); i++) {
      let hit = 0;
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) if (Math.hypot(KX0 + (i + (a + .5) / 4) * KKM - mx, KY0 + (j + (b + .5) / 4) * KKM - my) < t.R) hit++;
      if (hit >= 2) take(j * KN + i, n, hit / 16);
      else if (i === si && j === sj) take(j * KN + i, n, .06 + Math.min(.05, t.R * .1));   // its own chunk: the least share there is, the greater hamlet first
    }
  }
  for (const n of owner.values()) chunks[n]++;
  towns.forEach((t, n) => { t.chunks = chunks[n]; t.cls = Math.max(t.cls, classOf(t.people, chunks[n])); });
  return { owner, chunks };
}
