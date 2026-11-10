# Источники данных: климат

С версии 0.2.2 климатические нормы игры — **открытые данные**, их можно хранить в публичном репозитории и раздавать
вместе с игрой:

| Что | Источник | Лицензия |
|---|---|---|
| Температура и осадки по месяцам (суша и море) | **CHELSA V2.1**, климатологии 1981–2010 | **CC0 1.0** |
| Высота климатической сетки (с поверхностью ледниковых щитов) | **ETOPO 2022 v1**, 60″, «surface» (NOAA NCEI) | **CC0 1.0** |

Запечённые файлы лежат в git: `public/assets/climate/normals-open.bin.gz` (4,3 МБ) и `biome-open.bin.gz` (0,44 МБ),
описание формата — `normals.json`, `biomes.json`. Старые имена `normals.bin.gz` / `biome.bin.gz` (WorldClim) остаются
в `.gitignore`, игра их больше не читает.

## Лицензии (проверено на официальных страницах 10 ноября 2026 г.)

**CHELSA V2.1 climatologies** — Karger et al., WSL (Швейцария).
- Страница набора: https://www.chelsa-climate.org/datasets/chelsa_climatologies — в карточке «CHELSA-climatologies»
  (CHELSA_V2.1, climatologies): «License: Creative Commons Zero - No Rights Reserved (CC0 1.0)».
  (GPL v3 там же относится к коду модели CHELSA, не к данным.)
- Архив данных EnviDat, DOI 10.16904/envidat.228, версия 2.1: `license_id: CC0-1.0`,
  https://creativecommons.org/publicdomain/zero/1.0/ (API: https://www.envidat.ch/api/action/package_show?id=chelsa-climatologies).
- CC0 не требует указывать авторство, но авторы просят ссылаться так (мы ссылаемся — `data/ATTRIBUTION.md`):
  - Karger, D. N., Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R. W., Zimmermann, N. E., Linder, H. P.,
    Kessler, M. (2021). Climatologies at high resolution for the earth’s land surface areas. EnviDat.
    https://doi.org/10.16904/envidat.228
  - Karger, D. N. et al. (2017). Climatologies at high resolution for the earth’s land surface areas.
    *Scientific Data* 4, 170122. https://doi.org/10.1038/sdata.2017.122

**ETOPO 2022** — NOAA National Centers for Environmental Information.
- Страница: https://www.ncei.noaa.gov/products/etopo-global-relief-model
- Метаданные NCEI (`gov.noaa.ngdc.mgg.dem:etopo_2022`): данные созданы NOAA и «not subject to copyright protection in
  the United States»; NOAA отказывается от прав во всём мире по CC0-1.0 («SPDX License: Creative Commons Zero v1.0
  Universal (CC0-1.0)»).
- Ссылка (просят указывать): NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second
  Global Relief Model. NOAA National Centers for Environmental Information. https://doi.org/10.25921/fd45-gt74

### Почему не другие варианты
- **TerraClimate** (раньше значился здесь как CC0): на официальной странице
  https://www.climatologylab.org/terraclimate.html (10.11.2026) условий использования нет вовсе; версия 1.1 сама
  построена на климатологии CHELSA V2.1 + аномалиях ERA5, а прежние версии — на нормах WorldClim (та же лицензионная
  проблема). Берём первоисточник с явной лицензией — CHELSA.
- **ERA5** (Copernicus): нужна учётная запись CDS и ключ API; CHELSA V2.1 — это и есть уменьшенный до 1 км ERA5.
- **CRU TS**: лицензия Open Database License (с условием «share-alike» для производных баз), нет Антарктиды.

## Скачанные файлы (`data/raw/climate-open/`, не в git)

Команда: `tools/node/node.exe scripts/climate/download-open.mjs` (≈ 6 мин). Только официальные серверы.

| Файлы | Откуда | Объём загрузки |
|---|---|---|
| `chelsa/tas_01..12.u16.gz`, `chelsa/pr_01..12.u16.gz` | `https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/climatologies/{tas,pr}/1981-2010/CHELSA_{tas,pr}_MM_1981-2010_V.2.1.tif` (хранилище WSL/EnviDat, ссылка со страницы CHELSA) | 155 МБ вместо 6,2 ГБ полных файлов |
| `etopo/surface_3m.i16.gz` | `https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc` (OPeNDAP NCEI) | 104 МБ |

- CHELSA публикует Cloud Optimized GeoTIFF 43200×20880 (30″, 84° с.ш. – 90° ю.ш., ~150 МБ температура и ~360 МБ
  осадки на месяц). Читается только встроенный обзорный уровень 3 (1/8: 4′, 5400×2610) запросами по диапазонам байт
  (npm-пакет `geotiff`, уже в зависимостях). Обзоры — сглаженные средние, а не прореживание: сверка в Альпах — отличие
  от точного среднего 30″-пикселей ≈ 1 %. Значения: `tas` — K×10, `pr` — мм/мес×10, нет данных — 65535.
- ETOPO: каждая 3-я строка и столбец сетки 1′ (3′, 7200×3600), высота поверхности (верх ледниковых щитов), метры.
- `manifest.json` — адреса, размеры, даты изменения на сервере и SHA-256 каждого раскодированного растра.

## Обработка (`scripts/climate/bake-normals.mjs`, затем `bake-biomes.mjs`)

- **Пересчёт на сетку 0,5°:** среднее по площади 4′-пикселей CHELSA (7,5×7,5 на клетку; пограничные пиксели — с долей
  перекрытия). CHELSA покрывает и море (уменьшенный ERA5), поэтому суша и море — из одного источника; прежняя
  «формула моря» нужна только для полярной шапки севернее 84° с.ш. (там у CHELSA нет данных): заполнение уравнением
  Пуассона от края 84° с.ш. к зонально-сезонной формуле, с проходом для замёрзшего моря.
