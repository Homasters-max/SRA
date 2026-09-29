# Tasks

После группы должны быть зелёными: `npm run typecheck`, `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`), точечный vitest по затронутому; полный набор — CI impl-PR. Коммит — один на группу, в `worktree/release-path`.

Обозначения: §N — разделы design.md; D-N — решения §1.

## 1. Установка из тега (D1, D4, D8)

- [x] 1.1 `.github/workflows/warrant.yml` (D1): выход шага «Check the input warrant» — `kind`, `tag`; шаг «Install warrant» — `npm pack` тега в `$RUNNER_TEMP/warrant-pack` и `npm i -g` tarball, для `checkout` — `npm i -g .`; комментарии.

  Проверка: `workflows.test.ts` (1.2).
- [x] 1.2 `packages/cli/test/unit/meta/workflows.test.ts`: SCN-VER-122 — форма tarball, нет `npm i -g github:`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts workflows`.
- [x] 1.3 `packages/cli/test/e2e/install-tarball.test.ts` (D4): SCN-VER-126.

  Проверка: `npm run build`, затем `npx vitest run --config packages/cli/vitest.config.ts install-tarball`.
- [x] 1.4 `docs/06-verification.md` §8: таблица входов — форма tarball; «вне MVP» про branch protection — по REQ-VER-014 (D8).

## 2. Канарейка (D2, D3)

- [x] 2.1 `.github/workflows/canary.yml`: `push` тегов `v*`, `workflow_dispatch`, job `canary` — `if: startsWith(github.ref, 'refs/tags/v')`, `uses: ./.github/workflows/warrant.yml`, `warrant: ${{ github.ref_name }}`, `setup: npm ci`, права на чтение.
- [x] 2.2 `workflows.test.ts`: SCN-VER-125.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts workflows`.

## 3. CHANGELOG и версия (D6, D7)

- [x] 3.1 `scripts/versions-lib.js`: `.github/workflows/warrant.yml` — в содержимом CLI; проверка CHANGELOG (D6), компонент `changelog`.
- [x] 3.2 `packages/cli/test/e2e/versions.test.ts`: bump без раздела CHANGELOG — ошибка; minor без «Вердикт» и «Миграция для потребителя» — ошибка; patch с разделом — нет ошибок; правка `warrant.yml` без bump — ошибка `cli`.
- [x] 3.3 `CHANGELOG.md` (раздел `0.8.3`), `structure.test.ts` — корень; версия `0.8.3` (`npm version 0.8.3 --no-git-tag-version`), `warrant sync`, `npm run golden:update`, если версия CLI в них видна.

  Проверка: `node scripts/dev/check.js`, `npx vitest run --config packages/cli/vitest.config.ts versions structure`.
