/**
 * Registry of the checks of `warrant validate` — checks (1)–(13) of
 * REQ-KRN-021 (A-9, design phase-4a §3).
 *
 * Every finding is collected: the run never stops at the first error, so one
 * run tells the whole story (SCN-KRN-043). The order of the registry is the
 * order of the checks; it fixes the order of `data.skipped` and of the stderr
 * warnings, while `errors[]` is sorted by the command.
 *
 * `level` tells a check of one file (ADR-0019 point 1 (a)–(e)) from a check of
 * the whole project (lock, generated files, `openspec schema validate`, record
 * semantics); `appliesTo` says which project paths a `file` check reads. Both
 * are for `validate --files` (REQ-KRN-032, `runFileChecks`): a full
 * `validate` runs every check; `--files` runs the `file` checks that accept a
 * path, over the paths they accept, and reports only the findings of those
 * paths — no `openspec`, no git but one `contents` call of check (9).
 *
 * Nothing is skipped unconditionally: `config.yaml` is generated whole, so
 * there is no flag to opt out of check (4) (REQ-KRN-025, откат I-43).
 * `skipped` lists what this run could not do: `openspec-schema` and
 * `ids-placement` when `openspec` is not on PATH. Check (9) needs git; outside
 * a git work tree it is skipped with a warning on stderr only, because fixture
 * projects without git are a normal place to run `validate`.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { checkCanonical, isRawEvidencePath, SCHEMA_COPIES_PREFIX, WARRANT_DIR } from "../canon/files.js";
import type { WarrantConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import type { CliError } from "../errors.js";
import { projectPath, reportPath, walkFiles } from "../fs.js";
import { checkImmutableFiles, checkImmutableIds } from "../ids/immutable.js";
import { checkIds, checkIdsIn, loadAreas, scanIds, type FoundId, type ScanResult } from "../ids/scan.js";
import { checkLock, LOCK_REL } from "../packs/hash.js";
import type { LoadResult } from "../packs/types.js";
import { readAllRecords, type RecordFile } from "../record/read.js";
import { validateFile } from "../schemas/semantic.js";
import { scanSecrets, SECRET_SCAN_DIRS } from "../secrets.js";
import { checkWaivers } from "../waivers/check.js";
import { checkDangling } from "./dangling.js";
import { checkEvidence } from "./evidence.js";
import { checkGenerated } from "./generated.js";
import { checkLinkTargets } from "./links.js";
import { checkRuleScope } from "./rules.js";

/** State of one `validate` run, shared by its checks. */
export interface ValidateRun {
  readonly ctx: Ctx;
  /** Loader result: config, packs, their files, duplicates and overrides — checks (1) and (3). */
  readonly loaded: LoadResult;
  /** Project paths some check read, for `data.checked.files`. */
  readonly checked: Set<string>;
  /** What this run could not do (`openspec-schema`, `ids-placement`), for `data.skipped`. */
  readonly skipped: string[];
  /** Ids declared in `openspec/**`: written by check (5), read by check (13). */
  declared: readonly FoundId[];
  /** Change records, read once for checks (9)–(11). */
  records(): ReadonlyMap<string, RecordFile>;
  /** Ids of the whole project, scanned once for checks (5) and (13) under `--files`. */
  scan(): ScanResult;
}

export interface ValidateCheck {
  /** Stable id of the check. */
  readonly id: string;
  readonly level: "file" | "project";
  /** True when the check reads this project path (POSIX, relative to the root); `project` checks read none. */
  appliesTo(file: string, config: WarrantConfig): boolean;
  /**
   * `files` — under `validate --files`, the project paths `appliesTo` accepted:
   * the check reads only them and returns only their findings.
   */
  run(v: ValidateRun, files?: readonly string[]): Promise<readonly CliError[]>;
}

/** A new run over the loaded project: the loader's files are already checked. */
export function validateRun(ctx: Ctx, loaded: LoadResult): ValidateRun {
  let records: ReadonlyMap<string, RecordFile> | undefined;
  let scanned: ScanResult | undefined;
  return {
    ctx,
    loaded,
    checked: new Set(loaded.files),
    skipped: [],
    declared: [],
    records: () => (records ??= readAllRecords(ctx.root)),
    scan: () => (scanned ??= scanIds(ctx.root))
  };
}

const none = (): boolean => false;

/** Absolute path of a project path. */
function absoluteOf(root: string, file: string): string {
  return path.join(root, ...file.split("/"));
}

/** Findings whose `path` (without a `#pointer`) is one of `files`. */
function findingsOf(errors: readonly CliError[], files: readonly string[]): CliError[] {
  return errors.filter((error) => files.includes((error.path ?? "").split("#")[0] as string));
}

