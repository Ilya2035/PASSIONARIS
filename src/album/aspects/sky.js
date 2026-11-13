// The sky, the Sun and the Moon, the horizon, the weather (docs/album/sky.md). The owner of this file is the part
// «Небо, свет и камера», which also owns light.js (the one light of the album), camera.js, post.js, main.js,
// layers/clouds.js and the folder sky/. This file is where the part keeps its knobs, pages and its layer.
// A knob with `map: 'Подпись'` gets a switch on the panel of the map (mapview.js).
//
// The layer sets, every frame, what the light of the album (LIGHT in light.js) needs from the sky: the Sun of the
// hour, the day of the year and the latitude under the camera; the Moon and how strong its light is; the clouds.
import { Vector3, Vector4, BackSide } from 'three';
import { frame } from '../geo.js';
import { sunAt } from '../light.js';
import { sunDir, moonDir, moonLit, moonStrength } from '../sky/astro.js';

const MAP_LIGHT = sunAt(0);

// uniforms of LIGHT that the sky owns; through the ground's uniforms they reach every material (lightUniforms)
const U = { uSunW: { value: new Vector3(0, 1, 0) }, uMoon: { value: new Vector4(0, 0, 1, 0) }, uCloud: { value: new Vector4(0, 0, 0, 9) } };
const P = { pyr: [42.63, .66], zar: [41.65, -.89], all: [40.2, -3.4] };
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
    { key: 'edgePan', label: 'Сдвиг карты у края экрана', group: 'system', type: 'toggle', value: 1, map: 'Сдвиг у края' },
  ],
  pages: [
    { id: 'sky-near', group: 'Небо и свет', title: 'Горизонт вблизи: небо и дымка', note: 'Камера у самой земли смотрит вдоль неё. Над горизонтом небо: у земли светлое, выше темнее. Земля уходит в дымку. Наклон — средняя кнопка мыши или клавиши R и F.', p: {}, cam: cam(P.zar, 20, 84, 0) },
    { id: 'sky-200', group: 'Небо и свет', title: 'Горизонт с 200 км', note: 'Обычная игровая высота, взгляд к горизонту: край земли в дымке, над ним слой воздуха и тёмное небо.', p: {}, cam: cam(P.pyr, 200, 76, 15) },
    { id: 'sky-space', group: 'Небо и свет', title: 'Край шара с 2000 км', note: 'Тонкий голубой слой воздуха над краем шара. Космос не чёрный: тёмно-синий, у шара чуть светлее.', p: {}, cam: cam(P.all, 2000, 62, 0) },
    { id: 'sky-dawn', group: 'Небо и свет', title: 'Восход над Пиренеями', note: 'Пять часов утра, 21 июня: солнце только встало на северо-востоке, тени гор длинные.', p: { hour: 5 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-noon', group: 'Небо и свет', title: 'Полдень над Пиренеями', note: 'Солнце на юге, высоко: тени короткие.', p: { hour: 12 }, cam: cam(P.pyr, 90, 62, 250) },
    { id: 'sky-dusk', group: 'Небо и свет', title: 'Закат над Пиренеями', note: 'Семь часов вечера: солнце низко на северо-западе, свет тёплый, тени длинные. Камера смотрит на закат.', p: { hour: 19 }, cam: cam(P.pyr, 60, 82, 300) },
    { id: 'sky-night', group: 'Небо и свет', title: 'Ночь с Луной', note: 'Без четверти девять вечера, 21 июня: солнце уже глубоко под горизонтом, полная Луна только взошла на юго-востоке. Земля в слабом лунном свете, склоны к Луне светлее. Фазу меняет ручка «Фаза Луны».', p: { hour: 20.75, moon: .5 }, cam: cam(P.pyr, 40, 87, 136) },
    { id: 'sky-clouds', group: 'Небо и свет', title: 'Облака и их тени', note: 'Вид с 700 км: облака и тени от них на земле. Сколько облаков — ручка «Облачность». Вблизи облака тают, тени остаются.', p: { clouds: 1 }, cam: cam(P.all, 700, 35, 0) },
  ],
  async init(album) {
    const { SkyDome } = await import('../sky/dome.js');
    const T = album.terrain.u, p = album.params, dome = new SkyDome(album);
    // the sky replaces the old shell of air around the globe (terrain.js); the background colour is never seen now
    for (const o of album.scene.children) if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === BackSide) o.visible = false;
    const sunW = T.uSunW.value, moon = T.uMoon.value, cloud = T.uCloud.value, moonW = dome.u.uMoonW.value;
    const world = (e, n, u, f, out) => out.set(0, 0, 0).addScaledVector(f.east, e).addScaledVector(f.north, n).addScaledVector(f.up, u).normalize();
    let clock = null, drift = 0;                                    // the hour while the day runs; how far the clouds have drifted, km
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
      // clouds: how much of the sky, how far the wind (toward the east-north-east) has carried them
      drift += album.shot ? 0 : dt * p.get('play') * .9;
      cloud.set(p.get('clouds') && T.uStyle.value === 0 ? p.get('cloudCover') : 0, -drift * .92 - 37, drift * .38 + 11, 4 + 3 * T.uExag.value);
      dome.update(c.cam, album.renderer.domElement.height);
    } };
    return layer;
  },
};
