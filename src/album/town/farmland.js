// Farmland: the fields as the state of the chunks of 1 km² (division/km.js). The owner, 12.11.2026: «если это чанк,
// в котором у нас угодья, то это поля в основном и маленькие редкие домики, по-разному находящиеся… Если оно
// соединяется с другим чанком, в котором то же самое, то мы не должны видеть разницы… Мы чанки не видим сами по
// себе… на границе у нас идёт аккуратный переход»; 13.11.2026: «поля по чанкам».
//
// A chunk keeps one number for its fields: how much of it is ploughed, a byte. The picture of the fields is drawn
// from that number alone (aspects/settle.js), so a chunk of farmland looks the same whoever ploughed it, two such
// chunks side by side show no seam, and the number is all a save has to remember.
//
// Who ploughs what is worked out here. Every settlement lives from its fields: so many hectares a person. Its fields
// lie around its houses as far as it needs them to: the chunks well within that distance are ploughed whole, those
// at its rim in part, and broken ground counts as lying farther than level ground. A chunk can be ploughed only as
// far as its ground allows (its class, its height, how wet it is); what one settlement has taken is not there for
// the next, and the fields of the next reach farther to make up for it. The greater settlement chooses first.
// A great river stops the plough (the natural cells the caller says can be reached).
// Plain JavaScript without the GPU: the same land and the same people always give the same fields.
import { KN, KKM, KX0, KY0, JITTER, kmHash, CLASS_SLOPE, HIGH_M, ORDER_WEIGHT, cellsOfChunks } from '../division/km.js';

export const HA_PER_PERSON = 1;                // hectares of fields a person lives from (this work's estimate; knob «Угодья на жителя»)
// how much of a chunk can be ploughed, by the class of its ground (km.js: 1 level .. 5 mountain, 0 water)
export const FARM_CAP = [0, 1, .8, .4, .1, 0];
export const FARM_HIGH = [1300, 1700];         // metres: from the first the fields thin out, above the second there are none
export const FARM_WET = .9;                    // the share of swamp of the land around from which nothing is ploughed; below it the dry share can be
export const FARM_REACH = [4, 30];             // km: how far from its houses a village, a town goes to plough
export const FARM_LEAST = .004;                // km²: less than this left of a chunk is not worth the walk
export const FARM_ROUGH = .3;                  // how uneven the edge of the fields of a settlement is (a share of the way to a chunk)

const step = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the class of the ground of a chunk when the land is not divided yet: from the height at its middle and around it
function roughClass(at, i, j) {
  const x = KX0 + (i + .5) * KKM, y = KY0 + (j + .5) * KKM, h = at(x, y); if (h <= 1) return [0, h];
  const e = .25, s = Math.hypot(at(x + e, y) - at(x - e, y), at(x, y + e) - at(x, y - e)) / (2 * e * 1000);
  return [h >= HIGH_M ? 5 : s < CLASS_SLOPE[0] ? 1 : s < CLASS_SLOPE[1] ? 2 : s < CLASS_SLOPE[2] ? 3 : s < CLASS_SLOPE[3] ? 4 : 5, h];
}

// What the chunks can give: how much of each can be ploughed, km². It depends on the land alone, so it is kept
// between the calls of the model (the caller keeps the object while the division stands).
//   at(x, y) → metres at a point of the flat km plane
//   land     { cls: Uint8Array (km.js chunkFacts), hgt: Float32Array (div.raster.hgt) } once the land is divided;
//            without it the class of a chunk is read off the relief as the chunk is asked for
//   swamp(k) the share of swamp of natural cell k by nature, 0..1 (may be left out)
export function farmGround(ch, at, land = null, swamp = null) {
  const n = KN * KN, room = new Float32Array(n).fill(-1), cls = land ? land.cls : new Uint8Array(n), cellOf = cellsOfChunks(ch);
  // (the swamps are kept by the natural cells of 100 km²: a cell that is a third swamp leaves two thirds of each of
  // its chunks to the plough. Where exactly the wet ground lies the ground shader knows, and paints no field there.)
  const dry = new Float32Array(ch.count).fill(1); if (swamp) for (let k = 0; k < ch.count; k++) { const w = swamp(k); dry[k] = w >= FARM_WET ? 0 : 1 - w; }
  const g = { cls, cell: cellOf.cell, count: cellOf.count, divided: !!land,
    // km² of chunk c that can be ploughed at all
    room(c) {
      let v = room[c]; if (v >= 0) return v;
      let k = cls[c], h = land ? land.hgt[c] : 0;
      if (!land) { const i = c % KN; [k, h] = roughClass(at, i, (c - i) / KN); cls[c] = k; }
      const cell = cellOf.cell[c];
      v = FARM_CAP[k] * (1 - step(FARM_HIGH[0], FARM_HIGH[1], h)) * (cell < ch.count ? dry[cell] : 1) * KKM * KKM;
      return room[c] = v < FARM_LEAST ? 0 : v;
    } };
  return g;
}

