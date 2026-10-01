# Proposal: judge-law

## Why

Судья archive-PR и impl-PR (`warrant ci`) сверяет закон перехода только у `MERGED`, и только с базой самого archive-PR. У `SPECIFIED`, `APPROVED`, `IMPLEMENTING`, `VERIFYING` и `ARCHIVED` значение `effective_policy_hash` не сверяется ни с какой policy: PR мог записать переход по закону, которого в `main` не было (остаток WS-03, S1).

Основание записанного `NOT_APPLICABLE` «по evidence от check» существует в двух копиях: у движка gates и у судьи. Копии уже разошлись. Более старая запись `NOT_APPLICABLE` рядом со свежей `PASS` того же требования для судьи основание, а для движка нет (A-45, P1).

Ещё четыре дефекта судьи:

- ref перехода разрешается заново в каждом правиле, в пяти копиях (A-47);
- если `warrant.json` на M^1 сломан или его нет, весь `warrant ci` падает с кодом 3, а не закрывает исключение agent-merge fail-closed (R-45);
- виды evidence gate и check разбирают семь и шесть функций (A-34);
- признак «нужен человек» вычисляется в трёх местах по-своему (A-40).

[ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 1, 3, 4 ставит это вторым Change 0.10.0, после `exit-contract`.

## What Changes

- **Окно законов `main`** (ADR-0052 п. 4). Правило касается каждого нового перехода вперёд, кроме `PROPOSED`, и `MERGED` тоже:
  - `effective_policy_hash` перехода SHALL совпасть с hash одного из допустимых законов;
  - ключи `gates` перехода SHALL совпасть с gates этого перехода в том же законе.

  Допустимый закон — effective policy на одном из коммитов окна:
  - точка ответвления PR;
  - коммиты first-parent линии HEAD^1 после точки ответвления, меняющие policy-пути;
  - HEAD.

  Классификация закона — `classification` record базы или HEAD. Если текущий CLI не вычисляет закон коммита (например, встроенный pack другой версии), это информационная находка `LAW_NOT_COMPUTED`, а не нарушение. Сверка `MERGED` с базой archive-PR заменяется этим правилом.
- **Основание `NOT_APPLICABLE` по evidence — одним предикатом с движком** (ADR-0052 п. 3, A-45). Для каждого требования gate берётся самая свежая подходящая запись `evidence[]` перехода, принятая по attestation, как у REQ-VER-003. Основание есть, только если все такие записи — `NOT_APPLICABLE` от check. У `MERGED` судья дополнительно требует `attestation.type: "ci"` и `subject.commit` M^2. Evidence судья по-прежнему не пересчитывает (N44).
- **Ref перехода — один шаг до правил** (A-47). PR, M, M^1 и diff M вычисляются один раз, и правила получают готовый результат. Каждый PR форж запрашивает один раз.
- **M^1 с непригодным `warrant.json`** (R-45). Исключение agent-merge закрыто fail-closed: роль одобрения — `roles.maintainer`, вывод несёт находку `AGENT_MERGE_CLOSED`. Падения с кодом 3 больше нет.
- **Один разбор видов evidence** (A-34): требования gate и виды, которые производит check, читает одна пара функций.
- **Признак «нужен человек» — один** (A-40): переход спрашивает `requiresHuman`, а по kind спрашивает один предикат.
- **`warrant guard`** без `--frontend` (R-46): исключение runner'а даёт `deny` с кодом 0 (REQ-ENF-004), а не `INTERNAL` с кодом 3.
- **`run submit`** (BL-105): код выхода ошибки — по классу кода (REQ-KRN-003). `BUSY` атомарной записи даёт 4, а не 3.
- Версии не поднимаются: CLI 0.10.0 и pack `core-sdd` 0.4.1 уже подняты после `v0.9.0` (`exit-contract`). CHANGELOG — дополнение раздела `## 0.10.0`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification` — REQ-VER-011, разделы:
  - «Record»: окно законов `main` для hash и gates всех новых переходов вперёд, `LAW_NOT_COMPUTED`, основание `NOT_APPLICABLE` по самой свежей записи;
  - «Ref»: непригодная конфигурация M^1 закрывает исключение agent-merge.
- `enforcement` — REQ-ENF-007: код выхода ошибки `run submit` — по классу кода.

## Non-Goals

- **Основание `applies_when` у переходов, кроме `MERGED`.** Diff, на котором вычислялся переход, судье недоступен; diff всего PR не годится (design, альтернативы). Остаточный риск остаётся, долг — новой строкой backlog.
- **Судья не исполняет `evaluateGates`** над записанным evidence: N44 держится, иначе нужен отдельный ADR (ADR-0052 п. 3).
- **Floor профиля, `feature` по `paths.src`, пустой `profiles`, `dangling` в тестах** — Change `code-floor` (ADR-0052 п. 5–6).
- **Кэш законов между прогонами `warrant ci`.** Окно вычисляется в каждом прогоне заново.
- **Отбор коммитов окна по входам закона**, а не по policy-путям: правило ADR-0052 п. 4 сохраняется.

## Impact

- Код:
  - `packages/cli/src/core/ci/{record,refs,merge,base,judge,impl,archive,decisions,fetch}.ts` и новый `core/ci/law.ts`;
  - `core/gates/{verdict,predicates}.ts`, `core/packs/objects.ts`, `core/roles.ts`;
  - `core/check/execute.ts`, `core/gates/l0/evidence-complete.ts`, `core/resolve/index.ts`, `core/packs/overrides.ts`, `core/controller/inputs.ts`;
  - `commands/{transition,guard}.ts`, `bin/warrant.ts`;
  - `core/ports/git.ts`, `adapters/git.ts`.
- Тесты — `packages/cli/test/**`:
  - `app/commands/ci.test.ts`: окно законов, `NOT_APPLICABLE`, M^1;
  - unit `gates/predicates`, `meta/architecture.json` (реестр `helpers`);
  - `guard`, `run submit`.
- Документы:
  - `CHANGELOG.md` (`## 0.10.0`);
  - `docs/backlog.md`: закрываются WS-03, A-34, A-40, A-45, A-47, R-45, R-46, BL-105; новая строка — `applies_when` у переходов, кроме `MERGED`;
  - `docs/04-lifecycle.md`, если там описана сверка hash.
- Spec: `openspec/changes/judge-law/specs/{verification,enforcement}/spec.md`.
