/**
 * `warrant validate` at level `app` (A-21): the command on the project of a
 * builder, in the test process through `invoke`. The helpers are registered in
 * `test_helpers` of `architecture.json`: a test imports them, not a copy.
 */
import { runValidate } from "../../../src/commands/validate.js";
import type { CliError } from "../../../src/core/errors.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "./invoke.js";
import type { ProjectBuilder } from "./project-builder.js";

/** The result of `warrant validate` on the project of `p`. */
export function validate(p: ProjectBuilder): Promise<CommandResult> {
  return invoke(() => runValidate(p.ctx));
}

/** `errors[]` of `warrant validate` on the project of `p`. */
export async function validateErrors(p: ProjectBuilder): Promise<CliError[]> {
  return (await validate(p)).errors;
}

/** Error codes of a result, in order. */
export function errorCodes(run: CommandResult): string[] {
  return run.errors.map((e) => e.code);
}
