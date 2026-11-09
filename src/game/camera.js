import * as THREE from 'three';

// Globe camera.
// State: focus F (unit vector under the screen centre), screen-up tangent U,
// altitude above the focus (earth radii). Everything else is derived.
//
// North-up rule: U is always pulled toward local north, but slowly (time
// constant + max angular speed). When the focus crosses a pole, north flips
// behind the camera and the screen turns round gently instead of snapping.

const Y = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export function geoToVec(latDeg, lonDeg, out = new THREE.Vector3()) {
  const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
  return out.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}
export function vecToGeo(v) {
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, v.y)))),
    lon: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)),
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class GlobeCamera {
  constructor(camera, settings) {
    this.cam = camera;
    this.settings = settings;
    this.ALT_MIN = 0.003;   // ~19 km — the scale bar reaches ~2 km
    this.ALT_MAX = 3.6;
    this.F = geoToVec(47, 8);
    this.U = new THREE.Vector3();
    this.resetNorth();
    this.alt = 3.0;
    this.altTarget = 2.15;
    this.dispF = 0;          // smoothed terrain displacement under the focus
    this.heading = 0;        // radians between screen-up and north (for the compass)
    this.anchor = null;      // zoom-to-cursor anchor
    this.derived = {};
    this.update(0, 0);
  }

  get R() { return new THREE.Vector3().crossVectors(this.U, this.F); }

  resetNorth() {
    const n = tmpV.copy(Y).addScaledVector(this.F, -this.F.y);
    if (n.lengthSq() < 1e-10) n.set(0, 0, -1).addScaledVector(this.F, -this.F.z);
    this.U.copy(n.normalize());
  }

  lookAt(latDeg, lonDeg, alt) {
    geoToVec(latDeg, lonDeg, this.F);
    this.resetNorth();
    if (alt) this.altTarget = alt;
  }

  // ---- zoom-dependent parameters
  params(alt = this.alt) {
    const la = Math.log(alt);
    const unroll = this.settings.unroll ?? 0.85;
    const cMin = 1 - 0.92 * unroll;
    const u = smooth(Math.log(0.03), Math.log(1.25), la);
    const curv = cMin + (1 - cMin) * u;
    const tilt = this.tiltOverride ?? THREE.MathUtils.degToRad(46) * (1 - smooth(Math.log(0.012), Math.log(0.6), la));
    const relief = (this.settings.reliefScale ?? 1);
    // 1:1 by default (true proportions); the settings slider can exaggerate up to x10
    const exag = relief;
    return { curv, tilt, exag, globe: smooth(Math.log(0.45), Math.log(1.6), la) };
  }

  rotateState(q) {
    this.F.applyQuaternion(q).normalize();
    this.U.applyQuaternion(q);
    this.U.addScaledVector(this.F, -this.U.dot(this.F)).normalize();
  }

  // move focus by an arc (radians) along screen axes
  pan(dx, dy) {
    const R = this.R;
    const dir = R.multiplyScalar(dx).addScaledVector(this.U, dy);
    const a = dir.length();
    if (a < 1e-12) return;
    dir.normalize();
    const axis = new THREE.Vector3().crossVectors(this.F, dir).normalize();
    this.rotateState(tmpQ.setFromAxisAngle(axis, a));
  }

  // rotate the state so that geo point `cur` (now under the cursor) becomes `target`
  drag(cur, target) {
    if (!cur || !target) return;
    if (cur.distanceToSquared(target) < 1e-16) return;
    this.rotateState(tmpQ.setFromUnitVectors(cur, target));
  }

  zoom(factor, anchorGeo, ndc) {
    this.altTarget = Math.max(this.ALT_MIN, Math.min(this.ALT_MAX, this.altTarget * factor));
    this.anchor = factor < 1 && anchorGeo ? { geo: anchorGeo.clone(), ndc: ndc.clone() } : null;
  }

  // ray -> geographic point on the (morphed, height-free) surface
  pick(ndc) {
    const { curv } = this.derived;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam);
    const O = ray.ray.origin, D = ray.ray.direction;
    const rho = 1 / curv;
    const C = this.F.clone().multiplyScalar(1 - rho);
    const oc = O.clone().sub(C);
    const b = oc.dot(D), c = oc.lengthSq() - rho * rho;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const v = O.clone().addScaledVector(D, t).sub(C).divideScalar(rho);
    const d = Math.max(-1, Math.min(1, v.dot(this.F)));
    const Tv = v.clone().addScaledVector(this.F, -d);
    const tl = Tv.length();
    const s = Math.atan2(tl, d) / curv;
    if (s > Math.PI) return null;
    const T = tl > 1e-14 ? Tv.divideScalar(tl) : this.R;
    return this.F.clone().multiplyScalar(Math.cos(s)).addScaledVector(T, Math.sin(s)).normalize();
  }

  update(dt, focusHeightM) {
    // smooth zoom in log space
    const k = 1 - Math.exp(-dt * 7);
    this.alt = Math.exp(Math.log(this.alt) + (Math.log(this.altTarget) - Math.log(this.alt)) * (dt ? k : 1));
    const p = this.params();

    // slow north-up relaxation
    const north = tmpV.copy(Y).addScaledVector(this.F, -this.F.y);
    if (north.lengthSq() > 1e-8) {
      north.normalize();
      const cross = new THREE.Vector3().crossVectors(this.U, north).dot(this.F);
      const angle = Math.atan2(cross, this.U.dot(north));
      this.heading = angle;
      if (dt > 0 && Math.abs(angle) > 1e-5) {
        const tau = 0.55;                              // seconds
        const maxSpeed = THREE.MathUtils.degToRad(110); // deg/s
        let step = angle * (1 - Math.exp(-dt / tau));
        step = Math.sign(step) * Math.min(Math.abs(step), maxSpeed * dt);
        this.U.applyAxisAngle(this.F, step);
        this.U.addScaledVector(this.F, -this.U.dot(this.F)).normalize();
      }
    }

    // terrain under focus (smoothed so the camera glides over mountains)
    const targetDisp = Math.max(0, focusHeightM) * p.exag / 6371000;
    this.dispF += (targetDisp - this.dispF) * (dt ? 1 - Math.exp(-dt * 4) : 1);

    this.place(p);

    // keep the zoom anchor under the cursor
    if (this.anchor && dt) {
      const cur = this.pick(this.anchor.ndc);
      if (cur) { this.drag(cur, this.anchor.geo); this.place(p); }
      if (Math.abs(Math.log(this.alt / this.altTarget)) < 1e-3) this.anchor = null;
    }
    return p;
  }

  place(p) {
    const { tilt } = p;
    const target = this.F.clone().multiplyScalar(1 + this.dispF);
    const back = this.F.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(this.U, -Math.sin(tilt));
    this.cam.position.copy(target).addScaledVector(back, this.alt);
    this.cam.up.copy(this.U).multiplyScalar(Math.cos(tilt)).addScaledVector(this.F, Math.sin(tilt));
    this.cam.lookAt(target);
    this.cam.near = Math.max(1e-5, this.alt * 0.02);
    this.cam.far = this.alt + 2.5 / p.curv + 4;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    this.derived = { ...p, target };
  }

  // km per screen pixel at the screen centre (approx.)
  kmPerPixel(viewportH) {
    const fov = THREE.MathUtils.degToRad(this.cam.fov);
    return this.alt * 6371 * 2 * Math.tan(fov / 2) / viewportH;
  }
}
