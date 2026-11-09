// Hazards module: calendar helpers and the event scheduler.
//   tools/node/node.exe --test tests/hazards.test.mjs tests/hazards-scheduler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ymdToT, tToYmd, yearStartT, isLeap, daysInMonth, T_END } from '../src/sim/hazards/time.js';
import { loadHazards } from '../src/sim/hazards/loader.js';
import { createScheduler, HAZARD_TYPES } from '../src/sim/hazards/scheduler.js';
import { distKm, simCellOf } from '../src/sim/hazards/physics.js';
import { Rng } from '../src/sim/hazards/rng.js';

const DIR = path.resolve(import.meta.dirname, '..', 'public', 'assets', 'hazards');
const data = await loadHazards({ dir: DIR });
const sched = createScheduler({ data, seed: 2026 });
const Y = (y, m = 1, d = 1) => ymdToT(y, m, d);

// ------------------------------------------------------------------ calendar
test('ymdToT epoch and known spans', () => {
  assert.equal(ymdToT(-4999, 1, 1), 0);
  assert.equal(ymdToT(-4999, 12, 31), 364);                 // -4999 is not a leap year
  assert.equal(ymdToT(2000, 1, 1) - ymdToT(1970, 1, 1), 10957);
  assert.equal(ymdToT(1, 1, 1) - ymdToT(0, 1, 1), 366);     // astronomical year 0 (1 BC) is leap
  assert.equal(ymdToT(1600, 3, 1) - ymdToT(1600, 2, 28), 2);
  assert.equal(ymdToT(1700, 3, 1) - ymdToT(1700, 2, 28), 1);
  assert.equal(ymdToT(2000, 1, 1, 12), ymdToT(2000, 1, 1) + 0.5);
  assert.equal(T_END, ymdToT(2101, 1, 1));
  assert.ok(isLeap(-4996) && !isLeap(-4999) && isLeap(0) && !isLeap(1900) && isLeap(2000));
  assert.equal(daysInMonth(-1, 2), 28);
});

test('ymdToT agrees with the proleptic Gregorian JS Date and round-trips', () => {
  const dayOf = (y, m, d) => { const dt = new Date(0); dt.setUTCFullYear(y, m - 1, d); return Math.round(dt.getTime() / 86400000); };
  const base = dayOf(-4999, 1, 1);
  const r = new Rng(7);
  for (let i = 0; i < 3000; i++) {
    const y = -4999 + r.int(7100), m = 1 + r.int(12), d = 1 + r.int(daysInMonth(y, m));
    const t = ymdToT(y, m, d);
    assert.equal(t, dayOf(y, m, d) - base, `${y}-${m}-${d}`);
    const back = tToYmd(t + 0.25);
    assert.deepEqual([back.year, back.month, back.day], [y, m, d]);
    assert.ok(Math.abs(back.hour - 6) < 1e-6);
  }
});

// ------------------------------------------------------------------ scheduler
const sig = evs => evs.map(e => `${e.id}@${e.t.toFixed(6)}`).join('|');

test('events have the contract shape', () => {
  const evs = sched.eventsBetween(Y(1883), Y(1884));
  assert.ok(evs.length > 100);
  const seen = new Set();
  for (const e of evs) {
    assert.ok(HAZARD_TYPES.includes(e.type), e.type);
    for (const k of ['t', 'lat', 'lon', 'level']) assert.equal(typeof e[k], 'number', `${k} of ${e.id}`);
    assert.ok(e.level >= 0 && e.level <= 5);
    assert.ok(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180);
    assert.equal(typeof e.name, 'string');
    assert.equal(typeof e.documented, 'boolean');
    assert.ok('magnitude' in e && 'vei' in e);
    if (e.type === 'eruption') assert.equal(e.vei, e.magnitude);
    assert.ok(!seen.has(e.id), `unique id ${e.id}`); seen.add(e.id);
    seen.add(e.type);
  }
  for (const t of HAZARD_TYPES) assert.ok(seen.has(t), `type ${t} present in 1883`);
});

