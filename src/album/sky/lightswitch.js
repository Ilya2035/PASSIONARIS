// The switch of light on the panel of the map (the owner, 15.11.2026: «Переключение, чтобы я мог переключать
// освещение»): a row of buttons — the old light of the map, morning, day, evening, night. A named light is the knob
// `light` of the sky (aspects/sky.js): its hour is counted from the Sun of the place under the camera, so «Утро» is a
// morning anywhere on the Earth and on any day. The old light is hour 0: from the north-west, the same everywhere,
// with no Sun in the sky and no night — the light the album was drawn with, kept for comparison.
//
// The panel itself is mapview.js (the leading session's file); this row is put into it from here, by main.js, and
// uses the panel's own classes, so that file is not touched.

// [knob value, the word on the button, the hint]
export const LIGHTS = [
  ['', 'Прежний', 'Прежний свет карты: с северо-запада, одинаковый везде, без Солнца на небе и без ночи'],
  ['morning', 'Утро', 'Утро: Солнце невысоко на востоке, тени длинные'],
  ['day', 'День', 'День: настоящее Солнце после полудня, высоко на западе'],
  ['evening', 'Вечер', 'Вечер: Солнце низко на западе, свет оранжевый'],
  ['night', 'Ночь', 'Ночь: Солнце под горизонтом, светит Луна'],
];
// which button is lit for the knobs as they are: the named light, or the old one while the hour knob rests at 0;
// null when the hour is set by hand in the album or the day runs by itself
export const lightShown = get => (get('dayRun') ? null : get('light') ? get('light') : get('hour') ? null : '');
// what pressing a button sets
export const lightSet = id => (id ? { light: id, dayRun: 0 } : { light: '', hour: 0, dayRun: 0 });

const CSS = `
.mv .mv-light { display: grid; grid-template-columns: 1.5fr repeat(4, 1fr); gap: 4px; }
.mv .mv-light .btn { justify-content: center; min-width: 0; padding-left: 2px; padding-right: 2px; }
.mv .mv-light-cap { margin-bottom: -4px; }
`;

// puts the row into the panel of the map, above its switches; returns the row, or null when there is no panel
export function mountLightSwitch(album) {
  const box = document.querySelector('#ui > .mv'), p = album.params; if (!box || !p) return null;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const cap = Object.assign(document.createElement('div'), { className: 'S mv-light-cap mv-line', textContent: 'Свет' });
  const row = Object.assign(document.createElement('div'), { className: 'mv-light' });
  const btns = LIGHTS.map(([id, word, hint]) => {
    const b = Object.assign(document.createElement('button'), { className: 'btn off', type: 'button', textContent: word, title: hint });
    b.onclick = () => p.setMany(lightSet(id)); row.append(b); return [id, b];
  });
  const before = box.querySelector('.mv-sw'); box.insertBefore(cap, before); box.insertBefore(row, before);
  const sync = () => { const on = lightShown(p.get); for (const [id, b] of btns) b.classList.toggle('off', id !== on); };
  p.on(sync); sync();
  return row;
}
