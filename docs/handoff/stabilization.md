# stabilization

## Цель

Фаза стабилизации до фазы 5 ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)) и flow — доставка Change без рутины человека ([ADR-0049](../adr/WARRANT-ADR-0049-flow.md), [process/flow.md](../process/flow.md)). Цикл 0 закрыт Change `release-path` (CLI 0.8.3: установка из тега через tarball, канарейка, CHANGELOG). Дальше — волна 0 (идентичность агента) и волна 1 (`flow.js` v0), затем цикл 1 одним minor 0.9.0. Долг — строки `WS-N` [backlog](../backlog.md), S1 первыми.

## Готовый запрос

```text
Поток stabilization, волна 1 (ADR-0049 п. 8, process/flow.md §2–5).
1) Флейк WS-30 первым (он роняет каждый второй PR): tests-passed не пересобирает dist глобального warrant, build.js чистит dist.
2) scripts/dev/flow.js v0 — start / status / land для не-Change PR и стадии archive; unit-тесты таблицы стадий на fake git/gh; тест «нет импорта packages/cli/src/**, нет чтения .warrant/**»; навыки git-land / change-archive-pr / fast-mode — по ADR-0049 п. 2 и WS-04 (--by при human-approval).
3) Когда maintainer пришлёт логин бота — Change identities: identities.agents в .warrant/warrant.json, git-автор бота (ADR-0049 п. 3).
```

## Открытые вопросы

- Логин машинного пользователя агента — от maintainer'а (аккаунт, collaborator `write`, classic PAT в `GH_TOKEN`).
- Решения цикла 1, не принятые в grilling 2026-09-29: Р-5, Р-9, Р-10, форма проверки форжа — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2 и позже.
- Правило «разработка — автономно по умолчанию» (быстрый режим без просьбы) maintainer записывает сам: агенту запись отклонил классификатор auto-режима («Instruction Poisoning»).

## Не забыть

- Канарейка `canary.yml`: красный «Install warrant» — поставка сломана, patch до pin потребителя; красный `warrant ci` — строка backlog (design `release-path` D3, I-214).
- Каденс: ужесточения вердикта цикла 1 (WS-03, WS-13, WS-14, floor) — одним minor 0.9.0 с разделами CHANGELOG «Вердикт» и «Миграция для потребителя».
- Флейк WS-30 — один Re-run всего run, второе падение — стоп.
