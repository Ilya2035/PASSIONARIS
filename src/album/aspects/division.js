// ASPECT «Деление»: districts, provinces and regions drawn over the map. This file belongs to the division work; the
// contract with the rest of the album is in docs/ALBUM-CHUNKS.md.
//   aspDivision(p, col, landA) → tints the finished colour and draws the borders (map mode «Деление»)
//   districtAt(pk)             → the district of a point: xy = its centre in flat km, z = a random number of its own
//                                (the earthquake asks it to show what every district felt)
// For now the borders are a jittered lattice of the right size — a placeholder: districts are to be built from whole
// chunks along rivers and ridges, with lakes and the sea divided too.
const GLSL = /* glsl */`
uniform int uDivision;
// a jittered-lattice cell: x = distance to the border in cell units, y = cell id
vec2 cellOf(vec2 p) {
  vec2 i = floor(p), u = fract(p); float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + .15 + .7 * hash22(i + g) - u; float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; id = hash21(i + g + 3.3); } else if (dd < d2) d2 = dd;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
// the same lattice, returning the centre of the cell (xy, in cell units) and its id (z)
vec3 cellCentre(vec2 p) {
  vec2 i = floor(p), u = fract(p), best = vec2(0.); float d1 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = .15 + .7 * hash22(i + g), r = g + o - u; float dd = dot(r, r);
    if (dd < d1) { d1 = dd; best = i + g + o; id = hash21(i + g + 3.3); }
  }
  return vec3(best, id);
}
vec3 districtAt(vec2 pk) { vec3 c = cellCentre(pk / 30.); return vec3(c.xy * 30., c.z); }

void aspDivision(Px p, inout vec3 col, float landA) {
  if (uDivision == 0 || landA <= .5) return;
  vec2 pk = p.pk; float px = p.px;
  vec2 c1 = cellOf(pk / 30.), c2 = cellOf(pk / 100. + 7.), c3 = cellOf(pk / 340. + 19.);
  vec2 c = uDivision == 1 ? c1 : (uDivision == 2 ? c2 : c3);
  vec3 tint = idColour(c.y) * .55 + .35;
  col = mix(col, tint * (.55 + .5 * dot(col, vec3(.33))), .62);
  float w1 = px / 30., w2 = px / 100., w3 = px / 340.;
  col = mix(col, vec3(.10, .08, .06), (1. - smoothstep(w1 * .8, w1 * 2.2, c1.x)) * .45 * smoothstep(.9, .25, px));
  col = mix(col, vec3(.08, .06, .04), (1. - smoothstep(w2 * 1.6, w2 * 3.6, c2.x)) * (uDivision >= 2 ? .8 : .55));
  col = mix(col, vec3(.05, .03, .02), (1. - smoothstep(w3 * 3., w3 * 5.5, c3.x)) * (uDivision >= 3 ? .95 : .0));
}`;

export default {
  id: 'division', title: 'Деление', glsl: GLSL, uniforms: { uDivision: { value: 0 } },
  params: [
    { key: 'division', label: 'Деление', group: 'modes', type: 'select', options: [[0, 'нет'], [1, 'Районы'], [2, 'Провинции'], [3, 'Регионы']], value: 0, uniform: 'uDivision' },
  ],
  pages: [
    { id: 'mode-districts', group: 'Режимы карты', title: 'Деление: районы около 30 км', note: 'Границы условные (не по рекам): страница показывает размер, цвета и линии.', p: { look: 'paper', forest3d: 0, division: 1 }, cam: { lat: 41.4, lon: -1.0, h: 330, tilt: 10, heading: 0 } },
    { id: 'mode-provinces', group: 'Режимы карты', title: 'Деление: провинции около 100 км', note: 'Тонкие линии — районы внутри провинций.', p: { look: 'paper', forest3d: 0, division: 2 }, cam: { lat: 40.6, lon: -3.0, h: 700, tilt: 10, heading: 0 } },
    { id: 'mode-regions', group: 'Режимы карты', title: 'Деление: регионы 300–400 км', note: 'Самый крупный уровень. На полуостров выходит пять-шесть регионов.', p: { look: 'paper', forest3d: 0, division: 3 }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
  ],
};
