// Settings: defaults, storage, and ONE description of every setting (label, hint, section, list of values).
// The launcher (src/launcher/settingsPanel.js) and the in-game menu (src/game/ui/menus.js) both build their
// controls from SETTING_FIELDS / SETTING_SECTIONS below, so values, labels and sections are the same everywhere.
// Settings live in Electron's userData (via the preload bridge) or localStorage in a plain browser.
import { PALETTES } from './palettes.js';

export const DEFAULT_SETTINGS = {
  windowMode: 'fullscreen',   // 'fullscreen' | 'maximized' | 'window'
  resolution: 'native',     // 'native' or 'WxH' (e.g. '1920x1080'): window size in 'window' mode, render resolution otherwise
  uiScale: 'auto',          // 'auto' (by screen size) or 0.75..2: size of the interface
  fpsLimit: 0,                // 0 = no limit (display refresh), else 30 | 60 | 120 | 144
  quality: 'auto',            // mesh density: 'auto' | 'low' | 'medium' | 'high'
  pixelRatio: 1,              // legacy render scale multiplier
  renderScale: 'auto',        // 'auto' (dynamic resolution) or 0.5..1, upscaled with sharpening (FSR-like)
  sharpen: 0.35,              // sharpening strength for the upscale pass
  shaders: 'full',            // 'full' | 'simple' (cheaper terrain shading for weak GPUs)
  brightness: 1,              // 0.7..1.3
  reliefScale: 1,             // vertical scale: 1 = true 1:1 proportions
  unroll: 0.85,               // 0 = always a globe, 1 = almost flat when zoomed in
  showDistricts: true,
  showRivers: true,
  showCurrents: true,
  showLabels: true,
  showRoads: true,
  showWeather: true,          // clouds, snow, drought tint
  showWind: true,             // prevailing-wind streaks
  effects: true,              // eruptions, quakes, meteors, fires
  waterAnimation: true,
  autosaveMinutes: 10,        // 0 = off
  autosaveSlots: 3,
  showFps: false,
  gpu: 'discrete',            // Electron: force the discrete GPU on dual-GPU laptops ('auto' = system choice)
  palette: 'graphite',        // see src/shared/palettes.js
  packs: {},                  // mods / DLC on or off: {packId: true | false}; unset = the pack's default
  mapMode: 'terrain',         // the map mode picked last (src/game/ui/icons.js MODE_DEFS); ?mode= in the address wins
};

// ---------------------------------------------------------------- the description of every setting
// Sections in display order. `where`: 'both' (launcher and game) or 'launcher' (the launcher's «Система»).
// `note` (HTML): a line under the section's fields. A field's `group` starts a small heading inside its section.
export const SETTING_SECTIONS = [
  { id: 'screen', label: 'Экран', where: 'both' },
  { id: 'graphics', label: 'Графика', where: 'both',
    note: 'DLSS работает только в нативных движках. Здесь вместо него — масштаб рендеринга с повышением резкости.' },
  { id: 'map', label: 'Карта', where: 'both' },
  { id: 'game', label: 'Игра', where: 'both',
    note: 'В игре: <kbd>F5</kbd> — быстрое сохранение, <kbd>F9</kbd> — быстрая загрузка, <kbd>Esc</kbd> — меню с сохранением и загрузкой.' },
  { id: 'system', label: 'Система', where: 'launcher' },
];

