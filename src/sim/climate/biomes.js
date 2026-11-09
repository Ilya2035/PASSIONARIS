// Biome classes and the climate -> biome rule set (Köppen thresholds + Whittaker-style
// moisture / heat limits). Pure functions, no allocation in the hot path, so the same
// rules can re-classify the world under a paleo-climate (see paleo.js) at runtime.
//
// The baked map public/assets/climate/biome.bin.gz (Uint8 8192x4096) stores these ids.

export const BIOME = Object.freeze({
  WATER: 0, ICE: 1, TUNDRA: 2, TAIGA: 3, TEMPERATE_FOREST: 4, STEPPE: 5, MEDITERRANEAN: 6,
  DESERT: 7, SEMI_DESERT: 8, SAVANNA: 9, TROPICAL_FOREST: 10, WETLAND: 11, HIGHLAND: 12,
});

// Neutral, archival tones (fit the graphite / sepia palettes of src/shared/palettes.js).
export const BIOMES = Object.freeze([
  { id: 0, key: 'water', nameRu: 'Вода', description: 'Океаны, моря и озёра.', color: '#8e9a9c' },
  { id: 1, key: 'ice', nameRu: 'Льды', description: 'Ледниковые щиты и вечные льды: даже летом ниже нуля.', color: '#e8e6df' },
  { id: 2, key: 'tundra', nameRu: 'Тундра', description: 'Холодная безлесная равнина: мхи, лишайники, карликовые кустарники, вечная мерзлота.', color: '#b8b6a2' },
  { id: 3, key: 'taiga', nameRu: 'Тайга', description: 'Северный хвойный лес с долгой суровой зимой и коротким летом.', color: '#7b866e' },
  { id: 4, key: 'temperate_forest', nameRu: 'Умеренный лес', description: 'Широколиственные и смешанные леса умеренного пояса с выраженными сезонами.', color: '#929c78' },
  { id: 5, key: 'steppe', nameRu: 'Степь и луга', description: 'Травянистые равнины умеренного пояса с засушливым летом или малым количеством осадков.', color: '#c6bf92' },
  { id: 6, key: 'mediterranean', nameRu: 'Средиземноморье', description: 'Жестколистные леса и кустарники: сухое жаркое лето, мягкая дождливая зима.', color: '#aaa47a' },
  { id: 7, key: 'desert', nameRu: 'Пустыня', description: 'Крайне засушливые земли: пески, камни, редкие оазисы.', color: '#e3d7b6' },
  { id: 8, key: 'semi_desert', nameRu: 'Полупустыня', description: 'Сухие кустарники и редкая трава на границе пустыни.', color: '#d3c59f' },
  { id: 9, key: 'savanna', nameRu: 'Саванна', description: 'Жаркие травяные равнины с редкими деревьями, долгим сухим сезоном и сезоном дождей.', color: '#c8b27e' },
  { id: 10, key: 'tropical_forest', nameRu: 'Тропический лес', description: 'Влажные вечнозелёные и муссонные леса жаркого пояса.', color: '#6e7e5e' },
  { id: 11, key: 'wetland', nameRu: 'Болота', description: 'Плоские переувлажнённые низины: болота, топи, поймы.', color: '#879488' },
  { id: 12, key: 'highland', nameRu: 'Высокогорье', description: 'Горы выше границы леса и высокие плато: альпийские луга, камни, снега.', color: '#a39c8e' },
]);

export const LAPSE_RATE = 0.0065; // °C per metre
/** Minimum growing degree-days above 5 °C (from monthly means) for forest; below it tundra. */
export const TREE_GDD5 = 400;
/** Minimum GDD5 for the moist steppe / forest-steppe band (aridity ratio 1..1.5). */
export const STEPPE_GDD5 = 800;

const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_DOY = [15.5, 45.1, 74.6, 105.1, 135.6, 166.1, 196.6, 227.6, 258.1, 288.6, 319.1, 349.6];

/** Mean day length (hours) at mid-month for a latitude, per month (fills out[12]). */
export function dayLengths(latDeg, out = new Float32Array(12)) {
  const phi = latDeg * Math.PI / 180;
  for (let m = 0; m < 12; m++) {
    const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (MID_DOY[m] - 80) / 365.25);
    const c = Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl)));
    out[m] = 24 * Math.acos(c) / Math.PI;
  }
  return out;
}

/**
 * Thornthwaite (1948) potential evapotranspiration, mm/year.
 * T: 12 monthly °C; dayLen: 12 day lengths (h) from dayLengths(lat).
 */
export function thornthwaitePET(T, dayLen) {
  let I = 0;
  for (let m = 0; m < 12; m++) if (T[m] > 0) I += Math.pow(T[m] / 5, 1.514);
  if (I <= 0) return 0;
  const a = 6.75e-7 * I * I * I - 7.71e-5 * I * I + 1.792e-2 * I + 0.49239;
  let pet = 0;
  for (let m = 0; m < 12; m++) {
    const t = T[m];
    if (t <= 0) continue;
    const base = t >= 26.5 ? -415.85 + 32.24 * t - 0.43 * t * t : 16 * Math.pow(10 * t / I, a);
    pet += base * (dayLen[m] / 12) * (MONTH_DAYS[m] / 30);
  }
  return pet;
}

/**
 * Summary statistics of a 12-month climate (°C, mm/month) used by the classifier.
 * Summer half-year: Apr–Sep in the north, Oct–Mar in the south (blended across the equator).
 */
