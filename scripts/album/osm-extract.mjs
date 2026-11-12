// Reads the OpenStreetMap extracts (scripts/album/fetch-osm.mjs) and keeps what the album draws from:
//   rivers   ways waterway=river — the real courses, in the direction of the flow
//   banks    outlines of river water (natural=water + water=river, waterway=riverbank) — how wide a river really is
//   beaches  natural=beach
//   places   nodes place=city|town|village|hamlet with their names and people
//   admin    administrative borders of levels 4, 6 and 7 as relations of ways
// Each extract → data/album/osm/extract/<name>.<what>.json.gz (gitignored). Coordinates are whole microdegrees,
// [lon, lat, lon, lat, …]. The PBF format is read by hand: no dependencies.
//   node scripts/album/osm-extract.mjs [name …]
import { openSync, readSync, closeSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, gzipSync } from 'node:zlib';
import { PBF_DIR, EXTRACTS, pbfFile } from './fetch-osm.mjs';

export const OUT_DIR = join(PBF_DIR, '..', 'extract');
const BOX = { lat0: 34.9, lat1: 45.1, lon0: -10.4, lon1: 4.9 };       // the album's region with a margin, degrees
const PLACE = new Set(['city', 'town', 'village', 'hamlet']);
const WANT = ['waterway', 'natural', 'water', 'name', 'name:ru', 'name:es', 'intermittent', 'place', 'population', 'boundary', 'admin_level', 'type', 'tunnel'];

// ---- protobuf
let B, P;
function vint() {
  let b = B[P++], lo = b & 127; if (b < 128) return lo;
  b = B[P++]; lo |= (b & 127) << 7; if (b < 128) return lo;
  b = B[P++]; lo |= (b & 127) << 14; if (b < 128) return lo;
  b = B[P++]; lo |= (b & 127) << 21; if (b < 128) return lo;
  let res = lo, mul = 268435456;
  for (;;) { b = B[P++]; res += (b & 127) * mul; if (b < 128) return res; mul *= 128; }
}
const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
const skip = wt => { if (wt === 0) vint(); else if (wt === 2) { const l = vint(); P += l; } else if (wt === 5) P += 4; else if (wt === 1) P += 8; else throw new Error('wire type ' + wt); };

// ---- the file: a row of blobs
function index(file) {
  const fd = openSync(file, 'r'), size = statSync(file).size, head = Buffer.alloc(4), list = [];
  let off = 0, hb = Buffer.alloc(64);
  while (off < size) {
    readSync(fd, head, 0, 4, off); const hl = head.readUInt32BE(0);
    if (hl > hb.length) hb = Buffer.alloc(hl);
    readSync(fd, hb, 0, hl, off + 4); B = hb; P = 0; let type = '', ds = 0;
    while (P < hl) { const tag = vint(), f = tag >>> 3, wt = tag & 7; if (f === 1) { const l = vint(); type = hb.toString('latin1', P, P + l); P += l; } else if (f === 3) ds = vint(); else skip(wt); }
    if (type === 'OSMData') list.push([off + 4 + hl, ds]);
    off += 4 + hl + ds;
  }
  return { fd, list };
}
function blob(fd, [at, ds]) {
  const bb = Buffer.alloc(ds); readSync(fd, bb, 0, ds, at); B = bb; P = 0; let raw = null;
  while (P < ds) { const tag = vint(), f = tag >>> 3, wt = tag & 7; if (f === 1) { const l = vint(); raw = bb.subarray(P, P + l); P += l; } else if (f === 3) { const l = vint(); raw = inflateSync(bb.subarray(P, P + l)); P += l; } else skip(wt); }
  return raw;
}
// a block: its strings, its groups, which of the wanted keys it holds
function block(data) {
  B = data; P = 0; const end = data.length, groups = []; let st = null, gran = 100;
  while (P < end) { const tag = vint(), f = tag >>> 3, wt = tag & 7;
    if (f === 1) { const l = vint(); st = [P, P + l]; P += l; } else if (f === 2) { const l = vint(); groups.push([P, P + l]); P += l; } else if (f === 17) gran = vint(); else skip(wt); }
  const s = []; P = st[0]; while (P < st[1]) { vint(); const l = vint(); s.push(P, l); P += l; }
  const key = {}; for (let i = 0; i < s.length; i += 2) if (s[i + 1] >= 4 && s[i + 1] <= 12) { const w = data.latin1Slice(s[i], s[i] + s[i + 1]); if (WANT.includes(w)) key[w] = i / 2; }
  const kinds = groups.map(g => { P = g[0]; return vint() >>> 3; });   // 2 dense nodes · 3 ways · 4 relations
  return { data, s, key, groups, kinds, gran, str: i => data.utf8Slice(s[i * 2], s[i * 2] + s[i * 2 + 1]) };
}
const packed = (a, e, signedDelta) => { const out = []; let acc = 0; P = a; while (P < e) { if (signedDelta) { acc += zz(vint()); out.push(acc); } else out.push(vint()); } return out; };
// ways or relations of a group: cb({ id, keys, valsAt, refsAt, … }) gets raw ranges and decodes what it needs
function eachMsg(bl, g, cb) {
  let q = g[0];
  while (q < g[1]) {
    P = q; vint(); const len = vint(), e = P + len, m = { id: 0, k: null, v: null, refs: null, roles: null, mem: null, types: null };
    while (P < e) { const tag = vint(), f = tag >>> 3, wt = tag & 7;
      if (f === 1) m.id = vint(); else if (wt === 2) { const l = vint(), a = P; if (f === 2) m.k = [a, a + l]; else if (f === 3) m.v = [a, a + l]; else if (f === 8) m.refs = [a, a + l]; else if (f === 9) m.mem = [a, a + l]; else if (f === 10) m.types = [a, a + l]; P = a + l; } else skip(wt); }
    cb(m); q = e;
  }
}
const tagsOf = (bl, m) => { const t = {}; if (!m.k) return t; const k = packed(m.k[0], m.k[1]), v = packed(m.v[0], m.v[1]); for (let i = 0; i < k.length; i++) for (const w of WANT) if (bl.key[w] === k[i]) t[w] = bl.str(v[i]); return t; };
const hasKey = (bl, m, names) => { if (!m.k) return false; const ids = names.map(n => bl.key[n]).filter(x => x !== undefined); if (!ids.length) return false; P = m.k[0]; while (P < m.k[1]) if (ids.includes(vint())) return true; return false; };

