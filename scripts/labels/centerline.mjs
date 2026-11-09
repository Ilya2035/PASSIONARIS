// Zone label placement: polygon -> smooth curve along the zone's main axis.
//
// 1. Project the zone in a local azimuthal equidistant projection centred on the
//    zone (so zones across the antimeridian or around a pole are no special case).
// 2. Rasterise the outer rings (holes ignored), close small gaps between parts,
//    keep the biggest connected piece and fill enclosed holes/inclusions.
// 3. Distance transform -> "core" = pixels at least CORE_ALPHA of the maximal
//    half-width away from the border (drops thin tails, spikes and capes).
// 4. Elongated or bent cores: the geodesic diameter of the core (double sweep),
//    then the cheapest path between its ends with a cost that prefers the middle
//    of the shape (a medial line). Compact cores: a near-horizontal line through
//    the centre, tilted toward the principal axis as the shape gets longer.
// 5. Smooth, crop to the text length, limit the bending, verify the curve stays
//    inside the shape, resample to 3..9 points.
// Degenerate "sliver" polygons (some Natural Earth straits) use sliverAxis() instead.
import {
  makeAeqd, toVec, toLonLat, norm, dot, eastNorth, ringAreaKm2, densifyRing, fillRing, edtSq, closeMask,
  components, pick, fillHoles, dijkstra, argmax, polyLength, resample, smooth, turning, bendRange, gcKm,
} from './geom.mjs';

export const CORE_ALPHA = 0.2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ shape raster
export function rasterZone(parts, { N = 360, densify = 0.25 } = {}) {
  const areas = parts.map(p => ringAreaKm2(p[0]));
  const maxA = Math.max(...areas);
  const selIdx = areas.map((a, i) => i).filter(i => areas[i] >= 0.02 * maxA);
  const rings = selIdx.map(i => densifyRing(parts[i][0], densify));
  const areaKm2 = selIdx.reduce((s, i) => s + areas[i], 0);

  // initial centre: area-weighted mean of the parts' boundary centroids
  let c = [0, 0, 0];
  rings.forEach((r, k) => {
    const s = [0, 0, 0];
    for (const [lon, lat] of r) { const v = toVec(lon, lat); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
    const l = Math.hypot(...s) || 1, w = areas[selIdx[k]];
    c[0] += s[0] / l * w; c[1] += s[1] / l * w; c[2] += s[2] / l * w;
  });
  c = Math.hypot(...c) > 1e-9 ? norm(c) : toVec(rings[0][0][0], rings[0][0][1]);

  const closeR = Math.max(2, Math.round(N * 0.012));
  let grid = null;
  for (let pass = 0; pass < 2; pass++) {
    const proj = makeAeqd(c);
    const flats = rings.map(r => {
      const f = new Float64Array(r.length * 2);
      r.forEach(([lon, lat], i) => { const p = proj.fwd(toVec(lon, lat)); f[2 * i] = p[0]; f[2 * i + 1] = p[1]; });
      return f;
    });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of flats) for (let i = 0; i < f.length; i += 2) {
      if (f[i] < x0) x0 = f[i]; if (f[i] > x1) x1 = f[i];
      if (f[i + 1] < y0) y0 = f[i + 1]; if (f[i + 1] > y1) y1 = f[i + 1];
    }
    const px = Math.max(x1 - x0, y1 - y0, 1e-3) / N;
    const pad = closeR + 4;
    const W = Math.ceil((x1 - x0) / px) + 2 * pad, H = Math.ceil((y1 - y0) / px) + 2 * pad;
    const gx0 = x0 - pad * px, gy0 = y0 - pad * px;
    const mask = new Uint8Array(W * H);
    for (const f of flats) fillRing(mask, W, H, gx0, gy0, px, f);
    grid = { proj, W, H, gx0, gy0, px, raw: mask };
    if (pass === 1) break;
    // re-centre on the raster centroid (keeps projection distortion symmetric)
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (mask[j * W + i]) { sx += i; sy += j; n++; }
    if (!n) break;
    const cx = gx0 + (sx / n + 0.5) * px, cy = gy0 + (sy / n + 0.5) * px;
    if (Math.hypot(cx, cy) < 0.02 * N * px) break;
    c = proj.inv(cx, cy);
  }
  const { W, H } = grid;
  const closed = closeMask(grid.raw, W, H, closeR);
  const comp = components(closed, W, H, 1, true);
  let best = 0;
  comp.sizes.forEach((s, i) => { if (s > comp.sizes[best]) best = i; });
  const shape = comp.sizes.length ? pick(comp.label, best) : closed;
  grid.mask = fillHoles(shape, W, H, 0.3);
  grid.areaKm2 = areaKm2;
  return grid;
}

