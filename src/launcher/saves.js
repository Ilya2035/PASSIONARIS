// Saves panel on the launcher's main page: every save (newest first) with its thumbnail, in-game date, real
// date/time, autosave / quick-save marker and game version; «Загрузить», «Удалить», «Папка сохранений».
//
// Storage: the same adapters the game uses (src/save: Electron files → IndexedDB → memory). Loading a save works
// like «Продолжить»: the id goes to localStorage 'passionaris.continue' and the game picks it up on start.
import { VERSION } from '../shared/version.js';
import { formatRu, eraOf } from '../sim/calendar.js';
import { confirmDialog } from './dialog.js';

const $ = id => document.getElementById(id);
const QUICK_NAME = 'Быстрое сохранение';
const AUTO_RE = /^autosave-\d+$/;

const GLOBE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 12h17M12 3.5c-3 3-3 14 0 17M12 3.5c3 3 3 14 0 17" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 9.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="currentColor"/></svg>';
const WARN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 9.5v5M12 16.5v1.6" stroke="currentColor" stroke-width="1.6"/></svg>';

/** «только что», «12 мин назад», «сегодня, 09:01», «вчера, 18:40», «7 ноября, 04:13», «3 марта 2025 г., 11:00». */
export function formatRealTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms), n = new Date(now);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const diff = now - ms;
  if (diff >= 0 && diff < 60e3) return 'только что';
  if (diff >= 0 && diff < 3600e3) return `${Math.floor(diff / 60e3)} мин назад`;
  const day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (ms >= day0 && ms < day0 + 864e5) return `сегодня, ${time}`;
  if (ms >= day0 - 864e5 && ms < day0) return `вчера, ${time}`;
  const opts = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== n.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('ru-RU', opts)}, ${time}`;
}

const sizeText = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

/** Plain description of one storage entry (SaveInfo) for the list. */
export function describeSave(info, { quickId = QUICK_NAME, formatVersion = 1 } = {}) {
  const m = info.meta || {};
  const bad = !!info.error || !m || typeof m !== 'object';
  const kind = bad ? 'bad' : (m.autosave || AUTO_RE.test(info.id)) ? 'auto' : (info.id === quickId ? 'quick' : 'manual');
  const t = Number(m.t);
  const date = bad ? '' : (m.dateText || m.dateLabel || (Number.isFinite(t) ? formatRu(t, 'day') : ''));
  let era = '';
  try { if (!bad && Number.isFinite(t)) era = eraOf(t).nameRu; } catch { /* outside the calendar */ }
  const modified = info.modified || Date.parse(m.created) || 0;
  const tooNew = !bad && Number(info.formatVersion) > formatVersion;
  return {
    id: info.id, kind, bad, tooNew,
    name: (!bad && typeof m.name === 'string' && m.name.trim()) || info.id,
    date, era, modified,
    version: info.gameVersion || '',
    otherVersion: !!info.gameVersion && info.gameVersion !== VERSION,
    thumbnail: !bad && typeof m.thumbnail === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(m.thumbnail) ? m.thumbnail : null,
    size: info.size || 0,
    error: info.error || '',
  };
}

/**
 * @param {object} o
 * @param {() => object} o.getSettings      current settings (autosave interval for the empty-state hint)
 * @param {(id: string) => void} o.onLoad    launch the game into that save
 * @param {(latest: object|null) => void} o.onLatest   newest loadable save (for «Продолжить»)
 */
export function createSavesPanel({ getSettings, onLoad, onLatest }) {
  const list = $('save-list'), countEl = $('saves-count'), status = $('saves-status');
  const loadBtn = $('save-load'), delBtn = $('save-delete'), folderBtn = $('saves-folder');
  let storage = null, saveLib = null, items = [], selected = null, busy = false, statusTimer = 0;

  const canOpenFolder = typeof window.passionaris?.openSavesFolder === 'function';
  folderBtn.hidden = !canOpenFolder;
  folderBtn.onclick = async () => {
    try {
      const err = await window.passionaris.openSavesFolder();
      if (err) say(`Не удалось открыть папку: ${err}`, true);
    } catch (e) { say(`Не удалось открыть папку: ${e.message || e}`, true); }
  };

  function say(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => { status.textContent = ''; }, 6000);
  }

  async function ensureStorage() {
    if (storage) return storage;
    saveLib = await import('../save/index.js');
    storage = saveLib.createDefaultStorage();
    return storage;
  }

  function select(id, scroll = false) {
    selected = items.find(s => s.id === id) || null;
    for (const row of list.querySelectorAll('.save-row')) {
      const on = row.dataset.id === selected?.id;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', String(on));
      row.tabIndex = on ? 0 : -1;
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    }
    loadBtn.disabled = !selected || selected.bad || selected.tooNew || busy;
    delBtn.disabled = !selected || busy;
    loadBtn.title = !selected ? '' : selected.bad ? 'Файл не читается' : selected.tooNew ? 'Сохранено более новой версией игры' : `Загрузить «${selected.name}»`;
  }

  function rowFor(s) {
    const row = document.createElement('div');
    row.className = `save-row kind-${s.kind}`;
    row.dataset.id = s.id;
    row.setAttribute('role', 'option');
    const thumb = document.createElement('div');
    thumb.className = 'save-thumb';
    if (s.thumbnail) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = s.thumbnail;
      thumb.appendChild(img);
    } else {
      thumb.classList.add('empty');
      thumb.innerHTML = s.bad ? WARN_SVG : GLOBE_SVG;
    }
    const body = document.createElement('div');
    body.className = 'save-body';
    const l1 = document.createElement('div');
    l1.className = 'save-l1';
    const name = document.createElement('span');
    name.className = 'save-name';
    name.textContent = s.name;
    l1.appendChild(name);
    const chipText = { auto: 'Авто', quick: 'Быстрое', bad: 'Повреждён' }[s.kind];
    if (chipText) {
      const chip = document.createElement('span');
      chip.className = `save-chip ${s.kind}`;
      chip.textContent = chipText;
      chip.title = { auto: 'Автосохранение', quick: 'Быстрое сохранение — F5', bad: 'Файл не читается' }[s.kind];
      l1.appendChild(chip);
    }
    const l2 = document.createElement('div');
    l2.className = 'save-date';
    if (s.bad) l2.textContent = 'Файл не читается — можно только удалить';
    else {
      l2.textContent = s.date;
      // the era is dropped first on a narrow panel (container query in launcher.css)
      if (s.era) l2.appendChild(Object.assign(document.createElement('span'), { className: 'save-era', textContent: ` · ${s.era}` }));
    }
    const l3 = document.createElement('div');
    l3.className = 'save-sub';
    const when = document.createElement('span');
    when.textContent = formatRealTime(s.modified);
    if (s.modified) when.title = new Date(s.modified).toLocaleString('ru-RU');
    l3.appendChild(when);
    if (s.version || s.bad) {
      const v = document.createElement('span');
      v.className = 'save-ver' + (s.otherVersion || s.tooNew ? ' other' : '');
      v.textContent = s.bad ? sizeText(s.size) : `v${s.version}`;
      v.title = s.bad ? s.error : s.tooNew ? 'Сохранено более новой версией игры — обновите игру'
        : s.otherVersion ? `Сохранено в версии v${s.version}, сейчас v${VERSION}` : 'Текущая версия игры';
      l3.append(' · ', v);
    }
    body.append(l1, l2, l3);
    row.append(thumb, body);
    row.title = s.bad ? s.error : `${s.name}${s.date ? ' · ' + s.date : ''}`;
    row.onclick = () => select(s.id);
    row.ondblclick = () => { if (!s.bad && !s.tooNew) load(s); };
    return row;
  }

  function emptyState() {
    const minutes = Number(getSettings()?.autosaveMinutes ?? 10);
    const box = document.createElement('div');
    box.className = 'saves-empty';
    box.innerHTML = `${GLOBE_SVG}<b>Сохранений пока нет</b><span></span>`;
    box.querySelector('span').innerHTML = `Сохранения есть у прежней игры на глобусе: нажмите «Глобус: прежняя игра» — мир начнётся в 5000 г. до н.э. `
      + (minutes > 0 ? `Автосохранение — каждые ${minutes} мин` : 'Автосохранение выключено (Настройки → Игра)')
      + ', быстрое сохранение&nbsp;—&nbsp;<kbd>F5</kbd>.';
    return box;
  }

  async function refresh() {
    let raw;
    try {
      raw = await (await ensureStorage()).list();
    } catch (e) {
      console.warn('[launcher] saves', e);
      list.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'saves-empty';
      box.innerHTML = `${WARN_SVG}<b>Список сохранений недоступен</b><span></span>`;
      box.querySelector('span').textContent = String(e?.message || e);
      list.appendChild(box);
      countEl.textContent = '';
      items = []; select(null); onLatest?.(null);
      return;
    }
    const fv = saveLib?.FORMAT_VERSION ?? 1;
    const quickId = saveLib?.slugSaveId ? saveLib.slugSaveId(QUICK_NAME) : QUICK_NAME;
    items = (raw || []).map(i => describeSave(i, { quickId, formatVersion: fv }))
      .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name, 'ru'));
    const keep = selected?.id;
    list.innerHTML = '';
    if (!items.length) list.appendChild(emptyState());
    else for (const s of items) list.appendChild(rowFor(s));
    countEl.textContent = items.length ? String(items.length) : '';
    document.getElementById('saves-panel').classList.toggle('is-empty', !items.length);
    const latest = items.find(s => !s.bad && !s.tooNew) || null;
    select(items.some(s => s.id === keep) ? keep : (latest || items[0])?.id);
    onLatest?.(latest);
    updateFade();
  }

  // a soft fade at the bottom edge while more rows are below
  function updateFade() {
    list.classList.toggle('more', list.scrollHeight - list.scrollTop - list.clientHeight > 4);
  }
  list.addEventListener('scroll', updateFade, { passive: true });
  window.addEventListener('resize', updateFade);

  function load(s) {
    if (!s || s.bad || s.tooNew || busy) return;
    busy = true;
    select(s.id);
    say(`Запускаю «${s.name}»…`);
    onLoad(s.id);
  }

  async function remove(s) {
    if (!s || busy) return;
    const recycle = storage?.kind === 'electron';
    const ok = await confirmDialog({
      title: 'Удалить сохранение?',
      text: s.bad ? `«${s.name}» — файл не читается.` : `«${s.name}»${s.date ? ` · ${s.date}` : ''}`,
      note: recycle ? 'Файл будет перемещён в корзину — оттуда его можно восстановить.'
        : 'Сохранение будет удалено из браузера без возможности восстановления.',
      yes: 'Удалить', danger: true,
    });
    if (!ok) return;
    busy = true; select(s.id);
    try {
      const existed = await storage.remove(s.id);
      say(existed === false ? 'Этого сохранения уже нет' : (recycle ? `«${s.name}» — в корзине` : `«${s.name}» удалено`));
    } catch (e) {
      say(`Не удалось удалить: ${e?.message || e}`, true);
    }
    busy = false;
    // keep the selection near the removed row
    const idx = items.findIndex(x => x.id === s.id);
    const next = items[idx + 1] || items[idx - 1];
    selected = next || null;
    await refresh();
  }

  loadBtn.onclick = () => load(selected);
  delBtn.onclick = () => remove(selected);
  list.addEventListener('keydown', e => {
    if (!items.length) return;
    const k = items.findIndex(s => s.id === selected?.id);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = Math.max(0, Math.min(items.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)));
      select(items[n].id, true);
      list.querySelector('.save-row.sel')?.focus();
      e.preventDefault();
    } else if (e.key === 'Enter') { load(selected); e.preventDefault(); }
    else if (e.key === 'Delete') { remove(selected); e.preventDefault(); }
  });
  // files added or removed by hand while the launcher is open: re-read when the window gets the focus back
  let lastFocusRefresh = 0;
  window.addEventListener('focus', () => {
    if (busy || Date.now() - lastFocusRefresh < 1500) return;
    lastFocusRefresh = Date.now();
    refresh();
  });

  return { refresh, get items() { return items; } };
}
