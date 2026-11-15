// The sky, the Sun and the Moon, the horizon, the weather (docs/album/sky.md). The owner of this file is the part
// «Небо, свет и камера», which also owns light.js (the one light of the album), camera.js, post.js, main.js,
// layers/clouds.js and the folder sky/. This file is where the part keeps its knobs, pages and its layer.
// A knob with `map: 'Подпись'` gets a switch on the panel of the map (mapview.js).
//
// The layer sets, every frame, what the light of the album (LIGHT in light.js) needs from the sky: the Sun of the
// hour, the day of the year and the latitude under the camera; the Moon and how strong its light is; the clouds.
// And what the weather (sky/weather.js) needs: how much of the sky the clouds cover, how hard it rains, how much fog
// the hour has left.
import { Vector3, Vector4, BackSide } from 'three';
import { frame, BBOX, R, distKm } from '../geo.js';
import { sunAt, lightFrame, FRAME } from '../light.js';
import { snowlineOf, WARM_WORLD } from '../ground/climate.js';
import { sunDir, moonDir, moonLit, moonStrength, sunTimes, lightHour } from '../sky/astro.js';
import { PLUME, KINDS, plumeReach, plumeFrame, nearestVolcano } from '../sky/plume.js';
import { GLOBE, globeAmount, globeDim, frameSunUp, raiseSun } from '../sky/globe.js';
import { WX, WORLD, worldNeeded, needClouds, needFog, needClimate, climateOf, climateNow, windTurn, whirlsAt, whirlShare, snowClimNumbers, cloudOffset, growOffset, cellOffset, rainCover, rainMask, fogByHour, fogByHeight, fogNumbers, snowNumbers, HILL_FILL, capBank, STORM_FLASH, STORM_STILL } from '../sky/weather.js';

const MAP_LIGHT = sunAt(0);

// uniforms of LIGHT that the sky owns; through the ground's uniforms they reach every material (lightUniforms).
// FRAME is the light of the frame, counted once a frame on the processor (lightFrame in light.js).
const U = { uSunW: { value: new Vector3(0, 1, 0) }, uMoon: { value: new Vector4(0, 0, 1, 0) }, uCloud: { value: new Vector4(0, 0, 0, 9) }, ...FRAME };
const P = { pyr: [42.63, .66], zar: [41.65, -.89], all: [40.2, -3.4], rain: [39.0, -.6], rainEdge: [39.95, -1.55], duero: [41.5, -4.5] };
const cam = (ll, h, tilt = 0, heading = 0) => ({ lat: ll[0], lon: ll[1], h, tilt, heading });

