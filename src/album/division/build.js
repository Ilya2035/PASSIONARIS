// The division of the album's world: every chunk of 10 × 10 km goes to exactly one district; districts are grouped
// into provinces, provinces into regions. Land, sea and lakes are divided apart. The algorithm is described in
// docs/album/division.md. Plain JavaScript without the GPU: the page and the tests (tests/album-division.test.mjs)
// run the same code, and the same data always give the same division.
import { CHUNK_KM, CN, CI0, CJ0, kmOf, llOf } from '../chunks.js';
import { BBOX } from '../geo.js';
import { makeGraph, partition, tidy } from './graph.js';
import { smoothLine } from '../layers/ribbon.js';

export const LAND = 0, SEA = 1, LAKE = 2;
export const KIND_ID = ['land', 'sea', 'lake'];
export const KIND_TITLE = ['суша', 'море', 'озеро'];
export const SIZES = [30, 50, 100];                     // the district sizes the knob offers, km

// a province is about 100 km across, a region about 340 km; for larger districts they grow with them
export const levelSizes = s => { const p = Math.max(100, 2.2 * s); return { district: s, province: p, region: Math.max(340, 2.2 * p) }; };

// how much a river makes a border, by its rank in the data (5 the largest .. 9 small): in units of 30 km of walking
const RIVER_PEN = { 5: 3, 6: 2.6, 7: 2.2, 8: 1.8, 9: 1.3 };
const riverPen = rank => RIVER_PEN[Math.max(5, Math.min(9, rank))] || 1.3;

// the album shows nothing outside its region (glsl.js inRegion): there is only deep water there
const inside = (lat, lon) => lat > BBOX.lat0 - .05 && lat < BBOX.lat1 + .05 && lon > BBOX.lon0 - .05 && lon < BBOX.lon1 + .05;
const N = CN * CN;
const cx = k => (k % CN + CI0 + .5) * CHUNK_KM, cy = k => (((k / CN) | 0) + CJ0 + .5) * CHUNK_KM;

function pointInRing(lon, lat, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---- the kind of every chunk: land, sea or lake
export function chunkKinds(land, lakes = []) {
  const kind = new Uint8Array(N), landEff = new Float32Array(N), lakeCover = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let inn = 0;
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const p = llOf(cx(k) + (a - 1) * 3.3, cy(k) + (b - 1) * 3.3);
      if (inside(p.lat, p.lon)) inn++;
    }
    landEff[k] = land[k] * inn / 9;
  }
  // lake outlines (the water work will bring its own): share of each chunk inside one
  for (const lake of lakes) {
    const ring = lake.ring; if (!ring || ring.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lon, lat] of ring) { const [x, y] = kmOf(lat, lon); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let j = Math.floor(y0 / CHUNK_KM); j <= Math.floor(y1 / CHUNK_KM); j++) for (let i = Math.floor(x0 / CHUNK_KM); i <= Math.floor(x1 / CHUNK_KM); i++) {
      const xi = i - CI0, yj = j - CJ0; if (xi < 0 || yj < 0 || xi >= CN || yj >= CN) continue;
      let n = 0;
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) { const p = llOf((i + (a + .5) / 4) * CHUNK_KM, (j + (b + .5) / 4) * CHUNK_KM); if (pointInRing(p.lon, p.lat, ring)) n++; }
      lakeCover[yj * CN + xi] = Math.max(lakeCover[yj * CN + xi], n / 16);
    }
  }
  for (let k = 0; k < N; k++) kind[k] = lakeCover[k] >= .5 ? LAKE : landEff[k] >= .5 ? LAND : SEA;
  // water that does not reach the open sea is a lake: the water around the edge of the grid is the sea
  const seen = new Uint8Array(N), queue = [];
  for (let k = 0; k < N; k++) {
    const x = k % CN, y = (k / CN) | 0;
    if ((x === 0 || y === 0 || x === CN - 1 || y === CN - 1) && kind[k] === SEA) { seen[k] = 1; queue.push(k); }
  }
  for (let q = 0; q < queue.length; q++) for (const m of nbs(queue[q])) if (!seen[m] && kind[m] === SEA) { seen[m] = 1; queue.push(m); }
  for (let k = 0; k < N; k++) if (kind[k] === SEA && !seen[k]) kind[k] = LAKE;
  return { kind, landEff, lakeCover };
}
function nbs(k) { const x = k % CN, y = (k / CN) | 0, out = []; if (x > 0) out.push(k - 1); if (x < CN - 1) out.push(k + 1); if (y > 0) out.push(k - CN); if (y < CN - 1) out.push(k + CN); return out; }

