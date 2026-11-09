// Paleoclimate model for 5000 BC – 2100 AD (astronomical years -4999 .. 2100, fractional ok).
//
// Everything is a smooth (C1) deterministic function of time and place: monotone cubic
// (Fritsch–Carlson / PCHIP) curves through documented anchor values, multiplied by smooth
// spatial patterns (Gaussians, logistic bands). No randomness: year-to-year weather noise
// belongs to the weather module.
//
// Baselines
// - Temperatures are anomalies (°C) relative to 1970–2000, the period of the WorldClim
//   normals in public/assets/climate/normals.bin.gz, so `normal + regionalDT` is the climate
//   of a given year. globalDTPreindustrial() gives the same curve relative to 1850–1900.
// - precipFactor() multiplies the 1970–2000 precipitation normals.
// - seaLevel() is metres relative to 1995–2014 (IPCC AR6 baseline ≈ "present").
// - Months are 0-based (0 = January), fractional allowed.
//
// Sources for the anchors (values are rounded readings of the published curves):
//   Kaufman D. et al. 2020, Holocene global mean surface temperature, a multi-method
//     reconstruction approach. Scientific Data 7:201 (Temp12k; ~+0.6..0.7 °C at 6.5 ka vs 19th c.).
//   Marcott S.A. et al. 2013, A reconstruction of regional and global temperature for the past
//     11,300 years. Science 339:1198 (Holocene shape; slow cooling from ~5 ka to the LIA).
//   PAGES 2k Consortium 2019, Consistent multidecadal variability in global temperature
//     reconstructions and simulations over the Common Era. Nature Geoscience 12:643.
//   Mann M.E. et al. 2009, Global signatures and dynamical origins of the Little Ice Age and
//     Medieval Climate Anomaly. Science 326:1256 (N Atlantic / Europe warm MCA, La Niña-like Pacific).
//   Büntgen U. et al. 2016, Cooling and societal change during the Late Antique Little Ice Age
//     from 536 to around 660 AD. Nature Geoscience 9:231.
//   Morice C.P. et al. 2021, HadCRUT5 (instrumental 1850–2024).
//   IPCC AR6 WG1 SPM 2021, Table SPM.1 (SSP2-4.5: +1.5 °C 2021–2040, +2.0 °C 2041–2060,
//     +2.7 °C 2081–2100 vs 1850–1900) and Table 9.9 / SPM (GMSL SSP2-4.5 0.56 m in 2100 vs 1995–2014);
//     AR6 Ch. 8 (precipitation change patterns, ~1–3 %/°C, wet high latitudes, drier subtropics);
//     AR6 Ch. 9 (Arctic September sea ice practically ice-free before 2050 in most scenarios).
//   deMenocal P. et al. 2000, Abrupt onset and termination of the African Humid Period.
//     Quaternary Science Reviews 19:347 (termination ~5.5 ka BP).
//   Shanahan T.M. et al. 2015, The time-transgressive termination of the African Humid Period.
//     Nature Geoscience 8:140 (north earlier, south later).
//   Tierney J.E. et al. 2017, Rainfall regimes of the Green Sahara. Science Advances 3:e1601503
//     (mid-Holocene Saharan rainfall of several hundred mm/yr).
//   Fleitmann D. et al. 2007, Holocene ITCZ and Indian monsoon dynamics recorded in stalagmites
//     from Oman and Yemen (Socotra). QSR 26:170 (Arabian humid period, gradual monsoon decline).
//   Weiss H. et al. 1993 (Science 261:995); Cullen H.M. et al. 2000 (Geology 28:379);
//     Staubwasser M. et al. 2003 (GRL 30:1425): the 4.2 ka BP aridification event.
//   Kaniewski D. et al. 2013, Environmental roots of the Late Bronze Age crisis. PLoS ONE 8:e71004.
//   Haug G.H. et al. 2003 (Science 299:1731); Kennett D.J. et al. 2012 (Science 338:788): Maya droughts.
//   Buckley B.M. et al. 2010, Climate as a contributing factor in the demise of Angkor. PNAS 107:6748.
//   Cook E.R. et al. 2004, Long-term aridity changes in the western United States. Science 306:1015.
//   Zheng J. et al. 2014 / Shen C. et al. 2007: late-Ming drought (1627–1643) in north China.
//   Schubert S.D. et al. 2004, On the cause of the 1930s Dust Bowl. Science 303:1855.
//   Nicholson S.E. 2013, The West African Sahel: a review of recent studies on the rainfall regime
//     and its interannual variability. ISRN Meteorology (wet 1950s, drought 1970s–80s, partial recovery).
//   Lambeck K. et al. 2014, Sea level and global ice volumes from the Last Glacial Maximum to the
//     Holocene. PNAS 111:15296 (ESL ~ -4 m at 7 ka, slow rise to ~2.5 ka, near-stable until ~1900).
//   Mitrovica J.X. & Milne G.A. 2002, On the origin of late Holocene sea-level highstands within
//     equatorial ocean basins. QSR 21:2179 (far-field mid-Holocene highstand of 1–2 m).
//   Peltier W.R. et al. 2015, ICE-6G_C (glacial isostatic adjustment: Fennoscandia, Laurentide).
//   Fetterer F. et al. 2017, NSIDC Sea Ice Index v3 (1981–2010 monthly extent climatology).
//   Notz D. & Stroeve J. 2016, Observed Arctic sea-ice loss directly follows anthropogenic CO2
//     emission. Science 354:747 (September sensitivity).
//   Kaufman D.S. et al. 2004, Holocene thermal maximum in the western Arctic. QSR 23:529
//     (Arctic HTM ~ +1.6 °C summer).
//   Berger A. & Loutre M.F. 1991, Insolation values for the climate of the last 10 million years.
//     QSR 10:297 (precession: perihelion in NH summer at ~11 ka -> stronger NH summer insolation).

