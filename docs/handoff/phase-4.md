# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: process-PR
инструментов аудита → Change `core-seams` (3e) → 4a (Run, guard, адаптер `claude`) → 4b (producers, `warrant ci`) →
slice в отдельном репозитории. Grilling нарезки закрыт 2026-09-25 (N1–N17), ADR-0034 и ADR-0035 приняты.

## Готовый запрос

```text
Шаг 1 — process-PR (ветка process/audit-tools, навыки git-start / git-land), ADR-0034 п. 6, §5 п. 3–4 отчёта
docs/process/audits/2026-09-25.md: (a) scripts/dev/arch-snapshot.js зовёт `cs callers` с `--in <dir>` — срезы
перестают терять `evaluate`; случай — в регрессию Graft (scripts/dev/graph-audit.js); (b) scripts/dev/hygiene.js —
находка `audit-stale`: снимок аудита устарел при > N изменённых файлов packages/cli/src после коммита снимка или новом
модуле (N — предложить maintainer'у). Тесты скриптов — по образцу соседних.
Шаг 2 — Change core-seams (строка 3e 13 §2; навык change-spec-pr, образец — архив arch-boundaries): skip_specs,
CLI 0.4.2 → 0.4.3 первой задачей, пара waivers analyze-clean / adversarial-review (образец WAV-2026-007 / 008, срок
2026-12-31) в теле spec-PR. Группы: A-15 (WarrantConfig), A-16 (toProjectPaths, pathMatcher, core/glob.ts), A-14
(countingWaiverIds), A-17 + A-8 (cliError, findChangeDir), A-18 (test/helpers/git.ts), ADR-0035 (секции packages и
test_helpers в architecture.json), BL-26 (теги SCN). Отступления A-14 / A-15 — строками I-N. Прочитай: ADR-0034,
ADR-0035, ADR-0030, строки A-N в docs/backlog.md, §5 отчёта аудита.
```

## Открытые вопросы

- Порог N для `audit-stale` в `hygiene.js` (шаг 1).

## Не забыть

- Sample-проект slice — отдельный репозиторий (`Homasters-max/warrant-slice`, Python + pytest), создаёт maintainer
  до slice (ADR-0034 п. 7).
- 4b: сдача результата `warrant-reviewer` — строкой `I-N` после зонда; `SubagentStop` последний ответ не даёт,
  кандидат — хук `PreToolUse` во frontmatter субагента, из Bash только `warrant run submit` (ADR-0034 п. 10).
- 4a: dev-скрипт `scripts/dev/probe-hooks.js` перезаписывает фикстуры родного входа Claude Code (ADR-0034 п. 2).
- Субагенты работают под `PreToolUse deny` (ADR-0031): отказ хука, мешавший законной работе, — в `notes` карточки
  группы и maintainer'у.
- Пока нет producer'ов (BL-2, до 4b), каждый Change получает пару waivers в spec-PR, срок 2026-12-31.
