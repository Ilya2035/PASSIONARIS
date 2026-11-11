// Names and marks of settlements over the map. The shape of the mark tells the class of the settlement
// (town/rules.js, CLASSES): circle — village, triangle — small town, diamond — middling town, square — city,
// pentagon — megapolis. A mark stands while the settlement itself is too small on the screen to be read; when its
// houses can be seen the mark fades, and the name always stands beside the houses, never over them. Villages are not
// marked from afar: only close by, with a dot and a small name. The higher the camera, the fewer classes are shown.
import { toWorld } from '../geo.js';
import { llOf } from '../chunks.js';
import { CLASSES, classOf } from '../town/rules.js';

// the greatest camera height, km, from which a class is still marked
export const MARK_FROM = [45, 170, 430, 1300, 1e9];
const SIZE = [7, 11, 12, 12, 15];                                   // px across
const SHAPES = {
  circle: s => `<circle r="${s / 2 - 1}"/>`,
  triangle: s => `<polygon points="0,${-s * .56} ${s * .54},${s * .4} ${-s * .54},${s * .4}"/>`,
  diamond: s => `<polygon points="0,${-s * .58} ${s * .58},0 0,${s * .58} ${-s * .58},0"/>`,
  square: s => `<rect x="${-s * .44}" y="${-s * .44}" width="${s * .88}" height="${s * .88}"/>`,
  pentagon: s => `<polygon points="${[0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * Math.PI * .4; return `${(Math.cos(a) * s * .56).toFixed(2)},${(Math.sin(a) * s * .56).toFixed(2)}`; }).join(' ')}"/>`,
};
export const markSvg = cls => { const s = SIZE[cls];
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" style="flex:none;overflow:visible;transition:opacity .3s"><g fill="#fff8e6" stroke="#15100a" stroke-width="1.6" stroke-linejoin="round">${SHAPES[CLASSES[cls].mark](s)}</g></svg>`; };

export default async function init(album) {
  const box = document.createElement('div'); box.className = 'map-labels'; document.body.insertBefore(box, document.getElementById('ui'));
  const items = album.data.vectors.places.map((pl, index) => {
    const el = document.createElement('div'); el.className = 'ml'; el.style.cssText = 'margin:-10px 0 0 -10px;height:20px;gap:0'; box.appendChild(el);
    return { pl, index, el, shown: false, cls: -1, lat: pl.lat, lon: pl.lon, r: 0, town: true };
  });
  const v = toWorld(0, 0), p = album.params; let tick = 0, model = null;
  // what the model of growth founded: where each place stands now, how large it is, of what class
  function sync() {
    const m = album.layers.towns?.model?.() || null; if (m === model) return; model = m;
    const by = new Map((m?.towns || []).map(t => [t.index, t]));
    for (const it of items) {
      const t = by.get(it.index), cls = t ? t.cls : classOf(it.pl.pop / 60);
      it.town = !m || !!t; it.r = t ? t.R : 0;
      if (t) { const q = llOf(t.x, t.y); it.lat = q.lat; it.lon = q.lon; } else { it.lat = it.pl.lat; it.lon = it.pl.lon; }
      if (cls !== it.cls) { it.cls = cls; it.el.innerHTML = `${markSvg(cls)}<span${cls ? '' : ' style="font-size:var(--fs-s);letter-spacing:.04em"'}>${it.pl.name}</span>`; it.svg = it.el.firstChild; it.span = it.el.lastChild; }
    }
    items.sort((a, b) => b.cls - a.cls || b.pl.pop - a.pl.pop);     // the greater place takes the room first
  }
  return { id: 'labels', update(dt, t, cam) {
    if (tick++ % 2) return;
    sync();
    const on = !!p.get('labels'), h = cam.s.h, w = innerWidth, hh = innerHeight, used = [], k = Math.tan(cam.cam.fov * Math.PI / 360) * 2 / hh;
    for (const it of items) {
      let show = on && it.town && h <= MARK_FROM[it.cls];
      if (show) {
        toWorld(it.lat, it.lon, Math.max(0, album.data.base.at(it.lat, it.lon)) * cam.exag / 1000, v);
        const rpx = it.r / Math.max(1e-6, cam.cam.position.distanceTo(v) * k);        // the radius of the houses on the screen
        v.project(cam.cam);
        const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * hh;
        show = v.z < 1 && x > 20 && x < w - 20 && y > 20 && y < hh - 20 && !used.some(u => Math.abs(u[0] - x) < 92 + u[2] && Math.abs(u[1] - y) < 22);
        if (show) {
          used.push([x, y, rpx]); it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          it.svg.style.opacity = Math.max(0, Math.min(1, (20 - rpx) / 8)).toFixed(2);   // the houses are readable: no mark over them
          it.span.style.marginLeft = `${Math.max(4, rpx - 4).toFixed(0)}px`;            // the name beside the houses
        }
      }
      if (show !== it.shown) { it.shown = show; it.el.classList.toggle('on', show); }
    }
  } };
}
