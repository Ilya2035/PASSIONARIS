// Marks and names of settlements over the map, by the height of the camera. The owner's ladder, 15.11.2026: «с 70
// километров у нас видны деревушки, уже точечки… с 200 километров у нас видны малые города, города видны с тысячи. Как
// маленькие точки… с 25 километров и выше уже видно точечку, потом название»; «Столица должна быть видна с 2000
// километров. Выше нет… Просто красная точка… Крупная. И потом приближаем, и потихонечку там подпись „Мадрид“».
//
// • How long a settlement stays marked is told by its RANK (town/rules.js, RANKS): a village — to 100 km, the town of
//   a district — to 150 km, a greater town — to 200 km, the chief town of a province or of a land and the greatest
//   cities — to 1000 km, the capital (the chief town of a region, while there are no countries) — to 2000 km. Higher
//   than that the map carries no marks. Below MARK_FROM km (25) there is neither mark nor name: there one looks at
//   the settlement itself.
// • From high up a mark is a DOT, the larger the higher the rank; from DOTS_SMALL_FROM km up the dots of the towns
//   are small ones. Below SHAPES_TO km a mark is a SHAPE that tells the class of the settlement (rules.js, CLASSES):
//   circle — village, triangle — small town, diamond — middling town, square — city, pentagon — megapolis. A chief
//   town has a dark heart; that of a land a ring as well. The capital is red and large at every height.
// • A mark stands while the settlement itself is too small on the screen to be read: over a town whose houses fill
//   the middle of the picture no mark stands.
// • Names come in as the camera comes down, the higher the rank the earlier (RANKS[].name): the capital from 1250 km,
//   the chief town of a land from 520, of a province from 320, a town from 110, the town of a district from 75, a
//   village from 45; all go between NAME_FROM km. The knob «Названия столиц издалека» keeps the names of the chief
//   towns while they are marked.
// • Every settlement is marked, with a name or without (a made place has none: its dot stands alone).
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
import { CLASSES, RANKS, NAME_FROM, SHAPES_TO, MARK_FROM, DOTS_SMALL_FROM, CAPITAL_RANK, classOf, PASS_RANKS, passRank, passText } from '../town/rules.js';
import { createScaleBar, kmPerPixel } from '../town/scale.js';

