# Metals: richest deposits, size classes, defaults (research notes, 2026-11-11)

All numbers are metric tonnes of **contained metal** unless the cell says otherwise (REE as REO; TiO2 shown next to Ti).
"Contained" = endowment basis given in the cell: **P** = past production, **R** = reserves + resources still in the ground,
**P+R** = both. Footprint = orebody / open-pit / district outline in plan, rough. `t/km²` = contained ÷ footprint
(the number that matters for a 10 × 10 km chunk).

## How the size classes are built

Laznicka (2010, *Giant Metallic Deposits*, 2nd ed., Tables 2.2–2.3, after Laznicka 1999) grades every metal by the
same geochemical yardstick: contained metal divided by the metal's crustal abundance (clarke). The class lower bounds
are 10⁸ / 10⁹ / 10¹⁰ / 10¹¹ / 10¹² × clarke, which in tonnes is simply:

| class (lower bound) | small | medium | large | giant | supergiant |
|---|---|---|---|---|---|
| tonnes of metal | 100 × clarke(ppm) | 1 000 × clarke | 10 000 × clarke | 100 000 × clarke | 1 000 000 × clarke |

Example Cu (clarke 25 ppm): small 2.5 kt, medium 25 kt, large 250 kt, giant 2.5 Mt, supergiant 25 Mt. Each class spans
one decade; a **typical (geometric-middle) member ≈ 3 × its lower bound**. Laznicka splits giants further into
low / mid / high at 1×, 3.3×, 6.6× the giant bound.

Cross-check, Singer (1995, USGS, *Economic Geology* 90:88–104): "world-class" = top 10 % of known deposits by contained
metal: **Au ≥ 100 t, Ag ≥ 2 400 t, Cu ≥ 2 Mt, Zn ≥ 1.7 Mt, Pb ≥ 1 Mt**. These top-10 % deposits hold 71–86 % of all
the metal. Laznicka's giant bounds are a bit higher: Au 250 t, Ag 7 000 t, Cu 2.5 Mt, Zn 6.5 Mt, Pb 1.5 Mt.

"Default producer" = my judgment for a mine known to have produced but with no size given: normally the middle of the
*medium* class, nudged up for metals that are only mined from bulk deposits (Mo, PGM, Li, REE), down for metals mined from
many small deposits (Hg, Cr).

---

## 1. Base metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t, lower bounds) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| Copper | **El Teniente**, Chile (largest single porphyry Cu; breccia-porphyry around 1.2 km Braden pipe) | −34.09, −70.35 | **≥ 94 Mt Cu** (P+R; ~18 Mt already mined); Laznicka 98 Mt | ~5 (ore shell 2–3 km across; rough) | ~19 Mt | 2.5 k / 25 k / 250 k / 2.5 M (Singer world-class ≥ 2 Mt) | **100 kt Cu** | [ET], [L] |
| Lead | **Broken Hill**, NSW, Australia (Line of Lode) | −31.96, 141.46 | **~28 Mt Pb** (P+R; ~280 Mt ore @ 10 % Pb, 8.5 % Zn, 150 g/t Ag; AusIMM high case 340 Mt @ 12 % Pb) | ~2–3 (lode 7–9.5 km long, ≤ 300 m wide) | ~11 Mt | 1.5 k / 15 k / 150 k / 1.5 M (Singer WC ≥ 1 Mt) | **50 kt Pb** | [BH], [L] |
| Zinc | **Red Dog**, Alaska (Main + Aqqaluk + Qanaiyaq + Paalaaq) | 68.07, −162.86 | **~25 Mt Zn** (P+R; Laznicka ore field 31 Mt @ 16.6 %; Aqqaluk alone 55.6 Mt @ 16.4 %) | ~3 (adjacent pits) | ~8 Mt | 6.5 k / 65 k / 650 k / 6.5 M (Singer WC ≥ 1.7 Mt) | **150 kt Zn** | [RD], [L] |
| Tin | **San Rafael**, Peru — "world's richest tin lode", 4.7–5 % Sn | −14.23, −70.32 | **~1 Mt Sn** (P+R, pre-mining resource) | ~1 (single steep lode) | ~1 Mt | 230 / 2.3 k / 23 k / 230 k | **5 kt Sn** | [SR] |
| Mercury | **Almadén**, Spain (~1/3 of all Hg ever produced) | 38.78, −4.84 | **~260 kt Hg** (P: 7.5 M flasks × 34.5 kg); Laznicka 280 kt | ≤ 1 (three quartzite beds) | ≥ 260 kt | 4 / 40 / 400 / 4 000 | **100 t Hg** | [AL], [L] |

