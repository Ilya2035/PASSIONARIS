// Dynamic resolution: picks the render scale (share of the base resolution, min..max) that holds the frame rate.
// No three.js here — the controller is plain arithmetic, tested in tests/dynres.test.mjs.
//
// The goal is a frame time: the frame cap when one is set, else 60 FPS (16.7 ms; a faster screen does not make the
// picture drop for the sake of 144 FPS). Two ways to see the headroom:
//  * GPU time of a frame (timer queries, post.js GpuTimer) — the real load, even when the display's refresh (vsync)
//    hides it: at 60 Hz every frame lasts 16.7 ms whether the GPU worked 6 ms or 16. The scale goes down when the GPU
//    fills more than ~88% of the goal and up when the next step's predicted time stays under ~74%: between the two
//    it holds, so it cannot see-saw on a steady load. The prediction splits the frame: the scene (∝ pixels, scale²)
//    and the upscale passes (fixed — they work at screen size — and gone at 100%, where the scene goes straight to
//    the screen when freeAtMax is set).
//  * without timer queries, the frame intervals alone: down when frames run late, up at once when they are well
//    ahead of the goal, and on target it probes one step up after a quiet spell, stepping back if frames start to
//    miss — and then waiting twice as long before the next probe.
// Steps are small (≤ 0.05 up; down by what the load asks for, at most 20% at a time) and spaced ≥ 0.5 s apart.
export class DynamicResolution {
  constructor({ min = 0.5, max = 1, start = 1, step = 0.05 } = {}) {
    this.min = min; this.max = max; this.step = step;
    this.scale = Math.min(max, Math.max(min, start));
    this.interval = 0;      // drawn-frame interval, ms (smoothed, ~0.4 s)
    this.late = 0;          // share of frames that missed the goal (smoothed)
    this.gpu = 0;           // GPU time of a frame, ms (smoothed over samples taken at the current scale)
    this.gpuScene = 0;      // ...of which the scene (the rest: the upscale passes)
    this.post = 0;          // the upscale passes, ms (kept across changes: they do not depend on the scale)
    this.freeAtMax = true;  // at max scale the upscale passes are skipped (set by the caller)
    this.gpuN = 0;          // samples since the last change
    this.gpuAt = -1e9;      // when the last GPU sample came, s
    this.changedAt = -1e9;  // when the scale last changed, s
    this.framesSince = 0;   // frames drawn since then (GPU samples lag 2-3 frames behind)
    this.lateSince = 0;     // ...and how many of them were late
    this.lastDir = 0;       // +1 / -1: the last change
    this.prevScale = this.scale;   // the scale before it
    this.lateAtChange = 0;  // the late-frame share when it was made
    this.upHold = 0;        // s: after a step down, no step up before changedAt + upHold
    this.probe = null;      // fallback: a trial step up being watched { from, at }
    this.probeWait = 2;     // fallback: s on target before the next probe (doubles after a failed one)
    this.started = null;    // first update, s
    this.goalMs = 1000 / 60;
    this.mode = 'idle';     // 'gpu' | 'frames' | 'idle': what the last decision was based on (checks)
    this.history = [];      // the last changes [{ t, scale, why }] (checks)
  }

  // GPU time of one frame (ms) from the timer queries: the scene part and the upscale passes; frames drawn before the
  // last change are skipped
  gpuSample(sceneMs, postMs = 0, now = 0) {
    const ms = sceneMs + postMs;
    if (!(ms > 0) || ms > 1000 || this.framesSince < 4) return;
    const a = this.gpuN ? 0.2 : 1;
    this.gpu += (ms - this.gpu) * a;
    this.gpuScene += (sceneMs - this.gpuScene) * a;
    if (postMs > 0) this.post += (postMs - this.post) * (this.post ? 0.2 : 1);
    this.gpuN++;
    this.gpuAt = now;
  }

  // predicted GPU time of a frame at scale s2
  predict(s2) {
    const post = s2 >= this.max - 1e-3 && this.freeAtMax ? 0 : this.post;
    return this.gpuScene * (s2 / this.scale) ** 2 + post;
  }

  // once per drawn frame: dtMs = time since the previous drawn frame, capMs = the frame cap's interval (0 = none),
  // now in seconds. Returns the scale to draw at.
  update(dtMs, capMs, now) {
    const goal = this.goalMs = capMs > 0 ? capMs : 1000 / 60;
    if (this.started === null) this.started = now;
    if (dtMs > 0 && dtMs < 1000) {   // a pause (hidden window, a load) says nothing about the GPU
      const isLate = dtMs > goal * 1.2;
      const a = 1 - Math.exp(-dtMs / 400);
      this.interval = this.interval ? this.interval + (Math.min(dtMs, goal * 3) - this.interval) * a : dtMs;
      this.late += ((isLate ? 1 : 0) - this.late) * Math.min(1, a * 1.5);
      this.framesSince++;
      if (isLate) this.lateSince++;
    }
    if (now - this.started < 1 || now - this.changedAt < 0.5) return this.scale;   // start-up / let a change show
    // timer samples flowing: wait for a few taken at the current scale; none for 1.5 s: judge by the frames
    if (now - this.gpuAt < 1.5) { if (this.gpuN >= 6) this.byGpu(goal, now); }
    else this.byFrames(goal, now);
    return this.scale;
  }

