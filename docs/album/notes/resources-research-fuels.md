# Fuel reference numbers for the Passionaris resource map (metric)

Researched 2026-11-11. Conversions used:
- 1 bbl = 158.987 l = 0.158987 m³, so 1 Gbbl = 1.59e8 m³ = 1.59e11 l.
- 1 Tcf = 2.83168e10 m³, 1 Bcf = 2.83168e7 m³, 1 MMscf = 2.83168e4 m³.
- 1 short ton = 0.907185 t; 1 mi² = 2.59 km²; 1 Mt crude ≈ 1.16e6 m³ ≈ 7.3 MMbbl (density 0.86 t/m³).

**"Per 100 km²" is exactly one game chunk (10 × 10 km).** Notation: "1.1e9 m³" means 1.1 × 10⁹ m³; for oil, litres = m³ × 1000.

The tags below say what each number is:
- **URR**: cumulative production plus remaining reserves.
- **rem**: remaining only.
- **in place**: geological volume, not all recoverable.
- **est**: my own arithmetic from the cited inputs.

---

## 1. Oil (incl. extra-heavy oil, bitumen, oil shale)

| place | lat,lon | recoverable amount (metric) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| **Greater Burgan**, Kuwait (**richest conventional field per area**) | 29.11, 47.97 | URR ≈ 70 Gbbl (estimates 66–75) = **1.11e10 m³ = 1.11e13 l**. Produced ~28 Gbbl by 1996. Kuwaiti data are opaque. | ~1,000: Burgan 500, Magwa 180, Ahmadi 140, plus edges | **1.1e9 m³ (1.1e12 l ≈ 7 Gbbl)** | [Wikipedia: Burgan field](https://en.wikipedia.org/wiki/Burgan_field), citing Sorkhabi, *GeoExPro* 2012 (URR) and Carman 1996 / Ma et al. 2009 (areas) |
| Safaniya, Saudi Arabia (offshore) | 28.28, 48.75 | URR ≈ 55 Gbbl **est** = 8.7e9 m³. Inputs: 33.7 Gbbl proved liquids at end-2018 (Aramco 2019 prospectus), plus ~20 Gbbl produced 1957–2018 at ~1 Mb/d (my estimate). | ~750 (50 × 15 km; another passage gives 65 × 15 km) | 0.9–1.2e9 m³ (5.6–7.3 Gbbl) | [gem.wiki: Safaniya](https://gem.wiki/Safaniya_Oil_and_Gas_Field_(Saudi_Arabia)) (prospectus table); [Wikipedia: Safaniya](https://en.wikipedia.org/wiki/Safaniya_Oil_Field) |
| **Ghawar**, Saudi Arabia (**largest conventional field by total**) | 25.43, 49.62 | URR ≈ 125 Gbbl (range 100–140) = **1.99e10 m³ = 1.99e13 l**. Inputs: >65 Gbbl produced by 2010 (Aramco VP); ~12 Gbbl in 2010–18 (**est**); 48.25 Gbbl liquids remaining at end-2018 (prospectus). | ~8,400 (280 × 30 km) | 2.4e8 m³ (≈1.5 Gbbl) | [Wikipedia: Ghawar](https://en.wikipedia.org/wiki/Ghawar_Field); Aramco bond prospectus 1 Apr 2019, via [WorldOil](https://www.worldoil.com/news/2019/4/2/saudi-aramco-reveals-sharp-output-drop-at-its-major-fields) |
| Orinoco Oil Belt, Venezuela (extra-heavy oil) | ~8.5, −64.5 (belt ~600 km E–W) | Technically recoverable, mean 513 Gbbl (380–652) = **8.2e10 m³**. In place >1,000 Gbbl (>1.6e11 m³). No economic estimate exists. | ~50,000 | Recoverable 1.6e8 m³ (1.0 Gbbl); in place ≥3.2e8 m³ | [USGS FS 2009-3028](https://pubs.usgs.gov/fs/2009/3028) (Schenk et al.) |
| Alberta oil sands, Canada (Athabasca + Cold Lake + Peace River; bitumen) | Athabasca ~57.0, −111.5 | Initial established reserves 2.81e10 m³ (177 Gbbl, 2015). Ultimate potential 5.0e10 m³ (315 Gbbl). In place 2.93e11 m³ (1.84 Tbbl). | 142,200 in total; Athabasca alone >93,000 | Initial established 2.0e7 m³ (0.12 Gbbl); in place 2.1e8 m³ | AER [ST98-2016 executive summary](https://static.aer.ca/prd/documents/sts/ST98/ST98-2016_Executive_Summary.pdf) and [ST98-2017 executive summary](https://static.aer.ca/prd/documents/sts/ST98/ST98-2017_Executive_Summary.pdf); [Alberta oil sands facts](https://www.alberta.ca/oil-sands-facts-and-statistics.aspx) |
| Athabasca surface-mineable zone only | ~57.0, −111.5 | ≈34 Gbbl **rem** = 5.4e9 m³. Derived from the AER 2025 proved + probable assessment: 187 Gbbl total minus 153 Gbbl in situ. Past mining output is not included. | ~4,800 | ≥1.1e8 m³ (≥0.7 Gbbl) | AER reserves assessment (2025 data), via search; alberta.ca |
| Green River oil shale (CO/UT/WY), USA | Piceance ~39.9, −108.2 | Recoverable ~800 Gbbl (RAND central case; range 500–1,100) = **1.27e11 m³**. In place 4.285 Tbbl = 6.8e11 m³. | ~41,400 (16,000 mi²) | Recoverable 3.1e8 m³ (1.9 Gbbl); in place 1.6e9 m³ | [USGS FS 2012-3145](https://pubs.usgs.gov/fs/2012/3145); [RAND MG-414 (2005)](https://www.rand.org/content/dam/rand/pubs/monographs/2005/RAND_MG414.sum.pdf); [DOI testimony (area)](https://www.doi.gov/ocl/oil-shale) |
| Piceance Basin core of the Green River shale | 39.9, −108.2 | **in place** 1.53 Tbbl = 2.4e11 m³. Not recoverable economically. | ~3,460 (1,335 mi² underlain by oil shale) | **7.0e9 m³ in place (44 Gbbl)**. This is the densest accumulation in the table, but it is rock, not a reservoir. | [USGS oil shale pages](https://www.usgs.gov/centers/central-energy-resources-science-center/science/oil-shale) |

**Verdict.** By recoverable oil per area, Burgan (~1.1e9 m³ per chunk) and Safaniya are the richest; Ghawar is about 5× thinner. Ghawar is the largest conventional field by total; Orinoco and Alberta are larger still but spread thinly. Oil shale holds the most in place per area but contributes almost no recoverable oil.

## 2. Natural gas

| place | lat,lon | recoverable amount (m³) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| **South Pars / North Dome**, Iran/Qatar (**largest and densest**) | 26.62, 52.07 | Recoverable ≈ **3.6e13 m³** (36 tcm; about 70 % of the 51 tcm in place, IEA). Split: Qatar 26 tcm, Iran 10 tcm. | 9,700 (North Dome 6,000 + South Pars 3,700) | **3.7e11 m³** | [Wikipedia: South Pars](https://en.wikipedia.org/wiki/South_Pars) (IEA figures) |
| Galkynysh, Turkmenistan | 37.30, 62.36 | Gaffney Cline 2011 audit: 1.31e13 / 1.64e13 / 2.12e13 m³ (low / best / high). These are resources, probably in place. "Proven commercial" reserves were 2.8e12 m³ (2008). | 2,700 (90 × 30 km, early figure) to >4,000 (later delineation) | Best estimate 4.1e11 (over 4,000 km²); 1.0e11 using 2.8 tcm | [VOA 2011](https://voanews.com/a/turkmenistan-gas-reserves-/6741609.html); [Wikipedia: Galkynysh](https://en.wikipedia.org/wiki/Galkynysh_Gas_Field) |
| Urengoy, Russia | 66.1, 76.9 | Initial C1+C2 reserves **1.09e13 m³**; 6.5e12 m³ produced by 2013 | ~6,000 (single secondary source) | 1.8e11 | [Gazprom: Urengoyskoye](https://www.gazprom.com/projects/urengoyskoye); [Wikipedia: Urengoy](https://en.wikipedia.org/wiki/Urengoy_gas_field) |
| Hugoton–Panhandle, USA (shallow, very extensive) | 37.18, −101.35 | EUR >75 Tcf = **2.1e12 m³** | ~21,000 (8,000–8,500 mi²) | 1.0e10 | Sorenson 2003, [AAPG Search and Discovery](https://www.searchanddiscovery.com/documents/2003/sorenson/) |

## 3. Coal (tonnes in situ unless stated; usually only 10–60 % is recoverable)

| place | lat,lon | amount (t) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| **Ekibastuz**, Kazakhstan (**richest per area**) | 51.8, 75.3 | ~1.3e10 t (13 Gt) in a single syncline; 1991 table: 13.24 Gt for the open-cut fields. The Bogatyr mine alone holds 2.6e9 t recoverable. | 64 (12 × 6 km) | **≈2.0e10 t (~200 Mt/km²)**. Combined seam thickness is ~170 m, outcropping at the rim. | [rudmet.com (TAKRAF)](https://rudmet.com/news/5445/); USGS Minerals Yearbook USSR 1991; [gem.wiki: Bogatyr](https://gem.wiki/Bogatyr_coal_mine) |
| Latrobe Valley brown coal (lignite), Australia | −38.2, 146.5 | ~6.5e10 t measured, about half "potentially economic". Victoria as a whole holds 4.3e11 t in situ. | ~800 (onshore Latrobe Valley Depression) | 8e9 t on average. Locally, 180–230 m of continuous coal × ~1.1 t/m³ (assumed) ≈ 2.0–2.5e10 t. | [Geoscience Australia: brown coal](https://ga.gov.au/scientific-topics/minerals/mineral-resources-and-advice/australian-resource-reviews/brown-coal); [bioregionalassessments.gov.au](https://bioregionalassessments.gov.au/node/11930); USGS/UNESCO ch. 9 (area) |
| Kuzbass, Russia | 55.35, 86.09 | Total resources ~7.25e11 t to 1,800 m depth (uncited figure on Wikipedia). "Reserves" 2.64e11 t (BGS 2005). | 26,700 | Resources 2.7e9 t; reserves ~1.0e9 t | [Wikipedia: Kuzbas](https://en.wikipedia.org/wiki/Kuzbas); [BGS / NORA](https://nora.nerc.ac.uk/id/eprint/11137/); [Britannica](https://www.britannica.com/print/article/325744) |
| Powder River Basin, USA (**largest by output**) | 44.3, −105.5 | Original 1.05e12 t (1.16 T short tons). Recoverable at a stripping ratio of 10:1 or less: 1.47e11 t. Economic reserves 2.27e10 t. | 50,500 (19,500 mi²) | In place 2.1e9 t; recoverable 2.9e8 t; reserves 4.5e7 t | USGS [PP 1809 (2015)](https://pubs.usgs.gov/pp/1809); [USGS technical announcement](https://www.usgs.gov/news/technical-announcement/usgs-powder-river-basin-coal-assessment-features-estimate-reserve-base) |

## 4. Peat (tonnes of dry peat)

| place | lat,lon | amount (dry t) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| **Irish midland raised bogs** (e.g. Raheenmore) (**richest common type**) | ~53.3, −7.4 | ~0.49 t/m² **est**: average depth ~7 m × dry bulk density ~0.07 t/m³. Cross-check: the EPA gives 3,037 t C/ha for natural raised bog; ÷ 0.52 C gives ~5,840 t dry/ha. | Single bogs 1–20 km²; Bord na Móna estate ~880 km² | **4.9–5.8e7 t** (50–80 Mt in the deepest 10–12 m bogs) | [askaboutireland (depth)](https://askaboutireland.ie/learning-zone/secondary-students/geography/physical-environment/exploitation-of-natural-r/the-exploitation-of-soil-/peatland-decline-in-irela); [Wellock et al. 2011 (density)](https://www.ucc.ie/en/media/research/hydromet/WellockPaper.2011.pdf); EPA carbon storage infographic |
| Vasyugan Mire, Russia (**largest single bog**) | ~57, 78 (approx.) | 1.87e10 t of peat. This is probably at the Russian standard 40 % moisture, which gives ~1.1e10 t dry (**est**). | 53,000–55,000 | 3.5e7 t as reported; ~2.1e7 t dry | [TSPU study](https://old.tspu.ru/files/Lidooss/museumtorfa/Vasyugan_Mire-Tekst.pdf); [UNESCO tentative list](https://whc.unesco.org/fr/listesindicatives/5114/) |
| West Siberian Lowland peatlands (**largest total**) | ~61, 75 (region, approx.) | Peat mass 1.48e11 t (carbon 7.02e10 t) | 592,440 | 2.5e7 t (≈250 kg/m²) | Sheng et al. 2004, *Global Biogeochemical Cycles* 18, GB3004 ([PDF](https://wordpress.clarku.edu/wp-content/uploads/sites/38/2011/01/Sheng_GBC2004.pdf)) |
| Finland, all geological peatland (>30 cm) | ~64, 26 (approx.) | 7.0e10 m³ of peat (2.4e10 m³ of it energy-grade) × ~0.09 t/m³ (assumed) ≈ 6.3e9 t dry. Mean depth ≈1.4 m. | ~51,000 | ~1.2e7 t | GTK: Valpola 2013 and International Peat Congress paper, via [peatlands.org](https://peatlands.org/document/the-peat-investigations-in-the-geological-survey-of-finland/) |

## 5. Helium (m³ of pure He)

| place | lat,lon | amount (m³ He) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| **Qatar North Field** (+ South Pars) (**largest total, and densest of the big fields**) | 26.6, 52.1 | Qatar He reserves 360 Bcf = **1.0e10 m³**. The gas holds only ~0.04 % He, but the volume is huge. Whole SP/ND: 36 tcm × 0.04 % ≈ 1.4e10 m³ (**est**). | 6,000 (Qatar part) / 9,700 (whole field) | **1.5–1.7e8 m³** | [NRC 2010, *Selling the Nation's Helium Reserve*, Table 4.1](https://www.nationalacademies.org/read/12844/chapter/7); [QatarEnergy LNG](https://www.qatarenergylng.qa/english/operations/ras-laffan-helium) |
| Hugoton–Panhandle, USA (**richest He-grade gas giant, 0.3–1.9 % He**) | 37.18, −101.35 | Original He ≈ 6.4–10.6e9 m³ (**est**: 75 Tcf × 0.3–0.5 %). Proven in 2007: 47 Bcf = 1.33e9 m³, of which 23.1 Bcf is stored at Bush Dome and 20.5 Bcf (5.8e8 m³) is native gas. | ~21,000 | ~4e7 m³ originally | NRC 2010, Table 4.2; Ward & Pierce 1973 (He %), via [Wikipedia: Hugoton](https://en.wikipedia.org/wiki/Hugoton_Gas_Field) |
| Kovykta, Russia | 55.38, 106.12 | 2.3e9 m³ He (C1+C2); ~0.28 % He | ~7,500 | 3.1e7 m³ | [neftegaz.ru: Kovykta](https://neftegaz.ru/tech-library/mestorozhdeniya/141592-kovyktinskoe-gazokondensatnoe-mestorozhdenie-kovykta/) |
| Chayanda, Russia | ~60.5, 111 (approx.) | 1.4e9 m³ He; up to 0.45 % He | n/a | n/a | [offshore-technology.com: Chayandinskoye](https://www.offshore-technology.com/projects/chayandinskoye-field-yakutia-russia/) |
| Riley Ridge / LaBarge, USA | ~42.3, −110.3 (approx.) | 49 Bcf = 1.4e9 m³; 0.6 % He | n/a | n/a | NRC 2010 |
| Orenburg, Russia | 51.65, 54.80 | ≈1.0–1.1e9 m³ He in the original gas (**est**: ~1.9–2.0 tcm × 0.053–0.055 % He) | not found | n/a | [core.ac.uk Russian study (He %)](https://core.ac.uk/download/479524409.pdf); [Wikipedia: Orenburg](https://en.wikipedia.org/wiki/Orenburg_gas_field) |
| Rukwa, Tanzania (5–9 % He, very high grade, but little proven) | ~−8.0, 32.4 (approx.) | Southern Rukwa 2C contingent: 295.8 MMscf = **8.4e6 m³** (3C: 3.8e7 m³). Project-wide unrisked prospective resource: 138 Bcf = 3.9e9 m³ (risked 4.0e8 m³). Prospective is not a discovery. | 480 (S. Rukwa licence); 3,590 (whole project) | 2C: 1.7e6 m³; unrisked prospective: 1.1e8 m³ | [Helium One CPR RNS, 25 Jun 2025](https://www.accessnewswire.com/newsroom/en/industrial-and-manufacturing/helium-one-global-ltd-announces-independent-cpr-1042844); [SRK 2020, via TanzaniaInvest](https://tanzaniainvest.com/helium) |

Country context from NRC 2010:
- Russia: reserves 60 Bcf (1.7e9 m³), reserve base 250 Bcf (7.1e9 m³).
- Algeria: reserves 64 Bcf (1.8e9 m³), reserve base 300 Bcf (8.5e9 m³).

## 6. Iberian and south-French calibration points

| place | lat,lon | amount (metric) | area km² | per 100 km² | sources |
|---|---|---|---|---|---|
| Lacq gas, France (deep sour gas, 3.5–5 km) | 43.41, −0.63 | Cumulative **2.547e11 m³** to end-2019, about 97 % of reserves. Initial estimate: 8.8 Tcf = 2.5e11 m³. | ~160 (16 × 10 km) | **1.6e11 m³**, close to Urengoy density. The whole field covers about 1.6 chunks. | [Pyrénées-Atlantiques CLS 2019 report](https://www.pyrenees-atlantiques.gouv.fr/contenu/telechargement/36370/232861/file/CLS-Activité%202019.pdf); [Wikipedia: Lacq](https://en.wikipedia.org/wiki/Lacq_gas_field) (Winnock & Pontalier, AAPG Memoir 14) |
| Ayoluengo oil, Burgos | 42.747, −3.885 | Cumulative ≈17 MMbbl (1967–2017) = **2.7e6 m³ = 2.7e9 l**. OOIP ~104 MMbbl (1.65e7 m³). | ~10 | The whole field fits inside one chunk: **2.7e6 m³ per chunk** (density over 100 km² would read 2.7e7) | [AAPG Explorer](https://www.aapg.org/news-and-media/details/explorer/articleid/26767/spains-oldest-and-only-onshore-oilfield); [Wikipedia: Ayoluengo](https://en.wikipedia.org/wiki/Ayoluengo_oil_field) |
| Casablanca oil, offshore Tarragona | ~40.7, 1.35 (approx.) | Recoverable ~140 MMbbl (1997) = **2.2e7 m³**. The platform processed >161 MMbbl (2.6e7 m³) to 2013, satellites included (Chipirón ~6 MMbbl; others 4–5 MMbbl each). | not found (small buried karst high) | ~2.2–2.6e7 m³ in about one chunk | [AAPG Search and Discovery 1997 abstract](https://www.searchanddiscovery.com/abstracts/html/1997/intl/abstracts/1421c.htm); [Offshore magazine 2013](https://www.offshore-mag.com/subsea/article/16761407/deepwater-fields-extend-life-of-mediterranean-casablanca-production-complex) |
| Gaviota gas, off Bermeo | ~43.45, −2.75 (approx.) | Original reserves not found. It produced 1986–1994/95 with a design peak of 5e6 m³/d, so output was at most ≤1.5e10 m³ (**est**). The storage now built in it holds 2.68e9 m³ in total (0.98e9 working gas). | 64 | Likely a few e9 m³ in one chunk | [energyanalysis substack](https://energyanalysis.substack.com/p/la-gaviota-almacemaniento-subterraneo); [Enagás storage](https://www.enagas.es/en/energy-transition/gas-network/gas-infrastructure/underground-storage-facilities/) |
| Asturias Central Coal Basin (hard coal) | ~43.25, −5.75 (approx.) | Basin totals not found in open sources. HUNOSA mined 2.08e6 t in 1996 (29 % of Spain's hard coal). Asturias supplied 50–70 % of Spain's hard coal for two centuries. The coal series is up to ~6,000 m thick, with many thin seams. | n/a | n/a. A moderate guess is "medium coal" (see section 7). | [IGME Panorama Minero 1996](https://wwww.igme.es/PanoramaMinero/Historico/1996/CARBON96.pdf); Univ. Oviedo papers |
| As Pontes lignite, Galicia | 43.45, −7.85 | >2.6e8 t mined 1976–2007 | Pit ≈ 8.65 km² (now a lake), >300 m deep | ~3e9 t (30 Mt/km²) on the pit footprint | [Wikipedia: Lake As Pontes](https://en.wikipedia.org/wiki/Lake_As_Pontes); [Endesa](https://www.endesa.com/en/the-e-face/ecological-transition/as-pontes-coal-mine-environmental-rehabilitation) |
| Teruel lignite (Andorra–Ariño–Utrillas) | ~40.98, −0.45 | 3.53e8 t mined 1972–2015 at four sites. The two main seams of Val de Ariño held >1e8 t. | not found | n/a | [La Comarca](https://www.lacomarca.net/central-quema-ultimo-gramo-carbon-mineria-pasa-formar-parte-pasado-turolense/); [Museo Minero Andorra, via dialnet](https://dialnet.unirioja.es/descarga/articulo/4602065.pdf) |

## 7. Size classes

**Official, oil and gas.** Russian classification (Order of the Ministry of Natural Resources No. 477, 2013, §25), by *initial recoverable* reserves ([rulaws.ru](https://rulaws.ru/acts/Prikaz-Minprirody-Rossii-ot-01.11.2013-N-477/)):

| class | oil | oil in m³ (≈) | gas |
|---|---|---|---|
| very small | <1 Mt | <1.2e6 m³ (<1.2e9 l) | <1e9 m³ |
| small | 1–5 Mt | 1.2–5.8e6 m³ | 1–5e9 m³ |
| medium | 5–30 Mt | 5.8e6–3.5e7 m³ | 5–30e9 m³ |
| large | 30–300 Mt | 3.5e7–3.5e8 m³ | 3e10–3e11 m³ |
| unique | >300 Mt | >3.5e8 m³ (>2.2 Gbbl) | >3e11 m³ |

**Western usage, oil and gas** (Halbouty / AAPG; Ivanhoe & Leckie, [OGJ 1993](https://www.ogj.com/home/article/17223313/global-oil-gas-fieldssizes-tallied-analyzed)):
- Giant oil field: ≥500 MMbbl recoverable = **≥7.9e7 m³ (7.9e10 l)**.
- Giant gas field: ≥3 Tcf = **≥8.5e10 m³**.
- "Major" field: ≥100 MMbbl = 1.6e7 m³.
- "Tiny" field: <1 MMbbl = 1.6e5 m³.
- "Supergiant" (≥5 Gbbl = 8e8 m³) is common usage, not a formal class.
- Counts in 1989: 370 giants out of 41,164 oil fields, holding 74 % of world oil EUR.
- Median field size: about 3 MMbbl (4.8e5 m³) outside the USA; 370 MMbbl (5.9e7 m³) in the Persian Gulf.

**Proposed defaults when a field has no size info** (my proposal; the coal, peat and helium classes have no official scale):
- **Oil**: Russian "medium", default 10 Mt ≈ **1.2e7 m³ (1.2e10 l)**. Small 3e6 m³; large 1e8 m³; giant ≥8e7 m³.
- **Gas**: "medium", default **1e10 m³**. Small 3e9; large 1e11; giant ≥8.5e10.
- **Coal deposit**:
  - small <1e8 t (e.g. Val de Ariño seams);
  - medium 1e8–1e9 t (As Pontes, Teruel) — **default 3e8 t**;
  - large 1e9–1e10 t;
  - giant >1e10 t (Ekibastuz).
- **Peat bog** (dry):
  - small <1e6 t (a 2 km² bog 2 m deep ≈ 4e5 t);
  - medium 1e6–1e7 t — **default 2e6 t**;
  - large 1e7–1e8 t;
  - giant >1e9 t (Vasyugan).
- **Helium**:
  - small <1e7 m³ (Southern Rukwa 2C);
  - medium 1e7–1e8 m³ — **default 3e7 m³**;
  - large 1e8–1e9 m³;
  - giant >1e9 m³ (Kovykta, Chayanda, Riley Ridge, Hugoton; Qatar at 1e10).

**Per-chunk ceilings** (the 100 km² numbers above, moderate values):

| resource | world maximum per chunk | typical big-basin average per chunk | thin edge |
|---|---|---|---|
| Oil | ~1e9 m³ (Burgan) | ~2e8 (Ghawar, Orinoco) | ~2e7 (Alberta average) |
| Gas | ~4e11 m³ (South Pars) | ~2e11 (Urengoy, Lacq) | ~1e10 (Hugoton) |
| Coal | ~2e10 t (Ekibastuz, Latrobe core) | ~2–3e9 t (Kuzbass, PRB in place) | ~3e8 (PRB recoverable) |
| Peat (dry) | ~5–6e7 t (Irish raised bog) | ~2.5e7 (West Siberia) | ~1e7 (Finland) |
| Helium | ~1.7e8 m³ (Qatar) | ~3–4e7 (Hugoton, Kovykta) | ~2e6 (Rukwa 2C) |

## 8. Caveats

- **Small fields are smaller than a chunk.** Ayoluengo (10 km²) or Casablanca should put their *whole* volume into one chunk. Do not scale their density up to 100 km².
- **"Area" means different things** in different sources: structural closure (Ghawar, Burgan), licence (Rukwa), depression (Latrobe) or basin (PRB, Kuzbass, Alberta). The per-chunk numbers are averages over those areas; field cores can be 2–5× richer.
- **Basis differs by row**: URR, remaining, in place or recoverable, as tagged. Saudi and Kuwaiti field data are not independently audited. Ghawar and Safaniya URR are partly my arithmetic. Galkynysh's 16.4 tcm may be gas in place.
- **Peat**: Russian peat tonnages are normally given at 40 % conditional moisture, so I converted them to dry. Dry bulk density (0.07–0.10 t/m³) and the Finnish 0.09 t/m³ are assumptions.
- **Coal**: tonnages are in situ. Brown coal (~60 % water) has about a third of the energy of black coal per tonne, so tonnes of lignite and of hard coal are not equivalent.
- **Helium**:
  - Qatar's huge total comes from very lean gas (0.04 %). Gas is usually called "helium-rich" from 0.3 % He (USGS).
  - The Tanzanian figures are mostly prospective.
  - The USGS Mineral Commodity Summaries 2025/2026 helium chapter returned HTTP 403, so the country reserves are NRC 2010 figures.
- **Not found**: area/reserves of the Asturian Central Basin, original Gaviota reserves, Casablanca area and Orenburg area.
- **Prompt injection**: one search-result mirror (cavac.at) contained text addressed to the AI (asking it to change topic). It was ignored, and no data were taken from it.
