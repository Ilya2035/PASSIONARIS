// Are the album data of this folder what its code expects?
// The installed game takes dist/ and public/ of the folder that releases (install-local.mjs), and the data of the
// album (public/album-data/, outside git) are in a worktree a COPY that scripts/worktree-setup.mjs makes from the
// main folder. When the polygon grows (STAGE in src/album/geo.js, docs/BACKLOG.md «Этап 3, общий выпуск») or the
// leading session puts new heights into the main folder, a worktree with the old copy would build and install a
// game whose code and data do not belong together. release.mjs and install-local.mjs ask here first.
//   albumDataProblem(root) → null when all is well, or a sentence saying what is wrong and what to run.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const stageOfCode = root => +(readFileSync(join(root, 'src', 'album', 'geo.js'), 'utf8').match(/^export const STAGE = (\d+);/m) || [])[1] || 2;
export const stageOfData = root => +JSON.parse(readFileSync(join(root, 'public', 'album-data', 'meta.json'), 'utf8')).stage || 2;

export function albumDataProblem(root, main = null) {
  const fix = 'run "node scripts/worktree-setup.mjs" in this folder (it copies the data of the main folder)';
  const geo = join(root, 'src', 'album', 'geo.js'), meta = join(root, 'public', 'album-data', 'meta.json');
  if (!existsSync(geo) || !existsSync(meta)) return null;   // no album or no data here: nothing to compare
  const code = stageOfCode(root), data = stageOfData(root);
  if (code !== data) return `the album data of this folder are of stage ${data}, its code stands at stage ${code} — ${fix}`;
  if (!main) { try { main = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].slice(9).trim(); } catch { return null; } }
  if (!main || resolve(main) === resolve(root)) return null;
  // the same files as the main folder holds: the same size, and not older (worktree-setup.mjs keeps the times)
  for (const f of ['meta.json', 'height-base.u16.gz']) {
    const a = join(main, 'public', 'album-data', f), b = join(root, 'public', 'album-data', f);
    if (!existsSync(a)) continue;
    if (!existsSync(b)) return `the album data of this folder lack ${f} — ${fix}`;
    const sa = statSync(a), sb = statSync(b);
    if (sa.size !== sb.size || sa.mtimeMs > sb.mtimeMs + 2000) return `the album data of this folder (${f}) are not those of the main folder — ${fix}`;
  }
  return null;
}
