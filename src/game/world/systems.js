// Integration hub: wires the independent world modules (time, climate, weather, hazards, fx, saves)
// into the game. Every module is optional — import.meta.glob only resolves files that exist, so the game
// keeps running while modules are still being built.
const OPT = import.meta.glob([
  '../../sim/calendar.js', '../../sim/clock.js',
  '../../sim/climate/*.js', '../../sim/weather/client.js', '../../sim/weather/grid.js',
  '../../sim/hazards/*.js', '../../sim/aerosols/*.js',
  '../fx/*.js',
  '../../save/*.js',
]);
import { loadBiomes } from './biomes.js';
import { createTime } from './time.js';
import { createClimate } from './climate.js';
import { createHazards } from './hazards.js';
import { createRegions } from './regions.js';
import { createWeather } from './weather.js';
import { createAerosols } from './aerosols.js';
import { INFO_W } from '../globe.js';

const R2D = 180 / Math.PI;
const toGeo = v => (v ? { lat: Math.asin(Math.max(-1, Math.min(1, v.y))) * R2D, lon: Math.atan2(v.x, v.z) * R2D } : null);

// «Ветры и течения» info row: the prevailing wind (u east, v north, m/s) named by where it blows from and its belt
const DIRS = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
function windName({ u, v }, lat, itcz) {
  const sp = Math.hypot(u, v);
  if (sp < 1) return Math.abs(lat - itcz) < 12 ? 'штиль: экваториальная зона затиший' : 'штиль: конские широты';
  const from = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  const dir = DIRS[Math.round(from / 45) % 8];
  const a = Math.abs(lat - itcz * 0.6);
  const belt = u < 0 ? (a < 32 ? 'пассат' : 'полярный ветер') : 'западный перенос';
  return `${dir}, ${belt} · около ${Math.round(sp)} м/с`;
}

const has = p => !!OPT[p];
const load = async p => (OPT[p] ? OPT[p]() : null);

