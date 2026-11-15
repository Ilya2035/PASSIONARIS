// The borders of the lands as lines laid on the ground (the ribbons of layers/ribbon.js, like rivers and roads): clear
// and of steady width in pixels at any height, with no grain.
// The lines themselves are worked out once with the division (border.js): the same lines fill the districts in the
// shader, light up the one under the cursor and say which district a chunk belongs to. Here they become ribbons: the
// borders of every level, the outline of the district under the cursor and of the chosen one, and the border of a state
// of history (along the shore too).
import { llOf } from '../chunks.js';
import { KN as FN, KKM as FKM, KX0 as X0, KY0 as Y0 } from './km.js';
import { BBOX } from '../geo.js';
import { makeRibbons } from '../layers/ribbon.js';
import { LAND } from './build.js';
import { chainSides, smoothLabelled, riverSnapper, outlineOf, REACH } from './border.js';

export { riverSnapper };
const V = FN + 1;
const cornerXY = c => [X0 + (c % V) * FKM, Y0 + Math.floor(c / V) * FKM];

// levels: 0 district, 1 province, 2 region, 3 state; water: 0 land, 1 sea
// → { [level * 2 + water]: [[x, y] km …][] }
// state: one byte a natural cell, 1 inside the state shown (build.js stateMask); rivers: as for the division (the
// lines of the division were laid on them already, border.js)
export function borderLines(ch, div, state = null, rivers = null) {
  const out = {};
  for (const L of div.geo.lines) (out[L.key] || (out[L.key] = [])).push(L.pts);
  if (state) out[6] = stateLines(div, state, rivers);
  return out;
}

// The border of a state of history: on land the pieces of the lines with the state on one side only; along the shore
// the sides of squares between its land and the water, chained and evened out, ending where a land line meets the shore.
function stateLines(div, state, rivers) {
  const inState = new Uint8Array(div.count);
  for (let d = 0; d < div.count; d++) inState[d] = state[div.chunks[d][0]] ? 1 : 0;
  const out = [], ends = new Set();
  for (const L of div.geo.lines) {
    let run = null;
    for (let j = 0; j < L.labs.length; j++) {
      const l = L.labs[j];
      if (inState[l & 0xFFFF] !== inState[l >>> 16]) { if (!run) { run = [L.pts[j]]; out.push(run); } run.push(L.pts[j + 1]); } else run = null;
    }
  }
  for (const r of out) for (const p of [r[0], r[r.length - 1]]) ends.add(p[0].toFixed(5) + ',' + p[1].toFixed(5));
  // the shore of the state
  const cells = div.cells, wet = d => div.kinds[d] !== LAND, sides = [], pinned = new Set();
  for (let y = 0; y < FN; y++) for (let x = 0; x < FN; x++) {
    const t = y * FN + x, d0 = cells[t]; if (d0 < 0) continue;
    for (let s = 0; s < 2; s++) {
      if (s ? y >= FN - 1 : x >= FN - 1) continue;
      const d1 = cells[s ? t + FN : t + 1]; if (d1 < 0 || wet(d0) === wet(d1)) continue;
      const land = wet(d0) ? d1 : d0; if (!inState[land]) continue;
      if (!s) sides.push(y * V + x + 1, (y + 1) * V + x + 1, 0); else sides.push((y + 1) * V + x, (y + 1) * V + x + 1, 0);
    }
  }
  // a corner of the shore where a land line of the state ends is pinned: the shore line ends there too
  for (let i = 0; i < sides.length; i += 3) for (const c of [sides[i], sides[i + 1]]) { const p = cornerXY(c); if (ends.has(p[0].toFixed(5) + ',' + p[1].toFixed(5))) pinned.add(c); }
  for (const c of chainSides(sides, pinned)) {
    const ring = c.ring, pts = c.vs.map(cornerXY);
    const fixed = [!ring, !ring];                                        // (an end of the shore line is where a land line meets it, or a fork of the shore)
    out.push(smoothLabelled({ pts, labs: c.labs, ids: c.vs.map(() => null) }, REACH[6], null, fixed, ring).pts);
  }
  return out;
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

// a line of flat km → pieces of [lon, lat] for a ribbon: a point every 400 m (a line along a crest stands on every rise
// of it and is not buried between two far corners), cut where it leaves the album's region
function ribbonPts(line, list) {
  const fine = [line[0]];
  for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i], k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .4); for (let j = 1; j <= k; j++) fine.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
  let part = [];
  for (const [x, y] of fine) { const p = llOf(x, y), q = [p.lon, p.lat]; if (inside(q)) part.push(q); else { if (part.length > 1) list.push(part); part = []; } }
  if (part.length > 1) list.push(part);
}
function ribbons(album, lines, w, colour, minPx, order) {
  const list = []; for (const line of lines) ribbonPts(line, list);
  if (!list.length) return null;
  const rib = makeRibbons(album, list.map(pts => ({ pts, width: w, kind: 0 })), { colour, minPx, lift: .015 });
  rib.mesh.renderOrder = order; rib.mesh.material.depthTest = false;      // a border is drawn over the land whatever the relief: on a crest the coarse ground of the far view would bury parts of it
  return rib;
}
const drop = (album, m) => { if (!m) return; album.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); };

