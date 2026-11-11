# Природные ресурсы — источники данных и лицензии

Загрузка: `tools/node/node.exe scripts/resources/download.mjs` → `data/raw/resources/` (≈ 200 МБ, в git не идёт).
Сборка: `tools/node/node.exe scripts/resources/bake.mjs` → `public/assets/resources/` (коммитится).
Скачано 11.11.2026. Лицензия каждого набора проверена на странице источника в тот же день.

## Скачиваемые наборы

| Папка в `data/raw/resources/` | Что | Откуда | Лицензия (как проверено) |
|---|---|---|---|
| `mrds/` | Mineral Resources Data System: ≈ 305 000 месторождений и рудопроявлений мира — название, координаты, полезные ископаемые (главные, второстепенные, следы), статус (добывается, добывался, проявление), размер добычи, способ добычи | `https://mrdata.usgs.gov/mrds/mrds-csv.zip` (USGS) | Работа правительства США — общественное достояние ([политика USGS](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)); в метаданных `Access_Constraints: none`, `Use_Constraints: none` |
| `major/` | Major mineral deposits of the world (USGS Open-File Report 2005-1294 A–E): ≈ 2000 крупнейших месторождений неэнергетического сырья | `https://mrdata.usgs.gov/major-deposits/ofr20051294-csv.zip` | Общественное достояние (USGS); `Use_Constraints: none` |
| `vms/` | Volcanogenic massive sulfide deposits of the world (Mosier и др., 2009, OFR 2009-1034): 1090 колчеданных месторождений с тоннажом руды и содержанием меди, свинца, цинка, золота, серебра — в том числе Иберийский пиритовый пояс | `https://mrdata.usgs.gov/vms/vms-csv.zip` | Общественное достояние (USGS) |
| `potash/potash.geojson` | Evaporite-related potash resources worldwide (USGS SIR 2010-5090-S): 981 залежь калийных и каменных солей | слой ArcGIS USGS `energy.usgs.gov/arcgis/rest/services/Hosted/Evaporite_related_potash_resources_worldwide/FeatureServer/0` | Общественное достояние (USGS) |
| `wikidata/sites.json` | Викиданные: шахты, рудники и карьеры (`Q820477`, `Q188040` и все подклассы), нефтяные и газовые месторождения (`Q211748`, `Q1349255`), угольные месторождения (`Q12091026`), соляные шахты, солеварни и солончаковые пруды (`Q40551`, `Q1880708`, `Q244326`) — у кого есть координаты; продукт добычи (`P1056`). 126 классов, 60 885 мест; из них 11 928 записей ресурсов игры (остальные — шахты без указанного продукта или с ненужным: уран, цинк и т. п.) | `https://query.wikidata.org/sparql` | [CC0 1.0](https://www.wikidata.org/wiki/Wikidata:Licensing) — структурированные данные Викиданных |
| `glim/` | GLiM — Global Lithological Map v1.0, сетка 0,5°: главный тип горных пород клетки (16 классов: рыхлые осадки, карбонаты, кислые вулканиты, метаморфиты, эвапориты и т. д.) | PANGAEA, [doi:10.1594/PANGAEA.788537](https://doi.org/10.1594/PANGAEA.788537) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — нужна ссылка на авторов (см. `data/ATTRIBUTION.md`) |
| `chl/` | Хлорофилл-а у поверхности моря, S-NPP VIIRS, месячные снимки 2019 г., 4 км: область альбома через пиксель, мир через 13 пикселей | NOAA CoastWatch ERDDAP, набор `noaacwNPPVIIRSSQchlaMonthly` (`https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPVIIRSSQchlaMonthly`) | Свободное использование и распространение: «The data may be used and redistributed for free» ([политика данных NASA](https://science.nasa.gov/earth-science/earth-science-data/data-information-policy/)) |

## Уже есть в проекте

| Файл | Что берётся | Лицензия |
|---|---|---|
| `public/assets/climate/normals-open.bin.gz` | средняя температура, самый тёплый и холодный месяц, осадки за год (сетка 0,5°) | CHELSA V2.1 + ETOPO 2022, CC0 (см. `data/sources/climate.md`) |
| `public/assets/climate/biome-open.bin.gz` | природные зоны 8192 × 4096: доля леса, болота | собственный расчёт игры из тех же CC0-норм |
| `public/album-data/height-base.u16.gz` | высоты и глубины моря в области альбома (≈ 230 м) | AWS Terrain Tiles, открытые данные с указанием источников |
| `public/assets/map/height.delta.bin.gz`, `cells.bin.gz` | высоты, глубины и озёра всего мира | AWS Terrain Tiles + Natural Earth |
| `data/raw/ne_10m_rivers_lake_centerlines.geojson` | реки с классом размера | Natural Earth, общественное достояние |

## Что проверено и отвергнуто

- **USGS World Petroleum Assessment 2000** (нефтегазовые провинции): данные лежат только на ScienceBase, а он
  закрыт проверкой Cloudflare от автоматических запросов; обходить её нельзя. Сборники DDS-60 на pubs.usgs.gov
  содержат только PDF. Нефть и газ поэтому берутся из Викиданных, а «неразведанная часть бассейна» — правилом.
- **Угольные бассейны USGS** есть только по регионам (США, Америка, бывший СССР, Китай), мирового слоя нет. Уголь —
  из Викиданных и MRDS.
- **Global Energy Monitor** (угольные шахты, CC BY 4.0): выдача файла только через форму с личными данными.
- **NOAA CoastWatch West Coast** (`coastwatch.pfeg.noaa.gov`): сервер не отвечал; использован центральный
  `coastwatch.noaa.gov`.
- **Smithsonian GVP** (вулканы) в проекте есть, но условия запрещают коммерческое использование без разрешения;
  для обсидиана вместо него взят класс кислых вулканитов GLiM.
- Полная векторная GLiM (1,2 млн полигонов) лежит не на PANGAEA, а на стороннем хранилище без ясной лицензии; взята
  сетка 0,5°.

## Как данные превращаются в ресурсы

Подробно — `docs/RESOURCES.md`. Кратко:

- Товары MRDS и «крупных месторождений» переводятся в ресурсы игры таблицей `RES_BY_COMMODITY` в
  `scripts/resources/bake.mjs` (например, Halite, Potash → соль; Lignite, Anthracite → уголь; Marble, Slate,
  Alabaster, Flint, Perlite → редкий камень). Цинк, вольфрам, уран, фосфаты и другое пока в игре не используются.
- Классы и продукты Викиданных переводятся таблицей `RES_BY_WORD` (по английским названиям класса и продукта).
- Одна залежь в нескольких базах объединяется: то же имя (с точностью до одной опечатки) в пределах 75 км или любые
  записи одного ресурса в пределах 5 км (на мировой сетке 10 км). Координаты берутся у самого надёжного источника
  (Викиданные → VMS → «крупные месторождения» и калийные соли → MRDS), количество — наибольшее.
- В MRDS около 1800 записей стоят в условных точках (центр страны или района: одни и те же координаты у 8 и более
  разных мест). Если у того же места есть запись с настоящими координатами, условная отбрасывается и отдаёт ей свой
  размер; остальные становятся зонами «место известно неточно» радиусом 250 км.
