// The borders of the lands as lines laid on the ground (the ribbons of layers/ribbon.js, like rivers and roads): clear
// and of steady width in pixels at any height, with no grain. Up close the ground shader draws the borders itself,
// exactly on the outline of the chunks; from higher up these lines take over (division/runtime.js fades one into the
// other).
// Every border is taken from the fine raster of chunks (ch.cell, cells of 1.25 km): the sides of cells whose chunks
// lie in different districts, chained into lines, evened out (a running mean over a few km takes the steps of the
// cells away), rounded off (Chaikin) and thinned (Douglas–Peucker). A side gets
// the highest level it divides: a region border is not drawn again as a province border. The shore is not a border.
import { FN, FKM, llOf } from '../chunks.js';
import { BBOX } from '../geo.js';
import { makeRibbons } from '../layers/ribbon.js';
import { LAND } from './build.js';

const X0 = -880, Y0 = 3880;
// levels: 0 district, 1 province, 2 region, 3 state; water: 0 land, 1 sea
// → { [level * 2 + water]: [[x, y] km …][] }
export function borderLines(ch, div, state = null) {
  const n = FN * FN, cell = ch.cell, out = {};
  const d = new Int32Array(n), wet = new Uint8Array(n), st = new Uint8Array(n);
  for (let t = 0; t < n; t++) { const k = cell[t]; d[t] = div.district[k]; wet[t] = div.kind[k] === LAND ? 0 : 1; st[t] = state && state[k] ? 1 : 0; }
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
  for (const [key, segs] of groups) out[key] = chain(segs).map(line => thin(smooth(line.map(v => [X0 + (v % V) * FKM, Y0 + Math.floor(v / V) * FKM]), reach[key]), .1));
  return out;
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
function smooth(p, r = 2) {
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
  0: { w: .12, px: 1.3, ink: 0x584634, light: 0xeee4cc }, 1: { w: .08, px: 1, ink: 0x4c6a8c, light: 0xb8cce4 },
  2: { w: .22, px: 1.9, ink: 0x3a2a20, light: 0xfff2d4 }, 3: { w: .16, px: 1.4, ink: 0x2c4a70, light: 0xcfe0f4 },
  4: { w: .45, px: 3, ink: 0x24160e, light: 0xfff6e0 }, 5: { w: .3, px: 2, ink: 0x22406a, light: 0xdce8f8 },
  6: { w: .55, px: 3.4, ink: 0x7a1410, light: 0xc0201a },
};
const inside = ([lon, lat]) => lat > BBOX.lat0 - .1 && lat < BBOX.lat1 + .1 && lon > BBOX.lon0 - .1 && lon < BBOX.lon1 + .1;

// the meshes of all lines; set(alpha per key, look) each frame
export function createLines(album, ch, div, state) {
  const groups = borderLines(ch, div, state), meshes = {};
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
