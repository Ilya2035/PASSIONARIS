// Passionaris — natural resources: real reference numbers, metric (docs/RESOURCES.md, «Решения владельца»).
// Every stock is a real amount in the resource's unit (lib.mjs RESOURCES[].unit): tonnes of the metal itself, kg,
// litres, m³. Sources of every number: data/sources/resources.md, section «Эталоны».
//
// BONUS   the owner's rule: a plausible middle estimate, then 15 % on top.
// SIZE    a deposit of a class, by resource: [trace, small, medium, large, giant] in the unit. Class 2 «medium» is
//         also the default for a producing mine that a database lists without its size.
// REF100  the richest 10 × 10 km chunk of the world (its total ÷ its area in whole chunks): this amount is 100 on the
//         map's 0–100 scale; everything else is a share of it.
// DENSITY area resources: how much 100 km² hold where the ground suits them fully.

export const BONUS = 1.15;
export const CLASSES = ['проявление', 'малое', 'среднее', 'крупное', 'гигантское'];

const M = 1e6, G = 1e9, T = 1e12, BBL = 158.987; // barrel → litres, only to convert sources
export const SIZE = {
  // living stocks and water (t; timber and water m³): a fishing ground, a hunting ground, a wood, a spring … a sea
  fish: [10, 1e3, 10e3, 100e3, 1 * M],
  seamammals: [1, 100, 1e3, 10e3, 100e3],
  game: [1, 50, 500, 5e3, 50e3],
  wood: [1e3, 100e3, 1 * M, 10 * M, 100 * M],
  water: [1e4, 1e6, 1e7, 1e8, 1 * G],
  // metals: tonnes of metal (precious: kg). Classes after Laznicka's accumulation scale (small/medium/large/giant =
  // 100/1000/10 000/100 000 × the metal's crustal abundance in ppm) and Singer's world-class deposits; class 2 is the
  // research note's default producer
  copper: [1e3, 10e3, 100e3, 1 * M, 5 * M],
  tin: [100, 1e3, 5e3, 50e3, 300e3],
  lead: [500, 5e3, 50e3, 500e3, 3 * M],
  zinc: [2e3, 20e3, 150e3, 1.5 * M, 10 * M],
  mercury: [5, 30, 100, 1e3, 10e3],
  iron: [1 * M, 10 * M, 50 * M, 500 * M, 5 * G],
  gold: [100, 1e3, 10e3, 100e3, 500e3],               // kg; Singer world-class ≥ 100 t
  silver: [3e3, 30e3, 300e3, 3 * M, 20 * M],          // kg
  platinum: [500, 5e3, 40e3, 400e3, 3 * M],           // kg
  manganese: [20e3, 200e3, 2 * M, 20 * M, 200 * M],
  chromium: [5e3, 50e3, 200e3, 3 * M, 30 * M],
  nickel: [2e3, 20e3, 150e3, 1.5 * M, 10 * M],
  cobalt: [500, 5e3, 20e3, 300e3, 2 * M],
  tungsten: [50, 500, 5e3, 30e3, 200e3],
  molybdenum: [100, 2e3, 30e3, 300e3, 1 * M],
  aluminium: [500e3, 2 * M, 20 * M, 50 * M, 100 * M], // t of aluminium in bauxite (no Al deposit is giant)
  titanium: [100e3, 500e3, 2 * M, 10 * M, 30 * M],
  magnesium: [500e3, 3 * M, 10 * M, 100 * M, 500 * M],
  lithium: [1e3, 10e3, 100e3, 1 * M, 3 * M],
  ree: [5e3, 50e3, 200e3, 2 * M, 20 * M],             // t of rare-earth oxides
  raremetals: [100, 1e3, 10e3, 100e3, 1 * M],          // Nb, Ta, Be, Ga, Ge, In together
  uranium: [100, 1e3, 10e3, 50e3, 200e3],
  thorium: [300, 3e3, 10e3, 100e3, 1 * M],
  // minerals and stone: tonnes (gems and ornamental stones: kg). Class boundaries and the default producer (class 2)
  // after the research note: USGS deposit models where they exist (phosphate, diamonds), USGS Mineral Commodity
  // Summaries (a mean operation × 15–30 years) for the rest
  salt: [100e3, 500e3, 20 * M, 300 * M, 3 * G],       // rock salt; Khewra ≈ 300 Mt, Upper Kama 4.65 Tt in place
  potash: [1 * M, 5 * M, 50 * M, 300 * M, 3 * G],     // t K2O; one modern mine ≈ 2 Mt K2O/yr × 25 yr
  phosphate: [1 * M, 10 * M, 300 * M, 1.5 * G, 10 * G], // t of phosphate rock; USGS median deposit ≈ 330 Mt
  nitrate: [50e3, 200e3, 1 * M, 20 * M, 70 * M],     // t NaNO3; a 1900s oficina ≈ 30 kt/yr × 30 yr
  sulfur: [10e3, 100e3, 10 * M, 50 * M, 250 * M],     // t S; Mishraq ≈ 250 Mt
  borates: [100e3, 2 * M, 20 * M, 200 * M, 2 * G],    // t of borate or trona ore
  fluorite: [10e3, 100e3, 500e3, 5 * M, 30 * M],      // t CaF2
  graphite: [1e3, 50e3, 500e3, 5 * M, 30 * M],        // t of graphite
  kaolin: [100e3, 500e3, 5 * M, 50 * M, 200 * M],     // t marketable; St Austell ≈ 200–250 Mt
  gypsum: [100e3, 500e3, 10 * M, 50 * M, 500 * M],    // t crude gypsum
  marble: [1e3, 30e3, 300e3, 3 * M, 30 * M],          // t of blocks; a quarry ≈ 11 kt/yr × 30 yr
  flint: [100, 500, 1e3, 10e3, 100e3],                // t of knappable stone; Grime's Graves 16–18 kt
  limestone: [1 * M, 3 * M, 10 * M, 100 * M, 300 * M], // per quarry; cement-plant reserves ≈ 50–200 Mt
  quartz: [100e3, 500e3, 5 * M, 50 * M, 200 * M],     // t industrial sand
  sand: [50e3, 500e3, 2 * M, 20 * M, 100 * M],        // per pit
  stone: [100e3, 1 * M, 10 * M, 50 * M, 200 * M],     // crushed and rough stone per quarry
  clay: [10e3, 100e3, 1 * M, 10 * M, 50 * M],         // brick pit ≈ 50 kt/yr × 20 yr
  gems: [5, 50, 500, 5e3, 50e3],                       // kg; USGS median kimberlite ≈ 6.5 Mct = 1300 kg
  ornamental: [1e3, 10e3, 100e3, 1 * M, 10 * M],      // kg; amber, jade: a mine ≈ 100 t
  // fuels: peat and coal tonnes, oil litres, gas and helium m³
  // fuels: classes after the Russian classification of 2013 (oil and gas, by initial recoverable reserves) and the
  // research note (coal, peat, helium): data/sources/resources.md, «Эталоны»
  peat: [100e3, 500e3, 2 * M, 30 * M, 1 * G],         // dry t; a 2 km² bog 2 m deep ≈ 0.4 Mt
  coal: [1 * M, 30 * M, 300 * M, 3 * G, 20 * G],      // t; As Pontes ≈ 0.3 Gt, Ekibastuz ≈ 13 Gt
  oil: [3e8, 3e9, 12e9, 1e11, 8e11],                  // l; small 1–5 Mt, medium 5–30 Mt (≈ 1.2e10 l), giant ≥ 500 Mbbl
  gas: [3e8, 3e9, 10e9, 100e9, 500e9],                // m³; small 1–5, medium 5–30, large 30–300 billion m³
  helium: [1e6, 5e6, 30e6, 300e6, 3 * G],             // m³ of pure helium
};

