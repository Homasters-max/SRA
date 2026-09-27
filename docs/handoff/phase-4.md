# phase-4

## Цель

Закрыть фазу 4 приёмкой MVP ([13 §1](../13-roadmap.md), [ADR-0039](../adr/WARRANT-ADR-0039-vertical-slice.md) п. 8).
Change `rate-limiter` в slice прошёл три PR на v0.7.0, но не проверил `WAIT` (BL-59) и путь waiver ADR-0024 п. 4
(BL-63). Объём исправлений — [ADR-0040](../adr/WARRANT-ADR-0040-slice-fixes.md): Change `slice-fixes` → тег `v0.8.0`
→ pin-Change в slice руками maintainer'а → Change slice `rate-limiter-precision` → отчёт приёмки.

## Готовый запрос

```text
Поток phase-4. Change WARRANT slice-fixes по ADR-0040 (п. 1–6): артефакты в новом worktree ветки spec/slice-fixes
(proposal, delta specs — REQ-ENF-002, warrant unknown, gate blocking-unknowns-resolved, ref DECISION в warrant ci,
ForgePort, схема change-record/1; design с контрактом warrant unknown по навыку cli-contract; tasks — пять групп
п. 1), затем spec-PR навыком change-spec-pr. Архитектурный аудит — по снимку
docs/process/audits/2026-09-26-phase-4c.md (решение maintainer'а 2026-09-27: код CLI после v0.7.0 не менялся).
```

## Открытые вопросы

- Нет: решения grilling — ADR-0040 (N59–N66).

## Не забыть

- После archive-PR `slice-fixes`: тег `v0.8.0`, `npm link` из основного checkout; pin-Change в slice — maintainer
  руками (ADR-0040 п. 7), затем сессия slice на `rate-limiter-precision` (п. 8) и отчёт приёмки в строке 4c 13 §2.
- Сессия slice — отдельная сессия Claude Code в `D:/project/warrant-slice`; навыки WARRANT туда не копируются
  (ADR-0039 п. 3), нехватка подсказки — failure mode строкой backlog.
- `npm test` целиком на Windows падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
