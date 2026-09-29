/**
 * Fast checks of the repository: `scripts/dev/check-lib.js` — the steps and the summary of their JSON output.
 */
import { describe, expect, it } from "vitest";

import { checkSteps, formatReport, summarizeStep } from "../../../../../scripts/dev/check-lib.js";

describe("check — fast checks of the repository", () => {
  it("runs sync --check, validate, fmt --check and versions:check", () => {
    expect(checkSteps("w.js").map((s) => s.id)).toEqual(["sync --check", "validate", "fmt --check", "versions:check"]);
    expect(checkSteps("w.js")[0]?.argv).toEqual(["w.js", "sync", "--check", "--json"]);
  });

  it("passes a step with exit 0 and ok JSON", () => {
    expect(summarizeStep("validate", 0, '{"ok":true,"errors":[]}')).toEqual({ id: "validate", ok: true, errors: [] });
  });

  it("lists the errors of the envelope and of versions:check", () => {
    const envelope = JSON.stringify({
      ok: false,
      errors: [{ code: "NOT_CANONICAL", path: "a.json", message: "not canonical", hint: "warrant fmt" }],
    });
    expect(summarizeStep("fmt --check", 1, envelope).errors).toEqual(["NOT_CANONICAL a.json not canonical (warrant fmt)"]);
    const versions = JSON.stringify({ ok: false, errors: [{ component: "cli", message: "no bump" }] });
    expect(summarizeStep("versions:check", 1, versions)).toMatchObject({ ok: false, errors: ["cli no bump"] });
  });

  it("falls back to the tail of the output when it is not JSON", () => {
    const r = summarizeStep("validate", 1, "", "Error: Cannot find module dist");
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["Error: Cannot find module dist", "exit 1"]);
  });

  it("reports one line per step and the verdict", () => {
    const text = formatReport([
      { id: "validate", ok: true, errors: [] },
      { id: "fmt --check", ok: false, errors: ["x"] },
    ]);
    expect(text).toBe("ok   validate\nFAIL fmt --check\n       x\ncheck: 1 of 2 failed\n");
  });
});
