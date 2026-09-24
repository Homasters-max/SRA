/**
 * `cs` — поиск по коду через граф (Graft), порядок — `.claude/skills/code-search/SKILL.md`, решения — ADR-0026 п. 2,
 * ADR-0029 п. 1–2.
 *
 *   node scripts/dev/cs.js ask "<вопрос>" [--source] [-n N] [--in <путь>] | grep "<шаблон>" [-i] [--fixed] [--in <путь>]
 *     | skeleton <файл> | callers <символ> [-d N|all] [--direction in|out] [--in <путь>] | impact <символ> [--in <путь>]
 *     | deps <файл> | deps <каталог> [--level N] [--external] [--cycles [--runtime]] | deps --cycles [--in <путь>] [--runtime]
 *     | dups [--min N] [--kind function|all] [--in <путь>] | map | version        (--json — у всех, кроме version)
 *
 * Обёртка над `graft`: подкоманды и флаги — белым списком на подкоманду, ровно один позиционный аргумент (у map,
 * version и dups — ни одного, у deps — ноль или один), `--` завершает флаги; `--in`, файл skeleton и путь deps,
 * заданные от текущего каталога, переписываются от корня репозитория. Запускается `node <пакет>/<bin>` того установленного `@nanonets/graft`, чья версия проверена
 * (`cross-spawn` не нужен, `npm ci` для `cs` не требуется); git и graft — без shell, таймаут 120 с. Окружение: `GRAFT_*`
 * вызывающего удаляются, без правок `.gitignore` / `.ignore`, без status line и телеметрии. Индекс только в `graft/`
 * (исключён через `.git/info/exclude`); индекса нет — строит его сама под замком `graft/.cs-build.lock`. Из вывода
 * убираются строки об «экономии токенов», подсказки `graft <sub>` переписываются в `cs <sub>`; вывод `callers` — не
 * больше 80 строк (с `--json` — JSON graft без ограничения). `version` печатает установленную версию без обращения
 * к npm.
 *
 * `cs impact <символ>` — «что обновить при изменении символа»: `callers -d 1` графа, сведённый с grep мест вызова по
 * имени, с объемлющим символом из `graft/.graph/wiring.json` и метками `[graph+grep]` / `[grep]` / `[graph]`.
 * `cs deps` — граф импорта файлов из `wiring.json` (индекс сначала освежается через `graft map`): импорты и импортёры
 * файла с пометкой type-only, модули каталога с Ca / Ce / нестабильностью, циклы (Tarjan). `cs dups` — имена,
 * определённые в нескольких файлах (граф теряет межфайловых вызывающих таких имён). Текст ограничен, `--json` —
 * полный (форматы `cs-impact/1`, `cs-deps/1`, `cs-dups/1` описаны в cs-lib.js).
 *
 * Выход: код `graft`; 2 — подкоманда, флаг или аргумент не разрешены (поправь команду); 3 — окружение не то (версия,
 * индекс не исключён, graft не запустился или не уложился в таймаут) — остановиться и сообщить, не обходить.
 * Логика — `scripts/dev/cs-lib.js`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  callersOutput,
  clean,
  ensureIndex,
  EXIT_ENV,
  EXIT_USAGE,
  findGraftPackage,
  GRAFT_TIMEOUT_MS,
  GRAFT_VERSION,
  graftArgs,
  depsCycles,
  depsFile,
  depsModules,
  depsTargetError,
  dupsData,
  formatDeps,
  formatDups,
  formatImpact,
  impactData,
  impactQuery,
  importGraph,
  makeKindOf,
  normalizeDir,
  parseArgv,
  scrubEnv,
  USAGE,
  withRepoPaths
} from "./cs-lib.js";

export { GRAFT_VERSION };

/** @returns {never} */
function stop(/** @type {number} */ code, /** @type {string} */ msg) {
  process.stderr.write(`cs: ${msg}\n`);
  process.exit(code);
}

const parsed = parseArgv(process.argv.slice(2));
if ("error" in parsed) stop(EXIT_USAGE, `${parsed.error}\nusage: ${USAGE}`);
const cmd = /** @type {import("./cs-lib.js").Parsed} */ (parsed);

const pkg = findGraftPackage(process.env.PATH ?? "", {
  delimiter: path.delimiter,
  exists: existsSync,
  readJson: (p) => JSON.parse(readFileSync(p, "utf8"))
});
if (!pkg || pkg.version !== GRAFT_VERSION) {
  stop(EXIT_ENV, `need @nanonets/graft ${GRAFT_VERSION} (npm i -g @nanonets/graft@${GRAFT_VERSION}), found ${pkg?.version ?? "nothing on PATH"}`);
}
const bin = pkg.bin;
if (!bin || !existsSync(bin)) stop(EXIT_ENV, `@nanonets/graft in ${pkg.dir} has no graft bin`);

if (cmd.sub === "version") {
  process.stdout.write(`graft ${pkg.version} (pinned ${GRAFT_VERSION}) — ${pkg.dir}\n`);
  process.exit(0);
}

/**
 * Run a program without a shell; a failure to start, a timeout or an overflow is exit 3.
 * @param {string} what name for messages
 * @param {string} file
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} opts
 */
