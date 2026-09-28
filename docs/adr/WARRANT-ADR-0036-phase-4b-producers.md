---
id: WARRANT-ADR-0036
title: Нарезка 4b / 4c — producers раньше CI; evidence review привязана к дереву spec, а не к коммиту
adr_state: ACCEPTED
date: 2026-09-25
supersedes: []
amends: [WARRANT-ADR-0034]
---

## Context

[ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md) п. 6 ставит после 4a один Change 4b: `skill-result/1`, `run submit`, `analyze`, `warrant ci`, producers `analyze-clean` и `adversarial-review`. Выход — два критерия: (1) verdict impl-PR без ручного переноса artifact'а; (2) новые Changes без пары waivers `analyze-clean` / `adversarial-review`. Это около семи новых команд и схем, `ForgePort` на настоящем GitHub, `subject.tree` и сверка дерева в `transition MERGED` — spec-PR, который ADR-0034 (Alternatives, «один Change на фазу») отверг по размеру. У двух критериев общая зависимость одна: сборщик записи evidence (аудит [2026-09-25-phase-4a](../process/audits/2026-09-25-phase-4a.md), A-23).

Второе — допустимость evidence review. Пред-фильтр D-12 ([06 §3](../06-verification.md), REQ-VER-003) признаёт запись, только если `subject.commit` и `subject.base_commit` совпадают с оцениваемыми. Gate `adversarial-review` судится на `SPECIFIED → APPROVED` — первым коммитом impl-PR ([ADR-0011](WARRANT-ADR-0011-pr-topology.md) п. 3), а review spec по смыслу делается до approval, в spec-PR. Запись review из spec-PR на коммите approval всегда `STALE`; review «непосредственно перед `transition APPROVED`» лишает maintainer'а review при утверждении и переносит правку spec после `BLOCKER` в impl-PR. Review — отзыв о spec: он устаревает, когда меняется spec, а не когда появляется коммит.

Решение принято grilling'ом 2026-09-25 (N18–N26) по аудиту 2026-09-25-phase-4a.

## Decision

1. **4b делится на два Change** (N18), producers первыми:
   - **`phase-4b` — producers.** Первой группой — находки аудита A-24, A-23, A-25 с A-27 и строки `evidence-status`, `attestation-type` реестра `enums` ([ADR-0030](WARRANT-ADR-0030-module-boundaries.md)); затем `skill-result/1`, `run start --operation review`, `run submit`, `warrant analyze`, gates `analyze-clean` и `adversarial-review` (Claude-субагент `warrant-reviewer`, ADR-0034 п. 10); A-26 — с тестами `run submit`. Критерий выхода (N26): e2e без настоящего `claude` — Change фикстуры проходит `SPECIFIED → APPROVED` с `adversarial-review` `PASS` по evidence `run submit` и `VERIFYING → MERGED` с `analyze-clean` `PASS` без waivers; контракт субагента — на записанном входе Claude Code.
   - **`phase-4c` — CI.** `ForgePort` (ADR-0034 п. 9), `warrant ci` (п. 11–13), `ci fetch` (п. 14), `subject.tree` (R-12), specs через archive по record (R-16), `FRONTEND_HOOKS_INACTIVE` в отчёте `ci` (BL-7), BL-12. Свой grilling после архива 4b. Условие приёмки 4b по dogfooding: spec-PR 4c — первый в репозитории без пары waivers.
   - Порядок ADR-0034 п. 6 становится: `core-seams` → 4a → 4b → 4c → slice.
