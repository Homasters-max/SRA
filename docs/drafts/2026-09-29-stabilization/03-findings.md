# Реестр находок WS-01…30 — вход бэклога

Источник: аудит 2026-09-29, `10-findings-register.md` (перенесён, дальше правится здесь). Полные ответы с опорой `путь:строка` — `answers/A…G` аудита (вне репозитория).

## Проблема

База сверки: SRA HEAD `b578861` (по CLI и workflow равен тегу `v0.8.2`), LATTICE `341ea17`. Около 100 находок семи кластеров (`answers/*.md`, ID `F-<кластер>-NN`) сведены в 30 записей `WS-NN`. Классы — из §25 шаг 4 вопросника. Тяжесть:
- **S1** — блокирует golden path или честность вердикта;
- **S2** — ломает предсказуемость или потребителя;
- **S3** — неудобство или гигиена.

Колонка «Проверка»:
- ✔ — утверждение перепроверено мной по коду;
- 2+ — найдено независимо двумя и более кластерами;
- 1 — один кластер, вывод по коду без запуска.

### S1 — блокеры
| ID | Класс | Суть | Источники | Бэклог / потребитель | Проверка |
|---|---|---|---|---|---|
| WS-01 | BUG | Reusable workflow при `warrant: v<tag>` ставит CLI голой командой `npm i -g github:Homasters-max/SRA#tag` (`.github/workflows/warrant.yml:95,140`). У внешнего проекта не находится `commander`, и `warrant ci` не стартует. Это регресс BL-52, решённого в ADR-0040 п. 7 (`npm pack` → tgz). Норма `docs/06 §8` предписывает именно сломанную форму. LATTICE из-за этого сидит на копии job и waiver WAV-2026-002 (до 2026-10-13) | A-01, B-01, C-01, G-01 | BL-52 (устарел, триггер наступил); отдельной строки нет | ✔ 4 |
| WS-02 | TEST GAP | Поставка ни разу не исполняется так, как у потребителя. `ci.yml` SRA вызывает workflow с `warrant: checkout`. SCN-VER-122 «доказан» текстовым чтением YAML (`unit/meta/workflows.test.ts:78-100`). Сценариев «установка из тега или tgz в чистый проект» и «вызов workflow извне» нет | B-08, C-02, G-02 | — | 3 |
| WS-03 | CONTRACT GAP | CI-судья проверяет у записанного `MERGED` только gates со значением `PASS` (`core/ci/record.ts:137` — `if (verdict !== "PASS") continue`). `WAIVED` и `NOT_APPLICABLE`, даже у non-waivable `tests-passed`, не сверяются ни с файлом waiver, ни с `waivable`, ни с `applies_when`. У `APPROVED`, `SPECIFIED` и `ARCHIVED` hash и состав gates с policy базы не сверяются вовсе. Запись в `main` может утверждать неправду при зелёном CI | E-01 | нет | ✔ |
| WS-04 | ARCHITECTURAL GAP | Агент и maintainer работают под одним аккаунтом. Merge, решение UNKNOWN (комментарий), `human-approval` и активация waiver, сделанные агентом, засчитываются как акты человека. У LATTICE `identities: null`, `SHARED_IDENTITY` — только информационная находка. Активация waiver — локальное заявление без проверяемой ссылки (противоречит ADR-0010 п. 2). Решение UNKNOWN ищется подстрокой (`UNK-SRC-004` ⊂ `UNK-SRC-0040`) | F-01, F-02, E-05, E-08 | BL-83, BL-44, BL-75, R-29; S-1, ISS-010 | 2 |

### S2 — предсказуемость и потребитель
#### Контракт и версии

