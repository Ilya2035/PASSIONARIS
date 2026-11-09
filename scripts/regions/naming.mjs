// Name assignment for districts, provinces and regions (Russian + nameKey).
import { genitive, disambiguate, uniquify, featureGender, cap } from './names.mjs';
import { T_LAND, T_MOUNT, T_LAKE, T_SEA, isLandType } from './districts.mjs';
import { iceZone } from './terrain.mjs';

// Sparse (id, key) -> count accumulator on a Map.
class PairCount {
  constructor() { this.m = new Map(); }
  inc(id, k, v = 1) { const key = id * 65536 + k; this.m.set(key, (this.m.get(key) || 0) + v); }
  // per id: sorted [[k, count], ...]
  byId() {
    const out = new Map();
    for (const [key, c] of this.m) {
      const id = Math.floor(key / 65536), k = key % 65536;
      let a = out.get(id); if (!a) out.set(id, a = []);
      a.push([k, c]);
    }
    for (const a of out.values()) a.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    return out;
  }
}

// Collect per-district evidence for naming from the rasters.
export function collectEvidence(grid, did, type, rv, geo, marine, lakes) {
  const { W, H, N } = grid;
  const major = new PairCount(), minor = new PairCount(), feat = new PairCount(), rng = new PairCount();
  const sea = new PairCount(), lake = new PairCount();
  for (let i = 0; i < N; i++) {
    const d = did[i];
    if (d <= 0) continue;
    const t = type[d];
    if (isLandType(t)) {
      if (rv.majorName[i] >= 0) major.inc(d, rv.majorName[i]);
      if (rv.minorName[i] >= 0) minor.inc(d, rv.minorName[i]);
      const x = i % W, y = (i - x) / W, r = i - x;
      const nb = [r + (x + 1) % W, r + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && did[j] !== d && rv.barrier[j] && rv.majorName[j] >= 0) major.inc(d, rv.majorName[j]);
      if (geo.feature[i] >= 0) feat.inc(d, geo.feature[i]);
      if (geo.range[i] >= 0) rng.inc(d, geo.range[i]);
    } else if (t === T_SEA) {
      if (marine.marine[i] >= 0) sea.inc(d, marine.marine[i]);
    } else if (t === T_LAKE) {
      if (lakes.lake[i] >= 0) lake.inc(d, lakes.lake[i]);
    }
  }
  return { major: major.byId(), minor: minor.byId(), feature: feat.byId(), range: rng.byId(), sea: sea.byId(), lake: lake.byId() };
}

const lowerHead = ru => ru.replace(/^(Озеро|Озёра|Море|Залив|Пролив|Проливы|Водохранилище|Лагуна|Бухта|Губа|Фьорд|Устье|Река|Океан|Риф|Бассейн|Лиман)(?=\s|$)/, w => w.toLowerCase());
const lakePhrase = ru => /(озеро|озёра|море|водохранилище|залив|лагуна|лиман)/i.test(ru) ? genitive(lowerHead(ru)) : `озера ${ru}`;
const top = (list, minCount = 1) => (list && list.length && list[0][1] >= minCount) ? list[0] : null;

