# phase-4

## Цель

Фаза 4 — MVP frontend Codex ([13 §2](../13-roadmap.md), строка 4): `sync`, `run`, `guard`, `validate --files`, `analyze`,
`warrant ci`, адаптер `codex` после S8. Первый шаг — аудит и grilling нарезки; процесс — навыки ADR-0033
(`git-start`, `git-land`, `change-*`, `review-impl`, `cli-contract`).

## Готовый запрос

```text
Сначала — навык repo-hygiene (ADR-0033 п. 13), затем architecture-audit по packages/cli/src (облегчённо —
packages/cli/test) со сравнением --against docs/process/audits/2026-09-24.json; находки — строками A-N в docs/backlog.md, отчёт и снимок — в
docs/process/audits/. Снимок 2026-09-24.json старше arch-boundaries (группы 2–5 меняли core) — снимок устарел,
аудит обязателен. Открытые A-N из backlog.md (A-5, A-8, A-9, A-12) — вход grilling'а.
Затем grilling по нарезке фазы 4 (MVP frontend Codex). Прочитай: строки docs/backlog.md с «Куда: фаза 4»,
docs/13-roadmap.md (§2 строка 4, §3 S8), ADR-0017…0020, ADR-0022, ADR-0025 (новые команды — сразу с тестами app
через Ctx; новый внешний вызов — метод порта + адаптер + фейк + сценарий контракта), ADR-0029 и ADR-0031 (поиск по
коду субагентов — cs impact / cs deps; нарушение по входу вызова — deny). Факты о хуках Claude Code, проверенные
зондом (субагенты, additionalContext, SubagentStart, PreToolUse deny), — docs/process/graft-audit.md §4: вход к
решению об адаптере claude (ADR-0023 п. 4, backlog BL-20). Вопросы раунда 1:
(1) spike S8 (hooks Codex под codex-acp и codex exec) — отдельной сессией до spec фазы 4? codex на машине
maintainer'а не установлен;
(2) нарезка: 4a без Codex (run/1, skill-result/1, run start/submit, guard pre/post, guard_prefixes, validate --files,
analyze, warrant ci) и 4b после S8 (адаптер codex, .codex/hooks.json, AGENTS.md, FRONTEND_HOOKS_INACTIVE,
codex --version, slice) — или один Change;
(3) warrant ci ходит в GitHub API — ForgePort и как держать его контракт (настоящий GitHub в CI с токеном или
записанные ответы, которые ADR-0025 отверг для OpenSpec);
(4) где живёт sample-проект slice (Python + pytest, ADR-0013);
(5) producers analyze-clean / adversarial-review — до 2026-12-31 (срок waivers WAV-2026-001…008);
(6) контракт CLI новых команд — линза cli-contract (ADR-0033 п. 8): --dry-run у transition / archive / waive, поле
подсказки у WarrantError.
После раунда — сводка решений, затем ADR / нарезка в 13 §2 и этот файл на отдельной ветке.
```

## Открытые вопросы

- Вопросы (1)–(6) раунда 1 — в готовом запросе.

## Не забыть

- Субагенты работают под `PreToolUse deny` (ADR-0031): отказ хука, мешавший законной работе, — в `notes` карточки
  группы и maintainer'у.
- Пока нет producer'ов `analyze-clean` / `adversarial-review` (backlog BL-2), каждый Change получает пару waivers в
  spec-PR — образец `WAV-2026-007` / `008` (`arch-boundaries`), срок 2026-12-31.