export const MARK_TO = RANKS.map(r => r.to);                        // the greatest camera height, km, from which a rank is still marked
const SIZE = [7, 11, 12, 12, 15];                                   // px across: the shape of a class
const DOT = [5, 7.5, 8.5, 9.5, 11, 16];                             // px across: the dot of a rank
const DOT_SMALL = [5, 6, 6, 6, 7.5, 15];                            // …and from DOTS_SMALL_FROM km up: the towns are small dots, the capital stays large
// The town of a district that is still of village size keeps the circle of its class, drawn larger than a village:
// it is the town of its district and must be found on a dark mountain forest from 60 km and more.
const shapeSize = (cls, rank) => SIZE[cls] + (cls === 0 && rank >= 1 ? 3.5 : 0);
const FILL = '#fff8e6', INK = '#15100a';                            // working colours: a pale mark with a dark edge reads on any land
const RED = '#e02a1c';                                              // the capital (the owner: «просто красная точка… крупная»)
const SHAPES = {
  circle: s => `<circle r="${s / 2 - 1}"/>`,
  triangle: s => `<polygon points="0,${-s * .56} ${s * .54},${s * .4} ${-s * .54},${s * .4}"/>`,
  diamond: s => `<polygon points="0,${-s * .58} ${s * .58},0 0,${s * .58} ${-s * .58},0"/>`,
  square: s => `<rect x="${-s * .44}" y="${-s * .44}" width="${s * .88}" height="${s * .88}"/>`,
  pentagon: s => `<polygon points="${[0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * Math.PI * .4; return `${(Math.cos(a) * s * .56).toFixed(2)},${(Math.sin(a) * s * .56).toFixed(2)}`; }).join(' ')}"/>`,
};
// far: 0 (or false) the shape of the class · 1 (or true) the dot of the rank · 2 its small dot, from very high up
const sizeOf = (cls, rank, far) => (+far > 1 ? DOT_SMALL[rank] : far ? DOT[rank] : shapeSize(cls, rank));
const ringed = (rank, far) => rank === 4 && +far < 2;               // the chief town of a land; from very high up it is a dot like the rest
// how wide a mark is on the screen, px (with its ring)
export const markSize = (cls, rank, far) => sizeOf(cls, rank, far) + (ringed(rank, far) ? 9 : 0);
// The mark of a settlement of class cls and rank `rank`: its shape, or (far) its dot. The capital is red, without
// heart or ring: a large red dot.
export function markSvg(cls, rank = cls > 0 ? 2 : 0, far = false) {
  const s = sizeOf(cls, rank, far), capital = rank >= CAPITAL_RANK, body = far ? `<circle r="${(s / 2).toFixed(1)}"/>` : SHAPES[CLASSES[cls].mark](s);
  const heart = rank >= 3 && !capital ? `<circle r="${far ? 1.4 : 1.7}" fill="${INK}" stroke="none"/>` : '';
  const rr = (s / 2 + 3.2).toFixed(1), ring = ringed(rank, far) ? `<circle r="${rr}" fill="none" stroke="${INK}" stroke-width="3.2"/><circle r="${rr}" fill="none" stroke="${FILL}" stroke-width="1.4"/>` : '';
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" style="flex:none;overflow:visible;transition:opacity .3s"><g fill="${capital ? RED : FILL}" stroke="${INK}" stroke-width="${capital ? 2 : 1.6}" stroke-linejoin="round">${ring}${body}${heart}</g></svg>`;
}
// The mark of a pass: two arcs back to back. A great pass (rank 0) is drawn a little larger and heavier.
export const passSize = (rank, far) => (far ? 9 : 12) + (rank === 0 ? 2 : 0);
export const PASS_LIFT = 15;                                        // px: the mark of a pass stands this much above its point — over the saddle, not on the road and the hospice beside it
export function passSvg(rank = 2, far = false) {
  const s = (far ? 3.9 : 5.2) + (rank === 0 ? .9 : 0), w = s * .66, n = x => +x.toFixed(2);
  const d = `M${n(-w)},${n(-s)} Q${n(-w * .08)},0 ${n(-w)},${n(s)} M${n(w)},${n(-s)} Q${n(w * .08)},0 ${n(w)},${n(s)}`;
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" style="flex:none;overflow:visible;transition:opacity .3s"><g fill="none" stroke-linecap="round"><path d="${d}" stroke="${INK}" stroke-width="${rank === 0 ? 5 : 4.4}"/><path d="${d}" stroke="${FILL}" stroke-width="${rank === 0 ? 2.2 : 1.8}"/></g></svg>`;
}
// how present a thing still is at camera height h when it goes at height `to`: 1 well below, 0 from `to` on
const fade = (h, to) => Math.max(0, Math.min(1, (to - h) / (to * .08)));
const rise = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// What is shown at camera height h of a settlement of this rank, before anything is known of the screen:
// { mark: 0..1, name: 0..1, far: 0 a shape · 1 a dot · 2 a small dot }. farNames: the names of the chief towns stay with their marks.
export function shownAt(rank, h, farNames = false) {
  const R = RANKS[rank], mark = fade(h, R.to) * rise(MARK_FROM[0], MARK_FROM[1], h);
  return { mark, name: mark * rise(NAME_FROM[0], NAME_FROM[1], h) * (farNames && rank >= 3 ? 1 : fade(h, R.name)), far: h > DOTS_SMALL_FROM ? 2 : h > SHAPES_TO ? 1 : 0 };
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
  const v = toWorld(0, 0), p = album.params, byIndex = new Map(), byPass = new Map(); let items = [], tick = 0, seen = -2, passSeen, made = 0;
  const sig = (it, far) => `${it.pass ? 'p' : it.cls}|${it.rank}|${far}|${it.name}`;
  // (there are thousands of villages: the mark and the name of a place are made when it is first shown)
  const dress = it => {
    if (!it.el) { it.el = document.createElement('div'); it.el.className = 'ml'; it.el.style.cssText = 'margin:-10px 0 0 -10px;height:20px;gap:0'; box.appendChild(it.el); made++; }
    const small = 'font-size:var(--fs-s);letter-spacing:.04em;', style = it.pass ? (it.rank ? small : '') : it.rank === 0 ? small : it.rank >= CAPITAL_RANK ? 'font-size:1.3em;' : it.rank >= 4 ? 'font-size:1.14em;' : '';
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
        const on = towns?.passPoint?.(q) || q;                       // (on the road as it is drawn: the list has the pass on the way the road was found by)
        const { lat, lon } = llOf(on.x, on.y), rank = passRank(q), name = passText(q);
        byPass.set(i, { pass: true, index: i, el: null, shown: false, far: false, wide: 8 + name.length * (rank ? 7 : 8.5), name, rank, cls: 0, pri: PASS_RANKS[rank].order, people: q.h || 0, r: 0, lat, lon, alt: Math.max(0, album.data.base.at(lat, lon)) });
      });
    }
    if (ver === seen) { order(); return; }
    seen = ver;
    // (without the layer of settlements, the places of the album as they are)
    const marks = towns?.marks?.() || album.data.vectors.places.map((pl, index) => { const cls = classOf(pl.pop / 60); return { index, name: pl.name, cls, rank: cls > 0 ? 2 : 1, town: true, people: pl.pop / 60, radius: 0, lat: pl.lat, lon: pl.lon }; });
    const keep = new Set();
    for (const m of marks) {
      let it = byIndex.get(m.index); if (!it) { it = { index: m.index, el: null, shown: false, far: false, wide: 0 }; byIndex.set(m.index, it); }
      keep.add(m.index);
      it.name = m.name; it.cls = m.cls; it.rank = it.pri = m.rank; it.people = m.people; it.r = m.radius; it.lat = m.lat; it.lon = m.lon;
      it.alt = Math.max(0, album.data.base.at(m.lat, m.lon));
      if (!it.wide && m.name) it.wide = 8 + m.name.length * (m.rank ? 8.5 : 7);  // until the name is measured on the page, its length is told from its letters
    }
    for (const [index, it] of byIndex) if (!keep.has(index)) { if (it.el) { it.el.remove(); made--; } byIndex.delete(index); }
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
    // (which ranks are marked at all from this height — asked once, not for each of the twenty thousand settlements)
    const rankOn = RANKS.map((_, r) => shownAt(r, h, farNames).mark > 0), passRankOn = PASS_RANKS.map((_, r) => passOn && passShownAt(r, h).mark > 0);
    for (const it of items) {
      it.want = 0;
      if (!on) continue;
      if (!(it.pass ? passRankOn : rankOn)[it.rank]) continue;
      if (it.pri <= 0 && !(Math.abs(it.lat - cl) < reach && Math.abs(it.lon - co) < reach * 1.4)) continue;   // (villages and lesser passes)
      toWorld(it.lat, it.lon, it.alt * cam.exag / 1000, v);
      const eye = cam.cam.position, dist = eye.distanceTo(v);
      if (v.x * (eye.x - v.x) + (v.y + EARTH) * (eye.y - v.y) + v.z * (eye.z - v.z) <= 0) continue;   // beyond the horizon: the ground there faces away from the eye
      const s = it.pass ? passShownAt(it.rank, heightFor(h, dist)) : shownAt(it.rank, heightFor(h, dist), farNames); if (!(s.mark > 0)) continue;
      const kmPx = Math.max(1e-6, dist * k), rpx = it.r / kmPx;     // km to a pixel there · the radius of the houses on the screen
      v.project(cam.cam);
      const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * hh - (it.pass ? PASS_LIFT : 0);
      if (!(v.z < 1 && x > 20 && x < w - 20 && y > 20 && y < hh - 20)) continue;
      // the houses of a town fill the middle of the picture: no mark over them. (A village keeps its dot down to
      // MARK_FROM km — the owner, 15.11.2026: «с 25 километров и выше уже видно точечку»; below that one looks at the
      // settlement itself. A pass has no houses: its mark stands at every height it is shown from.)
      const markA = it.pass ? s.mark : s.mark * Math.max(0, Math.min(1, (20 - rpx) / 8));
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
    // there are thousands of villages, each marked: the marks of those left far behind are taken off the page
    if (made > 700 && tick % 240 === 1) for (const it of byIndex.values()) if (it.el && !it.shown && it.rank === 0) { it.el.remove(); it.el = null; it.dressed = ''; made--; }
  } };
}
