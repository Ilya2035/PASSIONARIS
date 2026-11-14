// The block with what a district holds, opened by a click on the map. A plain panel of the working interface
// (docs/UI.md): flat fill and frame from src/shared/theme.css (.panel, .close), the album's text sizes (.L, .M, .S,
// .cap). Only its place on the screen is set here: right of the album's top panel; on the map alone (mapview.js), at
// the right edge of the screen.
// It lists the settlements of the district (the owner, 13.11.2026: «по щелчку на район — список его городов и деревень:
// значок — та же отметка, что на карте — и площадь в км² по чанкам»): the town of the district first, then its
// villages. A click on a row flies the camera to that settlement.
// Under them, the passes on the border of the district (the list is laid by the roads): the mark of a pass as on the
// map, its name, the road that crosses it and the district beyond, its height in metres.
import { KIND_TITLE, KIND_ID } from './build.js';
import { markSvg, passSvg } from '../layers/labels.js';
import { CLASSES, RANKS, PASS_RANKS, PASS_ROAD } from '../town/rules.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pct = v => `${Math.round(v * 100)} %`;
const num = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ru-RU') : (Math.round(v * 10) / 10).toLocaleString('ru-RU'));
const CSS = `
.district-info { top: 20px; right: 358px; width: 372px; z-index: 4; max-height: calc(100% - 40px); }
body.mapview #ui > .district-info { right: 20px; }
.district-info .di-scroll { overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.district-info .di-list { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto auto; gap: 3px 10px; align-items: center; }
.district-info .di-list .hd { color: var(--c-text-dim); font: 400 var(--fs-s)/1.3 var(--font-ui); }
.district-info .di-list .nm { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.district-info .di-list .nm:hover { text-decoration: underline; }
.district-info .di-list .nm small { color: var(--c-text-dim); font: 400 var(--fs-s)/1.2 var(--font-ui); margin-left: 6px; }
.district-info .di-list .nm.tw { white-space: normal; }
.district-info .di-list .nm.tw small { display: block; margin-left: 0; }
.district-info .di-list .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.district-info .di-list .mk { width: 20px; height: 20px; display: flex; }
`;
// the class of a settlement in words, as the list of the panel writes it
export const classTitle = s => (s.partOf ? `часть города ${s.partOf}` : s.capital ? `${CLASSES[s.cls].title} · ${RANKS[{ province: 3, land: 4, region: 5 }[s.capital]].title}` : s.town && s.cls === 0 ? 'город района (пока деревня)' : CLASSES[s.cls].title);

// a pass in words, as the list of the panel writes it: what it is, the road over it, the district beyond
export const passTitle = q => [q.rank === 0 ? PASS_RANKS[0].title : '', PASS_ROAD[q.kind], q.to ? `в район ${q.to}` : ''].filter(Boolean).join(' · ');

