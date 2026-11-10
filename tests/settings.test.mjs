// The one description of the settings (src/shared/settings.js), shared by the launcher and the in-game menu:
// tools/node/node.exe --test tests/settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, SETTING_FIELDS, SETTING_SECTIONS, sectionFields, settingField, settingOptions, settingHint, parseSetting,
  formatSetting, resolutionOptions, physicalSize, plural, loadSettings, updateStoredSettings,
} from '../src/shared/settings.js';

const values = (key, v, ctx) => settingOptions(settingField(key), v, ctx).map(([x]) => x);

test('every setting is described once, in a known section, with a label and its default in the list', () => {
  const keys = new Set();
  const sections = new Set(SETTING_SECTIONS.map(s => s.id));
  for (const f of SETTING_FIELDS) {
    assert.ok(!keys.has(f.key), `${f.key} twice`);
    keys.add(f.key);
    assert.ok(f.key in DEFAULT_SETTINGS, `${f.key} has no default`);
    assert.ok(sections.has(f.section), `${f.key}: unknown section ${f.section}`);
    assert.ok(typeof f.label === 'string' && f.label.trim(), `${f.key}: no label`);
    assert.ok(['select', 'range', 'check'].includes(f.type), `${f.key}: type ${f.type}`);
    assert.equal(typeof settingHint(f, DEFAULT_SETTINGS, {}), 'string');
    if (f.type === 'select') {
      const opts = settingOptions(f, undefined, {});
      assert.ok(opts.length >= 2, `${f.key}: too few options`);
      const vs = opts.map(([v]) => v);
      assert.equal(new Set(vs).size, vs.length, `${f.key}: repeated option`);
      for (const [v, t] of opts) assert.ok(typeof v === 'string' && typeof t === 'string' && t, `${f.key}: bad option ${v}`);
      assert.ok(vs.includes(String(DEFAULT_SETTINGS[f.key])), `${f.key}: default ${DEFAULT_SETTINGS[f.key]} is not offered`);
      // what a <select> gives back turns into the setting's own value and back into the same option
      for (const v of vs) assert.equal(String(parseSetting(f, v)), v, `${f.key}: ${v} does not survive parsing`);
    } else if (f.type === 'range') {
      const d = DEFAULT_SETTINGS[f.key];
      assert.ok(f.min < f.max && f.step > 0 && d >= f.min && d <= f.max, `${f.key}: range`);
      assert.equal(typeof formatSetting(f, d), 'string');
      assert.equal(parseSetting(f, String(d)), d);
    } else {
      assert.equal(typeof DEFAULT_SETTINGS[f.key], 'boolean', `${f.key}: a check needs a boolean default`);
      assert.equal(parseSetting(f, 1), true);
    }
  }
  // the game shows every section but the launcher's «Система»
  assert.deepEqual(SETTING_SECTIONS.filter(s => s.where !== 'launcher').map(s => s.label), ['Экран', 'Графика', 'Карта', 'Игра']);
});

test('the shared lists: autosave, slots, interface scale, frame limit', () => {
  assert.deepEqual(values('autosaveMinutes'), ['0', '5', '10', '15', '20', '30']);
  assert.deepEqual(values('autosaveSlots'), ['1', '3', '5', '10']);
  const ui = values('uiScale');
  assert.equal(ui[0], 'auto');
  const nums = ui.slice(1).map(Number);
  assert.equal(nums[0], 0.75);
  assert.equal(nums.at(-1), 2);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  assert.deepEqual(values('fpsLimit'), ['0', '30', '60', '120', '144']);
  const labels = Object.fromEntries(settingOptions(settingField('autosaveSlots'), 3));
  assert.equal(labels['1'], '1 ячейка');
  assert.equal(labels['3'], '3 ячейки');
  assert.equal(labels['10'], '10 ячеек');
  assert.equal(Object.fromEntries(settingOptions(settingField('autosaveMinutes'), 10))['0'], 'Выключено');
  // the screen's refresh rate shows in the «no limit» line when the displays are known
  assert.match(settingOptions(settingField('fpsLimit'), 0, { displays: [{ width: 1920, height: 1080, scale: 1, hz: 143.9, primary: true }] })[0][1], /до 144 Гц/);
});

test('weather, winds and disasters sit in one section and one group', () => {
  const fx = ['showWeather', 'showWind', 'effects'].map(settingField);
  assert.equal(new Set(fx.map(f => f.section)).size, 1);
  assert.equal(new Set(fx.map(f => f.group)).size, 1);
  const inSection = sectionFields(fx[0].section).map(f => f.key);
  for (const f of fx) assert.ok(inSection.includes(f.key));
});

