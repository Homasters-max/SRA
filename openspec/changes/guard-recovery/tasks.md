# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/guard-recovery`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Поле `cli` (D3)

- [ ] 1.1 `packages/cli/schemas/config.1.schema.json`: необязательное `cli` — шаблон REQ-KRN-004, `description`. `core/config.ts`: `WarrantConfig.cli?: string`, список читаемых свойств `test/unit/config/config.test.ts`.
- [ ] 1.2 Фикстуры `test/fixtures/schemas/config/` — валидный `cli` и четыре невалидных (SCN-KRN-165), тег SCN в `unit/schemas/fixtures.test.ts`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts config fixtures`.

## 2. guard при policy, которая не грузится (D1, D2, D4)

- [ ] 2.1 `core/packs/loader.ts`: `bundledPackVersions()`. Сообщение `PACK_VERSION_RANGE` встроенного pack называет версию CLI, hint — `kernel`; код и путь прежние.
- [ ] 2.2 `core/guard/guard.ts`:
  - `PolicyNotLoaded` из `loadPolicy` — первая ошибка, версии CLI и packs, `pins` из терпимого чтения `warrant.json`;
  - `pinnedCli(root)` — тем же чтением;
  - `decidePre` — `edit` без пути проекта до policy, `PolicyNotLoaded` → `recoveryAnswer`.
- [ ] 2.3 `core/guard/decide.ts`:
  - `recoveryAnswer`, `isRecovery`, `PIN_HINT`, `RECOVERY_HINT`;
  - нормализация `node <cli>` → `warrant` в `reviewShellAnswer` и режиме восстановления;
  - комментарий модуля дополнен.
- [ ] 2.4 Тесты `app/commands/guard.test.ts`: SCN-ENF-048, SCN-ENF-049, SCN-ENF-050, SCN-ENF-051. SCN-ENF-011…016, 026, 027, 037…041, 044 — зелёные. Unit `decide`: `recoveryAnswer` и нормализация.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard decide loader`.

## 3. Адаптер `claude` и R-46 (D6)

- [ ] 3.1 `commands/guard.ts`: `runGuardRead(ctx, read)`. `bin/warrant.ts`: action `guard` зовёт его, `crash.guardInput` заполняется.
- [ ] 3.2 Тесты:
  - SCN-ENF-052 — `app/commands/guard.test.ts`, `read`, который бросает;
  - SCN-ENF-053 — `contract/frontend-claude.contract.test.ts`, записанные входы `PreToolUse` при policy, которая не грузится;
  - строка R-46 в `docs/backlog.md` удалена (закрыт).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard frontend-claude crash`.

## 4. Генератор `claude` (D3)

- [ ] 4.1 `core/sync/claude.ts`:
  - `guardCommand(cli?)` вместо константы в группах и frontmatter;
  - `isGuardHook` — обе формы;
  - `reviewerAgent(skill, cli?)` — команда хука и `node <cli> run submit` в разделе сдачи;
  - `claudeSettingsTarget` от конфигурации.
  
  `core/sync/plan.ts` передаёт `config.cli`.
- [ ] 4.2 Тесты `app/commands/sync-frontend.test.ts`: SCN-KRN-166. SCN-KRN-130, 134, 139, 140, 142, 154 — зелёные, байты без `cli` не изменились.
- [ ] 4.3 Зонд Claude Code: хук frontmatter субагента с `node "${CLAUDE_PROJECT_DIR}/…"` исполняется (`scripts/dev/probe-hooks-lib.js` или ручной прогон субагента). Итог — строка `I-N`; переменной нет — форма из риска design.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts sync-frontend sync claude`.

## 5. SRA на закреплённом CLI (D5)

- [ ] 5.1 `.warrant/warrant.json`: `"cli": "packages/cli/dist/bin/warrant.js"`; `warrant sync` (lock). `.claude/agents/warrant-reviewer.md` перегенерирован командой из шапки `test/unit/meta/reviewer-agent.test.ts`.
- [ ] 5.2 `test/unit/meta/dev-hooks.test.ts` — новая команда хука в `AGENT_HOOKS`. Навык `.claude/skills/change-spec-pr/SKILL.md` шаг 3 — `npm run build` вместо `npm link` (форма ADR-0032, `dev-context.test.ts`).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts reviewer-agent dev-hooks dev-context`; полный `npm test`.

## 6. Документы (D7)

- [ ] 6.1 `docs/08-packs.md` §3 — `cli`. `docs/process/rules.md` «Настройка машины» — CLI потребителя из тега.
- [ ] 6.2 `CHANGELOG.md` `## 0.10.0` — «Миграция для потребителя» и строка состава; «Вердикт» — guard не судья, без изменений.
- [ ] 6.3 Навык `warrant-upgrade` (`~/.claude/skills/warrant-upgrade/SKILL.md`, вне репозитория): подъём minor pack, порядок «закрепление, затем CLI», `cli`, CLI из тега на машине.

  Проверка: `node scripts/dev/check.js`; `node scripts/dev/hygiene.js` — без новых битых ссылок.
