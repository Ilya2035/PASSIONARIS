// Integration hub: wires the independent world modules (time, climate, weather, hazards, fx, saves)
// into the game. Every module is optional — import.meta.glob only resolves files that exist, so the game
// keeps running while modules are still being built.
const OPT = import.meta.glob([
  '../../sim/calendar.js', '../../sim/clock.js',
  '../../sim/climate/*.js', '../../sim/weather/client.js', '../../sim/weather/grid.js',
  '../../sim/hazards/*.js',
  '../fx/*.js',
  '../../save/*.js',
]);
import { loadBiomes } from './biomes.js';
import { createTime } from './time.js';
import { createClimate } from './climate.js';
import { createHazards } from './hazards.js';
import { createRegions } from './regions.js';
import { createWeather } from './weather.js';
import { INFO_W } from '../globe.js';

const R2D = 180 / Math.PI;
const toGeo = v => (v ? { lat: Math.asin(Math.max(-1, Math.min(1, v.y))) * R2D, lon: Math.atan2(v.x, v.z) * R2D } : null);

const has = p => !!OPT[p];
const load = async p => (OPT[p] ? OPT[p]() : null);

export async function createWorldSystems(ctx) {
  const { hud, globe } = ctx;
  const features = new Set();
  const updaters = [];
  let mode = 'terrain';
  const sys = {
    features,
    onModeChange(id) { mode = id; sys.regions?.setMode(id); },
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

  sys.describe = (g, geo, cell) => {
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
    if (sys.climate) section('Климат этой эпохи', sys.climate.describe(geo.lat, geo.lon));
    if (sys.weather) {
      const wr = sys.weather.describe(geo.lat, geo.lon);
      const cut = wr.findIndex(r => r[1] === null);   // the chronicle brings its own header
      section('Погода', cut < 0 ? wr : wr.slice(0, cut));
      if (cut >= 0) rows.push(...wr.slice(cut));
    }
    if (sys.hazards && mode === 'hazards') section('Опасности', sys.hazards.describe(geo.lat, geo.lon));
    return { kicker, title, rows, tip: kicker };
  };

  // SIM-grid land / lake / ocean mask for the weather, taken before the regions module re-encodes the cell raster
  const wxGrid = await load('../../sim/weather/grid.js');
  const wxMask = wxGrid ? wxGrid.maskFromCells(globe.data.cells) : null;

  // ---- natural districts, provinces, regions, sea zones and roads
  sys.regions = await createRegions({ globe, scene: ctx.scene, settings: ctx.settings, infoW: INFO_W })
    .catch(e => { console.warn('regions', e); return null; });
  if (sys.regions) {
    features.add('regions');
    updaters.push(() => sys.regions.update(ctx.gcam));
  }

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

  // ---- climate: monthly normals + paleoclimate (needs the clock)
  if (sys.clock) {
    const [climatology, paleo] = await Promise.all([load('../../sim/climate/climatology.js'), load('../../sim/climate/paleo.js')]);
    if (climatology && paleo) {
      sys.climate = await createClimate({ climatology, paleo, globe, clock: sys.clock, cal }).catch(e => { console.warn('climate', e); return null; });
      if (sys.climate) features.add('climate');
    }
  }

  // ---- daily weather (worker): snow, ice, clouds, rain, drought, weather spells
  if (sys.clock && sys.climate && wxMask) {
    const clientMod = await load('../../sim/weather/client.js');
    if (clientMod) {
      sys.weather = await createWeather({
        clientMod, mask: wxMask, normals: sys.climate.normals, clock: sys.clock, globe, fx: () => sys.fx, hud, gcam: ctx.gcam,
        registry: sys.time?.registry, placeName: (la, lo) => sys.regions?.describe(la, lo)?.title,
      }).catch(e => { console.warn('weather', e); return null; });
      if (sys.weather) {
        features.add('weather');
        sys.liveInfo = true;
        sys.weather.setEnabled(ctx.settings.showWeather !== false);
        const prevSetting = sys.onSetting;
        sys.onSetting = (k, v) => { if (k === 'showWeather') sys.weather.setEnabled(v !== false); prevSetting?.(k, v); };
      }
    }
  }

  // ---- light effects for events (eruptions, quakes, tsunamis, meteorites, fires, weather spells)
  const fxMod = await load('../fx/events.js');
  if (fxMod) {
    sys.fx = new fxMod.EventFx(ctx.scene, globe);
    sys.fx.setVisible(ctx.settings.effects !== false);
    features.add('fx');
    const prevSetting = sys.onSetting;
    sys.onSetting = (k, v) => { if (k === 'effects') sys.fx.setVisible(v !== false); prevSetting?.(k, v); };
  }

  // ---- natural hazards (needs the clock; effects and the hazard layer are optional)
  if (sys.clock) {
    const hz = await load('../../sim/hazards/index.js');
    if (hz) {
      sys.hazards = await createHazards({ mod: hz, clock: sys.clock, cal, climate: sys.climate, fx: sys.fx, hud, gcam: ctx.gcam })
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
      if (k === 'showCurrents') sys.currents?.setVisible(v !== false);
      if (k === 'showLabels') sys.labels?.setVisible(v !== false);
      prevSetting?.(k, v);
    };
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
    sys.fx?.update(ctx.gcam, t, { running: running(), heightPx: ctx.renderHeight?.(), fov: ctx.camera?.fov });
    if (sys.currents) { if (sys.clock) sys.currents.setMonth(monthOf(sys.clock.t)); sys.currents.update(ctx.gcam, t); }
    sys.labels?.update(ctx.gcam, t);
    for (const u of updaters) u(dt, t, p);
  };

  ctx.onProgress?.(1);
  return sys;
}

export { has, load };
