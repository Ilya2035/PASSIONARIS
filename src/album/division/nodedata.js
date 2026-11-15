// The album's data read from disk in Node (tests, scripts): heights, rivers, lakes, places — what data.js loads in the
// page, without textures. → null when public/album-data/ is not there (it is not in git: scripts/album/fetch-data.mjs).
// At stage 3 (geo.js STAGE) it gives the mask of the worked land too, as data.js does: data.worked(lat, lon) → 0 the
// world · 1 worked land · 2 its water (worked.js), the fourth argument of new Chunks(); at stage 2 data.worked is null.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { mercX, mercY, STAGE } from '../geo.js';
import { decodeWorked } from '../worked.js';
import { decodeCourses, mainRivers } from '../water/courses.js';
import { fillHollows } from '../water/hollows.js';
import { despike } from '../ground/despike.js';
import { WMAP_W, WMAP_H, decodeWorldHeights, raiseIce, capSouth, fitWorld, joinHeights } from '../ground/world.js';
import { decodeWorldClimate, ICE_STEP } from '../ground/climate.js';

export function loadAlbumData(root) {
  const dir = join(root, 'public', 'album-data');
  if (!existsSync(join(dir, 'meta.json')) || !existsSync(join(dir, 'vectors.json'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  if (!existsSync(join(dir, meta.base.file))) return null;
  const buf = gunzipSync(readFileSync(join(dir, meta.base.file)));
  const raw = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  // as data.js does in the page: the needles and wells of the coast, then the hollows — unless the heights were baked
  // already mended (meta.mended: the base of stage 3 is)
  if (!meta.mended) { despike(raw, meta.base.w, meta.base.h); fillHollows(raw, meta.base.w, meta.base.h); }
  const b = meta.base, n = 2 ** b.z, rect = [b.x0 / n, b.y0 / n, n * 256 / b.w, n * 256 / b.h];
  const regionAt = (lat, lon) => {
    const x = Math.max(0, Math.min(b.w - 1.001, (mercX(lon) - rect[0]) * rect[2] * b.w - 0.5));
    const y = Math.max(0, Math.min(b.h - 1.001, (mercY(lat) - rect[1]) * rect[3] * b.h - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * b.w + i;
    const p = raw[k], q = raw[k + 1], r = raw[k + b.w], s = raw[k + b.w + 1];
    return ((p * (1 - fx) + q * fx) * (1 - fy) + (r * (1 - fx) + s * fx) * fy) / 4 - 8192;
  };
  // the height of any place of the Earth, as data.js gives it: the polygon's own inside it, the world map beyond and in
  // a band at its edge (a chunk of the edge may reach a little beyond the polygon) — with the rock lifted to the ice and
  // the map fitted to the polygon's own heights at its edge
  const at = joinHeights(regionAt, worldHeights(root, regionAt));
  const vectors = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8'));
  // the real courses of the rivers, as data.js gives them to the page
  const rf = join(root, 'public', 'assets', 'album', 'water', 'rivers.bin.gz'); let courses = null;
  if (existsSync(rf)) { const u = gunzipSync(readFileSync(rf)); courses = decodeCourses(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); vectors.riversCoarse = vectors.rivers; vectors.rivers = mainRivers(courses); }
  return { meta, base: { ...b, at, regionAt }, vectors, courses, worked: STAGE >= 3 ? workedOf(root) : null };
}
// the mask of the worked land (public/assets/album/worked.bin.gz, scripts/album/bake-worked.mjs) as a function of a
// point, or null when the file is not there
export function workedOf(root) {
  const f = join(root, 'public', 'assets', 'album', 'worked.bin.gz'); if (!existsSync(f)) return null;
  const u = gunzipSync(readFileSync(f));
  return decodeWorked(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)).at;
}
// the world map of heights as data.js has it (ground/world.js), or null when it is not there (then beyond the polygon
// all is deep sea, as in the page); read once a process (36 MB packed, 64 MB as heights). The steps and their order are
// those of data.js: decode, the ice (or the cap of the south), then fitWorld to the heights of the polygon — the test
// tests/album-division-bake.test.mjs holds the two files to the same steps.
function readWorld(root) {
  const f = join(root, 'public', 'assets', 'map', 'height.delta.bin.gz'); if (!existsSync(f)) return null;
  const u = gunzipSync(readFileSync(f)), h = decodeWorldHeights(new Int16Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)));
  if (h.length !== WMAP_W * WMAP_H) return null;
  const cf = join(root, 'public', 'assets', 'album', 'ground', 'world.bin.gz'); let iced = false;
  if (existsSync(cf)) { const c = gunzipSync(readFileSync(cf)), d = decodeWorldClimate(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)); if (d) { raiseIce(h, d.ice, d.w, d.h, ICE_STEP); iced = true; } }
  if (!iced) capSouth(h);
  return h;
}
const WORLD = new Map();
function worldHeights(root, regionAt) {
  if (!WORLD.has(root)) { const h = readWorld(root); if (h) fitWorld(h, regionAt); WORLD.set(root, h); }
  return WORLD.get(root);
}