- **Период:** CHELSA — 1981–2010, а палеоклимат игры (`src/sim/climate/paleo.js`) отсчитывается от 1970–2000. Каждая
  клетка сдвинута разницей самой модели между этими периодами: температура −0,13…−0,67 °C (0,18 °C × полярное
  усиление), осадки ÷0,99…1,02. Так «норма + аномалия года» по-прежнему даёт климат нужного года.
- **Высота** («средняя высота суши клетки, открытое море = 0»): среднее точек ETOPO на суше карты (`cells.bin.gz`);
  точка ниже уровня моря в клетке, где есть и море, считается 0 м (островки и фьорды карты поверх морского дна ETOPO:
  у Багам иначе выходило −880 м); минимум −430 м (берег Мёртвого моря); клетки внутри крупных озёр — наименьшая высота
  соседней суши (≈ уровень озера).
- **Антарктида:** у WorldClim плато было на ~16 °C теплее наблюдений, его тянули к параметризации Fortuin & Oerlemans
  (1990); после этого ошибка среднегодовой на четырёх станциях плато была в среднем 4,3 °C (Купол C +7,7, Южный полюс
  −2,8). У CHELSA — 3,3 °C, и везде в одну сторону, теплее: Купол C −50,7 против −54,5 °C, Восток −52,4 против −55,2,
  Южный полюс −45,7 против −49,4, Купол A −51,5 против −54,5 (известная тёплая ошибка ERA5 зимой над плато; Саммит в
  Гренландии −28,4 против −29). Данные оставлены как есть, проверка печатается при запекании.
- **Природные зоны** (`bake-biomes.mjs`): без изменений метода — даунскейлинг на сетку карты 8192×4096 с поправкой
  6,5 °C/км, правила `src/sim/climate/biomes.js`.

## Насколько новые нормы отличаются от старых (WorldClim 2.1, 1970–2000)

Скрипт: `tools/node/node.exe scripts/climate/compare-normals.mjs <старые> <новые> [<старые зоны> <новые зоны>]`
(клетки суши карты, веса по площади).

- **Температура суши:** в среднем +0,1 °C, среднеквадратичная разница 1,4 °C по клеткам и месяцам (по поясам
  0,7–1,1 °C для среднегодовой). Исключение — Антарктида: +1,6 °C в среднем за год (старые данные там были
  подогнаны формулой), летом новые холоднее, зимой теплее.
- **Осадки суши:** CHELSA в целом влажнее на 18 % (медиана по клеткам +15 %): +40 % в Арктике (60–90° с.ш.),
  +21 % в умеренных широтах, +9…12 % в тропиках, ×3 на Антарктическом плато. WorldClim — интерполяция показаний
  осадкомеров, которые недоучитывают снег (особенно в Арктике), CHELSA — реанализ ERA5 с поправками; в горах (Вальдез,
  Норвегия) CHELSA заметно ближе к реальности.
- **Сверка с 14 станциями** (как в `tests/koppen.test.mjs`): температура — CHELSA ближе (средняя ошибка 0,7 °C против
  1,0 °C у WorldClim); осадки — WorldClim ближе к самим осадкомерам (типичная ошибка ×1,08 против ×1,15; больше всего
  отличие в Уткиагвике: ×1,72 — недоучёт снега осадкомером).
- **Классы Кёппена:** тот же класс на 85 % площади суши, та же группа — на 94 %; чаще всего меняются границы
  «пустыня ↔ степь» и «саванна ↔ муссонный климат».
- **Природные зоны:** тот же класс на ~90 % площади суши; меньше пустынь и саванн, больше тропических и умеренных
  лесов и болот (следствие более влажных данных).

Полная таблица по месяцам и поясам — в отчёте о переходе (версия 0.2.2) и воспроизводится скриптом.

## Прежний источник: WorldClim 2.1 (до версии 0.2.1 включительно)

WorldClim 2.1 (Fick & Hijmans 2017), нормы 1970–2000, 10′. Официальные условия
(https://www.worldclim.org/about.html): «The data are freely available for academic use and other non-commercial use.
Redistribution or commercial use is not allowed without prior permission.» Поэтому его производные файлы никогда не
попадали в публичный репозиторий (история очищена; `scripts/release.mjs` отказывается коммитить `normals.bin.gz` и
`biome.bin.gz`). Скрипт старого запекания — в истории git (`scripts/climate/bake-normals.mjs` до версии 0.2.2).

## Палеоклимат (`src/sim/climate/paleo.js`)

Модель не использует скачанных данных: кривые построены по опорным значениям из публикаций (полный список —
в комментариях в начале файла): Kaufman et al. 2020 (Temp12k), Marcott et al. 2013, PAGES 2k 2019,
Mann et al. 2009, Büntgen et al. 2016, HadCRUT5, IPCC AR6 WG1 (SSP2-4.5), deMenocal et al. 2000,
Shanahan et al. 2015, Tierney et al. 2017, Fleitmann et al. 2007, Weiss et al. 1993 / Cullen et al. 2000 /
Staubwasser et al. 2003 (событие 4,2 тыс. л.н.), Kaniewski et al. 2013, Haug et al. 2003, Kennett et al. 2012,
Buckley et al. 2010, Cook et al. 2004, Shen et al. 2007, Schubert et al. 2004, Nicholson 2013, Lambeck et al. 2014,
Mitrovica & Milne 2002, Peltier et al. 2015 (ICE-6G_C), NSIDC Sea Ice Index v3, Notz & Stroeve 2016,
Kaufman et al. 2004, Berger & Loutre 1991. Значения — округлённые прочтения опубликованных кривых.