| ID | Класс | Суть | Источники | Бэклог / потребитель |
|---|---|---|---|---|
| WS-05 | CONTRACT GAP | Нет политики совместимости, BREAKING и CHANGELOG. Патч 0.8.2 поменял семантику вердикта (пропущенный тест SCN → `NOT_PROVEN`) и схему `gate/1`. Стабильна только оболочка ответа: у `data` нет схемы, 69 кодов ошибок не объявлены. ADR-0013 («внешних пользователей нет») устарел | B-02, C-18, G-03 | — |
| WS-06 | CONTRACT GAP + DRIFT | Код выхода не отделяет инфраструктуру от правил. Код 3 означает сразу конфигурацию, usage, недоступный форж, таймаут и `INTERNAL`; падение до JSON даёт 1, как FAIL. REQ-KRN-003 обещает 1 при FAIL, фактически gate FAIL → WAIT → 2. Одна находка даёт 3 в `validate` и 1 в `validate --files`. Инвариант «ok:false ⇒ код ≠ 0» ничем не гарантирован. Признака `retryable` нет | B-03, G-04, G-05 | — |
| WS-07 | CONTRACT GAP | Pin хранится в 4–5 местах. `kernel` в `warrant.json` обязателен, но нигде не сверяется. `validate` (major.minor) и `sync --check` (байты) судят lock по-разному. Lock хранит установленную версию OpenSpec, то есть факт окружения, поэтому на другой машине `sync` даёт diff `.warrant/**` с риском HIGH. `uses:@tag` и вход `warrant:` не сверяются. Локальный CLI — `npm link` без закрепления | C-04, C-05, C-06, B-06 | — |
| WS-08 | ARCHITECTURAL GAP | Миграций и отката нет. Схемы меняются внутри `/1` при `additionalProperties:false`, поэтому откат ломает валидацию. Исключение для архива (ADR-0021 п. 1) не реализовано. Поведение Change в работе при смене pin не определено | C-03, C-17 | — |
| WS-09 | USABILITY | Цена обновления: 13 релизов за 8 суток. Каждый pin — Change `factory-change` HIGH из трёх PR, это 20–25 шагов. У LATTICE 3 из 4 Change — обслуживание WARRANT. Тег ставится руками, забытый тег блокирует потребителя | A-05, C-19, B-10 | BL-93 |

#### Граница продукта

| ID | Класс | Суть | Источники | Бэклог / потребитель |
|---|---|---|---|---|
| WS-10 | ARCHITECTURAL GAP | Процедура golden path (провести Change через три PR: правило `process`, навыки `change-spec-pr/impl-pr/archive-pr`) живёт в dev-слое и не поставляется. Потребитель держит копию правила (с pytest) | A-04, B-05 | BL-79, BL-82, BL-85; ISS-004, ISS-009, ISS-012, S-7 |
| WS-11 | ARCHITECTURAL GAP | У `source-warrant` (WARRANT как источник данных LATTICE) нет контракта со стороны WARRANT. Дизайн LATTICE опирается на то, чего нет: ID `TERM-…`, якоря пунктов ADR, units `.kb-search/` вне git, путь `D:/project/WARRANT`. `SRA/docs/integrations/05` описывает обратное направление | A-03, B-04 | — |
| WS-12 | CONTRACT GAP | Pack `core-sdd` несёт пути самого SRA (`factory-change`: `packages/cli/src/**`, `sra/skills/**`, `packages/cli/schemas/**`). Gate `factory-golden-passed` закрывается любым `test-report`: у всех трёх `factory-change` Change LATTICE записано `PASS`, хотя golden не запускались. Gate судит только по kind | B-09, E-04 | BL-57, R-39 |

#### Честность вердикта (кроме S1)

