// Procedural "crapinka" (stipple / speckle) textures for the UI, generated once at start-up.
// The look: soft gradient + dense fine dots, darker towards the bottom (gives volume), like a printed canvas.

function rng(s) {
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stippleDataUrl({ w = 256, h = 128, top, bottom, dark = 'rgba(60,40,20,.32)', light = 'rgba(255,250,236,.42)', density = 0.45, seed = 1 }) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const R = rng(seed);
  for (let i = 0; i < w * h * density; i++) {
    const y = R() * h;
    c.fillStyle = R() < y / h ? dark : light;
    c.fillRect(R() * w, y, 1, 1);
  }
  return cv.toDataURL('image/png');
}

// Sets CSS custom properties used by theme.css (.paper, .btn.primary, .hex …)
export function applyStippleTheme() {
  const root = document.documentElement.style;
  const set = (name, opts) => root.setProperty(name, `url("${stippleDataUrl(opts)}")`);
  set('--tex-paper', { w: 320, h: 320, top: '#f1ebdf', bottom: '#e2d8c5', dark: 'rgba(110,85,55,.16)', light: 'rgba(255,255,255,.5)', density: 0.35, seed: 3 });
  set('--tex-bronze', { w: 256, h: 64, top: '#ead4a6', bottom: '#b58a52', density: 0.5, seed: 5 });
  set('--tex-stone', { w: 256, h: 64, top: '#e9e3d5', bottom: '#bdb39e', density: 0.45, seed: 7 });
  set('--tex-ink', { w: 256, h: 256, top: '#1f1d1a', bottom: '#1f1d1a', dark: 'rgba(0,0,0,.35)', light: 'rgba(255,240,215,.07)', density: 0.4, seed: 9 });
}
