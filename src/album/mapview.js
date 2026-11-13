// The map on its own: the album without its pages and knobs (the owner, 13.11.2026: «собрать первую версию, хотя бы
// какая есть, чтобы можно было просто карту посмотреть… не забудь добавить возможность просмотра провинций, районов,
// регионов и так далее. Как раз посмотрю оптимизацию и все остальные изменения»).
//
// One small panel: the map modes (the natural map; districts, provinces, regions; the chunks of 1 km² for checking;
// temperature and heights), a few switches, and how fast the picture is drawn. The camera panel of the album stays.
//
// The page opens in one of three ways:
//   game   «Играть» in the launcher: the first version of the game on the new map (the owner, 13.11.2026, asked
//          whether the map view in the album was that first version: «Нужна в игре»). The map on its own and
//          nothing of the album.
//   map    the same from inside the album: a button brings the whole album back — its pages, marks and knobs — and
//          another returns here. Which of the two was open is remembered.
//   album  the album as it was.
// Nothing here draws the map: the modes are sets of the album's own parameters (params.js).

// a map mode: its name, what it sets, and how to tell that it is on
export const MAP_MODES = [
  { id: 'nature', title: 'Природа', hint: 'Обычная карта: земля, лес, вода, поселения, дороги', set: { division: 0, km: 0, data: 0 } },
  { id: 'districts', title: 'Районы', hint: 'Районы около 20 км. Щелчок по району открывает сведения о нём', set: { division: 1, km: 0, data: 0 } },
  { id: 'provinces', title: 'Провинции', hint: 'Исторические провинции. Из них собираются государства', set: { division: 2, km: 0, data: 0 } },
  { id: 'regions', title: 'Регионы', hint: 'Большие культурно-географические земли и моря', set: { division: 3, km: 0, data: 0 } },
  { id: 'chunks', title: 'Чанки', hint: 'Проверочный вид: чанки по 1 км² внутри районов. Видны с высоты до 150 км; в игре их не видно', set: { division: 1, km: 1, data: 0 } },
  { id: 'temperature', title: 'Температура', hint: 'Данные: температура', set: { division: 0, km: 0, data: 1 } },
  { id: 'heights', title: 'Высоты', hint: 'Данные: высоты', set: { division: 0, km: 0, data: 2 } },
];
// which mode the parameters of the album show now
export function modeOf(get) {
  if (get('data') === 1) return 'temperature';
  if (get('data') === 2) return 'heights';
  if (get('km') > 0 && get('division') > 0) return 'chunks';
  return ['nature', 'districts', 'provinces', 'regions'][get('division')] || 'nature';
}
// What a mode sets. The division is shown over the flat paper map, where the lands read as on a political map — or,
// with `natural`, over the natural land. The natural map has its trees standing; the flat ones do not.
export function modeParams(id, natural = false) {
  const m = MAP_MODES.find(x => x.id === id) || MAP_MODES[0], flat = m.set.division > 0 && !natural;
  return { ...m.set, look: flat ? 'paper' : 'natural', forest3d: flat || m.set.data ? 0 : 1 };
}
// the switches of the panel: a knob of the album each
export const MAP_SWITCHES = [['towns', 'Поселения'], ['roadsOn', 'Дороги'], ['riversOn', 'Реки'], ['labels', 'Подписи'], ['divLabels', 'Названия земель']];
export const VIEW_KEY = 'passionaris.album.view';
// which view to open: the address says (view=map / view=album), else what was open last, else the map. A capture
// (shot=1) keeps to the album unless told otherwise, so that the pictures taken for the notes stay as they were.
export function startView(q, stored, shot = false) {
  const v = q.get('view'); if (v === 'map' || v === 'album' || v === 'game') return v;
  if (shot || q.get('page')) return 'album';
  return stored === 'album' ? 'album' : 'map';
}

const CSS = `
body.mapview #ui > .left, body.mapview #ui > .top, body.mapview #ui > .right, body.mapview #ui > .modes { display: none; }
body.mapview #ui > .cam { left: 20px; }
body.mapview #ui > .back { right: 20px; }
body.mapview #ui > .hint { left: 392px; right: 20px; bottom: 20px; }
body:not(.mapview) #ui > .mv { display: none; }
body.mapview #ui > .mv-open { display: none; }
body.gameview #ui > .mv .mv-album { display: none; }
#ui > .mv { left: 20px; top: 20px; width: 352px; gap: 8px; }
.mv .mv-modes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.mv .mv-modes .btn { justify-content: center; }
.mv .mv-sw { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 10px; }
.mv .mv-sw label { display: flex; align-items: center; gap: 6px; cursor: pointer; font: 400 var(--fs-s)/1.3 var(--font-ui); color: var(--c-text); padding: 2px 0; }
.mv .mv-fps { font-variant-numeric: tabular-nums; color: var(--c-text); }
.mv .mv-line { border-top: var(--border) solid var(--c-line); padding-top: 8px; }
#ui > .mv-open { position: absolute; right: 358px; top: 64px; }
`;

