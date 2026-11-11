// Working interface (docs/UI.md): one scheme of work colours, four text sizes, flat blocks without textures —
// checked on the stylesheets and pages of the launcher, the game and the graphics album.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DEFS } from '../src/album/params.js';
import { knobGroups } from '../src/album/ui.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const STYLES = ['src/shared/theme.css', 'src/launcher/launcher.css', 'src/game/game.css', 'src/game/ui/legend.css', 'src/album/ui.css'];
const PAGES = ['index.html', 'game.html', 'album.html'];
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// [selector, body] of every rule (nested blocks such as @media are flattened: their inner rules come out one by one)
const rules = css => noComments(css).split('}').map(r => r.split('{')).filter(r => r.length >= 2).map(r => [r[r.length - 2].trim(), r[r.length - 1]]);

test('ui: theme.css holds the work colours and exactly four text sizes', () => {
  const theme = noComments(read('src/shared/theme.css'));
  for (const v of ['--c-blue', '--c-green', '--c-red', '--c-amber', '--c-grey', '--c-off', '--c-panel', '--c-line', '--c-text']) {
    assert.match(theme, new RegExp(`${v}:\\s*#[0-9a-f]{6};`), `${v} is a plain colour`);
  }
  const sizes = [...theme.matchAll(/(--fs-[a-z]+):\s*(\d+)px;/g)].map(m => [m[1], +m[2]]);
  assert.deepEqual(sizes.map(s => s[0]), ['--fs-huge', '--fs-l', '--fs-m', '--fs-s']);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i][1] < sizes[i - 1][1], 'sizes go from huge down to small');
});

test('ui: every font size of the interface is one of the four', () => {
  for (const f of STYLES) {
    for (const [sel, body] of rules(read(f))) {
      for (const m of body.matchAll(/(?:^|;|\s)(font-size|font):\s*([^;]+)/g)) {
        const v = m[2].trim();
        if (m[1] === 'font' && v === 'inherit') continue;
        assert.ok(/var\(--fs-(huge|l|m|s)\)/.test(v), `${f} «${sel}»: ${m[1]}: ${v}`);
      }
    }
  }
});

test('ui: flat blocks — no textures, grain, decorative gradients or cut shapes', () => {
  // the legend's swatches repeat the map's own symbols (hatching, cloud dots); the caret of a mode group is a pointer
  const allowed = sel => /i\.hatch|i\.dots|\.mode-caret/.test(sel);
  for (const f of STYLES) {
    for (const [sel, body] of rules(read(f))) {
      if (allowed(sel)) continue;
      assert.doesNotMatch(body, /gradient\(|clip-path|url\(["']?data:|--tex-|mix-blend-mode|drop-shadow|backdrop-filter/, `${f} «${sel}»`);
    }
  }
  assert.ok(!existsSync(new URL('../src/shared/stipple.js', import.meta.url)), 'the stipple textures are gone');
  for (const p of PAGES) {
    const html = read(p);
    assert.doesNotMatch(html, /class="[^"]*\b(paper|paper-body|grain|stone|primary|hex)\b/, `${p}: an old decorated class`);
  }
  assert.match(read('album.html'), /href="\.\/src\/shared\/theme\.css"/, 'the album takes the shared theme');
});

test('ui: the album builds its knob panel from DEFS, new groups included', () => {
  const groups = knobGroups();
  const seen = groups.flatMap(g => g.defs.map(d => d.key));
  assert.deepEqual([...seen].sort(), DEFS.map(d => d.key).sort(), 'every knob once');
  assert.equal(new Set(seen).size, seen.length);
  for (const g of groups) assert.ok(g.name && g.defs.length, g.key);
  const extra = knobGroups([...DEFS, { key: 'waves', label: 'Волны', group: 'water' }, { key: 'misc', label: 'Без группы' }]);
  assert.deepEqual(extra.slice(-2).map(g => [g.key, g.name, g.defs.map(d => d.key)]), [['water', 'water', ['waves']], ['other', 'Прочее', ['misc']]]);
});