function run(what, file, args, opts) {
  const r = spawnSync(file, args, { encoding: "utf8", shell: false, windowsHide: true, timeout: GRAFT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) stop(EXIT_ENV, `${what}: ${/** @type {NodeJS.ErrnoException} */ (r.error).code ?? ""} ${r.error.message}`);
  return { status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

const top = run("git rev-parse", "git", ["rev-parse", "--show-toplevel"], {});
if (top.status !== 0) stop(EXIT_ENV, "not inside a git repository");
const root = path.resolve(top.stdout.trim());
if (run("git check-ignore", "git", ["check-ignore", "-q", "graft/INDEX.md"], { cwd: root }).status !== 0) {
  stop(EXIT_ENV, "graft/ is not excluded from git (.git/info/exclude)");
}

const env = scrubEnv(process.env);
const runGraft = (/** @type {string[]} */ args) => run(`graft ${args[0]}`, process.execPath, [bin, ...args], { cwd: root, env });

const index = ensureIndex(root, () => {
  const b = runGraft(["build"]);
  return { ok: b.status === 0, message: b.stderr || b.stdout };
});
if (index.state === "failed") stop(EXIT_ENV, `graft build: ${clean(index.message)}`);
if (index.state === "timeout") stop(EXIT_ENV, "another cs has held the index build lock (graft/.cs-build.lock) for over 90 s");
if (index.state === "built") process.stderr.write("cs: index built\n");

const { sub, arg, opts } = withRepoPaths(cmd, { cwd: process.cwd(), root, exists: existsSync });

if (sub === "impact") {
  const symbol = /** @type {string} */ (arg);
  const scope = typeof opts.in === "string" ? ["--in", opts.in] : [];
  const c = runGraft(["callers", "--depth", "1", "--json", ...scope, "--", symbol]);
  const g = runGraft(["grep", "--json", ...scope, "--", impactQuery(symbol).pattern]);
  if (g.status !== 0) stop(EXIT_ENV, `graft grep: ${clean(g.stderr || g.stdout)}`);
  const json = (/** @type {string} */ what, /** @type {string} */ text) => {
    try {
      return JSON.parse(text);
    } catch {
      return stop(EXIT_ENV, `graft ${what} --json: not JSON: ${clean(text).slice(0, 400)}`);
    }
  };
  const callers = c.status === 0 ? json("callers", c.stdout) : null;
  const wiring = json("wiring.json", readFileSync(path.join(root, "graft", ".graph", "wiring.json"), "utf8"));
  const callersError = c.status === 0 ? null : clean(c.stderr || c.stdout).replace(/^✗\s*/, "");
  const data = impactData({ symbol, callers, grep: json("grep", g.stdout), nodes: wiring.nodes ?? [], ...(callersError ? { callersError } : {}) });
  process.stdout.write(opts.json ? `${JSON.stringify(data, null, 2)}\n` : formatImpact(data));
  process.exit(0);
}

if (sub === "deps" || sub === "dups") {
  const fresh = runGraft(["map", "--json"]); // graft refreshes a stale index before answering; the answer is not used
  if (fresh.status !== 0) stop(EXIT_ENV, `graft map: ${clean(fresh.stderr || fresh.stdout)}`);
  const wiring = JSON.parse(readFileSync(path.join(root, "graft", ".graph", "wiring.json"), "utf8"));
  const scope = typeof opts.in === "string" ? { in: opts.in } : {};
  /** @type {any} */
  let data;
  if (sub === "dups") {
    data = dupsData(wiring.nodes ?? [], { min: Number(opts.min ?? 2), kind: typeof opts.kind === "string" ? opts.kind : "function", ...scope });
  } else {
    const graph = importGraph(wiring);
    const kindOf = makeKindOf(graph.files, (file) => {
      try {
        return readFileSync(path.join(root, file), "utf8");
      } catch {
        return null;
      }
    });
    if (arg === undefined) data = depsCycles(graph, kindOf, { runtime: Boolean(opts.runtime), ...scope });
    else {
      const target = normalizeDir(arg);
      const abs = path.join(root, target);
      const kind = graph.files.has(target) ? "file" : existsSync(abs) && statSync(abs).isDirectory() ? "dir" : null;
      if (kind === null) stop(EXIT_USAGE, `deps: ${arg} is neither an indexed code file nor a directory`);
      const problem = depsTargetError(opts, kind);
      if (problem) stop(EXIT_USAGE, problem);
      data =
        kind === "file"
          ? depsFile(target, graph, kindOf)
          : depsModules(target, Number(opts.level ?? 1), graph, kindOf, { external: Boolean(opts.external), cycles: Boolean(opts.cycles), runtime: Boolean(opts.runtime) });
    }
  }
  process.stdout.write(opts.json ? `${JSON.stringify(data, null, 2)}\n` : sub === "dups" ? formatDups(data) : formatDeps(data));
  process.exit(0);
}

const r = runGraft(graftArgs({ sub, arg, opts }));
const out = clean(r.stdout);
process.stdout.write(sub === "callers" && !opts.json ? callersOutput(out, /** @type {string} */ (arg)) : out);
process.stderr.write(clean(r.stderr));
process.exit(r.status ?? 1);
