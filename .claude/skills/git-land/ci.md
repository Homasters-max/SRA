# Красный CI — справочник навыка `git-land`

CI — матрица `test` ubuntu + windows (P-9), шаг `PR form` на ubuntu, проверка `warrant / warrant` — job `warrant` из reusable workflow ([warrant.yml](../../../.github/workflows/warrant.yml), `warrant ci` на результате merge) на каждом PR ([ci.yml](../../../.github/workflows/ci.yml)). Разбор — сам, без вопросов ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 6); стоп — тот же сбой после двух исправлений или нестабильный тест.

1. Что упало:
   ```bash
   gh pr checks <N>
   gh run view <run-id> --log-failed
   ```
2. Класс:

   | Класс | Признак | Что делать |
   |---|---|---|
   | ожидаемое | `warrant / warrant` в impl-PR до коммита `VERIFYING` — `CHANGE_NOT_VERIFYING`; `human-approval` в `deferred[]` | ничего, это не сбой |
   | `warrant / warrant` | `GATE_NOT_PASSED`, `RECORD_MISMATCH`, `SCOPE_VIOLATION`, `REF_NOT_VERIFIED` — в `errors[]` вывода шага `warrant ci` | исправить PR по `hint`; `main` сдвинулся до merge — Re-run job; `FORGE_UNAVAILABLE` — `permissions` job `warrant` в `ci.yml`, `GH_TOKEN` в `warrant.yml` |
   | форма PR | шаг `PR form`: префикс ветки, заголовок коммита | заголовок — `git commit --amend -F` для последнего неопубликованного, иначе новая ветка по `recovery.md`; префикс — новая ветка |
   | платформа | только ubuntu или только windows: пути, регистр, 8.3-имена, symlink, CRLF, spawn, внешние утилиты | ловушки — раздел `packages/cli/AGENTS.md`; воспроизвести (шаг 3) |
   | нестабильный тест | проходит при повторе без изменений, зависит от времени или порядка | стоп и отчёт: не обходить повтором, не отключать тест |
   | таймаут | job упёрся в `timeout-minutes` | найти зависший процесс по логу, не поднимать лимит молча |
   | дефект | падает на обеих ОС или воспроизводится локально | исправить с тестом уровня по ADR-0025 |

3. Воспроизвести Linux-сбой локально: `npm run test:linux` — `npm test` закоммиченного HEAD в Docker `node:22` + openspec 1.13.1 (ADR-0033 п. 6). Docker не запущен — команда печатает вариант для WSL: клон в домашний каталог WSL, не `npm ci` в смонтированном worktree (перезапишет Windows-`node_modules`). Нет ни того, ни другого — исправление по логу, в отчёте пометка «не воспроизведено локально».
4. Исправление — коммит навыка `git-start`, push, снова шаг 3 `git-land`. Счётчик попыток — по одному сбою: третья попытка того же — стоп.
5. **Повтор run** (сбой не в коде PR — `main` сдвинулся, таймаут runner'а) — весь run: `gh run rerun <run-id>`, без `--failed`. Job `warrant` в impl-PR пишет artifact `evidence-<change>-<attempt>` только той попытки, в которой он выполнился. `--failed` перезапускает упавший `test`, а `warrant` переносит в новую попытку без запуска: у попытки нет artifact, у прежней — `conclusion: failure`, и `ci fetch` в archive-PR даёт `NO_CI_EVIDENCE` (impl-PR #70 `slice-fixes`, понадобился run восстановления на M). Re-run одного job `warrant` допустим — он сам пишет artifact новой попытки.
