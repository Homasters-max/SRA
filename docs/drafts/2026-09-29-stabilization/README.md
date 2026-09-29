# Стабилизация WARRANT и flow — индекс черновиков (2026-09-29)

Вход grilling решений, без которых нельзя начать волны 0–1 flow и цикл 0 стабилизации. Источник — стабилизационный аудит 2026-09-29 (`D:/tmp/warrant-inbox/stabilization-audit-2026-09-29/`, вне репозитория); нужные файлы перенесены сюда и дальше правятся здесь. Черновики — вход ADR и строк `docs/backlog.md`, не норма.

## Уже решено (не гриллить)

- **Р-F2 (Q1, вариант B):** archive-PR — `--auto` на зелёный CI всегда, в любом режиме. Docs/process-PR — тоже `--auto`, если diff не трогает защиту агента (`.claude/**`, `AGENTS.md`, хуки разработки); такой PR ждёт «Approve» человека, пока WS-13 не закрыт у судьи. Правка ADR-0047 п. 2 новым ADR.
- **Р-F3 (Q2, вариант A):** машинный пользователь агента — сейчас: collaborator `write`, classic PAT (`repo`, `workflow`) в `GH_TOKEN` среды пользователя, git-автор бота в worktree агента; `identities.agents` в `warrant.json` SRA, затем LATTICE. Решение человека — merge spec-PR и impl-PR maintainer'ом (судья уже проверяет `mergedBy`, `refs.ts:129-146`); archive/docs-PR сливает бот. Аккаунт и токен заводит maintainer. `identities` — policy-путь, правка — Change. Организация и App — позже, отдельным решением.
- **Р-F4 (Q3, вариант A):** flow — `scripts/dev/flow.js`, инструмент разработки, не поставляется; только `warrant … --json`, `git`, `gh`; без своего состояния, идемпотентен, трейлер `Flow: <stage>`; таблица стадий — чистая функция с unit-тестами на fake git/gh. Тест держит «только публичный контракт»: нет импорта `packages/cli/src/**` и чтения `.warrant/**`; нужда внутрь — строка backlog «пробел контракта» (WS-05). Отдельный пакет — триггер backlog «поставка flow потребителю (волна 4)».
- **Р-F1 (Q4, вариант B):** принцип «точки решения человека выводятся из policy по риску» принят. Без человека — только spec **LOW**; MEDIUM и HIGH — merge spec-PR человеком. Действует с волны 3, после WS-03, WS-13, WS-14 и floor (Р-F5), когда судья для LOW проверяет запись review (`PROVEN`, без MAJOR) вместо `mergedBy`. Правка: `human-approval` на `SPECIFIED→APPROVED` — из профилей в оверлеи `risk-medium`/`risk-high`; `approvalRoles` (`core/roles.ts:42`) — «нет роли» вместо fallback. До волны 3 все spec-PR сливает человек. Расширение на MEDIUM — строка backlog с триггером «review с attestation» (WS-20).
- **Р-F5 + Р-4 (Q5, вариант A):** правило судьи. Ключ match профиля по роли путей (`"match": {"path_roles": ["src"]}` у `feature`); diff в `paths.src` делает `feature` обязательным и в `classify`, и в CI `requiredProfiles` (`ci/base.ts:97-112`). Пустой `profiles` у Change, задевающего `paths.src`/`paths.tests`, — ошибка `classify` и находка `validate`. Волна 3 (цикл 1 п. 1.6), предпосылка Р-F1; меняет семантику вердикта pack — выпуск по Р-6.
- **Р-1 (Q6, вариант A):** модель угроз. A — ошибающийся агент: гарантия. B — обходящий агент: обнаружение (судья, `mergedBy ∉ agents`, WS-03, WS-13; вторая линия — merge spec/impl человеком). C — злонамеренный автор или админ форжа: вне WARRANT, настройки форжа проверяются и показываются. Maintainer доверен и вне модели — явно. ADR фиксирует модель; в `docs/06` § «Модель угроз» вместо «Угроза „общий аккаунт“»; обещания норм помечаются классом. Форма проверки форжа (`doctor` или находки в `status`/`ci`/`validate`) — в spec-PR цикла 1, склонность — находки в существующих командах.
- **Р-3 (Q7, вариант A):** PR без Change, задевающий `paths.src` или `paths.tests`, — `SCOPE_VIOLATION`, без опции «выключить». Новый ADR заменяет ADR-0044 п. 7 в этой части. Волна 3, вместе с Р-F1; до того flow v0 такой PR не выпускает. Опция для потребителя — строка backlog с триггером «просьба потребителя».
- **Р-6 (Q8, вариант A):** политика версий до 1.0 — новый ADR (ADR-0013 о версиях молчит). Patch `0.x.Y` — не меняет вердикт на тех же входах, схемы, контракт JSON и exit-кодов; minor `0.X.0` — всё, что меняет вердикт (включая ужесточение судьи), схемы, коды. CHANGELOG с разделами «Вердикт» и «Миграция для потребителя» у minor, проверка — в `versions:check`. Версия pack — по той же политике отдельно. Каденс: ужесточения цикла 1 — одним minor (0.9.0) в конце цикла; WS-01 — patch 0.8.3 до 2026-10-13. Фаза стабилизации в roadmap — в этом ADR: до конца цикла 2 minor только с ужесточением вердикта, без новой функциональности.
- **Р-12 + WS-01 (Q9, вариант A):** узкий Change `release-path`, patch 0.8.3, до 2026-10-13. Состав: `warrant.yml:95,140` — `npm pack` → tgz в `$RUNNER_TEMP` (ADR-0040 п. 7); `docs/06 §8` — та же форма; BL-52 закрыт; канарейка — workflow на push тега `v*`, job `uses: ./.github/workflows/warrant.yml` с `warrant: <тег>`; SCN-VER-122 — на канарейку, текстовая проверка YAML — не доказательство. `identities` и автотег — отдельными Change. Открыто на spec-PR: `warrant ci` на событии push тега (WS-16); если не работает — канарейка на `workflow_dispatch`/PR. Fixture-репозиторий — строка backlog с триггером «failure mode, который маскирует контекст SRA».
- **Backlog (Q10, вариант A):** строки `WS-NN` (номера аудита; префикс `WS-` — в правило шапки backlog), «Что» начинается с `S1:`/`S2:`, «Куда» — Change/волна/цикл по решениям Q1–Q9. Пересекающиеся BL-N/R-N удаляются, содержание вливается в WS-строку, старый ID — в «Источник». Просьбы LATTICE: ISS-013 → WS-14, ISS-019 → WS-26, ISS-025 → WS-19; ISS-018, ISS-021, ISS-026, S-10 — новые `BL-94+`; строка `handoff/lattice.md:25` убирается. S3 — одна строка `WS-31`, куда — циклы 3–4.
- **Раскладка (Q11, вариант A):** ADR-0048 «Стабилизация» (Р-1, Р-6, фаза стабилизации, циклы и волны, `release-path`); ADR-0049 «Flow и решения человека по риску» (Р-F1…F5, Р-3; меняет ADR-0047 п. 2 и ADR-0044 п. 7); `docs/process/flow.md` — рабочий дизайн flow (принципы, команды, таблица стадий, метрики). В том же PR `process/stabilization`: § «Модель угроз» в `docs/06` вместо «Угроза „общий аккаунт“», строка фазы в `13-roadmap`, backlog, пометки в ADR-0044/0047, удаление этой папки.
- **Поток (Q12, вариант A):** новый поток `stabilization` — первый; `docs/handoff/stabilization.md` (цель — волны 0–1 и цикл 0; запрос — `release-path`, затем `flow.js` v0). `phase-5.md` — `После: stabilization`, BL-74/BL-75 уходят в WS-04. `lattice.md` — `После: stabilization`; шаг 2 готового запроса: reusable workflow только после тега `v0.8.3`, до того — копия job и WAV-2026-002.

