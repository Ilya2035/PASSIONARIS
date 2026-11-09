# Источники: подписи природных зон (модуль labels)

| Данные | Откуда | Лицензия | Где лежит |
|---|---|---|---|
| Природные регионы суши (горы, пустыни, плато, равнины, полуострова…) | Natural Earth 1:10m Physical Labels — `ne_10m_geography_regions_polys.geojson`, https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson | Public domain | `data/raw/labels/` |
| Моря, заливы, проливы, океаны | Natural Earth 1:10m Physical Labels — `ne_10m_geography_marine_polys.geojson`, https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_marine_polys.geojson | Public domain | `data/raw/labels/` |
| Точечные подписи (мысы, полюса) — скачаны на будущее, пекарем пока не используются | Natural Earth — `ne_10m_geography_regions_points.geojson`, https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_points.geojson | Public domain | `data/raw/labels/` |
| Шрифт подписей Alegreya SC (Medium, Medium Italic), кириллица + латиница | Huerta Tipográfica (Juan Pablo del Peral), https://raw.githubusercontent.com/google/fonts/main/ofl/alegreyasc/ (`AlegreyaSC-Medium.ttf`, `AlegreyaSC-MediumItalic.ttf`, `OFL.txt`) | SIL Open Font License 1.1 (текст лицензии лежит рядом со шрифтом) | `data/raw/labels/`, копия для игры — `public/assets/labels/fonts/` |
| Высота рельефа под подписью (`baseM`) | собственная карта игры `public/assets/map/height.delta.bin.gz` (см. `data/ATTRIBUTION.md`) | — | — |

Скачивание: `tools/node/node.exe scripts/labels/download-labels.mjs` (≈ 8 МБ).
Запекание: `tools/node/node.exe scripts/labels/bake-labels.mjs` → `public/assets/labels/zones.json` (≈ 0,35 МБ, ≈ 12 с).

## Правки исходных данных

- **Русские названия.** В Natural Earth поле `NAME_RU` есть почти везде, но часть значений взята из Wikidata
  с ошибками (например, «Sea Islands» → «гора Скотт», «Tatra» → «Кшемёнки-Закшувские», «CORD. CENTRAL» → «Кордильера-Бланка»).
  Все отобранные зоны просмотрены вручную; исправления и переводы для пустых `NAME_RU` — в `scripts/labels/zone-table.mjs`
  (таблица `RU`). Ударения (U+0301) удаляются, родовые слова пишутся со строчной («море Лаптевых», «хребет Черского»).
- **Английские названия.** Ошибочные `NAME_EN` («Grampian Mts.» → «Cruach nam Miseag», «Niger Delta» → «Enugu Nigeria»,
  «Península de Taitao» → «Taitailei», «AHAGGAR MTS.» → «Ahag», «APPENNINI» → «Appennino Ligure» и т. п.) исправлены там же (таблица `EN`).
- **Русские кальки.** «залив Дарнли-Бэй», «пролив Сено Отвэй» и подобные заменены на «залив Дарнли», «залив Отуэй» (таблица `RU`).
- **Отбор.** Только природные зоны: острова, побережья, континенты, перешейки и исторические/административные «Geoarea»
  (Нормандия, Белуджистан, Аляска, земли Гренландии и Антарктиды и т. п.) не подписываются. Стран нет.
- **Вырожденные полигоны (документированный запасной вариант).** В Natural Earth 1:10m часть проливов нарисована
  «щепками» нулевой площади, а три объекта сломаны:
  - море Скоша — 8 вершин возле о. Элефант вместо моря, Лусонский пролив — 4 вершины, пролив Дрейка — набор щепок:
    для них линия подписи задана вручную (`MANUAL_PATH` в `zone-table.mjs`), в `zones.json` помечены `"fallback":"manual"`;
  - пролив Лаперуза, Баб-эль-Мандебский пролив, пролив Карские Ворота и залив Святой Елены — щепки вдоль берегов,
    главная ось которых шла *поперёк* пролива, с концами на суше (или на 120 км вдоль берега за пределы залива):
    линия задана вручную вдоль водного прохода, каждая точка проверена по сетке суши/воды самой игры
    (`public/assets/map/cells.bin.gz`), тоже `"fallback":"manual"`;
  - Гибралтарский пролив, Юкатанский пролив, залив Мапуту — щепки, которые обводят место подписи: линия строится
    по главной оси их вершин, помечены `"fallback":"sliver"`.
- **Cape York Peninsula** отбрасывалась фильтром мысов («Cape …»); теперь фильтр пропускает полуострова.
- Объекты с одинаковым именем, разрезанные по 180-му меридиану (Трансантарктические горы, горы Королевы Мод, Чукотское море…),
  склеиваются в одну зону; далеко разнесённые одноимённые объекты (две ветви Великого рифта) остаются отдельными подписями.