const pct = v => `${Math.round(Number(v) * 100)}%`;
/** Russian plural: plural(5, ['ячейка', 'ячейки', 'ячеек']) → 'ячеек'. */
export function plural(n, [one, few, many]) {
  const a = Math.abs(Math.trunc(Number(n))) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
const minutes = v => `Каждые ${v} ${plural(v, ['минуту', 'минуты', 'минут'])}`;
const slots = v => `${v} ${plural(v, ['ячейка', 'ячейки', 'ячеек'])}`;
const fps = v => `${v} ${plural(v, ['кадр', 'кадра', 'кадров'])}/с`;
const times = v => `×${Number(v) % 1 ? Number(v).toFixed(1) : Number(v)}`;

export const AUTOSAVE_MINUTES = [0, 5, 10, 15, 20, 30];
export const AUTOSAVE_SLOTS = [1, 3, 5, 10];
export const UI_SCALES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const FPS_LIMITS = [30, 60, 120, 144];

/**
 * One entry per setting:
 *   key, section, label, type 'select' | 'range' | 'check'; group: a heading inside the section (optional)
 *   hint      string, or (settings, ctx) => string
 *   options   [[value, label], …] or (ctx) => [[value, label], …]   (values are strings, as in a <select>)
 *   custom    v => label for a value the list does not offer (set by an older version, a mod or by hand):
 *             it stays in the list as it is and is never reset
 *   min, max, step, format   for ranges (format: value → the text next to the slider)
 *   reload    'game': in the game it takes effect after the next start; 'app': after the application restarts
 *   electron  true: only in the desktop application
 * ctx: { displays: window.passionaris.displays() result or null, autoUi, ui, wanted (the interface scale now, in the game) }
 */
export const SETTING_FIELDS = [
  // ---- Экран
  { key: 'windowMode', section: 'screen', label: 'Режим окна', type: 'select', hint: 'F11 — полный экран и обратно',
    options: [['fullscreen', 'Полный экран'], ['maximized', 'Окно на весь экран'], ['window', 'Окно']] },
  { key: 'resolution', section: 'screen', label: 'Разрешение', type: 'select',
    options: ctx => resolutionOptions(ctx?.displays), custom: v => String(v).replace('x', ' × '),
    hint: s => (s.windowMode === 'window' ? 'В оконном режиме — размер окна.' : 'На весь экран — разрешение отрисовки: картинка растягивается до экрана с повышением резкости.') },
  { key: 'uiScale', section: 'screen', label: 'Масштаб интерфейса', type: 'select', custom: pct,
    options: ctx => [['auto', ctx?.autoUi ? `Авто — сейчас ${pct(ctx.autoUi)}` : 'Авто — по размеру экрана'], ...UI_SCALES.map(v => [String(v), pct(v)])],
    hint: (s, ctx) => (ctx?.ui && ctx?.wanted && ctx.ui < ctx.wanted - 0.01 ? `Сейчас ${pct(ctx.ui)}: крупнее в это окно не помещается` : '') },
  { key: 'fpsLimit', section: 'screen', label: 'Ограничение кадров', type: 'select', custom: fps,
    options: ctx => {
      const hz = displayHz(ctx?.displays);
      return [['0', hz ? `Без ограничения — до ${hz} Гц экрана` : 'Без ограничения'], ...FPS_LIMITS.map(v => [String(v), fps(v)])];
    },
    hint: 'Меньше кадров — тише вентиляторы и дольше батарея' },
  { key: 'showFps', section: 'screen', label: 'Показывать FPS', type: 'check' },
  // ---- Графика
  { key: 'quality', section: 'graphics', label: 'Детализация сетки', type: 'select', reload: 'game',
    options: [['auto', 'Авто'], ['low', 'Низкая'], ['medium', 'Средняя'], ['high', 'Высокая']] },
  { key: 'renderScale', section: 'graphics', label: 'Масштаб рендеринга', type: 'select', custom: pct,
    options: [['auto', 'Авто — держит частоту кадров'], ['0.5', '50% — максимум FPS'], ['0.67', '67%'], ['0.8', '80%'], ['1', '100% — максимум чёткости']] },
  { key: 'sharpen', section: 'graphics', label: 'Резкость апскейла', type: 'range', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'shaders', section: 'graphics', label: 'Шейдеры', type: 'select',
    options: [['full', 'Полные — тени рельефа, рябь, изобаты'], ['simple', 'Простые — быстрее на слабой графике']] },
  { key: 'brightness', section: 'graphics', label: 'Яркость', type: 'range', min: 0.7, max: 1.3, step: 0.01, format: pct },
  { key: 'waterAnimation', section: 'graphics', label: 'Анимация воды', type: 'check' },
  // ---- Карта
  { key: 'palette', section: 'map', label: 'Палитра', type: 'select', reload: 'game',
    options: () => Object.entries(PALETTES).map(([id, p]) => [id, p.pack ? `${p.name} · из дополнения` : p.name]) },
  { key: 'reliefScale', section: 'map', label: 'Высота рельефа (1 = как в жизни)', type: 'range', min: 1, max: 10, step: 0.5, format: times },
  { key: 'unroll', section: 'map', label: 'Разворачивание глобуса', type: 'range', min: 0, max: 1, step: 0.01, format: pct,
    hint: 'Насколько глобус расправляется в плоскую карту при приближении' },
  { key: 'showRivers', section: 'map', group: 'Слои карты', label: 'Реки', type: 'check' },
  { key: 'showLabels', section: 'map', group: 'Слои карты', label: 'Подписи природных зон', type: 'check' },
  { key: 'showRoads', section: 'map', group: 'Слои карты', label: 'Дороги', type: 'check' },
  { key: 'showCurrents', section: 'map', group: 'Слои карты', label: 'Морские течения', type: 'check' },
  { key: 'showDistricts', section: 'map', group: 'Слои карты', label: 'Границы районов', type: 'check' },
  // weather, winds and disasters: one group in «Карта», in the launcher and in the game
  { key: 'showWeather', section: 'map', group: 'Погода и стихии', label: 'Погода: облака, снег, засуха', type: 'check' },
  { key: 'showWind', section: 'map', group: 'Погода и стихии', label: 'Ветры', type: 'check', hint: 'Полосы преобладающих ветров над картой' },
  { key: 'effects', section: 'map', group: 'Погода и стихии', label: 'Эффекты стихий', type: 'check', hint: 'Извержения, землетрясения, метеориты, пожары' },
  // ---- Игра
  { key: 'autosaveMinutes', section: 'game', label: 'Автосохранение', type: 'select', custom: minutes,
    options: AUTOSAVE_MINUTES.map(v => [String(v), v ? minutes(v) : 'Выключено']) },
  { key: 'autosaveSlots', section: 'game', label: 'Ячейки автосохранения', type: 'select', custom: slots,
    options: AUTOSAVE_SLOTS.map(v => [String(v), slots(v)]), hint: 'Новое автосохранение заменяет самое старое' },
  // ---- Система (launcher)
  { key: 'gpu', section: 'system', label: 'Видеокарта', type: 'select', reload: 'app', electron: true,
    options: [['discrete', 'Дискретная (быстрее)'], ['auto', 'Как решит система']], hint: 'На ноутбуках с двумя видеокартами' },
];

/** The fields of one section, in order. */
export const sectionFields = id => SETTING_FIELDS.filter(f => f.section === id);
export const settingField = key => SETTING_FIELDS.find(f => f.key === key) || null;

/** The hint text now ('' when there is none). */
export function settingHint(f, settings, ctx) {
  return (typeof f.hint === 'function' ? f.hint(settings || {}, ctx || {}) : f.hint) || '';
}

/** The text next to a slider. */
export const formatSetting = (f, v) => (f.format ? f.format(v) : String(v));

const numeric = v => v !== '' && v !== null && !isNaN(Number(v));
/**
 * Options of a select: the field's list for this ctx, plus the current value if the list does not offer it
 * (a value saved earlier is shown as it is and kept: nothing is reset when the lists change).
 * @returns {Array<[string, string]>}
 */
export function settingOptions(f, value, ctx = {}) {
  const list = (typeof f.options === 'function' ? f.options(ctx) : f.options) || [];
  if (value === undefined || value === null || value === '') return list.slice();
  const cur = String(value);
  if (list.some(([v]) => v === cur)) return list.slice();
  const label = f.custom ? f.custom(value) : cur;
  const out = list.slice();
  // numbers go in their place among the numbers ('auto', 'native' stay first), anything else at the end
  let at = out.length;
  if (numeric(cur)) {
    const k = out.findIndex(([v]) => numeric(v) && Number(v) > Number(cur));
    if (k >= 0) at = k;
  }
  out.splice(at, 0, [cur, label]);
  return out;
}

/** A control's value → the setting's value: checkbox → boolean, slider → number, select → number when numeric. */
export function parseSetting(f, raw) {
  if (f.type === 'check') return !!raw;
  if (f.type === 'range') return Number(raw);
  return numeric(raw) ? Number(raw) : raw;
}

// ---------------------------------------------------------------- screens and resolutions
// 'WxH' sizes are in physical pixels. The list offers the sizes that fit on at least one display (the main display's
// own size is «Родное»); window.passionaris.displays() gives logical sizes × Windows scaling.
export const RESOLUTIONS = [[1280, 720], [1280, 800], [1366, 768], [1440, 900], [1600, 900], [1680, 1050], [1920, 1080], [1920, 1200],
  [2560, 1080], [2560, 1440], [2560, 1600], [2880, 1800], [3440, 1440], [3840, 1600], [3840, 2160], [5120, 2160], [5120, 2880]];
export function aspectName(w, h) {
  const r = w / h;
  const known = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [5 / 4, '5:4'], [64 / 27, '21:9'], [43 / 18, '21:9'], [12 / 5, '21:9'], [32 / 9, '32:9']];
  const k = known.find(([v]) => Math.abs(v - r) < 0.02);
  return k ? k[1] : '';
}
/** Logical sizes are rounded (2560 px at 150% → 1707 → 2560.5): a value within 3 px of a usual size snaps to it. */
const USUAL = [720, 768, 800, 864, 900, 960, 1024, 1050, 1080, 1152, 1200, 1280, 1366, 1440, 1536, 1600, 1680, 1800, 1920, 2048, 2160,
  2400, 2560, 2880, 3000, 3072, 3200, 3440, 3840, 4096, 4320, 5120, 7680];
