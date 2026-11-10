// Aerosol layer (src/sim/aerosols): decay, transport by the prevailing winds, conservation, determinism, the
// empty-field fast path, saves, the volcanic winter and the GPU encoding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AerosolSim, AW, AH, AN, ASH, SMOKE, DUST, SULF, SO2, PARAMS, EARTH_KM2, windAt,
  eruptionSources, impactSources, fireSources, dustStormSources,
} from '../src/sim/aerosols/index.js';

const D2R = Math.PI / 180;
// area-weighted centroid (lat, lon relative to lon0, unwrapped) of a species
function centroid(sim, s, lon0 = 0) {
  const a = sim.f[s];
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < AH; y++) {
    const lat = 89.5 - y, cw = Math.cos(lat * D2R);
    for (let x = 0; x < AW; x++) {
      const v = a[y * AW + x];
      if (!v) continue;
      let dl = (x - 179.5) - lon0;
      dl = ((dl + 540) % 360) - 180;
      sx += dl * v * cw; sy += lat * v * cw; sw += v * cw;
    }
  }
  return { lat: sy / sw, dlon: sx / sw };
}
function run(sim, days, step = 0.25) {
  let t = sim.t;
  const n = Math.round(days / step);
  for (let i = 0; i < n; i++) { t += step; sim.advanceTo(t); }
}

test('decay: ash and smoke vanish with their e-folding times, the sulphate stays for a year', () => {
  for (const [s, life] of [[ASH, PARAMS[ASH].life], [SMOKE, PARAMS[SMOKE].life], [SULF, PARAMS[SULF].life]]) {
    const sim = new AerosolSim({ t: 0, windScale: 0 });
    sim.inject(s, 30, 40, 400, 1e6);
    const m0 = sim.totalMass(s);
    assert.ok(Math.abs(m0 - 1e6) / 1e6 < 1e-4, `injected mass ${m0}`);
    run(sim, 4, 0.5);
    const m = sim.totalMass(s), want = m0 * Math.exp(-4 / life);
    assert.ok(Math.abs(m - want) / want < 0.03, `${PARAMS[s].id}: ${m.toFixed(0)} vs ${want.toFixed(0)}`);
  }
});

test('ash settles: the removed ash becomes a ground deposit under the cloud', () => {
  const sim = new AerosolSim({ t: 0, windScale: 0 });
  sim.inject(ASH, -8, 118, 300, 2e6);
  run(sim, 6, 0.5);
  assert.ok(sim.sample('fall', -8, 118) > 0.3, `deposit ${sim.sample('fall', -8, 118)}`);
  assert.equal(sim.sample('fall', 40, -100), 0);
});

test('transport follows the prevailing winds: trades west, westerlies east, polar easterlies west', () => {
  const cases = [
    { lat: 15, dir: -1, equatorward: true },
    { lat: -15, dir: -1, equatorward: true },
    { lat: 45, dir: 1 },
    { lat: -45, dir: 1 },
    { lat: 72, dir: -1 },
  ];
  for (const c of cases) {
    const sim = new AerosolSim({ t: 100 });
    sim.inject(ASH, c.lat, 0, 250, 2e5);
    run(sim, 2);
    const g = centroid(sim, ASH, 0);
    assert.ok(Math.sign(g.dlon) === c.dir && Math.abs(g.dlon) > 3, `lat ${c.lat}: moved ${g.dlon.toFixed(1)} deg of longitude`);
    if (c.equatorward) assert.ok(Math.abs(g.lat) < Math.abs(c.lat) - 1, `lat ${c.lat}: trades drift toward the ITCZ, now ${g.lat.toFixed(1)}`);
    // the analytic circulation the field uses
    assert.equal(Math.sign(windAt(c.lat, 1).u), c.dir);
  }
});

test('mass is conserved by the transport (decay aside), even across the date line and near a pole', () => {
  for (const [lat, lon] of [[10, 179.5], [-60, -179], [82, 30], [0, 0]]) {
    const sim = new AerosolSim({ t: 50 });
    sim.inject(SULF, lat, lon, 600, 5e6);
    const m0 = sim.totalMass(SULF);
    run(sim, 20, 0.5);
    const want = m0 * Math.exp(-20 / PARAMS[SULF].life);
    const m = sim.totalMass(SULF);
    assert.ok(Math.abs(m - want) / want < 0.02, `(${lat}, ${lon}): ${m.toFixed(0)} vs ${want.toFixed(0)}`);
    for (const v of sim.f[SULF]) assert.ok(Number.isFinite(v) && v >= 0);
  }
});

