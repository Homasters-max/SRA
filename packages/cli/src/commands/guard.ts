/**
 * `warrant guard` (REQ-ENF-004, ADR-0018 п. 2): the normalised event on stdin
 * — `{ phase: pre|post, action: edit|shell|other, paths[], argv?, cwd }` —
 * and the decision in `data{ decision, reason?, hints[] }`. The decision is
 * data, not an error: exit 0 whatever it is (design §6). The logic lives in
 * `core/guard`; with `--frontend <name>` (REQ-ENF-005) an adapter of the port
 * `core/ports/frontend.ts` translates the native hook input and the answer.
 */
import type { Ctx } from "../core/ctx.js";
import { crashDecision, guard, guardFrontend } from "../core/guard/guard.js";
import type { FrontendAdapter, FrontendResponse, GuardResult } from "../core/ports/frontend.js";
import { success, type CommandResult } from "../io/output.js";

function decision(answer: GuardResult): CommandResult {
  return success({ decision: answer.decision, ...(answer.reason === undefined ? {} : { reason: answer.reason }), hints: answer.hints });
}

export async function runGuard(ctx: Ctx, input: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return decision(await guard(ctx, input, env));
}

/**
 * The result of `warrant guard` on an exception nothing caught (exit-contract
 * D9, REQ-ENF-004): `deny` in `pre` or an unknown phase, `allow` in `post`; exit 0.
 */
export function runGuardCrash(input: string | undefined, thrown: unknown): CommandResult {
  return decision(crashDecision(input, thrown));
}

/** `warrant guard --frontend <name>`: the native answer of `adapter`, not the envelope (REQ-ENF-005). */
export async function runGuardFrontend(
  ctx: Ctx,
  adapter: FrontendAdapter,
  input: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<FrontendResponse> {
  return guardFrontend(ctx, adapter, input, env);
}
