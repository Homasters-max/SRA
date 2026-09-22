/**
 * `warrant validate` — checks (1), (2), (3), (5) and (6) of REQ-KRN-021.
 *
 * Every finding is collected: the command never stops at the first error, so
 * one run tells the whole story (SCN-KRN-043, task 3.7).
 *
 * Not implemented yet and therefore always listed in `data.skipped`:
 *   - `generated` (check 4)  — closes with task 3.6, after `sync` exists.
 *   - `canonical` (check 7)  — closes with task 4.3, after `fmt` exists.
 */
import path from "node:path";

import { EXIT, type CliError } from "../core/errors.js";
import { walkFiles, loadPacks, reportPath } from "../core/packs/loader.js";
import { checkLock, LOCK_REL } from "../core/packs/hash.js";
import { checkIds } from "../core/ids/scan.js";
import { scanSecrets } from "../core/secrets.js";
import { validateFile } from "../core/schemas/semantic.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { projectRoot as defaultRoot, WARRANT_DIR } from "./context.js";
import { readFileSync } from "node:fs";

/**
 * `.warrant/schemas/` holds copies of the kernel JSON-Schema files themselves.
 * They are JSON Schema documents, not WARRANT documents: their `$schema` is
 * `https://json-schema.org/draft/2020-12/schema`, so validating them against
 * the WARRANT registry would report SCHEMA_UNKNOWN for every one. They are
 * excluded from check (1); `sync` verifies them by hash instead.
 */
const SCHEMA_COPIES_PREFIX = `${WARRANT_DIR}/schemas/`;

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
  /** `--no-generated`: commander sets `generated` to false when the flag is given. */
  generated?: boolean | undefined;
}

export function runValidate(
  opts: ValidateOptions = {},
  root: string = defaultRoot(),
  warn: (text: string) => void = (text) => process.stderr.write(text)
): CommandResult {
  const errors: CliError[] = [];
  const skipped: string[] = [];

  // Loader: config, packs, their files, duplicates and overrides — checks (1) and (3).
  const loaded = loadPacks(root);
  errors.push(...loaded.errors);
  const checkedFiles = new Set(loaded.files);

  // Check (1) for everything else under `.warrant/**`.
  for (const absolute of walkFiles(path.join(root, WARRANT_DIR))) {
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    const reported = reportPath(absolute, root);
    if (reported.startsWith(SCHEMA_COPIES_PREFIX)) continue;
    if (reported === LOCK_REL) continue; // check (2) validates the lock
    if (checkedFiles.has(reported)) continue;
    checkedFiles.add(reported);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(absolute, "utf8"));
    } catch (cause) {
      errors.push({ code: "CONFIG_INVALID", message: `invalid JSON: ${(cause as Error).message}`, path: reported });
      continue;
    }
    const result = validateFile(json, reported);
    if (!result.ok) errors.push(...result.errors);
  }

  // Check (2): lock against config and pack content.
  errors.push(...checkLock({ projectRoot: root, config: loaded.config, packs: loaded.packs }));
  checkedFiles.add(LOCK_REL);

  // Check (4): not implemented until `sync` exists (task 3.6).
  skipped.push("generated");
  warn(
    opts.generated === false
      ? "validate: check (4) generated files skipped (--no-generated)\n"
      : "validate: check (4) generated files is not implemented yet (task 3.6); skipped\n"
  );

  // Check (5): stable ids.
  const ids = checkIds(root);
  errors.push(...ids.errors);
  for (const file of ids.files) checkedFiles.add(file);
  if (ids.placementSkipped) {
    skipped.push("ids-placement");
    warn("validate: check (5) id placement skipped: `openspec` is not on PATH\n");
  }

  // Check (6): secrets.
  errors.push(
    ...scanSecrets(
      root,
      (dir) => walkFiles(dir),
      (absolute) => reportPath(absolute, root)
    )
  );

  // Check (7): canonical form — task 4.3.
  skipped.push("canonical");
  warn("validate: check (7) canonical form is not implemented yet (task 4.3); skipped\n");

  const data = {
    checked: { files: checkedFiles.size, packs: loaded.packs.map((p) => p.id) },
    skipped
  };

  if (errors.length === 0) return success(data);
  return failures(sortErrors(errors), EXIT.CONFIG, data);
}
