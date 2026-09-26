# Proposal: phase-4c

## Why

Решение о merge impl-PR до сих пор держится на ручном переносе: job `evidence` CI считает на head PR, а не на том, что
вливается в `main` (R-12). Maintainer вручную скачивает artifact и раскладывает записи в archive-PR (BL-12). Ref
подтверждения и CI-run проверяются только как URL (R-10). Правило «`openspec/specs/**` меняется только archive-PR» опознаёт
archive-PR по имени ветки (R-16). `warrant ci` из таблицы enforcement ([04 §6](../../../docs/04-lifecycle.md)) не существует.

Change 4c ([ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 9, 11–14,
[ADR-0036](../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 1, [ADR-0037](../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md))
делает CI последней инстанцией MVP. Выход: verdict impl-PR без ручного переноса artifact'а; spec-PR 4c — первый в
репозитории без пары waivers (приёмка 4b). Вход — аудит [2026-09-26-phase-4b](../../../docs/process/audits/2026-09-26-phase-4b.md):
A-28 и A-29 лежат ровно там, куда `subject.tree` и `ci fetch` добавили бы копии. Решения — grilling N29–N47 (ADR-0037 и
design.md).

## What Changes

- **Швы первой группой** (без изменения поведения):
  - общий читатель `subject` записи evidence рядом с писателем (A-28);
  - правила `MERGED` о CI-evidence — из `commands/transition.ts` в `core` (A-29).
- **`warrant ci [--base <sha>]`** — вердикт PR в CI, без записи в репозиторий (ADR-0010 п. 1). Вид PR и Change выводятся
  из diff record, а не из имени ветки (ADR-0034 п. 13). По видам PR:
  - **spec-PR** — правило путей (BL-42);
  - **impl-PR** — checks `VERIFYING->MERGED` на результате merge и вердикт;
  - **archive-PR** — проверка CI-evidence по ссылке: run, head, `conclusion`, повторное скачивание artifact'а; `openspec/specs/**`
    равны результату повтора archive (R-16);
  - **любой вид** — переходы из diff пересчитываются и сверяются с record, ref подтверждений проверяются через форж
    (`merged_by`, R-10).
  `FRONTEND_HOOKS_INACTIVE` — в отчёте (BL-7).
- **Evidence на результате merge** (R-12, ADR-0037 п. 2–4):
  - CI-запись несёт `subject.tree` — дерево результата merge; `subject.commit` остаётся head PR;
  - пред-фильтр допускает такую запись по дереву, несовпадение даёт `STALE` с `reason: "tree"`;
  - результат merge считает сам job, так что Re-run до merge лечит `STALE`; после merge — `workflow_dispatch` на
    merge-коммите.
- **`warrant ci fetch <pr> [--dry-run]`** — локальный шаг archive-PR (BL-12, ADR-0034 п. 14):
  - находит run слитого impl-PR, чьё evidence сделано на дереве merge-коммита;
  - проверяет run, скачивает artifact и кладёт записи в `<state>/evidence/<change>/`.
- **`transition MERGED`** (ADR-0037 п. 5):
  - `--ref` — URL impl-PR (ref `human-approval`, как у `APPROVED`);
  - правило «evidence одного CI-run» проверяется по `attestation.ref` записей, без флага;
  - дерево фактического merge-коммита судит записи с `subject.tree`.
- **`analyze` находит архивированный Change** (BL-43): повторная оценка `analyze-clean` на `MERGED->ARCHIVED` после
  `openspec archive` больше не `BLOCKED`.
- **`sync` без skill review** (BL-40, I-170): при `frontends ∋ "claude"` без `specification/adversarial-review` —
  находка `REVIEWER_SKILL_MISSING` с `hint`, код 0.
- **CI репозитория**:
  - job `warrant` на всех PR вместо `evidence` на `worktree/*`;
  - шаг «specs только через archive-PR» по имени ветки удаляется;
  - `workflow_dispatch` со входом `merge_commit`;
  - навык `change-archive-pr` — шаг `ci fetch`.
- **Версии**: CLI `0.6.0 → 0.7.0`; pack `core-sdd` `0.3.2 → 0.3.3` — диапазон `kernel: ">=0.1 <0.8"`. Схема `evidence/1`
  получает `subject.tree` (минорная правка).

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-001 — `subject` CI-записи на результате merge;
  - REQ-VER-003 — пред-фильтр `tree`;
  - REQ-VER-007 — `transition MERGED`: ref, run из записей, дерево M;
  - REQ-VER-010 — `analyze` архивированного Change;
  - новые требования: команда `ci`, команда `ci fetch`.
- `kernel`:
  - REQ-KRN-012 — `subject.tree` в схеме `evidence`;
  - REQ-KRN-033 — находка `REVIEWER_SKILL_MISSING`.
- `core-sdd`: REQ-SDD-001 — диапазон `kernel` `<0.8`, SCN-SDD-001 переписан под lock с одним hash на pack (BL-26).

## Non-Goals

- **Полное INV-03** (`review.author ≠ pr.author`, метод `reviews` в `ForgePort`) — с bot-идентичностью (BL-44). В 4c
  совпадение `merged_by` с автором PR даёт limitation, а не отказ.
- **Branch protection и обязательный статус** — недоступны на приватном репозитории без GitHub Pro. Красный `warrant ci` —
  сигнал maintainer'у, а не замок форжа.
- **Автоматическое evidence на каждый push в `main`** — только ручной `workflow_dispatch` для восстановления (ADR-0037 п. 4).
- **Разбор ID в тестах по названиям или маркерам; `paths.tests` этого репозитория** — I-169 закрыт статус-кво (ADR-0037 п. 7).
- **Изменение таблицы gates по переходам** (04 §5) — правило путей spec-PR держит `warrant ci`, а не gate `scope-valid`.
- **Slice, адаптер `codex`, второе семейство review (BL-28), A-5, I-146** — вне 4c.

## Impact

- `packages/cli/src`:
  - новые — `commands/ci.ts`, `core/ci/*` (вид PR, пересчёт переходов, проверки archive-PR, выбор run),
    `core/ports/forge.ts`, `adapters/forge-gh.ts`, `core/transition/merged.ts`, `core/evidence/approval.ts` (перенос);
  - правки — `commands/transition.ts`, `core/evidence/record.ts` (`subjectOf`, `tree`), `core/gates/prefilter.ts`,
    `core/gates/l0/spec-approved.ts`, `core/transition/facts.ts` (R-21), `core/run/{state,submit}.ts` (R-21, R-20),
    `core/analyze/*`, `core/sync/plan.ts`, `bin/warrant.ts`.
- `packages/cli/schemas/evidence.1.schema.json` и копия в `.warrant/schemas/`.
- `packages/cli/test`:
  - `FakeForge` в `ProjectBuilder`;
  - контракт `ForgePort` на настоящем GitHub против исторических объектов репозитория;
  - app `ci`, `ci fetch`, `transition`;
  - e2e impl-PR → archive-PR на фикстуре;
  - помощники тестов (A-30).
- `packs/core-sdd/pack.json` (версия, диапазон `kernel`), fixture-packs, lock.
- `.github/workflows/ci.yml`; навыки `change-archive-pr`, `change-impl-pr` (шаг CI).
- `docs/`:
  - 01 (INV-03), 04 §6–7 (`warrant ci`, `ci fetch`), 06 §3 (`tree`), 06a (`subject.tree`), 13 (строка 4c);
  - `backlog.md` — закрытые A-28…A-30, R-12, R-16, R-20, R-21, BL-7, BL-12, BL-26 (SDD-001), BL-40, BL-42, BL-43.
- **BREAKING** (внешних пользователей нет, ADR-0013):
  - `transition MERGED --ref` — URL impl-PR вместо URL CI-run;
  - job `evidence` заменён job'ом `warrant`;
  - evidence CI старого вида (без `tree`) на `MERGED` судится по-старому, по `commit` и `base_commit`.
