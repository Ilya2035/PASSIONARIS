// The bare ground: what the land looks like where no forest, swamp, field or house covers it (docs/album/ground.md).
// The owner of this file is the part «Земля и лес», which also owns terrain.js, glsl.js, data.js and the forest and
// swamp aspects. The ground shader (terrain.js) calls groundBare() for every pixel of land; the knobs and the pages of
// the ground live here. A knob with `map: 'Подпись'` gets a switch on the panel of the map (mapview.js).
//
// The land is painted the way it is seen from a satellite, and from nothing but the place itself:
//   • the climate of the place (ground/climate.js): how much the low growth hides the soil, and whether the grass of
//     summer is burnt straw or green;
//   • the lie of the land: a slope that faces north and the floor of a valley are wetter than the ridge above them
//     (the ground shader has already put that into p.wet), steep ground is rock, steep ground in a dry land is bare
//     marl cut by rills;
//   • patterns of their true size: scrub in patches of hundreds of metres, bushes of ten, the soil in regions of
//     tens of km. Nothing here is a photograph enlarged.
// How this function is written matters for speed, and not in the usual way. A weak video card keeps every number a
// shader holds at one moment in a register; when the fullest moment of the whole ground shader needs more registers
// than a limit, the card works on fewer pixels at a time and every frame takes half as long again (measured
// 13.11.2026: one more noise in the wrong place — 270 → 380 ms). The fullest moment was here. So: every noise and
// every weight is counted first, while no colour is held yet; then the colour is built one layer at a time, each layer
// used up at once; the grain of the ground is laid on by the ground shader afterwards. Keep it that way.
const GLSL = /* glsl */`
uniform float uDryK, uGrainK;
// nz: the shared noises of 38, 7 and 1 km; wet, px, hl, slope, pk: as in Px (the wetness already knows the slope and
// the hollow); summer: 0 a summer without water .. 1 a green one (albumClimate().a)
vec3 groundBare(vec3 nz, float wet, float summer, float px, float hl, float slope, vec2 pk) {
  // ---- noises and weights first
  float g2 = vnoise(pk / 23. + 31.), fine = .5, bush = 0.;
  if (px < .12) fine = mix(.5, vnoise(mat2(.8, -.6, .6, .8) * pk / .21 + 5.), smoothstep(.12, .04, px));
  if (px < .02) bush = smoothstep(.80, .92, vnoise(pk / .017 + 3.)) * smoothstep(.02, .009, px) * smoothstep(.10, .22, wet);   // bushes one by one, in the near view
  float mott = nz.z * .55 + fine * .45, tl = albumTreeline(nz.x);
  // how much of the soil the low growth hides (grass, herbs, dwarf scrub), in patches where it is thin
  float vc = smoothstep(.07 * uDryK, .40 * uDryK, wet);
  float veg = max(clamp(vc + (mott - .5) * 4.4 * vc * (1. - vc), 0., 1.), bush * .9);
  // straw where the summer is dry, green where it rains in summer
  float green = smoothstep(.30, .80, summer * .5 + wet * .5);
  // scrub in patches: grey-olive matorral in the dry lands, heather and gorse on the wet hills
  float sp = max(smoothstep(.50, .74, nz.z * .5 + nz.y * .22 + fine * .28) * smoothstep(.13, .26, wet) * (.75 - .3 * smoothstep(.55, .8, wet)), bush * .8);
  // dry slopes are bare: pale marl in beds (the badlands of the Ebro and of Almería)
  float bad = (1. - smoothstep(.13 * uDryK, .30 * uDryK, wet)) * smoothstep(.07, .30, slope) * (1. - smoothstep(.45, .9, slope)) * .85;
  float beds = .90 + .14 * (.5 + .5 * sin(hl / 7. + fine * 6.)) * smoothstep(.12, .03, px);
  // ---- the low growth
  vec3 c = mix(mix(vec3(.65, .57, .33), vec3(.53, .52, .28), smoothstep(0., .5, green)), mix(vec3(.38, .49, .20), vec3(.29, .45, .15), smoothstep(.6, 1., green)), smoothstep(.3, .85, green)) * (.93 + .14 * nz.y);
  c = mix(c, mix(vec3(.39, .42, .25), mix(vec3(.33, .40, .20), vec3(.46, .37, .37), smoothstep(.55, .8, mott)), smoothstep(.5, .75, wet)) * (1. - .18 * bush), sp);
  // ---- the soil under it: ochre loam, pale marl and gypsum, red clay, grey stony ground, in regions of tens of km
  vec3 soil = mix(vec3(.64, .53, .34), vec3(.70, .63, .46), smoothstep(.38, .62, nz.x));
  soil = mix(soil, vec3(.62, .42, .28), smoothstep(.55, .85, g2) * .7);
  soil = mix(soil, vec3(.54, .49, .40), smoothstep(.45, .15, g2) * .6) * (.94 + .12 * nz.y);
  soil = mix(soil, mix(soil, vec3(.68, .60, .45), .3) * beds, bad);
  c = mix(soil, c, veg * (1. - bad));
  // ---- above the trees: short alpine grass; just below them, heath in patches
  c = mix(c, vec3(.43, .46, .26) * (.92 + .16 * nz.z), smoothstep(tl - 100., tl + 150., hl) * smoothstep(.15, .4, wet));
  c = mix(c, vec3(.47, .39, .38), smoothstep(tl - 500., tl, hl) * smoothstep(.55, .8, mott) * .3 * smoothstep(.35, .6, wet));
  // ---- a true desert: sand in seas of dunes, stony plain between them
  return mix(c, vec3(.80, .64, .40) * (.95 + .1 * nz.y), (1. - smoothstep(.03, .07, wet)) * smoothstep(.46, .58, nz.x * .6 + g2 * .4));
}`;

