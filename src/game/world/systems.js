// Integration hub: wires the independent world modules (time, climate, weather, hazards, fx, saves)
// into the game. Every module is optional — import.meta.glob only resolves files that exist, so the game
// keeps running while modules are still being built.
const OPT = import.meta.glob([
  '../../sim/calendar.js', '../../sim/clock.js',
  '../../sim/climate/*.js', '../../sim/weather/client.js',
  '../../sim/hazards/*.js',
  '../fx/*.js',
  '../../save/*.js',
]);
import { loadBiomes } from './biomes.js';
import { createTime } from './time.js';
import { createClimate } from './climate.js';
import { createHazards } from './hazards.js';

const has = p => !!OPT[p];
const load = async p => (OPT[p] ? OPT[p]() : null);

export async function createWorldSystems(ctx) {
  const { hud, globe } = ctx;
  const features = new Set();
  const updaters = [];
  let mode = 'terrain';
  const sys = {
    features,
    onModeChange(id) { mode = id; },
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
    let kicker;
    if (biomes && cell >= 2) {
      const b = biomes.at(geo.lat, geo.lon);
      if (b) { kicker = b.nameRu; rows.push(['Местность', b.nameRu]); }
    }
    if (sys.climate) rows.push(...sys.climate.describe(geo.lat, geo.lon));
    if (sys.hazards && mode === 'hazards') rows.push(...sys.hazards.describe(geo.lat, geo.lon));
    return { kicker, rows, tip: kicker };
  };

  // ---- time, saves, autosave
  const [cal, clk, save] = await Promise.all([load('../../sim/calendar.js'), load('../../sim/clock.js'), load('../../save/index.js')]);
  if (cal && clk && save) {
    const time = createTime({ cal, clk, save, hud, settings: ctx.settings });
    sys.time = time;
    sys.clock = time.clock;
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

  const running = () => !!sys.time?.running;
  sys.update = (dt, t, p) => {
    sys.time?.update(dt);
    sys.hazards?.update(dt, running());
    sys.fx?.update(ctx.gcam, t, { running: running(), heightPx: ctx.renderHeight?.(), fov: ctx.camera?.fov });
    for (const u of updaters) u(dt, t, p);
  };

  ctx.onProgress?.(1);
  return sys;
}

export { has, load };
