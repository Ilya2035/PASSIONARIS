import '@fontsource/alegreya-sc/500.css';
import '@fontsource/alegreya-sc/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './launcher.css';
import changelogMd from '../../CHANGELOG.md?raw';
import { APP_NAME, VERSION, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron, DEFAULT_SETTINGS } from '../shared/settings.js';
import { PALETTES, applyUiPalette } from '../shared/palettes.js';
import { applyStippleTheme } from '../shared/stipple.js';
applyStippleTheme();

const $ = id => document.getElementById(id);
if (!isElectron) document.body.classList.add('browser');
document.title = `${APP_NAME} ${VERSION_LABEL} — лаунчер`;
$('ver').textContent = VERSION_LABEL;
$('epoch').textContent = EPOCH_LABEL;
$('foot-ver').textContent = `${APP_NAME} ${VERSION_LABEL}`;

// ------------------------------------------------------------- changelog
function mdToHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let html = '', inList = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^## /.test(line)) html += `<h3>${inline(line.slice(3))}</h3>`;
    else if (/^### /.test(line)) html += `<h4>${inline(line.slice(4))}</h4>`;
    else if (line.trim() && !/^# /.test(line)) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
const sections = changelogMd.split(/^(?=## )/m).filter(s => s.startsWith('## '));
const versionOf = s => (s.match(/^## \[?v?([\d.]+)/) || [])[1];
const select = $('version-select');
for (const s of sections) {
  const v = versionOf(s); if (!v) continue;
  const o = document.createElement('option');
  o.value = v; o.textContent = `v${v}${v === VERSION ? ' · текущая' : ''}`;
  select.appendChild(o);
}
const showVersion = v => { $('changelog').innerHTML = mdToHtml(sections.find(s => versionOf(s) === v) || sections[0] || ''); };
select.onchange = () => showVersion(select.value);
select.value = VERSION;
showVersion(VERSION);

// ------------------------------------------------------------- roadmap of epoch 0
const ROADMAP = [
  ['Обёртка (Electron) и лаунчер', 'done'],
  ['Глобус и 3D-карта высот', 'done'],
  ['Чёткая потоковая карта', 'wip'],
  ['Территории 10×10 км и районы', 'wip'],
  ['Провинции и регионы', ''],
  ['Границы всех эпох', ''],
  ['Погода и климат', ''],
  ['Визуализация и стиль', 'wip'],
  ['Ход времени', ''],
  ['Сохранение и загрузка', ''],
  ['Старые и новые версии', ''],
  ['Оптимизация', ''],
];
$('roadmap').innerHTML = ROADMAP.map(([t, s]) => `<li class="${s}">${t}</li>`).join('');

// ------------------------------------------------------------- settings
const settings = await loadSettings();
applyUiPalette(settings.palette);
for (const [id, p] of Object.entries(PALETTES)) {
  const o = document.createElement('option'); o.value = id; o.textContent = p.name; $('s-palette').appendChild(o);
}
const fields = [
  ['s-palette', 'palette', String],
  ['s-gpu', 'gpu', String],
  ['s-window', 'windowMode', String],
  ['s-quality', 'quality', String],
  ['s-scale', 'renderScale', v => (v === 'auto' ? 'auto' : Number(v))],
  ['s-bright', 'brightness', Number],
  ['s-relief', 'reliefScale', Number],
  ['s-unroll', 'unroll', Number],
];
const syncFields = () => { for (const [id, key] of fields) $(id).value = String(settings[key]); };
syncFields();
for (const [id, key, parse] of fields) $(id).addEventListener('input', () => { settings[key] = parse($(id).value); saveSettings(settings); });
// palette change: restyle instantly (the background globe picks it up on next launch of the page)
$('s-palette').addEventListener('input', () => applyUiPalette(settings.palette));
$('open-settings').onclick = () => $('settings').classList.add('open');
$('s-close').onclick = () => $('settings').classList.remove('open');
$('s-reset').onclick = () => { Object.assign(settings, DEFAULT_SETTINGS); syncFields(); saveSettings(settings); };
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').classList.remove('open'); });

// ------------------------------------------------------------- actions
$('play').onclick = async () => {
  await saveSettings(settings);
  if (isElectron) window.passionaris.launch(settings);
  else location.href = './game.html';
};
// "Continue": the latest save (manual or autosave); the game picks the id up from localStorage (same origin)
const CONTINUE_KEY = 'passionaris.continue';
(async () => {
  try {
    const { createDefaultStorage } = await import('../save/index.js');
    const list = await createDefaultStorage().list();
    if (!list?.length) return;
    const last = list.slice().sort((a, b) => (b.modified || 0) - (a.modified || 0))[0];
    const btn = $('continue');
    btn.disabled = false;
    btn.title = [last.meta?.name || last.id, last.meta?.dateText].filter(Boolean).join(' · ');
    btn.onclick = async () => {
      try { localStorage.setItem(CONTINUE_KEY, last.id); } catch { /* private mode: start fresh */ }
      await saveSettings(settings);
      if (isElectron) window.passionaris.launch(settings);
      else location.href = './game.html';
    };
  } catch (e) { console.warn('saves', e); }
})();
$('quit').onclick = () => { if (isElectron) window.passionaris.quit(); else window.close(); };
$('win-close').onclick = () => window.passionaris?.quit();
$('win-min').onclick = () => window.passionaris?.minimize();

// ------------------------------------------------------------- menu art
// Rendered by the game engine itself (scripts/render-menu-art.mjs) — v1: the Nile Delta.
const MENU_ART = "assets/ui/menu-nile-delta";
$("bg").style.backgroundImage = `url("${MENU_ART}.jpg")`;
fetch(`${MENU_ART}.json`).then(r => r.ok ? r.json() : null).then(j => { if (j?.caption) $("art-caption").textContent = j.caption; }).catch(() => {});

// ------------------------------------------------------------- logo: light-gothic letters filled with bronze stipple
document.fonts.load('700 80px "Alegreya SC"').then(() => {
  const cv = $('logo');
  const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * d; cv.height = h * d;
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
  // measure with letter spacing applied, then fit the width (two passes: spacing scales with size)
  let fs = 92;
  const setFont = size => { c.font = `700 ${size}px "Alegreya SC"`; if (c.letterSpacing !== undefined) c.letterSpacing = `${size * 0.04}px`; };
  setFont(fs);
  for (let k = 0; k < 2; k++) { fs = Math.min(96, fs * (w - 14) / c.measureText('PASSIONARIS').width); setFont(fs); }
  const tw = c.measureText('PASSIONARIS').width;
  const x0 = 2, yb = h * 0.62;
  const m = document.createElement('canvas'); m.width = cv.width; m.height = cv.height;
  const mc = m.getContext('2d'); mc.setTransform(d, 0, 0, d, 0, 0); mc.font = c.font; if (mc.letterSpacing !== undefined) mc.letterSpacing = c.letterSpacing;
  mc.fillText('PASSIONARIS', x0, yb);
  const md = mc.getImageData(0, 0, m.width, m.height).data;
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillText('PASSIONARIS', x0 + 2, yb + 3);
  c.fillStyle = '#5a4026'; c.fillText('PASSIONARIS', x0, yb);
  let s = 77; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const top = [242, 222, 172], bot = [140, 98, 52];
  for (let i = 0; i < w * h * 1.6; i++) {
    const x = R() * w, y = R() * h; const px = Math.floor(x * d), py = Math.floor(y * d);
    if (md[(py * m.width + px) * 4 + 3] < 128) continue;
    const t = Math.min(1, Math.max(0, (y - (yb - fs * 0.75)) / (fs * 0.8)));
    const col = top.map((v, k) => Math.round(v + (bot[k] - v) * t));
    c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},.95)`; c.fillRect(x, y, 0.9, 0.9);
  }
  c.lineWidth = 0.7; c.strokeStyle = 'rgba(30,20,10,.8)'; c.strokeText('PASSIONARIS', x0, yb);
  const ly = yb + fs * 0.24; c.strokeStyle = '#b58a52'; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x0, ly); c.lineTo(x0 + tw * 0.44, ly); c.moveTo(x0 + tw * 0.56, ly); c.lineTo(x0 + tw, ly); c.stroke();
  c.fillStyle = '#d9b77c'; c.beginPath(); c.moveTo(x0 + tw / 2, ly - 6); c.lineTo(x0 + tw / 2 + 8, ly); c.lineTo(x0 + tw / 2, ly + 6); c.lineTo(x0 + tw / 2 - 8, ly); c.closePath(); c.fill();
});
