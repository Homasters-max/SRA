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
 *
 * `--set <dim>=<value>` / `--set profile=<id>` (repeatable) with `--by <login>`
 * are the human source (P-5): the login must hold a role in `roles` of
 * `warrant.json` (`ROLE_REQUIRED`), `--set` without `--by` is `USAGE`, a value
 * below the floor is `BELOW_FLOOR` and nothing is written. A frozen record
 * (`ARCHIVED`, `ABANDONED`) is `RECORD_FROZEN` (REQ-VER-007).
 *
 * `--ref <url>` (REQ-KRN-028, design §10) makes the risk values of `--set`
 * approved: they may go below the floor and are written with `ref`. It is
 * accepted only in `PROPOSED` / `SPECIFIED` (`STATE_INVALID`) and only from a
 * login in a role of `approvals[]` of `SPECIFIED->APPROVED` of the effective
 * policy of the record as it stands (`maintainer` without one; `ROLE_REQUIRED`).
 * The ref is not verified before `warrant ci` (phase 4).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../core/canon/format-json.js";
import {
  classify,
  dimensionValueOrder,
  type FloorRule,
  type HumanValues,
  type ProfileMatch,
  type Proposal
} from "../core/classify/index.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { changedFromGit } from "../core/git/paths.js";
import { isPlainObject } from "../core/json.js";
import { loadPacks } from "../core/packs/loader.js";
import { packObjects } from "../core/packs/objects.js";
import type { LoadResult } from "../core/packs/types.js";
import { BELOW_FLOOR_APPROVABLE_STATES } from "../core/record/lifecycle.js";
import { readChangeRecord } from "../core/record/read.js";
import { assertNotFrozen } from "../core/record/write.js";
import { resolveForProject, RISK_DIMENSIONS, type Classification, type RiskDimension } from "../core/resolve/index.js";
import { approvalRoles, checkRef, FALLBACK_ROLE, roleMembers } from "../core/roles.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface ClassifyOptions {
  /** Ref, с которым сравнивается HEAD; по умолчанию `main`. */
  base?: string | undefined;
  /** Файл со списком изменённых путей, по одному на строку; альтернатива git. */
  paths?: string | undefined;
  /** JSON предложения proposer'а: `{"profiles": [...], "risk": {...}}`. */
  propose?: string | undefined;
  /** `--set <dim>=<value>` / `--set profile=<id>`, repeatable: the human's values. */
  set?: string[] | undefined;
  /** `--by <login>`: the human behind `--set`. */
  by?: string | undefined;
  /** `--ref <url>`: the approval of the `--set` risk values, which may then go below the floor. */
  ref?: string | undefined;
}

/** The transition whose approvers may approve a value below the floor (REQ-KRN-028). */
export const BELOW_FLOOR_APPROVAL = "SPECIFIED->APPROVED";

/** Parsed `--set` values; `USAGE` for anything that is not `<dimension>=<value>` or `profile=<id>`. */
export function parseSets(sets: readonly string[]): { profiles: string[]; risk: Partial<Record<RiskDimension, string>> } {
  const profiles: string[] = [];
  const risk: Partial<Record<RiskDimension, string>> = {};
  for (const raw of sets) {
    const eq = raw.indexOf("=");
    const key = eq < 0 ? "" : raw.slice(0, eq).trim();
    const value = eq < 0 ? "" : raw.slice(eq + 1).trim();
    if (key === "" || value === "") throw new WarrantError("USAGE", `--set ${JSON.stringify(raw)} is not <dimension>=<value> or profile=<id>`);
    if (key === "profile") {
      if (!profiles.includes(value)) profiles.push(value);
      continue;
    }
    if (!(RISK_DIMENSIONS as readonly string[]).includes(key)) {
      throw new WarrantError("USAGE", `--set: "${key}" is not a risk dimension (${RISK_DIMENSIONS.join(", ")}) or profile`);
    }
    const dimension = key as RiskDimension;
    const allowed = dimensionValueOrder(dimension);
    if (!allowed.includes(value)) {
      throw new WarrantError("USAGE", `--set: ${dimension} must be one of ${allowed.join(", ")}, not "${value}"`);
    }
    const previous = risk[dimension];
    if (previous !== undefined && previous !== value) {
      throw new WarrantError("USAGE", `--set: ${dimension} is set twice (${previous}, ${value})`);
    }
    risk[dimension] = value;
  }
  return { profiles, risk };
}

/**
 * Roles allowed to approve a value below the floor: those of `approvals[]` at
 * `SPECIFIED->APPROVED` of the effective policy of the record's classification
 * (`maintainer` when there is none, or when that policy is in conflict).
 */
