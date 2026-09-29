---
id: WARRANT-ADR-0034
title: Фаза 4 — первый frontend `claude` в локальном режиме, нарезка 3e / 4a / 4b, ForgePort, review spec Claude-субагентом, evidence по дереву merge
adr_state: ACCEPTED
date: 2026-09-25
supersedes: []
amends: [WARRANT-ADR-0011, WARRANT-ADR-0013, WARRANT-ADR-0014, WARRANT-ADR-0018, WARRANT-ADR-0020, WARRANT-ADR-0023, WARRANT-ADR-0025]
amended_by: [WARRANT-ADR-0036, WARRANT-ADR-0037, WARRANT-ADR-0039]
---

> Уточнено [ADR-0036](WARRANT-ADR-0036-phase-4b-producers.md): п. 6 — 4b делится на `phase-4b` (producers, п. 10) и `phase-4c` (CI, п. 9, 11–14), порядок `core-seams` → 4a → 4b → 4c → slice; evidence review привязана к дереву spec.
>
> Уточнено [ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md): п. 9 — `ForgePort` без `reviews`; п. 12 — результат merge считает сам job (не `refs/pull/<N>/merge`), `STALE` — причина пред-фильтра `tree`, восстановление после merge — `workflow_dispatch`; п. 14 — `ci fetch` выбирает run по совпадению `subject.tree` с деревом merge-коммита.
>
> Уточнено [ADR-0039](WARRANT-ADR-0039-vertical-slice.md): п. 7 — CLI в slice ставится тегом в его workflow (`npm i -g github:Homasters-max/SRA#<тег>`), смена pin — Change `factory-change` в slice.

## Context

Фаза 4 ([13 §2](../13-roadmap.md)) — MVP frontend: `run`, `guard`, `validate --files`, `analyze`, `warrant ci` и первый адаптер. Норма до этого ADR: MVP-адаптер — `codex` (ADR-0018 п. 7, ADR-0020 п. 4), proposed до spike S8; адаптер `claude` — later, кандидат фазы 4 по итогам S8 ([ADR-0023](WARRANT-ADR-0023-warrant-dev-frontend.md) п. 4).

Факты на 2026-09-25:

| Факт | Источник |
|---|---|
| `codex` и `opencode` на машине maintainer'а не установлены; S8 не проводился | `codex --version`, `opencode --version` |
| Хуки Claude Code 2.1.263 проверены зондом: `PreToolUse` / `PostToolUse` проекта срабатывают в субагентах, `additionalContext` доходит до модели, `permissionDecision: "deny"` отменяет вызов и отдаёт причину модели | [graft-audit §4](../process/graft-audit.md), [ADR-0031](WARRANT-ADR-0031-pretooluse-deny.md) |
| `SubagentStop` получает `agent_id`, `agent_type`, `agent_transcript_path`, последнего ответа субагента нет; frontmatter субагента принимает `hooks`; `tools` не принимает `Bash(<pattern>)` | документация Claude Code (не зонд) |
| Черновик SEF: Claude — только интерактивно с владельцем (R8), `claude-agent-acp` не используется (R4), реализацию ведут Codex / OpenCode headless; `.codex/hooks.json` — часть эталона движка (ADR-0020 п. 14) | [черновик SEF](../integrations/2026-09-17-sef-platform-design.md) rev 3 |
| Репозиторий `Homasters-max/SRA` приватный: branch protection недоступна (`403`) | `gh api …/branches/main/protection` |
| Job `evidence` считает на `pull_request.head.sha`, не на результате merge (R-12); шаг «specs только через archive-PR» опознаёт archive-PR по имени ветки (R-16) | `.github/workflows/ci.yml` |
| Аудит 2026-09-25: P1 A-14, A-15, A-16 лежат на пути `guard`; план исправления — §5 отчёта | [audits/2026-09-25.md](../process/audits/2026-09-25.md) |

Решения приняты grilling'ом 2026-09-25 (N1–N17, maintainer принял все рекомендации).

## Decision

### Frontend

