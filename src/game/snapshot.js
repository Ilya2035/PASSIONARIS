// Map snapshots for save thumbnails: a small JPEG of the map as it is drawn (the HTML interface is not on the canvas).
//
// The WebGL canvas keeps its picture only until the frame is shown (no preserveDrawingBuffer), so it is taken right
// after a frame is drawn: installMapSnapshot() wraps renderer.render, and while a snapshot is waiting, the first render
// to the screen queues a microtask. A microtask runs as soon as the frame callback returns — the whole frame is drawn,
// the browser has not shown it yet.
//
// Nothing in it waits for the GPU (checked on the integrated AMD, where a 2D canvas toBlob() or getImageData() of the
// same picture held the main thread for 170–330 ms, and a worker's OffscreenCanvas still delayed frames by ~100 ms):
//  1. in the microtask, GPU commands only: the screen is resolved into a framebuffer, cropped to 16:9 and halved by
//     blits down to 320×180, read into a pixel buffer (PBO), and a fence is set — no readback yet;
//  2. at the start of the following frames: is the fence passed? then the 230 KB are copied out of the buffer;
//  3. the JPEG is encoded on a CPU-only 2D canvas (toBlob, asynchronous).
// The frame loop itself is not touched. If no frame is drawn in time (a minimised window), the save goes without one.

export const THUMB_W = 320, THUMB_H = 180;
const MAX_CHARS = 40000;            // data URL ≈ 30 KB of JPEG
const QUALITIES = [0.72, 0.55, 0.4];

let gl = null, canvas = null;
let waiting = [];                   // requests waiting for the next drawn frame
let queued = false;
let busy = false;                   // one readback at a time (they share the framebuffers)
let chain = null;                   // { W, H, levels: [{fb, rb, w, h}], pbo } — kept for the next snapshot
// main-thread time of the last snapshot, for checks (window.__mapSnapshot)
export const snapshotStats = { count: 0, grabMs: 0, readMs: 0, frames: 0, chars: 0 };

/** Call once, after the renderer is made. */
export function installMapSnapshot(renderer) {
  if (renderer.__mapSnapshot) return;
  renderer.__mapSnapshot = true;
  canvas = renderer.domElement;
  const ctx = renderer.getContext();
  gl = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? ctx : null;
  const render = renderer.render;
  renderer.render = function (...args) {
    const r = render.apply(this, args);
    if (waiting.length && !queued && !busy && this.getRenderTarget() === null) {
      queued = true;
      queueMicrotask(grab);
      // registered inside the frame callback, so the check runs at the start of the next frames (before the game draws)
      requestAnimationFrame(poll);
    }
    return r;
  };
  if (typeof window !== 'undefined') window.__mapSnapshot = { request: requestMapSnapshot, stats: snapshotStats };
}

/**
 * A thumbnail of the map at the next drawn frame.
 * @param {object} [o] {timeoutMs=2500, maxChars=40000}
 * @returns {Promise<string|null>} 'data:image/jpeg;base64,…' (≤ maxChars), or null (no frame in time, no WebGL2)
 */
export function requestMapSnapshot({ timeoutMs = 2500, maxChars = MAX_CHARS } = {}) {
  if (!gl || !canvas || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const req = { done: false, maxChars, resolve: v => { if (!req.done) { req.done = true; clearTimeout(timer); resolve(v); } } };
    const timer = setTimeout(() => { waiting = waiting.filter(w => w !== req); req.resolve(null); }, timeoutMs);
    waiting.push(req);
  });
}

// ---------------------------------------------------------------- 1. GPU commands right after the frame
let job = null;  // { reqs, sync, frames }

function level(w, h, format = gl.RGBA8) {
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, format, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  return { fb, rb, w, h };
}
function freeChain() {
  if (!chain) return;
  for (const l of chain.levels) { gl.deleteFramebuffer(l.fb); gl.deleteRenderbuffer(l.rb); }
  gl.deleteBuffer(chain.pbo);
  chain = null;
}
// the screen size (a multisampled screen can only be resolved 1:1, in its own format), then the 16:9 centre halved
// step by step (no step shrinks more than 2×, so the bilinear blits average every pixel) down to 320×180
function ensureChain(W, H) {
  if (chain && chain.W === W && chain.H === H) return chain;
  freeChain();
  const s = Math.min(W / THUMB_W, H / THUMB_H);
  const levels = [level(W, H, gl.getContextAttributes()?.alpha === false ? gl.RGB8 : gl.RGBA8)];
  for (let k = s / 2; k > 1.01; k /= 2) levels.push(level(Math.round(THUMB_W * k), Math.round(THUMB_H * k)));
  levels.push(level(THUMB_W, THUMB_H));
  const pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, THUMB_W * THUMB_H * 4, gl.STREAM_READ);
  chain = { W, H, s, levels, pbo };
  return chain;
}

