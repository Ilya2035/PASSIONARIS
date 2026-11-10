// Map legend: a small paper slip above the mode buttons that says what the colours mean in the current mode.
// The ramps of the older modes are JS copies of the shader ramps in src/game/shaders.js (hypso, tempRamp, precRamp,
// hazardRamp); the climate belts, weather, air and winds read the same table as the shader (./mapcolors.js), and
// the fertility ramp comes straight from src/sim/climate/fertility.js — so those cannot drift from the map.
import { BIOME_COLORS } from '../world/biomes.js';
import { KOPPEN, KOPPEN_GROUPS } from '../../sim/climate/koppen.js';
import { fertRamp, FERT_TIERS } from '../../sim/climate/fertility.js';
import { koppenColor, WX, WX_STEPS, AIR, WIND } from './mapcolors.js';
import './legend.css';

const $ = id => document.getElementById(id);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c, d, t) => c.map((v, i) => v + (d[i] - v) * t);
const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

const PAPER = [0.83, 0.82, 0.75];   // ≈ the light paper land of the weather / air / winds maps
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
  fert: f => mix(fertRamp(f), PAPER, 0.08),
};

function gradient(fn, from, to, n = 24) {
  const stops = [];
  for (let i = 0; i <= n; i++) { const x = from + (to - from) * i / n; stops.push(`${css(fn(x))} ${(i / n * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
// a bar of equal flat steps (banded maps)
function steps(colors) {
  const n = colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${css(c)} ${(i / n * 100).toFixed(2)}% ${((i + 1) / n * 100).toFixed(2)}%`).join(', ')})`;
}
const bar = (bg, ticks) => `<div class="lg-bar" style="background:${bg}"></div><div class="lg-ticks">${ticks.map(([p, t]) => `<span style="left:${p}%">${t}</span>`).join('')}</div>`;
// a swatch with a name; cls: 'hatch' (diagonal strokes) or 'dots' (stipple) drawn in the colour over paper
const sw = (c, name, cls = '') => `<span><i class="${cls}" style="--c:${css(c)};background:${cls ? css(PAPER) : css(c)}"></i>${name}</span>`;
// a swatch of several flat steps (thin → thick)
const swSteps = (colors, name) => `<span><i class="wide" style="background:${steps(colors)}"></i>${name}</span>`;
const grid = (items, cls = '') => `<div class="lg-grid ${cls}">${items.join('')}</div>`;
const sub = text => `<div class="lg-sub">${text}</div>`;
const note = text => `<div class="lg-note">${text}</div>`;

const BIOMES = [
  ['ice', 'Льды'], ['tundra', 'Тундра'], ['taiga', 'Тайга'], ['temperate_forest', 'Умеренный лес'], ['steppe', 'Степь'],
  ['mediterranean', 'Средиземноморье'], ['desert', 'Пустыня'], ['semi_desert', 'Полупустыня'], ['savanna', 'Саванна'],
  ['tropical_forest', 'Тропический лес'], ['wetland', 'Болота'], ['highland', 'Высокогорье'],
];

// Köppen: the five groups with their classes as small labelled chips (the code on the class colour)
function koppenLegend() {
  const chip = k => {
    const c = koppenColor(k.code), L = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
    return `<span class="lg-chip${L < 0.52 ? ' dark' : ''}" style="background:${css(c)}" title="${k.code} — ${k.nameRu}">${k.code}</span>`;
  };
  const rows = KOPPEN_GROUPS.map(g => `<div class="lg-kg"><b>${g.key}</b>${g.nameRu}</div><div class="lg-chips">${KOPPEN.filter(k => k.group === g.key).map(chip).join('')}</div>`);
  return `${rows.join('')}${note('вторая буква — сухой сезон: f — нет, s — летом, w — зимой; третья — лето: a — жаркое, b — тёплое, c — прохладное, d — лютая зима; h и k — жаркая и холодная сушь. Название пояса — при наведении на значок. Пояса показаны для этой эпохи')}`;
}

// «Плодородие»: the ramp with its six named tiers
function fertilityLegend() {
  const tiers = FERT_TIERS.map((t, i) => {
    const lo = i ? FERT_TIERS[i - 1].max : 0, hi = Number.isFinite(t.max) ? t.max : 1;
    return sw(RAMPS.fert((lo + hi) / 2), t.nameRu[0].toUpperCase() + t.nameRu.slice(1));
  });
  return bar(gradient(RAMPS.fert, 0, 1), [[0, '0'], [20, '20'], [40, '40'], [60, '60'], [80, '80'], [100, '100 %']])
    + grid(tiers, 'three')
    + note('тепло для роста × влага × почвы × рельеф; реки, озёра и побережья дают воду засушливым землям, крутые склоны и высокогорья отнимают');
}

// «Погода сегодня»: the anomaly in the map's own bands (four on either side of the norm), then the signs
function weatherLegend() {
  const n = WX_STEPS.anomaly.length, bands = [];
  for (let i = -n; i <= n; i++) bands.push(mix(PAPER, i > 0 ? WX.warm : WX.cold, Math.abs(i) / n * 0.64));
  return sub('Температура против нормы месяца')
    + bar(steps(bands), [[0, '−8'], [27.8, '−4'], [50, 'норма'], [72.2, '+4'], [100, '+8 °C']])
    + sub('Осадки за день')
    + grid([swSteps(WX.rain, 'Морось · дождь · ливень'), swSteps(WX.snowfall, 'Снегопад: слабый · сильный')], 'one')
    + grid([sw(WX.cloud, 'Облачность', 'dots'), sw(WX.snow, 'Снег и лёд'), sw(WX.drought, 'Засуха', 'hatch')], 'three')
    + note('норма — средняя температура этого месяца в нынешнюю эпоху');
}

function airLegend() {
  const thin = (c, k) => mix(PAPER, c, k);
  const three = (c, top) => [thin(c, 0.5 * top), thin(c, 0.78 * top), thin(c, top)];
  return grid([swSteps(three(AIR.ash, 0.93), 'Вулканический пепел'), swSteps(three(AIR.smoke, 0.9), 'Дым пожаров'), swSteps(three(AIR.dust, 0.9), 'Пыль')], 'one')
    + grid([sw(thin(AIR.sulf, 0.7), 'Вулканическая дымка'), sw(thin(AIR.cool, 0.42), 'Вулканическая зима'), sw(AIR.fall, 'Пепел на земле', 'hatch')])
    + note('три ступени: редкое, густое, плотное облако. Облака несёт ветер; чистая карта — чистый воздух');
}

function windsLegend() {
  const belt = c => mix(PAPER, c, 0.36);
  return grid([sw(belt(WIND.east), 'Пассаты и полярные восточные'), sw(belt(WIND.west), 'Западные ветры'), sw(PAPER, 'Штили')], 'one')
    + grid([sw(CURRENT.warm, 'Тёплые течения'), sw(CURRENT.cold, 'Холодные течения')])
    + note('штрихи — куда дует ветер в этом сезоне; линии в море — течения');
}

const CONTENT = {
  relief: () => ['Высота над морем', bar(gradient(RAMPS.hypso, 0, 6000), [[0, '0'], [8.3, '500'], [33, '2000'], [66, '4000'], [100, '6000 м']])],
  terrain: () => ['Природные зоны', `<div class="lg-grid">${BIOMES.map(([k, n]) => `<span><i style="background:${BIOME_COLORS[k]}"></i>${n}</span>`).join('')}</div>`],
  temperature: () => ['Температура месяца и погода дня', bar(gradient(RAMPS.temp, 0, 1), [[0, '−40'], [25, '−20'], [50, '0'], [75, '+20'], [100, '+40 °C']])],
  precipitation: () => ['Осадки за месяц', bar(gradient(RAMPS.prec, 0, 1), [[0, '0'], [25, '25'], [50, '100'], [75, '225'], [100, '400 мм']])],
  hazards: () => ['Наибольшая природная опасность', `<div class="lg-steps">${[1, 2, 3, 4, 5].map(l => `<span><i style="background:${css(RAMPS.hazard(l / 5))}"></i>${l}</span>`).join('')}</div><div class="lg-note">землетрясения: 1 = 2–4 балла · 2 = 4–6 · 3 = 6–8 · 4 = 8–10 · 5 = более 10</div>`],
  regions: () => ['Районы, провинции, регионы', '<div class="lg-note">толстая линия — регион, средняя — провинция, тонкая — район; у каждого региона своё семейство оттенков</div>'],
  koppen: () => ['Климатические пояса (по Кёппену)', koppenLegend()],
  fertility: () => ['Плодородие земель', fertilityLegend()],
  weather: () => ['Погода сегодня', weatherLegend()],
  air: () => ['Воздух', airLegend()],
  winds: () => ['Ветры и течения', windsLegend()],
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
