// Launcher settings modal, in tabs: Экран · Графика · Карта · Игра · Дополнения · Система.
// Every setting — label, hint, section, list of values — comes from src/shared/settings.js (SETTING_FIELDS), the same
// description the in-game menu (src/game/ui/menus.js) is built from. Every change is saved at once; the game applies
// them when it starts.
import {
  saveSettings, DEFAULT_SETTINGS, isElectron, SETTING_SECTIONS, sectionFields, settingOptions, settingHint,
  formatSetting, parseSetting, physicalSize, browserDisplays,
} from '../shared/settings.js';
import { applyUiPalette } from '../shared/palettes.js';
import { applyPackData, isEnabled } from '../engine/packs.js';
import { APP_NAME, VERSION_LABEL } from '../shared/version.js';
import { createTabs } from './tabs.js';
import { confirmDialog, isConfirmOpen } from './dialog.js';

const $ = id => document.getElementById(id);
const bridge = window.passionaris;

// tabs: the shared sections, with «Дополнения» (packs) before «Система»
const RELOAD = '· после перезапуска';
const TABS = [
  ...SETTING_SECTIONS.filter(s => s.id !== 'system').map(s => ({ id: s.id, label: s.label, fields: sectionFields(s.id), note: s.note })),
  { id: 'packs', label: 'Дополнения' },
  { id: 'system', label: 'Система' },
];

// ---------------------------------------------------------------- panel
/**
 * @param {object} o
 * @param {object} o.settings           live settings object (mutated in place, saved on every change)
 * @param {Array}  o.packs              installed packs from applyPackData()
 * @param {Promise<Array>|null} o.displays   window.passionaris.displays() (null in a browser)
 * @param {(key, value) => void} [o.onChange]
 */
