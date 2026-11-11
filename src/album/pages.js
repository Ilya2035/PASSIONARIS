// The pages of the album: named sets of parameters (params.js) with a camera. The UI lists them by group; the owner
// marks each as fitting or not. To add a page, add a line here — or, for a page about one aspect of the picture
// (forest, water, settlements …), in that aspect's own file (aspects/*.js).
import { ASPECT_PAGES } from './aspects/index.js';

const P = { pyr: [42.63, .66], ebro: [40.72, .72], gib: [36.0, -5.5], mad: [40.6, -3.85], nev: [37.05, -3.35], tou: [43.6, 1.35], pic: [43.2, -4.85], lis: [38.75, -9.15] };
const cam = (ll, h, tilt = 0, heading = 0) => ({ lat: ll[0], lon: ll[1], h, tilt, heading });
// the order of the groups in the list; a group not named here goes to the end
const GROUPS = ['Земля', 'Чанки', 'Масштаб объектов', 'Лес', 'Вода и свет', 'Болота', 'Города и дороги', 'Режимы карты', 'Ресурсы', 'Бедствия'];

const BASE = [
  // ---- the land itself
  { id: 'land-far', group: 'Земля', title: 'Натуральная: весь полуостров', note: 'Вид с 1700 км: леса, сухие равнины Эбро и юго-востока, снег на Пиренеях, отмели у берегов.', p: { look: 'natural' }, cam: cam([40.2, -3.4], 1700) },
  { id: 'land-200', group: 'Земля', title: 'Натуральная: Пиренеи с 200 км', note: 'Обычная игровая высота. Смотрите на рельеф, тени и границу леса.', p: { look: 'natural' }, cam: cam(P.pyr, 200, 48, 15) },
  { id: 'land-20', group: 'Земля', title: 'Натуральная: Пиренеи с 25 км', note: 'Почти самая близкая высота. Скалы, снег, объёмные деревья.', p: { look: 'natural' }, cam: cam(P.pyr, 25, 58, 160) },
  { id: 'land-vivid', group: 'Земля', title: 'Яркая: Гибралтарский пролив', note: 'Те же данные, но цвета насыщеннее и свет теплее.', p: { look: 'vivid' }, cam: cam(P.gib, 180, 45, -30) },
  { id: 'land-autumn', group: 'Земля', title: 'Осень: Пикос-де-Эуропа', note: 'Широколиственный лес желтеет, снег опускается ниже.', p: { look: 'autumn' }, cam: cam(P.pic, 70, 55, 170) },
  { id: 'land-winter', group: 'Земля', title: 'Зима: Сьерра-Невада', note: 'Снеговая линия опущена на два километра.', p: { look: 'winter' }, cam: cam(P.nev, 120, 50, 20) },
  { id: 'land-atlas', group: 'Земля', title: 'Атлас: высоты цветом и горизонтали', note: 'Вид школьного атласа: зелёные низины, бурые горы, линии через 200 м.', p: { look: 'atlas', forest3d: 0 }, cam: cam([41.0, -1.5], 520, 20, 0) },
  { id: 'land-night', group: 'Земля', title: 'Ночной сланец', note: 'Тёмная карта с золотым светом по рельефу, в тон интерфейсу.', p: { look: 'night', forest3d: 0 }, cam: cam(P.pyr, 300, 40, 10) },
  // ---- the chunk system: the world as cells of 10 by 10 km that hold state and join without seams
  { id: 'chunks-grid', group: 'Чанки', title: 'Чанки: мир из ячеек 10 × 10 км', note: 'Самая мелкая ячейка мира. Наведите курсор: внизу видно, что хранит чанк. В игре на чанк нажать нельзя, он только хранит состояние; нажимается район.', p: { grid: 1, chunkInfo: 1 }, cam: cam([42.9, -1.9], 110, 30, 0) },
  { id: 'chunks-cut', group: 'Чанки', title: 'Вырубка: лес уходит чанк за чанком', note: 'Вокруг поселений лес сведён, на его месте поля. Двигайте «Показ: вырубка у поселений» (справа, раздел «Режимы и бедствия»). Соседние чанки сливаются без шва: край леса неровный, как в природе.', p: { demoCut: .7 }, cam: cam([43.05, -2.55], 150, 35, 10) },
  { id: 'chunks-cut-grid', group: 'Чанки', title: 'Та же вырубка с сеткой и числами', note: 'Цвет квадрата — сколько леса осталось в чанке. Картинка рисуется из этих чисел.', p: { demoCut: .7, grid: 1, chunkData: 'forest', forest3d: 0, towns: 0, labels: 0 }, cam: cam([43.05, -2.55], 220, 0, 0) },
  { id: 'chunks-ice', group: 'Чанки', title: 'Лёд на море: чанк за чанком', note: 'Лёд идёт с севера и от берегов. Двигайте «Показ: лёд на море» (справа, раздел «Режимы и бедствия»): разводья закрываются по мере роста льда в чанке.', p: { demoIce: .3, look: 'winter' }, cam: cam([44.05, -2.6], 150, 40, 175) },
  { id: 'chunks-snow', group: 'Чанки', title: 'Снег по чанкам', note: 'Снег ложится пятнами: сначала горы, потом плоскогорья; низины и побережье остаются без снега. Двигайте «Показ: снег» (справа, раздел «Режимы и бедствия»).', p: { demoSnow: .42 }, cam: cam([42.25, -2.7], 250, 35, 0) },
  { id: 'chunks-brush', group: 'Чанки', title: 'Кисть: менять чанки щелчком', note: 'Выберите действие в «Кисть: щелчок по карте» (раздел «Режимы и бедствия») и щёлкайте по карте: рубить и растить лес, распахивать поля, морозить воду, сыпать снег.', p: { brush: 'forest-', chunkInfo: 1, grid: 1 }, cam: cam([43.15, -5.6], 70, 35, 0) },
  // ---- how much larger than life things are drawn
  { id: 'scale-real', group: 'Масштаб объектов', title: 'Почти в настоящую величину', note: 'Деревья, дома, дороги и реки увеличены совсем чуть-чуть. Честно, но мелко.', p: { trees: .4, houses: .4, roads: .5, rivers: .5 }, cam: cam(P.mad, 45, 52, -20) },
  { id: 'scale-mid', group: 'Масштаб объектов', title: 'Умеренное увеличение', note: 'Средний вариант: объекты читаются, но не закрывают землю.', p: {}, cam: cam(P.mad, 45, 52, -20) },
  { id: 'scale-big', group: 'Масштаб объектов', title: 'Сильное увеличение, как на игровой карте', note: 'Всё крупное и заметное с любой высоты.', p: { trees: 1.7, houses: 1.9, roads: 1.8, rivers: 1.6 }, cam: cam(P.mad, 45, 52, -20) },
  { id: 'relief-1', group: 'Масштаб объектов', title: 'Рельеф без преувеличения', note: 'Высоты в масштабе один к одному.', p: { exag: 1 }, cam: cam(P.nev, 90, 62, 200) },
  { id: 'relief-3', group: 'Масштаб объектов', title: 'Рельеф втрое выше', note: 'Горы подняты втрое: выразительнее, но менее правдиво.', p: { exag: 3 }, cam: cam(P.nev, 90, 62, 200) },
  // ---- light
  { id: 'light-morning', group: 'Вода и свет', title: 'Утро над Пиренеями', note: 'Низкое солнце с востока, длинные тени.', p: { hour: 7.5 }, cam: cam(P.pyr, 90, 60, 250) },
  { id: 'light-evening', group: 'Вода и свет', title: 'Вечер над проливом', note: 'Тёплый свет с запада и блик на воде.', p: { hour: 18.75 }, cam: cam(P.gib, 110, 62, -80) },
  { id: 'light-night', group: 'Вода и свет', title: 'Ночь с огнями', note: 'После заката в домах горят окна.', p: { hour: 21.5, houses: 1.6, forest3d: 0 }, cam: cam(P.tou, 26, 55, 200) },
  { id: 'fx-off', group: 'Вода и свет', title: 'Без эффектов движка', note: 'Для сравнения со следующей страницей: затенение и резкость выключены.', p: { fx: 0 }, cam: cam(P.pyr, 25, 58, 160) },
  { id: 'fx-on', group: 'Вода и свет', title: 'С эффектами движка', note: 'Мягкая тень у деревьев, домов и в ущельях, лёгкая резкость.', p: { fx: 1, ao: 1.1 }, cam: cam(P.pyr, 25, 58, 160) },
  // ---- map modes
  { id: 'mode-political', group: 'Режимы карты', title: 'Политика: светлая земля', note: 'Бумага, рельеф тенью, реки и дороги. Государств нет — карта пустая.', p: { look: 'paper', forest3d: 0 }, cam: cam([40.4, -3.0], 620, 15, 0) },
  { id: 'data-temp', group: 'Режимы карты', title: 'Данные: температура', note: 'Один показатель за раз, без эффектов. Здесь расчёт по широте и высоте.', p: { data: 1, forest3d: 0, towns: 0, roadsOn: 0 }, cam: cam([40.2, -3.4], 1300) },
  { id: 'data-height', group: 'Режимы карты', title: 'Данные: высоты', note: 'Высота над морем ступенями цвета.', p: { data: 2, forest3d: 0, towns: 0, roadsOn: 0 }, cam: cam([40.2, -3.4], 1300) },
  // ---- roads
  { id: 'roads', group: 'Города и дороги', title: 'Дороги по рельефу', note: 'Главные дороги шире, остальные тоньше. Путь выбран по настоящим высотам: долинами и через перевалы.', p: { roads: 1.5 }, cam: cam([41.6, -2.2], 380, 30, 10) },
  // ---- disasters
  { id: 'hazard-fire', group: 'Бедствия', title: 'Пожар идёт по чанкам', note: 'Огонь неяркий, виден дым по ветру; за огнём остаётся гарь. Скорость — ползунок «Ход времени».', p: { hazard: 'fire', forest3d: 0 }, cam: cam([42.6, -7.6], 190, 45, 20) },
  { id: 'hazard-quake', group: 'Бедствия', title: 'Землетрясение: что почувствовал каждый район', note: 'Цвет района — сила толчков в нём; тёмная линия — разрыв.', p: { hazard: 'quake', look: 'paper', forest3d: 0, division: 1 }, cam: cam([38.3, -8.4], 520, 10, 0) },
];

const rank = g => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i; };
export const PAGES = [...BASE, ...ASPECT_PAGES].map((pg, i) => [pg, i]).sort((a, b) => rank(a[0].group) - rank(b[0].group) || a[1] - b[1]).map(x => x[0]);

export function initPages(album, q) {
  album.pages = PAGES;
  album.openPage = (id, keepCam) => {
    const page = PAGES.find(p => p.id === id) || PAGES[0];
    album.page = page;
    album.params.reset(); album.params.setMany(page.p || {});
    if (!keepCam && page.cam) album.cam.set(page.cam, !album.ready);
    album.restartHazard?.();
    album.onPage?.(page);
  };
  album.openPage(q.get('page') || PAGES[0].id);
}
