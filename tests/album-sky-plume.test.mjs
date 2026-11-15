// The plumes of the album (src/album/sky/plume.js, docs/album/sky.md): the ash of an erupting volcano and the dust
// of a sand storm. What they look like is checked by eye (harness acap … "page=sky-eruption", "page=sky-dust"), and
// whether their shaders compile by `harness acheck … "page=sky-eruption&ui=0"`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, PLUME, PLUME_GLSL, plumeReach, plumeShape, plumeFrame, nearestVolcano } from '../src/album/sky/plume.js';
import { plumeShader, plumeShow, PUFFS, PUFF_LIFE } from '../src/album/layers/plumes.js';
import { postShader, POST_PLUME, POST_CLOUDS, POST_BALL } from '../src/album/post.js';
import { WIND, WX } from '../src/album/sky/weather.js';
import { LIGHT } from '../src/album/light.js';
import { frame, R } from '../src/album/geo.js';
import sky from '../src/album/aspects/sky.js';
import { DEFS } from '../src/album/params.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} is not within ${eps} of ${b}`);
const page = id => sky.pages.find(p => p.id === id), def = k => DEFS.find(d => d.key === k);

test('plumes: ash is a long narrow streak, dust a wide low one; both grow from nothing', () => {
  const { ash, dust } = KINDS;
  assert.ok(ash.reach > 1000 && ash.half < 15 && ash.top > 8 && ash.top < 20, 'ash: seen from space, from one crater, in the stratosphere');
  assert.ok(dust.reach > 500 && dust.half > ash.half * 5 && dust.top < 5 && dust.spread > ash.spread, 'dust: wide, and near the ground');
  assert.ok(ash.id === 1 && dust.id === 2); assert.ok(dust.colour[0] > dust.colour[2] * 1.5, 'dust is yellow'); near(ash.colour[0], ash.colour[2], .05, 'ash is grey'); assert.ok(ash.colour[0] < .3 && ash.pale[0] < .55, 'and dark');
  for (const kind of ['ash', 'dust']) {
    assert.equal(plumeReach(kind, 0), 0); assert.equal(plumeReach(kind, -5), 0);
    near(plumeReach(kind, KINDS[kind].grow), KINDS[kind].reach * (1 - 1 / Math.E), 1e-9); near(plumeReach(kind, 600), KINDS[kind].reach, KINDS[kind].reach * 1e-4, 'full grown in a still capture');
    for (let t = 0; t < 200; t += 10) assert.ok(plumeReach(kind, t + 10) > plumeReach(kind, t), `${kind} at ${t}`);
  }
});

test('plumes: the shape — from the source downwind, widening, thinning to its end', () => {
  for (const kind of ['ash', 'dust']) {
    const k = KINDS[kind], L = 800, at = (u, v) => plumeShape(kind, u, v, L);
    // nothing upwind of the source, nothing beyond its end, nothing before it has begun
    assert.equal(at(-3 * k.half, 0).density, 0); assert.equal(at(L + 1, 0).density, 0); assert.equal(plumeShape(kind, 10, 0, 0).density, 0);
    // on its axis: whole a little way from the source, thinner farther on, gone at the end
    assert.ok(at(k.half * 2, 0).density > .8, `${kind}: ${at(k.half * 2, 0).density}`); assert.ok(at(L * .6, 0).density < at(L * .2, 0).density && at(L * .6, 0).density > .1); assert.ok(at(L * .99, 0).density < .02);
    // it widens as it goes: a place off the axis is outside it near the source and inside it far down
    const off = k.half * 2; assert.equal(at(k.half, off).density, 0); assert.ok(at(L * .5, off).density > .2, `${kind}: ${at(L * .5, off).density}`);
    near(at(L * .5, off).density, at(L * .5, -off).density, 1e-12, 'the same on both sides'); near(at(L * .25, 0).along, .25, 1e-12);
  }
});

