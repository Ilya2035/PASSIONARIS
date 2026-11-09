// SIM grid geometry (docs/ENGINE.md): 720x360, 0.5 deg, row 0 = 90N, column 0 = 180W,
// cell = y*720 + x, centre lon = -180 + (x+0.5)*0.5, lat = 90 - (y+0.5)*0.5.
//
// Two coarser grids are derived from it:
//  - coarse synoptic grid 144x72 (2.5 deg, 5x5 SIM cells per node) for the weather fields;
//  - climate-log boxes 72x36 (5 deg, 10x10 SIM cells per box).

export const W = 720, H = 360, N = W * H;
export const CS = 5, CX = W / CS, CY = H / CS, CN = CX * CY;
export const BS = 10, BX = W / BS, BY = H / BS, BN = BX * BY;

export const OCEAN = 0, LAKE = 1, LAND = 2;

export const cellLat = y => 90 - (y + 0.5) * 0.5;
export const cellLon = x => -180 + (x + 0.5) * 0.5;
export const nodeLat = j => 90 - (j + 0.5) * (180 / CY);
export const nodeLon = i => -180 + (i + 0.5) * (360 / CX);
export const boxLat = by => 90 - (by + 0.5) * 5;
export const boxLon = bx => -180 + (bx + 0.5) * 5;

/** SIM cell index of a geographic point. */
export function cellOf(lat, lon) {
  let x = Math.floor((lon + 180) * 2);
  x = ((x % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) * 2)));
  return y * W + x;
}
/** 5x5 deg climate-log box of a SIM cell. */
export const boxOfCell = c => ((c / W / BS) | 0) * BX + (((c % W) / BS) | 0);

/**
 * Bilinear interpolation weights from a node grid (nodes every `stride` cells, node centres at
 * block centres) to SIM cells. x is periodic, y is clamped.
 */
export function interpTables(stride) {
  const nx = W / stride, ny = H / stride;
  const ix0 = new Int32Array(W), ix1 = new Int32Array(W), fx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const g = (x + 0.5) / stride - 0.5;
    const i0 = Math.floor(g);
    fx[x] = g - i0;
    ix0[x] = ((i0 % nx) + nx) % nx;
    ix1[x] = (((i0 + 1) % nx) + nx) % nx;
  }
  const iy0 = new Int32Array(H), iy1 = new Int32Array(H), fy = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const g = (y + 0.5) / stride - 0.5;
    let j0 = Math.floor(g), f = g - j0, j1 = j0 + 1;
    if (j0 < 0) { j0 = 0; j1 = 0; f = 0; }
    if (j1 > ny - 1) { j1 = ny - 1; if (j0 > ny - 1) j0 = ny - 1; }
    iy0[y] = j0; iy1[y] = j1; fy[y] = f;
  }
  return { nx, ny, ix0, ix1, fx, iy0, iy1, fy };
}

/** Interpolate a node field (nx*ny) to a full SIM field (N) using interpTables(). */
export function nodesToCells(src, tab, out) {
  const { nx, ix0, ix1, fx, iy0, iy1, fy } = tab;
  for (let y = 0; y < H; y++) {
    const r0 = iy0[y] * nx, r1 = iy1[y] * nx, wy = fy[y], o = y * W;
    for (let x = 0; x < W; x++) {
      const a = src[r0 + ix0[x]] + (src[r0 + ix1[x]] - src[r0 + ix0[x]]) * fx[x];
      const b = src[r1 + ix0[x]] + (src[r1 + ix1[x]] - src[r1 + ix0[x]]) * fx[x];
      out[o + x] = a + (b - a) * wy;
    }
  }
  return out;
}

/**
 * Land/lake/ocean mask on the SIM grid from the MAP raster (cells.bin.gz: Uint32, 0 ocean,
 * 1 lake, >= 2 land district). Each SIM cell takes s x s point samples; majority wins
 * (land if >= half the samples are land).
 */
export function maskFromCells(cells, mapW = 8192, mapH = 4096, s = 4) {
  const mask = new Uint8Array(N);
  const half = (s * s) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let land = 0, lake = 0;
      for (let j = 0; j < s; j++) {
        const py = Math.min(mapH - 1, Math.floor(((y + (j + 0.5) / s) / H) * mapH));
        const row = py * mapW;
        for (let i = 0; i < s; i++) {
          const px = Math.min(mapW - 1, Math.floor(((x + (i + 0.5) / s) / W) * mapW));
          const v = cells[row + px];
          if (v >= 2) land++; else if (v === 1) lake++;
        }
      }
      const ocean = s * s - land - lake;
      mask[y * W + x] = land >= half ? LAND : lake > ocean ? LAKE : OCEAN;
    }
  }
  return mask;
}

/**
 * Split a decompressed normals.bin (docs/ENGINE.md: Int16 tavg[12][360][720] (degC*10),
 * Uint16 prec[12][360][720] (mm/month), Int16 elev[360][720] (m), little-endian, in this order).
 * `header` (normals.json) may override byte offsets with {offsets:{tavg,prec,elev}}.
 */
export function parseNormals(buffer, header = null) {
  const buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const off = header?.offsets ?? {};
  const oT = off.tavg ?? 0, oP = off.prec ?? oT + 12 * N * 2, oE = off.elev ?? oP + 12 * N * 2;
  if (buf.byteLength < oE + N * 2) throw new Error(`weather: normals buffer too small (${buf.byteLength} bytes)`);
  const copy = (C, o, n) => (o % C.BYTES_PER_ELEMENT === 0 ? new C(buf, o, n) : new C(buf.slice(o, o + n * C.BYTES_PER_ELEMENT)));
  return { tavg: copy(Int16Array, oT, 12 * N), prec: copy(Uint16Array, oP, 12 * N), elev: copy(Int16Array, oE, N) };
}
