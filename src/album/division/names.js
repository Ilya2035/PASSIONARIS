// The names of the districts (the owner, 13.11.2026: «названия — как можно более исторические; где исторического нет —
// по правилу сторон света: Северная Дакота, Юго-Восточно-Северная Дакота»). In this order:
//   1. a historical land of its own (a comarca, a pays: lands.json "comarcas") whose point lies in the district —
//      unless the district is the surroundings of a big town (CITY_POP), which names it;
//   2. the town of the district (centres.js: a real place, the biggest of the district) or the village its town
//      stands at;
//   3. its biggest real village, when its town stands elsewhere (by the river, by the shore);
//   3. by the rule of the sides of the world inside its province: the districts with no name are split by where they
//      lie from the middle of the province — north, north-east … and the middle; a side that still holds several is
//      split the same way from its own middle, and the sides go in front: «Северная Ла-Манча», «Юго-Восточно-Северная
//      Ла-Манча». The word agrees with the province (gender and number, PROVINCE_GENDER).
//   On the water: a piece of the sea along the shore after the land district it lies along («Валенсия: прибрежные
//   воды»), the open sea by the same rule inside its zone of the sea, in words: «Балеарское море, зона 3 — северо-запад».
// → { names: string[], kind: string[] ('history' | 'place' | 'village' | 'shore' | 'rule') }
// Plain JavaScript; the same division always gives the same names.
import { kmOf } from '../chunks.js';

const LAND = 0;
export const CITY_POP = 20000;

// the sides: an adjective by gender (m, f, n, plural), the same as the front part of a longer one, a noun
const SIDES = {
  C: [['Центральный', 'Центральная', 'Центральное', 'Центральные'], 'Центрально', 'середина'],
  N: [['Северный', 'Северная', 'Северное', 'Северные'], 'Северо', 'север'],
  NE: [['Северо-Восточный', 'Северо-Восточная', 'Северо-Восточное', 'Северо-Восточные'], 'Северо-Восточно', 'северо-восток'],
  E: [['Восточный', 'Восточная', 'Восточное', 'Восточные'], 'Восточно', 'восток'],
  SE: [['Юго-Восточный', 'Юго-Восточная', 'Юго-Восточное', 'Юго-Восточные'], 'Юго-Восточно', 'юго-восток'],
  S: [['Южный', 'Южная', 'Южное', 'Южные'], 'Южно', 'юг'],
  SW: [['Юго-Западный', 'Юго-Западная', 'Юго-Западное', 'Юго-Западные'], 'Юго-Западно', 'юго-запад'],
  W: [['Западный', 'Западная', 'Западное', 'Западные'], 'Западно', 'запад'],
  NW: [['Северо-Западный', 'Северо-Западная', 'Северо-Западное', 'Северо-Западные'], 'Северо-Западно', 'северо-запад'],
};
const RING = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const G = { m: 0, f: 1, n: 2, p: 3 };
// the gender of a province name where its ending does not tell it (lands.json ids)
export const PROVINCE_GENDER = { cerdanya: 'f', beira_alta: 'f', beira_lit: 'f', auvergne: 'f', albigeois: 'm', foix: 'n', landes: 'p', labourd: 'f' };
export function genderOf(name, id = '') {
  if (PROVINCE_GENDER[id]) return PROVINCE_GENDER[id];
  if (/ и /.test(name)) return 'p';
  const w = name.trim().toLowerCase(), e = w[w.length - 1];
  if (e === 'ы') return 'p';
  if (e === 'а' || e === 'я') return 'f';
  if ('оеиуюэ'.includes(e)) return 'n';
  return 'm';
}
// a name by the rule: sides from the outer to the inner part ['N', 'SE'] → «Юго-Восточно-Северная Ла-Манча»
export function sideName(sides, land, gender) {
  if (!sides.length) return land;
  const outer = sides[0], inner = sides.slice(1).reverse();
  return [...inner.map(s => SIDES[s][1]), SIDES[outer][0][G[gender]]].join('-') + ' ' + land;
}
export const sideWords = sides => sides.map(s => SIDES[s][2]).join(', ');

