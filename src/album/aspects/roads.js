// The roads and the rivers as lines on the map (docs/album/roads.md, docs/album/water.md). The owner of this file is
// the part «Дороги и реки». The roads themselves are laid by roads/routes.js and drawn by layers/roads.js; this file
// is where the part keeps its knobs, pages and whatever it adds to the ground shader. A knob with `map: 'Подпись'`
// gets a switch on the panel of the map (mapview.js) — that is how the owner turns kinds of roads on and off.
export default {
  id: 'roads', title: 'Дороги',
  glsl: '',
  uniforms: {},
  params: [],
  pages: [],
};