## Файлы

- [01-flow](01-flow.md) — flow `start/land/status` без своего состояния, таблица стадий, точки решения человека по риску, волны 0–4, решения Р-F1…F5 (главное).
- [02-plan](02-plan.md) — циклы стабилизации 0–4, решения Р-1…Р-12, метрики цикла.
- [03-findings](03-findings.md) — реестр WS-01…30 (4 S1, 26 S2), S3, FUTURE, «уже закрыто».

## Порядок grilling

1. Р-F2 — merge archive-PR и docs/process-PR всегда авто.
2. Р-F3 — машинный пользователь агента сейчас + `identities.agents` (WS-04).
3. Р-F4 — flow отдельным скриптом над публичным CLI.
4. Р-F1 — одобрение spec человеком только для HIGH.
5. Р-F5 — floor: `paths.src` ⇒ профиль ≥ `feature`.
6. Р-1 — модель угроз A/B/C.
7. Р-3 — PR без Change с `paths.src` → `SCOPE_VIOLATION` (WS-14).
8. Р-6 — patch до 1.0 не меняет семантику вердикта; пересмотр ADR-0013.

## Сквозные вопросы

- Срок: WS-01 (установка CLI из тега) и канарейка — до 2026-10-13, когда истекает waiver LATTICE WAV-2026-002.
- Выход: ADR (волна 0 и flow), строки backlog по WS-01…30 с тяжестью, список «делать сразу» для волн 0–1.

