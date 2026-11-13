// The sky, the Sun and the Moon, the horizon, the weather (docs/album/sky.md). The owner of this file is the part
// «Небо, свет и камера», which also owns light.js (the one light of the album), camera.js, post.js, main.js and
// layers/clouds.js. This file is where the part keeps its knobs, pages and its layer: `init(album)` may return
// { id, update(dt, t, cam) }. A knob with `map: 'Подпись'` gets a switch on the panel of the map (mapview.js).
export default {
  id: 'sky', title: 'Небо и свет',
  glsl: '',
  uniforms: {},
  params: [],
  pages: [],
};
