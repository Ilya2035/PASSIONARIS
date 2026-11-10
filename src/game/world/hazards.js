// Natural hazards integration: documented catalogues + seeded stochastic scheduler (src/sim/hazards)
// → light map effects, notifications about the great events, the hazard map layer and info rows.
//
// ~500 events happen per game year (mostly small landslides and M6 earthquakes), so the screen only gets the
// most significant ones and the ones in view: a token bucket allows ~2.5 effects per real second; giant events
// (VEI 6+, level-5 quakes and tsunamis) always pass.
export const QUAKE_LEVEL_TEXT = ['—', '2–4 балла', '4–6 баллов', '6–8 баллов', '8–10 баллов', 'более 10 баллов'];
const RISK = ['нет', 'низкая', 'умеренная', 'заметная', 'высокая', 'очень высокая'];
const D2R = Math.PI / 180;

// onEvent(ev): every event that happens (not only the shown ones) — the aerosol layer takes eruption ash, SO2
// and impact dust from here
export async function createHazards({ mod, clock, cal, climate, fx, hud, gcam, onEvent }) {
  const data = await mod.loadHazards();
  const sched = mod.createScheduler({ data, seed: 1 });
  const L = data.levels.layers;
  const N = data.levels.width * data.levels.height;

  // hazard map layer (sim channel B): the strongest of the four hazards, 0..5 → 0..255
  const combined = new Uint8Array(N);
  // land: the strongest of the four hazards; sea: only the tsunami exposure of coastal water (open-ocean quake
  // zones would paint meaningless bands with hard edges where the catalogue ends)
  const landFrac = L.land;
  for (let i = 0; i < N; i++) {
    const onLand = !landFrac || landFrac[i] >= 96;
    const lv = onLand ? Math.max(L.quake[i], L.volcano[i], L.tsunami[i], L.landslide[i]) : L.tsunami[i];
    combined[i] = Math.round(lv / 5 * 255);
  }
  climate?.setHazardChannel(combined);

  let lastT = clock.t, tokens = 3, toastCooldown = 0;
  const log = [];
  const pendingToasts = [];

  function viewScore(ev) {
    const cl = Math.cos(ev.lat * D2R);
    const x = cl * Math.sin(ev.lon * D2R), y = Math.sin(ev.lat * D2R), z = cl * Math.cos(ev.lon * D2R);
    const F = gcam.F;
    const d = Math.max(-1, Math.min(1, x * F.x + y * F.y + z * F.z));
    const ang = Math.acos(d);
    const viewR = Math.min(Math.acos(1 / (1 + gcam.alt)), gcam.alt * 0.6 + 0.004);
    if (ang < viewR) return 3;
    if (ang < viewR * 2.5) return 1.5;
    return d > 0 ? 0.5 : -2;
  }
  function weight(ev) {
    let s;
    switch (ev.type) {
      case 'eruption': s = 1 + (ev.vei ?? ev.level) * 1.1; break;
      case 'earthquake': s = ev.level; break;
      case 'tsunami': s = 1.5 + ev.level; break;
      case 'meteorite': s = 1.5 + ev.level; break;
      default: s = ev.level * 0.6;
    }
    if (ev.documented) s += 0.5;
    if (ev.deaths >= 1000) s += 1;
    return s;
  }
  const isGreat = ev => (ev.type === 'eruption' && (ev.vei ?? 0) >= 4)
    || (ev.type === 'earthquake' && (ev.level >= 5 || (ev.documented && ev.deaths >= 10000)))
    || (ev.type === 'tsunami' && ev.level >= 5)
    || (ev.type === 'meteorite' && ev.level >= 4);

  function detail(ev) {
    const parts = [];
    if (ev.type === 'eruption') parts.push(`ВЭИ ${ev.vei ?? ev.magnitude}`);
    if (ev.type === 'earthquake') parts.push(`уровень ${ev.level} · ${QUAKE_LEVEL_TEXT[ev.level]}${ev.magnitude ? ` · M ${ev.magnitude.toFixed(1)}` : ''}`);
    if (ev.type === 'tsunami' && ev.magnitude) parts.push(`волна до ${Math.round(ev.magnitude)} м`);
    if (ev.type === 'meteorite') parts.push(`уровень ${ev.level}`);
    if (ev.deaths >= 10) parts.push(`погибших ≈ ${Math.round(ev.deaths).toLocaleString('ru-RU')}`);
    return parts.join(' · ');
  }
  function showToast(ev) {
    const title = hud.esc(sched.label(ev));
    const when = cal.formatRu(ev.t, 'day');
    hud.toast(`<b>${title}</b><span class="sub">${hud.esc(when)}${detail(ev) ? ' · ' + hud.esc(detail(ev)) : ''}</span>`, 7000,
      () => gcam.flyTo(ev.lat, ev.lon, Math.min(gcam.alt, ev.type === 'tsunami' ? 0.9 : 0.35)));
  }

  function update(dt, running) {
    const t = clock.t;
    if (running) tokens = Math.min(4, tokens + dt * 2.5);
    toastCooldown -= dt;
    if (pendingToasts.length && toastCooldown <= 0) {
      pendingToasts.sort((a, b) => b.w - a.w);
      showToast(pendingToasts.shift().ev);
      pendingToasts.length = Math.min(pendingToasts.length, 3);
      toastCooldown = 1.4;
    }
    if (t < lastT || t - lastT > 800) { lastT = t; return; }   // load / jump: do not replay the skipped years
    if (t === lastT) return;
    const evs = sched.eventsBetween(lastT, t);
    lastT = t;
    if (!evs.length) return;
    const cand = [];
    for (const ev of evs) {
      if (onEvent) { try { onEvent(ev); } catch (e) { console.warn('hazard onEvent', e); } }
      const w = weight(ev);
      if (isGreat(ev)) {
        log.push(ev);
        if (log.length > 400) log.splice(0, log.length - 400);
        pendingToasts.push({ ev, w });
      }
      cand.push({ ev, s: w + viewScore(ev) });
    }
    if (!fx) return;
    cand.sort((a, b) => b.s - a.s);
    let spawned = 0;
    for (const { ev, s } of cand) {
      if (spawned >= 6) break;
      const always = s >= 9;
      if (!always && (tokens < 1 || s < 2)) break;
      if (!always) tokens -= 1;
      fx.spawn({ type: ev.type, lat: ev.lat, lon: ev.lon, level: ev.level, vei: ev.vei, kind: ev.kind });
      spawned++;
    }
  }

  function describe(lat, lon) {
    const l = sched.levelsAt(lat, lon);
    const rows = [['Землетрясения', l.quake ? `уровень ${l.quake} · ${QUAKE_LEVEL_TEXT[l.quake]}` : 'не бывает']];
    if (l.volcano) rows.push(['Вулканы', RISK[l.volcano]]);
    if (l.tsunami) rows.push(['Цунами', RISK[l.tsunami]]);
    if (l.landslide) rows.push(['Оползни', RISK[l.landslide]]);
    return rows;
  }

  return { sched, data, log, detail, update, describe, reset() { lastT = clock.t; } };
}
