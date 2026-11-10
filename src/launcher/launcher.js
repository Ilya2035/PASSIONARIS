import '@fontsource/alegreya-sc/500.css';
import '@fontsource/alegreya-sc/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './launcher.css';
import changelogMd from '../../CHANGELOG.md?raw';
import { APP_NAME, VERSION, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron } from '../shared/settings.js';
import { applyUiPalette } from '../shared/palettes.js';
import { applyPackData } from '../engine/packs.js';
import { applyStippleTheme } from '../shared/stipple.js';
import { createTabs } from './tabs.js';
import { createSavesPanel } from './saves.js';
import { createSettingsPanel } from './settingsPanel.js';
applyStippleTheme();
tallPaper();

// The shared paper tile is 320 px tall with a top→bottom gradient: on tall panels (wide layout, the settings modal)
// its repeats show as bands. The launcher's panels get one tall tile instead: the same stipple, a gentler gradient.
function tallPaper() {
  try {
    const w = 320, h = 1200;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f1ebdf'); g.addColorStop(0.42, '#e7ddcc'); g.addColorStop(1, '#ddd2be');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    let s = 11 >>> 0;
    const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < w * h * 0.35; i++) {
      const y = R() * h;
      c.fillStyle = R() < 0.25 + 0.5 * Math.min(1, y / 520) ? 'rgba(110,85,55,.16)' : 'rgba(255,255,255,.5)';
      c.fillRect(R() * w, y, 1, 1);
    }
    // a blob URL keeps the (noisy, ~1 MB) image out of the style text
    cv.toBlob(b => { if (b) document.documentElement.style.setProperty('--tex-paper-tall', `url("${URL.createObjectURL(b)}")`); }, 'image/png');
  } catch { /* the regular tile stays */ }
}

const $ = id => document.getElementById(id);
if (!isElectron) document.body.classList.add('browser');
// screens for the resolution list: asked early (IPC), used by the settings modal
const displaysPromise = typeof window.passionaris?.displays === 'function' ? window.passionaris.displays().catch(() => null) : Promise.resolve(null);
document.title = `${APP_NAME} ${VERSION_LABEL} — лаунчер`;
$('ver').textContent = VERSION_LABEL;
$('epoch').textContent = EPOCH_LABEL;
$('foot-ver').textContent = `${APP_NAME} ${VERSION_LABEL}`;

// the art and the logo first: nothing below may delay them (settings, packs and saves are awaited later)
// ------------------------------------------------------------- menu art
// Rendered by the game engine itself (scripts/render-menu-art.mjs) — v1: the Nile Delta.
const MENU_ART = "assets/ui/menu-nile-delta";
$("bg").style.backgroundImage = `url("${MENU_ART}.jpg")`;
fetch(`${MENU_ART}.json`).then(r => r.ok ? r.json() : null).then(j => { if (j?.caption) $("art-caption").textContent = j.caption; }).catch(() => {});

// ------------------------------------------------------------- logo: light-gothic letters filled with bronze stipple
// Redrawn when the window is resized (the canvas follows the layout: 960×600 … large screens).
let logoSize = '';
function drawLogo() {
  const cv = $('logo');
  const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h || `${w}x${h}x${d}` === logoSize) return;
  logoSize = `${w}x${h}x${d}`;
  cv.width = w * d; cv.height = h * d;
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
  // measure with letter spacing applied, then fit the width (two passes: spacing scales with size) and the height
  let fs = 92;
  const setFont = size => { c.font = `700 ${size}px "Alegreya SC"`; if (c.letterSpacing !== undefined) c.letterSpacing = `${size * 0.04}px`; };
  setFont(fs);
  for (let k = 0; k < 2; k++) { fs = Math.min(96, h * 0.62, fs * (w - 14) / c.measureText('PASSIONARIS').width); setFont(fs); }
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
}
document.fonts.load('700 80px "Alegreya SC"').then(drawLogo, drawLogo);
let logoTimer = 0;
window.addEventListener('resize', () => { clearTimeout(logoTimer); logoTimer = setTimeout(drawLogo, 120); });

