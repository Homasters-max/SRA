/** `parseOpenspecStatus` on real `openspec status --json` bodies (task 9.1). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WarrantError } from "../../../src/core/errors.js";
import { parseOpenspecStatus } from "../../../src/core/openspec/status.js";
import { CLI_ROOT } from "../../helpers/cli.js";

const FIXTURES = path.join(CLI_ROOT, "test", "fixtures", "openspec");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

describe("parseOpenspecStatus", () => {
  it("projects a fresh change onto artifact statuses (OpenSpec 1.13.1)", () => {
    expect(parseOpenspecStatus(fixture("status-fresh"))).toEqual({
      proposal: "ready",
      specs: "blocked",
      design: "blocked",
      tasks: "blocked"
    });
  });

  it("reports `done` once an artifact exists", () => {
    expect(parseOpenspecStatus(fixture("status-in-progress"))).toEqual({
      proposal: "done",
      specs: "ready",
      design: "ready",
      tasks: "blocked"
    });
  });

  it("rejects the error body OpenSpec prints for an unknown change", () => {
    expect(() => parseOpenspecStatus(fixture("status-not-found"))).toThrow(WarrantError);
    expect(() => parseOpenspecStatus(fixture("status-not-found"))).toThrow(/artifacts/);
  });

  it("rejects a body that is not an object", () => {
    expect(() => parseOpenspecStatus(undefined)).toThrow(/no JSON object/);
    expect(() => parseOpenspecStatus([])).toThrow(/no JSON object/);
  });

  it("rejects an unknown status value rather than dropping the artifact", () => {
    const body = { artifacts: [{ id: "proposal", status: "pending" }] };
    expect(() => parseOpenspecStatus(body)).toThrow(/unknown status "pending"/);
  });

  it("skips entries without an id", () => {
    const body = { artifacts: [{ status: "done" }, { id: "tasks", status: "skipped" }] };
    expect(parseOpenspecStatus(body)).toEqual({ tasks: "skipped" });
  });
});
