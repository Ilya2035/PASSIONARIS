// The centre of every land district: where its town stands and where its roads meet (the owner, 12.11.2026: «город
// всегда в центре района. Если он у воды, то у воды. Если район на горах, то на подножьях гор… не на вершине»; a
// road «заходит, где-то есть центр, и идёт в разные стороны»).
//   • A district with a real settlement in it takes the site of the largest one (town/sites.js and the places the
//     album already draws): a real town stands by its water, in its valley, at the foot of its hills.
//   • A district with none takes the best ground it has: near its middle, low and level, beside a river or the sea,
//     never in the water.
// Plain JavaScript without the GPU; the same division always gives the same centres.
import { FN, FKM, kmOf } from '../chunks.js';

const X0 = -880, Y0 = 3880, LAND = 0;
const texelOf = (x, y) => { const tx = Math.floor((x - X0) / FKM), ty = Math.floor((y - Y0) / FKM); return tx < 0 || ty < 0 || tx >= FN || ty >= FN ? -1 : ty * FN + tx; };

// div: the division with div.cells (the district of every texel) and div.raster = { hgt, riv } (cells.js);
// sites: [{ lat, lon, pop, name }] or [{ x, y, pop, name }] (flat km), the most important first
// → { x, y: Float64Array (flat km; NaN for water), site: Int32Array (index into sites, −1 none), texel: Int32Array }
export function districtCentres(div, sites = []) {
  const count = div.count, cells = div.cells, { hgt, riv } = div.raster, n = FN * FN;
  const x = new Float64Array(count).fill(NaN), y = new Float64Array(count).fill(NaN), site = new Int32Array(count).fill(-1), texel = new Int32Array(count).fill(-1);
  sites.forEach((s, i) => {
    const [sx, sy] = s.x !== undefined ? [s.x, s.y] : kmOf(s.lat, s.lon), t = texelOf(sx, sy); if (t < 0) return;
    const d = cells[t]; if (d < 0 || div.kinds[d] !== LAND || site[d] >= 0) return;
    site[d] = i; x[d] = sx; y[d] = sy; texel[d] = t;
  });
  // the others: the middle, the size and the lowest ground of each
  const mx = new Float64Array(count), my = new Float64Array(count), num = new Float64Array(count), low = new Float32Array(count).fill(1e9);
  for (let t = 0; t < n; t++) { const d = cells[t]; if (d < 0 || div.kinds[d] !== LAND || site[d] >= 0) continue; mx[d] += t % FN; my[d] += Math.floor(t / FN); num[d]++; if (hgt[t] < low[d]) low[d] = hgt[t]; }
  for (let d = 0; d < count; d++) if (num[d]) { mx[d] /= num[d]; my[d] /= num[d]; }
  const best = new Float64Array(count).fill(Infinity), water = t => { const d = cells[t]; return d < 0 || div.kinds[d] !== LAND; };
  for (let ty = 1; ty < FN - 1; ty++) for (let tx = 1; tx < FN - 1; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || !num[d] || div.kinds[d] !== LAND) continue;
    const dx = tx - mx[d], dy = ty - my[d], nb = [t - 1, t + 1, t - FN, t + FN];
    let sc = (dx * dx + dy * dy) / (.3 * num[d]), slope = 0, river = false, sea = false;       // 1 about half-way from the middle to the rim
    for (const u of nb) { slope = Math.max(slope, Math.abs(hgt[u] - hgt[t])); if (riv[u] > 1) river = true; if (water(u)) sea = true; }
    sc += (hgt[t] - low[d]) / 300 + slope / 80 + (riv[t] ? 1 : river ? -.5 : 0) + (sea ? -.35 : 0);
    if (sc < best[d]) { best[d] = sc; texel[d] = t; x[d] = X0 + (tx + .5) * FKM; y[d] = Y0 + (ty + .5) * FKM; }
  }
  return { x, y, site, texel };
}
