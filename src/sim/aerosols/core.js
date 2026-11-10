// Aerosol layer: volcanic ash, wildfire smoke, mineral dust and sulphate haze on a coarse lat-lon grid.
//
// Grid: AW x AH = 360 x 180 cells of 1 degree, row 0 = 90N, column 0 = 180W, cell = y*AW + x,
// centre lat = 90 - (y + 0.5), lon = -180 + (x + 0.5) (the same orientation as every other map layer).
//
// Fields (Float32Array(AN) each) hold the column optical depth tau (visible light, dimensionless):
//   0 ash       dark grey-black; settles within days (deposit -> `fall`), washed out by rain
//   1 smoke     brown-grey; lives ~5 days, washed out by rain
//   2 dust      ochre; lives ~1 week
//   3 sulphate  pale haze in the stratosphere; e-folding ~1 year, spreads over the hemisphere and the globe
//   4 so2       invisible precursor of the sulphate (converts with an e-folding of ~25 days)
// plus `fall` (ashfall deposit on the ground, 0..~3, fades over months) and `cooling` (Float32Array(AH),
// degC <= 0 per row: the volcanic winter that the sulphate haze causes, with a lag of a few months).
//
// "Mass" of a species = area integral of tau in tau*km^2 (sum of tau * cell area). Sources inject mass;
// advection keeps the global mass (it is renormalised), decay removes it.
//
// Transport: the prevailing circulation of src/game/fx/wind.js (easterly trades with their drift toward the
// ITCZ, mid-latitude westerlies, polar easterlies; the bands follow the season) times a per-species speed
// factor (high plumes move faster), plus Rossby-like meanders, by a semi-Lagrangian step: the wind depends
// only on latitude, so the departure point is one latitude and one zonal shift per row (cheap). Then
// diffusion (box filters of the right variance, mass-conserving in both directions) and decay.
//
// Stepping: fast species (ash, smoke, dust) in steps of >= MIN_STEP days; SO2 + sulphate every half day while
// the cloud is young, then every SLOW_STEP days, at most once per advanceTo() call. Faster game speeds take
// bigger steps (maxSteps per call), an empty field costs nothing (advanceTo returns at once), rows without
// content are skipped, and invisible tails are dropped. A wide (global) species step costs ~0.5 ms.
// Deterministic: the same calls give bit-identical fields.

export const AW = 360, AH = 180, AN = AW * AH;
export const SPECIES = Object.freeze(['ash', 'smoke', 'dust', 'sulphate', 'so2']);
export const ASH = 0, SMOKE = 1, DUST = 2, SULF = 3, SO2 = 4;
const NS = 5;
export const KM_DEG = 111.195;
const KM_DAY = 86.4;                      // km per day per m/s
const EPS = 1e-5;                         // tau below this is zero
export const EARTH_KM2 = 4 * Math.PI * 6371 * 6371;

// life: e-folding of the dry removal in days (SO2: of the conversion to sulphate); wet: extra removal per
// day under full rain; K: eddy diffusivity m^2/s; speed: factor on the prevailing zonal wind; vs: factor on
// its meridional part (the stratospheric haze ignores the surface trade convergence and spreads by mixing)
export const PARAMS = Object.freeze([
  // (the semi-Lagrangian steps add some numerical spreading of their own, so the eddy terms stay modest)
  Object.freeze({ id: 'ash', life: 6, wet: 0.6, K: 5e4, speed: 1.6, vs: 1, slow: false }),
  Object.freeze({ id: 'smoke', life: 5, wet: 0.7, K: 8e4, speed: 1.2, vs: 1, slow: false }),
  Object.freeze({ id: 'dust', life: 7, wet: 0.5, K: 1e5, speed: 1.3, vs: 1, slow: false }),
  Object.freeze({ id: 'sulphate', life: 365, wet: 0, K: 2.2e6, speed: 3.0, vs: 0, slow: true }),
  Object.freeze({ id: 'so2', life: 25, wet: 0, K: 6e5, speed: 3.0, vs: 0, slow: true }),
]);
export const FALL_LIFE = 100;            // days: ash on the ground is blown away, washed, overgrown
export const COOL_K = 5.0;             // degC of cooling per unit of (smoothed zonal) sulphate optical depth
export const COOL_LAG = 90;              // days: response time of the surface (ocean mixed layer)
export const MIN_STEP = 0.25;            // days
export const SLOW_STEP = 2;              // days
export const JUMP = 90;                  // days: a larger jump of the clock is not simulated (decay only)
const MAX_SOURCES = 96;

const latOfRow = y => 90 - (y + 0.5);
const lonOfCol = x => -180 + (x + 0.5);
const COS = new Float64Array(AH);         // cos(lat) per row = relative cell area
for (let y = 0; y < AH; y++) COS[y] = Math.cos(latOfRow(y) * Math.PI / 180);
export const CELL_KM2 = new Float64Array(AH);
for (let y = 0; y < AH; y++) CELL_KM2[y] = KM_DEG * KM_DEG * COS[y];

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** ITCZ shift (degrees north) for a fractional month 1..12 — as in src/game/fx/wind.js. */
export const itczOfMonth = m => 1 + 6 * Math.cos(2 * Math.PI * (m - 7.6) / 12);
/** Fractional month 1..13 of game time t (days since -4999-01-01, a mean Gregorian year). */
export const monthOfT = t => { const y = 365.2425; const d = ((t % y) + y) % y; return 1 + d / (y / 12); };

