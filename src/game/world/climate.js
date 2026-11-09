// Climate integration: monthly normals + paleoclimate (5000 BC → 2100) → the SIM-grid data layer the globe shows.
// Layer RGBA (720x360): R temperature of the current month (-40..+40 °C), G precipitation (sqrt, 0..400 mm),
// B hazard level (filled by the hazards integration), A "greening" vs today (128 = as today; wetter → greener).
const W = 720, H = 360, N = W * H;

export async function createClimate({ climatology, paleo, globe, clock, cal }) {
  const normals = await climatology.loadNormals('assets/climate/normals.bin.gz');
  const layer = new Uint8Array(N * 4);
  const dT = new Float32Array(N), pF = new Float32Array(N).fill(1);
  const lat = new Float32Array(H), lon = new Float32Array(W);
  for (let y = 0; y < H; y++) lat[y] = 90 - (y + 0.5) * 0.5;
  for (let x = 0; x < W; x++) lon[x] = -180 + (x + 0.5) * 0.5;

  let paleoDecade = NaN, month = -1, globalDT = 0;
  function refreshPaleo(year) {
    const decade = Math.floor(year / 10);
    if (decade === paleoDecade) return false;
    paleoDecade = decade;
    const yr = decade * 10 + 5;
    globalDT = paleo.globalDT(yr);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      dT[i] = paleo.regionalDT(yr, lat[y], lon[x]);
      pF[i] = paleo.precipFactor(yr, lat[y], lon[x]);
    }
    return true;
  }

  function rebuild(m) {
    const off = m * N;
    for (let i = 0; i < N; i++) {
      const T = normals.tavg[off + i] * 0.1 + dT[i];
      const P = normals.prec[off + i] * pF[i];
      const o = i * 4;
      layer[o] = Math.max(0, Math.min(255, Math.round((T + 40) / 80 * 255)));
      layer[o + 1] = Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.min(400, P) / 400) * 255)));
      // keep B (hazards) untouched
      layer[o + 3] = Math.max(0, Math.min(255, Math.round(128 + Math.log2(Math.max(0.05, pF[i])) * 64)));
    }
    globe.setSimLayer(layer, W, H);
  }

  function update(force = false) {
    const d = cal.toDate(clock.t);
    const changed = refreshPaleo(d.year);
    if (changed || force || d.month - 1 !== month) { month = d.month - 1; rebuild(month); }
  }
  update(true);
  clock.onMonth(() => update());
  clock.onState?.(() => update());

  const cellOf = (la, lo) => Math.min(H - 1, Math.max(0, Math.floor((90 - la) / 0.5))) * W + Math.min(W - 1, Math.max(0, Math.floor((lo + 180) / 0.5)));
  return {
    normals, layer,
    get globalDT() { return globalDT; },
    setHazardChannel(levels /* Uint8Array(N) 0..255 */) { for (let i = 0; i < N; i++) layer[i * 4 + 2] = levels[i]; globe.setSimLayer(layer, W, H); },
    describe(la, lo) {
      const c = cellOf(la, lo);
      const now = normals.tavg[month * N + c] * 0.1 + dT[c];
      const jan = normals.tavg[c] * 0.1 + dT[c], jul = normals.tavg[6 * N + c] * 0.1 + dT[c];
      let year = 0; for (let m = 0; m < 12; m++) year += normals.prec[m * N + c] * pF[c];
      const f = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} °C`;
      return [
        ['Температура сейчас', f(now)],
        ['Январь / июль', `${f(jan)} / ${f(jul)}`],
        ['Осадки за год', `${Math.round(year).toLocaleString('ru-RU')} мм`],
        ...(Math.abs(Math.log2(pF[c])) > 0.15 ? [['Влажнее, чем сегодня', `×${pF[c].toFixed(1)}`]] : []),
      ];
    },
  };
}
