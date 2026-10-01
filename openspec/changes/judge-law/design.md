# Design: judge-law

## Context

База — `main` после archive-PR `exit-contract` (`dcec61e`): CLI 0.10.0 не выпущен, pack `core-sdd` 0.4.1, `kernel` 0.10. Норма — [ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 3–4. Факты кода собраны 2026-10-01 на `dcec61e`; пути — от `packages/cli/src`.

**Закон перехода сейчас:**
- hash effective policy считает `resolve` (`core/resolve/merge.ts:127-219`, `canonicalHash(content)`, `:213`). В hash входят `risk_level`, `artifacts`, `gates` переходов, `capabilities.forbidden`, `approvals`, `evidence.required`; не входят `sources` и `explain`.
- Судья сверяет hash только у нового `MERGED`: функция `mergedRules` (`core/ci/record.ts:123-169`) сравнивает его с `basePolicy`, то есть с законом HEAD^1 archive-PR для классификации HEAD. Ключи `gates` проверяются только при совпавшем hash. Ошибка в обоих случаях — `RECORD_MISMATCH` с причиной `policy`.
- У остальных переходов вперёд проверяется только наличие строки hash (`record.ts:383-385`).
- `withBase(ctx, commit, use)` (`core/ci/base.ts:44-57`) уже работает для любого коммита: worktree, `loadPacks`, `acceptChangedLaw`. Сбой `worktreeAt` бросает `USAGE`.
- `mergeLaw` (`core/ci/merge.ts:144-165`) — образец «закона на коммите» для M^1. Он закрывается fail-closed `law(reason)`, если:
  - packs M^1 дают ошибки;
  - `changedBundledPacks` непуст;
  - record или diff не найден;
  - `resolveRecord` не составился.
- Встроенный pack берётся из установленного CLI. Коммит узнаёт его только по `hash` в своём lock (`changedBundledPacks`, `base.ts:120-132`).
- Порт `GitPort` (`core/ports/git.ts`) даёт `mergeBase`, `firstParents` (без фильтра путей), `parents`, `diffNameStatus`, `worktreeAt`. Списка boundary-коммитов диапазона в порту нет.
- Policy-пути — `match.paths` профиля `factory-change` (`policyPaths`, `core/packs/objects.ts:102-106`). В SRA к ним относится и `packages/cli/src/**`: любой слитый impl-PR меняет policy-пути.
- CI checkout полный (`fetch-depth: 0`, `.github/workflows/warrant.yml:77`).

**R-45:**
- `loadPacks` собирает ошибки packs в `errors[]`, а `loadConfig` бросает `CONFIG_MISSING` или `CONFIG_INVALID` (`core/config.ts:137-156`).
- `mergeLaw` и `mergedByLaw` (`core/ci/refs.ts:135-153`) это исключение не ловят. Весь `warrant ci` завершается кодом 3 через `resultFromThrown`.
- Тесты D3 `agent-merge` — `test/app/commands/ci.test.ts:1172-1270`. Сломанного `warrant.json` M^1 среди них нет.

**A-45, основание `NOT_APPLICABLE` по evidence:**
- Движок, `evidencePart` (`core/gates/verdict.ts:166-235`), по каждому требованию: кандидаты `satisfies`, затем принятые по `attestationAccepted` (`:94-101`), затем `freshest` (`:110-122`). `NOT_APPLICABLE` — если все выбранные записи `NOT_APPLICABLE` и `fromCheck`.
- Судья, `verdictsRule` (`core/ci/record.ts:276-346`): `some` по любой записи `evidence[]` перехода, `byCheck` (`:259-262`) — копия приватной `fromCheck`. У `MERGED` он требует `attestation.type: "ci"` и `subject.commit` M^2, а `accepts_attestation` не читает.
- `producerOf` (A-43) в коде нет.

**A-47, ref перехода:** «PR этого репозитория по ref» разобран в пяти местах:
- `judgeRefs` (`refs.ts:179-193`);
- `mergedPullOf` (`refs.ts:89-96`);
- `judgeDecisions` (`core/ci/decisions.ts:70-81`);
- `pullOf` (`core/ci/fetch.ts:53-68`);
- `defaultBranch` (`core/ci/archive.ts:120-125`), без сверки репозитория.

Ещё `approvedPr` (`core/ci/judge.ts:95-100`) разбирает номер PR. Кэша нет: `ForgeGh.pullRequest` ходит в API на каждый вызов. M одного `MERGED` ищут `judgeRefs` и `mergeOfMerged` (`refs.ts:103-113`) — с разными предусловиями.

**A-34, разбор `requires_evidence`:**
- `requirementsOf` (`verdict.ts:67-78`) — проверяет `status`;
- `checksForTransition` (`core/check/execute.ts:42-67`);
- `requiresKind` (`core/gates/l0/evidence-complete.ts:17-20`);
- `gateKinds` (`core/resolve/index.ts:41-55`);
- `weakenings` (`core/packs/overrides.ts:87-120`) — проверяет `status`;
- `transitionFed` (`core/ci/impl.ts:51-55`);
- `gateCheckErrors` (`core/packs/objects.ts:40-69`).

`produces` читают:
- `execute.ts:65`, `:127`, `:338`;
- `impl.ts:96`;
- `record.ts:117-119` (`checkKinds`);
- `gateCheckErrors`.

Схема `gate/1` требует у элемента `kind` и `status` (`schemas/gate.1.schema.json:48-70`).

**A-40, «нужен человек»:**
- `requiresHuman(policy, transition)` (`core/roles.ts:58-60`) — по id gate. Его зовут `humanAcceptance` (`base.ts:103-108`) и `mergedByLaw` (`refs.ts:142`).
- Копия того же выражения — `forward` (`commands/transition.ts:197`).
- По kind спрашивают `transitionFed` (`every`, `impl.ts:51-55`) и `controllerInputs` (`some`, `core/controller/inputs.ts:76-77`).

**R-46:**
- `bin/warrant.ts:597-609`: action `guard` без `--frontend` зовёт `run`. Исключение runner'а `run` ловит сам (`:102-113`, `resultFromThrown`): наружу выходит `INTERNAL`, код 3.
- `runGuardCrash` (`commands/guard.ts:26-28`) зовёт только `onCrash` (`bin/crash.ts`) — на `uncaughtException`.

**Архитектура** (`test/unit/meta/architecture.json`):
- ранги: `core/packs` — 1, `core/roles` — 2, `core/gates` — 3, `core/ci` — 4;
- импорт `core/ci` → `core/gates/predicates.ts` разрешён и уже есть (`record.ts:22`);
- реестр `helpers` (`:49-90`) — `{ name, owner }`; правило сверяет только имена (`byCheck` и `fromCheck` не ловит).

## Goals / Non-Goals

**Goals:**
- Закон каждого нового перехода вперёд проверяем: hash и состав gates — закон `main` или HEAD.
- Основание записанного `NOT_APPLICABLE` вычисляет один предикат для движка и судьи. Evidence судья по-прежнему не пересчитывает (N44).
- Ref, M, M^1 и diff M судья вычисляет один раз; каждый PR форж отдаёт один раз за прогон.
- Сломанная конфигурация M^1 закрывает исключение agent-merge, а не роняет прогон.
- Требования gate, виды check и признак «нужен человек» имеют по одному владельцу.

**Non-Goals:** — proposal.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | **Закон на коммите — одна функция.** Новый модуль `core/ci/law.ts`, функция `lawAt(ctx, commit, classifications)`.<br>• Строит законы коммита через `withBase` для каждой классификации, профили которой известны packs коммита.<br>• Возвращает `{ computed: true, laws[] }` (каждый закон — `{ hash, gates }`) или `{ computed: false, reason }`.<br>• Не вычислен, если: `loaded.errors` непусты ; `kernel` lock коммита (major.minor, как сверяет `checkLock`, `core/packs/hash.ts:96-97`) — не `KERNEL_VERSION`; `changedBundledPacks` непуст; `loadPacks` или `loadConfig` бросили `CONFIG_MISSING` или `CONFIG_INVALID`.<br>• Форма hash effective policy (`resolve`, `content`) — часть kernel: её правка поднимает minor CLI (`KERNEL_VERSION` — major.minor CLI), и законы коммитов со старым kernel становятся «не вычислен», а не ложным несовпадением (review 1, F-5). Правило держит unit-тест: hash effective policy фикстуры закреплён вместе с `KERNEL_VERSION`; другой hash при том же kernel — красный тест с подсказкой поднять minor (review 2, F-4).<br>• По каждой классификации `lawAt` различает: закон; `POLICY_CONFLICT`; профиль, которого нет в packs. Окно (D2) два последних исхода пропускает, `mergeLaw` закрывает на них исключение agent-merge, как сейчас (review 2, F-5).<br>• `POLICY_CONFLICT` и профиль, которого нет в packs, закона не дают и причиной «не вычислен» не считаются: переход на таком коммите не записывается.<br>• Сбой `worktreeAt` (`USAGE`, коммита нет в checkout) остаётся ошибкой окружения, код 3, как у базы.<br>• `mergeLaw` строится на `lawAt` |
| D2 | **Окно законов** — `lawWindow(ctx, subject, base)` в `core/ci/law.ts`.<br>• Точка ответвления — самый ранний коммит first-parent линии HEAD^1 среди родителей коммитов PR. Новый метод порта `GitPort.boundary(base, head)` (`git rev-list --boundary base..head`, только boundary-строки), адаптер `adapters/git.ts`. Пересечения с first-parent линией нет — последний коммит first-parent линии HEAD^1, предок HEAD^2 (`isAncestor` по `firstParents(HEAD^1)`), а не `mergeBase`: тот может лежать на боковой ветке (review 4, F-1, SCN-VER-150).<br>• Коммиты окна — first-parent линия HEAD^1 после точки ответвления, чей `diffNameStatus(c^1, c)` задевает `basePolicyPaths(base)` или входы закона (`.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.warrant/local/**`); плюс сама точка ответвления и HEAD. Объединение держит правило ADR-0052 п. 4 и не зависит от того, лежат ли входы закона в policy-путях потребителя (review 1, F-14).<br>• Коммит, у которого `git.tree(c, входы)` равен дереву уже вычисленного коммита, получает его закон без worktree: в SRA `packages/cli/src/**` (policy-путь) меняет каждый impl-PR, а входы закона — редко (F-15).<br>• Сбой git при построении окна (коммита нет в checkout) — `USAGE` с `hint`, код 3, как у базы (F-13).<br>• Законы вычисляются лениво, от новых к старым: HEAD, затем коммиты окна от HEAD^1 к точке ответвления. Обход останавливается, когда hash каждого нового перехода найден.<br>• Классификации — `classification` record базы (если он есть) и HEAD; одинаковые считаются один раз |
| D3 | **Правило закона перехода** — в `judgeRecord`, для каждого нового перехода вперёд, кроме `PROPOSED`.<br>• Hash найден — ключи `gates` перехода (сортировка) сравниваются с `gates[<from>-><to>]` этого закона. Расхождение — `RECORD_MISMATCH`, причина `policy`, pointer `#/transitions/<i>/gates`.<br>• Не найден, и все законы окна вычислены — `RECORD_MISMATCH`, причина `policy`, pointer `#/transitions/<i>/effective_policy_hash`.<br>• Не найден, а хотя бы один закон коммита `main` окна не вычислен — находка `LAW_NOT_COMPUTED` в `data.findings[]`. В `message` — переход и коммиты невычисленных законов с причинами; одна находка на переход. Код находки — в каталоге информационных находок рядом с `AGENT_MERGE_CLOSED`.<br>• Невычисленный закон HEAD находки не даёт и нарушение не снимает: его условие задаёт сам PR (review 1, F-8, U-1).<br>• Из `mergedRules` уходят сверка hash и ключей `gates` с `basePolicy`; правило `ci_evidence` остаётся по базе (D3a) |
| D3a | **Определения для оснований** (review 2, F-3; review 3, F-1). `verdictsRule` и правило `ci_evidence` берут определения gates и checks из базы, gate или check, которого в базе нет, — из HEAD; gate, которого нет ни в базе, ни в HEAD, основания не требует (его набор держит hash закона окна). Определение из закона, совпавшего с hash, отвергнуто: hash покрывает id gates, а не определения, и с одним hash совпадают несколько законов с разными определениями. Цена: определение, ужесточённое в `main` после перехода, судит записанный verdict (SCN-VER-148, норма ADR-0038 п. 1); восстановление — повтор перехода |
| D3b | **CLI против lock** (review 3, F-2; review 4, F-2, F-6; уточняет I-179). Lock на HEAD, не совпадающий с CLI (встроенные pack, включённые в `warrant.json`, по `hash` и `kernel` major.minor — своя проверка, а не весь `checkLock`: локальный дрейф lock остаётся за `validate`, review 5, F-5), и такой же lock базы при diff PR без `.warrant/warrant.lock.json` — `LOCK_MISMATCH` с путём lock и `hint` «lock записан другим CLI: `warrant sync` тем CLI, которым судит CI», код 3, вместо «закон изменён самим PR» (`factory-change` в impl, `SCOPE_VIOLATION` в остальных видах). PR, меняющий закон, меняет и lock (`warrant sync`, `validate`); без этого правила потребитель, поднявший CLI без `warrant sync`, получил бы невычисленными все законы `main` окна, и любой подложный hash стал бы находкой `LAW_NOT_COMPUTED`. Lock HEAD, не совпадающий с CLI, иначе сделал бы невычисленными и закон HEAD, и законы окна. Тест I-179 (`ci.test.ts`, «a bundled pack not held by the lock of the base») переводится на lock в diff и получает случаи без lock и с lock HEAD другого CLI — код 3 |
| D4 | **R-45.** `mergeLaw` через `lawAt` (D1) получает «не вычислен» с причиной «`warrant.json` M^1 нет или непригоден» вместо исключения. `MergeLaw.config` становится необязательным. Без него `mergedByLaw` берёт `roles.maintainer` и `identities.agents` базы требований (HEAD^1), исключение закрыто, находка `AGENT_MERGE_CLOSED` несёт причину. Код ref — как у прочих fail-closed причин |
| D5 | **Предикаты основания по evidence** (A-45) — в `core/gates/predicates.ts`:<br>• `fromCheck(record)`;<br>• `satisfies(requirement, record)`, `freshest(records)` и `attestationAccepted(definition, transition)` — переносятся из `verdict.ts`;<br>• `chosenRecord(requirement, records, accepts)` → `{ record?, candidates }`;<br>• `notApplicableByEvidence(requirements, records, accepts)` — требования непусты, у каждого есть выбранная запись, и все они `NOT_APPLICABLE` и `fromCheck`.<br>`evidencePart` зовёт `chosenRecord` и `notApplicableByEvidence`.<br>`verdictsRule` зовёт `notApplicableByEvidence` с `accepts` = `attestationAccepted(definition, to)` и сужением `chosen` для `MERGED`: выбранная запись ещё несёт `attestation.type: "ci"` и `subject.commit` M^2 (если M найден). Сужение — после выбора, а не фильтр до него: иначе старая `ci` `NOT_APPLICABLE` победила бы более свежую `PROVEN` (review 5, F-7). `byCheck` удаляется.<br>Имена — в реестр `helpers` с владельцем `core/gates/predicates.ts` |
| D6 | **Ref перехода — один шаг** (A-47).<br>• `pullOfRef(ctx, ref)` в `core/ci/refs.ts` принимает URL PR или номер. Делает разбор, `forge.pullRequest` и сверку `owner/repo`; возвращает `{ pull }` или `{ reason: "repository" }`.<br>• Запросы PR одного прогона мемоизирует обёртка порта форжа: `memoForge(forge)` ставит `judgePullRequest` и `ci fetch`.<br>• `transitionRefs(ctx, subject, transitions)` до правил строит для каждого нового `APPROVED` и `MERGED` `{ index, pull? , reason?, merge?, mergeDiff? }`, у `MERGED` — M по правилу ref.<br>• Результат получают `judgeRefs`, `verdictsRule` (M и diff M), `verifyCiEvidence` (ветка по умолчанию) и `judgeDecisions` (PR перехода `APPROVED`, вместо `approvedPr`).<br>• `fetch.ts` и разбор URL комментария в `decisions.ts` зовут `pullOfRef`.<br>• `mergedPullOf`, `mergeOfMerged`, `approvedPr` и замыкание `defaultBranch` удаляются.<br>• Вердикт не меняется: ветка по умолчанию берётся у PR этого репозитория, а ref чужого репозитория уже даёт `REF_NOT_VERIFIED` |
| D7 | **Один разбор видов** (A-34) — в `core/packs/objects.ts`:<br>• `requirementsOf(gate)` и тип `Requirement` — переносятся из `verdict.ts`;<br>• `producedKinds(check)` — новая.<br>Их зовут все места разбора: `checksForTransition`, `requiresKind`, `gateKinds`, `weakenings`, `transitionFed`, `gateCheckErrors`, `checkKinds`, `judgeImpl` и три места `execute.ts`.<br>Строки `helpers` с владельцем `core/packs/objects.ts`. Ранг 1 ниже всех потребителей |
| D8 | **«Нужен человек»** (A-40) — это два понятия, у каждого один предикат в `core/roles.ts`:<br>• `requiresHuman(policy, transition)` — нужен ли переходу акт человека (id gate). Его зовёт и `forward` в `commands/transition.ts`;<br>• `humanEvidence(requirement)` — пишет ли эту запись акт человека через `warrant transition` (kind `human-approval`). `transitionFed` спрашивает `every`, `controllerInputs` — `some`.<br>Строка `helpers` для `humanEvidence` |
| D9 | **`warrant guard`** (R-46). `run` в `bin/warrant.ts` получает необязательный перевод исключения в результат; по умолчанию — `resultFromThrown`. Action `guard` без `--frontend` передаёт `(thrown) => runGuardCrash(crash.guardInput, thrown)`: решение `deny` (или `allow` в фазе `post`, I-236), код 0. Перевод — экспортируемая функция `commands/guard.ts`, тест зовёт её и `run` напрямую |
| D10 | **`run submit`** (BL-105). Код ошибки уже выбирает класс (`exit-contract`). Меняется текст REQ-ENF-007: ошибки до записи — 3, ничего не записано; файлы — одним планом в порядке `finishRun` (`core/run/lifecycle.ts:99-120`: результат, evidence, manifest, Run, удаление `current`); ошибка записи по REQ-KRN-036 (`BUSY` — 4, иная — 3), файлы раньше по порядку REQ-KRN-036 остаются, Run активен, повтор того же envelope завершает Run путём повтора ADR-0044 п. 5 (review 1, F-1). Откат записанных файлов отвергнут: откат сам может упасть на `BUSY`, а путь повтора уже есть. Тест SCN-ENF-047 — `BUSY` на записи файла Run, затем повтор |
| D11 | **Версии и CHANGELOG.** Версии не поднимаются: CLI 0.10.0, pack `core-sdd` 0.4.1 и `kernel` 0.10 уже подняты после `v0.9.0`; pack и схемы не меняются. В `CHANGELOG.md`, `## 0.10.0 — не выпущена`, дополняется раздел «Вердикт»: окно законов, `LAW_NOT_COMPUTED`, `NOT_APPLICABLE` по самой свежей записи, M^1 без `warrant.json`, `guard`. «Миграция для потребителя»: record, записанный не по закону `main`, теперь красит CI — откат коммита перехода и повтор перехода; lock, записанный не тем CLI, которым судит CI, — `LOCK_MISMATCH`, код 3 (D3b): `warrant sync` версией CLI из workflow |

### 2. Альтернативы

- **Опорный коммит на переход** (`SPECIFIED` — точка ответвления, `APPROVED` — M spec-PR). Отвергнуто в ADR-0052: сдвиг `main` между merge spec-PR и ответвлением impl-PR даёт отказ честному record.
- **Окно от `merge-base(HEAD^1, HEAD^2)`.** Отвергнуто: после merge `main` в ветку merge-base сдвигается вперёд, и законы переходов, записанных до этого merge, выпадают из окна.
- **Только закон HEAD^1 для всех переходов.** Отвергнуто: ломается сдвигом `main`, как опорный коммит.
- **Невычисленный закон — нарушение.** Отвергнуто: каждый PR, поднимающий встроенный pack, получал бы отказ по переходам, записанным старым CLI. Правка pack — путь класса приёмки, PR сливает maintainer.
- **Все законы окна сразу.** Отвергнуто: в SRA каждый слитый impl-PR меняет policy-пути (`packages/cli/src/**`), и окно долгого PR — десятки worktree. Ленивый обход обычно останавливается на HEAD или HEAD^1.
- **Отбор коммитов окна только по policy-путям.** Отвергнуто: у потребителя policy-пути могут не содержать входы закона, и смена закона выпала бы из окна (F-14).
- **Отбор только по входам закона.** Отвергнуто: ADR-0052 п. 4 задаёт policy-пути; объединение с дедупликацией по дереву входов стоит столько же.
- **Невычисленный закон HEAD — `LAW_NOT_COMPUTED`, как у `main`.** Отвергнуто: PR сам ломает свой lock или `warrant.json` и превращает любой подложный hash в находку (U-1).
- **Основание `applies_when` у переходов, кроме `MERGED`, по diff всего PR.** Отвергнуто: diff растёт после перехода, и `APPROVED`, записанный в начале impl-PR, получил бы ложный отказ. Остаётся остаточный риск (proposal, Non-Goals).
- **Судья исполняет `evaluateGates`.** Отвергнуто ADR-0052 п. 3: снимает N44.
- **Судья читает `accepts_attestation` у `MERGED` без требования `ci`.** Отвергнуто: запись `human-review` или `signature` прошла бы как evidence run impl-PR, а правило `ci_evidence` требует `ci`.
- **`producerOf` (A-43) вместо `fromCheck`.** Отвергнуто: функции нет, а `fromCheck` — ровно нужный вопрос.
- **Кэш PR в адаптере `forge-gh`.** Отвергнуто: адаптер живёт дольше прогона в тестах, а мемоизация на прогон — свойство судьи.
- **`try/catch` внутри runner'а `guard`.** Отвергнуто: исключения `productionCtx` и `projectRoot` случаются до runner'а.

### 3. Порядок

- Группа 1 — рефакторинг без смены вердикта: разбор видов (D7) и «нужен человек» (D8). Существующие тесты держат поведение.
- Группа 2 — предикаты A-45 (D5), SCN-VER-144.
- Группа 3 — ref одним шагом (D6). Нужен до группы 4: окну и R-45 нужен M.
- Группа 4 — `lawAt` и R-45 (D1, D4), SCN-VER-145.
- Группа 5 — окно и правило закона (D2, D3), SCN-VER-140…143.
- Группа 6 — `guard` (D9) и `run submit` (D10).
- Группа 7 — документы (D11).

impl-PR сливает maintainer: пути CLI — класс приёмки (ADR-0051 п. 2).

### 4. Риски

- **Закон ветки, а не `main`.** Если impl-PR меняет закон (pack, `.warrant/local/**`), а `main` после точки ответвления тоже его менял, закон переходов ветки — «точка ответвления + PR». Он не равен ни одному закону окна. Восстановление: merge `main` в ветку и повтор перехода (`VERIFYING->IMPLEMENTING->VERIFYING`). Случай редкий: оба изменения — пути класса приёмки.
- **`LAW_NOT_COMPUTED` прячет подложный hash**, пока в окне есть закон с другим встроенным pack или kernel. Без lock в diff lock базы совпадает с CLI (D3b), и невычисленными бывают только коммиты `main` до смены lock в `main`. С lock в diff (PR поднимает pack или kernel) невычисленными бывают все законы `main` окна (review 5, F-4): lock — policy-путь, impl-PR с ним требует `factory-change`, его сливает maintainer.
- **Форма hash меняется дважды внутри невыпущенного minor** (review 3, F-7): `kernel` тот же, и records, записанные промежуточным CLI, получают `policy`. В SRA CLI собран из HEAD, records в полёте — единицы; тест формы hash (D1) подсказывает: в выпущенном kernel — поднять minor, в невыпущенном — обновить фикстуру и строку CHANGELOG о повторе переходов.
- **Цена прогона.** Каждый вычисленный закон — worktree и `loadPacks`. Ленивый обход (D2) обычно ограничен HEAD и одним-двумя коммитами. Худший случай — честный record с законом точки ответвления после долгого PR.
- **`requirementsOf` в `gateCheckErrors`** отбрасывает элемент без строкового `status`, а прежний разбор его видел. Объекты packs проходят схему `gate/1` при загрузке, и такой элемент даёт ошибку схемы раньше.
- **Переписанная история ветки** (rebase) сдвигает точку ответвления, и закон переходов до rebase может выпасть из окна (F-6). В SRA force push запрещён (ADR-0033 п. 9); ветку обновляет merge `main`. Восстановление — `git revert` коммита перехода и повтор `warrant transition` до merge PR.
- **Промежуточная классификация или промежуточный закон ветки** (classify, изменённый после перехода; pack ветки до последней правки) — нарушение `policy` (F-7), восстановление то же. Переход назад старый переход в record не снимает: суффикс новых переходов судится целиком.
- **Переходы, записанные до 0.10.0 по закону, которого нет в окне**, например после ручной правки record. Этот record теперь красит CI. Так и задумано — это и есть закрытая дыра WS-03; миграция — в CHANGELOG.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-242 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 1, RUN-01M3V9HN13E8EJ5JJ7WVZJEP5F) закрыт правкой spec до раунда 2: F-1 — REQ-ENF-007 и SCN-ENF-047 (D10); F-2 — исключение в «База требований»; F-3 — убрано «слил maintainer»; F-4 — `PROVEN` в SCN-VER-144; F-5 — kernel в D1 и «Record»; F-6, F-7 — граница и восстановление в «Record», риски; F-8, U-1 — закон HEAD без отговорки, SCN-VER-146; F-9 — policy правила `ci_evidence`; F-10 — `.warrant/local/**` в законе; F-11 — выбор записи описан без ссылки на текст REQ-VER-003; F-12 — SCN-VER-145; F-13 — сбой git, код 3; F-14, F-15 — окно по policy-путям и входам закона с дедупликацией (D2); SCN-VER-147 — окно после merge `main` в ветку | `specs/**`, `design.md`, `proposal.md` |
| I-243 | Review spec раунда 2 (PROVEN, MAJOR 4, MINOR 6, RUN-01M3VACYVJNZZQXZ1ZXTS7C9V3) закрыт правкой spec и раундом 3, а не waiver на `spec-approved` в impl-PR (прецедент `exit-contract`, раунды 2–3): F-3 — MAJOR о fail-open и ложном отказе честному record дешевле закрыть до `SPECIFIED`. F-1, F-2 — план записи и ошибка записи в REQ-ENF-007 (D10); F-3 — D3a и абзац определений в «Record»; F-4 — `kernel` lock, тест формы hash (D1); F-5 — `POLICY_CONFLICT` M^1 в «Ref», D1; F-6 — запасной вариант базы в двух фразах «Ref»; F-7 — pointer в требовании; F-8 — SCN-VER-108; F-9 — SCN-VER-144; F-10 — SCN-VER-147; F-11 (INFO) — текст REQ-VER-003 без tie-break по id и ограничения `accepts_attestation`: строка backlog | `specs/**`, `design.md`, `tasks.md` |
| I-244 | Review spec раунда 3 (NOT_PROVEN, BLOCKER 1, RUN-01M3VB2A0E55B22CSMQM86BFN6) закрыт правкой spec до раунда 4: F-1 — определения для оснований из базы (D3a, SCN-VER-148), обещание «сдвиг `main` не ломает» сужено до hash и ключей `gates`; F-2 — lock базы против CLI (D3b, SCN-VER-149); F-3 — «одной из других причин»; F-4 — сбой удаления `current` в REQ-ENF-007; F-5 — снято D3a (исключение «База требований» — только закон перехода); F-6 — закон HEAD по тем же условиям; F-7 — риск и подсказка теста; F-8 — D3 согласован с D3a | `specs/**`, `design.md`, `tasks.md` |
| I-245 | Review spec раунда 4 (PROVEN, MAJOR 1, MINOR 6, RUN-01M3VBN1ZKNH6DYKTH33TENCXJ) закрыт правкой spec и раундом 5 (последним: оставшиеся MAJOR — строками backlog): F-1 — запасная точка ответвления на first-parent линии (D2, SCN-VER-150); F-2, F-6 — lock HEAD против CLI и `hint` (D3b); F-3 — предусловие SCN-VER-142; F-4 — второе исключение «База требований», SCN-VER-151; F-5 — сбой удаления `current` — код 3; F-7 — proposal и CHANGELOG (D11); F-9 — `docs/04-lifecycle.md` убран из Impact | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
| I-246 | Review spec раунда 5 (NOT_PROVEN, BLOCKER 1, MINOR 7, RUN-01M3VCBZE93S8WX2KR834TTZFS) закрыт правкой spec до раунда 6: F-1 — предусловие SCN-VER-146 (packs HEAD не загружаются) и условия невычисленного закона HEAD после `LOCK_MISMATCH`; F-2 — PR судится дальше, правило закона не выполняется, `--dry-run` lock не сверяет; F-3 — SCN-VER-139 с синхронным lock; F-4 — риск lock в diff; F-5 — объём сверки lock (D3b); F-6 — вывод при сбое удаления `current`; F-7 — сужение судьи после выбора (D5); F-8 — несвязанные истории — точка ответвления HEAD^1 | `specs/**`, `design.md` |