// the rivers as the map draws them (layers/rivers.js): smoothed centre lines, [lon, lat]
export const smoothRivers = (rivers = []) => rivers.filter(r => r.pts && r.pts.length > 2).map(r => ({ ...r, pts: smoothLine(r.pts, 1.2, 2) }));

// ---- rivers between chunks: for every pair of side neighbours, the smallest rank of a river that runs between their
// centres (99 = none). Index: 2k = toward k + 1 (east), 2k + 1 = toward k + CN (north).
export function riverCrossings(rivers = []) {
  const rank = new Uint8Array(N * 2).fill(99);
  const mark = (i, j, east, r) => {
    const xi = i - CI0, yj = j - CJ0; if (xi < 0 || yj < 0 || yj >= CN || xi >= CN) return;
    if (east ? xi >= CN - 1 : yj >= CN - 1) return;
    const e = (yj * CN + xi) * 2 + (east ? 0 : 1); if (r < rank[e]) rank[e] = r;
  };
  for (const r of rivers) {
    const pts = (r.pts || []).map(([lon, lat]) => kmOf(lat, lon));
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
      // the river crosses the line between centres (i, j)–(i + 1, j): y = (j + .5) · 10
      for (let j = Math.ceil(Math.min(ay, by) / CHUNK_KM - .5); j + .5 <= Math.max(ay, by) / CHUNK_KM; j++) {
        const yc = (j + .5) * CHUNK_KM; if (ay === by) continue;
        const t = (yc - ay) / (by - ay); if (t < 0 || t >= 1) continue;
        const x = ax + (bx - ax) * t; mark(Math.floor(x / CHUNK_KM - .5), j, true, r.rank);
      }
      // … and (i, j)–(i, j + 1): x = (i + .5) · 10
      for (let i = Math.ceil(Math.min(ax, bx) / CHUNK_KM - .5); i + .5 <= Math.max(ax, bx) / CHUNK_KM; i++) {
        const xc = (i + .5) * CHUNK_KM; if (ax === bx) continue;
        const t = (xc - ax) / (bx - ax); if (t < 0 || t >= 1) continue;
        const y = ay + (by - ay) * t; mark(i, Math.floor(y / CHUNK_KM - .5), false, r.rank);
      }
    }
  }
  return rank;
}

// ---- what it costs to walk from a chunk to its neighbour, beyond the 10 km of the step itself: a river between them,
// a ridge or watershed between them (the ground rises above both), a step from lowland to upland.
// → Float32Array(2N), same index as riverCrossings; in km of walking.
export function edgePenalties(height, heightAt, rivers) {
  const rr = riverCrossings(rivers), pen = new Float32Array(N * 2);
  const at = heightAt ? (x, y) => { const p = llOf(x, y); return inside(p.lat, p.lon) ? Math.max(0, heightAt(p.lat, p.lon)) : 0; } : null;
  const S = 30;
  for (let k = 0; k < N; k++) for (let d = 0; d < 2; d++) {
    const x = k % CN, y = (k / CN) | 0;
    if (d === 0 ? x >= CN - 1 : y >= CN - 1) continue;
    const m = d === 0 ? k + 1 : k + CN, e = k * 2 + d;
    let p = rr[e] < 99 ? S * riverPen(rr[e]) : 0;
    if (at) {
      // the height profile between the two centres, each sample a little smoothed across the line
      const ax = cx(k), ay = cy(k), bx = cx(m), by = cy(m), ox = d === 0 ? 0 : 2, oy = d === 0 ? 2 : 0;
      let top = 0, h0 = 0, h1 = 0;
      for (let s = 0; s <= 6; s++) {
        const t = s / 6, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        const h = (at(px, py) + at(px + ox, py + oy) + at(px - ox, py - oy)) / 3;
        if (s === 0) h0 = h; else if (s === 6) h1 = h; else top = Math.max(top, h);
      }
      const ridge = Math.max(0, top - Math.max(h0, h1) - 40);
      p += S * Math.min(3, ridge / 220);
    }
    p += S * Math.min(1.5, Math.abs(height[k] - height[m]) / 450);
    pen[e] = p;
  }
  return { pen, river: rr };
}

