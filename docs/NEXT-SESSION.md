---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: фаза 1 Kernel
status: informative
maturity: MVP
version: 0.1.0
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-22

- Документы 01–08 отгриллены в MVP-scope. Результат — ADR-0010…0014 ([adr/](adr/README.md)); документы 01–04 приведены в соответствие.
- Спайки: S1 закрыт (ADR-0012 §7, OpenSpec 1.13.1), S2 закрыт ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)), S3 закрыт (ADR-0009, остаток — ADR-0015), S4 закрыт (ADR-0013: TypeScript), S5 закрыт (ADR-0014), S6 — proposed через LATTICE. Открытых spikes нет.
- Кода нет. Ни одной JSON Schema `warrant://*` нет.
- OpenSpec инициализирован в репозитории (`openspec init --tools claude`, schema `spec-driven`, `config.yaml` вручную — ADR-0015 п. 7).
- Change `phase-1-kernel`: `proposal.md`, `specs/kernel/spec.md` (REQ-KRN-001…027, SCN-KRN-001…072), `design.md`, `tasks.md`
  написаны, `openspec validate --strict` проходит. Семь вопросов review закрыты (`DECISION` в proposal).
  `.warrant/local/areas.json` создан вручную (`KRN` → `kernel`). **Следующий шаг — apply** на ветке `feature/phase-1-kernel`
  (`/opsx:apply phase-1-kernel`), группы задач 1 → 10, тесты первыми для schemas и resolver.

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

### Шаг 2a — apply · следующий

Ветка `feature/phase-1-kernel`. Вести через `/opsx:apply phase-1-kernel` группами задач 1 → 10 из tasks.md:
каркас → schemas (тесты первыми) → validate → fmt → init → id → sync → resolve (golden первыми) → status → критерий выхода.
Коммит на группу. Ничего сверх tasks.md: новая потребность — сначала правка tasks/design, потом код.

Готовый запрос:

```text
Прочитай docs/NEXT-SESSION.md, затем openspec/changes/phase-1-kernel/{proposal,design,tasks}.md и specs/kernel/spec.md.
Документы 02–08 и ADR-0006, 0012, 0013, 0015 — по мере необходимости. Создай ветку feature/phase-1-kernel и выполняй
tasks.md через /opsx:apply phase-1-kernel, группа за группой, начиная с 1. Тесты первыми для schemas и resolver.
Коммит после каждой группы с зелёными тестами. Отклонения от spec/design — вопросом ко мне, не молча.
Остановись после группы 3 (validate работает на packs/core-sdd) и покажи результат.
```

### Шаг 3 — не раньше конца фазы 1

Фаза 2 (core-sdd целиком, golden feature/chore), затем 3 (verification, CI) и 4 (Claude Code frontend).
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
