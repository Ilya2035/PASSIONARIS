// Aerosol integration: the ash / smoke / dust / sulphate field (src/sim/aerosols) stepped with the game clock →
// the globe's aerosol textures, sources from world events (eruptions and meteorites from the hazards, big
// wildfires and desert dust storms from the weather), the «Воздух» info rows, saves and the volcanic winter in
// the temperature layer.
//
// GPU layout (both 360x180 RGBA8, row 0 = 90N, column 0 = 180W, linear filtering, wrap in longitude):
//   uAero        R ash, G smoke, B dust, A sulphate: 255 * (1 - exp(-k * tau)), k = ENC_K = 0.9, 1.2, 1.0, 3.0
//                (decode: tau = -ln(1 - v) / k), mipmapped (the wide "tone" up close reads a coarse mip)
//   uAeroGround  R ashfall deposit 255 * (1 - exp(-0.9 * fall)), G volcanic cooling 25 per degC (0..255 = 0..-10.2 degC) (per row)
// uHasAero = 1 while anything is visible, uAeroLag = game days since the last step (the shader advects the
// lookup by the prevailing wind for that time, so the clouds glide between steps), uItcz = ITCZ shift (deg).
const ARID_MM = 250;   // annual precipitation below which a storm or a heat wave lifts desert dust
// main-thread budget of the field steps: at most ~40 ms of stepping per real second on average. A fast CPU keeps the
// ~30 steps a second; a slow one at a fast clock steps less often with longer steps (a plume lives ~6 game days,
// i.e. a few frames at a year per second, so nothing visible is lost)
const STEP_BUDGET = 0.04;

