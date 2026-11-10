// The album's own interface: pages on the left, the current page with marks on top, knobs on the right, camera and
// map modes below. Marks and notes are kept in localStorage and can be copied as text for the chat.
import { DEFS } from './params.js';
import { saveFeedback, loadFeedback, feedbackText } from './feedback.js';

const GROUPS = [['scale', 'Масштаб объектов'], ['land', 'Земля'], ['light', 'Свет и воздух'], ['layers', 'Слои'], ['modes', 'Режимы и бедствия'], ['system', 'Система']];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const panel = (cls, inner) => { const p = el('div', `pn ch ${cls}`); const i = el('div', 'in ch'); i.append(...[].concat(inner)); p.append(i); return p; };
const fmt = (d, v) => (v === 0 && d.zero ? d.zero : `${Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(d.step < .1 ? 2 : d.step < 1 ? 1 : 0)}${d.unit || ''}`);

export function initUI(album) {
  const root = document.getElementById('ui'), p = album.params, fb = loadFeedback();
  // ---- pages
  const list = el('div', 'pages');
  const rows = new Map();
  let group = null;
  for (const pg of album.pages) {
    if (pg.group !== group) { group = pg.group; list.append(el('div', 'S gold pg-group', group)); }
    const r = el('button', 'pg', `<i></i><span>${pg.title}</span>`); r.onclick = () => album.openPage(pg.id); rows.set(pg.id, r); list.append(r);
  }
  const count = el('div', 'S pg-count');
  root.append(panel('left', [el('div', 'hd2', '<span class="S gold">Passionaris</span><span class="L">Альбом графики</span>'), list, count]));

  // ---- current page and marks
  const title = el('div', 'L'), note = el('div', 'M note'), ok = el('button', 'bt ch ok', '<span>Подходит</span>'), no = el('button', 'bt ch no', '<span>Не то</span>');
  const memo = el('textarea', 'memo'); memo.placeholder = 'Заметка к этой странице: что нравится, что поправить'; memo.rows = 2;
  const copy = el('button', 'bt ch pri', '<span>Скопировать отзыв</span>'), copied = el('span', 'S copied');
  const marks = el('div', 'row'); marks.append(ok, no, copy);
  root.append(panel('top', [el('div', 'S gold', 'Страница альбома'), title, note, memo, marks, copied]));
  const mark = v => { const f = fb[album.page.id] ||= {}; f.mark = f.mark === v ? '' : v; saveFeedback(fb); paint(); };
  ok.onclick = () => mark('ok'); no.onclick = () => mark('no');
  memo.oninput = () => { (fb[album.page.id] ||= {}).note = memo.value; saveFeedback(fb); };
  copy.onclick = async () => {
    const text = feedbackText(album, fb);
    try { await navigator.clipboard.writeText(text); copied.textContent = 'Скопировано: вставьте в чат'; } catch { copied.textContent = 'Не удалось скопировать: отзыв сохранён в файле'; }
    window.passionaris?.albumFeedback?.(text);
    setTimeout(() => { copied.textContent = ''; }, 5000);
  };

  // ---- knobs
  const knobs = el('div', 'knobs'), ctl = new Map();
  for (const [g, gname] of GROUPS) {
    const sec = el('details', 'sec'); if (g === 'scale' || g === 'land') sec.open = true;
    sec.append(el('summary', 'S gold', gname));
    for (const d of DEFS.filter(x => x.group === g)) {
      const row = el('label', `kn kn-${d.type || 'range'}`); let input, out = null;
      if (d.type === 'select') { input = el('select'); for (const [v, t] of d.options) { const o = el('option', null, t); o.value = v; input.append(o); } input.onchange = () => p.set(d.key, typeof d.value === 'number' ? +input.value : input.value); row.append(el('span', 'S', d.label), input); }
      else if (d.type === 'toggle') { input = el('input'); input.type = 'checkbox'; input.onchange = () => p.set(d.key, input.checked ? 1 : 0); row.append(input, el('span', 'S', d.label)); }
      else { input = el('input'); input.type = 'range'; input.min = d.zero ? Math.min(d.min, 0) : d.min; input.max = d.max; input.step = d.step; out = el('span', 'S val'); input.oninput = () => p.set(d.key, +input.value); row.append(el('span', 'S', d.label), out, input); }
      ctl.set(d.key, { d, input, out }); sec.append(row);
    }
    knobs.append(sec);
  }
  const reset = el('button', 'bt ch', '<span>Как на странице</span>'); reset.onclick = () => album.openPage(album.page.id, true);
  root.append(panel('right', [el('div', 'S gold', 'Настройки вида'), knobs, reset]));

  // ---- camera, places, modes
  const hOut = el('span', 'L'), heights = el('div', 'row');
  for (const h of [20, 50, 200, 500]) { const b = el('button', 'bt ch sm', `<span>${h} км</span>`); b.onclick = () => album.cam.flyTo({ h }); heights.append(b); }
  const places = el('select'); places.append(Object.assign(el('option', null, 'Перелететь к месту…'), { value: '' }));
  for (const pl of album.data.places) places.append(Object.assign(el('option', null, pl.name), { value: pl.id }));
  places.onchange = () => { const pl = album.data.places.find(x => x.id === places.value); if (pl) album.cam.flyTo({ lat: pl.lat, lon: pl.lon, h: Math.min(album.cam.t.h, 120), tilt: 50 }); places.value = ''; };
  const fps = el('span', 'S');
  root.append(panel('cam', [el('div', 'S gold', 'Высота камеры'), hOut, heights, places, fps]));
  const modes = el('div', 'modes');
  const MODES = [['Политика', { look: 'paper', forest3d: 0, division: 0, data: 0 }], ['Деление', { look: 'paper', forest3d: 0, division: 1, data: 0 }], ['Природа', { look: 'natural', forest3d: 1, division: 0, data: 0 }], ['Данные', { data: 1, forest3d: 0, division: 0 }]];
  const mBtns = MODES.map(([name, set]) => { const b = el('button', 'md ch', `<span class="S">${name}</span>`); b.onclick = () => p.setMany(set); modes.append(b); return b; });
  root.append(modes);
  const back = el('button', 'bt ch back', '<span>В лаунчер</span>'); back.onclick = () => window.passionaris?.exitToLauncher?.(); root.append(back);
  root.append(el('div', 'hint S', 'Колесо — высота · левая кнопка — двигать · средняя или правая — вращать и наклонять · двойной щелчок — лететь · 1–4 — высоты · H — скрыть панели'));

  function paint() {
    const pg = album.page; title.textContent = pg.title; note.textContent = pg.note; memo.value = fb[pg.id]?.note || '';
    ok.classList.toggle('on', fb[pg.id]?.mark === 'ok'); no.classList.toggle('on', fb[pg.id]?.mark === 'no');
    let nOk = 0, nNo = 0;
    for (const [id, r] of rows) { const m = fb[id]?.mark || ''; r.dataset.mark = m; r.classList.toggle('on', id === pg.id); if (m === 'ok') nOk++; if (m === 'no') nNo++; }
    count.textContent = `Страниц ${rows.size} · подходит ${nOk} · не то ${nNo}`;
    rows.get(pg.id)?.scrollIntoView({ block: 'nearest' });
  }
  function sync() {
    for (const [k, c] of ctl) { const v = p.get(k); if (c.d.type === 'toggle') c.input.checked = !!v; else c.input.value = v; if (c.out) c.out.textContent = fmt(c.d, v); }
    const cur = p.get('data') ? 3 : p.get('division') ? 1 : p.get('look') === 'paper' ? 0 : 2; mBtns.forEach((b, i) => b.classList.toggle('on', i === cur));
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
