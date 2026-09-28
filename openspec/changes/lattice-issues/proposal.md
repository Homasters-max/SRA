# Proposal: lattice-issues

## Why

Исследование модели `dev/` LATTICE передало WARRANT вопросы S-1…S-6. Факты сверены с репозиторием 2026-09-28, решения
maintainer'а — [ADR-0044](../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) (S-1…S-4); S-5 — BL-91, S-6 — ADR-0045.

- **Пропущенный тест засчитывается (S-4).** Parser `junit` даёт `PROVEN`, если нет падений и выполнен хотя бы один тест.
  Тест сценария, помеченный `skip` / `todo`, виден только в `metrics.skipped`: `tests-passed` и `analyze-clean` зелёные.
- **Запись состояния не атомарна, Run не восстановить (S-3).**
  - `writeJsonFile` пишет прямо в целевой файл: обрыв оставляет record, evidence, Run или waiver битым.
  - `run submit` пишет evidence раньше Run; повтор после обрыва выдаёт второй EVID того же Run.
  - Под Run `review` guard пропускает только `warrant run submit`: автор не видит состояния и не может отменить Run (BL-81).
  - Незакоммиченная работа ловится только в `review`.
- **Gate маскирует evidence (S-2).** `requires_evidence[]{kind, status}` берёт самую свежую запись kind'а: второй producer
  `test-report` (проверка проекта) закрывает или маскирует первый (как BL-57). Job `warrant` проекты держат копией (BL-51).
- **Общий аккаунт (S-1).** Агент и maintainer работают под одним логином. `warrant ci` засчитывает решение UNKNOWN, merge и
  `human-approval` агента как акты maintainer'а молча. `identities.agents` (ADR-0010 п. 4) код не читает.

## What Changes

- **Атомарная запись состояния:** временный файл того же каталога + rename для record, evidence, manifest, Run, `current`,
  waivers, результата review.
- **Parser `junit`:** пропущенный `<testcase>`, в имени которого есть ссылка `SCN-<AREA>-NNN`, делает запись `NOT_PROVEN` с
  limitation `junit: skipped SCN-…`.
- **Run:**
  - повтор `run submit` того же Run переиспользует записанную evidence (`produced_by.run`);
  - под Run `review` guard пропускает команды без записи (`warrant status`, `warrant verify … --dry-run`,
    `warrant … --help`, `git status | log | diff | show`, `cd`) и `warrant run finish --state CANCELLED`; подсказка отказа
    называет отмену;
  - `run start` `specify` / `implement` — находка `UNCOMMITTED_IN_SCOPE` при незакоммиченных файлах внутри `write_scope`;
  - удалить недостижимую ветку `review` в `editWithRun` (R-32).
- **Gate по check:** необязательное `requires_evidence[].check` — gate берёт записи только этого check; `validate` проверяет
  ссылку; `check` без `id` выбирает check по `check` gate, если он задан.
- **Идентичность:**
  - `identities.agents[].login` читается; `validate` — `CONFIG_INVALID` для логина и в `roles.*`, и в `identities.agents`;
  - `warrant ci` при пустом `identities.agents` базы — находка `SHARED_IDENTITY` на каждом проверенном акте;
  - при непустом: `merged_by = pr.author` — `REF_NOT_VERIFIED` `merged_by` вместо находки `APPROVER_IS_AUTHOR`; автор
    решения UNKNOWN из `identities.agents` — деталь `author`.
- **Reusable workflow:** `.github/workflows/warrant.yml` (`on: workflow_call`) — job `warrant`; `ci.yml` этого репозитория
  вызывает его; проект вызывает по тегу CLI.
- **Версии:** CLI `0.8.1 → 0.8.2`; pack `core-sdd` — только если меняются его golden-копии схем.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-002 — пропущенный тест сценария;
  - REQ-VER-003 — выбор записи gate по `check`;
  - REQ-VER-011 — `SHARED_IDENTITY`, `merged_by = pr.author` при непустом `identities.agents`;
  - REQ-VER-013 — автор решения из `identities.agents`, `SHARED_IDENTITY`;
  - REQ-VER-014 (новое) — reusable workflow job `warrant`.
- `enforcement`:
  - REQ-ENF-002 — `UNCOMMITTED_IN_SCOPE`;
  - REQ-ENF-004 — команды без записи и отмена под Run `review`;
  - REQ-ENF-007 — повтор `run submit`.
- `kernel`:
  - REQ-KRN-009 — `requires_evidence[].check` в схеме gate;
  - REQ-KRN-021 — `validate`: `identities.agents` ∩ `roles`, ссылка `check` gate;
  - REQ-KRN-036 (новое) — атомарная запись состояния.

## Non-Goals

- **GitHub App агента** — создаёт maintainer; `identities.agents` в `.warrant/warrant.json` — после App (BL-83).
- **Проверка исполнителя активации waiver** (BL-75) — форж её не видит.
- **Жизненный цикл `rule/1`** (S-5, BL-91), **бенчмарк контекста разработки** (S-6, ADR-0045, BL-92).
- **Проверки PR без Change и прогон на push в `main`** — job проекта (ADR-0044 п. 7), ADR-0037 п. 4.
- **Привязка gate `factory-golden-passed` к check golden** (BL-57) — по failure mode.
- **Возобновление упавшего Run**, **`warrant run cancel`** — отвергнуты (ADR-0044, Alternatives).
- **Длинная команда в guard** (BL-86) — нарезка фазы 5.

## Impact

- `packages/cli/src`:
  - `core/canon/format-json.ts` (атомарная запись), места записи без `writeJsonFile` (`core/run/lifecycle.ts` —
    `current`, `core/evidence/store.ts`);
  - `core/evidence/parsers/junit.ts`;
  - `core/run/submit.ts`, `core/run/lifecycle.ts`, `commands/run.ts`, `core/guard/decide.ts`;
  - `core/gates/verdict.ts`, `core/check/execute.ts`, `core/validate/**`, `schemas/gate.1.schema.json`;
  - `core/config.ts`, `core/roles.ts`, `core/ci/decisions.ts`, `core/ci/refs.ts`.
- `.github/workflows/warrant.yml` (новый), `.github/workflows/ci.yml`.
- `packages/cli/test`: unit parser junit, атомарной записи, guard; app `run`, `guard`, `gate`, `verify`, `validate`, `ci`.
- `package.json` (версия), `warrant.lock.json` репозитория и golden-фикстур (`kernel`); копии схемы gate в
  `.warrant/schemas/` и golden — `warrant sync`.
- `docs/`: 04 (таблица восстановления Run), 06 §2 (id SCN в имени теста), 06 §3 (`check` gate), 06 §8 (общий аккаунт,
  reusable workflow, проверки вне Change); `backlog.md` — закрытые строки.
