// The cloud / precipitation channel (G) is spatially coherent: rain areas and the cloud band below the
// rain threshold come in patches several cells wide (mesoscale noise), not as per-cell salt-and-pepper,
// while the channel encoding stays (0-127 cloud fraction, 128-255 precipitation) and every cell keeps
// its wet-day frequency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { synthNormals, N, W, H } from './weather-fixtures.mjs';
import { createWeather, fromDate } from '../src/sim/weather/core.js';

const n = synthNormals();

test('cloud field: coherent patches, encoding kept, wet-day frequency per cell as the normals say', () => {
  const t0 = fromDate(2000, 7, 1);
  const sim = createWeather({ normals: n, mask: n.mask, seed: 3, t: t0, options: { events: false } });
  const DAYS = 30;
  let rho = 0, iso = 0, wet = 0, bad = 0;
  const wetDays = new Uint16Array(N);
  for (let d = 1; d <= DAYS; d++) {
    const g = sim.step(t0 + d).grid;
    const cf = new Float32Array(N);
    let m = 0;
    for (let c = 0; c < N; c++) {
      const G = g[c * 4 + 1];
      cf[c] = G >= 128 ? 1 : G / 127; m += cf[c];
      if ((G >= 128) !== (sim.precip[c] > 0)) bad++;
      if (G >= 128) wetDays[c]++;
    }
    m /= N;
    let v = 0, cv = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) { const c = y * W + x, a = cf[c] - m, b = cf[c + 1] - m; v += a * a; cv += a * b; }
    rho += cv / v / DAYS;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = y * W + x;
      if (g[c * 4 + 1] < 128) continue;
      wet++;
      if (g[(c - 1) * 4 + 1] < 128 && g[(c + 1) * 4 + 1] < 128 && g[(c - W) * 4 + 1] < 128 && g[(c + W) * 4 + 1] < 128) iso++;
    }
  }
  console.log(`# cloud field: neighbour correlation ${rho.toFixed(3)}, isolated wet cells ${((100 * iso) / wet).toFixed(2)} %`);
  assert.equal(bad, 0, 'G >= 128 exactly where it precipitates');
  assert.ok(rho > 0.93, `neighbour correlation of cloud cover ${rho.toFixed(3)} (white cell noise gave ~0.74)`);
  assert.ok(iso / wet < 0.01, `isolated wet cells ${((100 * iso) / wet).toFixed(2)} % (white cell noise gave ~7 %)`);
  // wet-day frequency: area mean over cells with p(wet) in a band matches p = 1 - exp(-mu / 4)
  const mo = 6 * N; // July
  let pSum = 0, fSum = 0, k = 0;
  for (let c = 0; c < N; c++) {
    const mu = n.prec[mo + c] / 31;
    const p = 1 - Math.exp(-mu / 4);
    if (p < 0.2 || p > 0.8) continue;
    pSum += p; fSum += wetDays[c] / DAYS; k++;
  }
  assert.ok(k > 10000);
  assert.ok(Math.abs(fSum / pSum - 1) < 0.08, `wet-day frequency ${(fSum / k).toFixed(3)} vs expected ${(pSum / k).toFixed(3)}`);
});
