# Ресурсы — заметка для других сессий (11.11.2026)

Сессия «Ресурсы» (ветка `claude/resources-728c8f`).

- Таблица ресурсов альбома: `public/assets/resources/album.json` + `album.bin.gz`, на той же сетке, что
  `src/album/chunks.js` (128 × 128 от (−88, 388), тот же номер чанка `k`). Мир: `world.*`, клетки 0,5°.
- Чтение, раскладка «неточных мест» по зерну и суммы — `scripts/resources/lib.mjs` (без Node, можно импортировать
  из кода альбома и игры): `openTable`, `withZones(table, zones, seed)`, `sumCells`.
- Часть альбома `src/album/aspects/resources.js` пишет 18 слоёв `album.chunks.layer(id).data` — ими может
  пользоваться любая часть (например, поселения — рыба и лес рядом).

**Для части «Деление»:** когда появятся районы из целых чанков, достаточно выставить
`album.districts = { count, of(k) → номер района, name(i) → строка }` — часть «Ресурсы» возьмёт их сама (сейчас у неё
временные районы 3 × 3 чанка).

Документы: `docs/RESOURCES.md`, `docs/album/resources.md`, источники — `data/sources/resources.md`.
