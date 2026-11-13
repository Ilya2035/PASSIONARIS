// A trial of how the land and its settlements go into a save: the proposal of docs/SAVE-LAND.md made runnable, so that
// its sizes are measured and not guessed. It is not the game's format yet — nothing reads these sections but the tests.
//
// What is kept is only what cannot be worked out again. The relief, the rivers, the division into districts, the
// centres of districts, the natural state of every chunk — all of that comes from the game's data and its rules, the
// same every time. Where each house stands, which furlong is ploughed, which chunk of a district is felled first —
// that too is worked out, from the numbers kept here:
//
//   district    how much of its natural forest stands, how much of it is ploughed, grazed, built on, burnt, how old
//               the last change is; how many settlements it has and how many of its chunks carry
//               farmsteads                                                                               9 bytes
//   settlement  every one of them, a hamlet as much as a city (the owner, 12.11.2026: «хранить каждую»): which site
//               of its district, who built it, its people, what stands in it (walls, a temple, a market …), when it
//               was founded. Its district is not written: settlements lie in the order of their districts 8 bytes
//   farmsteads  every single yard among the fields (the owner, 12.11.2026: «хранить и дворы», then «гуще, поднять
//               границу»). They are kept chunk by chunk: a chunk of ploughed land has sixteen places for a yard,
//               and two bytes say which of them are taken. So a yard is one bit of its own — it stands or it does
//               not — and however thickly the yards stand, the cost is the ploughed land.        2 bytes a chunk
//               A district where yards stand thinly keeps them as a list instead, whichever is shorter: the chunk
//               (12 bits) and the place in it (4 bits) of every yard.                              2 bytes a yard
//               Only the chunks of farmland are counted (those ploughed enough to carry a yard: the fields are
//               worked out from the settlements, farmland.js), in the order the district takes up its land
//               (division/km.js districtOrder: from its centre outward, level ground first): the first N of them
//               carry yards, and N is kept with the district.
//   road        for every pair of neighbouring districts a road may join: none, track, road, main road   2 bits
//   exception   a chunk that does not follow the rule of its district (a burnt wood, a mine): the district, the
//               chunk in it, what and how much                                                           8 bytes
//
// The sections are those of the game's save container (src/save/saveSystem.js): named typed arrays.
// This file has no imports: the tests and scripts read it.

export const LAND_FORMAT = 5;
// The version of the rules that turn these numbers into a picture. A save made under other rules is still read, but
// its houses and fields may stand elsewhere: the numbers hold, the drawing follows the rules of the day.
export const GENERATOR = 1;
export const STRUCTURES = ['walls', 'temple', 'market', 'fort', 'port', 'mill', 'palace', 'bridge', 'school', 'works'];   // bits of what stands in a settlement
export const ROAD_LEVELS = ['none', 'track', 'road', 'main'];
export const EXCEPTIONS = ['burnt', 'cleared', 'mine', 'quarry', 'fortress', 'ruin'];
export const MAX_IN_DISTRICT = 255;                // settlements a district can hold: its count is one byte
export const YARD_SLOTS = 16;                      // places for a farmstead in a chunk of 1 km²: a lattice of 250 m
export const YARD_CHUNKS = 32767;                  // chunks of a district that can carry farmsteads: their count is fifteen bits
export const YARD_LIST = 0x8000;                   // the mark of a district that keeps its yards as a list
export const YARD_LIST_CHUNKS = 4096;              // … which it can do while the chunk of every yard fits twelve bits

// people ↔ two bytes: eleven bits of the number and five of its order. Exact up to 2 047, then to one part in a thousand
export function peopleCode(n) {
  n = Math.max(0, Math.round(n)); if (n <= 2047) return n;
  let e = Math.floor(Math.log2(n)) - 10, m = Math.round(n / 2 ** e);
  if (m > 2047) { e++; m = Math.round(n / 2 ** e); }
  return m | Math.min(e, 31) << 11;
}
export const peopleOf = c => (c & 2047) * 2 ** (c >> 11);
const byte = v => Math.max(0, Math.min(255, Math.round(v * 255)));

