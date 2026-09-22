/**
 * `warrant classify <change>` (REQ-KRN-028): вычисляет `classification` Change
 * и записывает её в `.warrant/changes/<change>.json`.
 *
 * Команда — только сбор входов: изменённые пути (git diff или `--paths`),
 * floor rules и `match.paths` подключённых packs, предложение proposer'а и
 * ранее записанная classification. Решение принимает чистая функция
 * `core/classify` — та же, что проверяют unit-тесты.
 *
 * Запись идёт через `writeJsonFile`, `transitions[]` не трогается: classify —
 * не переход (04 §9). Если изменённые пути получить нечем, ничего не пишется
 * вовсе (SCN-KRN-076).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";

import { writeJsonFile } from "../core/canon/format-json.js";
import { classify, type FloorRule, type ProfileMatch, type Proposal } from "../core/classify/index.js";
import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { resolveForProject, RISK_DIMENSIONS, type Classification, type RiskDimension } from "../core/resolve/index.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { projectRoot as defaultRoot, requireConfigPath } from "./context.js";

// `cross-spawn` — CommonJS с `export =`; на Windows это ещё и единственный
// способ запустить `git` одинаково с `runOpenspec`.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

export interface ClassifyOptions {
  /** Ref, с которым сравнивается HEAD; по умолчанию `main`. */
  base?: string | undefined;
  /** Файл со списком изменённых путей, по одному на строку; альтернатива git. */
  paths?: string | undefined;
  /** JSON предложения proposer'а: `{"profiles": [...], "risk": {...}}`. */
  propose?: string | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const proc = spawn.sync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: proc.error == null && proc.status === 0,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? ""
  };
}

/**
 * Изменённые пути из `git diff --name-only <base>...HEAD`.
 *
 * `git` печатает пути относительно корня репозитория, а classification живёт в
 * проекте, поэтому пути переносятся в систему координат проекта; всё, что вне
 * проекта, отбрасывается — policy проекта о нём ничего сказать не может.
 */
function changedFromGit(root: string, base: string): string[] {
  const top = git(["rev-parse", "--show-toplevel"], root);
  if (!top.ok) {
    throw new WarrantError(
      "USAGE",
      `${root} is not a git repository; pass --paths <file> with one changed path per line`
    );
  }
  const diff = git(["diff", "--name-only", `${base}...HEAD`], root);
  if (!diff.ok) {
    throw new WarrantError(
      "USAGE",
      `git could not diff "${base}...HEAD": ${(diff.stderr || diff.stdout).trim().split("\n")[0] ?? ""}; pass an existing ref with --base or use --paths`
    );
  }

  const toplevel = path.resolve(top.stdout.trim());
  const prefix = path.relative(toplevel, path.resolve(root)).split(path.sep).join("/");
  const lines = diff.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (prefix === "") return lines;
  return lines
    .filter((line) => line.startsWith(`${prefix}/`))
    .map((line) => line.slice(prefix.length + 1));
}