const snap = x => USUAL.find(k => Math.abs(k - x) <= 3) ?? Math.round(x);
/** Physical pixels of a display {width, height, scale}. */
export const physicalSize = d => ({ w: snap(d.width * (d.scale || 1)), h: snap(d.height * (d.scale || 1)) });
/** The screen as a browser sees it (no Electron): one display. */
export function browserDisplays() {
  const s = (typeof window !== 'undefined' && window.screen) || { width: 1920, height: 1080 };
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return [{ width: s.width, height: s.height, scale: dpr, hz: 0, primary: true }];
}
/** Options for «Разрешение»: native first, then the usual sizes that fit on at least one display. */
export function resolutionOptions(displays) {
  const ds = displays?.length ? displays : browserDisplays();
  const main = physicalSize(ds.find(d => d.primary) || ds[0]);
  const out = [['native', `Родное · ${main.w} × ${main.h}`]];
  for (const [w, h] of RESOLUTIONS) {
    if (w === main.w && h === main.h) continue;
    if (!ds.some(d => { const p = physicalSize(d); return w <= p.w && h <= p.h; })) continue;
    const a = aspectName(w, h);
    out.push([`${w}x${h}`, `${w} × ${h}${a ? ` · ${a}` : ''}`]);
  }
  return out;
}
const displayHz = ds => Math.round(Math.max(0, ...(ds || []).map(d => Number(d.hz) || 0)));

