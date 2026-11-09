// Weather module worker (type: 'module').
//   new Worker(new URL('./weather.worker.js', import.meta.url), { type: 'module' })
// Protocol: see worker-host.js. Paleo anomalies can be supplied at init with
// {anomalyModule: url} (dynamic import inside the worker), or by a custom worker entry
// that calls installWeatherWorker(self, { anomalyFn }).

import { installWeatherWorker } from './worker-host.js';

installWeatherWorker(self);
