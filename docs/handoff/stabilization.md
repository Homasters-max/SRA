# stabilization

## Цель

Фаза стабилизации до фазы 5 ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)) и flow — доставка Change без рутины человека ([ADR-0049](../adr/WARRANT-ADR-0049-flow.md), [process/flow.md](../process/flow.md)). Решения приняты в grilling 2026-09-29 по стабилизационному аудиту. Сейчас идут волны 0–1 и цикл 0: поставка CLI из тега, идентичность агента, `flow.js` v0. Долг — строки `WS-N` [backlog](../backlog.md), S1 первыми.

## Готовый запрос

```text
Поток stabilization, волна 0 / цикл 0 (ADR-0048 п. 5, ADR-0049 п. 8).
1) Change release-path, patch 0.8.3, срок 2026-10-13 (истекает waiver LATTICE WAV-2026-002): WS-01 — установка CLI для тега в .github/workflows/warrant.yml:95,140 через npm pack "github:Homasters-max/SRA#<tag>" в $RUNNER_TEMP → npm i -g ./<tgz> (ADR-0040 п. 7), docs/06 §8 — та же форма; WS-02 — канарейка: workflow на push тега v*, job uses: ./.github/workflows/warrant.yml с warrant: <тег>; SCN-VER-122 — на канарейку; CHANGELOG и versions:check по ADR-0048 п. 3. На spec-PR выяснить, работает ли warrant ci на событии push тега (иначе — workflow_dispatch / PR). Навыки change-spec-pr → change-impl-pr → change-archive-pr.
2) Когда maintainer пришлёт логин бота — Change identities: identities.agents в .warrant/warrant.json, git-автор бота в worktree агента (ADR-0049 п. 3).
3) Волна 1: scripts/dev/flow.js v0 — start / status / land для не-Change PR и стадии archive по process/flow.md §2–4; unit-тесты таблицы стадий на fake git/gh, тест «нет импорта packages/cli/src/**, нет чтения .warrant/**»; process-PR навыков git-land / change-archive-pr / fast-mode по ADR-0049 п. 2 и WS-04 (--by при human-approval).
```

## Открытые вопросы

- Логин машинного пользователя агента — от maintainer'а (аккаунт, collaborator `write`, classic PAT в `GH_TOKEN`).
- Решения цикла 1, не принятые в grilling 2026-09-29: Р-5 (archive/abandon push в `main`), Р-9 (активация waiver по ссылке), Р-10 (код 4, `retryable`), форма проверки форжа (`doctor` или находки) — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2 и позже.

## Не забыть

- ADR-0047 п. 2 изменён ADR-0049 п. 2: archive-PR — `--auto` всегда; docs/process-PR — `--auto`, кроме diff с `.claude/**`, `AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`; spec- и impl-PR сливает maintainer.
- Каденс: ужесточения вердикта цикла 1 (WS-03, WS-13, WS-14, floor) — одним minor 0.9.0 в конце цикла, не россыпью.
- Флейк WS-30 (бывший BL-89) — один Re-run всего run, второе падение — стоп.