// ---------------------------------------------------------------- storage
const KEY = 'passionaris.settings';
const bridge = typeof window !== 'undefined' ? window.passionaris : undefined;

const SETTINGS_VERSION = 2;
function migrate(s) {
  // v2 (0.1.4): render scale and mesh quality became adaptive; older saved values are reset to 'auto'
  if (!s.settingsVersion || s.settingsVersion < 2) { delete s.renderScale; delete s.quality; delete s.reliefScale; }
  return { ...DEFAULT_SETTINGS, ...s, settingsVersion: SETTINGS_VERSION };
}

export async function loadSettings() {
  try {
    if (bridge?.getSettings) return migrate(await bridge.getSettings() || {});
    const raw = localStorage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s) {
  try {
    if (bridge?.setSettings) return await bridge.setSettings(s);
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable: keep in memory only */ }
}

// The game changes single keys (a setting in its menu, the map mode): it writes them over the STORED settings, so
// what exists only in the running game (address overrides like ?fps=30, values worked out at start) is never saved.
let patchQueue = Promise.resolve();
export function updateStoredSettings(patch) {
  patchQueue = patchQueue.then(async () => {
    const stored = await loadSettings();
    await saveSettings({ ...stored, ...patch });
  }).catch(() => { /* storage unavailable */ });
  return patchQueue;
}

export const isElectron = !!bridge?.isElectron;
