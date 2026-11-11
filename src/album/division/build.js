// The division of the album's world: every chunk goes to exactly one district; districts are grouped into provinces,
// provinces into regions. Land, sea and lakes are divided apart. A chunk is a natural cell of about 100 km² whose
// outline runs along rivers, the foot of slopes and the coast (chunks.js); the division works on the graph of chunks
// and their borders (ch.links), so a district's border is always a chunk's border. The algorithm is described in
// docs/album/division.md. Plain JavaScript without the GPU: the page and the tests (tests/album-division.test.mjs)
// run the same code, and the same chunks always give the same division.
import { FKM, FN, kmOf, llOf } from '../chunks.js';
import { BBOX } from '../geo.js';
import { makeGraph, partition, tidy } from './graph.js';

export const LAND = 0, SEA = 1, LAKE = 2;
export const KIND_ID = ['land', 'sea', 'lake'];
export const KIND_TITLE = ['суша', 'море', 'озеро'];
export const SIZES = [30, 50, 100];                     // the district sizes the knob offers, km: a district is about size² km²

// a province is about 100 km across, a region about 340 km; for larger districts they grow with them
export const levelSizes = s => { const p = Math.max(100, 2.2 * s); return { district: s, province: p, region: Math.max(340, 2.2 * p) }; };

// what makes a border, in km of walking
export const RIVER_KM = { 1: 50, 2: 90 };               // a lesser and a great river along the whole border of two chunks
const RIDGE_KM = 30;                                    // per 220 m that the ground between two chunks rises above both
const STEP_KM = 30;                                     // per 450 m of difference in the mean height of two chunks
const X0 = -880, Y0 = 3880;                             // the corner of the fine raster (chunks.js)

const inside = (lat, lon) => lat > BBOX.lat0 && lat < BBOX.lat1 && lon > BBOX.lon0 && lon < BBOX.lon1;
function pointInRing(lon, lat, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---- the kind of every chunk: land, sea or lake. A lake: a water chunk with no way over water to the edge of the
// map, or a chunk that a lake outline of the data covers at least half.
export function chunkKinds(ch, lakes = []) {
  const n = ch.count, kind = new Uint8Array(n);
  for (let k = 0; k < n; k++) kind[k] = ch.kind[k] ? LAND : SEA;
  const seen = new Uint8Array(n), queue = [];
  const edge = t => { const k = ch.cell[t]; if (!ch.kind[k] && !seen[k]) { seen[k] = 1; queue.push(k); } };
  for (let i = 0; i < FN; i++) { edge(i); edge((FN - 1) * FN + i); edge(i * FN); edge(i * FN + FN - 1); }
  for (let q = 0; q < queue.length; q++) for (const l of ch.links[queue[q]]) if (!ch.kind[l.k] && !seen[l.k]) { seen[l.k] = 1; queue.push(l.k); }
  for (let k = 0; k < n; k++) if (!ch.kind[k] && !seen[k]) kind[k] = LAKE;
  if (lakes.length) {
    const inLake = new Float32Array(n);
    for (const lake of lakes) {
      const ring = lake.ring; if (!ring || ring.length < 3) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [lon, lat] of ring) { const [x, y] = kmOf(lat, lon); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let ty = Math.max(0, Math.floor((y0 - Y0) / FKM)); ty <= Math.min(FN - 1, Math.floor((y1 - Y0) / FKM)); ty++)
        for (let tx = Math.max(0, Math.floor((x0 - X0) / FKM)); tx <= Math.min(FN - 1, Math.floor((x1 - X0) / FKM)); tx++) {
          const p = llOf(X0 + (tx + .5) * FKM, Y0 + (ty + .5) * FKM);
          if (pointInRing(p.lon, p.lat, ring)) inLake[ch.cell[ty * FN + tx]] += FKM * FKM;
        }
    }
    for (let k = 0; k < n; k++) if (inLake[k] >= .5 * ch.area[k]) kind[k] = LAKE;
  }
  return kind;
}

