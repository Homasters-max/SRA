/**
 * Дисциплина версий (ревью фазы 3, R-14): компонент, изменённый после
 * последнего релиза, уже несёт новую версию.
 *
 * Релиз — последний tag `v*`, достижимый из HEAD. Компоненты — то, что
 * поставляется и версионируется отдельно:
 *   - CLI: версия в `package.json`; содержимое — `packages/cli/src`,
 *     `packages/cli/schemas`, `packages/cli/package.json`, `scripts/build.js` и
 *     поставляемые поля `package.json` (зависимости, `bin`, `files`, …; скрипты
 *     и devDependencies в поставку не входят);
 *   - каждый pack `packs/<id>/`: версия в `pack.json`; содержимое — каталог без
 *     `golden/` (как `packContentHash`, I-59);
 *   - каждый skill `sra/skills/<…>/SKILL.md`: версия во frontmatter; содержимое —
 *     каталог skill'а.
 *
 * Изменён с релиза, а версия та же → ошибка: bump делается первым же
 * изменением после релиза, а не «к следующему tag» (так его и забывали, G-20).
 * Версия ниже релизной — тоже ошибка. Компонент, которого в релизе не было, —
 * новый, ему bump не нужен.
 *
 * Общий код `scripts/versions-check.js` (`npm run versions:check`) и e2e-теста
 * `packages/cli/test/e2e/versions.test.ts`. Plain Node ESM, только git.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Поля `package.json`, которые меняют установленный CLI. */
export const SHIPPED_PACKAGE_FIELDS = ["name", "type", "bin", "main", "exports", "files", "engines", "dependencies", "optionalDependencies", "peerDependencies"];

const CLI_PATHS = ["packages/cli/src", "packages/cli/schemas", "packages/cli/package.json", "scripts/build.js"];

function git(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: run.error == null && run.status === 0, stdout: run.stdout ?? "" };
}

/** Последний релизный tag `v*`, достижимый из HEAD; null, если его нет. */
export function releaseTag(root) {
  const run = git(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD"]);
  const tag = run.stdout.trim();
  return run.ok && tag !== "" ? tag : null;
}

/** Текст файла на ref, null — если его там нет. */
function showAt(root, ref, file) {
  const run = git(root, ["show", `${ref}:${file}`]);
  return run.ok ? run.stdout : null;
}

function readText(root, file) {
  const absolute = path.join(root, file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

function jsonVersion(text) {
  if (text === null) return null;
  try {
    const version = JSON.parse(text).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** `version:` из YAML-frontmatter SKILL.md. */
function frontmatterVersion(text) {
  if (text === null) return null;
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = head === null ? null : /^version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(head[1]);
  return line === null ? null : line[1];
}

function shippedFields(text) {
  if (text === null) return null;
  const json = JSON.parse(text);
  const out = {};
  for (const key of SHIPPED_PACKAGE_FIELDS) if (json[key] !== undefined) out[key] = json[key];
  return JSON.stringify(out);
}

/**
 * Файлы под `paths`, изменённые относительно `ref` (рабочее дерево против ref,
 * включая неотслеживаемые), кроме префиксов `excluded`; POSIX-пути от корня.
 */
export function changedSince(root, ref, paths, excluded = []) {
  const keep = (file) => file !== "" && !excluded.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
  const tracked = git(root, ["diff", "--name-only", ref, "--", ...paths]).stdout.split("\n");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths]).stdout.split("\n");
  return [...new Set([...tracked, ...untracked].map((f) => f.trim()).filter(keep))].sort();
}

/** `a` < `b` по числовым компонентам `MAJOR.MINOR.PATCH` (pre-release не используется). */
export function versionLess(a, b) {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10));
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort();
}

/** Каталоги skill'ов (с `SKILL.md`) под `sra/skills`, POSIX-пути от корня. */
function skillDirs(root) {
  const out = [];
  const walk = (rel) => {
    const absolute = path.join(root, rel);
    if (existsSync(path.join(absolute, "SKILL.md"))) out.push(rel);
    for (const name of listDirs(absolute)) walk(`${rel}/${name}`);
  };
  if (existsSync(path.join(root, "sra", "skills"))) walk("sra/skills");
  return out.sort();
}

/** Компоненты репозитория с их версиями сейчас и на ref и изменёнными файлами. */
export function components(root, ref) {
  const out = [];

  const pkgNow = readText(root, "package.json");
  const pkgThen = showAt(root, ref, "package.json");
  const cliChanged = changedSince(root, ref, CLI_PATHS);
  if (pkgNow !== null && pkgThen !== null && shippedFields(pkgNow) !== shippedFields(pkgThen)) cliChanged.push("package.json");
  out.push({ id: "cli", versionFile: "package.json", now: jsonVersion(pkgNow), then: jsonVersion(pkgThen), changed: cliChanged.sort() });

  for (const id of listDirs(path.join(root, "packs"))) {
    const dir = `packs/${id}`;
    const manifest = `${dir}/pack.json`;
    if (!existsSync(path.join(root, manifest))) continue;
    out.push({
      id: `pack ${id}`,
      versionFile: manifest,
      now: jsonVersion(readText(root, manifest)),
      then: jsonVersion(showAt(root, ref, manifest)),
      changed: changedSince(root, ref, [dir], [`${dir}/golden`])
    });
  }

  for (const dir of skillDirs(root)) {
    const file = `${dir}/SKILL.md`;
    out.push({
      id: `skill ${dir.slice("sra/skills/".length)}`,
      versionFile: file,
      now: frontmatterVersion(readText(root, file)),
      then: frontmatterVersion(showAt(root, ref, file)),
      changed: changedSince(root, ref, [dir])
    });
  }
  return out;
}

/**
 * Проверка дисциплины версий. `{ tag: null }` — релиза ещё нет (проверять не с
 * чем); иначе `errors[]` по компонентам, изменённым без bump.
 */
export function checkVersions(root) {
  const tag = releaseTag(root);
  if (tag === null) return { tag: null, components: [], errors: [] };
  const list = components(root, tag);
  const errors = [];
  for (const c of list) {
    if (c.then === null) continue; // нового компонента в релизе не было
    if (c.now === null) {
      errors.push({ component: c.id, message: `${c.versionFile}: version is missing (was ${c.then} in ${tag})` });
    } else if (versionLess(c.now, c.then)) {
      errors.push({ component: c.id, message: `${c.versionFile}: version ${c.now} is lower than ${c.then} of ${tag}` });
    } else if (c.changed.length > 0 && c.now === c.then) {
      const sample = c.changed.slice(0, 3).join(", ") + (c.changed.length > 3 ? `, … (${c.changed.length} files)` : "");
      errors.push({
        component: c.id,
        message: `${c.id} changed since ${tag} (${sample}) but ${c.versionFile} still says ${c.now}: bump it with the first change after a release`
      });
    }
  }
  return { tag, components: list, errors };
}