function extract(name, file) {
  const t0 = Date.now(), { fd, list } = index(file);
  const kindsOf = i => block(blob(fd, list[i])).kinds;
  let lo = 0, hi = list.length - 1;                                 // nodes come first: find the first blob with ways
  while (lo < hi) { const mid = (lo + hi) >> 1; if (kindsOf(mid).some(k => k >= 3)) hi = mid; else lo = mid + 1; }
  const firstWay = lo;
  // ---- ways with tags of their own, and relations
  const ways = new Map(), rels = [], members = new Set();          // id → { kind, tags, refs }
  for (let i = firstWay; i < list.length; i++) {
    const bl = block(blob(fd, list[i]));
    bl.groups.forEach((g, gi) => {
      if (bl.kinds[gi] === 3) eachMsg(bl, g, m => {
        if (!hasKey(bl, m, ['waterway', 'natural'])) return;
        const t = tagsOf(bl, m), kind = t.waterway === 'river' ? 'river' : t.waterway === 'riverbank' || (t.natural === 'water' && t.water === 'river') ? 'bank' : t.natural === 'beach' ? 'beach' : null;
        if (kind && m.refs) ways.set(m.id, { kind, t, refs: packed(m.refs[0], m.refs[1], true) });
      });
      else if (bl.kinds[gi] === 4) eachMsg(bl, g, m => {
        if (!hasKey(bl, m, ['boundary', 'waterway', 'natural'])) return;
        const t = tagsOf(bl, m), admin = t.boundary === 'administrative' && ['4', '6', '7'].includes(t.admin_level), bank = t.waterway === 'riverbank' || (t.natural === 'water' && t.water === 'river');
        if (!admin && !bank) return;
        const mem = packed(m.mem[0], m.mem[1], true), types = packed(m.types[0], m.types[1]), w = mem.filter((_, j) => types[j] === 1);
        for (const id of w) members.add(id);
        rels.push({ id: m.id, kind: admin ? 'admin' : 'bank', t, ways: w });
      });
    });
  }
  // ---- member ways of the relations (they carry no tags of their own)
  if (members.size) for (let i = firstWay; i < list.length; i++) {
    const bl = block(blob(fd, list[i])); if (!bl.kinds.includes(3)) { if (bl.kinds.includes(4)) break; continue; }
    bl.groups.forEach((g, gi) => { if (bl.kinds[gi] === 3) eachMsg(bl, g, m => { if (members.has(m.id) && !ways.has(m.id) && m.refs) ways.set(m.id, { kind: 'member', t: {}, refs: packed(m.refs[0], m.refs[1], true) }); }); });
  }
  // ---- the nodes those ways are made of, and the places
  let n = 0; for (const w of ways.values()) n += w.refs.length;
  const need = new Float64Array(n); n = 0; for (const w of ways.values()) for (const r of w.refs) need[n++] = r;
  need.sort(); let u = 0; for (let i = 0; i < n; i++) if (!i || need[i] !== need[i - 1]) need[u++] = need[i];
  const ids = need.subarray(0, u), lat = new Int32Array(u), lon = new Int32Array(u), places = [];
  const find = id => { let a = 0, b = u - 1; while (a <= b) { const m = (a + b) >> 1; if (ids[m] < id) a = m + 1; else if (ids[m] > id) b = m - 1; else return m; } return -1 - a; };
  for (let i = 0; i <= Math.min(firstWay, list.length - 1); i++) {
    const bl = block(blob(fd, list[i])), data = bl.data, sc = bl.gran / 1000;      // → microdegrees
    bl.groups.forEach((g, gi) => {
      if (bl.kinds[gi] !== 2) return;
      P = g[0]; vint(); const len = vint(), e = P + len; let rId, rLat, rLon, rKv;
      while (P < e) { const tag = vint(), f = tag >>> 3, wt = tag & 7; if (wt !== 2) { skip(wt); continue; } const l = vint(), a = P; if (f === 1) rId = [a, a + l]; else if (f === 8) rLat = [a, a + l]; else if (f === 9) rLon = [a, a + l]; else if (f === 10) rKv = [a, a + l]; P = a + l; }
      const nid = packed(rId[0], rId[1], true), nla = packed(rLat[0], rLat[1], true), nlo = packed(rLon[0], rLon[1], true);
      let p = find(nid[0]); if (p < 0) p = -1 - p;
      for (let j = 0; j < nid.length && p < u; j++) { while (p < u && ids[p] < nid[j]) p++; if (p < u && ids[p] === nid[j]) { lat[p] = Math.round(nla[j] * sc); lon[p] = Math.round(nlo[j] * sc); } }
      if (rKv && bl.key.place !== undefined) {                      // tags of dense nodes: k v k v … 0 for every node
        const kv = packed(rKv[0], rKv[1]); let j = 0, q = 0;
        while (q < kv.length && j < nid.length) {
          if (!kv[q]) { q++; j++; continue; }
          let t = null, q0 = q; while (kv[q]) { if (kv[q] === bl.key.place) t = {}; q += 2; }
          if (t) { for (let x = q0; x < q; x += 2) for (const w of WANT) if (bl.key[w] === kv[x]) t[w] = bl.str(kv[x + 1]);
            if (PLACE.has(t.place)) places.push({ t: t.place, name: t.name || '', ru: t['name:ru'] || '', pop: parseInt(t.population, 10) || 0, lat: Math.round(nla[j] * sc), lon: Math.round(nlo[j] * sc) }); }
          q++; j++;
        }
      }
    });
  }
  closeSync(fd);
  // ---- lines of coordinates; only what touches the region
  const B6 = { lat0: BOX.lat0 * 1e6, lat1: BOX.lat1 * 1e6, lon0: BOX.lon0 * 1e6, lon1: BOX.lon1 * 1e6 };
  const line = w => { const pts = []; let inside = false; for (const r of w.refs) { const p = find(r); if (p < 0) continue; pts.push(lon[p], lat[p]); if (lat[p] > B6.lat0 && lat[p] < B6.lat1 && lon[p] > B6.lon0 && lon[p] < B6.lon1) inside = true; } return inside && pts.length >= 4 ? pts : null; };
  const out = { rivers: [], banks: [], beaches: [], places: places.filter(p => p.lat > B6.lat0 && p.lat < B6.lat1 && p.lon > B6.lon0 && p.lon < B6.lon1), admin: { rels: [], ways: {} } };
  const lines = new Map();
  for (const [id, w] of ways) { const pts = line(w); if (!pts) continue; lines.set(id, pts);
    if (w.kind === 'river') out.rivers.push({ id, name: w.t.name || '', ru: w.t['name:ru'] || '', im: w.t.intermittent === 'yes' ? 1 : 0, tun: w.t.tunnel ? 1 : 0, pts });
    else if (w.kind === 'bank') out.banks.push(pts);
    else if (w.kind === 'beach') out.beaches.push({ name: w.t.name || '', pts }); }
  for (const r of rels) {
    const have = r.ways.filter(id => lines.has(id)); if (!have.length) continue;
    if (r.kind === 'bank') { for (const id of have) if (ways.get(id).kind === 'member') out.banks.push(lines.get(id)); continue; }
    out.admin.rels.push({ id: r.id, level: +r.t.admin_level, name: r.t.name || '', ru: r.t['name:ru'] || '', es: r.t['name:es'] || '', ways: have });
    for (const id of have) out.admin.ways[id] = lines.get(id);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const k of Object.keys(out)) writeFileSync(join(OUT_DIR, `${name}.${k}.json.gz`), gzipSync(Buffer.from(JSON.stringify(out[k])), { level: 5 }));
  console.log(`${name}: ${list.length} blobs, ${out.rivers.length} river ways, ${out.banks.length} bank lines, ${out.beaches.length} beaches, ${out.places.length} places, ${out.admin.rels.length} borders, ${u} nodes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/album/osm-extract.mjs')) {
  const only = process.argv.slice(2);
  for (const e of EXTRACTS) {
    const name = e.split('/').pop(), f = pbfFile(e);
    if (only.length ? !only.includes(name) : existsSync(join(OUT_DIR, `${name}.rivers.json.gz`))) continue;
    if (!existsSync(f)) { console.log(`no file for ${name}: run scripts/album/fetch-osm.mjs`); continue; }
    extract(name, f);
  }
}
