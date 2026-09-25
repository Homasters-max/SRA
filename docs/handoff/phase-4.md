# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: `core-seams` и `phase-4a`
(Run, guard, адаптер `claude`) закрыты → Change `phase-4b` (producers gates, `warrant ci`) → slice в отдельном
репозитории. Выход 4b: verdict impl-PR без ручного переноса artifact'а, новые Changes без пары waivers.

## Готовый запрос

```text
Шаг 1 — Change phase-4b до spec-PR. Снимок аудита 2026-09-25-core-seams старше тега v0.5.0 — аудит обязателен:
навык architecture-audit (--against docs/process/audits/2026-09-25-core-seams.json), затем repo-hygiene. Прочитай
ADR-0034 п. 6, 9–14, ADR-0010, ADR-0014 п. 3, ADR-0020, архив openspec/changes/archive/2026-09-25-phase-4a/
(design — I-156…I-165), backlog: BL-2, BL-3, BL-7, BL-9, BL-12, BL-13, R-12, R-16, A-5, A-19, BL-35…BL-38.
Grilling нарезки 4b (skill-result/1, run submit, analyze, warrant ci, ForgePort, producers analyze-clean и
adversarial-review — субагент warrant-reviewer); затем openspec-propose и change-spec-pr в ветке spec/phase-4b.
```

## Открытые вопросы

нет

## Не забыть

- Сдача результата `warrant-reviewer` — строкой `I-N` в 4b (ADR-0034 п. 10); зонд 2.1.263: deny действует до
  `PreToolUse`, `additionalContext` `PreToolUse` доходит только после результата; кандидат — хук во frontmatter
  субагента, из Bash только `warrant run submit`.
- Фикстуры Claude Code — `test/contract/fixtures/claude/2.1.263/`; `probe-hooks.js` перезаписывает их и вычищает путь
  профиля; NotebookEdit в сценарии зонда требует предварительного Read.
- Sample-проект slice — `Homasters-max/warrant-slice` (Python + pytest), создаёт maintainer до slice.
- Правка delta specs в impl-PR после approval закрывается waiver'ом на `spec-approved` (ADR-0024 п. 4, как WAV-2026-013).
- Субагенты под `PreToolUse deny` (ADR-0031): хук отклоняет любой grep по `packages/`, в том числе по JSON-фикстурам, —
  в промпте разрешать инструмент Grep для не-кода.
