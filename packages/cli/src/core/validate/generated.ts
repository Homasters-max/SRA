/**
 * Check (4) of `validate` (REQ-KRN-021): the generated OpenSpec files equal
 * what `sync` would write, `openspec schema validate` passes, and every `rules`
 * key names an artifact of the schema (ADR-0015).
 *
 * The check shares its planner with `warrant sync` (`core/sync/plan.ts`) so the
 * two can never disagree. The byte comparison and the `rules` check need no
 * `openspec` on PATH, so they always run; only the version gate and
 * `openspec schema validate` are skipped when the binary is absent.
 */
import type { Ctx } from "../ctx.js";
import { cliError, SYNC_HINT, WarrantError, type CliError } from "../errors.js";
import { openspecAvailable, requireOpenspec } from "../openspec/version.js";
import type { LoadResult } from "../packs/types.js";
import { planSync, subsetDrift } from "../sync/plan.js";

/** Check (4); pushes `openspec-schema` to `skipped` when `openspec` is not on PATH. */
export async function checkGenerated(ctx: Ctx, loaded: LoadResult, skipped: string[]): Promise<CliError[]> {
  const { root, warn } = ctx;
  const errors: CliError[] = [];
  const available = await openspecAvailable(ctx.openspec);

  let version: string | null = null;
  if (available) {
    try {
      version = await requireOpenspec(ctx.openspec, loaded.config);
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
    errors.push(
      cliError("GENERATED_DRIFT", "file differs from what `warrant sync` would generate", { path: file.path, hint: SYNC_HINT })
    );
  }
  // Managed subsets: only our entries, by the `drift` of the same plan (REQ-KRN-033).
  errors.push(...subsetDrift(plan));

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
    const run = await ctx.openspec.schemaValidate(plan.schema);
    if (!run.ok) {
      errors.push({
        code: "OPENSPEC_SCHEMA_INVALID",
        message: `openspec rejected schema ${plan.schema}: ${run.output.trim().split("\n")[0] ?? ""}`,
        path: `openspec/schemas/${plan.schema}/schema.yaml`
      });
    }
  } else if (version === null) {
    skipped.push("openspec-schema");
    warn("validate: check (4) `openspec schema validate` skipped: `openspec` is not on PATH\n");
  }

  return errors;
}
