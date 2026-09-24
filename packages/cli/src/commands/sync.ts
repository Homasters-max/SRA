/**
 * `warrant sync [--check]` — generate the OpenSpec files and the lock
 * (REQ-KRN-025, design D-7).
 *
 * The pipeline is: config -> OpenSpec version gate -> packs -> plan -> write.
 * Nothing is written unless the whole plan succeeded, so a failing run leaves
 * the project exactly as it was (SCN-KRN-064).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../core/canon/format-json.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, type CliError } from "../core/errors.js";
import { requireOpenspec } from "../core/openspec/version.js";
import { loadConfig, loadPacks } from "../core/packs/loader.js";
import { LOCK_REL } from "../core/packs/hash.js";
import { planSync, type SyncPlan } from "../core/sync/plan.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface SyncOptions {
  /** `--check`: report differences without touching the working tree. */
  check?: boolean | undefined;
}

/** Error code a drifted file is reported under: the lock has its own. */
export function driftCode(rel: string): CliError["code"] {
  return rel === LOCK_REL ? "LOCK_MISMATCH" : "GENERATED_DRIFT";
}

/** `data` payload shared by a successful run and a failing `--check`. */
function payload(plan: SyncPlan, changed: string[]): Record<string, unknown> {
  return {
    schema: plan.schema,
    changed,
    generated: plan.files.map((f) => f.path),
    stale: plan.stale
  };
}

export async function runSync(ctx: Ctx, opts: SyncOptions = {}): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);

  // The version gate runs before any other `openspec` call and before the
  // packs are loaded, so a wrong OpenSpec can never reach the generator.
  const config = loadConfig(root);
  const openspecVersion = await requireOpenspec(ctx.openspec, config);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) {
    // Any loader finding makes the pack set unusable: generating from half a
    // pack set would write files the project never asked for.
    return failures(loaded.errors, EXIT.CONFIG, { schema: "", changed: [], generated: [], stale: [] });
  }

  const plan = planSync({ root, loaded, openspecVersion });
  if (plan.errors.length > 0) {
    return failures(plan.errors, EXIT.CONFIG, payload(plan, []));
  }

  const changed = plan.files.filter((f) => f.changed).map((f) => f.path);

  if (opts.check === true) {
    if (changed.length === 0) return success(payload(plan, changed));
    const errors: CliError[] = changed.map((rel) => ({
      code: driftCode(rel),
      message: "file differs from what `warrant sync` would generate; run `warrant sync`",
      path: rel
    }));
    return failures(errors, EXIT.FAIL, payload(plan, changed));
  }

  for (const file of plan.files) {
    if (!file.changed) continue;
    const absolute = path.join(root, file.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    // JSON documents WARRANT owns go through the one canonical writer.
    if (file.json !== undefined) writeJsonFile(absolute, file.json);
    else writeFileSync(absolute, file.bytes);
  }

  return success(payload(plan, changed));
}
