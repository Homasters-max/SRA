/**
 * `warrant check <change> [id...] [--paths <a,b>] [--base <ref>]` (REQ-VER-002,
 * REQ-VER-001, design §2–§7).
 *
 * Runs checks and writes one evidence record per check. Without ids the checks
 * are those whose `produces` meets a `requires_evidence` kind of the gates of
 * the next forward transition from `change_state`. Each check runs its argv
 * without a shell, under the `exclusive` lock when it asks for one and with a
 * timeout that kills the whole process tree; its output is parsed into
 * `evidence_status` and `metrics`, the record goes to
 * `<state>/evidence/<change>/<EVID>.json` and the manifest is rewritten.
 *
 * A failed check (`BUSY`, `CHECK_TIMEOUT`, `CHECK_NOT_CONFIGURED`) does not stop
 * the others; the exit code is the highest of the failures, 0 when every
 * record was written — `NOT_PROVEN` included (P-20).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";

import { writeJsonFile } from "../core/canon/format-json.js";
import { canonicalHash } from "../core/canon/hash.js";
import { acquireLock, lockPath } from "../core/check/lock.js";
import { expandArgv, splitPaths } from "../core/check/placeholders.js";
import { runCommand } from "../core/check/runner.js";
import { EXIT, WarrantError, type CliError, type ExitCode } from "../core/errors.js";
import { attestationFromEnv } from "../core/evidence/attestation.js";
import { buildManifest } from "../core/evidence/manifest.js";
import { findParser, parserNames } from "../core/evidence/parsers/index.js";
import {
  buildCheckRecord,
  collectArtifacts,
  NO_GIT_COMMIT,
  NO_GIT_LIMITATION,
  type EvidenceStatus
} from "../core/evidence/record.js";
import { evidenceDir, listRecordIds, MANIFEST_FILE, projectUri, rawDir, readManifest } from "../core/evidence/store.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { openspecVersion } from "../core/openspec/version.js";
import { LOCK_REL } from "../core/packs/hash.js";
import { loadPacks } from "../core/packs/loader.js";
import type { LoadResult, PackObject } from "../core/packs/types.js";
import { readChangeRecord } from "../core/record/read.js";
import { resolveForProject, type Classification, type EffectivePolicy } from "../core/resolve/index.js";
import { validateFile } from "../core/schemas/semantic.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { CLI_VERSION } from "../version.js";
import { projectRoot as defaultRoot, requireConfigPath } from "./context.js";

// `cross-spawn` is CommonJS with `export =`; the same spawner as `classify` for git.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

export interface CheckOptions {
  /** `--paths a,b`: run `run.scoped_command` over these paths. */
  paths?: string | undefined;
  /** `--base <ref>`: base of `subject.base_commit`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
}

/** Default of `execution.timeout_s` when neither the check nor `warrant.json` sets one (D-17). */
export const DEFAULT_TIMEOUT_S = 1800;

/** Base branch of the default `--base` (design §9: a constant until a failure mode says otherwise). */
export const BASE_BRANCH = "main";