// The outline of one district: a light line over a dark one, on the very border the lines and the fill share
// look: { w: km, light, dark (colours), px: width of the light line, under: of the dark one, pixels }
function outline(album, geo, d, look) {
  if (d < 0) return null;
  const lines = outlineOf(geo, d); if (!lines.length) return null;
  return { d, dark: ribbons(album, lines, look.w * 2.4, look.dark, look.under, 7), light: ribbons(album, lines, look.w, look.light, look.px, 8) };
}
const HOVER = { w: .03, px: 2.2, under: 5, light: 0xf4f4f4, dark: 0x101010 };
const CHOSEN = { w: .04, px: 3, under: 6.5, light: 0xfff4d2, dark: 0x140c04 };

// the meshes of all lines; set(alpha per key, look) each frame
export function createLines(album, ch, div, state, rivers = null) {
  const groups = borderLines(ch, div, state, rivers), meshes = {};
  for (const [key, lines] of Object.entries(groups)) {
    const s = STYLE[key], rib = ribbons(album, lines, s.w, s.ink, s.px, 6);
    if (rib) meshes[key] = { ...rib, style: s };
  }
  let hov = null, sel = null;
  const forget = o => { if (o) { drop(album, o.dark); drop(album, o.light); } };
  return {
    // the district under the cursor and the chosen one (−1 none)
    mark(hover, chosen) {
      const h = hover !== chosen ? hover : -1;
      if ((hov ? hov.d : -1) !== h) { forget(hov); hov = outline(album, div.geo, h, HOVER); }
      if ((sel ? sel.d : -1) !== chosen) { forget(sel); sel = outline(album, div.geo, chosen, CHOSEN); }
    },
    update(cam, dom, alpha, look) {
      const light = look !== 'paper' && look !== 'atlas';
      for (const [key, m] of Object.entries(meshes)) {
        const a = alpha[key] || 0;
        m.mesh.visible = a > .01; if (!m.mesh.visible) continue;
        m.setPx(cam, dom); m.u.uAlpha.value = a; m.u.uColour.value.set(light ? m.style.light : m.style.ink);
      }
      for (const o of [hov, sel]) if (o) for (const [m, a] of [[o.dark, .45], [o.light, 1]]) if (m) { m.setPx(cam, dom); m.u.uAlpha.value = a; }
    },
    dispose() { for (const m of Object.values(meshes)) drop(album, m); forget(hov); forget(sel); },
    count: Object.values(groups).reduce((s, g) => s + g.length, 0),
  };
}
