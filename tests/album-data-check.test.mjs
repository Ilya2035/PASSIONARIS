// The guard of the release and of the local install: code and album data of one folder must be of one stage, and a
// worktree must hold the same data as the main folder (scripts/album-data-check.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { albumDataProblem, stageOfCode, stageOfData } from '../scripts/album-data-check.mjs';

const ROOT = resolve(import.meta.dirname, '..');
function folder(stage, dataStage, base = 'heights') {
  const d = mkdtempSync(join(tmpdir(), 'passionaris-datacheck-'));
  mkdirSync(join(d, 'src', 'album'), { recursive: true }); mkdirSync(join(d, 'public', 'album-data'), { recursive: true });
  writeFileSync(join(d, 'src', 'album', 'geo.js'), `export const R = 6371;\nexport const STAGE = ${stage};\n`);
  if (dataStage !== null) {
    writeFileSync(join(d, 'public', 'album-data', 'meta.json'), JSON.stringify(dataStage ? { stage: dataStage } : {}));
    writeFileSync(join(d, 'public', 'album-data', 'height-base.u16.gz'), base);
  }
  return d;
}
const done = (...ds) => { for (const d of ds) rmSync(d, { recursive: true, force: true }); };

test('the data check: this folder holds data of the stage its code stands at', { skip: !existsSync(join(ROOT, 'public', 'album-data', 'meta.json')) && 'no album data in this folder' }, () => {
  assert.equal(stageOfData(ROOT), stageOfCode(ROOT), 'run node scripts/worktree-setup.mjs: it copies the data of the main folder');
  assert.equal(albumDataProblem(ROOT, ROOT), null);
});

test('the data check: data of another stage are refused, old data without a stage count as stage 2', () => {
  const a = folder(3, 2), b = folder(3, 0), c = folder(2, 0), d = folder(3, 3), e = folder(3, null);
  assert.match(albumDataProblem(a, a), /stage 2, its code stands at stage 3/);
  assert.match(albumDataProblem(b, b), /stage 2, its code stands at stage 3/);
  assert.equal(albumDataProblem(c, c), null);
  assert.equal(albumDataProblem(d, d), null);
  assert.equal(albumDataProblem(e, e), null, 'a folder without album data has nothing to compare');
  done(a, b, c, d, e);
});

test('the data check: a worktree must hold the data of the main folder — same size, not older', () => {
  const main = folder(3, 3, 'heights of the main folder'), same = folder(3, 3, 'heights of the main folder'), other = folder(3, 3, 'old heights'), older = folder(3, 3, 'heights of the main folder');
  const t = new Date('2026-11-16T12:00:00Z'), before = new Date('2026-11-15T12:00:00Z');
  for (const d of [main, same, other]) for (const f of ['meta.json', 'height-base.u16.gz']) utimesSync(join(d, 'public', 'album-data', f), t, t);
  for (const f of ['meta.json', 'height-base.u16.gz']) utimesSync(join(older, 'public', 'album-data', f), before, before);
  assert.equal(albumDataProblem(same, main), null);
  assert.match(albumDataProblem(other, main), /height-base\.u16\.gz\) are not those of the main folder/);
  assert.match(albumDataProblem(older, main), /are not those of the main folder/);
  done(main, same, other, older);
});
