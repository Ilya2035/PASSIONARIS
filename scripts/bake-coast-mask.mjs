// Bakes an anti-aliased land/water coverage mask on the detail grid (32768x16384, ~1.2 km) from Natural Earth
// 1:10m vectors (countries = land, lakes subtracted). Gives crisp, smooth coasts when zoomed in.
//   node scripts/bake-coast-mask.mjs
// Output: public/assets/terrain/z7m/<tx>_<ty>.bin.gz — Uint8 coverage (255 = land) 256x256, for the same tiles as z7.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'assets', 'terrain', 'z7m');
const GW = 32768, GH = 16384, T = 256, TX = GW / T, TY = GH / T;
const SS = 4; // vertical sub-scanlines per pixel row
fs.mkdirSync(OUT, { recursive: true });

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'terrain', 'z7', 'index.json'), 'utf8'));
const kept = new Uint8Array(TX * TY);
for (const k of index.kept) kept[k] = 1;

// edges in pixel space: x = (lon+180)/360*GW, y = (90-lat)/180*GH
function edgesOf(file, filter) {
  const gj = JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8'));
  const E = [];
  for (const f of gj.features) {
    if (filter && !filter(f)) continue;
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = (ring[i][0] + 180) / 360 * GW, ay = (90 - ring[i][1]) / 180 * GH;
        const bx = (ring[i + 1][0] + 180) / 360 * GW, by = (90 - ring[i + 1][1]) / 180 * GH;
        if (ay === by) continue;
        const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
        E.push({ y0, y1, x0, k: (x1 - x0) / (y1 - y0) });
      }
    }
  }
  E.sort((p, q) => p.y0 - q.y0);
  return E;
}

// scanline coverage accumulator with an active edge table; returns a function that renders a band of pixel rows
function rasterizer(E) {
  let next = 0, active = [];
  const xs = [];
  return function band(row0, rows, acc /* Float32Array(rows*GW) */) {
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < SS; s++) {
        const yc = row0 + r + (s + 0.5) / SS;
        while (next < E.length && E[next].y0 <= yc) active.push(E[next++]);
        if (active.length > 64 && (r & 7) === 0) active = active.filter(e => e.y1 > yc);
        xs.length = 0;
        for (const e of active) if (e.y0 <= yc && e.y1 > yc) xs.push(e.x0 + (yc - e.y0) * e.k);
        xs.sort((p, q) => p - q);
        const base = r * GW;
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, xs[k]), xb = Math.min(GW, xs[k + 1]);
          if (xb <= xa) continue;
          const ia = Math.floor(xa), ib = Math.floor(xb);
          if (ia === ib) { acc[base + ia] += (xb - xa) / SS; continue; }
          acc[base + ia] += (ia + 1 - xa) / SS;
          for (let i = ia + 1; i < ib && i < GW; i++) acc[base + i] += 1 / SS;
          if (ib < GW) acc[base + ib] += (xb - ib) / SS;
        }
      }
    }
    active = active.filter(e => e.y1 > row0 + rows);
  };
}

const t0 = Date.now();
const land = rasterizer(edgesOf('ne_10m_admin_0_countries.geojson'));
const lakes = rasterizer(edgesOf('ne_10m_lakes.geojson'));
const accL = new Float32Array(T * GW), accW = new Float32Array(T * GW);
const tile = new Uint8Array(T * T);
let written = 0;
for (let ty = 0; ty < TY; ty++) {
  accL.fill(0); accW.fill(0);
  land(ty * T, T, accL);
  lakes(ty * T, T, accW);
  for (let tx = 0; tx < TX; tx++) {
    if (!kept[ty * TX + tx]) continue;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = y * GW + tx * T + x;
      const v = Math.max(0, Math.min(1, accL[i]) - Math.min(1, accW[i]));
      tile[y * T + x] = Math.round(v * 255);
    }
    fs.writeFileSync(path.join(OUT, `${tx}_${ty}.bin.gz`), zlib.gzipSync(Buffer.from(tile), { level: 6 }));
    written++;
  }
  if (ty % 8 === 7) console.log(`row ${ty + 1}/${TY}  ${written} tiles  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`done: ${written} mask tiles in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