// ---- what it costs to walk from a chunk to its neighbour, beyond the straight distance between their middles: a
// river on their border (as much of it as the share of the border on the river), a ridge or watershed between them
// (the ground rises above both middles), a step from lowland to upland. → Map "a,b" (a < b) → km; land to land only.
export function borderPenalties(ch, heightAt = null) {
  const pen = new Map();
  const at = heightAt ? (x, y) => { const p = llOf(x, y); return inside(p.lat, p.lon) ? Math.max(0, heightAt(p.lat, p.lon)) : 0; } : null;
  for (let a = 0; a < ch.count; a++) {
    if (!ch.kind[a]) continue;
    for (const l of ch.links[a]) {
      const b = l.k; if (b < a || !ch.kind[b]) continue;
      let p = l.river ? RIVER_KM[l.river] * Math.min(1, l.wet / l.km * 1.25) : 0;
      if (at) {
        const ax = ch.cx[a], ay = ch.cy[a], bx = ch.cx[b], by = ch.cy[b], L = Math.hypot(bx - ax, by - ay) || 1, ox = -(by - ay) / L * 2, oy = (bx - ax) / L * 2;
        let top = 0, h0 = 0, h1 = 0;
        for (let s = 0; s <= 6; s++) {
          const t = s / 6, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
          const h = (at(px, py) + at(px + ox, py + oy) + at(px - ox, py - oy)) / 3;
          if (s === 0) h0 = h; else if (s === 6) h1 = h; else top = Math.max(top, h);
        }
        p += RIDGE_KM * Math.min(3, Math.max(0, top - Math.max(h0, h1) - 40) / 220);
      }
      p += STEP_KM * Math.min(1.5, Math.abs(ch.height[a] - ch.height[b]) / 450);
      pen.set(a + ',' + b, p);
    }
  }
  return pen;
}
const penOf = (pen, a, b) => pen.get(a < b ? a + ',' + b : b + ',' + a) || 0;

// a small binary heap of [key, node], ties by node
function minHeap() {
  const h = [];
  const less = (p, q) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
  return {
    get size() { return h.length; },
    push(d, k) { const e = [d, k]; h.push(e); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(e, h[p])) break; h[i] = h[p]; i = p; } h[i] = e; },
    pop() {
      const top = h[0], last = h.pop();
      if (h.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= h.length) break; if (c + 1 < h.length && less(h[c + 1], h[c])) c++; if (!less(h[c], last)) break; h[i] = h[c]; i = c; } h[i] = last; }
      return top;
    },
  };
}

