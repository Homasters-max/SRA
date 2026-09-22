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
- Спайки: S1 закрыт (ADR-0012 §7, OpenSpec 1.13.1), S3 закрыт (ADR-0009), S4 закрыт (ADR-0013: TypeScript), S5 закрыт (ADR-0014), S6 — proposed через LATTICE. **Открыт только S2**: устройство project-local schema и `config.yaml` в OpenSpec 1.13.1.
- Кода нет. Ни одной JSON Schema `warrant://*` нет.
- Фаза 0 завершена. Следующая — **фаза 1 Kernel** ([13 §2](13-roadmap.md)), ведётся через OpenSpec, без superpowers.

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

### Шаг 1 — поставить OpenSpec и провести спайк S2

```bash
npm i -g @fission-ai/openspec@1.13.1 && openspec init
```

Изучить сгенерированные `openspec/config.yaml`, `openspec/schemas/`, slash-команды (`/opsx:*` или `/openspec:*`
в зависимости от версии). Результат — **ADR-0015**: что именно генерирует `warrant sync`, как выглядит
project-local schema `warrant-sdd`. Закрыть S2 в 13 §3.

### Шаг 2 — один OpenSpec Change на фазу 1

Change `phase-1-kernel` через штатные команды OpenSpec (propose → specs → design → tasks → apply → archive):

- **proposal.md** — только WHY / WHAT / non-goals (13 §5): команды `init validate fmt id sync resolve status`,
  core-sdd@0.1 = `feature chore factory-change`. Не design.
- **specs/** — требования с `<!-- id: REQ-KRN-NNN -->` под заголовками (ADR-0012 §7): по одному REQ на команду
  и на JSON Schema; сценарии WHEN/THEN. Это первые реальные stable ID проекта — сразу проверяем S1 на себе.
- **design.md** — monorepo `packages/cli/` TypeScript, порядок schemas по зависимостям
  (`config pack profile overlay gate check change-record evidence evidence-manifest controller-rules risk-floor
  risk-levels openspec-rules waiver`), `resolve` как чистая функция с golden cases (12 §2).
- **tasks.md** — ссылки на REQ; порядок: schemas → `validate` → `fmt` → `init` → `id` → `sync` → `resolve --explain` → `status`.
- **apply** — тесты первыми для schemas и `resolve`; ветка `feature/phase-1-kernel`.
- **archive** — критерий выхода 13 §2: `warrant validate` проходит на core-sdd и на sample-проекте после `warrant init`.

Готовый запрос:

```text
Прочитай docs/NEXT-SESSION.md, затем docs/00-readme.md, 13-roadmap.md, adr/WARRANT-ADR-0006, 0007, 0009–0014,
затем 02, 03, 04, 05, 06, 06a, 08. Выполни Шаг 1 (OpenSpec 1.13.1, спайк S2 → ADR-0015). Затем создай OpenSpec
Change phase-1-kernel по Шагу 2 и остановись после proposal + specs на моё review. Спорные места — вопросом ко мне.
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
