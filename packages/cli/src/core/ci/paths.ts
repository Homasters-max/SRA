/**
 * Path rules of `warrant ci` (REQ-VER-011 «Пути», «Правила по виду», N37, N47,
 * N48): they judge the pull request as a whole, whatever gate `scope-valid`
 * says of its transition. The own state of the Change is allowed everywhere;
 * `openspec/specs/**` only in an archive-PR with a new `ARCHIVED` (equality with
 * a repeated archive — `archive.ts`). The law — `paths.*` and policy paths — is the
 * base's (I-171).
 */
import type { Ctx } from "../ctx.js";
import { cliError, type CliError } from "../errors.js";
import { pathMatcher } from "../glob.js";
import { isPlainObject } from "../json.js";
import { LOCK_REL } from "../packs/hash.js";
import { codeScope } from "../run/scope.js";
import { otherState, ownState } from "../run/state.js";
import { basePolicyPaths, changedBundledPacks, type BaseContext } from "./base.js";
import { jsonAt, type CiSubject } from "./kind.js";
import type { NewTransition } from "./record.js";

export interface Skipped {
  rule: string;
  reason: string;
}

export interface PathJudgement {
  errors: CliError[];
  skipped: Skipped[];
}

/** Main specs: changed only by an archive-PR (R-16). */
const SPECS = "openspec/specs/";

/** State of any Change a pull request without a Change must not touch (N47, kind `none`). */
const CHANGE_STATE_PATHS = ["openspec/changes/**", ".warrant/changes/**", ".warrant/evidence/**", ".warrant/runs/**"];

const WAIVER_RE = /^\.warrant\/waivers\/[^/]+\.json$/;

function violation(p: string, why: string): CliError {
  return cliError("SCOPE_VIOLATION", `${p}: ${why}`, { path: p });
}

/** Every path the diff names: both sides of a rename. */
function diffPaths(subject: CiSubject): string[] {
  return [...new Set(subject.diff.flatMap((e) => (e.from === undefined ? [e.path] : [e.path, e.from])))].sort();
}

/** Waiver files of the diff whose `change` is `change` on HEAD (or on the base, when HEAD deleted them). */
async function ownWaivers(ctx: Pick<Ctx, "git">, subject: CiSubject, change: string, paths: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of paths.filter((x) => WAIVER_RE.test(x))) {
    const json = (await jsonAt(ctx, subject.merge, p)) ?? (await jsonAt(ctx, subject.base, p));
    if (isPlainObject(json) && json["change"] === change) out.add(p);
  }
  return out;
}

/**
 * The path rules of the kind of `subject`. `transitions` — the new transitions
 * of its record (an archive-PR may touch main specs only with `ARCHIVED`).
 */
export async function judgePaths(
  ctx: Pick<Ctx, "root" | "git">,
  subject: CiSubject,
  base: BaseContext,
  transitions: readonly NewTransition[],
  env: NodeJS.ProcessEnv
): Promise<PathJudgement> {
  const out: PathJudgement = { errors: [], skipped: [] };
  const paths = diffPaths(subject);
  const change = subject.change;
  const own = change === undefined ? (): boolean => false : ownState(ctx.root, change, env);
  const archived = subject.kind === "archive" && transitions.some((t) => t.to === "ARCHIVED");
  const policy = pathMatcher(basePolicyPaths(base));

  const judged = new Set<string>();
  for (const p of paths) {
    if (p.startsWith(SPECS) && !own(p) && !archived) {
      out.errors.push(violation(p, "main specs change only in an archive-PR with a new ARCHIVED (R-16)"));
      judged.add(p);
    }
  }
  const rest = paths.filter((p) => !judged.has(p) && !p.startsWith(SPECS));

  // The law itself: a bundled pack the lock of the base does not hold (I-179); an impl-PR answers by its classification.
  if (subject.kind !== "impl") {
    for (const id of changedBundledPacks(base)) {
      out.errors.push(violation(LOCK_REL, `bundled pack ${id} differs from the lock of the base: the law changes only in the impl-PR of a factory-change Change (ADR-0038, I-179)`));
    }
  }

  if (subject.kind === "none") {
    const state = pathMatcher(CHANGE_STATE_PATHS);
    for (const p of rest) {
      if (state(p)) out.errors.push(violation(p, "the state and artifacts of a Change change only in a pull request of that Change"));
      else if (policy(p)) out.errors.push(violation(p, "a policy path (factory-change) changes only in a pull request of a Change"));
    }
    return out;
  }
  if (change === undefined || subject.kind === "impl") return out;

  if (subject.kind === "abandon") {
    const dir = `openspec/changes/${change}/`;
    const deleted = new Set(subject.diff.filter((e) => e.status === "D").map((e) => e.path));
    for (const p of rest) {
      if (own(p) || (p.startsWith(dir) && deleted.has(p))) continue;
      out.errors.push(violation(p, `an abandon-PR holds only the own state of ${change} and the removal of ${dir}**`));
    }
    return out;
  }

  // spec and archive: N47, waivers of the Change allowed (N48).
  const code = codeScope(base.loaded.config);
  const isCode = code.length === 0 ? (): boolean => false : pathMatcher(code);
  if (code.length === 0) out.skipped.push({ rule: "code", reason: "paths.src and paths.tests are not set in warrant.json of the base" });
  const other = otherState(ctx.root, env);
  const waivers = await ownWaivers(ctx, subject, change, rest);
  const archiveDir = new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${change.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);
  for (const p of rest) {
    if (own(p)) continue;
    const changeDir = /^openspec\/changes\/([^/]+)\//.exec(p)?.[1];
    if (isCode(p)) out.errors.push(violation(p, "code and tests change in the impl-PR (paths.src, paths.tests of the base)"));
    else if (changeDir !== undefined && changeDir !== change && !(subject.kind === "archive" && archiveDir.test(p))) {
      out.errors.push(violation(p, `the artifacts of another Change (${changeDir})`));
    } else if (other(p)) out.errors.push(violation(p, "the state of another Change"));
    else if (policy(p) && !waivers.has(p)) out.errors.push(violation(p, "a policy path (factory-change of the base) outside the own state and waivers of the Change"));
  }
  return out;
}
