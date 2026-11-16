// The plain land and sea of the whole Earth beyond the polygon (docs/album/ground.md, «Вся Земля»).
//
// The map is the whole ball of the Earth (the owner, 15.11.2026: «Я должен видеть всю землю»). The polygon — BBOX of
// geo.js — is the part worked out in detail: heights every 230 m and finer, chunks, districts, roads, settlements.
// Everything beyond it is drawn by the same ground shader and the same rules from two maps of the world:
//   heights   public/assets/map/height.delta.bin.gz — the map of the old globe game: Int16 metres (the sea floor is
//             negative), WMAP_W × WMAP_H points on a plain grid of latitude and longitude, row 0 at 90° N, column 0
//             at 180° W, a point every 0.044° (4.9 km at the equator); every row is written as differences
//   climate   public/assets/album/ground/world.bin.gz (ground/climate.js, scripts/album/bake-world-climate.mjs)
// There are no chunks there: the land is in its natural state, as the rules of the ground and of the forest give it.
// This file is the part that needs no browser: where the polygon ends, and the heights of the world on the CPU.
import { BBOX, STAGE } from '../geo.js';

export const WMAP_W = 8192, WMAP_H = 4096;
// a point of the world map at the equator, km, and how many levels coarser that is than the heights of the polygon
// (230 m): heightLod() of the shaders counts its levels of detail from those
export const WMAP_KM = 40030 / WMAP_W, WORLD_LOD0 = Math.log2(WMAP_KM / .234);
// The heights (and the climate) of the polygon give way to those of the world over this many degrees beyond its
// border; inside the border they are the polygon's own, whole.
export const REGION_FADE = .2;
// the state of the chunks gives way to the natural state over the last kilometres inside the border, between these
// two depths, degrees (past the border the chunks are sea; a pattern reads them up to 3 km aside). Some 35 km: the
// land of the polygon is ploughed and felled, the land beyond it is as nature made it, and over 15 km the change
// read as a line along the border (the lead, 15.11.2026).
export const STATE_FADE = [.04, .35];

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// how deep inside the polygon a place lies, degrees; negative outside it (regionEdge() in glsl.js is its twin)
export const regionEdge = (lat, lon) => Math.min(lat - BBOX.lat0, BBOX.lat1 - lat, lon - BBOX.lon0, BBOX.lon1 - lon);
// 1 inside the polygon, fading to 0 over REGION_FADE beyond it (inRegion() in glsl.js)
export const regionWeight = (lat, lon) => ss(-REGION_FADE, 0, regionEdge(lat, lon));

