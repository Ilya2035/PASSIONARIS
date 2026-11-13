// The map on its own (src/album/mapview.js): the modes of the map as sets of the album's parameters, and which view
// the album opens in. The panel itself is DOM and is looked at in the album (harness acap … "view=map").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAP_MODES, MAP_SWITCHES, modeOf, modeParams, startView, VIEW_KEY } from '../src/album/mapview.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const def = k => DEFS.find(d => d.key === k), getter = o => k => (k in o ? o[k] : def(k)?.value);

test('map view: the modes — nature, districts, provinces, regions, chunks, temperature, heights', () => {
  assert.deepEqual(MAP_MODES.map(m => m.id), ['nature', 'districts', 'provinces', 'regions', 'chunks', 'temperature', 'heights']);
  assert.deepEqual(MAP_MODES.map(m => m.title), ['Природа', 'Районы', 'Провинции', 'Регионы', 'Чанки', 'Температура', 'Высоты']);
  for (const m of MAP_MODES) {
    assert.ok(m.hint.length > 10, m.id);
    // every mode sets knobs the album has, to values those knobs can take
    const set = modeParams(m.id);
    for (const [k, v] of Object.entries(set)) { const d = def(k); assert.ok(d, `${m.id}: the album has no knob ${k}`); if (d.options) assert.ok(d.options.some(o => o[0] === v), `${m.id}: ${k} = ${v}`); }
    // and is told from the others by what it sets
    assert.equal(modeOf(getter(set)), m.id); assert.equal(modeOf(getter(modeParams(m.id, true))), m.id);
  }
  // the three levels of the division are the three values of its knob
  assert.deepEqual(['districts', 'provinces', 'regions'].map(id => modeParams(id).division), [1, 2, 3]);
  assert.deepEqual(def('division').options.map(o => o[1]), ['нет', 'Районы', 'Провинции', 'Регионы']);
  // the division is shown on the flat paper map, or over the natural land when asked; the natural map keeps its trees
  assert.deepEqual([modeParams('provinces').look, modeParams('provinces').forest3d], ['paper', 0]); assert.deepEqual([modeParams('provinces', true).look, modeParams('provinces', true).forest3d], ['natural', 1]);
  assert.deepEqual([modeParams('nature').look, modeParams('nature').forest3d, modeParams('nature').division], ['natural', 1, 0]); assert.equal(modeParams('heights').forest3d, 0);
  assert.equal(modeParams('chunks').km, 1); assert.equal(modeParams('no such mode').division, 0);
  // the album as it opens is the natural map
  assert.equal(modeOf(getter({})), 'nature');
  for (const [k, name] of MAP_SWITCHES) { const d = def(k); assert.ok(d && d.type === 'toggle' && name.length > 3, k); }
});

test('map view: the album opens on the map; the address and the last choice can say otherwise', () => {
  const q = s => new URLSearchParams(s);
  assert.equal(startView(q(''), null), 'map'); assert.equal(startView(q(''), 'album'), 'album'); assert.equal(startView(q(''), 'map'), 'map');
  assert.equal(startView(q('view=album'), 'map'), 'album'); assert.equal(startView(q('view=map'), 'album'), 'map'); assert.equal(startView(q('view=nonsense'), null), 'map');
  // a capture, and an address that names a page, keep to the album: the pictures of the notes stay as they were
  assert.equal(startView(q('shot=1'), null, true), 'album'); assert.equal(startView(q('page=land-20'), 'map'), 'album'); assert.equal(startView(q('shot=1&view=map'), null, true), 'map');
  assert.ok(VIEW_KEY.startsWith('passionaris.'));
  // the page the map opens on, and the hook in the album
  const pg = PAGES.find(p => p.id === 'map'); assert.ok(pg && pg.cam.h > 500 && Object.keys(pg.p).length === 0, 'the whole map, as it is');
  const main = readFileSync(join(ROOT, 'src/album/main.js'), 'utf8'); assert.match(main, /initMapView\(album, q\)/);
});