function belowFloorRoles(loaded: LoadResult, record: Record<string, unknown>): { roles: string[]; errors: CliError[] } {
  const resolved = resolveForProject(loaded, isPlainObject(record["classification"]) ? (record["classification"] as Classification) : undefined);
  if (resolved.errors.length > 0) return { roles: [], errors: resolved.errors };
  if (!resolved.result.ok) return { roles: [FALLBACK_ROLE], errors: [] };
  return { roles: approvalRoles(resolved.result.policy, BELOW_FLOOR_APPROVAL), errors: [] };
}

/** The human source of the call, checked against `roles` and the declared profiles. */
function humanValues(loaded: LoadResult, sets: ReturnType<typeof parseSets>, login: string, ref?: string): HumanValues {
  if (!roleMembers(loaded.config).has(login)) {
    throw new WarrantError("ROLE_REQUIRED", `${login} is not listed in any role of .warrant/warrant.json; --set needs a login from roles`, {
      path: ".warrant/warrant.json"
    });
  }
  const declared = new Set(packObjects(loaded, "profile").map((o) => o.id));
  for (const id of sets.profiles) {
    if (!declared.has(id)) throw new WarrantError("USAGE", `--set profile=${id}: no profile "${id}" in the enabled packs or .warrant/local/`);
  }
  const human: HumanValues = { login };
  if (sets.profiles.length > 0) human.profiles = sets.profiles;
  if (Object.keys(sets.risk).length > 0) human.risk = sets.risk;
  if (ref !== undefined) human.ref = ref;
  return human;
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

export async function runClassify(ctx: Ctx, change: string, opts: ClassifyOptions = {}): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);

  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);

  // Всё, что может сказать «не буду», говорит это до первой записи.
  const sets = opts.set !== undefined && opts.set.length > 0 ? parseSets(opts.set) : undefined;
  const login = opts.by !== undefined && opts.by !== "" ? opts.by : undefined;
  if (sets !== undefined && login === undefined) throw new WarrantError("USAGE", "--set needs --by <login> of a member of roles");
  if (sets === undefined && login !== undefined) throw new WarrantError("USAGE", "--by applies only together with --set");
  if (login !== undefined && !/^[A-Za-z0-9._-]+$/.test(login)) {
    throw new WarrantError("USAGE", `--by ${JSON.stringify(login)} is not a login ([A-Za-z0-9._-]+)`);
  }
  const ref = opts.ref !== undefined && opts.ref !== "" ? opts.ref : undefined;
  if (ref !== undefined) {
    if (sets === undefined || Object.keys(sets.risk).length === 0) {
      throw new WarrantError("USAGE", "--ref approves --set <dimension>=<value>: pass at least one risk value with --set and --by");
    }
    checkRef(ref);
    const state = String(record["change_state"]);
    if (!(BELOW_FLOOR_APPROVABLE_STATES as readonly string[]).includes(state)) {
      throw new WarrantError(
        "STATE_INVALID",
        `record of "${change}" is ${state}: a value below the floor is approved only in PROPOSED or SPECIFIED`,
        { path: `.warrant/changes/${change}.json` }
      );
    }
  }
  const proposal = opts.propose !== undefined && opts.propose !== "" ? parseProposal(opts.propose) : undefined;
  const changed =
    opts.paths !== undefined && opts.paths !== ""
      ? changedFromFile(root, opts.paths)
      : await changedFromGit(ctx, opts.base !== undefined && opts.base !== "" ? opts.base : "main");

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  if (ref !== undefined && login !== undefined) {
    const { roles, errors } = belowFloorRoles(loaded, record);
    if (errors.length > 0) return failures(errors, EXIT.CONFIG, {}, change);
    if (!roleMembers(loaded.config, roles).has(login)) {
      throw new WarrantError(
        "ROLE_REQUIRED",
        `${login} is not listed in roles ${roles.map((r) => `"${r}"`).join(", ")} of .warrant/warrant.json, required to approve a value below the floor (${BELOW_FLOOR_APPROVAL})`,
        { path: ".warrant/warrant.json" }
      );
    }
  }
  const human = sets !== undefined && login !== undefined ? humanValues(loaded, sets, login, ref) : undefined;

  const result = classify({
    changed,
    floors: collectFloors(loaded.objects),
    profiles: collectProfileMatches(loaded.objects),
    ...(proposal === undefined ? {} : { propose: proposal }),
    ...(isPlainObject(record["classification"])
      ? { previous: record["classification"] as Classification }
      : {}),
    ...(human === undefined ? {} : { human })
  });
  if (result.belowFloor.length > 0) {
    const errors: CliError[] = result.belowFloor.map((b) => ({
      code: "BELOW_FLOOR",
      message: `--set ${b.dimension}=${b.value} is below the floor ${b.floor} (${b.from}); lowering below the floor needs --ref <url> of its approval`,
      path: `#/classification/risk/${b.dimension}`
    }));
    return failures(errors, EXIT.CONFIG, { changed, below_floor: result.belowFloor }, change);
  }

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