// the richest chunk of the world = 100 (amount per 100 km², before BONUS); place and how it was counted
export const REF100 = {
  oil: { amount: 1.1e12, place: 'Большой Бурган (Кувейт): ≈ 70 млрд баррелей = 1,1·10¹³ л на ≈ 1000 км²' },
  gas: { amount: 3.7e11, place: 'Южный Парс / Северное (Иран, Катар): ≈ 3,6·10¹³ м³ на 9700 км²' },
  coal: { amount: 2e10, place: 'Экибастуз (Казахстан): ≈ 13 млрд т на 64 км², одна чаша' },
  peat: { amount: 5.5e7, place: 'верховые болота центральной Ирландии: торф ≈ 7 м, сухой ≈ 0,5 т/м²' },
  helium: { amount: 1.6e8, place: 'Северное месторождение (Катар): ≈ 10¹⁰ м³ гелия на 6000 км²' },
  copper: { amount: 9.4e7, place: 'Эль-Теньенте (Чили): ≥ 94 млн т меди на ≈ 5 км²' },
  lead: { amount: 2.8e7, place: 'Брокен-Хилл (Австралия): ≈ 28 млн т свинца' },
  zinc: { amount: 2.5e7, place: 'Ред-Дог (Аляска): ≈ 25 млн т цинка' },
  tin: { amount: 1e6, place: 'Сан-Рафаэль (Перу), богатейшая оловянная жила: ≈ 1 млн т' },
  mercury: { amount: 2.6e5, place: 'Альмаден (Испания): ≈ 260 тыс. т — треть всей ртути, добытой людьми' },
  iron: { amount: 2.2e9, place: 'Каражас S11D (Бразилия): ≈ 2,2 млрд т железа на ≈ 20 км²' },
  gold: { amount: 4.8e6, place: 'Мурунтау (Узбекистан): ≈ 4800 т в одном карьере' },
  silver: { amount: 1.15e8, place: 'Серро-Рико, Потоси (Боливия): ≈ 115 тыс. т' },
  platinum: { amount: 8.3e6, place: 'Норильск — Талнах (Россия): ≈ 8300 т платиноидов' },
  manganese: { amount: 3.6e8, place: 'Калахари (ЮАР): ≈ 4 млрд т марганца на 1100 км²' },
  chromium: { amount: 1e8, place: 'Кемпирсай (Казахстан): ≈ 100 млн т хрома' },
  nickel: { amount: 1.5e7, place: 'Норильск — Талнах (Россия): ≈ 15 млн т никеля' },
  cobalt: { amount: 2e6, place: 'Кисанфу (ДР Конго): ≈ 2 млн т кобальта' },
  tungsten: { amount: 6e5, place: 'Шичжуюань (Китай): ≈ 0,6 млн т вольфрама' },
  molybdenum: { amount: 2.2e6, place: 'Клаймакс (США): ≈ 2,2 млн т молибдена' },
  aluminium: { amount: 8e7, place: 'Сангареди (Гвинея): ≈ 80 млн т алюминия в бокситах на ≈ 10 км²' },
  titanium: { amount: 3.4e7, place: 'Теллнес (Норвегия): ≈ 34 млн т титана' },
  magnesium: { amount: 1e9, place: 'Хайчэн (Китай): ≈ 1 млрд т магния в магнезитах' },
  lithium: { amount: 3.1e6, place: 'Гринбушес (Австралия): ≈ 3,1 млн т лития' },
  ree: { amount: 4.3e7, place: 'Баян-Обо (Китай): ≈ 43 млн т оксидов на ≈ 48 км²' },
  raremetals: { amount: 8e6, place: 'Араша (Бразилия): ≈ 8 млн т ниобия' },
  uranium: { amount: 2.7e5, place: 'Макартур-Ривер (Канада): ≈ 270 тыс. т урана' },
  thorium: { amount: 1.2e6, place: 'Араша (Бразилия): ≈ 1,2 млн т тория' },
  salt: { amount: 1e10, place: 'Верхнекамское (Россия): 570 млн т/км² в недрах, из них взято ≈ 20 % — извлекаемое' },
  potash: { amount: 3.7e8, place: 'Верхнекамское (Россия): ≈ 30 млрд т K2O на 8100 км²' },
  phosphate: { amount: 6e8, place: 'Улад-Абдун (Марокко): 26,8 млрд т на 4500 км²' },
  nitrate: { amount: 1e7, place: 'Нуэва-Виктория (Чили): ≈ 70 млн т NaNO3 на 700 км²' },
  sulfur: { amount: 2.5e8, place: 'Мишрак (Ирак): ≈ 250 млн т серы в одном рудном теле' },
  borates: { amount: 3.3e9, place: 'Грин-Ривер (США): ≈ 33 млн т троны на км²' },
  fluorite: { amount: 4.9e7, place: 'Вергеноэг (ЮАР): ≈ 49 млн т CaF2 в одной трубке' },
  graphite: { amount: 1.24e8, place: 'Балама (Мозамбик): ≈ 124 млн т графита' },
  kaolin: { amount: 3.5e8, place: 'Сент-Остелл (Англия): ≈ 3–4 млн т/км²' },
  gypsum: { amount: 1.3e9, place: 'озеро Макдоннелл (Австралия): ≈ 13 млн т/км²' },
  marble: { amount: 1e8, place: 'Каррара (Италия): ≈ 80–100 карьеров, блоки' },
  flint: { amount: 1e6, place: 'Большой обсидиановый поток (Орегон): 0,3–3 млн т орудийного стекла на 2,6 км²' },
  gems: { amount: 2e5, place: 'Аргайл (Австралия): 173 т алмазов из одной трубки; Кагем (Замбия): ≈ 218 т изумруда' },
  ornamental: { amount: 1e8, place: 'Хпакан (Мьянма), жадеит: ≥ 1 млн т за десятилетия на 140 км²; янтарь Приморского ≈ 53 тыс. т' },
};

