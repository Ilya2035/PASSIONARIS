// Runs src/sim/weather/weather.worker.js inside a Node worker_threads thread by providing the
// Web Worker `self` API (postMessage with transfer list, onmessage). Test helper only.
import { parentPort } from 'node:worker_threads';

const self = {
  onmessage: null,
  postMessage: (msg, transfer = []) => parentPort.postMessage(msg, transfer),
};
globalThis.self = self;
parentPort.on('message', data => self.onmessage?.({ data }));
await import('../src/sim/weather/weather.worker.js');
parentPort.postMessage({ id: -1, ready: true });