2. **`analyze-clean` — вычисляемый gate, не evidence** (N19). L0-калькулятор gate и команда `warrant analyze <change>` зовут одну функцию `core/analyze`; команда — отчёт без записи. Анализ детерминирован, CI его пересчитывает ([06a](../06a-evidence.md)), а operation не порождает своего файла ([01](../01-principles.md)).
3. **Evidence review привязана к дереву spec** (N21). Запись `kind: review` несёт `subject.spec_tree` — hash набора `{proposal.md, specs/**}` каталога Change, того же и тем же способом, что сравнивает `spec-approved` ([ADR-0024](WARRANT-ADR-0024-spec-approved-contract.md)). Для записи с `subject.spec_tree` пред-фильтр сравнивает дерево spec на оцениваемом коммите вместо `subject.commit` и `subject.base_commit`; остальные правила D-12 (`threshold`, `scoped:`, waivers) действуют. Review делается в spec-PR до `transition SPECIFIED`, его запись едет в spec-PR; на `SPECIFIED → APPROVED` `scope-valid` допускает свой каталог evidence Change.
4. **Статус evidence review выводит CLI** (N22; skill `evidence_status` не выносит, [07 §4](../07-skills.md)): `run_state: SUCCEEDED` и ни одной находки `BLOCKER` → `PROVEN`; есть `BLOCKER` → `NOT_PROVEN`; `FAILED` или `CANCELLED` → `INCONCLUSIVE`. «Blocking findings закрыты» ([06 §4](../06-verification.md)) — в последнем review нет `BLOCKER`; `MAJOR` информирует maintainer'а и не блокирует.

## Consequences

- ADR-0034 п. 6: строка 4b заменяется п. 1; п. 9, 11–14 исполняет 4c, п. 10 — 4b. Остальные пункты не меняются.
- Спецификация: [06](../06-verification.md) §3 — исключение пред-фильтра для `subject.spec_tree`; [06a](../06a-evidence.md) — поле `subject.spec_tree`; delta specs `verification` (REQ-VER-003) и `enforcement` — в Change 4b. Схемы: `evidence/1` — `subject.spec_tree` (минорная правка), `run/1` — операция `review`, `skill-result/1` — новая.
- Решения 4b без нормы — строками design.md Change 4b: правила `analyze` MVP (`UNSATISFIED`, `CONFLICT`, `ORPHAN` из упоминаний REQ/SCN в `tasks.md` и SCN в `paths.tests`; `ORPHAN` — по diff Change) (N20); `run submit` только для Run `review` с пустым `write_scope`, схема — envelope 07 §4 целиком, `dismissed[]` — later (N23); `.claude/agents/warrant-reviewer.md` — цель `sync` адаптера `claude`, в этом репозитории — копия, совпадение держит тест, так как guard здесь не включается (ADR-0034 п. 4) (N24).
- Сам spec-PR 4b ещё закрывает `analyze-clean` и `adversarial-review` парой waivers: producers появляются в нём же.
- [13-roadmap](../13-roadmap.md): строки 4b и 4c вместо 4b. [backlog](../backlog.md): «Куда» BL-2, BL-3, BL-13 — 4b; R-12, R-16, BL-7, BL-12 — 4c.

## Alternatives

- **Один Change 4b** (ADR-0034 п. 6) — отвергнуто: spec-PR на ~7 команд, два критерия без общей зависимости, кроме A-23; 4c после 4b проходит свой spec-PR настоящим review.
- **CI первым** — отвергнуто: `ForgePort` и настоящий GitHub дороже, а producers опираются на свежий Run 4a и сразу снимают waivers со следующего Change.
- **`analyze` пишет evidence** — отвергнуто: пред-фильтр по коммиту, `requires_evidence` в pack и шаг «запусти analyze перед verify» без прироста доверия: запись локальная, CI пересчитывает.
- **Review привязан к коммиту** (как сейчас) — отвергнуто: maintainer утверждает spec, не видя review, `BLOCKER` после merge spec-PR правит spec в impl-PR.
- **Review на `SPECIFIED` вместо `APPROVED`** (gate на переходе spec-PR) — отвергнуто: меняет таблицу gates ([04](../04-lifecycle.md), pack `core-sdd`) ради того, что даёт привязка к дереву; approval остаётся местом, где человек читает review.
- **`MAJOR` блокирует** — отвергнуто: gate L2 стал бы вето модели; решение по `MAJOR` — за maintainer'ом.