// ---- the division
// input: { land, height (Float32Array per chunk, from album.chunks), heightAt(lat, lon) metres, rivers, lakes,
//          size: district size in km (30, 50, 100) }
export function buildDivision({ land, height, heightAt = null, rivers = [], lakes = [], size = 30 }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sizes = levelSizes(size), T = (sizes.district / CHUNK_KM) ** 2;
  const { kind, landEff, lakeCover } = chunkKinds(land, lakes);
  const { pen, river } = edgePenalties(height, heightAt, smoothRivers(rivers));

  // the chunk graph: every side neighbour; walking on land costs the penalties, on water only the distance
  const X = new Float64Array(N), Y = new Float64Array(N), ones = new Float64Array(N).fill(1), edges = [];
  for (let k = 0; k < N; k++) { X[k] = cx(k); Y[k] = cy(k); }
  for (let k = 0; k < N; k++) for (let d = 0; d < 2; d++) {
    const x = k % CN, y = (k / CN) | 0;
    if (d === 0 ? x >= CN - 1 : y >= CN - 1) continue;
    const m = d === 0 ? k + 1 : k + CN;
    edges.push(k, m, CHUNK_KM + (kind[k] === LAND && kind[m] === LAND ? pen[k * 2 + d] : 0));
  }
  const g = makeGraph(N, X, Y, ones, edges);
  const district = new Int32Array(N).fill(-1);
  let count = 0;
  const take = (label, n) => { for (let k = 0; k < N; k++) if (label[k] >= 0) district[k] = count + label[k]; count += n; };

  // 1. land
  const gl = new Int32Array(N); for (let k = 0; k < N; k++) gl[k] = kind[k] === LAND ? 0 : -1;
  const landPart = partition(g, gl, T, { iters: 12 });
  take(landPart.label, landPart.count);
  const nLand = count;

  // 2. lakes: a lake is one district; a big one is cut into several of the usual size
  const gk = new Int32Array(N); for (let k = 0; k < N; k++) gk[k] = kind[k] === LAKE ? 0 : -1;
  const lakePart = partition(g, gk, T, { iters: 8, minK: .25, maxK: 1.8 });
  take(lakePart.label, lakePart.count);
  const nLake = count;

  // 3. the sea: a strip along the shore cut into pieces that face the land districts, the open sea in even pieces
  const W = Math.max(1, Math.round(sizes.district / 15)), seaLabel = new Int32Array(N).fill(-1), coastOf = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    if (kind[k] !== SEA) continue;
    const x0 = k % CN, y0 = (k / CN) | 0;
    let best = -1, bd = Infinity;
    for (let dy = -W; dy <= W; dy++) for (let dx = -W; dx <= W; dx++) {
      const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= CN || y >= CN) continue;
      const m = y * CN + x, d2 = dx * dx + dy * dy;
      if (kind[m] === LAND && d2 <= (W + .5) ** 2 && (d2 < bd || (d2 === bd && m < best))) { bd = d2; best = m; }
    }
    if (best >= 0) coastOf[k] = district[best];
  }
  // pieces of the strip: side-connected chunks facing the same land district
  let nSea = 0;
  for (let s = 0; s < N; s++) {
    if (coastOf[s] < 0 || seaLabel[s] >= 0) continue;
    const list = [s]; seaLabel[s] = nSea;
    for (let q = 0; q < list.length; q++) for (const m of nbs(list[q])) if (seaLabel[m] < 0 && coastOf[m] === coastOf[s]) { seaLabel[m] = nSea; list.push(m); }
    nSea++;
  }
  const gc = new Int32Array(N); for (let k = 0; k < N; k++) gc[k] = coastOf[k] >= 0 ? 0 : -1;
  const coast = tidy(g, gc, seaLabel, nSea, T, { minK: .35, maxK: 2.2 });
  // the open sea
  const go = new Int32Array(N); for (let k = 0; k < N; k++) go[k] = kind[k] === SEA && coastOf[k] < 0 ? 0 : -1;
  const T2 = T * 4, open = partition(g, go, T2, { iters: 10, minK: .3, maxK: 2 });
  const sea = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (coast.label[k] >= 0) sea[k] = coast.label[k]; else if (open.label[k] >= 0) sea[k] = coast.count + open.label[k];
  // a scrap of open sea shut in between strips joins a strip piece beside it
  const gs = new Int32Array(N); for (let k = 0; k < N; k++) gs[k] = kind[k] === SEA ? 0 : -1;
  const seaSize = new Float64Array(coast.count + open.count); for (let k = 0; k < N; k++) if (sea[k] >= 0) seaSize[sea[k]]++;
  for (let p = coast.count; p < seaSize.length; p++) {
    if (seaSize[p] >= .3 * T) continue;
    const touch = new Map();
    for (let k = 0; k < N; k++) if (sea[k] === p) for (const m of nbs(k)) if (sea[m] >= 0 && sea[m] !== p) touch.set(sea[m], (touch.get(sea[m]) || 0) + 1);
    let best = -1, bn = 0; for (const [q, n] of [...touch].sort((a, b) => a[0] - b[0])) if (n > bn) { bn = n; best = q; }
    if (best >= 0) { for (let k = 0; k < N; k++) if (sea[k] === p) sea[k] = best; seaSize[best] += seaSize[p]; seaSize[p] = 0; }
  }
  const seaFinal = tidy(g, gs, sea, seaSize.length, T, { minK: .25, maxK: 1e9 });   // only renumbers
  take(seaFinal.label, seaFinal.count);

  const kinds = new Uint8Array(count);
  for (let d = 0; d < count; d++) kinds[d] = d < nLand ? LAND : d < nLake ? LAKE : SEA;
  const div = finish({ district, count, kinds, kind, landEff, lakeCover, pen, river, size, sizes });
  div.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return div;
}

