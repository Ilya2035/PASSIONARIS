// Climate integration: monthly normals + paleoclimate (5000 BC → 2100) → the SIM-grid data layer the globe shows.
// Layer RGBA (720x360): R temperature of the current month (-40..+40 °C), G precipitation (sqrt, 0..400 mm),
// B hazard level (filled by the hazards integration), A "greening" vs today (128 = as today; wetter → greener).
//
// The climate of the era (all 12 months of the decade on show) also feeds the «Климат» (Köppen) and «Плодородие»
// map modes: src/sim/climate/era.js reduces it to statistics in a half-float array texture (built at load, rebuilt
// in the background when the decade changes — at once while the clock stands), src/sim/climate/waters.js adds the
// fresh-water raster. The shown month's paleo dT rides along for the «Погода» anomaly (uploaded in that mode only).
import { createEraClimate, LAYERS } from '../../sim/climate/era.js';
import { classifyStats, lapseDT, KOPPEN } from '../../sim/climate/koppen.js';
import { fertility, fertilityStats, fertTier } from '../../sim/climate/fertility.js';
import { buildWaterRaster, waterAt, WATER_W, WATER_H } from '../../sim/climate/waters.js';
const W = 720, H = 360, N = W * H;
const ERA_BUDGET_MS = 5;   // per frame while the clock runs (one step ~2–4 ms)

