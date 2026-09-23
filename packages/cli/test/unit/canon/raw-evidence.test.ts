/** I-76: raw check output is outside checks (1) and (7) of `validate` and outside `fmt`. */
import { describe, expect, it } from "vitest";

import { isRawEvidencePath } from "../../../src/core/canon/files.js";

describe("isRawEvidencePath", () => {
  it("matches .warrant/evidence/**/raw/** only", () => {
    expect(isRawEvidencePath(".warrant/evidence/add-search/raw/openspec-validate/stdout.json")).toBe(true);
    expect(isRawEvidencePath(".warrant/evidence/add-search/raw/x.json")).toBe(true);
    expect(isRawEvidencePath(".warrant/evidence/raw/x.json")).toBe(true);
    expect(isRawEvidencePath(".warrant/evidence/add-search/manifest.json")).toBe(false);
    expect(isRawEvidencePath(".warrant/evidence/add-search/EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json")).toBe(false);
    expect(isRawEvidencePath(".warrant/evidence/add-search/rawish/x.json")).toBe(false);
    expect(isRawEvidencePath(".warrant/changes/raw/x.json")).toBe(false);
  });
});
