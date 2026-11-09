// Weather worker entry of the game: the simulator (src/sim/weather) with the paleoclimate anomalies imported
// statically, so the bundled worker needs no runtime module URL. The anomaly is the climate module's effective one
// (makeAnomalyFn): regional dT plus a precipitation factor that folds in the humid-period monsoon rain, which a
// pure factor cannot express over a near-zero desert normal (green Sahara). It needs the normals, which arrive with
// the 'init' message, so the scope is proxied to catch them first.
import { installWeatherWorker } from '../../sim/weather/worker-host.js';
import { makeAnomalyFn } from '../../sim/climate/anomaly.js';
import { regionalDT, precipFactor } from '../../sim/climate/paleo.js';

let normals = null, fn = null;
const anomalyFn = (year, lat, lon, out) => {
  if (!fn) fn = normals?.tavg ? makeAnomalyFn(normals) : (y, la, lo, o = {}) => { o.dT = regionalDT(y, la, lo); o.precipFactor = precipFactor(y, la, lo); return o; };
  return fn(year, lat, lon, out);
};
const scope = {
  postMessage: (msg, transfer) => self.postMessage(msg, transfer),
  set onmessage(handler) {
    self.onmessage = e => {
      const d = e.data;
      if (d?.cmd === 'init' && d.args?.normals?.tavg) { normals = d.args.normals; fn = null; }
      handler(e);
    };
  },
};
installWeatherWorker(scope, { anomalyFn });
