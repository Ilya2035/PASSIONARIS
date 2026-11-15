// Orbit camera over the ground: a target point (lat, lon) anywhere on the Earth, a distance ("height", from 20 km
// to the whole ball in the window), a tilt from straight down and a heading. Driven the way grand strategy maps are (docs/album/sky.md, «Камера»):
//   the cursor at an edge of the window, W A S D or the arrows   move the map; the higher the camera, the faster
//   wheel                                                        nearer and farther, toward the point under the cursor
//   left drag                                                    drags the ground
//   middle or right drag, Q and E, R and F                       turn the view, tilt it toward the horizon and back
//   double click (ui.js), 1–6, N, Home                           fly to the point, set heights, north up, straight down
// Every move goes to a target state and the shown state eases toward it, so nothing jerks.
// The whole Earth (docs/album/sky.md, «Камера над всей Землёй»): the longitude of the target runs on past ±180° while
// the map is being moved and is brought back into −180…180 once shown, so a flight always takes the short way round;
// the latitude stops at ±85° (geo.js, worldLL); the higher the camera, the less it can tilt — at the top the ball
// stands whole in the middle of the window.
import { PerspectiveCamera, Vector3 } from 'three';
import { R, toWorld, fromWorld, frame, worldLL, wrapLon, KM_PER_DEG } from './geo.js';

// (at the largest tilt the camera looks along the ground: the horizon is in the middle of the window, the sky above)
// (from H_MAX the ball of the Earth takes seven eighths of the height of the window)
export const H_MIN = 20, H_MAX = 20000, TILT_MAX = 88;
export const H_TILT = 2000;         // up to this height the view tilts all the way; above it less and less, at H_MAX not at all
export const PAN_H = 8000;          // above this height the map moves no faster: the ball turns a quarter in about a second and a half
export const EDGE_PX = 14;          // the strip along the edges of the window that moves the map
export const PAN_RATE = .85;        // the map moves this many heights of the camera per second (about the width of the view)
const FAST = 2.5, TURN_RATE = 70, TILT_RATE = 45, D = Math.PI / 180;

