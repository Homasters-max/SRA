/**
 * Общая процедура прогона golden-фикстур pack `core-sdd` (REQ-SDD-009).
 *
 * Один и тот же код используют `scripts/golden-update.js` (перезапись
 * `expected/*.json`) и e2e-тест `packages/cli/test/e2e/golden.test.ts`
 * (сравнение с ними), чтобы скрипт и тест не могли разойтись.
 *
 * Plain Node ESM без TypeScript: скрипт запускается через `npm run
 * golden:update` без сборки тестов и импортирует канонизатор из
 * `packages/cli/dist/**` (сборка обязательна, её делает `npm test` и `npm run
 * build`).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Корень репозитория (= установленного пакета): `scripts/` лежит в нём. */
export const REPO_ROOT = path.resolve(HERE, "..");
export const CLI_ROOT = path.join(REPO_ROOT, "packages", "cli");
export const BIN = path.join(CLI_ROOT, "dist", "bin", "warrant.js");
export const PACKS_DIR = path.join(REPO_ROOT, "packs");
export const GOLDEN_ROOT = path.join(PACKS_DIR, "core-sdd", "golden");

/** Фикстуры в фиксированном порядке: имя каталога = имя profile = имя Change. */
export const GOLDEN_NAMES = ["chore", "factory-change", "feature"];

/** Версия OpenSpec, которую подставляет fake-бинарь: та же, что в локах фикстур. */
export const FAKE_OPENSPEC_VERSION = "1.13.1";

/** Ключ PATH в том написании, в котором его держит Windows, чтобы подмена не дублировала переменную. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/**
 * Fake `openspec` на PATH: отвечает на `--version` и на `status --change <c>
 * --json` телом, вычисленным по содержимому самой фикстуры.
 *
 * Зачем не настоящий бинарь: `expected/*.json` не должны зависеть от того,
 * установлен ли OpenSpec на машине и какой именно (фаза 1, `status.test.ts`).
 * Настоящий OpenSpec гоняет отдельный тест «`warrant validate` внутри копии».
 */
function fakeOpenspecDir(dir) {
  mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, "shim.cjs");
  writeFileSync(
    shim,
    `const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write(${JSON.stringify(FAKE_OPENSPEC_VERSION)} + "\\n"); process.exit(0); }
const i = args.indexOf("--change");
const change = i === -1 ? "" : args[i + 1];
const dir = path.join(process.cwd(), "openspec", "changes", change);
const yaml = path.join(dir, ".openspec.yaml");
const skipSpecs = fs.existsSync(yaml) && /^\\s*skip_specs\\s*:\\s*true\\s*$/m.test(fs.readFileSync(yaml, "utf8"));
const defs = [
  { id: "proposal", outputPath: "proposal.md", requires: [], exists: () => fs.existsSync(path.join(dir, "proposal.md")) },
  { id: "specs", outputPath: "specs/**/*.md", requires: ["proposal"], exists: () => fs.existsSync(path.join(dir, "specs")) },
  { id: "design", outputPath: "design.md", requires: ["proposal"], exists: () => fs.existsSync(path.join(dir, "design.md")) },
  { id: "tasks", outputPath: "tasks.md", requires: ["specs", "design"], exists: () => fs.existsSync(path.join(dir, "tasks.md")) }
];
const status = {};
for (const def of defs) {
  if (def.id === "specs" && skipSpecs) { status[def.id] = "skipped"; continue; }
  if (def.exists()) { status[def.id] = "done"; continue; }
  const blocked = def.requires.some((r) => status[r] !== "done" && status[r] !== "skipped");
  status[def.id] = blocked ? "blocked" : "ready";
}
process.stdout.write(JSON.stringify({
  changeName: change,
  schemaName: "warrant-sdd",
  artifacts: defs.map((d) => ({ id: d.id, outputPath: d.outputPath, status: status[d.id], requires: d.requires }))
}) + "\\n");
`,
    "utf8"
  );
  // На PATH лежит только этот каталог, поэтому `node` прописан абсолютным путём.
  const node = process.execPath;
  writeFileSync(path.join(dir, "openspec.cmd"), `@"${node}" "%~dp0shim.cjs" %*\r\n`, "utf8");
  writeFileSync(path.join(dir, "openspec"), `#!/bin/sh\nexec "${node}" "$(dirname "$0")/shim.cjs" "$@"\n`, "utf8");
  try {
    chmodSync(path.join(dir, "openspec"), 0o755);
  } catch {
    // На Windows прав нет; там используется .cmd.
  }
  return dir;
}

