// Dynamic resolution controller (src/game/dynres.js) on a modelled GPU and display: a frame costs the GPU
// fixed + perPixel * scale² ms; frames are shown on vsync (60 Hz), so a frame that overruns 16.7 ms takes two refreshes;
// timer-query results arrive 3 frames late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicResolution } from '../src/game/dynres.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function simulate({ fixed, perPixel, seconds, start = 0.5, timer = true, cap = 0, hz = 60, noise = 0, seed = 1, post = 0 }) {
  const d = new DynamicResolution({ min: 0.5, max: 1, start });
  const vsync = 1000 / hz, capMs = cap > 0 ? 1000 / cap : 0, rand = rng(seed), lag = [];
  const trace = [];
  let now = 10, late = 0, frames = 0;
  while (now < 10 + seconds) {
    const s = d.scale;
    const scene = (fixed + perPixel * s * s) * (1 + noise * (rand() - 0.5) * 2), pass = s < 1 ? post : 0;
    const gpu = scene + pass;
    const interval = Math.max(capMs, vsync * Math.ceil(gpu / vsync - 1e-9));
    lag.push([scene, pass]);
    if (lag.length > 3) { const g = lag.shift(); if (timer) d.gpuSample(g[0], g[1], now); }
    now += interval / 1000;
    d.update(interval, capMs, now);
    trace.push({ t: now - 10, scale: d.scale, interval });
    frames++; if (interval > (capMs || 1000 / 60) * 1.2) late++;
  }
  return { d, trace, late, frames };
}
// direction changes of the scale after time t0
function reversals(trace, t0) {
  let dir = 0, n = 0;
  for (let i = 1; i < trace.length; i++) {
    if (trace[i].t < t0) continue;
    const dd = Math.sign(trace[i].scale - trace[i - 1].scale);
    if (dd && dir && dd !== dir) n++;
    if (dd) dir = dd;
  }
  return n;
}
const lateShare = (trace, t0) => { const f = trace.filter(x => x.t >= t0); return f.filter(x => x.interval > 20).length / f.length; };

test('60 Hz, no cap, GPU timer: rises back to 100% when the GPU has room', () => {
  // 10 ms at full scale: every frame is 16.7 ms on vsync, which the old 14.5 ms rule read as "no headroom"
  const { d, trace } = simulate({ fixed: 2, perPixel: 8, seconds: 12 });
  assert.equal(d.scale, 1);
  const reached = trace.find(x => x.scale === 1);
  assert.ok(reached && reached.t < 8, `reached 100% at ${reached?.t}`);
});

test('heavy load: drops to the floor and stays there', () => {
  const { d, trace } = simulate({ fixed: 3, perPixel: 60, seconds: 15, start: 1 });
  assert.equal(d.scale, 0.5);
  assert.ok(trace.find(x => x.scale === 0.5).t < 5);
});

test('medium load with noisy timings: settles inside the budget without see-sawing', () => {
  // 22 ms at full scale: holds 60 FPS somewhere around 70-80%
  const { d, trace } = simulate({ fixed: 2, perPixel: 20, seconds: 60, start: 1, noise: 0.1, seed: 7 });
  assert.ok(d.scale >= 0.62 && d.scale <= 0.86, `scale ${d.scale}`);
  assert.ok(reversals(trace, 10) <= 2, `reversals ${reversals(trace, 10)}`);
  assert.ok(lateShare(trace, 10) < 0.03, `late ${lateShare(trace, 10)}`);
});

test('the load changes: follows it down and back up', () => {
  const d = new DynamicResolution({ start: 1 });
  let now = 0;
  const run = (gpuAtFull, seconds) => {
    const lag = [];
    for (const end = now + seconds; now < end;) {
      const gpu = 1 + gpuAtFull * d.scale * d.scale;
      const interval = 1000 / 60 * Math.ceil(gpu / (1000 / 60));
      lag.push(gpu); if (lag.length > 3) d.gpuSample(lag.shift(), 0, now);
      now += interval / 1000;
      d.update(interval, 0, now);
    }
  };
  run(8, 5); assert.equal(d.scale, 1);
  run(60, 8); assert.equal(d.scale, 0.5);   // e.g. zoomed into a heavy view
  run(8, 10); assert.equal(d.scale, 1);     // back out: it climbs back
});

