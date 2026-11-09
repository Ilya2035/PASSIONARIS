// Palettes: one source of truth for UI (CSS variables) and the map shader (uniforms).
// Mood: soft, 20th-century, archival — neutral tones, not copying any Paradox game.
export const PALETTES = {
  graphite: {
    name: 'Графит и бумага',
    ui: {
      '--ink': '#121211', '--ink-2': '#1b1a18', '--panel': 'rgba(25, 24, 22, 0.93)', '--panel-solid': '#1b1a18',
      '--accent': '#b3a37f', '--accent-hi': '#dccfae', '--accent-soft': 'rgba(179, 163, 127, 0.3)',
      '--text': '#e8e3d7', '--text-dim': '#b7b1a3', '--muted': '#878275',
      '--btn-top': '#ebe5d6', '--btn-bottom': '#c4bba6', '--btn-text': '#1b1a17',
    },
    map: {
      paper: [0.79, 0.78, 0.7], paperDark: [0.52, 0.5, 0.45], forest: [0.56, 0.58, 0.5], desert: [0.91, 0.87, 0.77],
      snow: [0.95, 0.94, 0.91], shallow: [0.62, 0.66, 0.66], deep: [0.33, 0.37, 0.39], lake: [0.55, 0.6, 0.61],
      ink: [0.13, 0.12, 0.11], river: [0.38, 0.44, 0.47], select: [0.86, 0.74, 0.47], space: [0.045, 0.045, 0.043], haze: [0.78, 0.77, 0.73],
    },
  },
  sepia: {
    name: 'Архивная сепия',
    ui: {
      '--ink': '#16120d', '--ink-2': '#211b14', '--panel': 'rgba(33, 27, 20, 0.93)', '--panel-solid': '#211b14',
      '--accent': '#b48a5a', '--accent-hi': '#e0bf8d', '--accent-soft': 'rgba(180, 138, 90, 0.3)',
      '--text': '#eadfca', '--text-dim': '#bfb096', '--muted': '#8c7d66',
      '--btn-top': '#ecdcbc', '--btn-bottom': '#c6aa7c', '--btn-text': '#21180f',
    },
    map: {
      paper: [0.77, 0.71, 0.57], paperDark: [0.5, 0.43, 0.34], forest: [0.55, 0.52, 0.4], desert: [0.91, 0.83, 0.66],
      snow: [0.95, 0.92, 0.86], shallow: [0.63, 0.64, 0.58], deep: [0.33, 0.34, 0.31], lake: [0.55, 0.57, 0.52],
      ink: [0.16, 0.11, 0.07], river: [0.4, 0.42, 0.4], select: [0.85, 0.6, 0.35], space: [0.05, 0.04, 0.03], haze: [0.8, 0.74, 0.64],
    },
  },
  lead: {
    name: 'Холодный свинец',
    ui: {
      '--ink': '#101214', '--ink-2': '#181b1e', '--panel': 'rgba(23, 26, 29, 0.93)', '--panel-solid': '#181b1e',
      '--accent': '#8fa6a3', '--accent-hi': '#c4d6d2', '--accent-soft': 'rgba(143, 166, 163, 0.3)',
      '--text': '#e4e6e3', '--text-dim': '#aeb3b1', '--muted': '#7d8483',
      '--btn-top': '#e2e6e3', '--btn-bottom': '#b3bcb9', '--btn-text': '#15181a',
    },
    map: {
      paper: [0.75, 0.76, 0.72], paperDark: [0.48, 0.49, 0.48], forest: [0.52, 0.56, 0.52], desert: [0.89, 0.87, 0.8],
      snow: [0.95, 0.96, 0.95], shallow: [0.58, 0.64, 0.66], deep: [0.27, 0.32, 0.36], lake: [0.5, 0.57, 0.6],
      ink: [0.1, 0.11, 0.12], river: [0.32, 0.41, 0.46], select: [0.75, 0.82, 0.8], space: [0.035, 0.04, 0.045], haze: [0.74, 0.77, 0.78],
    },
  },
};
export const DEFAULT_PALETTE = 'graphite';

export function getPalette(id) { return PALETTES[id] || PALETTES[DEFAULT_PALETTE]; }

export function applyUiPalette(id) {
  const p = getPalette(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p.ui)) root.style.setProperty(k, v);
  root.dataset.palette = id in PALETTES ? id : DEFAULT_PALETTE;
}
