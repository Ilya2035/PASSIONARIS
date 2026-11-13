// The album's own interface: pages on the left, the current page with marks on top, knobs on the right, camera and
// map modes below. Marks and notes are kept in localStorage and can be copied as text for the chat.
// Working interface (docs/UI.md): flat panels and the one button of src/shared/theme.css, coloured by purpose —
// blue: navigation, green / red: the marks «Подходит» / «Не то», red: back to the page's own values, grey: not chosen.
import { DEFS } from './params.js';
import { saveFeedback, loadFeedback, feedbackText } from './feedback.js';

// The knob panel is built from DEFS (params.js): a section per group found there — the known groups in this order and
// under these names, then any new group in the order it first appears (named by its key until it gets a name here).
const GROUP_NAMES = { scale: 'Масштаб объектов', land: 'Земля', light: 'Свет и воздух', layers: 'Слои', modes: 'Режимы и бедствия', system: 'Система' };
const OPEN_GROUPS = new Set(['scale', 'land']);
export function knobGroups(defs = DEFS) {
  const known = Object.keys(GROUP_NAMES), found = [...new Set(defs.map(d => d.group || 'other'))];
  return [...known.filter(g => found.includes(g)), ...found.filter(g => !known.includes(g))]
    .map(key => ({ key, name: GROUP_NAMES[key] || (key === 'other' ? 'Прочее' : key), defs: defs.filter(d => (d.group || 'other') === key) }));
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// a flat panel at one of the album's places (ui.css: .left, .top, .right, .cam)
const panel = (cls, inner) => { const p = el('div', `panel pn ${cls}`); p.append(...[].concat(inner)); return p; };
const button = (cls, text) => { const b = el('button', `btn ${cls}`.trim()); b.type = 'button'; b.textContent = text; return b; };
const fmt = (d, v) => (v === 0 && d.zero ? d.zero : `${Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(d.step < .1 ? 2 : d.step < 1 ? 1 : 0)}${d.unit || ''}`);

export function initUI(album) {
  const root = document.getElementById('ui'), p = album.params, fb = loadFeedback();
  // ---- pages
  const list = el('div', 'pages');
  const rows = new Map();
  let group = null;
  for (const pg of album.pages) {
    if (pg.group !== group) { group = pg.group; list.append(el('div', 'cap pg-group', group)); }
    const r = el('button', 'pg', `<i></i><span>${pg.title}</span>`); r.onclick = () => album.openPage(pg.id); rows.set(pg.id, r); list.append(r);
  }
  const count = el('div', 'S pg-count');
  root.append(panel('left', [el('div', 'hd2', '<span class="cap">Passionaris</span><span class="L">Альбом графики</span>'), list, count]));

  // ---- current page and marks: grey until chosen, then green «Подходит» or red «Не то»
  const title = el('div', 'L'), note = el('div', 'M note'), ok = button('ok off', 'Подходит'), no = button('danger off', 'Не то');
  const memo = el('textarea', 'memo'); memo.placeholder = 'Заметка к этой странице: что нравится, что поправить'; memo.rows = 2;
  const copy = button('', 'Скопировать отзыв'), copied = el('span', 'S copied');
  const marks = el('div', 'row'); marks.append(ok, no, copy);
  root.append(panel('top', [el('div', 'cap', 'Страница альбома'), title, note, memo, marks, copied]));
  const mark = v => { const f = fb[album.page.id] ||= {}; f.mark = f.mark === v ? '' : v; saveFeedback(fb); paint(); };
  ok.onclick = () => mark('ok'); no.onclick = () => mark('no');
  memo.oninput = () => { (fb[album.page.id] ||= {}).note = memo.value; saveFeedback(fb); };
  copy.onclick = async () => {
    const text = feedbackText(album, fb);
    let done = true;
    try { await navigator.clipboard.writeText(text); copied.textContent = 'Скопировано: вставьте в чат'; } catch { done = false; copied.textContent = 'Не удалось скопировать: отзыв сохранён в файле'; }
    copied.classList.toggle('err', !done);
    window.passionaris?.albumFeedback?.(text);
    setTimeout(() => { copied.textContent = ''; }, 5000);
  };

  // ---- knobs
  const knobs = el('div', 'knobs'), ctl = new Map();
  for (const g of knobGroups()) {
    const sec = el('details', 'sec'); if (OPEN_GROUPS.has(g.key)) sec.open = true;
    sec.append(el('summary', 'cap', g.name));
    for (const d of g.defs) {
      const row = el('label', `kn kn-${d.type || 'range'}`); let input, out = null;
      if (d.type === 'select') { input = el('select'); for (const [v, t] of d.options) { const o = el('option', null, t); o.value = v; input.append(o); } input.onchange = () => p.set(d.key, typeof d.value === 'number' ? +input.value : input.value); row.append(el('span', 'S', d.label), input); }
      else if (d.type === 'toggle') { input = el('input', 'toggle'); input.type = 'checkbox'; input.onchange = () => p.set(d.key, input.checked ? 1 : 0); row.append(input, el('span', 'S', d.label)); }
      else { input = el('input'); input.type = 'range'; input.min = d.zero ? Math.min(d.min, 0) : d.min; input.max = d.max; input.step = d.step; out = el('span', 'S val'); input.oninput = () => p.set(d.key, +input.value); row.append(el('span', 'S', d.label), out, input); }
      ctl.set(d.key, { d, input, out }); sec.append(row);
    }
    knobs.append(sec);
  }
  const reset = button('danger', 'Как на странице'); reset.onclick = () => album.openPage(album.page.id, true);
  root.append(panel('right', [el('div', 'cap', 'Настройки вида'), knobs, reset]));

  // ---- camera, places, modes
  const hOut = el('span', 'L'), heights = el('div', 'row');
  for (const h of [20, 50, 200, 500]) { const b = button('sm', `${h} км`); b.onclick = () => album.cam.flyTo({ h }); heights.append(b); }
  const places = el('select'); places.append(Object.assign(el('option', null, 'Перелететь к месту…'), { value: '' }));
  for (const pl of album.data.places) places.append(Object.assign(el('option', null, pl.name), { value: pl.id }));
  places.onchange = () => { const pl = album.data.places.find(x => x.id === places.value); if (pl) album.cam.flyTo({ lat: pl.lat, lon: pl.lon, h: Math.min(album.cam.t.h, 120), tilt: 50 }); places.value = ''; };
  const fps = el('span', 'S');
  root.append(panel('cam', [el('div', 'cap', 'Высота камеры'), hOut, heights, places, fps]));
  const modes = el('div', 'modes');
  const MODES = [['Политика', { look: 'paper', forest3d: 0, division: 0, data: 0 }], ['Деление', { look: 'paper', forest3d: 0, division: 1, data: 0 }], ['Природа', { look: 'natural', forest3d: 1, division: 0, data: 0 }], ['Данные', { data: 1, forest3d: 0, division: 0 }]];
  const mBtns = MODES.map(([name, set]) => { const b = button('off album-mode', name); b.onclick = () => p.setMany(set); modes.append(b); return b; });
  root.append(modes);
  const back = button('back', 'В лаунчер'); back.onclick = () => window.passionaris?.exitToLauncher?.(); root.append(back);
  // the strip stays one line (the scale bar of the map stands right above it); the whole list of the keys is its tooltip
  const keys = el('div', 'hint S', 'Колесо — высота · левая кнопка, край экрана, W A S D — двигать · правая кнопка, Q E R F — вращать и наклонять · двойной щелчок — лететь · H — скрыть панели');
  keys.title = 'Колесо — ближе и дальше, к точке под курсором · курсор у края экрана, W A S D или стрелки — двигать (с Shift быстрее) · левая кнопка — тащить карту · средняя или правая — вращать и наклонять · Q и E — поворот · R и F — наклон · двойной щелчок — лететь · N — север вверху · 1–4 — высоты · H — скрыть панели';
  root.append(keys);

  function paint() {
    const pg = album.page; title.textContent = pg.title; note.textContent = pg.note; memo.value = fb[pg.id]?.note || '';
    ok.classList.toggle('off', fb[pg.id]?.mark !== 'ok'); no.classList.toggle('off', fb[pg.id]?.mark !== 'no');
    let nOk = 0, nNo = 0;
    for (const [id, r] of rows) { const m = fb[id]?.mark || ''; r.dataset.mark = m; r.classList.toggle('on', id === pg.id); if (m === 'ok') nOk++; if (m === 'no') nNo++; }
    count.textContent = `Страниц ${rows.size} · подходит ${nOk} · не то ${nNo}`;
    rows.get(pg.id)?.scrollIntoView({ block: 'nearest' });
  }
  function sync() {
    for (const [k, c] of ctl) { const v = p.get(k); if (c.d.type === 'toggle') c.input.checked = !!v; else c.input.value = v; if (c.out) c.out.textContent = fmt(c.d, v); }
    const cur = p.get('data') ? 3 : p.get('division') ? 1 : p.get('look') === 'paper' ? 0 : 2; mBtns.forEach((b, i) => b.classList.toggle('off', i !== cur));
  }
  p.on(sync); album.onPage = () => { paint(); sync(); };
  album.cam.on(s => { hOut.textContent = `${s.h < 100 ? s.h.toFixed(0) : Math.round(s.h / 10) * 10} км`; });
  album.onFps = f => { fps.textContent = `${f.toFixed(0)} кадров в секунду`; };
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyH') root.classList.toggle('hidden');
    if (e.code === 'Escape') window.passionaris?.exitToLauncher?.();
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { const i = album.pages.indexOf(album.page) + (e.code === 'ArrowDown' ? 1 : -1); if (album.pages[i]) album.openPage(album.pages[i].id); e.preventDefault(); }
  });
  canvasDblClick(album);
  paint(); sync();
}

// double click flies to the clicked ground point (found by marching the view ray down to the height data)
function canvasDblClick(album) {
  const dom = album.renderer.domElement;
  dom.addEventListener('dblclick', async e => {
    const { Raycaster, Vector2, Vector3 } = await import('three'); const { fromWorld, R } = await import('./geo.js');
    const rc = new Raycaster(); rc.setFromCamera(new Vector2(e.clientX / dom.clientWidth * 2 - 1, -(e.clientY / dom.clientHeight) * 2 + 1), album.cam.cam);
    const o = rc.ray.origin.clone().add(new Vector3(0, R, 0)), d = rc.ray.direction, b = o.dot(d), c = o.dot(o) - R * R, disc = b * b - c;
    if (disc < 0) return;
    const hit = rc.ray.origin.clone().addScaledVector(d, -b - Math.sqrt(disc)), ll = fromWorld(hit);
    album.cam.flyTo({ lat: ll.lat, lon: ll.lon, h: Math.max(20, album.cam.t.h * .55) });
  });
}
