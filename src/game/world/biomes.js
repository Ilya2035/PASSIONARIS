// Terrain-mode colours for the climate module's biome classes (public/assets/climate/biomes.json).
// Clear, pleasant, slightly saturated period tones — the approved map style.
export const BIOME_COLORS = {
  water: '#8e9a9c',
  ice: '#eeede8',
  tundra: '#b7bba4',
  taiga: '#6e8768',
  temperate_forest: '#8ba26e',
  steppe: '#cfc68c',
  mediterranean: '#b7aa72',
  desert: '#ead7a3',
  semi_desert: '#dcc591',
  savanna: '#cbb26c',
  tropical_forest: '#4f7d55',
  wetland: '#829a8c',
  highland: '#a8a090',
};

const hexToRgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

// Loads the biome raster and hands it to the globe. Returns { classes, W, H, at(g) } or null when absent.
export async function loadBiomes(globe, base = 'assets/climate/') {
  const meta = await fetch(`${base}biomes.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta) return null;
  const { W, H } = meta.grid;
  const data = await fetchBytes(`${base}${meta.file || 'biome.bin.gz'}`);
  const colors = [];
  for (const c of meta.classes) colors[c.id] = hexToRgb(BIOME_COLORS[c.key] || c.color || '#cccccc');
  for (let i = 0; i < 16; i++) if (!colors[i]) colors[i] = [0.8, 0.8, 0.75];
  globe.setBiomes(data, W, H, colors);
  const byId = [];
  for (const c of meta.classes) byId[c.id] = c;
  return {
    meta, data, W, H,
    at(lat, lon) {
      const x = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / 360 * W)));
      const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
      return byId[data[y * W + x]] || null;
    },
  };
}
