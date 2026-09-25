---
id: WARRANT-BACKLOG
title: WARRANT — реестр долга
status: informative
maturity: MVP
---

# Реестр долга

Один реестр открытого долга ([ADR-0032](adr/WARRANT-ADR-0032-dev-context.md) п. 5). «Куда» — фаза, Change или триггер
пересмотра. Префикс ID сохраняет источник: `I-` — решение по ходу реализации (design.md Change), `A-` — архитектурный
аудит ([process/audits/](process/audits/)), `R-` — ревью фазы 3, `D-` — ревью ADR-0016…0022; строка без источника —
`BL-N` (следующий номер — максимальный + 1). Взятая в работу строка — ссылкой из tasks.md Change; закрытая —
**удаляется** (закрытие записано в Change или коммите, история — в git). Источники до 2026-09-24 —
[архив NEXT-SESSION](archive/2026-09-24-next-session.md). Строка `A-N` с исключением в храповике
`packages/cli/test/unit/meta/architecture.json` удаляется вместе с исключением. Форма таблицы — `dev-context.test.ts`.

| ID | Что | Куда | Источник |
|---|---|---|---|
| A-5 | Нетипизированный JSON (P2): типизированные читатели (цена L); копии `strings` под другими именами (I-144) — `stringArray` и тело `providedList` в `core/sync/plan.ts`, `stringsOf` в `commands/link.ts`, `stringList` в `core/sync/rules.ts`, `targetsOf` в `core/validate/links.ts` (вне реестра помощников, храповик их не ловит); 83 обращения `json["…"]` в 19 файлах; конфиг — A-15 | не в фазе 4 (ADR-0034 п. 6): первый шаг — A-15 в `core-seams`, остальные читатели — по мере правок; отдельный ADR — по росту `json["…"]` | аудит 2026-09-24, 2026-09-25; общий guard закрыт arch-boundaries #23 |
| A-8 | `findChangeDir` в `core/init/scaffold.ts` — 5 импортёров, рёбра `ids → init`, `status → init`, `transition → init` (P3) | `core-seams` (3e, ADR-0034 п. 6) | аудит 2026-09-24, 2026-09-25 |
| A-9 | `commands/validate.ts` — ручная последовательность 13 проверок, самый частый churn команд; фаза 4 добавляет `validate --files` и сверку `AGENTS.md` (P2) | 4a, первая группа: реестр проверок `{id, run, appliesTo}` до `--files` | аудит 2026-09-24, 2026-09-25 |
| A-12 | `adapters/check-runner.ts → core/check/interrupt.ts` (`onInterrupt`): обработка сигналов общая у адаптера и `core/check/lock.ts` (P3) | 4a — вместе с портом `guard` | аудит 2026-09-24, spec `arch-boundaries` |
| A-14 | Предикат «waiver в силе» в 2 копиях: `waiverStatus` (`core/waivers/status.ts`, gate engine) и `isWaiverInForce` / `activeWaiverIds` (`core/gates/prefilter.ts`, зовёт `ensureApproval` в `commands/transition.ts`) без approver / waivable / targets (P1) | `core-seams` (3e, ADR-0034 п. 6); `countingWaiverIds` в `core/waivers/` | аудит 2026-09-25 |
| A-15 | `warrant.json` по строковым ключам в 8 местах: `paths.tests` — 2 копии с разным разбором (`core/ids/renumber.ts`, `core/validate/dangling.ts`), диапазон pack — 2 копии (`loader.ts` `packRequests`, `hash.ts` `configuredRange`); фаза 4 добавляет `paths.src`, `guard_prefixes` (P1) | `core-seams` (3e, ADR-0034 п. 6); `WarrantConfig` рядом с `loadConfig` | аудит 2026-09-25 |
| A-16 | Путь проекта и glob: отрезание git-префикса — 2 копии (`commands/classify.ts` `changedFromGit`, `core/git/facts.ts`), `picomatch(…, { dot: true })` — 3 копии (classify, `scope-valid`, `verdict`); `guard` фазы 4 — третья и четвёртая (P1) | `core-seams` (3e, ADR-0034 п. 6); `toProjectPaths`, `pathMatcher`; реестр внешних пакетов — ADR-0035 | аудит 2026-09-25 |
| A-17 | Фабрика `CliError` — 4 локальные копии `err` (`packs/hash.ts`, `packs/loader.ts`, `resolve/layers.ts`, `sync/plan.ts`); вопрос (6) фазы 4 — поле подсказки ошибки (P2) | `core-seams` (3e, ADR-0034 п. 6); `cliError()` в `core/errors.ts`; `hint` в ошибках — 4a | аудит 2026-09-25 |
| A-18 | Помощники тестов: spawn `git` — 9 копий в e2e / contract с разными `-c`, `write` — 10 копий при `test/helpers/synced.ts#write`; фаза 4 добавит e2e `guard`, `run`, `ci` (P2) | `core-seams` (3e, ADR-0034 п. 6); `test/helpers/git.ts`; помощники тестов в храповике — ADR-0035 | аудит 2026-09-25 |
| I-59 | `packContentHash` исключает `golden/` pack'а | когда golden начнёт влиять на policy | design.md архива `phase-2-core-sdd` |
| I-90 | `branch-isolated` на detached HEAD — `FAIL`; в CI `pull_request` HEAD detached. Сейчас не мешает: gate на `APPROVED->IMPLEMENTING` считается локально | по первому failure mode | design.md архива `phase-3-verification` |
| I-103 | Пред-фильтр исключает запись, чей `metrics.waivers[]` ссылается на waiver с `targets[]` | фаза 5, вместе с D-10 | design.md архива `phase-3b` |
| I-146 | `cs deps --level` считает модули-файлы `core/*.ts` частью `core`, а ADR-0030 — отдельными модулями: ложный цикл `core ↔ core/resolve` (строка в навыке `code-search`, H-8) | по failure mode | design.md архива `arch-boundaries` |
| R-11 | Код замка, kill дерева и путей на Linux проверен только CI-тестами: smoke в WSL Ubuntu (`check` с timeout и деревом процессов, Ctrl+C, закрытие терминала, `BUSY`, ручное снятие замка) | отложено maintainer'ом (2026-09-23); до первого реального использования на Linux | ревью фазы 3 |
| R-12 | CI-evidence считается на head impl-PR, а не на результате merge: «злой» merge или сдвиг `main` после прогона не судятся | 4b: evidence на merge ref с `subject.tree`, сверка дерева в `transition MERGED` (ADR-0034 п. 12) | ревью фазы 3 |
| R-16 | Шаг CI `test` «diff `openspec/specs/**` только в PR из `archive/*`» — временный | 4b: правило `warrant ci` по переходу record `MERGED → ARCHIVED` (ADR-0034 п. 13) | ревью фазы 3 |
| D-10 | Поведение `waiver.targets[]`: отпечатки в пред-фильтре (D-12), `STALE` при несовпадении, `warrant waive` с частичным `targets[]` | фаза 5 (pack `bdd-tdd`, spike S7) | ревью ADR-0016…0022, V-1 |
| D-23 | Избыточность → later по триггерам: `check --wait`, `local: "ci-only"`, `max_paths`, авто-снятие замка мёртвого pid (ADR-0017); бюджет 500 мс и лимит строк (ADR-0019); генерация `AGENTS.md` и `rules[]` в Context Pack — с первым правилом pack или проекта (ADR-0022) | later по триггерам [13 §3](13-roadmap.md) | ревью ADR-0016…0022 |
| BL-1 | `warrant fmt --check` без пути не проверяет `packs/**`; `packs/core-sdd/pack.json` неканоничен (порядок `rules`/`skills`) | с первым правилом `rule/1` `json-canonical` или отдельным fix | долг после фазы 3 |
| BL-2 | Producers gates `analyze-clean` (`warrant analyze`) и `adversarial-review` (`run start --operation review` → исполнитель → `run submit`, D-5; в MVP — Claude-субагент `warrant-reviewer`, ADR-0034 п. 10) — до них каждый Change закрывает эти gates парой waivers (`WAV-2026-001…008`, срок 2026-12-31) | 4b | D-5, P-16, V-1 |
| BL-3 | Схемы `warrant://run/1` (03 §4: `change`, `operation`, `skill`, `write_scope[]`, `context_hash`, `run_state`, `guard_events[]`; `.warrant/runs/current`; путь через `WARRANT_STATE_DIR`) и `warrant://skill-result/1` (envelope 07 §4 для `run submit`) | 4a — `run/1`; 4b — `skill-result/1` | ADR-0014, 0017–0020, 0022; D-2, D-9 |
| BL-4 | Первый набор правил `rule/1` (черновик из 8 правил — архив NEXT-SESSION, «Долг схем», B): правило о форме — с `enforced_by`; с правилом `language-split` `context` «Language: Russian» уходит из `.warrant/local/openspec/rules.json` (INV-06) | с первым правилом pack или проекта | grilling 2026-09-22, ADR-0022 |
| BL-5 | `validate --files`; `AGENTS.md` побайтно и ≤ 16 KiB | 4a | ADR-0019, ADR-0022, V-1 |
| BL-6 | `validate`: проверка (f) pragma mutation-инструментов | фаза 5 | ADR-0016, V-1 |
| BL-7 | Finding `FRONTEND_HOOKS_INACTIVE` (пути diff ∩ `paths.src`/`paths.tests` без `guard_events[]`) в `status` и отчёте `verify`/`ci` | 4a | ADR-0018, D-14 |
| BL-8 | `init`: проверка `codex --version ≥ MIN` при генерации `.codex/hooks.json` | адаптер `codex` — до среза S1 SEF, после S8 (ADR-0034 п. 5) | ADR-0018, D-7 |
| BL-9 | `sync`: `.claude/settings.json` — управляемое подмножество (свои deny и хуки `warrant guard --frontend claude`, ADR-0034 п. 3), `AGENTS.md`; `.codex/hooks.json` (постоянная строка `warrant guard --frontend codex`) | 4a — `.claude/settings.json` и `AGENTS.md`; `.codex/hooks.json` — адаптер `codex` (до среза S1 SEF) | ADR-0018, ADR-0022 |
| BL-10 | `check`: исполнение `guard_prefixes` | 4a | ADR-0017, V-1 |
| BL-11 | `warrant analyze`: `STALE` для неприменимого target waiver, обратные ссылки; TASK ↔ sef item | 4b (TASK ↔ sef — срез S1 SEF) | V-1, ADR-0020 |
| BL-12 | `warrant ci`: verdict impl-PR по evidence CI вместо ручного переноса artifact'а; верификация `--ref` (`human-approval` пишет `limitations` «ref not verified», R-10); размещение по PR порядка P-2 | 4b: `ForgePort`, `warrant ci fetch <pr>` в `change-archive-pr` (ADR-0034 п. 9, 14) | P-15, P-17, R-10, P-2 |
| BL-13 | `run start` (Context Pack, JSON-вывод с `rules[]` по `write_scope`) и `run submit` | 4a — `run start`; 4b — `run submit` | ADR-0022, D-5 |
| BL-14 | `guard`: нормализованный контракт pre/post, `--frontend claude` (ADR-0034); без Run → `deny` по D-4; hints через `additionalContext`, текст правил раз за Run; `guard_events[]` | 4a | ADR-0017…0019, 0022 |
| BL-15 | Адаптер `codex` (ADR-0018 п. 7, ADR-0020 п. 5 — `proposed`) после spike S8: hooks Codex под `codex-acp` и `codex exec`, минимальная версия с hooks на `apply_patch`; codex на машине maintainer'а не установлен | адаптер `codex` — до среза S1 SEF (S8 — 13 §3; ADR-0034 п. 1, 5) | D-7 |
| BL-16 | `attestation_type` `sef-approval`, `sef-gate` (enum в `common.1`); gate `spec-approved` в `sef-hub`; `SEF_PROTECTED_DRIFT`; forge `sef-hub` | срез S1 SEF | ADR-0020 (proposed) |
| BL-17 | Pack `bdd-tdd`: check `mutation`, parser mutation-testing-report-schema, фильтр по diff, lint pragma | фаза 5; инструмент — spike S7 | ADR-0016 |
| BL-18 | Floor по размеру diff, pack `ui`, `dismissed[]` в skill-result | later по триггерам [13 §3](13-roadmap.md) | 13 §3 |
| BL-19 | При ревизии черновика SEF ([integrations/2026-09-17-sef-platform-design.md](integrations/2026-09-17-sef-platform-design.md)) сверить его с [11 §2](11-integrations.md) и ADR-0020 п. 8–14: approval без hash spec, `source_ref` TASK ↔ item, один тестовый гейт `warrant verify`, `warrant transition` в `sef work approve` и `landing`, archive в `landing`, `protected[]` ⊇ пути WARRANT, `AGENTS.md` и `.codex/hooks.json` в эталоне `.sef/engines/<profile>/` | новая rev черновика SEF | D-8 |
| BL-20 | Жёсткие правила `CLAUDE.md` — в `.warrant/local/rules/*.json` (`rule/1`), раздел `CLAUDE.md` — `@AGENTS.md` из `warrant sync` | 4a (адаптер `claude`, ADR-0022 п. 2, ADR-0034) | ADR-0032 п. 7 |
| BL-21 | Не проверено: мигает ли окно `node.exe` при хуках разработки в Desktop-приложении | по жалобе | ADR-0029 |
| BL-23 | Issue в OpenSpec: настраиваемая команда архивации (или отключаемая подсказка `openspec archive`) в генерируемом `openspec-apply-change` — тогда хук ADR-0033 п. 9 для `openspec archive` становится страховкой. Публикация во внешний репозиторий — только с согласия maintainer'а | по решению maintainer'а | ADR-0033 (A7) |
| BL-25 | Продуктовый check `scn-covered` в pack `core-sdd` (SCN delta specs против тегов тестов) вместо dev-скрипта `scn-coverage.js` | фаза 5 (`bdd-tdd`) | ADR-0033 (R4) |
| BL-26 | Покрытие SCN main specs тестами по id — 163/199 (`node scripts/dev/scn-coverage.js --main`, 2026-09-25): 36 сценариев без теста с тегом, из них 8 — delta `phase-3b`; разобрать, какие держит golden pack без тега (проставить тег) и какие не покрыты вовсе | `core-seams` (3e, ADR-0034 п. 6); вместе с BL-25 — фаза 5 | ADR-0033 (R4) |
| BL-27 | Guard (адаптер `claude`) на разработке самого WARRANT: `run start` и `write_scope` на группу субагента, сосуществование с dev-хуками ADR-0029 / 0031 / 0033 в `.claude/settings.json` | после пройденного slice MVP; пересмотр ADR-0023 п. 1 | ADR-0034 п. 4 |
| BL-28 | Второе семейство для `adversarial-review` (`codex exec --output-schema` или `opencode` с GLM / DeepSeek) тем же контрактом `run start` → `run submit`; снимает `limitations` «same model family as author» | по триггеру: установлен `codex` или `opencode` | ADR-0034 п. 10, Q7 |
