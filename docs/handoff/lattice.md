# lattice

## Цель

LATTICE (`D:\project\LATTICE`, `Homasters-max/LATTICE`) закреплён на WARRANT 0.8.2 (`core-sdd` `^0.3.4`) с копией job `warrant` по waiver WAV-2026-002 до 2026-10-13. Переход — сразу на `v0.10.0` (конец цикла 1, одна миграция; [ADR-0053](../adr/WARRANT-ADR-0053-guard-recovery.md)), после тега: он ставится archive-PR `code-floor`.

## Готовый запрос

```text
Сессия LATTICE: pin-Change на WARRANT v0.10.0 — навык warrant-upgrade. Начинать только после тега v0.10.0 в Homasters-max/SRA.
1) CLI на машине — из тега (ADR-0053 п. 4): npm pack github:Homasters-max/SRA#v0.10.0 вне checkout, npm i -g ./<tgz>; не npm link.
2) Закрепление: .warrant/warrant.json — kernel "0.10", core-sdd ^0.4.1; warrant sync; перезапустить сессию Claude Code.
3) Job warrant — reusable workflow вместо копии (SRA docs/06-verification.md §8): jobs.warrant.uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.10.0, with: warrant: v0.10.0, setup: <установка зависимостей>, merge_commit: ${{ inputs.merge_commit || '' }}; права contents / actions / pull-requests / issues: read; on.workflow_dispatch с входом merge_commit. Имя проверки — `warrant / warrant`: branch protection. Копию job и «форму B» теста пина удалить; WAV-2026-002 истекает неиспользованным.
4) Миграция — разделы CHANGELOG SRA 0.8.3, 0.9.0 (профиль приёмки human-acceptance, CODEOWNERS, paths.src и paths.tests), 0.10.0 (коды выхода 0…4 и retryable, floor feature, guard).
```

## Открытые вопросы

- Тег `v0.10.0` позже 2026-10-10 — запасной путь до истечения waiver: тот же pin-Change на `v0.9.0`. Решает maintainer по дате.
- Идентичность агента LATTICE — машинный пользователь, как в SRA ([ADR-0049](../adr/WARRANT-ADR-0049-flow.md) п. 3), `identities.agents`.

## Не забыть

- Сейчас глобальный `warrant` — `npm link` на dev-checkout SRA (0.10.0-dev), и guard запирает LATTICE при `^0.3.4`. Снять запирание до тега: в `.warrant/warrant.json` LATTICE заменить `^0.3.4` на `^0.4.0`, не коммитить — правка войдёт в pin-Change.
- Просьбы `PRIORITIES.md` LATTICE сведены в backlog: ISS-013 → WS-14, ISS-019 → WS-26, ISS-025 → WS-19, ISS-018 → BL-94, ISS-021 → BL-95, ISS-026 → BL-96, S-10 → BL-97.
- Флейк WS-30 (бывший BL-89) — Re-run всего run проходит.
- Контракты стыка `docs/integrations/01, 02, 05` остаются в SRA.
- Поток kb-domains: 02–07 ждут slice LATTICE (Q13).