Wide alternatives: Cu — Chuquicamata district 110 Mt, Lubin Kupferschiefer 91 Mt, Katanga Copperbelt 125 Mt (belt);
Pb — Viburnum Trend 40 Mt (belt); Zn — Kraków–Silesia basin 28 Mt; Broken Hill also ≈ 24 Mt Zn (≈ 10 Mt Zn/km², as dense
as Red Dog); Sn — Gejiu ore field 2.45 Mt (largest district), Kinta Valley placers 3.1 Mt (wide). [L]

## 2. Precious metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| Gold | **Muruntau**, Uzbekistan (one open pit) | 41.52, 64.58 | **~4 800 t Au** (P+R; quoted 4 500–5 000 t; ~1 Gt @ 3.5–4 g/t) | ~9 (pit 3.5 × 2.5 km) | ~530 t | 0.25 / 2.5 / 25 / 250 (Singer WC ≥ 100 t) | **10 t Au** | [MU], [L] |
| Silver | **Cerro Rico de Potosí**, Bolivia | −19.62, −65.75 | **~60 kt Ag produced** (P, 1545–1996); Laznicka P+R 115 kt @ 102 g/t | ~2 (the mountain's dacite dome; rough) | 30–55 kt | 7 / 70 / 700 / 7 000 (Singer WC ≥ 2 400 t) | **300 t Ag** | [CR], [L] |
| PGM (Pt+Pd+Rh…) | **Noril'sk–Talnakh** (Talnakh + Oktyabrsky + Noril'sk-1), Russia | 69.50, 88.30 | **~8 300 t PGE** (R; Nornickel 1.1.2024: M&I 255 Moz = 7 940 t, + inferred 107 Moz = 3 330 t, 6PGM) | ~20 (Oktyabrsky alone 2 × 4 km) | ~400 t | 1.3 / 13 / 130 / 1 300 | **40 t PGM** | [NN], [L] |

Wide alternatives: Au — Witwatersrand Central Rand Group 63 kt (basin ~350 km long), Welkom goldfield 15.3 kt;
Ag — Lubin Kupferschiefer 170 kt @ 4 g/t (district); PGM — Bushveld Merensky Reef 30.8 kt (Laznicka 2009), plus UG2 and
Platreef — larger in total but a reef only ~1 m thick: ~20 t PGM/km² of reef per layer, so per km² Noril'sk wins. [L]