export async function createWorldSystems(ctx) {
  const { hud, globe } = ctx;
  const features = new Set();
  const updaters = [];
  let mode = 'terrain', aeroMod = null;
  const sys = {
    features,
    onModeChange(id) {
      mode = id;
      sys.regions?.setMode(id);
      sys.climate?.setMode?.(id);
      // «Ветры и течения»: the landscape streaks drawn as ink over the quiet map, currents always on (see update)
      sys.winds?.setMode(id === 'winds' ? 'terrain' : id);
      sys.winds?.setVisible(id === 'winds' || (ctx.settings.showWind !== false && !globe.clean));
      sys.currents?.setVisible(id === 'winds' || ctx.settings.showCurrents !== false);
    },
    onHover(v) { sys.regions?.onHover(toGeo(v)); },
    onSelect(v) { const g = toGeo(v); sys.regions?.onSelect(g); sys.weather?.onSelect(g); },
    liveInfo: false,
    update() {},
    renderClock(extra) { hud.renderClock({ date: '—', time: extra || '' }, 0); },
  };
  sys.available = Object.keys(OPT);

  // ---- biomes (terrain mode)
  const biomes = await loadBiomes(globe).catch(e => { console.warn('biomes', e); return null; });
  if (biomes) features.add('biomes');

  sys.describe = (g, geo, cell, h = 0) => {
    const rows = [];
    let kicker, title;
    if (biomes && cell >= 2) {
      const b = biomes.at(geo.lat, geo.lon);
      if (b) { kicker = b.nameRu; rows.push(['Местность', b.nameRu]); }
    }
    const rd = sys.regions?.describe(geo.lat, geo.lon);
    if (rd) {
      title = rd.title;
      rows.push(...rd.rows);
      if (mode === 'regions' && rd.kicker) kicker = rd.kicker;
    }
    const section = (name, list) => { if (list?.length) rows.push([name, null], ...list); };
    if (sys.climate) {
      // Köppen class and fertility on land (the fertility mode adds what helps and what hinders)
      const era = cell >= 2 ? sys.climate.eraRows?.(geo.lat, geo.lon, h, mode === 'fertility') || [] : [];
      if (era.length && mode === 'koppen') kicker = era[0][1];
      if (era.length && mode === 'fertility') kicker = `Плодородие: ${era[1][1]}`;
      section('Климат этой эпохи', [...era, ...sys.climate.describe(geo.lat, geo.lon)]);
    }
    if (mode === 'winds' && aeroMod?.windAt) {
      const itcz = globe.terrainMat.uniforms.uItcz.value;
      section('Ветер', [['Преобладающий ветер', windName(aeroMod.windAt(geo.lat, itcz), geo.lat, itcz)]]);
    }
    const air = sys.aerosols?.describe(geo.lat, geo.lon) || [];   // «Воздух»: ash, smoke, dust, haze
    if (mode === 'air' && sys.aerosols && !air.length) air.push(['Воздух', 'чистый']);
    if (sys.weather) {
      const wr = sys.weather.describe(geo.lat, geo.lon);
      const cut = wr.findIndex(r => r[1] === null);   // the chronicle brings its own header
      section('Погода', [...(cut < 0 ? wr : wr.slice(0, cut)), ...air]);
      if (cut >= 0) rows.push(...wr.slice(cut));
    } else section('Погода', air);
    if (sys.hazards && mode === 'hazards') section('Опасности', sys.hazards.describe(geo.lat, geo.lon));
    return { kicker, title, rows, tip: kicker };
  };

  // SIM-grid land / lake / ocean mask for the weather, taken before the regions module re-encodes the cell raster
  const wxGrid = await load('../../sim/weather/grid.js');
  const wxMask = wxGrid ? wxGrid.maskFromCells(globe.data.cells) : null;

  // ---- time, saves, autosave
  const [cal, clk, save] = await Promise.all([load('../../sim/calendar.js'), load('../../sim/clock.js'), load('../../save/index.js')]);
  if (cal && clk && save) {
    const time = createTime({ cal, clk, save, hud, settings: ctx.settings });
    sys.time = time;
    sys.clock = time.clock;
    sys.cal = cal;
    features.add('time');
    sys.renderClock = extra => time.render(extra);
    sys.setSpeed = n => time.setSpeed(n);
    sys.togglePause = () => time.togglePause();
    sys.pauseForMenu = open => time.pauseForMenu(open);
    sys.openSaves = mode => time.openSaves(mode);
    sys.quickSave = () => time.quickSave();
    sys.quickLoad = () => time.quickLoad();
    const prevSetting = sys.onSetting;
    sys.onSetting = (k, v) => { if (k === 'autosaveMinutes') time.setAutosave(v); prevSetting?.(k, v); };
  }

  // ---- monthly climate normals: loaded first, they are all the weather needs
  let climatology = null, paleo = null, normals = null;
  if (sys.clock) {
    [climatology, paleo] = await Promise.all([load('../../sim/climate/climatology.js'), load('../../sim/climate/paleo.js')]);
    if (climatology && paleo) normals = await climatology.loadNormals(climatology.NORMALS_URL).catch(e => { console.warn('climate', e); return null; });
  }

  // ---- daily weather (worker): snow, ice, clouds, rain, drought, weather spells.
  // Started as early as possible and awaited at the end: its climatological spin-up (~0.5 s in the worker) overlaps
  // with the rest of the loading on the main thread (regions, climate, era statistics, aerosols, effects, hazards,
  // labels, shader compiles and texture uploads).
  let weatherP = null;
  if (sys.clock && normals && wxMask) {
    weatherP = (async () => {
      const clientMod = await load('../../sim/weather/client.js');
      if (!clientMod) return;
      sys.weather = await createWeather({
        clientMod, mask: wxMask, normals, clock: sys.clock, globe, fx: () => sys.fx, hud, gcam: ctx.gcam,
        registry: sys.time?.registry, placeName: (la, lo) => sys.regions?.describe(la, lo)?.title,
        // volcanic winter of the aerosol layer (created later while loading): degC per 1-degree row, sent on change
        cooling: () => sys.aerosols?.sim?.cooling ?? null,
      }).catch(e => { console.warn('weather', e); return null; });
      if (sys.weather) {
        features.add('weather');
        sys.liveInfo = true;
        sys.weather.setEnabled(ctx.settings.showWeather !== false);
        const prevSetting = sys.onSetting;
        sys.onSetting = (k, v) => { if (k === 'showWeather') sys.weather.setEnabled(v !== false); prevSetting?.(k, v); };
      }
    })();
  }

  // ---- natural districts, provinces, regions, sea zones and roads
  sys.regions = await createRegions({ globe, scene: ctx.scene, settings: ctx.settings, infoW: INFO_W })
    .catch(e => { console.warn('regions', e); return null; });
  if (sys.regions) {
    features.add('regions');
    ctx.onIdle?.();   // GPU warm-up (main.js): the re-encoded cell raster and the roads go up while the climate builds
    updaters.push(() => sys.regions.update(ctx.gcam));
  }

  // ---- climate: monthly normals + paleoclimate (needs the clock; after the regions: the fresh-water raster reads
  // their lakes and coasts from the re-encoded cell raster)
  if (normals) {
    sys.climate = await createClimate({ climatology, paleo, globe, clock: sys.clock, cal, normals, deferEra: true }).catch(e => { console.warn('climate', e); return null; });
    if (sys.climate) features.add('climate');
  }
  sys.climate?.tick?.(false);   // the era statistics (Köppen, fertility), at once (the clock stands while loading)

  // ---- aerosols: volcanic ash, wildfire smoke, dust, sulphate haze (sources: hazards and weather spells)
  if (sys.clock) {
    aeroMod = await load('../../sim/aerosols/index.js');
    if (aeroMod) {
      try {
        sys.aerosols = createAerosols({ mod: aeroMod, clock: sys.clock, globe, climate: sys.climate, mask: wxMask, registry: sys.time?.registry });
        features.add('aerosols');
        sys.liveInfo = true;
      } catch (e) { console.warn('aerosols', e); sys.aerosols = null; }
    }
  }
  // debug / captures: ?ashdemo=lat,lon[,vei[,days]] · ?smokedemo=lat,lon[,severity[,days]] · ?dustdemo=…
  // a pre-aged cloud placed on the first frame (after ?date= has set the clock)
  let aeroDemo = null;
  {
    const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    for (const [key, type, k0, d0] of [['ashdemo', 'ash', 6, 2], ['smokedemo', 'smoke', 4, 4], ['dustdemo', 'dust', 4, 2]]) {
      const v = qs?.get(key);
      if (!v) continue;
      const [la, lo, k, d] = v.split(',').map(Number);
      if (Number.isFinite(la) && Number.isFinite(lo)) (aeroDemo ||= []).push({ type, la, lo, k: Number.isFinite(k) ? k : k0, d: Number.isFinite(d) ? d : d0 });
    }
  }

  // ---- light effects for events (eruptions, quakes, tsunamis, meteorites, fires, weather spells)
  const fxMod = await load('../fx/events.js');
  if (fxMod) {
    sys.fx = new fxMod.EventFx(ctx.scene, globe);
    sys.fx.setVisible(ctx.settings.effects !== false);
    features.add('fx');
    ctx.onIdle?.();   // the effect shaders compile while the hazards, currents and labels load
    const prevSetting = sys.onSetting;
    sys.onSetting = (k, v) => { if (k === 'effects') sys.fx.setVisible(v !== false); prevSetting?.(k, v); };
  }

  // ---- natural hazards (needs the clock; effects and the hazard layer are optional)
  if (sys.clock) {
    const hz = await load('../../sim/hazards/index.js');
    if (hz) {
      sys.hazards = await createHazards({ mod: hz, clock: sys.clock, cal, climate: sys.climate, fx: sys.fx, hud, gcam: ctx.gcam, onEvent: ev => sys.aerosols?.onHazard(ev) })
        .catch(e => { console.warn('hazards', e); return null; });
      if (sys.hazards) {
        features.add('hazards');
        sys.time?.onLoad(() => sys.hazards.reset());
      }
    }
  }

  // ---- ocean currents (seasonal, Victoria-like streaks) and EU4-like natural zone labels
  const curMod = await load('../fx/currents.js');
  if (curMod) {
    try {
      sys.currents = new curMod.Currents(ctx.scene, globe, ctx.settings.palette);
      await sys.currents.ready;
      sys.currents.setVisible(ctx.settings.showCurrents !== false);
      features.add('currents');
    } catch (e) { console.warn('currents', e); sys.currents?.dispose?.(); sys.currents = null; }
  }
  const labMod = await load('../fx/labels.js');
  if (labMod) {
    try {
      sys.labels = new labMod.ZoneLabels(ctx.scene, globe, { palette: ctx.settings.palette, renderer: ctx.renderer, maxLetterPx: 58 });
      if (globe.clean) sys.labels.setVisible(false);
      if (!globe.clean) sys.labels.setVisible(ctx.settings.showLabels !== false);
      features.add('labels');
    } catch (e) { console.warn('labels', e); sys.labels = null; }
  }
  {
    const prevSetting = sys.onSetting;
    sys.onSetting = (k, v) => {
      if (k === 'showCurrents') sys.currents?.setVisible(v !== false || mode === 'winds');
      if (k === 'showLabels') sys.labels?.setVisible(v !== false);
      prevSetting?.(k, v);
    };
  }
  // prevailing winds (streaks), seasonal
  const windMod = await load('../fx/wind.js');
  if (windMod) {
    try {
      sys.winds = new windMod.Winds(ctx.scene, globe);
      sys.winds.setVisible(ctx.settings.showWind !== false && !globe.clean);
      features.add('wind');
      const prevSetting = sys.onSetting;
      sys.onSetting = (k, v) => { if (k === 'showWind') sys.winds.setVisible(v !== false || mode === 'winds'); prevSetting?.(k, v); };
    } catch (e) { console.warn('wind', e); sys.winds = null; }
  }
  // fractional month for seasonal currents: m = middle of month m (1..12)
  const monthOf = t => { const d = cal.toDate(t); return d.month + (d.day - 15.5) / 30.4; };

  // chronicle items: great hazards + strong weather spells, newest first
  sys.chronicle = () => {
    const out = [];
    for (const ev of sys.hazards?.log || []) {
      out.push({ kind: 'hazard', t: ev.t, lat: ev.lat, lon: ev.lon, title: sys.hazards.sched.label(ev), sub: sys.hazards.detail?.(ev) || '' });
    }
    for (const e of sys.weather?.recent || []) {
      if (e.severity < 4) continue;
      const where = sys.regions?.describe(e.lat, e.lon)?.title;
      out.push({ kind: 'weather', t: e.t0, lat: e.lat, lon: e.lon, title: e.name || e.type, sub: `${where ? where + ' · ' : ''}сила ${e.severity} из 5` });
    }
    out.sort((a, b) => b.t - a.t);
    return out.slice(0, 80).map(it => ({ ...it, when: cal ? cal.formatRu(it.t, 'day') : '' }));
  };

  const running = () => !!sys.time?.running;
  sys.update = (dt, t, p) => {
    sys.time?.update(dt);
    sys.hazards?.update(dt, running());
    sys.weather?.update(dt, running());
    if (sys.aerosols) {
      sys.aerosols.update(dt, running(), sys.weather?.recent);
      if (aeroDemo) { for (const a of aeroDemo) sys.aerosols.demo(a.type, a.la, a.lo, a.k, a.d); aeroDemo = null; }
    }
    sys.fx?.update(ctx.gcam, t, { running: running(), heightPx: ctx.renderHeight?.(), fov: ctx.camera?.fov });
    const mo = sys.clock ? monthOf(sys.clock.t) : 1;
    if (sys.currents) { if (sys.clock) sys.currents.setMonth(mo); sys.currents.update(ctx.gcam, t); }
    if (sys.winds) {
      sys.winds.setMonth(mo);
      sys.winds.update(ctx.gcam, t);
      // «Ветры и течения»: dark ink streaks, stronger, and the belts of the shader follow the same ITCZ
      const wu = sys.winds.material?.uniforms;
      if (wu) {
        const wm = mode === 'winds';
        if (wm) {
          wu.uOpacity.value = Math.min(0.85, 0.3 + wu.uOpacity.value * 1.25);
          globe.terrainMat.uniforms.uItcz.value = wu.uItcz.value;
        }
        if (wm !== windInk) { windInk = wm; wm ? wu.uColor.value.setRGB(0.2, 0.17, 0.14) : wu.uColor.value.setRGB(0.97, 0.97, 0.95); }
      }
    }
    sys.labels?.update(ctx.gcam, t);
    // the era's Köppen / fertility statistics: a decade change is rebuilt over a few frames (at once when paused)
    sys.climate?.tick?.(running());
    for (const u of updaters) u(dt, t, p);
  };
  let windInk = false;

  // everything is up: the rest of the shaders and textures go to the GPU while the weather worker finishes
  ctx.onIdle?.();
  await weatherP;
  ctx.onProgress?.(1);
  return sys;
}

export { has, load };
