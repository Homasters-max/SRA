---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: фаза 1 Kernel
status: informative
maturity: MVP
version: 0.1.0
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-22 (ночь)

- Документы 01–08 отгриллены в MVP-scope (ADR-0010…0015); открытых spikes нет.
- Change `phase-1-kernel` на ветке `feature/phase-1-kernel`: **группы 1–9 сделаны**, группа 10 — частично (см. ниже).
  Все семь команд фазы 1 реализованы: `init` (в т. ч. `init change`), `validate` (все семь проверок), `fmt`, `id`, `sync`, `resolve`, `status`.
  Решения по ходу реализации — I-1…I-42 в `design.md`. Глобальный `warrant` — symlink на этот чекаут: после `npm run build` актуален.
- Критерий выхода (10.1) закреплён e2e-тестом `exit-criterion.test.ts`: `openspec init` → `warrant init` → `init change demo` → `validate` ok → `status demo` `stale: []`.
- **Открыто — 10.2 (dogfooding на этом репозитории).** Задача требует `.warrant/warrant.json` и lock «через `warrant init` без перезаписи
  `openspec/config.yaml`», но `init` по REQ-KRN-023 всегда вызывает `sync`, который переписывает `config.yaml` (schema `warrant-sdd`) и кладёт
  его hash в lock; ADR-0015 п. 7 запрещает переход на `warrant-sdd` до фазы 2, а `--no-generated` отключает проверку (4), но не hash generated в проверке (2).
  Варианты для maintainer'а: (a) принять генерацию `config.yaml` сейчас — нужен ADR, меняющий ADR-0015 п. 7; (b) расширить `--no-generated` на
  generated-часть проверки (2) — правка REQ-KRN-021, временная до фазы 2; (c) отложить 10.2 до фазы 2 вместе со снятием флага.
- 10.3 (README, этот файл) сделано; 10.4 (PR) — после решения по 10.2.

## Что уже решено для фазы 1 (не обсуждать заново)

| Решение | Где |
|---|---|
| Стек: TypeScript на Node; bin `warrant`; не публикуется, `npm i -g <git-tag>` | ADR-0013 |
| Monorepo: `docs/`, `packages/cli/`, `packs/core-sdd/`, `sra/skills/`, `lattice/` | ADR-0013 |
| Команды фазы 1: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`; JSON-вывод, коды выхода 0/1/2/3 | 04 §7, 13 §2 |
| core-sdd@0.1: profiles `feature`, `chore`, `factory-change`; gates и checks из 06 §4 | ADR-0013, 05, 06 |
| Change record `.warrant/changes/<change>.json`; пишет только CLI | 04 §9, ADR-0009 |
| ID: `PREFIX-AREA-NNN` immutable с MERGED, ULID для EVID/RUN, реестр AREA, `warrant id renumber` | ADR-0012 |
| Доверие по ref, CI не пишет в репозиторий, bot-идентичность агента, forge = GitHub | ADR-0010 |
| Топология: spec-PR, impl-PR, archive-PR; `warrant archive` оборачивает `openspec archive`; gate `branch-isolated` | ADR-0011 |
| Enforcement Claude Code: static deny из `warrant sync` + hook `warrant guard`; reviewer = subagent | ADR-0014 |
| Все машинные файлы — JSON с `$schema` `warrant://<name>/<major>`; `warrant fmt` канонизирует | ADR-0006, 08 §7 |

## Порядок работы — через OpenSpec (dogfooding)

Skills superpowers из Claude Code убраны. Фаза 1 ведётся **самим OpenSpec** в этом репозитории: это одновременно
закрывает S2 (мы увидим `config.yaml` и schema изнутри) и даёт первые артефакты для будущего `factory-change`.

### Шаг 1 — спайк S2 · выполнен

`openspec init --tools claude` сделан, результат — [ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md). S2 и остаток S3 закрыты в 13 §3.

### Шаг 2 — планирование Change `phase-1-kernel` · выполнено

`openspec/changes/phase-1-kernel/`: proposal (решения review — `DECISION` в конце), specs (REQ-KRN-001…027, SCN-KRN-001…072),
design (D-1…D-10), tasks (10 групп, 47 задач). `openspec validate phase-1-kernel --strict` — зелёный.

### Шаг 2a — apply · в работе, остаток группы 10 (10.2, 10.4)

Ветка `feature/phase-1-kernel`. Вести через `/opsx:apply phase-1-kernel` по tasks.md; коммит на группу с зелёными тестами.
Ничего сверх tasks.md: новая потребность — сначала правка tasks/design, потом код. Отклонения от spec/design — вопросом
к maintainer'у, не молча; принятые — в таблицу «Решения по ходу реализации» design.md (I-N).

