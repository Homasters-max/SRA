/**
 * `warrant ci [--dry-run]` (REQ-VER-011, design §4 of phase-4c): the verdict of
 * a pull request in CI on the result of its merge. Never commits or pushes
 * (ADR-0010 п. 1). The kind of the pull request and its Change come from the
 * record in the diff (`core/ci/kind.ts`); everything the rules require is read
 * from the base, HEAD^1 (`core/ci/base.ts`, I-171); the rules — `core/ci/judge.ts`.
 *
 * Exit codes: 0 — no violation; 1 — a violation of the pull request; 3 — a
 * broken configuration, `USAGE`, a failed check, the forge unreachable
 * (`FORGE_UNAVAILABLE`). The controller's codes are not projected: CI has no
 * "wait", only "do not merge".
 *
 * `--dry-run` is a plan only: the kind, the Change, the checks and
 * `data.would_write[]`, without running checks or asking the forge.
 */
import { withBase } from "../core/ci/base.js";
import { judgePullRequest, planPullRequest } from "../core/ci/judge.js";
import { readCiSubject } from "../core/ci/kind.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface CiOptions {
  dryRun?: boolean | undefined;
}

/** Judges the pull request whose merge is HEAD. */
export async function runCi(ctx: Ctx, opts: CiOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  if (env["WARRANT_STATE_DIR"] !== undefined && env["WARRANT_STATE_DIR"] !== "") {
    throw new WarrantError("USAGE", "warrant ci judges the state committed in .warrant, not WARRANT_STATE_DIR", {
      hint: "unset WARRANT_STATE_DIR for warrant ci"
    });
  }
  const subject = await readCiSubject(ctx);
  const change = subject.change;
  if (subject.errors.length > 0) {
    const data: Record<string, unknown> = { kind: subject.kind };
    if (change !== undefined) data["change"] = change;
    return failures(subject.errors, EXIT.FAIL, { ...data, findings: [], skipped: [] }, change);
  }

  return withBase(ctx, subject.base, async (base) => {
    if (base.loaded.errors.length > 0) return failures(base.loaded.errors, EXIT.CONFIG, { kind: subject.kind }, change);
    const verdict = opts.dryRun === true ? planPullRequest(ctx, subject, base, env) : await judgePullRequest(ctx, subject, base, env);
    return verdict.exitCode === EXIT.OK && verdict.errors.length === 0
      ? success(verdict.data, change)
      : failures(verdict.errors, verdict.exitCode, verdict.data, change);
  });
}
