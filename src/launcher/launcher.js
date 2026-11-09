import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './launcher.css';
import changelogMd from '../../CHANGELOG.md?raw';
import { APP_NAME, VERSION, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron, DEFAULT_SETTINGS } from '../shared/settings.js';
import { PALETTES, applyUiPalette } from '../shared/palettes.js';

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
  ['s-window', 'windowMode', String],
  ['s-quality', 'quality', String],
  ['s-pixel', 'pixelRatio', Number],
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
$('quit').onclick = () => { if (isElectron) window.passionaris.quit(); else window.close(); };
$('win-close').onclick = () => window.passionaris?.quit();
$('win-min').onclick = () => window.passionaris?.minimize();

// ------------------------------------------------------------- menu art
// Rendered by the game engine itself (scripts/render-menu-art.mjs) — v1: the Nile Delta.
const MENU_ART = "assets/ui/menu-nile-delta";
$("bg").style.backgroundImage = `url("${MENU_ART}.jpg")`;
fetch(`${MENU_ART}.json`).then(r => r.ok ? r.json() : null).then(j => { if (j?.caption) $("art-caption").textContent = j.caption; }).catch(() => {});
