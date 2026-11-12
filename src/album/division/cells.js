// The outlines of the land districts, texel by texel of the fine raster (1.25 km).
// The partition of the chunk graph (build.js) says how many districts a province has and about where each lies. Here
// every district gets its real outline (the owner, 12.11.2026: districts «должны быть по рекам в основном… более
// овальными»). From the heart of each district the land is claimed along the cheapest way: a river is dear to cross,
// a climb costs too, so districts meet on rivers and on crests; then every heart moves to the middle of what it
// claimed and a district that came out too big starts a little later — a few times over, which rounds the outlines
// and evens the sizes. A district never leaves its province. Water keeps the districts of its chunks.
// Plain JavaScript without the GPU: the same chunks, heights and rivers always give the same outlines.
import { FN, FKM } from '../chunks.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';
import { Heap } from './graph.js';

const X0 = -880, Y0 = 3880, LAND = 0, NONE = 0xFFFF;
export const RIVER_TOLL = [0, 14, 26, 40];          // km of way paid on entering and again on leaving a river: a brook-sized one, a lesser, a great
export const CLIMB = .03;                           // km of way for every metre climbed
const GAIN = 5, ROUNDS = 5;                         // km a district twice the middle size starts later; how many times the land is claimed

// rivers: [{ pts: [[lon, lat], …], rank }] → a byte a texel: 0 none, 1 a small river, 2 a lesser, 3 a great one
export function riverRaster(rivers = []) {
  const riv = new Uint8Array(FN * FN);
  for (const rv of rivers) {
    const r = rv.rank <= 6 ? 3 : rv.rank <= 8 ? 2 : 1;
    const mark = (tx, ty) => { if (tx >= 0 && ty >= 0 && tx < FN && ty < FN && r > riv[ty * FN + tx]) riv[ty * FN + tx] = r; };
    for (let i = 1; i < rv.pts.length; i++) {
      // texels the stretch passes through, stepping one side at a time: the line of texels has no diagonal gaps
      let x = (rv.pts[i - 1][0] * KM_PER_DEG * COS_REF - X0) / FKM, y = (rv.pts[i - 1][1] * KM_PER_DEG - Y0) / FKM;
      const x1 = (rv.pts[i][0] * KM_PER_DEG * COS_REF - X0) / FKM, y1 = (rv.pts[i][1] * KM_PER_DEG - Y0) / FKM;
      let tx = Math.floor(x), ty = Math.floor(y); const ex = Math.floor(x1), ey = Math.floor(y1), dx = x1 - x, dy = y1 - y;
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, ax = dx ? Math.abs(1 / dx) : Infinity, ay = dy ? Math.abs(1 / dy) : Infinity;
      let mx = dx ? (dx > 0 ? tx + 1 - x : x - tx) * ax : Infinity, my = dy ? (dy > 0 ? ty + 1 - y : y - ty) * ay : Infinity;
      mark(tx, ty);
      for (let guard = 0; (tx !== ex || ty !== ey) && guard < 4096; guard++) { if (mx < my) { mx += ax; tx += sx; } else { my += ay; ty += sy; } mark(tx, ty); }
    }
  }
  return riv;
}

