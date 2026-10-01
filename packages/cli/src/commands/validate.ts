/**
 * `warrant validate` — checks (1)–(14) of REQ-KRN-021, run from the registry
 * `core/validate/registry.ts` (A-9): which checks there are, their order and
 * what each reads live there.
 *
 * The command loads the project, runs every check, sorts the findings and
 * reports `data.checked` and `data.skipped`. With `--files <a,b>`
 * (REQ-KRN-032, ADR-0019) it runs only the checks of one file over those
 * paths: `data.checked[]` — the paths read, `data.skipped[]` — the others with
 * a `reason`; a finding has the code and the exit code (3) of the full
 * `validate` (REQ-KRN-032, exit-contract D3).
 */
import { splitPaths } from "../core/check/placeholders.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError, type CliError } from "../core/errors.js";
import { loadPacks } from "../core/packs/loader.js";
import { runChecks, runFileChecks, validateRun } from "../core/validate/registry.js";
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

export interface ValidateOptions {
  /** `--files a,b`: the checks of one file over these paths only. */
  files?: string | undefined;
}

export async function runValidate(ctx: Ctx, opts: ValidateOptions = {}): Promise<CommandResult> {
  if (opts.files !== undefined) return runValidateFiles(ctx, opts.files);
  const loaded = loadPacks(ctx.root);
  const v = validateRun(ctx, loaded);
  const errors = await runChecks(v);

  const data = {
    checked: { files: v.checked.size, packs: loaded.packs.map((p) => p.id) },
    skipped: v.skipped
  };

  if (errors.length === 0) return success(data);
  return failures(sortErrors(errors), data);
}

async function runValidateFiles(ctx: Ctx, raw: string): Promise<CommandResult> {
  const paths = splitPaths(raw);
  if (paths.length === 0) {
    throw new WarrantError("USAGE", "--files lists no path", { hint: "pass comma-separated paths: warrant validate --files <a,b>" });
  }
  const v = validateRun(ctx, loadPacks(ctx.root));
  const { errors, checked, skipped } = await runFileChecks(v, paths);
  const data = { checked, skipped };
  if (errors.length === 0) return success(data);
  return failures(sortErrors(errors), data);
}
