# Design: phase-2-core-sdd

## Context

Kernel фазы 1 (см. `openspec/changes/archive/2026-09-22-phase-1-kernel/design.md`, D-1…D-10, I-1…I-44) уже умеет всё, что нужно
данным pack: loader собирает слои `default / project / profiles / risk` (D-6), resolver раскрывает `extends`, `match` overlay
сопоставляется с любым полем classification, lock знает `skills` (схема и `checkLock`), но `sync` их не пишет (plan.ts: «phase 1 ships none»).
Change record хранит `classification.risk.<dim> = {value, from}`. Схемы `profile`, `overlay`, `gate`, `check`, `controller-rules`,
`risk-floor` готовы; `profile.match.paths` — glob-ы по изменённым путям.

Ограничения: kernel-схемы `major = 1` не меняются; `warrant validate` без флагов на репозитории должен быть зелёным после каждой
группы (G-8); объём ≤ 6 групп, ~30 задач; solutions grilling'а G-1…G-21 — данность, не предмет обсуждения.

Текущее состояние репозитория после `openspec archive phase-1-kernel` (G-6): `warrant validate` красный — 99 × `ID_DUPLICATE`
(B6), потому что main spec и архивная delta объявляют одни ID. `openspec/config.yaml` — stock `spec-driven`; change фазы 2 создан
`warrant init change`, который взял schema из `config.yaml`, поэтому `.openspec.yaml` = `spec-driven` (артефакты те же четыре).

## Goals / Non-Goals

**Goals:**
- Pack `core-sdd@0.1.0` как полный набор policy-данных, проверяемый `validate` и зафиксированный lock'ом и golden.
- `classify` как единственный писатель `classification` (кроме будущего human-источника).
- `config.yaml` полностью генерируемый; репозиторий WARRANT на `warrant-sdd` без исключений и флагов.
- B1, B2, B6 закрыты с SCN.

**Non-Goals:**
- Исполнение gates/checks/controller, `transition`, `archive`, `waive` — фаза 3. Эти объекты здесь только данные.
- Изменение алгоритма слияния resolver'а (05 §5): реализован в фазе 1, здесь только используется.
- Новые поля в схемах kernel. Если pack-данные упрутся в схему — это отдельный change с bump `major`.

## Decisions

### 1. Раскладка pack: один объект — один файл, каталоги по типу

`packs/core-sdd/{overlays,profiles,gates,checks,controller,golden}/`. Имя файла = `id` объекта (I-9 фазы 1: id объекта = base name файла
для risk-levels; здесь распространяется на все типы; `validate` семантически проверяет `id === basename`). `pack.json.provides`
перечисляет файлы явно (схема pack требует списки), порядок — алфавитный, чтобы `fmt` и lock были стабильны.

Альтернатива — один `policy.json` — отвергнута 08 §7 (LLM-правки, diff).

### 2. Общий слой — overlay `core-default`, не profile `base` (G-13)

Слой `default` resolver'а = overlays с пустым `match`. `core-default` несёт `spec-valid` и `ids-valid` по переходам (REQ-SDD-002).
`factory-change` делает `extends: ["feature"]` — единственное использование `extends` в 0.1, и оно же упражняет B1
(override, удаляющий `extends`).

### 3. Risk overlays ссылаются только на свои gates (G-12)

`risk-high` = `adversarial-review` + `human-approval` на `VERIFYING->MERGED` + approval `maintainer`. 05 §4 переписывается:
таблица «Level → дополнительно» получает колонку «Pack», а `mutation-score` и `rollback-rehearsed` помечаются как overlays
`bdd-tdd` / `data` с `match.risk_level: ["HIGH"]`. Golden `factory-change` (HIGH) фиксирует это.

### 4. `classify` — новый модуль `core/classify/`, чистая функция + команда

```text
classify(input: { changed: string[], floors: FloorRule[], profiles: ProfileMatch[], propose?: Proposal, previous?: Classification })
  → { classification, ignored: {dimension, proposed, kept, reason}[] }
```