// ---- the division
// ch: album.chunks (or anything with count, kind, area, cx, cy, links, cell, land, height);
// heightAt(lat, lon) metres (for ridges; may be left out); lakes: [{ ring: [[lon, lat], …] }];
// size: district size in km (30, 50, 100) — a district is about size² km².
export function buildDivision(ch, { heightAt = null, lakes = [], size = 30 } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = ch.count, sizes = levelSizes(size), T = sizes.district ** 2;
  const kind = chunkKinds(ch, lakes), pen = borderPenalties(ch, heightAt);

  // the chunk graph: every pair of neighbours; walking on land pays the penalties, on water only the distance
  const X = Float64Array.from(ch.cx), Y = Float64Array.from(ch.cy), A = Float64Array.from(ch.area), edges = [];
  for (let a = 0; a < n; a++) for (const l of ch.links[a]) {
    const b = l.k; if (b < a) continue;
    edges.push(a, b, Math.hypot(X[a] - X[b], Y[a] - Y[b]) + (kind[a] === LAND && kind[b] === LAND ? penOf(pen, a, b) : 0));
  }
  const g = makeGraph(n, X, Y, A, edges);
  const district = new Int32Array(n).fill(-1);
  let count = 0;
  const take = (label, m) => { for (let k = 0; k < n; k++) if (label[k] >= 0) district[k] = count + label[k]; count += m; };
  const groupOf = f => { const gr = new Int32Array(n); for (let k = 0; k < n; k++) gr[k] = f(k) ? 0 : -1; return gr; };

  // 1. land
  const landPart = partition(g, groupOf(k => kind[k] === LAND), T, { iters: 12 });
  take(landPart.label, landPart.count);
  const nLand = count;
  // 2. lakes: a lake is one district; a big one is cut into several of the usual size
  const lakePart = partition(g, groupOf(k => kind[k] === LAKE), T, { iters: 8, minK: .25, maxK: 1.8 });
  take(lakePart.label, lakePart.count);
  const nLake = count;

  // 3. the sea: a strip along the shore cut into pieces that face the land districts, the open sea in even pieces.
  // Every sea chunk near the shore goes with the nearest coastal land chunk (straight distance, reached over the sea).
  const reach = Math.max(1, Math.round(size / 15)) * 10 + 5;          // the strip: 25 km wide for districts of 30 km
  const dist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), heap = minHeap();
  for (let k = 0; k < n; k++) if (kind[k] === LAND && ch.links[k].some(l => kind[l.k] === SEA)) { dist[k] = 0; from[k] = k; heap.push(0, k); }
  while (heap.size) {
    const [d, k] = heap.pop(); if (d > dist[k]) continue;
    for (const l of ch.links[k]) {
      const m = l.k; if (kind[m] !== SEA) continue;
      const nd = Math.hypot(X[m] - X[from[k]], Y[m] - Y[from[k]]);
      if (nd <= reach && nd < dist[m]) { dist[m] = nd; from[m] = from[k]; heap.push(nd, m); }
    }
  }
  const coastOf = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (kind[k] === SEA && from[k] >= 0) coastOf[k] = district[from[k]];
  // pieces of the strip: neighbouring chunks facing the same land district
  const seaLabel = new Int32Array(n).fill(-1);
  let nSea = 0;
  for (let s = 0; s < n; s++) {
    if (coastOf[s] < 0 || seaLabel[s] >= 0) continue;
    const list = [s]; seaLabel[s] = nSea;
    for (let q = 0; q < list.length; q++) for (const l of ch.links[list[q]]) if (seaLabel[l.k] < 0 && coastOf[l.k] === coastOf[s]) { seaLabel[l.k] = nSea; list.push(l.k); }
    nSea++;
  }
  const coast = tidy(g, groupOf(k => coastOf[k] >= 0), seaLabel, nSea, T, { minK: .35, maxK: 2.2 });
  // the open sea, in pieces four times the area of a land district
  const open = partition(g, groupOf(k => kind[k] === SEA && coastOf[k] < 0), T * 4, { iters: 10, minK: .3, maxK: 2 });
  const sea = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (coast.label[k] >= 0) sea[k] = coast.label[k]; else if (open.label[k] >= 0) sea[k] = coast.count + open.label[k];
  // a scrap of open sea shut in between strips joins the piece it shares the longest border with
  const seaSize = new Float64Array(coast.count + open.count), members = Array.from({ length: seaSize.length }, () => []);
  for (let k = 0; k < n; k++) if (sea[k] >= 0) { seaSize[sea[k]] += A[k]; members[sea[k]].push(k); }
  for (let p = coast.count; p < seaSize.length; p++) {
    if (seaSize[p] >= .3 * T || !members[p].length) continue;
    const touch = new Map();
    for (const k of members[p]) for (const l of ch.links[k]) { const q = sea[l.k]; if (q >= 0 && q !== p) touch.set(q, (touch.get(q) || 0) + l.km); }
    let best = -1, bk = 0; for (const [q, km] of [...touch].sort((a, b) => a[0] - b[0])) if (km > bk) { bk = km; best = q; }
    if (best >= 0) { for (const k of members[p]) sea[k] = best; members[best] = members[best].concat(members[p]); members[p] = []; seaSize[best] += seaSize[p]; seaSize[p] = 0; }
  }
  const seaFinal = tidy(g, groupOf(k => kind[k] === SEA), sea, seaSize.length, T, { minK: .25, maxK: 1e9 });
  take(seaFinal.label, seaFinal.count);

  const kinds = new Uint8Array(count);
  for (let d = 0; d < count; d++) kinds[d] = d < nLand ? LAND : d < nLake ? LAKE : SEA;
  const div = finish(ch, { district, count, kinds, kind, pen, size, sizes });
  div.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return div;
}

