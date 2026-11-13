// The division of the album's world into historical lands, built from whole chunks (docs/album/division.md):
//   region   — a great historical land (Galicia with Asturias, the Douro basin, Catalonia, Andalusia …),
//   province — a historical area inside it (Rioja, La Mancha, Bierzo, Béarn, Algarve …),
//   district — a valley, a comarca, the surroundings of a town.
// The lands are listed by hand in public/assets/album/division/lands.json with their real names. A land leans to the
// modern provinces and départements it grew into (Natural Earth admin-1, public domain, admin.json) — that only tells
// which chunk belongs where roughly; the relief draws the border: a mountain range is never a unit but a border, each
// slope goes with the valley it drains into, a whole valley is never cut. Plain JavaScript without the GPU: the page
// and the tests run the same code, and the same chunks always give the same division.
import { FKM, FN, kmOf, llOf } from '../chunks.js';
import { BBOX } from '../geo.js';
import { makeGraph, partition, tidy } from './graph.js';
import { districtCells } from './cells.js';
import { borderGeometry } from './border.js';
import { KKM, kmData, kmFacts, cellsOfDistrict, cellsOfChunks, chunksOfDistrict, livingOf } from './km.js';

export const LAND = 0, SEA = 1, LAKE = 2;
export const KIND_ID = ['land', 'sea', 'lake'];
export const KIND_TITLE = ['суша', 'море', 'озеро'];
export const SIZES = [20, 30, 50, 100];                 // district sizes the knob offers, km: a district is about size² km²
// nominal sizes of the levels, km: the provinces and regions are historical lands; these only say how big they are
export const levelSizes = s => ({ district: s, province: Math.max(100, 2 * s), region: 900 });

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
function minHeap() {
  const h = [], less = (p, q) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
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

// ---- the kind of every chunk: land, sea or lake (a water chunk with no way over water to the edge of the map, or a
// chunk a lake outline of the data covers at least half)
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

// ---- the relief between two neighbouring land chunks: how high the ground between their middles rises above both
// (a ridge, a watershed) and the step between their mean heights, metres. → Map "a,b" (a < b) → { ridge, step }
export function linkRelief(ch, heightAt = null) {
  const out = new Map();
  const at = heightAt ? (x, y) => { const p = llOf(x, y); return inside(p.lat, p.lon) ? Math.max(0, heightAt(p.lat, p.lon)) : 0; } : null;
  for (let a = 0; a < ch.count; a++) {
    if (!ch.kind[a]) continue;
    for (const l of ch.links[a]) {
      const b = l.k; if (b < a || !ch.kind[b]) continue;
      let ridge = 0;
      if (at) {
        const ax = ch.cx[a], ay = ch.cy[a], bx = ch.cx[b], by = ch.cy[b], L = Math.hypot(bx - ax, by - ay) || 1, ox = -(by - ay) / L * 2, oy = (bx - ax) / L * 2;
        let top = 0, h0 = 0, h1 = 0;
        for (let s = 0; s <= 6; s++) {
          const t = s / 6, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
          const h = (at(px, py) + at(px + ox, py + oy) + at(px - ox, py - oy)) / 3;
          if (s === 0) h0 = h; else if (s === 6) h1 = h; else top = Math.max(top, h);
        }
        ridge = Math.max(0, top - Math.max(h0, h1));
      }
      out.set(a + ',' + b, { ridge, step: Math.abs(ch.height[a] - ch.height[b]) });
    }
  }
  return out;
}
const reliefOf = (rel, a, b) => rel.get(a < b ? a + ',' + b : b + ',' + a) || { ridge: 0, step: 0 };
// what crossing a border costs, km of walking: a ridge most of all; a river some (inside a land a big lowland river
// is an axis, not a border); a step from lowland to upland a little
function crossKm(rel, a, b, link) {
  const r = reliefOf(rel, a, b);
  return 30 * Math.min(4, Math.max(0, r.ridge - 40) / 200) + (link.river ? (link.river === 2 ? 35 : 22) * Math.min(1, link.wet / link.km * 1.25) : 0) + 20 * Math.min(1.5, r.step / 450);
}

// ---- which modern unit (admin.json) the middle of every land chunk lies in: −1 none
export function chunkUnits(ch, admin, kind) {
  const ids = Object.keys(admin.units).sort(), boxes = ids.map(id => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const ring of admin.units[id].rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  });
  const unit = new Int32Array(ch.count).fill(-1);
  for (let k = 0; k < ch.count; k++) {
    if (kind[k] === SEA) continue;
    const c = ch.centre(k);
    for (let u = 0; u < ids.length; u++) {
      const b = boxes[u]; if (c.lon < b[0] || c.lon > b[2] || c.lat < b[1] || c.lat > b[3]) continue;
      if (admin.units[ids[u]].rings.some(r => pointInRing(c.lon, c.lat, r))) { unit[k] = u; break; }
    }
  }
  return { unit, ids };
}

