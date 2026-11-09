// Terrain analysis: local relief (max - min in a ~25 km window) and the
// mountain-massif mask (threshold + morphology + size filter + hole filling).
import { components } from './grid.mjs';

// Separable sliding max/min over a rectangle radius rx(y) x ry (texels), x wraps.
// src: typed array (Int16/Uint8...). Returns { max, min } of the same type (either may be skipped).
export function slidingMaxMin(grid, src, rKm, { wantMax = true, wantMin = true, maxRx = 96 } = {}) {
  const { W, H, dxKm, dyKm } = grid;
  const Ctor = src.constructor;
  const ry = Math.max(0, Math.round(rKm / dyKm));
  const hMax = wantMax ? new Ctor(W * H) : null, hMin = wantMin ? new Ctor(W * H) : null;
  for (let y = 0; y < H; y++) {
    const rx = Math.min(maxRx, Math.max(0, Math.round(rKm / dxKm[y])));
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let mx = -Infinity, mn = Infinity;
      for (let k = -rx; k <= rx; k++) {
        let xx = x + k; if (xx < 0) xx += W; else if (xx >= W) xx -= W;
        const v = src[row + xx];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      if (hMax) hMax[row + x] = mx;
      if (hMin) hMin[row + x] = mn;
    }
  }
  const outMax = wantMax ? new Ctor(W * H) : null, outMin = wantMin ? new Ctor(W * H) : null;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - ry), y1 = Math.min(H - 1, y + ry);
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let mx = -Infinity, mn = Infinity;
      for (let yy = y0; yy <= y1; yy++) {
        const j = yy * W + x;
        if (hMax && hMax[j] > mx) mx = hMax[j];
        if (hMin && hMin[j] < mn) mn = hMin[j];
      }
      if (outMax) outMax[row + x] = mx;
      if (outMin) outMin[row + x] = mn;
    }
  }
  return { max: outMax, min: outMin };
}

// Greenland outline (lon, lat): runs along the middle of Davis Strait, Baffin Bay,
// Nares Strait and Denmark Strait, so Baffin Island, Ellesmere Island, northern
// Quebec / Labrador and Iceland stay outside (a plain lon/lat box caught them all).
const GREENLAND = [
  [-44, 58.5], [-52, 60], [-57.5, 65], [-58.5, 68], [-62, 72], [-68, 75], [-74.4, 76.4], [-75, 77.2],
  // Nares Strait midline, measured on the MAP land mask (Ellesmere west, Greenland east)
  [-74.1, 78], [-74.1, 78.4], [-72, 78.8], [-70.1, 79.2], [-69, 79.6], [-67.9, 80], [-68.2, 80.4],
  [-66.6, 80.8], [-64.7, 81.2], [-64.4, 81.6], [-61, 82], [-56.1, 82.4], [-55, 83.5],
  [-30, 84.5], [-8, 82], [-9, 78], [-16, 74], [-20, 70.5], [-28.5, 67], [-31, 65], [-38, 61],
];
function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Is the point in the Greenland / Antarctic ice-sheet zone (flat high ice, not mountains)?
export function iceZone(lon, lat) {
  if (lat < -60) return true;
  if (lat < 58.5 || lon < -75 || lon > -8) return false;
  return inPolygon(GREENLAND, lon, lat);
}

// Mountain mask. land: Uint8 (1 = land incl. lakes), height: Int16 metres.
// Returns { mountain: Uint8Array, relief: Int16Array, stats }.
export function mountainMask(grid, land, height, opts = {}) {
  const {
    windowKm = 12, reliefMin = 650, highMin = 1900, highRelief = 300, plateauMin = 3000, iceRelief = 1000,
    closeKm = 7, openKm = 9, minKm2 = 6000, holeKm2 = 2500,
  } = opts;
  const { W, H, N, rowLat, colLon } = grid;
  const hl = new Int16Array(N);
  for (let i = 0; i < N; i++) hl[i] = land[i] ? Math.max(0, height[i]) : 0;
  const { max, min } = slidingMaxMin(grid, hl, windowKm);
  const relief = new Int16Array(N);
  for (let i = 0; i < N; i++) relief[i] = max[i] - min[i];
  // smoothed elevation (mean over a similar window, via box of maxima is too crude: use 3x3 mean)
  let m = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const lat = rowLat[y];
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land[i]) continue;
      const h = hl[i], r = relief[i];
      if (iceZone(colLon[x], lat)) { if (r >= iceRelief) m[i] = 1; continue; }
      if (r >= reliefMin || (h >= highMin && r >= highRelief) || h >= plateauMin) m[i] = 1;
    }
  }
  // closing (fills gaps) then opening (removes thin spurs); restricted to land
  const close1 = slidingMaxMin(grid, m, closeKm, { wantMin: false }).max;
  const close2 = slidingMaxMin(grid, close1, closeKm, { wantMax: false }).min;
  const open1 = slidingMaxMin(grid, close2, openKm, { wantMax: false }).min;
  const open2 = slidingMaxMin(grid, open1, openKm, { wantMin: false }).max;
  m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = land[i] && open2[i] ? 1 : 0;
  // keep significant massifs only
  const cls = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (land[i]) cls[i] = m[i];
  let cc = components(grid, cls);
  let kept = 0, removed = 0;
  const keepM = new Uint8Array(cc.count);
  for (let c = 0; c < cc.count; c++) {
    const f = cc.first[c];
    if (cls[f] === 1) { if (cc.area[c] >= minKm2) { keepM[c] = 1; kept++; } else removed++; }
  }
  for (let i = 0; i < N; i++) if (m[i] && !keepM[cc.comp[i]]) { m[i] = 0; cls[i] = 0; }
  // fill small lowland holes fully enclosed by mountains (no contact with water)
  cc = components(grid, cls);
  const touchesOther = new Uint8Array(cc.count); // 1 = touches water or grid edge
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cls[i] !== 0) continue;
    const c = cc.comp[i];
    if (touchesOther[c]) continue;
    if (y === 0 || y === H - 1) { touchesOther[c] = 1; continue; }
    const nb = [i - W, i + W, y * W + (x + 1) % W, y * W + (x + W - 1) % W];
    for (const j of nb) if (!land[j]) { touchesOther[c] = 1; break; }
  }
  let filled = 0;
  for (let i = 0; i < N; i++) {
    if (cls[i] !== 0) continue;
    const c = cc.comp[i];
    if (!touchesOther[c] && cc.area[c] < holeKm2) { m[i] = 1; filled++; }
  }
  let mArea = 0, lArea = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!land[i]) continue;
    lArea += grid.areaKm2[y];
    if (m[i]) mArea += grid.areaKm2[y];
  }
  return { mountain: m, relief, stats: { massifsKept: kept, massifsRemoved: removed, holeTexelsFilled: filled, mountainShare: +(mArea / lArea).toFixed(3) } };
}