## 3. Iron, ferro-alloy and steel metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| Iron (Fe) | **Carajás S11D** (Serra Sul), Brazil, ~65–67 % Fe hematite | ~−6.40, −50.35 | **~2.2 Gt Fe in reserves** (3.4 Gt ore @ 65.4 %, Vale 31.12.2024); ~2.6 Gt incl. mining since 2016 | ~20 (rough) | ~120 Mt | 4.3 M / 43 M / 430 M / 4.3 G | **50 Mt Fe** (~90 Mt ore) | [CAR], [L] |
| Manganese | **Kalahari Manganese Field** (Hotazel), South Africa — largest *and* densest | −27.20, 22.95 | **~4 Gt Mn** (R; Laznicka 4.19 Gt Mn @ 31 %, ~13 Gt ore; ~70–80 % of world land Mn) | ≥ 1 100 | ~3.6 Mt | 72 k / 720 k / 7.2 M / 72 M | **2 Mt Mn** | [KMF], [L] |
| Chromium | **Kempirsai Main (South Kempirsai) Ore Field**, Kazakhstan (podiform chromite, Donskoy GOK) | ~50.2, 58.5 | **~100 Mt Cr** (estimate: > 300 Mt ore explored × ~50 % Cr2O3 × 0.684; single orebodies > 150 Mt @ 55–60 % Cr2O3) | ~25 (rough) | ~4 Mt | 13 k / 130 k / 1.3 M / 13 M | **200 kt Cr** | [KZ] |
| Nickel | **Noril'sk–Talnakh**, Russia (massive sulphide) | 69.50, 88.30 | **~15 Mt Ni** (R; 15.3 Mt; Nornickel M&I 11.8 Mt + inferred 5.2 Mt; Laznicka P+R 23.2 Mt) | ~20 | ~0.75 Mt | 5.5 k / 55 k / 550 k / 5.5 M | **150 kt Ni** | [NN], [L] |
| Cobalt | **Kisanfu**, Lualaba, DR Congo (1 % Co, highest-grade large Cu-Co) | −10.78, 25.93 | **~2.0 Mt Co** (R; 198.8 Mt @ 1.01 % Co, NERIN 2021; older 365 Mt @ 0.85 % = 3.1 Mt) | ~5 (rough) | ~0.4 Mt | 2.4 k / 24 k / 240 k / 2.4 M | **20 kt Co** (mostly by-product) | [KIS], [L] |
| Tungsten | **Shizhuyuan**, Hunan, China (W-Sn-Mo-Bi skarn/greisen) | ~25.74, 113.17 | **~0.55–0.63 Mt W** (R; 0.68–0.80 Mt WO3 × 0.793; also ~0.49 Mt Sn, 0.2 Mt Mo, 0.1–0.3 Mt Bi) | ~1.5 (rough) | ~0.4 Mt | 100 / 1 k / 10 k / 100 k | **5 kt W** | [SZY], [L] |
| Molybdenum | **Climax**, Colorado, USA | 39.37, −106.18 | **~2.2 Mt Mo** (P+R; Laznicka 2.18 Mt, 2009 update 2.70 Mt, 0.24 % MoS2-grade ore) | ~2 (stacked ore shells ~1.5 km across; rough) | ~1 Mt | 110 / 1.1 k / 11 k / 110 k | **30 kt Mo** | [CLX], [L] |

Wide alternatives: Fe — Kursk Magnetic Anomaly 35 Gt Fe, Hamersley basin 19.5 Gt Fe (Laznicka 2009), Carajás district
~18 Gt ore @ 65 % (~12 Gt Fe) spread over tens of km. Most compact Fe: **Kiruna** (67.85, 20.20): ~1.5 Gt ore mined +
0.54 Gt reserves (~1 Gt Fe) in a 4 km × 80–120 m slab going 2 km deep — enormous per km² of outcrop, but less per chunk
than S11D. Cr — Bushveld chromitite seams 3.47 Gt Cr (Laznicka 1999) over ~300 km of outcrop, ~4–5 Mt Cr/km² of reef
plane, i.e. same density as Kempirsai but over a far larger area. Ni — New Caledonia laterite blanket ~50 Mt Ni (island-
wide). Co — Katanga Copperbelt 10.4 Mt Co (belt ~300 km); Tenke-Fungurume reserves 177 Mt @ 0.30 % Co (~0.5 Mt).
W — Verkhnee Kairakty, Kazakhstan, 0.88 Mt W but only 0.1 % W (Laznicka 1999).

## 4. Light metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| Aluminium | **Sangarédi** plateau, Boké, Guinea (CBG; historic 51–58 % Al2O3) | ~11.10, −13.80 | **~80 Mt Al** (P+R; > 300 Mt bauxite @ ~51 % Al2O3 × 0.529). Bauxite basis: > 300 Mt | ~10 (outcrop) | ~8 Mt | 8 M / 80 M / 800 M / 8 G (Laznicka: no Al deposit is giant) | **20 Mt Al** (~80 Mt bauxite) | [SAN], [L] |
| Titanium | **Tellnes**, Norway (ilmenite norite) | ~58.34, 6.40 | **~57 Mt TiO2 = ~34 Mt Ti** (R; > 300 Mt @ 18 % TiO2) | ~1.1 (2.7 × 0.4 km) | ~31 Mt Ti | 0.4 M / 4 M / 40 M / 400 M | **2 Mt Ti** (~3.5 Mt TiO2) | [TEL], [L] |
| Magnesium | **Haicheng–Dashiqiao magnesite belt**, Liaoning, China (largest magnesite district; densest as a belt) | 40.73, 122.81 (Xiafangshen) | **~1 Gt Mg** (R; Haicheng proven 3.93 Gt magnesite × ~27 % Mg; "resource" claims up to 25 Gt magnesite). Single deposit Xiafangshen: 258 Mt @ 47 % MgO ≈ 74 Mt Mg | 60–120 (belt 60 km × 1–2 km) | ~10 Mt | 3.2 M / 32 M / 320 M / 3.2 G | **10 Mt Mg** (~35 Mt magnesite) | [HC], [L] |
| Lithium | **Greenbushes**, Western Australia (spodumene pegmatite) | −33.86, 116.06 | **~3.1 Mt Li** (R; 440 Mt @ 1.5 % Li2O = 6.6 Mt Li2O × 0.4646; IGO CY24) | ~3 (pegmatite ~3 km × ≤ 0.3 km; pits) | ~1 Mt | 1.8 k / 18 k / 180 k / 1.8 M | **100 kt Li** (~0.5 Mt LCE) | [GB], [L] |