export function initMapView(album, q) {
  const root = document.getElementById('ui'), p = album.params; if (!root || !p) return null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (cls, text) => { const b = el('button', `btn ${cls}`.trim(), text); b.type = 'button'; return b; };
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const store = { get: () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } }, set: v => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* a private window: nothing to remember */ } } };

  // ---- the panel of the map
  const box = el('div', 'panel pn mv'), modes = el('div', 'mv-modes'), hint = el('div', 'S'), sw = el('div', 'mv-sw mv-line'), fps = el('div', 'S mv-fps mv-line');
  let natural = false;
  const mBtns = MAP_MODES.map(m => { const b = button('off', m.title); b.title = m.hint; b.onclick = () => p.setMany(modeParams(m.id, natural)); modes.append(b); return b; });
  const over = el('label'), overBox = Object.assign(el('input', 'toggle'), { type: 'checkbox' }); over.append(overBox, el('span', null, 'Деление поверх натуральной карты'));
  over.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font:400 var(--fs-s)/1.3 var(--font-ui)';
  overBox.onchange = () => { natural = overBox.checked; const id = modeOf(p.get); if (MAP_MODES.find(m => m.id === id).set.division) p.setMany(modeParams(id, natural)); };
  const sBoxes = MAP_SWITCHES.filter(([k]) => p.get(k) !== undefined).map(([k, name]) => {
    const l = el('label'), c = Object.assign(el('input', 'toggle'), { type: 'checkbox' }); c.onchange = () => p.set(k, c.checked ? 1 : 0); l.append(c, el('span', null, name)); sw.append(l); return [k, c];
  });
  const toAlbum = button('mv-album', 'Альбом: страницы и настройки'); toAlbum.title = 'Все страницы альбома, отметки «Подходит» и «Не то», ручки вида';
  const name = el('span', 'cap', 'Passionaris'), head = el('div', 'hd2'); head.append(name, el('span', 'L', 'Карта'));
  box.append(head, modes, over, hint, sw, fps, toAlbum);
  // the version beside the name (the owner's rule), where the app can tell it
  window.passionaris?.appInfo?.().then(i => { if (i?.version) name.textContent = `Passionaris · версия ${i.version}`; }).catch(() => {});
  const toMap = button('mv-open', 'Просто карта'); toMap.title = 'Убрать страницы и ручки альбома, оставить карту и её режимы';
  root.append(box, toMap);

  function show(view) {
    document.body.classList.toggle('mapview', view !== 'album'); document.body.classList.toggle('gameview', view === 'game');
    if (view !== 'game') store.set(view);                            // the game does not change how the album opens
    sync();
  }
  toAlbum.onclick = () => show('album'); toMap.onclick = () => show('map');
  function sync() {
    const id = modeOf(p.get), m = MAP_MODES.find(x => x.id === id);
    mBtns.forEach((b, i) => b.classList.toggle('off', MAP_MODES[i].id !== id));
    hint.textContent = m.hint;
    for (const [k, c] of sBoxes) c.checked = !!p.get(k);
    if (m.set.division) { natural = p.get('look') !== 'paper'; overBox.checked = natural; }
  }
  p.on(sync);
  // how fast the picture is drawn: frames a second, the time of a frame, and whether the album has made the picture
  // coarser to keep up (main.js steps the picture scale down when frames run late)
  const shown = album.onFps;
  album.onFps = f => {
    shown?.(f);
    const dom = album.renderer.domElement, scale = Math.round((album.autoScale ?? 1) * (p.get('renderScale') || 1) * 100);
    fps.textContent = `${f.toFixed(0)} кадров в секунду · кадр ${(1000 / Math.max(f, .1)).toFixed(1)} мс · картинка ${dom.width} × ${dom.height}${scale < 100 ? ` (чёткость ${scale} %)` : ''}`;
  };
  fps.textContent = 'Скорость: считаю…';

  const first = startView(q, store.get(), album.shot);
  if (first !== 'album' && !q.get('page') && album.pages?.some(pg => pg.id === 'map')) album.openPage('map');
  show(first);
  return { show, mode: () => modeOf(p.get), view: () => (document.body.classList.contains('gameview') ? 'game' : document.body.classList.contains('mapview') ? 'map' : 'album') };
}