// ---- the land provinces: every land chunk to one province of lands.json
function landProvinces(ch, kind, rel, lands, admin) {
  const n = ch.count, P = lands.provinces, prov = new Int32Array(n).fill(-1);
  const { unit, ids } = chunkUnits(ch, admin, kind);
  const owners = new Map();                                          // unit → provinces that grew from it
  P.forEach((p, i) => { for (const u of p.admin) { if (!owners.has(u)) owners.set(u, []); owners.get(u).push(i); } });
  const unitChunks = new Map();
  for (let k = 0; k < n; k++) if (kind[k] === LAND && unit[k] >= 0) { const u = ids[unit[k]]; if (!unitChunks.has(u)) unitChunks.set(u, []); unitChunks.get(u).push(k); }
  const anchorChunk = ([lat, lon]) => ch.at(lat, lon);
  const cost = (a, l) => Math.hypot(ch.cx[a] - ch.cx[l.k], ch.cy[a] - ch.cy[l.k]) + crossKm(rel, a, l.k, l);
  // 1. a unit of one land goes whole to it; a unit several lands grew from is shared out from their anchors, the way
  // water spreads: dear across ridges, so every share is a set of whole valleys
  for (const [u, list] of [...unitChunks].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const own = owners.get(u); if (!own) continue;
    if (own.length === 1) { for (const k of list) prov[k] = own[0]; continue; }
    const member = new Set(list), dist = new Map(), heap = minHeap();
    for (const i of own) for (const a of P[i].at) { const k = anchorChunk(a); if (member.has(k) && !(dist.get(k) <= 0)) { dist.set(k, 0); prov[k] = i; heap.push(0, k); } }
    while (heap.size) {
      const [d, k] = heap.pop(); if (d > dist.get(k)) continue;
      for (const l of ch.links[k]) {
        if (!member.has(l.k)) continue;
        const nd = d + cost(k, l);
        if (nd < (dist.get(l.k) ?? Infinity)) { dist.set(l.k, nd); prov[l.k] = prov[k]; heap.push(nd, l.k); }
      }
    }
    for (const k of list) if (prov[k] < 0) {                         // an island of the unit without an anchor: the nearest land
      let best = own[0], bd = Infinity;
      for (const i of own) for (const [lat, lon] of P[i].at) { const [x, y] = kmOf(lat, lon), d = (x - ch.cx[k]) ** 2 + (y - ch.cy[k]) ** 2; if (d < bd) { bd = d; best = i; } }
      prov[k] = best;
    }
  }
  // 2. land the units do not reach (a cape beyond a simplified outline) takes its neighbours' land
  const q = [];
  for (let k = 0; k < n; k++) if (prov[k] >= 0) q.push(k);
  for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (kind[l.k] === LAND && prov[l.k] < 0) { prov[l.k] = prov[q[h]]; q.push(l.k); }
  for (let k = 0; k < n; k++) if (kind[k] === LAND && prov[k] < 0) {
    let best = 0, bd = Infinity;
    P.forEach((p, i) => { for (const [lat, lon] of p.at) { const [x, y] = kmOf(lat, lon), d = (x - ch.cx[k]) ** 2 + (y - ch.cy[k]) ** 2; if (d < bd) { bd = d; best = i; } } });
    prov[k] = best;
  }
  // 3. a slope goes with the valley it drains into: a chunk that runs down into another land and is cut off from its
  // own by a ridge goes over; the lowest first, so a whole valley follows its floor
  const down = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    if (kind[k] !== LAND) continue;
    let best = -1, bh = ch.height[k] - 40;
    for (const l of ch.links[k]) if (kind[l.k] === LAND && ch.height[l.k] < bh && reliefOf(rel, k, l.k).ridge < 100) { bh = ch.height[l.k]; best = l.k; }   // water does not run over a ridge
    down[k] = best;
  }
  // the floor of the valley a chunk drains to: down the steepest way while the ground keeps falling
  const floorOf = k => { let x = k; for (let i = 0; i < 16 && down[x] >= 0; i++) x = down[x]; return x; };
  // where the heart of every land drains to: a slope that drains to the same valley floor stays (an upper valley like
  // Andorra or Cerdanya is a land of its own, even if its river runs on into another)
  const homeFloors = P.map(p => new Set(p.at.map(a => anchorChunk(a)).filter(k => k >= 0 && kind[k] === LAND).map(floorOf)));
  const order = [...Array(n).keys()].filter(k => kind[k] === LAND && down[k] >= 0).sort((a, b) => ch.height[a] - ch.height[b] || a - b);
  const moved = [];
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (const k of order) {
      const d = down[k]; if (prov[d] === prov[k]) continue;
      // with its own land the chunk keeps only ridges or ground along and up the slope — no way down
      let rOwn = Infinity, open = false;
      for (const l of ch.links[k]) {
        if (kind[l.k] !== LAND || prov[l.k] !== prov[k]) continue;
        const r = reliefOf(rel, k, l.k).ridge; rOwn = Math.min(rOwn, r);
        if (r < 150 && ch.height[l.k] <= ch.height[k] - 20) open = true;
      }
      const rDown = reliefOf(rel, k, d).ridge, f = floorOf(k);
      const behindRidge = rOwn >= Math.max(150, rDown + 120);                                   // cut off by a ridge
      const onSlope = !open && prov[f] === prov[d] && ch.height[k] - ch.height[f] >= 150 && !homeFloors[prov[k]].has(f);   // a slope of the other valley
      if (behindRidge || onSlope) { moved.push([k, prov[k], prov[d]]); prov[k] = prov[d]; changed++; }
    }
    if (!changed) break;
  }
  // 4. every province hangs together: a piece cut off from the rest of its land (not an island) joins the land it
  // shares the longest border with
  for (let round = 0; round < 3; round++) {
    const comp = new Int32Array(n).fill(-1), comps = [];
    for (let s = 0; s < n; s++) {
      if (kind[s] !== LAND || comp[s] >= 0) continue;
      const list = [s]; comp[s] = comps.length; let area = 0;
      for (let h = 0; h < list.length; h++) { area += ch.area[list[h]]; for (const l of ch.links[list[h]]) if (kind[l.k] === LAND && comp[l.k] < 0 && prov[l.k] === prov[s]) { comp[l.k] = comps.length; list.push(l.k); } }
      comps.push({ p: prov[s], list, area });
    }
    const biggest = new Map(); comps.forEach((c, i) => { if (!biggest.has(c.p) || comps[biggest.get(c.p)].area < c.area) biggest.set(c.p, i); });
    let changed = 0;
    comps.forEach((c, i) => {
      if (biggest.get(c.p) === i) return;
      const border = new Map();
      for (const k of c.list) for (const l of ch.links[k]) if (kind[l.k] === LAND && prov[l.k] !== c.p) border.set(prov[l.k], (border.get(prov[l.k]) || 0) + l.km);
      if (!border.size) return;                                       // an island: it stays
      let best = -1, bk = 0; for (const [p, km] of [...border].sort((a, b) => a[0] - b[0])) if (km > bk) { bk = km; best = p; }
      for (const k of c.list) prov[k] = best; changed++;
    });
    if (!changed) break;
  }
  return { prov, moved };
}