// The fields of one run of the model: settlements claim their ground one after another, the greater first.
//   ground   farmGround()
// → { claim(x, y, need, reach, ok) → km² taken; done() → the state of the chunks }
export function farmRun(ground) {
  const n = KN * KN, used = new Float32Array(n), felled = new Float32Array(ground.count.length), touched = [];
  let keys = new Float64Array(256), cost = new Float32Array(256), room = new Float32Array(256), left = new Float32Array(256);
  return {
    // A settlement at (x, y) ploughs `need` km² of the good ground around it, no farther than `reach` km.
    // ok: the natural cells it can walk to (a Map or a Set of their numbers; null — any); fell: how much forest it
    // fells besides, as a share of what it ploughs (0 for a village: its fields are all it clears)
    claim(x, y, need, reach, ok = null, fell = 0) {
      if (!(need > 0)) return 0;
      let rho = Math.min(reach, 1.2 + 1.4 * Math.sqrt(need / Math.PI)), m = 0, far = 0;
      // How much the settlement ploughs when its fields reach `far` km: a chunk that lies nearer than that by half a
      // chunk or more is ploughed as far as it can be, one that lies farther by as much not at all, those between
      // in part. (The chunks are sorted by how far they count as lying.)
      const sum = far => { let t = 0; for (let q = 0; q < m; q++) { const sh = (far - cost[q]) / KKM + .5; if (sh <= 0) break; t += Math.min(left[q], room[q] * Math.min(1, sh)); } return t; };
      for (;;) {
        const i0 = Math.max(0, Math.floor((x - rho - KX0) / KKM)), i1 = Math.min(KN - 1, Math.floor((x + rho - KX0) / KKM)), j0 = Math.max(0, Math.floor((y - rho - KY0) / KKM)), j1 = Math.min(KN - 1, Math.floor((y + rho - KY0) / KKM));
        const most = Math.max(0, (i1 - i0 + 1) * (j1 - j0 + 1));
        if (most > keys.length) { const size = 2 ** Math.ceil(Math.log2(most)); keys = new Float64Array(size); cost = new Float32Array(size); room = new Float32Array(size); left = new Float32Array(size); }
        m = 0;
        for (let j = j0; j <= j1; j++) for (let i = i0, c = j * KN + i0; i <= i1; i++, c++) {
          if (ground.room(c) - used[c] < FARM_LEAST) continue;
          if (ok && !ok.has(ground.cell[c])) continue;
          const d = Math.hypot(KX0 + (i + .5 + (kmHash(i, j, 1) - .5) * 2 * JITTER) * KKM - x, KY0 + (j + .5 + (kmHash(i, j, 2) - .5) * 2 * JITTER) * KKM - y); if (d > rho) continue;   // to the seed of the chunk
          // how far the chunk counts as lying: broken ground lies farther, and no two chunks quite alike
          keys[m++] = Math.round(d * ORDER_WEIGHT[ground.cls[c]] * (1 + (kmHash(i, j, 12) - .5) * FARM_ROUGH) * 1000) * 2097152 + c;
        }
        const part = keys.subarray(0, m).sort();
        for (let q = 0; q < m; q++) { const c = part[q] % 2097152; cost[q] = Math.floor(part[q] / 2097152) / 1000; room[q] = ground.room(c); left[q] = room[q] - used[c]; }
        far = rho + .5 * KKM;
        if (sum(far) >= need || rho >= reach) break;
        rho = Math.min(reach, rho * 1.5);
      }
      if (sum(far) > need) { let lo = 0; for (let n = 0; n < 14; n++) { const mid = (lo + far) / 2; if (sum(mid) < need) lo = mid; else far = mid; } }
      let got = 0;
      for (let q = 0; q < m; q++) {
        const sh = (far - cost[q]) / KKM + .5; if (sh <= 0) break;
        const take = Math.min(left[q], room[q] * Math.min(1, sh), need - got); if (take < FARM_LEAST) continue;
        const c = keys[q] % 2097152;
        if (used[c] === 0) touched.push(c);
        used[c] += take; got += take;
        if (fell > 0) { const k = ground.cell[c]; if (k < felled.length) felled[k] += take * fell; }
      }
      return got;
    },
    // → { km: Uint8Array (KN · KN: the share of every chunk under fields, a byte), list: Int32Array (the chunks that
    //     have fields, in rising order), area: km² under fields, cellArea: Float32Array (km² of fields in the chunks of
    //     every natural cell), cellFelled: Float32Array (km² felled there besides) }
    done() {
      const km = new Uint8Array(n), list = Int32Array.from(touched).sort(), cellArea = new Float32Array(felled.length); let area = 0;
      for (const c of list) { km[c] = Math.max(1, Math.min(255, Math.round(used[c] / (KKM * KKM) * 255))); area += used[c]; const k = ground.cell[c]; if (k < cellArea.length) cellArea[k] += used[c]; }
      return { km, list, area, cellArea, cellFelled: felled };
    },
  };
}

// The same state for a natural cell someone has ploughed by hand (the brush of the album writes cells of 100 km²):
// every chunk of the cell gets the share of the cell. cells: Map(natural cell → share 0..1). Returns a new state.
export function farmWithCells(ground, farm, cells) {
  if (!cells.size) return farm;
  const km = Uint8Array.from(farm.km), set = new Set(farm.list);
  for (let c = 0; c < km.length; c++) { const v = cells.get(ground.cell[c]); if (v === undefined) continue; const b = ground.room(c) > 0 || !ground.divided ? Math.round(v * 255) : 0; km[c] = b; if (b) set.add(c); else set.delete(c); }
  return { ...farm, km, list: Int32Array.from(set).sort() };
}

// km² of fields in every district. cells: the district of every chunk (division/cells.js); count: how many districts
export function farmOfDistricts(farm, cells, count) {
  const out = new Float32Array(count);
  for (const c of farm.list) { const d = cells[c]; if (d >= 0 && d < count) out[d] += farm.km[c] / 255 * KKM * KKM; }
  return out;
}