// ------------------------------------------------------------- changelog
function mdToHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let html = '', inList = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    // an indented line continues the previous list item
    if (inList && /^\s{2,}\S/.test(line)) { html = html.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`); continue; }
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
// The whole history in one scroll (newest first); the picker jumps to a version and follows the scroll.
const changelogEl = $('changelog'), changelogPane = $('pane-changelog');
changelogEl.innerHTML = sections.map(s => `<section class="cl-version" data-v="${versionOf(s) || ''}">${mdToHtml(s)}</section>`).join('');
const versionBlocks = [...changelogEl.querySelectorAll('.cl-version')];
let jumping = false;
select.onchange = () => {
  const el = versionBlocks.find(b => b.dataset.v === select.value);
  if (!el) return;
  jumping = true;
  changelogPane.scrollTop = el.offsetTop - changelogEl.offsetTop;
  requestAnimationFrame(() => { jumping = false; });
};
changelogPane.addEventListener('scroll', () => {
  if (jumping) return;
  const y = changelogPane.scrollTop + changelogEl.offsetTop + 24;
  let cur = versionBlocks[0];
  for (const b of versionBlocks) { if (b.offsetTop <= y) cur = b; else break; }
  if (cur && select.value !== cur.dataset.v) select.value = cur.dataset.v;
}, { passive: true });
select.value = VERSION;

// ------------------------------------------------------------- roadmap of epoch 0
const ROADMAP = [
  ['Обёртка (Electron) и лаунчер', 'done'],
  ['Глобус и 3D-карта высот', 'done'],
  ['Чёткая потоковая карта', 'done'],
  ['Районы, провинции, регионы, моря', 'done'],
  ['Погода, климат, времена года', 'done'],
  ['Стихии и хроника мира', 'done'],
  ['Ход времени', 'done'],
  ['Сохранение и загрузка', 'done'],
  ['Моды и дополнения', 'wip'],
  ['Визуализация и стиль', 'wip'],
  ['Оптимизация', 'wip'],
  ['Народы, города, государства', ''],
  ['Границы всех эпох', ''],
];
$('roadmap').innerHTML = ROADMAP.map(([t, s]) => `<li class="${s}">${t}</li>`).join('');
$('roadmap-title').textContent = EPOCH_LABEL;

// changelog and roadmap share one panel, in tabs (the version picker belongs to the changelog)
createTabs({
  strip: $('codex-tabs'),
  panes: id => $(`pane-${id}`),
  items: [{ id: 'changelog', label: 'Журнал изменений', short: 'Журнал' }, { id: 'roadmap', label: 'План', title: `${EPOCH_LABEL}: что готово и что впереди` }],
  storageKey: 'passionaris.launcher.codexTab',
  onChange: id => { select.style.visibility = id === 'changelog' ? '' : 'hidden'; },
});

// ------------------------------------------------------------- launching the game
// The game reads 'passionaris.continue' once on start (src/game/main.js) and loads that save (same origin).
const CONTINUE_KEY = 'passionaris.continue';
let launching = false;
async function launchGame(saveId = null) {
  if (launching) return;
  launching = true;
  document.body.classList.add('launching');
  try {
    if (saveId) localStorage.setItem(CONTINUE_KEY, saveId);
    else localStorage.removeItem(CONTINUE_KEY); // «Играть» = a new world, never a stale pick
  } catch { /* storage unavailable: the game starts fresh */ }
  await saveSettings(settings);
  if (isElectron) window.passionaris.launch(settings);
  else location.href = './game.html';
}

// ------------------------------------------------------------- settings
const settings = await loadSettings();
applyUiPalette(settings.palette);
// installed packs: palettes from enabled ones join the palette list
const packInfo = await applyPackData(settings).catch(() => ({ packs: [] }));

// ------------------------------------------------------------- saves on the main page; «Продолжить» = the newest one
const savesPanel = createSavesPanel({
  getSettings: () => settings,
  onLoad: id => launchGame(id),
  onLatest: latest => {
    const btn = $('continue');
    btn.disabled = !latest;
    $('continue-sub').textContent = latest ? [latest.name, latest.date].filter(Boolean).join(' · ') : '';
    btn.title = latest ? `${latest.name}${latest.date ? ' · ' + latest.date : ''}` : 'Сохранений пока нет';
    btn.onclick = latest ? () => launchGame(latest.id) : null;
  },
});
savesPanel.refresh();

const settingsPanel = createSettingsPanel({
  settings, packs: packInfo.packs || [], displays: displaysPromise,
  // the empty saves list mentions the autosave interval
  onChange: key => { if ((key === 'autosaveMinutes' || key === '*') && !savesPanel.items.length) savesPanel.refresh(); },
});
$('open-settings').onclick = () => settingsPanel.open();

$('play').onclick = () => launchGame(null);
$('quit').onclick = () => { if (isElectron) window.passionaris.quit(); else window.close(); };
$('win-close').onclick = () => window.passionaris?.quit();
$('win-min').onclick = () => window.passionaris?.minimize();
// in a plain browser there is no window to close or files to open
for (const el of document.querySelectorAll('.electron-only')) el.hidden = !isElectron;
