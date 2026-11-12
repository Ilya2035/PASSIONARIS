// The real courses of the rivers: public/assets/album/water/rivers.bin.gz, baked by scripts/album/bake-rivers.mjs
// from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0). Every river runs from its source down and knows its
// width at every point. The file, unzipped: [u32 length of the head][head, JSON][body].
//   head.chains  one entry a river: [points, name, flags, km of river above its lower end]
//                flags: 1 — dry for a part of the year · 2 — ends on a greater river · 4 — begins on another river
//                (an arm that leaves it), not at a source
//   head.names   [[name, name in Russian], …]
//   body         river after river: i32 lon, lat of the first point in 1e-5°, i16 steps to every next point, then a
//                byte of width for every point (widthOf)
// This file has no imports: the page, the tests and the bake script all read it.

export const BBOX_M = { lon0: -1000000, lon1: 450000, lat0: 3520000, lat1: 4480000 };        // the region in 1e-5°
// width of the water, km ↔ its byte: steps of 3 %, from 1.5 m to 4.6 km
export const widthCode = km => Math.max(0, Math.min(255, Math.round(Math.log(Math.max(km, .0015) / .0015) / Math.log(1.032))));
export const widthOf = code => .0015 * 1.032 ** code;

export function decodeCourses(buf) {
  const dv = new DataView(buf), hl = dv.getUint32(0, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const rivers = []; let o = 4 + hl;
  for (const [n, nameIx, flags, acc] of head.chains) {
    const ll = new Float64Array(n * 2), w = new Float32Array(n); let lon = dv.getInt32(o, true), lat = dv.getInt32(o + 4, true); o += 8;
    ll[0] = lon / 1e5; ll[1] = lat / 1e5;
    for (let i = 1; i < n; i++) { lon += dv.getInt16(o, true); lat += dv.getInt16(o + 2, true); o += 4; ll[i * 2] = lon / 1e5; ll[i * 2 + 1] = lat / 1e5; }
    for (let i = 0; i < n; i++) w[i] = widthOf(dv.getUint8(o++));
    const nm = head.names[nameIx] || ['', ''];
    rivers.push({ name: nm[0], ru: nm[1], dry: !!(flags & 1), joins: !!(flags & 2), arm: !!(flags & 4), acc, n, ll, w });
  }
  return { rivers, rule: head.rule, source: head.source };
}
// the same file from rivers [{ name, ru, flags, acc, lon, lat (whole 1e-5°), w (km) }] — the bake script and the tests
export function encodeCourses(rivers, extra = {}) {
  const names = [], ix = new Map(), nameOf = (a, b) => { const k = a + '|' + b; if (!ix.has(k)) { ix.set(k, names.length); names.push([a, b]); } return ix.get(k); };
  const head = { v: 1, ...extra, chains: rivers.map(c => [c.lon.length, nameOf(c.name || '', c.ru || ''), c.flags || 0, Math.round(c.acc || 0)]), names };
  const hb = new TextEncoder().encode(JSON.stringify(head)), size = rivers.reduce((s, c) => s + 8 + (c.lon.length - 1) * 4 + c.lon.length, 0);
  const buf = new ArrayBuffer(4 + hb.length + size), dv = new DataView(buf); dv.setUint32(0, hb.length, true); new Uint8Array(buf, 4, hb.length).set(hb);
  let o = 4 + hb.length;
  for (const c of rivers) {
    dv.setInt32(o, c.lon[0], true); dv.setInt32(o + 4, c.lat[0], true); o += 8;
    for (let i = 1; i < c.lon.length; i++) { dv.setInt16(o, c.lon[i] - c.lon[i - 1], true); dv.setInt16(o + 2, c.lat[i] - c.lat[i - 1], true); o += 4; }
    for (let i = 0; i < c.lon.length; i++) dv.setUint8(o++, widthCode(c.w[i]));
  }
  return buf;
}
// in the page: fetch and unzip; null when the file is not there
export async function loadCourses(url) {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    return decodeCourses(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  } catch { return null; }
}

// The rank the rest of the album knows a river by (chunks, division: 6 and less is a great river), from its width
export const rankOf = wKm => (wKm >= .12 ? 5 : wKm >= .07 ? 6 : wKm >= .04 ? 7 : wKm >= .02 ? 8 : 9);
// The greater rivers as plain lines for those who only need to know where a river runs (the chunks, the division,
// the settlements): [{ name, rank, width (km), pts: [[lon, lat], …] }]. A river is cut into pieces of one rank; its
// head waters, narrower than minW, are left out; points stand every stepKm or so.
export function mainRivers(courses, minW = .012, stepKm = .6) {
  const out = [], KX = 111.195 * Math.cos(40 * Math.PI / 180), KY = 111.195;
  for (const r of courses.rivers) {
    let piece = null, lastX = 0, lastY = 0;
    const flush = () => { if (piece && piece.pts.length > 2) out.push(piece); piece = null; };
    for (let i = 0; i < r.n; i++) {
      const w = r.w[i]; if (w < minW) { flush(); continue; }
      const rank = rankOf(w), lon = r.ll[i * 2], lat = r.ll[i * 2 + 1], x = lon * KX, y = lat * KY;
      if (piece && piece.rank !== rank) { piece.pts.push([lon, lat]); flush(); }
      if (!piece) { piece = { name: r.ru || r.name, rank, width: w, pts: [[lon, lat]] }; lastX = x; lastY = y; continue; }
      if (Math.hypot(x - lastX, y - lastY) >= stepKm || i === r.n - 1) { piece.pts.push([lon, lat]); lastX = x; lastY = y; piece.width = Math.max(piece.width, w); }
    }
    flush();
  }
  return out;
}

// The raster of beaches (public/assets/album/water/coast.bin.gz, scripts/album/bake-coast.mjs): COAST_N × COAST_N
// bytes over the album's square of flat km, from (COAST_X0, COAST_Y0), COAST_KM across; row by row from the south.
export const COAST_N = 2048, COAST_X0 = -880, COAST_Y0 = 3880, COAST_KM = 1280;
