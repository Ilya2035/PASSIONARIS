// The scale bar of the map. The owner, 13.11.2026: «Мне нужно увидеть реальный масштаб городов». Settlements stand
// at their real size, one to one, and are never drawn larger as the camera rises — so the screen itself has to say how
// large they are: a bar of a round length, cut into equal pieces, in the working colours of the interface.
// The scale is that of the ground at the middle of the screen, where the camera looks; toward the horizon of a tilted
// view the ground is smaller.
export const SCALE_STEPS = [.05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];   // km: the lengths a bar may have
const text = km => (km >= 1 ? `${km} км` : `${Math.round(km * 1000)} м`);
// kmPerPx: km of ground to a pixel of the screen; most: the widest the bar may be, px
// → { km (the length of the bar), px (its width on the screen), parts (the equal pieces it is cut into), part (km a
//     piece), label, partLabel }
export function scaleOf(kmPerPx, most = 170) {
  let km = SCALE_STEPS[0]; for (const s of SCALE_STEPS) if (s / kmPerPx <= most) km = s;
  const lead = Math.round(km / 10 ** Math.floor(Math.log10(km) + 1e-9)), parts = lead === 2 ? 4 : 5;
  return { km, px: km / kmPerPx, parts, part: km / parts, label: text(km), partLabel: text(km / parts) };
}
// km of ground to a pixel at the point the camera looks at: h km away, a picture `height` pixels high seen under `fov` degrees
export const kmPerPixel = (h, fov, height) => 2 * h * Math.tan(fov * Math.PI / 360) / Math.max(1, height);

const CSS = `
.map-scale { position: absolute; left: 20px; bottom: 20px; padding: 8px 10px 6px; background: var(--c-panel, #1b2130); border: 2px solid var(--c-line, #4a576f);
  color: var(--c-text, #f3f5f9); font: 400 var(--fs-s, 13px)/1.2 var(--font-ui, sans-serif); pointer-events: none; }
.map-scale .ms-bar { display: flex; height: 8px; border: 1px solid var(--c-text, #f3f5f9); box-sizing: content-box; }
.map-scale .ms-bar i { flex: 1; background: var(--c-text, #f3f5f9); }
.map-scale .ms-bar i:nth-child(even) { background: var(--c-panel, #1b2130); }
.map-scale .ms-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.map-scale .ms-row span:last-child { color: var(--c-text-dim, #b3bccc); }
`;
// the bar on the page: host — the element it is put into. → { update(kmPerPx, shown) }
export function createScaleBar(host) {
  if (!document.getElementById('map-scale-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'map-scale-css', textContent: CSS }));
  const box = document.createElement('div'); box.className = 'map-scale';
  const bar = document.createElement('div'); bar.className = 'ms-bar';
  const row = document.createElement('div'); row.className = 'ms-row'; const a = document.createElement('span'), b = document.createElement('span'); row.append(a, b);
  box.append(bar, row); host.appendChild(box);
  let key = '', place = '';
  return { el: box, update(kmPerPx, shown = true) {
    box.style.display = shown ? '' : 'none'; if (!shown) return;
    // where it stands: on the map alone — above the strip of the keys; in the album — in the free corner under that
    // strip; with no interface at all (a capture) — in the corner of the picture
    const ui = document.getElementById('ui'), bare = !ui || !ui.childElementCount || ui.classList.contains('hidden');
    const at = bare ? '20px|20px' : document.body.classList.contains('mapview') ? '392px|64px' : '716px|20px';
    if (at !== place) { place = at; [box.style.left, box.style.bottom] = at.split('|'); }
    const s = scaleOf(kmPerPx), k = `${s.km}|${Math.round(s.px)}`; if (k === key) return; key = k;
    bar.style.width = `${Math.round(s.px)}px`; bar.textContent = ''; for (let i = 0; i < s.parts; i++) bar.appendChild(document.createElement('i'));
    a.textContent = `${s.label}`; b.textContent = `деление — ${s.partLabel}`;
  } };
}
