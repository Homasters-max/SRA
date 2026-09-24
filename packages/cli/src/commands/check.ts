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
 * A check with `execution.local: "scoped-only"` runs outside CI (attestation
 * `none`) only with `--paths`; without them it is `CHECK_LOCAL_FORBIDDEN` —
 * nothing started, no lock, no record (ADR-0017 п. 4, phase-3b design §7).
 *
 * A failed check (`BUSY`, `CHECK_TIMEOUT`, `CHECK_NOT_CONFIGURED`,
 * `CHECK_LOCAL_FORBIDDEN`) does not stop the others; the exit code is the
 * highest of the failures, 0 when every record was written — `NOT_PROVEN`
 * included (P-20).
 */
import { checksForTransition, executeChecks } from "../core/check/execute.js";
import { splitPaths } from "../core/check/placeholders.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { readGitFacts } from "../core/git/facts.js";
import { loadPacks } from "../core/packs/loader.js";
import type { PackObject } from "../core/packs/types.js";
import { nextForwardTransition } from "../core/record/lifecycle.js";
import { readChangeRecord } from "../core/record/read.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface CheckOptions {
  /** `--paths a,b`: run `run.scoped_command` over these paths. */
  paths?: string | undefined;
  /** `--base <ref>`: base of `subject.base_commit`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
}

export async function runCheck(
  ctx: Ctx,
  change: string,
  ids: string[],
  opts: CheckOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  const { root } = ctx;
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

  const run = await executeChecks({ ctx, change, loaded, policy, selected, facts: await readGitFacts(ctx, opts.base), paths, env });
  const { entries, errors, exitCode, holder } = run;
  const data: Record<string, unknown> = { transition, checks: entries };
  if (holder !== undefined) data["holder"] = holder;
  if (errors.length > 0) return failures(errors, exitCode, data, change);
  return success(data, change);
}