// ---- the seas: every sea chunk to a real sea of lands.json. A sea has an outline after the descriptions of the
// International Hydrographic Organization (its borders run from cape to cape, across straits); the middle of a chunk
// inside it puts the chunk into that sea (the first outline that holds it). A chunk no outline holds takes the sea
// nearest over the water, and a piece of a sea cut off from the rest of it joins the sea it borders longest.
export function seaChunks(ch, kind, seas) {
  const n = ch.count, seaOf = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    if (kind[k] !== SEA) continue;
    const c = ch.centre(k);
    for (let i = 0; i < seas.length; i++) if (seas[i].outline && pointInRing(c.lon, c.lat, seas[i].outline)) { seaOf[k] = i; break; }
  }
  for (let i = 0; i < seas.length; i++) if (!seas[i].outline) for (const [lat, lon] of seas[i].at) { const k = ch.at(lat, lon); if (k >= 0 && kind[k] === SEA) seaOf[k] = i; }
  const dist = new Float64Array(n).fill(Infinity), heap = minHeap();
  for (let k = 0; k < n; k++) if (seaOf[k] >= 0) { dist[k] = 0; heap.push(0, k); }
  while (heap.size) {
    const [d, k] = heap.pop(); if (d > dist[k]) continue;
    for (const l of ch.links[k]) { if (kind[l.k] !== SEA) continue; const nd = d + Math.hypot(ch.cx[k] - ch.cx[l.k], ch.cy[k] - ch.cy[l.k]); if (nd < dist[l.k]) { dist[l.k] = nd; seaOf[l.k] = seaOf[k]; heap.push(nd, l.k); } }
  }
  for (let k = 0; k < n; k++) if (kind[k] === SEA && seaOf[k] < 0) seaOf[k] = 0;
  for (let round = 0; round < 3; round++) {
    const comp = new Int32Array(n).fill(-1), comps = [];
    for (let s = 0; s < n; s++) {
      if (kind[s] !== SEA || comp[s] >= 0) continue;
      const list = [s]; comp[s] = comps.length;
      for (let h = 0; h < list.length; h++) for (const l of ch.links[list[h]]) if (kind[l.k] === SEA && comp[l.k] < 0 && seaOf[l.k] === seaOf[s]) { comp[l.k] = comps.length; list.push(l.k); }
      comps.push({ s: seaOf[s], list });
    }
    const biggest = new Map(); comps.forEach((c, i) => { if (!biggest.has(c.s) || comps[biggest.get(c.s)].list.length < c.list.length) biggest.set(c.s, i); });
    let changed = 0;
    comps.forEach((c, i) => {
      if (biggest.get(c.s) === i) return;
      const border = new Map();
      for (const k of c.list) for (const l of ch.links[k]) if (kind[l.k] === SEA && seaOf[l.k] !== c.s) border.set(seaOf[l.k], (border.get(seaOf[l.k]) || 0) + l.km);
      if (!border.size) return;
      let best = -1, bk = 0; for (const [s, km] of [...border].sort((a, b) => a[0] - b[0])) if (km > bk) { bk = km; best = s; }
      for (const k of c.list) seaOf[k] = best; changed++;
    });
    if (!changed) break;
  }
  return seaOf;
}