// pixel index <-> plane km
const pxToKm = (g, i) => [g.gx0 + ((i % g.W) + 0.5) * g.px, g.gy0 + (((i / g.W) | 0) + 0.5) * g.px];
function sampleIdx(g, p) {
  const i = Math.floor((p[0] - g.gx0) / g.px), j = Math.floor((p[1] - g.gy0) / g.px);
  if (i < 0 || j < 0 || i >= g.W || j >= g.H) return -1;
  return j * g.W + i;
}

// ------------------------------------------------------------------ medial line / main axis
export function mainAxis(g, alpha = CORE_ALPHA) {
  const { W, H, mask } = g;
  const D = edtSq(mask, W, H, 1);
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? Math.sqrt(D[i]) : 0;
  const am = argmax(D);
  const maxD = D[am];
  const core0 = new Uint8Array(W * H);
  for (let i = 0; i < D.length; i++) core0[i] = D[i] >= alpha * maxD ? 1 : 0;
  const cc = components(core0, W, H, 1, true);
  const core = pick(cc.label, cc.label[am]);

  // principal axes of the core
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < core.length; i++) if (core[i]) { const p = pxToKm(g, i); mx += p[0]; my += p[1]; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < core.length; i++) if (core[i]) {
    const p = pxToKm(g, i), dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const tr = (sxx + syy) / 2, det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr + det, l2 = Math.max(1e-9, tr - det);
  const aspect = Math.sqrt(l1 / l2);
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);     // major axis angle (plane, from +x)

  // geodesic diameter of the core (double sweep)
  const s1 = dijkstra(core, W, H, am);
  const A = argmax(s1.dist, core);
  const s2 = dijkstra(core, W, H, A);
  const B = argmax(s2.dist, core);
  const geoLen = s2.dist[B];

  const ci = sampleIdx(g, [mx, my]);
  const centroidInCore = ci >= 0 && core[ci] === 1 && D[ci] >= 0.5 * maxD;
  // convex-ish blobs get a straight line along their principal axis; long, thin or bent shapes a medial curve
  const elongated = aspect >= 2.6 || geoLen >= 5.5 * maxD || !centroidInCore;

  let pts;
  if (elongated) {
    const cost = new Float32Array(W * H);
    for (let i = 0; i < cost.length; i++) if (core[i]) cost[i] = (maxD / Math.max(D[i], 0.5)) ** 2;
    const { prev } = dijkstra(core, W, H, A, cost);
    const raw = [];
    for (let p = B; p >= 0; p = prev[p]) { raw.push(pxToKm(g, p)); if (p === A) break; }
    raw.reverse();
    pts = raw.length >= 2 ? smooth(resample(raw, 64), 2.5) : null;
  }
  if (!pts) {
    // compact: through the centre, along local east blended toward the major axis
    const anchor = centroidInCore ? [mx, my] : pxToKm(g, am);
    const v = g.proj.inv(anchor[0], anchor[1]);
    const lat = Math.asin(v[1]) / DEG;
    let ang;
    if (Math.abs(lat) > 84) ang = theta;
    else {
      const { e } = eastNorth(v);
      const q = g.proj.fwd(norm([v[0] + e[0] * 1e-4, v[1] + e[1] * 1e-4, v[2] + e[2] * 1e-4]));
      const p0 = g.proj.fwd(v);
      const east = Math.atan2(q[1] - p0[1], q[0] - p0[0]);
      let dth = theta - east;
      while (dth > Math.PI / 2) dth -= Math.PI;
      while (dth < -Math.PI / 2) dth += Math.PI;
      const w = Math.min(1, Math.max(0, (aspect - 1.1) / 0.5));
      ang = east + dth * w * w * (3 - 2 * w);
    }
    const dx = Math.cos(ang), dy = Math.sin(ang), step = g.px * 0.5;
    const march = sgn => {
      let t = 0;
      for (;;) {
        const k = sampleIdx(g, [anchor[0] + sgn * (t + step) * dx, anchor[1] + sgn * (t + step) * dy]);
        if (k < 0 || !core[k]) break;
        t += step;
      }
      return [anchor[0] + sgn * t * dx, anchor[1] + sgn * t * dy];
    };
    const a = march(-1), b = march(1);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < g.px) { a[0] -= maxD * g.px * dx; a[1] -= maxD * g.px * dy; b[0] += maxD * g.px * dx; b[1] += maxD * g.px * dy; }
    pts = resample([a, b], 64);
  }
  return { pts, D, maxD, core, aspect, elongated, theta };
}