test('famous documented events come out on their dates', () => {
  const find = (t0, t1, pred) => sched.eventsBetween(t0, t1, { documented: true }).find(pred);
  const ves = find(Y(79, 10, 24), Y(79, 10, 25), e => e.type === 'eruption' && e.name === 'Везувий');
  assert.ok(ves && ves.vei === 5, 'Vesuvius 24 Oct 79');
  const tam = find(Y(1815, 4, 10), Y(1815, 4, 11), e => e.type === 'eruption' && e.name === 'Тамбора');
  assert.ok(tam && tam.vei === 7 && tam.tStart < tam.t, 'Tambora paroxysm after the 1812 onset');
  const kra = find(Y(1883, 8, 27), Y(1883, 8, 28), e => e.type === 'eruption' && e.name === 'Кракатау');
  assert.ok(kra && kra.vei === 6, 'Krakatau');
  const lis = find(Y(1755, 11, 1), Y(1755, 11, 2), e => e.type === 'earthquake' && e.magnitude >= 8);
  assert.ok(lis && lis.level === 5 && Math.abs(tToYmd(lis.t).hour - 9.5) < 0.01, 'Lisbon 09:30');
  assert.ok(find(Y(1755, 11, 1), Y(1755, 11, 2), e => e.type === 'tsunami' && e.t > lis.t), 'Lisbon tsunami follows');
  assert.ok(find(Y(1908, 6, 30), Y(1908, 7, 1), e => e.type === 'meteorite' && e.kind === 'airburst'), 'Tunguska');
  assert.ok(find(Y(2013, 2, 15), Y(2013, 2, 16), e => e.type === 'meteorite' && e.name === 'Челябинский'), 'Chelyabinsk');
});

test('unknown month/day are placed deterministically inside the year', () => {
  // Minoan eruption of Santorini: year only (-1609)
  const evs = sched.eventsBetween(Y(-1609), Y(-1608), { types: ['eruption'], documented: true });
  const santorini = evs.find(e => e.name === 'Санторин');
  assert.ok(santorini && santorini.vei === 7);
  assert.ok(santorini.t >= yearStartT(-1609) && santorini.t < yearStartT(-1608));
  const again = createScheduler({ data, seed: 2026 }).eventsBetween(Y(-1609), Y(-1608), { types: ['eruption'], documented: true });
  assert.equal(again.find(e => e.name === 'Санторин').t, santorini.t);
});

test('deterministic: same seed -> same events regardless of query order', () => {
  const a = createScheduler({ data, seed: 99 });
  const b = createScheduler({ data, seed: 99 });
  const w = [[Y(-3200), Y(-3199, 7)], [Y(1450, 3, 3), Y(1452)], [Y(2050), Y(2051)]];
  const ra = w.map(([t0, t1]) => sig(a.eventsBetween(t0, t1)));
  const rb = w.slice().reverse().map(([t0, t1]) => sig(b.eventsBetween(t0, t1))).reverse();
  assert.deepEqual(ra, rb);
  // one large window equals the union of its pieces
  const whole = sig(a.eventsBetween(Y(1700), Y(1704)));
  const parts = [];
  for (let t = Y(1700); t < Y(1704); t += 97.3) parts.push(...b.eventsBetween(t, Math.min(t + 97.3, Y(1704))));
  assert.equal(sig(parts), whole);
  // another seed changes the stochastic part only
  const c = createScheduler({ data, seed: 100 });
  assert.notEqual(sig(c.eventsBetween(Y(-3200), Y(-3199, 7))), ra[0]);
  assert.equal(sig(c.eventsBetween(Y(1883, 8, 27), Y(1883, 8, 28), { documented: true }).filter(e => e.type === 'eruption')),
    sig(a.eventsBetween(Y(1883, 8, 27), Y(1883, 8, 28), { documented: true }).filter(e => e.type === 'eruption')));
  // string seeds work too
  assert.equal(sig(createScheduler({ data, seed: 'мир' }).eventsBetween(Y(10), Y(11))), sig(createScheduler({ data, seed: 'мир' }).eventsBetween(Y(10), Y(11))));
});

test('no events outside the requested window; sorted by t', () => {
  const r = new Rng(5);
  for (let i = 0; i < 40; i++) {
    const t0 = r.next() * (T_END - 400);
    const t1 = t0 + r.next() * 400;
    const evs = sched.eventsBetween(t0, t1);
    for (let k = 0; k < evs.length; k++) {
      assert.ok(evs[k].t >= t0 && evs[k].t < t1, `${evs[k].id} ${evs[k].t} not in [${t0}, ${t1})`);
      if (k) assert.ok(evs[k].t >= evs[k - 1].t);
    }
  }
  assert.deepEqual(sched.eventsBetween(100, 100), []);
  assert.deepEqual(sched.eventsBetween(200, 100), []);
  const edge = sched.eventsBetween(-1e6, 30);
  for (const e of edge) assert.ok(e.t >= 0 && e.t < 30);
  for (const e of sched.eventsBetween(T_END - 30, T_END + 1e6)) assert.ok(e.t < T_END);
});