// how many people a chunk feeds, for the size of districts: districts are smaller on fertile lowland and the coast,
// larger in the mountains and on the dry plateau (a district is about the same "weight")
function weight(ch, kind, k) {
  const h = ch.height[k];
  // (the owner, 12.11.2026: districts may differ in size but should all be about the same — so the spread is mild)
  let f = h < 200 ? 1.17 : h < 500 ? 1.08 : h < 900 ? .96 : h < 1300 ? .88 : .8;
  if (ch.links[k].some(l => kind[l.k] === SEA)) f *= 1.1;
  return ch.area[k] * f;
}

// ---- the division
// ch: album.chunks; lands: lands.json, admin: admin.json (public/assets/album/division/); heightAt(lat, lon) metres;
// lakes: [{ ring }]; size: district size in km (20, 30, 50, 100) — a district is about size² km² of middling land.
// rivers: [{ pts, rank }] — the outlines of districts run along them (cells.js)
export function buildDivision(ch, { lands, admin, heightAt = null, lakes = [], size = 20, rivers = [] } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = ch.count, sizes = levelSizes(size), T = size ** 2;
  const kind = chunkKinds(ch, lakes), rel = linkRelief(ch, heightAt);
  const { prov: landProv, moved } = landProvinces(ch, kind, rel, lands, admin);
  const nLP = lands.provinces.length;

  // the chunk graph: on land the crossing costs, on water only the distance; the node size is the chunk's weight
  const X = Float64Array.from(ch.cx), Y = Float64Array.from(ch.cy), W = new Float64Array(n), edges = [];
  for (let k = 0; k < n; k++) W[k] = kind[k] === LAND ? weight(ch, kind, k) : ch.area[k];
  for (let a = 0; a < n; a++) for (const l of ch.links[a]) {
    const b = l.k; if (b < a) continue;
    edges.push(a, b, Math.hypot(X[a] - X[b], Y[a] - Y[b]) + (kind[a] === LAND && kind[b] === LAND ? crossKm(rel, a, b, l) : 0));
  }
  const g = makeGraph(n, X, Y, W, edges);
  const district = new Int32Array(n).fill(-1), dProv = [];
  let count = 0;
  const take = (label, m, provOf) => { const first = count; for (let k = 0; k < n; k++) if (label[k] >= 0) district[k] = count + label[k]; count += m; for (let d = first; d < count; d++) dProv.push(-1); for (let k = 0; k < n; k++) if (label[k] >= 0) dProv[district[k]] = provOf(k); };

  // 1. land districts: every province cut into valleys and comarcas
  const gl = new Int32Array(n); for (let k = 0; k < n; k++) gl[k] = kind[k] === LAND ? landProv[k] : -1;
  const lp = partition(g, gl, T, { iters: 12, minK: .4, maxK: 2.2 });
  take(lp.label, lp.count, k => landProv[k]);
  const nLand = count;

  // 2. lakes: a lake is one district (a big one several), in the land around it
  const gk = new Int32Array(n); for (let k = 0; k < n; k++) gk[k] = kind[k] === LAKE ? 0 : -1;
  const lk = partition(g, gk, T, { iters: 8, minK: .25, maxK: 1.8 });
  const lakeProv = label => { const km = new Map(); for (let k = 0; k < n; k++) if (lk.label[k] === label) for (const l of ch.links[k]) if (kind[l.k] === LAND) km.set(landProv[l.k], (km.get(landProv[l.k]) || 0) + l.km); let best = 0, bk = -1; for (const [p, v] of km) if (v > bk) { bk = v; best = p; } return best; };
  const lakeP = Array.from({ length: lk.count }, (_, i) => lakeProv(i));
  take(lk.label, lk.count, k => lakeP[lk.label[k]]);
  const nLake = count;

  // 3. the sea: every sea chunk to its real sea (seaChunks); in it, along the shore, pieces facing the land districts,
  // so a landing is possible everywhere; farther out even pieces
  const seas = lands.seas, seaOf = seaChunks(ch, kind, seas);
  const reach = Math.max(1, Math.round(size / 15)) * 10 + 5;
  const sdist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), heap = minHeap();
  for (let k = 0; k < n; k++) if (kind[k] === LAND && ch.links[k].some(l => kind[l.k] === SEA)) { sdist[k] = 0; from[k] = k; heap.push(0, k); }
  while (heap.size) {
    const [d, k] = heap.pop(); if (d > sdist[k]) continue;
    for (const l of ch.links[k]) {
      const m = l.k; if (kind[m] !== SEA) continue;
      const nd = Math.hypot(X[m] - X[from[k]], Y[m] - Y[from[k]]);
      if (nd <= reach && nd < sdist[m]) { sdist[m] = nd; from[m] = from[k]; heap.push(nd, m); }
    }
  }
  const coastKey = new Float64Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (kind[k] === SEA && from[k] >= 0) coastKey[k] = district[from[k]] * 64 + seaOf[k];
  const seaLabel = new Int32Array(n).fill(-1);
  let nSea = 0;
  for (let s = 0; s < n; s++) {
    if (coastKey[s] < 0 || seaLabel[s] >= 0) continue;
    const list = [s]; seaLabel[s] = nSea;
    for (let h = 0; h < list.length; h++) for (const l of ch.links[list[h]]) if (seaLabel[l.k] < 0 && coastKey[l.k] === coastKey[s]) { seaLabel[l.k] = nSea; list.push(l.k); }
    nSea++;
  }
  const gc = new Int32Array(n); for (let k = 0; k < n; k++) gc[k] = coastKey[k] >= 0 ? seaOf[k] : -1;
  const coast = tidy(g, gc, seaLabel, nSea, T, { minK: .35, maxK: 2.2 });
  const go = new Int32Array(n); for (let k = 0; k < n; k++) go[k] = kind[k] === SEA && coastKey[k] < 0 ? seaOf[k] : -1;
  const open = partition(g, go, T * 4, { iters: 10, minK: .3, maxK: 2 });
  const sea = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (coast.label[k] >= 0) sea[k] = coast.label[k]; else if (open.label[k] >= 0) sea[k] = coast.count + open.label[k];
  const gs = new Int32Array(n); for (let k = 0; k < n; k++) gs[k] = kind[k] === SEA ? seaOf[k] : -1;
  const seaFinal = tidy(g, gs, sea, coast.count + open.count, T, { minK: .25, maxK: 1e9 });
  // sea provinces: the sea districts of one named sea grouped into pieces of about a province
  const sd0 = count;
  take(seaFinal.label, seaFinal.count, () => -1);
  const nSD = count - sd0, sdx = new Float64Array(nSD), sdy = new Float64Array(nSD), sda = new Float64Array(nSD), sdSea = new Int32Array(nSD);
  for (let k = 0; k < n; k++) if (kind[k] === SEA) { const d = district[k] - sd0; sdx[d] += X[k] * ch.area[k]; sdy[d] += Y[k] * ch.area[k]; sda[d] += ch.area[k]; sdSea[d] = seaOf[k]; }
  for (let d = 0; d < nSD; d++) { sdx[d] /= sda[d]; sdy[d] /= sda[d]; }
  const sEdges = [], seenE = new Set();
  for (let a = 0; a < n; a++) if (kind[a] === SEA) for (const l of ch.links[a]) {
    if (kind[l.k] !== SEA) continue;
    const da = district[a] - sd0, db = district[l.k] - sd0; if (da >= db) continue;
    const key = da * 65536 + db; if (seenE.has(key)) continue; seenE.add(key);
    sEdges.push(da, db, Math.hypot(sdx[da] - sdx[db], sdy[da] - sdy[db]));
  }
  const sp = partition(makeGraph(nSD, sdx, sdy, sda, sEdges), sdSea, sizes.province ** 2 * 1.5, { iters: 8, minK: .3, maxK: 2.2 });

  // ---- provinces and regions: the land ones of lands.json, then the sea ones
  const regionIds = lands.regions.map(r => r.id), nLR = regionIds.length;
  const landName = Object.fromEntries((lands.lands || []).map(l => [l.id, l.name]));        // the historical land a province belongs to
  const provinces = lands.provinces.map(p => ({ name: p.name, region: regionIds.indexOf(p.region), kind: LAND, at: p.at, land: landName[p.land] || '' }));
  const seaProvBase = provinces.length, seaCountIn = new Int32Array(seas.length);
  const spSea = new Int32Array(sp.count); for (let d = 0; d < nSD; d++) spSea[sp.label[d]] = sdSea[d];
  for (let i = 0; i < sp.count; i++) seaCountIn[spSea[i]]++;
  const seaSeen = new Int32Array(seas.length);
  for (let i = 0; i < sp.count; i++) { const s = spSea[i]; provinces.push({ name: seaCountIn[s] > 1 ? `${seas[s].name}, зона ${++seaSeen[s]}` : seas[s].name, region: nLR + s, kind: SEA, sea: s }); }
  const regions = [...lands.regions.map(r => ({ name: r.name, kind: LAND })), ...seas.map((s, i) => ({ name: s.name, kind: SEA, sea: i }))];
  for (let d = 0; d < nSD; d++) dProv[sd0 + d] = seaProvBase + sp.label[d];

  const kinds = new Uint8Array(count);
  for (let d = 0; d < count; d++) kinds[d] = d < nLand ? LAND : d < nLake ? LAKE : SEA;
  const province = Int32Array.from(dProv), region = Int32Array.from(provinces.map(p => p.region));
  const div = finish(ch, { district, count, kinds, kind, province, region, provinces, regions, size, sizes, nLP });
  div.landProv = landProv; div.moved = moved; div.seaOf = seaOf;
  // the outline of every land province and district, texel by texel: straightened, along the rivers and the crests
  // (cells.js), chunk by chunk of 1 km² (km.js): a district is the chunks div.cells gives it, and its numbers are
  // summed from them (districtSummary). div.chunks — the natural cells the partition gave a district — is what the
  // district was laid out from, and what the other aspects still ask by.
  // The borders are then drawn once as smooth lines along the rivers and the crests (border.js), and every chunk goes
  // to the district its seed lies in by those lines: the chunks of a district are what is drawn as the district.
  { const c = districtCells(ch, div, { heightAt, rivers }); div.cells = c.cells; div.provCells = c.prov; div.provChunks = c.prov0; div.raster = { hgt: c.hgt, riv: c.riv, heightAt };
    div.geo = borderGeometry(div, rivers);
    for (let t = 0; t < div.cells.length; t++) { const d = div.cells[t]; if (d >= 0 && div.kinds[d] === LAND) div.provCells[t] = div.province[d]; }
    kmData(div); }
  div.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return div;
}

