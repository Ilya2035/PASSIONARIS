// Lays the roads of the album once and keeps them in public/assets/album/roads/roads.bin.gz, so that the page does
// not work the network out at every start (the owner, 13.11.2026: «нужно прочертить все дороги заранее»).
//
//   node scripts/album/bake-roads.mjs <folder for the check, outside the repository> [--no-build]
//
// The network is laid by the page itself (src/album/roads/routes.js) and read back from it: the file is good for one
// division only — the districts, the points of their towns, the towns of the provinces — and only the page has all
// of that exactly as the game will have it (the settlements move their sites off the rivers before the land is
// divided). So this script builds the pages, opens the album once through scripts/harness.sh and saves what it laid.
// Run it again whenever the division changes; until then the page notices that the file is for another division
// (netSignature) and lays the roads itself at the start, which costs it a second.
//
// The heights of the passes are then read anew from the fine heights of the mountains (public/album-data/h11, a
// point every 57 m; the page lays the roads by the heights it keeps in memory, a point every 230 m): the height of a
// pass in the list is the height of the ground as it is drawn there. A pass outside the fine tiles keeps its height.
// Run from Git Bash (the harness is a bash script).
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), A = process.argv[2];
if (!A) { console.error('usage: node scripts/album/bake-roads.mjs <folder outside the repository> [--no-build]'); process.exit(1); }
const dir = resolve(A).replace(/\\/g, '/'), run = (...args) => spawnSync('bash', ['scripts/harness.sh', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
mkdirSync(dir, { recursive: true });
if (!process.argv.includes('--no-build')) { const b = run('build', dir); process.stdout.write(b.stdout || ''); if (b.status) { console.error(b.stderr); process.exit(1); } }
// what the page is asked: the network as the file keeps it, and whether it had to lay it
const ev = join(dir, 'bake-roads-eval.js').replace(/\\/g, '/');
writeFileSync(ev, `(() => { const n = window.__album.roadNet; return 'ROADS' + JSON.stringify({ sig: n.signature(), fromFile: n.fromFile, stats: n.stats, fords: n.fords.length, b64: n.encode() }); })()`);
const r = run('acap', dir, 'bake-roads', 'page=map&ui=0&dpr=1', '800', '450', ev), at = (r.stdout || '').indexOf('ROADS{');
if (at < 0) { console.error('the page gave no roads:\n' + (r.stdout || '').slice(-1500) + (r.stderr || '')); process.exit(1); }
const end = r.stdout.indexOf('\n', at), got = JSON.parse(r.stdout.slice(at + 5, end < 0 ? undefined : end).trim());
const out = join(ROOT, 'public', 'assets', 'album', 'roads', 'roads.bin.gz'); mkdirSync(dirname(out), { recursive: true });
const fixed = await finePasses(Buffer.from(got.b64, 'base64'));
writeFileSync(out, gzipSync(fixed.buf, { level: 9 }));
const s = got.stats;
console.log(`${got.fromFile ? 'the file was up to date' : 'laid anew'}: ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${s.capitals} towns of provinces, ${got.fords} river crossings, ${s.unreached} districts without a road`);
console.log(fixed.note);
console.log(`signature ${got.sig} → ${out} (${statSync(out).size} bytes)`);

// The network as the page gave it, with the heights of its passes read from the fine tiles → { buf, note }
async function finePasses(buf) {
  const imp = f => import(pathToFileURL(join(ROOT, f)).href), { llOf } = await imp('src/album/chunks.js'), { decodeTile, FINE_Z } = await imp('src/album/ground/fine.js');
  const dir = join(ROOT, 'public', 'album-data', 'h11'), N = 2 ** FINE_Z, tiles = new Map();
  if (!existsSync(dir)) return { buf, note: 'no fine heights here (public/album-data/h11): the passes keep the heights of the page — node scripts/worktree-setup.mjs brings the tiles' };
  const tile = (x, y) => { const k = x + '_' + y; if (!tiles.has(k)) { const f = join(dir, k + '.u16d.gz'); if (!existsSync(f)) tiles.set(k, null); else { const b = gunzipSync(readFileSync(f)); tiles.set(k, decodeTile(new Uint16Array(b.buffer, b.byteOffset, 65536))); } } return tiles.get(k); };
  const pt = (i, j) => { const t = tile(Math.floor(i / 256), Math.floor(j / 256)); return t ? t[(j & 255) * 256 + (i & 255)] / 4 - 8192 : null; };
  const fineAt = (lat, lon) => {                                 // metres between the four points around, or null where a tile is missing
    const mx = (lon + 180) / 360 * N * 256 - .5, s = Math.sin(lat * Math.PI / 180), my = (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N * 256 - .5;
    const i = Math.floor(mx), j = Math.floor(my), fx = mx - i, fy = my - j, a = pt(i, j), b = pt(i + 1, j), c = pt(i, j + 1), d = pt(i + 1, j + 1);
    return a === null || b === null || c === null || d === null ? null : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), hl = dv.getUint32(0, true), head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl)));
  let n = 0, sum = 0, most = 0;
  for (const q of head.passes || []) { const p = llOf(q[1] / 100, q[2] / 100), f = fineAt(p.lat, p.lon); if (f === null) continue; const d = Math.abs(f - q[3]); n++; sum += d; most = Math.max(most, d); q[3] = Math.round(f); }
  const hb = Buffer.from(JSON.stringify(head)), len = Buffer.alloc(4); len.writeUInt32LE(hb.length);
  return { buf: Buffer.concat([len, hb, buf.subarray(4 + hl)]), note: `passes: ${n} of ${(head.passes || []).length} take their height from the fine heights (it moved by ${n ? (sum / n).toFixed(1) : 0} m on average, ${most.toFixed(0)} m at most)` };
}
