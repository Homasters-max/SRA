/**
 * One run of `sync` (REQ-KRN-025, design D-7): config -> OpenSpec version
 * gate -> packs -> plan -> write. Nothing is written unless the whole plan
 * succeeded, so a failing run leaves the project exactly as it was
 * (SCN-KRN-064). Shared by `sync` and by `init`, which calls it last.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import { loadConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import { cliError, SYNC_HINT, type CliError } from "../errors.js";
import { requireOpenspec } from "../openspec/version.js";
import { LOCK_REL } from "../packs/hash.js";
import { loadPacks } from "../packs/loader.js";
import { readAtSessionStart, RESTART_HINT } from "./claude.js";
import { planSync, subsetDrift, type SyncFinding, type SyncPlan } from "./plan.js";

/** What a run of `sync` left: `data` of the command and its errors (their class gives the exit code). */
export interface SyncOutcome {
  ok: boolean;
  data: Record<string, unknown>;
  errors: CliError[];
}

/** Error code a drifted file is reported under: the lock has its own. */
export function driftCode(rel: string): CliError["code"] {
  return rel === LOCK_REL ? "LOCK_MISMATCH" : "GENERATED_DRIFT";
}

/** `data` payload shared by a successful run and a failing `--check`; `restart` — findings of the written files. */
function payload(plan: SyncPlan, changed: string[], restart: SyncFinding[] = []): Record<string, unknown> {
  return {
    schema: plan.schema,
    changed,
    generated: plan.files.map((f) => f.path),
    stale: plan.stale,
    findings: [...plan.findings, ...restart]
  };
}

function syncFailed(errors: CliError[], data: Record<string, unknown>): SyncOutcome {
  return { ok: false, data, errors };
}

function syncDone(data: Record<string, unknown>): SyncOutcome {
  return { ok: true, data, errors: [] };
}

/**
 * Plans the generated files and writes the changed ones; with `check` only
 * reports the drift. The config must exist (the caller checks it).
 */
export async function applySync(ctx: Ctx, check: boolean): Promise<SyncOutcome> {
  const { root } = ctx;

  // The version gate runs before any other `openspec` call and before the
  // packs are loaded, so a wrong OpenSpec can never reach the generator.
  const config = loadConfig(root);
  const openspecVersion = await requireOpenspec(ctx.openspec, config);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) {
    // Any loader finding makes the pack set unusable: generating from half a
    // pack set would write files the project never asked for.
    return syncFailed(loaded.errors, { schema: "", changed: [], generated: [], stale: [], findings: [] });
  }

  const plan = planSync({ root, loaded, openspecVersion });
  if (plan.errors.length > 0) {
    return syncFailed(plan.errors, payload(plan, []));
  }

  // A generated file the plan dropped (REQ-KRN-033) is a change too: deleted, or drift under `--check`.
  const changedFiles = [...plan.files.filter((f) => f.changed).map((f) => f.path), ...plan.removed];
  const changed = [...changedFiles, ...plan.subsets.filter((s) => s.changed).map((s) => s.path)];

  if (check) {
    if (changed.length === 0) return syncDone(payload(plan, changed));
    const errors: CliError[] = [
      ...changedFiles.map((rel) =>
        cliError(driftCode(rel), "file differs from what `warrant sync` would generate", { path: rel, hint: SYNC_HINT })
      ),
      ...subsetDrift(plan)
    ];
    return syncFailed(errors, payload(plan, changed));
  }

  for (const rel of plan.removed) rmSync(path.join(root, rel), { force: true });
  for (const file of [...plan.files, ...plan.subsets]) {
    if (!file.changed) continue;
    const absolute = path.join(root, file.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    // JSON documents WARRANT owns go through the one canonical writer.
    if (file.json !== undefined) writeJsonFile(absolute, file.json);
    else writeFileSync(absolute, file.bytes);
  }

  // Written, not planned: `--check` never gets here, and a run without changes has none (ADR-0042 п. 5).
  const restart = changed
    .filter(readAtSessionStart)
    .map((rel): SyncFinding => ({ code: "FRONTEND_RESTART_REQUIRED", path: rel, hint: RESTART_HINT }));
  return syncDone(payload(plan, changed, restart));
}
