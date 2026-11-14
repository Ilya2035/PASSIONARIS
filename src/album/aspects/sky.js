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
import { frame } from '../geo.js';
import { sunAt, lightFrame, FRAME } from '../light.js';
import { sunDir, moonDir, moonLit, moonStrength, sunTimes } from '../sky/astro.js';
import { WX, needClouds, needFog, cloudOffset, rainCover, rainMask, fogByHour, fogNumbers, snowNumbers } from '../sky/weather.js';

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
    { key: 'yday', label: 'День года (172 — 21 июня)', group: 'light', min: 1, max: 365, step: 1, value: 172 },
    { key: 'moon', label: 'Фаза Луны (0,5 — полнолуние)', group: 'light', min: 0, max: 1, step: .05, value: .5 },
    { key: 'dayRun', label: 'Ход суток', group: 'light', type: 'toggle', value: 0, map: 'Ход суток' },
    { key: 'clouds', label: 'Облака', group: 'light', type: 'toggle', value: 0, map: 'Облака' },
    { key: 'cloudCover', label: 'Облачность', group: 'light', min: .05, max: 1, step: .05, value: .45 },
    { key: 'cloudShift', label: 'Сдвиг облаков по ветру', group: 'light', min: 0, max: 8192, step: 16, value: 0, unit: ' км' },
    { key: 'rain', label: 'Дождь', group: 'light', type: 'toggle', value: 0, map: 'Дождь' },
    { key: 'rainForce', label: 'Сила дождя', group: 'light', min: .1, max: 1, step: .05, value: .6 },
    { key: 'fog', label: 'Туман (утром; к полудню рассеивается)', group: 'light', type: 'toggle', value: 0, map: 'Туман' },
    { key: 'fogAmount', label: 'Сколько тумана', group: 'light', min: .1, max: 1, step: .05, value: .7 },
    { key: 'edgePan', label: 'Сдвиг карты у края экрана', group: 'system', type: 'toggle', value: 1, map: 'Сдвиг у края' },
  ],
  pages: [
    { id: 'sky-near', group: 'Небо и свет', title: 'Горизонт вблизи: небо и дымка', note: 'Камера у самой земли смотрит вдоль неё. Над горизонтом небо: у земли светлое, выше темнее. Земля уходит в дымку. Наклон — средняя кнопка мыши или клавиши R и F.', p: {}, cam: cam(P.zar, 20, 84, 0) },
    { id: 'sky-200', group: 'Небо и свет', title: 'Горизонт с 200 км', note: 'Обычная игровая высота, взгляд к горизонту: край земли в дымке, над ним слой воздуха и тёмное небо.', p: {}, cam: cam(P.pyr, 200, 76, 15) },
    { id: 'sky-space', group: 'Небо и свет', title: 'Край шара с 2000 км', note: 'Тонкий голубой слой воздуха над краем шара. Космос не чёрный: тёмно-синий, у шара чуть светлее.', p: {}, cam: cam(P.all, 2000, 62, 0) },
    { id: 'sky-dawn', group: 'Небо и свет', title: 'Восход над Пиренеями', note: 'Пять часов утра, 21 июня: солнце только встало на северо-востоке, тени гор длинные.', p: { hour: 5 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-noon', group: 'Небо и свет', title: 'Полдень над Пиренеями', note: 'Солнце на юге, высоко: тени короткие.', p: { hour: 12 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-dusk', group: 'Небо и свет', title: 'Закат над Пиренеями', note: 'Четверть восьмого вечера, 21 июня: солнце у самого горизонта на северо-западе, небо вокруг него оранжевое, свет тёплый, тени длинные. Камера смотрит на закат.', p: { hour: 19.25 }, cam: cam(P.pyr, 60, 84, 300) },
    { id: 'sky-night', group: 'Небо и свет', title: 'Ночь с Луной', note: 'Без четверти девять вечера, 21 июня: солнце уже глубоко под горизонтом, полная Луна только взошла на юго-востоке. Земля в слабом лунном свете, склоны к Луне светлее. Фазу меняет ручка «Фаза Луны».', p: { hour: 20.75, moon: .5 }, cam: cam(P.pyr, 40, 87, 136) },
    { id: 'sky-clouds', group: 'Небо и свет', title: 'Облака и их тени', note: 'Вид с 700 км: облака и тени от них на земле. Сколько облаков — ручка «Облачность». Вблизи облака тают, тени остаются.', p: { clouds: 1 }, cam: cam(P.all, 700, 35, 0) },
    { id: 'sky-rain', group: 'Небо и свет', title: 'Дождь с высоты', note: 'Взгляд от Валенсии на север: над горами идёт дождь. Туча тяжёлая и серая, под её ближним краем висит серая завеса дождя с полосами, земля под ней тёмная, мокрая. Туча уходит на восток и оставляет за собой мокрый след. Переключатель «Дождь», ручка «Сила дождя».', p: { rain: 1 }, cam: cam(P.rain, 220, 74, 0) },
    { id: 'sky-rain-200', group: 'Небо и свет', title: 'Дождь с игровой высоты', note: 'Тот же дождь с 200 км: тучи полупрозрачные, чтобы карта читалась; под дождём земля темнее.', p: { rain: 1 }, cam: cam([40.0, -0.9], 200, 40, 0) },
    { id: 'sky-rain-near', group: 'Небо и свет', title: 'Дождь вблизи', note: 'Край дождя с 28 км: справа льёт — видны тонкие линии дождя, земля мокрая и тёмная; слева сухо. Вблизи облака не рисуются, остаются их тень и сам дождь.', p: { rain: 1 }, cam: cam(P.rainEdge, 28, 66, 80) },
    { id: 'sky-snow', group: 'Небо и свет', title: 'Снегопад в Пиренеях', note: 'Туча стоит над хребтом. Выше линии снегопада идёт снег: склоны белеют, лес под снегом серо-синий. Ниже той же линии идёт дождь: долины тёмные, мокрые. Линия снегопада на 900 м ниже вечного снега; её двигает ручка «Снеговая линия». Тучу двигает ручка «Сдвиг облаков по ветру».', p: { rain: 1, cloudShift: 1312 }, cam: cam([42.7, .3], 60, 45, 0) },
    { id: 'sky-snow-near', group: 'Небо и свет', title: 'Снегопад вблизи: Ането', note: 'С 20 км: над белыми склонами падают снежинки, в долине под ними — линии дождя. Граница снега идёт по высоте склона.', p: { rain: 1, cloudShift: 1312 }, cam: cam(P.pyr, 20, 60, 0) },
    { id: 'sky-snow-200', group: 'Небо и свет', title: 'След снегопада с 200 км', note: 'Туча уходит на восток, за ней на горах остаётся белый след длиной больше ста километров; равнина под той же тучей только мокрая.', p: { rain: 1, cloudShift: 1312 }, cam: cam([42.7, .3], 200, 25, 0) },
    { id: 'sky-fog', group: 'Небо и свет', title: 'Утренний туман в долине Эбро', note: 'Половина седьмого утра: туман лежит в долине и над водой, холмы стоят из него островами. К полудню он рассеивается — следующая страница. Переключатель «Туман», ручка «Сколько тумана».', p: { fog: 1, hour: 6.5 }, cam: cam(P.zar, 40, 65, 300) },
    { id: 'sky-fog-late', group: 'Небо и свет', title: 'Туман уходит: половина девятого', note: 'То же место через два часа: туман редеет и держится только в самых низких местах и над рекой. К полудню его не будет.', p: { fog: 1, hour: 8.5 }, cam: cam(P.zar, 40, 65, 300) },
    { id: 'sky-fog-far', group: 'Небо и свет', title: 'Туман с высоты: долины Дуэро', note: 'Семь утра, вид с 500 км: туман заполняет долины рек и повторяет их рисунок, как на снимке со спутника.', p: { fog: 1, hour: 7 }, cam: cam(P.duero, 500, 0, 0) },
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
    const sync = () => { album.cam.edgePan = !!p.get('edgePan') && !album.shot; };
    p.on(sync); sync();
    const layer = { id: 'sky', dome, hour: 0, update(dt, _t, c) {
      const s = c.s, yday = p.get('yday'), phase = p.get('moon'), f = frame(s.lat, s.lon);
      // the hour: the knob, or the running clock (a day in a minute and a half; «Ход времени» speeds it up)
      let hour = p.get('hour');
      if (p.get('dayRun') && !album.shot) { clock = ((clock ?? (hour || 9)) + dt * p.get('play') * .27) % 24; hour = clock || .001; } else clock = null;
      layer.hour = hour;
      if (hour) T.uSun.value.set(...sunDir(hour, yday, s.lat)); else T.uSun.value.copy(MAP_LIGHT);   // hour 0: the cartographer's light
      const sun = T.uSun.value; world(sun.x, sun.y, sun.z, f, sunW);
      if (hour) {
        const m = moonDir(hour, yday, s.lat, phase);
        moon.set(m[0], m[1], m[2], moonStrength(sun.z, m[2], phase)); world(m[0], m[1], m[2], f, moonW); dome.u.uSkyK.value.y = moonLit(phase);
      } else { moon.set(0, 0, 1, 0); moonW.copy(sunW).negate(); dome.u.uSkyK.value.y = 0; }
      // the light of this frame for every shader: colours of the Sun, the sky and the haze, the day, the thin air
      lightFrame({ sun, moon: moon.w, style: T.uStyle.value, warm: T.uWarm.value, haze: T.uHaze.value, alt: c.alt ?? s.h });
      // clouds: how much of the sky, how far the wind (toward the east-north-east) has carried them
      // (The weather is there in the natural look only. Rain brings its own clouds if there are too few.)
      const natural = T.uStyle.value === 0, force = p.get('rainForce'), rain = !!p.get('rain') && natural;
      const cover = natural ? Math.max(p.get('clouds') ? p.get('cloudCover') : 0, rain ? rainCover(force) : 0) : 0;
      if (!album.shot) { drift += dt * p.get('play') * .9; rainT = (rainT + dt * p.get('play')) % 1000; }
      const off = cloudOffset(drift + p.get('cloudShift'));
      cloud.set(cover, off[0], off[1], 4 + 3 * T.uExag.value);
      // the lines of falling rain show near the ground only: from a height rain is a grey curtain under its cloud
      WX.uRain.value.set(rain ? force : 0, rainMask(force), rainT, 1 - ss(60, 220, s.h));
      // above the line of snowfall it snows (the line follows the snow line of the ground: the look, «Снеговая линия»)
      if (rain) { needFog(album.data.base.at); WX.uSnowF.value.set(...snowNumbers(T.uSnow.value, T.uExag.value), 1); } else WX.uSnowF.value.w = 0;
      // fog: what the hour has left of it (thickest at dawn, gone by noon)
      const rise = sunTimes(yday, s.lat)?.rise ?? 6, fog = p.get('fog') && natural ? p.get('fogAmount') * fogByHour(hour, rise) : 0;
      if (fog > .02) { const f = fogNumbers(fog), k = T.uExag.value / 1000; needFog(album.data.base.at); WX.uFog.value.set(1, f.thick * k, f.bank, f.soft * k); } else WX.uFog.value.x = 0;
      if (cover > 0 || fog > .02) needClouds();
      layer.weather = { cover, rain: rain ? force : 0, fog };
      dome.update(c.cam, album.renderer.domElement.height);
    } };
    return layer;
  },
};
