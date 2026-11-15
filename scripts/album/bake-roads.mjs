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
// For the bake the page lays the network on the fine heights of the mountains (public/album-data/h11, a point every
// 57 m; at an ordinary start it keeps a point every 230 m in memory): album.roadNet.rebake(). A road finds the floor
// of a gorge that the coarse heights do not have, and the height of a pass in the list is the height of the ground
// as it is drawn there. Without the tiles (node scripts/worktree-setup.mjs brings them) the bake is refused.
// Run from Git Bash (the harness is a bash script).
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), A = process.argv[2];
if (!A) { console.error('usage: node scripts/album/bake-roads.mjs <folder outside the repository> [--no-build]'); process.exit(1); }
const dir = resolve(A).replace(/\\/g, '/'), run = (...args) => spawnSync('bash', ['scripts/harness.sh', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
mkdirSync(dir, { recursive: true });
if (!existsSync(join(ROOT, 'public', 'album-data', 'h11'))) { console.error('no fine heights here (public/album-data/h11): run node scripts/worktree-setup.mjs first'); process.exit(1); }
if (!process.argv.includes('--no-build')) { const b = run('build', dir); process.stdout.write(b.stdout || ''); if (b.status) { console.error(b.stderr); process.exit(1); } }
// what the page is asked: the network as the file keeps it, and whether it had to lay it
const ev = join(dir, 'bake-roads-eval.js').replace(/\\/g, '/');
writeFileSync(ev, `(async () => { const t0 = performance.now(), tiles = await window.__album.roadNet.rebake(), n = window.__album.roadNet; return 'ROADS' + JSON.stringify({ sig: n.signature(), tiles, ms: Math.round(performance.now() - t0), since: Math.round(performance.now()), stats: n.stats, fords: n.fords.length, banks: n.banks, b64: n.encode() }); })()`);
const t0 = Date.now(), r = run('acap', dir, 'bake-roads', 'page=map&ui=0&dpr=1&bakeroads=1', '800', '450', ev), at = (r.stdout || '').indexOf('ROADS{');
// (the window of the harness lives 240 s: a bake that needs longer is cut off there and gives nothing)
if (at < 0) { console.error('the page gave no roads' + (Date.now() - t0 > 235e3 ? ' — the window of the harness was closed after 240 s (scripts/harness.sh, acap: timeout 240); the bake needs longer' : '') + ':\n' + (r.stdout || '').slice(-1500) + (r.stderr || '')); process.exit(1); }
const end = r.stdout.indexOf('\n', at), got = JSON.parse(r.stdout.slice(at + 5, end < 0 ? undefined : end).trim());
const out = join(ROOT, 'public', 'assets', 'album', 'roads', 'roads.bin.gz'); mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(Buffer.from(got.b64, 'base64'), { level: 9 }));
const s = got.stats;
console.log(`laid on ${got.tiles} fine tiles (those under the roads): ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${s.capitals} towns of provinces, ${got.fords} river crossings, ${s.unreached} districts without a road, ${s.shaped} legs shaped, ${got.banks.km} km on the banks of rivers, ${s.passes.join(' + ')} passes`);
console.log(`signature ${got.sig} → ${out} (${statSync(out).size} bytes); the laying on the fine heights took ${(got.ms / 1000).toFixed(0)} s, the page ${(got.since / 1000).toFixed(0)} s from its start, the window with its turn in the queue ${((Date.now() - t0) / 1000).toFixed(0)} s`);