// world: { districts: [{ forest, fields, pasture, built, burnt (0..1), age (years, 0..255) }],
//          settlements: [{ district, site, people, structures (bits of STRUCTURES), culture, founded (year) }],
//          farmsteads: [{ district, chunk (its number in the order the land of the district is taken up, from 0),
//                         slot (0 .. YARD_SLOTS − 1) }] (may be left out),
//          roads: [level for every possible leg], exceptions: [{ district, chunk, kind, value (0..255) }] }
// → sections for encodeSave(): name → typed array or JSON
export function packLand(world) {
  const D = world.districts.length, N = world.settlements.length, R = world.roads.length, X = world.exceptions.length;
  const use = new Uint8Array(D * 6), count = new Uint8Array(D);
  world.districts.forEach((d, i) => {                               // one number after another for all districts: neighbours are alike, so it packs well
    use[i] = byte(d.forest); use[D + i] = byte(d.fields); use[2 * D + i] = byte(d.pasture); use[3 * D + i] = byte(d.built); use[4 * D + i] = byte(d.burnt); use[5 * D + i] = Math.max(0, Math.min(255, d.age | 0));
  });
  const site = new Uint8Array(N), culture = new Uint8Array(N), people = new Uint16Array(N), structures = new Uint16Array(N), founded = new Int16Array(N);
  [...world.settlements].sort((a, b) => a.district - b.district || a.site - b.site).forEach((s, i) => {
    if (!(s.district >= 0 && s.district < D)) throw new RangeError(`a settlement in district ${s.district} of ${D}`);
    if (count[s.district] >= MAX_IN_DISTRICT) throw new RangeError(`more than ${MAX_IN_DISTRICT} settlements in district ${s.district}`);
    count[s.district]++;
    site[i] = s.site; culture[i] = s.culture; people[i] = peopleCode(s.people); structures[i] = s.structures; founded[i] = s.founded;
  });
  // farmsteads: for every district either the map of its chunks, as many as reach the last one that carries a yard,
  // two bytes a chunk — or, where that is longer, the list of its yards, two bytes a yard
  const farms = world.farmsteads || [], yardChunks = new Uint16Array(D), reach = new Uint32Array(D), per = new Map();
  for (const y of farms) {
    if (!(y.district >= 0 && y.district < D && y.chunk >= 0 && y.chunk < YARD_CHUNKS && y.slot >= 0 && y.slot < YARD_SLOTS)) throw new RangeError(`a farmstead out of bounds: district ${y.district}, chunk ${y.chunk}, place ${y.slot}`);
    if (y.chunk + 1 > reach[y.district]) reach[y.district] = y.chunk + 1;
    (per.get(y.district) || per.set(y.district, new Set()).get(y.district)).add(y.chunk << 4 | y.slot);
  }
  const words = new Uint32Array(D + 1), listed = new Uint8Array(D);
  for (let d = 0; d < D; d++) {
    const n = per.get(d)?.size || 0;
    listed[d] = n > 0 && n < reach[d] && reach[d] <= YARD_LIST_CHUNKS && n < YARD_LIST ? 1 : 0;
    yardChunks[d] = listed[d] ? YARD_LIST | n : reach[d]; words[d + 1] = words[d] + (listed[d] ? n : reach[d]);
  }
  const yards = new Uint16Array(words[D]);
  for (const [d, set] of per) { if (listed[d]) yards.set([...set].sort((a, b) => a - b), words[d]); else for (const v of set) yards[words[d] + (v >> 4)] |= 1 << (v & 15); }
  const roads = new Uint8Array(Math.ceil(R / 4)); world.roads.forEach((lv, i) => { roads[i >> 2] |= (lv & 3) << (i & 3) * 2; });
  const xd = new Uint32Array(X), xc = new Uint16Array(X), xk = new Uint8Array(X), xv = new Uint8Array(X);
  world.exceptions.forEach((x, i) => { xd[i] = x.district; xc[i] = x.chunk; xk[i] = x.kind; xv[i] = x.value; });
  return { 'land/head': { format: LAND_FORMAT, generator: GENERATOR, districts: D, settlements: N, farmsteads: farms.length, roads: R, exceptions: X },
    'land/use': use, 'land/count': count, 'land/yardChunks': yardChunks, 'land/yards': yards,
    'land/s.site': site, 'land/s.culture': culture, 'land/s.people': people, 'land/s.structures': structures, 'land/s.founded': founded,
    'land/roads': roads, 'land/x.of': xd, 'land/x.chunk': xc, 'land/x.kind': xk, 'land/x.value': xv };
}
export function unpackLand(s) {
  const h = s['land/head'], D = h.districts, use = s['land/use'], count = s['land/count'];
  const districts = Array.from({ length: D }, (_, i) => ({ forest: use[i] / 255, fields: use[D + i] / 255, pasture: use[2 * D + i] / 255, built: use[3 * D + i] / 255, burnt: use[4 * D + i] / 255, age: use[5 * D + i] }));
  const settlements = []; let i = 0;
  for (let d = 0; d < D; d++) for (let k = 0; k < count[d]; k++, i++) settlements.push({ district: d, site: s['land/s.site'][i], people: peopleOf(s['land/s.people'][i]),
    structures: s['land/s.structures'][i], culture: s['land/s.culture'][i], founded: s['land/s.founded'][i] });
  const farmsteads = []; let y = 0;
  for (let d = 0; d < D; d++) {
    const n = s['land/yardChunks'][d];
    if (n & YARD_LIST) for (let i = 0; i < (n & YARD_LIST - 1); i++, y++) { const v = s['land/yards'][y]; farmsteads.push({ district: d, chunk: v >> 4, slot: v & 15 }); }
    else for (let c = 0; c < n; c++, y++) { const m = s['land/yards'][y]; for (let slot = 0; slot < YARD_SLOTS; slot++) if (m >> slot & 1) farmsteads.push({ district: d, chunk: c, slot }); }
  }
  const roads = Array.from({ length: h.roads }, (_, j) => (s['land/roads'][j >> 2] >> (j & 3) * 2) & 3);
  const exceptions = Array.from({ length: h.exceptions }, (_, j) => ({ district: s['land/x.of'][j], chunk: s['land/x.chunk'][j], kind: s['land/x.kind'][j], value: s['land/x.value'][j] }));
  return { format: h.format, generator: h.generator, districts, settlements, farmsteads, roads, exceptions };
}
// bytes of the sections before packing: what each part of the land costs
export function landBytes(sections) {
  const size = k => (sections[k].byteLength ?? 0), sum = keys => keys.reduce((a, k) => a + size(k), 0);
  return { districts: sum(['land/use', 'land/count', 'land/yardChunks']), settlements: sum(['land/s.site', 'land/s.culture', 'land/s.people', 'land/s.structures', 'land/s.founded']), farmsteads: size('land/yards'),
    roads: size('land/roads'), exceptions: sum(['land/x.of', 'land/x.chunk', 'land/x.kind', 'land/x.value']) };
}