/** The forward chain of 04 §2; `ABANDONED` has no successor. */
const FORWARD = ["PROPOSED", "SPECIFIED", "APPROVED", "IMPLEMENTING", "VERIFYING", "MERGED", "ARCHIVED"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** `<STATE>-><NEXT>` of the next forward transition, or null at the end of the chain. */
export function nextForwardTransition(state: string): string | null {
  const index = (FORWARD as readonly string[]).indexOf(state);
  if (index < 0 || index === FORWARD.length - 1) return null;
  return `${state}->${FORWARD[index + 1] as string}`;
}

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
  const gates = new Map(loaded.objects.filter((o) => o.kind === "gate").map((o) => [o.id, o]));
  const kinds = new Set<string>();
  for (const gateId of policy.gates[transition] ?? []) {
    const gate = gates.get(gateId);
    const required = isPlainObject(gate?.json) ? gate.json["requires_evidence"] : undefined;
    if (!Array.isArray(required)) continue;
    for (const entry of required) {
      if (isPlainObject(entry) && typeof entry["kind"] === "string") kinds.add(entry["kind"]);
    }
  }
  return loaded.objects
    .filter((o) => o.kind === "check" && strings(effectiveCheck(o)["produces"]).some((kind) => kinds.has(kind)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const proc = spawn.sync("git", args, { cwd, encoding: "utf8" });
  return { ok: proc.error == null && proc.status === 0, stdout: (proc.stdout ?? "").trim() };
}

interface GitFacts {
  /** Absolute `git rev-parse --git-common-dir`, or null outside git. */
  commonDir: string | null;
  /** HEAD, or {@link NO_GIT_COMMIT} outside git or before the first commit. */
  commit: string;
  baseCommit?: string;
  limitations: string[];
}

/** The git facts a record needs (design §6, §9); `--base` that does not resolve is `USAGE`. */
function gitFacts(root: string, baseRef: string | undefined): GitFacts {
  const common = git(["rev-parse", "--git-common-dir"], root);
  const head = common.ok ? git(["rev-parse", "--verify", "--quiet", "HEAD"], root) : { ok: false, stdout: "" };
  const facts: GitFacts = {
    commonDir: common.ok && common.stdout !== "" ? path.resolve(root, common.stdout) : null,
    commit: head.ok && head.stdout !== "" ? head.stdout : NO_GIT_COMMIT,
    limitations: []
  };
  if (facts.commit === NO_GIT_COMMIT) facts.limitations.push(NO_GIT_LIMITATION);

  if (baseRef !== undefined) {
    const base =
      facts.commonDir === null
        ? { ok: false, stdout: "" }
        : git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], root);
    if (!base.ok || base.stdout === "") {
      throw new WarrantError("USAGE", `--base ${JSON.stringify(baseRef)} does not name a commit of this repository`);
    }
    facts.baseCommit = base.stdout;
  } else if (facts.commit !== NO_GIT_COMMIT) {
    const base = git(["merge-base", "HEAD", BASE_BRANCH], root);
    if (base.ok && base.stdout !== "") facts.baseCommit = base.stdout;
    else facts.limitations.push(`no base: merge-base(HEAD, ${BASE_BRANCH}) unknown`);
  }
  return facts;
}

/** Everything the per-check step shares. */
interface Context {
  root: string;
  change: string;
  loaded: LoadResult;
  policyHash: string;
  git: GitFacts;
  paths: string[] | undefined;
  env: NodeJS.ProcessEnv;
  warn: (text: string) => void;
  /** Lazily computed `manifest.versions`. */
  versions: () => { warrant: string; openspec: string; lock_hash?: string; effective_policy_hash: string };
}

type CheckOutcome =
  | { ok: true; entry: Record<string, unknown> }
  | { ok: false; entry: Record<string, unknown>; error: WarrantError; holder?: unknown };

function notConfigured(object: PackObject, message: string): CheckOutcome {
  const error = new WarrantError("CHECK_NOT_CONFIGURED", `check ${object.id}: ${message}`, { path: object.path });
  return { ok: false, entry: { id: object.id, error: error.code }, error };
}

