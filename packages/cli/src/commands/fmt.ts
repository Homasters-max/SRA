/**
 * `warrant fmt [paths...] [--check]` — the canonical form of WARRANT JSON
 * files (REQ-KRN-022, design D-3).
 *
 * With no arguments the command formats every `*.json` under `.warrant/**`
 * except `.warrant/schemas/**` (decision I-4). Explicit paths may be files or
 * directories and are taken relative to the project root; they are formatted
 * even when the project has no `.warrant/`, because `fmt` is a text tool and
 * needs no configuration. Only the default file set does: without `.warrant/`
 * there is nothing to default to, so that case is `CONFIG_MISSING` (the same
 * answer `validate` gives, SCN-KRN-007).
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkFile, canonicalTargets, WARRANT_DIR } from "../core/canon/files.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { reportPath, walkFiles } from "../core/packs/loader.js";
import { failures, success, type CommandResult } from "../io/output.js";

export interface FmtOptions {
  /** `--check`: report differences without writing. */
  check?: boolean | undefined;
}

/** Resolves the arguments into the list of files to format, collecting what cannot be resolved. */
function targets(paths: string[], root: string, errors: CliError[]): string[] {
  if (paths.length === 0) {
    if (!existsSync(path.join(root, WARRANT_DIR))) {
      throw new WarrantError("CONFIG_MISSING", `${WARRANT_DIR}/ not found in ${root}; pass explicit paths to format`, {
        path: WARRANT_DIR
      });
    }
    return canonicalTargets(root);
  }

  const out: string[] = [];
  for (const given of paths) {
    const absolute = path.resolve(root, given);
    if (!existsSync(absolute)) {
      errors.push({ code: "CONFIG_MISSING", message: "path does not exist", path: reportPath(absolute, root) });
      continue;
    }
    if (statSync(absolute).isDirectory()) {
      // An explicit directory is taken at face value: nothing is excluded from it.
      out.push(...walkFiles(absolute).filter((f) => f.toLowerCase().endsWith(".json")));
    } else {
      out.push(absolute);
    }
  }
  return [...new Set(out)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function runFmt(ctx: Ctx, paths: string[], opts: FmtOptions = {}): CommandResult {
  const { root, warn } = ctx;
  const errors: CliError[] = [];
  const files = targets(paths, root, errors);
  const changed: string[] = [];
  let checked = 0;

  for (const absolute of files) {
    const reported = reportPath(absolute, root);
    const result = checkFile(absolute);
    if (result.status === "unreadable") {
      errors.push({ code: "CONFIG_INVALID", message: result.message, path: reported });
      continue;
    }
    checked += 1;
    if (!result.schemaKnown) {
      // Diagnostics go to stderr; stdout stays exactly one envelope (SCN-KRN-004).
      warn(`fmt: ${reported}: no known $schema, keys ordered alphabetically\n`);
    }
    if (result.status === "canonical") continue;
    changed.push(reported);
    if (opts.check !== true) writeFileSync(absolute, result.text, "utf8");
  }

  const data = { checked, changed };

  // A file that cannot be parsed is a configuration problem (exit 3) and
  // outranks a formatting difference (exit 1).
  if (errors.length > 0) return failures(errors, EXIT.CONFIG, data);

  if (opts.check === true && changed.length > 0) {
    return failures(
      changed.map((p) => ({
        code: "NOT_CANONICAL" as const,
        message: "file is not in canonical form; run `warrant fmt`",
        path: p
      })),
      EXIT.FAIL,
      data
    );
  }

  return success(data);
}
