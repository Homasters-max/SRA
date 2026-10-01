/**
 * `warrant ci [--dry-run]` (REQ-VER-011, design §4 of phase-4c): the verdict of
 * a pull request in CI on the result of its merge. Never commits or pushes
 * (ADR-0010 п. 1). The kind of the pull request and its Change come from the
 * record in the diff (`core/ci/kind.ts`); everything the rules require is read
 * from the base, HEAD^1 (`core/ci/base.ts`, I-171); the rules — `core/ci/judge.ts`.
 *
 * Exit code — the class of `errors[]` (REQ-KRN-003): 0 — no violation; 1 — a
 * violation of the pull request; 3 — a broken configuration, `USAGE`; 4 — a
 * failure a retry may get past (`BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`).
 * The controller's action does not enter it: CI has no "wait", only "do not merge".
 *
 * `--dry-run` is a plan only: the kind, the Change, the checks and
 * `data.would_write[]`, without running checks or asking the forge.
 *
 * `warrant ci fetch <pr>` — the local step of an archive-PR (`core/ci/fetch.ts`).
 */
import { withBase } from "../core/ci/base.js";
import { fetchCiEvidence } from "../core/ci/fetch.js";
import { judgePullRequest, planPullRequest } from "../core/ci/judge.js";
import { readCiSubject } from "../core/ci/kind.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun } from "./context.js";

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
    return failures(subject.errors, { ...data, findings: [], skipped: [] }, change);
  }

  return withBase(ctx, subject.base, async (base) => {
    if (base.loaded.errors.length > 0) return failures(base.loaded.errors, { kind: subject.kind }, change);
    const verdict = opts.dryRun === true ? planPullRequest(ctx, subject, base, env) : await judgePullRequest(ctx, subject, base, env);
    return verdict.errors.length === 0 ? success(verdict.data, change) : failures(verdict.errors, verdict.data, change);
  });
}

/**
 * `warrant ci fetch <pr> [--dry-run]` (REQ-VER-012): the CI evidence of the
 * merged impl-PR `<pr>` into `.warrant/evidence/<change>/` for the archive-PR.
 * Exit code — the class of `errors[]`: 0 — imported (or already present); else nothing written.
 * `--dry-run` chooses the run and prints `data.would_write[]` without writing.
 */
export async function runCiFetch(ctx: Ctx, pr: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  return withDryRun(ctx, async () => {
    const verdict = await fetchCiEvidence(ctx, pr, env);
    return verdict.errors.length === 0 ? success(verdict.data, verdict.change) : failures(verdict.errors, verdict.data, verdict.change);
  });
}
