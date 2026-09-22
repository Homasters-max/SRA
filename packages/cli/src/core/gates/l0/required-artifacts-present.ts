/**
 * `required-artifacts-present`: every artifact of `artifacts.required` of the
 * effective policy is `done` by `openspec status --json`; `skipped` counts for
 * `specs` only, which is what `skip_specs` of a `chore` produces (REQ-VER-004).
 */
import type { ArtifactStatuses } from "../../openspec/status.js";
import { noInput, pass, type Calculator } from "./types.js";

/** Required artifacts that are not present, in policy order. */
export function missingArtifacts(required: readonly string[], statuses: ArtifactStatuses): string[] {
  return required.filter((id) => {
    const status = statuses[id];
    return !(status === "done" || (status === "skipped" && id === "specs"));
  });
}

export const requiredArtifactsPresent: Calculator = (ctx) => {
  if (!ctx.signals.artifacts.ok) return noInput(ctx.gate, `artifact statuses unknown: ${ctx.signals.artifacts.reason}`);
  const statuses = ctx.signals.artifacts.value;
  const missing = missingArtifacts(ctx.policy.artifacts.required, statuses);
  if (missing.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: [
      {
        code: "ARTIFACT_MISSING",
        gate: ctx.gate,
        items: missing,
        message: `required artifacts not done: ${missing.map((id) => `${id} (${statuses[id] ?? "absent"})`).join(", ")}`
      }
    ]
  };
};
