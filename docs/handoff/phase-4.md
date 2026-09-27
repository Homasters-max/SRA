# phase-4

## Цель

Закрыть фазу 4 приёмкой MVP ([13 §1](../13-roadmap.md), ADR-0039 п. 8). Change `slice-fixes`
([ADR-0040](../adr/WARRANT-ADR-0040-slice-fixes.md)) в `SPECIFIED` → impl-PR → archive-PR, тег `v0.8.0` → pin-Change в
slice руками maintainer'а → Change slice `rate-limiter-precision` → отчёт приёмки в строке 4c 13 §2.

## Готовый запрос

```text
Поток phase-4. Проведи impl-PR Change slice-fixes навыком change-impl-pr (spec-PR —
https://github.com/Homasters-max/SRA/pull/68, слит). Перед первой раздачей групп — навык change-coordinate.
Прочитай openspec/changes/slice-fixes/ (design §1–§9, tasks — группы 1–6), ADR-0040, строку BL-67 docs/backlog.md.
Review 2 spec — PROVEN с MAJOR (BL-67): исправить в этом impl-PR путём ADR-0024 п. 4 — строки I-N в design.md
(навык decision), правка delta spec, waiver spec-approved через warrant waive; активирует maintainer по слову в PR.
F-1 — решение maintainer'а: RECORD_MISMATCH, если PR после SPECIFIED удаляет или ослабляет элемент unknowns[]
базы (ADR-0040 п. 3). F-2, F-3, MINOR F-4…F-7 и F-9 — по BL-67; F-8 — по failure mode.
Контракт ForgePort.comment (задача 3.3) — объекты PR #68: issuecomment-5856576133 и
pullrequestreview-5330605727 (автор Homasters-max, текст содержит UNK-KRN-999).
Merge — по «merge #N»; затем change-archive-pr, тег v0.8.0, npm link из основного checkout.
```

## Открытые вопросы

- нет

## Не забыть

- После тега `v0.8.0` pin-Change в `warrant-slice` делает maintainer руками (ADR-0040 п. 7): тег в `warrant.yml`,
  `permissions` += `issues: read`, `kernel: "0.8"`, `warrant sync`, текст `process.json` (без `--by` у `MERGED`,
  `warrant unknown`, путь waiver); затем сессия slice на `rate-limiter-precision` (п. 8).
- Сессия slice — отдельная сессия Claude Code в `D:/project/warrant-slice`; навыки WARRANT туда не копируются.
- `npm test` целиком на Windows падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки;
  `warrant run submit` субагент зовёт из worktree (`cd <worktree> &&`).
