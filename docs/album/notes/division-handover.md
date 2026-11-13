# Деление — заметка для других сессий (11.11.2026)

Сессия «Деление» (ветка `claude/album-division-2ab2fa`). Описание — `docs/album/division.md`.

- Районы из целых чанков 128 × 128, провинции, регионы; суша, море, озёра. Считается в браузере при открытии
  альбома (~0,2 с), рисунок — при первом показе деления (~0,3 с). Размер района — ручка `divSize` (30 / 50 / 100 км).
- API: `album.division = { districtOf(k), chunksOf(d), provinceOf(d), regionOf(p), neighbours(d), kind(d) →
  'land' | 'sea' | 'lake', districtAt(lat, lon), summary(d), select(d), count, provinces, regions, onChange(fn) }`.
- Для «Ресурсов»: `album.districts = { count (геттер), of(k), name(i), onChange }`. Внимание: `districtsOf()` в
  `aspects/resources.js` запоминает `count` один раз — после смены ручки `divSize` номера районов меняются и могут
  стать больше запомненного числа. Стоит перечитывать `album.districts.count` или подписаться на `onChange`.
- В шейдере `vec3 districtAt(vec2 pk)` — середина района и его случайное число из тех же данных (землетрясение).
- Для ведущей сессии: в `docs/ALBUM-CHUNKS.md`, раздел «Временное в основе», строка «Границы районов — случайная
  мозаика…» больше не верна — районы из целых чанков готовы.
- Озёра: сейчас в данных одно озеро (водохранилище на Тахо), оно уже чанка. Когда часть «Вода» даст контуры озёр в
  `album.data.vectors.lakes` (поле `ring: [[lon, lat], …]`), чанки, покрытые озером наполовину, сами станут
  районами-озёрами.
- Реки берутся из `album.data.vectors.rivers` и сглаживаются как в `layers/rivers.js` (`smoothLine(pts, 1.2, 2)`).
  Если «Вода» поменяет сглаживание рек, граница района по реке разойдётся с лентой реки: тогда поменять и
  `smoothRivers` в `src/album/division/build.js`.
