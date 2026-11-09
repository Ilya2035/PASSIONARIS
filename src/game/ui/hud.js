import { ICONS, MODE_DEFS } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Bottom-right hexagon map-mode buttons. available: Set of feature keys ('climate', 'hazards', 'regions').
export function buildModes(onSelect, available) {
  const el = $('modes');
  el.innerHTML = '';
  for (const m of MODE_DEFS) {
    if (m.needs && !available.has(m.needs)) continue;
    const b = document.createElement('button');
    b.className = 'hex'; b.dataset.mode = m.id; b.title = `${m.name} — ${m.hint}`;
    b.setAttribute('aria-label', m.name);
    b.innerHTML = ICONS[m.id] || '';
    b.onclick = () => onSelect(m.id);
    el.appendChild(b);
  }
}
export function markMode(id) {
  for (const b of $('modes').children) b.classList.toggle('active', b.dataset.mode === id);
}

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

export function showTooltip(html, x, y) {
  const t = $('tooltip');
  t.innerHTML = html;
  t.classList.remove('hidden');
  const tw = t.offsetWidth, th = t.offsetHeight;
  t.style.left = `${Math.min(window.innerWidth - tw - 8, x + 16)}px`;
  t.style.top = `${Math.min(window.innerHeight - th - 8, y + 18)}px`;
}
export function hideTooltip() { $('tooltip').classList.add('hidden'); }

// Event toasts (eruptions, quakes …): small paper slips that fade away
export function toast(html, ms = 5000, onClick = null) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = onClick ? 'toast link' : 'toast';
  el.innerHTML = html;
  if (onClick) el.onclick = onClick;
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, ms);
  return el;
}

export function updateCompassAndScale(heading, kmPerPixel) {
  $('compass-needle').setAttribute('transform', `rotate(${(-heading * 180 / Math.PI).toFixed(2)} 24 24)`);
  const target = kmPerPixel * 110;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map(m => m * pow).reverse().find(v => v <= target) || pow;
  $('scale-bar').style.width = `${(nice / kmPerPixel).toFixed(0)}px`;
  $('scale-text').textContent = nice >= 1 ? `${nice.toLocaleString('ru-RU')} км` : `${Math.round(nice * 1000)} м`;
}

export { esc };
