// The worked land for the bakes of the water (bake-rivers.mjs, bake-coast.mjs): is a point on the land the map is
// made on in detail, or within `near` km of it? The mask itself: src/album/worked.js, scripts/album/bake-worked.mjs
// (a byte for every square km: 0 the world, 1 the worked land, 2 its lakes and the sea along its coast).
// The rivers and the beaches are needed only there (the lead, 15.11.2026). The margin keeps whole a river that IS
// the edge of the worked land: the Rhine runs half in it and half beside it.
// → (lat, lon) → true | false, or null when there is no file of the mask (then everything in the region is kept).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeWorked } from '../../src/album/worked.js';
import { KM_PER_DEG, COS_REF } from '../../src/album/geo.js';

export function workedNear(root, near = 3) {
  const f = join(root, 'public', 'assets', 'album', 'worked.bin.gz'); if (!existsSync(f)) return null;
  const u = gunzipSync(readFileSync(f)), { x0, y0, w, h, data } = decodeWorked(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
  // the mask grown by `near` squares: along the rows, then along the columns
  const R = Math.max(0, Math.round(near)), rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) { let last = -1e9; const o = j * w;
    for (let i = 0; i < w; i++) { if (data[o + i]) last = i; if (i - last <= R) rows[o + i] = 1; }
    last = 1e9; for (let i = w - 1; i >= 0; i--) { if (data[o + i]) last = i; if (last - i <= R) rows[o + i] = 1; } }
  for (let i = 0; i < w; i++) { let last = -1e9;
    for (let j = 0; j < h; j++) { if (rows[j * w + i]) last = j; if (j - last <= R) out[j * w + i] = 1; }
    last = 1e9; for (let j = h - 1; j >= 0; j--) { if (rows[j * w + i]) last = j; if (last - j <= R) out[j * w + i] = 1; } }
  return (lat, lon) => { const i = Math.floor(lon * KM_PER_DEG * COS_REF - x0), j = Math.floor(lat * KM_PER_DEG - y0); return i >= 0 && j >= 0 && i < w && j < h && out[j * w + i] === 1; };
}
