import { afterAll, describe, expect, it } from "vitest";

import { exitCodeFor, WarrantError } from "../../../src/core/errors.js";
import { allocateSpecLevel, allocateUlid, allocateWaiver, highestNumber } from "../../../src/core/ids/allocate.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";
import { write } from "../../helpers/synced.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function project(): string {
  const root = makeTempDir("warrant-ids-");
  tempDirs.push(root);
  write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
  return root;
}

function req(id: string): string {
  return `### Requirement: X\n<!-- id: ${id} -->\n\nThe system SHALL x.\n`;
}

describe("allocateSpecLevel", () => {
  it("starts at 001 when nothing is allocated yet", () => {
    expect(allocateSpecLevel(project(), "REQ", "KRN")).toBe("REQ-KRN-001");
  });

  it("counts archive and Change records, not just active specs (SCN-KRN-056)", () => {
    const root = project();
    write(root, "openspec/specs/kernel/spec.md", req("REQ-KRN-007"));
    write(root, "openspec/changes/archive/2026-01-01-old/specs/kernel/spec.md", req("REQ-KRN-012"));
    expect(highestNumber(root, "REQ", "KRN")).toBe(12);
    expect(allocateSpecLevel(root, "REQ", "KRN")).toBe("REQ-KRN-013");
  });

  it("counts unknowns and assumptions of Change records", () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", {
      $schema: "warrant://change-record/1",
      change: "add-search",
      change_state: "SPECIFIED",
      unknowns: [{ id: "UNK-KRN-004", text: "q", blocking: false }]
    });
    expect(allocateSpecLevel(root, "UNK", "KRN")).toBe("UNK-KRN-005");
  });

  it("counts per prefix and per area", () => {
    const root = project();
    write(root, "openspec/specs/kernel/spec.md", req("REQ-KRN-009") + req("SCN-KRN-002"));
    expect(allocateSpecLevel(root, "SCN", "KRN")).toBe("SCN-KRN-003");
  });

  it("refuses an AREA that is not in the registry (SCN-KRN-057)", () => {
    try {
      allocateSpecLevel(project(), "REQ", "ZZZ");
      expect.unreachable();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(WarrantError);
      expect((thrown as WarrantError).code).toBe("AREA_UNKNOWN");
      expect(exitCodeFor([thrown as WarrantError])).toBe(3);
    }
  });

  it("refuses to go past 999 with ID_FORMAT", () => {
    const root = project();
    write(root, "openspec/specs/kernel/spec.md", req("REQ-KRN-999"));
    try {
      allocateSpecLevel(root, "REQ", "KRN");
      expect.unreachable();
    } catch (thrown) {
      expect((thrown as WarrantError).code).toBe("ID_FORMAT");
    }
  });
});

describe("allocateUlid", () => {
  it("is Crockford base32, 26 chars, and monotonic within the process (SCN-KRN-058)", () => {
    const a = allocateUlid("EVID");
    const b = allocateUlid("EVID");
    expect(a).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
    expect(allocateUlid("RUN")).toMatch(/^RUN-[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("allocateWaiver", () => {
  it("starts at 001 for a year with no waivers", () => {
    expect(allocateWaiver(project(), 2026)).toBe("WAV-2026-001");
  });

  it("continues the counter of the requested year only", () => {
    const root = project();
    write(root, ".warrant/waivers/a.json", { id: "WAV-2026-003" });
    write(root, ".warrant/waivers/b.json", { id: "WAV-2025-009" });
    expect(allocateWaiver(root, 2026)).toBe("WAV-2026-004");
    expect(allocateWaiver(root, 2027)).toBe("WAV-2027-001");
  });

  it("counts a file name WAV-<year>-NNN.json as taken even when its content says otherwise (REQ-KRN-031)", () => {
    const root = project();
    write(root, ".warrant/waivers/WAV-2026-007.json", "not json");
    write(root, ".warrant/waivers/WAV-2026-002.json", { id: "WAV-2026-002" });
    expect(allocateWaiver(root, 2026)).toBe("WAV-2026-008");
  });
});
