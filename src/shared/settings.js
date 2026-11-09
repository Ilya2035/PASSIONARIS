// Settings live in Electron's userData (via preload bridge) or localStorage in a plain browser.
export const DEFAULT_SETTINGS = {
  windowMode: 'fullscreen',   // 'fullscreen' | 'maximized' | 'window'
  quality: 'high',            // mesh density: 'low' | 'medium' | 'high'
  pixelRatio: 1,              // render scale
  reliefScale: 1,             // multiplier for terrain exaggeration
  unroll: 0.85,               // 0 = always a globe, 1 = almost flat when zoomed in
  showDistricts: true,
  showRivers: true,
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
