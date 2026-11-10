// Fresh-water proximity raster for the fertility map: rivers (irrigation, floodplains), lakes and — a little —
// sea coasts (fish, mild air). Uint8 0..255 on an equirectangular grid (row 0 = 90N, column 0 = 180W), ~20 km
// cells: the Nile, the Tigris and Euphrates, the Indus stay green ribbons across their deserts.
//
// rivers: Float32 segments [lon1, lat1, lon2, lat2] (degrees), ranks: Uint8 per segment (0 = largest, ~10 = brook)
// cells: the MAP cell raster (W x H): 0 ocean, 1 lake, 2.. land, >= SEA_BIT sea zones.
export const WATER_W = 2048, WATER_H = 1024;
export const LAKE_W = 0.7, COAST_W = 0.18;
const SEA_BIT = 0x40000000;

/** Weight of a river of Natural Earth rank r: the big rivers water whole valleys, brooks a little. */
export const riverWeight = r => Math.max(0.25, Math.min(1, 1 - 0.1 * (r - 2)));

export function buildWaterRaster({ rivers, ranks, cells, W, H, outW = WATER_W, outH = WATER_H }) {
  const n = outW * outH;
  let a = new Float32Array(n), b = new Float32Array(n);
  const sx = outW / 360, sy = outH / 180;
  // ---- rivers: each segment stamped as a thin line (one cell per row or column)
  if (rivers && ranks) {
    const segs = Math.min(ranks.length, (rivers.length / 4) | 0);
    for (let s = 0; s < segs; s++) {
      const w = riverWeight(ranks[s]);
      const x1 = (rivers[s * 4] + 180) * sx, y1 = (90 - rivers[s * 4 + 1]) * sy;
      const x2 = (rivers[s * 4 + 2] + 180) * sx, y2 = (90 - rivers[s * 4 + 3]) * sy;
      const dx = x2 - x1, dy = y2 - y1;
      if (Math.abs(dx) > outW / 2) continue;   // crosses the date line: too short to matter
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) + 1;   // one stamp per cell of the major axis
      for (let k = 0; k <= steps; k++) {
        const x = x1 + dx * k / steps, y = y1 + dy * k / steps;
        const ix = ((Math.floor(x) % outW) + outW) % outW, iy = Math.min(outH - 1, Math.max(0, Math.floor(y)));
        const i = iy * outW + ix;
        if (a[i] < w) a[i] = w;
      }
    }
  }
  // ---- lakes and coasts from the cell raster (a 2x2 sample of every output cell)
  if (cells && W && H) {
    const fx = W / outW, fy = H / outH;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        let lake = 0, land = 0, sea = 0;
        for (let j = 0; j < 2; j++) {
          const my = Math.min(H - 1, Math.floor((y + 0.25 + 0.5 * j) * fy)) * W;
          for (let i = 0; i < 2; i++) {
            const c = cells[my + Math.min(W - 1, Math.floor((x + 0.25 + 0.5 * i) * fx))];
            if (c === 1) lake++; else if (c >= 2 && c < SEA_BIT) land++; else sea++;
          }
        }
        const o = y * outW + x;
        let v = a[o];
        if (lake) v = Math.max(v, LAKE_W);
        else if (land && sea) v = Math.max(v, COAST_W);
        a[o] = v;
      }
    }
  }
  // ---- spread: a 5-tap and a 3-tap box blur in x and y; the gain brings the core of a one-cell line back to its
  // weight: a valley ~3 cells (60 km) wide, fading out over 2 more on each side
  for (const rad of [2, 1]) {
    const k = 1 / (2 * rad + 1);
    for (let y = 0; y < outH; y++) {   // x pass (wraps)
      const r = y * outW;
      let s = 0;
      for (let d = -rad; d <= rad; d++) s += a[r + ((d % outW) + outW) % outW];
      for (let x = 0; x < outW; x++) {
        b[r + x] = s * k;
        s += a[r + (x + rad + 1) % outW] - a[r + ((x - rad) % outW + outW) % outW];
      }
    }
    for (let x = 0; x < outW; x++) {   // y pass (clamps)
      let s = 0;
      for (let d = -rad; d <= rad; d++) s += b[Math.min(outH - 1, Math.max(0, d)) * outW + x];
      for (let y = 0; y < outH; y++) {
        a[y * outW + x] = s * k;
        s += b[Math.min(outH - 1, y + rad + 1) * outW + x] - b[Math.max(0, y - rad) * outW + x];
      }
    }
  }
  const out = new Uint8Array(n);
  const GAIN = 5;
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.min(1, a[i] * GAIN) * 255);
  return out;
}

/** Bilinear lookup (0..1) in a water raster at lat / lon (degrees), like the GPU's linear filter. */
export function waterAt(raster, lat, lon, outW = WATER_W, outH = WATER_H) {
  if (!raster) return 0;
  const fx = (lon + 180) / 360 * outW - 0.5, fy = (90 - lat) / 180 * outH - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const X = x => ((x % outW) + outW) % outW, Y = y => Math.min(outH - 1, Math.max(0, y));
  const v = (x, y) => raster[Y(y) * outW + X(x)];
  return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
}
