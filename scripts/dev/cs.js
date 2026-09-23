/**
 * `cs` — поиск по коду через граф (Graft), порядок — `.claude/skills/code-search/SKILL.md`.
 *
 *   node scripts/dev/cs.js ask "<вопрос>" --source | grep "<символ>" | skeleton <файл> | callers <символ> [-d N|all] | map | version
 *
 * Обёртка над `graft`: разрешённые подкоманды и флаги, фиксированная версия, индекс только в `graft/` (исключён через
 * `.git/info/exclude`), без правок `.gitignore` / `.ignore`, без телеметрии; индекса нет — строит его сама. Служебные
 * строки `graft` об «экономии токенов» из вывода убираются, подсказки `graft <sub>` переписываются в `cs <sub>`.
 * Выход: код `graft`; 2 — подкоманда или флаг не разрешены; 3 — окружение не то (версия, индекс не исключён) —
 * остановиться и сообщить, не обходить.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import spawn from "cross-spawn";

export const GRAFT_VERSION = "0.19.0";
const ALLOWED = new Set(["ask", "grep", "skeleton", "callers", "map", "version"]);
const FORBIDDEN_FLAG = /^--(deep|lsp|no-refresh|dir)(=|$)/;

function stop(code, msg) {
  process.stderr.write(`cs: ${msg}\n`);
  process.exit(code);
}

function installedVersion() {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const rel of ["node_modules", "../lib/node_modules"]) {
      const pkg = path.join(dir, rel, "@nanonets", "graft", "package.json");
      if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, "utf8")).version;
    }
  }
  return null;
}

const [sub, ...rest] = process.argv.slice(2);
if (!sub || !ALLOWED.has(sub)) stop(2, `разрешено: ${[...ALLOWED].join(", ")} (получено: ${sub ?? "ничего"})`);
const bad = rest.find((a) => FORBIDDEN_FLAG.test(a));
if (bad) stop(2, `флаг ${bad} не разрешён`);

const version = installedVersion();
if (version !== GRAFT_VERSION) stop(3, `нужен @nanonets/graft ${GRAFT_VERSION}, установлен ${version ?? "ничего"}`);

const top = spawn.sync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) stop(3, "не внутри git-репозитория");
const root = top.stdout.trim();
if (spawn.sync("git", ["check-ignore", "-q", "graft/INDEX.md"], { cwd: root }).status !== 0) {
  stop(3, "каталог graft/ не исключён из git (.git/info/exclude)");
}

const env = { ...process.env, GRAFT_NO_GITIGNORE: "1", GRAFT_NO_IGNORE: "1", GRAFT_NO_STATUSLINE: "1", DO_NOT_TRACK: "1" };

if (sub !== "version" && !existsSync(path.join(root, "graft", ".graph", "wiring.json"))) {
  const build = spawn.sync("graft", ["build"], { cwd: root, env, encoding: "utf8" });
  if (build.status !== 0) stop(3, `graft build: ${build.stderr || build.stdout}`);
  process.stderr.write("cs: индекс построен\n");
}

const run = spawn.sync("graft", [sub, ...rest], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const clean = (text) =>
  (text ?? "")
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("[graft] tokens saved"))
    .join("\n")
    .replace(/`graft (ask|grep|skeleton|callers|map)\b/g, "`cs $1");
process.stdout.write(clean(run.stdout));
process.stderr.write(clean(run.stderr));
process.exit(run.status ?? 1);
