// Map legend: a small paper slip above the mode buttons that says what the colours mean in the current mode.
// The ramps are JS copies of the shader ramps in src/game/shaders.js (hypso, tempRamp, precRamp, hazardRamp and the
// WX_* / AIR_* / WIND_* colours of the weather, air and winds modes); the Köppen palette and the fertility ramp come
// straight from src/sim/climate (the shader's copies are generated from the same tables).
import { BIOME_COLORS } from '../world/biomes.js';
import { KOPPEN, KOPPEN_GROUPS } from '../../sim/climate/koppen.js';
import { fertRamp } from '../../sim/climate/fertility.js';
import './legend.css';

const $ = id => document.getElementById(id);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c, d, t) => c.map((v, i) => v + (d[i] - v) * t);
const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

const PAPER = [0.93, 0.9, 0.84];   // ≈ the quiet base of the weather / air / winds maps
const WX = {
  warm: [0.85, 0.42, 0.3], cold: [0.32, 0.5, 0.78], drought: [0.6, 0.38, 0.19], cloud: [0.94, 0.94, 0.93], snow: [0.975, 0.98, 0.995],
  rain: r => mix(mix([0.6, 0.78, 0.6], [0.2, 0.52, 0.38], ss(0, 0.55, r)), [0.38, 0.24, 0.5], ss(0.6, 1, r)),
  snowfall: r => mix([0.84, 0.84, 0.95], [0.58, 0.54, 0.83], ss(0, 1, r)),
};
const AIR = { ash: [0.22, 0.21, 0.21], smoke: [0.52, 0.38, 0.27], dust: [0.85, 0.62, 0.32], sulf: [0.6, 0.55, 0.76], fall: [0.35, 0.33, 0.32], cool: [0.42, 0.58, 0.82] };
const WIND = { east: [0.88, 0.72, 0.5], west: [0.52, 0.66, 0.8] };
const CURRENT = { warm: [0.86, 0.55, 0.32], cold: [0.6, 0.76, 0.9] };   // src/game/fx/currents.js defaults

const RAMPS = {
  hypso: h => {
    let c = mix([0.62, 0.71, 0.55], [0.78, 0.79, 0.6], ss(0, 350, h));
    c = mix(c, [0.84, 0.76, 0.56], ss(350, 1200, h));
    c = mix(c, [0.72, 0.6, 0.47], ss(1200, 2600, h));
    c = mix(c, [0.6, 0.55, 0.52], ss(2600, 4000, h));
    return mix(c, [0.95, 0.94, 0.92], ss(4300, 5800, h));
  },
  temp: t => {
    let c = mix([0.27, 0.36, 0.62], [0.55, 0.72, 0.84], ss(0, 0.42, t));
    c = mix(c, [0.93, 0.9, 0.78], ss(0.42, 0.55, t));
    c = mix(c, [0.9, 0.62, 0.36], ss(0.55, 0.75, t));
    return mix(c, [0.7, 0.25, 0.2], ss(0.75, 1, t));
  },
  prec: p => {
    let c = mix([0.9, 0.84, 0.68], [0.62, 0.78, 0.6], ss(0.05, 0.35, p));
    c = mix(c, [0.3, 0.6, 0.62], ss(0.35, 0.65, p));
    return mix(c, [0.16, 0.32, 0.55], ss(0.65, 1, p));
  },
  hazard: h => mix(mix([0.98, 0.9, 0.62], [0.93, 0.62, 0.3], ss(0.1, 0.5, h)), [0.62, 0.16, 0.14], ss(0.5, 1, h)),
  // weather anomaly: −8 … +8 °C (the shader mixes 60 % of the tint at |8 °C|)
  anomaly: x => { const a = x * 2 - 1; return mix(PAPER, a > 0 ? WX.warm : WX.cold, Math.pow(Math.abs(a), 0.85) * 0.6); },
  fert: f => mix(fertRamp(f), PAPER, 0.08),
};

