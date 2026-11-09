# Источники данных: климат

## Скачанные файлы (`data/raw/climate/`)

| Файл | URL | Размер | SHA-256 |
|---|---|---|---|
| `wc2.1_10m_tavg.zip` | https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_tavg.zip | 37,4 МБ | `5e567dcfe94379b94229492849ce91078b1c6e5210aaf435fba449fae6b95405` |
| `wc2.1_10m_prec.zip` | https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_prec.zip | 7,3 МБ | `1090f578f6402672a2b6438e252156f6cf867a25002a8ad6ffcbfa19e516ddc6` |
| `wc2.1_10m_elev.zip` | https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_elev.zip | 1,3 МБ | `6a9f4e9a37f289d594ed1567b63be344a4dacf247f0b69756e81df031087e3bd` |

Распакованы `C:\Windows\System32\tar.exe -xf` в `data/raw/climate/{tavg,prec,elev}/` (GeoTIFF 2160×1080,
10′, Float32 / Int16, nodata над океаном). Скачано 10 ноября 2026 г., всего ≈ 46 МБ архивов + 47 МБ GeoTIFF.

**Набор:** WorldClim 2.1, средние месячные нормы 1970–2000 гг. (температура воздуха, осадки, высота).
Страница: https://www.worldclim.org/data/worldclim21.html

**Ссылка (обязательна):** Fick, S.E. and R.J. Hijmans, 2017. WorldClim 2: new 1-km spatial resolution climate
surfaces for global land areas. *International Journal of Climatology* 37 (12): 4302–4315.

## ⚠ Лицензия — внимание

В задании WorldClim был указан как CC BY 4.0, но официальные условия этого не подтверждают:

- https://www.worldclim.org/about.html (проверено 10.11.2026): «The data are freely available for academic use
  and other non-commercial use. Redistribution or commercial use is not allowed without prior permission.»
- `readme.txt` внутри архива осадков: «You are not allowed to redistribute these data.»

Следствия для проекта:
- Локальная разработка и некоммерческое использование — разрешены.
- `public/assets/climate/normals.bin.gz` (и производные `biome.bin.gz`, `landfrac.bin.gz` частично) — это
  переработанные данные WorldClim. **Публиковать их в открытом репозитории или продавать игру с ними без
  разрешения авторов нельзя.** Сейчас `.gitignore` не исключает `public/assets/climate/` — это стоит
  решить главному потоку (добавить в `.gitignore` или получить разрешение).
- Открытые замены той же формы (скрипт `bake-normals.mjs` легко переключить — нужна сетка температуры
  и осадков по месяцам):
  - **CRU CL 2.0** (New et al. 2002), 10′, нормы 1961–1990, температура/осадки/высота —
    https://crudata.uea.ac.uk/cru/data/hrg/tmc/ (условия CRU — проверить перед использованием);
  - **TerraClimate** (Abatzoglou et al. 2018), 1/24°, CC0 (общественное достояние) —
    https://www.climatologylab.org/terraclimate.html;
  - **ERA5 / ERA5-Land monthly** (Copernicus), лицензия Copernicus (разрешает коммерческое использование
    с указанием источника).

## Обработка (что сделано с данными)

- `scripts/climate/bake-normals.mjs`: среднее по блокам 3×3 действительных пикселей → сетка SIM 720×360 (0,5°).
- Плато Восточной Антарктиды: у WorldClim там почти нет станций, данные слишком тёплые (Купол C: годовая
  ≈ −38 °C против наблюдаемых −54,5 °C). Ячейки южнее 60° ю.ш. выше 1000 м плавно смешаны с параметризацией
  Fortuin & Oerlemans (1990, *Annals of Glaciology* 14: 64–70): T = 34,46 − 0,00914·z − 0,688·|φ|, плюс
  сезонный ход станции Южный полюс; накопление — к ≈ 25 мм/год на высоком плато.
- Океан (в WorldClim — нет данных) заполнен решением экранированного уравнения Пуассона: суша — граничные
  значения, море стремится к зонально-сезонной формуле «температуры воздуха над морем» и осадков
  (ВЗК, штормовые пути, тёплый бассейн), с поправками на главные течения (Северо-Атлантическое,
  Гольфстрим, Куросио, Лабрадорское, Ойясио, Охотское море, Калифорнийское, Канарское, Гумбольдта,
  Бенгельское). Температура заполняется приведённой к уровню моря (6,5 °C/км), чтобы горные берега не
  выхолаживали море. Замкнутые водоёмы < 600 ячеек (Чёрное море и т.п.) — интерполяция Лапласа от берегов;
  их «высота» — минимальная высота берега.
- `landfrac.bin.gz` построен по маске карты игры `public/assets/map/cells.bin.gz` (Natural Earth).
- `scripts/climate/bake-biomes.mjs`: даунскейлинг на сетку карты 8192×4096 — билинейная интерполяция +
  поправка температуры на высоту по `height.delta.bin.gz` (6,5 °C/км). На ледниковых щитах высота карты —
  коренное ложе (например, 72° с.ш. 40° з.д.: −20 м вместо ≈ 3000 м поверхности льда), поэтому там при
  |φ| > 58° берётся высота климатической сетки. Правила классификации — `src/sim/climate/biomes.js`
  (пороги Кёппена + правила в духе диаграммы Уиттекера; болота — плоские влажные низменности,
  P/PET Торнтвейта ≥ 1,1).

## Палеоклимат (`src/sim/climate/paleo.js`)

Модель не использует скачанных данных: кривые построены по опорным значениям из публикаций (полный список —
в комментариях в начале файла): Kaufman et al. 2020 (Temp12k), Marcott et al. 2013, PAGES 2k 2019,
Mann et al. 2009, Büntgen et al. 2016, HadCRUT5, IPCC AR6 WG1 (SSP2-4.5), deMenocal et al. 2000,
Shanahan et al. 2015, Tierney et al. 2017, Fleitmann et al. 2007, Weiss et al. 1993 / Cullen et al. 2000 /
Staubwasser et al. 2003 (событие 4,2 тыс. л.н.), Kaniewski et al. 2013, Haug et al. 2003, Kennett et al. 2012,
Buckley et al. 2010, Cook et al. 2004, Shen et al. 2007, Schubert et al. 2004, Nicholson 2013, Lambeck et al. 2014,
Mitrovica & Milne 2002, Peltier et al. 2015 (ICE-6G_C), NSIDC Sea Ice Index v3, Notz & Stroeve 2016,
Kaufman et al. 2004, Berger & Loutre 1991. Значения — округлённые прочтения опубликованных кривых.