function grab() {
  queued = false;
  const reqs = waiting;
  waiting = [];
  if (!reqs.length) return;
  const t0 = performance.now();
  let sync = null;
  // bindings are read and put back as they were (three.js keeps its own record of them); none of these calls waits
  const prev = gl.isContextLost() ? null : {
    read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    rb: gl.getParameter(gl.RENDERBUFFER_BINDING), pack: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), scissor: gl.isEnabled(gl.SCISSOR_TEST),
  };
  if (prev) {
    try {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      if (W >= THUMB_W / 2 && H >= THUMB_H / 2) {
        const c = ensureChain(W, H);
        if (prev.scissor) gl.disable(gl.SCISSOR_TEST);
        const L = c.levels;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L[0].fb);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        const cw = THUMB_W * c.s, ch = THUMB_H * c.s, x0 = Math.round((W - cw) / 2), y0 = Math.round((H - ch) / 2);
        for (let i = 1; i < L.length; i++) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L[i - 1].fb);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L[i].fb);
          if (i === 1) gl.blitFramebuffer(x0, y0, x0 + Math.round(cw), y0 + Math.round(ch), 0, 0, L[1].w, L[1].h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
          else gl.blitFramebuffer(0, 0, L[i - 1].w, L[i - 1].h, 0, 0, L[i].w, L[i].h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L[L.length - 1].fb);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, c.pbo);
        gl.readPixels(0, 0, THUMB_W, THUMB_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
      }
    } catch (e) { console.warn('[snapshot]', e); sync = null; }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prev.draw);
    gl.bindRenderbuffer(gl.RENDERBUFFER, prev.rb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev.pack);
    if (prev.scissor) gl.enable(gl.SCISSOR_TEST);
  }
  snapshotStats.grabMs = performance.now() - t0;
  if (!sync) { for (const r of reqs) r.resolve(null); return; }
  busy = true;
  job = { reqs, sync, frames: 0 };
}

// ---------------------------------------------------------------- 2. the pixels, once the GPU has them
function poll() {
  if (!job) return;   // grab() found nothing to do
  const j = job;
  if (gl.isContextLost()) { end(j, null); return; }
  const st = gl.clientWaitSync(j.sync, 0, 0);   // timeout 0: never waits
  if (st === gl.TIMEOUT_EXPIRED && ++j.frames < 240) { requestAnimationFrame(poll); return; }
  gl.deleteSync(j.sync);
  if (st === gl.TIMEOUT_EXPIRED || st === gl.WAIT_FAILED) { end(j, null); return; }
  const t0 = performance.now();
  const px = new Uint8Array(THUMB_W * THUMB_H * 4);
  const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, chain.pbo);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
  snapshotStats.readMs = performance.now() - t0;
  snapshotStats.frames = j.frames;
  job = null;
  busy = false;
  encode(px, Math.min(...j.reqs.map(r => r.maxChars))).then(url => end(j, url), () => end(j, null));
}

function end(j, url) {
  if (job === j) { job = null; busy = false; }
  snapshotStats.count++;
  snapshotStats.chars = url ? url.length : 0;
  for (const r of j.reqs) r.resolve(url);
}

// ---------------------------------------------------------------- 3. JPEG on the CPU
let cpu = null;
async function encode(px, maxChars) {
  if (!cpu) {
    const c = document.createElement('canvas');
    c.width = THUMB_W; c.height = THUMB_H;
    // willReadFrequently: a CPU canvas — putImageData and the JPEG encoding never touch the GPU
    cpu = c.getContext('2d', { willReadFrequently: true, alpha: false });
  }
  const img = cpu.createImageData(THUMB_W, THUMB_H);
  const row = THUMB_W * 4;
  for (let y = 0; y < THUMB_H; y++) img.data.set(px.subarray((THUMB_H - 1 - y) * row, (THUMB_H - y) * row), y * row); // GL rows go up
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  cpu.putImageData(img, 0, 0);
  let out = null;
  for (const q of QUALITIES) {
    out = await toDataUrl(cpu.canvas, q);
    if (!out || out.length <= maxChars) break;
  }
  return out && out.length <= maxChars ? out : null;
}

function toDataUrl(c, quality) {
  return new Promise(resolve => {
    c.toBlob(blob => {
      if (!blob) { resolve(null); return; }
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    }, 'image/jpeg', quality);
  });
}
