// Land fertility: the potential of a place for early farming and settlement, 0 (barren) .. 1 (richest).
// The groundwork for future peoples: where they can live, grow and multiply. Follows the era's climate.
//
//   heat     growing season: degree-days above 5 °C (GDD5), 0 below ~300 (tundra), full from ~3000 (long warm
//            seasons: the river valleys of the first civilisations; Paris ~0.8, Moscow ~0.45)
//   water    precipitation / potential evaporation (Thornthwaite): 0 in deserts, full from P/PET ≈ 0.8, a little
//            less when waterlogged; rivers, lakes and (a little) sea coasts lift it (irrigation, floodplains, fish)
//   soil     leached soils of the ever-wet tropics (rainforest: no dry season to clear and ripen), permafrost
//   terrain  steep slopes and high plateaus (the map height, per pixel)
// fertility = heat · max(water, irrigation) · soil · terrain.
//
// The statistics live on the 0.5° SIM grid; the map adds per pixel a lapse-rate correction of the growing season
// for the local height (dT · days above 5 °C), the slope and the river / lake proximity raster. FERT_GLSL is the
// shader copy of fertility() and FERT_RAMP_GLSL of fertRamp(), generated from this file.
import { dayLengths, thornthwaitePET } from './biomes.js';

const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const HEAT0 = 300, HEAT1 = 3000;            // GDD5 for no / full growing season (two harvests)
export const SLOPE0 = 0.05, SLOPE1 = 0.4;          // m/m: ~3° (no penalty) .. ~22° (−80 %)
export const ALT0 = 2500, ALT1 = 4500;             // m: high plateaus (thin air, frost, poor soils) −40 %
export const IRRIGATION = 1;                       // the strongest river raster value as a water factor (the Nile)

/** Water factor from the ratio of annual precipitation to potential evaporation. */
export function waterFactor(r) { return ss(0.1, 0.8, r) * (1 - 0.3 * ss(1.6, 3.5, r)); }

/**
 * Climate part of the fertility for 12 monthly temperatures (°C) and precipitation sums (mm) at latitude lat.
 *   gdd5   degree-days above 5 °C;  n5  days with a mean above 5 °C (d gdd5 / d T)
 *   pet    Thornthwaite potential evaporation (mm/yr);  ratio = MAP / PET
 *   water, soil  factors 0..1
 * dayLen: optional 12 day lengths for lat (dayLengths), reused across a row of the grid.
 */
export function fertilityStats(T, P, lat, s = {}, dayLen = null) {
  let gdd = 0, n5 = 0, map = 0, tMin = Infinity, tSum = 0, pDry = Infinity;
  for (let m = 0; m < 12; m++) {
    const t = T[m];
    if (t > 5) { gdd += (t - 5) * MONTH_DAYS[m]; n5 += MONTH_DAYS[m]; }
    if (t < tMin) tMin = t;
    tSum += t * MONTH_DAYS[m];
    const p = P[m] > 0 ? P[m] : 0;
    map += p;
    if (p < pDry) pDry = p;
  }
  const pet = thornthwaitePET(T, dayLen || dayLengths(lat, _dl));
  const r = pet > 1 ? map / pet : 99;
  const mat = tSum / 365.25;
  let soil = 1;
  // laterite: rain all year washes the warm soils out, and the forest never dries for clearing
  soil *= 1 - 0.45 * ss(15, 18, tMin) * Math.max(ss(30, 110, pDry), ss(1.2, 2.2, r));
  soil *= 1 - 0.4 * ss(-2, -9, mat);                    // permafrost
  s.gdd5 = gdd; s.n5 = n5; s.pet = pet; s.ratio = r; s.map = map;
  s.water = pet > 1 ? waterFactor(r) : 0.7;
  s.soil = soil;
  return s;
}
const _dl = new Float32Array(12);

/**
 * Fertility 0..1 from fertilityStats (or the map's layers): dT = temperature offset for the local height,
 * slope (m/m), h = height (m), irrig = river / lake / coast raster 0..1. out (optional) receives the factors.
 */
export function fertility(s, dT = 0, slope = 0, h = 0, irrig = 0, out = null) {
  const gdd = Math.max(0, s.gdd5 + dT * s.n5);
  const heat = ss(HEAT0, HEAT1, gdd);
  const water = Math.max(s.water, irrig * IRRIGATION);
  const terrain = (1 - 0.8 * ss(SLOPE0, SLOPE1, slope)) * (1 - 0.4 * ss(ALT0, ALT1, h));
  const f = Math.min(1, Math.max(0, heat * water * s.soil * terrain));
  if (out) { out.gdd = gdd; out.heat = heat; out.water = water; out.soil = s.soil; out.terrain = terrain; out.f = f; }
  return f;
}

export const FERT_TIERS = Object.freeze([
  { max: 0.06, nameRu: 'бесплодные' },
  { max: 0.2, nameRu: 'скудные' },
  { max: 0.4, nameRu: 'средние' },
  { max: 0.6, nameRu: 'хорошие' },
  { max: 0.8, nameRu: 'богатые' },
  { max: Infinity, nameRu: 'богатейшие' },
]);
export const fertTier = f => FERT_TIERS.find(t => f < t.max);

// ------------------------------------------------------------------ colours (map + legend)
// pale paper (barren) → ochre → straw → light green → green → deep green (richest)
export const FERT_STOPS = Object.freeze([
  [0, [0.86, 0.84, 0.79]], [0.12, [0.87, 0.77, 0.6]], [0.32, [0.83, 0.78, 0.52]],
  [0.52, [0.65, 0.71, 0.45]], [0.72, [0.44, 0.6, 0.37]], [1, [0.24, 0.44, 0.28]],
]);
export function fertRamp(f) {
  let c = FERT_STOPS[0][1].slice();
  for (let i = 1; i < FERT_STOPS.length; i++) {
    const [x0] = FERT_STOPS[i - 1], [x1, d] = FERT_STOPS[i], t = ss(x0, x1, f);
    c = c.map((v, k) => v + (d[k] - v) * t);
  }
  return c;
}
const g = v => (Math.round(v * 1000) / 1000).toFixed(3);
const v3 = c => `vec3(${c.map(g).join(', ')})`;
export const FERT_RAMP_GLSL = `vec3 fertRamp(float f) {
  vec3 c = ${v3(FERT_STOPS[0][1])};
${FERT_STOPS.slice(1).map(([x1, d], i) => `  c = mix(c, ${v3(d)}, smoothstep(${g(FERT_STOPS[i][0])}, ${g(x1)}, f));`).join('\n')}
  return c;
}`;

/** GLSL copy of fertility(): c = (afM, amM, cellElev, gdd5), d = (water, n5, soil, -). */
export const FERT_GLSL = /* glsl */ `
float fertilityAt(vec4 c, vec4 d, float dT, float slope, float h, float irrig) {
  float gdd = max(0.0, c.w + dT * d.y);
  float heat = smoothstep(${g(HEAT0)}, ${g(HEAT1)}, gdd);
  float water = max(d.x, irrig * ${g(IRRIGATION)});
  float terr = (1.0 - 0.8 * smoothstep(${g(SLOPE0)}, ${g(SLOPE1)}, slope)) * (1.0 - 0.4 * smoothstep(${g(ALT0)}, ${g(ALT1)}, h));
  return clamp(heat * water * d.z * terr, 0.0, 1.0);
}
${FERT_RAMP_GLSL}
`;