| ID | Класс | Суть | Источники | Бэклог / потребитель |
|---|---|---|---|---|
| WS-13 | SPEC/IMPL DRIFT | `.claude/**` и `AGENTS.md` не входят в policy-пути (`factory-change.json:10-19`), хотя по ADR-0014 п. 4 и ADR-0034 п. 3 должны. `validate`/`GENERATED_DRIFT` и lock в судье не проверяются. Агент может снять свои hooks и deny обычным PR при зелёном CI | C-07, F-03 | README LATTICE §4 |
| WS-14 | CONTRACT GAP | PR без Change с правкой `src/**` проходит `warrant ci` (`core/ci/paths.ts:92-100`). ADR-0044 п. 7 называет это границей, руководство — правилом, а потребитель — дырой | F-04 | ISS-013; PRIORITIES #5 |
| WS-15 | CONTRACT GAP | Profile, а с ним набор gates, для кода выбирает proposer, то есть LLM. Floor задаёт только risk. `chore` снимает review и `evidence-complete`; пустые profiles, по коду, снимают и `tests-passed` | F-05, E-10 | — |
| WS-16 | ARCHITECTURAL GAP | На push в `main` судья не запускается, хотя `main` — доверенный закон (policy из базы, ADR-0038). `04 §5` разрешает archive/abandon «push в main». Evidence на merge-результате M проверяется уже после того, как код в `main`. Squash/rebase ловятся, но не предотвращаются. Branch protection WARRANT не проверяет, у LATTICE её нет | F-07, D-03, D-04, D-05 | S-2 (частично) |
| WS-17 | CONTRACT GAP | Attestation `ci` выводится из env и подделывается локально (`act`). Archive-PR не сверяет, какой workflow выложил artifact. Run `pull_request` исполняет workflow из самого PR | E-03 | ADR-0038 (остаточный риск) |
| WS-18 | ARCHITECTURAL GAP | Доверие одноразовое, результат верификации не хранится: `human-approval` навсегда «ref not verified», `waiver_state: ACTIVE` после срока, `STALE` вычисляется каждый раз. Evidence не называет ни Change, ни REQ/SCN (`claim.targets: []`). Вердикт зависит от системной даты, artifact живёт 90 дней, так что решение нельзя воспроизвести. Главный барьер для «LATTICE принимает evidence как знание» | E-02, E-13, E-14, E-15 | — |
| WS-19 | CONTRACT GAP | Waiver в impl-PR лежит на policy-пути и превращает Change в `factory-change` HIGH с golden-gate, а `scope-valid` падает. Сам процесс велит заводить waiver `spec-approved` именно в impl-PR | E-06 | ISS-025 |
| WS-20 | SPEC/IMPL DRIFT | 06a §3: «review для HIGH — Run в CI». В 0.8.2 review всегда локальный и без attestation, и HIGH-изменения LATTICE одобрены по нему | E-07 | — |
| WS-21 | BUG | `validate` сверяет `approved_by` всех waiver'ов, включая архивные, с текущими `roles`: удаление логина задним числом валит историю (`WAIVER_INVALID`) | E-09 | — |

#### Жизненный цикл и надёжность

| ID | Класс | Суть | Источники | Бэклог / потребитель |
|---|---|---|---|---|
| WS-22 | BUG | Составные команды с внешним шагом не завершаются повтором. Обрыв `archive` после `openspec archive` даёт тупик (`CHANGE_NOT_FOUND` / `USAGE`); незавершённый `ABANDONED` — `RECORD_FROZEN`. Повтор успешного `transition` — `STATE_INVALID` (код 3), а не no-op. Выход только через Git, в таблице восстановления этих случаев нет | D-01, D-12, D-14, D-16 | родственно BL-48 |
| WS-23 | BUG | `ids-valid` ищет дубликаты раздельно по main specs, активным Change и каждому архиву. Если ID параллельного Change уже в main specs, дубль не ловится, а после архивации блокирует все следующие Change. `warrant id` не резервирует номер | D-02 | BL-62, BL-68, BL-76; ISS-008 |
| WS-24 | CONTRACT GAP | После `IMPLEMENTING→SPECIFIED` с правкой spec новое ревью провести нельзя (Run `review` только в `PROPOSED`). Повторное `APPROVED` может сослаться на старый spec-PR | D-08 | — |
| WS-25 | USABILITY | Первый день: bootstrap-PR всегда красный (`CONFIG_MISSING` без hint), `init --frontend claude` сразу включает hooks, нет `.gitattributes`. Подсказка к `ALREADY_INITIALIZED` советует `--force`, который **стирает** `roles`, `paths`, `identities`, реестр AREA | C-08, C-09, C-10, C-11, F-13 | BL-77, BL-84, BL-55; ISS-001, ISS-011 |
| WS-26 | USABILITY | Шум guard: «start a Run first» на каждую правку вне Run (22 и 132 за сессию); правила `paths: **` (~6 КБ) повторяются в каждом Run | F-08 | ISS-019; PRIORITIES #2 |

#### Норма, процесс, тесты