1. **Первый frontend MVP — адаптер `claude`** (N1). Slice MVP ведёт Claude Code под hooks в ручном режиме и CI. Решения [ADR-0014](WARRANT-ADR-0014-claude-code-enforcement.md) (static deny, hook `warrant guard`, review-субагент) становятся адаптером `claude` фазы 4, с уточнением п. 3 ниже. Адаптер — **только локальный режим** ([ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md) п. 2, 4): человек ведёт сессию интерактивно — «стол» по R8 черновика SEF; SEF адаптер `claude` не использует, R4 и R8 не затрагиваются. Адаптер `codex` обязателен к срезу S1 SEF (`.codex/hooks.json` в эталоне, ADR-0020 п. 14); фаза 7 оставляет `opencode`.
2. **Нейтральность guard** (N2). Логика — только в `warrant guard` на нормализованном событии (ADR-0018 п. 2); адаптер переводит родной JSON в событие и решение — в родной ответ, больше ничего. Имя frontend встречается только в адаптере (`adapters/frontend/<name>*`), генераторе `sync` и значении `--frontend`; `run/1`, `guard_events[]`, `FRONTEND_HOOKS_INACTIVE` имени frontend не несут. Держится мета-тестом. Контракт адаптера — сценарий `contract` на **записанном родном входе** (stdin хука с версией Claude Code в фикстуре) — исключение из отказа [ADR-0025](WARRANT-ADR-0025-test-levels.md) от записи и воспроизведения: настоящий `claude` в CI без подписки или API-ключа не запускается. Устаревание фикстуры ловит dev-скрипт перезаписи `scripts/dev/probe-hooks.js`, запускаемый при обновлении Claude Code.
3. **`.claude/settings.json` — управляемое подмножество** (N13). `warrant sync` владеет только своими записями: `permissions.deny` ADR-0014 п. 1 и записями `hooks` с командой ровно `warrant guard --frontend claude` на `PreToolUse` / `PostToolUse` (`Edit|Write|Bash`); вставляет и обновляет их, чужие ключи сохраняет, пишет `writeJsonFile`. `validate` сверяет точное наличие своих записей (расхождение — ошибка), а не файл побайтно. `.claude/**` остаётся policy-путём (`factory-change`, ADR-0014 п. 4): иначе агент снимет свой deny обычным Change. Пометку «generated» в JSON поставить нельзя — её роль играет сверка подмножества.
4. **Guard на самом репозитории WARRANT — не в фазе 4** (N14). [ADR-0023](WARRANT-ADR-0023-warrant-dev-frontend.md) п. 1 действует; пересмотр — после пройденного slice MVP.
5. **Spike S8** (hooks Codex) — до адаптера `codex`, то есть до среза S1 SEF, а не до фазы 4 (N10).

### Нарезка и контракт CLI

6. **Порядок** (N3, N7, N8): process-PR инструментов аудита → Change `core-seams` (строка 3e) → Change 4a → Change 4b → slice в sample-проекте.
   - **3e `core-seams`** — находки аудита 2026-09-25 по §5 отчёта: A-15, A-16, A-14, A-17 + A-8, A-18, BL-26 (теги SCN), правила [ADR-0035](WARRANT-ADR-0035-ratchet-external-packages.md). `skip_specs: true`, CLI `0.4.3` первой задачей, пара waivers `analyze-clean` / `adversarial-review`; отступления A-14 / A-15 — `I-N`. Выход — как у 3d: golden, `app`, `contract`, `e2e` без правок ожидаемых значений.
   - **4a** — Run и guard: реестр проверок `validate` (A-9) первой группой, `warrant://run/1`, `run start` (Context Pack, `rules[]`), `guard` pre / post с портом (A-12), `guard_prefixes`, guard без Run → `deny`, `validate --files`, `FRONTEND_HOOKS_INACTIVE`, `sync` → `.claude/settings.json` (п. 3) и `AGENTS.md` с `@AGENTS.md` в `CLAUDE.md` (BL-20; строка в `CLAUDE.md` снята Change `no-claude-md`, D1: Claude Code читает `AGENTS.md` сам), `hint` и `--dry-run` (п. 8); адаптер `claude` — последней группой. Выход: сессия Claude в sample-проекте получает `deny` вне `write_scope` и hints после правки.
   - **4b** — producers gates и CI: `warrant://skill-result/1`, `run submit`, `analyze`, `warrant ci` (п. 9, 11–13), producers `analyze-clean` и `adversarial-review` (п. 10). Выход: verdict impl-PR без ручного переноса artifact'а; новые Changes без пары waivers `WAV-…`.
   - **Slice** — после 4b; критерий выхода MVP (ADR-0013): Claude проходит slice под hooks; в `guard_events[]` нет обойдённого `deny`; `FRONTEND_HOOKS_INACTIVE` отсутствует; ни одна транзиция не записана вне `warrant`. A-5 (типизированные читатели JSON) — не в фазе 4: первый шаг — `WarrantConfig` (A-15), остальные читатели — по мере правок, отдельный ADR — по росту обращений `json["…"]` (N9).
