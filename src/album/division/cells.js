// The outlines of the land districts, texel by texel of the fine raster (1.25 km).
// The partition of the chunk graph (build.js) says how many districts a province has and about where each lies. Here
// every district gets its real outline (the owner, 12.11.2026: districts «должны быть по рекам в основном… более
// овальными»). From the heart of each district the land is claimed along the cheapest way: a river is dear to cross,
// so is a crest, so districts meet on rivers and on crests; then every heart moves to the middle of what it
// claimed and a district that came out too big starts a little later — a few times over, which rounds the outlines
// and evens the sizes. A district never leaves its province. Water keeps the districts of its chunks.
// The borders of the provinces are straightened first (provinceCells), and the districts are laid inside them.
// Plain JavaScript without the GPU: the same chunks, heights and rivers always give the same outlines.
import { FN, FKM } from '../chunks.js';
import { KM_PER_DEG, COS_REF } from '../geo.js';
import { Heap } from './graph.js';

const X0 = -880, Y0 = 3880, LAND = 0, NONE = 0xFFFF;
export const RIVER_TOLL = [0, 14, 26, 40];          // km of way paid on entering and again on leaving a river: a brook-sized one, a lesser, a great
export const CREST_TOLL = [0, 2.5, 11];               // … on entering and on leaving a crest: a lesser one, a great one
export const CLIMB = .008;                          // km of way for every metre of height gained or lost: steep ground is slow both ways
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

const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
// one step of the way from texel t to its neighbour u: the distance, the slope, the river or the crest entered or left
// (a step along the river itself is three times as long: otherwise whoever reached the river first would run along
// it for tens of kilometres and its bed would be a thin arm of one district between all the others)
const stepCost = (q, t, u, hgt, riv, crest) => (q < 8 ? FKM : FKM * 1.4142) * (riv[t] > 0 && riv[u] > 0 ? 3 : 1) + Math.abs(hgt[u] - hgt[t]) * CLIMB
  + ((riv[t] > 0) !== (riv[u] > 0) ? RIVER_TOLL[riv[t] > riv[u] ? riv[t] : riv[u]] : 0) + ((crest[t] > 0) !== (crest[u] > 0) ? CREST_TOLL[crest[t] > crest[u] ? crest[t] : crest[u]] : 0);

// Crests: a texel that stands above the land 3.75 km away on both sides of it, along some line through it — by 130 m
// (a lesser crest, which costs little) or by 320 m (a great one). A crest is paid for like a river, so a border settles on it. Paying
// only for the climb would not do: whoever reached the top first would run down the far side for nothing.
export function crestRaster(hgt, land) {
  const n = FN * FN, out = new Uint8Array(n), R = 3, D = [1, 0, 0, 1, 1, 1, 1, -1];
  for (let ty = R; ty < FN - R; ty++) for (let tx = R; tx < FN - R; tx++) {
    const t = ty * FN + tx; if (land[t] < 0) continue;
    let best = 0;
    for (let q = 0; q < 8; q += 2) {
      const a = t + (D[q + 1] * FN + D[q]) * R, b = t - (D[q + 1] * FN + D[q]) * R; if (land[a] < 0 || land[b] < 0) continue;
      const m = Math.min(hgt[t] - hgt[a], hgt[t] - hgt[b]); if (m > best) best = m;
    }
    out[t] = best >= 320 ? 2 : best >= 130 ? 1 : 0;
  }
  return out;
}