// ---- districts' members, centres, neighbours; then provinces and regions
function finish({ district, count, kinds, kind, landEff, lakeCover, pen, river, size, sizes }) {
  const chunks = Array.from({ length: count }, () => []);
  for (let k = 0; k < N; k++) chunks[district[k]].push(k);
  const cxs = new Float64Array(count), cys = new Float64Array(count), csz = new Float64Array(count);
  for (let d = 0; d < count; d++) { for (const k of chunks[d]) { cxs[d] += cx(k); cys[d] += cy(k); } csz[d] = chunks[d].length; cxs[d] /= csz[d]; cys[d] /= csz[d]; }
  // borders between districts: how many chunk sides they share and what crossing them costs on average
  const border = new Map();
  const key = (a, b) => a < b ? a * 65536 + b : b * 65536 + a;
  for (let k = 0; k < N; k++) for (let d = 0; d < 2; d++) {
    const x = k % CN, y = (k / CN) | 0;
    if (d === 0 ? x >= CN - 1 : y >= CN - 1) continue;
    const m = d === 0 ? k + 1 : k + CN, a = district[k], b = district[m];
    if (a === b) continue;
    const kk = key(a, b), r = border.get(kk) || { a: Math.min(a, b), b: Math.max(a, b), n: 0, pen: 0 };
    r.n++; r.pen += kind[k] === LAND && kind[m] === LAND ? pen[k * 2 + d] : 0; border.set(kk, r);
  }
  const borders = [...border.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  const neighbours = Array.from({ length: count }, () => []);
  for (const r of borders) { neighbours[r.a].push(r.b); neighbours[r.b].push(r.a); }
  for (const n of neighbours) n.sort((a, b) => a - b);

  // provinces: districts grouped like chunks into districts; land and lakes together, the sea apart
  const S = sizes.district;
  const classOf = kd => kd === SEA ? 1 : 0;
  const level = (n, x, y, sz, cls, bs, levelKm, rivK, islands) => {
    const edges = [];
    for (const r of bs) {
      const dist = Math.hypot(x[r.a] - x[r.b], y[r.a] - y[r.b]);
      edges.push(r.a, r.b, dist + (r.pen / r.n) * (levelKm / S) * rivK);
    }
    for (const v of islands) edges.push(v.a, v.b, v.cost);
    const g = makeGraph(n, x, y, sz, edges);
    return partition(g, cls, (levelKm / CHUNK_KM) ** 2, { iters: 10, minK: .4, maxK: 2.1 });
  };
  const dClass = Int32Array.from(kinds, classOf);
  const isl1 = islandLinks(district, kind, chunks, dClass, (sizes.province / CHUNK_KM) ** 2, 16, sizes.province);
  const prov = level(count, cxs, cys, csz, dClass, borders, sizes.province, .6, isl1);
  const province = prov.label, nP = prov.count;
  // provinces' centres, borders
  const pcx = new Float64Array(nP), pcy = new Float64Array(nP), psz = new Float64Array(nP), pClass = new Int32Array(nP);
  for (let d = 0; d < count; d++) { const p = province[d]; pcx[p] += cxs[d] * csz[d]; pcy[p] += cys[d] * csz[d]; psz[p] += csz[d]; pClass[p] = dClass[d]; }
  for (let p = 0; p < nP; p++) { pcx[p] /= psz[p]; pcy[p] /= psz[p]; }
  const pb = new Map();
  for (const r of borders) {
    const a = province[r.a], b = province[r.b]; if (a === b) continue;
    const kk = key(a, b), q = pb.get(kk) || { a: Math.min(a, b), b: Math.max(a, b), n: 0, pen: 0 }; q.n += r.n; q.pen += r.pen; pb.set(kk, q);
  }
  const pBorders = [...pb.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  const pChunks = Array.from({ length: nP }, () => []); for (let d = 0; d < count; d++) pChunks[province[d]].push(...chunks[d]);
  const pDistrict = new Int32Array(N); for (let k = 0; k < N; k++) pDistrict[k] = province[district[k]];
  const isl2 = islandLinks(pDistrict, kind, pChunks, pClass, (sizes.region / CHUNK_KM) ** 2, 30, sizes.region);
  const reg = level(nP, pcx, pcy, psz, pClass, pBorders, sizes.region, .5, isl2);
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
    size, sizes, count, district, kinds, kind, landEff, lakeCover, chunks, cx: cxs, cy: cys, neighbours, borders, river, pen,
    province, provinceCount: nP, region, regionCount: nR, provinceChunks: pChunks,
    colour: { district: dColour, province: pColour, region: rColour },
  };
}

// Islands too small for a province (region) of their own get one link over the water to the nearest other land, so
// they can join it: { a, b, cost } between units (districts or provinces). unitOf: chunk → unit.
function islandLinks(unitOf, kind, unitChunks, unitClass, target, reach, levelKm) {
  const n = unitChunks.length, land = k => kind[k] !== SEA;
  // land masses: units joined by land borders
  const mass = new Int32Array(n).fill(-1), masses = [];
  const adj = Array.from({ length: n }, () => new Set());
  for (let k = 0; k < N; k++) for (const m of nbs(k)) if (land(k) && land(m) && unitOf[k] !== unitOf[m]) adj[unitOf[k]].add(unitOf[m]);
  for (let s = 0; s < n; s++) {
    if (mass[s] >= 0 || unitClass[s] !== 0) continue;
    const list = [s]; mass[s] = masses.length;
    for (let q = 0; q < list.length; q++) for (const j of adj[list[q]]) if (mass[j] < 0 && unitClass[j] === 0) { mass[j] = masses.length; list.push(j); }
    masses.push(list);
  }
  const links = [];
  for (let id = 0; id < masses.length; id++) {
    const units = masses[id], size = units.reduce((s, u) => s + unitChunks[u].length, 0);
    if (size >= target) continue;
    // over the water from every chunk of this land mass, to the first land of another
    const from = new Int32Array(N).fill(-1), dist = new Int32Array(N).fill(-1), queue = [];
    for (const u of units) for (const k of unitChunks[u]) if (land(k)) { from[k] = u; dist[k] = 0; queue.push(k); }
    queue.sort((a, b) => a - b);
    let found = null;
    for (let q = 0; q < queue.length && !found; q++) {
      const k = queue[q]; if (dist[k] > reach) break;
      for (const m of nbs(k)) {
        if (dist[m] >= 0) continue;
        if (land(m) && mass[unitOf[m]] !== id && unitClass[unitOf[m]] === 0) { found = { a: from[k], b: unitOf[m], steps: dist[k] + 1 }; break; }
        if (!land(m)) { dist[m] = dist[k] + 1; from[m] = from[k]; queue.push(m); }
      }
    }
    if (found) links.push({ a: found.a, b: found.b, cost: found.steps * CHUNK_KM + levelKm });
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

// ---- what a district holds: sums over its chunks (state read from album.chunks, layers with sum: true)
// ---- names: a land district takes the name of its largest settlement (album.data.vectors.places), a coastal town
// in a chunk counted as sea names the land district beside it; the rest are numbered. at(lat, lon) — the district
// as drawn (fine.js), when there is a drawing: by a river the drawing follows the river and may put a town on the
// other bank than its chunk, and the name goes where the player sees the town.
export function districtNames(div, places = [], at = null) {
  const best = new Float64Array(div.count).fill(-1), name = new Array(div.count).fill(null);
  for (const pl of places) {
    const [x, y] = kmOf(pl.lat, pl.lon), i = Math.floor(x / CHUNK_KM) - CI0, j = Math.floor(y / CHUNK_KM) - CJ0;
    if (i < 0 || j < 0 || i >= CN || j >= CN) continue;
    const drawn = at ? at(pl.lat, pl.lon) : -1;
    if (drawn >= 0 && div.kinds[drawn] === LAND) { if ((pl.pop || 0) > best[drawn]) { best[drawn] = pl.pop || 0; name[drawn] = pl.name; } continue; }
    let k = j * CN + i;
    if (div.kinds[div.district[k]] !== LAND) { const m = nbs(k).find(q => div.kinds[div.district[q]] === LAND); if (m === undefined) continue; k = m; }
    const d = div.district[k], pop = pl.pop || 0;
    if (pop > best[d]) { best[d] = pop; name[d] = pl.name; }
  }
  return name.map((n, d) => n || `${div.kinds[d] === SEA ? 'Морской район' : div.kinds[d] === LAKE ? 'Озеро' : 'Район'} № ${d + 1}`);
}

export function districtSummary(div, d, ch) {
  const list = div.chunks[d] || [];
  let area = 0, landA = 0;
  const share = { forest: 0, swamp: 0, built: 0, fields: 0 };
  for (const k of list) {
    const l = div.kind[k] === LAND ? ch.land[k] : 0;
    area += 100; landA += 100 * l;
    for (const name of Object.keys(share)) share[name] += ch.get(name, k) * l;
  }
  const landSum = landA / 100;
  for (const name of Object.keys(share)) share[name] = landSum > 0 ? share[name] / landSum : 0;
  const sums = [];
  for (const l of ch.layers.values()) {
    if (!l.sum) continue;
    let s = 0; for (const k of list) s += l.data[k] || 0;
    sums.push({ name: l.name, title: l.title, unit: l.unit || '', value: s });
  }
  return { id: d, name: div.names ? div.names[d] : `Район № ${d + 1}`, kind: KIND_ID[div.kinds[d]], area, landArea: landA, chunks: list.length, share, sums,
    province: div.province[d], region: div.region[div.province[d]], neighbours: div.neighbours[d].length };
}