**Модели и схема работы (проверена на группах 1–3).** Сессия (координатор) — Fable 5.1: читает spec/design/tasks целиком,
пишет субагенту полный prompt (пути, REQ/SCN, конвенции кода, что уже есть), принимает отчёт, сам гоняет `npm test` и
`npm run typecheck`, делает ручную проверку команды, коммитит. Субагент — Agent tool, `model: "opus"`, одна группа задач,
`run_in_background: false`, отчёт ≤ 70 строк с разделом «Decisions/deviations». Sonnet не использовать.

Порядок и зависимости:

| Группа | Зависит от | Заметки |
|---|---|---|
| 4 `fmt` | 2 | сделана (I-12, I-13) |
| 6 `id` | 2, 3.5 | сделана (I-14, I-15) |
| 7 `sync` | 4 | сделана (I-16…I-18); `runSync`/`planSync` в `core/sync/plan.ts`, версия OpenSpec — `core/openspec/version.ts` |
| 8 `resolve` | 3.1 | сделана (I-19…I-21); `resolveForProject(loaded, classification?)` в `core/resolve/index.ts` — использовать в `status` |
| 5 `init` | 4, 7 | `init` вызывает `runSync`; JSON писать только через `writeJsonFile` (`core/canon/format-json.ts`); `init change` — имя проверять до `openspec new change` |
| 9 `status` | 8, 5 | `effective_policy.{hash,sources}` через `resolveForProject`; `openspec status --change <c> --json` через `runOpenspec` |
| 10 | всё | 10.2: `.warrant/warrant.json` этого репозитория через `warrant init` без перезаписи `config.yaml` |

Конвенции кода, которые субагент должен знать: TypeScript ESM NodeNext (`.js` в импортах), strict +
`exactOptionalPropertyTypes`; `WarrantError(code, message, {path})` из `core/errors.ts`; `success/failure/failures` из `io/output.ts`;
команды регистрируются в `src/bin/warrant.ts` через `register`; e2e через `test/helpers/cli.ts` (`runCli`, `makeTempDir`);
тесты, которым нужен `openspec`, — `it.skipIf(!openspecAvailable())` из `core/openspec/cli.ts`.

Готовый запрос:

```text
Прочитай docs/NEXT-SESSION.md, затем openspec/changes/phase-1-kernel/{proposal,design,tasks}.md и specs/kernel/spec.md
(design.md — включая таблицу «Решения по ходу реализации»). Документы 02–08 и ADR-0006, 0012, 0013, 0015 — по мере
необходимости. Ветка feature/phase-1-kernel уже есть, группы 1–3 сделаны. Продолжай /opsx:apply phase-1-kernel по той же
схеме: координатор — ты, субагенты Opus 5 по одной группе. Группы 4, 6, 7, 8 сделаны. Запусти группу 5, затем 9, затем 10 (последовательно: 9 зависит от 5, 10 — от всего). Коммит после каждой группы с зелёными тестами; сам проверяй результат
субагента (npm test, npm run typecheck, ручной прогон команды). Отклонения от spec/design — вопросом ко мне, не молча.
Остановись после группы 10 и покажи результат.
```

### Шаг 3 — не раньше конца фазы 1

Фаза 2 (core-sdd целиком, golden feature/chore), затем 3 (verification, CI) и 4 (Claude Code frontend).
В фазе 3 вместе с `warrant ci` — CI-матрица **ubuntu-latest + windows-latest**: `npm test`, `npm i -g` из чекаута,
`warrant validate` на sample-проекте. До этого WARRANT на Linux не запускался ни разу; код кроссплатформенный
по замыслу (`path`, `cross-spawn`, POSIX-пути в lock), но это не проверено.
Vertical slice по ADR-0013 — после фазы 4. LATTICE — после slice ([../lattice/NEXT-SESSION.md](../lattice/NEXT-SESSION.md)).

## Чего не делать

- Не реализовывать `check`, `gate`, `verify`, `analyze`, `guard`, `ci` в фазе 1: это фазы 3–4.
- Не добавлять profiles `bugfix`, `refactor`, `experiment`: без failure mode (ADR-0013).
- Не трогать `docs/integrations/`, `lattice/`: не на критическом пути.
- Не изобретать второй формат конфигурации: `warrant.json` — единственная точка (08 §3).
- Изменение любого нормативного документа во время реализации — только через новый ADR, не молча.

## Контекст для агента

SEF (Software Factory): OpenSpec — specification kernel (stock, без форка); WARRANT — governance, этот проект;
LATTICE — субстрат объектов (`../lattice/`); SRA — reasoning (skills); JEV — classifier без authority.
Документы RU с EN-терминами, машинные файлы JSON. Перед большими переписываниями — обсуждать с пользователем.
