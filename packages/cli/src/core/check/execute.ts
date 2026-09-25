/**
 * Running checks (REQ-VER-002, REQ-VER-001, design §2–§7): which checks a
 * transition asks for, and one run of a batch of them — argv without a shell,
 * the `exclusive` lock, the timeout, the parser, one evidence record per check.
 * Shared by `check`, `verify` and `archive`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Ctx } from "../ctx.js";
import { EXIT, WarrantError, type CliError, type ExitCode } from "../errors.js";
import { attestationFromEnv } from "../evidence/attestation.js";
import type { ManifestVersions } from "../evidence/manifest.js";
import { findParser, parserNames } from "../evidence/parsers/index.js";
import { buildCheckRecord, collectArtifacts, type EvidenceStatus } from "../evidence/record.js";
import { rawDir } from "../evidence/store.js";
import { manifestVersions, storeRecord } from "../evidence/write.js";
import { projectPath, projectUri } from "../fs.js";
import type { GitFacts } from "../git/facts.js";
import { allocateUlid } from "../ids/allocate.js";
import { isPlainObject, strings } from "../json.js";
import { gateDefinitions, packObjects } from "../packs/objects.js";
import type { LoadResult, PackObject } from "../packs/types.js";
import type { EffectivePolicy } from "../resolve/index.js";
import type { PendingRecord } from "../evidence/store.js";
import { acquireLock, lockPath } from "./lock.js";
import { expandArgv } from "./placeholders.js";

/** Default of `execution.timeout_s` when neither the check nor `warrant.json` sets one (D-17). */
export const DEFAULT_TIMEOUT_S = 1800;

/**
 * The check document in force: a project-local override replaces the pack
 * object (08 §4), and the fields it leaves out are the pack's (`produces`,
 * `parser`, …), so an override that only supplies `run` still says what it
 * produces and how its output is read.
 */
export function effectiveCheck(object: PackObject): Record<string, unknown> {
  const own = isPlainObject(object.json) ? object.json : {};
  if (object.overridden === undefined || !isPlainObject(object.overridden.json)) return own;
  const merged: Record<string, unknown> = { ...object.overridden.json, ...own };
  delete merged["overrides"];
  return merged;
}

/**
 * Checks of a transition: those whose `produces` meets a `requires_evidence`
 * kind of the transition's gates in the effective policy, sorted by id.
 */
