# Passionaris — движок и контракт модулей (ночь 10→11 ноября 2026)

Цель ночи: **живой макет мира 5000 г. до н.э. — 2100 г.** — глобус, ландшафт, климат, погода, стихийные бедствия,
течения, природные зоны с подписями, районы и дороги, время, сохранения, настройки. **Народов и стран нет.**
Графика — «активный макет» в лёгком разрешении; главное — механики и данные, которые потом легко украсить.

## Почему этот движок
Свой движок на **Three.js (WebGL2) + Electron**: бесплатный, открытый, быстрый в итерациях, моддинг — через
JSON/бинарные паки данных. Симуляция пишется **отдельно от графики** (чистые JS-модули + Web Worker), поэтому её
можно перенести в любой будущий движок (WebGPU, Godot, Unreal). DLSS доступен только в нативных движках
(Unreal/Unity) — в нашем стеке вместо него «масштаб рендеринга + повышение резкости» (как FSR 1).

## Общие правила для всех модулей
- Корень проекта — текущая папка. Node: `tools/node/node.exe`. Пакеты уже установлены: `three`, `sharp`, `geotiff`,
  `vite`, `electron`. **Не менять** `package.json`/`package-lock.json`, не запускать `npm install`, не запускать `git`.
- Писать **только свои файлы** (см. «Владение файлами»). Общие файлы (`src/game/main.js`, `globe.js`, `shaders.js`,
  `camera.js`, `index.html`, `game.html`, `electron/main.cjs`) — **только читать**; интеграцию делает главный поток.
- Сырые загрузки — только в `data/raw/<модуль>/`. Готовые данные — в `public/assets/<модуль>/`.
  Ничего вне проекта не трогать, ничего не удалять кроме своих временных файлов.
- Каждый модуль — ES-модули (`export`), без глобалов, детерминированный (seed), с тестами на `node:test`
  (`tests/<модуль>.test.mjs`, запуск: `tools/node/node.exe --test tests/`).
- Источники данных и лицензии дописывать в `data/sources/<модуль>.md` (свой файл, не общий ATTRIBUTION).

## Сетки и координаты
- **MAP-сетка**: равнопромежуточная 8192×4096, строка 0 = 90° с.ш., столбец 0 = 180° з.д. (как `cells.bin.gz`).
- **SIM-сетка** (климат/погода/бедствия): 720×360, шаг 0,5°, та же ориентация, `cell = y*720 + x`,
  центр ячейки: `lon = -180 + (x+0.5)*0.5`, `lat = 90 - (y+0.5)*0.5`.
- Единичный вектор точки: `(cos(lat)·sin(lon), sin(lat), cos(lat)·cos(lon))` (как `src/game/camera.js`).

## Календарь и время (`src/sim/calendar.js`, `src/sim/clock.js`)
- Астрономическая нумерация лет (год 0 = 1 г. до н.э., −4999 = 5000 г. до н.э.), пролептический григорианский календарь.
- Игровое время `t` — **дни (float64) от −4999-01-01 00:00**. Конец мира: 2100-12-31.
- `calendar`: `toDate(t)` → `{year, month(1-12), day(1-31), hour, minute, dayOfYear}`, `fromDate(y,m,d,h=0)`,
  `isLeap(y)`, `daysInMonth(y,m)`, `formatRu(t, level)` (`level`: 'year'|'month'|'day'|'hour'; «5000 г. до н.э.»,
  «12 марта 1066 г.», «14:00»), `eraOf(t)`.
- `clock`: скорости и шаг по эпохам (дефолт: до 2000 г. до н.э. скорость 1 = **1 месяц в секунду**, 1000 лет ≈ 200 мин;
  позже — недели, дни, часы). Пауза, 5 скоростей, события `onDay/onMonth/onYear`, детерминированный шаг.

## Климат (`src/sim/climate/`)
- Климатология: `public/assets/climate/normals.bin.gz` — Int16 `tavg[12][360][720]` (°C×10), Uint16 `prec[12][360][720]` (мм/мес),
  Int16 `elev[360][720]` (м), заголовок JSON `normals.json` (формат, источник).
- Биомы на MAP-сетке: `public/assets/climate/biome.bin.gz` — Uint8 8192×4096, классы в `biomes.json`
  (лёд, тундра, тайга, умеренный лес, степь/луг, средиземноморский, пустыня, полупустыня, саванна, тропический лес, болото, горы-высокогорье).
- Палеоклимат `paleo.js`: `globalDT(year)`, `regionalDT(year, lat, lon)`, `precipFactor(year, lat, lon)`
  (зелёная Сахара до ~3000 г. до н.э., средневековый оптимум, малый ледниковый период, потепление до 2100),
  `seaLevel(year)` (м к современному), `seaIceExtent(year, month, hemisphere)`. Плавно, без скачков.