test('determinism: the same events give bit-identical fields', () => {
  const make = () => {
    const sim = new AerosolSim({ t: 2000 });
    for (const s of eruptionSources({ t: 2000, lat: 15.1, lon: 120.3, vei: 6 })) sim.addSource(s);
    for (const s of fireSources({ t0: 2001, t1: 2010, lat: 55, lon: -120, severity: 4 })) sim.addSource(s);
    let t = 2000;
    for (const dt of [0.3, 0.25, 1.7, 0.25, 4, 0.5, 0.25, 9]) { t += dt; sim.advanceTo(t); }
    return sim;
  };
  const a = make(), b = make();
  for (let s = 0; s < 5; s++) assert.deepEqual(Buffer.from(a.f[s].buffer), Buffer.from(b.f[s].buffer));
  assert.deepEqual(Buffer.from(a.fall.buffer), Buffer.from(b.fall.buffer));
  assert.deepEqual(Array.from(a.cooling), Array.from(b.cooling));
});

test('empty field: advancing costs nothing and keeps the field empty', () => {
  const sim = new AerosolSim({ t: 0 });
  assert.ok(sim.empty);
  const t0 = performance.now();
  for (let i = 1; i <= 100000; i++) sim.advanceTo(i * 0.37);
  const ms = performance.now() - t0;
  assert.equal(sim.stats.steps, 0);
  assert.ok(sim.empty && !sim.visible);
  assert.ok(ms < 200, `${ms.toFixed(0)} ms for 100k empty calls`);
  const rgba = new Uint8Array(AN * 4).fill(7), ground = new Uint8Array(AN * 4).fill(7);
  sim.encode(rgba, ground);
  assert.ok(rgba.every(v => v === 0) && ground.every(v => v === 0));
});

test('a fading cloud is dropped and the field becomes empty again', () => {
  const sim = new AerosolSim({ t: 0 });
  for (const s of eruptionSources({ t: 0, lat: 46, lon: 7, vei: 3 })) sim.addSource(s);
  run(sim, 2);
  assert.ok(sim.visible);
  run(sim, 400, 2);
  assert.ok(sim.empty, 'empty after a year');
});

test('big clock jumps: decay only (forward), clear (backward or very far)', () => {
  const sim = new AerosolSim({ t: 0, windScale: 0 });
  sim.inject(SULF, 0, 0, 800, 1e7);
  const m0 = sim.totalMass(SULF);
  sim.advanceTo(200);   // > JUMP: no transport
  const want = m0 * Math.exp(-200 / PARAMS[SULF].life);
  assert.ok(Math.abs(sim.totalMass(SULF) - want) / want < 0.01);
  sim.advanceTo(100);   // backward
  assert.ok(sim.empty);
  assert.equal(sim.t, 100);
});

test('save / load round trip; a missing or foreign state loads as a clear sky', () => {
  const sim = new AerosolSim({ t: 5000 });
  for (const s of eruptionSources({ t: 5000, lat: -8.25, lon: 118, vei: 7 })) sim.addSource(s);
  run(sim, 3);
  const st = sim.serialize();
  assert.ok(st.fields.ash instanceof Float32Array && st.sources.length > 0);
  const b = new AerosolSim();
  assert.ok(b.deserialize(structuredClone(st)));
  for (let s = 0; s < 5; s++) assert.deepEqual(Array.from(b.f[s]), Array.from(sim.f[s]));
  assert.equal(b.t, sim.t);
  // continuing both gives the same result
  run(sim, 2); run(b, 2);
  assert.deepEqual(Array.from(b.f[ASH]), Array.from(sim.f[ASH]));
  const c = new AerosolSim();
  assert.equal(c.deserialize(null), false);
  assert.ok(c.empty);
  assert.equal(c.deserialize({ v: 99 }), false);
  assert.ok(c.empty);
});

