// Browser-safe helpers for the baked regions data (no Node imports): the main
// thread can import this file directly or copy it into src/. Pure functions,
// typed arrays, nothing allocated per frame.
//
// Files (public/assets/regions/):
//   districts.bin.gz  Uint16 W x H (8192 x 4096), row 0 = 90N, col 0 = 180W; 0 = unassigned (never in practice)
//   regions.json      { districts:[{id,type,lon,lat,areaKm2,elevM,neighbors,province,region,nameRu,nameKey,reservoir?}],
//                       provinces:[{id,type,lon,lat,areaKm2,districts,neighbors,region,nameRu,nameKey}],
//                       regions:[{id,type,lon,lat,areaKm2,provinces,neighbors,nameRu,nameKey}], stats }
//   roads.bin.gz      Float32 [lon,lat, lon,lat, ...] of all road polylines
//   roads.json        [{a, b, lengthKm, offset, count}]  (offset/count in points)

export const TYPE_CODE = { sea: 0, lake: 1, land: 2, mountain: 3 };

const typed = (bytes, Type) => {
  if (bytes.byteOffset % Type.BYTES_PER_ELEMENT) bytes = bytes.slice();
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};

// bytes: already gunzipped Uint8Arrays; json: parsed objects.
export function parseRegions(regionsJson, districtBytes, roadBytes, roadIndex) {
  const map = typed(districtBytes, Uint16Array);
  const roadPts = typed(roadBytes, Float32Array);
  const n = regionsJson.districts.length;
  const type = new Uint8Array(n + 1), province = new Uint16Array(n + 1), region = new Uint16Array(n + 1);
  const lon = new Float32Array(n + 1), lat = new Float32Array(n + 1);
  for (const d of regionsJson.districts) {
    type[d.id] = TYPE_CODE[d.type]; province[d.id] = d.province; region[d.id] = d.region;
    lon[d.id] = d.lon; lat[d.id] = d.lat;
  }
  const { width: W, height: H } = regionsJson.grid;
  return { W, H, map, data: regionsJson, roads: roadIndex, roadPts, type, province, region, lon, lat, count: n };
}

// District id under a geographic point.
export function districtAt(R, lonDeg, latDeg) {
  const { W, H, map } = R;
  let x = Math.floor((lonDeg + 180) / 360 * W); x = ((x % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - latDeg) / 180 * H)));
  return map[y * W + x];
}

// Per-id table for an RG16UI texture (like makeInfoTexture): R = province, G = region.
export function infoTable(R, rowWidth = 1024) {
  const rows = Math.ceil((R.count + 1) / rowWidth);
  const out = new Uint16Array(rowWidth * rows * 2);
  for (let id = 1; id <= R.count; id++) { out[id * 2] = R.province[id]; out[id * 2 + 1] = R.region[id]; }
  return { data: out, width: rowWidth, height: rows };
}

// Drop-in replacement for the legacy cells raster used by TERRAIN_FRAG
// (0 ocean, 1 lake, >= 2 land): land / mountain district id -> id + 1.
// Pass the original cells (Uint32, from cells.bin.gz) to keep its exact water
// mask: lakes < 400 km2, lagoons and ocean pockets < 300 km2 belong to land
// districts in districts.bin but must still be drawn as water. The array is then
// rewritten in place (no second 134 MB buffer) and returned.
export function toLegacyCells(R, cells = null) {
  const { map, type } = R;
  if (cells) {
    if (cells.length !== map.length) throw new Error('toLegacyCells: cells size mismatch');
    for (let i = 0; i < map.length; i++) {
      if (cells[i] < 2) continue; // keep ocean (0) / lake (1) as they are
      const id = map[i];
      cells[i] = type[id] >= 2 ? id + 1 : 2; // land texels always carry land ids
    }
    return cells;
  }
  const out = new Uint32Array(map.length);
  for (let i = 0; i < map.length; i++) {
    const id = map[i], t = type[id];
    out[i] = t >= 2 ? id + 1 : t;
  }
  return out;
}

// Road polylines -> LineSegments positions (lon, lat, 0) pairs, the layout
// RIVER_VERT in src/game/shaders.js expects (position.z = rank / class).
export function roadSegments(R, z = 0) {
  let nseg = 0;
  for (const r of R.roads) nseg += Math.max(0, r.count - 1);
  const pos = new Float32Array(nseg * 6);
  let o = 0;
  const P = R.roadPts;
  for (const r of R.roads) {
    for (let k = 0; k + 1 < r.count; k++) {
      const p = (r.offset + k) * 2;
      pos[o++] = P[p]; pos[o++] = P[p + 1]; pos[o++] = z;
      pos[o++] = P[p + 2]; pos[o++] = P[p + 3]; pos[o++] = z;
    }
  }
  return pos;
}

// Road polyline of one road as a Float32Array view [lon,lat,...] (no copy).
export function roadPolyline(R, roadIndex) {
  const r = R.roads[roadIndex];
  return R.roadPts.subarray(r.offset * 2, (r.offset + r.count) * 2);
}
