// Orbit camera over the ground: a target point (lat, lon), a distance ("height", 20–2000 km), a tilt from straight
// down and a heading. Wheel = height, left drag = pan, middle or right drag = rotate and tilt, double click = fly there.
import { PerspectiveCamera, Vector3 } from 'three';
import { R, toWorld, frame, clampLL, KM_PER_DEG } from './geo.js';

export const H_MIN = 20, H_MAX = 2000;
export class AlbumCamera {
  constructor(dom, groundAt) {
    this.cam = new PerspectiveCamera(32, 1, 1, 9000);
    this.groundAt = groundAt;               // (lat, lon) → metres
    this.s = { lat: 40.4, lon: -3.2, h: 500, tilt: 0, heading: 0 };   // shown state
    this.t = { ...this.s };                 // target state, eased toward
    this.exag = 1; this.changed = true; this.listeners = [];
    this.bind(dom);
  }
  on(fn) { this.listeners.push(fn); }
  set(o, instant) { Object.assign(this.t, o); this.limit(); if (instant) Object.assign(this.s, this.t); this.changed = true; }
  flyTo(o) { this.set(o, false); }
  limit() {
    const t = this.t, c = clampLL(t.lat, t.lon);
    t.lat = c.lat; t.lon = c.lon; t.h = Math.max(H_MIN, Math.min(H_MAX, t.h)); t.tilt = Math.max(0, Math.min(78, t.tilt));
  }
  bind(dom) {
    let drag = null;
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => { drag = { b: e.button, x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointerup', e => { drag = null; dom.releasePointerCapture(e.pointerId); });
    dom.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = this.t; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 0) {
        const kmPerPx = 2 * t.h * Math.tan(this.cam.fov * Math.PI / 360) / dom.clientHeight, a = t.heading * Math.PI / 180;
        const e_ = -dx * kmPerPx, n_ = dy * kmPerPx / Math.max(0.35, Math.cos(t.tilt * Math.PI / 180));
        t.lat += (n_ * Math.cos(a) - e_ * Math.sin(a)) / KM_PER_DEG;
        t.lon += (n_ * Math.sin(a) + e_ * Math.cos(a)) / (KM_PER_DEG * Math.cos(t.lat * Math.PI / 180));
      } else { t.heading -= dx * 0.25; t.tilt -= dy * 0.2; }
      this.limit(); this.changed = true;
    });
    dom.addEventListener('wheel', e => { e.preventDefault(); this.t.h *= Math.exp(e.deltaY * 0.0011); this.limit(); this.changed = true; }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const h = { Digit1: 20, Digit2: 50, Digit3: 200, Digit4: 500 }[e.code];
      if (h) this.flyTo({ h });
      if (e.code === 'KeyN') this.flyTo({ heading: 0 });
    });
  }
  // eases toward the target; returns true while moving
  update(dt, aspect) {
    const s = this.s, t = this.t, k = 1 - Math.exp(-dt * 7);
    let moving = false;
    for (const key of ['lat', 'lon', 'tilt', 'heading']) { const d = t[key] - s[key]; if (Math.abs(d) > 1e-6) { s[key] += d * k; moving = true; } }
    const dh = Math.log(t.h / s.h); if (Math.abs(dh) > 1e-5) { s.h *= Math.exp(dh * k); moving = true; }
    const { up, east, north } = frame(s.lat, s.lon), a = s.heading * Math.PI / 180, ti = s.tilt * Math.PI / 180;
    const fwd = new Vector3().addScaledVector(north, Math.cos(a)).addScaledVector(east, Math.sin(a));
    const ground = Math.max(0, this.groundAt(s.lat, s.lon)) * this.exag / 1000;
    const target = toWorld(s.lat, s.lon, ground);
    const pos = target.clone().addScaledVector(up, s.h * Math.cos(ti)).addScaledVector(fwd, -s.h * Math.sin(ti));
    const c = this.cam;
    c.position.copy(pos); c.up.copy(ti < 0.02 ? fwd : up); c.lookAt(target);
    const alt = pos.clone().add(new Vector3(0, R, 0)).length() - R;        // camera altitude above the sphere
    c.near = Math.max(0.2, alt * 0.05); c.far = Math.sqrt(2 * R * alt + alt * alt) * 1.25 + 300;
    c.aspect = aspect; c.updateProjectionMatrix(); c.updateMatrixWorld();
    this.alt = alt; this.target = target;
    if (moving || this.changed) { this.changed = false; for (const fn of this.listeners) fn(s); return true; }
    return false;
  }
}