export function createPanel(onClose, onGo = null) {
  const box = el('div', 'panel pn district-info');
  if (typeof document !== 'undefined' && !document.getElementById('district-info-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'district-info-css', textContent: CSS }));
  const close = el('button', 'close', '×'); close.type = 'button'; close.title = 'Закрыть';
  close.onclick = e => { e.stopPropagation(); onClose(); };
  const cap = el('div', 'cap'), title = el('div', 'L'), sub = el('div', 'S'), scroll = el('div', 'di-scroll'), towns = el('div'), ways = el('div'), rows = el('div', 'M'), res = el('div', 'S');
  rows.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 12px';
  scroll.append(towns, ways, rows, res);
  box.append(close, cap, title, sub, scroll);
  const host = () => document.getElementById('ui') || document.body;   // inside #ui: «H» hides it with the other panels
  const row = (name, value) => { rows.append(el('span', null, name), el('span', null, value)); };
  // a click on a settlement of the list: the camera flies there and comes down to where its houses can be seen
  const go = onGo || (s => { const cam = globalThis.__album?.cam; if (cam) cam.flyTo({ lat: s.lat, lon: s.lon, h: Math.min(cam.t.h, 40) }); });
  // the settlements of the district: mark, name and class, people, area by chunks of 1 km²
  function list(st) {
    towns.textContent = '';
    if (!st?.list?.length) return;
    const all = st.list, town = all.filter(s => s.town && !s.partOf).length, vill = all.filter(s => !s.town).length;
    towns.append(el('div', 'cap', `Поселения: ${town ? 'город' : 'города нет'}${vill ? ` и ${vill} ${vill % 10 === 1 && vill % 100 !== 11 ? 'деревня' : vill % 10 >= 2 && vill % 10 <= 4 && (vill % 100 < 12 || vill % 100 > 14) ? 'деревни' : 'деревень'}` : ''}`));
    const g = el('div', 'M di-list'); g.style.marginTop = '4px';
    g.append(el('span'), el('span', 'hd', 'Название и класс'), el('span', 'hd r', 'Жителей'), el('span', 'hd r', 'Площадь'));
    for (const s of all) {
      const mk = el('span', 'mk'); mk.innerHTML = s.partOf ? '' : markSvg(s.cls, s.rank, false);            // (the mark is this file's own markup; the name below is text)
      const nm = el('span', s.town ? 'nm tw' : 'nm'); nm.append(el('span', null, s.name || 'Без названия'), el('small', null, classTitle(s)));
      nm.title = `${s.name || 'Без названия'} — ${classTitle(s)}. Щелчок: показать на карте`;
      if (s.lat !== undefined) nm.onclick = e => { e.stopPropagation(); go(s); };
      g.append(mk, nm, el('span', 'r', s.partOf ? '' : num(s.people)), el('span', 'r', s.partOf ? '' : `${num(s.areaKm2)} км²`));
    }
    towns.append(g, el('div', 'S', 'Площадь — число чанков по 1 км², на которых стоят дома поселения.'));
  }
  // the passes on the border of the district: mark, name, the road and the district beyond, height
  function passes(st) {
    ways.textContent = '';
    const all = st?.passes; if (!all?.length) return;
    ways.append(el('div', 'cap', `Перевалы на границе района: ${all.length}`));
    const g = el('div', 'M di-list'); g.style.marginTop = '4px';
    for (const q of all) {
      const mk = el('span', 'mk'); mk.innerHTML = passSvg(q.rank, false);                                    // (the mark is this file's own markup; the name below is text)
      const nm = el('span', 'nm tw'); nm.append(el('span', null, q.name || 'Перевал без названия'), el('small', null, passTitle(q)));
      nm.title = `${q.name || 'Перевал'}, ${q.h} м — ${passTitle(q)}. Щелчок: показать на карте`;
      if (q.lat !== undefined) nm.onclick = e => { e.stopPropagation(); go(q); };
      g.append(mk, nm, el('span'), el('span', 'r', `${q.h.toLocaleString('ru-RU')} м`));
    }
    ways.append(g);
  }

  return {
    el: box,
    show(s) {
      if (!s) { box.remove(); return; }
      if (!box.isConnected) host().appendChild(box);
      cap.textContent = 'Район';
      title.textContent = s.name;
      sub.textContent = `${s.provinceName} · ${s.regionName} · ${KIND_TITLE[KIND_ID.indexOf(s.kind)]}, район № ${s.id + 1}, соседей ${s.neighbours}`;
      list(s.kind === 'land' ? s.settle : null); passes(s.kind === 'land' ? s.settle : null);
      rows.textContent = '';
      row('Площадь', `${num(s.area)} км²`);
      if (s.kind === 'land') row('из них суша', `${num(s.landArea)} км²`);
      row('Чанков', num(s.chunks));
      if (s.kind === 'land') {
        if (s.settle) {                                             // the places of the district and who lives on them (town/villages.js)
          row('Жителей', num(s.settle.people)); row('Поселений', num(s.settle.settlements));
          row('Мест под поселения', num(s.settle.places));
          if (s.place) row('Место города', s.place);              // why the town of the district stands where it stands (division/centres.js)
          if (s.settle.tracksKm >= .5) row('Тропы к деревням', `${num(s.settle.tracksKm)} км`);
        }
        row('Лес', pct(s.share.forest)); row('Болота', pct(s.share.swamp)); row('Застройка', pct(s.share.built));
        row('Поля', s.settle ? `${num(s.settle.fieldsKm2)} км² · ${pct(s.share.fields)}` : pct(s.share.fields));
        if (s.classes) {                                            // how level the ground is, chunk by chunk
          for (let k = 1; k <= 5; k++) if (s.classes[k]) row(`Земля ${k} класса`, `${num(s.classes[k])} · ${pct(s.classes[k] / s.chunks)}`);
          row('Жилых чанков', num(s.living[2])); if (s.living[1]) row('Едва жилых', num(s.living[1])); if (s.living[0]) row('Нежилых', num(s.living[0]));
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