/** Runs one check and writes its record; never throws for a check-level failure. */
async function runOne(ctx: Context, object: PackObject): Promise<CheckOutcome> {
  const check = effectiveCheck(object);
  const run = isPlainObject(check["run"]) ? check["run"] : {};
  const command = strings(run["command"]);
  const scoped = strings(run["scoped_command"]);
  if (command.length === 0) {
    return notConfigured(object, "has no run.command; supply one with an override in .warrant/local/checks/");
  }

  const parser = findParser(check["parser"]);
  if (parser === undefined) {
    return notConfigured(object, `parser ${JSON.stringify(check["parser"] ?? null)} is not one of: ${parserNames().join(", ")}`);
  }
  const produces = strings(check["produces"]);
  if (produces.length > 0 && !produces.includes(parser.kind)) {
    return notConfigured(object, `parser ${parser.name} yields ${parser.kind}, but the check produces ${produces.join(", ")}`);
  }

  // A check without `scoped_command` runs in full under --paths: its result
  // does not depend on the paths, so the record is not scoped either.
  const useScoped = ctx.paths !== undefined && scoped.length > 0;
  if (ctx.paths !== undefined && !useScoped) {
    ctx.warn(`check: ${object.id} has no run.scoped_command; running run.command in full\n`);
  }

  const outDir = rawDir(ctx.root, ctx.change, object.id, ctx.env);
  const outRel = path.relative(ctx.root, outDir);
  const outArg = outRel.startsWith("..") || path.isAbsolute(outRel) ? outDir : outRel.split(path.sep).join("/");
  let argv: string[];
  try {
    argv = expandArgv(useScoped ? scoped : command, {
      out: outArg,
      change: ctx.change,
      paths: useScoped ? ctx.paths : undefined
    });
  } catch (thrown) {
    if (!(thrown instanceof WarrantError)) throw thrown;
    const error = new WarrantError(thrown.code, `check ${object.id}: ${thrown.message}`, { path: object.path });
    return { ok: false, entry: { id: object.id, error: error.code }, error };
  }

  const execution = isPlainObject(check["execution"]) ? check["execution"] : {};
  const defaults = isPlainObject(ctx.loaded.config["defaults"]) ? ctx.loaded.config["defaults"] : {};
  const timeoutS =
    typeof execution["timeout_s"] === "number"
      ? execution["timeout_s"]
      : typeof defaults["check_timeout_s"] === "number"
        ? defaults["check_timeout_s"]
        : DEFAULT_TIMEOUT_S;

  let release: (() => void) | undefined;
  if (execution["exclusive"] === true) {
    const where = lockPath(ctx.root, ctx.git.commonDir);
    if (where.warning !== undefined) ctx.warn(where.warning);
    const lock = acquireLock(where.file, {
      pid: process.pid,
      check: object.id,
      started_at: new Date().toISOString(),
      cwd: ctx.root
    });
    if (!lock.ok) {
      const pid = isPlainObject(lock.holder) ? lock.holder["pid"] : undefined;
      const error = new WarrantError(
        "BUSY",
        `check ${object.id}: the exclusive check lock is held${pid === undefined ? "" : ` by pid ${String(pid)}`}; if that process is gone, delete ${where.file}`,
        { path: where.file, exitCode: EXIT.WAIT }
      );
      return { ok: false, entry: { id: object.id, error: error.code }, error, holder: lock.holder };
    }
    release = lock.release;
  }

  let outcome;
  try {
    // `{out}` starts empty: nothing of an earlier run may pass for this one's output.
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    outcome = await runCommand({ argv, cwd: ctx.root, timeoutMs: timeoutS * 1000, captureStdout: parser.readsStdout });
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

  const dir = evidenceDir(ctx.root, ctx.change, ctx.env);
  const file = path.join(dir, `${id}.json`);
  const reported = projectUri(ctx.root, file);
  const checked = validateFile(record, reported);
  if (!checked.ok) {
    throw new WarrantError("INTERNAL", `the record of check ${object.id} does not match its schema: ${checked.errors[0]?.message ?? ""}`);
  }
  mkdirSync(dir, { recursive: true });
  writeJsonFile(file, record);
  writeJsonFile(
    path.join(dir, MANIFEST_FILE),
    buildManifest(readManifest(dir), {
      change: ctx.change,
      commit: ctx.git.commit,
      versions: ctx.versions(),
      evidence: listRecordIds(dir)
    })
  );

  const entry: Record<string, unknown> = {
    id: object.id,
    kind: parser.kind,
    evidence: id,
    evidence_status: status,
    path: reported
  };
  if (parsed.metrics !== undefined) entry["metrics"] = parsed.metrics;
  entry["limitations"] = limitations;
  return { ok: true, entry };
}

/** Version of OpenSpec for the manifest: the binary on PATH, else the lock's; `0.0.0` when neither is known. */
function manifestOpenspecVersion(root: string, lock: Record<string, unknown> | undefined, warn: (text: string) => void): string {
  const onPath = openspecVersion(root);
  if (onPath !== null) return onPath;
  if (typeof lock?.["openspec"] === "string") return lock["openspec"];
  warn("check: OpenSpec version unknown (no `openspec` on PATH, no lock); manifest.versions.openspec is 0.0.0\n");
  return "0.0.0";
}

function readLock(root: string): Record<string, unknown> | undefined {
  const file = path.join(root, ...LOCK_REL.split("/"));
  if (!existsSync(file)) return undefined;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return isPlainObject(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

export async function runCheck(
  change: string,
  ids: string[],
  opts: CheckOptions = {},
  root: string = defaultRoot(),
  env: NodeJS.ProcessEnv = process.env,
  warn: (text: string) => void = (text) => process.stderr.write(text)
): Promise<CommandResult> {
  requireConfigPath(root);
  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);

  const record = readChangeRecord(root, change);
  const resolved = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (resolved.errors.length > 0) return failures(resolved.errors, EXIT.CONFIG, {}, change);
  if (!resolved.result.ok) {
    return failures(
      [{ code: "POLICY_CONFLICT", message: `${change}: ${resolved.result.conflict.message}` }],
      EXIT.WAIT,
      { controller_action: "ESCALATE" },
      change
    );
  }
  const policy = resolved.result.policy;

  // Which checks: the named ones, or those of the next forward transition.
  const checks = new Map(loaded.objects.filter((o) => o.kind === "check").map((o) => [o.id, o]));
  let transition: string | null = null;
  let selected: PackObject[];
  if (ids.length > 0) {
    selected = [];
    for (const id of [...new Set(ids)]) {
      const object = checks.get(id);
      if (object === undefined) {
        throw new WarrantError("USAGE", `no check "${id}" in the enabled packs or .warrant/local/`);
      }
      selected.push(object);
    }
  } else {
    transition = nextForwardTransition(String(record["change_state"]));
    selected = transition === null ? [] : checksForTransition(loaded, policy, transition);
  }

  const paths = opts.paths === undefined ? undefined : splitPaths(opts.paths);
  if (paths !== undefined && paths.length === 0) throw new WarrantError("USAGE", "--paths lists no path");

  const facts = gitFacts(root, opts.base);
  let versions: ReturnType<Context["versions"]> | undefined;
  const ctx: Context = {
    root,
    change,
    loaded,
    policyHash: policy.hash,
    git: facts,
    paths,
    env,
    warn,
    versions: () => {
      if (versions !== undefined) return versions;
      const lock = readLock(root);
      versions = {
        warrant: CLI_VERSION,
        openspec: manifestOpenspecVersion(root, lock, warn),
        ...(lock === undefined ? {} : { lock_hash: canonicalHash(lock) }),
        effective_policy_hash: policy.hash
      };
      return versions;
    }
  };

  const entries: Record<string, unknown>[] = [];
  const errors: CliError[] = [];
  let exitCode: ExitCode = EXIT.OK;
  let holder: unknown;
  for (const object of selected) {
    const outcome = await runOne(ctx, object);
    entries.push(outcome.entry);
    if (outcome.ok) continue;
    errors.push(outcome.error.toCliError());
    exitCode = Math.max(exitCode, outcome.error.exitCode) as ExitCode;
    if (outcome.holder !== undefined && holder === undefined) holder = outcome.holder;
  }

  const data: Record<string, unknown> = { transition, checks: entries };
  if (holder !== undefined) data["holder"] = holder;
  if (errors.length > 0) return failures(errors, exitCode, data, change);
  return success(data, change);
}
