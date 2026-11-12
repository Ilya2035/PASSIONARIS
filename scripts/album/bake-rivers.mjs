// The rivers of the graphics album as they really run: OpenStreetMap courses (scripts/album/osm-extract.mjs) joined
// into a network, every point with the width of the river there.
//   • ways are cut at their meeting points into reaches; water runs along a way, so each reach knows what flows into
//     it, and the length of all the river above a point says how much water it carries;
//   • where OpenStreetMap has the outline of the water itself, the width is measured across it; elsewhere it comes
//     from the water carried, by a rule fitted to the measured widths. Reservoirs are not river water, so a river
//     under a reservoir is as wide as it would be without the dam;
//   • reaches are strung into rivers along the main stem; a tributary ends on the river it joins;
//   • the lines are thinned to a few metres of tolerance.
// → public/assets/album/water/rivers.bin.gz (in git; © OpenStreetMap contributors, ODbL 1.0). Format: courses.js.
//   node scripts/album/bake-rivers.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { OUT_DIR } from './osm-extract.mjs';
import { encodeCourses, BBOX_M } from '../../src/album/water/courses.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
// Russian names of the rivers the album speaks of; OpenStreetMap has name:ru only here and there
const RU = { Ebro: 'Эбро', Tajo: 'Тахо', Tejo: 'Тежу', Duero: 'Дуэро', Douro: 'Дору', Guadiana: 'Гвадиана', Guadalquivir: 'Гвадалквивир', Garonne: 'Гаронна', Júcar: 'Хукар', Xúquer: 'Хукар', Segura: 'Сегура',
  Miño: 'Миньо', Minho: 'Миньо', Dordogne: 'Дордонь', Rhône: 'Рона', Adour: 'Адур', Lot: 'Ло', Tarn: 'Тарн', Genil: 'Хениль', Jalón: 'Халон', Segre: 'Сегре', Cinca: 'Синка', Esla: 'Эсла', Pisuerga: 'Писуэрга',
  Aude: 'Од', Hérault: 'Эро', Mondego: 'Мондегу', Sado: 'Саду', Turia: 'Турия', Túria: 'Турия', Aragón: 'Арагон', Gállego: 'Гальего', Ariège: 'Арьеж', Sil: 'Силь', Tormes: 'Тормес', Jarama: 'Харама', Henares: 'Энарес',
  Alagón: 'Алагон', Zújar: 'Сухар', Guadalete: 'Гвадалете', Odiel: 'Одьель', Tinto: 'Тинто', Almanzora: 'Альмансора', Llobregat: 'Льобрегат', Ter: 'Тер', Nalón: 'Налон', Navia: 'Навия', Tâmega: 'Тамега', Zêzere: 'Зезере',
  Vouga: 'Вога', Mira: 'Мира', Orb: 'Орб', Têt: 'Тет', Gers: 'Жер', Aveyron: 'Аверон', Moulouya: 'Мулуя', Chélif: 'Шелифф', Cheliff: 'Шелифф', Arga: 'Арга', Ega: 'Эга', Huerva: 'Уэрва', Guadalope: 'Гвадалопе', Mijares: 'Михарес',
  Cabriel: 'Кабриэль', Guadalimar: 'Гвадалимар', Guadiato: 'Гвадиато', Bidasoa: 'Бидасоа', Nervión: 'Нервьон', Ebre: 'Эбро', Tage: 'Тахо' };
const bare = n => n.replace(/^(r[íi]o|riu|rivi[èe]re|fleuve|oued|wadi|la|le|el|l')\s+/i, '').replace(/^(d[e']|du|des|de la)\s*/i, '').trim();
const KX = 111.195 * Math.cos(40 * Math.PI / 180) / 1e6, KY = 111.195 / 1e6;      // microdegrees → flat km
const rd = (name, what) => JSON.parse(gunzipSync(readFileSync(join(OUT_DIR, `${name}.${what}.json.gz`))));
const names = readdirSync(OUT_DIR).filter(f => f.endsWith('.rivers.json.gz')).map(f => f.slice(0, -'.rivers.json.gz'.length));
const key = (lon, lat) => lat * 33554432 + lon + 12e6;

