/**
 * A command called in the test process as `src/bin/warrant.ts` calls it: what
 * the runner throws becomes the failing result, with the exit code of the
 * catalogued error (`resultFromThrown`). The envelope printed by the binary is
 * `toEnvelope(command, result)`; its fields `ok`, `data` and `errors` are those
 * of the result, the exit code is `result.exitCode`.
 */
import { resultFromThrown, type CommandResult } from "../../../src/io/output.js";

export async function invoke(call: () => Promise<CommandResult> | CommandResult): Promise<CommandResult> {
  try {
    return await call();
  } catch (thrown) {
    return resultFromThrown(thrown);
  }
}