test('a value saved earlier and not in the list is kept and shown as it is', () => {
  // an old launcher list had 2 and 4 slots, the old game 0.85…1.8 interface scales, 20-minute autosaves
  let o = settingOptions(settingField('autosaveSlots'), 4);
  assert.deepEqual(o.map(([v]) => v), ['1', '3', '4', '5', '10']);
  assert.equal(o[2][1], '4 ячейки');
  o = settingOptions(settingField('uiScale'), 1.6);
  assert.ok(o.some(([v, t]) => v === '1.6' && t === '160%'));
  assert.equal(o[0][0], 'auto');
  o = settingOptions(settingField('autosaveMinutes'), 45);
  assert.deepEqual(o.at(-1), ['45', 'Каждые 45 минут']);
  o = settingOptions(settingField('resolution'), '1024x768', { displays: [{ width: 1920, height: 1080, scale: 1, primary: true }] });
  assert.deepEqual(o.at(-1), ['1024x768', '1024 × 768']);
  o = settingOptions(settingField('fpsLimit'), 90);
  assert.ok(o.some(([v, t]) => v === '90' && t === '90 кадров/с'));
  // a value the list offers is not repeated
  assert.equal(settingOptions(settingField('autosaveSlots'), 3).length, 4);
  assert.equal(settingOptions(settingField('autosaveSlots'), '3').length, 4);
});

test('resolutions: native first, then the usual sizes that fit a display', () => {
  // 2560×1440 at 150% Windows scaling reads as 1707×960 logical pixels
  const main = { width: 1707, height: 960, scale: 1.5, hz: 165, primary: true };
  assert.deepEqual(physicalSize(main), { w: 2560, h: 1440 });
  let o = resolutionOptions([main]);
  assert.deepEqual(o[0], ['native', 'Родное · 2560 × 1440']);
  const vs = o.map(([v]) => v);
  assert.ok(vs.includes('1920x1080') && vs.includes('2560x1080'));
  assert.ok(!vs.includes('2560x1440'), 'the native size is not repeated');
  assert.ok(!vs.includes('3840x2160') && !vs.includes('2560x1600'));
  assert.equal(o.find(([v]) => v === '1920x1200')[1], '1920 × 1200 · 16:10');
  // a second, larger display adds its sizes
  o = resolutionOptions([main, { width: 3840, height: 2160, scale: 1, primary: false }]);
  assert.ok(o.some(([v]) => v === '3840x2160'));
  // without displays (a plain browser in Node): still a list with native first
  assert.equal(resolutionOptions(null)[0][0], 'native');
  // the hint follows the window mode
  const r = settingField('resolution');
  assert.match(settingHint(r, { windowMode: 'window' }), /размер окна/);
  assert.match(settingHint(r, { windowMode: 'fullscreen' }), /разрешение отрисовки/);
});

test('plural forms', () => {
  const f = ['ячейка', 'ячейки', 'ячеек'];
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(n => plural(n, f)),
    ['ячейка', 'ячейки', 'ячеек', 'ячеек', 'ячеек', 'ячейка', 'ячейки', 'ячеек', 'ячейка', 'ячеек']);
});

test('stored values survive loading; the game writes single keys over the stored settings', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    store.set('passionaris.settings', JSON.stringify({ settingsVersion: 2, autosaveSlots: 4, uiScale: 1.6, autosaveMinutes: 45, mapMode: 'koppen' }));
    const s = await loadSettings();
    assert.equal(s.autosaveSlots, 4);
    assert.equal(s.uiScale, 1.6);
    assert.equal(s.autosaveMinutes, 45);
    assert.equal(s.mapMode, 'koppen');
    assert.equal(s.palette, DEFAULT_SETTINGS.palette);
    // the running game has values of its own (address overrides, resolved quality): they are not written back
    s.fpsLimit = 30; s.qualityResolved = 'high';
    await updateStoredSettings({ mapMode: 'weather' });
    const stored = JSON.parse(store.get('passionaris.settings'));
    assert.equal(stored.mapMode, 'weather');
    assert.equal(stored.autosaveSlots, 4);
    assert.equal(stored.fpsLimit, 0);
    assert.ok(!('qualityResolved' in stored));
    // a fresh start has the default map mode
    store.clear();
    assert.equal((await loadSettings()).mapMode, 'terrain');
  } finally {
    delete globalThis.localStorage;
  }
});