Notes: Al — Laznicka's largest Al "deposit" is Boké–Gaoual, 3.88 Gt Al over a large plateau region; CBG concession total
resource 7.0 Gt @ 46.4 % Al2O3 (~1.7 Gt Al). Lateritic bauxite usually gives 2–4 Mt Al per km² (blanket 5–10 m thick);
Sangarédi is unusually thick and rich. Ti — Bushveld Main Magnetitite Seam holds 2.88 Gt Ti (Laznicka) but at 7 % Ti
over the whole complex; Panzhihua and other V-Ti magnetites are similar. Mg — brines are larger still: the Dead Sea holds
~40+ g/L Mg, i.e. several Gt Mg in ~600 km² (my rough estimate, not from a cited source). Li — Salar de Atacama and Uyuni
hold more Li in total (each ~10–20 Mt Li) but over 3 000–10 000 km², i.e. ~2–3 kt Li/km²; Manono (DRC) ~400 Mt @ 1.65 %
Li2O (~3 Mt Li) rivals Greenbushes.

## 5. Rare earths and rare metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| REE (as REO) | **Bayan Obo**, Inner Mongolia, China (REE-Fe-Nb) | 41.80, 109.97 | **~40–45 Mt REO** (R; 43.5 Mt "industrial reserve"; USGS 1990 "> 30 Mt"; Laznicka 45 Mt @ 4 %; press claims ~100 Mt) | ~48 district (18 km × ~3 km); Main + East pits ~3 | ~0.9 Mt (district) | 15 k / 150 k / 1.5 M / 15 M | **200 kt REO** | [BO], [L] |
| Niobium | **Araxá (Barreiro)**, Minas Gerais, Brazil (CBMM; pyrochlore laterite on carbonatite) | −19.66, −46.94 | **~8 Mt Nb** (R; 462 Mt @ 2.5 % Nb2O5 = 11.6 Mt Nb2O5 × 0.699) | ~20 (complex ~5 km diameter) | ~0.4 Mt | 1.9 k / 19 k / 190 k / 1.9 M | **50 kt Nb** | [ARX], [L] |
| Tantalum | **Greenbushes**, WA (same pegmatite as Li; was the top Ta mine) | −33.86, 116.06 | **~24 kt Ta** (R; > 135 Mt @ 0.022 % Ta2O5 = ~30 kt Ta2O5 × 0.819) | ~3 | ~8 kt | 110 / 1.1 k / 11 k / 110 k | **2 kt Ta** | [GBTa], [L] |
| Beryllium | **Spor Mountain**, Utah (bertrandite in tuff; > 2/3 of world Be since 1968) | ~39.72, −113.22 | **~7 kt Be** (R; ~7 Mt ore @ 0.27 %, read as BeO × 0.36; 19 kt if the 0.266 % is Be) | ~10 (pits spread over the ridge; rough) | ~1 kt | 240 / 2.4 k / 24 k / 240 k | **2 kt Be** | [SPOR], [L] |
| Gallium | no primary Ga ore; by-product of bauxite (~50 g/t) and zinc ores. Largest listed: Brockman, WA | — | 640 t Ga (Laznicka). Bauxite rule: Sangarédi-type 300 Mt × 50 g/t ≈ 15 kt Ga in ore, little recovered | — | — | 1.5 k / 15 k / 150 k / 1.5 M (geochemical; no deposit reaches "large") | **100 t Ga** (by-product) | [L] |
| Germanium | by-product of Zn (and Ge-rich coal). **Tsumeb**, Namibia (historic Ge mine) | −19.24, 17.71 | 2 160 t Ge (P+R, Laznicka 1999); Red Dog ore holds ~18.7 kt Ge (unrecovered, Laznicka 2009) | ~0.1 (pipe) | — | 140 / 1.4 k / 14 k / 140 k | **100 t Ge** (by-product) | [L] |
| Indium | by-product of Zn-Sn-Cu ores. Largest listed: **Uchaly** ore field, S Urals | ~54.3, 59.4 | 3 150 t In @ 15 g/t (Laznicka 2009); Toyoha (Japan) was the largest producer until 2006 | — | — | 5 / 50 / 500 / 5 000 | **50 t In** (by-product) | [L], [IN] |

