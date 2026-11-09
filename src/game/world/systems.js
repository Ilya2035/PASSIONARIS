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
const has = p => !!OPT[p];
const load = async p => (OPT[p] ? OPT[p]() : null);

export async function createWorldSystems(ctx) {
  const { hud } = ctx;
  const features = new Set();
  const sys = {
    features,
    liveInfo: false,
    update() {},
    renderClock(extra) { hud.renderClock({ date: '—', time: extra || '' }, 0); },
  };
  sys.available = Object.keys(OPT);
  ctx.onProgress?.(1);
  return sys;
}

export { has, load };