// ch: the chunks; div: the division of the chunk graph (district per chunk, kinds, province, cx, cy);
// heightAt(lat, lon) → metres; rivers as for riverRaster → Int32Array FN × FN: the district of every texel (−1 none)
export function districtCells(ch, div, { heightAt = null, rivers = [] } = {}) {
  const n = FN * FN, cell = ch.cell, out = new Int32Array(n).fill(-1), prov = new Int32Array(n).fill(-1), hgt = new Float32Array(n);
  for (let ty = 0, t = 0; ty < FN; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KM_PER_DEG;
    for (let tx = 0; tx < FN; tx++, t++) {
      const k = cell[t]; if (k === NONE || k >= ch.count) continue;
      const d = div.district[k]; out[t] = d;
      if (div.kinds[d] !== LAND) continue;
      prov[t] = div.province[d];
      if (heightAt) hgt[t] = Math.max(0, heightAt(lat, (X0 + (tx + .5) * FKM) / (KM_PER_DEG * COS_REF)));
    }
  }
  const riv = riverRaster(rivers), count = div.count;
  // the heart of a district to begin with: the texel of its own nearest to its middle, off the rivers if it can be
  const seed = new Int32Array(count).fill(-1), best = new Float64Array(count).fill(Infinity);
  const nearest = (label, cx, cy) => {
    best.fill(Infinity); seed.fill(-1);
    for (let t = 0; t < n; t++) {
      const d = label[t]; if (d < 0 || prov[t] < 0) continue;
      const x = X0 + (t % FN + .5) * FKM - cx[d], y = Y0 + (Math.floor(t / FN) + .5) * FKM - cy[d], s = x * x + y * y + (riv[t] ? 40 : 0);
      if (s < best[d]) { best[d] = s; seed[d] = t; }
    }
  };
  nearest(out, div.cx, div.cy);
  const dist = new Float64Array(n), label = new Int32Array(n), heap = new Heap(1 << 16), start = new Float64Array(count);   // (whole doubles: a rounded distance would be bettered by itself for ever)
  const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
  const cx = new Float64Array(count), cy = new Float64Array(count), size = new Float64Array(count);
  for (let round = 0; round < ROUNDS; round++) {
    dist.fill(Infinity); label.fill(-1); heap.clear();
    for (let d = 0; d < count; d++) if (seed[d] >= 0) { dist[seed[d]] = start[d]; label[seed[d]] = d; heap.push(start[d], seed[d]); }
    while (heap.n) {
      const t = heap.pop(), dt = heap.key; if (dt > dist[t]) continue;
      const tx = t % FN, ty = (t - tx) / FN, p = prov[t], h = hgt[t], rt = riv[t];
      for (let q = 0; q < 16; q += 2) {
        const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= FN || uy >= FN) continue;
        const u = uy * FN + ux; if (prov[u] !== p) continue;
        const ru = riv[u];
        let c = dt + (q < 8 ? FKM : FKM * 1.4142) + Math.max(0, hgt[u] - h) * CLIMB;
        if ((rt > 0) !== (ru > 0)) c += RIVER_TOLL[rt > ru ? rt : ru];
        if (c < dist[u]) { dist[u] = c; label[u] = label[t]; heap.push(c, u); }
      }
    }
    if (round === ROUNDS - 1) break;
    // the hearts move to the middle of what they claimed; a district larger than the middle one of its province
    // starts later next time, a smaller one earlier
    cx.fill(0); cy.fill(0); size.fill(0);
    for (let t = 0; t < n; t++) { const d = label[t]; if (d < 0) continue; cx[d] += X0 + (t % FN + .5) * FKM; cy[d] += Y0 + (Math.floor(t / FN) + .5) * FKM; size[d]++; }
    const sum = new Map(), num = new Map();
    for (let d = 0; d < count; d++) if (size[d]) { cx[d] /= size[d]; cy[d] /= size[d]; const p = div.province[d]; sum.set(p, (sum.get(p) || 0) + size[d]); num.set(p, (num.get(p) || 0) + 1); }
    for (let d = 0; d < count; d++) if (size[d]) { const p = div.province[d], mean = sum.get(p) / num.get(p); start[d] = Math.max(-6, Math.min(12, start[d] + GAIN * (size[d] - mean) / mean)); }
    const old = Int32Array.from(seed);
    nearest(label, cx, cy);
    for (let d = 0; d < count; d++) if (seed[d] < 0) seed[d] = old[d];
  }
  for (let t = 0; t < n; t++) if (label[t] >= 0) out[t] = label[t];   // land no heart could reach (an islet of a province) keeps the district of its chunk
  return out;
}

// what the outlines are like, for the notes and the tests: for every land district its texels, the sides it shares
// with other districts and how many of those lie on a river
export function cellStats(div, cells, riv) {
  const count = div.count, area = new Float64Array(count), edge = new Float64Array(count); let border = 0, onRiver = 0;
  for (let ty = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++) {
    const t = ty * FN + tx, d = cells[t]; if (d < 0 || div.kinds[d] !== LAND) continue;
    area[d]++;
    for (const u of [tx + 1 < FN ? t + 1 : -1, ty + 1 < FN ? t + FN : -1]) {
      if (u < 0) continue; const e = cells[u]; if (e === d) continue;
      edge[d]++; if (e >= 0) edge[e]++;
      if (e >= 0 && div.kinds[e] === LAND) { border++; if (riv && (riv[t] || riv[u])) onRiver++; }
    }
  }
  // roundness: 1 a circle, less the more drawn out or ragged (the sides of texels overstate a smooth outline by 4 / π)
  const round = []; for (let d = 0; d < count; d++) if (area[d] > 20) round.push(4 * Math.PI * area[d] / (edge[d] * Math.PI / 4) ** 2);
  round.sort((a, b) => a - b);
  return { area, round, roundMid: round[round.length >> 1] || 0, border, onRiver, riverShare: border ? onRiver / border : 0 };
}
