// Every knob of the album in one place: its Russian label, range and what it drives. Pages (pages.js) are just sets
// of these values; the UI builds its sliders from the same list; URL keys p.<name>=<value> override them.
import { Vector3 } from 'three';

export const LOOKS = {
  natural: { title: 'Натуральная', u: { uStyle: 0, uSat: 1.12, uWarm: 0, uSnow: 0, uSeason: 0, uExposure: 1.05 } },
  vivid: { title: 'Яркая', u: { uStyle: 0, uSat: 1.36, uWarm: 1, uSnow: 0, uSeason: 0, uExposure: 1.14 } },
  autumn: { title: 'Осень', u: { uStyle: 0, uSat: 1.18, uWarm: 1, uSnow: -250, uSeason: 1, uExposure: 1.05 } },
  winter: { title: 'Зима', u: { uStyle: 0, uSat: .92, uWarm: 0, uSnow: -2150, uSeason: 0, uExposure: 1.0 } },
  atlas: { title: 'Атлас', u: { uStyle: 2, uSat: 1.0, uWarm: 0, uSnow: 0, uSeason: 0, uExposure: 1.0 } },
  paper: { title: 'Бумага', u: { uStyle: 3, uSat: 1.0, uWarm: 0, uSnow: 0, uSeason: 0, uExposure: 1.0 } },
  night: { title: 'Ночной сланец', u: { uStyle: 6, uSat: 1.0, uWarm: 0, uSnow: 0, uSeason: 0, uExposure: 1.0 } },
};

// group: land | scale | light | layers | modes | system
export const DEFS = [
  { key: 'look', label: 'Вид земли', group: 'land', type: 'select', options: Object.entries(LOOKS).map(([id, l]) => [id, l.title]), value: 'natural' },
  { key: 'exag', label: 'Высота рельефа', group: 'scale', min: 1, max: 4, step: .1, value: 1.6, unit: '×', uniform: 'uExag' },
  { key: 'shade', label: 'Сила теней рельефа', group: 'land', min: .5, max: 3, step: .1, value: 1.6, unit: '×', uniform: 'uShade' },
  { key: 'forest', label: 'Густота леса', group: 'scale', min: 0, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uForestK' },
  { key: 'trees', label: 'Размер деревьев', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
  { key: 'houses', label: 'Размер домов', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
  { key: 'roads', label: 'Ширина дорог', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
  { key: 'rivers', label: 'Ширина рек', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
  { key: 'growth', label: 'Рост городов', group: 'scale', min: .1, max: 3, step: .05, value: 1, unit: '×' },
  { key: 'hour', label: 'Время суток', group: 'light', min: 4, max: 22, step: .25, value: 0, unit: ' ч', zero: 'свет как на карте' },
  { key: 'fx', label: 'Эффекты движка', group: 'light', type: 'toggle', value: 1 },
  { key: 'ao', label: 'Затенение у объектов', group: 'light', min: 0, max: 1.5, step: .05, value: .8, unit: '×' },
  { key: 'sharp', label: 'Резкость', group: 'light', min: 0, max: 1, step: .05, value: .3, unit: '×' },
  { key: 'haze', label: 'Дымка воздуха', group: 'light', min: .02, max: .3, step: .01, value: .09, uniform: 'uHaze' },
  { key: 'sat', label: 'Насыщенность', group: 'land', min: .5, max: 1.7, step: .02, value: 0, zero: 'как в виде' },
  { key: 'snow', label: 'Снеговая линия', group: 'land', min: -2500, max: 600, step: 50, value: 0, unit: ' м', zero: 'как в виде' },
  { key: 'forest3d', label: 'Объёмные деревья', group: 'layers', type: 'toggle', value: 1 },
  { key: 'towns', label: 'Поселения', group: 'layers', type: 'toggle', value: 1 },
  { key: 'roadsOn', label: 'Дороги', group: 'layers', type: 'toggle', value: 1 },
  { key: 'riversOn', label: 'Реки', group: 'layers', type: 'toggle', value: 1 },
  { key: 'labels', label: 'Подписи', group: 'layers', type: 'toggle', value: 1 },
  { key: 'showcase', label: 'Витрина моделей', group: 'layers', type: 'toggle', value: 0 },
  { key: 'grid', label: 'Территории 10 км', group: 'modes', type: 'toggle', value: 0, uniform: 'uGrid' },
  { key: 'division', label: 'Деление', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Районы'], [2, 'Провинции'], [3, 'Регионы']], value: 0, uniform: 'uDivision' },
  { key: 'data', label: 'Данные', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Температура'], [2, 'Высоты']], value: 0, uniform: 'uData' },
  { key: 'hazard', label: 'Бедствие', group: 'modes', type: 'select', options: [['', 'нет'], ['fire', 'Пожар'], ['quake', 'Землетрясение']], value: '' },
  { key: 'play', label: 'Ход времени', group: 'system', min: 0, max: 8, step: .25, value: 1, unit: '×' },
  { key: 'renderScale', label: 'Чёткость картинки', group: 'system', min: .5, max: 1, step: .05, value: 1, unit: '×' },
];

// sun direction as (east, north, up). hour 0 = the cartographer's light from the north-west.
export function sunAt(hour) {
  if (!hour) return new Vector3(-.5, .45, .74).normalize();
  const a = (hour - 12) * 15 * Math.PI / 180, el = Math.max(-.2, Math.sin((hour - 6) / 12 * Math.PI)) * 62 * Math.PI / 180;
  return new Vector3(-Math.sin(a) * Math.cos(el), -Math.cos(a) * Math.cos(el) * .85, Math.sin(el)).normalize();
}

export function createParams(album) {
  const v = Object.fromEntries(DEFS.map(d => [d.key, d.value])), subs = [], u = album.terrain.u;
  const byKey = Object.fromEntries(DEFS.map(d => [d.key, d]));
  function apply(key) {
    const d = byKey[key]; if (!d) return;
    if (d.uniform) u[d.uniform].value = +v[key];
    if (key === 'look' || key === 'sat' || key === 'snow') {
      const L = LOOKS[v.look] || LOOKS.natural;
      for (const [k, val] of Object.entries(L.u)) u[k].value = val;
      if (v.sat) u.uSat.value = v.sat;
      if (v.snow) u.uSnow.value = L.u.uSnow + v.snow;
    }
    if (key === 'hour') u.uSun.value.copy(sunAt(v.hour));
  }
  const api = {
    defs: DEFS, values: v,
    get: k => v[k],
    set(k, val, silent) { if (!(k in v) || v[k] === val) return; v[k] = val; apply(k); if (!silent) for (const f of subs) f(k, val); },
    setMany(o) { for (const [k, val] of Object.entries(o)) api.set(k, val, true); for (const f of subs) f(null); },
    reset() { api.setMany(Object.fromEntries(DEFS.map(d => [d.key, d.value]))); },
    on: f => subs.push(f),
  };
  for (const d of DEFS) apply(d.key);
  return api;
}