// the height file as it lies → metres, in place
export function decodeWorldHeights(h, w = WMAP_W) {
  for (let k = 0; k < h.length; k++) if (k % w) h[k] += h[k - 1];
  return h;
}
// The world map holds the rock under the ice of Greenland and of the Antarctic, and much of that rock lies under the
// sea: drawn as it is, Greenland was a ring of mountains round a bay. The surface of the ice sheets comes with the
// climate of the world (ground/climate.js: a plane of world.bin.gz, bytes of step m on a grid of iw × ih cells):
// the heights are lifted to it, joined smoothly between the cells.
export function raiseIce(h, ice, iw, ih, step, w = WMAP_W) {
  const rows = h.length / w;
  let j0 = ih, j1 = -1;
  for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) if (ice[j * iw + i]) { j0 = Math.min(j0, j); j1 = Math.max(j1, j); break; }
  for (let j = ih - 1; j > j1; j--) for (let i = 0; i < iw; i++) if (ice[j * iw + i]) { j1 = j; break; }
  if (j1 < 0) return h;
  const used = new Uint8Array(ih); for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) if (ice[j * iw + i]) { used[j] = 1; break; }
  for (let y = 0; y < rows; y++) {
    const v = (y + .5) / rows * ih - .5, j = Math.max(0, Math.min(ih - 2, Math.floor(v))), fy = Math.max(0, Math.min(1, v - j));
    if (!used[j] && !used[j + 1]) continue;
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const u = (x + .5) / w * iw - .5, i = Math.floor(u), fx = u - i, i0 = ((i % iw) + iw) % iw, i1 = (i0 + 1) % iw;
      const a = ice[j * iw + i0], b = ice[j * iw + i1], c = ice[(j + 1) * iw + i0], d = ice[(j + 1) * iw + i1];
      if (!(a || b || c || d)) continue;
      const top = ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * step;
      if (top > h[k]) h[k] = Math.round(top);
    }
  }
  return h;
}
// The world map was baked from tiles that end at 85° of latitude: every row beyond is a copy of the last real one.
// In the north that is the floor of the Arctic Ocean, which nobody sees under its ice. In the south it is land —
// the rock under the ice of the Antarctic — and the copies drew every ridge of that last row out into a ray to the
// pole: a fan of light and shade round it. Beyond CAP_LAT the land is made level instead: the mean height of the
// land of the last real row, reached over half a degree.
export const CAP_LAT = 85;
export function capSouth(h, w = WMAP_W) {
  const rows = h.length / w, rowOf = lat => Math.round((90 - lat) / 180 * rows - .5), j0 = rowOf(-CAP_LAT + .5), j1 = rowOf(-CAP_LAT);
  let sum = 0, n = 0;
  for (let i = 0, k = j0 * w; i < w; i++, k++) if (h[k] > 0) { sum += h[k]; n++; }
  const level = n ? Math.round(sum / n) : 0;
  for (let j = j0 + 1; j < rows; j++) { const t = Math.min(1, (j - j0) / Math.max(1, j1 - j0)), r = j * w; for (let i = 0; i < w; i++) h[r + i] = Math.round(h[r + i] + (level - h[r + i]) * t); }
  return h;
}
// The height of the world map at a place, m, joined between its four nearest points — as the shaders read it far
// from the ground. The longitude wraps round the Earth (any number of degrees), the latitude stops at the poles.
export function worldAt(h, lat, lon, w = WMAP_W, rows = WMAP_H) {
  const x = (lon + 180) / 360 * w - .5, y = Math.max(0, Math.min(rows - 1, (90 - lat) / 180 * rows - .5));
  const i = Math.floor(x), j = Math.min(rows - 2, Math.floor(y)), fx = x - i, fy = y - j, i0 = ((i % w) + w) % w, i1 = (i0 + 1) % w, r = j * w;
  return (h[r + i0] * (1 - fx) + h[r + i1] * fx) * (1 - fy) + (h[r + w + i0] * (1 - fx) + h[r + w + i1] * fx) * fy;
}
// The world map and the heights of the polygon are two measurements of the same land, and they do not agree: along
// the border they stand 40–80 m apart on the average and up to 500 m in the mountains of the Maghreb. Joined as they
// were, a range that crosses the border changed its height on the way. So round the polygon the world map is made
// to say what the polygon says: every point of it there takes the mean of the polygon's heights over its own cell.
// What is left between the two at the border is the detail the world map cannot hold, and that fades out evenly.
//   h         the world map, decoded (changed in place)
//   regionAt  the heights of the polygon, (lat, lon) → m; they must reach FIT_REACH degrees beyond its border
// The fit is whole out to REGION_FADE + FIT_PAD beyond the border and is gone FIT_FEATHER further.
// (Beyond the border. The heights of the polygon end at its border: asked for a place past it, regionAt() answers
// with the last point on its side. Until stage 3 the fit took that answer for the 0.28° beyond the border as well,
// which drew the last row of the polygon out: where a shore runs along the border — the coast of East Frisia along
// 53.7° N — the land at the border stood out into the sea as straight-sided blocks 30 km long (16.11.2026). At
// stage 3 a point beyond the border keeps the world's own height and is shifted by what the fit changed at the
// nearest point of the border, so that the two still meet there; and it stays on its own side of the sea — what the
// world map has as water is left water, what it has as land is left land. At stage 2 the rule is as it was.)
export const FIT_PAD = .02, FIT_FEATHER = .06, FIT_REACH = REGION_FADE + FIT_PAD + FIT_FEATHER;
export function fitWorld(h, regionAt, w = WMAP_W, rows = WMAP_H, shift = STAGE >= 3) {
  const dLat = 180 / rows, dLon = 360 / w, K = 5;
  const y0 = Math.max(0, Math.floor((90 - BBOX.lat1 - FIT_REACH) / dLat)), y1 = Math.min(rows - 1, Math.ceil((90 - BBOX.lat0 + FIT_REACH) / dLat));
  const x0 = Math.floor((BBOX.lon0 - FIT_REACH + 180) / dLon), x1 = Math.ceil((BBOX.lon1 + FIT_REACH + 180) / dLon);
  const mean = (lat, lon) => { let sum = 0; for (let b = 0; b < K; b++) for (let a = 0; a < K; a++) sum += regionAt(lat + ((b + .5) / K - .5) * dLat, lon + ((a + .5) / K - .5) * dLon); return sum / (K * K); };
  const latOf = y => 90 - (y + .5) * dLat, lonOf = x => -180 + (x + .5) * dLon, at = (x, y) => y * w + ((x % w) + w) % w;
  let n = 0;
  if (!shift) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const lat = latOf(y), lon = lonOf(x), k = ss(-FIT_FEATHER, 0, regionEdge(lat, lon) + REGION_FADE + FIT_PAD);
      if (k <= 0) continue;
      const o = at(x, y);
      h[o] = Math.round(h[o] + (mean(lat, lon) - h[o]) * k); n++;
    }
    return n;
  }
  // the points of the map whose middle lies inside the polygon: columns xa..xb, rows ya..yb
  const xa = Math.ceil((BBOX.lon0 + 180) / dLon - .5), xb = Math.floor((BBOX.lon1 + 180) / dLon - .5), ya = Math.ceil((90 - BBOX.lat1) / dLat - .5), yb = Math.floor((90 - BBOX.lat0) / dLat - .5);
  const cw = xb - xa + 1, by = new Float32Array(Math.max(0, cw * (yb - ya + 1)));
  // inside: the mean of the polygon over the cell, and by how much that moved the point
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const o = at(x, y), v = mean(latOf(y), lonOf(x)); by[(y - ya) * cw + x - xa] = v - h[o]; h[o] = Math.round(v); n++; }
  if (!by.length) return n;
  const moved = (x, y) => by[(Math.max(ya, Math.min(yb, y)) - ya) * cw + Math.max(xa, Math.min(xb, x)) - xa];
  // beyond: the world's own height, moved as the border was moved beside it (the mean of three points along the border)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x >= xa && x <= xb && y >= ya && y <= yb) continue;
    const k = ss(-FIT_FEATHER, 0, regionEdge(latOf(y), lonOf(x)) + REGION_FADE + FIT_PAD);
    if (k <= 0) continue;
    const sideX = x < xa || x > xb, sideY = y < ya || y > yb;
    const d = sideX && !sideY ? (moved(x, y - 1) + moved(x, y) + moved(x, y + 1)) / 3 : sideY && !sideX ? (moved(x - 1, y) + moved(x, y) + moved(x + 1, y)) / 3 : moved(x, y);
    const o = at(x, y), hw = h[o]; let v = hw + d * k;
    if (hw <= 0) v = Math.min(v, Math.max(hw, -1)); else v = Math.max(v, Math.min(hw, 1));
    h[o] = Math.round(v); n++;
  }
  return n;
}
// The heights of the polygon and of the world as one: (lat, lon) → m. Inside the polygon regionAt() answers alone;
// beyond it the world map, and over REGION_FADE between them a mix of the two — the rule of heightLod() in glsl.js.
//   regionAt(lat, lon)  the heights of the polygon (the base);   world  the decoded world map, or null: then −3200 m
export function joinHeights(regionAt, world, w = WMAP_W, rows = WMAP_H) {
  return (lat, lon) => {
    if (!(lon >= -180 && lon < 180)) lon = ((lon + 180) % 360 + 360) % 360 - 180;
    const k = regionWeight(lat, lon);
    if (k >= 1) return regionAt(lat, lon);
    const hw = world ? worldAt(world, lat, lon, w, rows) : -3200;
    return k <= 0 ? hw : hw + (regionAt(lat, lon) - hw) * k;
  };
}