// ---- ways, once each
const ways = new Map(); let banksRaw = [];
for (const n of names) { for (const w of rd(n, 'rivers')) if (!ways.has(w.id) && w.pts.length >= 4) ways.set(w.id, w); banksRaw = banksRaw.concat(rd(n, 'banks')); }
console.log(`${ways.size} river ways, ${banksRaw.length} bank lines from ${names.join(', ')}`);

// ---- reaches: ways cut where another way begins or ends
const ends = new Set();
for (const w of ways.values()) { const p = w.pts, n = p.length; ends.add(key(p[0], p[1])); ends.add(key(p[n - 2], p[n - 1])); }
const reaches = [];
for (const w of ways.values()) {
  const p = w.pts; let from = 0;
  for (let i = 2; i < p.length; i += 2) if (i === p.length - 2 || ends.has(key(p[i], p[i + 1]))) {
    const pts = p.slice(from, i + 2), xy = new Float64Array(pts.length); let len = 0;
    for (let j = 0; j < pts.length; j += 2) { xy[j] = pts[j] * KX; xy[j + 1] = pts[j + 1] * KY; if (j) len += Math.hypot(xy[j] - xy[j - 2], xy[j + 1] - xy[j - 1]); }
    if (len > 0) reaches.push({ w, pts, xy, len, a: key(pts[0], pts[1]), b: key(pts[pts.length - 2], pts[pts.length - 1]), acc: 0, up: [], down: [], chain: -1 });
    from = i;
  }
}
const starts = new Map(), stops = new Map(), push = (m, k, r) => { const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); };
for (const r of reaches) { push(starts, r.a, r); push(stops, r.b, r); }
for (const r of reaches) { r.up = stops.get(r.a) || []; r.down = (starts.get(r.b) || []).filter(d => d !== r); }
// ---- the water carried: km of river above the lower end of a reach
{
  const left = new Map(reaches.map(r => [r, r.up.length])), q = reaches.filter(r => !r.up.length); let done = 0;
  const settle = r => { let acc = 0; for (const u of r.up) acc += u.acc / Math.max(1, u.down.length); r.acc = r.len + acc; done++; for (const d of r.down) { const n = left.get(d) - 1; left.set(d, n); if (n === 0) q.push(d); } };
  for (let i = 0; i < q.length; i++) settle(q[i]);
  for (const r of reaches) if (left.get(r) > 0) { left.set(r, 0); q.push(r); for (let i = q.length - 1; i < q.length; i++) settle(q[i]); }   // rings: taken as they come
  console.log(`${reaches.length} reaches, ${done} settled; the most water: ${Math.round(Math.max(...reaches.map(r => r.acc)))} km of river above`);
}

