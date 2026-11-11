// ASPECT «Поселения»: what people do to the ground of a chunk — fields, trodden earth under houses — and the houses
// themselves (layers/towns.js). These files belong to the settlement work; the contract with the rest of the album is
// in docs/ALBUM-CHUNKS.md.
//   aspSettle(p, L) → changes the ground colour L.col and clears the forest (L.cover) where people live and farm
// The state comes from the chunks: p.cC = (built, fields, building manner, burnt). This is a first, plain version.
const GLSL = /* glsl */`
void aspSettle(Px p, inout Land L) {
  float built = p.cC.r, fields = p.cC.g;
  if (built + fields < .004) return;
  float flat_ = 1. - smoothstep(.2, .5, p.slope), near = smoothstep(1.5, .4, p.px);
  // fields: a patchwork of plots about a kilometre across; a plot is farmed when the share of fields beats its own number
  vec4 w = worleyV(p.pk / .9);
  float plot = step(w.w, fields * 1.15);
  vec3 crop = mix(vec3(.74, .66, .36), vec3(.46, .52, .22), step(.5, fract(w.w * 7.3)));       // stubble or green crop
  crop = mix(crop, vec3(.52, .40, .27), step(.8, fract(w.w * 13.7)));                           // fallow
  float fm = mix(fields * .8, plot, near) * flat_;                 // from afar the plots melt into one tint
  L.col = mix(L.col, mix(vec3(.62, .58, .32), crop, near), fm);
  // under the houses: trodden pale earth
  float bm = smoothstep(-.1, .1, built * 1.3 - (p.n3 * .6 + p.n2 * .4)) * flat_;
  L.col = mix(L.col, vec3(.63, .57, .46), bm * .7);
  L.cover *= (1. - fm) * (1. - bm);
}`;

const ZAR = { lat: 41.65, lon: -.89 };
export default {
  id: 'settle', title: 'Поселения', glsl: GLSL, uniforms: {},
  params: [
    { key: 'houses', label: 'Размер домов', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'growth', label: 'Рост городов', group: 'scale', min: .1, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'towns', label: 'Поселения', group: 'layers', type: 'toggle', value: 1 },
    { key: 'showcase', label: 'Витрина моделей', group: 'layers', type: 'toggle', value: 0 },
  ],
  pages: [
    { id: 'grow-village', group: 'Города и дороги', title: 'Деревня: колодец и несколько домов', note: 'Начало: «Рост городов» на 0,12. Рядом стоят стройки следующих домов.', p: { growth: .12, forest3d: 0, houses: 2.3 }, cam: { ...ZAR, h: 20, tilt: 55, heading: 30 } },
    { id: 'grow-small', group: 'Города и дороги', title: 'Городок: таверна, церковь, рынок', note: 'Тот же город позже: «Рост городов» на 0,4. Двигайте ползунок и смотрите, как он строится.', p: { growth: .4, forest3d: 0, houses: 2.3 }, cam: { ...ZAR, h: 20, tilt: 55, heading: 30 } },
    { id: 'grow-town', group: 'Города и дороги', title: 'Город: кузница, башни, замок, поля и мельница', note: 'Полный рост. Старое ядро стоит по сетке улиц, окраины выросли свободно.', p: { forest3d: 0, houses: 2.3 }, cam: { ...ZAR, h: 24, tilt: 55, heading: 30 } },
    { id: 'town-ring', group: 'Города и дороги', title: 'Другая манера строить: свободные кольца', note: 'Атлантический север: без сетки улиц и без рынка, дома стоят как попало вокруг колодца.', p: { forest3d: 0, houses: 2.3 }, cam: { lat: 43.26, lon: -2.93, h: 22, tilt: 55, heading: 160 } },
    { id: 'models', group: 'Города и дороги', title: 'Витрина моделей', note: 'Все модели набора (дома, церковь, замок, башни, мельницы, стройки, стены, деревья, скалы) в ряд. Облетайте и вращайте.', p: { showcase: 1, forest3d: 0, towns: 0, roadsOn: 0, labels: 0 }, cam: { lat: 39.25, lon: -3.0, h: 20, tilt: 55, heading: 0 } },
  ],
  async init(album) { return (await import('../layers/towns.js')).default(album); },
};
