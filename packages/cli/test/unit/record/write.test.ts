/**
 * The transition matrix of 04 section 2 and the freeze of the record
 * (REQ-VER-007, design §10): every pair of states, `appendTransition` on disk.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { WarrantError } from "../../../src/core/errors.js";
import { CHANGE_STATES, transitionKind } from "../../../src/core/record/lifecycle.js";
import { appendTransition, assertNotFrozen, withTransition } from "../../../src/core/record/write.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** The whole allowed set; every other pair is refused. */
const ALLOWED: Record<string, string> = {
  "PROPOSED->SPECIFIED": "forward",
  "SPECIFIED->APPROVED": "forward",
  "APPROVED->IMPLEMENTING": "forward",
  "IMPLEMENTING->VERIFYING": "forward",
  "VERIFYING->MERGED": "forward",
  "MERGED->ARCHIVED": "forward",
  "VERIFYING->IMPLEMENTING": "backward",
  "IMPLEMENTING->SPECIFIED": "backward",
  "PROPOSED->ABANDONED": "abandon",
  "SPECIFIED->ABANDONED": "abandon",
  "APPROVED->ABANDONED": "abandon",
  "IMPLEMENTING->ABANDONED": "abandon",
  "VERIFYING->ABANDONED": "abandon"
};

function record(state: string): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change: "add-search",
    change_state: state,
    transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }]
  };
}

describe("transition matrix (04 section 2)", () => {
  it("allows exactly the forward chain, two backward moves and ABANDONED before MERGED", () => {
    for (const from of CHANGE_STATES) {
      for (const to of CHANGE_STATES) {
        expect(transitionKind(from, to), `${from}->${to}`).toBe(ALLOWED[`${from}->${to}`] ?? null);
      }
    }
  });

  it("refuses skipping a state, going back further, abandoning after MERGED and leaving a frozen state", () => {
    expect(transitionKind("PROPOSED", "APPROVED")).toBeNull();
    expect(transitionKind("VERIFYING", "SPECIFIED")).toBeNull();
    expect(transitionKind("MERGED", "ABANDONED")).toBeNull();
    expect(transitionKind("ARCHIVED", "ABANDONED")).toBeNull();
    expect(transitionKind("ABANDONED", "PROPOSED")).toBeNull();
    expect(transitionKind("SPECIFIED", "SPECIFIED")).toBeNull();
  });
});

describe("record freeze (SCN-VER-035)", () => {
  it("throws RECORD_FROZEN with exit 3 for ARCHIVED and ABANDONED only", () => {
    for (const state of CHANGE_STATES) {
      const call = (): void => assertNotFrozen(record(state), "add-search");
      if (state === "ARCHIVED" || state === "ABANDONED") {
        expect(call).toThrow(WarrantError);
        try {
          call();
        } catch (thrown) {
          expect((thrown as WarrantError).code).toBe("RECORD_FROZEN");
          expect((thrown as WarrantError).exitCode).toBe(3);
        }
      } else {
        expect(call).not.toThrow();
      }
    }
  });
});

describe("appendTransition", () => {
  it("appends the entry, moves change_state and writes the record canonically", () => {
    const root = makeTempDir("warrant-record-write-");
    tempDirs.push(root);
    mkdirSync(path.join(root, ".warrant", "changes"), { recursive: true });
    const entry = {
      to: "SPECIFIED",
      at: "2026-09-23T10:00:00.000Z",
      by: "cli:local",
      effective_policy_hash: `sha256:${"a".repeat(64)}`,
      gates: { "spec-valid": "PASS" },
      evidence: ["EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W"]
    };
    const updated = appendTransition(root, "add-search", record("PROPOSED"), entry);
    expect(updated).toEqual(withTransition(record("PROPOSED"), entry));
    const stored = JSON.parse(readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8"));
    expect(stored.change_state).toBe("SPECIFIED");
    expect(stored.transitions).toHaveLength(2);
    expect(stored.transitions[1]).toEqual(entry);
  });

  it("refuses to write past a frozen state", () => {
    expect(() =>
      appendTransition("unused", "add-search", record("ABANDONED"), { to: "PROPOSED", at: "2026-09-23T10:00:00Z", by: "cli:local" })
    ).toThrow(/ABANDONED/);
  });
});
