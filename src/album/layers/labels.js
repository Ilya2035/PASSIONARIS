// Marks and names of settlements over the map, by the height of the camera. The owner, 13.11.2026: «совсем далеко —
// ничего; около 500 км — точки самых крупных городов и столиц; 200 км — города поменьше; 100 км — ещё меньше; ближе —
// отметки разной формы у города и деревни. Деревни пропадают первыми, столицы видны дольше всех»; names: «на 20 км их
// не показывать — там смотрят на сам город; показывать около 50 км, дальше убирать».
//
// • How long a settlement stays marked is told by its RANK (town/rules.js, RANKS): a village — to 45 km, the town of a
//   district — to 110 km, a greater town — to 230 km, the chief town of a province and the greatest cities — to
//   560 km, the chief town of a land — to 760 km, of a region — to 900 km. Higher than that the map carries no marks.
// • From high up a mark is a DOT, the larger the higher the rank; below SHAPES_TO km it is a SHAPE that tells the
//   class of the settlement (rules.js, CLASSES): circle — village, triangle — small town, diamond — middling town,
//   square — city, pentagon — megapolis. A chief town has a dark heart; that of a land or a region a ring as well.
// • A mark stands while the settlement itself is too small on the screen to be read; when its houses can be seen the
//   mark fades. So from 20 km there is neither mark nor name: there one looks at the town itself.
// • Names come in between NAME_FROM km and go at the height of their rank (RANKS[].name): about 50 km all of them
//   stand, from 200 km none. The knob «Названия столиц издалека» keeps the names of the chief towns while they are marked.
// • The town of a district is marked even while it has no name (a made place: in the mountains most are): its mark
//   stands alone. A village without a name is not marked.
// • Nothing overlaps: the greater settlement takes the room first; a mark that would touch another mark or a name is
//   left out, and a name that has no room is left out while its mark stays.
// • Under a tilted camera the ground toward the horizon is far away: a settlement more than FAR times farther from
//   the eye than the point the camera looks at is shown as from that much higher up (heightFor()), and one beyond the
//   horizon is not shown at all. So the horizon is not crowded with the marks of villages.
// • A PASS of the mountains (the list is laid by the roads: album.roadNet.passes) has a mark of its own — two arcs
//   back to back, the sign of a pass on a map — and beside it its name and its height in metres («Сомпорт, 1632 м»).
//   It is marked by the height of the camera as a settlement is (rules.js, PASS_RANKS): a great historical pass to
//   230 km, a pass of a main road to 110 km, the rest to 45 km. Its name is written from close up: at a pass there
//   are no houses to look at instead, the mark and the name are all the map says of it.
// The panel of a district (division/panel.js) shows the same marks: markSvg(), passSvg().
// The scale bar of the map (town/scale.js) is kept here too: the settlements stand at their real size, and the bar
// says what that size is.
import { toWorld, R as EARTH } from '../geo.js';
import { llOf } from '../chunks.js';
import { CLASSES, RANKS, NAME_FROM, SHAPES_TO, CELL, classOf, PASS_RANKS, passRank, passText } from '../town/rules.js';
import { createScaleBar, kmPerPixel } from '../town/scale.js';