// ---- districts' members, middles, neighbours; then provinces and regions
function finish(ch, { district, count, kinds, kind, pen, size, sizes }) {
  const n = ch.count, chunks = Array.from({ length: count }, () => []);
  for (let k = 0; k < n; k++) chunks[district[k]].push(k);
  const cxs = new Float64Array(count), cys = new Float64Array(count), area = new Float64Array(count);
  for (let d = 0; d < count; d++) {
    for (const k of chunks[d]) { const a = ch.area[k]; cxs[d] += ch.cx[k] * a; cys[d] += ch.cy[k] * a; area[d] += a; }
    cxs[d] /= area[d] || 1; cys[d] /= area[d] || 1;
  }
  // borders between districts: their length and what crossing them costs (summed per km of border)
  const border = new Map();
  for (let a = 0; a < n; a++) for (const l of ch.links[a]) {
    const b = l.k; if (b < a) continue;
    const da = district[a], db = district[b]; if (da === db) continue;
    const key = da < db ? da * 65536 + db : db * 65536 + da, r = border.get(key) || { a: Math.min(da, db), b: Math.max(da, db), km: 0, pen: 0 };
    r.km += l.km; r.pen += (kind[a] === LAND && kind[b] === LAND ? penOf(pen, a, b) : 0) * l.km; border.set(key, r);
  }
  const borders = [...border.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  const neighbours = Array.from({ length: count }, () => []);
  for (const r of borders) { neighbours[r.a].push(r.b); neighbours[r.b].push(r.a); }
  for (const nb of neighbours) nb.sort((a, b) => a - b);

  // provinces: districts grouped the way chunks are grouped into districts; land and lakes together, the sea apart
  const S = sizes.district;
  const classOf = kd => kd === SEA ? 1 : 0;
  const level = (m, x, y, sz, cls, bs, levelKm, rivK, islands) => {
    const edges = [];
    for (const r of bs) edges.push(r.a, r.b, Math.hypot(x[r.a] - x[r.b], y[r.a] - y[r.b]) + (r.pen / r.km) * (levelKm / S) * rivK);
    for (const v of islands) edges.push(v.a, v.b, v.cost);
    return partition(makeGraph(m, x, y, sz, edges), cls, levelKm ** 2, { iters: 10, minK: .4, maxK: 2.1 });
  };
  const dClass = Int32Array.from(kinds, classOf);
  const isl1 = islandLinks(ch, district, kind, chunks, dClass, sizes.province ** 2, 16, sizes.province);
  const prov = level(count, cxs, cys, area, dClass, borders, sizes.province, .6, isl1);
  const province = prov.label, nP = prov.count;
  const pcx = new Float64Array(nP), pcy = new Float64Array(nP), parea = new Float64Array(nP), pClass = new Int32Array(nP);
  for (let d = 0; d < count; d++) { const p = province[d]; pcx[p] += cxs[d] * area[d]; pcy[p] += cys[d] * area[d]; parea[p] += area[d]; pClass[p] = dClass[d]; }
  for (let p = 0; p < nP; p++) { pcx[p] /= parea[p]; pcy[p] /= parea[p]; }
  const pb = new Map();
  for (const r of borders) {
    const a = province[r.a], b = province[r.b]; if (a === b) continue;
    const key = a < b ? a * 65536 + b : b * 65536 + a, q = pb.get(key) || { a: Math.min(a, b), b: Math.max(a, b), km: 0, pen: 0 }; q.km += r.km; q.pen += r.pen; pb.set(key, q);
  }
  const pBorders = [...pb.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  const pChunks = Array.from({ length: nP }, () => []); for (let d = 0; d < count; d++) for (const k of chunks[d]) pChunks[province[d]].push(k);
  const pOf = new Int32Array(n); for (let k = 0; k < n; k++) pOf[k] = province[district[k]];
  const isl2 = islandLinks(ch, pOf, kind, pChunks, pClass, sizes.region ** 2, 30, sizes.region);
  const reg = level(nP, pcx, pcy, parea, pClass, pBorders, sizes.region, .5, isl2);
  const region = reg.label, nR = reg.count;

  // colours: neighbours never share one (greedy, the least used colour first)
  const dColour = colourise(count, neighbours, d => kinds[d]);
  const pNb = Array.from({ length: nP }, () => []); for (const r of pBorders) { pNb[r.a].push(r.b); pNb[r.b].push(r.a); }
  const pColour = colourise(nP, pNb, p => pClass[p]);
  const rNb = Array.from({ length: nR }, () => new Set());
  for (const r of pBorders) { const a = region[r.a], b = region[r.b]; if (a !== b) { rNb[a].add(b); rNb[b].add(a); } }
  const rClass = new Int32Array(nR); for (let p = 0; p < nP; p++) rClass[region[p]] = pClass[p];
  const rColour = colourise(nR, rNb.map(s => [...s].sort((a, b) => a - b)), r => rClass[r]);

  return {
    size, sizes, count, district, kinds, kind, chunks, area, cx: cxs, cy: cys, neighbours, borders, pen,
    province, provinceCount: nP, region, regionCount: nR, provinceChunks: pChunks,
    colour: { district: dColour, province: pColour, region: rColour },
  };
}

// Islands too small for a province (region) of their own get one link over the water to the nearest other land, so
// they can join it: { a, b, cost } between units (districts or provinces). unitOf: chunk → unit.
function islandLinks(ch, unitOf, kind, unitChunks, unitClass, target, reach, levelKm) {
  const n = unitChunks.length, land = k => kind[k] !== SEA;
  const mass = new Int32Array(n).fill(-1), masses = [], adj = Array.from({ length: n }, () => new Set());
  for (let k = 0; k < ch.count; k++) if (land(k)) for (const l of ch.links[k]) if (land(l.k) && unitOf[k] !== unitOf[l.k]) adj[unitOf[k]].add(unitOf[l.k]);
  for (let s = 0; s < n; s++) {
    if (mass[s] >= 0 || unitClass[s] !== 0) continue;
    const list = [s]; mass[s] = masses.length;
    for (let q = 0; q < list.length; q++) for (const j of [...adj[list[q]]].sort((a, b) => a - b)) if (mass[j] < 0 && unitClass[j] === 0) { mass[j] = masses.length; list.push(j); }
    masses.push(list);
  }
  const links = [];
  for (let id = 0; id < masses.length; id++) {
    const units = masses[id], size = units.reduce((s, u) => s + unitChunks[u].reduce((t, k) => t + ch.area[k], 0), 0);
    if (size >= target) continue;
    // over the water from every chunk of this land mass, to the first land of another
    const from = new Int32Array(ch.count).fill(-1), steps = new Int32Array(ch.count).fill(-1), queue = [];
    for (const u of units) for (const k of unitChunks[u]) if (land(k)) { from[k] = u; steps[k] = 0; queue.push(k); }
    queue.sort((a, b) => a - b);
    let found = null;
    for (let q = 0; q < queue.length && !found; q++) {
      const k = queue[q]; if (steps[k] > reach) break;
      for (const l of ch.links[k]) {
        const m = l.k; if (steps[m] >= 0) continue;
        if (land(m) && mass[unitOf[m]] !== id && unitClass[unitOf[m]] === 0) { found = { a: from[k], b: unitOf[m], km: (steps[k] + 1) * 10 }; break; }
        if (!land(m)) { steps[m] = steps[k] + 1; from[m] = from[k]; queue.push(m); }
      }
    }
    if (found) links.push({ a: found.a, b: found.b, cost: found.km + levelKm });
  }
  return links;
}

// greedy colouring with 8 colours per class: each unit takes the least used colour none of its coloured neighbours has
function colourise(n, nb, cls) {
  const col = new Uint8Array(n), used = [new Float64Array(8), new Float64Array(8), new Float64Array(8)];
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => nb[b].length - nb[a].length || a - b);
  const done = new Uint8Array(n);
  for (const i of order) {
    const bad = new Set(); for (const j of nb[i]) if (done[j]) bad.add(col[j]);
    const u = used[cls(i)] || used[0];
    let best = 0, bu = Infinity;
    for (let c = 0; c < 8; c++) if (!bad.has(c) && u[c] < bu) { bu = u[c]; best = c; }
    col[i] = best; u[best]++; done[i] = 1;
  }
  return col;
}

// ---- names: a land district takes the name of its largest settlement (album.data.vectors.places), a coastal town
// in a water chunk names the land district beside it; the rest are numbered
export function districtNames(ch, div, places = []) {
  const best = new Float64Array(div.count).fill(-1), name = new Array(div.count).fill(null);
  for (const pl of places) {
    let k = ch.at(pl.lat, pl.lon); if (k < 0) continue;
    if (div.kinds[div.district[k]] !== LAND) {
      const l = [...ch.links[k]].sort((p, q) => q.km - p.km || p.k - q.k).find(x => div.kinds[div.district[x.k]] === LAND); if (!l) continue; k = l.k;
    }
    const d = div.district[k], pop = pl.pop || 0;
    if (pop > best[d]) { best[d] = pop; name[d] = pl.name; }
  }
  return name.map((nm, d) => nm || `${div.kinds[d] === SEA ? 'Морской район' : div.kinds[d] === LAKE ? 'Озеро' : 'Район'} № ${d + 1}`);
}

// ---- what a district holds: sums over its chunks (state read from album.chunks, layers with sum: true)
export function districtSummary(div, d, ch) {
  const list = div.chunks[d] || [];
  let area = 0, landA = 0;
  const share = { forest: 0, swamp: 0, built: 0, fields: 0 };
  for (const k of list) {
    const a = ch.area[k], l = div.kind[k] === LAND ? a * ch.land[k] : 0;
    area += a; landA += l;
    for (const name of Object.keys(share)) share[name] += ch.get(name, k) * l;
  }
  for (const name of Object.keys(share)) share[name] = landA > 0 ? share[name] / landA : 0;
  const sums = [];
  for (const l of ch.layers.values()) {
    if (!l.sum) continue;
    let s = 0; for (const k of list) s += l.data[k] || 0;
    sums.push({ name: l.name, title: l.title, unit: l.unit || '', value: s });
  }
  return { id: d, name: div.names ? div.names[d] : `Район № ${d + 1}`, kind: KIND_ID[div.kinds[d]], area, landArea: landA, chunks: list.length, share, sums,
    province: div.province[d], region: div.region[div.province[d]], neighbours: div.neighbours[d].length };
}
