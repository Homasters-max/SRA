import { existsSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import { resultFromThrown, type CommandResult } from "../io/output.js";

export const WARRANT_DIR = ".warrant";
export const CONFIG_FILE = "warrant.json";

/** Project root = current working directory; the CLI never walks upward, so output paths stay relative to it. */
export function projectRoot(): string {
  return process.cwd();
}

/** Throws CONFIG_MISSING when `.warrant/warrant.json` is absent (SCN-KRN-007). */
export function requireConfigPath(root: string = projectRoot()): string {
  const configPath = path.join(root, WARRANT_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new WarrantError("CONFIG_MISSING", `${WARRANT_DIR}/${CONFIG_FILE} not found in ${root}`, {
      path: `${WARRANT_DIR}/${CONFIG_FILE}`
    });
  }
  return configPath;
}

/**
 * A command that changes state, under `--dry-run` (REQ-KRN-034): the same
 * result — refusals and thrown errors included, with the same exit code — and
 * `data.dry_run: true`, `data.would_write[]` from `ctx.writes`. Without
 * `--dry-run` the result is the command's own.
 */
export async function withDryRun(ctx: Ctx, run: () => Promise<CommandResult> | CommandResult): Promise<CommandResult> {
  if (!ctx.writes.dryRun) return run();
  let result: CommandResult;
  try {
    result = await run();
  } catch (thrown) {
    // As `bin` turns a thrown error into the envelope: without `change`.
    result = resultFromThrown(thrown);
  }
  return { ...result, data: { ...result.data, dry_run: true, would_write: ctx.writes.collected() } };
}
