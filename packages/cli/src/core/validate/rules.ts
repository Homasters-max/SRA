/**
 * Path rules (`warrant://rule/1`, ADR-0022): check (8) of `validate` and the
 * `rules` summary of `status` (REQ-KRN-021, REQ-KRN-027).
 *
 * `id` equal to the file name is a semantic rule of the schema
 * (`core/schemas/semantic.ts`), applied when the loader validates the file;
 * only the scope rule lives here.
 */
import type { CliError } from "../errors.js";
import type { LoadedRule } from "../packs/types.js";

/**
 * True when every path a glob can match lies under `openspec/changes/`: its
 * literal prefix is that directory. `**` and `openspec/**` reach outside it.
 */
export function globInsideChanges(glob: string): boolean {
  const normal = glob.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  return /^openspec\/changes(\/|$)/.test(normal);
}

/**
 * Check (8): a rule whose `paths` all lie inside `openspec/changes/**` belongs
 * to the `openspec-rules` channel, not to path rules (ADR-0022 point 4).
 */
export function checkRuleScope(rules: readonly LoadedRule[]): CliError[] {
  const errors: CliError[] = [];
  for (const rule of rules) {
    if (rule.paths.length === 0 || !rule.paths.every(globInsideChanges)) continue;
    errors.push({
      code: "RULE_SCOPE",
      message: `rule "${rule.id}" applies only inside openspec/changes/**; rules for OpenSpec artifacts belong in openspec rules (ADR-0022 point 4)`,
      path: `${rule.path}#/paths`
    });
  }
  return errors;
}

/** `rules{ total, unenforced }` of `warrant status` without an argument (ADR-0022 point 4). */
export function rulesSummary(rules: readonly LoadedRule[]): { total: number; unenforced: number } {
  return { total: rules.length, unenforced: rules.filter((r) => r.enforcedBy === undefined).length };
}
