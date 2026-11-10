import { saveSettings } from '../../shared/settings.js';
import { esc } from './hud.js';

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- modal helpers
export function openModal(id) { $(id).classList.add('open'); }
export function closeModal(id) { $(id).classList.remove('open'); }
export function anyModalOpen() { return !!document.querySelector('.modal-back.open'); }
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => closeModal(b.dataset.close);
for (const back of document.querySelectorAll('.modal-back')) back.addEventListener('click', e => { if (e.target === back && back.id !== 'menu') back.classList.remove('open'); });

// ---------------------------------------------------------------- settings (declarative)
// apply(key, value) is called live; keys marked reload:true take effect after restart.
// The launcher shows the same keys under the same section names and labels.

// Resolution list: 'native' + common sizes that fit this screen, in physical pixels (CSS size × devicePixelRatio).
// 'WxH' means: in window mode — the size of the window's picture; in fullscreen / maximized — the internal render
// resolution, stretched to the screen by the sharpening upscaler (see main.js, renderScale combines with it).
const COMMON_RES = [[1280, 720], [1280, 800], [1280, 1024], [1366, 768], [1440, 900], [1600, 900], [1600, 1200], [1680, 1050],
  [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440], [2560, 1600], [2880, 1800], [3440, 1440], [3840, 1600], [3840, 2160], [5120, 2160], [5120, 2880]];
