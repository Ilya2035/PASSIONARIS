// Bakes the natural lakes of the graphics album (docs/album/water.md) into public/assets/album/water/lakes.json.
// Natural Earth has no natural lake in this region (its one "lake" here is the Valdecañas reservoir), so the list is
// our own: names, places, water levels and depths typed in below from general geographic knowledge, outlines traced
// from the open height data of the album (AWS Terrain Tiles): the basin around each lake is filled up to its water
// level and the shore of that pool is the outline. Reservoirs are left out: in 5000 BC there were none.
//   node scripts/album/water-lakes.mjs [--print]      (needs public/album-data/, see scripts/album/fetch-data.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DATA = join(ROOT, 'public', 'album-data'), OUT = join(ROOT, 'public', 'assets', 'album', 'water');
const KM = 111.195, D = Math.PI / 180;

// level: metres above the sea of the bottom of the basin in the height data (null = the height at the centre); rise:
// how far above that the pool is filled, which gives the shore and the height of the water; r: radius of the search,
// km; depth: greatest depth, metres; salt: a salt lagoon;
// since: the year the lake appeared (negative = BC) when it is younger than the album's 5000 BC, else omitted;
// oval: [half-length km, half-width km, turn from east in degrees] — a lake too small for the 230 m height data is
// drawn as an uneven oval of its real size instead of being traced
export const LAKES = [
  { id: 'sanabria', name: 'Озеро Санабрия', lat: 42.123, lon: -6.716, level: 1000, oval: [1.65, .74, 8], depth: 51, note: 'ледниковое, самое большое естественное озеро полуострова' },
  { id: 'banyoles', name: 'Озеро Баньолес', lat: 42.126, lon: 2.755, level: null, rise: 2.5, r: 2.5, depth: 46, note: 'карстовое' },
  { id: 'gallocanta', name: 'Лагуна Гальоканта', lat: 40.972, lon: -1.502, level: null, rise: 1.6, r: 9, depth: 2.5, salt: 1, note: 'бессточная солёная лагуна на плоскогорье' },
  { id: 'fuente-piedra', name: 'Лагуна Фуэнте-де-Пьедра', lat: 37.108, lon: -4.77, level: null, rise: 1.2, r: 7, depth: 1.5, salt: 1, note: 'бессточная солёная лагуна' },
  { id: 'antela', name: 'Лагуна Антела', lat: 42.105, lon: -7.715, level: 614.6, rise: 1.6, r: 9, depth: 3, note: 'осушена в 1958 г.; в 5000 г. до н. э. была' },
  { id: 'nava', name: 'Лагуна Ла-Нава', lat: 42.055, lon: -4.745, level: 736.5, rise: .95, r: 8, depth: 2, note: 'осушена в XX веке; в 5000 г. до н. э. была' },
  { id: 'janda', name: 'Лагуна Ла-Ханда', lat: 36.255, lon: -5.86, level: 2.6, rise: 2.2, r: 10, depth: 3, note: 'осушена в 1960-х; в 5000 г. до н. э. была' },
  { id: 'villafafila', name: 'Лагуны Вильяфафилы', lat: 41.83, lon: -5.607, level: null, rise: 1.4, r: 4, depth: 1.5, salt: 1, note: 'солёные степные лагуны' },
  { id: 'cazaux', name: 'Озеро Казо и Сангине', lat: 44.49, lon: -1.16, level: null, rise: 1.2, r: 10, depth: 23, since: -1000, note: 'подпружено дюнами Ландов; моложе 5000 г. до н. э.' },
  { id: 'biscarrosse', name: 'Озеро Бискаррос и Парантис', lat: 44.345, lon: -1.175, level: null, rise: 1.2, r: 9, depth: 20, since: -1000, note: 'подпружено дюнами Ландов; моложе 5000 г. до н. э.' },
];

