// ASPECT «Лес»: where the forest of a chunk stands and how it looks. This file and layers/forest.js belong to the
// forest work; the contract with the rest of the album is in docs/ALBUM-CHUNKS.md.
//   forestCover(p)   → share of the pixel under canopy (the ground shader asks it first)
//   aspForest(p, L)  → paints the canopy over the ground colour L.col
// The state comes from the chunks: p.cA = (forest 0 cut .. 1 natural, share of conifers, age, swamp).

// rules shared with the 3D trees (layers/forest.js): a tree stands exactly where the ground is painted as forest
export const FOREST_RULES = /* glsl */`
float albumTreeline(float n1) { return 2150. + (n1 - .5) * 260.; }
// share of the ground under trees before patchiness: closed forest where wet, open woodland where dry
float albumForestShare(float wet, float hl, float slope, float n1) {
  float steep = smoothstep(.40, .82, slope), tl = albumTreeline(n1);
  float fc = smoothstep(.34, .58, wet) * (1. - smoothstep(tl - 180., tl + 40., hl)) * (1. - steep);
  return max(fc, smoothstep(.20, .34, wet) * .38 * (1. - steep) * (1. - smoothstep(1500., 1900., hl)));
}
float albumCover(float fc, float k, float n2, float n3) { return smoothstep(-.10, .10, fc * k - (n2 * .65 + n3 * .35) * .9 + .05); }
// the same with the state of the chunk: as the forest of a chunk is cut, the thinnest stands go first
float albumChunkCover(float fc, float k, float n2, float n3, float density) { return albumCover(fc, k * density, n2, n3) * smoothstep(0., .08, density); }
`;

const GLSL = /* glsl */`
${FOREST_RULES}
float forestCover(Px p) { return albumChunkCover(albumForestShare(p.wet, p.hl, p.slope, p.n1), uForestK, p.n2, p.n3, p.cA.r); }

void aspForest(Px p, inout Land L) {
  float cover = L.cover, px = p.px; vec2 pk = p.pk;
  vec2 pks = pk + p.sd * .22;                                       // the same question a step toward the sun: rim and cast shade
  float coverS = cover;
  if (px < .7) coverS = mix(cover, albumChunkCover(albumForestShare(p.wet, p.hl, p.slope, p.n1), uForestK, mix(.5, fbm(pks / 7.3 + 5.), smoothstep(5., 1.5, px)), mix(.5, vnoise(pks / 1.1), smoothstep(.7, .25, px)), p.cA.r), smoothstep(.7, .4, px));
  if (cover < .003 && coverS < .003) return;
  vec3 forestCol = mix(vec3(.20, .27, .10), vec3(.105, .235, .085), smoothstep(.5, .75, p.wet));
  forestCol = mix(forestCol, vec3(.075, .19, .12), clamp(smoothstep(1100., 1700., p.hl) * .7 + (p.n1 - .5) * .3, 0., 1.));
  forestCol = mix(forestCol, vec3(.42, .26, .08), uSeason * (.55 + .45 * p.n3) * smoothstep(.45, .7, p.wet));   // autumn
  // the forest reads as moss: tufts of three sizes, each lit on its sunny side; they fade out one by one with distance
  float f1 = smoothstep(.06, .015, px), f2 = smoothstep(.2, .05, px), f3 = smoothstep(.9, .25, px), tuft = 0., tone = .5, litc = 0.;
  if (cover > .01) {
    if (f1 > 0.) { vec4 w = worleyV(pk / .045); tuft += f1 * .45 * (1. - w.z); litc += f1 * .55 * (dot(normalize(vec3(-w.xy * 2.4, 1.)), uSun) - uSun.z); tone = mix(tone, w.w, f1 * .6); }
    if (f2 > 0.) { vec4 w = worleyV(pk / .14 + 3.1); tuft += f2 * .35 * (1. - w.z); litc += f2 * .4 * (dot(normalize(vec3(-w.xy * 2., 1.)), uSun) - uSun.z); tone = mix(tone, w.w, f2 * .5); }
    if (f3 > 0.) { vec4 w = worleyV(pk / .62 + 7.7); tuft += f3 * .3 * (1. - w.z); litc += f3 * .32 * (dot(normalize(vec3(-w.xy * 1.6, 1.)), uSun) - uSun.z); tone = mix(tone, w.w, f3 * .5); }
  }
  float stand = vnoise(pk / 2.6 + 11.) * .6 + p.n2 * .4;            // stands of different trees
  forestCol = mix(forestCol, vec3(.36, .44, .14), smoothstep(.58, .8, stand) * .55);
  forestCol = mix(forestCol, vec3(.07, .20, .14), smoothstep(.42, .2, stand) * .5);
  forestCol = mix(forestCol, vec3(.50, .44, .16), smoothstep(.93, .99, tone) * .5);
  vec3 canopy = forestCol * (.78 + .5 * tone) * (.86 + .5 * tuft + .9 * litc * p.day) * (cover > .01 ? mix(vec3(1.), texDetail(tForest, pk, px, p.pdx, p.pdy), .35) : vec3(1.));
  float rim = clamp(cover - coverS, 0., 1.), castS = clamp(coverS - cover, 0., 1.);
  L.col = mix(L.col * (1. - .5 * castS * p.day), canopy * (1. + .35 * rim * p.day), cover);
}`;

export default {
  id: 'forest', title: 'Лес', glsl: GLSL, uniforms: {},
  params: [
    { key: 'forest', label: 'Густота леса', group: 'scale', min: 0, max: 1.6, step: .05, value: 1, unit: '×', uniform: 'uForestK' },
    { key: 'trees', label: 'Размер деревьев', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'forest3d', label: 'Объёмные деревья', group: 'layers', type: 'toggle', value: 1 },
  ],
  pages: [
    { id: 'forest-paint', group: 'Лес', title: 'Лес только краской', note: 'Лес показан цветом и рисунком крон на земле, без объёмных деревьев.', p: { forest3d: 0 }, cam: { lat: 43.2, lon: -4.85, h: 35, tilt: 55, heading: 150 } },
    { id: 'forest-3d', group: 'Лес', title: 'Лес объёмными кронами', note: 'Поверх краски стоят увеличенные деревья: лиственные круглые, хвойные острые.', p: { forest3d: 1 }, cam: { lat: 43.2, lon: -4.85, h: 35, tilt: 55, heading: 150 } },
    { id: 'forest-open', group: 'Лес', title: 'Редколесье и поляны', note: 'Густота леса снижена: больше открытых мест.', p: { forest: .6 }, cam: { lat: 40.6, lon: -3.85, h: 60, tilt: 50, heading: 30 } },
    { id: 'forest-moss', group: 'Лес', title: 'Лес как мох с 200 км', note: 'Издалека лес — мягкий ворс из пучков трёх размеров и разных оттенков.', p: {}, cam: { lat: 43.2, lon: -4.85, h: 200, tilt: 40, heading: 170 } },
  ],
  async init(album) { return (await import('../layers/forest.js')).default(album); },
};
