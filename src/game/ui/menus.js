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
const FIELDS = [
  { key: 'windowMode', label: 'Режим окна', type: 'select', options: [['fullscreen', 'Полный экран'], ['maximized', 'Окно на весь экран'], ['window', 'Окно']], reload: true },
  { key: 'renderScale', label: 'Масштаб рендеринга', type: 'select', options: [['auto', 'Авто — держит частоту кадров'], ['0.5', '50% — максимум FPS'], ['0.67', '67%'], ['0.8', '80%'], ['1', '100% — максимум чёткости']] },
  { key: 'sharpen', label: 'Резкость апскейла', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'brightness', label: 'Яркость', type: 'range', min: 0.7, max: 1.3, step: 0.01 },
  { key: 'quality', label: 'Детализация сетки', type: 'select', options: [['auto', 'Авто'], ['low', 'Низкая'], ['medium', 'Средняя'], ['high', 'Высокая']], reload: true },
  { key: 'reliefScale', label: 'Высота рельефа (1 = как в жизни)', type: 'range', min: 1, max: 10, step: 0.5 },
  { key: 'unroll', label: 'Разворачивание глобуса', type: 'range', min: 0, max: 1, step: 0.01 },
  { key: 'showWeather', label: 'Погода: облака, снег, засуха', type: 'check' },
  { key: 'effects', label: 'Эффекты стихий', type: 'check' },
  { key: 'waterAnimation', label: 'Анимация воды', type: 'check' },
  { key: 'showCurrents', label: 'Морские течения', type: 'check' },
  { key: 'showLabels', label: 'Подписи природных зон', type: 'check' },
  { key: 'showRivers', label: 'Реки', type: 'check' },
  { key: 'showRoads', label: 'Дороги', type: 'check' },
  { key: 'showDistricts', label: 'Границы районов', type: 'check' },
  { key: 'autosaveMinutes', label: 'Автосохранение', type: 'select', options: [['0', 'Выключено'], ['5', 'Каждые 5 минут'], ['10', 'Каждые 10 минут'], ['20', 'Каждые 20 минут']] },
  { key: 'showFps', label: 'Показывать FPS', type: 'check' },
];

export function buildSettings(settings, apply) {
  const box = $('settings-fields');
  box.innerHTML = '';
  for (const f of FIELDS) {
    const row = document.createElement('div');
    row.className = 'field';
    const id = `set-${f.key}`;
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}">${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>`;
    } else if (f.type === 'range') {
      input = `<input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}" />`;
    } else {
      input = `<input type="checkbox" id="${id}" />`;
    }
    row.innerHTML = `<label for="${id}">${esc(f.label)}${f.reload ? ' <span class="dim">· после перезапуска</span>' : ''}</label>${input}`;
    box.appendChild(row);
    const el = row.querySelector('select, input');
    if (f.type === 'check') el.checked = !!settings[f.key];
    else el.value = String(settings[f.key]);
    el.addEventListener('input', () => {
      const v = f.type === 'check' ? el.checked : f.type === 'range' ? Number(el.value) : (isNaN(Number(el.value)) ? el.value : Number(el.value));
      settings[f.key] = v;
      saveSettings(settings);
      apply(f.key, v);
    });
  }
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
      row.querySelector('[data-act="del"]').onclick = async () => { await api.remove(s.name); render(); };
      row.querySelector('[data-act="load"], [data-act="over"]').onclick = async () => {
        if (mode === 'save') { await api.save(s.name); render(); }
        else { await api.load(s.name); closeModal('saves'); }
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
