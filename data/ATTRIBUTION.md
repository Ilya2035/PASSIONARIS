# Источники данных карты

| Данные | Источник | Лицензия |
|---|---|---|
| Границы стран, провинций (admin-0, admin-1), озёра, реки, города | [Natural Earth](https://www.naturalearthdata.com) 1:10m, v5 (через github.com/nvkelso/natural-earth-vector) | Public domain |
| Цвет поверхности | NASA Blue Marble Next Generation, июнь 2004 (NASA Earth Observatory) | Общественное достояние (NASA) |
| Высоты суши и рельеф дна | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen «terrarium», z5) | Открытые данные; источники: SRTM, GMTED, ETOPO1, NRCan CDEM, EU-DEM и др. — требуется указание авторства |

Сырые файлы скачиваются в `data/raw/` командой `npm run data:download` и не хранятся в репозитории.
Карта игры запекается из них командой `npm run data:bake`.

Ассеты Europa Universalis V и других игр Paradox **не используются**.
