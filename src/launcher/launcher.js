import '../shared/theme.css';
import './launcher.css';
import changelogMd from '../../CHANGELOG.md?raw';
import { APP_NAME, VERSION, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron } from '../shared/settings.js';
import { applyUiPalette } from '../shared/palettes.js';
import { applyPackData } from '../engine/packs.js';
import { createTabs } from './tabs.js';
import { createSavesPanel } from './saves.js';
import { createSettingsPanel } from './settingsPanel.js';
const $ = id => document.getElementById(id);
if (!isElectron) document.body.classList.add('browser');
// screens for the resolution list: asked early (IPC), used by the settings modal
const displaysPromise = typeof window.passionaris?.displays === 'function' ? window.passionaris.displays().catch(() => null) : Promise.resolve(null);
document.title = `${APP_NAME} ${VERSION_LABEL} — лаунчер`;
$('ver').textContent = VERSION_LABEL;
$('epoch').textContent = EPOCH_LABEL;
$('foot-ver').textContent = `${APP_NAME} ${VERSION_LABEL}`;

// the art first: nothing below may delay it (settings, packs and saves are awaited later)
// ------------------------------------------------------------- menu art
// Rendered by the game engine itself (scripts/render-menu-art.mjs) — v1: the Nile Delta.
const MENU_ART = "assets/ui/menu-nile-delta";
$("bg").style.backgroundImage = `url("${MENU_ART}.jpg")`;
fetch(`${MENU_ART}.json`).then(r => r.ok ? r.json() : null).then(j => { if (j?.caption) $("art-caption").textContent = j.caption; }).catch(() => {});

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
    else localStorage.removeItem(CONTINUE_KEY); // «Глобус: прежняя игра» = a new world, never a stale pick
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
// the graphics album (album.html, docs/ALBUM.md): its own window in the app, a plain page in a browser
$('open-album').onclick = () => { if (isElectron) window.passionaris.openAlbum('album'); else location.href = 'album.html?view=album'; };

// «Играть» — the first version of the game on the new map (the owner, 13.11.2026: «собрать первую версию, хотя бы
// какая есть, чтобы можно было просто карту посмотреть… нужна в игре»): the map of the album on its own, with its
// map modes (src/album/mapview.js, view=game). The game on the globe — the world from 5000 BC, time, weather, saves —
// keeps its own button, and «Продолжить» and the saves still open it.
async function launchMap() {
  if (launching) return;
  launching = true;
  document.body.classList.add('launching');
  await saveSettings(settings);
  if (isElectron) window.passionaris.openAlbum('game');
  else location.href = './album.html?view=game';
}
$('play').onclick = () => launchMap();
$('play-globe').onclick = () => launchGame(null);
$('quit').onclick = () => { if (isElectron) window.passionaris.quit(); else window.close(); };
$('win-close').onclick = () => window.passionaris?.quit();
$('win-min').onclick = () => window.passionaris?.minimize();
// in a plain browser there is no window to close or files to open
for (const el of document.querySelectorAll('.electron-only')) el.hidden = !isElectron;
