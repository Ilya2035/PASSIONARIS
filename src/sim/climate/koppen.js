// Köppen–Geiger climate classes after Peel, Finlayson & McMahon (2007), with the B group evaluated first
// (Beck et al. 2018). Pure functions, no allocation in the hot path.
//
// Two ways to classify:
//   classifyKoppen(T, P, lat)          12 monthly mean temperatures (°C) and precipitation sums (mm)
//   classifyStats(koppenStats(…), dT)   the same from summary statistics, with a uniform temperature offset dT
// The second form is what the map uses: the statistics live on the 0.5° SIM grid (bilinear between cells) and
// every pixel adds its own lapse-rate correction for the map height, so class borders are crisp at any zoom and
// follow the relief (snow-line ET on the Alps, Cfb in their valleys). KOPPEN_GLSL is the shader copy of
// classifyStats and KOPPEN_COLORS_GLSL the palette below — both generated from this file, so map and legend agree.
//
// Rules (MAT mean annual T, MAP annual precipitation, Thot / Tcold warmest / coldest month, Tmon10 months above
// 10 °C, Pdry driest month, summer = the warmer of the half-years AMJJAS / ONDJFM, Psdry / Pswet driest / wettest
// summer month, Pwdry / Pwwet the same in winter):
//   B   MAP < 10·Pth, Pth = 2·MAT (+14, or +28 when ≥ 70 % of MAP falls in summer, +0 when ≥ 70 % in winter)
//       BW MAP < 5·Pth else BS; h MAT ≥ 18 else k
//   E   Thot ≤ 10: ET Thot > 0, EF Thot ≤ 0
//   A   Tcold ≥ 18: Af Pdry ≥ 60, Am Pdry ≥ 100 − MAP/25, else Aw
//   C   0 < Tcold < 18,  D  Tcold ≤ 0 (both Thot > 10)
//       s Psdry < 40 and Psdry < Pwwet/3,  w Pwdry < Pswet/10,  f neither (both s and w: the wetter half wins)
//       a Thot ≥ 22, b Tmon10 ≥ 4, d (D only) Tcold < −38, else c

export const KOPPEN = Object.freeze([
  { id: 0, code: '', group: '', nameRu: 'Вода', color: [0.6, 0.65, 0.66] },
  { id: 1, code: 'Af', group: 'A', nameRu: 'влажный тропический', color: [0.25, 0.43, 0.31] },
  { id: 2, code: 'Am', group: 'A', nameRu: 'муссонный тропический', color: [0.37, 0.53, 0.34] },
  { id: 3, code: 'Aw', group: 'A', nameRu: 'тропический с сухой зимой (саванна)', color: [0.64, 0.66, 0.4] },
  { id: 4, code: 'BWh', group: 'B', nameRu: 'жаркая пустыня', color: [0.92, 0.82, 0.61] },
  { id: 5, code: 'BWk', group: 'B', nameRu: 'холодная пустыня', color: [0.86, 0.81, 0.7] },
  { id: 6, code: 'BSh', group: 'B', nameRu: 'жаркая степь', color: [0.84, 0.66, 0.42] },
  { id: 7, code: 'BSk', group: 'B', nameRu: 'холодная степь', color: [0.75, 0.68, 0.51] },
  { id: 8, code: 'Csa', group: 'C', nameRu: 'средиземноморский с жарким летом', color: [0.86, 0.8, 0.42] },
  { id: 9, code: 'Csb', group: 'C', nameRu: 'средиземноморский с тёплым летом', color: [0.74, 0.75, 0.42] },
  { id: 10, code: 'Csc', group: 'C', nameRu: 'средиземноморский с прохладным летом', color: [0.63, 0.66, 0.47] },
  { id: 11, code: 'Cwa', group: 'C', nameRu: 'субтропический муссонный', color: [0.62, 0.74, 0.5] },
  { id: 12, code: 'Cwb', group: 'C', nameRu: 'субтропический нагорный', color: [0.51, 0.64, 0.46] },
  { id: 13, code: 'Cwc', group: 'C', nameRu: 'нагорный с прохладным летом', color: [0.43, 0.55, 0.43] },
  { id: 14, code: 'Cfa', group: 'C', nameRu: 'влажный субтропический', color: [0.71, 0.8, 0.55] },
  { id: 15, code: 'Cfb', group: 'C', nameRu: 'умеренный морской', color: [0.55, 0.73, 0.58] },
  { id: 16, code: 'Cfc', group: 'C', nameRu: 'субполярный морской', color: [0.44, 0.61, 0.57] },
  { id: 17, code: 'Dsa', group: 'D', nameRu: 'континентальный с сухим жарким летом', color: [0.77, 0.61, 0.68] },
  { id: 18, code: 'Dsb', group: 'D', nameRu: 'континентальный с сухим тёплым летом', color: [0.69, 0.58, 0.69] },
  { id: 19, code: 'Dsc', group: 'D', nameRu: 'субарктический с сухим летом', color: [0.6, 0.53, 0.65] },
  { id: 20, code: 'Dsd', group: 'D', nameRu: 'субарктический с сухим летом и лютой зимой', color: [0.52, 0.47, 0.6] },
  { id: 21, code: 'Dwa', group: 'D', nameRu: 'континентальный муссонный с жарким летом', color: [0.64, 0.71, 0.83] },
  { id: 22, code: 'Dwb', group: 'D', nameRu: 'континентальный муссонный с тёплым летом', color: [0.55, 0.63, 0.78] },
  { id: 23, code: 'Dwc', group: 'D', nameRu: 'субарктический с сухой зимой', color: [0.46, 0.53, 0.7] },
  { id: 24, code: 'Dwd', group: 'D', nameRu: 'субарктический с сухой лютой зимой', color: [0.38, 0.43, 0.6] },
  { id: 25, code: 'Dfa', group: 'D', nameRu: 'влажный континентальный с жарким летом', color: [0.61, 0.79, 0.8] },
  { id: 26, code: 'Dfb', group: 'D', nameRu: 'влажный континентальный с тёплым летом', color: [0.5, 0.69, 0.76] },
  { id: 27, code: 'Dfc', group: 'D', nameRu: 'субарктический (таёжный)', color: [0.42, 0.56, 0.65] },
  { id: 28, code: 'Dfd', group: 'D', nameRu: 'субарктический с лютой зимой', color: [0.35, 0.44, 0.54] },
  { id: 29, code: 'ET', group: 'E', nameRu: 'тундра', color: [0.73, 0.74, 0.74] },
  { id: 30, code: 'EF', group: 'E', nameRu: 'вечные льды', color: [0.95, 0.95, 0.94] },
]);
export const KOPPEN_ID = Object.freeze(Object.fromEntries(KOPPEN.slice(1).map(k => [k.code, k.id])));
export const KOPPEN_GROUPS = Object.freeze([
  { key: 'A', nameRu: 'тропические' },
  { key: 'B', nameRu: 'сухие' },
  { key: 'C', nameRu: 'умеренные' },
  { key: 'D', nameRu: 'континентальные' },
  { key: 'E', nameRu: 'полярные' },
]);