export function createSettingsPanel({ settings, packs = [], displays = null, onChange }) {
  const back = $('settings');
  const ctx = { displays: null };
  const syncers = [];   // () => void: put settings[key] back into the control
  const rebuilders = []; // () => void: refresh option lists that depend on displays / packs
  const hints = [];      // () => void: hints that depend on other settings (resolution ← window mode)

  function setValue(key, v) {
    settings[key] = v;
    saveSettings(settings);
    if (key === 'palette') applyUiPalette(v);
    for (const h of hints) h();
    onChange?.(key, v);
  }

  // a value the list does not offer (set by an older version, a mod or by hand) stays in the list: see settingOptions
  function fillOptions(select, f) {
    select.innerHTML = '';
    for (const [v, t] of settingOptions(f, settings[f.key], ctx)) select.add(new Option(t, v));
    select.value = String(settings[f.key]);
  }

  function fieldRow(f) {
    const row = document.createElement('div');
    row.className = `field f-${f.type}`;
    row.dataset.key = f.key;
    const id = `s-${f.key}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.innerHTML = '<span class="lbl"></span>';
    label.firstChild.textContent = f.label;
    // the launcher starts the game anew, so only what needs the whole application restarted is marked
    if (f.reload === 'app') label.firstChild.append(' ', Object.assign(document.createElement('span'), { className: 'dim', textContent: RELOAD }));
    if (f.hint) {
      const small = Object.assign(document.createElement('small'), { className: 'hint' });
      const fill = () => { small.textContent = settingHint(f, settings, ctx); };
      fill();
      if (typeof f.hint === 'function') hints.push(fill);
      label.appendChild(small);
    }
    const ctl = document.createElement('div');
    ctl.className = 'ctl';
    let el, out = null;
    if (f.type === 'select') {
      el = document.createElement('select');
      fillOptions(el, f);
      if (typeof f.options === 'function') rebuilders.push(() => fillOptions(el, f));
      syncers.push(() => fillOptions(el, f));
    } else if (f.type === 'range') {
      el = Object.assign(document.createElement('input'), { type: 'range', min: f.min, max: f.max, step: f.step });
      out = document.createElement('output');
      out.htmlFor = id;
      ctl.appendChild(out);
      syncers.push(() => { el.value = String(settings[f.key]); out.textContent = formatSetting(f, el.value); });
    } else {
      el = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'toggle' });
      syncers.push(() => { el.checked = !!settings[f.key]; });
    }
    el.id = id;
    ctl.prepend(el);
    syncers[syncers.length - 1]();
    el.addEventListener('input', () => {
      const v = parseSetting(f, f.type === 'check' ? el.checked : el.value);
      if (out) out.textContent = formatSetting(f, el.value);
      setValue(f.key, v);
    });
    row.append(label, ctl);
    return row;
  }

  // ---- panes
  const strip = $('s-tabs'), panesBox = $('s-panes');
  const panes = new Map();
  for (const t of TABS) {
    const pane = document.createElement('div');
    pane.className = 's-pane';
    pane.dataset.pane = t.id;
    let group = '';
    for (const f of t.fields || []) {
      if (f.electron && !isElectron) continue;
      if (f.group && f.group !== group) pane.appendChild(Object.assign(document.createElement('h4'), { className: 's-group', textContent: f.group }));
      group = f.group || '';
      pane.appendChild(fieldRow(f));
    }
    if (t.note) pane.appendChild(Object.assign(document.createElement('p'), { className: 'pane-note', innerHTML: t.note }));
    panes.set(t.id, pane);
    panesBox.appendChild(pane);
  }
  buildPacks(panes.get('packs'));
  const system = buildSystem(panes.get('system'));
  const tabs = createTabs({
    strip, panes: id => panes.get(id), items: TABS.map(t => ({ id: t.id, label: t.label })),
    storageKey: 'passionaris.launcher.settingsTab',
    onChange: id => { panesBox.scrollTop = 0; if (id === 'system' && back.classList.contains('open')) system.reveal(); },
  });

  // ---- displays arrive asynchronously (IPC): refresh the lists that depend on them
  Promise.resolve(displays).then(ds => {
    ctx.displays = Array.isArray(ds) && ds.length ? ds : null;
    for (const r of rebuilders) r();
    system.setDisplays(ctx.displays);
  }).catch(() => {});

  // ---- packs: on/off switches; palettes of a newly enabled pack join the palette list
  function buildPacks(pane) {
    const box = document.createElement('div');
    box.className = 'pack-list';
    if (!packs.length) {
      box.innerHTML = '<div class="pack-empty"><b>Нет установленных дополнений</b><span>Моды и DLC — это папки с файлом <code>pack.json</code> в <code>packs/</code>; как их делать, рассказано в <code>docs/MODDING.md</code>.</span></div>';
    }
    for (const p of packs) {
      const row = document.createElement('label');
      row.className = 'pack';
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'toggle' });
      const sync = () => { cb.checked = isEnabled(p, settings); };
      sync();
      syncers.push(sync);
      cb.onchange = async () => {
        setValue('packs', { ...(settings.packs || {}), [p.id]: cb.checked });
        await applyPackData(settings).catch(() => {});
        for (const r of rebuilders) r();
      };
      const txt = document.createElement('span');
      txt.className = 'pack-text';
      txt.innerHTML = '<b></b> <i></i><small></small>';
      txt.querySelector('b').textContent = p.name;
      txt.querySelector('i').textContent = `${p.kind === 'dlc' ? 'DLC' : 'мод'} · v${p.version}${p.author ? ` · ${p.author}` : ''}`;
      txt.querySelector('small').textContent = p.description;
      row.append(txt, cb);
      box.appendChild(row);
    }
    pane.appendChild(box);
    pane.appendChild(Object.assign(document.createElement('p'), { className: 'pane-note', textContent: 'Включённые дополнения подключаются при запуске игры.' }));
  }

  // ---- system: GPU choice, data folder, versions, screens, the GPU that draws now
  function buildSystem(pane) {
    for (const f of sectionFields('system')) if (!f.electron || isElectron) pane.appendChild(fieldRow(f));
    const info = document.createElement('dl');
    info.className = 'sys-info';
    const add = (term, cls) => {
      const dt = document.createElement('dt'); dt.textContent = term;
      const dd = document.createElement('dd'); if (cls) dd.className = cls;
      info.append(dt, dd);
      return dd;
    };
    const ddGpu = add('Рисует сейчас');
    const ddScreens = add('Экраны');
    const ddData = add('Папка данных', 'path');
    const ddVer = add('Версии');
    ddVer.textContent = `${APP_NAME} ${VERSION_LABEL}`;
    pane.appendChild(info);
    if (typeof bridge?.openSavesFolder === 'function') {
      const bar = document.createElement('div');
      bar.className = 'sys-bar';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn stone sm';
      btn.textContent = 'Открыть папку сохранений';
      btn.onclick = () => bridge.openSavesFolder().catch(() => {});
      bar.appendChild(btn);
      pane.appendChild(bar);
    }
    if (typeof bridge?.appInfo === 'function') {
      bridge.appInfo().then(a => {
        if (!a) return;
        ddData.textContent = a.userData || '—';
        ddData.title = a.userData ? `${a.userData}\\saves — сохранения, settings.json — настройки` : '';
        ddVer.textContent = [`${APP_NAME} ${VERSION_LABEL}`, a.electron && `Electron ${a.electron}`, a.chrome && `Chromium ${String(a.chrome).split('.')[0]}`].filter(Boolean).join(' · ');
      }).catch(() => { ddData.textContent = '—'; });
    } else {
      ddData.textContent = 'Браузер: настройки и сохранения хранятся в этом браузере';
      ddData.classList.remove('path');
    }
    let revealed = false;
    return {
      setDisplays(ds) {
        const list = ds || browserDisplays();
        ddScreens.textContent = '';
        for (const d of list) {
          const p = physicalSize(d);
          const line = document.createElement('div');
          line.textContent = [`${p.w} × ${p.h}`, d.scale && d.scale !== 1 ? `масштаб ${Math.round(d.scale * 100)}%` : '',
            d.hz ? `${Math.round(d.hz)} Гц` : '', list.length > 1 && d.primary ? 'основной' : ''].filter(Boolean).join(' · ');
          ddScreens.appendChild(line);
        }
      },
      // the WebGL renderer string, read once when the tab is first opened (a throwaway context)
      reveal() {
        if (revealed) return;
        revealed = true;
        ddGpu.textContent = gpuName();
      },
    };
  }

  // ---- open / close / reset
  const open = () => { back.classList.add('open'); tabs.button(tabs.current)?.focus(); if (tabs.current === 'system') system.reveal(); };
  const close = () => back.classList.remove('open');
  $('s-close').onclick = close;
  back.addEventListener('click', e => { if (e.target === back) close(); });
  // Esc closes the confirmation first (it handles the key in the capture phase and marks it handled)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented && back.classList.contains('open') && !isConfirmOpen()) close(); });
  $('s-reset').onclick = async () => {
    const ok = await confirmDialog({ title: 'Сбросить настройки?', text: 'Все настройки, включая дополнения, вернутся к начальным значениям.', yes: 'Сбросить' });
    if (!ok) return;
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const v = DEFAULT_SETTINGS[k];
      settings[k] = v && typeof v === 'object' ? structuredClone(v) : v;
    }
    await saveSettings(settings);
    applyUiPalette(settings.palette);
    await applyPackData(settings).catch(() => {});
    for (const s of syncers) s();
    for (const h of hints) h();
    onChange?.('*', null);
  };
  return { open, close, select: id => tabs.select(id), get isOpen() { return back.classList.contains('open'); } };
}

function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'WebGL недоступен';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    let s = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    // "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "AMD Radeon(TM) Graphics"
    const m = /^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s+Direct3D.*|\s+OpenGL.*|\s+Vulkan.*)?(?:,\s*[^,]+)?\)$/i.exec(s);
    if (m) s = m[2];
    return s.replace(/\s+/g, ' ').trim() || '—';
  } catch { return '—'; }
}
