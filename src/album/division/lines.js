// The borders of the lands as lines laid on the ground (the ribbons of layers/ribbon.js, like rivers and roads): clear
// and of steady width in pixels at any height, with no grain. Up close the ground shader draws the borders itself,
// exactly on the outline of the chunks; from higher up these lines take over (division/runtime.js fades one into the
// other).
// Every border is taken from the fine raster of chunks (ch.cell, cells of 1.25 km): the sides of cells whose chunks
// lie in different districts, chained into lines, evened out (a running mean over a few km takes the steps of the
// cells away), rounded off (Chaikin) and thinned (Douglas–Peucker). A side gets
// the highest level it divides: a region border is not drawn again as a province border. The shore is not a border.
import { FN, FKM, llOf } from '../chunks.js';
import { BBOX, KM_PER_DEG, COS_REF } from '../geo.js';
import { makeRibbons } from '../layers/ribbon.js';
import { LAND } from './build.js';

const X0 = -880, Y0 = 3880;
// levels: 0 district, 1 province, 2 region, 3 state; water: 0 land, 1 sea
// → { [level * 2 + water]: [[x, y] km …][] }
// rivers: [{ pts: [[lon, lat], …] }] — a border that runs beside a river is laid on the river itself
export function borderLines(ch, div, state = null, rivers = null) {
  const n = FN * FN, cell = ch.cell, out = {}, cells = div.cells, snap = riverSnapper(rivers);
  const d = new Int32Array(n), wet = new Uint8Array(n), st = new Uint8Array(n);
  for (let t = 0; t < n; t++) { const k = cell[t]; d[t] = cells && cells[t] >= 0 ? cells[t] : div.district[k]; wet[t] = div.kind[k] === LAND ? 0 : 1; st[t] = state && state[k] ? 1 : 0; }
  const P = div.province, R = div.region;
  // the sides of cells, grouped by (level, water): vertical sides at x + 1 between (x, y) and (x + 1, y), horizontal
  // at y + 1 between (x, y) and (x, y + 1); corners numbered y × (FN + 1) + x
  const groups = new Map();
  const add = (key, a, b) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(a, b); };
  const V = FN + 1;
  for (let y = 0; y < FN; y++) for (let x = 0; x < FN; x++) {
    const t = y * FN + x;
    for (let s = 0; s < 2; s++) {
      if (s ? y >= FN - 1 : x >= FN - 1) continue;
      const m = s ? t + FN : t + 1, a = s ? (y + 1) * V + x : y * V + x + 1, b = s ? (y + 1) * V + x + 1 : (y + 1) * V + x + 1;
      if (state && st[t] !== st[m] && (!wet[t] || !wet[m])) add(6, a, b);                       // the state, along its shore too
      if (d[t] === d[m] || wet[t] !== wet[m]) continue;                                         // the shore is not a border
      const level = R[P[d[t]]] !== R[P[d[m]]] ? 2 : P[d[t]] !== P[d[m]] ? 1 : 0;
      add(level * 2 + wet[t], a, b);
    }
  }
  // the higher the level, the farther it is seen from and the more its line is evened out: regions as neat as provinces
  const reach = { 0: 2, 1: 2, 2: 3, 3: 3, 4: 4, 5: 4, 6: 4 };
  for (const [key, segs] of groups) out[key] = chain(segs).map(line => thin(smooth(line.map(v => [X0 + (v % V) * FKM, Y0 + Math.floor(v / V) * FKM]), reach[key], key % 2 === 0 ? snap : null), .1));
  return out;
}

// Where a border of the land runs beside a river, it lies on the river: the nearest point of a river no farther than
// reach km. The same point always goes to the same place, so lines that meet still meet.
export function riverSnapper(rivers, reach = 1.9) {
  if (!rivers || !rivers.length) return null;
  const G = 2.5, grid = new Map(), segs = [], KX = KM_PER_DEG * COS_REF, KY = KM_PER_DEG;
  for (const rv of rivers) for (let i = 1; i < rv.pts.length; i++) {
    const ax = rv.pts[i - 1][0] * KX, ay = rv.pts[i - 1][1] * KY, bx = rv.pts[i][0] * KX, by = rv.pts[i][1] * KY, id = segs.length / 4; segs.push(ax, ay, bx, by);
    for (let gy = Math.floor((Math.min(ay, by) - reach) / G); gy <= Math.floor((Math.max(ay, by) + reach) / G); gy++)
      for (let gx = Math.floor((Math.min(ax, bx) - reach) / G); gx <= Math.floor((Math.max(ax, bx) + reach) / G); gx++) { const k = gx * 100003 + gy, a = grid.get(k); if (a) a.push(id); else grid.set(k, [id]); }
  }
  return p => {
    let bd = reach * reach, qx = p[0], qy = p[1];
    for (const id of grid.get(Math.floor(p[0] / G) * 100003 + Math.floor(p[1] / G)) || []) {
      const ax = segs[id * 4], ay = segs[id * 4 + 1], dx = segs[id * 4 + 2] - ax, dy = segs[id * 4 + 3] - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)) : 0, x = ax + dx * t, y = ay + dy * t, dd = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (dd < bd) { bd = dd; qx = x; qy = y; }
    }
    return [qx, qy];
  };
}