// ------------------------------------------------------------------ math helpers

/** Monotone cubic (PCHIP, Fritsch–Carlson / Fritsch–Butland slopes). Flat outside the range. */
export function monotoneCubic(points) {
  const n = points.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), ms = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = points[i][0]; ys[i] = points[i][1]; }
  const h = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  // ends: zero slope keeps the flat extrapolation C1
  ms[0] = 0; ms[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { ms[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    ms[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  const f = x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const hh = h[lo], t = (x - xs[lo]) / hh, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * hh * ms[lo]
      + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * hh * ms[lo + 1];
  };
  f.points = points;
  return f;
}

const DEG = Math.PI / 180;
const smoothstep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrapLon = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d; };
const gauss = (lat, lon, la, lo, sla, slo) => {
  const u = (lat - la) / sla, v = wrapLon(lon - lo) / slo;
  const q = u * u + v * v;
  return q > 25 ? 0 : Math.exp(-q);
};
const logistic = z => 1 / (1 + Math.exp(-4 * z));
/** Smooth longitude band [a, b] with edge width w (degrees). */
const lonBand = (lon, a, b, w) => logistic(wrapLon(lon - a) / w) * logistic(wrapLon(b - lon) / w);
const softplus = (x, k) => (x * k > 30 ? x : Math.log1p(Math.exp(k * x)) / k);
const softClamp = (x, lo, hi, k = 4) => {
  const y = lo + softplus(x - lo, k);
  return hi - softplus(hi - y, k);
};
/** Great-circle distance in degrees. */
function arcDeg(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * DEG / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin((lo2 - lo1) * DEG / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) / DEG;
}

export const YEAR_MIN = -4999;
export const YEAR_MAX = 2100;

// ------------------------------------------------------------------ global temperature
// Anomaly vs 1850–1900 (°C). Holocene: Kaufman 2020 / Marcott 2013; Common Era: PAGES2k 2019
// (+ LALIA 536–660, MCA ~950–1250, LIA ~1450–1850 with Maunder and Dalton/Tambora minima);
// 1850–2023: HadCRUT5 decadal shape; 2030–2100: IPCC AR6 SSP2-4.5 central estimate.
const GLOBAL_T = monotoneCubic([
  [-5000, 0.60], [-4500, 0.66], [-4000, 0.64], [-3500, 0.58], [-3000, 0.52], [-2500, 0.45],
  [-2000, 0.38], [-1500, 0.32], [-1000, 0.26], [-500, 0.20], [1, 0.15], [300, 0.12],
  [500, 0.06], [600, -0.05], [700, 0.02], [900, 0.06], [1000, 0.08], [1100, 0.07],
  [1250, 0.0], [1350, -0.08], [1450, -0.12], [1550, -0.15], [1640, -0.28], [1700, -0.25],
  [1750, -0.15], [1815, -0.30], [1830, -0.20], [1860, -0.03], [1880, 0.0], [1905, -0.08],
  [1925, 0.05], [1945, 0.22], [1960, 0.18], [1975, 0.27], [1985, 0.42], [1995, 0.62],
  [2005, 0.88], [2015, 1.10], [2023, 1.30], [2030, 1.50], [2040, 1.75], [2050, 2.00],
  [2060, 2.20], [2070, 2.40], [2080, 2.55], [2090, 2.70], [2100, 2.80],
]);
const meanOver = (f, y0, y1) => { let s = 0, n = 0; for (let y = y0; y <= y1; y += 0.25) { s += f(y); n++; } return s / n; };
/** Mean of the curve over 1970–2000 (vs 1850–1900): the offset between the two baselines. */
export const BASELINE_1970_2000 = meanOver(GLOBAL_T, 1970, 2000);
const PREIND = meanOver(GLOBAL_T, 1850, 1900);

/** Global mean surface temperature anomaly (°C) relative to 1970–2000. */
export function globalDT(year) { return GLOBAL_T(year) - BASELINE_1970_2000; }
/** Same, relative to 1850–1900 (pre-industrial). */
export function globalDTPreindustrial(year) { return GLOBAL_T(year) - PREIND; }

// ------------------------------------------------------------------ polar amplification
// Warming/cooling scales with latitude: Arctic ~3x global (AR6: >2x, observed 3–4x since 1979),
// Antarctic weaker, tropics ~0.6x. Normalised so that the area-weighted mean is exactly 1.
const ampRaw = lat => { const s = Math.sin(Math.abs(lat) * DEG) ** 4; return 0.55 + (lat >= 0 ? 2.4 : 1.2) * s; };
const AMP_NORM = (() => {
  let s = 0, w = 0;
  for (let i = 0; i < 1800; i++) { const lat = -90 + (i + 0.5) * 0.1, c = Math.cos(lat * DEG); s += ampRaw(lat) * c; w += c; }
  return s / w;
})();
/** Polar amplification factor (area mean = 1). */
export function polarAmplification(lat) { return ampRaw(lat) / AMP_NORM; }

// ------------------------------------------------------------------ orbital seasonality
// Precession: perihelion near NH summer at ~11 ka BP -> more July insolation (all latitudes,
// strongest in NH high-latitude summer), less in January; zero at present. Annual mean 0.
const orbitalStrength = year => {
  const bp = 1950 - year; // years before 1950
  return Math.max(0, (1 + Math.cos(2 * Math.PI * (bp - 11000) / 22000)) / 2);
};
const orbitalAmp = lat => 0.4 + 1.4 * Math.max(0, Math.sin(lat * DEG)) ** 2;
/** Seasonal orbital temperature term (°C), month 0..11 (fractional ok). */
export function orbitalSeasonalDT(year, lat, month) {
  return orbitalStrength(year) * orbitalAmp(lat) * Math.cos(2 * Math.PI * (month + 0.5 - 6.5) / 12);
}

// ------------------------------------------------------------------ regional temperature anomalies
// Additive °C at the pattern maximum (on top of globalDT * amplification).
const TEMP_ANOMALIES = [
  { // Europe / North Atlantic: Roman Warm Period, Medieval Climate Anomaly, Little Ice Age (Mann 2009)
    id: 'north_atlantic', patterns: [[58, 0, 16, 55]],
    series: monotoneCubic([[-500, 0], [1, 0.25], [250, 0.2], [400, 0], [800, 0], [950, 0.3], [1050, 0.45], [1150, 0.4],
      [1250, 0.2], [1350, -0.05], [1450, -0.2], [1550, -0.25], [1650, -0.45], [1700, -0.35], [1800, -0.35], [1850, -0.1], [1900, 0]]),
  },
  { // Late Antique Little Ice Age 536–660 (Büntgen 2016): Alps and Altai
    id: 'lalia', patterns: [[47, 10, 12, 30], [50, 87, 10, 30]],
    series: monotoneCubic([[480, 0], [530, -0.05], [560, -0.6], [620, -0.7], [680, -0.3], [760, 0]]),
  },
  { // La Niña-like eastern tropical Pacific during the MCA (Mann 2009)
    id: 'pacific_mca', patterns: [[0, -110, 10, 35]],
    series: monotoneCubic([[800, 0], [950, -0.3], [1200, -0.3], [1350, 0]]),
  },
];

function patternAt(patterns, lat, lon) {
  let s = 0;
  for (const [la, lo, sla, slo] of patterns) s += gauss(lat, lon, la, lo, sla, slo);
  return s;
}

/**
 * Regional temperature anomaly (°C) vs 1970–2000 at a place.
 * month (0..11, optional): adds the orbital seasonal term; omit for the annual mean.
 */
export function regionalDT(year, lat, lon, month) {
  let dt = globalDT(year) * polarAmplification(lat);
  for (const a of TEMP_ANOMALIES) {
    const v = a.series(year);
    if (v !== 0) dt += v * patternAt(a.patterns, lat, lon);
  }
  if (month !== undefined && month !== null) dt += orbitalSeasonalDT(year, lat, month);
  return dt;
}

// ------------------------------------------------------------------ precipitation
// African Humid Period ("green Sahara"): strength 1 until the end window, then a smooth decline.
// End is time-transgressive (Shanahan 2015): ~3600 BC at 30°N, ~3300 BC at 20°N, ~3000 BC at 10°N,
// matching the ~5.5–5 ka BP termination of deMenocal 2000.
export function humidPeriodStrength(year, lat) {
  const l = Math.max(5, Math.min(35, lat));
  const centre = -3300 - 30 * (l - 20);
  return 1 - smoothstep((year - (centre - 450)) / 900);
}
// Fractional precipitation increase at full AHP strength (factor = 1 + S * w).
function ahpWeight(lat, lon) {
  if (lat < -15 || lat > 38) return 0;
  return lonBand(lon, -20, 36, 6) * (3.8 * Math.exp(-(((lat - 21) / 6.5) ** 2)) + 0.5 * Math.exp(-(((lat - 12) / 4) ** 2)))
    + lonBand(lon, 34, 60, 5) * 2.0 * Math.exp(-(((lat - 21) / 6) ** 2))       // Arabian humid period
    + lonBand(lon, 62, 78, 5) * 1.0 * Math.exp(-(((lat - 26) / 5) ** 2))       // Thar lakes
    + lonBand(lon, 30, 52, 5) * 0.35 * Math.exp(-(((lat - 3) / 8) ** 2));      // East African lakes high-stands
}
// Additive monsoon rain at full AHP strength, mm/yr (Tierney 2017: hundreds of mm in the Sahara).
function ahpAddAnnual(lat, lon) {
  if (lat < 0 || lat > 38) return 0;
  return lonBand(lon, -20, 36, 6) * 380 * Math.exp(-(((lat - 19) / 6) ** 2))
    + lonBand(lon, 34, 60, 5) * 200 * Math.exp(-(((lat - 20) / 5.5) ** 2))
    + lonBand(lon, 62, 78, 5) * 150 * Math.exp(-(((lat - 26) / 5) ** 2));
}
// share of the additive rain per month (West African / Arabian summer monsoon, JJAS)
const MONSOON_SHAPE = [0, 0, 0, 0.01, 0.04, 0.11, 0.25, 0.32, 0.2, 0.06, 0.01, 0];

const PRECIP_ANOMALIES = [
  { // stronger mid-Holocene Indian summer monsoon, gradual decline (Fleitmann 2007, Dixit 2014)
    id: 'indian_monsoon', patterns: [[24, 78, 8, 14]],
    series: monotoneCubic([[-5000, 0.25], [-3000, 0.18], [-2300, 0.08], [-2000, 0], [-1500, -0.02], [-1000, 0]]),
  },
  { // 4.2 ka BP event: Mesopotamia / Levant / Iran, Indus, Ethiopian highlands (Nile floods)
    id: 'event_4_2ka', patterns: [[33, 45, 7, 18], [27, 70, 6, 10], [10, 37, 6, 8]],
    series: monotoneCubic([[-2500, 0], [-2280, -0.1], [-2200, -0.3], [-2100, -0.3], [-1950, -0.05], [-1850, 0]]),
  },
  { // Late Bronze Age drought, eastern Mediterranean (Kaniewski 2013)
    id: 'late_bronze_age', patterns: [[34, 35, 6, 12]],
    series: monotoneCubic([[-1400, 0], [-1250, -0.12], [-1180, -0.22], [-1050, -0.15], [-900, 0]]),
  },
  { // Terminal Classic Maya droughts (Haug 2003, Kennett 2012)
    id: 'maya', patterns: [[18.5, -89.5, 4, 6]],
    series: monotoneCubic([[650, 0], [760, -0.1], [820, -0.25], [910, -0.3], [1020, -0.2], [1100, 0]]),
  },
  { // medieval and 16th-century megadroughts, western North America (Cook 2004, Stahle 2000)
    id: 'sw_megadrought', patterns: [[37, -110, 7, 12]],
    series: monotoneCubic([[750, 0], [900, -0.1], [1150, -0.18], [1280, -0.15], [1350, -0.05], [1450, 0],
      [1540, 0], [1575, -0.15], [1600, 0]]),
  },
  { // Angkor droughts of the 14th–15th centuries (Buckley 2010)
    id: 'angkor', patterns: [[13, 104, 5, 8]],
    series: monotoneCubic([[1300, 0], [1345, -0.15], [1370, -0.12], [1405, -0.2], [1430, -0.1], [1480, 0]]),
  },
  { // late-Ming drought 1627–1643, north China (Shen 2007, Zheng 2014)
    id: 'ming_drought', patterns: [[37, 113, 6, 10]],
    series: monotoneCubic([[1600, 0], [1627, -0.1], [1640, -0.3], [1650, -0.1], [1665, 0]]),
  },
  { // Dust Bowl (Schubert 2004)
    id: 'dust_bowl', patterns: [[38, -100, 5, 10]],
    series: monotoneCubic([[1925, 0], [1934, -0.25], [1938, -0.15], [1945, 0]]),
  },
  { // Sahel relative to the 1970–2000 normals: wet 1950s, drought 1970s–80s, partial recovery (Nicholson 2013)
    id: 'sahel', patterns: [[14, 0, 4, 25]],
    series: monotoneCubic([[1800, 0.1], [1900, 0.15], [1950, 0.25], [1965, 0.12], [1984, -0.12], [2000, 0], [2020, 0.05], [2100, 0.05]]),
  },
];

// Future hydrological change per °C of warming above 1970–2000 (AR6 Ch. 8 patterns).
function futurePattern(lat, lon) {
  const a = Math.abs(lat);
  return 0.05 * logistic((a - 50) / 5)
    + 0.02 * Math.exp(-((lat / 10) ** 2))
    - 0.03 * Math.exp(-(((a - 30) / 7) ** 2))
    - 0.06 * gauss(lat, lon, 38, 18, 7, 22)    // Mediterranean
    - 0.04 * gauss(lat, lon, 33, -110, 6, 12)  // SW North America / Mexico
    - 0.04 * gauss(lat, lon, -30, 22, 6, 10)   // southern Africa
    - 0.04 * gauss(lat, lon, -32, 118, 5, 10); // SW Australia
}
const futureAmount = year => smoothstep((year - 1950) / 50) * Math.max(0, globalDT(year));

const PF_MIN = 0.2;
const pfFromFrac = frac => PF_MIN + softplus(1 + frac - PF_MIN, 10);

/**
 * Multiplicative precipitation factor (1 = 1970–2000 normals) for a year and place.
 * Includes the African Humid Period (green Sahara), mid-Holocene monsoons, documented
 * megadroughts and the SSP2-4.5 hydrological pattern after 1950. Always >= 0.2.
 */
export function precipFactor(year, lat, lon) {
  let frac = humidPeriodStrength(year, lat) * ahpWeight(lat, lon);
  for (const a of PRECIP_ANOMALIES) {
    const v = a.series(year);
    if (v !== 0) frac += v * patternAt(a.patterns, lat, lon);
  }
  const fa = futureAmount(year);
  if (fa > 0) frac += fa * futurePattern(lat, lon);
  return pfFromFrac(frac);
}

/**
 * Additive monsoon rain (mm/month) of the African / Arabian humid period, for a month 0..11.
 * A dry desert normal times any factor stays dry, so the green Sahara needs this term.
 */
export function precipAddMm(year, lat, lon, month) {
  const s = humidPeriodStrength(year, lat);
  if (s <= 0) return 0;
  const add = ahpAddAnnual(lat, lon);
  if (add <= 0) return 0;
  const m = ((Math.floor(month) % 12) + 12) % 12, f = month - Math.floor(month);
  const shape = MONSOON_SHAPE[m] * (1 - f) + MONSOON_SHAPE[(m + 1) % 12] * f;
  return s * add * shape;
}

/** Convenience: paleo-adjusted monthly precipitation (mm/month). */
export function adjustPrecip(baseMm, year, lat, lon, month) {
  return baseMm * precipFactor(year, lat, lon) + precipAddMm(year, lat, lon, month);
}
/** Convenience: paleo-adjusted temperature (°C) for a month. */
export function adjustTemp(baseC, year, lat, lon, month) {
  return baseC + regionalDT(year, lat, lon, month);
}

// ------------------------------------------------------------------ sea level
// Global mean (eustatic) sea level, m vs 1995–2014. Lambeck 2014 (Holocene), ~0.2 m rise
// 1901–2018 (AR6), SSP2-4.5 median 0.20 m (2050) and 0.56 m (2100).
const ESL = monotoneCubic([
  [-5000, -4.2], [-4500, -3.6], [-4000, -3.0], [-3500, -2.4], [-3000, -1.9], [-2500, -1.45],
  [-2000, -1.1], [-1500, -0.8], [-1000, -0.55], [-500, -0.38], [1, -0.27], [500, -0.23],
  [1000, -0.21], [1500, -0.205], [1800, -0.2], [1850, -0.195], [1900, -0.17], [1950, -0.11],
  [1990, -0.03], [2005, 0.0], [2018, 0.045], [2025, 0.075], [2050, 0.20], [2075, 0.36], [2100, 0.56],
]);
/** Global mean sea level (m) relative to 1995–2014. */
export function seaLevel(year) { return ESL(year); }

// Far-field (equatorial ocean) mid-Holocene highstand: correction to ESL (Mitrovica & Milne 2002).
const FARFIELD = monotoneCubic([[-5000, 2.7], [-4000, 3.6], [-3000, 3.1], [-2000, 2.1], [-1000, 1.05], [1, 0.47],
  [1000, 0.26], [1500, 0.1], [1900, 0], [2100, 0]]);
// Glacial isostatic adjustment: remaining uplift since `year` (m) at the centre of former ice
// sheets (ICE-6G-like magnitudes), exponential relaxation tau = 5500 yr, plus collapsing forebulges.
const GIA = [
  // lat, lon, sigma (deg), uplift since 5000 BC (m), bulge radius, bulge width, bulge amplitude (m)
  [63.0, 19.5, 4.5, 100, 11, 4, -7],    // Fennoscandia (Gulf of Bothnia; Litorina shoreline)
  [60.5, -86, 9, 140, 25, 8, -8],       // Laurentide (Hudson Bay; US mid-Atlantic subsidence)
  [56.8, -4.5, 2.5, 8, 0, 0, 0],        // Scotland
  [78, 25, 6, 40, 0, 0, 0],             // Barents Sea / Svalbard
];
const TAU = 5500, E_NOW = Math.exp(-(2005 + 5000) / TAU);
const giaTime = year => (Math.exp(-(year + 5000) / TAU) - E_NOW) / (1 - E_NOW);

/**
 * Relative sea level (m vs 1995–2014) at a place: eustatic + far-field highstand + GIA.
 * Positive = the sea stood higher against the land than today (e.g. ~+95 m in the Gulf of
 * Bothnia at 5000 BC, so the Baltic coast was far inland).
 */
export function relativeSeaLevel(year, lat, lon) {
  let rsl = ESL(year) + FARFIELD(year) * Math.exp(-((lat / 35) ** 4));
  const g = giaTime(year);
  for (const [la, lo, sig, u0, br, bw, ba] of GIA) {
    const d = arcDeg(lat, lon, la, lo);
    rsl += g * u0 * Math.exp(-((d / sig) ** 2));
    if (ba) rsl += g * ba * Math.exp(-(((d - br) / bw) ** 2));
  }
  return rsl;
}

// ------------------------------------------------------------------ sea ice
// NSIDC Sea Ice Index 1981–2010 monthly mean extent, million km² (rounded).
const ICE_BASE_N = [14.85, 15.72, 15.85, 15.28, 13.95, 12.37, 10.04, 7.62, 6.53, 8.67, 10.93, 13.10];
const ICE_BASE_S = [5.0, 3.1, 4.4, 7.4, 10.4, 13.3, 15.8, 17.6, 18.5, 18.2, 16.0, 11.2];
const POLAR_LONS = [-150, -90, -30, 30, 90, 150];

function periodicMonthly(arr, month) {
  const u = month - 0.0; // integer month = that month's value
  const m1 = ((Math.floor(u) % 12) + 12) % 12, t = u - Math.floor(u);
  const m0 = (m1 + 11) % 12, m2 = (m1 + 1) % 12, m3 = (m1 + 2) % 12;
  const p0 = arr[m0], p1 = arr[m1], p2 = arr[m2], p3 = arr[m3], t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const hemiSign = h => (h === 'S' || h === 's' || h === 'south' || h === 'SH' || h === -1 ? -1 : 1);

/**
 * Sea-ice extent (million km²) for a year, month (0..11, fractional ok) and hemisphere
 * ('N' | 'S', also 'north'/'south', +1/-1). Driven by the polar regional temperature anomaly
 * of that month (incl. the orbital seasonal term); September Arctic ice ~0.9 M km² per °C of
 * Arctic warming (Notz & Stroeve 2016 / AR6), winter much less sensitive. Soft-clamped.
 */
export function seaIceExtent(year, month, hemisphere = 'N') {
  const sgn = hemiSign(hemisphere);
  let dT = 0;
  for (const lon of POLAR_LONS) dT += regionalDT(year, 75 * sgn, lon, month);
  dT /= POLAR_LONS.length;
  if (sgn > 0) {
    const sens = 0.35 + 0.55 * (1 + Math.cos(2 * Math.PI * (month - 8) / 12)) / 2;
    return softClamp(periodicMonthly(ICE_BASE_N, month) - sens * dT, 0.3, 18);
  }
  const sens = 0.5 + 0.5 * (1 + Math.cos(2 * Math.PI * (month - 1.5) / 12)) / 2;
  return softClamp(periodicMonthly(ICE_BASE_S, month) - sens * dT, 1.0, 22);
}

/**
 * Approximate mean equatorward latitude of the sea-ice edge (degrees, negative in the south),
 * from the extent treated as a polar cap (Arctic: ice on ~62 % of the cap area; Antarctic:
 * cap = 14 M km² of continent + ice).
 */
export function seaIceEdgeLat(year, month, hemisphere = 'N') {
  const sgn = hemiSign(hemisphere);
  const e = seaIceExtent(year, month, hemisphere);
  const cap = sgn > 0 ? e / 0.62 : 14 + e;
  const half = 2 * Math.PI * 6371 * 6371 / 1e6; // hemisphere area, million km²
  return sgn * Math.asin(Math.max(-1, Math.min(1, 1 - cap / half))) / DEG;
}

// ------------------------------------------------------------------ whole-grid fields (SIM grid)
// Patterns are cached per SIM cell on first use, so a field update is a few multiply-adds per
// cell and allocates nothing.
const SW = 720, SH = 360, SN = SW * SH;
const cellLat = y => 90 - (y + 0.5) * 0.5;
const cellLon = x => -180 + (x + 0.5) * 0.5;
let CACHE = null;
function sparsePattern(fn) {
  const idx = [], w = [];
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const v = fn(cellLat(y), cellLon(x));
    if (Math.abs(v) > 1e-4) { idx.push(y * SW + x); w.push(v); }
  }
  return { idx: Int32Array.from(idx), w: Float32Array.from(w) };
}
function cache() {
  if (CACHE) return CACHE;
  const amp = new Float32Array(SH), orb = new Float32Array(SH);
  for (let y = 0; y < SH; y++) { amp[y] = polarAmplification(cellLat(y)); orb[y] = orbitalAmp(cellLat(y)); }
  CACHE = {
    amp, orb,
    temp: TEMP_ANOMALIES.map(a => ({ series: a.series, ...sparsePattern((la, lo) => patternAt(a.patterns, la, lo)) })),
    prec: PRECIP_ANOMALIES.map(a => ({ series: a.series, ...sparsePattern((la, lo) => patternAt(a.patterns, la, lo)) })),
    ahp: sparsePattern(ahpWeight),
    ahpAdd: sparsePattern(ahpAddAnnual),
    future: Float32Array.from({ length: SN }, (_, i) => futurePattern(cellLat((i / SW) | 0), cellLon(i % SW))),
    rowS: new Float32Array(SH),
    frac: new Float32Array(SN),
  };
  return CACHE;
}

/**
 * Fill a Float32Array(720*360) with regionalDT(year, lat, lon, month) at SIM cell centres.
 * month may be undefined/null for the annual mean.
 */
export function fillRegionalDT(year, month, out) {
  const c = cache();
  const g = globalDT(year);
  const hasM = month !== undefined && month !== null;
  const orbit = hasM ? orbitalStrength(year) * Math.cos(2 * Math.PI * (month + 0.5 - 6.5) / 12) : 0;
  for (let y = 0; y < SH; y++) {
    const v = g * c.amp[y] + orbit * c.orb[y], row = y * SW;
    for (let x = 0; x < SW; x++) out[row + x] = v;
  }
  for (const a of c.temp) {
    const v = a.series(year);
    if (v === 0) continue;
    const { idx, w } = a;
    for (let k = 0; k < idx.length; k++) out[idx[k]] += v * w[k];
  }
  return out;
}

/**
 * Fill precipitation adjustment fields at SIM cell centres:
 * factorOut[i] = precipFactor(year, lat, lon); addOut[i] = precipAddMm(year, lat, lon, month)
 * (addOut optional; month needed only for it).
 */
export function fillPrecip(year, month, factorOut, addOut) {
  const c = cache();
  const frac = c.frac;
  frac.fill(0);
  for (let y = 0; y < SH; y++) c.rowS[y] = humidPeriodStrength(year, cellLat(y));
  { const { idx, w } = c.ahp; for (let k = 0; k < idx.length; k++) frac[idx[k]] += c.rowS[(idx[k] / SW) | 0] * w[k]; }
  for (const a of c.prec) {
    const v = a.series(year);
    if (v === 0) continue;
    const { idx, w } = a;
    for (let k = 0; k < idx.length; k++) frac[idx[k]] += v * w[k];
  }
  const fa = futureAmount(year);
  if (fa > 0) for (let i = 0; i < SN; i++) frac[i] += fa * c.future[i];
  if (factorOut) for (let i = 0; i < SN; i++) factorOut[i] = pfFromFrac(frac[i]);
  if (addOut) {
    addOut.fill(0);
    const m = ((Math.floor(month) % 12) + 12) % 12, f = month - Math.floor(month);
    const shape = MONSOON_SHAPE[m] * (1 - f) + MONSOON_SHAPE[(m + 1) % 12] * f;
    if (shape > 0) {
      const { idx, w } = c.ahpAdd;
      for (let k = 0; k < idx.length; k++) addOut[idx[k]] = c.rowS[(idx[k] / SW) | 0] * w[k] * shape;
    }
  }
}

/** Compact snapshot for UI / logs. */
export function paleoSummary(year, out = {}) {
  out.year = year;
  out.globalDT = globalDT(year);
  out.globalDTPreindustrial = globalDTPreindustrial(year);
  out.seaLevel = seaLevel(year);
  out.seaIceMarchN = seaIceExtent(year, 2, 'N');
  out.seaIceSeptN = seaIceExtent(year, 8, 'N');
  out.seaIceSeptS = seaIceExtent(year, 8, 'S');
  out.greenSahara = humidPeriodStrength(year, 20);
  return out;
}
