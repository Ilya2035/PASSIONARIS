// The block with what a district holds, opened by a click on the map. A plain panel of the working interface
// (docs/UI.md): flat fill and frame from src/shared/theme.css (.panel, .close), the album's text sizes (.L, .M, .S,
// .cap). Only its place on the screen is set here: right of the album's top panel.
import { KIND_TITLE, KIND_ID } from './build.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pct = v => `${Math.round(v * 100)} %`;
const num = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ru-RU') : (Math.round(v * 10) / 10).toLocaleString('ru-RU'));

export function createPanel(onClose) {
  const box = el('div', 'panel pn district-info');
  box.style.cssText = 'top:20px;right:358px;width:300px;z-index:4';
  const close = el('button', 'close', '×'); close.type = 'button'; close.title = 'Закрыть';
  close.onclick = e => { e.stopPropagation(); onClose(); };
  const cap = el('div', 'cap'), title = el('div', 'L'), sub = el('div', 'S'), rows = el('div', 'M'), res = el('div', 'S');
  rows.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 12px';
  box.append(close, cap, title, sub, rows, res);
  const host = () => document.getElementById('ui') || document.body;   // inside #ui: «H» hides it with the other panels
  const row = (name, value) => { rows.append(el('span', null, name), el('span', null, value)); };

  return {
    el: box,
    show(s) {
      if (!s) { box.remove(); return; }
      if (!box.isConnected) host().appendChild(box);
      cap.textContent = 'Район';
      title.textContent = s.name;
      sub.textContent = `${s.provinceName} · ${s.regionName} · ${KIND_TITLE[KIND_ID.indexOf(s.kind)]}, район № ${s.id + 1}, соседей ${s.neighbours}`;
      rows.textContent = '';
      row('Площадь', `${num(s.area)} км²`);
      if (s.kind === 'land') row('из них суша', `${num(s.landArea)} км²`);
      row('Чанков', num(s.chunks));
      if (s.kind === 'land') {
        row('Лес', pct(s.share.forest)); row('Болота', pct(s.share.swamp)); row('Застройка', pct(s.share.built)); row('Поля', pct(s.share.fields));
        if (s.classes) {                                            // how level the ground is, chunk by chunk
          for (let k = 1; k <= 5; k++) if (s.classes[k]) row(`Земля ${k} класса`, `${num(s.classes[k])} · ${pct(s.classes[k] / s.chunks)}`);
          row('Жилых чанков', num(s.living[2])); if (s.living[1]) row('Едва жилых', num(s.living[1])); if (s.living[0]) row('Нежилых', num(s.living[0]));
        }
        if (s.settle) {                                             // the places of the district and who lives on them (town/villages.js)
          row('Мест под поселения', num(s.settle.places)); row('Поселений', num(s.settle.settlements));
          if (s.settle.villages) row('из них деревень', num(s.settle.villages));
          row('Жителей', num(s.settle.people));
        }
      }
      res.textContent = '';
      const some = s.sums.filter(r => r.value >= .5);
      if (some.length) {
        res.append(el('div', 'cap', 'Ресурсы, сумма по чанкам'));
        const g = el('div', 'M'); g.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 12px;margin-top:4px';
        for (const r of some) g.append(el('span', null, r.title), el('span', null, `${num(r.value)}${r.unit ? ' ' + r.unit : ''}`));
        res.append(g);
        if (some.length < s.sums.length) res.append(el('div', 'S', `Остальных ресурсов (${s.sums.length - some.length}) в районе нет.`));
      } else res.textContent = s.sums.length ? 'Ресурсов в районе нет.' : 'Ресурсов в чанках пока нет: их положит часть «Ресурсы».';
    },
  };
}