Wide/other: REE — Tomtor (Russia) is very high grade (Laznicka 1999 listed 40 Mt REE at 8 %); ionic-clay REE of S China is
spread thin. Nb — Seis Lagos (Brazil) 48.9 Mt Nb by Laznicka 1999, undeveloped and poorly constrained. Ta — Ghurayyah
(Saudi Arabia) 93 kt Ta at only 212 ppm, undeveloped. Be — Laznicka 2009 lists Shizhuyuan with 100 kt Be at 0.12 %
(skarn, not mined for Be) and Strange Lake 15 kt. In — Werner et al. (2017) count ≥ 356 kt In inside 1 512 known
deposits, almost all as unrecovered trace content.

## 6. Nuclear metals

| metal | richest deposit (per km²) | lat, lon | contained metal | footprint km² | ≈ t/km² | small / medium / large / giant (t) | default producer | sources |
|---|---|---|---|---|---|---|---|---|
| Uranium | **McArthur River**, Saskatchewan (unconformity; 6.5 % U3O8 reserves) | 57.76, −105.05 | **~270 kt U** (P+R: ≈ 360 Mlb U3O8 packaged 2000–2024 + 346.5 Mlb reserves at 31.12.2025 → ~320 kt U3O8 × 0.848) | < 1 (orebody plan ~0.1–0.2; rough) | > 0.3 Mt | 170 / 1.7 k / 17 k / 170 k | **10 kt U** | [CAM], [L] |
| Thorium | **Araxá (Barreiro) carbonatite**, Brazil | −19.66, −46.94 | **~1.2 Mt Th** (R, single source: Laznicka 1999, 1.16 Mt @ 0.62 %; never mined for Th) | ~20 | ~60 kt | 850 / 8.5 k / 85 k / 850 k | **10 kt Th** | [L] |

Notes: U — **Olympic Dam** (−30.44, 136.88) is by far the largest: "well over 1 Mt U" (Red Book via WNN), Laznicka
1.98 Mt U at only ~0.02 % U, in a breccia complex of roughly 20 km² (≈ 0.1 Mt U/km²). Inside one 100 km² chunk
Olympic Dam holds more U than McArthur River; per km² McArthur River and Cigar Lake (479 kt ore @ 16.3 % U3O8 reserves)
are far denser. Th — world Th resources ~6 Mt (IAEA TECDOC-1877). Highest-grade mined Th-bearing ore: Steenkampskraal
(South Africa) 665 kt @ 2.14 % Th ≈ 14 kt Th in a tiny vein. Lemhi Pass (Idaho/Montana) is the largest US Th district.
India's monazite beach sands hold the largest national total but are spread along coasts.

---

## Conversion factors used

1 troy oz = 31.1035 g (1 Moz = 31.1 t); 1 lb = 0.4536 kg; 1 short ton = 0.907185 t; 1 flask Hg = 34.5 kg.
Oxide → metal: U3O8 × 0.848; Li2O × 0.4646; LCE (Li2CO3) × 0.1879; WO3 × 0.793; MoS2 × 0.599; Nb2O5 × 0.699;
Ta2O5 × 0.819; BeO × 0.360; ThO2 × 0.879; TiO2 × 0.599; Al2O3 × 0.529; MgO × 0.603; MgCO3 × 0.288; Cr2O3 × 0.684.
REE kept as REO (REE metal ≈ 0.85 × REO).

## Caveats

