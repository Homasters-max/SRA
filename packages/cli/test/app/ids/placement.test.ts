/**
 * Check 5d, `checkPlacement` (ADR-0025 п. 9, design §4, task 3.1): `openspec
 * show` runs only for the changes and specs whose files carry a REQ or SCN id,
 * counts only for names `list` returned, runs at most SHOW_CONCURRENCY calls at
 * once, and the findings do not depend on the order the calls finish in.
 *
 * The port is a local stub with a call journal; FakeOpenSpec replaces it with
 * task 4.1 (I-127).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkPlacement, scanIds, SHOW_CONCURRENCY } from "../../../src/core/ids/scan.js";
import type { OpenSpecPort } from "../../../src/core/ports/openspec.js";

/** Stub `OpenSpecPort`: answers `list`/`show` from a map, logs calls, tracks calls in flight. */
class StubOpenSpec implements OpenSpecPort {
  readonly calls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;

  /**
   * `changes` and `specs` are what `list` returns and `show` answers; `unlisted`
   * are answered by `show` but not listed.
   */
  constructor(
    private readonly changes: Record<string, string[]>,
    private readonly specs: Record<string, string[]>,
    private readonly delayOf: (name: string) => number = () => 0,
    private readonly available = true,
    private readonly unlisted: Record<string, string[]> = {}
  ) {}

  version(): Promise<string | null> {
    this.calls.push("version");
    return Promise.resolve(this.available ? "1.13.1" : null);
  }
  listChanges(): Promise<string[]> {
    this.calls.push("list");
    return Promise.resolve(Object.keys(this.changes));
  }
  listSpecs(): Promise<string[]> {
    this.calls.push("list --specs");
    return Promise.resolve(Object.keys(this.specs));
  }
  showChange(name: string): Promise<string[]> {
    return this.show(`show ${name}`, name, this.changes[name] ?? this.unlisted[name] ?? []);
  }
  showSpec(id: string): Promise<string[]> {
    return this.show(`show --type spec ${id}`, id, this.specs[id] ?? this.unlisted[id] ?? []);
  }
  private async show(call: string, name: string, texts: string[]): Promise<string[]> {
    this.calls.push(call);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, this.delayOf(name)));
    this.inFlight -= 1;
    return texts;
  }
  status(): never {
    throw new Error("not used by checkPlacement");
  }
  archive(): never {
    throw new Error("not used by checkPlacement");
  }
  newChange(): never {
    throw new Error("not used by checkPlacement");
  }
  schemaValidate(): never {
    throw new Error("not used by checkPlacement");
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "warrant-placement-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Requirement text as `show` returns it: the id comment first, a body after it. */
const placed = (id: string): string => `<!-- id: ${id} -->\nThe system SHALL do ${id}.`;

const requirement = (id: string): string => `### Requirement: ${id}\n<!-- id: ${id} -->\nThe system SHALL do ${id}.\n`;

describe("checkPlacement: show only where ids are (ADR-0025 п. 9)", () => {
  it("shows only the changes and specs whose files carry a REQ or SCN id", async () => {
    write("openspec/changes/with-ids/specs/cap/spec.md", requirement("REQ-TST-001"));
    write("openspec/changes/no-ids/specs/cap/spec.md", "### Requirement: plain\nThe system SHALL.\n");
    write("openspec/changes/no-ids/tasks.md", "- [ ] 1.1 <!-- id: TASK-TST-001 --> covers REQ-TST-001\n");
    write("openspec/specs/main/spec.md", requirement("REQ-TST-002"));
    write("openspec/specs/plain/spec.md", "### Requirement: plain\nThe system SHALL.\n");
    write("openspec/specs/area/nested/spec.md", requirement("SCN-TST-003"));

    const openspec = new StubOpenSpec(
      { "with-ids": [placed("REQ-TST-001")], "no-ids": [] },
      { main: [placed("REQ-TST-002")], plain: [], "area/nested": [placed("SCN-TST-003")] }
    );
    const result = await checkPlacement({ openspec }, scanIds(root).ids);

    expect(result).toEqual({ errors: [], skipped: false });
    const shows = openspec.calls.filter((call) => call.startsWith("show")).sort();
    // A nested spec is asked about under every directory above its file (`area` is not a spec).
    expect(shows).toEqual([
      "show --type spec area",
      "show --type spec area/nested",
      "show --type spec main",
      "show with-ids"
    ]);
  });

  it("an id is placed only by what show returned for a name list returned", async () => {
    write("openspec/changes/listed/specs/cap/spec.md", requirement("REQ-TST-001") + requirement("REQ-TST-002"));
    write("openspec/changes/unlisted/specs/cap/spec.md", requirement("REQ-TST-003"));

    const openspec = new StubOpenSpec({ listed: [placed("REQ-TST-001")] }, {}, () => 0, true, {
      unlisted: [placed("REQ-TST-003")]
    });
    const result = await checkPlacement({ openspec }, scanIds(root).ids);

    expect(openspec.calls.filter((call) => call.startsWith("show")).sort()).toEqual(["show listed", "show unlisted"]);
    expect(result.errors.map((e) => [e.code, e.path, e.message.split(" ")[0]])).toEqual([
      ["ID_PLACEMENT", "openspec/changes/listed/specs/cap/spec.md", "REQ-TST-002"],
      ["ID_PLACEMENT", "openspec/changes/unlisted/specs/cap/spec.md", "REQ-TST-003"]
    ]);
  });

  it(`runs at most ${SHOW_CONCURRENCY} shows at once and reports in scan order whatever the finish order`, async () => {
    const names = Array.from({ length: 10 }, (_, i) => `spec-${String(i).padStart(2, "0")}`);
    const specs: Record<string, string[]> = {};
    names.forEach((name, i) => {
      const nnn = String(i + 1).padStart(3, "0");
      write(`openspec/specs/${name}/spec.md`, requirement(`REQ-TST-${nnn}`) + requirement(`SCN-TST-${nnn}`));
      // Only the scenarios come back placed: every requirement is a finding.
      specs[name] = [placed(`SCN-TST-${nnn}`)];
    });
    const ids = scanIds(root).ids;

    const forward = new StubOpenSpec({}, specs, (name) => names.indexOf(name) * 3);
    const backward = new StubOpenSpec({}, specs, (name) => (names.length - names.indexOf(name)) * 3);
    const first = await checkPlacement({ openspec: forward }, ids);
    const second = await checkPlacement({ openspec: backward }, ids);

    expect(forward.maxInFlight).toBe(SHOW_CONCURRENCY);
    expect(backward.maxInFlight).toBe(SHOW_CONCURRENCY);
    expect(second).toEqual(first);
    expect(first.errors.map((e) => e.message.split(" ")[0])).toEqual(
      names.map((_, i) => `REQ-TST-${String(i + 1).padStart(3, "0")}`)
    );
  });

  it("no REQ or SCN id to check — no openspec call; openspec absent — skipped without list or show", async () => {
    write("openspec/changes/c/tasks.md", "<!-- id: TASK-TST-001 -->\n");
    const none = new StubOpenSpec({ c: [] }, {});
    expect(await checkPlacement({ openspec: none }, scanIds(root).ids)).toEqual({ errors: [], skipped: false });
    expect(none.calls).toEqual([]);

    write("openspec/specs/main/spec.md", requirement("REQ-TST-001"));
    const absent = new StubOpenSpec({}, { main: [] }, () => 0, false);
    expect(await checkPlacement({ openspec: absent }, scanIds(root).ids)).toEqual({ errors: [], skipped: true });
    expect(absent.calls).toEqual(["version"]);
  });
});
