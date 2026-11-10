# Источники данных карты

| Данные | Источник | Лицензия |
|---|---|---|
| Границы стран, провинций (admin-0, admin-1), озёра, реки, города | [Natural Earth](https://www.naturalearthdata.com) 1:10m, v5 (через github.com/nvkelso/natural-earth-vector) | Public domain |
| Цвет поверхности | NASA Blue Marble Next Generation, июнь 2004 (NASA Earth Observatory) | Общественное достояние (NASA) |
| Высоты суши и рельеф дна | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen «terrarium», z5) | Открытые данные; источники: SRTM, GMTED, ETOPO1, NRCan CDEM, EU-DEM и др. — требуется указание авторства |
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
