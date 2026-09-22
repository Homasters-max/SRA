import { WarrantError } from "../core/errors.js";
import { type CommandResult, failure } from "../io/output.js";

/** Placeholder for commands not yet implemented in the current task group. */
export function notImplemented(command: string): CommandResult {
  return failure(new WarrantError("INTERNAL", `command '${command}' is not implemented yet`));
}
