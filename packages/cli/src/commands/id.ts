/**
 * `warrant id` (REQ-KRN-024): allocation and renumbering of stable ids.
 */
import { loadConfig } from "../core/config.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import { allocateSpecLevel, allocateUlid, allocateWaiver, isSpecLevelPrefix, isUlidPrefix } from "../core/ids/allocate.js";
import { renumber } from "../core/ids/renumber.js";
import { success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

const USAGE = "usage: warrant id <REQ|SCN|TASK|UNK|ASM> <AREA> | warrant id <EVID|RUN|WAV> | warrant id renumber <old> <new> --change <name>";

export function runId(ctx: Ctx, args: string[], opts: { change?: string } = {}): CommandResult {
  const { root } = ctx;
  // Every `id` form needs the project config (SCN-KRN-007).
  requireConfigPath(root);

  const head = args[0];
  if (head === undefined) throw new WarrantError("USAGE", USAGE);

  if (head === "renumber") {
    const [, oldId, newId, ...rest] = args;
    if (oldId === undefined || newId === undefined || rest.length > 0) throw new WarrantError("USAGE", USAGE);
    const change = opts.change;
    if (change === undefined || change === "") {
      throw new WarrantError("USAGE", "warrant id renumber requires --change <name>");
    }
    const result = renumber(root, loadConfig(root), oldId, newId, change);
    return success({ old: result.old, new: result.new, rewritten: result.rewritten }, change);
  }

  if (isSpecLevelPrefix(head)) {
    const area = args[1];
    if (area === undefined || args.length > 2) throw new WarrantError("USAGE", USAGE);
    return success({ id: allocateSpecLevel(root, head, area), prefix: head, area });
  }

  if (isUlidPrefix(head)) {
    if (args.length > 1) throw new WarrantError("USAGE", USAGE);
    return success({ id: allocateUlid(head), prefix: head });
  }

  if (head === "WAV") {
    if (args.length > 1) throw new WarrantError("USAGE", USAGE);
    const year = new Date().getUTCFullYear();
    return success({ id: allocateWaiver(root, year), prefix: "WAV", year });
  }

  throw new WarrantError("USAGE", `unknown id kind "${head}". ${USAGE}`);
}
