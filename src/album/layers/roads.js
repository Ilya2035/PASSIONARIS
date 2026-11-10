// A first road network to look at: main roads between the largest places and lesser roads to the rest. Each road is
// the cheapest path over the real relief (flat ground and passes are cheap, slopes dear, sea forbidden), so roads wind
// through valleys and cross ranges at passes — the owner's "logical routes" before historical ones are drawn in.
import { makeRibbons, smoothLine } from './ribbon.js';
import { BBOX, KM_PER_DEG, distKm } from '../geo.js';

const CELL = 4; // km
function route(grid, W, H, a, b) {
  const N = W * H, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [], push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const bx = b % W, by = (b / W) | 0, hx = i => Math.hypot((i % W) - bx, ((i / W) | 0) - by);
  g[a] = 0; push(hx(a), a);
  while (heap.length) {
    const [, i] = pop(); if (closed[i]) continue; closed[i] = 1; if (i === b) break;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx, hj = grid[j]; if (closed[j] || hj <= 0) continue;
      const d = Math.hypot(dx, dy), s = Math.abs(hj - grid[i]) / (d * CELL * 1000), c = g[i] + d * (1 + 900 * s * s + hj * .00018);
      if (c < g[j]) { g[j] = c; from[j] = i; push(c + hx(j), j); }
    }
  }
  if (from[b] < 0) return null;
  const path = []; for (let i = b; i >= 0; i = from[i]) path.push(i);
  return path.reverse();
}

export default async function init(album) {
  const at = album.data.base.at, c0 = Math.cos(40 * Math.PI / 180);
  const W = Math.round((BBOX.lon1 - BBOX.lon0) * KM_PER_DEG * c0 / CELL), H = Math.round((BBOX.lat1 - BBOX.lat0) * KM_PER_DEG / CELL);
  const lonOf = x => BBOX.lon0 + (x + .5) / W * (BBOX.lon1 - BBOX.lon0), latOf = y => BBOX.lat1 - (y + .5) / H * (BBOX.lat1 - BBOX.lat0);
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y * W + x] = at(latOf(y), lonOf(x));
  const node = p => { // nearest land cell to a place
    const x0 = Math.max(0, Math.min(W - 1, Math.floor((p.lon - BBOX.lon0) / (BBOX.lon1 - BBOX.lon0) * W))), y0 = Math.max(0, Math.min(H - 1, Math.floor((BBOX.lat1 - p.lat) / (BBOX.lat1 - BBOX.lat0) * H)));
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = x0 + dx, y = y0 + dy; if (x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] > 0) return y * W + x; }
    return -1;
  };
  const places = album.data.vectors.places.filter(p => p.lat > 35.9 || p.lon > -5.2).slice(0, 60).map(p => ({ ...p, n: node(p) })).filter(p => p.n >= 0);
  const big = places.slice(0, 16), edges = new Map();
  const link = (a, b, kind) => { if (a === b) return; const k = a.n < b.n ? `${a.n}-${b.n}` : `${b.n}-${a.n}`; if (!edges.has(k) || kind < edges.get(k).kind) edges.set(k, { a, b, kind }); };
  for (const a of big) for (const b of [...big].sort((p, q) => distKm(a, p) - distKm(a, q)).slice(1, 4)) link(a, b, 0);
  for (const a of places.slice(16)) for (const b of [...places].sort((p, q) => distKm(a, p) - distKm(a, q)).slice(1, 3)) link(a, b, 1);
  const main = [], minor = [];
  for (const { a, b, kind } of edges.values()) {
    if (distKm(a, b) > 520) continue;
    const path = route(grid, W, H, a.n, b.n); if (!path || path.length < 2) continue;
    const pts = smoothLine(path.map(i => [lonOf(i % W), latOf((i / W) | 0)]), 1.5, 3);
    (kind ? minor : main).push({ pts, width: kind ? .05 : .09 });
  }
  const r1 = makeRibbons(album, main, { colour: 0xe8cf9a, minPx: 2.4, lift: .006 });
  const r2 = makeRibbons(album, minor, { colour: 0xd9c08c, minPx: 1.5, dash: 3.2, lift: .005 });
  album.roadNet = { main: main.length, minor: minor.length };
  const p = album.params;
  const sync = () => {
    const on = !!p.get('roadsOn') && p.get('roads') > 0, dark = p.get('look') === 'paper' || p.get('look') === 'atlas';
    r1.mesh.visible = r2.mesh.visible = on; r1.u.uK.value = r2.u.uK.value = p.get('roads');
    r1.u.uColour.value.set(dark ? 0x6b4a2a : 0xe8cf9a); r2.u.uColour.value.set(dark ? 0x7a5a38 : 0xd9c08c);
  };
  p.on(sync); sync();
  return { id: 'roads', update(dt, t, cam) { const dom = album.renderer.domElement; r1.setPx(cam, dom); r2.setPx(cam, dom); r2.u.uDash.value = Math.max(1.2, cam.s.h * .035); } };
}
