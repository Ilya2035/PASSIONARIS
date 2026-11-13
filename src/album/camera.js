// Orbit camera over the ground: a target point (lat, lon), a distance ("height", 20–2000 km), a tilt from straight
// down and a heading. Driven the way grand strategy maps are (docs/album/sky.md, «Камера»):
//   the cursor at an edge of the window, W A S D or the arrows   move the map; the higher the camera, the faster
//   wheel                                                        nearer and farther, toward the point under the cursor
//   left drag                                                    drags the ground
//   middle or right drag, Q and E, R and F                       turn the view, tilt it toward the horizon and back
//   double click (ui.js), 1–4, N, Home                           fly to the point, set heights, north up, straight down
// Every move goes to a target state and the shown state eases toward it, so nothing jerks.
import { PerspectiveCamera, Vector3 } from 'three';
import { R, toWorld, fromWorld, frame, clampLL, KM_PER_DEG } from './geo.js';

// (at the largest tilt the camera looks along the ground: the horizon is in the middle of the window, the sky above)
export const H_MIN = 20, H_MAX = 2000, TILT_MAX = 88;
export const EDGE_PX = 14;          // the strip along the edges of the window that moves the map
export const PAN_RATE = .85;        // the map moves this many heights of the camera per second (about the width of the view)
const FAST = 2.5, TURN_RATE = 70, TILT_RATE = 45, D = Math.PI / 180;

// ---- the rules of the controls as plain functions (tests/album-sky.test.mjs)
// The cursor near an edge of a window w × h → a push: x to the right, y up the screen (away from the eye), each
// −1..1. Nothing in the middle of the window and nothing when the cursor is outside it; the push starts at .4 on
// the inner side of the strip and grows to 1 at the very edge.
export function edgePush(x, y, w, h, zone = EDGE_PX) {
  if (!(x >= 0 && y >= 0 && x < w && y < h)) return { x: 0, y: 0 };
  const side = (v, max) => (v < zone ? -(1 - v / zone) : v > max - 1 - zone ? 1 - (max - 1 - v) / zone : 0);
  const ramp = k => (k ? Math.sign(k) * (.4 + .6 * Math.abs(k)) : 0);
  return { x: ramp(side(x, w)), y: 0 - ramp(side(y, h)) };
}
// The keys held down → the same kind of push, a turn (+ clockwise), a tilt (+ toward the horizon) and «faster».
// upDown: whether the up and down arrows belong to the map (in the album they turn its pages).
export function keyPush(keys, upDown = true) {
  const on = (...codes) => (codes.some(c => c && keys.has(c)) ? 1 : 0);
  return { x: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'), y: on('KeyW', upDown && 'ArrowUp') - on('KeyS', upDown && 'ArrowDown'),
    turn: on('KeyE') - on('KeyQ'), tilt: on('KeyR') - on('KeyF'), fast: keys.has('ShiftLeft') || keys.has('ShiftRight') };
}
// A push held for dt seconds → how far the target point moves, in degrees. The speed grows with the height of the
// camera: the picture always crosses the window in about the same time.
export function panStep(s, push, dt, fast = false) {
  const len = Math.max(1, Math.hypot(push.x, push.y)), a = s.heading * D, km = s.h * PAN_RATE * (fast ? FAST : 1) * dt / len;
  const e = push.x * km, n = push.y * km / Math.max(.45, Math.cos(s.tilt * D));
  return { lat: (n * Math.cos(a) - e * Math.sin(a)) / KM_PER_DEG, lon: (n * Math.sin(a) + e * Math.cos(a)) / (KM_PER_DEG * Math.cos(s.lat * D)) };
}
// The wheel: where the target goes when the height becomes h1 and the ground point P must stay under the cursor.
// The whole view scales around P, so the target keeps its share of the way to it.
export function zoomAbout(s, P, h1) {
  const k = h1 / s.h;
  return { lat: P.lat + (s.lat - P.lat) * k, lon: P.lon + (s.lon - P.lon) * k, h: h1 };
}

