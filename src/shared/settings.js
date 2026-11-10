// Settings live in Electron's userData (via preload bridge) or localStorage in a plain browser.
export const DEFAULT_SETTINGS = {
  windowMode: 'fullscreen',   // 'fullscreen' | 'maximized' | 'window'
  quality: 'auto',            // mesh density: 'auto' | 'low' | 'medium' | 'high'
  pixelRatio: 1,              // legacy render scale multiplier
  renderScale: 'auto',        // 'auto' (dynamic resolution) or 0.5..1, upscaled with sharpening (FSR-like)
  sharpen: 0.35,              // sharpening strength for the upscale pass
  shaders: 'full',            // 'full' | 'simple' (cheaper terrain shading for weak GPUs)
  brightness: 1,              // 0.7..1.3
  reliefScale: 1,             // vertical scale: 1 = true 1:1 proportions
  unroll: 0.85,               // 0 = always a globe, 1 = almost flat when zoomed in
  showDistricts: true,
  showRivers: true,
  showCurrents: true,
  showLabels: true,
  showRoads: true,
  showWeather: true,          // clouds, snow, drought tint
  showWind: true,             // prevailing-wind streaks
  effects: true,              // eruptions, quakes, meteors, fires
  waterAnimation: true,
  autosaveMinutes: 10,        // 0 = off
  autosaveSlots: 3,
  showFps: false,
  gpu: 'discrete',            // Electron: force the discrete GPU on dual-GPU laptops ('auto' = system choice)
  palette: 'graphite',        // see src/shared/palettes.js
  packs: {},                  // mods / DLC on or off: {packId: true | false}; unset = the pack's default
};

const KEY = 'passionaris.settings';
const bridge = typeof window !== 'undefined' ? window.passionaris : undefined;

const SETTINGS_VERSION = 2;
function migrate(s) {
  // v2 (0.1.4): render scale and mesh quality became adaptive; older saved values are reset to 'auto'
  if (!s.settingsVersion || s.settingsVersion < 2) { delete s.renderScale; delete s.quality; delete s.reliefScale; }
  return { ...DEFAULT_SETTINGS, ...s, settingsVersion: SETTINGS_VERSION };
}

export async function loadSettings() {
  try {
    if (bridge?.getSettings) return migrate(await bridge.getSettings() || {});
    const raw = localStorage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s) {
  try {
    if (bridge?.setSettings) return await bridge.setSettings(s);
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable: keep in memory only */ }
}

export const isElectron = !!bridge?.isElectron;
