// The lands and provinces of France beyond the polygon of today (data/division/lands-france.json): ready for the day
// the polygon takes in all of France. Every department of mainland France and Corsica has its province, here or in
// the provinces of the south (lands.json), and nothing clashes with what is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fr = JSON.parse(readFileSync(join(ROOT, 'data/division/lands-france.json'), 'utf8'));
const lands = JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division/lands.json'), 'utf8'));

// the departments the provinces of the south already reach (lands.json, admin of Natural Earth)
const SOUTH = ['07', '09', '11', '12', '15', '24', '30', '31', '32', '33', '34', '40', '43', '46', '47', '48', '64', '65', '66', '81', '82'];
const ALL = [...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter(c => c !== '20'), '2A', '2B'];

test('France: every department has its province, once', () => {
  const iso = fr.provinces.flatMap(p => p.iso);
  assert.equal(new Set(iso).size, iso.length, 'no department in two provinces');
  const have = new Set([...iso.map(c => c.slice(3)), ...SOUTH]);
  assert.deepEqual(ALL.filter(c => !have.has(c)), [], 'every department of France');
  assert.ok(iso.every(c => !SOUTH.includes(c.slice(3))), 'none of those the south already has');
});

test('France: the lands, regions and ids fit with lands.json', () => {
  const ids = new Set(fr.lands.map(l => l.id)), regions = new Set(lands.regions.map(r => r.id));
  for (const p of fr.provinces) {
    assert.ok(ids.has(p.land), `${p.id}: its land`);
    assert.ok(regions.has(p.region), `${p.id}: its region`);
    assert.ok(p.name && p.town && p.at.length >= 1, `${p.id}: name, town, points`);
    for (const [lat, lon] of p.at) assert.ok(lat > 41 && lat < 51.2 && lon > -5.2 && lon < 9.7, `${p.id}: a point in France`);
  }
  const old = new Set(lands.provinces.map(p => p.id)), oldLands = new Set(lands.lands.map(l => l.id));
  assert.deepEqual(fr.provinces.filter(p => old.has(p.id)).map(p => p.id), [], 'no province id twice');
  assert.deepEqual(fr.lands.filter(l => oldLands.has(l.id)).map(l => l.id), [], 'no land id twice');
  const pid = fr.provinces.map(p => p.id); assert.equal(new Set(pid).size, pid.length);
});