// The number of every chunk among the chunks of farmland of its district: those at least `least` under fields
// (km: a byte a chunk, farmland.js), in the order the district takes up its land. order: km.js districtOrder().
// → Int32Array, −1 for a chunk that is no farmland
export function farmRank(order, km, least = 0) {
  const rank = new Int32Array(km.length).fill(-1), min = Math.max(1, Math.ceil(least * 255 - 1e-9));
  for (let d = 0; d + 1 < order.first.length; d++) { let r = 0; for (let q = order.first[d]; q < order.first[d + 1]; q++) { const c = order.list[q]; if (km[c] >= min) rank[c] = r++; } }
  return rank;
}
// The farmsteads of the album as such a save keeps them (town/yards.js draws them). A yard stands at one of the
// sixteen places of a chunk of 1 km² (division/km.js): the chunk is the square (kx, ky) of the lattice of n × n
// squares its place lies in. yards: [{ kx, ky, slot }]; cells: the district of every chunk; rank: the number of every
// chunk among the chunks of its district that are counted — its farmland (farmRank), or all its chunks in the order
// the district takes up its land (km.js districtOrder().rank); −1 for a chunk that is not counted: no yard stands there.
// → [{ district, chunk, slot }], chunk = that number
export function farmsteadsOfAlbum(yards, { cells, rank, n }) {
  const out = [];
  for (const y of yards) { const c = y.ky * n + y.kx, r = rank[c]; if (r >= 0) out.push({ district: cells[c], chunk: r, slot: y.slot }); }
  return out;
}

// The world of the album as such a save sees it. div: the division; model: growTowns(): its fields are the state of
// the chunks of 1 km² (model.farm), its forest and houses are still counted by the natural cells of chunks.js;
// cellOf: the natural cell of every chunk of 1 km² (km.js cellsOfChunks().cell) — a district is its chunks
// (div.cells), and each brings the forest and the houses of its cell and its own fields;
// places: what the model was given; legs: roadNetwork().legs (kind 0 main, 1 lesser, 2 track, 3 no road);
// districtOf(x, y) → the district of a point; cultureOf(place) → a number; farmsteads: farmsteadsOfAlbum();
// siteOf(town) → { district, site }: which place of the list of its district the settlement stands on
// (town/villages.js; 0 is the centre). Without it the settlements of a district are numbered as they come.
export function landOfAlbum({ div, model, places, legs, districtOf, cellOf, cultureOf = () => 1, farmsteads = [], siteOf = null }) {
  const D = div.count, sum = Array.from({ length: D }, () => [0, 0, 0, 0]), cells = div.cells, N = model.keep.length;
  const km = model.farm ? model.farm.km : null;
  for (let c = 0; c < cells.length; c++) { const d = cells[c], k = cellOf[c]; if (d < 0 || k >= N) continue; const s = sum[d]; s[0]++; s[1] += model.keep[k]; s[2] += km ? km[c] / 255 : model.fields[k]; s[3] += model.built[k]; }
  const districts = sum.map(s => ({ forest: s[0] ? s[1] / s[0] : 1, fields: s[0] ? s[2] / s[0] : 0, pasture: 0, built: s[0] ? s[3] / s[0] : 0, burnt: 0, age: 0 }));
  const settlements = [], taken = new Uint8Array(D);
  for (const t of model.towns) {
    const known = siteOf ? siteOf(t) : null, d = known ? known.district : districtOf(t.x, t.y); if (d < 0) continue;
    const structures = (t.R >= .22 ? 2 : 0) | (t.R >= .4 ? 4 : 0) | (t.R >= .7 ? 8 : 0);            // a temple, a market, a fort: what the plan builds at these sizes
    // site 0 is the centre of the district; a settlement on no place of the list is counted from the far end
    settlements.push({ district: d, site: known ? known.site : siteOf ? MAX_IN_DISTRICT - taken[d]++ : taken[d]++, people: t.people, structures, culture: cultureOf(places[t.index]), founded: 0 });
  }
  return { districts, settlements, farmsteads, roads: legs.map(l => (l.kind === 0 ? 3 : l.kind === 1 ? 2 : l.kind === 2 ? 1 : 0)), exceptions: [] };
}
