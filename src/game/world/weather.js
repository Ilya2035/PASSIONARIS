// Weather integration: the daily simulator in a worker → snow, sea ice, clouds, rain, drought on the map,
// weather spells as light effects and notifications, a live readout for the selected point, saves.
//
// Pace: a daily step costs ~4 ms in the worker (measured from every answer). When the clock runs faster than the
// worker can follow with about half of its time, the worker simulates blocks of k days per step (a block costs
// about (1 + (k-1)/4) daily steps: fields, cyclones and detectors still run every day, the cells once per block),
// so the weather keeps up with the clock at every speed and the map changes smoothly instead of catching up by
// jumps. A request is never sent while the previous one is in flight.
// Display: the map does not switch from frame to frame but chases the newest frame with a short cross-fade in real
// time (FADE_TAU): at slow speeds each new day blends in, at fast speeds clouds and snow glide (the fade averages
// over the last days); the first frame, loads, rewinds and jumps while paused are shown at once.
const D2R = Math.PI / 180;
const WX_W = 720, WX_H = 360;
const FADE_TAU = 0.25, FADE_STEP = 1 / 20; // s: cross-fade time constant (0 = off), at most 20 texture updates per second
const BUDGET = 0.45;                         // share of the worker's time the simulation may use
const STRIDE_MAX = 8;                        // longer blocks drift from the daily statistics (fire danger, droughts)
const blockCost = k => (1 + 0.25 * (k - 1)) / k; // cost per game day of a k-day block, in daily steps
const COOL_STEP = 0.05;                      // degC: a change of the volcanic cooling this large is sent to the worker

/**
 * @param {() => (Float32Array|null)} [o.cooling] volcanic winter of the aerosol layer: degC (<= 0) per latitude row,
 *   row 0 = north (world.aerosols.sim.cooling). Read before every step and sent to the worker when it changed, so the
 *   snow, the sea ice, «Погода сегодня» and the weather spells feel it at every pace and after loads.
 */
