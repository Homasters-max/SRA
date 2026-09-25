/**
 * `warrant guard` (REQ-ENF-004, ADR-0018 п. 2): the normalised event on stdin
 * — `{ phase: pre|post, action: edit|shell|other, paths[], argv?, cwd }` —
 * and the decision in `data{ decision, reason?, hints[] }`. The decision is
 * data, not an error: exit 0 whatever it is (design §6). The logic lives in
 * `core/guard`; a frontend adapter (`--frontend`, group 8) only translates.
 */
import type { Ctx } from "../core/ctx.js";
import { guard } from "../core/guard/guard.js";
import { success, type CommandResult } from "../io/output.js";

export async function runGuard(ctx: Ctx, input: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  const answer = await guard(ctx, input, env);
  return success({ decision: answer.decision, ...(answer.reason === undefined ? {} : { reason: answer.reason }), hints: answer.hints });
}
