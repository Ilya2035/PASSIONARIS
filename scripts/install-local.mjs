// Installs the built game for this Windows user, like an installer would:
//   %LOCALAPPDATA%\Programs\Passionaris\Passionaris.exe   (Electron runtime, renamed)
//   …\resources\app\{package.json, electron, dist, public}  (the game itself)
//   shortcuts "Passionaris" on the Desktop and in the Start menu.
// Saves and settings stay where they always were: %APPDATA%\Passionaris.
//
//   npm run build && node scripts/install-local.mjs [--no-shortcuts]
//
// Safety: only ever writes inside its own install folder (marked with .passionaris-install) and the two shortcut
// files; an existing folder or shortcut that is not ours is left alone.
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const LOCAL = process.env.LOCALAPPDATA;
if (process.platform !== 'win32' || !LOCAL) { console.error('install-local: Windows only'); process.exit(1); }
const TARGET = join(LOCAL, 'Programs', 'Passionaris');
const MARK = join(TARGET, '.passionaris-install');
const RUNTIME_SRC = join(ROOT, 'node_modules', 'electron', 'dist');
const APP = join(TARGET, 'resources', 'app');
const EXE = join(TARGET, 'Passionaris.exe');

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('install-local: run "npm run build" first'); process.exit(1); }
if (existsSync(TARGET) && !existsSync(MARK)) {
  console.error(`install-local: ${TARGET} exists and was not created by this installer — left untouched`);
  process.exit(1);
}
mkdirSync(TARGET, { recursive: true });
writeFileSync(MARK, 'Passionaris local install (scripts/install-local.mjs). Safe to delete this whole folder.\n');

// mirror src → dst: copy new/changed files, remove files that no longer exist in src (dst is ours)
let copied = 0, removed = 0;
function mirror(src, dst, skip = () => false) {
  mkdirSync(dst, { recursive: true });
  const want = new Set();
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    want.add(e.name);
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) { mirror(s, d); continue; }
    const ss = statSync(s);
    let same = false;
    try { const ds = statSync(d); same = ds.size === ss.size && ds.mtimeMs >= ss.mtimeMs; } catch { /* new */ }
    if (!same) { copyFileSync(s, d); copied++; }
  }
  for (const e of readdirSync(dst, { withFileTypes: true })) {
    if (want.has(e.name)) continue;
    rmSync(join(dst, e.name), { recursive: true, force: true });
    removed++;
  }
}

// 1. runtime (only when the Electron version changed)
const rtVersion = readFileSync(join(RUNTIME_SRC, 'version'), 'utf8').trim();
const rtMark = join(TARGET, '.runtime-version');
const haveRt = existsSync(rtMark) ? readFileSync(rtMark, 'utf8').trim() : '';
if (haveRt !== rtVersion || !existsSync(EXE)) {
  console.log(`runtime: Electron ${rtVersion}`);
  for (const e of readdirSync(RUNTIME_SRC, { withFileTypes: true })) {
    const s = join(RUNTIME_SRC, e.name);
    if (e.isDirectory()) mirror(s, join(TARGET, e.name), n => e.name === 'resources' && n === 'app');
    else copyFileSync(s, join(TARGET, e.name === 'electron.exe' ? 'Passionaris.exe' : e.name));
  }
  writeFileSync(rtMark, rtVersion);
}

// 2. the game
mkdirSync(APP, { recursive: true });
writeFileSync(join(APP, 'package.json'), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: 'electron/main.cjs',
}, null, 2));
mirror(join(ROOT, 'electron'), join(APP, 'electron'));
mirror(join(ROOT, 'dist'), join(APP, 'dist'));
mirror(join(ROOT, 'public'), join(APP, 'public'));
writeFileSync(join(TARGET, 'version.txt'), `${pkg.productName} v${pkg.version}\n`);
console.log(`game v${pkg.version}: ${copied} files copied, ${removed} removed → ${TARGET}`);

// 3. shortcuts (WScript.Shell through PowerShell); a shortcut of the same name pointing elsewhere is not replaced
if (!process.argv.includes('--no-shortcuts')) {
  const icon = join(APP, 'public', 'assets', 'ui', 'icon.ico');
  const ps = `
$ErrorActionPreference = 'Stop'
$sh = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $lnk = Join-Path $dir 'Passionaris.lnk'
  if (Test-Path $lnk) {
    $old = $sh.CreateShortcut($lnk).TargetPath
    if ($old -and ($old -ne '${EXE.replace(/'/g, "''")}')) { Write-Output "skip (not ours): $lnk -> $old"; continue }
  }
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = '${EXE.replace(/'/g, "''")}'
  $s.WorkingDirectory = '${TARGET.replace(/'/g, "''")}'
  $s.IconLocation = '${icon.replace(/'/g, "''")},0'
  $s.Description = 'Passionaris v${pkg.version}'
  $s.Save()
  Write-Output "shortcut: $lnk"
}`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  process.stdout.write(out);
}
