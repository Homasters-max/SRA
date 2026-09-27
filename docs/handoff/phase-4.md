# phase-4

## Цель

Закрыть фазу 4 приёмкой MVP ([13 §1](../13-roadmap.md), [ADR-0039](../adr/WARRANT-ADR-0039-vertical-slice.md) п. 8).
Change `rate-limiter` в slice прошёл три PR на v0.7.0, но не проверил `WAIT` (BL-59) и путь waiver ADR-0024 п. 4
(BL-63). Остались: Change WARRANT по отказам slice → тег и pin в slice → второй малый Change slice → отчёт приёмки.

## Готовый запрос

```text
Поток phase-4, worktree D:/project/SRA-phase-4, ветка process/phase-4. Grilling объёма Change WARRANT по
отказам slice (навык grilling). Прочитай: ADR-0039 (п. 5, 7, 8), ADR-0024 п. 4, ADR-0034, строки docs/backlog.md
с источником slice (BL-56…BL-65) и A-31…A-37, аудит docs/process/audits/2026-09-26-phase-4c.md — снимок
актуален: код CLI после v0.7.0 не менялся, повторный аудит не нужен. Вопросы раунда 1:
(1) BL-59 — команда записи и закрытия UNKNOWN: classify --propose с unknowns[] или отдельная warrant unknown;
(2) BL-63 — design.md и delta spec в IMPLEMENTING под guard: write_scope операции implement или операция amend;
    пересмотр ADR-0024 п. 4 для проектов под guard;
(3) объём: в тот же Change мелкие BL-56, BL-58, BL-60, BL-61, BL-64 или отдельный fix-Change; BL-57 — до
    первого Change slice, правящего .warrant/local/**;
(4) BL-65 — решение maintainer'а: убрать --by у MERGED из AGENTS.md (sync) и навыка change-archive-pr или gate
    human-approval на VERIFYING->MERGED;
(5) правит ли Change core/ci — тогда первой группой A-31 + A-32 (ADR-0039 п. 7);
(6) версия после Change (0.7.x или 0.8.0) и смена pin в slice — Change factory-change там (ADR-0039 п. 5).
После раунда — сводка, ADR, Change WARRANT навыками change-spec-pr → change-impl-pr → change-archive-pr, тег,
pin и npm link. Затем передача сессии slice на второй малый Change (WAIT по blocking UNKNOWN, текст spec
rate-limiter по F-1 через путь waiver) и отчёт приёмки в строке 4c 13 §2: guard_events[] без обойдённых deny,
нет FRONTEND_HOOKS_INACTIVE, refs переходов в CI, WAIT и waiver.
```

## Открытые вопросы

- BL-65: `--by` у `MERGED` — убрать из текстов или добавить gate `human-approval`.
- BL-52: форма установки CLI (`npm i -g github:…#<тег>` в ADR против `npm pack` по факту) — новый ADR до второго
  проекта под WARRANT; в этот Change или отдельно.

## Не забыть

- Глобальный `warrant` — `npm link` из основного checkout на теге; после нового тега — pin в workflow slice и
  `npm link` одной версии.
- Сессия slice — отдельная сессия Claude Code в `D:/project/warrant-slice`; навыки WARRANT туда не копируются
  (ADR-0039 п. 3), нехватка подсказки — failure mode строкой backlog.
- `npm test` целиком на Windows падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
