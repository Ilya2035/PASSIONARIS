// Map legend: a small paper slip above the mode buttons that says what the colours mean in the current mode.
// The ramps are JS copies of the shader ramps in src/game/shaders.js (hypso, tempRamp, precRamp, hazardRamp).
import { BIOME_COLORS } from '../world/biomes.js';

const $ = id => document.getElementById(id);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c, d, t) => c.map((v, i) => v + (d[i] - v) * t);
const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

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
};

function gradient(fn, from, to, n = 24) {
  const stops = [];
  for (let i = 0; i <= n; i++) { const x = from + (to - from) * i / n; stops.push(`${css(fn(x))} ${(i / n * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
const bar = (bg, ticks) => `<div class="lg-bar" style="background:${bg}"></div><div class="lg-ticks">${ticks.map(([p, t]) => `<span style="left:${p}%">${t}</span>`).join('')}</div>`;

const BIOMES = [
  ['ice', 'Льды'], ['tundra', 'Тундра'], ['taiga', 'Тайга'], ['temperate_forest', 'Умеренный лес'], ['steppe', 'Степь'],
  ['mediterranean', 'Средиземноморье'], ['desert', 'Пустыня'], ['semi_desert', 'Полупустыня'], ['savanna', 'Саванна'],
  ['tropical_forest', 'Тропический лес'], ['wetland', 'Болота'], ['highland', 'Высокогорье'],
];

const CONTENT = {
  relief: () => ['Высота над морем', bar(gradient(RAMPS.hypso, 0, 6000), [[0, '0'], [8.3, '500'], [33, '2000'], [66, '4000'], [100, '6000 м']])],
  terrain: () => ['Природные зоны', `<div class="lg-grid">${BIOMES.map(([k, n]) => `<span><i style="background:${BIOME_COLORS[k]}"></i>${n}</span>`).join('')}</div>`],
  temperature: () => ['Температура месяца и погода дня', bar(gradient(RAMPS.temp, 0, 1), [[0, '−40'], [25, '−20'], [50, '0'], [75, '+20'], [100, '+40 °C']])],
  precipitation: () => ['Осадки за месяц', bar(gradient(RAMPS.prec, 0, 1), [[0, '0'], [25, '25'], [50, '100'], [75, '225'], [100, '400 мм']])],
  hazards: () => ['Наибольшая природная опасность', `<div class="lg-steps">${[1, 2, 3, 4, 5].map(l => `<span><i style="background:${css(RAMPS.hazard(l / 5))}"></i>${l}</span>`).join('')}</div><div class="lg-note">землетрясения: 1 = 2–4 балла · 2 = 4–6 · 3 = 6–8 · 4 = 8–10 · 5 = более 10</div>`],
  regions: () => ['Районы, провинции, регионы', '<div class="lg-note">толстая линия — регион, средняя — провинция, тонкая — район; у каждого региона своё семейство оттенков</div>'],
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