- Источник путей: `git diff --name-only <base>...HEAD` через `cross-spawn` (как `runOpenspec`), либо `--paths <file>`. Без git и без
  `--paths` — `USAGE` (SCN-KRN-076). Untracked-файлы не учитываются: classify по diff, не по worktree; для локального прогона до коммита
  агент передаёт `--paths`.
- Glob — `picomatch` (уже транзитивно есть? проверить; иначе `minimatch`, одна зависимость), `dot: true`, POSIX-пути.
- Монотонность: значение измерения = max(previous, floor, proposer) по порядку enum из `warrant://common/1`; `from` берётся у победителя;
  при равенстве приоритет `record` > `floor` > `proposer` (чтобы повторный запуск не менял `from`). Profiles = объединение
  previous ∪ match ∪ propose; `from` профиля — `record` / `match:<pack>:<profile>` / `proposer`.
- `risk_level` не пишется (REQ-KRN-028); команда после записи вызывает `resolveForProject` и печатает `effective_policy` в `data`.
- Record пишется через `writeJsonFile` (D-3); `transitions[]` не трогается: classify — не переход.

Альтернатива — classify внутри `status` «на лету» — отвергнута: classification должна быть записана (04 §9, ADR-0009), иначе
`status` двух машин разойдётся.

### 5. `config.yaml` целиком из rules (G-5, G-18)

`planSync` уже сливает `rules`/`operations` pack + проект; добавляется `context` проекта из `.warrant/local/openspec/rules.json`
(SCN-KRN-062 это уже описывает — реализация просто перестаёт уважать ручной файл). `--no-generated` удаляется из `validate` и из
lock-проверки (откат I-43). Pack `rules.json.context` становится нейтральным (одна фраза о WARRANT); «Language: Russian…» — в local.
Переезд репозитория: `sync` перезаписывает `config.yaml` (`schema: warrant-sdd`), затем `validate` без флагов. Так как активный change
`phase-2-core-sdd` создан на `spec-driven`, его `.openspec.yaml` правится руками на `warrant-sdd` в той же задаче (артефакты
совпадают, OpenSpec это допускает) — записать как I-решение.

### 6. B6: archive — «занято», не «объявлено» (G-7)

`scanIds` помечает каждое вхождение `origin: "specs" | "changes" | "archive"`. Проверка дубликатов: ID дублируется, если объявлен
дважды среди `specs ∪ changes`, или дважды внутри одного archive-каталога; пара `specs × archive` и `archive × archive` разных
каталогов — не дубликат. `highestNumber` и `ID_TAKEN` учитывают все три origin (REQ-KRN-024 не меняется). Ставится в группу 1,
чтобы репозиторий стал зелёным до наполнения pack.

### 7. B1, B2 в loader (G-7)

- `weakenings()`: overlay — `match` override должен быть подмножеством по каждому ключу (меньше ключей или больше значений = не слабее;
  новый ключ или меньше значений = слабее); profile — `extends` override ⊇ `extends` оригинала. Сообщение `OVERRIDE_WEAKENS` с `path`
  `<file>#/match` или `#/extends`.
- `loadLocalLayer()`: каталог `.warrant/local/<dir>/` с `pack.json` пропускается как слой проекта всегда; если `<dir>` не подключён
  в `warrant.json.packs` — `CONFIG_INVALID` (SCN-KRN-080). Каталоги без `pack.json` по-прежнему читаются как объекты проекта.

### 8. Golden как мини-проекты в pack, тест в CLI (G-1, G-10)

