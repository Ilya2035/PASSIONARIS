// Prepares a git worktree of Passionaris so the game builds and runs there. A worktree only gets the tracked
// files; the big generated data (map, terrain, climate normals) and node_modules are gitignored. This copies the
// data from the main checkout and installs node_modules from the npm cache. Nothing in the main checkout changes.
//
//   node scripts/worktree-setup.mjs            (run inside the worktree; node: <main checkout>/tools/node/node.exe)
//
// Copies, not links: a worktree deleted later can never take the main checkout's files with it.
// .env.local (tokens) is NOT copied — scripts/release.mjs reads it from the main checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, cpSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const HERE = git(['rev-parse', '--show-toplevel'], process.cwd());
const MAIN = git(['worktree', 'list', '--porcelain'], HERE).split('\n').find(l => l.startsWith('worktree ')).slice(9).trim();
if (resolve(HERE) === resolve(MAIN)) { console.log('this is the main checkout — nothing to set up'); process.exit(0); }
console.log(`worktree ${HERE}\nmain     ${MAIN}`);

// 1. gitignored data the game needs (skip build output, secrets, logs, raw downloads, tools, drafts)
// (data/album/ is the raw material of the album's bakes — OpenStreetMap extracts, height tiles: gigabytes that only
// a session that bakes needs; it copies the piece it needs itself)
const SKIP = /^(dist\/|node_modules\/|tools\/|data\/raw\/|data\/album\/|art\/drafts\/|\.env|\.claude\/)|\.log$/;
const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], MAIN)
  .split('\n').filter(p => p && !SKIP.test(p));
let files = 0, bytes = 0;
function copy(src, dst) {
  const s = statSync(src);
  if (s.isDirectory()) { mkdirSync(dst, { recursive: true }); for (const n of readdirSync(src)) copy(join(src, n), join(dst, n)); return; }
  try { const d = statSync(dst); if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return; } catch { /* new */ }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { preserveTimestamps: true });
  files++; bytes += s.size;
}
for (const p of ignored) copy(join(MAIN, p), join(HERE, p));
// the few raw downloads the tests read (the rest of data/raw/ stays in the main checkout); release.mjs runs every
// test inside the worktree, so without these the river-border checks of tests/regions.test.mjs would be skipped
const RAW_FOR_TESTS = ['data/raw/ne_10m_rivers_lake_centerlines.geojson'];
for (const p of RAW_FOR_TESTS) {
  if (existsSync(join(MAIN, p))) copy(join(MAIN, p), join(HERE, p));
  else console.log(`data: ${p} is not in the main checkout (scripts/download-data.mjs) — its checks will be skipped`);
}
console.log(`data: ${files} files copied (${(bytes / 1e6).toFixed(0)} MB)`);

// 2. node_modules from the npm cache (same lockfile as main; electron and sharp binaries come from their caches)
if (!existsSync(join(HERE, 'node_modules', 'vite'))) {
  const nodeDir = join(MAIN, 'tools', 'node');
  const npmCli = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const nodeExe = existsSync(join(nodeDir, 'node.exe')) ? join(nodeDir, 'node.exe') : process.execPath;
  console.log('node_modules: npm ci --prefer-offline …');
  const r = spawnSync(nodeExe, [existsSync(npmCli) ? npmCli : 'npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: HERE, stdio: 'inherit', env: { ...process.env, PATH: nodeDir + (process.platform === 'win32' ? ';' : ':') + process.env.PATH },
  });
  if (r.status !== 0) { console.error('npm ci failed'); process.exit(1); }
} else console.log('node_modules: already there');
// the Electron binary comes from its own install script (from %LOCALAPPDATA%\electron\Cache); npm may skip it
if (!existsSync(join(HERE, 'node_modules', 'electron', 'dist'))) {
  console.log('electron: fetching the runtime from its cache …');
  const r = spawnSync(process.execPath, [join(HERE, 'node_modules', 'electron', 'install.js')], { cwd: join(HERE, 'node_modules', 'electron'), stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(join(HERE, 'node_modules', 'electron', 'dist'))) { console.error('electron runtime missing'); process.exit(1); }
}
console.log(`\nready. Node: "${join(MAIN, 'tools', 'node')}" — checks: bash scripts/harness.sh …, release: node scripts/release.mjs …`);