// ---- the banks as short pieces in a grid of half a kilometre
const GC = .5, grid = new Map(), segs = [];
for (const b of banksRaw) for (let i = 2; i < b.length; i += 2) {
  const x0 = b[i - 2] * KX, y0 = b[i - 1] * KY, x1 = b[i] * KX, y1 = b[i + 1] * KY, id = segs.length / 4; segs.push(x0, y0, x1, y1);
  for (let gy = Math.floor(Math.min(y0, y1) / GC); gy <= Math.floor(Math.max(y0, y1) / GC); gy++) for (let gx = Math.floor(Math.min(x0, x1) / GC); gx <= Math.floor(Math.max(x0, x1) / GC); gx++) { const k = gx * 100003 + gy, a = grid.get(k); if (a) a.push(id); else grid.set(k, [id]); }
}
// width of the water across the river at (x, y), the river running along (dx, dy): km, or 0 when no banks are near
function across(x, y, dx, dy, reach = 1.25) {
  const nx = -dy, ny = dx; let lo = -1e9, hi = 1e9;
  const g0 = Math.floor((x - reach) / GC), g1 = Math.floor((x + reach) / GC), h0 = Math.floor((y - reach) / GC), h1 = Math.floor((y + reach) / GC);
  for (let gy = h0; gy <= h1; gy++) for (let gx = g0; gx <= g1; gx++) for (const id of grid.get(gx * 100003 + gy) || []) {
    const ax = segs[id * 4] - x, ay = segs[id * 4 + 1] - y, bx = segs[id * 4 + 2] - x, by = segs[id * 4 + 3] - y;
    const sa = ax * dx + ay * dy, sb = bx * dx + by * dy; if ((sa > 0) === (sb > 0)) continue;       // the piece does not cross the line drawn across the river
    const t = sa / (sa - sb), d = (ax + (bx - ax) * t) * nx + (ay + (by - ay) * t) * ny;
    if (d < 0) { if (d > lo) lo = d; } else if (d < hi) hi = d;
  }
  return lo > -reach && hi < reach ? hi - lo : 0;
}
// measure every 60 m or so along each reach
let measured = 0; const fitX = [], fitY = [];
for (const r of reaches) {
  const n = r.xy.length / 2; r.wm = new Float32Array(n); let since = 1e9, d = 0;
  for (let i = 0; i < n; i++) {
    if (i) { const s = Math.hypot(r.xy[i * 2] - r.xy[i * 2 - 2], r.xy[i * 2 + 1] - r.xy[i * 2 - 1]); since += s; d += s; }
    if (since < .06 || !segs.length) continue; since = 0;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = r.xy[b * 2] - r.xy[a * 2], dy = r.xy[b * 2 + 1] - r.xy[a * 2 + 1]; const l = Math.hypot(dx, dy); if (!l) continue;
    const w = across(r.xy[i * 2], r.xy[i * 2 + 1], dx / l, dy / l);
    if (w > .003) { r.wm[i] = w; measured++; if (measured % 7 === 0) { fitX.push(Math.log(r.acc - r.len + d + 1)); fitY.push(Math.log(w)); } }
  }
}
// The rule for everything not measured: width = A · (km of river above)^B — a river with 10 km of water above it is
// 7 m wide, with 100 km 21 m, with 1 000 km 66 m, with 10 000 km 210 m. Only the larger rivers have outlines in
// OpenStreetMap, so a rule fitted to the measured widths alone would make every brook too wide; the measured
// widths are used where they are, and each river sets the rule's scale for its own unmeasured stretches.
const A = .0021, Bx = .5, rule = acc => Math.max(.003, A * (acc + 1) ** Bx);
{ const r = fitX.map((x, i) => Math.exp(fitY[i]) / rule(Math.exp(x) - 1)).sort((a, b) => a - b);
  console.log(`${measured} widths measured across the water; against the rule they are ×${(r[r.length >> 2] || 0).toFixed(2)} … ×${(r[r.length >> 1] || 0).toFixed(2)} … ×${(r[(r.length * 3) >> 2] || 0).toFixed(2)} (quartiles)`); }

