// The album's data read from disk in Node (tests, scripts): heights, rivers, lakes, places — what data.js loads in the
// page, without textures. → null when public/album-data/ is not there (it is not in git: scripts/album/fetch-data.mjs).
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { mercX, mercY } from '../geo.js';
import { decodeCourses, mainRivers } from '../water/courses.js';
import { fillHollows } from '../water/hollows.js';

export function loadAlbumData(root) {
  const dir = join(root, 'public', 'album-data');
  if (!existsSync(join(dir, 'meta.json')) || !existsSync(join(dir, 'vectors.json'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  if (!existsSync(join(dir, meta.base.file))) return null;
  const buf = gunzipSync(readFileSync(join(dir, meta.base.file)));
  const raw = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  fillHollows(raw, meta.base.w, meta.base.h);                       // as data.js does in the page
  const b = meta.base, n = 2 ** b.z, rect = [b.x0 / n, b.y0 / n, n * 256 / b.w, n * 256 / b.h];
  const at = (lat, lon) => {
    const x = Math.max(0, Math.min(b.w - 1.001, (mercX(lon) - rect[0]) * rect[2] * b.w - 0.5));
    const y = Math.max(0, Math.min(b.h - 1.001, (mercY(lat) - rect[1]) * rect[3] * b.h - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * b.w + i;
    const p = raw[k], q = raw[k + 1], r = raw[k + b.w], s = raw[k + b.w + 1];
    return ((p * (1 - fx) + q * fx) * (1 - fy) + (r * (1 - fx) + s * fx) * fy) / 4 - 8192;
  };
  const vectors = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8'));
  // the real courses of the rivers, as data.js gives them to the page
  const rf = join(root, 'public', 'assets', 'album', 'water', 'rivers.bin.gz'); let courses = null;
  if (existsSync(rf)) { const u = gunzipSync(readFileSync(rf)); courses = decodeCourses(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); vectors.riversCoarse = vectors.rivers; vectors.rivers = mainRivers(courses); }
  return { meta, base: { ...b, at }, vectors, courses };
}
