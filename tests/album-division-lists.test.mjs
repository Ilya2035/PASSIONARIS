// The lists of lands beyond the polygon of today (data/division/lands-*.json: France, Benelux with the left bank of the
// Rhine, the whole Maghreb) and their joining into lands.json (division/join-lands.mjs): ready for the day the polygon
// takes them in. Every department of France has its province; codes, ids, lands and regions fit; a unit is shared out
// between provinces only where a list says so; joining twice changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { joinLands, joinList, LISTS } from '../src/album/division/join-lands.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const lands = read('public/assets/album/division/lands.json');
const lists = LISTS.map(f => [f, read(`data/division/${f}`)]);
const list = name => lists.find(([f]) => f === `lands-${name}.json`)[1];
const fr = list('france');
// where the provinces of a list lie (their points), lat0, lat1, lon0, lon1
const BOX = { 'lands-france.json': [41, 51.2, -5.2, 9.7], 'lands-benelux.json': [49, 53.6, 2.5, 8.6], 'lands-maghreb.json': [29, 37.5, -10.5, 11.7] };

test('lists: France — every department has its province, once', () => {
  // the departments the provinces of the south already reach (lands.json)
  const SOUTH = ['07', '09', '11', '12', '15', '24', '30', '31', '32', '33', '34', '40', '43', '46', '47', '48', '64', '65', '66', '81', '82'];
  const ALL = [...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter(c => c !== '20'), '2A', '2B'];
  const iso = fr.provinces.flatMap(p => p.iso).filter(c => c.startsWith('FR-'));
  const twice = iso.filter((c, i) => iso.indexOf(c) !== i);
  assert.deepEqual(twice, ['FR-67'], 'only Bas-Rhin in two provinces: Alsace Bossue goes to Lorraine');
  const have = new Set([...iso.map(c => c.slice(3)), ...SOUTH]);
  assert.deepEqual(ALL.filter(c => !have.has(c)), [], 'every department of France');
  assert.ok(iso.every(c => !SOUTH.includes(c.slice(3))), 'none of those the south already has');
});

test('lists: the owner of 15.11.2026 — Corsica its own region, the Channel Islands with France, Alsace Bossue to Lorraine', () => {
  const j = joinLands(lands, lists).lands, prov = id => j.provinces.find(p => p.id === id);
  assert.ok(j.regions.some(r => r.id === 'corsica'));
  for (const id of ['cismonte', 'pumonti']) assert.equal(prov(id).region, 'corsica');
  assert.equal(j.lands.find(l => l.id === 'corsica').region, 'corsica');
  assert.ok(prov('cotentin').admin.includes('JEY+00?') && prov('cotentin').admin.includes('GGY+00?'), 'Jersey and Guernsey');
  assert.ok(prov('messin').admin.includes('FRA-5273') && prov('basalsace').admin.includes('FRA-5273'), 'Bas-Rhin shared');
  assert.ok(prov('messin').at.some(([lat, lon]) => lat > 48.8 && lat < 49 && lon > 7 && lon < 7.25), 'an anchor of Lorraine in Alsace Bossue');
  for (const id of ['flanders', 'holland', 'rhineland', 'palatinate']) assert.equal(j.lands.find(l => l.id === id).region, 'westeurope', `${id}: Western Europe`);
});

test('lists: codes, ids, lands, regions and points fit', () => {
  const regions = new Set([...lands.regions, ...lists.flatMap(([, l]) => l.regions || [])].map(r => r.id));
  const landIds = new Set([...lands.lands, ...lists.flatMap(([, l]) => l.lands)].map(l => l.id));
  const ids = [...lands.provinces, ...lists.flatMap(([, l]) => l.provinces)].map(p => p.id), lids = [...lands.lands, ...lists.flatMap(([, l]) => l.lands)].map(l => l.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'no province id twice');
  assert.deepEqual(lids.filter((x, i) => lids.indexOf(x) !== i), [], 'no land id twice');
  for (const [f, l] of lists) {
    const [a0, a1, o0, o1] = BOX[f];
    for (const p of l.provinces) {
      assert.ok(p.name && p.town && p.at.length >= 1, `${f} ${p.id}: name, town, points`);
      assert.equal(p.admin.length, p.iso.length, `${f} ${p.id}: a code of Natural Earth for every unit`);
      for (const a of p.admin) assert.match(a, /^[A-Z]{3}[-+][0-9?]+$/, `${f} ${p.id}: ${a}`);
      assert.ok(landIds.has(p.land), `${f} ${p.id}: its land`); assert.ok(regions.has(p.region), `${f} ${p.id}: its region`);
      for (const [lat, lon] of p.at) assert.ok(lat > a0 && lat < a1 && lon > o0 && lon < o1, `${f} ${p.id}: a point in its lands`);
    }
    for (const x of l.lands) assert.ok(regions.has(x.region), `${f} ${x.id}: its region`);
  }
});

test('lists: a unit goes to two provinces only where a list shares it out', () => {
  let cur = lands;
  for (const [f, l] of lists) { const j = joinList(cur, l); assert.deepEqual(j.twice, [], `${f}: units in two provinces not marked shared`); cur = j.lands; }
  // a shared unit is shared indeed: each of its provinces has a point to grow from
  for (const [f, l] of lists) for (const a of l.shared || []) {
    const ps = cur.provinces.filter(p => p.admin?.includes(a));
    assert.ok(ps.length >= 2, `${f} ${a}: shared by ${ps.map(p => p.id)}`);
  }
});

test('lists: joining changes lands.json once, and a second time nothing', () => {
  const before = JSON.stringify(lands), j = joinLands(lands, lists);
  assert.equal(JSON.stringify(lands), before, 'lands.json itself is not touched');
  const n = k => lists.reduce((s, [, l]) => s + (l[k] || []).length, 0);
  assert.equal(j.lands.provinces.length, lands.provinces.length + n('provinces'));
  assert.equal(j.lands.lands.length, lands.lands.length + n('lands'));
  assert.equal(j.lands.seas.length, lands.seas.length + n('seas'));
  assert.equal(j.lands.regions.length, lands.regions.length + n('regions'));
  assert.ok(j.lands.provinces.every(p => !('iso' in p) && !('town' in p)), 'iso and town stay in the lists');
  assert.ok(!j.lands.provinces.find(p => p.id === 'nimes').admin.includes('FRA-5274'), 'Bouches-du-Rhône leaves Nîmes');
  assert.deepEqual(j.lands.provinces.find(p => p.id === 'oran').admin, ['DZA-2145', 'DZA-2144'], 'Oran gives Tlemcen and Sidi Bel Abbès away');
  assert.deepEqual(joinLands(j.lands, lists).log, [], 'joined twice: nothing more');
  // every new sea has its point inside its own outline, and no sea before it in the list takes that point first
  const inRing = (lon, lat, r) => { let c = false; for (let i = 0, k = r.length - 1; i < r.length; k = i++) { const [ax, ay] = r[k], [bx, by] = r[i]; if ((ay > lat) !== (by > lat) && lon < ax + (lat - ay) / (by - ay) * (bx - ax)) c = !c; } return c; };
  for (const s of lists.flatMap(([, l]) => l.seas || [])) {
    const [lat, lon] = s.at[0], first = j.lands.seas.find(q => q.outline && inRing(lon, lat, q.outline));
    assert.equal(first?.id, s.id, `${s.id}: its point falls into ${first?.id}`);
  }
});
