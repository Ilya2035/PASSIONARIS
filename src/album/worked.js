// The mask of the WORKED LAND (scripts/album/bake-worked.mjs; docs/BACKLOG.md, «Этап 3»): where the map is made in
// detail — chunks, districts, roads, settlements — and where it is the simple land of the world. One byte for every
// square kilometre of the lattice of the chunks. The worked land is made of regions, and a region is a land, not a
// state: Iberia, Western Europe up to the Rhine, the Maghreb down to the edge of the Sahara.
// Nothing reads the mask yet: the parts take it up together, in the one release that enlarges the polygon.
import { KM_PER_DEG, COS_REF } from './geo.js';

export const WORLD = 0, WORKED = 1, WORKED_WATER = 2;   // the world · worked land · its lakes and the sea along its coast

// buf: the unpacked file — Int32 x0, y0, w, h (km of the plane of chunks.js), then w · h bytes, rows south to north
export function decodeWorked(buf) {
  const [x0, y0, w, h] = new Int32Array(buf, 0, 4), data = new Uint8Array(buf, 16, w * h);
  // what a point is; beyond the lattice everything is the world
  const at = (lat, lon) => {
    const i = Math.floor(lon * KM_PER_DEG * COS_REF - x0), j = Math.floor(lat * KM_PER_DEG - y0);
    return i >= 0 && j >= 0 && i < w && j < h ? data[j * w + i] : WORLD;
  };
  return { x0, y0, w, h, data, at };
}
export async function loadWorked(url = 'assets/album/worked.bin.gz') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return decodeWorked(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