## Проверенные факты (2026-09-29)

- HEAD `b578861` — тот же, на котором сделан аудит.
- Настройки `Homasters-max/SRA` (`gh api`): `delete_branch_on_merge: false`, `allow_auto_merge: true`, squash и rebase запрещены; branch protection `main` есть — 4 required checks, `strict: false`, required reviews нет, `enforce_admins: false`; collaborator один — `Homasters-max`. Аудит «branch protection нет» — про LATTICE, не SRA.
- WS-01 подтверждён: `warrant.yml:95,140` — голое `npm i -g github:…#tag`; `docs/06 §8` предписывает ту же форму; ADR-0040 п. 7 и BL-52 (`backlog.md:78`) — форму `npm pack` → tgz.
- WS-03 подтверждён: `core/ci/record.ts:137-138` пропускает не-`PASS`; `record.ts:275-279` проверяет только, что вердикт из `PASS/WAIVED/NOT_APPLICABLE`. В impl-PR `ci/impl.ts:85-137` пересчитывает gates на merge-результате — дыра только в archive-PR.
- WS-14 подтверждён: `core/ci/paths.ts:92-98` для PR без Change смотрит только пути состояния и policy. Это норма ADR-0044 п. 7 («проверки PR без Change — job проекта»). В самом SRA `packages/cli/src/**` — policy-путь `factory-change`, поэтому там такой PR красный; у проекта — проходит.
- WS-04: `identities.agents[]` (`login, kind, description`) **уже есть** в `config.1.schema.json:110-135`; в `.warrant/warrant.json` SRA `identities` нет. `SHARED_IDENTITY` — информационная находка (`ci/decisions.ts:103`, `ci/refs.ts:190`), код выхода не меняет. Решение UNKNOWN: автор — maintainer и ∉ agents, ID ищется подстрокой (`decisions.ts:91`). `mergedBy === author` отказывается, только если agents заданы (`refs.ts:135-147`). Waiver `--by` сверяется только с локальными `roles` (`commands/waive.ts:168-200`, BL-75).
- WS-15 подтверждён: floor риска — только `risk/floors.json` (migrations, auth, security, `.warrant/**`, openspec schemas/config), floor по `paths.src` нет. `feature` не матчится по путям, `chore` — `docs/**`, `**/*.md`, `package*.json`; профиль кода может выбрать только proposer. Пустой `profiles` допустим (`change-record.1.schema.json:146-150`, нет `minItems`).
- `human-approval` на `SPECIFIED→APPROVED` задаёт **profile** (есть и в `chore`, и в `feature`), не риск; `overlays/risk-high.json` добавляет `human-approval` на `VERIFYING→MERGED`; `spec-approved` — в `core-default` на `VERIFYING→MERGED` при любом риске.
- WS-13 подтверждён: `factory-change.json:10-19` без `.claude/**` и `AGENTS.md`.
- **Аудит ошибся про ADR-0013:** о semver и «внешних пользователей нет» в нём ничего нет; есть только «не публикуется в MVP; `npm i -g <git-tag>`» (`ADR-0013:29`). Политики версий нет ни в одном ADR.
- ADR-0010 п. 1 «CI никогда не пишет в репозиторий», п. 2 «доверие — к ссылке». Модели угроз с классами противника нет; есть `06 §8` «Угроза „общий аккаунт“» и шаблон в `10 §4` для будущего security pack.
- ADR-0047: п. 2 — решение о merge за maintainer'ом («merge #N» или ответ на план fast-mode), `--auto` только ждёт зелёного; п. 3 — archive-PR открывает сессия с `--auto`, пересмотр — когда у агента своя идентичность; п. 4 — тег workflow'ом после archive-PR (пока — шаг навыка).
- `flow` нигде нет. `scripts/dev/` не поставляется (`package.json` `files`).