// ---- districts' members, middles, neighbours; colours; where to write the names of provinces and regions
function finish(ch, { district, count, kinds, kind, province, region, provinces, regions, size, sizes }) {
  const n = ch.count, chunks = Array.from({ length: count }, () => []);
  for (let k = 0; k < n; k++) chunks[district[k]].push(k);
  const cxs = new Float64Array(count), cys = new Float64Array(count), area = new Float64Array(count);
  for (let d = 0; d < count; d++) {
    for (const k of chunks[d]) { const a = ch.area[k]; cxs[d] += ch.cx[k] * a; cys[d] += ch.cy[k] * a; area[d] += a; }
    cxs[d] /= area[d] || 1; cys[d] /= area[d] || 1;
  }
  const dn = Array.from({ length: count }, () => new Set()), pn = Array.from({ length: provinces.length }, () => new Set()), rn = Array.from({ length: regions.length }, () => new Set());
  for (let a = 0; a < n; a++) for (const l of ch.links[a]) {
    const da = district[a], db = district[l.k]; if (da === db) continue;
    dn[da].add(db);
    const pa = province[da], pb = province[db]; if (pa === pb) continue;
    pn[pa].add(pb); if (region[pa] !== region[pb]) rn[region[pa]].add(region[pb]);
  }
  const neighbours = dn.map(s => [...s].sort((a, b) => a - b));
  const colour = {
    district: colourise(count, neighbours, d => kinds[d]),
    province: colourise(provinces.length, pn.map(s => [...s].sort((a, b) => a - b)), p => provinces[p].kind === SEA ? 1 : 0),
    region: colourise(regions.length, rn.map(s => [...s].sort((a, b) => a - b)), r => regions[r].kind === SEA ? 1 : 0),
  };
  // the name of a land goes on its deepest chunk near its middle (a land may be bent like a horseshoe)
  const chunkProv = new Int32Array(n); for (let k = 0; k < n; k++) chunkProv[k] = province[district[k]];
  const chunkReg = new Int32Array(n); for (let k = 0; k < n; k++) chunkReg[k] = region[chunkProv[k]];
  const labelsOf = (of, units) => {
    const depth = new Int32Array(n).fill(-1), q = [];
    for (let k = 0; k < n; k++) if (of[k] >= 0 && ch.links[k].some(l => of[l.k] !== of[k])) { depth[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) for (const l of ch.links[q[h]]) if (depth[l.k] < 0 && of[l.k] === of[q[h]]) { depth[l.k] = depth[q[h]] + 1; q.push(l.k); }
    const sx = new Float64Array(units.length), sy = new Float64Array(units.length), sa = new Float64Array(units.length), maxD = new Int32Array(units.length);
    for (let k = 0; k < n; k++) { const u = of[k]; if (u < 0) continue; sx[u] += ch.cx[k] * ch.area[k]; sy[u] += ch.cy[k] * ch.area[k]; sa[u] += ch.area[k]; maxD[u] = Math.max(maxD[u], depth[k]); }
    const best = new Int32Array(units.length).fill(-1), score = new Float64Array(units.length).fill(-Infinity);
    for (let k = 0; k < n; k++) {
      const u = of[k]; if (u < 0 || !sa[u]) continue;
      const s = Math.min(depth[k], 6) * 30 - Math.hypot(ch.cx[k] - sx[u] / sa[u], ch.cy[k] - sy[u] / sa[u]) * .5;
      if (s > score[u]) { score[u] = s; best[u] = k; }
    }
    return units.map((u, i) => best[i] >= 0 ? { name: u.name, area: sa[i], ...ch.centre(best[i]) } : null);
  };
  const labels = { province: labelsOf(chunkProv, provinces), region: labelsOf(chunkReg, regions) };
  return {
    size, sizes, count, district, kinds, kind, chunks, area, cx: cxs, cy: cys, neighbours,
    province, provinceCount: provinces.length, region, regionCount: regions.length, provinces, regions,
    colour, labels,
  };
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

// ---- a state of history assembled from provinces (lands.json "states"): 1 for every chunk inside it
export function stateMask(div, lands, id) {
  const st = (lands.states || []).find(s => s.id === id), mask = new Uint8Array(div.district.length);
  if (!st) return mask;
  const want = new Set(st.provinces.map(p => lands.provinces.findIndex(q => q.id === p)));
  for (let k = 0; k < mask.length; k++) if (want.has(div.province[div.district[k]])) mask[k] = 1;
  return mask;
}

// ---- names of districts: a land district takes the name of its largest settlement (album.data.vectors.places), a
// coastal town in a water chunk names the land district beside it; the rest are numbered
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
// A district is its chunks of 1 km² (div.cells): its area is their number, and what the nature models keep cell by
// cell (forest, swamp, resources) goes to the district by the share of each cell's chunks that lie in it. So the
// numbers belong to the outline that is drawn.
//   classes: how many of its chunks are of each class of ground, [—, 1 … 5] (land only);
//   living:  how many chunks nobody can live on, people barely can, people can freely
export function districtSummary(div, d, ch) {
  const land = div.kinds[d] === LAND, parts = cellsOfDistrict(div, ch, d), per = cellsOfChunks(ch).count, chunks = kmData(div).box.num[d];
  const area = chunks * KKM * KKM, landA = land ? area : 0, share = { forest: 0, swamp: 0, built: 0, fields: 0 };
  let w = 0;
  for (const [k, n] of parts) { w += n; if (land) for (const name of Object.keys(share)) share[name] += ch.get(name, k) * n; }
  for (const name of Object.keys(share)) share[name] = land && w > 0 ? share[name] / w : 0;
  const sums = [];
  for (const l of ch.layers.values()) {
    if (!l.sum) continue;
    let s = 0; for (const [k, n] of parts) s += (l.data[k] || 0) * n / per[k];
    sums.push({ name: l.name, title: l.title, unit: l.unit || '', value: s });
  }
  let classes = null, living = null;
  if (land) {
    const facts = kmFacts(div, div.raster.heightAt); classes = [0, 0, 0, 0, 0, 0]; living = [0, 0, 0];
    for (const c of chunksOfDistrict(div, d)) { classes[facts.cls[c]]++; living[livingOf(facts.cls[c])]++; }
  }
  const p = div.province[d], r = div.region[p];
  return { id: d, name: div.names ? div.names[d] : `Район № ${d + 1}`, kind: KIND_ID[div.kinds[d]], area, landArea: landA, chunks, cells: (div.chunks[d] || []).length, share, sums, classes, living,
    province: p, region: r, provinceName: div.provinces[p]?.name || '', regionName: div.regions[r]?.name || '', neighbours: div.neighbours[d].length };
}
