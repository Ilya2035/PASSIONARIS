// The division of the album in Node, for the notes of the division work (docs/album/division.md): builds it as the page
// does (districts of 20 km, along the rivers) and prints what the borders, the chunks and the centres are like.
//   node scripts/album/division-check.mjs [size]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks } from '../../src/album/chunks.js';
import { buildDivision, LAND } from '../../src/album/division/build.js';
import { loadAlbumData } from '../../src/album/division/nodedata.js';
import { KN } from '../../src/album/division/km.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = f => JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division', f), 'utf8'));
const data = loadAlbumData(ROOT); if (!data) { console.log('no album data (public/album-data)'); process.exit(1); }
const lakes = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'public/assets/album/water/lakes.json'), 'utf8')).lakes.filter(l => !l.shoal && l.ring); } catch { return []; } })();
const ch = new Chunks(data.base.at, data.vectors.rivers, lakes);
const size = +process.argv[2] || 20, t0 = performance.now();
const div = buildDivision(ch, { lands: json('lands.json'), admin: json('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size });
const g = div.geo;
console.log(`division ${size} km: ${div.count} districts, built in ${(performance.now() - t0).toFixed(0)} ms`);
console.log(`borders: ${g.lines.length} lines, ${g.count} pieces; lists ${g.list.length} entries; squares with a list ${g.num.reduce((s, v) => s + (v > 0), 0)}; most fours ${g.num.reduce((m, v) => Math.max(m, v), 0)}; clipped ${g.over}`);
const hist = new Map(); for (const v of g.num) if (v) hist.set(v, (hist.get(v) || 0) + 1); console.log('fours per square:', [...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + ':' + v).join(' '));
console.log(`chunks moved to the district their seed lies in: ${g.moved}`);
const num = new Int32Array(div.count); for (const d of div.cells) if (d >= 0) num[d]++;
const empty = []; for (let d = 0; d < div.count; d++) if (!num[d]) empty.push(d); console.log('districts without chunks:', empty.length, empty.slice(0, 10).join(' '));
const land = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) land.push(num[d]); land.sort((a, b) => a - b);
console.log(`land district chunks: min ${land[0]}, 10% ${land[land.length * .1 | 0]}, mid ${land[land.length >> 1]}, 90% ${land[land.length * .9 | 0]}, max ${land[land.length - 1]}`);
export { div, ch, data };
if (process.argv.includes('--moved')) {
  const { districtCells } = await import('../../src/album/division/cells.js');
  const c0 = districtCells(ch, div, { heightAt: data.base.at, rivers: data.vectors.rivers || [] }).cells, n0 = new Int32Array(div.count);
  for (const d of c0) if (d >= 0) n0[d]++;
  const rows = []; for (let d = 0; d < div.count; d++) if (div.kinds[d] === LAND) rows.push([d, n0[d], num[d], (num[d] - n0[d]) / Math.max(1, n0[d])]);
  rows.sort((a, b) => a[3] - b[3]);
  console.log('lost most:', rows.slice(0, 8).map(r => `${r[0]}:${r[1]}→${r[2]}`).join(' '));
  console.log('gained most:', rows.slice(-8).map(r => `${r[0]}:${r[1]}→${r[2]}`).join(' '));
  const small = rows.filter(r => r[1] < 60).map(r => `${r[0]}:${r[1]}→${r[2]}`); console.log('small before:', small.length, small.slice(0, 20).join(' '));
}