// Known deposits with a real amount from the literature (before BONUS). The databases give these only a rough size
// class; this amount replaces it for every record of the resource within 60 km whose name matches. A place that no
// database lists is added at lat/lon. area (km²): the deposit spreads over that many chunks for the 0–100 scale.
export const KNOWN = [
  // fuels of the album's region
  { res: 'gas', label: 'Лак', area: 160, name: /lacq/i, lat: 43.41, lon: -0.63, amount: 2.55e11, src: 'добыто 2,547·10¹¹ м³ к 2019 г. ≈ 97 % запаса (отчёт CLS Pyrénées-Atlantiques 2019)' },
  { res: 'oil', label: 'Айолуэнго', area: 10, name: /ayoluengo/i, lat: 42.747, lon: -3.885, amount: 2.7e9, src: '≈ 17 млн баррелей добыто 1967–2017 (AAPG Explorer)' },
  { res: 'oil', label: 'Касабланка', area: 20, name: /casablanca/i, lat: 40.72, lon: 1.36, amount: 2.2e10, src: 'извлекаемые ≈ 140 млн баррелей (AAPG 1997)' },
  { res: 'gas', label: 'Гавиота', area: 64, name: /gaviota/i, lat: 43.45, lon: -2.75, amount: 5e9, src: 'добыча 1986–1995, пик 5 млн м³/сут; оценка ≤ 1,5·10¹⁰ м³, взято 5·10⁹' },
  { res: 'coal', label: 'Ас-Понтес', area: 9, name: /pontes|puentes/i, lat: 43.45, lon: -7.85, amount: 3e8, src: '> 2,6·10⁸ т бурого угля добыто 1976–2007' },
  { res: 'coal', label: 'Теруэльский бурый уголь', area: 100, name: /andorra|ari(n|ñ)o|utrillas|teruel/i, lat: 40.98, lon: -0.45, amount: 3.5e8, src: '3,53·10⁸ т добыто 1972–2015' },
  // metals of the album's region
  { res: 'mercury', label: 'Альмаден', name: /alma(n)?den/i, lat: 38.78, lon: -4.84, area: 100, amount: 2.6e5, src: '7,5 млн фляг × 34,5 кг ≈ 260 тыс. т (Laznicka: 280 тыс. т)' },
  // the giants of the world (for the world table and the 100 of each resource)
  { res: 'copper', label: 'Эль-Теньенте', name: /teniente/i, lat: -34.09, lon: -70.35, area: 100, amount: 9.4e7, src: '≥ 94 млн т меди (добыто и в запасах)' },
  { res: 'lead', label: 'Брокен-Хилл', name: /broken hill/i, lat: -31.96, lon: 141.46, area: 100, amount: 2.8e7, src: '≈ 280 млн т руды при 10 % свинца' },
  { res: 'zinc', label: 'Ред-Дог', name: /red dog/i, lat: 68.07, lon: -162.86, area: 100, amount: 2.5e7, src: 'рудное поле 31 млн т при 16,6 % (Laznicka)' },
  { res: 'gold', label: 'Мурунтау', name: /muruntau/i, lat: 41.52, lon: 64.58, area: 100, amount: 4.8e6, src: '≈ 1 млрд т руды при 3,5–4 г/т' },
  { res: 'silver', label: 'Серро-Рико', name: /potos|cerro rico/i, lat: -19.62, lon: -65.75, area: 100, amount: 1.15e8, src: 'добыто и в запасах 115 тыс. т (Laznicka)' },
  { res: 'iron', label: 'Каражас', name: /caraj/i, lat: -6.40, lon: -50.35, area: 100, amount: 2.2e9, src: '3,4 млрд т руды при 65 % (Vale, 2024)' },
  { res: 'nickel', label: 'Норильск — Талнах, никель', name: /noril|talnakh|oktyabr/i, lat: 69.5, lon: 88.3, area: 100, amount: 1.5e7, src: 'Норникель, 2024' },
  { res: 'platinum', label: 'Норильск — Талнах, платиноиды', name: /noril|talnakh|oktyabr/i, lat: 69.5, lon: 88.3, area: 100, amount: 8.3e6, src: 'Норникель, 2024' },
  { res: 'manganese', label: 'Калахари', name: /kalahari|hotazel|mamatwan|wessels/i, lat: -27.2, lon: 22.95, area: 1100, amount: 4e9, src: '≈ 13 млрд т руды при 31 % (Laznicka)' },
  { res: 'aluminium', label: 'Сангареди', name: /sangar/i, lat: 11.1, lon: -13.8, area: 100, amount: 8e7, src: '> 300 млн т бокситов при ≈ 51 % Al2O3' },
  { res: 'lithium', label: 'Гринбушес', name: /greenbushes/i, lat: -33.86, lon: 116.06, area: 100, amount: 3.1e6, src: '440 млн т при 1,5 % Li2O (IGO 2024)' },
  { res: 'ree', label: 'Баян-Обо', name: /bayan obo|baiyun/i, lat: 41.8, lon: 109.97, area: 100, amount: 4.3e7, src: '43,5 млн т оксидов (промышленный запас)' },
  { res: 'uranium', label: 'Макартур-Ривер', name: /mcarthur river/i, lat: 57.76, lon: -105.05, area: 100, amount: 2.7e5, src: 'Cameco, 2025' },
  { res: 'oil', label: 'Большой Бурган', area: 1000, name: /burgan/i, lat: 29.11, lon: 47.97, amount: 1.11e13, src: 'URR ≈ 70 млрд баррелей (Sorkhabi 2012)' },
  { res: 'oil', label: 'Гавар', area: 8400, name: /ghawar/i, lat: 25.43, lon: 49.62, amount: 1.99e13, src: 'URR ≈ 125 млрд баррелей (проспект Aramco 2019)' },
  { res: 'oil', label: 'Сафания', area: 750, name: /safaniya/i, lat: 28.28, lon: 48.75, amount: 8.7e12, src: 'URR ≈ 55 млрд баррелей (оценка)' },
  { res: 'gas', label: 'Южный Парс / Северное', area: 9700, name: /south pars|north (dome|field)/i, lat: 26.62, lon: 52.07, amount: 3.6e13, src: 'извлекаемые ≈ 36 трлн м³ (МЭА)' },
  { res: 'gas', label: 'Уренгой', area: 6000, name: /urengoy|уренгой/i, lat: 66.1, lon: 76.9, amount: 1.09e13, src: 'начальные запасы C1+C2 (Газпром)' },
  { res: 'coal', label: 'Экибастуз', area: 64, name: /ekibastuz|bogatyr|экибастуз/i, lat: 51.8, lon: 75.3, amount: 1.3e10, src: '≈ 13 млрд т в одной чаше (TAKRAF, USGS 1991)' },
  { res: 'helium', label: 'Северное месторождение, гелий', area: 6000, name: /north field|ras laffan/i, lat: 26.6, lon: 52.1, amount: 1e10, src: '360 млрд фут³ гелия (NRC 2010)' },
];