// normals: already loaded (the weather starts from them early); deferEra: the caller builds the first era
// statistics itself (tick(false)), e.g. while a worker spins up
export async function createClimate({ climatology, paleo, globe, clock, cal, normals: given = null, deferEra = false }) {
  const normals = given || await climatology.loadNormals(climatology.NORMALS_URL);
  const layer = new Uint8Array(N * 4);
  const dT = new Float32Array(N), pF = new Float32Array(N).fill(1);
  const addMm = new Float32Array(N), addYear = new Float32Array(N), tmp = new Float32Array(N);
  const eff = new Float32Array(N).fill(1);   // effective annual precipitation factor (factor + humid-period rain)
  const effA = new Uint8Array(N).fill(128);  // its encoding for the layer's A channel (changes with the decade only)
  const baseYear = new Float32Array(N);
  for (let m = 0; m < 12; m++) for (let i = 0; i < N; i++) baseYear[i] += normals.prec[m * N + i];
  const lat = new Float32Array(H), lon = new Float32Array(W);
  for (let y = 0; y < H; y++) lat[y] = 90 - (y + 0.5) * 0.5;
  for (let x = 0; x < W; x++) lon[x] = -180 + (x + 0.5) * 0.5;

  let paleoDecade = NaN, month = -1, globalDT = 0, paleoYear = 0;
  let coolRows = null;   // optional Float32Array(H): volcanic cooling per row, degC (src/game/world/aerosols.js)
  // whole-grid fills (~4 ms each) instead of per-cell calls; the additive humid-period rain is what turns the
  // Sahara green — a factor alone over ~1 mm/month stays a desert
  function refreshPaleo(year) {
    const decade = Math.floor(year / 10);
    if (decade === paleoDecade) return false;
    paleoDecade = decade;
    const yr = paleoYear = decade * 10 + 5;
    globalDT = paleo.globalDT(yr);
    if (paleo.fillPrecip) {
      addYear.fill(0);
      // the factor does not depend on the month: computed once (its exp/log per cell was ~90 % of a decade change)
      for (let m = 0; m < 12; m++) { paleo.fillPrecip(yr, m, m === 0 ? pF : null, tmp); for (let i = 0; i < N; i++) addYear[i] += tmp[i]; }
      for (let i = 0; i < N; i++) {
        const b = Math.max(baseYear[i], 10);
        eff[i] = addYear[i] > 0 ? Math.max(pF[i], Math.min(25, (b * pF[i] + addYear[i]) / b)) : pF[i];
      }
    } else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; pF[i] = eff[i] = paleo.precipFactor(yr, lat[y], lon[x]); }
    }
    // the A channel per decade: its log2 per cell was most of a monthly rebuild
    for (let i = 0; i < N; i++) effA[i] = Math.max(0, Math.min(255, Math.round(128 + Math.log2(Math.max(0.05, eff[i])) * 64)));
    return true;
  }
  function refreshMonth(m) {
    if (paleo.fillRegionalDT) paleo.fillRegionalDT(paleoYear, m, dT);   // annual anomaly + orbital seasonal term
    else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dT[y * W + x] = paleo.regionalDT(paleoYear, lat[y], lon[x]);
    if (paleo.fillPrecip) paleo.fillPrecip(paleoYear, m, null, addMm);   // pF: set with the decade (refreshPaleo)
  }

  // ---- era statistics (Köppen, fertility) and the fresh-water raster
  const era = createEraClimate({ normals, paleo });
  let eraShown = -1, monthDirty = true, modeId = 'terrain', water = null;
  try {
    const d = globe.data;
    water = buildWaterRaster({ rivers: d.rivers, ranks: d.riverRank, cells: d.cells, W: d.W, H: d.H });
    globe.setWaterRaster(water, WATER_W, WATER_H);
  } catch (e) { console.warn('water raster', e); water = null; }
  // the monthly paleo dT (layer 3 .w): only the weather map reads it, so it is uploaded in that mode only
  function pushMonth() {
    if (!era.ready) return;
    era.setMonthDT(dT);
    globe.setClimateLayers(era.data, W, H, LAYERS, 3);
    monthDirty = false;
  }
  function eraTick(running) {
    if (era.busy) era.work(running ? ERA_BUDGET_MS : Infinity);
    if (era.ready && era.version !== eraShown) {
      eraShown = era.version;
      era.setMonthDT(dT);
      globe.setClimateLayers(era.data, W, H, LAYERS);
      monthDirty = false;
    }
  }

  function rebuild(m) {
    refreshMonth(m);
    monthDirty = true;
    if (modeId === 'weather') pushMonth();
    // ~10x faster than per-cell Math.round/min/max/log2 with the same bytes: x + 0.5 stored into a Uint8Array
    // truncates (= Math.round for x > 0), NaN stores 0, and the A channel comes from the decade (effA)
    const off = m * N, tavg = normals.tavg, prec = normals.prec;
    for (let y = 0; y < H; y++) {
      const cool = coolRows ? coolRows[y] : 0, end = (y + 1) * W;
      for (let i = y * W; i < end; i++) {
        const T = tavg[off + i] * 0.1 + dT[i] + cool;
        let P = prec[off + i] * pF[i] + addMm[i];
        if (P > 400) P = 400;
        const a = (T + 40) / 80 * 255 + 0.5, b = Math.sqrt(P / 400) * 255 + 0.5, o = i * 4;
        layer[o] = a <= 0 ? 0 : a >= 255 ? 255 : a;
        layer[o + 1] = b <= 0 ? 0 : b >= 255 ? 255 : b;
        // keep B (hazards) untouched
        layer[o + 3] = effA[i];
      }
    }
    globe.setSimLayer(layer, W, H);
  }

  function update(force = false) {
    const d = cal.toDate(clock.t);
    const changed = refreshPaleo(d.year);
    if (changed || force || d.month - 1 !== month) { month = d.month - 1; rebuild(month); }
    era.request(paleoYear);
  }
  update(true);
  if (!deferEra) eraTick(false);   // the first era is built while loading
  clock.onMonth(() => update());
  clock.onState?.(() => update());

  const cellOf = (la, lo) => Math.min(H - 1, Math.max(0, Math.floor((90 - la) / 0.5))) * W + Math.min(W - 1, Math.max(0, Math.floor((lo + 180) / 0.5)));

  // ---- point readouts of the era maps (the shader's rules: bilinear statistics + lapse rate for the map height)
  const st = {}, fo = {}, fsx = {};
  // slope (m/m) from the map heights one texel around (~5 km at the equator)
  function slopeAt(la, lo) {
    const d = globe.data;
    if (!d?.height) return 0;
    const x = ((Math.floor((lo + 180) / 360 * d.W) % d.W) + d.W) % d.W, y = Math.min(d.H - 2, Math.max(1, Math.floor((90 - la) / 180 * d.H)));
    const h = (xx, yy) => Math.max(0, d.height[yy * d.W + ((xx % d.W) + d.W) % d.W]);
    const dx = 2 * 2 * Math.PI * 6371000 * Math.max(0.02, Math.cos(la * Math.PI / 180)) / d.W, dy = 2 * Math.PI * 6371000 / d.H;
    return Math.hypot((h(x + 1, y) - h(x - 1, y)) / dx, (h(x, y - 1) - h(x, y + 1)) / dy);
  }
  const levelRu = (v, words) => words[v < 0.25 ? 0 : v < 0.55 ? 1 : v < 0.85 ? 2 : 3];
  function eraRows(la, lo, h, detail) {
    if (!era.ready) return [];
    const s = era.statsAt(la, lo, st);
    const dTl = lapseDT(h, s.elev, s.tHot, la);
    const k = KOPPEN[classifyStats(s, dTl)];
    const irr = waterAt(water, la, lo);
    const slope = slopeAt(la, lo);
    const f = fertility(s, dTl, slope, Math.max(0, h), irr, fo);
    const rows = [
      ['Климат', `${k.code} — ${k.nameRu}`],
      ['Плодородие', `${fertTier(f).nameRu} земли · ${Math.round(f * 100)} из 100`],
    ];
    if (!detail) return rows;
    // the fertility mode explains itself: what helps and what holds the land back
    const { T, P } = era.monthsAt(la, lo);
    fertilityStats(T, P, la, fsx);
    rows.push(['Тепло для роста', levelRu(fo.heat, ['почти нет', 'мало', 'умеренно', 'вдоволь'])]);
    rows.push(['Влага', fsx.ratio > 2.6 && fo.water < 0.9 ? 'переувлажнение' : levelRu(s.water, ['засуха', 'мало', 'умеренно', 'вдоволь'])]);
    if (irr > 0.12) rows.push(['Реки и озёра', irr > 0.5 ? 'рядом: орошение, поймы' : 'неподалёку']);
    if (fo.terrain < 0.92) rows.push(['Рельеф', fo.terrain < 0.6 ? 'крутые склоны, высокогорье' : 'холмы и склоны']);
    if (s.soil < 0.85) rows.push(['Почвы', s.tCold >= 15 ? 'вымытые дождями' : 'мерзлота']);
    if (f < 0.6) {
      const lim = [[fo.heat, 'холод'], [fo.water, 'нехватка воды'], [fo.terrain, 'рельеф'], [s.soil, 'бедные почвы']].sort((a, b) => a[0] - b[0])[0];
      rows.push(['Главная помеха', lim[1]]);
    }
    return rows;
  }

  return {
    normals, layer, era,
    get globalDT() { return globalDT; },
    /** Per frame: advances a pending era rebuild (budgeted while the clock runs) and uploads it when done. */
    tick(running) { eraTick(running); },
    /** The map mode on show: the weather map needs the monthly paleo dT on the GPU. */
    setMode(id) { modeId = id; if (id === 'weather' && monthDirty) pushMonth(); },
    /** «Климат» and «Плодородие» rows for a land point at height h (m); detail = the fertility breakdown. */
    eraRows,
    setHazardChannel(levels /* Uint8Array(N) 0..255 */) { for (let i = 0; i < N; i++) layer[i * 4 + 2] = levels[i]; globe.setSimLayer(layer, W, H); },
    // volcanic winter (aerosol layer): per-row cooling in degC added to the temperature layer, null = none
    // (only the temperature channel is rewritten: the paleo fields of the month stay as they are)
    setCooling(rows /* Float32Array(H) | null */) {
      coolRows = rows ? Float32Array.from(rows) : null;
      if (month < 0) return;
      const off = month * N, tavg = normals.tavg;
      for (let y = 0; y < H; y++) {
        const cool = coolRows ? coolRows[y] : 0, end = (y + 1) * W;
        for (let i = y * W; i < end; i++) {
          const a = (tavg[off + i] * 0.1 + dT[i] + cool + 40) / 80 * 255 + 0.5;   // as in rebuild()
          layer[i * 4] = a <= 0 ? 0 : a >= 255 ? 255 : a;
        }
      }
      globe.setSimLayer(layer, W, H);
    },
    describe(la, lo) {
      const c = cellOf(la, lo);
      const now = normals.tavg[month * N + c] * 0.1 + dT[c];
      const jan = normals.tavg[c] * 0.1 + dT[c], jul = normals.tavg[6 * N + c] * 0.1 + dT[c];
      const year = baseYear[c] * pF[c] + addYear[c];
      const f = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} °C`;
      return [
        ['Норма месяца', f(now)],
        ['Январь / июль', `${f(jan)} / ${f(jul)}`],
        ['Осадки за год', `${Math.round(year).toLocaleString('ru-RU')} мм`],
        ...(Math.abs(Math.log2(eff[c])) > 0.15 ? [[eff[c] > 1 ? 'Влажнее, чем сегодня' : 'Суше, чем сегодня', `×${eff[c].toFixed(1)}`]] : []),
      ];
    },
  };
}