// The borders of the land provinces, texel by texel. A province is the chunks the division gave it (build.js), so
// its border is the outline of chunks: it wiggles, and it runs beside a river as often as along it. Here the border is
// straightened and laid on the lie of the land. Every province gives up a belt SMOOTH_KM wide along its borders
// with other provinces; what is left is its core. Then the cores claim the belts back along the cheapest way (a river
// and a crest are dear to cross): where a river or a crest lies in the belt the border settles on it, elsewhere it
// runs midway between the cores, which is the old border with its wiggles ironed out. The shore never moves. A
// province that would fall apart (a neck narrower than the belt) or lose much of its land keeps its old outline.
// prov0: Int32Array FN × FN, the province of every land texel by its chunk (−1 water) → the same, straightened
export const SMOOTH_KM = 6.5;
export function provinceCells(prov0, hgt, riv, crest, provinceCount) {
  const n = FN * FN, R = SMOOTH_KM / FKM, INF = 1e9, d = new Float32Array(n).fill(INF);
  // how far every land texel is from another province, in texels, over land (two sweeps)
  for (let ty = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++) {
    const t = ty * FN + tx, p = prov0[t]; if (p < 0) continue;
    for (let q = 0; q < 16; q += 2) { const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= FN || uy >= FN) continue; const o = prov0[uy * FN + ux]; if (o >= 0 && o !== p) { d[t] = .5; break; } }
  }
  const relax = (t, u, w) => { if (prov0[u] >= 0 && d[u] + w < d[t]) d[t] = d[u] + w; };
  for (let ty = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++) { const t = ty * FN + tx; if (prov0[t] < 0) continue;
    if (tx > 0) relax(t, t - 1, 1); if (ty > 0) { relax(t, t - FN, 1); if (tx > 0) relax(t, t - FN - 1, 1.4142); if (tx < FN - 1) relax(t, t - FN + 1, 1.4142); } }
  for (let ty = FN - 1; ty >= 0; ty--) for (let tx = FN - 1; tx >= 0; tx--) { const t = ty * FN + tx; if (prov0[t] < 0) continue;
    if (tx < FN - 1) relax(t, t + 1, 1); if (ty < FN - 1) { relax(t, t + FN, 1); if (tx < FN - 1) relax(t, t + FN + 1, 1.4142); if (tx > 0) relax(t, t + FN - 1, 1.4142); } }
  // a small province keeps a core too: the belt is never more than six tenths of its half-width
  const deep = new Float32Array(provinceCount);
  for (let t = 0; t < n; t++) { const p = prov0[t]; if (p >= 0 && d[t] < INF && d[t] > deep[p]) deep[p] = d[t]; }
  const belt = p => Math.min(R, deep[p] * .6);
  // pieces of land a province is made of, and its size
  const census = P => {
    const parts = new Int32Array(provinceCount), size = new Int32Array(provinceCount), seen = new Uint8Array(n), stack = [];
    for (let s0 = 0; s0 < n; s0++) {
      const p = P[s0]; if (p < 0) continue; size[p]++; if (seen[s0]) continue;
      parts[p]++; seen[s0] = 1; stack.push(s0);
      while (stack.length) { const t = stack.pop(), tx = t % FN;
        if (tx > 0 && !seen[t - 1] && P[t - 1] === p) { seen[t - 1] = 1; stack.push(t - 1); }
        if (tx < FN - 1 && !seen[t + 1] && P[t + 1] === p) { seen[t + 1] = 1; stack.push(t + 1); }
        if (t >= FN && !seen[t - FN] && P[t - FN] === p) { seen[t - FN] = 1; stack.push(t - FN); }
        if (t < n - FN && !seen[t + FN] && P[t + FN] === p) { seen[t + FN] = 1; stack.push(t + FN); } }
    }
    return { parts, size };
  };
  const before = census(prov0), keep = new Uint8Array(provinceCount), dist = new Float64Array(n), heap = new Heap(1 << 16);
  let out = prov0;
  for (let pass = 0; pass < 3; pass++) {
    const label = new Int32Array(n).fill(-1); dist.fill(Infinity); heap.clear();
    for (let t = 0; t < n; t++) { const p = prov0[t]; if (p >= 0 && (keep[p] || d[t] > belt(p))) { label[t] = p; dist[t] = 0; } }
    for (let t = 0; t < n; t++) if (label[t] >= 0 && dist[t] === 0) {                 // the rim of a core
      const tx = t % FN, ty = (t - tx) / FN;
      for (let q = 0; q < 8; q += 2) { const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= FN || uy >= FN) continue; const u = uy * FN + ux; if (prov0[u] >= 0 && label[u] < 0) { heap.push(0, t); break; } }
    }
    while (heap.n) {
      const t = heap.pop(), dt = heap.key; if (dt > dist[t]) continue;
      const tx = t % FN, ty = (t - tx) / FN;
      for (let q = 0; q < 16; q += 2) {
        const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= FN || uy >= FN) continue;
        const u = uy * FN + ux; if (prov0[u] < 0) continue;
        const c = dt + stepCost(q, t, u, hgt, riv, crest);
        if (c < dist[u]) { dist[u] = c; label[u] = label[t]; heap.push(c, u); }
      }
    }
    for (let t = 0; t < n; t++) if (prov0[t] >= 0 && label[t] < 0) label[t] = prov0[t];   // land no core reached
    out = label;
    const after = census(out); let bad = 0;
    for (let p = 0; p < provinceCount; p++) if (!keep[p] && (after.parts[p] > before.parts[p] || after.size[p] < before.size[p] * .7)) { keep[p] = 1; bad++; }
    if (!bad) break;
  }
  return out;
}