// ---- the rules of the controls as plain functions (tests/album-sky.test.mjs)
// The largest tilt at a height: the whole of TILT_MAX up to H_TILT, then falling evenly with each doubling of the height.
export const tiltCap = h => TILT_MAX * Math.max(0, Math.min(1, Math.log(H_MAX / h) / Math.log(H_MAX / H_TILT)));
// The copy of a longitude that lies nearest to another one (179° seen from −179° is −181°).
export const nearLon = (lon, ref) => ref + wrapLon(lon - ref);
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
  const len = Math.max(1, Math.hypot(push.x, push.y)), a = s.heading * D, km = Math.min(s.h, PAN_H) * PAN_RATE * (fast ? FAST : 1) * dt / len;
  const e = push.x * km, n = push.y * km / Math.max(.45, Math.cos(s.tilt * D));
  // (near a pole a kilometre is many degrees of longitude: there the map turns no faster than at 78°)
  return { lat: (n * Math.cos(a) - e * Math.sin(a)) / KM_PER_DEG, lon: (n * Math.sin(a) + e * Math.cos(a)) / (KM_PER_DEG * Math.max(.2, Math.cos(s.lat * D))) };
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
    // (lat, lon) → the ground there, km of the scene; the longitude goes in as −180…180, the sea and no data count as 0
    this.ground = (lat, lon) => { const m = groundAt(lat, wrapLon(lon)); return m > 0 ? m * this.exag / 1000 : 0; };
    this.s = { lat: 40.4, lon: -3.2, h: 500, tilt: 0, heading: 0 };   // shown state
    this.t = { ...this.s };                 // target state, eased toward
    this.exag = 1; this.changed = true; this.listeners = [];
    this.shot = !!opt.shot; this.upDown = opt.upDown || (() => true);
    this.edgePan = !this.shot;              // the switch «Сдвиг карты у края экрана» (aspects/sky.js)
    this.keys = new Set(); this.ptr = null; this.drag = null; this.anchor = null; this.lift = 0;
    if (dom) this.bind(dom);
  }
  on(fn) { this.listeners.push(fn); }
  set(o, instant) {
    if (o.lon !== undefined) o = { ...o, lon: nearLon(o.lon, this.s.lon) };   // a flight takes the short way round the ball
    Object.assign(this.t, o); this.anchor = null; this.limit();
    if (instant) { Object.assign(this.s, this.t); this.s.tilt = Math.min(this.s.tilt, tiltCap(this.s.h)); this.wrap(); }
    this.changed = true;
  }
  flyTo(o) { this.set(o, false); }
  limit() {
    const t = this.t, c = worldLL(t.lat, t.lon);
    t.lat = c.lat; t.lon = c.lon; t.h = Math.max(H_MIN, Math.min(H_MAX, t.h)); t.tilt = Math.max(0, Math.min(TILT_MAX, t.tilt));
  }
  // the shown longitude back into −180…180; everything that is counted from it moves by the same whole turn
  wrap() {
    const d = wrapLon(this.s.lon) - this.s.lon; if (!d) return;
    this.s.lon += d; this.t.lon += d; if (this.anchor) this.anchor.lon += d; if (this.drag?.g) this.drag.g.lon += d;
  }
  // the ground point under a place of the window, by the picture as it is shown now: { lat, lon } or null (the sky);
  // its longitude is the copy nearest to the middle of the view
  groundUnder(clientX, clientY) {
    const r = this.dom.getBoundingClientRect(), c = this.cam;
    const d = new Vector3((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, .5).unproject(c).sub(c.position).normalize();
    const o = c.position.clone().add(new Vector3(0, R, 0)), b = o.dot(d), oo = o.dot(o);
    let ll = null, rad = R;
    for (let i = 0; i < 4; i++) {
      const disc = b * b - (oo - rad * rad);
      if (disc < 0 || -b - Math.sqrt(disc) < 0) return ll;
      ll = fromWorld(c.position.clone().addScaledVector(d, -b - Math.sqrt(disc))); ll.lon = nearLon(ll.lon, this.s.lon);
      rad = R + this.ground(ll.lat, ll.lon);
    }
    return ll;
  }
  bind(dom) {
    const typing = e => { const el = e.target; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el?.isContentEditable; };
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => {
      this.drag = { b: e.button, x: e.clientX, y: e.clientY, g: e.button === 0 ? this.groundUnder(e.clientX, e.clientY) : null };
      if (e.button === 0) { this.t.lat = this.s.lat; this.t.lon = this.s.lon; this.anchor = null; }   // the hand stops the map
      try { dom.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    });
    const up = e => { this.drag = null; if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId); };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('pointermove', e => {
      const drag = this.drag; if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = this.t;
      if (!dx && !dy) return;
      if (drag.b === 0) {
        // The ground follows the hand: the point that was grabbed stays under the cursor. This move is not eased:
        // the hand itself is smooth, and a map that lags behind it feels loose.
        const s = this.s, kmPerPx = 2 * s.h * Math.tan(this.cam.fov * Math.PI / 360) / dom.clientHeight, cl = Math.cos(t.lat * D);
        const p1 = drag.g && this.groundUnder(e.clientX, e.clientY);
        let dLat, dLon;
        if (p1) { dLat = drag.g.lat - p1.lat; dLon = wrapLon(drag.g.lon - p1.lon); }
        else { const st = panStep({ ...s, h: kmPerPx / PAN_RATE }, { x: -dx, y: dy }, Math.hypot(dx, dy)); dLat = st.lat; dLon = st.lon; }
        // near the horizon one pixel is a great distance: the drag never runs faster than six times the middle of the view
        const km = Math.hypot(dLat * KM_PER_DEG, dLon * KM_PER_DEG * cl), most = 6 * kmPerPx * Math.hypot(dx, dy);
        if (km > most) { dLat *= most / km; dLon *= most / km; }
        t.lat += dLat; t.lon += dLon; this.limit(); s.lat = t.lat; s.lon = t.lon; this.wrap(); this.pose(0);
      } else { t.heading -= dx * 0.25; t.tilt = Math.min(t.tilt, tiltCap(this.s.h)) - dy * 0.2; }
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
        if (km <= most) { this.anchor.x = e.clientX; this.anchor.y = e.clientY; }   // (the anchor is the very point under the cursor)
        Object.assign(this.t, zoomAbout(s, P, h1));
      } else { this.anchor = null; this.t.h = h1; }
      this.limit(); this.changed = true;
    }, { passive: false });
    addEventListener('keydown', e => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      // on the map shown on its own the up and down arrows move the map and must not also turn the pages of the
      // album behind it (the album's own handler in ui.js comes after this one)
      if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && this.upDown()) { e.stopImmediatePropagation(); e.preventDefault(); }
      const h = { Digit1: 20, Digit2: 50, Digit3: 200, Digit4: 500, Digit5: 2000, Digit6: H_MAX }[e.code];
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
    this.aspect = aspect;
    if (!this.shot && this.dom) {
      const ask = this.push(), step = Math.min(dt, .1);
      if (ask.x || ask.y) { const st = panStep(s, ask, step, ask.fast); t.lat += st.lat; t.lon += st.lon; this.anchor = null; }
      if (ask.turn) t.heading += ask.turn * TURN_RATE * step * (ask.fast ? 1.8 : 1);
      if (ask.tilt) t.tilt = Math.min(t.tilt, tiltCap(s.h)) + ask.tilt * TILT_RATE * step * (ask.fast ? 1.8 : 1);
      if (ask.x || ask.y || ask.turn || ask.tilt) { this.limit(); this.changed = true; }
    }
    const k = 1 - Math.exp(-dt * 7), A = this.anchor;
    let moving = false;
    const dh = Math.log(t.h / s.h); if (Math.abs(dh) > 1e-5) { s.h *= Math.exp(dh * k); moving = true; }
    if (A && moving) { const c = worldLL(A.lat + A.kLat * s.h, A.lon + A.kLon * s.h); s.lat = c.lat; s.lon = c.lon; }   // the wheel: the point under the cursor stays put
    else { if (A) this.anchor = null; for (const key of ['lat', 'lon']) { const d = t[key] - s[key]; if (Math.abs(d) > 1e-6) { s[key] += d * k; moving = true; } } }
    // (the tilt asked for is kept; shown is as much of it as the height allows, so coming back down brings it back)
    for (const key of ['tilt', 'heading']) { const d = (key === 'tilt' ? Math.min(t.tilt, tiltCap(s.h)) : t[key]) - s[key]; if (Math.abs(d) > 1e-6) { s[key] += d * k; moving = true; } }
    this.wrap();
    if (this.pose(dt)) moving = true;
    // The wheel, exactly. Relief and the roundness of the Earth bend the simple rule a little, so the point that was
    // under the cursor is looked up again in the new picture, and the view is moved by what it has strayed.
    if (A && this.anchor && A.x !== undefined && this.dom) {
      const p = this.groundUnder(A.x, A.y);
      if (p) {
        const c = worldLL(s.lat + A.lat - p.lat, s.lon + A.lon - p.lon); s.lat = c.lat; s.lon = c.lon;
        A.kLat = (s.lat - A.lat) / s.h; A.kLon = (s.lon - A.lon) / s.h; t.lat = A.lat + A.kLat * t.h; t.lon = A.lon + A.kLon * t.h; this.limit();
        this.wrap(); this.pose(0);
      }
    }
    if (moving || this.changed) { this.changed = false; for (const fn of this.listeners) fn(s); return true; }
    return false;
  }
  // puts the camera where the shown state says; returns true while the eye is still being lifted over the land
  pose(dt) {
    const s = this.s, { up, east, north } = frame(s.lat, s.lon), a = s.heading * D, ti = s.tilt * D;
    const fwd = new Vector3().addScaledVector(north, Math.cos(a)).addScaledVector(east, Math.sin(a));
    const ground = this.ground(s.lat, s.lon);
    const target = toWorld(s.lat, s.lon, ground);
    const pos = target.clone().addScaledVector(up, s.h * Math.cos(ti)).addScaledVector(fwd, -s.h * Math.sin(ti));
    // the eye never sinks into the land under it: it is lifted to keep a clearance, smoothly
    const here = fromWorld(pos), under = this.ground(here.lat, here.lon);
    const need = Math.max(0, under + Math.max(.35, s.h * .02) - here.h), dl = need - this.lift, lifting = Math.abs(dl) > 1e-4;
    if (lifting) this.lift += dl * (1 - Math.exp(-dt * 8));
    if (this.lift > 0) pos.addScaledVector(pos.clone().add(new Vector3(0, R, 0)).normalize(), this.lift);
    const c = this.cam;
    c.position.copy(pos); c.up.copy(ti < 0.02 ? fwd : up); c.lookAt(target);
    const alt = pos.clone().add(new Vector3(0, R, 0)).length() - R;        // camera altitude above the sphere
    // nothing stands nearer to the eye than a part of its height over the land, so the near plane can be far: the
    // depth buffer is then fine enough for the far land too
    c.near = Math.max(0.15, (alt - under) * 0.2); c.far = Math.sqrt(2 * R * alt + alt * alt) * 1.25 + 300;
    c.aspect = this.aspect || 1; c.updateProjectionMatrix(); c.updateMatrixWorld();
    this.alt = alt; this.target = target;
    return lifting && dt > 0;
  }
}
