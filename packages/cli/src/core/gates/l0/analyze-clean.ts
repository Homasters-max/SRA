/**
 * `analyze-clean` (REQ-VER-004, N19, ADR-0036 п. 2): the findings of
 * `warrant analyze` on the evaluated commit with the base of the transition,
 * from `signals.analyze` (`core/transition` runs `analyze` on the diff of
 * `scope-valid`). A finding `UNSATISFIED`, `CONFLICT` or `ORPHAN` → `FAIL` with
 * those findings; none → `PASS`; no diff (no git, base unresolved) → `BLOCKED`
 * with `NO_INPUT`. A waiver turns `FAIL` or `BLOCKED` into `WAIVED`.
 */
import type { AnalyzeFinding } from "../../analyze/index.js";
import type { Finding } from "../types.js";
import { noInput, pass, type Calculator } from "./types.js";

export const ANALYZE_CLEAN = "analyze-clean";

function message(finding: AnalyzeFinding): string {
  if (finding.code === "UNSATISFIED") {
    return (
      `${finding.id} has no ${finding.missing.join(" and no ")}: mention it or one of its SCN in tasks.md, ` +
      "and one of its SCN in a test under paths.tests"
    );
  }
  return `${finding.path} mentions ${finding.id}, which is not defined: removed, or declared in no spec`;
}

export const analyzeClean: Calculator = (ctx) => {
  const analyzed = ctx.signals.analyze;
  if (analyzed === undefined) return noInput(ctx.gate, "`warrant analyze` was not run for this evaluation");
  if (!analyzed.ok) return noInput(ctx.gate, analyzed.reason);
  const { findings } = analyzed.value;
  if (findings.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: findings.map((finding): Finding => ({ ...finding, gate: ctx.gate, message: message(finding) }))
  };
};
