// Names and markers of settlements over the map: fewer and larger places as the camera climbs (villages from
// 50–100 km, towns from 200 km), a marker that fades as the block town underneath becomes readable.
import { toWorld } from '../geo.js';

export default async function init(album) {
  const box = document.createElement('div'); box.className = 'map-labels'; document.body.insertBefore(box, document.getElementById('ui'));
  const items = album.data.vectors.places.map(pl => {
    const el = document.createElement('div'); el.className = 'ml'; el.innerHTML = `<i></i><span>${pl.name}</span>`; box.appendChild(el);
    return { pl, el, shown: false };
  });
  const v = toWorld(0, 0), p = album.params; let tick = 0;
  return { id: 'labels', update(dt, t, cam) {
    if (tick++ % 2) return;
    const on = !!p.get('labels'), h = cam.s.h, w = innerWidth, hh = innerHeight, used = [];
    const minPop = h > 900 ? 9e5 : h > 450 ? 3e5 : h > 220 ? 9e4 : h > 90 ? 2.5e4 : 0;
    box.dataset.far = h > 260 ? '1' : '0';
    for (const it of items) {
      let show = on && it.pl.pop >= minPop;
      if (show) {
        toWorld(it.pl.lat, it.pl.lon, Math.max(0, album.data.base.at(it.pl.lat, it.pl.lon)) * cam.exag / 1000, v).project(cam.cam);
        const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * hh;
        show = v.z < 1 && x > 20 && x < w - 20 && y > 20 && y < hh - 20 && !used.some(u => Math.abs(u[0] - x) < 92 && Math.abs(u[1] - y) < 22);
        if (show) { used.push([x, y]); it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; }
      }
      if (show !== it.shown) { it.shown = show; it.el.classList.toggle('on', show); }
    }
  } };
}
