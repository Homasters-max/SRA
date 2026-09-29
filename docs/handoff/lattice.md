# lattice

После: stabilization

## Цель

LATTICE (`D:\project\LATTICE`, `Homasters-max/LATTICE`) подключён к WARRANT 0.8.2 (Change `pin-v0-8-2` в архиве) и держит копию job `warrant` по waiver WAV-2026-002 до 2026-10-13. Reusable workflow при `warrant: v<tag>` сломан — голое `npm i -g github:…#tag`, WS-01. Исправление — Change `release-path` потока stabilization, patch 0.8.3 ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md) п. 5). После тега `v0.8.3` сессия LATTICE переходит на reusable workflow и удаляет копию job до истечения waiver.

## Готовый запрос

```text
Сессия LATTICE: переход на WARRANT v0.8.3 — только после тега v0.8.3 (Change release-path SRA); до него копия job и WAV-2026-002 остаются.
1) CLI — github:Homasters-max/SRA#v0.8.3; warrant sync; перезапустить сессию Claude Code.
2) Job warrant — вызов reusable workflow вместо копии (пример — SRA docs/06-verification.md §8):
   jobs.warrant.uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.3
   with: warrant: v0.8.3, setup: <установка зависимостей проекта>, merge_commit: ${{ inputs.merge_commit || '' }}
   права contents / actions / pull-requests / issues: read; on.workflow_dispatch с входом merge_commit.
   Имя проверки — `warrant / warrant`: обновить branch protection. Удалить копию job и ветку «форма B» теста пина; WAV-2026-002 истекает неиспользованным.
3) Миграция — раздел CHANGELOG 0.8.3 SRA.
```

## Открытые вопросы

- Идентичность агента LATTICE — машинный пользователь, как в SRA ([ADR-0049](../adr/WARRANT-ADR-0049-flow.md) п. 3); `identities.agents` — после Change `identities` в SRA.

## Не забыть

- Просьбы `PRIORITIES.md` LATTICE сведены в backlog: ISS-013 → WS-14, ISS-019 → WS-26, ISS-025 → WS-19, ISS-018 → BL-94, ISS-021 → BL-95, ISS-026 → BL-96, S-10 → BL-97.
- Флейк WS-30 (бывший BL-89) — Re-run всего run проходит.
- Контракты стыка `docs/integrations/01, 02, 05` остаются в SRA.
- Поток kb-domains: 02–07 ждут slice LATTICE (Q13).
