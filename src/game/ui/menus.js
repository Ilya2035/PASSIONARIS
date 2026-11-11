import {
  SETTING_SECTIONS, sectionFields, settingOptions, settingHint, formatSetting, parseSetting, updateStoredSettings,
} from '../../shared/settings.js';
import { esc } from './hud.js';

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- modal helpers
export function openModal(id) { $(id).classList.add('open'); }
export function closeModal(id) { $(id).classList.remove('open'); }
export function anyModalOpen() { return !!document.querySelector('.modal-back.open'); }
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => closeModal(b.dataset.close);
for (const back of document.querySelectorAll('.modal-back')) back.addEventListener('click', e => { if (e.target === back && back.id !== 'menu') back.classList.remove('open'); });

// ---------------------------------------------------------------- settings
// Every setting — label, hint, section, list of values — comes from src/shared/settings.js (SETTING_FIELDS): the
// launcher builds its settings from the same description, so both show the same values under the same names.
// apply(key, value) is called live; fields marked reload: 'game' take effect at the next start.
// 'WxH' resolutions are physical pixels: in window mode — the size of the window's picture; in fullscreen / maximized —
// the internal render resolution, stretched to the screen by the sharpening upscaler (see main.js).

const TAB_KEY = 'passionaris.settingsTab';
const SECTIONS = SETTING_SECTIONS.filter(s => s.where !== 'launcher');
const bridge = typeof window !== 'undefined' ? window.passionaris : undefined;
const RELOAD = ' <span class="dim">· после перезапуска</span>';
let refreshSettings = () => {};
// Re-reads option lists and hints (the screens, the 'auto' interface scale) — e.g. after the window moved or resized.
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
  try { const t = localStorage.getItem(TAB_KEY); if (SECTIONS.some(s => s.id === t)) current = t; } catch { /* storage unavailable */ }
  const show = id => {
    current = id;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.sec === id);
    for (const [k, p] of Object.entries(pages)) p.classList.toggle('on', k === id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* storage unavailable */ }
  };
  for (const { id, label } of SECTIONS) {
    const b = document.createElement('button');
    b.className = 'set-tab'; b.dataset.sec = id; b.textContent = label; b.setAttribute('role', 'tab');
    b.onclick = () => show(id);
    tabs.appendChild(b);
    const p = document.createElement('div');
    p.className = 'set-page'; p.dataset.sec = id;
    box.appendChild(p);
    pages[id] = p;
  }

  // ctx of the option lists and hints: the screens (Electron: every display, as in the launcher; a browser: this
  // screen) and the interface scale now ({ autoUi, ui, wanted } from main.js)
  const ctx = { displays: null };
  const live = []; // [field, element, hintElement]
  const fillOptions = (f, el) => {
    el.innerHTML = settingOptions(f, settings[f.key], ctx).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    el.value = String(settings[f.key]);
  };
  const fillHint = (f, h) => { if (h) h.textContent = settingHint(f, settings, ctx); };

  for (const sec of SECTIONS) {
    const page = pages[sec.id];
    let group = '';
    for (const f of sectionFields(sec.id)) {
      if (f.electron && !bridge?.isElectron) continue;
      if (f.group && f.group !== group) {
        const g = document.createElement('div');
        g.className = 'set-group';
        g.textContent = f.group;
        page.appendChild(g);
      }
      group = f.group || '';
      const row = document.createElement('div');
      row.className = 'field';
      row.dataset.key = f.key;
      const id = `set-${f.key}`;
      let input;
      if (f.type === 'select') input = `<select id="${id}"></select>`;
      else if (f.type === 'range') input = `<span class="ctl"><input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}" /><output for="${id}"></output></span>`;
      else input = `<input type="checkbox" class="toggle" id="${id}" />`;
      row.innerHTML = `<label for="${id}">${esc(f.label)}${f.reload ? RELOAD : ''}</label>${input}${f.hint ? '<div class="hint"></div>' : ''}`;
      page.appendChild(row);
      const el = row.querySelector('select, input');
      const hint = row.querySelector('.hint'), out = row.querySelector('output');
      if (f.type === 'select') fillOptions(f, el);
      else if (f.type === 'check') el.checked = !!settings[f.key];
      else { el.value = String(settings[f.key]); out.textContent = formatSetting(f, el.value); }
      fillHint(f, hint);
      live.push([f, el, hint]);
      el.addEventListener('input', () => {
        const v = parseSetting(f, f.type === 'check' ? el.checked : el.value);
        if (out) out.textContent = formatSetting(f, el.value);
        settings[f.key] = v;
        // only this key goes over the stored settings (not what exists only in the running game: ?fps=, resolved values)
        updateStoredSettings({ [f.key]: v });
        apply(f.key, v);
        for (const [g, , h] of live) if (typeof g.hint === 'function') fillHint(g, h);
      });
    }
    if (sec.note) {
      const n = document.createElement('div');
      n.className = 'dim note';
      n.innerHTML = sec.note; // static text from src/shared/settings.js
      page.appendChild(n);
    }
  }
  const redraw = () => {
    for (const [f, el, hint] of live) {
      if (f.type === 'select' && typeof f.options === 'function' && document.activeElement !== el) fillOptions(f, el);
      fillHint(f, hint);
    }
  };
  // the display list comes over IPC: asked at start and again (at most every 2 s) when the window changes
  let asked = -1e9;
  const askDisplays = () => {
    if (typeof bridge?.displays !== 'function' || performance.now() - asked < 2000) return;
    asked = performance.now();
    bridge.displays().then(ds => { ctx.displays = Array.isArray(ds) && ds.length ? ds : null; redraw(); }).catch(() => {});
  };
  askDisplays();
  refreshSettings = (extra = {}) => {
    ctx.autoUi = extra.autoUi; ctx.ui = extra.ui; ctx.wanted = extra.wanted;
    askDisplays();
    redraw();
  };
  show(current);
}

// ---------------------------------------------------------------- saves dialog
// api: { list(): Promise<[{id, name, meta: {dateText, saved, thumbnail?}}]>, save(name), load(id), remove(id) }
const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,/;
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
      const thumb = typeof s.meta?.thumbnail === 'string' && THUMB_RE.test(s.meta.thumbnail) ? s.meta.thumbnail : '';
      row.innerHTML = `<div class="thumb${thumb ? '' : ' empty'}">${thumb ? '<img alt="" decoding="async" />' : ''}</div>
        <div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.meta?.dateText || '')}${s.meta?.saved ? ' · ' + esc(new Date(s.meta.saved).toLocaleString('ru-RU')) : ''}</div></div>
        <button class="btn sm${mode === 'save' ? ' warn' : ''}" data-act="${mode === 'save' ? 'over' : 'load'}">${mode === 'save' ? 'Перезаписать' : 'Загрузить'}</button><button class="btn sm danger" data-act="del">Удалить</button>`;
      if (thumb) row.querySelector('img').src = thumb;
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