// ch: the chunks; div: the division of the chunk graph (district per chunk, kinds, province, cx, cy);
// heightAt(lat, lon) → metres; rivers as for riverRaster
// → { cells: Int32Array FN × FN, the district of every texel (−1 none); prov: the province of every land texel;
//     hgt, riv: the heights and the rivers of the texels, for those who lay centres and roads over the same land }
export function districtCells(ch, div, { heightAt = null, rivers = [] } = {}) {
  const n = FN * FN, cell = ch.cell, out = new Int32Array(n).fill(-1), prov0 = new Int32Array(n).fill(-1), hgt = new Float32Array(n);
  for (let ty = 0, t = 0; ty < FN; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KM_PER_DEG;
    for (let tx = 0; tx < FN; tx++, t++) {
      const k = cell[t]; if (k === NONE || k >= ch.count) continue;
      const d = div.district[k]; out[t] = d;
      if (div.kinds[d] !== LAND) continue;
      prov0[t] = div.province[d];
      if (heightAt) hgt[t] = Math.max(0, heightAt(lat, (X0 + (tx + .5) * FKM) / (KM_PER_DEG * COS_REF)));
    }
  }
  const riv = riverRaster(rivers), crest = crestRaster(hgt, prov0), count = div.count, prov = provinceCells(prov0, hgt, riv, crest, div.provinces.length);
  // the heart of a district to begin with: the texel of its own, inside its province as it is drawn now, nearest to
  // its middle, off the rivers if it can be
  const seed = new Int32Array(count).fill(-1), best = new Float64Array(count).fill(Infinity);
  const nearest = (label, cx, cy) => {
    best.fill(Infinity); seed.fill(-1);
    for (let t = 0; t < n; t++) {
      const d = label[t]; if (d < 0 || prov[t] !== div.province[d]) continue;
      const x = X0 + (t % FN + .5) * FKM - cx[d], y = Y0 + (Math.floor(t / FN) + .5) * FKM - cy[d], s = x * x + y * y + (riv[t] ? 40 : 0);
      if (s < best[d]) { best[d] = s; seed[d] = t; }
    }
  };
  nearest(out, div.cx, div.cy);
  // a district whose own chunks all went to another province when the border was straightened: the free texel of its
  // province nearest to its middle
  { const lost = []; for (let d = 0; d < count; d++) if (div.kinds[d] === LAND && seed[d] < 0) lost.push(d);
    if (lost.length) {
      const taken = new Set(seed), byProv = new Map(); for (const d of lost) { const p = div.province[d]; if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(d); }
      const bs = new Map(lost.map(d => [d, Infinity]));
      for (let pass = 0; pass < 2; pass++) for (let t = 0; t < n; t++) {
        const list = byProv.get(prov[t]); if (!list || taken.has(t)) continue;
        for (const d of list) { const x = X0 + (t % FN + .5) * FKM - div.cx[d], y = Y0 + (Math.floor(t / FN) + .5) * FKM - div.cy[d], q = x * x + y * y; if (q < bs.get(d)) { bs.set(d, q); seed[d] = t; } }
        if (pass === 0 && t === n - 1) { const used = new Set(); for (const d of lost) { if (used.has(seed[d])) { seed[d] = -1; bs.set(d, Infinity); } else if (seed[d] >= 0) { used.add(seed[d]); taken.add(seed[d]); } } for (const [p, l] of byProv) byProv.set(p, l.filter(d => seed[d] < 0)); }
      }
    } }
  const dist = new Float64Array(n), label = new Int32Array(n), heap = new Heap(1 << 16), start = new Float64Array(count);   // (whole doubles: a rounded distance would be bettered by itself for ever)
  const cx = new Float64Array(count), cy = new Float64Array(count), size = new Float64Array(count), heart = new Uint8Array(n);
  for (let round = 0; round < ROUNDS; round++) {
    dist.fill(Infinity); label.fill(-1); heap.clear(); heart.fill(0);
    for (let d = 0; d < count; d++) if (seed[d] >= 0) { dist[seed[d]] = start[d]; label[seed[d]] = d; heart[seed[d]] = 1; heap.push(start[d], seed[d]); }
    while (heap.n) {
      const t = heap.pop(), dt = heap.key; if (dt > dist[t]) continue;
      const tx = t % FN, ty = (t - tx) / FN, p = prov[t];
      for (let q = 0; q < 16; q += 2) {
        const ux = tx + NB[q], uy = ty + NB[q + 1]; if (ux < 0 || uy < 0 || ux >= FN || uy >= FN) continue;
        const u = uy * FN + ux; if (prov[u] !== p || heart[u]) continue;       // a heart is never taken by a neighbour, however late its district starts
        const c = dt + stepCost(q, t, u, hgt, riv, crest);
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
    for (let d = 0; d < count; d++) if (size[d]) { const p = div.province[d], mean = sum.get(p) / num.get(p); start[d] = Math.max(-6, Math.min(9, start[d] + GAIN * (size[d] - mean) / mean)); }
    const old = Int32Array.from(seed);
    nearest(label, cx, cy);
    for (let d = 0; d < count; d++) if (seed[d] < 0) seed[d] = old[d];
  }
  // land no heart could reach (an islet of a province): the district of its province whose heart is nearest
  let byProv = null;
  for (let t = 0; t < n; t++) {
    if (label[t] >= 0) { out[t] = label[t]; continue; }
    if (prov[t] < 0) continue;
    if (!byProv) { byProv = new Map(); for (let d = 0; d < count; d++) if (seed[d] >= 0) { const p = div.province[d]; if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(d); } }
    let bd = Infinity, bi = -1;
    for (const d of byProv.get(prov[t]) || []) { const dx = (t % FN) - (seed[d] % FN), dy = Math.floor(t / FN) - Math.floor(seed[d] / FN), q = dx * dx + dy * dy; if (q < bd) { bd = q; bi = d; } }
    if (bi >= 0) out[t] = bi;
  }
  return { cells: out, prov, prov0, hgt, riv };
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
