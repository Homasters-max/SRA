/**
 * `warrant validate` — checks (1)–(13) of REQ-KRN-021, run from the registry
 * `core/validate/registry.ts` (A-9): which checks there are, their order and
 * what each reads live there.
 *
 * The command loads the project, runs every check, sorts the findings and
 * reports `data.checked` and `data.skipped`.
 */
import type { Ctx } from "../core/ctx.js";
import { EXIT, type CliError } from "../core/errors.js";
import { loadPacks } from "../core/packs/loader.js";
import { runChecks, validateRun } from "../core/validate/registry.js";
import { failures, success, type CommandResult } from "../io/output.js";

function sortErrors(errors: CliError[]): CliError[] {
  return [...errors].sort((a, b) => {
    const pa = a.path ?? "";
    const pb = b.path ?? "";
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

export async function runValidate(ctx: Ctx): Promise<CommandResult> {
  const loaded = loadPacks(ctx.root);
  const v = validateRun(ctx, loaded);
  const errors = await runChecks(v);

  const data = {
    checked: { files: v.checked.size, packs: loaded.packs.map((p) => p.id) },
    skipped: v.skipped
  };

  if (errors.length === 0) return success(data);
  return failures(sortErrors(errors), EXIT.CONFIG, data);
}
