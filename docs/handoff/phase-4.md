# phase-4

## Цель

Закрыть фазу 4 приёмкой MVP ([13 §1](../13-roadmap.md), ADR-0039 п. 8). Change `slice-fixes` архивирован, CLI
`v0.8.0`. Дальше: pin-Change в slice руками maintainer'а → Change slice `rate-limiter-precision` → отчёт приёмки в
строке 4c 13 §2.

## Готовый запрос

```text
Поток phase-4. Change slice-fixes архивирован, тег v0.8.0. Проверь, что maintainer провёл pin-Change в
D:/project/warrant-slice (ADR-0040 п. 7): тег v0.8.0 в warrant.yml, permissions += issues: read, kernel "0.8",
warrant sync, текст process.json (warrant unknown add | resolve, путь waiver ADR-0024 п. 4). Не проведён —
спроси maintainer'а, что мешает, и остановись.
Проведён — готовый запрос для сессии slice на rate-limiter-precision (ADR-0040 п. 8): spec-PR с blocking
UNKNOWN (unknown add --blocking → WAIT → комментарий maintainer'а → unknown resolve --as decision --ref),
review spec, при MAJOR — путь waiver в impl-PR. Затем отчёт приёмки в строке 4c docs/13-roadmap.md §2:
что проверено (WAIT, решение через warrant ci, путь waiver), что — руками maintainer'а (bootstrap, pin-Change).
Отдельно — process-PR: BL-31 (триггер наступил в CI #70), BL-72 (ci.md: Re-run всего run), BL-74 (--by у MERGED
в change-archive-pr при gate human-approval).
```

## Открытые вопросы

- нет

## Не забыть

- Сессия slice — отдельная сессия Claude Code в `D:/project/warrant-slice`; навыки WARRANT туда не копируются.
- Форма установки CLI в slice — `npm pack github:Homasters-max/SRA#v0.8.0` → `npm i -g ./<tgz>` (BL-52).
- `npm test` целиком на Windows падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- Impl-PR с красным Windows по таймауту — Re-run всего run, не `--failed`: иначе `ci fetch` без evidence (BL-72).
