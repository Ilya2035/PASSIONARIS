// How settlements grow, as numbers of chunks. A place has a size; the size times the «Рост городов» knob is the radius
// of its settlement: хутор → деревня → село → городок → город (STAGES in rules.js). From the radius the model works out
// what every chunk around holds: the share under houses (`built`), under fields (`fields`), and how much of the
// natural forest still stands. It only returns numbers — the layer writes them into the chunks, and the picture is
// then drawn from the chunks alone.
import { CHUNK_KM, CN, kmOf } from '../chunks.js';
import { RMAX, siteBytes, stageOf } from './rules.js';

export const RCAP = 9;                                              // km: the largest settlement the album draws
// radius of a place at full growth, km: the smallest places of the data are villages, the largest a great city
export function fullRadius(pop) {
  const l = Math.max(0, Math.min(1, Math.log(Math.max(pop, 1) / 15000) / Math.log(5.6e6 / 15000)));
  return .7 + 7.3 * l ** 1.6;
}
// how far the fields and the felling reach around a settlement of radius r, km
export const fieldReach = r => r + .6 + 1.15 * r;
export const fellReach = r => fieldReach(r) + .4 + .25 * r;

// 5 × 5 samples of every chunk: bit 0 land, bit 1 land that can be ploughed (not steep, not high)
export function sampleLand(ch, at) {
  const out = new Uint8Array(ch.count * 25), e = .6;
  for (let k = 0; k < ch.count; k++) {
    if (ch.land[k] <= 0) continue;
    const { i, j } = ch.ij(k);
    for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) {
      const x = (i + (a + .5) / 5) * CHUNK_KM, y = (j + (b + .5) / 5) * CHUNK_KM, h = at(x, y);
      if (h <= 1) continue;
      const slope = Math.hypot(at(x + e, y) - at(x - e, y), at(x, y + e) - at(x, y - e)) / (2 * e * 1000);
      out[k * 25 + b * 5 + a] = 1 | (slope < .2 && h < 1500 ? 2 : 0);
    }
  }
  return out;
}
// the nearest dry point to (x, y) within 4 km, or null
export function landNear(at, x, y) {
  if (at(x, y) > 2) return [x, y];
  for (let r = .4; r <= 4; r += .4) for (let a = 0; a < 12; a++) {
    const px = x + r * Math.cos(a * .5236), py = y + r * Math.sin(a * .5236);
    if (at(px, py) > 2) return [px, py];
  }
  return null;
}

// places: [{ lat, lon, pop }]; growth: the knob; at(xKm, yKm) → metres; land: sampleLand()
// → { built, fields, keep (share of the forest left), sites: Map chunk → [bx, by], towns: [{ index, x, y, R, stage, k, chunks }] }
export function growTowns(ch, places, growth, at, land) {
  const n = ch.count, built = new Float32Array(n), fields = new Float32Array(n), keep = new Float32Array(n).fill(1), sites = new Map(), towns = [];
  const order = places.map((_, i) => i).sort((a, b) => places[b].pop - places[a].pop);
  for (const index of order) {
    const pl = places[index], R = Math.min(RCAP, fullRadius(pl.pop) * growth);
    if (R < .3) continue;
    const dry = landNear(at, ...kmOf(pl.lat, pl.lon)); if (!dry) continue;
    const [x, y] = dry, ci = Math.floor(x / CHUNK_KM), cj = Math.floor(y / CHUNK_KM), k0 = ch.k(ci, cj);
    if (k0 < 0 || sites.has(k0)) continue;                          // one settlement per chunk: the larger came first
    built[k0] = Math.max(built[k0], (Math.min(R, RMAX) / RMAX) ** 2); sites.set(k0, siteBytes(x, y));
    const town = { index, x, y, R, stage: stageOf(R), k: k0, chunks: [k0] };
    // a town larger than a chunk can hold spills into its neighbours: each takes a lobe that reaches as far as R
    if (R > RMAX + .4) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const kn = ch.k(ci + di, cj + dj); if (kn < 0 || sites.has(kn) || ch.land[kn] < .3) continue;
      const x0 = (ci + di) * CHUNK_KM, y0 = (cj + dj) * CHUNK_KM, ux = x0 + 5 - x, uy = y0 + 5 - y, ul = Math.hypot(ux, uy);
      const qx = Math.max(x0 + .4, Math.min(x0 + CHUNK_KM - .4, x + ux / ul * R * .62)), qy = Math.max(y0 + .4, Math.min(y0 + CHUNK_KM - .4, y + uy / ul * R * .62));
      const rl = Math.min(RMAX, R - Math.hypot(qx - x, qy - y));
      if (rl < 1 || at(qx, qy) <= 2) continue;
      built[kn] = Math.max(built[kn], (rl / RMAX) ** 2); sites.set(kn, siteBytes(qx, qy)); town.chunks.push(kn);
    }
    // fields around the houses, the forest felled a little further out
    const Rf = fieldReach(R), Rc = fellReach(R), reach = Rc * 1.5, c0 = Math.floor((x - reach) / CHUNK_KM), c1 = Math.floor((x + reach) / CHUNK_KM), d0 = Math.floor((y - reach) / CHUNK_KM), d1 = Math.floor((y + reach) / CHUNK_KM);
    for (let j = d0; j <= d1; j++) for (let i = c0; i <= c1; i++) {
      const k = ch.k(i, j); if (k < 0 || ch.land[k] <= 0) continue;
      let nLand = 0, nField = 0, cut = 0;
      for (let b = 0; b < 10; b++) for (let a = 0; a < 10; a++) {     // every square kilometre of the chunk
        const f = land[k * 25 + (b >> 1) * 5 + (a >> 1)]; if (!(f & 1)) continue;
        const d = Math.hypot((i + (a + .5) / 10) * CHUNK_KM - x, (j + (b + .5) / 10) * CHUNK_KM - y);
        nLand++;
        if ((f & 2) && d > R && d < Rf) nField++;
        cut += d < Rc ? 1 : d < reach ? .5 * (1 - (d - Rc) / (reach - Rc)) : 0;
      }
      if (!nLand) continue;
      fields[k] = Math.max(fields[k], nField / 100 * .95); keep[k] = Math.min(keep[k], 1 - cut / nLand);
    }
    towns.push(town);
  }
  return { built, fields, keep, sites, towns };
}
// the chunk of a place and where the model would put it, for pages and tests
export const placeChunk = (ch, pl) => { const [x, y] = kmOf(pl.lat, pl.lon); return ch.k(Math.floor(x / CHUNK_KM), Math.floor(y / CHUNK_KM)); };
export { CN };
