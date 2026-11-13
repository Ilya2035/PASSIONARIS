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
// Run from Git Bash (the harness is a bash script).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
writeFileSync(out, gzipSync(Buffer.from(got.b64, 'base64'), { level: 9 }));
const s = got.stats;
console.log(`${got.fromFile ? 'the file was up to date' : 'laid anew'}: ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${s.capitals} towns of provinces, ${got.fords} river crossings, ${s.unreached} districts without a road`);
console.log(`signature ${got.sig} → ${out} (${statSync(out).size} bytes)`);
