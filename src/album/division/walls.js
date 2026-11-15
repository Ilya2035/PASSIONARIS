// Borders nobody can cross (the lead's brief of the second step, 14.11.2026). The roads say where: between two
// neighbouring land districts the roads work out the cheapest way from town to town (roads/routes.js); where it costs
// far more than its length the mountain is impassable there and the two get no leg at all. So these are the borders of
// neighbours with no leg between them, read from album.roadNet every time the network is laid (the roads may move to
// the passes of history), never kept. A border a road crosses as it is drawn is not one of them either
// (album.roadNet.crossed): the road of a pass of history joins districts that do not touch and goes over the borders
// of those between, and a leg may cut the corner of a third district.
// They are data only (album.division.impassable()): from v0.6.82 they were drawn in the division modes as walls, and the
// owner took that back on 15.11.2026: «не надо визуализировать, мы это потом визуализируем уже в
// строительстве дорог». Troops will cross mountains, only few of them; whether a land can be passed is worked out
// later and is not this. The rule that some districts cannot be joined by a main road stays («это крутая будет механика»).
import { LAND } from './build.js';
import { KN as FN, KNY as FNY } from './km.js';

const key = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);

// div: the division (cells, kinds, count); centres: div.centres; legs: album.roadNet.legs ({ a, b }); crossed:
// album.roadNet.crossed (Set of a · 65536 + b, a < b: the borders a road goes over) → [[a, b] …]: the land districts
// that touch (by two sides of chunks or more, as the roads count them), have no leg between them and no road across
export function impassablePairs(div, centres, legs, crossed = null) {
  const touch = new Map(), cells = div.cells;
  for (let ty = 0; ty < FNY - 1; ty++) for (let tx = 0; tx < FN - 1; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || div.kinds[d] !== LAND) continue;
    for (const u of [t + 1, t + FN]) { const e = cells[u]; if (e < 0 || e === d || div.kinds[e] !== LAND) continue; const k = key(d, e); touch.set(k, (touch.get(k) || 0) + 1); }
  }
  const has = new Set(legs.map(L => key(L.a, L.b))), out = [];
  for (const [k, sides] of [...touch].sort((p, q) => p[0] - q[0])) {
    if (sides < 2 || has.has(k) || crossed?.has(k)) continue;
    const a = Math.floor(k / 65536), b = k % 65536;
    if (centres && (centres.texel[a] < 0 || centres.texel[b] < 0)) continue;     // a district with no town has no roads to ask
    out.push([a, b]);
  }
  return out;
}

// the pieces of the border lines between the districts of the pairs, joined into runs → [[[x, y] km …] …]
export function wallLines(geo, pairs) {
  const set = new Set(pairs.map(([a, b]) => key(a, b))), out = [];
  for (const L of geo.lines) {
    let run = null;
    for (let j = 0; j < L.labs.length; j++) {
      const l = L.labs[j];
      if (set.has(key(l & 0xFFFF, l >>> 16))) { if (!run) { run = [L.pts[j]]; out.push(run); } run.push(L.pts[j + 1]); } else run = null;
    }
  }
  return out;
}

// the borders of the pairs for the network the roads laid → { pairs, km }
export function wallsOf(div, net) {
  const pairs = impassablePairs(div, div.centres, net.legs, net.crossed), lines = wallLines(div.geo, pairs);
  return { pairs, km: lines.reduce((s, l) => { for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; }, 0) };
}