export function checksForTransition(loaded: LoadResult, policy: EffectivePolicy, transition: string): PackObject[] {
  const gates = gateDefinitions(loaded);
  const kinds = new Set<string>();
  for (const gateId of policy.gates[transition] ?? []) {
    const required = gates.get(gateId)?.["requires_evidence"];
    if (!Array.isArray(required)) continue;
    for (const entry of required) {
      if (isPlainObject(entry) && typeof entry["kind"] === "string") kinds.add(entry["kind"]);
    }
  }
  return packObjects(loaded, "check")
    .filter((o) => strings(effectiveCheck(o)["produces"]).some((kind) => kinds.has(kind)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Everything the per-check step shares. */
interface Context {
  root: string;
  checks: Ctx["checks"];
  signals: Ctx["signals"];
  writes: Ctx["writes"];
  change: string;
  loaded: LoadResult;
  policyHash: string;
  git: GitFacts;
  paths: string[] | undefined;
  env: NodeJS.ProcessEnv;
  warn: (text: string) => void;
  /** Lazily computed `manifest.versions`. */
  versions: () => Promise<ManifestVersions>;
}

type CheckOutcome =
  | { ok: true; entry: Record<string, unknown>; record: PendingRecord }
  | { ok: false; entry: Record<string, unknown>; error: WarrantError; holder?: unknown };

function notConfigured(object: PackObject, message: string, hint?: string): CheckOutcome {
  const error = new WarrantError("CHECK_NOT_CONFIGURED", `check ${object.id}: ${message}`, {
    path: object.path,
    ...(hint === undefined ? {} : { hint })
  });
  return { ok: false, entry: { id: object.id, error: error.code }, error };
}

/**
 * Runs one check and writes its record; never throws for a check-level
 * failure. Under `--dry-run` the check still runs, but `{out}` is a temporary
 * directory outside the project, removed afterwards, and the raw directory,
 * the record and the manifest are only collected in `ctx.writes` (REQ-KRN-034).
 */
async function runOne(ctx: Context, object: PackObject): Promise<CheckOutcome> {
  if (!ctx.writes.dryRun) return runOneIn(ctx, object, undefined);
  const scratch = mkdtempSync(path.join(tmpdir(), "warrant-dry-run-"));
  try {
    return await runOneIn(ctx, object, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runOneIn(ctx: Context, object: PackObject, scratch: string | undefined): Promise<CheckOutcome> {
  const check = effectiveCheck(object);
  const run = isPlainObject(check["run"]) ? check["run"] : {};
  const command = strings(run["command"]);
  const scoped = strings(run["scoped_command"]);
  if (command.length === 0) {
    return notConfigured(object, "has no run.command", "supply one with an override in .warrant/local/checks/");
  }

  const parser = findParser(check["parser"]);
  if (parser === undefined) {
    return notConfigured(object, `parser ${JSON.stringify(check["parser"] ?? null)} is not one of: ${parserNames().join(", ")}`);
  }
  const produces = strings(check["produces"]);
  if (produces.length > 0 && !produces.includes(parser.kind)) {
    return notConfigured(object, `parser ${parser.name} yields ${parser.kind}, but the check produces ${produces.join(", ")}`);
  }

  // `scoped-only` (design §7): locally — the same notion of "local" as the
  // record's attestation — the check runs only narrowed, never in full: without
  // --paths, and also without run.scoped_command to narrow with (I-116).
  const execution = isPlainObject(check["execution"]) ? check["execution"] : {};
  if (execution["local"] === "scoped-only" && (ctx.paths === undefined || scoped.length === 0) && attestationFromEnv(ctx.env).type === "none") {
    // Without --paths the fix is to pass them; with --paths the check itself cannot narrow — a reason, not a fix.
    const error =
      ctx.paths === undefined
        ? new WarrantError("CHECK_LOCAL_FORBIDDEN", `check ${object.id}: execution.local is "scoped-only": outside CI it runs only narrowed`, {
            path: object.path,
            hint: "pass --paths <a,b>"
          })
        : new WarrantError(
            "CHECK_LOCAL_FORBIDDEN",
            `check ${object.id}: execution.local is "scoped-only": outside CI it runs only narrowed; it has no run.scoped_command to narrow with`,
            { path: object.path }
          );
    return { ok: false, entry: { id: object.id, error: error.code }, error };
  }

  // A check without `scoped_command` runs in full under --paths: its result
  // does not depend on the paths, so the record is not scoped either.
  const useScoped = ctx.paths !== undefined && scoped.length > 0;
  if (ctx.paths !== undefined && !useScoped) {
    ctx.warn(`check: ${object.id} has no run.scoped_command; running run.command in full\n`);
  }

  const raw = rawDir(ctx.root, ctx.change, object.id, ctx.env);
  const outDir = scratch ?? raw;
  const outArg = projectPath(ctx.root, outDir) ?? outDir;
  let argv: string[];
  try {
    argv = expandArgv(useScoped ? scoped : command, {
      out: outArg,
      change: ctx.change,
      paths: useScoped ? ctx.paths : undefined
    });
  } catch (thrown) {
    if (!(thrown instanceof WarrantError)) throw thrown;
    const error = new WarrantError(thrown.code, `check ${object.id}: ${thrown.message}`, {
      path: object.path,
      ...(thrown.hint === undefined ? {} : { hint: thrown.hint })
    });
    return { ok: false, entry: { id: object.id, error: error.code }, error };
  }

  const timeoutS =
    typeof execution["timeout_s"] === "number"
      ? execution["timeout_s"]
      : (ctx.loaded.config.defaults.checkTimeoutS ?? DEFAULT_TIMEOUT_S);

  let release: (() => void) | undefined;
  if (execution["exclusive"] === true) {
    const where = lockPath(ctx.root, ctx.git.commonDir);
    if (where.warning !== undefined) ctx.warn(where.warning);
    const holder = { pid: process.pid, check: object.id, started_at: new Date().toISOString(), cwd: ctx.root };
    const lock = acquireLock(where.file, holder, ctx.signals);
    if (!lock.ok) {
      const pid = isPlainObject(lock.holder) ? lock.holder["pid"] : undefined;
      const error = new WarrantError(
        "BUSY",
        `check ${object.id}: the exclusive check lock is held${pid === undefined ? "" : ` by pid ${String(pid)}`}`,
        { path: where.file, hint: `if that process is gone, delete ${where.file}`, exitCode: EXIT.WAIT }
      );
      return { ok: false, entry: { id: object.id, error: error.code }, error, holder: lock.holder };
    }
    release = lock.release;
  }

  let outcome;
  try {
    // `{out}` starts empty: nothing of an earlier run may pass for this one's output.
    ctx.writes.write(projectUri(ctx.root, raw), () => {
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
    });
    outcome = await ctx.checks.run({ argv, cwd: ctx.root, timeoutMs: timeoutS * 1000, captureStdout: parser.readsStdout });
  } finally {
    release?.();
  }

  if (outcome.kind === "timeout") {
    const error = new WarrantError("CHECK_TIMEOUT", `check ${object.id} did not finish within ${timeoutS} s and was stopped`, {
      path: object.path
    });
    return { ok: false, entry: { id: object.id, error: error.code }, error };
  }
  if (outcome.kind === "spawn-error") {
    return notConfigured(object, `cannot start ${JSON.stringify(argv[0] ?? "")}: ${outcome.message}`);
  }

  if (parser.readsStdout && parser.stdoutFile !== undefined) {
    writeFileSync(path.join(outDir, parser.stdoutFile), outcome.stdout, "utf8");
  }
  const parsed = parser.parse({ outDir, stdout: outcome.stdout });
  let status: EvidenceStatus = parsed.status;
  const limitations = [...ctx.git.limitations, ...parsed.limitations];
  if (useScoped) limitations.unshift(`scoped: ${(ctx.paths ?? []).join(",")}`);
  if (outcome.code !== 0 && status === "PROVEN") {
    // The report says nothing failed, the tool says otherwise: no conclusion.
    status = "INCONCLUSIVE";
    limitations.push(
      outcome.code === null ? `command ended by signal ${String(outcome.signal)}` : `command exited with code ${outcome.code}`
    );
  }

  const id = allocateUlid("EVID");
  const record = buildCheckRecord({
    id,
    change: ctx.change,
    check: {
      id: object.id,
      version: typeof check["version"] === "string" ? check["version"] : "0.0.0",
      level: typeof check["level"] === "string" ? check["level"] : "L1"
    },
    kind: parser.kind,
    status,
    metrics: parsed.metrics,
    limitations,
    commit: ctx.git.commit,
    baseCommit: ctx.git.baseCommit,
    attestation: attestationFromEnv(ctx.env),
    effectivePolicyHash: ctx.policyHash,
    argv,
    artifacts: collectArtifacts(ctx.root, outDir),
    createdAt: new Date().toISOString()
  });

  const reported = storeRecord({
    root: ctx.root,
    writes: ctx.writes,
    change: ctx.change,
    env: ctx.env,
    record,
    commit: ctx.git.commit,
    versions: await ctx.versions(),
    what: `check ${object.id}`
  });

  const entry: Record<string, unknown> = {
    id: object.id,
    kind: parser.kind,
    evidence: id,
    evidence_status: status,
    path: reported
  };
  if (parsed.metrics !== undefined) entry["metrics"] = parsed.metrics;
  entry["limitations"] = limitations;
  return { ok: true, entry, record: { id, json: record } };
}

/** What a batch of checks left behind: one entry per check and the failures among them. */
export interface ChecksRun {
  entries: Record<string, unknown>[];
  errors: CliError[];
  /** Failed checks with the kinds they would have produced (for `verify`, REQ-VER-006). */
  failures: { check: string; code: string; kinds: string[] }[];
  /** Highest exit code of the failures; 0 when every record was written. */
  exitCode: ExitCode;
  /** Holder of the exclusive lock, when a check found it taken. */
  holder?: unknown;
  /** The records of this run — written, or under `--dry-run` only built — for the gates that judge them. */
  records: PendingRecord[];
}

export interface ChecksParams {
  ctx: Ctx;
  change: string;
  loaded: LoadResult;
  policy: EffectivePolicy;
  selected: PackObject[];
  facts: GitFacts;
  paths: string[] | undefined;
  env: NodeJS.ProcessEnv;
}

/**
 * Runs the selected checks one after another and writes their records; shared
 * by `check` and `verify`. A failed check does not stop the others.
 */
export async function executeChecks(params: ChecksParams): Promise<ChecksRun> {
  const { loaded, policy } = params;
  let versions: Promise<ManifestVersions> | undefined;
  const ctx: Context = {
    root: params.ctx.root,
    checks: params.ctx.checks,
    signals: params.ctx.signals,
    writes: params.ctx.writes,
    change: params.change,
    loaded,
    policyHash: policy.hash,
    git: params.facts,
    paths: params.paths,
    env: params.env,
    warn: params.ctx.warn,
    versions: () => (versions ??= manifestVersions(params.ctx, policy.hash))
  };

  const run: ChecksRun = { entries: [], errors: [], failures: [], exitCode: EXIT.OK, records: [] };
  for (const object of params.selected) {
    const outcome = await runOne(ctx, object);
    run.entries.push(outcome.entry);
    if (outcome.ok) {
      run.records.push(outcome.record);
      continue;
    }
    run.errors.push(outcome.error.toCliError());
    run.failures.push({ check: object.id, code: outcome.error.code, kinds: strings(effectiveCheck(object)["produces"]) });
    run.exitCode = Math.max(run.exitCode, outcome.error.exitCode) as ExitCode;
    if (outcome.holder !== undefined && run.holder === undefined) run.holder = outcome.holder;
  }
  return run;
}
