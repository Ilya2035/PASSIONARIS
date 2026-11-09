// Bridge from the paleoclimate model to the weather module's `anomalyFn` contract:
//   (year, lat, lon) => { dT, precipFactor }
// dT is the annual regional anomaly vs the 1970–2000 normals. precipFactor is an *effective*
// annual factor: it folds the additive African/Arabian humid-period monsoon rain (which a pure
// factor cannot express over a near-zero desert normal) into
//   (Σ_m base_m · precipFactor + Σ_m add_m) / Σ_m base_m, capped at maxFactor.
// Continuous in time: when the humid period fades (add -> 0) it returns precipFactor itself.
import { regionalDT, precipFactor, precipAddMm } from './paleo.js';
import { sampleMonthlyAt } from './climatology.js';

/**
 * @param {{tavg, prec, elev}} normals from loadNormals()
 * @param {{maxFactor?: number, minBaseMm?: number}} [opts]
 * @returns {(year:number, lat:number, lon:number, out?:object) => {dT:number, precipFactor:number}}
 */
export function makeAnomalyFn(normals, { maxFactor = 25, minBaseMm = 10 } = {}) {
  const s = { tavg: 0, prec: 0, elev: 0 };
  return function anomaly(year, lat, lon, out = {}) {
    const pf = precipFactor(year, lat, lon);
    let add = 0;
    for (let m = 0; m < 12; m++) add += precipAddMm(year, lat, lon, m);
    let f = pf;
    if (add > 0) {
      let base = 0;
      for (let m = 0; m < 12; m++) base += sampleMonthlyAt(normals, lat, lon, m, s).prec;
      const b = Math.max(base, minBaseMm);
      f = Math.max(pf, Math.min(maxFactor, (b * pf + add) / b));
    }
    out.dT = regionalDT(year, lat, lon);
    out.precipFactor = f;
    return out;
  };
}
