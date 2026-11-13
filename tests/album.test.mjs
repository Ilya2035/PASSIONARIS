// Graphics album (docs/ALBUM.md): the parts that can be checked without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toWorld, fromWorld, frame, distKm, mercX, mercY, BBOX, CENTRE, R } from '../src/album/geo.js';
import { PAGES } from '../src/album/pages.js';
import { DEFS, LOOKS, sunAt } from '../src/album/params.js';
import { feedbackText } from '../src/album/feedback.js';
import { smoothLine } from '../src/album/layers/ribbon.js';

test('album geo: lat/lon → world → lat/lon round trip across the region, heights kept', () => {
  for (const [lat, lon, h] of [[CENTRE.lat, CENTRE.lon, 0], [BBOX.lat0, BBOX.lon0, 0], [BBOX.lat1, BBOX.lon1, 3.4], [36.0, -5.5, .8], [42.63, .66, 2.9]]) {
    const b = fromWorld(toWorld(lat, lon, h));
    assert.ok(Math.abs(b.lat - lat) < 1e-4 && Math.abs(b.lon - lon) < 1e-4 && Math.abs(b.h - h) < 2e-3, `${lat},${lon},${h} → ${b.lat},${b.lon},${b.h}`);
  }
});
test('album geo: the frame centre is the origin with +Y up, and the local frame is orthonormal', () => {
  const o = toWorld(CENTRE.lat, CENTRE.lon, 0);
  assert.ok(o.length() < 1e-3);
  assert.ok(toWorld(CENTRE.lat + 1, CENTRE.lon, 0).z < 0, 'north is −Z');
  assert.ok(toWorld(CENTRE.lat, CENTRE.lon + 1, 0).x > 0, 'east is +X');
  const f = frame(42, 1);
  for (const [a, b] of [[f.up, f.east], [f.up, f.north], [f.east, f.north]]) assert.ok(Math.abs(a.dot(b)) < 1e-6);
  assert.ok(Math.abs(f.up.length() - 1) < 1e-9 && Math.abs(f.north.length() - 1) < 1e-9);
});
test('album geo: distances and the Web-Mercator helpers', () => {
  assert.ok(Math.abs(distKm({ lat: 40, lon: -3 }, { lat: 41, lon: -3 }) - Math.PI * R / 180) < .01);
  assert.equal(mercX(-180), 0); assert.ok(Math.abs(mercY(0) - .5) < 1e-12);
  assert.ok(mercY(44) < mercY(36), 'north is up (smaller y)');
});
test('album pages: unique ids, a title, a note and a camera inside the region; only known parameters', () => {
  const keys = new Set(DEFS.map(d => d.key)), ids = new Set();
  assert.ok(PAGES.length >= 24, `at least 24 pages, got ${PAGES.length}`);
  for (const pg of PAGES) {
    assert.ok(!ids.has(pg.id), `duplicate ${pg.id}`); ids.add(pg.id);
    assert.ok(pg.title && pg.note && pg.group, pg.id);
    for (const [k, v] of Object.entries(pg.p || {})) {
      assert.ok(keys.has(k), `${pg.id}: unknown parameter ${k}`);
      if (k === 'look') assert.ok(LOOKS[v], `${pg.id}: unknown look ${v}`);
    }
    const c = pg.cam;
    assert.ok(c.lat >= BBOX.lat0 && c.lat <= BBOX.lat1 && c.lon >= BBOX.lon0 && c.lon <= BBOX.lon1 && c.h >= 20 && c.h <= 2000, `${pg.id}: camera`);
  }
});
test('album params: the sun is a unit vector, up by day and under the horizon late at night', () => {
  for (const h of [0, 6, 12, 18, 22]) assert.ok(Math.abs(sunAt(h).length() - 1) < 1e-9);
  assert.ok(sunAt(12).z > .8 && sunAt(22).z < 0 && sunAt(0).z > .5);
});
test('album feedback: marks and notes become plain text for the chat', () => {
  const values = Object.fromEntries(DEFS.map(d => [d.key, d.value])); values.trees = 1.5;
  const album = { pages: PAGES, page: PAGES[1], params: { get: k => values[k] }, cam: { s: { h: 200, tilt: 48, lat: 42.63, lon: .66 } } };
  const text = feedbackText(album, { [PAGES[0].id]: { mark: 'ok', note: 'красиво' }, [PAGES[2].id]: { mark: 'no' } }, '0.3.0');
  assert.match(text, /Подходит:\n- .*красиво/); assert.match(text, /Не то:\n- /);
  assert.match(text, /Высота леса: 1\.5/); assert.match(text, /высота 200 км/);
  assert.match(feedbackText(album, {}, ''), /Оценок пока нет/);
});
test('album lines: smoothing keeps the ends and resamples to an even step', () => {
  const line = smoothLine([[-3, 40], [-2, 40.5], [-1, 40]], 2, 2);
  assert.deepEqual(line[0], [-3, 40]); assert.deepEqual(line[line.length - 1], [-1, 40]);
  assert.ok(line.length > 60 && line.length < 140, String(line.length));
});
