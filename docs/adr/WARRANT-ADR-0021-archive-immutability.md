---
id: WARRANT-ADR-0021
title: Неизменность архива и связи между Changes — amends / supersedes, брошенный Change
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0020]
---

## Context

Сторонний проект `oinsio/clear-progress` запрещает правку `openspec/changes/archive/` и исправляет ошибки новым Change
со строкой `Supersedes: <old>` в proposal — правило держится на тексте prompt (INV-04).

У WARRANT то же правило подразумевается, но не принуждается:

- `scope-valid` impl-PR запрещает `openspec/specs/**` ([ADR-0011](WARRANT-ADR-0011-pr-topology.md)), но не архив;
  static deny [ADR-0014](WARRANT-ADR-0014-claude-code-enforcement.md) архив не покрывает и отложен; список
  `protected[]` для SEF ([ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md) п. 13) архива не содержит.
- [ADR-0012](WARRANT-ADR-0012-id-allocation.md) опирается на неизменность архива: следующий NNN и запрет повторного
  имени Change вычисляются сканированием, включая archive.
- Change record (`change-record.1`) не имеет связи между Changes.
- Брошенный (`ABANDONED`) Change оставляет каталог в `openspec/changes/`; `openspec list` показывает его активным.

## Decision

1. **Неизменно после `ARCHIVED`:** `openspec/changes/archive/<dir>/**`, record `.warrant/changes/<change>.json`,
   evidence `.warrant/evidence/<change>/**`. Единственное исключение — `factory-change` с целью «миграция формата»
   (например, обновление OpenSpec), по правилу INV-08.
2. **Принуждение — `scope-valid`.** Пути п. 1 входят в набор, запрещённый любому profile, кроме `factory-change`, —
   для spec-PR и impl-PR. Archive-PR (переход `MERGED → ARCHIVED`) может создать ровно свой каталог
   `openspec/changes/archive/<date>-<change>/` и изменить `openspec/specs/**` как результат `openspec archive`;
   чужие каталоги архива, records и evidence — запрещены (D-15; без этого штатный archive-PR ронял бы `scope-valid`).
   В `sef-hub` они входят в `protected[]` (ADR-0020 п. 13, `SEF_PROTECTED_DRIFT`); landing — доверенный писатель
   архива. Раннюю подсказку даёт `validate --files` ([ADR-0019](WARRANT-ADR-0019-post-edit-hints.md)). Нового gate нет.
3. **Связь хранится в Change record** (владелец метаданных governance, INV-06). Текст в proposal допустим для человека,
   authority — record. `.openspec.yaml` не используется (ADR-0015: WARRANT его только читает).
4. **Два поля.** `amends[]` — исправление Change в состоянии `MERGED` или `ARCHIVED` (его дельты уже в `specs/` или в
   `main`; исправляется новыми дельтами `MODIFIED` / `REMOVED`). `supersedes[]` — замена Change в состоянии
   `ABANDONED`. Цель в другом состоянии или несуществующая — ошибка `validate`. Значения совпадают по смыслу с
   `amends` / `supersedes` ADR.
5. **Обратные ссылки вычисляются.** `amended_by[]` / `superseded_by[]` показывают `warrant status` и `analyze`
   просмотром records; нигде не хранятся (иначе второй писатель и второй источник).
6. **Связь необязательна.** Эвристик нет: любой REQ в `specs/` когда-то добавлен архивным Change, поэтому «правка
   старого REQ» ≠ «исправление ошибки». Решение — человека; связь служит трассировке и аудиту.
7. **Отката из `MERGED` нет**; исправление — новый Change с `amends`, в том числе пока цель ещё не в `ARCHIVED`.
8. **`ABANDONED`.** `warrant transition <change> ABANDONED` замораживает record (как п. 1) и удаляет
   `openspec/changes/<change>/`; оба изменения едут одним коммитом. Артефакты — в истории git; имя закреплено record
   (ADR-0012 п. 6). Агент каталог сам не удаляет. Механизм (D-22): CLI не коммитит, поэтому «тем же коммитом» — правило
   ветки, а расхождение ловят `warrant status` и `ci` как `stale[]`: `ABANDONED_DIR_PRESENT` (record `ABANDONED`,
   каталог есть) и `DIR_MISSING_WITHOUT_TRANSITION` (каталога нет, record не `ABANDONED` и не в archive). В транспорте
   `github` переход и удаление едут в ветке `abandon/<change>` → PR или push в `main` как для archive
   ([ADR-0011](WARRANT-ADR-0011-pr-topology.md) п. 2 — четвёртый префикс ветки).
9. **Команда** `warrant link <change> --amends|--supersedes <target>` — до `APPROVED` (после — метаданные меняются
   только новой ревизией approval, ср. ADR-0020 п. 9). Флаг при создании Change — later.

## Consequences

- Гарантии ADR-0012 (ID и имена не переиспользуются) защищены механизмом, а не соглашением.
- `change-record.1` получает `amends[]`, `supersedes[]`; `scope-valid` — пути архива; `warrant link` — новая команда.
  Реализация — фаза 3, как и долг ADR-0016…0020.
- ADR-0020 п. 13: список путей для `protected[]` расширен путями п. 1.
- REQ-KRN-027 (`status`): правила `stale[]` `ABANDONED_DIR_PRESENT`, `DIR_MISSING_WITHOUT_TRANSITION`; ADR-0011 п. 2: ветка
  `abandon/<change>`; `scope-valid` знает вид PR (D-15, D-22).

## Alternatives

- **Отдельный gate `archive-immutable`** — отвергнуто: «какие пути может трогать Change» — это `scope-valid`.
- **Только каталог архива, без record и evidence** — отвергнуто: аудит опирается на все три.
- **Строка `Supersedes:` в proposal** — отвергнуто: машина её не проверяет.
- **Одно поле `supersedes`** — отвергнуто: результат архивного Change не исчезает, «замена» вводит в заблуждение.
- **Индекс обратных ссылок** — отвергнуто: второй источник истины (INV-06).
- **Эвристика или обязательная связь** — отвергнуто: срабатывала бы на любую правку spec.
- **Откат `MERGED → IMPLEMENTING`** — отвергнуто: код уже в `main`.
- **Брошенный каталог — в архив** — отвергнуто: `openspec archive` влил бы его дельты в `specs/`.
- **Запрет путей архива без исключения для archive-PR** — уточнено ревью 2026-09-22 (D-15).
- **«Тем же коммитом» без проверки** — дополнено (D-22): CLI не коммитит, нужна сверка в `status`/`ci`.
