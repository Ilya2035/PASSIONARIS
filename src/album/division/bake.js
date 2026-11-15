// The texels of a division baked into a file (division/bake-cells.mjs): the district and the province of every square
// of 1 km², as the claim of cells.js works them out (before the borders move a few squares, border.js). That claim is
// the dear part of the division — 2–3 s on the polygon
// of today, about 9 s on that of stage 3 — and its result depends only on the land, so the page reads it from
// public/assets/album/division/cells-<size>.bin.gz instead of working it out. It is taken only when its stamp is the
// stamp of the land as it is now (cells.js cellsStamp); otherwise the page works the texels out as before.
// The file, unpacked: Uint32 length of the head, the head (JSON: rule, size, stamp, n, width, height), padded to four
// bytes, then the districts and the provinces of the n squares, Int16 each (−1 none).

const MAGIC = 'passionaris-division-cells';

// → Uint8Array (to be gzipped by the caller)
export function encodeCells({ size, stamp, cells, prov, width, height }) {
  const n = cells.length;
  for (const a of [cells, prov]) for (let t = 0; t < n; t++) if (a[t] < -1 || a[t] > 32767) throw new Error(`bake: ${a[t]} does not fit in 16 bits`);
  const head = new TextEncoder().encode(JSON.stringify({ magic: MAGIC, rule: 1, size, stamp, n, width, height }));
  const at = 4 + Math.ceil(head.length / 4) * 4, out = new Uint8Array(at + n * 4);
  new DataView(out.buffer).setUint32(0, head.length, true); out.set(head, 4);
  const c = new Int16Array(out.buffer, at, n), p = new Int16Array(out.buffer, at + n * 2, n);
  for (let t = 0; t < n; t++) { c[t] = cells[t]; p[t] = prov[t]; }
  return out;
}

// buf: ArrayBuffer of the unpacked file → { size, stamp, n, width, height, cells: Int16Array, prov: Int16Array }, or
// null when it is not such a file
export function decodeCells(buf) {
  if (!buf || buf.byteLength < 8) return null;
  const len = new DataView(buf).getUint32(0, true); if (len > 4096 || 4 + len > buf.byteLength) return null;
  let head; try { head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))); } catch { return null; }
  if (head.magic !== MAGIC) return null;
  const at = 4 + Math.ceil(len / 4) * 4, n = head.n; if (at + n * 4 > buf.byteLength) return null;
  return { ...head, cells: new Int16Array(buf.slice(at, at + n * 2)), prov: new Int16Array(buf.slice(at + n * 2, at + n * 4)) };
}

// in the page: the baked texels of districts of this size, or null when there are none
export async function loadCells(size, url = `assets/album/division/cells-${size}.bin.gz`) {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    return decodeCells(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  } catch { return null; }
}
