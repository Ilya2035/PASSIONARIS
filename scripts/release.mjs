// Releases one version of Passionaris (docs/VERSIONING.md), the same way from the main checkout or from a git worktree:
//   1. (worktree/branch) commits leftover work and rebases the branch onto the local main
//   2. bumps package.json (ШАГ by default, --update → ОБНОВЛЕНИЕ), adds the CHANGELOG.md entry
//   3. builds, runs the tests, commits "vX.Y.Z — <title>", tags vX.Y.Z
//   4. (worktree/branch) fast-forwards main in the main checkout
//   5. pushes main + the tag to GitHub (token from the main checkout's .env.local), refreshes the installed copy
//
//   node scripts/release.mjs "<заголовок>" <entry.md> [--update] [--no-test] [--no-push] [--no-install]
//                            [--trailer "Co-Authored-By: …"]
//   <entry.md>: the changelog bullets only ("- …" lines, Russian); the "## [X.Y.Z] — date · title" header is added here.
//
// Releases are serialised through a lock file in the shared .git folder, so parallel sessions can each run this.
// Safety: refuses to commit WorldClim-derived files; pushes only main and the new tag (never refs/backup/*).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const REPO_URL = 'https://github.com/Ilya2035/PASSIONARIS.git';
const FORBIDDEN = /(^|\/)(normals|biome)\.bin\.gz$/;
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--trailer');
const [TITLE, ENTRY] = pos;
if (!TITLE || !ENTRY || !existsSync(ENTRY)) {
  console.error('usage: node scripts/release.mjs "<заголовок>" <entry.md> [--update] [--no-test] [--no-push] [--no-install] [--trailer "…"]');
  process.exit(1);
}
const TRAILER = opt('--trailer');