export async function createWeather({ clientMod, mask, normals, clock, globe, fx, hud, gcam, registry, placeName, cooling = null }) {
  const worker = new Worker(new URL('./weather.worker.js', import.meta.url), { type: 'module' });
  const client = new clientMod.WeatherClient({ worker });
  // the worker keeps its own copy of the normals (structured clone), the climate layer keeps ours
  let frame = await client.init({ normals: { tavg: normals.tavg, prec: normals.prec, elev: normals.elev }, mask, seed: 1, t: clock.t });
  let lastT = frame.t, lastDay = frame.day, enabled = true, snapshot = null, snapAt = -1e9, tokens = 2, toastCooldown = 0;
  const recent = [];

  // ---- display: `disp` is on the map, `target` the newest frame; the fade moves disp towards target
  const disp = new Uint8Array(WX_W * WX_H * 4), target = new Uint8Array(disp.length);
  const disp32 = new Uint32Array(disp.buffer), target32 = new Uint32Array(target.buffer);
  let fading = false, fadeAt = 0, snapNext = true, fadeTau = FADE_TAU;
  const upload = () => { if (enabled) globe.setWeather(disp, WX_W, WX_H); };
  function show(f, snap = false) {
    target.set(f.grid);
    client.release(f.grid);
    if (snap || snapNext || !(fadeTau > 0)) { disp.set(target); snapNext = false; fading = false; upload(); }
    else if (!fading) { fading = true; fadeAt = performance.now(); }
  }
  // one fade step: disp += (target - disp) * w / 256 on all four channels at once (two 8-bit lanes per 32-bit op,
  // rounded); a byte that rounding would keep in place takes the target value, so the fade always ends
  function fadeStep(a) {
    const w = Math.max(8, Math.min(256, Math.round(a * 256))), iw = 256 - w;
    let moving = 0;
    for (let i = 0; i < disp32.length; i++) {
      const p = disp32[i], q = target32[i];
      if (p === q) continue;
      const rb = (((p & 0x00ff00ff) * iw + (q & 0x00ff00ff) * w + 0x00800080) >>> 8) & 0x00ff00ff;
      const ga = (((p >>> 8) & 0x00ff00ff) * iw + ((q >>> 8) & 0x00ff00ff) * w + 0x00800080) & 0xff00ff00;
      const v = (rb | ga) >>> 0;
      disp32[i] = v === p ? q : v;
      moving++;
    }
    return moving;
  }
  show(frame, true);

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
        // tropical cyclones of the simulator carry their kind: the effect does not have to guess it from the latitude
        fxs.spawn({ type: e.type, lat: e.lat, lon: e.lon, severity: e.severity, ...(e.subtype === 'tropical' ? { kind: 'tropical' } : null) });
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

  // ---- pacing: msDay = learned cost of one daily step in the worker (ms)
  let msDay = 5, stride = 0, maxSim = 0, requests = 0, maxLag = 0;
  function learn(f) {
    if (!(f.ms > 0) || !(f.simDays >= 1) || f.simDays > maxSim) return; // jumps (re-initialisation) do not count
    const k = Math.min(stride, f.simDays), per = f.ms / f.simDays / blockCost(k);
    const w = Math.min(1, f.simDays / 20) * 0.25;
    msDay = Math.min(200, Math.max(0.3, msDay + (per - msDay) * w));
  }
  function pace() {
    const rate = clock.daysPerSecond; // game days per real second (0 when paused)
    let k = 1;
    while (k < STRIDE_MAX && rate * msDay * blockCost(k) > BUDGET * 1000) k++;
    // hysteresis: a smaller stride only when it is clearly within the budget
    if (k < stride && stride > 1 && rate * msDay * blockCost(stride - 1) > 0.8 * BUDGET * 1000) k = stride;
    // a gap the worker can simulate within ~0.5 s is simulated, a longer one re-initialises from climatology
    const ms = Math.round(Math.min(730, Math.max(60, 500 / (msDay * blockCost(k)))));
    if (k !== stride || Math.abs(ms - maxSim) > 0.25 * maxSim) {
      stride = k; maxSim = ms;
      client.setOptions?.({ stride: k, maxSimDays: ms }).catch(() => {});
    }
  }
  clock.on?.('state', pace);
  pace();
  let paceAt = performance.now();

  // ---- volcanic winter → the worker (a message, served before the next step). `coolSent` mirrors the worker's rows:
  // the worker keeps them across loads (they are not part of the weather save), so a load only has to send the
  // loaded aerosol state when it differs, like any other change. A cooling that has died out is cleared exactly.
  let coolSent = null, coolForce = false, coolAt = 0;
  function syncCooling() {
    if (!client.setCooling) return;
    const src = typeof cooling === 'function' ? cooling() : cooling;
    const on = !!src && src.some(v => v !== 0);
    let send = coolForce;
    if (!on) send ||= coolSent !== null;
    else if (!coolSent || coolSent.length !== src.length) send = true;
    else for (let i = 0; i < src.length && !send; i++) if (Math.abs(src[i] - coolSent[i]) > COOL_STEP) send = true;
    if (!send) return;
    coolForce = false;
    coolSent = on ? Float32Array.from(src) : null;
    client.setCooling(coolSent).catch(e => console.warn('weather cooling', e));
  }

  let rtt = 60; // ms, request round trip (EMA): while the clock runs, the request aims that far ahead
  async function stepTo(t, running) {
    try {
      requests++;
      syncCooling();
      const t0 = performance.now();
      const f = await client.step(t);
      rtt += (performance.now() - t0 - rtt) * 0.2;
      learn(f);
      // shown at once: rewinds, and jumps while the clock stands (loads, date changes); otherwise faded in
      const jump = f.day < lastDay || (!running && f.day - lastDay > 1);
      lastT = f.t; lastDay = f.day;
      show(f, jump);
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
      // A snapshot only fits the normals it was made with (the freezing-sea cell list follows them): saves from
      // before the open climate data (v0.2.4 and older, WorldClim) restart the weather at the loaded date instead,
      // exactly as a save without weather does — the rest of the save still loads.
      let f;
      try { f = await client.deserialize(s); } catch (e) {
        console.warn('weather: saved weather does not fit these climate normals, restarting it', e.message || e);
        snapshot = null; snapAt = -1e9; coolForce = true;   // no stale pre-load snapshot in the next save
        return;
      }
      lastT = f.t; lastDay = f.day; snapshot = s; show(f, true);
      coolForce = true;   // the next step (or the paused check in update) sends the cooling of the loaded aerosols
    },
  });

  // climate chronicle (climateLog: per 5x5 degree box and year) for the info window
  let log = null, logAt = -1e9;
  async function refreshLog() {
    if (performance.now() - logAt < 4000) return;
    logAt = performance.now();
    try { log = await client.climateLog(); } catch { log = null; }
  }
  const yearRu = y => (y <= 0 ? `${1 - y} г. до н.э.` : `${y} г.`);
  function chronicle(lat, lon) {
    const ys = log?.years;
    if (!ys || !ys.year.length) return [];
    const B = log.count, n = ys.year.length;
    const box = Math.min(35, Math.max(0, Math.floor((90 - lat) / 5))) * 72 + Math.min(71, Math.max(0, Math.floor((lon + 180) / 5)));
    const k = Math.min(50, n), i0 = n - k;
    let T = 0, P = 0, sw = 0, dm = 0, hw = 0;
    for (let i = i0; i < n; i++) {
      const o = i * B + box;
      T += ys.meanT[o] / 10; P += ys.totalP[o]; sw += ys.severeWinter[o]; dm += ys.droughtMonths[o]; hw += ys.heatwaves[o];
    }
    const last = n - 1, lo = last * B + box;
    const rows = [
      ['Летопись края (квадрат 5°)', null],
      ['Годы', k > 1 ? `${yearRu(ys.year[i0])} — ${yearRu(ys.year[last])}` : yearRu(ys.year[last])],
      ['Средняя температура', `${fmtT(T / k)}${k > 1 ? ` · в последний год ${fmtT(ys.meanT[lo] / 10)}` : ''}`],
      ['Осадки в год', `${Math.round(P / k).toLocaleString('ru-RU')} мм`],
      ['Суровые зимы', `${sw} из ${k}`],
      ['Засушливые месяцы', `${(dm / k).toFixed(1)} в год`],
    ];
    if (hw) rows.push(['Волны жары', `${hw} за ${k} ${k === 1 ? 'год' : 'лет'}`]);
    return rows;
  }

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
      const t = clock.t, now = performance.now();
      if (running && t - lastT > maxLag) maxLag = t - lastT;
      if (now - paceAt > 1000) { paceAt = now; pace(); }
      // aim where the clock will be when the answer arrives (fast speeds), at most a month ahead; a weather
      // slightly ahead of a stopped or slowed clock waits for it instead of rewinding (which re-initialises)
      const want = running ? t + Math.min(30, clock.daysPerSecond * rtt / 1000) : t;
      const ahead = lastT - want;
      if (!client.busy && (want - lastT >= 1 || ahead > 45)) stepTo(want, running);
      // while no step goes out (a paused clock), the point readout still learns a changed cooling within a second
      else if (!client.busy && now - coolAt > 1000) { coolAt = now; syncCooling(); }
      if (fading && !enabled) { disp.set(target); fading = false; }
      if (fading && now - fadeAt >= FADE_STEP * 1000) {
        const a = 1 - Math.exp(-(now - fadeAt) / 1000 / fadeTau);
        fadeAt = now;
        if (!fadeStep(a)) fading = false;
        upload();
      }
      if (sel && now - selAt > 1000 && !client.busy) { selAt = now; querySel(); refreshLog(); }
    },
    setEnabled(v) {
      const was = enabled;
      enabled = v !== false;
      globe.terrainMat.uniforms.uHasWeather.value = enabled ? 1 : 0;
      if (enabled && !was) upload();
    },
    /** Pacing and display state (diagnostics, smoke tests): lag of the shown weather behind the clock, in days. */
    stats() {
      return { clockT: clock.t, weatherT: lastT, lagDays: clock.t - lastT, maxLagDays: maxLag, stride, maxSimDays: maxSim, msDay, requests, fading, daysPerSecond: clock.daysPerSecond };
    },
    resetStats() { maxLag = 0; requests = 0; },
    /** Cross-fade time constant in seconds (0 switches the fade off: every frame is shown at once). */
    setFade(seconds) { fadeTau = Math.max(0, +seconds || 0); },
    onSelect(geo) { sel = geo; selInfo = null; selAt = 0; if (geo) { logAt = -1e9; refreshLog(); } },
    describe(lat, lon) {
      if (!sel || !selInfo || Math.abs(sel.lat - lat) > 0.3 || Math.abs(sel.lon - lon) > 0.3) return [];
      const q = selInfo;
      const rows = [['Погода сегодня', `${fmtT(q.temp)} (обычно ${fmtT(q.normalTemp)})`]];
      if (q.precip > 0.2) rows.push(['Осадки', `${q.precip.toFixed(1)} мм за день`]);
      if (q.swe > 1) rows.push(['Снег', `${Math.round(q.swe / 3)} см`]);
      if (q.ice) rows.push(['Лёд', `${Math.round(q.iceCm)} см`]);
      if (q.drought > 0.3) rows.push(['Засуха', `${Math.round(q.drought * 100)} %`]);
      if (q.fireDanger > 0.4) rows.push(['Пожароопасность', `${Math.round(q.fireDanger * 100)} %`]);
      return rows.concat(chronicle(lat, lon));
    },
    climateLog: () => client.climateLog(),
    reset() { lastT = -1e9; snapNext = true; },
  };
}