export const MARK_TO = RANKS.map(r => r.to);                        // the greatest camera height, km, from which a rank is still marked
const SIZE = [7, 11, 12, 12, 15];                                   // px across: the shape of a class
const DOT = [5, 7.5, 8.5, 9.5, 11, 13];                             // px across: the dot of a rank
// The town of a district that is still of village size keeps the circle of its class, drawn larger than a village:
// it is the town of its district and must be found on a dark mountain forest from 60 km and more.
const shapeSize = (cls, rank) => SIZE[cls] + (cls === 0 && rank >= 1 ? 3.5 : 0);
const FILL = '#fff8e6', INK = '#15100a';                            // working colours: a pale mark with a dark edge reads on any land
const SHAPES = {
  circle: s => `<circle r="${s / 2 - 1}"/>`,
  triangle: s => `<polygon points="0,${-s * .56} ${s * .54},${s * .4} ${-s * .54},${s * .4}"/>`,
  diamond: s => `<polygon points="0,${-s * .58} ${s * .58},0 0,${s * .58} ${-s * .58},0"/>`,
  square: s => `<rect x="${-s * .44}" y="${-s * .44}" width="${s * .88}" height="${s * .88}"/>`,
  pentagon: s => `<polygon points="${[0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * Math.PI * .4; return `${(Math.cos(a) * s * .56).toFixed(2)},${(Math.sin(a) * s * .56).toFixed(2)}`; }).join(' ')}"/>`,
};
// how wide a mark is on the screen, px (with its ring)
export const markSize = (cls, rank, far) => (far ? DOT[rank] : shapeSize(cls, rank)) + (rank >= 4 ? 9 : 0);
// The mark of a settlement of class cls and rank `rank`: its shape, or (far) its dot.
export function markSvg(cls, rank = cls > 0 ? 2 : 0, far = false) {
  const s = far ? DOT[rank] : shapeSize(cls, rank), body = far ? `<circle r="${(s / 2).toFixed(1)}"/>` : SHAPES[CLASSES[cls].mark](s);
  const heart = rank >= 3 ? `<circle r="${far ? 1.4 : 1.7}" fill="${INK}" stroke="none"/>` : '';
  const rr = (s / 2 + 3.2).toFixed(1), ring = rank >= 4 ? `<circle r="${rr}" fill="none" stroke="${INK}" stroke-width="3.2"/><circle r="${rr}" fill="none" stroke="${FILL}" stroke-width="1.4"/>` : '';
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" style="flex:none;overflow:visible;transition:opacity .3s"><g fill="${FILL}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round">${ring}${body}${heart}</g></svg>`;
}
// The mark of a pass: two arcs back to back. A great pass (rank 0) is drawn a little larger and heavier.
export const passSize = (rank, far) => (far ? 9 : 12) + (rank === 0 ? 2 : 0);
export function passSvg(rank = 2, far = false) {
  const s = (far ? 3.9 : 5.2) + (rank === 0 ? .9 : 0), w = s * .66, n = x => +x.toFixed(2);
  const d = `M${n(-w)},${n(-s)} Q${n(-w * .08)},0 ${n(-w)},${n(s)} M${n(w)},${n(-s)} Q${n(w * .08)},0 ${n(w)},${n(s)}`;
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" style="flex:none;overflow:visible;transition:opacity .3s"><g fill="none" stroke-linecap="round"><path d="${d}" stroke="${INK}" stroke-width="${rank === 0 ? 5 : 4.4}"/><path d="${d}" stroke="${FILL}" stroke-width="${rank === 0 ? 2.2 : 1.8}"/></g></svg>`;
}
// how present a thing still is at camera height h when it goes at height `to`: 1 well below, 0 from `to` on
const fade = (h, to) => Math.max(0, Math.min(1, (to - h) / (to * .08)));
const rise = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// What is shown at camera height h of a settlement of this rank, before anything is known of the screen:
// { mark: 0..1, name: 0..1, far: a dot instead of a shape }. farNames: the names of the chief towns stay with their marks.
export function shownAt(rank, h, farNames = false) {
  const R = RANKS[rank], mark = fade(h, R.to);
  return { mark, name: mark * rise(NAME_FROM[0], NAME_FROM[1], h) * (farNames && rank >= 3 ? 1 : fade(h, R.name)), far: h > SHAPES_TO };
}
// What is shown of a pass of this rank (PASS_RANKS) at camera height h: { mark, name: 0..1, far: the smaller mark }
export function passShownAt(rank, h) {
  const R = PASS_RANKS[rank], mark = fade(h, R.to);
  return { mark, name: mark * fade(h, R.name), far: h > SHAPES_TO };
}
// The camera height a settlement is shown for: the height of the camera (its distance from the point it looks at),
// or, for a settlement much farther from the eye than that, its own distance from the eye over FAR.
export const FAR = 1.25;
export const heightFor = (h, dist) => Math.max(h, dist / FAR);
// Which of the marks and names have room. list: the settlements the greater first, each { x, y (px), mark (px across,
// 0: no mark stands), name (px wide, 0: no name), gap (px from the place to where its name begins) }.
// → for each: 0 nothing shown · 1 the mark alone · 2 mark and name (or the name alone when no mark stands)
export function declutter(list) {
  const boxes = [], hits = (x0, y0, x1, y1) => { for (const b of boxes) if (x0 < b[2] && b[0] < x1 && y0 < b[3] && b[1] < y1) return true; return false; };
  return list.map(it => {
    const m = it.mark > 0 ? it.mark / 2 + 3 : 0;
    if (m && hits(it.x - m, it.y - m, it.x + m, it.y + m)) return 0;
    const named = it.name > 0 && !hits(it.x + it.gap, it.y - 9, it.x + it.gap + it.name, it.y + 9);
    if (!m && !named) return 0;
    if (m) boxes.push([it.x - m, it.y - m, it.x + m, it.y + m]);
    if (named) boxes.push([it.x + it.gap, it.y - 9, it.x + it.gap + it.name, it.y + 9]);
    return named ? 2 : 1;
  });
}