test('volcanic winter: VEI 6 ~ half a degree over its hemisphere, VEI 7 one to two degrees, both fade', () => {
  const res = {};
  for (const vei of [5, 6, 7]) {
    const sim = new AerosolSim({ t: 0 });
    for (const s of eruptionSources({ t: 0, lat: 15.1, lon: 120.3, vei })) sim.addSource(s);
    let peak = 0;
    for (let m = 1; m <= 24; m++) { run(sim, 30.4, 1); peak = Math.min(peak, sim.meanCooling(0, 90)); }
    res[vei] = { peak, end: sim.meanCooling(0, 90), sulf: sim.meanTau(SULF) };
  }
  assert.ok(res[5].peak > -0.2 && res[5].peak < -0.02, `VEI 5: ${res[5].peak.toFixed(2)}`);
  assert.ok(res[6].peak < -0.3 && res[6].peak > -0.8, `VEI 6: ${res[6].peak.toFixed(2)}`);
  assert.ok(res[7].peak < -1 && res[7].peak > -2.5, `VEI 7: ${res[7].peak.toFixed(2)}`);
  for (const v of [6, 7]) assert.ok(res[v].end > res[v].peak * 0.5, `VEI ${v} fades after two years`);
});

test('sources: VEI sets the size, only VEI >= 5 reaches the stratosphere; small falls and fires raise nothing', () => {
  assert.equal(eruptionSources({ t: 0, lat: 0, lon: 0, vei: 1 }).length, 0);
  assert.equal(eruptionSources({ t: 0, lat: 0, lon: 0, vei: 4 }).filter(s => s.sp === SO2).length, 0);
  const v6 = eruptionSources({ t: 0, lat: 0, lon: 0, vei: 6 }), v7 = eruptionSources({ t: 0, lat: 0, lon: 0, vei: 7 });
  const so2 = l => l.filter(s => s.sp === SO2).reduce((a, s) => a + s.rate * (s.t1 - s.t0), 0) / EARTH_KM2;
  assert.ok(Math.abs(so2(v6) - 0.12) < 1e-9 && so2(v7) > 3 * so2(v6));
  assert.equal(impactSources({ t: 0, lat: 0, lon: 0, level: 2 }).length, 0);
  assert.equal(impactSources({ t: 0, lat: 0, lon: 0, level: 4 })[0].sp, DUST);
  assert.equal(fireSources({ t0: 0, t1: 5, lat: 0, lon: 0, severity: 2 }).length, 0);
  assert.equal(fireSources({ t0: 0, t1: 5, lat: 0, lon: 0, severity: 4 })[0].sp, SMOKE);
  assert.equal(dustStormSources({ t0: 0, t1: 3, lat: 20, lon: 10, severity: 3 })[0].sp, DUST);
});

test('a smoke plume from a long fire keeps burning while the source is active', () => {
  const sim = new AerosolSim({ t: 0 });
  for (const s of fireSources({ t0: 0, t1: 12, lat: 52, lon: -110, severity: 5 })) sim.addSource(s);
  run(sim, 8);
  const at = sim.sample(SMOKE, 52, -106);
  assert.ok(at > 0.5, `smoke near the fire ${at}`);
  const g = centroid(sim, SMOKE, -110);
  assert.ok(g.dlon > 2, `smoke drifts east with the westerlies (${g.dlon.toFixed(1)})`);
});

test('encoding: R ash, G smoke, B dust, A sulphate; the deposit and the cooling in the ground texture', () => {
  const sim = new AerosolSim({ t: 0, windScale: 0 });
  sim.inject(ASH, 10, 10, 300, 1e6);
  sim.inject(DUST, -20, 20, 300, 1e6);
  sim.fall[90 * AW + 190] = 1;
  sim.cooling[60] = -1;
  sim._extents();
  const rgba = new Uint8Array(AN * 4), ground = new Uint8Array(AN * 4);
  sim.encode(rgba, ground);
  const c = (79 * AW + 189) * 4, d = (109 * AW + 199) * 4;
  assert.ok(rgba[c] > 100 && rgba[c + 1] === 0 && rgba[c + 2] === 0 && rgba[c + 3] === 0);
  assert.ok(rgba[d + 2] > 100 && rgba[d] === 0);
  assert.ok(ground[(90 * AW + 190) * 4] > 100);
  assert.equal(ground[(60 * AW + 5) * 4 + 1], 25);
});

test('performance: a VEI 7 year with a fire season stays cheap', () => {
  const sim = new AerosolSim({ t: 0 });
  for (const s of eruptionSources({ t: 0, lat: -8.25, lon: 118, vei: 7 })) sim.addSource(s);
  for (let k = 0; k < 10; k++) for (const s of fireSources({ t0: 20 + k * 9, t1: 30 + k * 9, lat: 50 + k, lon: -120 + 9 * k, severity: 4 })) sim.addSource(s);
  const t0 = performance.now();
  run(sim, 365, 0.25);
  const ms = performance.now() - t0;
  const per = ms / sim.stats.steps;
  assert.ok(per < 3, `${per.toFixed(2)} ms per step`);
});
