// Bakes the texels of the division (division/bake.js) into public/assets/album/division/cells-<size>.bin.gz: builds
// the division in Node from the same data the page reads, the way the page builds it, and writes the district and the
// province of every square of 1 km². Run it after anything the division is built from has changed (the heights, the
// rivers, the lakes, the natural cells, lands.json, admin.json, the rules of cells.js); the test
// tests/album-division-bake.test.mjs says when the file is behind. Only Node.
//   node src/album/division/bake-cells.mjs [size …]     (default 20; the knob offers 20, 30, 50, 100)
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chunks } from '../chunks.js';
import { buildDivision } from './build.js';
import { loadAlbumData } from './nodedata.js';
import { encodeCells } from './bake.js';
import { KN, KNY } from './km.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// the division as the page builds it (main.js: the natural cells with the lakes of the water; division/runtime.js)
export function nodeDivision(root = ROOT, size = 20, baked = null, keepClaim = false) {
  const data = loadAlbumData(root); if (!data) throw new Error('no album data (public/album-data)');
  const lakes = (() => { try { return JSON.parse(readFileSync(join(root, 'public/assets/album/water/lakes.json'), 'utf8')).lakes.filter(l => !l.shoal && l.ring); } catch { return []; } })();
  const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
  const j = f => JSON.parse(readFileSync(join(root, 'public/assets/album/division', f), 'utf8'));
  return { ch, data, div: buildDivision(ch, { lands: j('lands.json'), admin: j('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size, baked, keepClaim }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  for (const size of sizes.length ? sizes : [20]) {
    const t = performance.now(), { div } = nodeDivision(ROOT, size, null, true);
    const raw = encodeCells({ size, stamp: div.stamp, cells: div.claim, prov: div.provCells, width: KN, height: KNY }), gz = gzipSync(raw, { level: 9 });
    const out = join(ROOT, `public/assets/album/division/cells-${size}.bin.gz`);
    writeFileSync(out, gz);
    console.log(`districts of ${size} km: ${div.count}, ${KN} × ${KNY} texels, stamp ${div.stamp} → ${out} (${(gz.length / 1024).toFixed(0)} KB, ${((performance.now() - t) / 1000).toFixed(1)} s)`);
  }
}