7. **Sample-проект slice** — отдельный репозиторий GitHub (рабочее имя `Homasters-max/warrant-slice`, Python + pytest): своя топология PR, свой CI, свой `warrant.json`, CLI ставится `npm i -g <git-tag>` (N5). Создаёт maintainer перед slice.
8. **Контракт CLI** (N6, линза `cli-contract`). `WarrantError` получает опциональное `hint`, JSON-вывод — `errors[].hint`. Новые команды фазы 4 рождаются с `hint` и `--dry-run` у меняющих состояние. `--dry-run` у `transition` / `archive` / `waive` и `hint` в существующих ошибках — в 4a с delta specs; `core-seams` вводит только фабрику `cliError(code, message, {path?, hint?})` (A-17), без наблюдаемых изменений.

### Producers gates и CI

9. **`ForgePort`** (N4) — реализация интерфейса `forge` ([ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 5) по правилам ADR-0025: методы только используемые (`pullRequest`, `reviews`, `workflowRun`, `listRuns`, `downloadArtifact`), адаптер через `gh api` (одна авторизация: `GITHUB_TOKEN` read-only в CI, `gh auth` локально), `FakeForge` заполняет `ProjectBuilder`. Контракт соответствия — на **настоящем GitHub** против неизменяемых исторических объектов этого репозитория (слитые PR с review, завершённые runs); без `skipIf`.
10. **Adversarial review spec в MVP — Claude-субагент `warrant-reviewer`** (N11; ADR-0014 п. 3). Контракт producer'а нейтрален: `run start --operation review` → исполнитель → `skill-result/1` → `run submit`. Evidence несёт `limitations: ["produced locally, unattested", "same model family as author"]`. Независимость по семействам (ADR-0020 п. 5, Q7) — со вторым исполнителем (`codex exec` или `opencode`) тем же контрактом; триггер — установлен `codex` или `opencode`. Сдача результата из субагента — строкой `I-N` в 4b после зонда (`SubagentStop` не даёт последний ответ; кандидат — хук `PreToolUse` во frontmatter субагента, разрешающий из Bash только `warrant run submit`). Headless `claude -p` не используется (R8 черновика SEF).
11. **Dev-ревью и gate `adversarial-review` — разные объекты** (N12, BL-24): gate проверяет spec на `SPECIFIED → APPROVED` (ADR-0013), навык `review-impl` — код до merge impl-PR; общий у них механизм (субагент и навык), не gate. `review-impl` остаётся с attestation `none`; code review как gate — фаза 5.
12. **Evidence на результате merge** (N15, R-12). `warrant ci` в job `evidence` считает на merge ref PR (`refs/pull/<N>/merge`); evidence получает `subject.tree` — hash дерева результата merge — рядом с `commit` и `base_commit`. `transition MERGED` сравнивает дерево фактического merge-коммита с `subject.tree`; несовпадение (сдвиг `main`, «злой» merge) — evidence `STALE`, CI прогоняется заново. Branch protection «require branches up to date» на приватном репозитории недоступна.
13. **Specs только через archive — по record** (N16, R-16). Правило `warrant ci`: diff `openspec/specs/**` допустим, только если тот же diff несёт переход `MERGED → ARCHIVED` своего Change и совпадает с результатом `warrant archive`. Шаг bash по имени ветки из `ci.yml` удаляется. `warrant ci` выводит Change и переход из diff `.warrant/changes/*.json`, а не из имени ветки.
14. **Evidence impl-PR в archive-PR** (N17, BL-12). Локальная команда шага `change-archive-pr` (рабочее имя `warrant ci fetch <pr>`) через `ForgePort` находит run impl-PR, проверяет принадлежность репозиторию, head sha, `subject.tree` и `conclusion`, скачивает artifact и кладёт evidence в `.warrant/evidence/`; CI archive-PR верифицирует `attestation.ref` (ADR-0010 п. 3). CI в репозиторий не пишет (ADR-0010 п. 1).

## Consequences

- ADR-0013: критерий выхода MVP — «Claude проходит slice под hooks» (исходная формулировка ADR-0013 до ADR-0018).
- ADR-0014: адаптер `claude` — фаза 4; п. 4 уточнён п. 3 (управляемое подмножество вместо файла целиком).
- ADR-0018 п. 7: MVP-адаптер — `claude`; `codex` — до среза S1 SEF после S8; `.codex/hooks.json`, `codex --version ≥ MIN` (BL-8, BL-9 в части Codex, BL-15) — туда же. Нейтральный контракт п. 2 и живость п. 5 не меняются.
- ADR-0020: п. 4 — slice ведёт Claude, не Codex; п. 5 и Q7 — исполнитель review в MVP — Claude-субагент с `limitations`, независимость — со вторым семейством; следствие «адаптер `claude` не планируется» снято для локального режима. Граница с SEF (п. 1–3, 6–15) не меняется.
- ADR-0023 п. 4 исполнен; п. 1 действует до пересмотра после slice.
- ADR-0011: `warrant ci` (Consequences) выводит Change и переход из record, а не из ветки; evidence impl-PR привязан к дереву merge.
- ADR-0025: единственное исключение из отказа от записи и воспроизведения — родной вход frontend в контракте адаптера (п. 2); `ForgePort` проверяется на настоящем GitHub (п. 9).
- Схемы: `evidence/1` — `subject.tree` (минорная правка), `run/1`, `skill-result/1` — новые (BL-3). JSON-вывод ошибок — `errors[].hint`.
- [13-roadmap](../13-roadmap.md): строка 3e, строки 4a / 4b вместо 4, критерий MVP, строка 7, S5, S8, Q6, Q7. [backlog](../backlog.md): «Куда» строк фазы 4 — 3e / 4a / 4b / адаптер `codex`; BL-24 закрыта; новые строки — guard на репозитории WARRANT (п. 4) и второе семейство review (п. 10).

## Alternatives

- **Первым — адаптер `codex`** (норма ADR-0018 п. 7) — отвергнуто: `codex` не установлен, S8 не проведён, а хуки Claude Code проверены зондом; MVP ждал бы spike ради того же контракта `guard`.
- **Нарезка по нейтральности** (4a без frontend, 4b — адаптер) — отвергнуто: нейтральность держит мета-тест, а не граница Change; без адаптера guard не проверяется сквозным путём, а у 4b не было бы собственного критерия выхода.
- **Один Change на фазу** — отвергнуто: spec-PR на десяток команд, общий критерий выхода не проверяется по частям.
- **Находки аудита первой группой 4a** — отвергнуто: spec 4a смешал бы рефакторинг без правок ожидаемых значений с новыми командами.
- **Записанные ответы GitHub API** — отвергнуто: устаревают молча (ADR-0025); исторические объекты репозитория неизменны, меняется только форма API — её и ловит контракт.
- **Sample-проект каталогом в monorepo** — отвергнуто: смешивает CI, ветки и record slice с WARRANT; ADR-0013 отводит репозиторий CLI.
- **Review через `claude -p`** — отвергнуто: автоматизация подписки (R8 черновика SEF). **`opencode` или `codex exec` сейчас** — отвергнуто: установка и ключи ради одного gate до MVP; контракт позволяет подключить их позже.
- **`sync` генерирует `.claude/settings.json` целиком** — отвергнуто: стирает хуки и настройки проекта (в этом репозитории — хуки ADR-0029, ADR-0031, ADR-0033).
- **Guard на репозитории WARRANT в фазе 4** — отвергнуто: каждой группе субагента нужен `run start` и `write_scope`, хуки пересекаются с dev-хуками; сначала адаптер проверяется на sample-проекте.
- **Branch protection «up to date»** — недоступна без GitHub Pro. **Evidence на head** — не судит сдвиг `main`.
- **Archive-PR по имени ветки** — отвергнуто: имя ветки подделывается, переход record проверяется.
- **CI коммитит evidence** — отвергнуто: ADR-0010 п. 1.
