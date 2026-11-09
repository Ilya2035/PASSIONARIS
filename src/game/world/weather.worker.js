// Weather worker entry of the game: the simulator (src/sim/weather) with the paleoclimate anomalies
// (src/sim/climate/paleo.js) imported statically, so the bundled worker needs no runtime module URL.
import { installWeatherWorker } from '../../sim/weather/worker-host.js';
import { regionalDT, precipFactor } from '../../sim/climate/paleo.js';

installWeatherWorker(self, {
  anomalyFn: (year, lat, lon) => ({ dT: regionalDT(year, lat, lon), precipFactor: precipFactor(year, lat, lon) }),
});
