# phase-4

## Цель

Фаза 4 — MVP frontend ([13 §2](../13-roadmap.md), строка 4): `sync`, `run`, `guard`, `validate --files`, `analyze`,
`warrant ci`, первый адаптер frontend. Предложение maintainer'а (2026-09-25): первым — адаптер `claude` (ADR-0023
п. 4), `codex` и `opencode` — позже тем же контрактом `guard`. Первый шаг — аудит и grilling нарезки; процесс —
навыки ADR-0033 (`git-start`, `git-land`, `change-*`, `review-impl`, `cli-contract`).

## Готовый запрос

```text
Гигиена и аудит сделаны 2026-09-25: docs/process/audits/2026-09-25.md (снимок .json рядом). Открытые A-N из
backlog.md — вход grilling'а: P1 — A-14 (предикат waiver в 2 копиях), A-15 (warrant.json без типа; paths.tests,
диапазон pack), A-16 (git-префикс и glob в копиях — guard добавит ещё); P2 — A-5, A-9 (реестр проверок до
validate --files), A-17 (фабрика CliError), A-18 (помощники тестов); P3 — A-8, A-12. Решить, что из P1 чинится
первой группой фазы 4, а что — отдельным Change до неё.
Grilling по нарезке фазы 4 (MVP frontend). Прочитай: строки docs/backlog.md с «Куда: фаза 4»,
docs/13-roadmap.md (§2 строка 4, §3 S8), ADR-0017…0020, ADR-0022, ADR-0025 (новые команды — сразу с тестами app
через Ctx; новый внешний вызов — метод порта + адаптер + фейк + сценарий контракта), ADR-0029 и ADR-0031 (поиск по
коду субагентов — cs impact / cs deps; нарушение по входу вызова — deny). Факты о хуках Claude Code, проверенные
зондом (субагенты, additionalContext, SubagentStart, PreToolUse deny), — docs/process/graft-audit.md §4: вход к
решению об адаптере claude (ADR-0023 п. 4, ADR-0014, backlog BL-20). Вопросы раунда 1:
(0) первый frontend MVP — адаптер claude вместо codex (рекомендация: да — hooks проверены зондом, S5 закрыт,
codex не установлен): новый ADR меняет ADR-0018 п. 7 и критерий выхода ADR-0013 («slice проходит frontend под
hooks»), реализует ADR-0023 п. 4; правки 13 §2 строки 4 и 7, §3 S8; BL-8 / BL-15 — за S8, BL-20 — в фазу 4.
Переход на codex / opencode держать открытым: логика только в guard (нормализованное событие ADR-0018 п. 2),
адаптер — перевод родного JSON, у каждого адаптера — сценарий контракта на записанном родном входе;
FRONTEND_HOOKS_INACTIVE, guard_events[] и sync — без имени frontend вне генератора адаптера;
(1) spike S8 (hooks Codex под codex-acp и codex exec) — при (0) = claude откладывается до адаптера codex;
иначе — отдельной сессией до spec фазы 4 (codex на машине maintainer'а не установлен);
(2) нарезка: 4a без привязки к frontend (run/1, skill-result/1, run start/submit, guard pre/post, guard_prefixes,
validate --files, analyze, warrant ci) и 4b — первый адаптер (claude: .claude/settings.json, AGENTS.md,
FRONTEND_HOOKS_INACTIVE, slice; или codex после S8: .codex/hooks.json, codex --version) — или один Change;
(3) warrant ci ходит в GitHub API — ForgePort и как держать его контракт (настоящий GitHub в CI с токеном или
записанные ответы, которые ADR-0025 отверг для OpenSpec);
(4) где живёт sample-проект slice (Python + pytest, ADR-0013);
(5) producers analyze-clean / adversarial-review — до 2026-12-31 (срок waivers WAV-2026-001…008); при (0) =
claude — независимость review (Q7: spec пишет Claude, проверяет Codex): unattested review тем же семейством в MVP,
review через opencode с моделью другого семейства или codex exec только для review (без hooks, без S8); headless
claude -p с JSON по схеме — проверить зондом;
(6) контракт CLI новых команд — линза cli-contract (ADR-0033 п. 8): --dry-run у transition / archive / waive, поле
подсказки у WarrantError.
После раунда — сводка решений, затем ADR / нарезка в 13 §2 и этот файл на отдельной ветке.
```

## Открытые вопросы

- Вопросы (0)–(6) раунда 1 — в готовом запросе.

## Не забыть

- Субагенты работают под `PreToolUse deny` (ADR-0031): отказ хука, мешавший законной работе, — в `notes` карточки
  группы и maintainer'у.
- Пока нет producer'ов `analyze-clean` / `adversarial-review` (backlog BL-2), каждый Change получает пару waivers в
  spec-PR — образец `WAV-2026-007` / `008` (`arch-boundaries`), срок 2026-12-31.