const G = 'Земля';
const cam = (lat, lon, h, tilt = 40, heading = 0) => ({ lat, lon, h, tilt, heading });
const PLAIN = { towns: 0, labels: 0, roadsOn: 0 };
export default {
  id: 'ground', title: 'Земля',
  glsl: GLSL,
  uniforms: { uDryK: { value: 1 }, uGrainK: { value: 1 } },
  params: [
    { key: 'dry', label: 'Сухие земли и пустыни', group: 'land', min: .6, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uDryK' },
    { key: 'grain', label: 'Зерно земли', group: 'land', min: 0, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uGrainK' },
  ],
  pages: [
    { id: 'ground-meseta', group: G, title: 'Месета у Мадрида с 20 км', note: 'Сухая степь: выгоревшая трава, пятна кустарника, редкие дубравы на северных склонах и в низинах. Лес к северу, на склонах Гвадаррамы.', p: PLAIN, cam: cam(40.05, -3.55, 20) },
    { id: 'ground-meseta-200', group: G, title: 'Месета с 200 км', note: 'Обычная игровая высота: жёлто-бурое плато, зелёные горы вокруг, леса на влажном севере.', p: {}, cam: cam(40.05, -3.55, 200) },
    { id: 'ground-desert', group: G, title: 'Пустыня Альмерии с 20 км', note: 'Самое сухое место Европы: голая светлая земля, осыпи и промоины на склонах, редкий кустарник.', p: PLAIN, cam: cam(37.02, -2.42, 20, 50) },
    { id: 'ground-desert-200', group: G, title: 'Сухой юго-восток с 200 км', note: 'От пустыни Альмерии до лесов Сьерра-Невады и Касорлы.', p: {}, cam: cam(37.4, -2.6, 200) },
    { id: 'ground-ebro', group: G, title: 'Монегрос и Барденас с 60 км', note: 'Сухая котловина Эбро: светлый мергель, степь, зелень только вдоль рек и на северных склонах.', p: PLAIN, cam: cam(41.75, -0.6, 60) },
    { id: 'ground-atlantic', group: G, title: 'Галисия с 50 км', note: 'Влажный север: зелёные луга, вереск на холмах, сомкнутый лес.', p: PLAIN, cam: cam(42.85, -7.9, 50) },
    { id: 'ground-rif', group: G, title: 'Север Марокко с 50 км', note: 'Риф: сухие предгорья, лес на высоких склонах.', p: PLAIN, cam: cam(35.45, -5.45, 50) },
    { id: 'ground-far', group: G, title: 'Влажность и сухость: весь полуостров', note: 'Сколько леса и какого цвета земля, решает открытый климат (CHELSA): зелёный атлантический север, сухое плато, пустынный юго-восток.', p: {}, cam: cam(40.2, -3.4, 1500, 0) },
  ],
};