export default async function init(album) {
  const box = document.createElement('div'); box.className = 'map-labels'; document.body.insertBefore(box, document.getElementById('ui'));
  const v = toWorld(0, 0), p = album.params, byIndex = new Map(), byPass = new Map(); let items = [], tick = 0, seen = -2, passSeen;
  const sig = (it, far) => `${it.pass ? 'p' : it.cls}|${it.rank}|${far}|${it.name}`;
  // (there are thousands of villages: the mark and the name of a place are made when it is first shown)
  const dress = it => {
    if (!it.el) { it.el = document.createElement('div'); it.el.className = 'ml'; it.el.style.cssText = 'margin:-10px 0 0 -10px;height:20px;gap:0'; box.appendChild(it.el); }
    const small = 'font-size:var(--fs-s);letter-spacing:.04em;', style = it.pass ? (it.rank ? small : '') : it.rank === 0 ? small : it.rank >= 4 ? 'font-size:1.14em;' : '';
    it.el.innerHTML = `${it.pass ? passSvg(it.rank, it.far) : markSvg(it.cls, it.rank, it.far)}<span style="${style}transition:opacity .3s"></span>`; it.svg = it.el.firstChild; it.span = it.el.lastChild;
    it.span.textContent = it.name;                                  // (a name is text, never markup)
    it.wide = it.span.offsetWidth || it.wide; it.dressed = sig(it, it.far);
  };
  // the settlements that stand now (layers/towns.js): where each is, how large, of what class and rank
  function sync() {
    const towns = album.layers.towns, ver = towns?.version?.() ?? -1, ps = album.roadNet?.passes || null;
    if (ver === seen && ps === passSeen) return;
    // the passes the roads have laid (album.roadNet.passes; none until they are laid — then the map has no such marks)
    if (ps !== passSeen) {
      passSeen = ps; for (const it of byPass.values()) it.el?.remove(); byPass.clear();
      (Array.isArray(ps) ? ps : []).forEach((q, i) => {
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
        const { lat, lon } = llOf(q.x, q.y), rank = passRank(q), name = passText(q);
        byPass.set(i, { pass: true, index: i, el: null, shown: false, far: false, wide: 8 + name.length * (rank ? 7 : 8.5), name, rank, cls: 0, pri: PASS_RANKS[rank].order, people: q.h || 0, r: 0, lat, lon, alt: Math.max(0, album.data.base.at(lat, lon)) });
      });
    }
    if (ver === seen) { order(); return; }
    seen = ver;
    // (without the layer of settlements, the places of the album as they are)
    const marks = towns?.marks?.() || album.data.vectors.places.map((pl, index) => { const cls = classOf(pl.pop / 60); return { index, name: pl.name, cls, rank: cls > 0 ? 2 : 1, town: true, people: pl.pop / 60, radius: 0, lat: pl.lat, lon: pl.lon }; });
    const keep = new Set();
    for (const m of marks) {
      if (!m.name && !(m.rank >= 1)) continue;                      // a village without a name is never marked; the town of a district is, by its mark alone
      let it = byIndex.get(m.index); if (!it) { it = { index: m.index, el: null, shown: false, far: false, wide: 0 }; byIndex.set(m.index, it); }
      keep.add(m.index);
      it.name = m.name; it.cls = m.cls; it.rank = it.pri = m.rank; it.people = m.people; it.r = m.radius; it.lat = m.lat; it.lon = m.lon;
      it.alt = Math.max(0, album.data.base.at(m.lat, m.lon));
      if (!it.wide && m.name) it.wide = 8 + m.name.length * (m.rank ? 8.5 : 7);  // until the name is measured on the page, its length is told from its letters
    }
    for (const [index, it] of byIndex) if (!keep.has(index)) { it.el?.remove(); byIndex.delete(index); }
    order();
  }
  // the greater place takes the room first; a pass has its turn among the settlements (PASS_RANKS[].order), the higher first
  function order() { items = [...byIndex.values(), ...byPass.values()].sort((a, b) => b.pri - a.pri || b.people - a.people || a.index - b.index); }
  const cand = [], rows = [], scale = createScaleBar(box);
  return { id: 'labels', update(dt, t, cam) {
    if (tick++ % 2) return;
    sync();
    scale.update(kmPerPixel(cam.s.h, cam.cam.fov, innerHeight), p.get('scaleBar') !== 0);
    const on = !!p.get('labels'), passOn = p.get('passMarks') !== 0, farNames = !!p.get('labelsFar'), h = cam.s.h, w = innerWidth, hh = innerHeight, k = Math.tan(cam.cam.fov * Math.PI / 360) * 2 / hh;
    const reach = Math.max(.6, h * .07), cl = cam.s.lat, co = cam.s.lon;       // degrees around the point the camera looks at: villages farther off are not looked at
    cand.length = rows.length = 0;
    for (const it of items) {
      it.want = 0;
      if (!on) continue;
      if (it.pass ? !passOn || !(passShownAt(it.rank, h).mark > 0) : !(shownAt(it.rank, h, farNames).mark > 0)) continue;
      if (it.pri <= 0 && !(Math.abs(it.lat - cl) < reach && Math.abs(it.lon - co) < reach * 1.4)) continue;   // (villages and lesser passes)
      toWorld(it.lat, it.lon, it.alt * cam.exag / 1000, v);
      const eye = cam.cam.position, dist = eye.distanceTo(v);
      if (v.x * (eye.x - v.x) + (v.y + EARTH) * (eye.y - v.y) + v.z * (eye.z - v.z) <= 0) continue;   // beyond the horizon: the ground there faces away from the eye
      const s = it.pass ? passShownAt(it.rank, heightFor(h, dist)) : shownAt(it.rank, heightFor(h, dist), farNames); if (!(s.mark > 0)) continue;
      const kmPx = Math.max(1e-6, dist * k), rpx = it.r / kmPx;     // km to a pixel there · the radius of the houses on the screen
      v.project(cam.cam);
      const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * hh;
      if (!(v.z < 1 && x > 20 && x < w - 20 && y > 20 && y < hh - 20)) continue;
      // the houses are readable: no mark over them. A settlement of village size is a few houses — the town of a
      // district may be no more than that: its mark goes as soon as a single house can be told (the owner: the name
      // «не прикрывает саму деревушку»; from 20 km one looks at the settlement itself)
      // (a pass has no houses: its mark stands at every height it is shown from)
      const markA = it.pass ? s.mark : s.mark * Math.max(0, Math.min(1, (20 - rpx) / 8, it.cls ? 1 : (4.5 - CELL / kmPx) / 1.5));
      const nameA = it.name ? s.name : 0;
      if (!(markA > 0 || nameA > 0)) continue;
      it.x = x; it.y = y; it.markA = markA; it.nameA = nameA; it.wantFar = s.far;
      it.gap = 10 + Math.max(4, rpx - 4) + (!it.pass && it.rank >= 4 && markA > 0 ? 4 : 0);   // the name stands beside the houses, never over them
      cand.push(it); rows.push({ x, y, mark: markA > 0 ? (it.pass ? passSize(it.rank, s.far) : markSize(it.cls, it.rank, s.far)) : 0, name: nameA > 0 ? it.wide : 0, gap: it.gap });
    }
    const got = declutter(rows);
    for (let i = 0; i < cand.length; i++) cand[i].want = got[i];
    for (const it of items) {
      const show = it.want > 0;
      if (show) {
        if (!it.el || it.far !== it.wantFar || it.dressed !== sig(it, it.wantFar)) { it.far = it.wantFar; dress(it); }
        it.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
        it.svg.style.opacity = it.markA.toFixed(2);
        it.span.style.opacity = (it.want > 1 ? it.nameA : 0).toFixed(2);
        it.span.style.marginLeft = `${(it.gap - 10).toFixed(0)}px`;
      }
      if (show !== it.shown) { it.shown = show; it.el?.classList.toggle('on', show); }
    }
  } };
}