/** `.warrant/**` JSON governed by the schema and the canonical form: not the schema copies, not raw check output. */
function isWarrantJson(file: string): boolean {
  return (
    file.startsWith(`${WARRANT_DIR}/`) &&
    file.toLowerCase().endsWith(".json") &&
    !file.startsWith(SCHEMA_COPIES_PREFIX) &&
    !isRawEvidencePath(file)
  );
}

/** Markdown of `openspec/specs/**` and `openspec/changes/**`, archive included. */
function isOpenspecMarkdown(file: string): boolean {
  return /^openspec\/(specs|changes)\/.+\.md$/.test(file);
}

function underTests(file: string, config: WarrantConfig): boolean {
  const tests = config.paths.tests?.replace(/\/+$/, "");
  return tests !== undefined && tests.length > 0 && (file === tests || file.startsWith(`${tests}/`));
}

/** Check (1) for every `.warrant/**` JSON file the loader did not read — or only `files`. */
function checkWarrantFiles(v: ValidateRun, files?: readonly string[]): CliError[] {
  const { root } = v.ctx;
  const errors: CliError[] = [];
  const targets = files?.map((file) => absoluteOf(root, file)) ?? walkFiles(path.join(root, WARRANT_DIR));
  for (const absolute of targets) {
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    const reported = reportPath(absolute, root);
    if (reported.startsWith(SCHEMA_COPIES_PREFIX)) continue;
    if (isRawEvidencePath(reported)) continue; // raw check output is not a record (I-76)
    if (reported === LOCK_REL) continue; // check (2) validates the lock
    if (v.checked.has(reported)) continue;
    v.checked.add(reported);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(absolute, "utf8"));
    } catch (cause) {
      errors.push({ code: "CONFIG_INVALID", message: `invalid JSON: ${(cause as Error).message}`, path: reported });
      continue;
    }
    const result = validateFile(json, reported);
    if (!result.ok) errors.push(...result.errors);
  }
  return errors;
}

/** The checks of `validate`, in the order of REQ-KRN-021 as the command has always run them. */
export const VALIDATE_CHECKS: readonly ValidateCheck[] = [
  {
    // Loaded by `validateRun`: its errors are those of checks (1) and (3) for config, packs and overrides.
    id: "packs", // check (1), (3)
    level: "file",
    appliesTo: (file) => (isWarrantJson(file) && file !== LOCK_REL) || /^packs\/.+\.json$/.test(file),
    run: async (v, files) => (files === undefined ? v.loaded.errors : findingsOf(v.loaded.errors, files))
  },
  {
    id: "schema", // check (1)
    level: "file",
    appliesTo: (file) => isWarrantJson(file) && file !== LOCK_REL,
    run: async (v, files) => checkWarrantFiles(v, files)
  },
  {
    id: "lock", // check (2)
    level: "project",
    appliesTo: none,
    run: async (v) => {
      const errors = checkLock({ projectRoot: v.ctx.root, config: v.loaded.config, packs: v.loaded.packs });
      v.checked.add(LOCK_REL);
      return errors;
    }
  },
  {
    // A failed load already told the whole story; planning on top of it would
    // only repeat it, so the check is skipped without a second word.
    id: "generated", // check (4)
    level: "project",
    appliesTo: none,
    run: async (v) => (v.loaded.errors.length === 0 ? checkGenerated(v.ctx, v.loaded, v.skipped) : [])
  },
  {
    id: "ids", // check (5)
    level: "file",
    appliesTo: isOpenspecMarkdown,
    run: async (v, files) => {
      if (files !== undefined) return checkIdsIn(v.scan(), loadAreas(v.ctx.root), new Set(files));
      const ids = await checkIds(v.ctx);
      for (const file of ids.files) v.checked.add(file);
      v.declared = ids.ids;
      if (ids.placementSkipped) {
        v.skipped.push("ids-placement");
        v.ctx.warn("validate: check (5) id placement skipped: `openspec` is not on PATH\n");
      }
      return ids.errors;
    }
  },
  {
    // Raw check output is never committed (I-76).
    id: "secrets", // check (6)
    level: "file",
    appliesTo: (file) => SECRET_SCAN_DIRS.some((dir) => file.startsWith(`${dir}/`)) && !isRawEvidencePath(file),
    run: async (v, files) => {
      const { root } = v.ctx;
      const targets = files?.map((file) => absoluteOf(root, file));
      return scanSecrets(
        root,
        (dir) =>
          targets?.filter((absolute) => projectPath(dir, absolute) !== undefined) ??
          walkFiles(dir).filter((absolute) => !isRawEvidencePath(reportPath(absolute, root))),
        (absolute) => reportPath(absolute, root)
      );
    }
  },
  {
    // Shares its file set with `warrant fmt` (`core/canon/files.ts`) so the two can never disagree (REQ-KRN-022).
    id: "canonical", // check (7)
    level: "file",
    appliesTo: isWarrantJson,
    run: async (v, files) =>
      files === undefined
        ? checkCanonical(v.ctx.root)
        : checkCanonical(v.ctx.root, files.map((file) => absoluteOf(v.ctx.root, file)))
  },
  {
    // Path rules (ADR-0022); `id` = file name is a semantic rule of the loader.
    id: "rules", // check (8)
    level: "project",
    appliesTo: none,
    run: async (v) => checkRuleScope(v.loaded.rules)
  },
  {
    // Stable ids against HEAD (D-18).
    id: "ids-immutable", // check (9)
    level: "file",
    appliesTo: (file) => isOpenspecMarkdown(file) && !file.startsWith("openspec/changes/archive/"),
    run: async (v, files) => {
      if (files !== undefined) return checkImmutableFiles(v.ctx, v.records(), files);
      const immutable = await checkImmutableIds(v.ctx, v.records());
      if (immutable.skipped !== undefined) {
        v.ctx.warn(`validate: check (9) stable ids against HEAD skipped: ${immutable.skipped}\n`);
      }
      return immutable.errors;
    }
  },
  {
    // Targets of amends / supersedes (ADR-0021).
    id: "links", // check (10)
    level: "project",
    appliesTo: none,
    run: async (v) => checkLinkTargets(v.records())
  },
  {
    // Waiver semantics; an expired ACTIVE waiver is a warning only.
    id: "waivers", // check (11)
    level: "project",
    appliesTo: none,
    run: async (v) => {
      const waivers = checkWaivers(v.ctx.root, v.loaded, v.records(), v.ctx.clock.today());
      for (const line of waivers.warnings) v.ctx.warn(line);
      return waivers.errors;
    }
  },
  {
    // Evidence records and manifests, second step of D-13.
    id: "evidence", // check (12)
    level: "project",
    appliesTo: none,
    run: async (v) => checkEvidence(v.ctx.root, v.loaded)
  },
  {
    // Dangling REQ/SCN references, against the ids check (5) scanned.
    id: "dangling", // check (13)
    level: "file",
    appliesTo: (file, config) =>
      /^openspec\/changes\/(?!archive\/)[^/]+\/tasks\.md$/.test(file) || underTests(file, config),
    run: async (v, files) =>
      files === undefined
        ? checkDangling(v.ctx.root, v.loaded.config, v.declared)
        : checkDangling(v.ctx.root, v.loaded.config, v.scan().ids, files.map((file) => absoluteOf(v.ctx.root, file)))
  }
];

