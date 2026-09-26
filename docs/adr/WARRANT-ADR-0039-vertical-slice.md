---
id: WARRANT-ADR-0039
title: Vertical slice MVP — Change `rate-limiter` в `warrant-slice`, bootstrap корневым коммитом, CLI по тегу в workflow, процесс агенту — правилом проекта
adr_state: ACCEPTED
date: 2026-09-26
supersedes: []
amends: [WARRANT-ADR-0034]
---

## Context

`phase-4a`, `phase-4b`, `phase-4c` закрыты (CLI 0.7.0, pack `core-sdd` 0.3.3); остаётся vertical slice — критерий
выхода MVP ([13 §1](../13-roadmap.md), [ADR-0013](WARRANT-ADR-0013-mvp-refinement.md), [ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md)
п. 6–7): Claude Code под hooks проводит одно FEATURE-изменение sample-проекта Python + pytest от intent до archive; в
`guard_events[]` нет обойдённого `deny`, `FRONTEND_HOOKS_INACTIVE` отсутствует, ни одна транзиция не записана вне
`warrant`. Вход grilling — аудит [2026-09-26-phase-4c](../process/audits/2026-09-26-phase-4c.md), открытые A-5, A-31,
A-32, [handoff/phase-4.md](../handoff/phase-4.md).

Факты на 2026-09-26:

- Репозитория `Homasters-max/warrant-slice` нет. `Homasters-max/SRA` публичный; корневой `package.json` несёт `bin` и
  `prepare: build` — `npm i -g github:Homasters-max/SRA#<тег>` собирает CLI без токена.
- CLI workflow не генерирует: job `warrant` есть только в `.github/workflows/ci.yml` этого репозитория, CLI он ставит из
  checkout результата merge (`npm i -g .`, [ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md) п. 3) — в чужом проекте CLI в
  checkout нет.
- `.github/workflows/**` — policy-путь `factory-change` ([ADR-0038](WARRANT-ADR-0038-pr-judged-by-base.md) п. 3); gate
  `factory-golden-passed` к нему не применяется (`applies_when` — `.warrant/**`, `packs/**` и схемы). Собственное
  состояние Change (record, evidence, Runs) в классификации не участвует (REQ-KRN-028).
- `tests-passed` исполняет команду проекта из `.warrant/local/checks/`, парсер `junit`.
- `AGENTS.md` собирается `sync` только из правил `rule/1` с `paths: ["**"]` (REQ-KRN-033); знания о топологии PR
  (spec-PR → impl-PR → archive-PR, `ci fetch`, `transition MERGED --ref`) агент sample-проекта иначе не получает.
- Hooks Claude Code читаются из `.claude/settings.json` проекта сессии: сессия в `D:\project\SRA` под guard slice не
  попадает.

## Decision

1. **Репозиторий** (N50). `Homasters-max/warrant-slice` — публичный, пустой (без README и лицензии): корневой коммит —
   bootstrap (п. 4). Actions и `GITHUB_TOKEN` read-only для `ForgePort` — без настроек.
2. **Change slice** (N51) — `rate-limiter`, profile `feature`: token-bucket на stdlib с внедряемыми часами. REQ — «не
   больше N запросов за окно», «пополнение со временем»; SCN — «лимит исчерпан», «пополнение», «независимые ключи»;
   blocking UNKNOWN — поведение при часах, идущих назад (`WAIT` до решения); одно измерение risk — proposer через
   `warrant classify --propose`; тесты pytest с токеном `SCN-…`. Содержание ADR-0013 («≥ 2 REQ, ≥ 3 SCN, …») им
   исполняется.
3. **Кто ведёт** (N52). Сессия разработки WARRANT — grilling, ADR, bootstrap (п. 4), файл передачи. Slice от intent до
   archive ведёт отдельная сессия Claude Code, открытая в каталоге `warrant-slice`, под его `.claude/settings.json`.
   Навыки разработки WARRANT в slice не копируются: процесс агент получает только средствами продукта — проектным
   правилом `.warrant/local/rules/*.json` (`rule/1`, `paths: ["**"]`) → `AGENTS.md` через `sync`, `--help` и `hint`
   ошибок. Каждая нехватка подсказки — failure mode (п. 8).
