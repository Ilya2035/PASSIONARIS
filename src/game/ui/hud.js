import { buildModeButtons, markModeButtons } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- interface scale (settings.uiScale)
// Every HUD element (clock, modes, legend, info, tooltip, toasts, compass, modals, loading screen) carries
// `zoom: var(--ui)` in game.css: the browser lays text out at the final size, so it stays crisp at any scale
// (no bitmap stretching). Inside a zoomed element every length — px, vw, vh — is multiplied by --ui, which is why
// game.css writes viewport-sized limits as calc(100vh / var(--ui)).
// 'auto': the window size in CSS pixels already includes the OS display scaling (devicePixelRatio), so a 4K screen at
// 200% reads as 1920×1080 and keeps scale 1. A plain 1080p-class layout (1600×900 … 1920×1080) is 1; bigger windows
// (1440p, 4K at 100%) grow the interface by 70% of the extra size, smaller ones (1366×768, 1280×720) shrink it.
// devicePixelRatio sets the floor: text never drops below ~85% of its design size in physical pixels.
// Mirrored in game.html (inline script, sets --ui before the first paint) — keep both in sync.
export function autoUiScale(w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1) {
  const s = Math.min(h / 1080, w / 1600);
  let k = s >= 1 ? 1 + (s - 1) * 0.7 : s >= 0.8333 ? 1 : 1 - (0.8333 - s) * 1.1;
  k = Math.min(2.2, Math.max(k, 0.7, 0.85 / dpr));
  return Math.round(k * 20) / 20;
}
let ui = 1;
export const uiScale = () => ui;
// setting: 'auto' | number. Returns { ui, auto, wanted }: auto = what 'auto' would pick for this window,
// wanted = the asked-for scale. Any scale is capped so the HUD keeps a room of at least 760×480 of its own pixels
// (200% on a 1280×720 window becomes 150%): the corners never run into each other.
export function applyUiScale(setting) {
  const auto = autoUiScale();
  const n = Number(setting);
  const wanted = setting === 'auto' || setting == null || !(n > 0) ? auto : Math.min(2.5, Math.max(0.5, n));
  const fit = Math.floor(Math.min(window.innerWidth / 760, window.innerHeight / 480) * 20) / 20;
  ui = Math.max(0.6, Math.min(wanted, fit));
  document.documentElement.style.setProperty('--ui', String(ui));
  // room left for the HUD, in HUD pixels: narrow / short windows switch to a tighter layout (game.css)
  const rw = window.innerWidth / ui, rh = window.innerHeight / ui;
  document.body.classList.toggle('hud-narrow', rw < 700);
  document.body.classList.toggle('hud-tight', rw < 560);
  document.body.classList.toggle('hud-short', rh < 600);
  return { ui, auto, wanted };
}

// Bottom-right map-mode buttons. available: Set of feature keys ('climate', 'hazards', 'regions').
// (grouped modes open a column above their group's button: src/game/ui/icons.js)
export function buildModes(onSelect, available) { buildModeButtons($('modes'), onSelect, available); }
export function markMode(id) { markModeButtons($('modes'), id); }

// Top-right date & time. text: { date, time }, speed: 0..5
export function renderClock(text, speed) {
  $('clock-date').textContent = text.date;
  $('clock-time').textContent = text.time;
  for (const b of document.querySelectorAll('#clock-speed .spd')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
}
export function onSpeedClick(fn) {
  for (const b of document.querySelectorAll('#clock-speed .spd')) b.onclick = () => fn(Number(b.dataset.speed));
}

// Info window (opened on click). rows: [[label, value], ...] (plain text); [label, null] = section header.
// Refreshed live while time runs, so the DOM is touched only when the content changes.
let infoHtml = '';
export function showInfo({ kicker, title, rows }) {
  const html = `${esc(kicker)}|${esc(title)}|` + rows.map(([k, v]) => (v === null ? `<dt class="sec">${esc(k)}</dt>` : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)).join('');
  if (html !== infoHtml) {
    infoHtml = html;
    $('info-kicker').textContent = kicker || '';
    $('info-title').textContent = title || '';
    $('info-list').innerHTML = html.slice(html.indexOf('|', html.indexOf('|') + 1) + 1);
  }
  $('info').classList.remove('hidden');
}
export function hideInfo() { $('info').classList.add('hidden'); infoHtml = ''; }

let tipHtml = '';
export function showTooltip(html, x, y) {
  const t = $('tooltip');
  if (html !== tipHtml) { tipHtml = html; t.innerHTML = html; }
  t.classList.remove('hidden');
  // the tooltip is zoomed by --ui: offset sizes are unzoomed, and left/top are multiplied by the zoom
  const tw = t.offsetWidth * ui, th = t.offsetHeight * ui;
  t.style.left = `${(Math.max(4, Math.min(window.innerWidth - tw - 8, x + 16)) / ui).toFixed(1)}px`;
  t.style.top = `${(Math.max(4, Math.min(window.innerHeight - th - 8, y + 18)) / ui).toFixed(1)}px`;
}
export function hideTooltip() { $('tooltip').classList.add('hidden'); }

// Event toasts (eruptions, quakes …): small slips with an amber edge that fade away
export function toast(html, ms = 5000, onClick = null) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = onClick ? 'toast link' : 'toast';
  el.innerHTML = html;
  if (onClick) el.onclick = onClick;
  box.prepend(el);
  // short windows keep fewer slips so the column never reaches the legend and the mode buttons
  const max = document.body.classList.contains('hud-short') ? 3 : 5;
  while (box.children.length > max) box.lastChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, ms);
  return el;
}

// kmPerPixel: per CSS pixel of the map; the bar lives in the zoomed HUD (a HUD pixel = --ui CSS pixels)
let compassText = '', scaleW = '', scaleText = '';
export function updateCompassAndScale(heading, kmPerPixel) {
  const rot = `rotate(${(-heading * 180 / Math.PI).toFixed(1)} 24 24)`;
  if (rot !== compassText) { compassText = rot; $('compass-needle').setAttribute('transform', rot); }
  const target = kmPerPixel * 110 * ui;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map(m => m * pow).reverse().find(v => v <= target) || pow;
  const w = `${(nice / kmPerPixel / ui).toFixed(0)}px`;
  const txt = nice >= 1 ? `${nice.toLocaleString('ru-RU')} км` : `${Math.round(nice * 1000)} м`;
  if (w !== scaleW) { scaleW = w; $('scale-bar').style.width = w; }
  if (txt !== scaleText) { scaleText = txt; $('scale-text').textContent = txt; }
}

export { esc };
