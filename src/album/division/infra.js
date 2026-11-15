// The level of infrastructure of a chunk of 1 km² (the owner, 15.11.2026: «Надо прописать все уровни в чанки
// инфраструктур. Можно там дорогу построить, не можно»): what can be laid through it — a main road, a lesser road, a
// track or nothing. The rule and its limits belong to the roads (roads/infra.js: the ease of a chunk, the limits the
// network is laid by), so that what a chunk says and the roads drawn over it never part; on the page the levels come
// from album.roadNet.infra(), which also lifts a chunk to the road that really runs through it. Here: the words, and
// the rule the owner liked («через некоторые районы невозможно проложить главную дорогу… это крутая будет механика»):
// a main road can be laid through a district when a band of its chunks of the main level joins two of its neighbours.
import { LEVEL, infraLevels } from '../roads/infra.js';
import { KN as FN, KKM } from './km.js';
import { LAND } from './build.js';

export { LEVEL };
// by level (0 nothing … 3 a main road): what can be laid, after «можно проложить»; the road that runs through
export const INFRA_CAN = ['ничего', 'только тропу', 'малую дорогу', 'главную дорогу'];
export const ROAD_KIND = ['', 'тропа', 'малая дорога', 'главная дорога'];

// 1 where a chunk is land
export function landOf(div) {
  const land = new Uint8Array(FN * FN);
  for (let t = 0; t < land.length; t++) { const d = div.cells[t]; land[t] = d >= 0 && div.kinds[d] === LAND ? 1 : 0; }
  return land;
}
// the levels as the roads work them out, without the roads that are laid (before the network is there, and in Node)
export const chunkLevels = (div, roads = null) => infraLevels(div.raster.hgt, landOf(div), FN, KKM, roads);

// div: the division; levels: a level a chunk → Uint8Array a district: 1 when a main road can be laid through it — its
// chunks of the main level (4-neighbours, inside the district) hold one band that touches chunks of the main level of
// two different neighbouring land districts; 0 otherwise (and for water, and for a district with one land neighbour)
export function mainThrough(div, levels) {
  const n = FN * FN, cells = div.cells, seen = new Uint8Array(n), out = new Uint8Array(div.count), stack = [];
  for (let t = 0; t < n; t++) {
    if (levels[t] !== LEVEL.main || seen[t]) continue;
    const d = cells[t]; if (d < 0 || div.kinds[d] !== LAND || out[d]) { seen[t] = 1; continue; }
    const touch = new Set(); seen[t] = 1; stack.push(t);
    while (stack.length) {
      const u = stack.pop(), ux = u % FN, uy = (u - ux) / FN;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = ux + dx, y = uy + dy; if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
        const v = y * FN + x, e = cells[v]; if (levels[v] !== LEVEL.main) continue;
        if (e === d) { if (!seen[v]) { seen[v] = 1; stack.push(v); } } else if (e >= 0 && div.kinds[e] === LAND) touch.add(e);
      }
    }
    if (touch.size >= 2) out[d] = 1;
  }
  return out;
}
