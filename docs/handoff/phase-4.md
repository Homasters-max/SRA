# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md) и [ADR-0037](../adr/WARRANT-ADR-0037-phase-4c-ci.md): `phase-4a`,
`phase-4b`, `phase-4c` закрыты → vertical slice по [ADR-0039](../adr/WARRANT-ADR-0039-vertical-slice.md) — критерий MVP
([13 §1](../13-roadmap.md)). Bootstrap `Homasters-max/warrant-slice` сделан корневым коммитом (`3430f5a`), клон —
`D:/project/warrant-slice`; находки bootstrap — BL-52…BL-55.

## Готовый запрос

Сессия slice — новая сессия Claude Code, открытая в `D:/project/warrant-slice` (hooks `warrant guard` из её
`.claude/settings.json`); `warrant --version` там — 0.7.0, как pin workflow:

```text
Проведи Change rate-limiter этого репозитория от intent до archive по процессу AGENTS.md — три PR, каждый шаг
только через warrant. Содержание: библиотека rate_limiter — token-bucket на stdlib с внедряемыми часами;
REQ «не больше N запросов за окно» и «пополнение со временем»; SCN «лимит исчерпан», «пополнение», «независимые
ключи»; blocking UNKNOWN — поведение при часах, идущих назад (решаю я); риск — от себя через
warrant classify --propose; тесты pytest с токеном SCN-… своего сценария. Merge PR делаю я. Начни со spec-PR и
остановись, когда PR открыт и job warrant прошёл, — дай ссылку. Отказ warrant или нехватку подсказки не обходи:
опиши failure mode (команда, вывод, чего не хватило).
```

После slice — в сессии WARRANT: failure modes — строками backlog с источником `slice`, исправления — Change WARRANT
(первым, что правит `core/ci`, — группа A-31 + A-32), отчёт приёмки по критерию 13 §1 — в строке 4c 13 §2
(ADR-0039 п. 7, 8).

## Открытые вопросы

- Форма установки CLI: ADR-0034 п. 7 и ADR-0039 п. 5 называют `npm i -g github:…#<тег>`, факт — BL-52 (workflow slice
  ставит через `npm pack`); уточнить новым ADR или по второму проекту.

## Не забыть

- Глобальный `warrant` — `npm link` из основного checkout (`D:/project/SRA`, `main` на `v0.7.0` + документы): после
  нового тега CLI — pin в workflow slice и `npm link` одной версии.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
- BL-45: `classify` по diff spec-PR не видит путей реализации — `--paths` планом.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- Review spec `PROVEN` с MAJOR — решение в impl-PR по ADR-0024 п. 4 (I-176), не новый раунд.