/**
 * Prevailing surface wind (m/s, u east, v north) at latitude phi (deg) with the ITCZ at `itcz` deg —
 * the same analytic circulation as the wind streaks (src/game/fx/wind.js, windAt).
 */
export function windAt(phi, itcz, out = { u: 0, v: 0 }) {
  const p = phi - itcz * (1 - smooth(10, 45, Math.abs(phi)));
  const ap = Math.abs(p), s = p < 0 ? -1 : p > 0 ? 1 : 0;
  let u, v;
  if (ap < 30) { const k = Math.sin(Math.PI * ap / 30); u = -6.5 * k; v = -s * 2.2 * k; }
  else if (ap < 60) { const k = Math.sin(Math.PI * (ap - 30) / 30); u = (p < 0 ? 13 : 9) * k; v = s * 1.2 * k; }
  else { const k = Math.sin(Math.PI * (ap - 60) / 30); u = -3.5 * k; v = -s * 0.8 * k; }
  out.u = u; out.v = v;
  return out;
}

// ---------------------------------------------------------------- the simulation
export class AerosolSim {
  /**
   * @param {object} [o]
   * @param {number} [o.t=NaN]           game time (days); NaN = take the first advanceTo() time
   * @param {(t:number)=>number} [o.monthOf]  fractional month 1..12 of game time (default: mean calendar)
   * @param {number} [o.windScale=1]     0 freezes transport (tests)
   */
  constructor({ t = NaN, monthOf = monthOfT, windScale = 1 } = {}) {
    this.f = Array.from({ length: NS }, () => new Float32Array(AN));
    this.fall = new Float32Array(AN);
    this.cooling = new Float32Array(AH);
    this.r0 = new Int16Array(NS + 1).fill(-1);   // content row extents per species (+ fall), -1 = empty
    this.r1 = new Int16Array(NS + 1).fill(-1);
    this.mass = new Float64Array(NS);            // tau*km^2, kept up to date by the steps
    this.sources = [];
    this.t = t;
    this.slowAcc = 0;
    this.monthOf = monthOf;
    this.windScale = windScale;
    this.rain = null;                            // optional Uint8Array(AN) 0..255: rain intensity (wet removal)
    this.stats = { steps: 0, slowSteps: 0, cells: 0 };
    // scratch
    this._tmp = new Float32Array(AN); this._tmp2 = new Float32Array(AN);
    this._depY = new Float64Array(AH); this._depX = new Float64Array(AH); this._mAmp = new Float64Array(AH);
    this._mer = new Float64Array(AW);
    this._pre = new Float64Array(AW + 1); this._pre2 = new Float64Array((AH + 1) * AW); this._ends = new Float64Array(8);
    this._w = { u: 0, v: 0 };
    this._zon = new Float64Array(AH); this._zs = new Float64Array(AH);
  }

  // ------------------------------------------------------------ state
  /** True when nothing needs simulating (no aerosol, no deposit, no pending source, no cooling left). */
  get empty() {
    for (let s = 0; s <= NS; s++) if (this.r0[s] >= 0) return false;
    if (this.sources.length) return false;
    for (let y = 0; y < AH; y++) if (this.cooling[y] < -1e-3) return false;
    return true;
  }
  /** Is there anything visible (for the renderer: skip the texture and the shader work otherwise)? */
  get visible() {
    for (let s = 0; s < SO2; s++) if (this.r0[s] >= 0) return true;
    return this.r0[NS] >= 0;
  }
  clear() {
    for (const a of this.f) a.fill(0);
    this.fall.fill(0); this.cooling.fill(0);
    this.r0.fill(-1); this.r1.fill(-1); this.mass.fill(0);
    this.sources.length = 0;
    this.slowAcc = 0;
    this.t = NaN;
  }
  /** Global mass of a species (tau*km^2), recomputed. */
  totalMass(s) {
    const a = s === NS ? this.fall : this.f[s];
    let m = 0;
    for (let y = 0; y < AH; y++) { let r = 0; const o = y * AW; for (let x = 0; x < AW; x++) r += a[o + x]; m += r * CELL_KM2[y]; }
    return m;
  }
  /** Global-mean optical depth of a species. */
  meanTau(s) { return this.totalMass(s) / EARTH_KM2; }

