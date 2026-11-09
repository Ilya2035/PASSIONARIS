# Источники данных модуля regions (природные районы, морские зоны, дороги)

| Данные | Источник (URL) | Лицензия | Где лежит |
|---|---|---|---|
| Рельеф и маска суши/озёр | собственные ассеты проекта `public/assets/map/height.delta.bin.gz`, `cells.bin.gz` (из AWS Terrain Tiles и Natural Earth, см. `data/ATTRIBUTION.md`) | см. `data/ATTRIBUTION.md` | — |
| Осевые линии рек (крупные реки = границы районов) | Natural Earth 1:10m `ne_10m_rivers_lake_centerlines` — https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson (уже был в `data/raw/`) | Public domain | `data/raw/ne_10m_rivers_lake_centerlines.geojson` |
| Озёра (названия, признак водохранилища) | Natural Earth 1:10m `ne_10m_lakes` (уже был в `data/raw/`) | Public domain | `data/raw/ne_10m_lakes.geojson` |
| Дополнительные реки Европы (густота, русские названия) | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_europe.geojson | Public domain | `data/raw/regions/` |
| Дополнительные реки Северной Америки | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_north_america.geojson | Public domain | `data/raw/regions/` |
| Природные области: хребты, плато, пустыни, равнины, полуострова (с `NAME_RU`) | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson | Public domain | `data/raw/regions/` |
| Моря, заливы, проливы (названия морских зон) | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_marine_polys.geojson | Public domain | `data/raw/regions/` |

Скачивание: `tools/node/node.exe scripts/regions/download.mjs` (≈18 МБ, все файлы с официального репозитория Natural Earth
на GitHub — того же, откуда проект уже брал остальные слои NE). Без дополнительных файлов запекание тоже работает
(меньше названий, морские зоны получают нейтральные имена).

Русские названия рек: в основном слое рек NE поля `name_ru` нет, поэтому используется собственный словарь
(`scripts/regions/names.mjs`, ~590 рек, 650 написаний NE), русские имена из региональных слоёв NE и, в крайнем случае, транслитерация.
Несколько заведомо ошибочных русских названий из `geography_regions_polys` исправлены вручную (`GEO_FIX` в
`scripts/regions/features.mjs`).

Современные страны, провинции и города **не используются** ни для границ районов, ни для их названий.