export function createAerosols({ mod, clock, globe, climate, mask, registry }) {
  const { AW, AH, AN } = mod;
  const sim = mod.createAerosolSim({ t: clock.t });
  const rgba = new Uint8Array(AN * 4), ground = new Uint8Array(AN * 4);
  const rain = new Uint8Array(AN);
  sim.rain = rain;
  let dirty = true, shown = false, runAt = -1e9, upAt = -1e9, rainT = -1e9, rainAt = -1e9, coolAt = -1e9, stepMs = 0;
  const u = globe.terrainMat.uniforms;

  // ---- sources
  function add(list) {
    for (const s of list) {
      if (Number.isFinite(sim.t) && s.t0 < sim.t) { const d = sim.t - s.t0; s.t0 += d; s.t1 += d; }
      sim.addSource(s);
    }
    if (list.length) dirty = true;
  }
  function onHazard(ev) {
    if (ev.type === 'eruption') add(mod.eruptionSources({ t: ev.t, lat: ev.lat, lon: ev.lon, vei: ev.vei ?? 2 }));
    else if (ev.type === 'meteorite') add(mod.impactSources({ t: ev.t, lat: ev.lat, lon: ev.lon, level: ev.level, kind: ev.kind }));
  }

  // desert cells (aerosol grid) from the climate normals: land with less than ARID_MM a year (built while loading)
  let arid = null;
  if (climate?.normals?.prec && mask) {
    arid = new Uint8Array(AN);
    const W = 720, N = 720 * 360, P = climate.normals.prec;
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      let land = 0, mm = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const c = (y * 2 + j) * W + x * 2 + i;
        if (mask[c] !== 2) continue;
        land++;
        for (let m = 0; m < 12; m++) mm += P[m * N + c];
      }
      arid[y * AW + x] = land >= 3 && mm / land < ARID_MM ? 1 : 0;
    }
  }
  function aridAt(lat, lon) {
    if (!arid) return false;
    const y = Math.min(AH - 1, Math.max(0, Math.floor(90 - lat))), x = ((Math.floor(lon + 180) % AW) + AW) % AW;
    return arid[y * AW + x] === 1;
  }
  // weather spells arrive as messages in weather.recent (newest last): take each one once
  const seen = new WeakSet();
  function pollWeather(recent) {
    for (let i = recent.length - 1; i >= 0; i--) {
      const e = recent[i];
      if (seen.has(e)) break;
      seen.add(e);
      if (e.type === 'wildfire') add(mod.fireSources({ t0: e.t0, t1: e.t1, lat: e.lat, lon: e.lon, severity: e.severity }));
      else if ((e.type === 'storm' && e.subtype !== 'tropical') || e.type === 'heatwave') {
        if (e.severity >= 2 && aridAt(e.lat, e.lon)) add(mod.dustStormSources({ t0: e.t0, t1: e.t1, lat: e.lat, lon: e.lon, severity: e.severity }));
      }
    }
  }

  // rain intensity on the aerosol grid from the weather layer (G >= 128 = precipitation), once a game day
  function refreshRain() {
    const tex = u.uWeather?.value?.image;
    if (!tex || tex.width !== 720 || !tex.data) { rain.fill(0); return; }
    const d = tex.data;
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      let s = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const g = d[(((y * 2 + j) * 720) + x * 2 + i) * 4 + 1]; if (g > 128) s += g - 128; }
      rain[y * AW + x] = Math.min(255, s * 0.5);
    }
  }

  // ---- volcanic winter → temperature layer (only when it changes noticeably: the layer stores ~0.3 degC steps)
  const coolRows = new Float32Array(360);
  let coolPushed = new Float32Array(360);
  function pushCooling(force) {
    if (!climate?.setCooling) return;
    let dmax = 0;
    for (let y = 0; y < 360; y++) {
      const c = sim.coolingAt(90 - (y + 0.5) * 0.5);
      coolRows[y] = c;
      dmax = Math.max(dmax, Math.abs(c - coolPushed[y]));
    }
    if (!force && dmax < 0.12) return;
    coolPushed = coolRows.slice();
    climate.setCooling(coolRows.some(v => v !== 0) ? coolRows : null);
  }

  function upload() {
    const vis = sim.visible;
    if (!vis && !shown) return;
    sim.encode(rgba, ground);
    globe.setAerosols(rgba, ground, AW, AH, vis);
    shown = vis;
  }

  // ---- saves (optional section: older saves load with a clear sky)
  registry?.register('aerosols', {
    optional: true,
    save: () => sim.serialize(),
    load: s => { sim.deserialize(s); if (!Number.isFinite(sim.t)) sim.t = clock.t; dirty = true; pushCooling(true); },
    onMissing: () => { sim.clear(); sim.t = clock.t; dirty = true; pushCooling(true); },
  });

  const fmtC = v => `−${Math.abs(v).toFixed(1)} °C`;
  return {
    sim,
    onHazard,
    update(dt, running, recent) {
      if (recent?.length) pollWeather(recent);
      const now = performance.now();
      // the field moves at most ~30 times a real second (less when its steps are costly, STEP_BUDGET); between
      // steps the shader glides the lookup
      if (now - runAt > Math.max(33, stepMs / STEP_BUDGET)) {
        runAt = now;
        // wet removal: rain from the weather layer, every other game day and at most twice a real second
        if (!sim.empty && Math.abs(clock.t - rainT) >= 2 && now - rainAt > 500) { rainT = clock.t; rainAt = now; refreshRain(); }
        if (sim.advanceTo(clock.t, { maxSteps: 2 })) {
          dirty = true;
          const c = performance.now() - now;
          stepMs += (c - stepMs) * 0.3;   // learned only from calls that stepped
        }
      }
      if (dirty && now - upAt > 50) { upAt = now; dirty = false; upload(); }
      if (shown) {
        const lag = (clock.renderT ?? clock.t) - sim.t;
        u.uAeroLag.value = Math.max(0, Math.min(2, lag));
        u.uItcz.value = mod.itczOfMonth(mod.monthOfT(clock.t));
      }
      if (now - coolAt > 2000) { coolAt = now; pushCooling(false); }
    },
    /** Debug / captures: a pre-aged cloud of `type` ('ash' | 'smoke' | 'dust') with strength k (VEI / severity). */
    demo(type, lat, lon, k, days) {
      if (!Number.isFinite(sim.t)) sim.t = clock.t;
      const t = sim.t;
      const list = type === 'smoke' ? mod.fireSources({ t0: t, t1: t + days + 6, lat, lon, severity: k })
        : type === 'dust' ? mod.dustStormSources({ t0: t, t1: t + Math.max(days, 2), lat, lon, severity: k })
          : mod.eruptionSources({ t, lat, lon, vei: k });
      add(list);
      const n = Math.max(1, Math.ceil(days / 0.25));
      for (let i = 1; i <= n; i++) sim.advanceTo(t + days * i / n, { maxSteps: 1 });
      // put the clock of the field back: the cloud stays as aged
      for (const q of sim.sources) { q.t0 -= days; q.t1 -= days; }
      sim.t = t;
      dirty = true; upAt = -1e9;
      pushCooling(true);
    },
    describe(lat, lon) {
      if (sim.empty) return [];
      const q = sim.at(lat, lon);
      const parts = [];
      if (q.ash > 1.5) parts.push('под пеплом'); else if (q.ash > 0.15) parts.push('вулканический пепел');
      if (q.smoke > 1) parts.push('густой дым лесных пожаров'); else if (q.smoke > 0.12) parts.push('дым лесных пожаров');
      if (q.dust > 1.2) parts.push('пыльная буря'); else if (q.dust > 0.12) parts.push('пыльная мгла');
      if (q.sulphate > 0.04) parts.push('вулканическая дымка');
      const rows = [];
      if (parts.length) rows.push(['Воздух', parts.join(' · ')]);
      if (q.fall > 0.15) rows.push(['Пепел на земле', q.fall > 1 ? 'толстый слой' : 'тонкий слой']);
      if (q.cooling < -0.05) rows.push(['Вулканическая зима', fmtC(q.cooling)]);
      return rows;
    },
  };
}