test('stochastic filling: ancient and future years get instrumental-era rates, 1950 none', () => {
  const count = (y0, y1, type, documented) => sched.eventsBetween(Y(y0), Y(y1), { types: [type], documented }).length;
  const ancientQ = count(-3000, -2990, 'earthquake') / 10;
  const futureQ = count(2060, 2070, 'earthquake') / 10;
  assert.ok(ancientQ > 80 && ancientQ < 150, `ancient quakes/yr ${ancientQ}`);
  assert.ok(futureQ > 80 && futureQ < 150, `future quakes/yr ${futureQ}`);
  assert.equal(count(1950, 1960, 'earthquake', false), 0, 'instrumental era is documented only');
  const ancientE = count(-3000, -2990, 'eruption') / 10, futureE = count(2060, 2070, 'eruption') / 10;
  assert.ok(ancientE > 20 && ancientE < 60 && futureE > 20 && futureE < 60, `eruptions/yr ${ancientE} ${futureE}`);
  assert.ok(count(1965, 1975, 'eruption', false) === 0, 'GVP complete era');
  assert.ok(count(2030, 2100, 'tsunami') > 20, 'future tsunamis');
  assert.ok(count(-4000, -3900, 'meteorite') > 100, 'ancient meteorite falls');
  assert.ok(count(-4000, -3999, 'landslide') > 200, 'landslides');
});

test('no stochastic eruption of a volcano during its documented onset..paroxysm span', () => {
  // Tambora: GVP onset 1812, paroxysm 10 Apr 1815
  for (let seed = 0; seed < 12; seed++) {
    const s = createScheduler({ data, seed });
    const evs = s.eventsBetween(Y(1810), Y(1818), { types: ['eruption'] });
    const tam = evs.find(e => e.documented && e.name === 'Тамбора' && e.vei === 7);
    assert.ok(tam && tam.t - tam.tStart > 365, 'long documented span');
    for (const e of evs) {
      if (e.documented || e.volcano !== tam.volcano) continue;
      assert.ok(e.t < tam.tStart - 365 || e.t > tam.t + 365, `seed ${seed}: ${e.id} at ${JSON.stringify(tToYmd(e.t))}`);
    }
  }
});

test('stochastic events never duplicate documented ones', () => {
  for (const [y0, y1] of [[-500, -450], [1200, 1250], [1850, 1900]]) {
    const evs = sched.eventsBetween(Y(y0), Y(y1), { types: ['eruption', 'earthquake'] });
    const docE = evs.filter(e => e.documented && e.type === 'eruption');
    const docQ = evs.filter(e => e.documented && e.type === 'earthquake');
    for (const s of evs) {
      if (s.documented) continue;
      if (s.type === 'eruption') {
        for (const d of docE) assert.ok(d.volcano !== s.volcano || Math.abs(d.t - s.t) > 365, `${s.id} vs ${d.id}`);
      } else {
        for (const d of docQ) assert.ok(Math.abs(d.t - s.t) > 30 || distKm(d.lat, d.lon, s.lat, s.lon) >= 150, `${s.id} vs ${d.id}`);
      }
    }
  }
});

test('landslides happen on steep susceptible land', () => {
  const lv = data.levels.layers;
  const evs = sched.eventsBetween(Y(-2000), Y(-1995), { types: ['landslide'] });
  assert.ok(evs.length > 1000);
  let bad = 0;
  for (const e of evs) {
    const c = simCellOf(e.lat, e.lon);
    if (lv.land[c] === 0 || lv.landslide[c] === 0) bad++;
    assert.ok(e.level <= Math.max(1, lv.landslide[c]) || e.trigger === 'earthquake');
  }
  assert.ok(bad / evs.length < 0.05, `landslides off susceptible land: ${bad}/${evs.length}`);
  const lvHist = [0, 0, 0, 0, 0, 0];
  for (const e of evs) lvHist[e.level]++;
  assert.ok(lvHist[1] > lvHist[3], 'small landslides dominate');
});

test('filters and helpers', () => {
  const evs = sched.eventsBetween(Y(1900), Y(1910), { types: ['earthquake'], minLevel: 4 });
  assert.ok(evs.length > 0 && evs.every(e => e.type === 'earthquake' && e.level >= 4));
  const L = sched.levelsAt(35.7, 139.7);
  assert.ok(L.quake >= 4 && L.place === 'Япония');
  assert.match(sched.label(evs[0]), /^Землетрясение/);
  const st = sched.stats();
  // complete-era (1964–2025) global M>=6 rate is ~130–150 per year
  assert.ok(st.ratesPerYear.earthquakesInstrumental > 120 && st.ratesPerYear.earthquakesInstrumental < 160, String(st.ratesPerYear.earthquakesInstrumental));
});
