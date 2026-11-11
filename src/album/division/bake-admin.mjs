// Bakes the outlines of the modern provinces, districts and départements around the album (Natural Earth admin-1,
// public domain) into public/assets/album/division/admin.json. The division uses them only as a hint of which land a
// chunk leans to (docs/album/division.md): the exact border is drawn by the relief.
//   node src/album/division/bake-admin.mjs [path/to/ne_10m_admin_1_states_provinces.geojson]
// Without a path it takes data/raw/ of the main checkout (scripts/regions/download.mjs downloads it there).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const main = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n')[0].slice(9).trim();
const SRC = process.argv[2] || [join(ROOT, 'data/raw/ne_10m_admin_1_states_provinces.geojson'), join(main, 'data/raw/ne_10m_admin_1_states_provinces.geojson')].find(existsSync);
if (!SRC) { console.error('no Natural Earth admin-1 file (scripts/regions/download.mjs)'); process.exit(1); }
const B = { lon0: -10.4, lon1: 4.9, lat0: 34.9, lat1: 45.1 };      // the album region and a little more
const TOL = .006;                                                   // simplification, degrees (≈ 0.6 km)

// Douglas–Peucker on a closed ring
function simplify(pts, tol) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol * tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i], t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const d = (px - ax - dx * t) ** 2 + (py - ay - dy * t) ** 2; if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r3 = v => Math.round(v * 1000) / 1000;

const g = JSON.parse(readFileSync(SRC, 'utf8')), units = {};
for (const f of g.features) {
  const p = f.properties, polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer.some(([x, y]) => x > B.lon0 && x < B.lon1 && y > B.lat0 && y < B.lat1)) continue;
    const s = simplify(outer, TOL); if (s.length >= 4) rings.push(s.map(([x, y]) => [r3(x), r3(y)]));
  }
  if (rings.length) units[p.adm1_code] = { name: p.name_ru || p.name, country: p.iso_a2, rings };
}
const out = join(ROOT, 'public/assets/album/division/admin.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: 'Natural Earth 1:10m admin-1 states and provinces (public domain), simplified', units }));
console.log(`${Object.keys(units).length} units → ${out} (${(JSON.stringify(units).length / 1024).toFixed(0)} KB)`);
