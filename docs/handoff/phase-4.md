# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md) и [ADR-0037](../adr/WARRANT-ADR-0037-phase-4c-ci.md): `phase-4a`,
`phase-4b` закрыты → Change `phase-4c` (CI: ForgePort, `warrant ci`, `ci fetch`, `subject.tree`) → slice в отдельном
репозитории.

## Готовый запрос

```text
Spec-PR Change phase-4c (ветка spec/phase-4c, worktree D:/project/SRA-phase-4c) — в SPECIFIED, PR открыт; жду «merge #N»,
затем навык change-impl-pr. Перед impl-PR решить строку BL-47 (4 MAJOR седьмого review: правка spec с новым review или
строки I-N в impl-PR). Review spec — 7 раундов субагентом warrant-reviewer (design.md «Review spec»), последний PROVEN
(EVID-01M3DY9C11RK1RVEMTK3AQPNN3); N44 сужен (ci не пересчитывает verdicts прошлых переходов), N48, N49 — design §1.
```

## Открытые вопросы

- BL-47: 4 MAJOR седьмого review — исправлять в spec до `APPROVED` (новый review) или решениями `I-N` в impl-PR.

## Не забыть

- `npm link` сделан из worktree `SRA-phase-4c`: глобальный `warrant` указывает туда; после удаления worktree — `npm link` из
  основного checkout.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
- BL-45: `classify` по diff spec-PR не видит путей реализации — `--paths` планом (как в `phase-4c`).
- Sample-проект slice — `Homasters-max/warrant-slice` (Python + pytest), создаёт maintainer до slice.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-37) — прогонять уровни по очереди.
