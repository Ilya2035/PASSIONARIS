// Distance transform (km) on the MAP grid: two-pass chamfer with per-row metric
// weights, repeated so the x-wrap seam propagates. src[i] != 0 marks sources.
export function distanceKm(grid, src, rounds = 2) {
  const { W, H, N, dxKm, dyKm } = grid;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = src[i] ? 0 : Infinity;
  const diag = new Float64Array(H);
  for (let y = 1; y < H; y++) { const dx = 0.5 * (dxKm[y] + dxKm[y - 1]); diag[y] = Math.sqrt(dx * dx + dyKm * dyKm); }
  for (let r = 0; r < rounds; r++) {
    // forward: from upper-left
    for (let y = 0; y < H; y++) {
      const row = y * W, dx = dxKm[y];
      for (let x = 0; x < W; x++) {
        const i = row + x;
        let v = d[i];
        const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
        let t = d[row + xl] + dx; if (t < v) v = t;
        if (y > 0) {
          const up = row - W;
          t = d[up + x] + dyKm; if (t < v) v = t;
          t = d[up + xl] + diag[y]; if (t < v) v = t;
          t = d[up + xr] + diag[y]; if (t < v) v = t;
        }
        d[i] = v;
      }
    }
    // backward: from lower-right
    for (let y = H - 1; y >= 0; y--) {
      const row = y * W, dx = dxKm[y];
      for (let x = W - 1; x >= 0; x--) {
        const i = row + x;
        let v = d[i];
        const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
        let t = d[row + xr] + dx; if (t < v) v = t;
        if (y < H - 1) {
          const dn = row + W;
          t = d[dn + x] + dyKm; if (t < v) v = t;
          t = d[dn + xl] + diag[y + 1]; if (t < v) v = t;
          t = d[dn + xr] + diag[y + 1]; if (t < v) v = t;
        }
        d[i] = v;
      }
    }
  }
  return d;
}

// Sea-zone size (side, km) as a function of distance from land (km):
// ~200 km along coasts, growing to ~800 km in the open ocean.
export function seaSideKm(dKm, { near = 200, far = 800, d0 = 80, d1 = 1100 } = {}) {
  if (dKm <= d0) return near;
  if (dKm >= d1) return far;
  const t = (dKm - d0) / (d1 - d0);
  return near + (far - near) * t;
}
