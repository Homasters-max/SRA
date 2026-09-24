/**
 * Check 5d, `checkPlacement` (ADR-0025 п. 9, design §4, task 3.1): `openspec
 * show` runs only for the changes and specs whose files carry a REQ or SCN id,
 * counts only for names `list` returned, runs at most SHOW_CONCURRENCY calls at
 * once, and the findings do not depend on the order the calls finish in.
 *
 * The project is built by `ProjectBuilder`; `FakeOpenSpec` answers from the
 * same model and keeps the journal of calls (task 4.1, I-127).
 */
import { describe, expect, it } from "vitest";

import { checkPlacement, scanIds, SHOW_CONCURRENCY } from "../../../src/core/ids/scan.js";
import type { ModelRequirement } from "../helpers/fakes/spec-model.js";
import { useProjectBuilder, type BuilderOptions } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** A requirement whose id is placed directly under its heading. */
const req = (id: string, scenarios: ModelRequirement["scenarios"] = []): ModelRequirement => ({ name: id, id, scenarios });

const shows = (calls: string[]): string[] => calls.filter((call) => call.startsWith("show")).sort();

describe("checkPlacement: show only where ids are (ADR-0025 п. 9)", () => {
  it("shows only the changes and specs whose files carry a REQ or SCN id", async () => {
    const p = project()
      .withChange("with-ids", { specs: { cap: [req("REQ-TST-001")] } })
      .withChange("no-ids", { specs: { cap: [{ name: "plain" }] }, tasks: "- [ ] 1.1 <!-- id: TASK-TST-001 --> covers REQ-TST-001\n" })
      .withSpec("main", [req("REQ-TST-002")])
      .withSpec("plain", [{ name: "plain" }])
      .withSpec("area/nested", [{ name: "nested", scenarios: [{ name: "S", id: "SCN-TST-003" }] }]);

    const result = await checkPlacement(p.ctx, scanIds(p.root).ids);

    expect(result).toEqual({ errors: [], skipped: false });
    // A nested spec is asked about under every directory above its file (`area` is not a spec).
    expect(shows(p.openspec.calls)).toEqual([
      "show --type spec area",
      "show --type spec area/nested",
      "show --type spec main",
      "show with-ids"
    ]);
  });

  it("an id is placed only by what show returned for a name list returned", async () => {
    const p = project()
      .withChange("listed", { specs: { cap: [req("REQ-TST-001"), { name: "late", id: "REQ-TST-002", idAfterBody: true }] } })
      .withChange("unlisted", { specs: { cap: [req("REQ-TST-003")] } });
    p.openspec.change("unlisted").listed = false;

    const result = await checkPlacement(p.ctx, scanIds(p.root).ids);

    expect(shows(p.openspec.calls)).toEqual(["show listed", "show unlisted"]);
    expect(result.errors.map((e) => [e.code, e.path, e.message.split(" ")[0]])).toEqual([
      ["ID_PLACEMENT", "openspec/changes/listed/specs/cap/spec.md", "REQ-TST-002"],
      ["ID_PLACEMENT", "openspec/changes/unlisted/specs/cap/spec.md", "REQ-TST-003"]
    ]);
  });

  it(`runs at most ${SHOW_CONCURRENCY} calls at once and reports in scan order whatever the finish order`, async () => {
    const names = Array.from({ length: 10 }, (_, i) => `spec-${String(i).padStart(2, "0")}`);
    const build = (openspecDelay: NonNullable<BuilderOptions["openspecDelay"]>) => {
      const p = project({ openspecDelay });
      names.forEach((name, i) => {
        const nnn = String(i + 1).padStart(3, "0");
        // Only the scenario is placed: every requirement is a finding.
        p.withSpec(name, [
          { name: "late", id: `REQ-TST-${nnn}`, idAfterBody: true, scenarios: [{ name: "S", id: `SCN-TST-${nnn}` }] }
        ]);
      });
      return p;
    };
    const indexOf = (call: string): number => names.indexOf(call.replace("show --type spec ", ""));
    const forward = build((call) => Math.max(0, indexOf(call)) * 3);
    const backward = build((call) => (indexOf(call) < 0 ? 0 : (names.length - indexOf(call)) * 3));

    const first = await checkPlacement(forward.ctx, scanIds(forward.root).ids);
    const second = await checkPlacement(backward.ctx, scanIds(backward.root).ids);

    expect(forward.openspec.maxInFlight).toBe(SHOW_CONCURRENCY);
    expect(backward.openspec.maxInFlight).toBe(SHOW_CONCURRENCY);
    expect(second).toEqual(first);
    expect(first.errors.map((e) => e.message.split(" ")[0])).toEqual(
      names.map((_, i) => `REQ-TST-${String(i + 1).padStart(3, "0")}`)
    );
  });

  it("no REQ or SCN id to check — no openspec call; openspec absent — skipped without list or show", async () => {
    const none = project().withChange("c", { tasks: "<!-- id: TASK-TST-001 -->\n" });
    expect(await checkPlacement(none.ctx, scanIds(none.root).ids)).toEqual({ errors: [], skipped: false });
    expect(none.openspec.calls).toEqual([]);

    const absent = project().withSpec("main", [req("REQ-TST-001")]);
    absent.openspec.fail("version");
    expect(await checkPlacement(absent.ctx, scanIds(absent.root).ids)).toEqual({ errors: [], skipped: true });
    expect(absent.openspec.calls).toEqual(["--version"]);
  });
});
