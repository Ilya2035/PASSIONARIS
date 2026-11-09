// Settings live in Electron's userData (via preload bridge) or localStorage in a plain browser.
export const DEFAULT_SETTINGS = {
  windowMode: 'fullscreen',   // 'fullscreen' | 'maximized' | 'window'
  quality: 'high',            // mesh density: 'low' | 'medium' | 'high'
  pixelRatio: 1,              // legacy render scale multiplier
  renderScale: 1,             // 0.5..1: render at lower resolution, upscale with sharpening (FSR-like)
  sharpen: 0.35,              // sharpening strength for the upscale pass
  brightness: 1,              // 0.7..1.3
  reliefScale: 1,             // vertical scale: 1 = true 1:1 proportions
  unroll: 0.85,               // 0 = always a globe, 1 = almost flat when zoomed in
  showDistricts: true,
  showRivers: true,
  showCurrents: true,
  showLabels: true,
  showRoads: true,
  showWeather: true,          // clouds, snow, drought tint
  effects: true,              // eruptions, quakes, meteors, fires
  waterAnimation: true,
  autosaveMinutes: 10,        // 0 = off
  autosaveSlots: 3,
  showFps: false,
  palette: 'graphite',        // see src/shared/palettes.js
};

const KEY = 'passionaris.settings';
const bridge = typeof window !== 'undefined' ? window.passionaris : undefined;

export async function loadSettings() {
  try {
    if (bridge?.getSettings) return { ...DEFAULT_SETTINGS, ...(await bridge.getSettings()) };
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
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