  byGpu(goal, now) {
    this.mode = 'gpu';
    this.probe = null;
    const load = this.gpu / goal, s = this.scale;
    const missing = this.late > 0.15 && this.interval > goal * 1.08;
    // frames started missing right after a step up although the timed load looked fine: the GPU also works for
    // what the timer does not see (the window compositor, other programs) — take the step back, wait longer
    if (this.lastDir > 0 && now - this.changedAt < 3 && this.framesSince >= 20
      && this.lateSince / this.framesSince > Math.max(0.12, this.lateAtChange + 0.08)) {
      this.down(this.prevScale / s, now, 'late after a step up');
      return;
    }
    // over budget — or frames run late while the GPU is a large part of it (the compositor's share is not timed)
    if (load > 0.88 || (missing && load > 0.7)) {
      // the scale whose predicted time is 80% of the goal (the upscale passes stay, or come back below 100%)
      const room = 0.8 * goal - (this.freeAtMax || s < this.max ? this.post : 0);
      this.down(room > 0 ? Math.sqrt(room / Math.max(this.gpuScene, 1e-3)) : 0, now, load > 0.88 ? 'gpu' : 'late');
      return;
    }
    if (missing || this.held(now) || s >= this.max) return;
    // the largest step (≤ step) whose predicted time stays under 74% of the goal; or 100% at once from close by,
    // when dropping the upscale passes pays for the extra pixels
    const fits = x => this.predict(x) < 0.74 * goal;
    let up = Math.min(this.max, s + this.step);
    if (!fits(up)) {
      const room = 0.74 * goal - this.post;
      up = room > 0 ? Math.min(up, s * Math.sqrt(room / Math.max(this.gpuScene, 1e-3))) : s;
    }
    if (up < this.max && s >= this.max - 3 * this.step && fits(this.max)) up = this.max;
    if (up >= this.max - 0.01 && fits(this.max)) this.set(this.max, now, 'gpu headroom', 1);
    else if (up - s >= 0.02 && up < this.max - 0.01) this.set(up, now, 'gpu headroom', 1);
  }

  byFrames(goal, now) {
    this.mode = 'frames';
    const s = this.scale, since = now - this.changedAt;
    if (this.probe) {
      // a trial step up: frames missing since it → back, and wait twice as long before the next one
      const share = this.lateSince / Math.max(1, this.framesSince);
      if (this.lateSince >= 6 || (since > 1.5 && share > 0.08)) {
        this.probeWait = Math.min(32, this.probeWait * 2);
        this.probe = null;
        this.set(Math.max(this.min, s - this.step), now, 'probe failed', -1);
        this.upHold = this.probeWait;
      } else if (since > 1.5) {
        this.probe = null;
        this.probeWait = Math.max(2, this.probeWait / 2);
      }
      return;
    }
    if (this.interval > goal * 1.1 && this.late > 0.15) { this.down(Math.sqrt(goal * 0.95 / this.interval), now, 'late'); return; }
    if (s >= this.max || this.held(now)) return;
    if (this.interval < goal * 0.8 && this.late < 0.05) { this.set(Math.min(this.max, s + this.step), now, 'fast frames', 1); return; }
    // on target (vsync or the cap hides the headroom): try one step up after a quiet spell
    if (this.interval <= goal * 1.05 && this.late < 0.05 && since > this.probeWait) {
      this.probe = { from: s, at: now };
      this.set(Math.min(this.max, s + this.step), now, 'probe', 1);
    }
  }

  held(now) { return this.lastDir < 0 && now - this.changedAt < this.upHold; }

  down(factor, now, why) {
    const next = Math.max(this.min, this.scale * Math.min(0.97, Math.max(0.8, factor)));
    if (next >= this.scale - 1e-4) return;
    // straight down after a step up = the step up was one too many: hold the next one back longer
    this.upHold = this.lastDir > 0 && now - this.changedAt < 4 ? Math.min(16, Math.max(2, this.upHold * 2)) : 1.5;
    this.set(next, now, why, -1);
  }

  set(scale, now, why, dir) {
    this.prevScale = this.scale;
    this.lateAtChange = this.late;
    this.scale = Math.round(scale * 1000) / 1000;
    this.changedAt = now;
    this.lastDir = dir;
    this.framesSince = 0; this.lateSince = 0;
    this.gpuN = 0;
    this.history.push({ t: Math.round(now * 100) / 100, scale: this.scale, why });
    if (this.history.length > 40) this.history.shift();
  }
}