/** Запуск собранного CLI с разобранным конвертом. */
export function runCli(args, cwd, env) {
  const proc = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  let json;
  try {
    json = JSON.parse(proc.stdout);
  } catch {
    json = undefined;
  }
  return { status: proc.status ?? -1, stdout: proc.stdout, stderr: proc.stderr, json };
}

/** Версия CLI из собранного `dist`: она попадает в `sources[0]` и нормализуется. */
export async function cliVersion() {
  const mod = await import(pathToFileURL(path.join(CLI_ROOT, "dist", "version.js")).href);
  return mod.CLI_VERSION;
}

/**
 * Окружение для CLI: bundled pack репозитория и fake `openspec` вместо PATH.
 * Версия OpenSpec фиксирована, поэтому лок фикстуры одинаков на любой машине.
 */
export function goldenEnv(tempRoot, label) {
  return {
    WARRANT_PACKS_DIR: PACKS_DIR,
    [PATH_KEY]: fakeOpenspecDir(path.join(tempRoot, `${label}-bin`))
  };
}

/**
 * Копия фикстуры во временном каталоге, без `expected/`.
 * Возвращает корень копии и окружение для CLI.
 */
export function prepareGolden(name, tempRoot, label = name) {
  const root = path.join(tempRoot, label);
  cpSync(path.join(GOLDEN_ROOT, name), root, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(GOLDEN_ROOT, name), src).split(path.sep).join("/");
      return rel !== "expected" && !rel.startsWith("expected/");
    }
  });
  return { root, env: goldenEnv(tempRoot, label) };
}

/**
 * Нормализация снимка: убирает всё, что зависит от машины и от версии CLI.
 *
 * Волатильны ровно две вещи: `sources[0]` = `kernel@<версия CLI>` и абсолютный
 * путь временной копии, если он куда-то просочится. `hash` effective policy
 * считается по содержимому policy (`merge.ts`), поэтому он остаётся как есть —
 * именно он и ломает golden при правке pack.
 */
export function normalise(value, { cliVersion, projectRoot }) {
  const text = JSON.stringify(value)
    .split(JSON.stringify(projectRoot).slice(1, -1))
    .join("<project>")
    .split(JSON.stringify(projectRoot.split(path.sep).join("/")).slice(1, -1))
    .join("<project>")
    .split(`kernel@${cliVersion}`)
    .join("kernel@{CLI_VERSION}");
  return JSON.parse(text);
}

/**
 * Полная процедура одной фикстуры: `sync`, `resolve --explain`, `status`.
 * Возвращает нормализованные `data` обеих команд.
 */
export async function runGolden(name, tempRoot) {
  const { root, env } = prepareGolden(name, tempRoot);
  const version = await cliVersion();

  const sync = runCli(["sync"], root, env);
  if (sync.status !== 0) {
    throw new Error(`golden ${name}: warrant sync failed (${sync.status})\n${sync.stdout}${sync.stderr}`);
  }
  const resolve = runCli(["resolve", name, "--explain"], root, env);
  if (resolve.status !== 0) {
    throw new Error(`golden ${name}: warrant resolve failed (${resolve.status})\n${resolve.stdout}${resolve.stderr}`);
  }
  const status = runCli(["status", name], root, env);
  if (status.status !== 0) {
    throw new Error(`golden ${name}: warrant status failed (${status.status})\n${status.stdout}${status.stderr}`);
  }

  const context = { cliVersion: version, projectRoot: root };
  return {
    root,
    changed: sync.json.data.changed,
    resolve: normalise(resolve.json.data, context),
    status: normalise(status.json.data, context)
  };
}

/** Каталог `expected/` фикстуры. */
export function expectedDir(name) {
  return path.join(GOLDEN_ROOT, name, "expected");
}

/** Содержимое `expected/<file>.json` фикстуры. */
export function readExpected(name, file) {
  return JSON.parse(readFileSync(path.join(expectedDir(name), `${file}.json`), "utf8"));
}

/** Временный каталог для прогона фикстур. */
export function makeTempRoot() {
  return mkdtempSync(path.join(tmpdir(), "warrant-golden-"));
}

export function removeDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
