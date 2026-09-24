/**
 * `FakeOpenSpec` (ADR-0025 п. 4, design §5, task 4.1): answers from its model,
 * journal of calls, calls in flight, injected failures, and the acts on the
 * Change directory. Conformity with the real `openspec` is the contract's job
 * (`test/contract/openspec.contract.test.ts`); here — the fake's own rules.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../app/helpers/fakes/clock.js";
import { FakeOpenSpec, OPENSPEC_VERSION } from "../../app/helpers/fakes/openspec.js";
import type { ModelRequirement } from "../../app/helpers/fakes/spec-model.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "warrant-fakes-openspec-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const RANK: ModelRequirement = {
  name: "Rank",
  id: "REQ-SRC-002",
  scenarios: [{ name: "Ranked", id: "SCN-SRC-002" }, { name: "Unranked" }]
};

describe("FakeOpenSpec: model", () => {
  it("lists listed changes and specs by name; shows the texts of the model, each once", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock());
    fake.change("zeta").files.add("proposal");
    const beta = fake.change("beta");
    beta.files.add("proposal");
    beta.specs.set("search", [RANK]);
    beta.specs.set("alpha", [{ ...RANK, scenarios: [] }]);
    fake.change("hidden").listed = false;
    fake.spec("search", [{ name: "Find", id: "REQ-SRC-001", body: "The system SHALL find." }]);
    fake.spec("area/nested", []);

    expect(await fake.version()).toBe(OPENSPEC_VERSION);
    expect(await fake.listChanges()).toEqual(["beta", "zeta"]);
    expect(await fake.listSpecs()).toEqual(["area/nested", "search"]);
    // Capabilities by name; the requirement shared by both is shown once.
    expect(await fake.showChange("beta")).toEqual([
      "<!-- id: REQ-SRC-002 -->\nThe system SHALL rank.",
      "<!-- id: SCN-SRC-002 -->\n- **WHEN** it is asked\n- **THEN** it answers",
      "- **WHEN** it is asked\n- **THEN** it answers"
    ]);
    expect(await fake.showSpec("search")).toEqual(["<!-- id: REQ-SRC-001 -->\nThe system SHALL find."]);
    expect(await fake.showSpec("area")).toEqual([]);
  });

  it("a change without a proposal shows nothing; status follows the artifact graph", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock());
    const change = fake.change("add-search");
    change.specs.set("search", [RANK]);
    expect(await fake.showChange("add-search")).toEqual([]);

    expect((await fake.status("add-search")).artifacts).toEqual({ proposal: "ready", specs: "done", design: "blocked", tasks: "blocked" });
    change.files.add("proposal");
    change.files.add("design");
    expect(await fake.status("add-search")).toEqual({ artifacts: { proposal: "done", specs: "done", design: "done", tasks: "ready" } });
    expect((await fake.status("nope")).warning).toMatch(/nope/);
  });

  it("archive moves the change directory to archive/<today>-<change> and out of the model", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock("2026-01-02"));
    const created = await fake.newChange("add-search", "spec-driven");
    expect(created.ok).toBe(true);
    expect(readFileSync(path.join(root, "openspec/changes/add-search/.openspec.yaml"), "utf8")).toBe(
      "schema: spec-driven\ncreated: 2026-01-02\n"
    );
    expect((await fake.newChange("add-search", "spec-driven")).ok).toBe(false);
    expect((await fake.newChange("other", "warrant-sdd")).ok).toBe(false);

    expect((await fake.archive("add-search")).ok).toBe(true);
    expect(existsSync(path.join(root, "openspec/changes/archive/2026-01-02-add-search/.openspec.yaml"))).toBe(true);
    expect(existsSync(path.join(root, "openspec/changes/add-search"))).toBe(false);
    expect(await fake.listChanges()).toEqual([]);
    expect(fake.archived).toEqual(["2026-01-02-add-search"]);
    expect((await fake.archive("add-search")).ok).toBe(false);
  });

  it("schema validate knows the built-in schema and those added by sync", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock());
    expect((await fake.schemaValidate("warrant-sdd")).ok).toBe(false);
    fake.schemas.add("warrant-sdd");
    expect((await fake.schemaValidate("warrant-sdd")).ok).toBe(true);
  });
});

describe("FakeOpenSpec: journal, concurrency, failures", () => {
  it("journals every call as its openspec argv", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock());
    await fake.version();
    await fake.listChanges();
    await fake.listSpecs();
    await fake.showChange("c");
    await fake.showSpec("s");
    await fake.status("c");
    await fake.schemaValidate("x");
    expect(fake.calls).toEqual(["--version", "list", "list --specs", "show c", "show --type spec s", "status --change c", "schema validate x"]);
  });

  it("counts calls in flight and delays answers by journal line", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock(), (call) => (call === "list" ? 10 : 0));
    const order: string[] = [];
    await Promise.all([fake.listChanges().then(() => order.push("list")), fake.listSpecs().then(() => order.push("list --specs"))]);
    expect(order).toEqual(["list --specs", "list"]);
    expect(fake.maxInFlight).toBe(2);
  });

  it("a failed method answers as when the call fails, until it recovers", async () => {
    const fake = new FakeOpenSpec(root, new FakeClock());
    fake.change("c").files.add("proposal");
    fake.fail("version").fail("listChanges").fail("status").fail("archive");
    expect(await fake.version()).toBeNull();
    expect(await fake.listChanges()).toEqual([]);
    expect((await fake.status("c")).warning).toBeDefined();
    expect((await fake.archive("c")).ok).toBe(false);
    expect(fake.changes.has("c")).toBe(true);
    fake.recover("listChanges");
    expect(await fake.listChanges()).toEqual(["c"]);
  });
});
