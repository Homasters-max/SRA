---
id: WARRANT-ADR-0019
title: Подсказки после правки — validate --files, канал, видимый модели, без блокировки
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: []
amended_by: [WARRANT-ADR-0022]
---

> Уточнено [ADR-0022](WARRANT-ADR-0022-path-rules.md): hints включают текст правил по путям — один раз за Run на правило (исключение из п. 10 только для текста правил; находки проверок приходят всегда).

## Context

Сейчас ошибка в артефакте WARRANT (ID не под заголовком, правка stable ID, неканонический JSON) обнаруживается на `warrant validate` или на gate в CI — через PR после того, как агент закончил. Правило «Never edit a stable ID comment while implementing» (`packs/core-sdd/openspec/rules.json`) держится на тексте prompt (INV-04).

Сторонний проект `oinsio/clear-progress` ставит PostToolUse hook, который печатает предупреждения в stdout с кодом 0. По документации Claude Code stdout с кодом 0 у PostToolUse уходит в debug log и **модели не показывается** (исключения — `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`). Видимый модели неблокирующий канал — `additionalContext` (Claude Code, Codex), `output` (OpenCode), следующий prompt (ACP).

Сканер stable ID ([scan.ts](../../packages/cli/src/core/ids/scan.ts)) — регулярное выражение по сырому тексту; `openspec show --json` нужен только для сверки. Проверка одного файла возможна без запуска `openspec` и без второго парсера ([ADR-0015](WARRANT-ADR-0015-openspec-sync-contract.md)).

## Decision

1. **Проверки одного файла** (все — части существующих или решённых проверок): (a) JSON `.warrant/**` и packs — схема и канонический вид; (b) Markdown `openspec/changes/**` — формат ID, размещение под заголовком, AREA из реестра; (c) **stable ID изменён или удалён** относительно `HEAD` — для `openspec/specs/**` и для Change с record ≥ `APPROVED` (до `APPROVED` renumber и удаление REQ легитимны, [ADR-0012](WARRANT-ADR-0012-id-allocation.md) п. 1; D-18); (d) висячие ссылки REQ / SCN в `tasks.md` и тестах; (e) строки, похожие на токены; (f) pragma-маркеры mutation-инструментов ([ADR-0016](WARRANT-ADR-0016-mutation-diff-scope.md) п. 8b). Проверки уровня проекта (lock, hash, drift сгенерированных файлов, сверка с `openspec show`) — только `validate`.
2. **Команда** — `warrant validate --files <paths>`: та же реализация и коды ошибок; пропущенное — в `data.skipped[]` с причиной. Новые проверки (c), (d), (f) добавляются в `validate` для обоих режимов.
3. **Только сообщение.** Файлы не правятся: автоисправление сломало бы следующий `Edit` агента и писало бы в обход `write_scope`. Пример: «`fmt`: не канонический — выполни `warrant fmt <path>`».
4. **Сила — подсказка.** Не evidence, не verdict, не блокирует (INV-02). Находки пишутся в `guard_events[]` активного Run — сырьё для [12-evolution](../12-evolution.md).
5. **Выбор проверок** — по пути в CLI; hook вызывается на любую правку, для постороннего файла ответ пустой.
6. **Бюджет** — 500 мс на файл; без lock, hash и дочерних процессов, кроме одного `git show HEAD:<path>` для (c). Превышение → проверка в `data.skipped[]` с причиной `budget`. Числовой бюджет и `skipped: budget` — later по замеру (D-23); в фазах 3–4 действует только правило «без lock, hash и дочерних процессов».
7. **Адаптер** — `warrant guard` с `phase: post` ([ADR-0018](WARRANT-ADR-0018-frontend-adapters.md)).
8. **Канал.** Hints доставляются туда, где модель их видит: `additionalContext` (Codex, Claude Code), `output` (OpenCode), блок следующего prompt (ACP). Адаптер всегда завершается успешно; его сбой — только в журнал Run. Вывод, которого модель не видит, MUST NOT использоваться.
9. **Момент.** Внутри агента — синхронно после каждой правки; в слое ACP — после каждого завершённого edit `tool_call`, доставка в конце хода. `Stop` / `session.idle` не используются: у Claude и Codex блок на Stop продолжает ход, то есть блокирует.
10. **Повторы.** Полный список находок по файлу, не больше 10 строк + «и ещё N» (лимит строк — later, D-23); чистый файл — пустой ответ. Без состояния между вызовами.

## Consequences

- Правка stable ID ловится в том же ходе, а не на `ids-valid` в CI.
- Kernel spec (Команда validate) получает `--files` и три новые проверки — OpenSpec change фазы 3 / 4.
- Журнал hints показывает повторяющиеся ошибки агента — кандидаты в `factory-change`.

## Alternatives

- **Отдельная команда `warrant lint`** — отвергнуто: два набора кодов разойдутся с `validate`.
- **Автоисправление (`fmt`) в hook** — отвергнуто: см. п. 3.
- **Блокировать до исправления** — отвергнуто: второй gate рядом с CI (INV-02).
- **Проверка на `Stop` пакетом** — отвергнуто: неблокирующего канала на Stop нет; список файлов пришлось бы доставать из transcript.
- **`async` hook** — отвергнуто: его вывод модели не доставляется.
- **Только новые находки** (с состоянием в Run) — отвергнуто: результат зависит от истории, труднее отлаживать.
- **stdout с кодом 0**, как в clear-progress — отвергнуто: модель его не видит.
