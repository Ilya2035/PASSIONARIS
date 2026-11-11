// Names of the lands over the map: regions in the regions mode, provinces in the other modes of the division, the
// name of the state of history when one is shown. Map content, not interface (like layers/labels.js): a name is
// written only while its land is large enough on the screen, bigger lands first, never one name over another.
import { toWorld } from '../geo.js';

const INK = { dark: ['#2a1d12', '0 0 2px #f6eedd, 0 0 5px #f6eedd, 0 0 9px rgba(246,238,221,.8)'], light: ['#fff8e6', '0 0 3px #000, 0 0 7px rgba(0,0,0,.9), 0 1px 0 #000'] };

export function createLabels(album) {
  const box = document.createElement('div');
  box.className = 'division-labels';
  box.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  document.body.insertBefore(box, document.getElementById('ui'));
  const v = toWorld(0, 0);
  let items = [], key = '';

  // level: 'region' | 'province' | 'state'; units: [{ name, lat, lon, area }]
  function set(list, k) {
    if (k === key) return;
    key = k; box.textContent = ''; items = [];
    for (const u of list) {
      if (!u) continue;
      const el = document.createElement('div');
      const big = u.level === 'region' || u.level === 'state';
      el.textContent = big ? u.name.toUpperCase() : u.name;
      el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;transform-origin:50% 50%;opacity:0;transition:opacity .25s;
        font:${big ? 600 : 500} var(${u.level === 'state' ? '--fs-l' : big ? '--fs-m' : '--fs-s'})/1 'Alegreya SC', var(--font-display);letter-spacing:${big ? '.18em' : '.06em'}`;
      if (u.sea) el.style.fontStyle = 'italic';               // the seas lean, as on any map
      box.appendChild(el);
      items.push({ ...u, el, w: el.textContent.length * (big ? 13 : 8) + 10, shown: false });
    }
    items.sort((a, b) => (b.level === 'state') - (a.level === 'state') || (a.sea ? 1 : 0) - (b.sea ? 1 : 0) || b.area - a.area);
  }
  function update(cam, look) {
    const w = innerWidth, hh = innerHeight, used = [], ink = INK[look === 'paper' || look === 'atlas' ? 'dark' : 'light'];
    const kmPerPx = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / hh;
    for (const it of items) {
      let show = Math.sqrt(it.area) / kmPerPx > it.w * (it.level === 'province' ? .9 : .5);
      if (show) {
        toWorld(it.lat, it.lon, Math.max(0, album.data.base.at(it.lat, it.lon)) * cam.exag / 1000, v).project(cam.cam);
        const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * hh;
        show = v.z < 1 && x > it.w / 2 && x < w - it.w / 2 && y > 14 && y < hh - 14
          && !used.some(u => Math.abs(u[0] - x) < (u[2] + it.w) / 2 && Math.abs(u[1] - y) < 24);
        if (show) {
          used.push([x, y, it.w]);
          it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
          it.el.style.color = ink[0]; it.el.style.textShadow = ink[1];
        }
      }
      if (show !== it.shown) { it.shown = show; it.el.style.opacity = show ? (it.level === 'province' ? .9 : 1) : 0; }
    }
  }
  return { set, update, hide() { set([], 'none'); } };
}