1. **Bases are mixed on purpose and labelled.** P+R (endowment) is the right number for "how much metal was ever in this
   ground"; R alone understates old mines (Broken Hill is ~90 % mined out, Almadén and Cerro Rico are mostly mined).
2. **Footprints are rough**, often my reading of pit/orebody sizes, not surveyed areas. Steep, deep orebodies (Kiruna,
   Noril'sk, McArthur River, San Rafael, El Teniente) reach 1–2 km depth, so their t/km² of *surface* is very high. For a
   chunk cap, use the contained metal of the whole deposit, not t/km² × 100.
3. **Belts vs deposits.** The largest accumulations (Witwatersrand Au, Bushveld PGM/Cr/Ti, Katanga Co/Cu, KMA/Hamersley
   Fe, New Caledonia Ni, Kalahari Mn, Haicheng magnesite) are basins or belts; the tables give the densest single deposit
   and list the belt totals underneath.
4. **Laznicka classes are geochemical** (relative to crustal abundance), not economic. They work well for most metals but
   are too strict for Al and Mg (no Al deposit reaches "giant") and generous for by-product metals (Ga, Ge, In) whose
   "contained" metal is mostly never recovered. For game balance, Al/Mg/Ti may be shifted one class down.
5. **Chinese and Kazakh figures** (Bayan Obo, Shizhuyuan, Haicheng, Kempirsai) vary 2–3× between "reserve", "industrial
   reserve" and "resource"; I took the moderate published values. Kempirsai's 100 Mt Cr is my arithmetic from published
   ore tonnage and grade, not a quoted total.
6. **Single-source numbers:** Araxá Th (1.16 Mt) and the Ga/Ge/In maxima come only from Laznicka's GIANTDEP; Spor Mountain's
   grade basis (Be vs BeO) is ambiguous (7 vs 19 kt Be).
7. **By-products** (Co, PGM in Ni ores, Ag in Pb-Zn, Ga, Ge, In, Mo in porphyry Cu): their default "producer" size is a
   share of the host mine, not a standalone mine.
8. **Defaults are judgment calls**, not statistics: roughly the middle of the medium class (≈ 3 000 × clarke), adjusted as
   described above. Singer's world-class thresholds are the better anchor for "large" in Au/Ag/Cu/Zn/Pb.
9. Laznicka (2010) is a copyrighted book; only numbers are used here (read from the publisher's free chapter-2 sample).

## Sources

- [L] Laznicka, P. (2010) *Giant Metallic Deposits*, 2nd ed., Springer — ch. 2, Tables 2.2, 2.3 (class thresholds),
  2.7a/2.7b (largest deposit per metal, 1999 and 2009). Free sample:
  https://beckassets.blob.core.windows.net/product/readingsample/610713/9783642124044_excerpt_001.pdf
- [S95] Singer, D.A. (1995) World class base and precious metal deposits — a quantitative analysis. *Economic Geology*
  90(1):88–104. https://pubs.usgs.gov/publication/70197194
- [ET] Cannell, J. et al. (2005) Geology, mineralization, alteration and structural evolution of the El Teniente porphyry
  Cu-Mo deposit. *Economic Geology* 100. https://figshare.utas.edu.au/articles/journal_contribution/Geology_mineralization_alteration_and_structural_evolution_of_the_El_Teniente_porphyry_Cu-Mo_deposit/22856216
- [BH] PDAC Broken Hill geology overview (~280 Mt @ 10 % Pb, 8.5 % Zn, 150 g/t Ag; strike > 7 km):
  https://cdn7.pdac.ca/web/files/faa_broken-hill_4_rev2.pdf ; AusIMM 2011, CML7 resource model (340 Mt high case, 7.8 km):
  https://www.ausimm.com/publications/conference-proceedings/eighth-international-mining-geology-conference-2011/chasing-the-leadzincsilver-lining---establishing-a-resource-model-for-the-historic-cml7-broken-hill-new-south-wales-australia/
- [RD] Alaska DNR, Red Dog deposit tables (Main, Aqqaluk 55.6 Mt @ 16.4 % Zn, Qanaiyaq, Paalaaq, Anarraaq):
  https://dnr.alaska.gov/mlw/mining/large-mines/red-dog/pdf/sdb1.pdf
- [SR] Mlynarczyk, Sherlock & Williams-Jones (2003) San Rafael, Peru: geology and structure of the world's richest tin
  lode. *Mineralium Deposita* 38:555–567 ("average 4.7 wt% Sn, total resource of ~1 million tonnes Sn (metal)").
  https://app.ingemmet.gob.pe/biblioteca/pdf/MD-38-555.pdf
- [AL] Almadén 7.5 million flasks, ~1/3 of world Hg (Hernández 1995, cited in): https://core.ac.uk/download/351885921.pdf ;
  IGME Almadén geosite sheet: https://www.igme.es/patrimonio/LigMes/2022/Almaden.pdf
- [MU] Muruntau: Porter GeoConsultancy abstract (> 1 Gt @ 3.5–4 g/t, 4 500–5 000 t Au):
  https://portergeo.com.au/publishing/porphyry98/Abstract16p.asp ; Wilde et al., Virtual Explorer:
  https://virtualexplorer.com.au/article/2000/4/setting-of-muruntau-gold/index.html ; pit 3.5 × 2.5 km:
  https://en.wikipedia.org/wiki/Muruntau_gold_deposit
- [CR] Cerro Rico (~60 000 t Ag by 1996): https://en.wikipedia.org/wiki/Cerro_Rico ; Cunningham et al., USGS, age and
  thermal history: https://pubs.usgs.gov/publication/70018674
- [NN] Nornickel, mineral resources and ore reserves at 1 Jan 2024 (Norilsk Division, SRK 2021):
  https://ar2023.nornickel.ru/en/business-overview.1.html ; Minerals 2018, 8(4):124 (Oktyabrsky + Talnakh + Noril'sk-1:
  15.3 Mt Ni, 8 300 t PGE; Oktyabrsky 2 × 4 km): https://www.mdpi.com/2075-163X/8/4/124
- [CAR] Vale Serra Sul reserves 3.4 Gt @ 65.4 % Fe (31.12.2024):
  https://www.engineeringnews.co.za/article/serra-sul-complex-brazil-2025-08-29 ; Serra Norte:
  https://www.miningweekly.com/article/serra-norte-complex-brazil-2025-09-05-1 ; Kiruna geometry:
  https://en.wikipedia.org/wiki/Kiruna_Mine
- [KMF] Kalahari Mn field ≥ 1 100 km² (Wits thesis):
  https://wiredspace.wits.ac.za/server/api/core/bitstreams/2c670a15-446b-4a0f-b9d6-f6f57d7f7c9c/content ; Ntsimbintle
  (≈ 4.2 Gt, ~77 % of world land Mn): https://ntsimbintle.co.za/our-business/the-kalahari-manganese-field
- [KZ] Melcher et al. (1997) Petrogenesis of the ophiolitic giant chromite deposits of Kempirsai, *J. Petrology*
  38:1419–1458, and Melcher et al. 1994 (orebodies > 150 Mt @ 55–60 % Cr2O3):
  https://link.springer.com/doi/10.1007/s001260050202 ; Gornyi Zhurnal 2013 (Donskoy GOK, ~50 % Cr2O3):
  https://rudmet.com/journal/1177/article/20054
- [KIS] Kisanfu: CMOC/Freeport deal (365 Mt @ 1.72 % Cu, 0.85 % Co; 3.1 Mt Co):
  https://www.mining.com/web/china-moly-buys-95-of-drc-copper-cobalt-mine-from-freeport-for-550m/ ; NERIN 2021 model
  198.8 Mt @ 1.01 % Co and coordinates: https://africamining.chinaglobalsouth.com/projects/kisanfu-mining
- [SZY] Shizhuyuan: Minerals 2020, 10(9):748 (≈ 800 kt WO3, 486 kt Sn, 200 kt Mo, 100 kt Bi):
  https://www.mdpi.com/2075-163X/10/9/748 ; China Tungsten & Hightech 2026 (678.7 kt):
  https://www.asianmetal.com/news/2280137/CMT-announces-major-resource-growth-at-Shizhuyuan-mine/1
- [CLX] Climax production and reserve history (MRDS): https://westernmininghistory.com/mine-detail/10214926/
- [SAN] Sangarédi / CBG: USGS Minerals Yearbook Guinea 2019: https://pubs.usgs.gov/myb/vol3/2019/myb3-2019-guinea.pdf ;
  CBG project page (> 300 Mt @ ~51 %, historic 56–58 %): https://www.mining-technology.com/projects/cbg-bauxite/ ;
  outcrop ~10 km²: https://iieta.org/node/9238
- [TEL] Tellnes: Charlier et al. (2,700 × 400 m, ~18 % TiO2, 57 Mt TiO2):
  https://orbi.uliege.be/bitstream/2268/2855/1/charlier05.pdf ; NGU titanium focus:
  https://www.ngu.no/sites/default/files/2024-03/Focus_3_2022_TITANIUM_AND_IRON_TITANIUM.pdf
- [HC] Haicheng–Dashiqiao: belt 60 km × 1–2 km: https://core.ac.uk/download/161256944.pdf ; Liaoning industry report
  (Haicheng proven 3.93 Gt magnesite): https://faxiangongchang.com/en/reports/liaoning-feijinshukuangwuzhipinye ;
  Xiafangshen: https://en.wikipedia.org/wiki/Xiafangshen_mine ; USGS MCS 2025 magnesium compounds:
  https://pubs.usgs.gov/periodicals/mcs2025/mcs2025-magnesium-compounds.pdf
- [GB] IGO, Greenbushes CY24 Mineral Resources and Ore Reserves (440 Mt @ 1.5 % Li2O):
  https://igo.com.au/site/PDF/871f9559-e640-4987-b9a0-b1740dafb6d9/GreenbushesCY24ResourcesandReserves
- [GBTa] USGS tantalum deposits data release (Greenbushes > 135 Mt @ ~0.022 % Ta2O5):
  https://www.usgs.gov/data/tantalum-deposits-united-states
- [BO] Bayan Obo: USGS OFR 90-538: https://pubs.usgs.gov/of/1990/0538/report.pdf ; district 18 km / 48 km²:
  https://en.wikipedia.org/wiki/Bayan_Obo_Mining_District ; pits: https://www.nsenergybusiness.com/projects/bayan-obo-rare-earth-mine/
- [ARX] Araxá: CPRM 2019 presentation (462 Mt @ 2.5 % Nb2O5):
  https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-permanentes/cme/apresentacoes-em-eventos/2019/09-07-2019-extracao-exploracao-comercio-e-exportacao-do-niobio-pl-4978-2013/6.%20CPRM.pdf ;
  complex 5 km diameter: https://assets.niobium.tech/-/media/niobiumtech/attachments-biblioteca-tecnica/nt_some-aspects-of-the-mineralogy-of-cbmm-niobium--deposit-and-mining-pyrochlore-ore-processing-1.pdf
- [SPOR] NMBGMR OFR-533 (Spor Mountain 7.0 Mt @ 0.266 %): https://geoinfo.nmt.edu/publications/openfile/details.cfml?Volume=533 ;
  Materion S-K 1300 report 2021: https://www.sec.gov/Archives/edgar/data/1104657/000110465722000021/mtrn-ex96_20211231.htm
- [IN] Werner et al. (2017) The world's by-product and critical metal resources part III: indium. *Ore Geology Reviews*.
  https://digitalscholarship.unlv.edu/geo_fac_articles/189
- [CAM] Cameco, Mineral reserves and resources at 31 Dec 2025 (McArthur River 2 426 kt @ 6.48 % = 346.5 Mlb; Cigar Lake
  479 kt @ 16.33 % = 172.4 Mlb): https://www.cameco.com/sites/default/files/documents/2025-mineral-reserves-and-resources.pdf ;
  production 2000–2023 340.0 Mlb: https://www.sec.gov/Archives/edgar/data/1009001/000119312524088138/d764441dex991.pdf
- Olympic Dam "well over one million tonnes of uranium":
  https://world-nuclear-news.org/Articles/Australian-miners-provide-updates-on-past-and-futu
- Thorium: IAEA TECDOC-1877 (world ~6 Mt Th): https://www-pub.iaea.org/MTCD/publications/PDF/TE-1877web.pdf ;
  Steenkampskraal (665 kt @ 2.14 % Th, ~14 kt Th):
  https://www.miningweekly.com/article/smm-breaks-ground-on-western-cape-monazite-plant-2026-04-22 ;
  USGS Circular 1336, US thorium deposits: https://pubs.usgs.gov/circ/1336/pdf/C1336.pdf
