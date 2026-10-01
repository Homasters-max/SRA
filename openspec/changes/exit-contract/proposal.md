# Proposal: exit-contract

## Why

Код выхода `warrant` не отделяет сбой инфраструктуры от нарушения правила и от ошибки конфигурации (WS-06, S2). Из-за этого CI потребителя не может безопасно повторять вызов: недоступный форж, таймаут check и занятый замок дают тот же код 3, что сломанный `warrant.json`, а `BUSY` даёт 2 в `check` и 3 в `ci fetch`. Код выбирает каждое место само: в 27 файлах 67 ссылок `EXIT.*`, коды пяти мест складываются через `Math.max` или тернарий. У кода ошибки нет класса (A-42, P1). Судья различает ошибку диапазона pack по тексту сообщения загрузчика (A-48). [ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 1–2 ставит это первым Change 0.10.0. На этом классе ошибок строится R-45 следующего Change `judge-law`.

## What Changes

- **Класс у каждого кода ошибки** ([ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2, A-42). Классов четыре:
  - нарушение правила — код 1;
  - ожидание действия — код 2;
  - конфигурация — код 3;
  - сбой инфраструктуры — новый код 4.

  Один код ошибки даёт один код выхода во всех командах.
- **Код 4 и `retryable`** (WS-06). Сбой, повтор которого может пройти, — это `BUSY`, `CHECK_TIMEOUT` и `FORGE_UNAVAILABLE`. Элемент `errors[]` с таким кодом несёт `retryable: true`; у остальных кодов ключа нет.
- **Одна функция выбирает код выхода** по приоритету `3` > `1` > `4` > `2` > `0` из кодов ошибок и действия controller. Она заменяет `Math.max` и выбор кода по месту.
- **BREAKING — меняются коды выхода:**

  | Случай | Было | Стало |
  |---|---|---|
  | `BUSY` в `check`, `run`, записи состояния | 2 | 4 |
  | `BUSY` в `ci fetch` | 3 | 4 |
  | `CHECK_TIMEOUT` | 3 | 4 |
  | недоступный форж | 3 | 4 |
  | `fmt --check`, `sync --check`, `validate --files` с находками | 1 | 3 |
  | `warrant ci` при занятом замке check | 2 | 4 |
  | `TOPOLOGY_VIOLATION` в `ci fetch` | 3 | 1 |
  | непредвиденное исключение | аварийный выход Node | `INTERNAL`, 3; в `guard --frontend` — 2 |

- **Форж** делит отказ доступа и сбой:
  - `gh` не найден, не авторизован или без прав — новый код `FORGE_ACCESS`, 3;
  - сеть, таймаут, ответ 5xx, лимит запросов, неразборчивый ответ — `FORGE_UNAVAILABLE`, 4;
  - неверный `GITHUB_REPOSITORY` или `origin` не на форже — `USAGE`, 3.
- **Ошибка диапазона pack** — свой код `PACK_VERSION_RANGE` (код выхода 3, как раньше) во всех командах, загружающих packs. Судья снимает её у pack, изменённого PR, сверяя код, а не текст (A-48, I-233).
- **`warrant ci`:** код выхода ошибок check — по их классу. `GATE_NOT_PASSED` gate, ставшего `BLOCKED` из-за ошибки check, код выхода не выбирает.
- **Версии:**
  - CLI 0.10.0; в CHANGELOG — разделы «Вердикт» и «Миграция для потребителя»;
  - `kernel` 0.10;
  - pack `core-sdd` 0.4.1 с диапазоном `kernel` `>=0.1 <0.11`;
  - lock и golden — перегенерация.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `kernel` — изменения по требованиям:
  - REQ-KRN-002 — `retryable` в `errors[]`;
  - REQ-KRN-003 — классы, код 4, приоритет, `INTERNAL`;
  - REQ-KRN-021 — `PACK_VERSION_RANGE`;
  - REQ-KRN-022 — `fmt --check`: 3;
  - REQ-KRN-025 — `sync --check`: 3;
  - REQ-KRN-032 — `validate --files`: 3;
  - REQ-KRN-036 — `BUSY`: 4.
- `verification` — изменения по требованиям:
  - REQ-VER-002 — `BUSY` и `CHECK_TIMEOUT`: 4;
  - REQ-VER-005 и REQ-VER-006 — приоритет вместо максимума;
  - REQ-VER-011 — коды форжа и check, `GITHUB_REPOSITORY`, `PACK_VERSION_RANGE` базы;
  - REQ-VER-012 — коды форжа, `BUSY`;
  - REQ-VER-013 — коды форжа в решениях UNKNOWN.
- `enforcement` — REQ-ENF-005: код 2 `guard --frontend` — протокол frontend, вне таблицы.
- `core-sdd` — REQ-SDD-001: `kernel` pack — `>=0.1 <0.11`; иначе CLI 0.10 pack не грузит.

Отступление от списка delta specs в ADR-0052 (Consequences): добавлены REQ-KRN-022, REQ-KRN-025 и REQ-SDD-001. REQ-SDD-001 — следствие подъёма `kernel` до 0.10 (п. 1). Для REQ-KRN-022 и REQ-KRN-025: по правилу п. 2 «один сбой — один код» `NOT_CANONICAL`, `GENERATED_DRIFT` и `LOCK_MISMATCH` дают один код и в `validate`, и в режимах `--check`. Обоснование и альтернатива — design D3.

## Non-Goals

- **`judge-law`** — WS-03, A-45, A-47, R-45, A-34, A-40.
- **`code-floor`** — WS-15, A-46, A-41, `paths.tests` SRA.

  Оба Change идут следом ([ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 1).
- **Повтор внутри CLI** (backoff) и повтор в reusable `warrant.yml`: CLI сообщает `retryable`, повторяет вызывающий. Код 4 по-прежнему красит job.
- **`guard --frontend`** — его коды 0 и 2 не меняются; `BUSY` внутри guard остаётся `deny` с кодом 0.
- **Атомарная запись `fmt`** — `BUSY` у `fmt` не появляется.
- **Ошибка загрузки модулей CLI** до первой строки `bin` — вне требования (риск в design).

## Impact

- Код:
  - `packages/cli/src/core/errors.ts`, `io/output.ts`, `bin/warrant.ts`;
  - `commands/**` — все места выбора кода;
  - `core/controller/evaluate.ts`, `core/transition/outcome.ts`, `core/check/execute.ts`, `core/ci/{judge,impl,archive,fetch,base}.ts`, `core/run/store.ts`, `core/canon/format-json.ts`, `core/packs/loader.ts`, `core/sync/apply.ts`;
  - `adapters/forge-gh.ts`.
- Тесты — `packages/cli/test/**`: коды выхода `BUSY`, `CHECK_TIMEOUT`, форжа, `--check` и `validate --files`; meta-тест «код выбирает одна функция».
- Документы и навыки:
  - `docs/04-lifecycle.md` (коды выхода), `README.md`;
  - `.claude/skills/cli-contract/SKILL.md` — 0…4;
  - `docs/backlog.md` — WS-06, A-42, A-48.
- Версии и конфигурация:
  - `package.json`, `CHANGELOG.md`, `.warrant/warrant.json`, `.warrant/warrant.lock.json`;
  - `packs/core-sdd/pack.json`, `packs/core-sdd/golden/**`.
- Spec: `openspec/changes/exit-contract/specs/{kernel,verification,enforcement,core-sdd}/spec.md`.
