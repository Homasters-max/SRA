# WARRANT ADR

Решения, принятые при проектировании самой системы WARRANT.

| ADR | Решение | adr_state |
|---|---|---|
| [0001](WARRANT-ADR-0001-openspec-kernel.md) | OpenSpec — specification lifecycle kernel | ACCEPTED |
| [0002](WARRANT-ADR-0002-kernel-and-packs.md) | Модель Kernel + Packs | ACCEPTED |
| [0003](WARRANT-ADR-0003-vocabulary-axes.md) | Шесть маркеров, раздельные оси статусов | ACCEPTED |
| [0004](WARRANT-ADR-0004-stable-ids.md) | Stable ID через HTML-комментарии | ACCEPTED (S1 закрыт) |
| [0005](WARRANT-ADR-0005-enforcement.md) | Enforcement в CLI и CI | ACCEPTED |
| [0006](WARRANT-ADR-0006-json-conventions.md) | JSON-конвенции, язык, комментарии | ACCEPTED |
| [0007](WARRANT-ADR-0007-mvp-scope.md) | Объём MVP | ACCEPTED |
| [0008](WARRANT-ADR-0008-naming.md) | Название и границы компонентов | ACCEPTED |
| [0009](WARRANT-ADR-0009-change-record-attestation.md) | Change record и attestation: доверенные писатели состояния | ACCEPTED (уточнён 0010) |
| [0010](WARRANT-ADR-0010-trust-by-reference.md) | Доверие по верифицируемой ссылке; CI не пишет в репозиторий; bot-идентичность агента; форж GitHub | ACCEPTED (уточнён 0020, 0037) |
| [0011](WARRANT-ADR-0011-pr-topology.md) | Два PR на Change + archive; транзиции record в следующем PR; `warrant archive` | ACCEPTED (уточнён 0020, 0033, 0034) |
| [0012](WARRANT-ADR-0012-id-allocation.md) | Выдача ID: NNN immutable с MERGED, ULID для EVID/RUN, реестр AREA | ACCEPTED |
| [0013](WARRANT-ADR-0013-mvp-refinement.md) | Уточнение MVP: sample-проект, TypeScript, агент ведёт slice, core-sdd@0.1 = feature/chore/factory-change | ACCEPTED (уточнён 0018, 0020, 0034) |
| [0014](WARRANT-ADR-0014-claude-code-enforcement.md) | Enforcement в Claude Code: static deny + `warrant guard`, review как subagent | ACCEPTED (уточнён 0017, 0018, 0020, 0034; адаптер `claude` — фаза 4) |
| [0015](WARRANT-ADR-0015-openspec-sync-contract.md) | Контракт `warrant sync` с OpenSpec 1.13.1: что генерируется, schema `warrant-sdd`, что WARRANT читает у OpenSpec (S2, остаток S3) | ACCEPTED |
| [0016](WARRANT-ADR-0016-mutation-diff-scope.md) | Mutation score по diff: формула, порог 0.9, эквивалентные мутанты — частичный waiver, evidence `metrics` | ACCEPTED (уточнён 0025) |
| [0017](WARRANT-ADR-0017-check-execution.md) | `execution` в check: машинный замок `exclusive`, `local` allowed / scoped-only / ci-only, `--paths`, guard по `guard_prefixes` | ACCEPTED (уточнён 0020) |
| [0018](WARRANT-ADR-0018-frontend-adapters.md) | Frontend adapters: нейтральный `warrant guard`, три слоя (ACP client, hooks агента, CI), MVP — Codex в ручном режиме (ACP — S1 SEF, ADR-0020) | ACCEPTED (уточнён 0020, 0022, 0023, 0034: MVP — `claude`) |
| [0019](WARRANT-ADR-0019-post-edit-hints.md) | Подсказки после правки: `validate --files`, канал, видимый модели, без блокировки | ACCEPTED (уточнён 0022) |
| [0020](WARRANT-ADR-0020-warrant-sef-boundary.md) | Граница WARRANT и SEF: argv-гейты, транспорты `github` и `sef-hub` (proposed), MVP без фабрики | ACCEPTED (уточнён 0021, 0022, 0024, 0034) |
| [0021](WARRANT-ADR-0021-archive-immutability.md) | Неизменность архива (`scope-valid`), связи `amends` / `supersedes` в record, `warrant link`, брошенный Change | ACCEPTED |
| [0022](WARRANT-ADR-0022-path-rules.md) | Правила по путям: JSON `rule/1`, `AGENTS.md`, подсказка при правке, Context Pack; guard без Run → `deny` | ACCEPTED |
| [0023](WARRANT-ADR-0023-warrant-dev-frontend.md) | Frontend разработки самого WARRANT: сессии Claude Code без guard, защита — топология PR, review, CI, `validate`; адаптер `claude` — кандидат фазы 4 по S8 | ACCEPTED (уточнён 0034) |
| [0024](WARRANT-ADR-0024-spec-approved-contract.md) | `spec-approved`: контракт `{proposal.md, specs/**}` без `design.md`, gate waivable — правка контракта после approval снимается waiver'ом maintainer'а | ACCEPTED |
| [0025](WARRANT-ADR-0025-test-levels.md) | Уровни тестов WARRANT: `unit`, `app`, `contract`, `e2e`; порты процессов и `Ctx`, фейки с контрактом соответствия, проверки уровней, `validate` без N вызовов `openspec` подряд | ACCEPTED (уточнён 0034) |
| [0026](WARRANT-ADR-0026-graft-experiment.md) | Graft в разработке WARRANT: слепой эксперимент `[A]` / `[B]` по группам задач, только CLI через `scripts/dev/cs.js`, навык `code-search`, без записи в конфиги агента; порог −20 % токенов или tool calls | ACCEPTED (эксперимент закрыт; уточнён 0027, 0028) |
| [0027](WARRANT-ADR-0027-graft-tuning.md) | Graft: донастройка после `test-levels` — парный бенчмарк 8 вопросов, метрика прочитанных байт, детектор отступлений без ложных срабатываний, слепота без памяти и навыка, одна группа — один агент | ACCEPTED (уточнён 0028) |
| [0028](WARRANT-ADR-0028-graft-adoption.md) | Graft: итог эксперимента — `accept` (прочитанное −46 %, токены −22 %, recall 1,0); поиск через `cs.js` и навык `code-search` — стандарт субагентов; обновление Graft — только через регрессию бенчмарка | ACCEPTED |
| [0029](WARRANT-ADR-0029-graft-audit-dev-hooks.md) | Graft: итог аудита — `cs impact` вместо голого `callers`, `cs deps` / `cs dups` / `--json`, регрессия графа против компилятора, хуки разработки в `.claude/settings.json` (только `hooks`) | ACCEPTED (уточнён 0031, 0032) |
| [0030](WARRANT-ADR-0030-module-boundaries.md) | Границы модулей CLI: ранги `core` R0–R4, сценарий перехода `core/transition`, мета-тест `architecture.test.ts` с реестрами помощников и перечислений и храповиком A-N; аудит перед фазой | ACCEPTED (уточнён 0035) |
| [0031](WARRANT-ADR-0031-pretooluse-deny.md) | `PreToolUse deny` у субагентов: отступление от навыка `code-search`, видимое по входу вызова, запрещается до выполнения; код — `packages/`, `scripts/` рабочего дерева; `blocked` в метриках; `cs impact` по слову для не-функций | ACCEPTED (уточнён 0033) |
| [0032](WARRANT-ADR-0032-dev-context.md) | Контекст разработки: у каждого вида знания одно место, NEXT-SESSION упразднён — передача файлом на поток `docs/handoff/`, состояние вычисляет `brief.js` (хук `SessionStart`), долг — `docs/backlog.md`; стандарт навыков и мета-тест; `CLAUDE.md`; навыки OpenSpec без `archive`/`sync`; auto-memory — только личное | ACCEPTED (уточнён 0033) |
| [0033](WARRANT-ADR-0033-git-process.md) | Git и PR разработки WARRANT: человек только решает («merge #N», waivers в теле spec-PR), агент выполняет; навыки `git-start` / `git-land` и `change-*-pr` цепочкой, хук `deny` и у основной сессии (git в основном checkout, force push, `openspec archive`), `pr-form` в CI, гигиена и `structure.test.ts`, `review-impl` до merge | ACCEPTED |
| [0034](WARRANT-ADR-0034-phase-4-frontend.md) | Фаза 4: первый frontend — адаптер `claude` (локальный режим, «стол» SEF), `codex` — до среза S1 SEF; нарезка 3e `core-seams` / 4a Run и guard / 4b producers и `warrant ci` / slice в отдельном репозитории; `ForgePort` на настоящем GitHub; review spec — Claude-субагент с `limitations`; evidence по дереву merge; specs через archive — по record | ACCEPTED (уточнён 0036, 0037, 0039) |
| [0035](WARRANT-ADR-0035-ratchet-external-packages.md) | Храповик границ: реестр внешних пакетов «пакет → владелец» и помощники тестов в `architecture.json` | ACCEPTED |
| [0036](WARRANT-ADR-0036-phase-4b-producers.md) | Нарезка 4b / 4c: producers (`skill-result/1`, `run submit`, `analyze`, `analyze-clean`, `adversarial-review`, находки A-23…A-27) раньше CI (`ForgePort`, `warrant ci`, `subject.tree`); `analyze-clean` — вычисляемый gate; evidence review привязана к дереву spec (`subject.spec_tree`), статус — по `BLOCKER` | ACCEPTED |
| [0037](WARRANT-ADR-0037-phase-4c-ci.md) | Фаза 4c: evidence CI на результате merge, который считает сам job (`subject.commit` — head, `subject.tree` — дерево merge), `STALE` — причина пред-фильтра `tree`, восстановление — `workflow_dispatch`; ref `human-approval` — URL слитого PR с проверкой `merged_by`; `ForgePort` из четырёх методов; I-169 — без `paths.tests` | ACCEPTED |
| [0038](WARRANT-ADR-0038-pr-judged-by-base.md) | PR не задаёт требований к себе: policy-пути, `paths.*`, `roles`, effective policy и классификация для `warrant ci` — из HEAD^1; требования к новому `MERGED` — из политики базы; исполняемое из PR (workflow, судья-CLI) — policy-пути `factory-change` | ACCEPTED |
| [0039](WARRANT-ADR-0039-vertical-slice.md) | Vertical slice MVP: Change `rate-limiter` в публичном `warrant-slice`, bootstrap корневым коммитом, CLI тегом в workflow slice (`github:…#<тег>`), job `warrant` — копией, процесс агенту — правилом проекта → `AGENTS.md`; slice ведёт отдельная сессия под hooks; долг A-31 / A-32 — по отказу slice | ACCEPTED |

Новый ADR: следующий номер, frontmatter как в существующих, строка в этой таблице.