// Splits the points (districts) by the sides they lie on from a middle; the first split from the middle of the whole
// province (mx, my, spread r), the deeper ones from the middle of the part. → Map(district → [sides])
export function splitBySides(items, mx, my, r) {
  const out = new Map();
  const go = (list, cx, cy, rr, path, depth) => {
    if (list.length === 1) { out.set(list[0].d, path); return; }
    const parts = new Map();
    for (const it of list) {
      const dx = it.x - cx, dy = it.y - cy, dist = Math.hypot(dx, dy);
      const side = dist < .42 * rr && depth < 3 ? 'C' : RING[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
      if (!parts.has(side)) parts.set(side, []); parts.get(side).push(it);
    }
    // all in one part (a tight knot at the middle): split by the eight sides alone
    if (parts.size === 1 && list.length > 1 && depth < 6) { if (parts.has('C')) { go(list, cx, cy, 0, path, depth + 3); return; } }
    for (const [side, part] of [...parts].sort((a, b) => RING.indexOf(a[0]) - RING.indexOf(b[0]))) {
      if (part.length === 1 || depth >= 5) { for (const it of part) out.set(it.d, [...path, side]); continue; }
      const px = part.reduce((s, it) => s + it.x, 0) / part.length, py = part.reduce((s, it) => s + it.y, 0) / part.length;
      const pr = Math.sqrt(part.reduce((s, it) => s + (it.x - px) ** 2 + (it.y - py) ** 2, 0) / part.length) || 1;
      go(part, px, py, pr, [...path, side], depth + 1);
    }
  };
  go(items, mx, my, r, [], 0);
  return out;
}

// div: the division (cells, kinds, province, provinces, count, cx, cy, centres); sites: the list the centres were
// chosen from; lands: lands.json (provinces with ids, comarcas)
export function nameDistricts(div, sites, lands) {
  const count = div.count, names = new Array(count).fill(''), kind = new Array(count).fill('rule'), c = div.centres;
  // the middle of every district and of every province, by their chunks of 1 km²
  const sx = new Float64Array(count), sy = new Float64Array(count), sn = new Float64Array(count);
  const FN = 1280, X0 = -880, Y0 = 3880;
  for (let t = 0; t < div.cells.length; t++) { const d = div.cells[t]; if (d < 0) continue; sx[d] += X0 + (t % FN) + .5; sy[d] += Y0 + Math.floor(t / FN) + .5; sn[d]++; }
  for (let d = 0; d < count; d++) if (sn[d]) { sx[d] /= sn[d]; sy[d] /= sn[d]; } else { sx[d] = div.cx[d]; sy[d] = div.cy[d]; }
  // 1. historical lands of their own
  for (const cm of lands.comarcas || []) {
    const [x, y] = kmOf(cm.at[0], cm.at[1]), t = Math.floor(y - Y0) * FN + Math.floor(x - X0), d = div.cells[t];
    if (d < 0 || div.kinds[d] !== LAND || names[d] || (c && c.pop[d] >= CITY_POP)) continue;
    names[d] = cm.name; kind[d] = 'history';
  }
  // 2. the town of the district
  for (let d = 0; d < count; d++) if (!names[d] && c && c.site[d] >= 0 && sites[c.site[d]]?.name) { names[d] = sites[c.site[d]].name; kind[d] = 'place'; }
  // 3. its biggest real village (its town stands elsewhere: by the river, the shore)
  const village = new Int32Array(count).fill(-1);
  sites.forEach((st, i) => {
    if (!st.name) return;
    const [x, y] = st.x !== undefined ? [st.x, st.y] : kmOf(st.lat, st.lon), ti = Math.floor(x - X0), tj = Math.floor(y - Y0); if (ti < 0 || tj < 0 || ti >= FN || tj >= FN) return;
    const d = div.cells[tj * FN + ti]; if (d < 0 || div.kinds[d] !== LAND) return;
    if (village[d] < 0 || (st.pop || 0) > (sites[village[d]].pop || 0)) village[d] = i;
  });
  for (let d = 0; d < count; d++) if (!names[d] && village[d] >= 0) { names[d] = sites[village[d]].name; kind[d] = 'village'; }
  // 4. a piece of the sea along the shore: the land district it lies along («Валенсия: прибрежные воды»)
  const shore = new Map();
  for (let t = 0; t < div.cells.length; t++) {
    const d = div.cells[t]; if (d < 0 || div.kinds[d] === LAND || names[d]) continue;
    const i = t % FN;
    for (const u of [i > 0 ? t - 1 : -1, i < FN - 1 ? t + 1 : -1, t - FN, t + FN]) {
      const e = u >= 0 && u < div.cells.length ? div.cells[u] : -1; if (e < 0 || div.kinds[e] !== LAND) continue;
      let m = shore.get(d); if (!m) shore.set(d, m = new Map()); m.set(e, (m.get(e) || 0) + 1);
    }
  }
  for (const [d, m] of shore) {
    let best = -1, bn = 0; for (const [e, v] of [...m].sort((a, b) => a[0] - b[0])) if (v > bn) { bn = v; best = e; }
    if (best >= 0 && names[best]) { names[d] = `${names[best]}: ${div.kinds[d] === 2 ? 'озеро' : 'прибрежные воды'}`; kind[d] = 'shore'; }
  }
  // 5. the rest by the sides of the world inside the province (or zone of the sea)
  const byProv = new Map();
  for (let d = 0; d < count; d++) { const p = div.province[d]; if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(d); }
  for (const [p, all] of byProv) {
    const open = all.filter(d => !names[d]); if (!open.length) continue;
    const pv = div.provinces[p], w = all.map(d => sn[d] || 1), W = w.reduce((a, b) => a + b, 0);
    const mx = all.reduce((s, d, i) => s + sx[d] * w[i], 0) / W, my = all.reduce((s, d, i) => s + sy[d] * w[i], 0) / W;
    const r = Math.sqrt(all.reduce((s, d, i) => s + ((sx[d] - mx) ** 2 + (sy[d] - my) ** 2) * w[i], 0) / W) || 1;
    const sides = splitBySides(open.map(d => ({ d, x: sx[d], y: sy[d] })), mx, my, r);
    const pid = lands.provinces[p]?.id || '', g = genderOf(pv.name, pid);
    for (const d of open) {
      const s = sides.get(d) || [];
      if (div.kinds[d] === LAND) names[d] = open.length === 1 && all.length === 1 ? pv.name : sideName(s, pv.name, g);
      else names[d] = `${div.kinds[d] === 2 ? 'Озеро: ' : ''}${pv.name}${s.length ? ' — ' + sideWords(s) : ''}`;
      kind[d] = 'rule';
    }
  }
  // the same name twice in a province (two towns of one name, pieces of one lake): the next one takes the side it
  // lies on from the first, and a number if that is taken too
  const seen = new Map();
  for (let d = 0; d < count; d++) {
    const k = div.province[d] + '|' + names[d]; if (!seen.has(k)) { seen.set(k, d); continue; }
    const f0 = seen.get(k), base = `${names[d]} (${SIDES[sideOf(sx[d] - sx[f0], sy[d] - sy[f0])][2]}`;
    let nmd = base + ')'; for (let i = 2; seen.has(div.province[d] + '|' + nmd); i++) nmd = `${base}, ${i})`;
    names[d] = nmd; seen.set(div.province[d] + '|' + nmd, d);
  }
  return { names, kind };
}
const sideOf = (dx, dy) => RING[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