function aspectName(w, h) {
  const r = w / h;
  const known = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [5 / 4, '5:4'], [64 / 27, '21:9'], [43 / 18, '21:9'], [12 / 5, '21:9']];
  const k = known.find(([v]) => Math.abs(v - r) < 0.02);
  return k ? k[1] : `${(r).toFixed(2)}:1`;
}
function screenPx() {
  const dpr = window.devicePixelRatio || 1;
  const sw = Math.round((window.screen?.width || window.innerWidth) * dpr), sh = Math.round((window.screen?.height || window.innerHeight) * dpr);
  // logical sizes are rounded (2560 / 1.5 = 1706.67 → 1707): snap back to the panel's real resolution
  const near = COMMON_RES.find(([w, h]) => Math.abs(w - sw) <= 3 && Math.abs(h - sh) <= 3);
  return near ? [near[0], near[1]] : [sw, sh];
}
function resolutionOptions() {
  const [sw, sh] = screenPx();
  // the screen's own size is 'native'
  const list = COMMON_RES.filter(([w, h]) => w <= sw && h <= sh && !(w === sw && h === sh));
  list.sort((a, b) => a[0] * a[1] - b[0] * b[1] || a[0] - b[0]);
  return [['native', `Родное · ${sw} × ${sh}`], ...list.map(([w, h]) => [`${w}x${h}`, `${w} × ${h} · ${aspectName(w, h)}`])];
}
const pct = v => `${Math.round(v * 100)}%`;
const UI_SCALES = [0.75, 0.85, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

const SECTIONS = [
  ['screen', 'Экран'], ['graphics', 'Графика'], ['map', 'Карта'], ['game', 'Игра'],
];
const FIELDS = [
  // ---- Экран
  { sec: 'screen', key: 'windowMode', label: 'Режим окна', type: 'select', options: [['fullscreen', 'Полный экран'], ['maximized', 'Окно на весь экран'], ['window', 'Окно']], hint: 'F11 — полный экран и обратно' },
  { sec: 'screen', key: 'resolution', label: 'Разрешение', type: 'select', options: resolutionOptions,
    hint: s => (s.windowMode === 'window' ? 'В оконном режиме — размер окна.' : 'На весь экран — разрешение отрисовки: картинка растягивается до экрана с повышением резкости.') },
  { sec: 'screen', key: 'uiScale', label: 'Масштаб интерфейса', type: 'select', options: () => [['auto', 'Авто — по размеру экрана'], ...UI_SCALES.map(v => [String(v), pct(v)])],
    hint: (s, x) => (x.ui && x.wanted && x.ui < x.wanted - 0.01 ? `Сейчас ${pct(x.ui)}: крупнее в это окно не помещается` : '') },
  { sec: 'screen', key: 'fpsLimit', label: 'Ограничение кадров', type: 'select', options: [['0', 'Без ограничения'], ['30', '30 кадров/с'], ['60', '60 кадров/с'], ['120', '120 кадров/с'], ['144', '144 кадра/с']], hint: 'Меньше кадров — тише вентиляторы и дольше батарея' },
  { sec: 'screen', key: 'showFps', label: 'Показывать FPS', type: 'check' },
  // ---- Графика
  { sec: 'graphics', key: 'renderScale', label: 'Масштаб рендеринга', type: 'select', options: [['auto', 'Авто — держит частоту кадров'], ['0.5', '50% — максимум FPS'], ['0.67', '67%'], ['0.8', '80%'], ['1', '100% — максимум чёткости']] },
  { sec: 'graphics', key: 'sharpen', label: 'Резкость апскейла', type: 'range', min: 0, max: 1, step: 0.05 },
  { sec: 'graphics', key: 'brightness', label: 'Яркость', type: 'range', min: 0.7, max: 1.3, step: 0.01 },
  { sec: 'graphics', key: 'quality', label: 'Детализация сетки', type: 'select', options: [['auto', 'Авто'], ['low', 'Низкая'], ['medium', 'Средняя'], ['high', 'Высокая']], reload: true },
  { sec: 'graphics', key: 'shaders', label: 'Шейдеры', type: 'select', options: [['full', 'Полные — тени рельефа, рябь, изобаты'], ['simple', 'Простые — быстрее на слабой графике']] },
  { sec: 'graphics', key: 'waterAnimation', label: 'Анимация воды', type: 'check' },
  { sec: 'graphics', note: 'DLSS работает только в нативных движках. Здесь вместо него — масштаб рендеринга с повышением резкости.' },
  // ---- Карта
  { sec: 'map', key: 'reliefScale', label: 'Высота рельефа (1 = как в жизни)', type: 'range', min: 1, max: 10, step: 0.5 },
  { sec: 'map', key: 'unroll', label: 'Разворачивание глобуса', type: 'range', min: 0, max: 1, step: 0.01 },
  { sec: 'map', key: 'showWeather', label: 'Погода: облака, снег, засуха', type: 'check' },
  { sec: 'map', key: 'showWind', label: 'Ветры', type: 'check' },
  { sec: 'map', key: 'effects', label: 'Эффекты стихий', type: 'check' },
  { sec: 'map', key: 'showCurrents', label: 'Морские течения', type: 'check' },
  { sec: 'map', key: 'showLabels', label: 'Подписи природных зон', type: 'check' },
  { sec: 'map', key: 'showRivers', label: 'Реки', type: 'check' },
  { sec: 'map', key: 'showRoads', label: 'Дороги', type: 'check' },
  { sec: 'map', key: 'showDistricts', label: 'Границы районов', type: 'check' },
  // ---- Игра
  { sec: 'game', key: 'autosaveMinutes', label: 'Автосохранение', type: 'select', options: [['0', 'Выключено'], ['5', 'Каждые 5 минут'], ['10', 'Каждые 10 минут'], ['20', 'Каждые 20 минут']] },
  { sec: 'game', key: 'autosaveSlots', label: 'Ячейки автосохранения', type: 'select', options: [['1', '1'], ['3', '3'], ['5', '5'], ['10', '10']], reload: true },
];

const TAB_KEY = 'passionaris.settingsTab';
let refreshSettings = () => {};
// Re-reads option lists and hints (the screen, the 'auto' interface scale) — e.g. after the window moved or resized.
export function refreshSettingsView(extra = {}) { refreshSettings(extra); }

export function buildSettings(settings, apply) {
  const box = $('settings-fields');
  box.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'set-tabs';
  tabs.setAttribute('role', 'tablist');
  box.appendChild(tabs);
  const pages = {};
  let current = 'screen';
  try { const t = localStorage.getItem(TAB_KEY); if (SECTIONS.some(([id]) => id === t)) current = t; } catch { /* storage unavailable */ }
  const show = id => {
    current = id;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.sec === id);
    for (const [k, p] of Object.entries(pages)) p.classList.toggle('on', k === id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* storage unavailable */ }
  };
  for (const [id, name] of SECTIONS) {
    const b = document.createElement('button');
    b.className = 'set-tab'; b.dataset.sec = id; b.textContent = name; b.setAttribute('role', 'tab');
    b.onclick = () => show(id);
    tabs.appendChild(b);
    const p = document.createElement('div');
    p.className = 'set-page'; p.dataset.sec = id;
    box.appendChild(p);
    pages[id] = p;
  }

  const live = []; // [field, element, hintElement]
  const fillOptions = (f, el, extra) => {
    let opts = typeof f.options === 'function' ? f.options() : f.options;
    if (f.key === 'uiScale' && extra.autoUi) opts = opts.map(([v, t]) => (v === 'auto' ? [v, `Авто — сейчас ${pct(extra.autoUi)}`] : [v, t]));
    const cur = String(settings[f.key]);
    // a value set elsewhere (the launcher, another screen) that is not in this list still shows as it is
    if (!opts.some(([v]) => v === cur)) opts = [...opts, [cur, /^\d+x\d+$/.test(cur) ? cur.replace('x', ' × ') : /^[\d.]+$/.test(cur) && f.key === 'uiScale' ? pct(Number(cur)) : cur]];
    el.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    el.value = cur;
  };
  let lastExtra = {}; // { autoUi, ui, wanted } from main.js (interface scale now)
  const fillHint = (f, h) => { if (h) h.textContent = typeof f.hint === 'function' ? f.hint(settings, lastExtra) : f.hint; };

  for (const f of FIELDS) {
    if (f.note) {
      const n = document.createElement('div');
      n.className = 'dim note';
      n.textContent = f.note;
      pages[f.sec].appendChild(n);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'field';
    const id = `set-${f.key}`;
    let input;
    if (f.type === 'select') input = `<select id="${id}"></select>`;
    else if (f.type === 'range') input = `<input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}" />`;
    else input = `<input type="checkbox" id="${id}" />`;
    row.innerHTML = `<label for="${id}">${esc(f.label)}${f.reload ? ' <span class="dim">· после перезапуска</span>' : ''}</label>${input}${f.hint ? '<div class="hint"></div>' : ''}`;
    pages[f.sec].appendChild(row);
    const el = row.querySelector('select, input');
    const hint = row.querySelector('.hint');
    if (f.type === 'select') fillOptions(f, el, {});
    else if (f.type === 'check') el.checked = !!settings[f.key];
    else el.value = String(settings[f.key]);
    fillHint(f, hint);
    live.push([f, el, hint]);
    el.addEventListener('input', () => {
      const v = f.type === 'check' ? el.checked : f.type === 'range' ? Number(el.value) : (isNaN(Number(el.value)) ? el.value : Number(el.value));
      settings[f.key] = v;
      saveSettings(settings);
      apply(f.key, v);
      for (const [g, , h] of live) if (typeof g.hint === 'function') fillHint(g, h);
    });
  }
  refreshSettings = (extra = {}) => {
    lastExtra = extra;
    for (const [f, el, hint] of live) {
      if (f.type === 'select' && typeof f.options === 'function' && document.activeElement !== el) fillOptions(f, el, extra);
      fillHint(f, hint);
    }
  };
  show(current);
}

// ---------------------------------------------------------------- saves dialog
// api: { list(): Promise<[{name, meta}]>, save(name), load(name), remove(name) }
export async function openSaves(api, mode /* 'save' | 'load' */) {
  $('saves-title').textContent = mode === 'save' ? 'Сохранить игру' : 'Загрузить игру';
  $('save-name').parentElement.style.display = mode === 'save' ? '' : 'none';
  openModal('saves');
  const render = async () => {
    const list = await api.list().catch(() => []);
    $('save-list').innerHTML = list.length ? '' : '<div class="dim">Сохранений пока нет</div>';
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'save-row';
      row.innerHTML = `<div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.meta?.dateText || '')}${s.meta?.saved ? ' · ' + esc(new Date(s.meta.saved).toLocaleString('ru-RU')) : ''}</div></div>
        <button data-act="${mode === 'save' ? 'over' : 'load'}">${mode === 'save' ? 'Перезаписать' : 'Загрузить'}</button><button data-act="del">Удалить</button>`;
      const id = s.id ?? s.name;
      row.querySelector('[data-act="del"]').onclick = async () => { await api.remove(id); render(); };
      row.querySelector('[data-act="load"], [data-act="over"]').onclick = async () => {
        if (mode === 'save') { await api.save(s.name); render(); }
        else { await api.load(id); closeModal('saves'); }
      };
      $('save-list').appendChild(row);
    }
  };
  $('save-do').onclick = async () => {
    const name = $('save-name').value.trim() || `Сохранение ${new Date().toLocaleString('ru-RU')}`;
    await api.save(name);
    $('save-name').value = '';
    render();
  };
  await render();
}