// D: id upper bound; info per id: { type, lon, lat, area, meanH, meanR, landNb: [[id, edges]], waterNb: [[id, edges]] }
export function nameDistricts(D, info, ev, rv, geo, marine, lakes, count) {
  const items = [];
  const seaName = new Map(), lakeName = new Map();
  // water first: their names feed the coastal / lakeshore district names
  for (let d = 1; d < D; d++) {
    const it = info[d];
    if (!it) continue;
    if (it.type === T_SEA) {
      const tp = top(ev.sea.get(d));
      const m = tp ? marine.table[tp[0]] : null;
      if (m && m.ru) seaName.set(d, m);
    } else if (it.type === T_LAKE) {
      const tp = top(ev.lake.get(d));
      const l = tp ? lakes.table[tp[0]] : null;
      if (l && l.ru) lakeName.set(d, l);
    }
  }
  const counters = new Map();
  const numbered = base => { const k = (counters.get(base) || 0) + 1; counters.set(base, k); return k; };
  for (let d = 1; d < D; d++) {
    const it = info[d];
    if (!it) continue;
    let base, key, gender, commonHead;
    if (it.type === T_SEA) {
      const m = seaName.get(d);
      if (m) { base = m.ru; key = `sea:${m.en}`; } else { base = 'Морская зона'; key = 'sea'; gender = 'f'; commonHead = true; }
    } else if (it.type === T_LAKE) {
      const l = lakeName.get(d);
      if (l) { base = l.ru; key = `lake:${l.en}`; } else { base = 'Озеро'; key = 'lake'; gender = 'n'; commonHead = true; }
      const tp = top(ev.lake.get(d));
      if (tp && lakes.table[tp[0]]?.reservoir) it.reservoir = true;
    } else if (it.type === T_MOUNT) {
      const rg = top(ev.range.get(d), Math.max(3, it.count * 0.15));
      const ft = top(ev.feature.get(d), Math.max(3, it.count * 0.3));
      const r = rg && geo.table[rg[0]];
      const f = ft && geo.table[ft[0]];
      if (r && r.ru) { base = r.ru; key = `range:${r.en}`; gender = featureGender(r.ru, r.cls); }
      else if (f && f.ru && /Plateau|Range|Foothills|Geoarea|Peninsula|Pen\/cape|Island|Desert|Plain|Basin/.test(f.cls)) { base = f.ru; key = `feature:${f.en}`; gender = featureGender(f.ru, f.cls); }
      else if (it.meanH >= 2500 && it.meanR < 1100) { base = 'Нагорье'; key = 'highland'; }
      else { base = 'Горный массив'; key = 'massif'; gender = 'm'; commonHead = true; }
    } else {
      // lowland: rivers -> lakeshore -> coast -> natural feature -> terrain descriptor
      const rivers = [];
      const seen = new Set();
      for (const [k, c] of ev.major.get(d) || []) {
        if (c < 3) break;
        const r = rv.names[k];
        if (!seen.has(r.key)) { seen.add(r.key); rivers.push(r); }
      }
      for (const [k, c] of ev.minor.get(d) || []) {
        if (c < 5 || rivers.length >= 2) break;
        const r = rv.names[k];
        if (!seen.has(r.key)) { seen.add(r.key); rivers.push(r); }
      }
      let lakeNb = null, seaNb = null;
      for (const [w, e] of it.waterNb) {
        if (e < 4) continue;
        if (!lakeNb && lakeName.has(w)) lakeNb = lakeName.get(w);
        if (!seaNb && seaName.has(w)) seaNb = seaName.get(w);
      }
      const ft = top(ev.feature.get(d), Math.max(3, it.count * 0.3));
      const f = ft && geo.table[ft[0]];
      if (rivers.length >= 2) {
        const [a, b] = rivers;
        base = `Междуречье ${a.gen} и ${b.gen}`; key = `interfluve:${a.en}:${b.en}`; gender = 'n'; commonHead = true;
      } else if (rivers.length === 1) {
        base = `Долина ${rivers[0].gen}`; key = `valley:${rivers[0].en}`; gender = 'f'; commonHead = true;
      } else if (lakeNb) {
        base = `Побережье ${lakePhrase(lakeNb.ru)}`; key = `lakeshore:${lakeNb.en}`; gender = 'n'; commonHead = true;
      } else if (f && f.ru && f.cls !== 'Coast') {
        base = f.ru; key = `feature:${f.en}`; gender = featureGender(f.ru, f.cls);
      } else if (seaNb) {
        base = `Побережье ${genitive(lowerHead(seaNb.ru))}`; key = `coast:${seaNb.en}`; gender = 'n'; commonHead = true;
      } else if (iceZone(it.lon, it.lat)) {
        base = 'Ледниковый щит'; key = 'icesheet'; gender = 'm'; commonHead = true;
      } else if (!it.landNb.length) {
        base = 'Остров'; key = 'island'; gender = 'm'; commonHead = true;
      } else if (it.meanR >= 380) { base = 'Холмы'; key = 'hills'; gender = 'p'; commonHead = true; }
      else if (it.meanH >= 700) { base = 'Плато'; key = 'plateau'; gender = 'n'; commonHead = true; }
      else if (it.meanH < 120) { base = 'Низменность'; key = 'lowland'; gender = 'f'; commonHead = true; }
      else { base = 'Равнина'; key = 'plain'; gender = 'f'; commonHead = true; }
    }
    items[d] = { base: cap(base), key, gender, commonHead, lon: it.lon, lat: it.lat, kind: it.type === T_SEA ? 's' : it.type === T_LAKE ? 'l' : 'g', reservoir: !!it.reservoir };
  }
  // disambiguate per kind (land+mountain, lakes, seas separately), then make names
  // unique across kinds too (an island and a sea of the same name)
  const all = [];
  for (const kind of ['g', 'l', 's']) {
    const list = [];
    for (let d = 1; d < D; d++) if (items[d] && items[d].kind === kind) list.push(items[d]);
    disambiguate(list);
    all.push(...list);
  }
  uniquify(all);
  return items;
}

// Name groups (provinces / regions) from member evidence.
// members: per group, list of member indices; votes(member) -> [[nameObj{ru,en}, weight], ...]
// A natural feature / range / sea must cover minShare of the group; a river
// ("Поречье X") riverShare; otherwise any feature covering looseShare.
export function nameGroups(groups, votesOf, fallbackRu, fallbackKey, { minShare = 0.3, riverShare = 0.12, looseShare = 0.15, fallbackGender = 'f' } = {}) {
  const items = groups.map(g => {
    const tally = new Map();
    let total = 0;
    for (const [obj, w] of g.votes) {
      total += w;
      if (!obj) continue;
      const k = obj.ru;
      const t = tally.get(k);
      if (t) t.w += w; else tally.set(k, { obj, w });
    }
    const pick = ok => {
      let best = null;
      for (const t of tally.values()) if (ok(t) && (!best || t.w > best.w || (t.w === best.w && t.obj.ru < best.obj.ru))) best = t;
      return best;
    };
    const best = pick(t => t.w >= (t.obj.kind === 'river' ? riverShare : minShare) * total)
      || pick(t => t.obj.kind !== 'river' && t.w >= looseShare * total);
    if (best) {
      return { base: cap(best.obj.ru), key: `${best.obj.kind || 'feature'}:${best.obj.en}`, gender: best.obj.gender, commonHead: best.obj.commonHead, lon: g.lon, lat: g.lat };
    }
    return { base: fallbackRu, key: fallbackKey, lon: g.lon, lat: g.lat, gender: fallbackGender, commonHead: true };
  });
  disambiguate(items);
  return items;
}
