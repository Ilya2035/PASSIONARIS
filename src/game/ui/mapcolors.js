// Colours of the data map modes — «Климатические пояса», «Погода сегодня», «Воздух», «Ветры и течения» — in one
// table: the terrain shader (MAPCOLORS_GLSL, src/game/shaders.js) and the legend (src/game/ui/legend.js) both read
// it, so the map and its legend cannot drift apart. («Плодородие» keeps the ramp of src/sim/climate/fertility.js.)
//
// One quiet style: muted paper tones, no loud primaries; neighbouring classes differ in hue or in lightness (hot and
// cold deserts, the three temperate families, the three continental ones), and none of them sits near the slate of
// the sea, so land and water always read apart.

import { KOPPEN } from '../../sim/climate/koppen.js';

// Köppen–Geiger classes by code (ids and names: src/sim/climate/koppen.js)
export const KOPPEN_COLORS = Object.freeze({
  // A tropical: deep greens, the savanna an olive
  Af: [0.22, 0.42, 0.3], Am: [0.36, 0.55, 0.36], Aw: [0.67, 0.7, 0.42],
  // B dry: hot sand and ochre, the cold ones greyer
  BWh: [0.93, 0.83, 0.6], BWk: [0.82, 0.79, 0.72], BSh: [0.86, 0.66, 0.4], BSk: [0.72, 0.66, 0.5],
  // C temperate: dry summer golden, dry winter mint, no dry season fresh green
  Csa: [0.9, 0.8, 0.36], Csb: [0.78, 0.76, 0.38], Csc: [0.6, 0.62, 0.44],
  Cwa: [0.62, 0.8, 0.66], Cwb: [0.46, 0.68, 0.58], Cwc: [0.36, 0.56, 0.52],
  Cfa: [0.74, 0.82, 0.5], Cfb: [0.52, 0.72, 0.48], Cfc: [0.4, 0.58, 0.46],
  // D continental: dry summer rose to plum, dry winter lavender, no dry season blue-teal; darker = harsher
  Dsa: [0.84, 0.62, 0.66], Dsb: [0.75, 0.56, 0.68], Dsc: [0.63, 0.5, 0.65], Dsd: [0.52, 0.43, 0.58],
  Dwa: [0.72, 0.72, 0.88], Dwb: [0.61, 0.61, 0.82], Dwc: [0.5, 0.5, 0.73], Dwd: [0.4, 0.4, 0.62],
  Dfa: [0.6, 0.8, 0.83], Dfb: [0.46, 0.7, 0.78], Dfc: [0.36, 0.56, 0.68], Dfd: [0.28, 0.42, 0.56],
  // E polar: frost and ice
  ET: [0.8, 0.8, 0.84], EF: [0.96, 0.96, 0.95],
});
const KOPPEN_WATER = [0.6, 0.65, 0.66];   // class 0 (never drawn: the sea has its own colour)
export const koppenColor = code => KOPPEN_COLORS[code] || KOPPEN_WATER;

// «Погода сегодня»
export const WX = Object.freeze({
  warm: [0.82, 0.44, 0.31], cold: [0.35, 0.51, 0.76],          // anomaly against the norm, at ±8 °C and beyond
  rain: [[0.6, 0.78, 0.64], [0.27, 0.57, 0.45], [0.4, 0.27, 0.53]],   // drizzle, rain, downpour
  snowfall: [[0.82, 0.82, 0.95], [0.58, 0.55, 0.83]],        // light, heavy
  cloud: [0.98, 0.98, 0.97], snow: [0.975, 0.98, 0.995], drought: [0.58, 0.36, 0.18],
});
export const WX_STEPS = Object.freeze({
  anomaly: [1.5, 3.5, 5.5, 7.5],   // °C: the edges of the four bands on either side of the norm
  rain: [0.03, 0.3, 0.66],         // weather-layer intensity (log scale): drizzle from, rain from, downpour from
});
// «Воздух»
export const AIR = Object.freeze({
  ash: [0.2, 0.19, 0.19], smoke: [0.5, 0.37, 0.27], dust: [0.86, 0.63, 0.32], sulf: [0.62, 0.56, 0.78],
  fall: [0.33, 0.31, 0.3], cool: [0.42, 0.58, 0.82],
});
// «Ветры и течения»: the belts (the currents' own colours: src/game/fx/currents.js)
export const WIND = Object.freeze({ east: [0.86, 0.7, 0.46], west: [0.5, 0.64, 0.8] });

const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
const v3 = c => `vec3(${c.map(f3).join(', ')})`;
/** GLSL copy of the tables above (constants only). */
export const MAPCOLORS_GLSL = `
const vec3 KPAL[${KOPPEN.length}] = vec3[${KOPPEN.length}](${KOPPEN.map(k => v3(koppenColor(k.code))).join(',\n  ')});   // index = class id
const vec3 WX_WARM = ${v3(WX.warm)}, WX_COLD = ${v3(WX.cold)}, WX_DROUGHT = ${v3(WX.drought)};
const vec3 WX_CLOUD = ${v3(WX.cloud)}, WX_SNOW = ${v3(WX.snow)};
const vec3 WX_RAIN0 = ${v3(WX.rain[0])}, WX_RAIN1 = ${v3(WX.rain[1])}, WX_RAIN2 = ${v3(WX.rain[2])};
const vec3 WX_SNOWF0 = ${v3(WX.snowfall[0])}, WX_SNOWF1 = ${v3(WX.snowfall[1])};
const vec4 WX_ASTEP = vec4(${WX_STEPS.anomaly.map(f3).join(', ')});
const vec3 WX_RSTEP = vec3(${WX_STEPS.rain.map(f3).join(', ')});
const vec3 AIR_ASH = ${v3(AIR.ash)}, AIR_SMOKE = ${v3(AIR.smoke)}, AIR_DUST = ${v3(AIR.dust)};
const vec3 AIR_SULF = ${v3(AIR.sulf)}, AIR_FALL = ${v3(AIR.fall)}, AIR_COOL = ${v3(AIR.cool)};
const vec3 WIND_EAST = ${v3(WIND.east)}, WIND_WEST = ${v3(WIND.west)};
`;