// sides into lines: walk from the ends and the forks, then what is left are rings
function chain(segs) {
  const adj = new Map();
  for (let i = 0; i < segs.length; i += 2) for (const [a, b] of [[segs[i], segs[i + 1]], [segs[i + 1], segs[i]]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  const used = new Set(), key = (a, b) => (a < b ? a * 2e6 + b : b * 2e6 + a), lines = [];
  const walk = (a, b) => {
    const line = [a, b]; used.add(key(a, b));
    for (;;) {
      const nb = adj.get(b); if (nb.length !== 2) break;
      const c = nb[0] === a ? nb[1] : nb[0]; if (used.has(key(b, c))) break;
      used.add(key(b, c)); line.push(c); a = b; b = c;
    }
    return line;
  };
  for (const [v, nb] of [...adj].sort((p, q) => p[0] - q[0])) if (nb.length !== 2) for (const w of nb) if (!used.has(key(v, w))) lines.push(walk(v, w));
  for (const [v, nb] of [...adj].sort((p, q) => p[0] - q[0])) for (const w of nb) if (!used.has(key(v, w))) lines.push(walk(v, w));
  return lines;
}
// a running mean over ±r corners (1.25 km apart), twice, then Chaikin corner cutting; the ends stay (they meet other
// lines)
// snap: after the mean, every point goes where snap sends it (onto a river), before the corners are cut
function smooth(p, r = 2, snap = null) {
  const ring = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1], n = p.length;
  for (let it = 0; it < 2 && n > 4; it++) {
    const q = p.map(v => v.slice());
    for (let i = ring ? 0 : 1; i < (ring ? n - 1 : n - 1); i++) {
      let sx = 0, sy = 0, c = 0;
      for (let j = -r; j <= r; j++) {
        let m = i + j;
        if (ring) m = ((m % (n - 1)) + (n - 1)) % (n - 1); else if (m < 0 || m >= n) continue;
        sx += p[m][0]; sy += p[m][1]; c++;
      }
      q[i] = [sx / c, sy / c];
    }
    if (ring) q[n - 1] = q[0];
    p = q;
  }
  if (snap) { p = p.map(snap); p = p.filter((v, i) => !i || v[0] !== p[i - 1][0] || v[1] !== p[i - 1][1]); }
  for (let r = 0; r < 2 && p.length > 2; r++) {
    const ring = p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1], q = ring ? [] : [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); }
    if (ring) q.push(q[0]); else q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
// Douglas–Peucker, tolerance in km
function thin(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol * tol;
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const t = L ? Math.max(0, Math.min(1, ((p[i][0] - ax) * dx + (p[i][1] - ay) * dy) / L)) : 0;
      const dd = (p[i][0] - ax - dx * t) ** 2 + (p[i][1] - ay - dy * t) ** 2; if (dd > bd) { bd = dd; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return p.filter((_, i) => keep[i]);
}

// what each kind of line looks like: width km, at least pixels; colours for the light paper and for the natural land
const STYLE = {
  // (thin on the ground, so that from the lowest height a line is still a line and not a band)
  0: { w: .02, px: 1.4, ink: 0x584634, light: 0xeee4cc }, 1: { w: .015, px: 1, ink: 0x4c6a8c, light: 0xb8cce4 },
  2: { w: .035, px: 2, ink: 0x3a2a20, light: 0xfff2d4 }, 3: { w: .025, px: 1.4, ink: 0x2c4a70, light: 0xcfe0f4 },
  4: { w: .06, px: 3, ink: 0x24160e, light: 0xfff6e0 }, 5: { w: .04, px: 2, ink: 0x22406a, light: 0xdce8f8 },
  6: { w: .07, px: 3.4, ink: 0x7a1410, light: 0xc0201a },
};
const inside = ([lon, lat]) => lat > BBOX.lat0 - .1 && lat < BBOX.lat1 + .1 && lon > BBOX.lon0 - .1 && lon < BBOX.lon1 + .1;

// the meshes of all lines; set(alpha per key, look) each frame
export function createLines(album, ch, div, state, rivers = null) {
  const groups = borderLines(ch, div, state, rivers), meshes = {};
  for (const [key, lines] of Object.entries(groups)) {
    const s = STYLE[key], list = [];
    for (const line of lines) {
      const ll = line.map(([x, y]) => { const p = llOf(x, y); return [p.lon, p.lat]; });
      // the album shows nothing beyond its region: cut a line where it leaves it
      let part = [];
      for (const q of ll) { if (inside(q)) part.push(q); else { if (part.length > 1) list.push(part); part = []; } }
      if (part.length > 1) list.push(part);
    }
    if (!list.length) continue;
    const rib = makeRibbons(album, list.map(pts => ({ pts, width: s.w, kind: 0 })), { colour: s.ink, minPx: s.px, lift: .006 });
    rib.mesh.renderOrder = 6; meshes[key] = { ...rib, style: s };
  }
  return {
    update(cam, dom, alpha, look) {
      const light = look !== 'paper' && look !== 'atlas';
      for (const [key, m] of Object.entries(meshes)) {
        const a = alpha[key] || 0;
        m.mesh.visible = a > .01; if (!m.mesh.visible) continue;
        m.setPx(cam, dom); m.u.uAlpha.value = a; m.u.uColour.value.set(light ? m.style.light : m.style.ink);
      }
    },
    dispose() { for (const m of Object.values(meshes)) { album.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); } },
    count: Object.values(groups).reduce((s, g) => s + g.length, 0),
  };
}
