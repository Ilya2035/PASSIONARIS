// Vector -> raster helpers on the MAP grid (equirectangular W x H).

export function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
export function linesOf(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

// Even-odd scanline fill of one polygon (outer ring + holes): texels whose centres
// are inside. Calls put(rowStart, x0, x1) per span. Returns the number of texels.
export function fillPolygon(grid, rings, put) {
  const { W, H, lonToX, latToY } = grid;
  const edges = [];
  let ymin = Infinity, ymax = -Infinity;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      const ax = lonToX(ring[i][0]), ay = latToY(ring[i][1]);
      const bx = lonToX(ring[i + 1][0]), by = latToY(ring[i + 1][1]);
      if (ay === by) continue;
      const e = ay < by ? { y0: ay, y1: by, x0: ax, k: (bx - ax) / (by - ay) } : { y0: by, y1: ay, x0: bx, k: (ax - bx) / (ay - by) };
      edges.push(e);
      if (e.y0 < ymin) ymin = e.y0;
      if (e.y1 > ymax) ymax = e.y1;
    }
  }
  if (!edges.length) return 0;
  edges.sort((a, b) => a.y0 - b.y0);
  let count = 0, next = 0, active = [];
  const r0 = Math.max(0, Math.floor(ymin - 0.5)), r1 = Math.min(H - 1, Math.ceil(ymax));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const yc = r + 0.5;
    while (next < edges.length && edges[next].y0 <= yc) active.push(edges[next++]);
    active = active.filter(e => e.y1 > yc);
    xs.length = 0;
    for (const e of active) if (e.y0 <= yc) xs.push(e.x0 + (yc - e.y0) * e.k);
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      if (xb >= xa) { put(r * W, xa, xb); count += xb - xa + 1; }
    }
  }
  return count;
}

// Rasterise a polyline [[lon,lat],...] into texels, 8-connected and gap-free
// (every texel the segment passes through is visited). put(texel) may be called
// more than once for the same texel. Segments crossing the antimeridian are split.
export function rasterLine(grid, coords, put) {
  const { W, H, lonToX, latToY } = grid;
  for (let i = 0; i + 1 < coords.length; i++) {
    let [lo0, la0] = coords[i], [lo1, la1] = coords[i + 1];
    if (Math.abs(lo1 - lo0) > 180) continue; // antimeridian: skip (rare, tiny)
    const ax = lonToX(lo0), ay = latToY(la0), bx = lonToX(lo1), by = latToY(la1);
    // supercover traversal (Amanatides-Woo)
    let x = Math.floor(ax), y = Math.floor(ay);
    const ex = Math.floor(bx), ey = Math.floor(by);
    const dx = bx - ax, dy = by - ay;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? (x + 1 - ax) : (ax - x)) * tdx : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? (y + 1 - ay) : (ay - y)) * tdy : Infinity;
    let guard = Math.abs(ex - x) + Math.abs(ey - y) + 2;
    for (;;) {
      if (y >= 0 && y < H) put(y * W + ((x % W) + W) % W);
      if ((x === ex && y === ey) || guard-- <= 0) break;
      if (tmx < tmy) { tmx += tdx; x += sx; } else { tmy += tdy; y += sy; }
    }
  }
}
