# Стихийные бедствия (hazards) — источники данных и лицензии

Загрузка: `tools/node/node.exe scripts/hazards/download.mjs` → `data/raw/hazards/` (≈37 МБ, 2026-11-10).
Сборка: `tools/node/node.exe scripts/hazards/bake.mjs` → `public/assets/hazards/` (≈2,5 МБ).

## Сырые данные

| Файл | Источник (URL) | Лицензия / условия |
|---|---|---|
| `gvp_holocene_volcanoes.geojson` (1214 вулканов) | Smithsonian Global Volcanism Program, *Volcanoes of the World* v5, WFS: `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json` | Бесплатно, с обязательной ссылкой: «Global Volcanism Program, Volcanoes of the World (v. 5), Smithsonian Institution, https://volcano.si.edu (accessed 2026-11-10)». Условия использования Смитсоновского института: некоммерческое/образовательное использование; **перед коммерческим выпуском уточнить разрешение** |
| `gvp_holocene_eruptions.geojson` (11 089 извержений) | то же, `typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions` | то же |
| `ncei_earthquakes.json` (6698) | NOAA NCEI HazEL API `https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes?minYear=-2150&maxYear=2026&page=N` — NCEI/WDS Global Significant Earthquake Database, doi:10.7289/V5TD9V7K | Общественное достояние (работа правительства США); просьба ссылаться |
| `ncei_tsunami_events.json` (3140), `ncei_tsunami_runups.json` (35 136) | `…/api/v1/tsunamis/events`, `…/api/v1/tsunamis/runups` — NCEI/WDS Global Historical Tsunami Database, doi:10.7289/V5PN93H7 | Общественное достояние |
| `ncei_volcanoes.json` (903) | `…/api/v1/volcanoes` — NCEI/WDS Global Significant Volcanic Eruptions Database, doi:10.7289/V5JW8BSH | Общественное достояние |
| `usgs_m6_1900_now.json` (14 552, M≥6, 1900-01-01 … 2026-11-09) | USGS ComCat FDSN: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=…&endtime=…&minmagnitude=6&orderby=time-asc&limit=20000` (5 диапазонов дат) — ANSS ComCat, doi:10.5066/F7MS3QZH | Общественное достояние (USGS) |
| `nasa_meteorite_landings.csv` (45 716) | NASA Open Data Portal, «Meteorite Landings» (данные The Meteoritical Society). Старый адрес Socrata `https://data.nasa.gov/resource/gh4g-9sfh.json` больше не работает (404, портал переехал на CKAN); **резервный официальный файл**: `https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.csv` | Открытые данные NASA (в каталоге CKAN лицензия «not specified»; данные NASA, как правило, общественное достояние). Первоисточник — Meteoritical Bulletin Database (Meteoritical Society) |

## Добавлено вручную (по литературе)
- Тунгусский взрыв: 30.06.1908, 60.886° с.ш. 101.894° в.д., энергия принята 12 Мт (оценки 3–15 Мт; Boslough & Crawford 2008, *Int. J. Impact Eng.* 35:1441).
- Челябинский метеорит: дата 15.02.2013, энергия ≈500 кт (Brown et al. 2013, *Nature* 503:238; Popova et al. 2013, *Science* 342:1069).
- Точные даты известных падений (в таблице NASA только год): Сихотэ-Алинь 12.02.1947, Энсисхайм 07.11.1492 (в таблице 1491), L'Aigle 26.04.1803, Allende 08.02.1969, Murchison 28.09.1969, Peekskill 09.10.1992, Almahata Sitta 07.10.2008, Carancas 15.09.2007, Куня-Ургенч 20.06.1998, Гирин 08.03.1976, Ногата 19.05.861.
- Даты кульминаций извержений (Тамбора 10.04.1815, Кракатау 27.08.1883, Пинатубо 15.06.1991 и др.) взяты из NOAA NCEI (significant volcanic eruptions), а не придуманы.

## Также используются (уже есть в проекте)
- `public/assets/map/cells.bin.gz`, `height.delta.bin.gz`, `world.json` (Natural Earth — общественное достояние; рельеф AWS Terrain Tiles) — суша/берег, уклоны, названия стран.
- `public/assets/map/albedo-2k.jpg` (NASA Blue Marble NG, общественное достояние) — грубый индекс влажности (зелень растительности) для оползней.

## Методы (опубликованные соотношения)
- Интенсивность: Allen, Wald & Worden (2012), *J. Seismol.* 16:409–433 (IPE по гипоцентральному расстоянию).
- Длина разрыва: Wells & Coppersmith (1994), *BSSA* 84:974–1002 (log RLD = −2.44 + 0.59 M).
- Магнитуда по интенсивности (доинструментальные события): сначала региональная калибровка по самому каталогу NCEI — медиана M событий той же страны с тем же I₀ и известной магнитудой (глубина ≤ 40 км, не менее 5 событий; например, для I₀ = X: Италия M 6,2, Греция 6,7, Турция 7,0, Мексика 7,8); если таких нет — Шебалин Н. В. (1968), I₀ = 1,5M − 3,5 lg h + 3,0; ограничение M ≤ 7,5.
- Шкала уровней землетрясений: границы [от, до), кроме верхней — «5 = >10» понимается буквально, поэтому X баллов — это уровень 4, а уровень 5 — только XI–XII.
- Очистка NCEI: около 60 записей с интенсивностью 12 без магнитуды и без каких-либо последствий (жертвы, ущерб, цунами) — в основном «ITALY: N / CENTRAL / S / SICILY» 1450 г. до н.э. – 1963 г. — признаны недостоверными; их размер считается неизвестным (флаг 32, принято I₀ = 7). События без магнитуды и интенсивности — I₀ = 7 (флаг 8).
- Объединение NCEI и USGS: второй проход сопоставляет события с временем в очаге в пределах 15 мин и 300 км даже при расхождении магнитуд больше чем на единицу (ранние Ms NCEI против пересчитанных Mw ISC-GEM).
- Частота стохастических землетрясений: пространственное распределение по зонам 5°×5° за 1900–2025, общий темп приведён к полному периоду 1964–2025 (≈138 событий M≥6 в год) коэффициентом полноты.
- Уклоны для оползней: высоты ниже уровня моря обнуляются, чтобы батиметрия соседних морских пикселей не считалась уклоном берега.
- Дальнее затухание за 300 км: член вида c·R как в IPE Atkinson & Wald (2007); значение c = −0,0012 1/км — **допущение модели**.
- Цунами: интенсивность Соловьёва–Имамуры I = log₂(√2·H) (Soloviev 1970).
- Вулканы: радиусы 10/30/100 км индекса VPEI (Brown et al. 2015, *Global Volcanic Hazards and Risk*, CUP), шкала VEI (Newhall & Self 1982, *JGR* 87:1231).
- Метеориты: поток N(>E) = 3,7·E^−0,9 в год, E в кт (Brown et al. 2002, *Nature* 420:294).
- Оползни: глобальная частота 4862 смертоносных оползня за 2004–2016 (Froude & Petley 2018, *NHESS* 18:2161); восприимчивость по уклону с триггерами — по идее Stanley & Kirschbaum (2017, *Nat. Hazards* 87:145).