export class AlbumCamera {
  // opt.shot: a still capture — nothing moves by itself; opt.upDown(): do the up and down arrows move the map now
  constructor(dom, groundAt, opt = {}) {
    this.cam = new PerspectiveCamera(32, 1, 1, 9000);
    this.dom = dom;
    this.groundAt = groundAt;               // (lat, lon) → metres
    this.s = { lat: 40.4, lon: -3.2, h: 500, tilt: 0, heading: 0 };   // shown state
    this.t = { ...this.s };                 // target state, eased toward
    this.exag = 1; this.changed = true; this.listeners = [];
    this.shot = !!opt.shot; this.upDown = opt.upDown || (() => true);
    this.edgePan = !this.shot;              // the switch «Сдвиг карты у края экрана» (aspects/sky.js)
    this.keys = new Set(); this.ptr = null; this.drag = null; this.anchor = null; this.lift = 0;
    if (dom) this.bind(dom);
  }
  on(fn) { this.listeners.push(fn); }
  set(o, instant) { Object.assign(this.t, o); this.anchor = null; this.limit(); if (instant) Object.assign(this.s, this.t); this.changed = true; }
  flyTo(o) { this.set(o, false); }
  limit() {
    const t = this.t, c = clampLL(t.lat, t.lon);
    t.lat = c.lat; t.lon = c.lon; t.h = Math.max(H_MIN, Math.min(H_MAX, t.h)); t.tilt = Math.max(0, Math.min(TILT_MAX, t.tilt));
  }
  // the ground point under a place of the window, by the picture as it is shown now: { lat, lon } or null (the sky)
  groundUnder(clientX, clientY) {
    const r = this.dom.getBoundingClientRect(), c = this.cam;
    const d = new Vector3((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, .5).unproject(c).sub(c.position).normalize();
    const o = c.position.clone().add(new Vector3(0, R, 0)), b = o.dot(d), oo = o.dot(o);
    let ll = null, rad = R;
    for (let i = 0; i < 4; i++) {
      const disc = b * b - (oo - rad * rad);
      if (disc < 0 || -b - Math.sqrt(disc) < 0) return ll;
      ll = fromWorld(c.position.clone().addScaledVector(d, -b - Math.sqrt(disc)));
      rad = R + Math.max(0, this.groundAt(ll.lat, ll.lon)) * this.exag / 1000;
    }
    return ll;
  }
  bind(dom) {
    const typing = e => { const el = e.target; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el?.isContentEditable; };
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => { this.drag = { b: e.button, x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
    const up = e => { this.drag = null; if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId); };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('pointermove', e => {
      const drag = this.drag; if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = this.t;
      if (!dx && !dy) return;
      if (drag.b === 0) {
        // the ground follows the cursor: the point that was under it stays under it
        const kmPerPx = 2 * this.s.h * Math.tan(this.cam.fov * Math.PI / 360) / dom.clientHeight, cl = Math.cos(t.lat * D);
        const p0 = this.groundUnder(drag.x, drag.y), p1 = this.groundUnder(e.clientX, e.clientY);
        let dLat, dLon;
        if (p0 && p1) { dLat = p0.lat - p1.lat; dLon = p0.lon - p1.lon; }
        else { const st = panStep({ ...this.s, h: kmPerPx / PAN_RATE }, { x: -dx, y: dy }, Math.hypot(dx, dy)); dLat = st.lat; dLon = st.lon; }
        // near the horizon one pixel is a great distance: the drag never runs faster than six times the middle of the view
        const km = Math.hypot(dLat * KM_PER_DEG, dLon * KM_PER_DEG * cl), most = 6 * kmPerPx * Math.hypot(dx, dy);
        if (km > most) { dLat *= most / km; dLon *= most / km; }
        t.lat += dLat; t.lon += dLon;
      } else { t.heading -= dx * 0.25; t.tilt -= dy * 0.2; }
      drag.x = e.clientX; drag.y = e.clientY;
      this.anchor = null; this.limit(); this.changed = true;
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      const s = this.s, h1 = Math.max(H_MIN, Math.min(H_MAX, this.t.h * Math.exp(e.deltaY * (e.deltaMode === 1 ? 33 : 1) * 0.0011)));
      let P = this.groundUnder(e.clientX, e.clientY);
      if (P) {
        // a point far off toward the horizon would throw the view: the pull toward it is kept within two heights
        const cl = Math.cos(s.lat * D), km = Math.hypot((P.lat - s.lat) * KM_PER_DEG, (P.lon - s.lon) * KM_PER_DEG * cl), most = 2 * s.h;
        if (km > most) P = { lat: s.lat + (P.lat - s.lat) * most / km, lon: s.lon + (P.lon - s.lon) * most / km };
        this.anchor = { lat: P.lat, lon: P.lon, kLat: (s.lat - P.lat) / s.h, kLon: (s.lon - P.lon) / s.h };
        Object.assign(this.t, zoomAbout(s, P, h1));
      } else { this.anchor = null; this.t.h = h1; }
      this.limit(); this.changed = true;
    }, { passive: false });
    addEventListener('keydown', e => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      const h = { Digit1: 20, Digit2: 50, Digit3: 200, Digit4: 500 }[e.code];
      if (h) this.flyTo({ h });
      if (e.code === 'KeyN') this.flyTo({ heading: 0 });
      if (e.code === 'Home') this.flyTo({ heading: 0, tilt: 0 });
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.ptr = null; });
    // where the cursor is, for the push at the edges: only while it is inside the window and over the map itself
    addEventListener('pointermove', e => { this.ptr = { x: e.clientX, y: e.clientY, over: e.target === dom }; });
    document.documentElement.addEventListener('pointerleave', () => { this.ptr = null; });
  }
  // what the keys and the cursor at the edge ask for right now
  push() {
    const k = keyPush(this.keys, this.upDown()), p = this.ptr;
    if (this.edgePan && p && p.over && !this.drag && !k.x && !k.y) { const e = edgePush(p.x, p.y, innerWidth, innerHeight); k.x = e.x; k.y = e.y; }
    return k;
  }
  // eases toward the target; returns true while moving
  update(dt, aspect) {
    const s = this.s, t = this.t;
    if (!this.shot && this.dom) {
      const ask = this.push(), step = Math.min(dt, .1);
      if (ask.x || ask.y) { const st = panStep(s, ask, step, ask.fast); t.lat += st.lat; t.lon += st.lon; this.anchor = null; }
      if (ask.turn) t.heading += ask.turn * TURN_RATE * step * (ask.fast ? 1.8 : 1);
      if (ask.tilt) t.tilt += ask.tilt * TILT_RATE * step * (ask.fast ? 1.8 : 1);
      if (ask.x || ask.y || ask.turn || ask.tilt) { this.limit(); this.changed = true; }
    }
    const k = 1 - Math.exp(-dt * 7), A = this.anchor;
    let moving = false;
    const dh = Math.log(t.h / s.h); if (Math.abs(dh) > 1e-5) { s.h *= Math.exp(dh * k); moving = true; }
    if (A && moving) { const c = clampLL(A.lat + A.kLat * s.h, A.lon + A.kLon * s.h); s.lat = c.lat; s.lon = c.lon; }   // the wheel: the point under the cursor stays put
    else { if (A) this.anchor = null; for (const key of ['lat', 'lon']) { const d = t[key] - s[key]; if (Math.abs(d) > 1e-6) { s[key] += d * k; moving = true; } } }
    for (const key of ['tilt', 'heading']) { const d = t[key] - s[key]; if (Math.abs(d) > 1e-6) { s[key] += d * k; moving = true; } }
    const { up, east, north } = frame(s.lat, s.lon), a = s.heading * D, ti = s.tilt * D;
    const fwd = new Vector3().addScaledVector(north, Math.cos(a)).addScaledVector(east, Math.sin(a));
    const ground = Math.max(0, this.groundAt(s.lat, s.lon)) * this.exag / 1000;
    const target = toWorld(s.lat, s.lon, ground);
    const pos = target.clone().addScaledVector(up, s.h * Math.cos(ti)).addScaledVector(fwd, -s.h * Math.sin(ti));
    // the eye never sinks into the land under it: it is lifted to keep a clearance, smoothly
    const here = fromWorld(pos), under = Math.max(0, this.groundAt(here.lat, here.lon)) * this.exag / 1000;
    const need = Math.max(0, under + Math.max(.35, s.h * .02) - here.h), dl = need - this.lift;
    if (Math.abs(dl) > 1e-4) { this.lift += dl * (1 - Math.exp(-dt * 8)); moving = true; }
    if (this.lift > 0) pos.addScaledVector(pos.clone().add(new Vector3(0, R, 0)).normalize(), this.lift);
    const c = this.cam;
    c.position.copy(pos); c.up.copy(ti < 0.02 ? fwd : up); c.lookAt(target);
    const alt = pos.clone().add(new Vector3(0, R, 0)).length() - R;        // camera altitude above the sphere
    // nothing stands nearer to the eye than a part of its height over the land, so the near plane can be far: the
    // depth buffer is then fine enough for the far land too
    c.near = Math.max(0.15, (alt - under) * 0.2); c.far = Math.sqrt(2 * R * alt + alt * alt) * 1.25 + 300;
    c.aspect = aspect; c.updateProjectionMatrix(); c.updateMatrixWorld();
    this.alt = alt; this.target = target;
    if (moving || this.changed) { this.changed = false; for (const fn of this.listeners) fn(s); return true; }
    return false;
  }
}