function gradient(fn, from, to, n = 24) {
  const stops = [];
  for (let i = 0; i <= n; i++) { const x = from + (to - from) * i / n; stops.push(`${css(fn(x))} ${(i / n * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
const bar = (bg, ticks) => `<div class="lg-bar" style="background:${bg}"></div><div class="lg-ticks">${ticks.map(([p, t]) => `<span style="left:${p}%">${t}</span>`).join('')}</div>`;
const sw = (c, name, cls = '') => `<span><i class="${cls}" style="--c:${css(c)};background:${cls ? 'transparent' : css(c)}"></i>${name}</span>`;
const grid = items => `<div class="lg-grid">${items.join('')}</div>`;

const BIOMES = [
  ['ice', 'Льды'], ['tundra', 'Тундра'], ['taiga', 'Тайга'], ['temperate_forest', 'Умеренный лес'], ['steppe', 'Степь'],
  ['mediterranean', 'Средиземноморье'], ['desert', 'Пустыня'], ['semi_desert', 'Полупустыня'], ['savanna', 'Саванна'],
  ['tropical_forest', 'Тропический лес'], ['wetland', 'Болота'], ['highland', 'Высокогорье'],
];

// Köppen: the five groups with their classes as small labelled chips (the code on the class colour)
function koppenLegend() {
  const chip = k => {
    const L = 0.3 * k.color[0] + 0.55 * k.color[1] + 0.15 * k.color[2];
    return `<span class="lg-chip${L < 0.5 ? ' dark' : ''}" style="background:${css(k.color)}" title="${k.code} — ${k.nameRu}">${k.code}</span>`;
  };
  const rows = KOPPEN_GROUPS.map(g => `<div class="lg-kg"><b>${g.key}</b>${g.nameRu}</div><div class="lg-chips">${KOPPEN.filter(k => k.group === g.key).map(chip).join('')}</div>`);
  return `${rows.join('')}<div class="lg-note">f — без сухого сезона · s — сухое лето · w — сухая зима; a, b, c — жаркое, тёплое, прохладное лето, d — лютая зима; h / k — жарко / холодно. Пояса этой эпохи: сдвигаются с климатом</div>`;
}

const CONTENT = {
  relief: () => ['Высота над морем', bar(gradient(RAMPS.hypso, 0, 6000), [[0, '0'], [8.3, '500'], [33, '2000'], [66, '4000'], [100, '6000 м']])],
  terrain: () => ['Природные зоны', `<div class="lg-grid">${BIOMES.map(([k, n]) => `<span><i style="background:${BIOME_COLORS[k]}"></i>${n}</span>`).join('')}</div>`],
  temperature: () => ['Температура месяца и погода дня', bar(gradient(RAMPS.temp, 0, 1), [[0, '−40'], [25, '−20'], [50, '0'], [75, '+20'], [100, '+40 °C']])],
  precipitation: () => ['Осадки за месяц', bar(gradient(RAMPS.prec, 0, 1), [[0, '0'], [25, '25'], [50, '100'], [75, '225'], [100, '400 мм']])],
  hazards: () => ['Наибольшая природная опасность', `<div class="lg-steps">${[1, 2, 3, 4, 5].map(l => `<span><i style="background:${css(RAMPS.hazard(l / 5))}"></i>${l}</span>`).join('')}</div><div class="lg-note">землетрясения: 1 = 2–4 балла · 2 = 4–6 · 3 = 6–8 · 4 = 8–10 · 5 = более 10</div>`],
  regions: () => ['Районы, провинции, регионы', '<div class="lg-note">толстая линия — регион, средняя — провинция, тонкая — район; у каждого региона своё семейство оттенков</div>'],
  koppen: () => ['Климатические пояса (по Кёппену)', koppenLegend()],
  fertility: () => ['Плодородие земель', bar(gradient(RAMPS.fert, 0, 1), [[0, 'бесплодные'], [50, 'средние'], [100, 'богатейшие']])
    + '<div class="lg-note">тепло для роста × влага × почвы × рельеф; реки, озёра и побережья дают воду засушливым землям, крутые склоны и высокогорья отнимают</div>'],
  weather: () => ['Погода сегодня', bar(gradient(RAMPS.anomaly, 0, 1), [[0, '−8'], [50, 'норма'], [100, '+8 °C']])
    + grid([sw(WX.rain(0.35), 'Дождь'), sw(WX.rain(1), 'Ливень'), sw(WX.snowfall(0.6), 'Снегопад'), sw(WX.cloud, 'Облачность'),
      sw(WX.snow, 'Снег и лёд'), sw(WX.drought, 'Засуха', 'hatch')])
    + '<div class="lg-note">отклонение от нормы этого месяца в нынешнюю эпоху</div>'],
  air: () => ['Воздух', grid([sw(AIR.ash, 'Вулканический пепел'), sw(AIR.smoke, 'Дым пожаров'), sw(AIR.dust, 'Пыль'), sw(AIR.sulf, 'Вулканическая дымка'),
    sw(AIR.fall, 'Пепел на земле', 'hatch'), sw(AIR.cool, 'Вулканическая зима')])
    + '<div class="lg-note">облака уносит ветрами; пустая карта — чистый воздух</div>'],
  winds: () => ['Ветры и течения', grid([sw(WIND.east, 'Пассаты, восточные'), sw(WIND.west, 'Западные ветры'), sw(PAPER, 'Штили'),
    sw(CURRENT.warm, 'Тёплые течения'), sw(CURRENT.cold, 'Холодные течения')])
    + '<div class="lg-note">штрихи — направление ветров этого сезона</div>'],
};

export function showLegend(mode) {
  const box = $('legend');
  if (!box) return;
  const c = CONTENT[mode];
  if (!c) { box.classList.add('hidden'); return; }
  const [title, html] = c();
  box.querySelector('.lg-title').textContent = title;
  box.querySelector('.lg-body').innerHTML = html;
  box.classList.remove('hidden');
}