test('plumes: the wind of the weather carries them; the nearest volcano erupts', () => {
  // the frame: the source, downwind and across, three directions at right angles; downwind is the wind of the clouds
  for (const [la, lo] of [[38.87, -4.02], [37.75, 15], [-8, 115], [64, -19]]) {
    const f = plumeFrame(la, lo), fr = frame(la, lo);
    near(f.o.length(), 1, 1e-9); near(f.w.length(), 1, 1e-9); near(f.c.length(), 1, 1e-9); near(f.o.dot(f.w), 0, 1e-9); near(f.o.dot(f.c), 0, 1e-9); near(f.w.dot(f.c), 0, 1e-9);
    near(f.o.dot(fr.up), 1, 1e-9); near(f.w.dot(fr.east), WIND[0], 1e-3); near(f.w.dot(fr.north), -WIND[1], 1e-3);
  }
  // a made-up list: the nearest above the sea is taken
  const list = { fields: ['gvp', 'name', 'nameEn', 'lat', 'lon', 'elev'], rows: [[1, 'Дальний', 'Far', 10, 10, 900], [2, 'Ближний', 'Near', 40, -3, 1200], [3, 'Подводный', 'Sub', 40.1, -3.1, -300]] };
  const v = nearestVolcano(list, 40.1, -3.1); assert.deepEqual([v.name, v.lat, v.lon, v.elev], ['Ближний', 40, -3, 1200]); assert.ok(v.km > 5 && v.km < 20);
  assert.equal(nearestVolcano({ fields: list.fields, rows: [] }, 0, 0), null);
  // the list of the world: over the middle of Spain it is Calatrava, over Sicily Etna
  const world = JSON.parse(readFileSync(new URL('../public/assets/hazards/volcanoes.json', import.meta.url), 'utf8'));
  assert.ok(world.rows.length > 1000); assert.match(nearestVolcano(world, 39.4, -2.2).name, /Калатрава/); assert.match(nearestVolcano(world, 37.6, 14.8).name, /Этна/);
  for (const id of ['sky-eruption', 'sky-eruption-near']) assert.match(nearestVolcano(world, page(id).cam.lat, page(id).cam.lon).name, /Калатрава/, id);
  assert.match(nearestVolcano(world, page('sky-eruption-space').cam.lat, page('sky-eruption-space').cam.lon).name, /Этна|Стромболи|Вулькано/);
});

test('plumes: drawn over the finished picture, and nothing while they are off', () => {
  // the knobs: two switches on the panel of the map, off until asked for
  for (const k of ['eruption', 'dustStorm']) { assert.equal(def(k).type, 'toggle', k); assert.equal(def(k).value, 0, k); assert.ok(def(k).map.length > 5, k); }
  assert.equal(PLUME.uPl.value.x, 0, 'no plume');
  for (const id of ['sky-eruption', 'sky-eruption-near', 'sky-eruption-space']) assert.equal(page(id).p.eruption, 1, id);
  for (const id of ['sky-dust', 'sky-dust-near']) assert.equal(page(id).p.dustStorm, 1, id);
  // the GLSL: where the plume is; it reads the picture of the clouds and counts no noise
  assert.ok(PLUME_GLSL.includes('vec3 plumeAt(vec3 P)') && PLUME_GLSL.includes('textureLod(tCloud') && !/vnoise|fbm/.test(PLUME_GLSL));
  for (const k of Object.keys(PLUME)) assert.match(PLUME_GLSL, new RegExp(`\\b${k}\\b`), k);
  // the shell: hidden behind the globe by its own arithmetic, lit from the side of the Sun, dimmed on the night side
  assert.ok(/plumeAt\(C\)/.test(plumeShader) && /globeRelight\(U\)/.test(plumeShader) && /-b - sqrt\(disc\) < reach\) discard/.test(plumeShader));
  // from near the ash is the column of puffs, from afar the shell; the dust shows from nearer
  assert.equal(plumeShow('ash', 30), 0); assert.equal(plumeShow('ash', 200), 1); assert.ok(plumeShow('dust', 60) > plumeShow('ash', 60)); assert.ok(PUFFS >= 300 && PUFFS <= 1500 && PUFF_LIFE > 10);
  // the finishing pass: the shadow and what has fallen, only while a plume is there
  assert.ok(!postShader(0).includes('plumeAt') && !postShader(POST_CLOUDS).includes('plumeAt') && !postShader(POST_BALL).includes('plumeAt'));
  for (const f of [POST_PLUME, POST_PLUME | POST_CLOUDS | POST_BALL]) { const s = postShader(f); assert.ok(/if \(uPl\.x > 0\. && ground\)/.test(s) && /plumeAt\(G \+ L \*/.test(s) && /float fell = /.test(s), `${f}`); }
  // nothing of it in the light the ground shader carries; its uniforms are not among those of the ground
  assert.ok(!/uPl|plumeAt/.test(LIGHT)); for (const k of Object.keys(PLUME)) assert.ok(!(k in sky.uniforms), k);
  assert.ok('tCloud' in WX);
});