const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Summary statistics of a 12-month climate for classifyStats. Every temperature-dependent threshold is stored as a
 * temperature (so a uniform offset can be added later) and every precipitation test as a signed margin (> 0 = the
 * rule holds), which interpolate smoothly between grid cells.
 *   tCold, tHot, mat, t4     coldest / warmest month, mean annual, 4th warmest month (Tmon10 ≥ 4 ⇔ t4 > 10)
 *   bcrit, wcrit             B when mat > bcrit, BW when mat > wcrit (the aridity thresholds solved for MAT)
 *   sM, wM                   s / w margins (mm)
 *   afM, amM                 Af / Am margins (mm)
 *   map, pDry, summerN       annual precipitation, driest month, true when AMJJAS is the warmer half
 */
export function koppenStats(T, P, lat, s = {}) {
  let tMin = Infinity, tMax = -Infinity, tSum = 0, map = 0, pDry = Infinity;
  let tA = 0, tB = 0;   // AMJJAS / ONDJFM temperature sums (the warmer half is summer)
  let pA = 0, pB = 0, aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  // the 4 warmest months, kept sorted (descending) without allocation
  let w1 = -Infinity, w2 = -Infinity, w3 = -Infinity, w4 = -Infinity;
  for (let m = 0; m < 12; m++) {
    const t = T[m], p = P[m] > 0 ? P[m] : 0;
    tSum += t * MONTH_DAYS[m];
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    map += p;
    if (p < pDry) pDry = p;
    if (t > w4) {
      if (t > w1) { w4 = w3; w3 = w2; w2 = w1; w1 = t; } else if (t > w2) { w4 = w3; w3 = w2; w2 = t; } else if (t > w3) { w4 = w3; w3 = t; } else w4 = t;
    }
    if (m >= 3 && m <= 8) { tA += t; pA += p; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
    else { tB += t; pB += p; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
  }
  const summerN = tA >= tB;
  const pSum = summerN ? pA : pB, pWin = summerN ? pB : pA;
  const psDry = summerN ? aMin : bMin, psWet = summerN ? aMax : bMax;
  const pwDry = summerN ? bMin : aMin, pwWet = summerN ? bMax : aMax;
  const mat = tSum / 365.25;
  // 10·Pth = 20·MAT + add (mm)
  const add = map > 0 && pSum >= 0.7 * map ? 280 : map > 0 && pWin >= 0.7 * map ? 0 : 140;
  s.tCold = tMin; s.tHot = tMax; s.mat = mat; s.t4 = w4;
  s.bcrit = (map - add) / 20;
  s.wcrit = (map - add / 2) / 10;
  let sM = Math.min(40 - psDry, pwWet / 3 - psDry), wM = psWet / 10 - pwDry;
  if (sM > 0 && wM > 0) { if (pSum >= pWin) sM = -Math.min(sM, 1); else wM = -Math.min(wM, 1); }
  s.sM = sM; s.wM = wM;
  s.afM = pDry - 60;
  s.amM = pDry - (100 - map / 25);
  s.map = map; s.pDry = pDry; s.summerN = summerN; s.lat = lat;
  return s;
}

/** Class id (KOPPEN index) from koppenStats with a uniform temperature offset dT (°C, e.g. a lapse-rate correction). */
export function classifyStats(s, dT = 0) {
  const tc = s.tCold + dT, th = s.tHot + dT, mat = s.mat + dT, t4 = s.t4 + dT;
  if (mat > s.bcrit) return mat > s.wcrit ? (mat >= 18 ? 4 : 5) : (mat >= 18 ? 6 : 7);
  if (th <= 10) return th > 0 ? 29 : 30;
  if (tc >= 18) return s.afM >= 0 ? 1 : s.amM >= 0 ? 2 : 3;
  const p = s.sM > 0 ? 0 : s.wM > 0 ? 1 : 2;
  if (tc > 0) return 8 + 3 * p + (th >= 22 ? 0 : t4 > 10 ? 1 : 2);
  return 17 + 4 * p + (th >= 22 ? 0 : t4 > 10 ? 1 : tc < -38 ? 3 : 2);
}

const _s = {};
/** Class id from 12 monthly temperatures (°C) and precipitation sums (mm). */
export function classifyKoppen(T, P, lat) { return classifyStats(koppenStats(T, P, lat, _s)); }
export const koppenCode = id => KOPPEN[id]?.code || '';
export const koppenOf = code => KOPPEN[KOPPEN_ID[code]] || null;

// ------------------------------------------------------------------ map: lapse-rate correction
export const LAPSE = 0.0065;   // °C per metre
/**
 * Temperature correction (°C) from the 0.5° cell's mean height `cellElev` to the local map height `h`. The map
 * height is bedrock under the Greenland / Antarctic ice sheets (−20 m at 72N 40W vs ~3000 m of ice): where the
 * cell itself is glacial (warmest month ≤ 0 °C, fading out by 4 °C) the climate's own height is kept — the same
 * rule as the biome bake (scripts/climate/bake-biomes.mjs).
 */
export function lapseDT(h, cellElev, tHot, lat) {
  let hh = h > 0 ? h : 0;
  if (Math.abs(lat) > 58 && cellElev - hh > 150) {
    const w = sm01((4 - tHot) / 4) * sm01((cellElev - hh - 150) / 300);
    hh += w * (cellElev - hh);
  }
  return -LAPSE * (hh - cellElev);
}
const sm01 = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
/** GLSL palette: const vec3 KCOL[31] (index = class id). */
export const KOPPEN_COLORS_GLSL = `const vec3 KCOL[31] = vec3[31](${KOPPEN.map(k => `vec3(${k.color.map(f3).join(', ')})`).join(',\n  ')});`;

/**
 * GLSL copy of classifyStats and lapseDT. a = (tCold, tHot, mat, t4), b = (bcrit, wcrit, sM, wM),
 * c = (afM, amM, cellElev, gdd5).
 */
export const KOPPEN_GLSL = /* glsl */ `
float climLapse(float h, float e, float tHot, float latDeg) {
  float hh = max(h, 0.0);
  if (abs(latDeg) > 58.0 && e - hh > 150.0) {
    float w = smoothstep(0.0, 1.0, (4.0 - tHot) / 4.0) * smoothstep(0.0, 1.0, (e - hh - 150.0) / 300.0);
    hh += w * (e - hh);
  }
  return -${LAPSE} * (hh - e);
}
int koppenClass(vec4 a, vec4 b, vec4 c, float dT) {
  float tc = a.x + dT, th = a.y + dT, mat = a.z + dT, t4 = a.w + dT;
  int k = 0;
  if (mat > b.x) k = mat > b.y ? (mat >= 18.0 ? 4 : 5) : (mat >= 18.0 ? 6 : 7);
  else if (th <= 10.0) k = th > 0.0 ? 29 : 30;
  else if (tc >= 18.0) k = c.x >= 0.0 ? 1 : (c.y >= 0.0 ? 2 : 3);
  else {
    int p = b.z > 0.0 ? 0 : (b.w > 0.0 ? 1 : 2);
    if (tc > 0.0) k = 8 + 3 * p + (th >= 22.0 ? 0 : (t4 > 10.0 ? 1 : 2));
    else k = 17 + 4 * p + (th >= 22.0 ? 0 : (t4 > 10.0 ? 1 : (tc < -38.0 ? 3 : 2)));
  }
  return k;
}
${KOPPEN_COLORS_GLSL}
`;