const git = (args, cwd = ROOT, quiet = false) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] }).trim();
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const MAIN = git(['worktree', 'list', '--porcelain']).split('\n').find(l => l.startsWith('worktree ')).slice(9).trim();
const BRANCH = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const onMain = BRANCH === 'main';
if (!onMain && resolve(ROOT) === resolve(MAIN)) { console.error(`release: the main checkout is on "${BRANCH}", expected main`); process.exit(1); }
const NODE_BIN = [join(ROOT, 'tools', 'node'), join(MAIN, 'tools', 'node')].find(d => existsSync(join(d, 'node.exe')) || existsSync(join(d, 'node'))) || dirname(process.execPath);
const env = { ...process.env, PATH: NODE_BIN + (process.platform === 'win32' ? ';' : ':') + process.env.PATH };
const node = (args, cwd = ROOT) => { const r = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' }); if (r.status !== 0) throw new Error(`node ${args.join(' ')} failed`); };
const step = s => console.log(`\n▸ ${s}`);

// ---- lock (shared by all worktrees: they have one common .git) ----
const COMMON = resolve(ROOT, git(['rev-parse', '--git-common-dir']));
const LOCK = join(COMMON, 'passionaris-release.lock');
async function lock() {
  for (let i = 0; i < 120; i++) {
    try { closeSync(openSync(LOCK, 'wx')); writeFileSync(LOCK, `${BRANCH} ${new Date().toISOString()}\n`); return; } catch { /* held */ }
    try { if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60e3) { rmSync(LOCK, { force: true }); continue; } } catch { continue; }
    if (i === 0) console.log(`release: waiting for another release (${readFileSync(LOCK, 'utf8').trim()})…`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('release: lock still held after 10 minutes');
}
const unlock = () => rmSync(LOCK, { force: true });

function stageAll() {
  git(['add', '-A']);
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const bad = staged.filter(f => FORBIDDEN.test(f));
  if (bad.length) { git(['reset', '-q']); throw new Error(`release: WorldClim-derived files must never be committed: ${bad.join(', ')}`); }
  return staged.length;
}
const commitMsg = title => ['-m', title, ...(TRAILER ? ['-m', TRAILER] : [])];

let restore = null;   // undo the version bump if the release fails before its commit
await lock();
try {
  if (!onMain) {
    step(`branch ${BRANCH}: commit leftovers, rebase onto main`);
    if (stageAll()) git(['commit', '-q', ...commitMsg(`wip: ${TITLE}`)]);
    const r = spawnSync('git', ['rebase', 'main'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      spawnSync('git', ['rebase', '--abort'], { cwd: ROOT, stdio: 'inherit' });
      throw new Error('release: rebase onto main has conflicts — resolve them (git rebase main), then run the release again');
    }
  }

  step('version and changelog');
  const pkgPath = join(ROOT, 'package.json');
  const pkgText = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgText);
  const [E, U, S] = pkg.version.split('.').map(Number);
  const V = flag('--update') ? `${E}.${U + 1}.0` : `${E}.${U}.${S + 1}`;
  if (git(['tag', '-l', `v${V}`])) throw new Error(`release: tag v${V} already exists`);
  pkg.version = V;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const d = new Date(), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const clPath = join(ROOT, 'CHANGELOG.md');
  const cl = readFileSync(clPath, 'utf8');
  restore = () => { writeFileSync(pkgPath, pkgText); writeFileSync(clPath, cl); };
  const entry = `## [${V}] — ${date} · ${TITLE}\n\n${readFileSync(ENTRY, 'utf8').trim()}\n\n`;
  const at = cl.indexOf('\n## [');
  writeFileSync(clPath, at < 0 ? cl.trimEnd() + '\n\n' + entry : cl.slice(0, at + 1) + entry + cl.slice(at + 1));
  console.log(`v${V}`);

  step('build');
  node([join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error']);
  if (!flag('--no-test')) {
    step('tests');
    const files = execFileSync('git', ['ls-files', 'tests/*.test.mjs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    node(['--test', '--test-concurrency=1', ...files]);
  }

  step('commit and tag');
  stageAll();
  git(['commit', '-q', ...commitMsg(`v${V} — ${TITLE}`)]);
  restore = null;
  git(['tag', `v${V}`]);

  if (!onMain) {
    step('fast-forward main in the main checkout');
    const r = spawnSync('git', ['merge', '--ff-only', '-q', BRANCH], { cwd: MAIN, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`release: could not fast-forward main in ${MAIN} (uncommitted changes there?). v${V} is committed on ${BRANCH}; fix and run: git -C "${MAIN}" merge --ff-only ${BRANCH}`);
  }

  if (!flag('--no-push')) {
    step('push to GitHub');
    const envFile = [join(MAIN, '.env.local'), join(ROOT, '.env.local')].find(existsSync);
    const token = envFile && (readFileSync(envFile, 'utf8').match(/^GITHUB_TOKEN=(.+)$/m) || [])[1]?.trim();
    if (!token) console.log('push skipped: no GITHUB_TOKEN in .env.local of the main checkout (ask the owner for a new token)');
    else {
      const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
      const r = spawnSync('git', ['-c', 'credential.helper=', '-c', `http.extraheader=AUTHORIZATION: basic ${auth}`,
        'push', '-q', REPO_URL, 'main', `refs/tags/v${V}`], { cwd: MAIN, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 300e3 });
      const out = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter(l => l && !/authorization/i.test(l) && !l.includes(token)).join('\n');
      if (out) console.log(out);
      if (r.status === 0) { git(['update-ref', 'refs/remotes/origin/main', 'main'], MAIN); console.log('pushed main + tag'); }
      else console.log('push FAILED (token expired? network?) — the version is committed and tagged locally');
    }
  }

  if (!flag('--no-install') && process.platform === 'win32') {
    step('refresh the installed game (desktop shortcut)');
    node([join(ROOT, 'scripts', 'install-local.mjs')]);
  }
  console.log(`\n✔ v${V} — ${TITLE}`);
} catch (e) {
  if (restore) { restore(); console.error('version bump undone (package.json, CHANGELOG.md)'); }
  console.error(`\n✖ ${e.message}`);
  process.exitCode = 1;
} finally {
  unlock();
}