export default {
  id: 'sky', title: 'Небо и свет',
  glsl: '',
  uniforms: U,
  params: [
    // the light by its name: the hour is then counted from the Sun of the place under the camera (sky/astro.js,
    // lightHour); '' leaves the hour to the knob «Время суток». The buttons of it stand on the panel of the map
    // (sky/lightswitch.js); the game opens with «День» (main.js), the pages of the album with the light of the map.
    { key: 'light', label: 'Освещение', group: 'light', type: 'select', value: '', options: [['', 'по ручке «Время суток»'], ['morning', 'Утро'], ['day', 'День'], ['evening', 'Вечер'], ['night', 'Ночь']] },
    { key: 'yday', label: 'День года (172 — 21 июня)', group: 'light', min: 1, max: 365, step: 1, value: 172 },
    { key: 'moon', label: 'Фаза Луны (0,5 — полнолуние)', group: 'light', min: 0, max: 1, step: .05, value: .5 },
    { key: 'dayRun', label: 'Ход суток', group: 'light', type: 'toggle', value: 0, map: 'Ход суток' },
    { key: 'clouds', label: 'Облака', group: 'light', type: 'toggle', value: 0, map: 'Облака' },
    { key: 'cloudCover', label: 'Облачность', group: 'light', min: .05, max: 1, step: .05, value: .45 },
    { key: 'cloudShift', label: 'Сдвиг облаков по ветру', group: 'light', min: 0, max: 32768, step: 16, value: 0, unit: ' км' },
    { key: 'rain', label: 'Дождь', group: 'light', type: 'toggle', value: 0, map: 'Дождь' },
    { key: 'rainForce', label: 'Сила дождя', group: 'light', min: .1, max: 1, step: .05, value: .6 },
    { key: 'storm', label: 'Гроза (дождь с молниями)', group: 'light', type: 'toggle', value: 0, map: 'Гроза' },
    { key: 'fog', label: 'Туман (утром; к полудню рассеивается)', group: 'light', type: 'toggle', value: 0, map: 'Туман' },
    { key: 'fogAmount', label: 'Сколько тумана', group: 'light', min: .1, max: 1, step: .05, value: .7 },
    // an eruption of the volcano nearest to the place the camera looks at, and a sand storm that rises there
    // (sky/plume.js); one at a time: the eruption comes first
    { key: 'eruption', label: 'Извержение вулкана (ближайшего к взгляду)', group: 'light', type: 'toggle', value: 0, map: 'Извержение' },
    { key: 'dustStorm', label: 'Песчаная буря (там, куда смотрит камера)', group: 'light', type: 'toggle', value: 0, map: 'Песчаная буря' },
    { key: 'edgePan', label: 'Сдвиг карты у края экрана', group: 'system', type: 'toggle', value: 1, map: 'Сдвиг у края' },
  ],
  pages: [
    { id: 'sky-near', group: 'Небо и свет', title: 'Горизонт вблизи: небо и дымка', note: 'Камера у самой земли смотрит вдоль неё. Над горизонтом небо: у земли светлое, выше темнее. Земля уходит в дымку. Наклон — средняя кнопка мыши или клавиши R и F.', p: {}, cam: cam(P.zar, 20, 84, 0) },
    { id: 'sky-200', group: 'Небо и свет', title: 'Горизонт с 200 км', note: 'Обычная игровая высота, взгляд к горизонту: край земли в дымке, над ним слой воздуха и тёмное небо.', p: {}, cam: cam(P.pyr, 200, 76, 15) },
    { id: 'sky-space', group: 'Небо и свет', title: 'Край шара с 2000 км', note: 'Тонкий голубой слой воздуха над краем шара. Космос не чёрный: тёмно-синий, у шара чуть светлее.', p: {}, cam: cam(P.all, 2000, 62, 0) },
    { id: 'sky-dawn', group: 'Небо и свет', title: 'Восход над Пиренеями', note: 'Пять часов утра, 21 июня: солнце только встало на северо-востоке, тени гор длинные.', p: { hour: 5 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-noon', group: 'Небо и свет', title: 'Полдень над Пиренеями', note: 'Солнце на юге, высоко: тени короткие.', p: { hour: 12 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-dusk', group: 'Небо и свет', title: 'Закат над Пиренеями', note: 'Четверть восьмого вечера, 21 июня: солнце у самого горизонта на северо-западе, небо вокруг него оранжевое, свет тёплый, тени длинные. Камера смотрит на закат.', p: { hour: 19.25 }, cam: cam(P.pyr, 60, 84, 300) },
    { id: 'sky-light-morning', group: 'Небо и свет', title: 'Свет: утро', note: 'Кнопка «Утро» на панели карты. Солнце невысоко на востоке, тени гор длинные и лежат к западу, свет тёплый. Час считается по Солнцу места: утро остаётся утром в любой день года и на любой широте.', p: { light: 'morning' }, cam: cam([42.7, .3], 60, 50, 0) },
    { id: 'sky-light-day', group: 'Небо и свет', title: 'Свет: день', note: 'Кнопка «День»: настоящее Солнце после полудня. Оно стоит высоко на западе, поэтому тени короткие и лежат к востоку. С этим светом открывается игра.', p: { light: 'day' }, cam: cam([42.7, .3], 60, 50, 0) },
    { id: 'sky-light-evening', group: 'Небо и свет', title: 'Свет: вечер', note: 'Кнопка «Вечер»: Солнце низко на западе, свет оранжевый, тени длинные и лежат к востоку.', p: { light: 'evening' }, cam: cam([42.7, .3], 60, 50, 0) },
    { id: 'sky-light-night', group: 'Небо и свет', title: 'Свет: ночь', note: 'Кнопка «Ночь»: полночь, Солнце глубоко под горизонтом, полная Луна стоит на юге. Земля в слабом лунном свете.', p: { light: 'night' }, cam: cam([42.7, .3], 60, 50, 0) },
    { id: 'sky-sun-day', group: 'Небо и свет', title: 'Где Солнце: день', note: 'Днём Солнце стоит выше окна, но видно, где оно: небо и дымка в его стороне светлее и теплее. Камера смотрит на запад, к Солнцу.', p: { light: 'day' }, cam: cam(P.zar, 30, 86, 268) },
    { id: 'sky-sun-evening', group: 'Небо и свет', title: 'Где Солнце: вечер', note: 'Вечером Солнце видно над горизонтом: диск, сияние вокруг него и тёплая дымка в его стороне. Камера смотрит на закат.', p: { light: 'evening' }, cam: cam(P.zar, 30, 86, 291) },
    { id: 'sky-night', group: 'Небо и свет', title: 'Ночь с Луной', note: 'Без четверти девять вечера, 21 июня: солнце уже глубоко под горизонтом, полная Луна только взошла на юго-востоке. Земля в слабом лунном свете, склоны к Луне светлее. Фазу меняет ручка «Фаза Луны».', p: { hour: 20.75, moon: .5 }, cam: cam(P.pyr, 40, 87, 136) },
    { id: 'sky-earth-day', group: 'Небо и свет', title: 'Вся Земля: день', note: 'Шар целиком с 20 000 км, кнопка «День». Под камерой день, к краю шара свет слабеет, за краем дня — ночь. Клавиша 6 — эта высота.', p: { light: 'day' }, cam: cam(P.all, 20000, 0, 0) },
    { id: 'sky-earth-evening', group: 'Небо и свет', title: 'Вся Земля: вечер', note: 'Кнопка «Вечер»: под камерой Солнце садится. На западе ещё день, на востоке уже ночь, между ними полоса тёплого низкого света.', p: { light: 'evening' }, cam: cam(P.all, 20000, 0, 0) },
    { id: 'sky-earth-night', group: 'Небо и свет', title: 'Вся Земля: ночь', note: 'Кнопка «Ночь»: под камерой полночь, шар тёмный, у края виден серп дня.', p: { light: 'night' }, cam: cam(P.all, 20000, 0, 0) },
    { id: 'sky-terminator', group: 'Небо и свет', title: 'Край дня с 3000 км', note: 'Вечер над Испанией с 3000 км: на западе, над океаном, ещё светло, на востоке уже темнеет. Свет считается для каждого места своего.', p: { light: 'evening' }, cam: cam(P.all, 3000, 30, 0) },
    { id: 'sky-clouds', group: 'Небо и свет', title: 'Облака и их тени', note: 'Вид с 700 км: облака и тени от них на земле. Сколько облаков — ручка «Облачность». Вблизи облака тают, тени остаются.', p: { clouds: 1 }, cam: cam(P.all, 700, 35, 0) },
    { id: 'sky-rain', group: 'Небо и свет', title: 'Дождь с высоты', note: 'Взгляд от Валенсии на север: над горами идёт дождь. Туча тяжёлая и серая, под её ближним краем висит серая завеса дождя с полосами, земля под ней тёмная, мокрая. Туча уходит на восток и оставляет за собой мокрый след. Переключатель «Дождь», ручка «Сила дождя».', p: { rain: 1, cloudShift: 8208 }, cam: cam(P.rain, 220, 74, 0) },
    { id: 'sky-rain-200', group: 'Небо и свет', title: 'Дождь с игровой высоты', note: 'Тот же дождь с 200 км: дождевая туча как на снимке со спутника — белая, плотная, с буграми, светлыми со стороны Солнца. Обычные облака вокруг неё полупрозрачные. Ближе 120 км туча тает, чтобы карта под дождём читалась.', p: { rain: 1, cloudShift: 1216 }, cam: cam([40.0, -0.9], 200, 40, 0) },
    { id: 'sky-rain-near', group: 'Небо и свет', title: 'Дождь вблизи', note: 'Край дождя с 28 км: справа льёт — видны тонкие линии дождя, земля мокрая и тёмная; слева сухо. Вблизи облака не рисуются, остаются их тень и сам дождь.', p: { rain: 1, cloudShift: 112 }, cam: cam(P.rainEdge, 28, 66, 80) },
    { id: 'sky-storm', group: 'Небо и свет', title: 'Гроза с высоты', note: 'Ночь, дождевая туча с 200 км: молнии освещают тучу изнутри — сине-белые вспышки то в одном её месте, то в другом. Переключатель «Гроза» на панели карты (включает и дождь).', p: { storm: 1, light: 'night', cloudShift: 1216 }, cam: cam([40.0, -0.9], 200, 40, 0) },
    { id: 'sky-storm-near', group: 'Небо и свет', title: 'Гроза вблизи', note: 'Вечер в предгорьях Пиренеев, над хребтом гроза: небо под тучей вспыхивает, земля под ней на миг светлеет.', p: { storm: 1, light: 'evening', cloudShift: 7856 }, cam: cam([42.2, .3], 20, 84, 0) },
    { id: 'sky-overcast', group: 'Небо и свет', title: 'Пасмурное небо под тучей', note: 'Предгорья Пиренеев, взгляд на север вдоль земли. Над хребтом стоит туча, и небо над горизонтом серое, а не ясное: светлее у тонкого края тучи, темнее под её серединой и там, где льёт. Светлая полоса у самого горизонта — там туча кончается.', p: { rain: 1, cloudShift: 7856 }, cam: cam([42.2, .3], 20, 84, 0) },
    { id: 'sky-snow', group: 'Небо и свет', title: 'Снегопад в Пиренеях', note: 'Туча стоит над хребтом. Выше линии снегопада идёт снег: склоны белеют, лес под снегом серо-синий. Ниже той же линии идёт дождь: долины тёмные, мокрые. Линия снегопада на 900 м ниже вечного снега; её двигает ручка «Снеговая линия». Тучу двигает ручка «Сдвиг облаков по ветру».', p: { rain: 1, cloudShift: 7856 }, cam: cam([42.7, .3], 60, 45, 0) },
    { id: 'sky-snow-near', group: 'Небо и свет', title: 'Снегопад вблизи: Ането', note: 'С 20 км: над белыми склонами падают снежинки, в долине под ними — линии дождя. Граница снега идёт по высоте склона.', p: { rain: 1, cloudShift: 7856 }, cam: cam(P.pyr, 20, 60, 0) },
    { id: 'sky-snow-200', group: 'Небо и свет', title: 'След снегопада с 200 км', note: 'Туча уходит на восток, за ней на горах остаётся белый след длиной больше ста километров; равнина под той же тучей только мокрая.', p: { rain: 1, cloudShift: 7984 }, cam: cam([42.7, .3], 200, 25, 0) },
    { id: 'sky-fog', group: 'Небо и свет', title: 'Утренний туман в долине Эбро', note: 'Половина седьмого утра: туман лежит в долине и над водой, холмы стоят из него островами. К полудню он рассеивается — следующая страница. Переключатель «Туман», ручка «Сколько тумана».', p: { fog: 1, hour: 6.5 }, cam: cam(P.zar, 40, 65, 300) },
    { id: 'sky-fog-late', group: 'Небо и свет', title: 'Туман уходит: половина девятого', note: 'То же место через два часа: туман редеет и держится только в самых низких местах и над рекой. К полудню его не будет.', p: { fog: 1, hour: 8.5 }, cam: cam(P.zar, 40, 65, 300) },
    { id: 'sky-valley-clouds', group: 'Небо и свет', title: 'Облака в горных долинах', note: 'Половина седьмого утра в Пиренеях: долины залиты облаком, гребни и вершины стоят над ним. Это тот же «Туман»: в горах он заполняет долины до половины их глубины. К полудню рассеивается.', p: { fog: 1, hour: 6.5 }, cam: cam([42.7, .3], 60, 45, 0) },
    { id: 'sky-caps', group: 'Небо и свет', title: 'Шапки облаков на гребнях', note: 'Ането с 20 км, облака включены: высокие гребни носят шапки облаков, долины под ними открыты. Сколько гребней в шапках — ручка «Облачность».', p: { clouds: 1, cloudCover: .7 }, cam: cam(P.pyr, 20, 60, 0) },
    { id: 'sky-fog-high', group: 'Небо и свет', title: 'Туман с высоты не виден', note: 'То же утро и тот же туман, вид с 300 км: тумана нет. Туман — погода вблизи: с 70 км высоты камеры он редеет, с 260 км его не видно вовсе.', p: { fog: 1, hour: 6.5 }, cam: cam(P.zar, 300, 30, 0) },
    { id: 'sky-eruption', group: 'Небо и свет', title: 'Извержение: шлейф пепла', note: 'Извергается вулканическое поле Калатрава (ближайший вулкан к взгляду). Ветер несёт пепел на восток-северо-восток: шлейф расширяется, под ним тень, на земле лежит серый пепел — гуще всего у вулкана. Переключатель «Извержение» на панели карты.', p: { eruption: 1 }, cam: cam([39.4, -2.2], 700, 30, 0) },
    { id: 'sky-eruption-near', group: 'Небо и свет', title: 'Извержение вблизи: столб дыма', note: 'Тот же вулкан с 40 км: из кратера поднимается столб тёмного дыма, наверху его подхватывает ветер. Ночью в молодом дыму виден отсвет огня.', p: { eruption: 1 }, cam: cam([38.87, -4.02], 40, 78, 340) },
    { id: 'sky-eruption-space', group: 'Небо и свет', title: 'Извержение из космоса: Этна', note: 'Этна с 6000 км: шлейф пепла длиной больше тысячи километров виден из космоса.', p: { eruption: 1, light: 'day' }, cam: cam([38.5, 17], 6000, 0, 0) },
    { id: 'sky-dust', group: 'Небо и свет', title: 'Песчаная буря с высоты', note: 'Буря поднялась на юго-востоке Испании и идёт по ветру: широкий бледно-жёлтый шлейф пыли, земля под ним в мутной дымке. Буря поднимается там, куда смотрит камера, — в игре её место выбирает игрок. Переключатель «Песчаная буря» на панели карты.', p: { dustStorm: 1 }, cam: cam([38.3, -1.8], 500, 30, 0) },
    { id: 'sky-dust-near', group: 'Небо и свет', title: 'Песчаная буря вблизи', note: 'Та же буря с 30 км: земля тонет в жёлтой пыли, дальние холмы едва видны.', p: { dustStorm: 1 }, cam: cam([38.3, -1.8], 30, 70, 60) },
    { id: 'sky-earth-whirls', group: 'Небо и свет', title: 'Вся Земля: большие вихри', note: 'Северная Атлантика с 20 000 км. Облака не рассыпаны ровно: их закручивают большие вихри — шторм умеренных широт посреди океана и, ближе к экватору, тропический циклон с ясным глазом. К северу от экватора вихри закручены против часовой стрелки. Вихри идут вместе с ветром: штормы на восток, тропические циклоны на запад.', p: { light: 'day', clouds: 1, yday: 250, cloudShift: 5008 }, cam: cam([35, -52], 20000, 0, 0) },
    { id: 'sky-whirl', group: 'Небо и свет', title: 'Шторм умеренных широт', note: 'Тот же шторм с 5000 км: облака свиты в спираль шириной больше двух тысяч километров, в середине их больше, и там идёт дождь.', p: { light: 'day', rain: 1, yday: 250, cloudShift: 5008 }, cam: cam([43.6, -47], 5000, 0, 0) },
    { id: 'sky-hurricane', group: 'Небо и свет', title: 'Тропический циклон', note: 'Сентябрь, Атлантика к северу от Пуэрто-Рико, вид с 1800 км: плотная спираль облаков в тысячу километров с ясным глазом посередине.', p: { light: 'day', rain: 1, yday: 250, cloudShift: 5008 }, cam: cam([20.4, -66.4], 1800, 0, 0) },
    { id: 'sky-earth-clouds', group: 'Небо и свет', title: 'Вся Земля: облака по климату', note: 'Шар с 20 000 км, облака включены. Сколько облаков над местом — по его климату в этом месяце: над Сахарой небо чистое, над северной Атлантикой и у экватора облачно. Месяц берётся из ручки «День года».', p: { light: 'day', clouds: 1 }, cam: cam([25, 5], 20000, 0, 0) },
    { id: 'sky-earth-rain', group: 'Небо и свет', title: 'Вся Земля: где идут дожди', note: 'То же с дождём: тёмные тучи стоят там, где в этом месяце дождливо, — у экватора и в умеренных широтах; над пустынями их нет.', p: { light: 'day', rain: 1 }, cam: cam([25, 5], 20000, 0, 0) },
  ],
  async init(album) {
    const { SkyDome } = await import('../sky/dome.js');
    const T = album.terrain.u, p = album.params, dome = new SkyDome(album);
    // the sky replaces the old shell of air around the globe (terrain.js); the background colour is never seen now
    for (const o of album.scene.children) if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === BackSide) o.visible = false;
    const sunW = T.uSunW.value, moon = T.uMoon.value, cloud = T.uCloud.value, moonW = dome.u.uMoonW.value;
    const world = (e, n, u, f, out) => out.set(0, 0, 0).addScaledVector(f.east, e).addScaledVector(f.north, n).addScaledVector(f.up, u).normalize();
    let clock = null, drift = 0, rainT = 40;                        // the hour while the day runs; how far the clouds have drifted, km; the time of the falling rain, s
    const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // ---- the plume of an eruption or of a sand storm: where it began, and when
    let plume = null, volcanoes = null, asked = false, wanted = '';
    const want = () => { const w = p.get('eruption') ? 'ash' : p.get('dustStorm') ? 'dust' : ''; if (w !== wanted) { wanted = w; plume = null; } };
    // (called by the layer a frame after the switch: by then the camera stands where the page has put it)
    const begin = at => {
      if (wanted === 'dust') {
        // it rises a little upwind of the place looked at, so that it blows across the view
        plume = { kind: 'dust', name: '', lat: at.lat - .9, lon: at.lon - 1.6 / Math.max(.3, Math.cos(at.lat * Math.PI / 180)), elev: 0, t: 0 };
      } else if (wanted === 'ash') {
        if (volcanoes) { const v = nearestVolcano(volcanoes, at.lat, at.lon); if (v) plume = { kind: 'ash', ...v, t: 0 }; }
        else if (!asked) { asked = true; fetch('assets/hazards/volcanoes.json').then(r => r.json()).then(j => { volcanoes = j; }).catch(e => console.warn('[album] no list of volcanoes:', e.message || e)); }
      }
    };
    const sync = () => { album.cam.edgePan = !!p.get('edgePan') && !album.shot; want(); };
    // the open climate of the world, for the clouds: read once, when the clouds are first switched on
    const fetchClimate = () => fetch('assets/climate/normals-open.bin.gz').then(r => { if (!r.ok) throw new Error(`normals-open: ${r.status}`); return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); }).then(climateOf);
    // the line of lasting snow of the world at a place, m — the rule of the land of the whole Earth (ground/climate.js)
    // by the warmth it keeps for every place; nothing where the album has no climate of the world
    const wc = album.data.world?.clim?.image, lastingSnow = wc?.data ? (lat, lon) => {
      const i = Math.min(wc.width - 1, Math.max(0, Math.floor((lon / 360 + .5) * wc.width))), j = Math.min(wc.height - 1, Math.max(0, Math.floor((.5 - lat / 180) * wc.height)));
      return snowlineOf(WARM_WORLD[0] + (WARM_WORLD[1] - WARM_WORLD[0]) * wc.data[(j * wc.width + i) * 4 + 2] / 255, lat);
    } : null;
    // the fog and the caps of the crests lie on the album's own land: there is nothing of them to draw far from it
    const nearLand = c => c.lat > BBOX.lat0 - 6 && c.lat < BBOX.lat1 + 6 && c.lon > BBOX.lon0 - 8 && c.lon < BBOX.lon1 + 8;
    p.on(sync); sync();
    const layer = { id: 'sky', dome, hour: 0, update(dt, _t, c) {
      const s = c.s, yday = p.get('yday'), phase = p.get('moon'), f = frame(s.lat, s.lon);
      // the hour: the knob, or the running clock (a day in a minute and a half; «Ход времени» speeds it up)
      let hour = p.get('light') ? lightHour(p.get('light'), yday, s.lat) : p.get('hour');
      if (p.get('dayRun') && !album.shot) { clock = ((clock ?? (hour || 9)) + dt * p.get('play') * .27) % 24; hour = clock || .001; } else clock = null;
      layer.hour = hour;
      const here = hour ? sunDir(hour, yday, s.lat) : null;
      if (here) T.uSun.value.set(...here); else T.uSun.value.copy(MAP_LIGHT);   // hour 0: the cartographer's light
      const sun = T.uSun.value; world(sun.x, sun.y, sun.z, f, sunW);          // (the real Sun, as a direction of the world)
      { const k = Math.hypot(sun.x, sun.y) || 1; WX.uSunMap.value.set(sun.x / k, -sun.y / k); }   // (and its side on the map of the weather: east, south)
      // Day and night on the ball (sky/globe.js): from a height the frame is drawn with the highest Sun in view, and
      // every pixel is then dimmed to the light of its own place. Only with a real Sun and in the natural look.
      const eye = c.alt ?? s.h, ball = here && T.uStyle.value === 0 ? globeDim(eye) : 0;
      if (ball > 0) sun.set(...raiseSun(here, frameSunUp(here[2], eye, globeAmount(eye))));
      GLOBE.uGlobe.value.set(ball, .5 + .34 * .8 * moonLit(phase), 0, 0); layer.ball = ball;
      if (hour) {
        const m = moonDir(hour, yday, s.lat, phase);
        moon.set(m[0], m[1], m[2], moonStrength(sun.z, m[2], phase)); world(m[0], m[1], m[2], f, moonW); dome.u.uSkyK.value.y = moonLit(phase);
      } else { moon.set(0, 0, 1, 0); moonW.copy(sunW).negate(); dome.u.uSkyK.value.y = 0; }
      dome.u.uSkyK.value.z = hour ? 1 : 0;
      // the light of this frame for every shader: colours of the Sun, the sky and the haze, the day, the thin air
      // (a real Sun has a glow in the air around it; the light of the map — hour 0 — has no Sun in its sky)
      lightFrame({ sun, moon: moon.w, style: T.uStyle.value, warm: T.uWarm.value, haze: T.uHaze.value, alt: c.alt ?? s.h, aureole: hour ? 1 : 0 });
      // clouds: how much of the sky, how far the wind (toward the east-north-east) has carried them
      // (The weather is there in the natural look only. Rain brings its own clouds if there are too few.)
      // (a thunderstorm is rain with lightning: it brings the rain with it)
      const natural = T.uStyle.value === 0, force = p.get('rainForce'), storm = !!p.get('storm') && natural, rain = (!!p.get('rain') || storm) && natural;
      const cover = natural ? Math.max(p.get('clouds') ? p.get('cloudCover') : 0, rain ? rainCover(force) : 0) : 0;
      if (!album.shot) { drift += dt * p.get('play') * .9; rainT = (rainT + dt * p.get('play')) % 1000; }
      // (the clouds go with the wind; what makes them grow and melt slides the other way, the cells of rain lag behind)
      const way = drift + p.get('cloudShift'), off = cloudOffset(way), grow = growOffset(way), cell = cellOffset(way);
      cloud.set(cover, off[0], off[1], 4 + 3 * T.uExag.value); WX.uGrow.value.set(grow[0], grow[1], cell[0], cell[1]);
      // how much cloud a place has, and how willingly it rains there, goes by its climate
      if (cover > 0) needClimate(yday, fetchClimate, lastingSnow);
      // where the wind is not the album's the clouds are read twice, in their turn (sky/weather.js, windTurn)
      WX.uWind.value.set(...windTurn(way));
      // the great whirls: those that reach into the view (the eye sees as far as its horizon), each as much as the
      // climate of its place has of it
      let whirls = 0;
      if (cover > 0) {
        const far = Math.acos(R / (R + Math.max(eye, 1))) * R + 400;
        for (const w of whirlsAt(way)) {
          const k = whirlShare(climateNow(w.lat, w.lon)); if (k < .02 || distKm(s, w) > far + w.km) continue;
          WX.uWhirl.value[whirls++].set(w.x, w.y, 1 / w.r, w.turn * k);
        }
      }
      WX.uWhirlN.value = whirls;
      // which text of the shaders of the weather this view needs: the plain one over the album, the whole one beyond
      // (how far the land in view lies from the place looked at: to the edge of the window, or to the horizon)
      const look = (s.tilt + 30) * Math.PI / 180, reach = Math.min(Math.acos(R / (R + Math.max(eye, 1))) * R, look < 1.45 ? eye * Math.tan(look) : 1e9);
      WORLD.on = cover > 0 && worldNeeded(s.lat, s.lon, reach, whirls);
      // the lines of falling rain show near the ground only: from a height rain is a grey curtain under its cloud
      WX.uRain.value.set(rain ? force : 0, rainMask(force), rainT, 1 - ss(60, 220, s.h));
      WX.uStorm.value.set(storm ? 1 : 0, rainT, album.shot ? STORM_STILL : STORM_FLASH, 0);
      // above the line of snowfall it snows (the line follows the snow line of the ground: the look, «Снеговая линия»)
      // (on the album's own land; off it the line goes by the warmth of the month)
      if (rain) { needFog(album.data.base.at); WX.uSnowF.value.set(...snowNumbers(T.uSnow.value, T.uExag.value), 1); WX.uSnowC.value.set(...snowClimNumbers(T.uSnow.value, T.uExag.value), 0); } else WX.uSnowF.value.w = 0;
      // fog: what the hour has left of it (thickest at dawn, gone by noon)
      // (and what the height of the camera leaves of it: fog is weather seen from near, from a height there is none)
      const rise = sunTimes(yday, s.lat)?.rise ?? 6, low = natural && nearLand(s) ? fogByHeight(s.h) : 0, fog = p.get('fog') ? p.get('fogAmount') * fogByHour(hour, rise) * low : 0;
      // (clouds in the mountains: with the fog the deep valleys fill with cloud; with the clouds on, high crests wear caps)
      const caps = p.get('clouds') && low > 0 ? p.get('cloudCover') : 0;
      if (fog > .02 || caps > 0) {
        const f = fogNumbers(fog > .02 ? fog : 0), k = T.uExag.value / 1000; needFog(album.data.base.at);
        WX.uFog.value.set(1, f.thick * k, f.bank, f.soft * k); WX.uLow.value.set(fog > .02 ? HILL_FILL * Math.min(1, fog / .7) : 0, caps > 0 ? 1 : 0, capBank(caps), fog > .02 ? 1 : 0);
      } else WX.uFog.value.x = 0;
      if (cover > 0 || fog > .02) needClouds();
      layer.weather = { cover, rain: rain ? force : 0, storm, fog, caps, whirls, climate: cover > 0 ? climateNow(s.lat, s.lon) : null };
      // the plume: it grows with the time of the map (a still capture shows it full grown), its billows travel down it
      if (wanted && !plume) begin(c.t);
      if (plume && natural) {
        plume.t = album.shot ? 600 : plume.t + dt * p.get('play');
        const k = KINDS[plume.kind], fr = plumeFrame(plume.lat, plume.lon), reach = plumeReach(plume.kind, plume.t);
        PLUME.uPlO.value.copy(fr.o); PLUME.uPlW.value.copy(fr.w); PLUME.uPlC.value.copy(fr.c);
        PLUME.uPl.value.set(reach, k.half, k.spread, plume.t * k.speed); PLUME.uPlK.value.set(k.id, (k.top + Math.max(0, plume.elev || 0) / 1000) * T.uExag.value, k.billow, 0);
        needClouds(); layer.plume = { kind: plume.kind, name: plume.name, lat: plume.lat, lon: plume.lon, reach };
      } else { PLUME.uPl.value.x = 0; layer.plume = null; }
      dome.update(c.cam, album.renderer.domElement.height);
    } };
    const { default: initPlumes } = await import('../layers/plumes.js');
    return [layer, initPlumes(album)];
  },
};