| ID | Класс | Суть | Источники | Бэклог / потребитель |
|---|---|---|---|---|
| WS-27 | DOCUMENTATION GAP + DRIFT | Четыре уровня нормы без правила старшинства в репозитории: `docs/01–13` (`normative`), main specs, 46 ADR (все `ACCEPTED`), внешнее руководство. `docs/04/05/06a/07` расходятся с кодом примерно в 18 пунктах без пометок. README устарел. Гарантии, 7 особенностей подключения и модель угроз есть только во внешнем руководстве, а оно само переоценивает гарантии (§7.1, 7.7, 10.6) | A-02, A-06, A-07, C-13, C-14, E-12, F-06, F-11 | — |
| WS-28 | DOCUMENTATION GAP (процесс) | Просьбы потребителя (PRIORITIES #2–#8: ISS-013/018/019/021/025/026, S-10) и регресс WS-01 не заведены в `docs/backlog.md`, единственный реестр долга. Они лежат только в `handoff/lattice.md` | B-07 | — |
| WS-29 | TEST GAP | Расхождения fake и реального адаптера без сценария (R-37 `.gitignore`, BL-71 дата). Тесты вне typecheck, поэтому соответствие fake порту не проверяется | G-07 | R-37, BL-71, BL-30, BL-36 |
| WS-30 | BUG | Флейк вердикта собственных PR: `tests-passed` пересобирает `dist`, на который указывает глобальный `warrant` (`npm i -g .`), а `build.js` не чистит `dist`. Полный набор на ubuntu идёт дважды | G-08 | BL-89 |

## Идея

Свести WS-01…30 в `docs/backlog.md` — единственный реестр долга (WS-28, план 0.4): строка на находку с тяжестью S1/S2 и ссылкой на существующие BL-N; просьбы LATTICE (PRIORITIES #2–#8) — туда же.

## Вопросы для grilling

1. Тяжесть S1/S2 по реестру — принять как есть? Рекомендация: да; S1 — WS-01…04.
2. Строки, совпадающие с BL-N (BL-52, BL-57, BL-83, BL-89, BL-93 и др.), — обновить существующие, а не дублировать? Рекомендация: да.

## Вне объёма

### S3 — гигиена (сгруппировано, подробности в `answers/`)
- **Жизненный цикл:** D-06 (`status` не сверяет merge), D-07 = ISS-018 (spec-report привязан к коммиту, а не к `spec_tree`; у потребителя приоритет #3, поднять в цикл 3), D-09 (`fmt` без tmp+rename), D-10 (record без блокировки/CAS), D-11 (NO_CI_EVIDENCE — заглушка в hint), D-13 (нет тестов на обрыв), D-15 (переходы не смотрят на активный Run).
- **Evidence и policy:** E-11 (навык `change-archive-pr` про `--by`, BL-74/90), E-15 (`evidence-complete` принимает `NOT_APPLICABLE` от кого угодно).
- **Guard:** F-09 (нет realpath и учёта регистра; symlink/junction, `SRC/` на Windows), F-10 (асимметрия shell/edit, ISS-020), F-12 (R-28, R-33, R-41), F-14 (guard не работает на разработке самого WARRANT, ADR-0023).
- **CLI и тесты:** G-06 (`--json` ничего не делает, нет компактного вывода, ISS-021), G-09 (допущения тестовой среды, Node 20), G-10/G-11 (`process.env` вне `Ctx`, policy в commands), G-12 (нет бюджета задержки guard/status), G-14 (R-36 устарел), G-15 (контракт Forge на живом GitHub).
- **Норма и объём:** A-08…A-12 (нет документа для потребителя, статусы ADR, `trusted_signers`/`signature` без проверки, `WARRANT_STATE_DIR`, roadmap без фазы стабилизации), B-11 (одноимённые термины WARRANT/LATTICE в одном контексте), C-12 (удаление/снятие frontend оставляет hooks), C-15/C-16 (drift копится по устройству процесса; один факт разбирается в 7–12 местах), C-20 (режимы без CI/GitHub не описаны).

### FUTURE ENHANCEMENT (не стабилизация)
G-13 (`ci` выгружает полный worktree — монорепо); LATTICE S-7 кроме процедуры трёх PR (WS-10), S-8 (шаблон вывода), S-9 (разбор сессий), S-10 (autoMemory), PRP-001, PRP-002; S-6 / ADR-0045 (бенчмарк контекста); guard для других frontends и MCP; pack `bdd-tdd`/`arch`/`security`/`data`, codex, sef-hub.

### Уже закрыто (сверено с HEAD)
- **S-3 LATTICE (частично):** JSON состояния пишется через tmp+rename (ADR-0044 п. 4–5, REQ-KRN-036); повтор `run submit` не создаёт второй EVID; отмена Run — `run finish --state CANCELLED`, в том числе под `review`; таблица восстановления — `04 §7`. Отдельная `run cancel` не нужна.
- **S-4 LATTICE:** пропущенный тест с `SCN-…` в имени даёт `NOT_PROVEN`.
- **Архитектура:** доменной логики в адаптерах нет, циклов 0, LATTICE в ядре упоминается только в комментариях. Общие contract-наборы «fake против реального» есть для всех портов.
