// How settlements grow, as numbers of chunks. A place has a size; the size times the «Рост городов» knob is the radius
// of its settlement, at its real size: хутор → деревня → село → городок → город (STAGES in rules.js). From the radius
// the model works out what the chunks around hold: the share under houses (`built`), under fields (`fields`), and
// how much of the natural forest still stands. It only returns numbers — the layer writes them into the chunks.
//
// Chunks have natural outlines (docs/ALBUM-CHUNKS.md), so the model walks from chunk to chunk by their links: fields
// and felling spread from the chunk of the settlement to its neighbours over land, and a great river stops them.
// A settlement by a river stands on one bank: its site is moved off the water until its houses touch the bank.
import { FKM, FN, kmOf, llOf } from '../chunks.js';
import { GX0, GY0, stageOf, fieldsBeyond, peopleOf, classOf } from './rules.js';

export const RCAP = 2.2;                                            // km: the largest settlement the album founds
// radius of a place at full growth, km: the smallest places of the data are villages, the largest a great city
export function fullRadius(pop) {
  const l = Math.max(0, Math.min(1, Math.log(Math.max(pop, 1) / 15000) / Math.log(5.6e6 / 15000)));
  return .12 + 1.5 * l ** 1.6;
}
// how far the felling reaches beyond the fields, km
export const fellBeyond = r => .3 + .5 * r;

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

// places: [{ lat, lon, pop }]; growth: the knob; at(xKm, yKm) → metres; river(xKm, yKm) → km to the nearest river bank
// → { built, fields, keep (share of the forest left), towns: [{ index, x, y, R, stage, home, byte, people, cls }] }
export function growTowns(ch, places, growth, at, river = () => 1e9) {
  const n = ch.count, built = new Float32Array(n), fields = new Float32Array(n), keep = new Float32Array(n).fill(1), taken = new Set(), towns = [];
  const order = places.map((_, i) => i).sort((a, b) => places[b].pop - places[a].pop);
  for (const index of order) {
    const pl = places[index], R = Math.min(RCAP, fullRadius(pl.pop) * growth);
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
    if (home < 0 || ch.kind[home] !== 1 || taken.has(home)) continue;   // one settlement a chunk: the larger came first
    taken.add(home);
    const byte = Math.max(1, Math.min(255, Math.round(Math.PI * R * R / ch.area[home] * 255)));
    built[home] = Math.max(built[home], byte / 255);
    // fields around the houses, the forest felled a little further out: over land, from chunk to chunk, not across a great river
    const Rf = R + fieldsBeyond(R), Rc = Rf + fellBeyond(R), far = Rc * 1.5, ok = reachOf(ch, home, 4, 1), sum = new Map();
    const tx0 = Math.max(0, Math.floor((x - far - GX0) / FKM)), tx1 = Math.min(FN - 1, Math.floor((x + far - GX0) / FKM)), ty0 = Math.max(0, Math.floor((y - far - GY0) / FKM)), ty1 = Math.min(FN - 1, Math.floor((y + far - GY0) / FKM));
    const part = (rad, d) => Math.max(0, Math.min(1, (rad - d) / FKM + .5));   // how much of a texel of the fine raster lies within a radius
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const c = ch.cell[ty * FN + tx]; if (!ok.has(c)) continue;
      const cx = GX0 + (tx + .5) * FKM, cy = GY0 + (ty + .5) * FKM, d = Math.hypot(cx - x, cy - y); if (d > far + FKM) continue;
      const h = at(cx, cy); if (h <= 1) continue;
      const s = sum.get(c) || sum.set(c, [0, 0]).get(c);
      const flat = h < 1500 && Math.hypot(at(cx + .5, cy) - at(cx - .5, cy), at(cx, cy + .5) - at(cx, cy - .5)) / 1000 < .2;
      if (flat) s[0] += FKM * FKM * (part(Rf, d) - part(R, d));
      s[1] += FKM * FKM * (part(Rc, d) + .5 * (part(far, d) - part(Rc, d)));
    }
    for (const [c, s] of sum) { fields[c] = Math.max(fields[c], Math.min(1, s[0] / ch.area[c]) * .95); keep[c] = Math.min(keep[c], Math.max(0, 1 - s[1] / ch.area[c])); }
    const people = peopleOf(R);
    towns.push({ index, x, y, R, stage: stageOf(R), home, byte, people, cls: classOf(people, Math.PI * R * R) });
  }
  return { built, fields, keep, towns };
}
