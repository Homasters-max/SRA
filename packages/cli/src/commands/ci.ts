/**
 * `warrant ci [--dry-run]` (REQ-VER-011, design §4 of phase-4c): the verdict of
 * a pull request in CI on the result of its merge. Never commits or pushes
 * (ADR-0010 п. 1). The kind of the pull request and its Change come from the
 * record in the diff (`core/ci/kind.ts`); everything the rules require is read
 * from the base, HEAD^1 (`core/ci/base.ts`, I-171); the rules — `core/ci/judge.ts`.
 *
 * Exit code — the class of `errors[]` (REQ-KRN-003): 0 — no violation; 1 — a
 * violation of the pull request; 2 — `POLICY_CONFLICT`; 3 — a broken
 * configuration, `USAGE`, `FORGE_ACCESS`; 4 — a failure a retry may get past
 * (`BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`). A gate `BLOCKED` by a failed
 * check gives no `GATE_NOT_PASSED` (design D6): the failure chooses the code.
 * The controller's action does not enter it: CI has no "wait", only "do not merge".
 *
 * `--dry-run` is a plan only: the kind, the Change, the checks and
 * `data.would_write[]`, without running checks or asking the forge.
 *
 * `--no-record` (REQ-VER-017) is the same verdict with nothing left written:
 * every write goes through {@link restoringWrites} and is put back after the
 * last check, on an exception and on a signal; `data.no_record: true` and
 * `data.not_restored[]` in every output.
 *
 * `warrant ci fetch <pr>` — the local step of an archive-PR (`core/ci/fetch.ts`).
 */
import { fileURLToPath } from "node:url";

import { withBase } from "../core/ci/base.js";
import { fetchCiEvidence } from "../core/ci/fetch.js";
import { judgePullRequest, planPullRequest } from "../core/ci/judge.js";
import { readCiSubject } from "../core/ci/kind.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import { absolutePath } from "../core/fs.js";
import { restoringWrites } from "../core/writes.js";
import { failure, failures, resultFromThrown, success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun } from "./context.js";

export interface CiOptions {
  dryRun?: boolean | undefined;
  noRecord?: boolean | undefined;
}

/** `result` with `data.no_record: true` and `data.not_restored[]` (REQ-VER-017). */
function noRecordOf(result: CommandResult, notRestored: string[] = []): CommandResult {
  return { ...result, data: { ...result.data, no_record: true, not_restored: notRestored } };
}

/** Judges the pull request whose merge is HEAD; with `noRecord` nothing written stays (REQ-VER-017). */
export async function runCi(ctx: Ctx, opts: CiOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  if (opts.noRecord !== true) return judge(ctx, opts, env);
  if (opts.dryRun === true) {
    return noRecordOf(failure(new WarrantError("USAGE", "--no-record runs the checks and --dry-run does not: pass one of them", { hint: "warrant ci --no-record" })));
  }
  if (env["GITHUB_ACTIONS"] === "true") {
    return noRecordOf(
      failure(new WarrantError("USAGE", "--no-record is for a local verdict: in GitHub Actions warrant ci records the evidence of the artifact and of ci fetch", { hint: "warrant ci" }))
    );
  }
  const writes = restoringWrites((target) => (target.startsWith("file:") ? fileURLToPath(target) : absolutePath(ctx.root, target)));
  const unregister = ctx.signals.onInterrupt(() => {
    for (const target of writes.restore()) ctx.warn(`warrant ci --no-record: not restored: ${target}\n`);
  });
  let result: CommandResult;
  try {
    result = await judge({ ...ctx, writes }, opts, env);
  } catch (thrown) {
    result = resultFromThrown(thrown);
  } finally {
    unregister();
  }
  return noRecordOf(result, writes.restore());
}

async function judge(ctx: Ctx, opts: CiOptions, env: NodeJS.ProcessEnv): Promise<CommandResult> {
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
