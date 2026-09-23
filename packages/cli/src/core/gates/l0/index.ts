/**
 * The table of L0 calculators by gate id of `core-sdd` (design §8, D-8).
 * `factory-golden-passed` is absent on purpose: it is an evidence gate with
 * `applies_when`, which the verdict algorithm handles for every gate alike.
 */
import { analyzeClean } from "./analyze-clean.js";
import { blockingUnknownsResolved } from "./blocking-unknowns-resolved.js";
import { branchIsolated } from "./branch-isolated.js";
import { evidenceComplete } from "./evidence-complete.js";
import { idsValid } from "./ids-valid.js";
import { requiredArtifactsPresent } from "./required-artifacts-present.js";
import { scopeValid } from "./scope-valid.js";
import type { Calculator } from "./types.js";

export const CALCULATORS: ReadonlyMap<string, Calculator> = new Map<string, Calculator>([
  ["analyze-clean", analyzeClean],
  ["blocking-unknowns-resolved", blockingUnknownsResolved],
  ["branch-isolated", branchIsolated],
  ["evidence-complete", evidenceComplete],
  ["ids-valid", idsValid],
  ["required-artifacts-present", requiredArtifactsPresent],
  ["scope-valid", scopeValid]
]);

export type { Calculator, L0Context, L0Result } from "./types.js";
