# Источники данных карты

| Данные | Источник | Лицензия |
|---|---|---|
| Границы стран, провинций (admin-0, admin-1), озёра, реки, города | [Natural Earth](https://www.naturalearthdata.com) 1:10m, v5 (через github.com/nvkelso/natural-earth-vector) | Public domain |
| Цвет поверхности | NASA Blue Marble Next Generation, июнь 2004 (NASA Earth Observatory) | Общественное достояние (NASA) |
| Высоты суши и рельеф дна | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen «terrarium», z5) | Открытые данные; источники: SRTM, GMTED, ETOPO1, NRCan CDEM, EU-DEM и др. — требуется указание авторства |
| Поправки берега (`public/assets/coast/`: суша и вода для всех масштабов, без водохранилищ и польдеров) | Natural Earth 1:10m (страны, озёра) и климатические нормы ниже (классы природных зон новой суши); `scripts/bake-coast-fix.mjs` | Public domain / CC0 |
| Климатические нормы: температура и осадки по месяцам (`public/assets/climate/normals-open.bin.gz`, природные зоны `biome-open.bin.gz`) | [CHELSA V2.1](https://www.chelsa-climate.org/datasets/chelsa_climatologies), климатологии 1981–2010 ([EnviDat, doi:10.16904/envidat.228](https://doi.org/10.16904/envidat.228)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (общественное достояние); просьба авторов о ссылке — ниже |
| Высота климатической сетки (поверхность ледниковых щитов) | [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model), 60″, поверхность (NOAA NCEI, [doi:10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (NOAA отказывается от прав) |

Сырые файлы скачиваются в `data/raw/` командой `npm run data:download` и не хранятся в репозитории.
Карта игры запекается из них командой `npm run data:bake`. Климатические нормы уже запечены и лежат в репозитории
(`public/assets/climate/`); пересобрать их: `node scripts/climate/download-open.mjs`, затем `bake-normals.mjs` и
`bake-biomes.mjs` (подробности — `data/sources/climate.md`).

**Ссылки, о которых просят авторы климатических данных** (CC0 их не требует, но мы их приводим):
- Karger, D. N., Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R. W., Zimmermann, N. E., Linder, H. P.,
  Kessler, M. (2021). Climatologies at high resolution for the earth’s land surface areas. EnviDat.
  https://doi.org/10.16904/envidat.228
- Karger, D. N. et al. (2017). Climatologies at high resolution for the earth’s land surface areas. *Scientific Data* 4,
  170122. https://doi.org/10.1038/sdata.2017.122
- NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model.
  https://doi.org/10.25921/fd45-gt74

Прежний источник климата, WorldClim 2.1, больше не используется: его лицензия запрещает распространение
(подробности — `data/sources/climate.md`).

Ассеты Europa Universalis V и других игр Paradox **не используются**.

## Альбом графики (`album.html`)

Данные альбома скачивает `scripts/album/fetch-data.mjs` в `public/album-data/`; в репозиторий они не входят.

| Данные | Источник | Лицензия |
|---|---|---|
| Высоты Пиренейского полуострова и юга Франции (уровни 9 и 12) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), формат terrarium; собраны Mapzen из SRTM, GMTED, ETOPO1 и других открытых наборов | Открытые данные с указанием источников: [список Mapzen](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Реки, озёра, поселения | Natural Earth 10m | Общественное достояние |
| Деление: очертания нынешних провинций, округов и департаментов — подсказка, к какой исторической земле тянется чанк (`public/assets/album/division/admin.json`) | Natural Earth 10m admin-1 states and provinces | Общественное достояние |
| 3D-модели домов, строек, стен, деревьев и скал (41 штука) | [KayKit : Medieval Hexagon Pack 1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0), Kay Lousberg (www.kaylousberg.com) | CC0 1.0 |
| Текстуры земли, 16 штук (`aerial_*`, `forest_floor`, `snow_*` и другие) | [Poly Haven](https://polyhaven.com/textures) | CC0 1.0 |

### Альбом: вода

| Данные | Источник | Лицензия |
|---|---|---|
| Естественные озёра региона (`public/assets/album/water/lakes.json`, в репозитории) | Перечень свой: названия, места, уровни и глубины записаны в `scripts/album/water-lakes.mjs`. Очертания сняты этим скриптом с высот альбома ([AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)) | Перечень — свой. Высоты — открытые данные с указанием источников: [список Mapzen](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Русла рек с шириной (`public/assets/album/water/rivers.bin.gz`) и пляжи (`public/assets/album/water/coast.bin.gz`), оба файла в репозитории | © участники [OpenStreetMap](https://www.openstreetmap.org/copyright); выгрузки по странам с [download.geofabrik.de](https://download.geofabrik.de). Собраны скриптами `scripts/album/fetch-osm.mjs`, `osm-extract.mjs`, `bake-rivers.mjs`, `bake-coast.mjs` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): нужно указание авторства; производная база данных распространяется на тех же условиях — оба файла открыто лежат в репозитории |
| Места настоящих городов, городков и сёл (`public/assets/album/town/sites.json.gz`, в репозитории): по ним стоят центры районов | © участники [OpenStreetMap](https://www.openstreetmap.org/copyright); те же выгрузки; `scripts/album/bake-sites.mjs` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |

## Ресурсы

Таблица ресурсов `public/assets/resources/` собрана из открытых данных скриптами `scripts/resources/download.mjs` и
`bake.mjs`; подробности, отвергнутые наборы и правила — `data/sources/resources.md` и `docs/RESOURCES.md`.

| Данные | Источник | Лицензия |
|---|---|---|
| Месторождения и рудопроявления мира | U.S. Geological Survey, 2005, [Mineral Resources Data System](https://mrdata.usgs.gov/mrds/) (MRDS) | Общественное достояние (USGS) |
| Крупнейшие месторождения | Schulz, K. J., Briskey, J. A. (ред.), 2005–2009, [Major mineral deposits of the world](https://mrdata.usgs.gov/major-deposits/), USGS OFR 2005-1294 A–E | Общественное достояние (USGS) |
| Колчеданные месторождения с тоннажом | Mosier, D. L., Berger, V. I., Singer, D. A., 2009, [Volcanogenic massive sulfide deposits of the world](https://mrdata.usgs.gov/vms/), USGS OFR 2009-1034 | Общественное достояние (USGS) |
| Калийные и каменные соли | Orris, G. J. и др., 2014, Evaporite-related potash resources worldwide, USGS SIR 2010-5090-S | Общественное достояние (USGS) |
| Шахты, карьеры, нефтяные, газовые и угольные месторождения, солеварни | [Викиданные](https://www.wikidata.org) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Горные породы (сетка 0,5°) | Hartmann, J., Moosdorf, N., 2012, Global Lithological Map Database v1.0 (gridded to 0.5° spatial resolution), PANGAEA, [doi:10.1594/PANGAEA.788537](https://doi.org/10.1594/PANGAEA.788537); статья: *Geochem. Geophys. Geosyst.* 13, Q12004, [doi:10.1029/2012GC004370](https://doi.org/10.1029/2012GC004370) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Продуктивность моря (хлорофилл-а, 2019) | NOAA CoastWatch, S-NPP VIIRS Science Quality Level 3, 4 км, месячные (NOAA/STAR Ocean Color Team; NASA) | Свободное использование и распространение ([политика данных NASA](https://science.nasa.gov/earth-science/earth-science-data/data-information-policy/)) |
| Климат, природные зоны, высоты, реки | см. разделы выше: CHELSA V2.1 и ETOPO 2022 (CC0), AWS Terrain Tiles, Natural Earth | см. выше |

## Код

- Масштабирование картинки (`src/game/post.js`): перенос AMD FidelityFX Super Resolution 1.0 (EASU + RCAS),
  © 2021 Advanced Micro Devices, Inc., лицензия MIT — текст лицензии в начале файла.
