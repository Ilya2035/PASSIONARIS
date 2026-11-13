// The roads and the rivers as lines on the map (docs/album/roads.md, docs/album/water.md). The owner of this file is
// the part «Дороги и реки». The roads themselves are laid by roads/routes.js and drawn by layers/roads.js; this file
// is where the part keeps its knobs and pages. A knob with `map: 'Подпись'` gets a switch on the panel of the map
// (mapview.js) — that is how the owner turns kinds of roads on and off (13.11.2026: «в настройках нужна возможность
// нажать и посмотреть главные дороги (от провинции к провинции) и малые дороги; плюс мелкие улочки и тропы»).
const G = 'Города и дороги';
export default {
  id: 'roads', title: 'Дороги',
  glsl: '',
  uniforms: {},
  params: [
    { key: 'roadMain', label: 'Главные дороги', group: 'layers', type: 'toggle', value: 1, map: 'Главные дороги' },
    { key: 'roadMinor', label: 'Малые дороги', group: 'layers', type: 'toggle', value: 1, map: 'Малые дороги' },
    { key: 'roadTracks', label: 'Тропы', group: 'layers', type: 'toggle', value: 1, map: 'Тропы' },
  ],
  pages: [
    { id: 'roads-main', group: G, title: 'Главные дороги: от провинции к провинции', note: 'Только главные дороги. Сначала проложены большие дороги истории — Августова, Серебряный путь, Путь Иакова и другие, город за городом; потом город каждой провинции соединён с городами соседних провинций, если туда ещё не ведёт главная дорога. Путь выбирает рельеф: долиной, через перевал. С высоты дорога — тонкая нитка цвета утоптанной земли.', p: { roadMinor: 0, roadTracks: 0, labels: 0 }, cam: { lat: 40.3, lon: -3.2, h: 950, tilt: 0, heading: 0 } },
    { id: 'roads-minor', group: G, title: 'Малые дороги: между районами', note: 'Главные и малые дороги. Малая дорога идёт от города района к городу соседнего района; она проложена там, где без неё пришлось бы делать большой крюк. В каждый район, куда можно пройти, ведёт дорога. Где путь круто лезет в гору, вместо дороги — вьючная тропа через перевал.', p: { labels: 0 }, cam: { lat: 41.75, lon: -1.3, h: 170, tilt: 20, heading: 0 } },
    { id: 'roads-slope', group: G, title: 'Дорога лежит на склоне', note: 'Пиренеи, дорога из Сарагосы в Беарн: от Хаки вверх по долине к перевалу. Дорога лежит на земле, как настоящая: поднимается долиной, освещена тем же солнцем, в тени горы тоже в тени. В лесу вдоль неё просека.', p: { labels: 0 }, cam: { lat: 42.76, lon: -.78, h: 26, tilt: 56, heading: 20 } },
    { id: 'roads-bridge', group: G, title: 'Мост и брод', note: 'Где главная дорога встречает реку, стоит мост: каменный настил от берега до берега. Малая дорога наводит деревянный мост через небольшую реку, а через большую переправляется паромом — дорога просто подходит к воде с обеих сторон. Ручей все переходят вброд. Дорога не идёт по крышам: она кончается у первых домов поселения, дальше идут его улицы.', p: { labels: 0 }, cam: { lat: 41.652, lon: -.862, h: 20, tilt: 42, heading: 0 } },
  ],
};