  // ------------------------------------------------------------ sources
  /** Spread `mass` (tau*km^2) of species s as a gaussian of radius rKm (2 sigma) around lat, lon. */
  inject(s, lat, lon, rKm, mass) {
    if (!(mass > 0) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const a = s === NS ? this.fall : this.f[s];
    const sig = Math.max(20, rKm * 0.5);
    const yc = (90 - lat) - 0.5, xc = (lon + 180) - 0.5;
    const ry = Math.ceil(2.5 * sig / KM_DEG) + 1;
    const ya = Math.max(0, Math.floor(yc - ry)), yb = Math.min(AH - 1, Math.ceil(yc + ry));
    const cl = Math.max(0.02, Math.cos(lat * Math.PI / 180));
    const rx = Math.min(AW / 2 - 1, Math.ceil(2.5 * sig / (KM_DEG * Math.max(0.05, Math.min(cl, COS[ya], COS[yb])))) + 1);
    const xa = Math.floor(xc - rx), xb = Math.min(Math.ceil(xc + rx), xa + AW - 1);
    const wt = (y, xx) => {
      const dy = (y - yc) * KM_DEG, dx = (xx - xc) * KM_DEG * (COS[y] + cl) * 0.5;
      return Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
    };
    // normalise the weights so that exactly `mass` lands on the grid
    let sw = 0;
    for (let y = ya; y <= yb; y++) for (let xx = xa; xx <= xb; xx++) { const w = wt(y, xx); if (w >= 1e-4) sw += w * CELL_KM2[y]; }
    if (!(sw > 0)) {   // cannot happen with sig >= 20 km, kept for safety: the nearest cell takes it all
      const y = Math.min(AH - 1, Math.max(0, Math.round(yc))), x = ((Math.round(xc) % AW) + AW) % AW;
      a[y * AW + x] += mass / CELL_KM2[y];
      this._grow(s, y, y);
      if (s < NS) this.mass[s] += mass;
      return;
    }
    const k = mass / sw;
    for (let y = ya; y <= yb; y++) {
      const o = y * AW;
      for (let xx = xa; xx <= xb; xx++) {
        const w = wt(y, xx);
        if (w < 1e-4) continue;
        a[o + (((xx % AW) + AW) % AW)] += k * w;
      }
    }
    this._grow(s, ya, yb);
    if (s < NS) this.mass[s] += mass;
  }
  _grow(s, ya, yb) {
    if (this.r0[s] < 0) { this.r0[s] = ya; this.r1[s] = yb; return; }
    if (ya < this.r0[s]) this.r0[s] = ya;
    if (yb > this.r1[s]) this.r1[s] = yb;
  }
  /**
   * Add an emitting source: species index, centre, radius (km), mass rate (tau*km^2 per day), active
   * over game time [t0, t1). Sources are part of the saved state.
   */
  addSource({ sp, lat, lon, rKm, rate, t0, t1, tag = '' }) {
    if (!(rate > 0) || !(t1 > t0) || sp < 0 || sp >= NS) return null;
    const src = { sp, lat: +lat, lon: +lon, rKm: +rKm, rate: +rate, t0: +t0, t1: +t1, tag: String(tag) };
    this.sources.push(src);
    if (this.sources.length > MAX_SOURCES) {
      // drop the weakest remaining emission
      let k = 0, best = Infinity;
      for (let i = 0; i < this.sources.length; i++) {
        const q = this.sources[i], m = q.rate * (q.t1 - Math.max(q.t0, this.t || q.t0));
        if (m < best) { best = m; k = i; }
      }
      this.sources.splice(k, 1);
    }
    return src;
  }
  _emit(t, dt) {
    const S = this.sources;
    for (let i = 0; i < S.length; i++) {
      const q = S[i];
      const ov = Math.min(t + dt, q.t1) - Math.max(t, q.t0);
      if (ov > 0) this.inject(q.sp, q.lat, q.lon, q.rKm, q.rate * ov);
    }
    for (let i = S.length - 1; i >= 0; i--) if (S[i].t1 <= t + dt) S.splice(i, 1);
  }

  // ------------------------------------------------------------ stepping
  /**
   * Bring the field to game time t. Returns true when the field changed.
   * @param {number} t
   * @param {object} [o]
   * @param {number} [o.maxSteps=3]  sub-steps per call (more elapsed time = longer steps)
   */
  advanceTo(t, { maxSteps = 3 } = {}) {
    if (!Number.isFinite(t)) return false;
    if (!Number.isFinite(this.t)) { this.t = t; return false; }
    const el = t - this.t;
    if (el === 0) return false;
    if (el < 0 || el > JUMP) return this.jump(t);
    if (this.empty) { this.t = t; this.slowAcc = 0; return false; }   // fast path: nothing to do
    if (el < MIN_STEP) return false;                                   // accumulate (the renderer advects the lookup)
    let n = Math.max(1, Math.min(maxSteps, Math.floor(el / MIN_STEP)));
    const dt = el / n;
    for (let i = 0; i < n; i++) this.step(dt, i === n - 1);
    this.t = t;
    return true;
  }
  /** Large or backward jump of the clock (load, date change): no transport, only what decay leaves. */
  jump(t) {
    const el = t - this.t;
    if (!(el > 0) || el > 3650) { const keep = this.monthOf; this.clear(); this.monthOf = keep; this.t = t; return true; }
    for (let s = 0; s < NS; s++) {
      if (this.r0[s] < 0) continue;
      if (s === SO2) {   // what converted in the meantime lands as sulphate where the SO2 was
        const a = this.f[SO2], b = this.f[SULF], k = 1 - Math.exp(-el / PARAMS[SO2].life), d = Math.exp(-el / PARAMS[SULF].life);
        for (let c = 0; c < AN; c++) if (a[c]) { b[c] += a[c] * k * d; a[c] *= 1 - k; }
        this._grow(SULF, this.r0[SO2], this.r1[SO2]);
      }
      const k = Math.exp(-el / PARAMS[s].life), a = this.f[s];
      for (let c = 0; c < AN; c++) a[c] = a[c] * k < EPS ? 0 : a[c] * k;
    }
    const kf = Math.exp(-el / FALL_LIFE);
    for (let c = 0; c < AN; c++) this.fall[c] = this.fall[c] * kf < EPS ? 0 : this.fall[c] * kf;
    this.sources = this.sources.filter(q => q.t1 > t);
    this._extents();
    this._cool(el);
    this.t = t;
    return true;
  }
  _extents() {
    for (let s = 0; s <= NS; s++) {
      const a = s === NS ? this.fall : this.f[s];
      let ya = -1, yb = -1;
      for (let y = 0; y < AH; y++) {
        const o = y * AW;
        for (let x = 0; x < AW; x++) if (a[o + x] > 0) { if (ya < 0) ya = y; yb = y; break; }
      }
      this.r0[s] = ya; this.r1[s] = yb;
      if (s < NS) this.mass[s] = ya < 0 ? 0 : this.totalMass(s);
    }
  }

  /**
   * One step of dt days: the fast species always; the slow ones (SO2, sulphate, deposit, cooling) when due and
   * `slowOk` (at most once per advanceTo call).
   */
  step(dt, slowOk = true) {
    const t = this.t;
    this._emit(t, dt);
    const m = this.monthOf(t + dt * 0.5);
    const itcz = itczOfMonth(m);
    for (let s = 0; s < SULF; s++) if (this.r0[s] >= 0) this._stepSpecies(s, dt, t, itcz);
    this.slowAcc += dt;
    // a young sulphate cloud (mostly SO2 still) is followed closely (every half day); later it is a smooth haze
    const young = this.r0[SO2] >= 0 && this.mass[SO2] > 0.25 * this.mass[SULF];
    if (slowOk && this.slowAcc >= (young ? 2 * MIN_STEP : SLOW_STEP)) {
      const ds = this.slowAcc;
      this.slowAcc = 0;
      if (this.r0[SO2] >= 0) {
        this._stepSpecies(SO2, ds, t, itcz);
        // the thin SO2 tail is invisible: finish its conversion at once (keeps the slow pace cheap)
        if (this.r0[SO2] >= 0 && this.mass[SO2] < 0.02 * this.mass[SULF]) this._convertSo2();
      }
      if (this.r0[SULF] >= 0) this._stepSpecies(SULF, ds, t, itcz);
      if (this.r0[NS] >= 0) this._decayFall(ds);
      this._cool(ds);
      this.stats.slowSteps++;
    }
    this.stats.steps++;
    this.t = t + dt;
  }

  _convertSo2() {
    const a = this.f[SO2], b = this.f[SULF];
    const A = this.r0[SO2] * AW, B = (this.r1[SO2] + 1) * AW;
    for (let c = A; c < B; c++) if (a[c]) { b[c] += a[c]; a[c] = 0; }
    this._grow(SULF, this.r0[SO2], this.r1[SO2]);
    this.r0[SO2] = this.r1[SO2] = -1;
    this.mass[SULF] += this.mass[SO2];
    this.mass[SO2] = 0;
  }

  _decayFall(dt) {
    const a = this.fall, k = Math.exp(-dt / FALL_LIFE);
    let ya = -1, yb = -1, vmax = 0;
    for (let y = this.r0[NS]; y <= this.r1[NS]; y++) {
      const o = y * AW;
      let any = false;
      for (let x = 0; x < AW; x++) {
        const v = a[o + x] * k;
        if (v < EPS) a[o + x] = 0; else { a[o + x] = v; any = true; if (v > vmax) vmax = v; }
      }
      if (any) { if (ya < 0) ya = y; yb = y; }
    }
    if (ya >= 0 && vmax < 0.01) { a.fill(0, ya * AW, (yb + 1) * AW); ya = yb = -1; }   // faded out
    this.r0[NS] = ya; this.r1[NS] = yb;
  }

  _stepSpecies(s, dt, t, itcz) {
    const P = PARAMS[s];
    const src = this.f[s], dst = this._tmp;
    const { _depY: depY, _depX: depX, _mAmp: mAmp, _mer: mer, _w: w } = this;
    const sp = P.speed * this.windScale, spv = sp * P.vs;
    // ---- departure points per row (backward trajectory in sub-steps of <= 6 h)
    const K = Math.max(1, Math.min(64, Math.ceil(dt / 0.25)));
    const h = dt / K;
    for (let y = 0; y < AH; y++) {
      let phi = latOfRow(y), dx = 0;
      for (let k = 0; k < K; k++) {
        windAt(phi, itcz, w);
        const cphi = Math.max(0.05, Math.cos(phi * Math.PI / 180));
        dx += w.u * sp * h * KM_DAY / (KM_DEG * cphi);
        phi -= w.v * spv * h * KM_DAY / KM_DEG;
        if (phi > 89.5) phi = 89.5; else if (phi < -89.5) phi = -89.5;
      }
      depY[y] = (90 - phi) - 0.5;
      depX[y] = dx;
      // meanders of the westerlies (and weak ones elsewhere), in rows, capped; the smooth haze has none
      const al = Math.abs(latOfRow(y));
      // (mid-latitude meridional winds are of the order of the zonal ones: plumes curl into lobes)
      const amp = (1.2 + 6.0 * smooth(28, 45, al) * (1 - smooth(60, 75, al))) * Math.min(sp, 1.3);
      mAmp[y] = P.slow ? 0 : Math.min(3, amp * dt * KM_DAY / KM_DEG * 0.5);
    }
    // Rossby-like waves: wavenumber 6, drifting east (period 6 days at a point)
    const ph = (t / 6) * 2 * Math.PI;
    for (let x = 0; x < AW; x++) mer[x] = Math.sin(6 * lonOfCol(x) * Math.PI / 180 + ph);

    // ---- advection (semi-Lagrangian, bilinear) on the rows whose departure reaches the content
    const ra = this.r0[s], rb = this.r1[s];
    let before = 0, after = 0;
    for (let y = ra; y <= rb; y++) { let r = 0; const o = y * AW; for (let x = 0; x < AW; x++) r += src[o + x]; before += r * COS[y]; }
    let ya = -1, yb = -1;
    for (let y = 0; y < AH; y++) {
      const o = y * AW;
      const dy = depY[y], am = mAmp[y];
      if (dy + am < ra - 1 || dy - am > rb + 1) { dst.fill(0, o, o + AW); continue; }
      // the zonal shift is the same for the whole row: one integer offset and one fraction
      const sx0 = -depX[y];
      let fl = Math.floor(sx0);
      const fx = sx0 - fl, gx = 1 - fx;
      fl %= AW; if (fl < 0) fl += AW;
      let rowSum = 0;
      if (am < 0.01) {
        const sy = dy < 0 ? 0 : dy > AH - 1 ? AH - 1 : dy;
        const y0 = sy | 0, fy = sy - y0, gy = 1 - fy, y1 = y0 < AH - 1 ? y0 + 1 : y0;
        if (y1 < ra || y0 > rb) { dst.fill(0, o, o + AW); continue; }
        const o0 = y0 * AW, o1 = y1 * AW;
        for (let x = 0; x < AW; x++) {
          let x0 = x + fl; if (x0 >= AW) x0 -= AW;
          const x1 = x0 === AW - 1 ? 0 : x0 + 1;
          const v = (src[o0 + x0] * gx + src[o0 + x1] * fx) * gy + (src[o1 + x0] * gx + src[o1 + x1] * fx) * fy;
          dst[o + x] = v;
          rowSum += v;
        }
      } else {
        for (let x = 0; x < AW; x++) {
          let sy = dy + am * mer[x];
          if (sy < 0) sy = 0; else if (sy > AH - 1) sy = AH - 1;
          const y0 = sy | 0, fy = sy - y0, y1 = y0 < AH - 1 ? y0 + 1 : y0;
          if (y1 < ra || y0 > rb) { dst[o + x] = 0; continue; }
          let x0 = x + fl; if (x0 >= AW) x0 -= AW;
          const x1 = x0 === AW - 1 ? 0 : x0 + 1;
          const o0 = y0 * AW, o1 = y1 * AW;
          const v = (src[o0 + x0] * gx + src[o0 + x1] * fx) * (1 - fy) + (src[o1 + x0] * gx + src[o1 + x1] * fx) * fy;
          dst[o + x] = v;
          rowSum += v;
        }
      }
      if (rowSum > 0) { if (ya < 0) ya = y; yb = y; after += rowSum * COS[y]; }
    }
    this.stats.cells += (yb - ya + 1) * AW;
    if (ya < 0) { src.fill(0); this.r0[s] = this.r1[s] = -1; this.mass[s] = 0; return; }
    // semi-Lagrangian steps are not exactly conservative where the flow converges: renormalise
    const corr = after > 0 ? Math.min(2, Math.max(0.5, before / after)) : 1;

    // ---- diffusion: latitude (mass-weighted, reflecting at the poles), then longitude (periodic).
    // Box filters of fractional width w (variance w^2/12) from prefix sums, or a 3-tap kernel when narrow;
    // both conserve mass. Rows are processed whole (cache-friendly), the band grows by the kernel half-width.
    const v2 = 2 * P.K * 1e-6 * 86400 * dt;   // km^2
    const vy = v2 / (KM_DEG * KM_DEG);
    const grow = Math.ceil(Math.sqrt(12 * vy) * 0.5) + 1;
    ya = Math.max(0, ya - grow); yb = Math.min(AH - 1, yb + grow);
    const n = yb - ya + 1;
    let cur = dst;
    if (vy > 1e-6 && n > 1) {
      const out = this._tmp2;
      if (vy < 1 / 12) {
        const al = vy / 2;
        for (let y = ya; y <= yb; y++) {
          const yu = y > ya ? y - 1 : y, yd = y < yb ? y + 1 : y;
          const o = y * AW, ou = yu * AW, od = yd * AW, c0 = COS[y], cu = COS[yu], cd = COS[yd], ic = 1 / c0;
          for (let x = 0; x < AW; x++) {
            const m0 = dst[o + x] * c0;
            out[o + x] = (m0 + al * (dst[ou + x] * cu + dst[od + x] * cd - 2 * m0)) * ic;
          }
        }
      } else {
        const pre = this._pre2;   // pre[j*AW + x] = mass of rows ya .. ya+j-1 in column x
        pre.fill(0, 0, AW);
        for (let j = 0; j < n; j++) {
          const o = (ya + j) * AW, p0 = j * AW, p1 = p0 + AW, c = COS[ya + j];
          for (let x = 0; x < AW; x++) pre[p1 + x] = pre[p0 + x] + dst[o + x] * c;
        }
        const tot = n * AW, w = Math.min(n, Math.sqrt(12 * vy)), h = w / 2, iw = 1 / w;
        const E = this._ends;   // sign, k (multiple of the column total), row j, fraction f — for one end
        const end = (pos, k0) => {
          let sg = 1, k = 0;
          if (pos < 0) { pos = -pos; sg = -1; } else if (pos > n) { pos = 2 * n - pos; sg = -1; k = 2; }
          let j = Math.floor(pos); if (j >= n) j = n - 1;
          E[k0] = sg; E[k0 + 1] = k; E[k0 + 2] = j; E[k0 + 3] = pos - j;
        };
        for (let i = 0; i < n; i++) {
          end(i + 0.5 - h, 0); end(i + 0.5 + h, 4);
          const sa = E[0], ka = E[1], ja = E[2], fa = E[3] * COS[ya + E[2]];
          const sb = E[4], kb = E[5], jb = E[6], fb = E[7] * COS[ya + E[6]];
          const pA = ja * AW, pB = jb * AW, mA = (ya + ja) * AW, mB = (ya + jb) * AW;
          const o = (ya + i) * AW, ic = iw / COS[ya + i];
          for (let x = 0; x < AW; x++) {
            const T = pre[tot + x];
            out[o + x] = ((sb * (pre[pB + x] + fb * dst[mB + x]) + kb * T) - (sa * (pre[pA + x] + fa * dst[mA + x]) + ka * T)) * ic;
          }
        }
      }
      cur = out;
    }
    const fin = cur === dst ? this._tmp2 : dst;
    {
      const pre = this._pre;
      for (let y = ya; y <= yb; y++) {
        const o = y * AW;
        const vx = Math.min(v2 / (KM_DEG * KM_DEG * COS[y] * COS[y]), AW * AW / 12);
        if (vx < 1 / 12) {
          const al = vx / 2;
          for (let x = 0; x < AW; x++) {
            const l = x ? cur[o + x - 1] : cur[o + AW - 1], r = x < AW - 1 ? cur[o + x + 1] : cur[o];
            fin[o + x] = cur[o + x] + al * (l + r - 2 * cur[o + x]);
          }
          continue;
        }
        let tot = 0;
        pre[0] = 0;
        for (let x = 0; x < AW; x++) { tot += cur[o + x]; pre[x + 1] = tot; }
        if (tot === 0) { fin.fill(0, o, o + AW); continue; }
        const w = Math.sqrt(12 * vx), h = w / 2, iw = 1 / w;
        const B = 0.5 + h, A = 0.5 - h;
        const jb0 = Math.floor(B), fb = B - jb0, ja0 = Math.floor(A), fa = A - ja0;
        for (let x = 0; x < AW; x++) {
          let jb = x + jb0, kb = 0;
          if (jb >= AW) { jb -= AW; kb = 1; }
          let ja = x + ja0, ka = 0;
          if (ja < 0) { ja += AW; ka = -1; } else if (ja >= AW) { ja -= AW; ka = 1; }
          fin[o + x] = ((kb * tot + pre[jb] + fb * cur[o + jb]) - (ka * tot + pre[ja] + fa * cur[o + ja])) * iw;
        }
      }
    }

    // ---- decay, wet removal, deposition, conversion; new extents and mass
    const keep = Math.exp(-dt / P.life);
    const rain = P.wet > 0 ? this.rain : null;
    // wet-removal factor per rain byte (the same exp as per cell, 256 of them instead of one per rainy cell)
    const wetK = rain ? (this._wetK ||= new Float64Array(256)) : null;
    if (wetK) for (let r = 0; r < 256; r++) wetK[r] = Math.exp(-P.wet * dt * r / 255);
    const toFall = s === ASH ? this.fall : s === SO2 ? this.f[SULF] : null;
    let ra2 = -1, rb2 = -1, mass = 0, vmax = 0;
    for (let y = ya; y <= yb; y++) {
      const o = y * AW;
      let rs = 0;
      for (let x = 0; x < AW; x++) {
        const c = o + x;
        const v0 = fin[c] * corr;
        if (!(v0 > 0)) { src[c] = 0; continue; }
        let k = keep;
        if (rain && rain[c]) k *= wetK[rain[c]];
        let v = v0 * k;
        if (toFall) toFall[c] += (v0 - v) * (s === ASH ? 0.35 : 1);
        if (v < EPS) v = 0;
        else if (v > vmax) vmax = v;
        src[c] = v;
        rs += v;
      }
      if (rs > 0) { if (ra2 < 0) ra2 = y; rb2 = y; mass += rs * CELL_KM2[y]; }
    }
    // rows outside the processed band are empty now (their content moved into the band)
    if (this.r0[s] < ya) src.fill(0, this.r0[s] * AW, ya * AW);
    if (this.r1[s] > yb) src.fill(0, (yb + 1) * AW, (this.r1[s] + 1) * AW);
    // an invisible tail is dropped (otherwise a cloud would cost steps for months after it faded)
    const gone = s === SULF ? this.r0[SO2] < 0 && mass / EARTH_KM2 < 0.0015 && vmax < 0.01 : s !== SO2 && vmax < 0.004;
    if (gone && ra2 >= 0) { src.fill(0, ra2 * AW, (rb2 + 1) * AW); ra2 = rb2 = -1; mass = 0; }
    this.r0[s] = ra2; this.r1[s] = rb2; this.mass[s] = mass;
    if (toFall) this._grow(s === ASH ? NS : SULF, ya, yb);
    if (s === SO2) this.mass[SULF] = this.totalMass(SULF);
    if (s === ASH) this._trimFall(ya, yb);
  }
  _trimFall(ya, yb) {
    // the deposit band may contain only zeros at its edges after a step: recompute it lazily
    const a = this.fall;
    let r0 = -1, r1 = -1;
    const A = Math.min(this.r0[NS] < 0 ? ya : this.r0[NS], ya), B = Math.max(this.r1[NS], yb);
    for (let y = A; y <= B; y++) { const o = y * AW; for (let x = 0; x < AW; x++) if (a[o + x] > 0) { if (r0 < 0) r0 = y; r1 = y; break; } }
    this.r0[NS] = r0; this.r1[NS] = r1;
  }

  // volcanic winter: the surface relaxes toward -COOL_K * (sulphate tau, zonal mean smoothed over +-12 deg)
  _cool(dt) {
    const zon = this._zon, zs = this._zs, a = this.f[SULF];
    if (this.r0[SULF] >= 0) {
      for (let y = 0; y < AH; y++) {
        let r = 0;
        if (y >= this.r0[SULF] && y <= this.r1[SULF]) { const o = y * AW; for (let x = 0; x < AW; x++) r += a[o + x]; }
        zon[y] = r / AW;
      }
      const R = 12;
      for (let y = 0; y < AH; y++) {
        let s = 0, ws = 0;
        for (let k = -R; k <= R; k++) {
          const j = y + k;
          if (j < 0 || j >= AH) continue;
          s += zon[j] * COS[j]; ws += COS[j];
        }
        zs[y] = s / ws;
      }
    } else zs.fill(0);
    const r = 1 - Math.exp(-dt / COOL_LAG);
    for (let y = 0; y < AH; y++) {
      const target = -COOL_K * zs[y];
      let c = this.cooling[y] + (target - this.cooling[y]) * r;
      if (c > -1e-4 && target === 0) c = 0;
      this.cooling[y] = c;
    }
  }

  // ------------------------------------------------------------ queries
  /** Bilinear value of a field at (lat, lon); s = species index or 'fall'. */
  sample(s, lat, lon) {
    const a = s === 'fall' || s === NS ? this.fall : this.f[s];
    let sy = (90 - lat) - 0.5; sy = Math.min(AH - 1, Math.max(0, sy));
    const sx = (lon + 180) - 0.5;
    const y0 = Math.floor(sy), y1 = Math.min(AH - 1, y0 + 1), fy = sy - y0;
    const fl = Math.floor(sx), fx = sx - fl;
    const x0 = ((fl % AW) + AW) % AW, x1 = (x0 + 1) % AW;
    return (a[y0 * AW + x0] * (1 - fx) + a[y0 * AW + x1] * fx) * (1 - fy) + (a[y1 * AW + x0] * (1 - fx) + a[y1 * AW + x1] * fx) * fy;
  }
  /** Volcanic cooling (degC, <= 0) at latitude lat. */
  coolingAt(lat) {
    let sy = (90 - lat) - 0.5; sy = Math.min(AH - 1, Math.max(0, sy));
    const y0 = Math.floor(sy), y1 = Math.min(AH - 1, y0 + 1), fy = sy - y0;
    return this.cooling[y0] * (1 - fy) + this.cooling[y1] * fy;
  }
  /** Area-weighted mean cooling over a latitude band (e.g. the northern hemisphere: 0, 90). */
  meanCooling(lat0 = -90, lat1 = 90) {
    let s = 0, ws = 0;
    for (let y = 0; y < AH; y++) { const la = latOfRow(y); if (la < lat0 || la > lat1) continue; s += this.cooling[y] * COS[y]; ws += COS[y]; }
    return ws ? s / ws : 0;
  }
  /** Point readout: optical depth per species, ashfall deposit and cooling. */
  at(lat, lon) {
    return {
      ash: this.sample(ASH, lat, lon), smoke: this.sample(SMOKE, lat, lon), dust: this.sample(DUST, lat, lon),
      sulphate: this.sample(SULF, lat, lon), fall: this.sample(NS, lat, lon), cooling: this.coolingAt(lat),
    };
  }

  // ------------------------------------------------------------ rendering
  /**
   * Encode the visible layer for the GPU.
   * rgba (Uint8Array(AN*4)): R ash, G smoke, B dust, A sulphate, each 255 * (1 - exp(-ENC_K[i] * tau)).
   * ground (Uint8Array(AN*4), optional): R ashfall deposit 255 * (1 - exp(-0.9 * fall)), G volcanic cooling
   * 25 per degC (0..255 = 0..-10.2 degC, same value along each row), B, A reserved (0).
   */
  encode(rgba, ground) {
    const LUT = this._lut || (this._lut = buildLut());
    const ra = Math.min(...[0, 1, 2, 3].map(s => (this.r0[s] < 0 ? AH : this.r0[s])));
    const rb = Math.max(...[0, 1, 2, 3].map(s => this.r1[s]));
    rgba.fill(0);
    for (let s = 0; s < 4; s++) {
      if (this.r0[s] < 0) continue;
      const a = this.f[s], k = ENC_K[s], lut = LUT[s];
      for (let c = this.r0[s] * AW, e = (this.r1[s] + 1) * AW; c < e; c++) {
        const v = a[c];
        if (v === 0) continue;
        const q = v * k;
        rgba[c * 4 + s] = q >= 8 ? 255 : lut[(q * 512) | 0];
      }
    }
    if (ground) {
      ground.fill(0);
      if (this.r0[NS] >= 0) {
        const a = this.fall, lut = LUT[4];
        for (let c = this.r0[NS] * AW, e = (this.r1[NS] + 1) * AW; c < e; c++) {
          const v = a[c] * 0.9;
          if (v > 0) ground[c * 4] = v >= 8 ? 255 : lut[(v * 512) | 0];
        }
      }
      for (let y = 0; y < AH; y++) {
        const g = Math.min(255, Math.round(-this.cooling[y] * 25));
        if (g > 0) for (let x = 0, o = y * AW * 4 + 1; x < AW; x++, o += 4) ground[o] = g;
      }
    }
    return ra <= rb;
  }

  // ------------------------------------------------------------ saves
  serialize() {
    const fields = {};
    for (let s = 0; s < NS; s++) if (this.r0[s] >= 0) fields[SPECIES[s]] = this.f[s].slice();
    return {
      v: 1, t: Number.isFinite(this.t) ? this.t : null, slowAcc: this.slowAcc,
      fields, fall: this.r0[NS] >= 0 ? this.fall.slice() : null,
      cooling: this.cooling.slice(),
      sources: this.sources.map(q => ({ ...q })),
    };
  }
  deserialize(st) {
    const keep = this.monthOf;
    this.clear();
    this.monthOf = keep;
    if (!st || st.v !== 1) return false;
    const ok = a => a && a.length === AN;
    for (let s = 0; s < NS; s++) { const a = st.fields?.[SPECIES[s]]; if (ok(a)) this.f[s].set(a); }
    if (ok(st.fall)) this.fall.set(st.fall);
    if (st.cooling?.length === AH) this.cooling.set(st.cooling);
    for (const q of st.sources || []) this.addSource(q);
    this.t = Number.isFinite(st.t) ? st.t : NaN;
    this.slowAcc = Number.isFinite(st.slowAcc) ? st.slowAcc : 0;
    this._extents();
    return true;
  }
}

// encoding gains: tau -> 1 - exp(-k tau); the sulphate gets a large gain so that a thin haze keeps resolution
export const ENC_K = Object.freeze([0.9, 1.2, 1.0, 3.0]);
function buildLut() {
  // q = k*tau in [0, 8) sampled every 1/512
  const mk = () => { const l = new Uint8Array(8 * 512); for (let i = 0; i < l.length; i++) l[i] = Math.round(255 * (1 - Math.exp(-(i + 0.5) / 512))); return l; };
  const l = mk();
  return [l, l, l, l, l];
}

export function createAerosolSim(opts) { return new AerosolSim(opts); }