/** Runs `checks` in order over `v`, collecting every finding. */
export async function runChecks(v: ValidateRun, checks: readonly ValidateCheck[] = VALIDATE_CHECKS): Promise<CliError[]> {
  const errors: CliError[] = [];
  for (const check of checks) errors.push(...(await check.run(v)));
  return errors;
}

/** Why `validate --files` did not check a path (REQ-KRN-032). */
export type SkipReason = "no-check" | "missing" | "outside";

export interface FileChecks {
  errors: CliError[];
  /** Project paths at least one check read, sorted. */
  checked: string[];
  /** The other paths, sorted: the project path, or the path as given when it lies outside. */
  skipped: Array<{ path: string; reason: SkipReason }>;
}

/**
 * `validate --files` (REQ-KRN-032, ADR-0019): each `file` check of `checks`
 * whose `appliesTo` accepts one of `paths` runs over the paths it accepts.
 * A path is taken from the project root; one outside the project, missing
 * from the disk or accepted by no check is not read.
 */
export async function runFileChecks(
  v: ValidateRun,
  paths: readonly string[],
  checks: readonly ValidateCheck[] = VALIDATE_CHECKS
): Promise<FileChecks> {
  const { root } = v.ctx;
  const skipped = new Map<string, SkipReason>();
  const present: string[] = [];
  for (const given of paths) {
    const file = projectPath(root, path.resolve(root, given));
    if (file === undefined) {
      skipped.set(given, "outside");
      continue;
    }
    if (present.includes(file) || skipped.has(file)) continue;
    let isFile: boolean;
    try {
      isFile = statSync(absoluteOf(root, file)).isFile();
    } catch {
      skipped.set(file, "missing");
      continue;
    }
    if (isFile) present.push(file);
    else skipped.set(file, "no-check"); // a directory: no check reads one
  }

  const errors: CliError[] = [];
  const checked = new Set<string>();
  for (const check of checks) {
    if (check.level !== "file") continue;
    const files = present.filter((file) => check.appliesTo(file, v.loaded.config));
    if (files.length === 0) continue;
    for (const file of files) checked.add(file);
    errors.push(...(await check.run(v, files)));
  }
  for (const file of present) if (!checked.has(file)) skipped.set(file, "no-check");

  const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return {
    errors,
    checked: [...checked].sort(byPath),
    skipped: [...skipped.entries()].sort((a, b) => byPath(a[0], b[0])).map(([file, reason]) => ({ path: file, reason }))
  };
}