test('no GPU timer: probes upwards on vsync and reaches 100% when there is room', () => {
  const { d } = simulate({ fixed: 2, perPixel: 8, seconds: 60, timer: false });
  assert.equal(d.scale, 1);
  assert.equal(d.mode, 'frames');
});

test('no GPU timer: failed probes back off (rare, short dips)', () => {
  const { d, trace } = simulate({ fixed: 2, perPixel: 20, seconds: 120, start: 1, timer: false, noise: 0.05, seed: 3 });
  const failed = d.history.filter(h => h.why === 'probe failed').length;
  assert.ok(failed <= 6, `failed probes ${failed}`);
  assert.ok(lateShare(trace, 20) < 0.06, `late ${lateShare(trace, 20)}`);
  assert.ok(d.scale >= 0.55 && d.scale <= 0.85, `scale ${d.scale}`);
});

test('a 30 FPS cap is the goal: 33 ms frames are on target, not slow', () => {
  const { d } = simulate({ fixed: 2, perPixel: 18, seconds: 15, cap: 30 });
  assert.equal(d.scale, 1);
  const f = simulate({ fixed: 2, perPixel: 18, seconds: 60, cap: 30, timer: false });
  assert.equal(f.d.scale, 1);
});

test('a fast screen without a cap aims at 60 FPS, not at its refresh rate', () => {
  // 144 Hz, 12 ms at full scale: 83 FPS is plenty, the picture stays at 100%
  const { d } = simulate({ fixed: 2, perPixel: 10, seconds: 20, start: 1, hz: 144 });
  assert.equal(d.scale, 1);
});

test('upscale passes cost the same at every scale and nothing at 100%: they count in the prediction', () => {
  // scene 9 ms at full scale, passes 5 ms below it: 100% (9 ms) is cheaper than 90% (12.3 ms), climbs there
  const a = simulate({ fixed: 1, perPixel: 8, post: 5, seconds: 15 });
  assert.equal(a.d.scale, 1);
  // scene 13 ms at full scale, passes 2.5 ms: stays below 100% would cost more than the goal → holds where it fits
  const b = simulate({ fixed: 1, perPixel: 12, post: 2.5, seconds: 20, start: 1 });
  assert.ok(b.d.scale === 1 || b.d.predict(b.d.scale) < 1000 / 60 * 0.88, `scale ${b.d.scale}`);
  // heavy scene with passes: goes down knowing the passes stay
  const c = simulate({ fixed: 2, perPixel: 30, post: 4, seconds: 20, start: 1 });
  assert.ok(c.d.scale < 0.75 && c.d.predict(c.d.scale) < 1000 / 60 * 0.9, `scale ${c.d.scale}`);
  assert.ok(lateShare(c.trace, 8) < 0.03, `late ${lateShare(c.trace, 8)}`);
});

test('frames that start missing after a step up (load the timer does not see) take the step back', () => {
  // the timed scene is light, but above 70% something untimed (compositor, other programs) makes frames miss
  const d = new DynamicResolution({ start: 0.5 });
  let now = 0, late = 0, frames = 0;
  const lag = [];
  for (; now < 40;) {
    const s = d.scale, scene = 1 + 6 * s * s;
    const interval = s > 0.7 ? 1000 / 60 * (frames % 3 === 0 ? 2 : 1) : 1000 / 60;
    lag.push(scene); if (lag.length > 3) d.gpuSample(lag.shift(), 0, now);
    now += interval / 1000; frames++;
    d.update(interval, 0, now);
    if (now > 20 && interval > 20) late++;
  }
  assert.ok(d.scale <= 0.7, `scale ${d.scale}`);
  assert.ok(d.history.some(h => h.why === 'late after a step up'));
  assert.ok(late / frames < 0.08, `late ${late / frames}`);
});