// ------------------------------------------------------------------ fitting the text
function quantile(arr, q) {
  const a = Float64Array.from(arr).sort();
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}

function insideAll(g, D, pts, minPx) {
  // check densely between consecutive points
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / (g.px * 0.5)));
    for (let j = 0; j <= k; j++) {
      const p = [a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k];
      const idx = sampleIdx(g, p);
      if (idx < 0 || !g.mask[idx] || D[idx] < minPx) return false;
    }
  }
  return true;
}

// nChars: characters of the displayed name. Returns plane-space curve + text metrics.
// Text length per character, in em: ~1.4 (wide EU4 tracking) for short names, tighter for long ones
// so that long Russian names still get readable letters.
export function spacingFor(nChars) {
  const t = Math.min(1, Math.max(0, (nChars - 8) / 12));
  return 1.4 - 0.35 * t * t * (3 - 2 * t);
}

export function fitText(g, ax, nChars, { maxTurnDeg = 100, spacing = spacingFor(nChars), maxSpread = 2.4, widthK = 1.7 } = {}) {
  const { D } = ax;
  const n = Math.max(1, nChars);
  const L = polyLength(ax.pts);
  const dKm = p => { const k = sampleIdx(g, p); return k < 0 ? 0 : D[k] * g.px; };
  const avail = 0.92 * L;
  const windowAt = (c, len, M = 40) => resample(ax.pts, M, c - len / 2, c + len / 2);
  const widthOf = seg => quantile(seg.slice(Math.floor(seg.length * 0.1), Math.ceil(seg.length * 0.9)).map(dKm), 0.25);
  // window centre: the widest stretch of the zone, mildly preferring the middle
  const bestCenter = len => {
    if (len >= avail * 0.999) return L / 2;
    let best = L / 2, bs = -Infinity;
    for (let k = 0; k <= 20; k++) {
      const c = len / 2 + (L - len) * k / 20;
      const sc = widthOf(windowAt(c, len, 24)) * (1 - 0.3 * Math.abs(c - L / 2) / (L / 2));
      if (sc > bs + 1e-9) { bs = sc; best = c; }
    }
    return best;
  };
  let textLen = avail, center = L / 2, h = avail / (n * spacing), wq = 0;
  for (let it = 0; it < 6; it++) {
    wq = widthOf(windowAt(center, textLen));
    h = Math.min(textLen / (n * spacing), widthK * wq);
    const newLen = Math.min(avail, n * h * maxSpread);
    if (newLen >= textLen * 0.995) break;
    textLen = newLen;
    center = bestCenter(textLen);
  }
  const cropAt = (len, sigma) => smooth(resample(ax.pts, 48, center - len / 2, center + len / 2), sigma);
  let seg = cropAt(textLen, 5);
  for (let k = 0; k < 10 && bendRange(seg) > maxTurnDeg * DEG && textLen > 0.2 * avail; k++) {
    textLen *= 0.85;
    center = bestCenter(textLen);
    seg = cropAt(textLen, 5);
  }
  // keep the curve inside: try decreasing smoothing, then the bare medial line
  let ok = false;
  for (const sigma of [5, 2.5, 0]) {
    seg = cropAt(textLen, sigma);
    if (insideAll(g, D, seg, 0.5)) { ok = true; break; }
  }
  wq = widthOf(resample(seg, 40));
  h = Math.min(h, textLen / (n * spacing), widthK * wq);
  const turn = turning(seg);
  const K = Math.max(3, Math.min(9, 3 + Math.round(turn / (12 * DEG))));
  let pts = resample(seg, K);
  if (!insideAll(g, D, pts, 0.01)) {
    // last resort: snap each point to the nearest point of the medial line
    pts = pts.map(p => {
      const k = sampleIdx(g, p);
      if (k >= 0 && g.mask[k]) return p;
      let best = null, bd = Infinity;
      for (const q of ax.pts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
      return best.slice();
    });
  }
  return { pts, letterHeightKm: h, widthKm: 2 * wq, textLenPlane: textLen, turnDeg: turn / DEG, inside: ok };
}

// ------------------------------------------------------------------ to the sphere
// Plane points -> lon/lat, oriented to read left-to-right with north up
// (near-vertical labels read bottom-to-top).
export function toGeoPath(g, pts) {
  return orientPath(pts.map(p => g.proj.inv(p[0], p[1])));
}

export function orientPath(vs) {
  const mid = vs[vs.length >> 1];
  const chord = [vs[vs.length - 1][0] - vs[0][0], vs[vs.length - 1][1] - vs[0][1], vs[vs.length - 1][2] - vs[0][2]];
  const { e, n } = eastNorth(mid);
  const ce = dot(chord, e), cn = dot(chord, n), cl = Math.hypot(ce, cn);
  const reverse = cl > 0 && (Math.abs(ce) >= 0.17 * cl ? ce < 0 : cn < 0);
  if (reverse) vs = vs.reverse();
  let len = 0;
  for (let i = 1; i < vs.length; i++) len += gcKm(vs[i - 1], vs[i]);
  return { path: vs.map(v => toLonLat(v)), lengthKm: len, vecs: vs };
}

// ------------------------------------------------------------------ degenerate polygons
// Natural Earth draws a few straits and bays as slivers (area ~0) that only trace
// where the label goes. Detect them (area tiny vs. extent) and use the principal
// line through their vertices instead of a medial axis.
export function sliverAxis(parts, ratio = 0.01) {
  const pts = parts.flatMap(p => p[0]).map(([lon, lat]) => toVec(lon, lat));
  if (pts.length < 3) return null;
  const area = parts.reduce((s, p) => s + ringAreaKm2(p[0]), 0);
  const far = from => { let b = from, bd = -1; for (const v of pts) { const d = gcKm(from, v); if (d > bd) { bd = d; b = v; } } return [b, bd]; };
  const [a] = far(pts[0]);
  const [, diam] = far(a);
  if (!(diam > 0) || area / (diam * diam) >= ratio) return null;
  const c = norm(pts.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]));
  const proj = makeAeqd(c);
  const xy = pts.map(v => proj.fwd(v));
  let mx = 0, my = 0;
  for (const p of xy) { mx += p[0]; my += p[1]; }
  mx /= xy.length; my /= xy.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of xy) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  let lo = Infinity, hi = -Infinity, spread = 0;
  for (const p of xy) {
    const t = (p[0] - mx) * ux + (p[1] - my) * uy;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    spread = Math.max(spread, Math.abs(-(p[0] - mx) * uy + (p[1] - my) * ux));
  }
  const vs = [lo, (lo + hi) / 2, hi].map(t => proj.inv(mx + ux * t, my + uy * t));
  return { vecs: vs, widthKm: Math.max(2, 2 * spread), areaKm2: area };
}