const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')), b = meta.base;
const buf = gunzipSync(readFileSync(join(DATA, b.file))), raw = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const n2 = 2 ** b.z, rect = [b.x0 / n2, b.y0 / n2, n2 * 256 / b.w, n2 * 256 / b.h];
const mercX = lon => (lon + 180) / 360, mercY = lat => { const r = lat * D; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
const heightAt = (lat, lon) => {
  const x = Math.max(0, Math.min(b.w - 1.001, (mercX(lon) - rect[0]) * rect[2] * b.w - .5)), y = Math.max(0, Math.min(b.h - 1.001, (mercY(lat) - rect[1]) * rect[3] * b.h - .5));
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * b.w + i;
  return ((raw[k] * (1 - fx) + raw[k + 1] * fx) * (1 - fy) + (raw[k + b.w] * (1 - fx) + raw[k + b.w + 1] * fx) * fy) / 4 - 8192;
};

// the pool around (lat, lon) filled to `top` metres: its outline as a ring of [lon, lat], and its area in km²
function oval(lake) {
  const [a, b, turn] = lake.oval, c = Math.cos(lake.lat * D), ca = Math.cos(turn * D), sa = Math.sin(turn * D), ring = [];
  for (let i = 0; i < 72; i++) {
    const t = i / 72 * 2 * Math.PI, k = 1 + .09 * Math.sin(3 * t + 1.1) + .06 * Math.sin(5 * t + 4) + .04 * Math.sin(8 * t + 2.2), x = a * k * Math.cos(t), y = b * k * Math.sin(t) * (1 + .25 * Math.cos(t));
    ring.push([Math.round((lake.lon + (x * ca - y * sa) / (KM * c)) * 1e5) / 1e5, Math.round((lake.lat + (x * sa + y * ca) / KM) * 1e5) / 1e5]);
  }
  return { ring, area: Math.PI * a * b, level: lake.level };
}
function trace(lake) {
  const step = Math.max(.04, lake.r / 90), N = Math.ceil(lake.r / step) * 2 + 1, c = Math.cos(lake.lat * D), half = (N - 1) / 2;
  const ll = (i, j) => [lake.lon + (i - half) * step / (KM * c), lake.lat + (half - j) * step / KM];
  const level = lake.level ?? heightAt(lake.lat, lake.lon), top = level + lake.rise;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const p = ll(i, j); h[j * N + i] = heightAt(p[1], p[0]); }
  // flood from the centre over cells below the top (and above the sea: a lagoon stops at the coast)
  const inside = new Uint8Array(N * N), stack = [Math.round(half) * N + Math.round(half)];
  const ok = k => h[k] <= top && h[k] > -.5;
  if (!ok(stack[0])) throw new Error(`${lake.id}: the centre is not under water at ${top.toFixed(1)} m (height there ${h[stack[0]].toFixed(1)})`);
  inside[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % N, j = (k / N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = i + di, y = j + dj, m = y * N + x;
      if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || inside[m] || !ok(m) || Math.hypot(x - half, y - half) * step > lake.r) continue;
      inside[m] = 1; stack.push(m);
    }
  }
  // the shore: every side of an inside cell that faces an outside cell, as a step from corner to corner (clockwise
  // around the cell); the steps chain into closed loops, the longest loop is the outer shore (islands are dropped)
  const at = (i, j) => (i >= 0 && j >= 0 && i < N && j < N ? inside[j * N + i] : 0), W = N + 1, from = new Map();
  const edge = (ax, ay, bx, by) => { const k = ay * W + ax; if (!from.has(k)) from.set(k, []); from.get(k).push(by * W + bx); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!inside[j * N + i]) continue;
    if (!at(i, j - 1)) edge(i, j, i + 1, j); if (!at(i + 1, j)) edge(i + 1, j, i + 1, j + 1);
    if (!at(i, j + 1)) edge(i + 1, j + 1, i, j + 1); if (!at(i - 1, j)) edge(i, j + 1, i, j);
  }
  let ring = [];
  for (const k0 of [...from.keys()]) {
    const loop = []; let k = k0;
    while (from.get(k)?.length) { loop.push([k % W - .5, ((k / W) | 0) - .5]); k = from.get(k).pop(); if (k === k0) break; }
    if (loop.length > ring.length) ring = loop;
  }
  // smooth the staircase (three rounds of averaging with the neighbours), thin it out, turn to degrees
  let pts = ring;
  for (let r = 0; r < 3; r++) pts = pts.map((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], c2 = pts[(i + 1) % pts.length]; return [(a[0] + 2 * p[0] + c2[0]) / 4, (a[1] + 2 * p[1] + c2[1]) / 4]; });
  const keep = Math.max(1, Math.round(pts.length / 110)), out = pts.filter((_, i) => i % keep === 0).map(p => { const q = ll(p[0], p[1]); return [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]; });
  let area = 0; for (let k = 0; k < N * N; k++) area += inside[k];
  return { ring: out, area: area * step * step, level: Math.round(top * 10) / 10, N, inside };
}

const lakes = [];
for (const lake of LAKES) {
  const t = lake.oval ? oval(lake) : trace(lake);
  console.log(`${lake.id.padEnd(14)} level ${String(t.level).padStart(7)} m  area ${t.area.toFixed(1).padStart(6)} km²  ${t.ring.length} points`);
  if (process.argv.includes('--print') && t.inside) { const s = Math.ceil(t.N / 70); for (let j = 0; j < t.N; j += s * 2) { let row = ''; for (let i = 0; i < t.N; i += s) row += t.inside[j * t.N + i] ? '#' : '.'; console.log(row); } }
  const { r, rise, level, oval: _, ...rest } = lake;
  lakes.push({ ...rest, level: t.level, area: Math.round(t.area * 10) / 10, ring: t.ring });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'lakes.json'), JSON.stringify({ about: 'Natural lakes of the album region, 5000 BC. Own list; outlines traced from AWS Terrain Tiles heights by scripts/album/water-lakes.mjs.', lakes }));
console.log(`→ ${join(OUT, 'lakes.json')}: ${lakes.length} lakes`);