// ---- rivers: reaches strung along the main stem
for (const r of reaches) r.main = r.up.length ? r.up.reduce((a, b) => (b.acc > a.acc ? b : a)) : null;       // which reach above carries on into this one
const follows = new Map(); for (const r of reaches) if (r.main && !follows.has(r.main)) follows.set(r.main, r);   // … and each reach carries on into one below at most
const chains = [];
for (const r of reaches) {
  if (r.main && follows.get(r.main) === r) continue;                // not a beginning
  const parts = []; for (let c = r; c && c.chain < 0; c = follows.get(c)) { c.chain = chains.length; parts.push(c); }
  if (parts.length) chains.push(parts);
}
const smoothW = (w, at, span) => { const out = new Float32Array(w.length); let a = 0, b = 0, sum = 0; for (let i = 0; i < w.length; i++) { while (b < w.length && at[b] <= at[i] + span) sum += w[b++]; while (at[a] < at[i] - span) sum -= w[a++]; out[i] = sum / (b - a); } return out; };
function thin(xy, w, tol) {                                         // Douglas–Peucker; the tolerance follows the width
  const n = xy.length / 2, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop(); if (b - a < 2) continue;
    const ax = xy[a * 2], ay = xy[a * 2 + 1], dx = xy[b * 2] - ax, dy = xy[b * 2 + 1] - ay, l2 = dx * dx + dy * dy || 1e-12; let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) { const px = xy[i * 2] - ax, py = xy[i * 2 + 1] - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2)), d = Math.hypot(px - dx * t, py - dy * t) / tol(w[i]); if (d > worst) { worst = d; wi = i; } }
    if (worst > 1) { keep[wi] = 1; st.push([a, wi], [wi, b]); }
  }
  return keep;
}
// A wide river is often drawn with a few long straight strokes down the middle of its water. Its line is made finer
// and then evened out over a little more than its own width, so the corners become bends; a narrow river, whose
// line already follows every loop, is left as it is. The ends stay where they are: rivers meet there.
function relax(xy, w, at) {
  const n = w.length; let wide = 0; for (let i = 0; i < n; i++) if (w[i] > wide) wide = w[i];
  if (wide < .03) return { xy, w };
  const X = [], Y = [], W = [], Dd = [];
  for (let i = 0; i < n; i++) {
    X.push(xy[i * 2]); Y.push(xy[i * 2 + 1]); W.push(w[i]); Dd.push(at[i]);
    if (i < n - 1) { const seg = at[i + 1] - at[i], k = Math.min(400, Math.floor(seg / Math.max(.02, w[i] * .5)));
      for (let j = 1; j <= k; j++) { const t = j / (k + 1); X.push(xy[i * 2] + (xy[i * 2 + 2] - xy[i * 2]) * t); Y.push(xy[i * 2 + 1] + (xy[i * 2 + 3] - xy[i * 2 + 1]) * t); W.push(w[i] + (w[i + 1] - w[i]) * t); Dd.push(at[i] + seg * t); } }
  }
  const m = X.length, ox = new Float64Array(m * 2), ow = new Float32Array(m), px = new Float64Array(m + 1), py = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) { px[i + 1] = px[i] + X[i]; py[i + 1] = py[i] + Y[i]; }
  for (let pass = 0, a = 0, b = 0; pass < 1; pass++) for (let i = 0; i < m; i++) {
    const half = Math.min(W[i] * 1.3, Dd[i] - Dd[0], Dd[m - 1] - Dd[i]);
    while (b < m && Dd[b] <= Dd[i] + half) b++; while (Dd[a] < Dd[i] - half) a++;
    const c = Math.max(1, b - a); ox[i * 2] = half > 0 ? (px[b] - px[a]) / c : X[i]; ox[i * 2 + 1] = half > 0 ? (py[b] - py[a]) / c : Y[i]; ow[i] = W[i];
  }
  return { xy: ox, w: ow };
}
const out = []; let nPts = 0, nRaw = 0, km = 0;
for (const parts of chains) {
  const lon = [], lat = [], wRaw = [], at = [], seen = []; let d = 0, im = 0, len = 0; const byName = new Map();
  for (const r of parts) {
    const n = r.pts.length / 2, a0 = r.acc - r.len; let dd = 0;
    byName.set(`${r.w.name}|${r.w.ru}`, (byName.get(`${r.w.name}|${r.w.ru}`) || 0) + r.len); if (r.w.im) im += r.len; len += r.len;
    for (let i = lon.length ? 1 : 0; i < n; i++) {
      if (i) { const s = Math.hypot(r.xy[i * 2] - r.xy[i * 2 - 2], r.xy[i * 2 + 1] - r.xy[i * 2 - 1]); dd += s; d += s; }
      lon.push(r.pts[i * 2]); lat.push(r.pts[i * 2 + 1]); at.push(d); wRaw.push(rule(a0 + dd)); seen.push(r.wm[i]);
    }
  }
  nRaw += lon.length;
  const last = parts[parts.length - 1], joins = last.down.length > 0;
  if (len < 4 && !(joins && len > 1.5)) continue;                    // a stub
  // measured widths, carried over the gaps between measurements; where none is near, the rule
  const w = new Float32Array(lon.length); let prev = -1;
  for (let i = 0; i < w.length; i++) if (seen[i] > 0) { if (prev >= 0 && at[i] - at[prev] < .4) for (let j = prev + 1; j < i; j++) w[j] = seen[prev] + (seen[i] - seen[prev]) * (at[j] - at[prev]) / (at[i] - at[prev]); w[i] = seen[i]; prev = i; }
  // how this river does against the rule where it was measured: the same holds for its stretches that were not
  // a pond, a weir or a mill race drawn as river water is a short wide spot: the middle width of the two kilometres
  // around a point is the river's, the spot is not
  { const got = []; for (let i = 0; i < w.length; i++) if (w[i] > 0) got.push(i);
    const med = new Float32Array(got.length);
    for (let g = 0, a = 0, b = 0; g < got.length; g++) { while (at[got[a]] < at[got[g]] - 1) a++; while (b < got.length && at[got[b]] <= at[got[g]] + 1) b++; const win = []; for (let j = a; j < b; j++) win.push(w[got[j]]); win.sort((p, q) => p - q); med[g] = win[win.length >> 1]; }
    for (let g = 0; g < got.length; g++) w[got[g]] = Math.min(w[got[g]], med[g] * 1.25); }
  const ratios = []; for (let i = 0; i < w.length; i++) if (w[i] > 0) ratios.push(Math.min(w[i], Math.max(.02, wRaw[i] * 4)) / wRaw[i]);
  ratios.sort((a, b) => a - b); const kRiver = ratios.length >= 8 ? Math.max(.5, Math.min(2.5, ratios[ratios.length >> 1])) : 1;
  for (let i = 0; i < w.length; i++) if (!(w[i] > 0)) w[i] = wRaw[i] * kRiver; else w[i] = Math.min(w[i], Math.max(.02, wRaw[i] * 4));   // a bay or a lake taken for a river is not four times the rule
  const xy0 = new Float64Array(lon.length * 2); for (let i = 0; i < lon.length; i++) { xy0[i * 2] = lon[i] * KX; xy0[i * 2 + 1] = lat[i] * KY; }
  const { xy, w: ws } = relax(xy0, smoothW(w, at, .4), at);
  const keep = thin(xy, ws, wi => Math.max(.009, Math.min(.03, wi * .25)));
  const nm = [...byName].sort((a, b) => b[1] - a[1])[0][0].split('|');
  let ruName = nm[1]; if (!ruName) for (const [k] of byName) { const q = k.split('|'); if (q[0] === nm[0] && q[1]) { ruName = q[1]; break; } }
  const c = { lon: [], lat: [], w: [], name: nm[0], ru: ruName || RU[bare(nm[0])] || '', flags: (im > len * .5 ? 1 : 0) | (joins ? 2 : 0) | (parts[0].up.length ? 4 : 0), acc: last.acc };
  for (let i = 0; i < ws.length; i++) if (keep[i]) { c.lon.push(Math.round(xy[i * 2] / KX / 10)); c.lat.push(Math.round(xy[i * 2 + 1] / KY / 10)); c.w.push(ws[i]); }
  // only what lies in the region; a line that leaves it is cut there
  let run = null; const flush = () => { if (run && run.lon.length > 2) { out.push(run); nPts += run.lon.length; } run = null; };
  for (let i = 0; i < c.lon.length; i++) {
    const inside = c.lon[i] > BBOX_M.lon0 && c.lon[i] < BBOX_M.lon1 && c.lat[i] > BBOX_M.lat0 && c.lat[i] < BBOX_M.lat1;
    if (!inside) { flush(); continue; }
    if (!run) run = { lon: [], lat: [], w: [], name: c.name, ru: c.ru, flags: c.flags, acc: c.acc };
    if (run.lon.length && (Math.abs(c.lon[i] - run.lon[run.lon.length - 1]) > 32000 || Math.abs(c.lat[i] - run.lat[run.lat.length - 1]) > 32000)) { flush(); run = { lon: [], lat: [], w: [], name: c.name, ru: c.ru, flags: c.flags, acc: c.acc }; }
    run.lon.push(c.lon[i]); run.lat.push(c.lat[i]); run.w.push(c.w[i]);
  }
  flush(); km += len;
}
// ---- the file
const gz = gzipSync(Buffer.from(encodeCourses(out, { source: '© OpenStreetMap contributors, ODbL 1.0', rule: [A, Bx] })), { level: 9 });
mkdirSync(join(ROOT, 'public', 'assets', 'album', 'water'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'assets', 'album', 'water', 'rivers.bin.gz'), gz);
const wide = out.filter(c => Math.max(...c.w) >= .1).length;
console.log(`${chains.length} rivers strung, ${out.length} kept (${wide} reach 100 m of width), ${Math.round(km)} km, ${nRaw} points thinned to ${nPts} → rivers.bin.gz ${(gz.length / 1e6).toFixed(2)} MB`);
