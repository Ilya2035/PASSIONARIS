// Weather integration: the daily simulator in a worker → snow, sea ice, clouds, rain, drought on the map,
// weather spells as light effects and notifications, a live readout for the selected point, saves.
//
// Pace: one simulated day costs ~8 ms in the worker, so speeds 1–4 keep up; at speed 5 (a year per second) the
// worker simply covers more days per request and the map refreshes every second or two. A request is never sent
// while the previous one is in flight.
const D2R = Math.PI / 180;

export async function createWeather({ clientMod, mask, normals, clock, globe, fx, hud, gcam, registry, placeName }) {
  const worker = new Worker(new URL('./weather.worker.js', import.meta.url), { type: 'module' });
  const client = new clientMod.WeatherClient({ worker });
  // the worker keeps its own copy of the normals (structured clone), the climate layer keeps ours
  let frame = await client.init({ normals: { tavg: normals.tavg, prec: normals.prec, elev: normals.elev }, mask, seed: 1, t: clock.t });
  let lastT = frame.t, enabled = true, snapshot = null, snapAt = -1e9, tokens = 2, toastCooldown = 0;
  const recent = [];

  function show(f) {
    if (enabled) globe.setWeather(f.grid, 720, 360);
    client.release(f.grid);
  }
  show(frame);

  function viewScore(ev) {
    const cl = Math.cos(ev.lat * D2R);
    const x = cl * Math.sin(ev.lon * D2R), y = Math.sin(ev.lat * D2R), z = cl * Math.cos(ev.lon * D2R);
    const F = gcam.F;
    const d = Math.max(-1, Math.min(1, x * F.x + y * F.y + z * F.z));
    const viewR = Math.min(Math.acos(1 / (1 + gcam.alt)), gcam.alt * 0.6 + 0.004);
    const ang = Math.acos(d);
    return ang < viewR ? 3 : ang < viewR * 2.5 ? 1.5 : d > 0 ? 0.5 : -2;
  }
  function onEvents(events) {
    const starts = events.filter(e => e.phase === 'start');
    for (const e of starts) { recent.push(e); if (recent.length > 200) recent.shift(); }
    const fxs = typeof fx === 'function' ? fx() : fx;
    if (fxs) {
      const cand = starts.map(e => ({ e, s: e.severity + viewScore(e) })).sort((a, b) => b.s - a.s);
      for (const { e, s } of cand) {
        if (tokens < 1 || s < 3) break;
        tokens -= 1;
        fxs.spawn({ type: e.type, lat: e.lat, lon: e.lon, severity: e.severity });
      }
    }
    // only the extreme spells get a notification
    const big = starts.filter(e => e.severity >= 5).sort((a, b) => viewScore(b) - viewScore(a))[0];
    if (big && toastCooldown <= 0) {
      toastCooldown = 4;
      const where = placeName?.(big.lat, big.lon);
      hud.toast(`<b>${hud.esc(big.name || big.type)}</b><span class="sub">${where ? hud.esc(where) + ' · ' : ''}сила ${big.severity} из 5</span>`, 6000,
        () => gcam.flyTo(big.lat, big.lon, Math.min(gcam.alt, 0.6)));
    }
  }

  async function stepTo(t) {
    try {
      const f = await client.step(t);
      lastT = f.t;
      show(f);
      if (f.events?.length) onEvents(f.events);
      // keep a recent snapshot for saves (SaveRegistry.collect() is synchronous)
      if (performance.now() - snapAt > 20000) {
        snapAt = performance.now();
        snapshot = await client.serialize();
      }
    } catch (e) { console.warn('weather step', e); }
  }

  registry?.register('weather', {
    optional: true,
    save: () => snapshot,
    load: async s => {
      if (!s?.buffers) return;
      const f = await client.deserialize(s);
      lastT = f.t; snapshot = s; show(f);
    },
  });

  // point readout for the info window (async query, cached)
  let sel = null, selInfo = null, selAt = 0;
  async function querySel() {
    if (!sel) return;
    try { selInfo = await client.queryLatLon(sel.lat, sel.lon); } catch { selInfo = null; }
  }
  const fmtT = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} °C`;

  return {
    client,
    recent,
    update(dt, running) {
      if (running) tokens = Math.min(3, tokens + dt * 1.2);
      toastCooldown -= dt;
      const t = clock.t;
      if (!client.busy && Math.abs(t - lastT) >= 1) stepTo(t);
      if (sel && performance.now() - selAt > 1000 && !client.busy) { selAt = performance.now(); querySel(); }
    },
    setEnabled(v) {
      enabled = v !== false;
      globe.terrainMat.uniforms.uHasWeather.value = enabled ? 1 : 0;
    },
    onSelect(geo) { sel = geo; selInfo = null; selAt = 0; },
    describe(lat, lon) {
      if (!sel || !selInfo || Math.abs(sel.lat - lat) > 0.3 || Math.abs(sel.lon - lon) > 0.3) return [];
      const q = selInfo;
      const rows = [['Погода сегодня', `${fmtT(q.temp)} (обычно ${fmtT(q.normalTemp)})`]];
      if (q.precip > 0.2) rows.push(['Осадки', `${q.precip.toFixed(1)} мм за день`]);
      if (q.swe > 1) rows.push(['Снег', `${Math.round(q.swe / 3)} см`]);
      if (q.ice) rows.push(['Лёд', `${Math.round(q.iceCm)} см`]);
      if (q.drought > 0.3) rows.push(['Засуха', `${Math.round(q.drought * 100)} %`]);
      if (q.fireDanger > 0.4) rows.push(['Пожароопасность', `${Math.round(q.fireDanger * 100)} %`]);
      return rows;
    },
    climateLog: () => client.climateLog(),
    reset() { lastT = -1e9; },
  };
}