## Погода (`src/sim/weather/`) — Web Worker
- Протокол: `init({normals, seed, t})` → `step({t})` → ответ
  `{t, grid: Uint8Array(720*360*4) /* R снег 0-255, G облачность/осадки, B аномалия T (128=0), A засуха */, events[]}`.
- `events`: `{type:'snowstorm'|'heatwave'|'coldwave'|'drought'|'flood'|'storm'|'wildfire', t0, t1, cell, lat, lon, severity 1-5}`.
- Снег — суточная модель (накопление при T<0 и осадках, таяние); засуха — индекс осадков за 3–12 мес.
- `serialize()`/`deserialize()` для сохранений. Журнал паттернов `climateLog` — по «провинциям» 5°×5°: средняя T, осадки,
  засухи, суровые зимы по годам (компактно) — для будущего населения.

## Бедствия (`src/sim/hazards/`)
- Данные `public/assets/hazards/`: вулканы и извержения (GVP), значимые землетрясения и цунами (NOAA NCEI), падения
  метеоритов (NASA). Компактные JSON/бинарь.
- Шкала землетрясений по ТЗ: уровень 1 = 2–4 балла, 2 = 4–6, 3 = 6–8, 4 = 8–10, 5 = >10.
- `hazardLevels`: на SIM-сетке — максимальный ожидаемый уровень землетрясения, цунами, вулканическая опасность.
- `scheduler.eventsBetween(t0, t1)` → `{type:'eruption'|'earthquake'|'tsunami'|'meteorite'|'landslide', t, lat, lon, magnitude, vei, level, name, documented}`;
  после 2026 г. и для слабо задокументированной древности — стохастика по частотам, детерминированная по seed.

## Графические модули (подключаются главным потоком)
Класс с `constructor(scene, globe)`, `update(gcam, timeSec)`, `setVisible(bool)`, `dispose()`.
Геометрия на глобусе — через GLSL-чанк `COMMON` из `src/game/shaders.js` (`morphPos`, `geoToUV`, униформы
`globe.shared`), как у рек в `RIVER_VERT`. Палитра — `src/shared/palettes.js`.
- `src/game/fx/currents.js` + `public/assets/ocean/currents.json` — течения (тёплые/холодные), анимированные частицы.
- `src/game/fx/labels.js` + `public/assets/labels/zones.json` — подписи природных зон в духе EU4: одна крупная
  подпись на зону, растёт с приближением, идёт по изгибу зоны, не ломается из-за мелких вкраплений.
- `src/game/fx/events.js` — лёгкие эффекты: извержение, землетрясение, цунами, метеорит, пожар.

## Районы и дороги (`scripts/bake-regions.mjs`)
- Природные районы ~100 км (между реками, горные массивы отдельно, озёра отдельно) + морские зоны.
- `public/assets/regions/districts.bin.gz` — Uint16 8192×4096; `regions.json` — таблица районов (центр, площадь,
  тип, соседи, имя), группировка в провинции (~500 км) и регионы (~1000 км).
- Дороги: `public/assets/regions/roads.bin.gz` — Float32 `[lon,lat,…]` ломаные + индекс; путь между центрами
  соседних районов по рельефу (дешевле по равнинам, дороже через горы и реки).

## Сохранения (`src/save/`)
- Формат: заголовок `PSAV` + версия игры + версия формата + JSON-метаданные + разделы (типизированные массивы),
  сжатие gzip (CompressionStream), миграции по версии формата. Автосохранение раз в N минут, кольцо из K слотов.
- Хранилище: в Electron — файлы в `userData/saves` через IPC (`electron/saves.cjs`), в браузере — IndexedDB.

## Владение файлами (кто что пишет)
| Модуль | Файлы |
|---|---|
| climate | `scripts/climate/**`, `src/sim/climate/**`, `public/assets/climate/**`, `data/raw/climate/**`, `tests/climate*.mjs`, `data/sources/climate.md` |
| weather | `src/sim/weather/**`, `tests/weather*.mjs` |
| hazards | `scripts/hazards/**`, `src/sim/hazards/**`, `public/assets/hazards/**`, `data/raw/hazards/**`, `tests/hazards*.mjs`, `data/sources/hazards.md` |
| currents | `src/game/fx/currents.js`, `public/assets/ocean/**`, `tests/currents*.mjs`, `data/sources/ocean.md` |
| labels | `scripts/labels/**`, `src/game/fx/labels.js`, `public/assets/labels/**`, `tests/labels*.mjs`, `data/sources/labels.md` |
| regions | `scripts/bake-regions.mjs`, `scripts/regions/**`, `public/assets/regions/**`, `tests/regions*.mjs` |
| time-save | `src/sim/calendar.js`, `src/sim/clock.js`, `src/save/**`, `electron/saves.cjs`, `tests/time*.mjs`, `tests/save*.mjs` |
| главный поток | всё остальное (`src/game/main.js`, `globe.js`, `shaders.js`, UI, `electron/main.cjs`, лаунчер) |