/** Изменённые пути из файла `--paths`: по одному на строку, пустые строки игнорируются. */
function changedFromFile(root: string, file: string): string[] {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  if (!existsSync(absolute)) {
    throw new WarrantError("USAGE", `--paths file not found: ${file}`, { path: file });
  }
  return readFileSync(absolute, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Разбирает и проверяет `--propose`: неверная форма — ошибка пользователя, не конфигурации. */
function parseProposal(raw: string): Proposal {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new WarrantError("USAGE", `--propose is not valid JSON: ${(cause as Error).message}`);
  }
  if (!isPlainObject(json)) throw new WarrantError("USAGE", "--propose must be a JSON object");

  const proposal: Proposal = {};
  const profiles = json["profiles"];
  if (profiles !== undefined) {
    if (!Array.isArray(profiles) || profiles.some((p) => typeof p !== "string")) {
      throw new WarrantError("USAGE", "--propose: `profiles` must be an array of profile ids");
    }
    proposal.profiles = profiles as string[];
  }
  const risk = json["risk"];
  if (risk !== undefined) {
    if (!isPlainObject(risk)) throw new WarrantError("USAGE", "--propose: `risk` must be an object");
    const values: Partial<Record<RiskDimension, string>> = {};
    for (const [key, value] of Object.entries(risk)) {
      if (!(RISK_DIMENSIONS as readonly string[]).includes(key)) {
        throw new WarrantError("USAGE", `--propose: "${key}" is not a risk dimension`);
      }
      if (typeof value !== "string") {
        throw new WarrantError("USAGE", `--propose: risk.${key} must be a string`);
      }
      values[key as RiskDimension] = value;
    }
    proposal.risk = values;
  }
  return proposal;
}

/** Floor rules всех подключённых packs, с индексом правила внутри своего файла. */
function collectFloors(objects: { kind: string; pack: string; json: unknown }[]): FloorRule[] {
  const out: FloorRule[] = [];
  for (const object of objects) {
    if (object.kind !== "risk-floor" || !isPlainObject(object.json)) continue;
    const floors = object.json["floors"];
    if (!Array.isArray(floors)) continue;
    floors.forEach((rule, index) => {
      if (!isPlainObject(rule)) return;
      const paths = Array.isArray(rule["paths"])
        ? rule["paths"].filter((p): p is string => typeof p === "string")
        : [];
      const set: Partial<Record<RiskDimension, string>> = {};
      if (isPlainObject(rule["set"])) {
        for (const dimension of RISK_DIMENSIONS) {
          const value = (rule["set"] as Record<string, unknown>)[dimension];
          if (typeof value === "string") set[dimension] = value;
        }
      }
      out.push({ pack: object.pack, index, paths, set });
    });
  }
  return out;
}

/** Profiles с `match.paths` — кандидаты, предлагаемые изменёнными путями. */
function collectProfileMatches(objects: { kind: string; pack: string; id: string; json: unknown }[]): ProfileMatch[] {
  const out: ProfileMatch[] = [];
  for (const object of objects) {
    if (object.kind !== "profile" || !isPlainObject(object.json)) continue;
    const match = object.json["match"];
    if (!isPlainObject(match)) continue;
    const paths = Array.isArray(match["paths"])
      ? match["paths"].filter((p): p is string => typeof p === "string")
      : [];
    if (paths.length === 0) continue;
    out.push({ pack: object.pack, id: object.id, paths });
  }
  return out;
}

export function runClassify(
  change: string,
  opts: ClassifyOptions = {},
  root: string = defaultRoot()
): CommandResult {
  requireConfigPath(root);

  const record = readChangeRecord(root, change);

  // Всё, что может сказать «не буду», говорит это до первой записи.
  const proposal = opts.propose !== undefined && opts.propose !== "" ? parseProposal(opts.propose) : undefined;
  const changed =
    opts.paths !== undefined && opts.paths !== ""
      ? changedFromFile(root, opts.paths)
      : changedFromGit(root, opts.base !== undefined && opts.base !== "" ? opts.base : "main");

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);

  const result = classify({
    changed,
    floors: collectFloors(loaded.objects),
    profiles: collectProfileMatches(loaded.objects),
    ...(proposal === undefined ? {} : { propose: proposal }),
    ...(isPlainObject(record["classification"])
      ? { previous: record["classification"] as Classification }
      : {})
  });

  const updated = { ...record, classification: result.classification };
  writeJsonFile(path.join(root, ".warrant", "changes", `${change}.json`), updated);

  const { result: resolved, errors } = resolveForProject(loaded, result.classification);
  const data: Record<string, unknown> = {
    changed,
    classification: result.classification,
    profiles: result.profiles,
    ignored: result.ignored
  };

  if (errors.length > 0) return failures(errors, EXIT.CONFIG, data, change);
  if (!resolved.ok) {
    const conflicts: CliError[] = [{ code: "POLICY_CONFLICT", message: resolved.conflict.message }];
    return failures(conflicts, EXIT.WAIT, { ...data, controller_action: "ESCALATE", conflicts: resolved.conflict.items }, change);
  }

  const { explain: _explain, ...policy } = resolved.policy;
  return success({ ...data, effective_policy: policy }, change);
}
