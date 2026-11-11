// One coastline at every zoom, as in 5000 BC (scripts/bake-coast-fix.mjs, public/assets/coast/).
// The baked map rasters lost islands (most of the Kurils, many Pacific islands, land cut off by lakes), drew 20th
// century reservoirs and the IJsselmeer polders, and disagreed with the 1.2 km coast mask in places. The fix is a
// list of map texels with their natural district and biome class, plus detail coverage tiles that replace or add
// z7m tiles; applied here while the world loads:
//   regions.js  fixDistricts(ids)   the natural-district raster (land / water and the district a texel belongs to)
//   biomes.js   fixBiomes(classes)  the terrain colours of the new land and of thin islands
//   detail.js   coast.tiles         which detail mask tiles come from assets/coast/z7m/
const BASE = 'assets/coast/';

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

// decodes cells-fix.bin.gz (layout: scripts/bake-coast-fix.mjs)
export function decodeCoastFix(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const idx = new Uint32Array(n), id = new Uint16Array(n), bio = new Uint8Array(n);
  for (let k = 0, p = 0; k < n; k++, o += 4) { p += dv.getUint32(o, true); idx[k] = p; }
  for (let k = 0; k < n; k++, o += 2) id[k] = dv.getUint16(o, true);
  bio.set(bytes.subarray(o, o + n)); o += n;
  const m = dv.getUint32(o, true); o += 4;
  const bIdx = new Uint32Array(m), bBio = new Uint8Array(m);
  for (let k = 0, p = 0; k < m; k++, o += 4) { p += dv.getUint32(o, true); bIdx[k] = p; }
  bBio.set(bytes.subarray(o, o + m));
  return { idx, id, bio, bIdx, bBio };
}

let pending = null;
// { meta, idx, id, bio, bIdx, bBio, tiles: Set of detail tile keys (ty * 128 + tx) } or null; loaded once
export function loadCoastFix(base = BASE) {
  pending ||= (async () => {
    const meta = await fetch(base + 'coast.json').then(r => (r.ok ? r.json() : null));
    if (!meta || meta.format !== 'passionaris-coast-fix') return null;
    const fix = decodeCoastFix(await fetchGz(base + meta.cells.file));
    return { meta, ...fix, tiles: new Set(meta.tiles), base };
  })().catch(e => { console.warn('coast fix', e); return null; });
  return pending;
}

// natural-district raster (Uint16 per map texel, public/assets/regions/districts.bin.gz); the fix is baked against
// one set of districts: a re-baked regions set (other count) leaves the raster alone until the fix is baked again
export function fixDistricts(ids, fix, districtCount) {
  if (!fix) return false;
  if (fix.meta.regions?.districts !== districtCount) { console.warn('coast fix: baked for other districts — not applied'); return false; }
  const { idx, id } = fix;
  for (let k = 0; k < idx.length; k++) ids[idx[k]] = id[k];
  return true;
}

// biome classes (Uint8 per map texel, public/assets/climate/biome-open.bin.gz)
export function fixBiomes(classes, fix) {
  if (!fix) return false;
  const { idx, bio, bIdx, bBio } = fix;
  for (let k = 0; k < idx.length; k++) classes[idx[k]] = bio[k];
  for (let k = 0; k < bIdx.length; k++) classes[bIdx[k]] = bBio[k];
  return true;
}