4. **Bootstrap** (N53) — один корневой коммит прямо в `main`, до CI: `pyproject.toml`, `openspec init`,
   `warrant init --frontend claude` и `warrant sync`, команда `tests-passed` (`pytest --junitxml`), правило п. 3,
   workflow (п. 6). Базы у него нет, а PR без Change на policy-путях (`.warrant/**`, `.github/workflows/**`) по
   ADR-0038 — нарушение. Транзиций bootstrap не пишет. Дальше в `warrant-slice` — только Change и PR.
5. **Установка CLI** (N54) — точным тегом в workflow: `npm i -g github:Homasters-max/SRA#v0.7.0` и
   `@fission-ai/openspec@1.13.1`, первым шагом `warrant --version`. Смена pin — Change `factory-change` в slice
   (`human-approval`, без golden). Локальная сессия slice — та же версия: `npm link` из основного checkout на теге.
   Уточняет ADR-0034 п. 7 («`npm i -g <git-tag>`»): тег — в workflow slice, форма — `github:<owner>/<repo>#<тег>`.
6. **Job `warrant` в slice** (N55) — адаптированная копия job этого репозитория в `.github/workflows/warrant.yml`:
   merge PR в tip базы, установка по п. 5 вместо `npm ci` + `npm i -g .`, `setup-python` + pytest, `warrant ci`, upload
   artifact `evidence-<change>-<attempt>`, `workflow_dispatch` восстановления. Отдельного job тестов нет — pytest
   исполняет `tests-passed` внутри `warrant ci`. Шаблон workflow, поставляемый WARRANT, — по failure mode (строка
   backlog).
7. **Долг до slice не чинится** (N56). Slice идёт на v0.7.0: он проверяет выпущенный конвейер, новые возможности — по
   фактическим failure modes (13 §1). Первый Change WARRANT, который правит `core/ci` по отказу slice, начинается
   группой A-31 + A-32. A-5 — вне фазы 4 (ADR-0034 п. 6).
8. **Итог slice** (N57, N58). Branch protection в slice не включается (как ADR-0038, Non-Goals `phase-4c`): красный job —
   сигнал maintainer'у; merge на красном — failure mode. Failure modes — строки `docs/backlog.md` с источником
   `slice`; исправления — Change WARRANT → тег → смена pin в slice (п. 5). Приёмка MVP — отчёт по критерию 13 §1
   (`guard_events[]` Runs, отсутствие `FRONTEND_HOOKS_INACTIVE`, refs переходов в CI) в строке 4c
   [13 §2](../13-roadmap.md).

## Consequences

- ADR-0034 п. 7 уточнён п. 5: заметка `amended_by`.
- `docs/backlog.md`: «Куда» A-31 и A-32 — по п. 7; строка шаблона workflow (п. 6).
- В `warrant-slice` ведётся свой `warrant.json`, record и evidence; в этот репозиторий из slice приходят только
  строки backlog и отчёт приёмки.
- Pin CLI в slice отстаёт от `main` WARRANT до следующего тега: исправление по failure mode видно в slice только после
  релиза.
- Guard на разработке самого WARRANT (BL-20, BL-27, ADR-0023 п. 1) пересматривается после пройденного slice.

## Alternatives

- **Сначала Change WARRANT с A-31 / A-32, затем slice** — отвергнуто: оба P1 про крайние случаи attestation и refs,
  slice на v0.7.0 может их не задеть; чинить до отказа — против 13 §1.
- **Навыки WARRANT (`change-*-pr`, `git-land`) в slice** — отвергнуто: slice проверил бы нашу фабрику разработки, а не
  продукт; пробелы подсказок продукта остались бы невидимы.
- **Bootstrap через PR** — отвергнуто: у пустого репозитория нет базы для `warrant ci`, PR без Change на policy-путях
  нарушает ADR-0038.
- **Шаблон workflow в WARRANT сразу** (`init --ci github`) — отвергнуто: одна копия, новый вход CLI без failure mode.
- **Branch protection с обязательным `warrant`** — отвергнуто: расходится с ADR-0038; критерий MVP измеряется без
  блокировки кнопки.