// area resources: amount per 100 km² of fully suitable ground (before BONUS)
export const DENSITY = {
  // fish: t per 100 km² of sea in the unfished sea of 5000 BC — today's stock × 2–3 (research note): Bay of Biscay
  // today ≈ 1870, Gulf of Lion ≈ 940, unfished North Sea ≈ 2740, Peru anchoveta alone ≈ 5000, world ≈ 900
  fish: { rich: 10e3, shelf: 2.5e3, ocean: 200 },
  // marine mammals: t per 100 km² before whaling — Southern Ocean ≈ 110–140, world baleen whales ≈ 29, Biscay today ≈ 5
  seamammals: { rich: 130, shelf: 30, ocean: 15 },
  // game: t of wild large herbivores per 100 km² by natural zone (kg/km² ÷ 10), moderate values: taiga ≈ 62 kg/km²,
  // tundra ≈ 120, Białowieża ≈ 2290 (best site), prairie with bison 5000–10 000, richest savanna ≈ 19 900
  game: { tundra: 12, taiga: 6, temperate_forest: 120, steppe: 600, mediterranean: 100, desert: 0.5, semi_desert: 5,
    savanna: 1000, tropical_forest: 50, wetland: 150, highland: 20 },
  // timber: m³ of standing stem wood per hectare, a map-wide average of natural old forest (≈ 40–70 % of the best
  // stands): holm oak 140–170, boreal pine ≈ 140, Atlantic oak 350–600, Pyrenean beech–fir 500–800 m³/ha
  woodPerHa: { tundra: 5, taiga: 80, temperate_forest: 280, steppe: 10, mediterranean: 85, desert: 0,
    semi_desert: 3, savanna: 30, tropical_forest: 400, wetland: 100, highland: 40 },
  // fresh water: m³ per year per 100 km² for every millimetre of runoff
  waterPerMm: 1e5,
  // common ground, tonnes per 100 km² of fully suitable ground (a usable layer, not the whole crust)
  stone: 2e8, limestone: 6e8, clay: 1.1e8, sand: 1.5e8, quartz: 5e7, peat: 5.5e7, saltPan: 2.7e6,
};
