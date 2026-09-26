# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md): `phase-4a`, `phase-4b` закрыты → Change `phase-4c` (CI:
ForgePort, `warrant ci`, `ci fetch`, `subject.tree`) → slice в отдельном репозитории.

## Готовый запрос

```text
Spec-PR Change phase-4c: аудит сделан — docs/process/audits/2026-09-26-phase-4b.md (коммит 2903a89 в spec/phase-4c,
worktree D:/project/SRA-phase-4c; продолжать в нём, второй не открывать). Дальше навыки grilling → openspec-propose →
change-spec-pr, линзы cli-contract и software-architect. Прочитай отчёт аудита (§3 находки, §3.4 наблюдения для 4c),
ADR-0034 п. 9, 11–14, ADR-0036 п. 1, архив openspec/changes/archive/2026-09-26-phase-4b/design.md (I-166…I-170).
Вход grilling'а — строки backlog с «Куда» 4c: R-12, R-16, R-21, BL-7, BL-12, BL-26 (SCN-SDD-001), BL-40
(REQ-KRN-033), BL-42, BL-43, I-169, и A-28 (P1, subject evidence — subjectOf), A-29 (P1, правила MERGED из
commands/transition.ts), A-30 (P3) — первой группой 4c. Вопрос maintainer'у из §3.4: STALE — причина пред-фильтра
(как сейчас) или пятый статус evidence (строка enums). Review spec — субагентом warrant-reviewer (шаг навыка
change-spec-pr) до transition SPECIFIED: это приёмка 4b по dogfooding — spec-PR 4c первый без пары waivers.
```

## Открытые вопросы

нет

## Не забыть

- Перед review субагентом — `npm link` в worktree: хук frontmatter `warrant-reviewer` зовёт `warrant` с `PATH`, без него
  хук падает и не блокирует (Risks design 4b).
- Guard при Run `review` пропускает только строгую форму `warrant run submit [--dry-run] [--file <path>]` и heredoc
  (ревью 4b): `< file`, `2>&1`, `bash -lc` — `deny`.
- I-169: `paths.tests` репозитория не задан — `analyze-clean` без тестовой половины; решение продукта — до spec-PR 4c.
- Sample-проект slice — `Homasters-max/warrant-slice` (Python + pytest), создаёт maintainer до slice.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-37) — прогонять уровни по очереди.
