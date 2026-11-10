// Time & saves integration: game clock (5000 BC → 2100), date/time HUD, speeds, pause, saves, autosave.
import { openSaves } from '../ui/menus.js';
import { requestMapSnapshot } from '../snapshot.js';

// the autosave settings, read live (the in-game menu changes them; odd stored values fall back to the defaults)
const autosaveMinutes = s => { const m = Number(s.autosaveMinutes ?? 10); return Number.isFinite(m) && m >= 0 ? m : 10; };
const autosaveSlots = s => { const k = Math.floor(Number(s.autosaveSlots ?? 3)); return Number.isFinite(k) && k >= 1 ? Math.min(k, 99) : 3; };

export function createTime({ cal, clk, save, hud, settings }) {
  const clock = clk.createClock({ t0: 0 }); // astronomical -4999-01-01 00:00, paused, speed 3 = 1 month/s in the first era
  let menuPaused = false;

  // ---- HUD: date always; hours only when time runs slower than ~a day per second
  let lastLabel = '', lastEra = '';
  function render(extra) {
    // the interface follows the epoch (paper tone, ink, contrast): see game.css body[data-era]
    const era = clock.era.id;
    if (era !== lastEra) { lastEra = era; document.body.dataset.era = era; }
    const rate = clock.rateOf(clock.speed);
    const date = cal.formatRu(clock.t, rate > 20 ? 'month' : 'day');
    const time = rate < 1.5 ? cal.formatRu(clock.t, 'hour') : `${clock.era.nameRu}`;
    const label = `${date}|${time}|${extra}|${clock.paused}|${clock.speed}`;
    if (label === lastLabel) return;
    lastLabel = label;
    hud.renderClock({ date, time: extra ? `${time} · ${extra}` : time }, clock.paused ? 0 : clock.speed);
  }

  function setSpeed(n) {
    if (n <= 0) { clock.togglePause(); return; }
    clock.setSpeed(n);
    clock.resume();
  }
  hud.onSpeedClick(setSpeed);

  // ---- saves
  const storage = save.createDefaultStorage();
  const registry = new save.SaveRegistry();
  registry.register('clock', { save: () => clock.serialize(), load: s => clock.deserialize(s) });
  const collect = () => ({ meta: { t: clock.t, dateText: cal.formatRu(clock.t, 'day') }, sections: registry.collect() });
  // every save carries a small picture of the map (meta.thumbnail) taken at the next drawn frame (src/game/snapshot.js)
  const thumbnail = () => requestMapSnapshot();
  const autosave = save.createAutosave({
    storage, collect, thumbnail,
    intervalMinutes: autosaveMinutes(settings), slots: autosaveSlots(settings),
    getGameTime: () => clock.t,
    onSaved: () => hud.toast('<b>Автосохранение</b> записано', 2500),
    onError: e => hud.toast(`<b>Автосохранение не удалось</b><br>${e.message || e}`, 6000),
  });
  autosave.init?.();

  const listeners = new Set();
  async function saveAs(name) {
    try {
      const id = save.slugSaveId(name);
      const data = collect();
      // the state as it is now; the sim runs on while the thumbnail waits for a frame and the file is compressed
      const sections = save.snapshotSections(data.sections);
      const thumb = await save.withTimeout(thumbnail, 3000);
      await save.saveGame(storage, id, { meta: { ...data.meta, ...(thumb ? { thumbnail: thumb } : {}), name }, sections });
      hud.toast(`<b>Сохранено</b> · ${hud.esc(name)}`, 2500);
    } catch (e) { hud.toast(`<b>Не удалось сохранить</b><br>${hud.esc(e.message || e)}`, 6000); }
  }
  async function loadId(id) {
    try {
      const s = await save.loadGame(storage, id);
      await registry.apply(s.sections);
      autosave.reset?.();
      lastLabel = '';
      for (const fn of listeners) fn(s);
      hud.toast(`<b>Загружено</b> · ${hud.esc(s.meta?.name || id)}`, 2500);
    } catch (e) { hud.toast(`<b>Не удалось загрузить</b><br>${hud.esc(e.message || e)}`, 6000); }
  }
  const api = {
    list: async () => (await storage.list()).sort((a, b) => (b.modified || 0) - (a.modified || 0)).map(s => ({
      id: s.id, name: s.meta?.name || s.id,
      meta: { dateText: s.meta?.dateText || (Number.isFinite(s.meta?.t) ? cal.formatRu(s.meta.t, 'day') : ''), saved: s.modified, thumbnail: s.meta?.thumbnail || null },
    })),
    save: name => saveAs(name),
    load: id => loadId(id),
    remove: id => storage.remove(id),
  };

  return {
    clock, registry, storage, autosave,
    get running() { return !clock.paused && !menuPaused; },
    update(dt) {
      clock.advance(menuPaused ? 0 : dt);
      const m = autosaveMinutes(settings), k = autosaveSlots(settings);
      if (m !== autosave.intervalMinutes) autosave.setIntervalMinutes(m);
      if (k !== autosave.slots) autosave.setSlots(k);
      autosave.tick();
    },
    render,
    setSpeed,
    togglePause: () => clock.togglePause(),
    pauseForMenu(open) { menuPaused = open; },
    openSaves: mode => openSaves(api, mode),
    quickSave: () => saveAs('Быстрое сохранение'),
    quickLoad: () => loadId(save.slugSaveId('Быстрое сохранение')),
    loadId,
    quickSaveId: save.slugSaveId('Быстрое сохранение'),
    onLoad: fn => listeners.add(fn),
    setAutosave(minutes) { const m = autosaveMinutes({ autosaveMinutes: minutes }); autosave.setIntervalMinutes(m); },
  };
}
