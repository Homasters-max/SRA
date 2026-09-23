/**
 * `warrant validate` — checks (1)–(12) of REQ-KRN-021.
 *
 * Every finding is collected: the command never stops at the first error, so
 * one run tells the whole story (SCN-KRN-043, task 3.7).
 *
 * Check (7), the canonical form, shares its file set with `warrant fmt`
 * (`core/canon/files.ts`) so the two can never disagree; check (4) shares its
 * planner with `warrant sync` (`core/sync/plan.ts`) for the same reason.
 *
 * Nothing is skipped unconditionally: `config.yaml` is generated whole, so
 * there is no flag to opt out of check (4) (REQ-KRN-025, откат I-43).
 * `data.skipped` lists what this run could not do: `openspec-schema` and
 * `ids-placement` when `openspec` is not on PATH. Check (9) needs git; outside
 * a git work tree it is skipped with a warning on stderr only, because fixture
 * projects without git are a normal place to run `validate` (design §14).
 */
import path from "node:path";

import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { walkFiles, loadPacks, reportPath } from "../core/packs/loader.js";
import type { LoadResult } from "../core/packs/types.js";
import { openspecAvailable, runOpenspec } from "../core/openspec/cli.js";
import { requireOpenspec } from "../core/openspec/version.js";
import { planSync } from "../core/sync/plan.js";
import { checkLock, LOCK_REL } from "../core/packs/hash.js";
import { checkIds } from "../core/ids/scan.js";
import { checkImmutableIds } from "../core/ids/immutable.js";
import { readAllRecords } from "../core/record/read.js";
import { checkRuleScope } from "../core/validate/rules.js";
import { checkLinkTargets } from "../core/validate/links.js";
import { checkWaivers } from "../core/validate/waivers.js";
import { checkEvidence } from "../core/validate/evidence.js";
import { scanSecrets } from "../core/secrets.js";
import { validateFile } from "../core/schemas/semantic.js";
import { checkCanonical, isRawEvidencePath, SCHEMA_COPIES_PREFIX } from "../core/canon/files.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { projectRoot as defaultRoot, WARRANT_DIR } from "./context.js";
import { readFileSync } from "node:fs";

function sortErrors(errors: CliError[]): CliError[] {
  return [...errors].sort((a, b) => {
    const pa = a.path ?? "";
    const pb = b.path ?? "";
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/**
 * Check (4) of REQ-KRN-021: the generated OpenSpec files equal what `sync`
 * would write, `openspec schema validate` passes, and every `rules` key names
 * an artifact of the schema (ADR-0015).
 *
 * The byte comparison and the `rules` check need no `openspec` on PATH, so
 * they always run; only the version gate and `openspec schema validate` are
 * skipped when the binary is absent.
 */
function checkGenerated(
  root: string,
  loaded: LoadResult,
  skipped: string[],
  warn: (text: string) => void
): CliError[] {
  const errors: CliError[] = [];
  const available = openspecAvailable();

  let version: string | null = null;
  if (available) {
    try {
      version = requireOpenspec(loaded.config, root);
    } catch (thrown) {
      errors.push(
        thrown instanceof WarrantError
          ? thrown.toCliError()
          : { code: "OPENSPEC_FAILED", message: (thrown as Error).message }
      );
    }
  }

  // The lock belongs to check (2); passing null keeps it out of this plan.
  const plan = planSync({ root, loaded, openspecVersion: null });
  errors.push(...plan.errors);

  for (const file of plan.files) {
    if (!file.changed) continue;
    errors.push({
      code: "GENERATED_DRIFT",
      message: "file differs from what `warrant sync` would generate; run `warrant sync`",
      path: file.path
    });
  }

  const artifacts = new Set(plan.artifacts);
  for (const key of Object.keys(plan.rules.rules ?? {})) {
    if (artifacts.has(key)) continue;
    const source = plan.ruleSources[key] ?? ".warrant/local/openspec/rules.json";
    errors.push({
      code: "RULES_ARTIFACT_UNKNOWN",
      message: `rules key "${key}" is not an artifact of schema ${plan.schema || "(unknown)"}`,
      path: `${source}#/rules/${key}`
    });
  }

  if (version !== null && plan.schema !== "") {
    const run = runOpenspec(["schema", "validate", plan.schema, "--json"], root);
    const valid = typeof run.json === "object" && run.json !== null ? (run.json as { valid?: unknown }).valid : undefined;
    if (!run.ok || valid === false) {
      errors.push({
        code: "OPENSPEC_SCHEMA_INVALID",
        message: `openspec rejected schema ${plan.schema}: ${(run.stderr || run.stdout).trim().split("\n")[0] ?? ""}`,
        path: `openspec/schemas/${plan.schema}/schema.yaml`
      });
    }
  } else if (version === null) {
    skipped.push("openspec-schema");
    warn("validate: check (4) `openspec schema validate` skipped: `openspec` is not on PATH\n");
  }

  return errors;
}

/** Today as the UTC calendar date `YYYY-MM-DD`, the unit of `waiver.expires_at`. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runValidate(
  root: string = defaultRoot(),
  warn: (text: string) => void = (text) => process.stderr.write(text),
  today: string = utcToday()
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
    if (isRawEvidencePath(reported)) continue; // raw check output is not a record (I-76)
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

  // Check (4): generated OpenSpec files, byte for byte (task 3.6, SCN-KRN-045).
  // A failed load already told the whole story; planning on top of it would
  // only repeat it, so the check is skipped without a second word.
  if (loaded.errors.length === 0) {
    errors.push(...checkGenerated(root, loaded, skipped, warn));
  }

  // Check (5): stable ids.
  const ids = checkIds(root);
  errors.push(...ids.errors);
  for (const file of ids.files) checkedFiles.add(file);
  if (ids.placementSkipped) {
    skipped.push("ids-placement");
    warn("validate: check (5) id placement skipped: `openspec` is not on PATH\n");
  }

  // Check (6): secrets; raw check output is never committed (I-76).
  errors.push(
    ...scanSecrets(
      root,
      (dir) => walkFiles(dir).filter((absolute) => !isRawEvidencePath(reportPath(absolute, root))),
      (absolute) => reportPath(absolute, root)
    )
  );

  // Check (7): canonical form of every `.warrant/**` JSON file (REQ-KRN-022).
  errors.push(...checkCanonical(root));

  // Check (8): path rules (ADR-0022); `id` = file name is a semantic rule of the loader.
  errors.push(...checkRuleScope(loaded.rules));

  // Check (9): stable ids against HEAD (D-18).
  const records = readAllRecords(root);
  const immutable = checkImmutableIds(root, records);
  errors.push(...immutable.errors);
  if (immutable.skipped !== undefined) {
    warn(`validate: check (9) stable ids against HEAD skipped: ${immutable.skipped}
`);
  }

  // Check (10): targets of amends / supersedes (ADR-0021).
  errors.push(...checkLinkTargets(records));

  // Check (11): waiver semantics; an expired ACTIVE waiver is a warning only.
  const waivers = checkWaivers(root, loaded, records, today);
  errors.push(...waivers.errors);
  for (const line of waivers.warnings) warn(line);

  // Check (12): evidence records and manifests, second step of D-13.
  errors.push(...checkEvidence(root, loaded));

  const data = {
    checked: { files: checkedFiles.size, packs: loaded.packs.map((p) => p.id) },
    skipped
  };

  if (errors.length === 0) return success(data);
  return failures(sortErrors(errors), EXIT.CONFIG, data);
}
