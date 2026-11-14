// Borders nobody can cross (the lead's brief of the second step, 14.11.2026: «такая граница должна читаться как стена…
// чтобы перевал читался как ворота в ней»). The roads say where: between two neighbouring land districts the roads
// work out the cheapest way from town to town (roads/routes.js); where it costs far more than its length the mountain
// is impassable there and the two get no leg at all. So the walls are the borders of neighbours with no leg between
// them, read from album.roadNet every time the network is laid (the roads may move to the passes of history), never
// kept. Where a pass leads over a range its two districts have a leg: the wall has a gap there, a gate.
// Drawn in the division modes as a dark band with a brick-red core, over the border line it lies on.
import { LAND } from './build.js';
import { KN as FN } from './km.js';
import { makeRibbonsFor } from './lines.js';

const key = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);

// div: the division (cells, kinds, count); centres: div.centres; legs: album.roadNet.legs ({ a, b }) → [[a, b] …]: the
// land districts that touch (by two sides of chunks or more, as the roads count them) and have no leg between them
export function impassablePairs(div, centres, legs) {
  const touch = new Map(), cells = div.cells;
  for (let ty = 0; ty < FN - 1; ty++) for (let tx = 0; tx < FN - 1; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || div.kinds[d] !== LAND) continue;
    for (const u of [t + 1, t + FN]) { const e = cells[u]; if (e < 0 || e === d || div.kinds[e] !== LAND) continue; const k = key(d, e); touch.set(k, (touch.get(k) || 0) + 1); }
  }
  const has = new Set(legs.map(L => key(L.a, L.b))), out = [];
  for (const [k, sides] of [...touch].sort((p, q) => p[0] - q[0])) {
    if (sides < 2 || has.has(k)) continue;
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

// what a wall looks like: a dark band under a brick-red core, km on the ground and at least so many pixels
export const WALL = { w: .09, px: 7, dark: 0x120c08, core: { w: .035, px: 2.6, colour: 0xc2321e } };

// → { pairs, update(cam, dom, alpha), dispose() }
export function createWalls(album, geo, pairs) {
  const lines = wallLines(geo, pairs);
  const dark = makeRibbonsFor(album, lines, WALL.w, WALL.dark, WALL.px, 6.4), core = makeRibbonsFor(album, lines, WALL.core.w, WALL.core.colour, WALL.core.px, 6.5);
  return {
    pairs, km: lines.reduce((s, l) => { for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; }, 0),
    update(cam, dom, alpha) {
      for (const [m, a] of [[dark, alpha * .8], [core, alpha]]) { if (!m) continue; m.mesh.visible = a > .01; if (m.mesh.visible) { m.setPx(cam, dom); m.u.uAlpha.value = a; } }
    },
    dispose() { for (const m of [dark, core]) if (m) { album.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); } },
  };
}
