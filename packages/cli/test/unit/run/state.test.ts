/**
 * The own state of a Change and the state of any Change (N27, REQ-VER-004,
 * REQ-KRN-028; `core/run/state.ts`): record, evidence directory, Run files
 * naming the Change and their envelopes, under `.warrant` or a
 * `WARRANT_STATE_DIR` inside or outside the project.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { otherState, ownState } from "../../../src/core/run/state.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const OWN_RUN = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y";
const OTHER_RUN = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X7Z";

/** A finished `review` Run of `change`, valid by `warrant://run/1`. */
function runJson(id: string, change: string): Record<string, unknown> {
  return {
    $schema: "warrant://run/1",
    id,
    change,
    operation: "review",
    write_scope: [],
    scope: [],
    spec_tree: `sha256:${"3".repeat(64)}`,
    branch: `spec/${change}`,
    started_at: "2026-09-25T10:00:00Z",
    finished_at: "2026-09-25T10:12:00Z",
    run_state: "SUCCEEDED",
    context_hash: `sha256:${"1".repeat(64)}`,
    effective_policy_hash: `sha256:${"2".repeat(64)}`,
    guard_events: []
  };
}

/** A project root whose `<state>/runs/` (relative to the root) holds a Run of `add-search` and one of `other`. */
function withRuns(root: string, state = ".warrant"): string {
  const runs = path.join(root, state, "runs");
  mkdirSync(runs, { recursive: true });
  writeFileSync(path.join(runs, `${OWN_RUN}.json`), JSON.stringify(runJson(OWN_RUN, "add-search")));
  writeFileSync(path.join(runs, `${OTHER_RUN}.json`), JSON.stringify(runJson(OTHER_RUN, "other")));
  return root;
}

const dirs: string[] = [];
function tempRoot(): string {
  const dir = makeTempDir("warrant-state-");
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe("ownState / otherState", () => {
  it("own: the record, evidence and Runs of the Change with their envelopes; nothing of other Changes", () => {
    const root = withRuns(tempRoot());
    const own = ownState(root, "add-search", {});
    for (const p of [
      ".warrant/changes/add-search.json",
      ".warrant/evidence/add-search/manifest.json",
      ".warrant/evidence/add-search/EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json",
      `.warrant/runs/${OWN_RUN}.json`,
      `.warrant/runs/${OWN_RUN}.result.json`
    ]) {
      expect(own(p), p).toBe(true);
    }
    for (const p of [
      ".warrant/changes/other.json",
      ".warrant/evidence/other/manifest.json",
      ".warrant/evidence/add-search-2/manifest.json",
      `.warrant/runs/${OTHER_RUN}.json`,
      `.warrant/runs/${OTHER_RUN}.result.json`,
      ".warrant/runs/current",
      ".warrant/warrant.json",
      ".warrant/local/areas.json",
      "openspec/changes/add-search/proposal.md"
    ]) {
      expect(own(p), p).toBe(false);
    }
  });

  it("other: the state of any Change, not the configuration of the project", () => {
    const root = withRuns(tempRoot());
    const other = otherState(root, {});
    for (const p of [
      ".warrant/changes/other.json",
      ".warrant/changes/add-search.json",
      ".warrant/evidence/other/manifest.json",
      `.warrant/runs/${OTHER_RUN}.json`,
      `.warrant/runs/${OTHER_RUN}.result.json`,
      // A Run file nobody can read any more (removed, broken) is still a Run file.
      ".warrant/runs/RUN-01J8Z3KQ2M7N4P6R8T0V2W4X8A.json"
    ]) {
      expect(other(p), p).toBe(true);
    }
    for (const p of [".warrant/warrant.json", ".warrant/local/areas.json", ".warrant/runs/current", ".warrant/evidence/README.md", "src/app.py"]) {
      expect(other(p), p).toBe(false);
    }
  });

  it("follows WARRANT_STATE_DIR inside the project; outside it only records match", () => {
    const inside = withRuns(tempRoot(), "state");
    const env = { WARRANT_STATE_DIR: "state" };
    const own = ownState(inside, "add-search", env);
    expect(own(".warrant/changes/add-search.json")).toBe(true);
    expect(own("state/evidence/add-search/manifest.json")).toBe(true);
    expect(own(`state/runs/${OWN_RUN}.json`)).toBe(true);
    expect(own(".warrant/evidence/add-search/manifest.json")).toBe(false);
    expect(otherState(inside, env)(`state/runs/${OTHER_RUN}.json`)).toBe(true);

    const outside = tempRoot();
    const away = { WARRANT_STATE_DIR: path.join(tempRoot(), "state") };
    expect(ownState(outside, "add-search", away)(".warrant/changes/add-search.json")).toBe(true);
    expect(ownState(outside, "add-search", away)(".warrant/evidence/add-search/manifest.json")).toBe(false);
    expect(otherState(outside, away)(".warrant/evidence/other/manifest.json")).toBe(false);
  });
});
