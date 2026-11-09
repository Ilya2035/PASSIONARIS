// Loads the baked hazard catalogues (public/assets/hazards/) in the browser (fetch) or in
// Node (fs). Returns the `data` object expected by createScheduler({data, seed}).
//
//   Browser: const data = await loadHazards();                       // base 'assets/hazards/'
//   Node:    const data = await loadHazards({ dir: 'public/assets/hazards' });

export const HAZARD_FILES = ['volcanoes.json', 'eruptions.json', 'earthquakes.json', 'tsunamis.json', 'meteorites.json', 'hazardLevels.json'];
const LEVELS_BIN = 'hazardLevels.bin.gz';

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

/**
 * @param {object} [opts]
 * @param {string} [opts.base='assets/hazards/']  URL prefix for fetch (browser)
 * @param {string} [opts.dir]                      directory for fs (Node); default public/assets/hazards
 * @param {(f: number) => void} [opts.onProgress]  0..1
 * @param {typeof fetch} [opts.fetch]              custom fetch (tests)
 */
export async function loadHazards(opts = {}) {
  const useFs = opts.dir != null || (isNode && !opts.fetch && opts.base == null);
  const files = useFs ? await nodeReader(opts.dir) : fetchReader(opts.base ?? 'assets/hazards/', opts.fetch ?? globalThis.fetch);
  let done = 0;
  const tick = () => opts.onProgress?.(++done / (HAZARD_FILES.length + 1));
  const [volcanoes, eruptions, earthquakes, tsunamis, meteorites, levelsMeta, levelsBin] = await Promise.all([
    ...HAZARD_FILES.map(f => files.json(f).then(j => { tick(); return j; })),
    files.gz(LEVELS_BIN).then(b => { tick(); return b; }),
  ]);
  return { volcanoes, eruptions, earthquakes, tsunamis, meteorites, levels: decodeLevels(levelsMeta, levelsBin) };
}

/** Splits the concatenated Uint8 level layers into named views. */
export function decodeLevels(meta, bytes) {
  const n = meta.layerBytes;
  if (bytes.length < n * meta.layers.length) throw new Error(`hazardLevels: expected ${n * meta.layers.length} bytes, got ${bytes.length}`);
  const layers = {};
  for (const l of meta.layers) layers[l.name] = bytes.subarray(l.offset, l.offset + n);
  // place-name index per SIM cell
  const place = new Uint16Array(n);
  if (layers.placeLo && layers.placeHi) for (let i = 0; i < n; i++) place[i] = layers.placeLo[i] | (layers.placeHi[i] << 8);
  return { meta, layers, place, width: meta.grid.width, height: meta.grid.height };
}

function fetchReader(base, fetchFn) {
  if (!base.endsWith('/')) base += '/';
  const bytes = async f => {
    const res = await fetchFn(base + f);
    if (!res.ok) throw new Error(`${base + f}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    json: async f => JSON.parse(new TextDecoder().decode(await bytes(f))),
    gz: async f => {
      const b = await bytes(f);
      // a dev server may already have decoded the gzip transfer
      if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
      const ds = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    },
  };
}

async function nodeReader(dir) {
  // specifiers are built at runtime so that browser bundlers never try to resolve them
  const fsName = 'node:' + 'fs/promises', zName = 'node:' + 'zlib', pName = 'node:' + 'path', uName = 'node:' + 'url';
  const [fs, zlib, path, url] = await Promise.all([
    import(/* @vite-ignore */ fsName), import(/* @vite-ignore */ zName), import(/* @vite-ignore */ pName), import(/* @vite-ignore */ uName),
  ]);
  const root = dir ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..', 'public', 'assets', 'hazards');
  return {
    json: async f => JSON.parse(await fs.readFile(path.join(root, f), 'utf8')),
    gz: async f => {
      const b = await fs.readFile(path.join(root, f));
      const out = b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b;
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    },
  };
}
