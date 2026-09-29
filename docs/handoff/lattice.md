# lattice

## Цель

LATTICE (`D:\project\LATTICE`, `Homasters-max/LATTICE`) подключён к WARRANT и ждёт релиза 0.8.2: в нём Change `lattice-issues` (ADR-0044) и `no-claude-md` — ответ на разбор `D:\tmp\warrant-inbox\lattice-2026-09-29` (приоритет 1 — тег `v0.8.2`). Сессия LATTICE поднимает CLI до `v0.8.2` и снимает обходы 0.8.1.

## Готовый запрос

```text
Сессия LATTICE: переход на WARRANT v0.8.2.
1) CLI — github:Homasters-max/SRA#v0.8.2; warrant sync (kernel 0.8.2 в lock, копия схемы gate/1); перезапустить сессию Claude Code.
2) Job warrant — вызов reusable workflow вместо копии (пример — SRA docs/06-verification.md §8):
   jobs.warrant.uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.2
   with: warrant: v0.8.2, setup: <установка зависимостей проекта>, merge_commit: ${{ inputs.merge_commit || '' }}
   права contents / actions / pull-requests / issues: read; on.workflow_dispatch с входом merge_commit.
   Имя проверки — `warrant / warrant`: обновить branch protection.
3) Своя проверка dev-check — через Change factory-change: check в .warrant/local/checks/, gate с requires_evidence[{kind, status, check: "dev-check"}] (06 §3).
4) Тесты сценариев: id SCN в имени теста — it("SCN-… …"); пропущенный такой тест даёт NOT_PROVEN (06 §2).
5) Снять обходы, закрытые 0.8.2: под Run review разрешены warrant status / gate / --help, git status|log|diff|show, cd внутри проекта, warrant run finish --state CANCELLED; повтор run submit / EVIDENCE_CONFLICT; UNCOMMITTED_IN_SCOPE; атомарная запись состояния.
```

## Открытые вопросы

- GitHub App агента создаёт maintainer; до того `warrant ci` даёт находку `SHARED_IDENTITY` (BL-83). После — `identities.agents` в `.warrant/warrant.json`.
- Остальные пункты `PRIORITIES.md` LATTICE (шум guard ISS-019, `spec-report` от коммита ISS-018, отметки `tasks.md` при archive ISS-026, PR `none` с `src/**` ISS-013, S-10, P-4 / P-5 / S-8) — разбор inbox отдельной задачей.

## Не забыть

- Нестабильный e2e BL-89 («does not provide an export named …», рассогласованный `dist`) — Re-run всего run проходит; разбор — отдельной задачей.
- Контракты стыка `docs/integrations/01, 02, 05` остаются в SRA.
- Поток kb-domains: 02–07 ждут slice LATTICE (Q13).