export function climateStats(T, P, lat, s = {}) {
  let tSum = 0, tMin = Infinity, tMax = -Infinity, pAnn = 0, pDry = Infinity, gdd5 = 0;
  let pAprSep = 0, pDrySummer = Infinity, pWetWinter = 0;
  for (let m = 0; m < 12; m++) {
    const t = T[m], p = P[m];
    tSum += t * MONTH_DAYS[m];
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    pAnn += p;
    if (p < pDry) pDry = p;
    if (t > 5) gdd5 += (t - 5) * MONTH_DAYS[m];
    const aprSep = m >= 3 && m <= 8;
    if (aprSep) pAprSep += p;
    const summer = lat >= 0 ? aprSep : !aprSep;
    if (summer) { if (p < pDrySummer) pDrySummer = p; } else if (p > pWetWinter) pWetWinter = p;
  }
  // Summer half-year rain for the Köppen aridity threshold: Apr–Sep in the north, Oct–Mar in the
  // south, blended over 5°S..5°N so the classification has no seam along the equator.
  const wN = lat >= 5 ? 1 : lat <= -5 ? 0 : (lat + 5) / 10;
  const pSum = wN * pAprSep + (1 - wN) * (pAnn - pAprSep), pWin = pAnn - pSum;
  s.absLat = Math.abs(lat);
  s.tAnn = tSum / 365.25; s.tMin = tMin; s.tMax = tMax; s.pAnn = pAnn; s.pDry = pDry; s.gdd5 = gdd5;
  s.pSummer = pSum; s.pWinter = pWin; s.pDrySummer = pDrySummer; s.pWetWinter = pWetWinter;
  // Köppen aridity threshold (mm/yr) and the ratio of precipitation to it
  const add = pSum >= 0.7 * pAnn ? 280 : pWin >= 0.7 * pAnn ? 0 : 140;
  const pth = 20 * s.tAnn + add;
  s.aridity = pth > 1 ? pAnn / pth : 99;
  return s;
}

/**
 * Classify a climate. s: climateStats() result; h: surface elevation (m);
 * flatLow: true if the place is a low, very flat plain (wetland candidate);
 * T, dayLen: monthly temperatures and day lengths, only read when flatLow (for PET).
 */
export function classifyBiome(s, h, flatLow = false, T = null, dayLen = null) {
  let b;
  if (s.tMax < 0) return BIOME.ICE;                       // EF
  // A climates, plus tropical highlands whose coolest month is only cooled by altitude
  // (East African / Zambezian plateaus): weak seasonality, frost-free
  const tropical = s.tMin >= 18 || (s.absLat < 23.5 && s.tMin >= 10 && s.tMax - s.tMin < 10);
  // Cs: dry summer in the subtropics / mid-latitudes (not the equatorial dry season)
  const medit = !tropical && s.tMin > -3 && s.absLat >= 25 && s.pDrySummer < 40 && s.pDrySummer < s.pWetWinter / 3;
  const r = s.aridity;
  // ET (warmest month < 10 °C), or too little summer heat for trees: the Arctic tree line follows
  // a growing-degree-day limit better than the 10 °C July isotherm (BIOME, Prentice et al. 1992:
  // boreal trees need GDD5 >= ~350 from daily temperatures; GDD5 from monthly means runs lower
  // near the limit, hence TREE_GDD5 = 400). Baker Lake, Taimyr, Chukotka, the Alaskan North Slope
  // have warmest months of 11–12 °C but GDD5 of 300–390 and are tundra; Kuujjuaq, Vorkuta, Inuvik
  // (430–600) keep their forest-tundra / taiga.
  if (s.tMax < 10 || s.gdd5 < TREE_GDD5) {               // above the tree line in mountains
    if (h >= 1500) return BIOME.HIGHLAND;
    b = BIOME.TUNDRA;
  } else if (h >= 3000) return BIOME.HIGHLAND;            // high plateaus (Tibet, Altiplano)
  else if (r < 0.5) b = BIOME.DESERT;
  else if (r < 0.75) b = BIOME.SEMI_DESERT;
  else if (r < 1) b = tropical ? BIOME.SAVANNA : medit ? BIOME.MEDITERRANEAN : BIOME.STEPPE;
  else if (tropical) {
    // Af / Am, or very wet monsoon climates -> forest; Aw / As -> savanna
    b = (s.pDry >= 60 || s.pDry >= 100 - s.pAnn / 25 || s.pAnn >= 1700) ? BIOME.TROPICAL_FOREST : BIOME.SAVANNA;
  } else if (medit) b = BIOME.MEDITERRANEAN;
  // forest-steppe margin (1 <= r < 1.5) only where summers are warm enough for grassland to
  // out-compete trees; in cold boreal climates the Köppen threshold 20·T + 280 is tiny, so dry
  // interior Alaska / the Yukon Flats (r ≈ 1.2, GDD5 < 800) stay taiga
  else if (r < 1.5 && s.gdd5 >= STEPPE_GDD5) b = BIOME.STEPPE;
  else if ((s.tMin < -2 && s.gdd5 < 1400) || s.gdd5 < 700) b = BIOME.TAIGA;
  else b = BIOME.TEMPERATE_FOREST;

  if (flatLow && T && dayLen && (b === BIOME.TUNDRA || b === BIOME.TAIGA || b === BIOME.TEMPERATE_FOREST
    || b === BIOME.STEPPE || b === BIOME.SAVANNA)) {
    const pet = thornthwaitePET(T, dayLen);
    if (pet > 0 && s.pAnn / pet >= WETLAND_MOISTURE) b = BIOME.WETLAND;
  }
  return b;
}

/** Wetland thresholds: annual P / PET, max local relief (m), max elevation (m). */
export const WETLAND_MOISTURE = 1.1;
export const WETLAND_RELIEF = 35;
export const WETLAND_MAX_ELEV = 200;
