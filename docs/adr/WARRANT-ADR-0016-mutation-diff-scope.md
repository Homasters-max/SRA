---
id: WARRANT-ADR-0016
title: Mutation score по diff — scope, формула, исключения эквивалентных мутантов, evidence metrics
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: []
---

## Context

[10-pack-bdd-tdd §4](../10-pack-bdd-tdd.md) требовал mutation «на изменённых модулях» с порогом
`mutation_threshold: 0.7`, то есть score считался по модулю целиком. Наблюдение из стороннего проекта на
OpenSpec + Claude Code (`oinsio/clear-progress`, `mutation-coverage-gap-analysis.md`): score по файлу 53–56%
при 100% убитых мутантов внутри diff — все выжившие сидели в коде, который изменение не трогало. На brownfield
такой gate падает из-за унаследованного долга, а не из-за изменения, и каждый раз требует waiver.

Попутно выяснилось:

- Evidence ([06a](../06a-evidence.md)) не имеет места для чисел: score, знаменатель и base некуда записать.
- Gate видит только `evidence_status`; сравнение с порогом нигде не определено.
- Инструменты различаются гранулярностью: Stryker отдаёт строку мутанта, mutmut 3 именует мутанты по функции
  (`x_func__mutmut_N`), per-mutant результаты хранит в недокументированных `mutants/*.meta`, наружу отдаёт только
  агрегат (`export-cicd-stats`).
- Инструменты имеют собственные механизмы обхода: `# pragma: no mutate`, `do_not_mutate_patterns` (mutmut),
  сужение `mutate` в конфиге (Stryker).

## Decision

1. **Scope — diff.** Мутант учитывается, если его location пересекает изменённые строки (hunks). Если инструмент
   не даёт строк — изменённые функции. Гранулярность (`line` / `function`) объявляет parser и записывает в
   evidence. Перенесённый код считается изменённым; rename файла распознаётся (`git diff -M`), эвристика
   `--color-moved` не используется.
2. **Base** — `merge-base(HEAD, base-ветка PR)`, как у `scope-valid` ([ADR-0011](WARRANT-ADR-0011-pr-topology.md)).
   Пишется в `subject.base_commit`; сдвиг base → `STALE`.
3. **Фильтрует WARRANT.** Отчёт инструмента нормализуется parser'ом в mutation-testing-report-schema
   (`schemaVersion` 1–2, экосистема Stryker); check пересекает его с diff. Инструмент MAY сужать прогон ради
   стоимости, но verdict считается только по фильтру WARRANT.
4. **Формула.** `score = killed / (killed + survived + no_coverage)`; `Timeout` → killed;
   `CompileError`, `RuntimeError` — вне знаменателя, счётчик `errors`; `Ignored` внутри diff → survived, если на
   мутант нет исключения (п. 7). 0 мутантов в diff → evidence `NOT_APPLICABLE` → gate `NOT_APPLICABLE`.
5. **Порог** — один: `params.mutation_threshold`, default `0.9`. Понижение — правка policy → `factory-change` (INV-08).
6. **Сравнение делает check.** Check получает порог из effective params, выставляет `PROVEN` / `NOT_PROVEN` и
   пишет применённый порог в `metrics.threshold`. Gate сверяет его с текущим effective param; расхождение →
   `STALE`, evidence не засчитывается. Алгоритм verdict ([06 §3](../06-verification.md)) не меняется.
7. **Эквивалентные мутанты — частичный waiver.** Waiver получает необязательное поле `targets[]`; каждый target —
   отпечаток `{file, symbol, mutator, replacement, source_sha256}` (`source_sha256` — hash исходного фрагмента
   под мутантом; для гранулярности `function` — hash тела функции, `mutator` = порядковый номер). Waiver с
   `targets` не переводит gate в `WAIVED`, а исключает эти мутанты из знаменателя. Отпечаток, не совпавший с
   текущим кодом, — finding `STALE`; исключение не действует. Исключения живут в рамках одного Change,
   общего реестра нет. Агент предлагает, человек активирует — как у любого waiver ([05 §7](../05-policy.md)).
8. **Защита от обхода.** (a) `Ignored` в diff → survived (п. 4); (b) lint diff ищет pragma-маркеры инструмента —
   finding, не FAIL; легитимная pragma оформляется через п. 7; (c) конфиги mutation-инструмента
   (`params.mutation_config_paths`) добавляются pack'ом в `match.paths` profile `factory-change`.
9. **Evidence.** Kind `mutation-report` (pack `bdd-tdd`). Evidence schema получает необязательное поле `metrics`;
   его JSON Schema объявляет pack для своего kind. Для `mutation-report`:
   `{scope, granularity, base_commit, killed, survived, no_coverage, timeout, errors, excluded_equivalent,
   score, threshold, module_score}`. `module_score` — справочно, gate его не читает.
10. **Risk.** `HIGH` — gate `mutation-score` required. `MEDIUM` — check выполняется, evidence пишется в manifest,
    gate не required. `LOW` — не выполняется.
11. **Сроки.** Поле `metrics` в evidence schema и объявление metrics-схем kind'ов в pack — требование к фазе 3
    (MVP). Всё остальное — pack `bdd-tdd`, фаза 5. Выбор инструмента для Python sample — spike S7.

## Consequences

- Gate `mutation-score` перестаёт падать из-за унаследованного долга; долг виден как `module_score` и остаётся
  предметом brownfield, а не каждого Change.
- Evidence schema фазы 3 закладывает `metrics` — без этого фаза 5 ломала бы схему.
- Waiver получает второй режим (частичный); `warrant waive` (later) должен уметь `targets`.
- Любая правка кода под исключённым мутантом снимает исключение — для mutmut это любая правка функции. Строже,
  но честно: эквивалентность утверждалась про конкретный код.
- Конфиг mutation-инструмента в общем файле (`pyproject.toml`, `setup.cfg`) делает policy-путём весь файл;
  проекту SHOULD держать конфиг отдельным файлом.

## Alternatives

- **Score по модулю** (как было) — отвергнуто: знаменатель содержит долг, не относящийся к Change.
- **Фильтр силами инструмента** (`stryker --mutate file:lines`) как основа verdict — отвергнуто: у каждого
  инструмента свой синтаксис и гранулярность, сужение нельзя проверить единообразно.
- **Base = commit `APPROVED` или предыдущий CI-прогон** — отвергнуто: score начинает зависеть от истории прогонов.
- **Target 0.95 + minimum 0.9** — отвергнуто: мягкая цель ни на что не влияет.
- **Условие на метрику в gate** (`requires_evidence[].metric >= param`) — отвергнуто: усложняет общий алгоритм
  verdict ради одного kind.
- **Inline pragma как механизм исключения** — отвергнуто: агент ослабляет проверку одной строкой (INV-07, INV-08).
- **Отдельный список исключений в Change record / реестр проекта** — отвергнуто: новая сущность дублирует waiver;
  реестр — второй источник истины (INV-06).
- **Ratchet по `module_score`** — отложено (later): требует истории прогонов.
- **Выбрать mutmut сейчас** — отложено в S7: parser зависел бы от недокументированного `.meta`.