`packs/core-sdd/golden/<profile>/` содержит `.warrant/warrant.json` (packs: core-sdd только), `.warrant/warrant.lock.json`,
`.warrant/local/areas.json`, `.warrant/changes/<name>.json`, `openspec/changes/<name>/` с artifacts, `expected/resolve.json`,
`expected/status.json`. Тест копирует каталог во временный проект, кладёт bundled pack по тому же пути, что `warrant init`
(через `CLI_ROOT`), гонит `resolve --explain` и `status` (status — с fake `openspec` из фазы 1) и сравнивает `data` после удаления
полей `at`, абсолютных путей. Lock golden'а собирается `warrant sync` при создании и перегенерируется задачей `golden:update`
(`npm run golden:update`) — единственный легальный способ менять `expected/*`. Content hash проектного слоя вместо git-sha уже
реализован в фазе 1 (`layers.ts`), менять нечего.

### 9. Skill-stub и lock (G-15)

`sra/skills/specification/adversarial-review/SKILL.md` c frontmatter (`name`, `version: 0.1.0`, `description`) и семью категориями
06 §7. `planSync` пишет `lock.skills[<namespace>/<name>] = {version, path, hash}` (hash — `bytesHash`); `checkLock` уже проверяет.
Разрешение `@^0.1` → единственная версия в monorepo; semver-диапазон проверяется против frontmatter `version`.

### 10. Документы правятся в группе 1, до данных

Чтобы данные писались по уже исправленной норме: 13 §2, 13 §5, 05 §4, 06 §4, 08 §6. Правки — уточнения ранее принятых ADR, поэтому
без нового ADR (G-2). NEXT-SESSION и README — в группе 6.

### 11. Тесты и порядок работы

Как в фазе 1 (D-10, «Модели и схема работы»): координатор Fable, субагент Opus на группу, `npm test` + `npm run typecheck` +
`warrant validate` на репозитории после каждой группы, коммит на группу. Fixture-packs фазы 1 в `test/fixtures/packs/` остаются
для kernel-тестов; тесты core-sdd используют настоящий pack.

## Risks / Trade-offs

- [Схема `pack` или `profile` не вместит данные 0.1 (например, `evidence.required` у overlay)] → сначала проверить схемами `validate`
  на черновиках объектов (задача 2.1), затем писать; упёрлись — отдельный change, не правка «по-тихому».
- [Golden ломается от любой правки pack] → это цель (REQ-SDD-009); `golden:update` + обязательный просмотр diff `expected/*` в PR.
- [`git diff` в classify зависит от наличия `main` локально] → `--base` явный, ошибка `USAGE` с подсказкой; в CI будущая фаза 3 задаёт base PR.
- [Переезд репозитория на `warrant-sdd` ломает OpenSpec-скиллы Claude Code] → `.claude/skills/openspec-*` читают schema из
  `config.yaml` динамически; проверить `openspec status --change phase-2-core-sdd` после переезда (задача 4.4).
- [Объём] → потолок 6 групп; если `classify` вырастет (human-источник, JEV) — это фаза 3, не расширение здесь.

## Migration Plan

1. Группа 1 (B6 + документы) делает `validate --no-generated` зелёным на репозитории.
2. Группа 4 удаляет флаг и перезаписывает `config.yaml`; с этого момента `validate` без флагов.
3. Откат: `git revert` группы; данные pack без исполнителя ни на что не влияют до фазы 3.

## Open Questions

- Имя glob-библиотеки (picomatch vs minimatch) — решает субагент группы 3 по тому, что уже есть в `node_modules` транзитивно; в отчёте.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-45 | `warrant init change` берёт schema из `openspec/config.yaml`, а не всегда `warrant-sdd`: до переезда репозитория change фазы 2 создан на `spec-driven` | commands/init.ts, группа 4 |
| I-46 | B6: сферы уникальности ID — `specs`, `changes` (все активные changes вместе) и каждый archive-каталог отдельно, а не `specs ∪ changes`: delta `MODIFIED` активного change повторяет ID редактируемого main spec (13 таких пар в самом репозитории), это одно объявление, а не два; `highestNumber`/`ID_TAKEN` по-прежнему считают все origin | core/ids/scan.ts, группа 1 |
