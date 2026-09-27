/**
 * The CI run of the records of `MERGED` (A-29, R-6): `ciRunOf`, shared by
 * `transition MERGED`, `ci` and `ci fetch`.
 */
import { describe, expect, it } from "vitest";

import { ciRunOf } from "../../../src/core/transition/merged.js";

const RUN = "https://github.com/o/r/actions/runs/1";

function ci(id: string, ref: unknown): { id: string; json: Record<string, unknown> } {
  return { id, json: { attestation: { type: "ci", ref } } };
}

describe("ciRunOf", () => {
  it("is the one run every CI record names, a trailing / aside; other attestations do not count", () => {
    const local = { id: "EVID-3", json: { attestation: { type: "none" } } };
    expect(ciRunOf([ci("EVID-1", RUN), ci("EVID-2", `${RUN}/`), local])).toEqual({ ref: RUN });
  });

  it("takes a ref without an attempt for attempt 1 of the run, not for another attempt (A-31)", () => {
    expect(ciRunOf([ci("EVID-1", RUN), ci("EVID-2", `${RUN}/attempts/1`)])).toEqual({ ref: RUN });
    expect(ciRunOf([ci("EVID-1", RUN), ci("EVID-2", `${RUN}/attempts/2`)])).toEqual({ mismatched: ["EVID-1", "EVID-2"] });
  });

  it("is null without CI records", () => {
    expect(ciRunOf([{ id: "EVID-1", json: { attestation: { type: "human-review", ref: RUN } } }])).toEqual({ ref: null });
    expect(ciRunOf([])).toEqual({ ref: null });
  });

  it("lists every CI record, sorted, when they name two runs or one names none", () => {
    expect(ciRunOf([ci("EVID-2", RUN), ci("EVID-1", "https://github.com/o/r/actions/runs/2")])).toEqual({
      mismatched: ["EVID-1", "EVID-2"]
    });
    expect(ciRunOf([ci("EVID-1", RUN), ci("EVID-2", undefined)])).toEqual({ mismatched: ["EVID-1", "EVID-2"] });
  });
});
