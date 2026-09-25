/**
 * `warrant run start` / `run finish` in the test process (REQ-ENF-001…003,
 * SCN-ENF-002, 004…010): the Run file and `current`, `write_scope` by
 * operation, the Context Pack, one active Run per worktree, `--dry-run`, the
 * lock of the Run file (F18) and a `hint` on every error (REQ-KRN-002).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runFinish, runStart, type RunFinishOptions, type RunStartOptions } from "../../../src/commands/run.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { withoutDryRun, writtenBeyond } from "../helpers/dry-run.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const RUNS = ".warrant/runs";
const CURRENT = `${RUNS}/current`;

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function start(p: ProjectBuilder, change: string | undefined, opts: RunStartOptions, ctx = p.ctx): Promise<Result> {
  return invoke(() => runStart(ctx, change, opts, ENV));
}

function finish(p: ProjectBuilder, opts: RunFinishOptions = {}, ctx = p.ctx): Promise<Result> {
  return invoke(() => runFinish(ctx, opts, ENV));
}

/** Run files of the project (`RUN-*.json`). */
function runFiles(p: ProjectBuilder): string[] {
  const dir = path.join(p.root, ".warrant", "runs");
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^RUN-.*\.json$/.test(f)) : [];
}

function readRun(p: ProjectBuilder, id: string): Data {
  return JSON.parse(p.read(`${RUNS}/${id}.json`)) as Data;
}

/** A synced project with `add-search` in `state`, `paths.src: src`, `paths.tests: tests`. */
async function repo(state: string, configure: (p: ProjectBuilder) => void = () => undefined): Promise<ProjectBuilder> {
  const p = project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      paths: { src: "src", tests: "tests" },
      roles: { maintainer: ["kat"] }
    })
    .withRecord("add-search", state)
    .withChange("add-search", { tasks: "## 1. Search\n\n- [ ] 1.1 Index\n" });
  configure(p);
  return p.synced();
}

function rule(p: ProjectBuilder, id: string, paths: string[]): void {
  p.write(`.warrant/local/rules/${id}.json`, { $schema: "warrant://rule/1", id, paths, text: `Rule ${id}.` });
}

describe("warrant run start", () => {
  it("specify in PROPOSED: a RUNNING Run, current names it, the Context Pack lists proposal.md (SCN-ENF-004)", async () => {
    const p = await repo("PROPOSED");
    const run = await start(p, "add-search", { operation: "specify", task: "1.1" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.change).toBe("add-search");

    const id = run.data["run"] as string;
    expect(id).toMatch(/^RUN-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(p.read(CURRENT)).toBe(`${id}\n`);
    expect(runFiles(p)).toEqual([`${id}.json`]);
    const stored = readRun(p, id);
    expect(stored).toMatchObject({
      $schema: "warrant://run/1",
      id,
      change: "add-search",
      operation: "specify",
      task: "1.1",
      write_scope: ["openspec/changes/add-search/**"],
      scope: [],
      run_state: "RUNNING",
      context_hash: run.data["context_hash"],
      guard_events: []
    });
    expect(stored["effective_policy_hash"]).toMatch(/^sha256:/);
    // Written by the CLI: canonical and valid, `validate` stays green.
    expect(p.read(`${RUNS}/${id}.json`)).toBe(canonicalText(stored as never).text);
    expect(await validateErrors(p)).toEqual([]);

    expect(Object.keys(run.data)).toEqual(["run", "change", "operation", "write_scope", "scope", "rules", "items", "context_hash"]);
    expect(run.data["write_scope"]).toEqual(["openspec/changes/add-search/**"]);
    expect(run.data["items"].map((i: Data) => i.path)).toEqual([
      "openspec/changes/add-search/proposal.md",
      "openspec/changes/add-search/tasks.md"
    ]);
    expect(run.data["rules"]).toEqual([]);
  });

  it("implement in PROPOSED: STATE_INVALID with a hint naming IMPLEMENTING, no Run file, exit 3 (SCN-ENF-005)", async () => {
    const p = await repo("PROPOSED");
    const run = await start(p, "add-search", { operation: "implement" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("STATE_INVALID");
    expect(run.errors[0]?.hint).toMatch(/IMPLEMENTING/);
    expect(run.errors[0]?.message).not.toMatch(/warrant transition/);
    expect(runFiles(p)).toEqual([]);
    expect(existsSync(path.join(p.root, ".warrant", "runs", "current"))).toBe(false);
  });

  it("specify outside PROPOSED is STATE_INVALID with a hint too", async () => {
    const p = await repo("IMPLEMENTING");
    const run = await start(p, "add-search", { operation: "specify" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("STATE_INVALID");
    expect(run.errors[0]?.hint).toMatch(/--operation implement/);
  });

  it("a second start while a Run is RUNNING: RUN_ACTIVE with warrant run finish, the Run unchanged, exit 3 (SCN-ENF-006)", async () => {
    const p = await repo("PROPOSED");
    const first = await start(p, "add-search", { operation: "specify" });
    const id = first.data["run"] as string;
    const before = p.tree();

    const second = await start(p, "add-search", { operation: "specify" });
    expect(second.exitCode).toBe(3);
    expect(second.errors[0]?.code).toBe("RUN_ACTIVE");
    expect(second.errors[0]?.hint).toContain("warrant run finish");
    expect(second.errors[0]?.path).toBe(CURRENT);
    expect(p.tree()).toEqual(before);
    expect(readRun(p, id)["run_state"]).toBe("RUNNING");
  });

  it("implement --scope narrows write_scope; rules[] holds the rule inside the final scope only (SCN-ENF-007)", async () => {
    const p = await repo("IMPLEMENTING", (b) => {
      b.write("src/search/index.py", "x = 1\n").write("src/other/util.py", "y = 2\n").write("docs/notes.md", "notes\n");
      rule(b, "docs-style", ["docs/**"]);
      rule(b, "search-api", ["src/search/**"]);
    });
    const run = await start(p, "add-search", { operation: "implement", scope: "src/search/**" });
    expect(run.errors).toEqual([]);
    expect(run.data["write_scope"]).toEqual(["src/**", "tests/**", "openspec/changes/add-search/tasks.md"]);
    expect(run.data["scope"]).toEqual(["src/search/**"]);
    expect(run.data["rules"]).toEqual([{ id: "search-api", paths: ["src/search/**"], text: "Rule search-api." }]);
    const stored = readRun(p, run.data["run"]);
    expect(stored["write_scope"]).toEqual(run.data["write_scope"]);
    expect(stored["scope"]).toEqual(["src/search/**"]);
  });

  it("implement without paths.src and paths.tests: CONFIG_INVALID with a hint, nothing written", async () => {
    const p = await repo("IMPLEMENTING", (b) => {
      b.write(".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version: CORE_SDD_RANGE } },
        roles: { maintainer: ["kat"] }
      });
    });
    const run = await start(p, "add-search", { operation: "implement" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_INVALID");
    expect(run.errors[0]?.hint).toMatch(/paths/);
    expect(runFiles(p)).toEqual([]);
  });

  it("--dry-run: the same JSON with dry_run and would_write[] of the Run file and current, no file created (SCN-ENF-008)", async () => {
    const p = await repo("PROPOSED");
    const before = p.tree();
    const dry = await start(p, "add-search", { operation: "specify" }, p.dryRun());
    expect(dry.errors).toEqual([]);
    expect(dry.exitCode).toBe(0);
    expect(dry.data["dry_run"]).toBe(true);
    expect(dry.data["would_write"]).toEqual([`${RUNS}/${dry.data["run"] as string}.json`, CURRENT]);
    expect(p.tree()).toEqual(before);

    const real = await start(p, "add-search", { operation: "specify" });
    expect(withoutDryRun(dry.data)).toEqual(withoutDryRun(real.data));
    expect(writtenBeyond(before, p.tree(), dry.data["would_write"])).toEqual([]);
  });

  it("a refusal under --dry-run is the same refusal with dry_run", async () => {
    const p = await repo("PROPOSED");
    const dry = await start(p, "add-search", { operation: "implement" }, p.dryRun());
    expect(dry.exitCode).toBe(3);
    expect(dry.errors[0]?.code).toBe("STATE_INVALID");
    expect(dry.data).toEqual({ dry_run: true, would_write: [] });
  });

  it("every error carries a hint: usage, a missing Change, no warrant.json (REQ-KRN-002)", async () => {
    const p = await repo("PROPOSED");
    const results = [
      await start(p, undefined, { operation: "specify" }),
      await start(p, "add-search", {}),
      await start(p, "add-search", { operation: "review" }),
      await start(p, "add-search", { operation: "specify", scope: " , " }),
      await start(p, "no-such-change", { operation: "specify" }),
      await finish(p, { state: "DONE" })
    ];
    expect(results.map((r) => r.errors[0]?.code)).toEqual(["USAGE", "USAGE", "USAGE", "USAGE", "CHANGE_NOT_FOUND", "USAGE"]);
    for (const r of results) {
      expect(r.exitCode).toBe(3);
      expect(r.errors.every((e) => typeof e.hint === "string" && e.hint.length > 0)).toBe(true);
    }
    p.remove(".warrant/warrant.json");
    const missing = await start(p, "add-search", { operation: "specify" });
    expect(missing.errors[0]?.code).toBe("CONFIG_MISSING");
    expect(missing.errors[0]?.hint).toMatch(/warrant init/);
  });

  it("current naming a Run that does not read: refused with the file and a hint (fix or delete current)", async () => {
    const p = await repo("PROPOSED");
    p.write(CURRENT, "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y\n");
    const run = await start(p, "add-search", { operation: "specify" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.path).toBe(`${RUNS}/RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y.json`);
    expect(run.errors[0]?.hint).toContain(CURRENT);
  });
});

describe("warrant run finish", () => {
  it("--state FAILED: run_state and finished_at written, current removed, a new start passes (SCN-ENF-009)", async () => {
    const p = await repo("PROPOSED");
    const started = await start(p, "add-search", { operation: "specify" });
    const id = started.data["run"] as string;

    const run = await finish(p, { state: "FAILED" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.change).toBe("add-search");
    expect(run.data).toEqual({ run: id, change: "add-search", operation: "specify", run_state: "FAILED", finished_at: expect.any(String) });
    const stored = readRun(p, id);
    expect(stored["run_state"]).toBe("FAILED");
    expect(stored["finished_at"]).toBe(run.data["finished_at"]);
    expect(existsSync(path.join(p.root, ".warrant", "runs", "current"))).toBe(false);
    // The lock of the Run is gone with the write.
    expect(existsSync(path.join(p.root, ".warrant", "runs", `${id}.lock`))).toBe(false);
    expect(await validateErrors(p)).toEqual([]);

    const again = await start(p, "add-search", { operation: "specify" });
    expect(again.errors).toEqual([]);
    expect(runFiles(p)).toHaveLength(2);
  });

  it("the default state is SUCCEEDED", async () => {
    const p = await repo("PROPOSED");
    await start(p, "add-search", { operation: "specify" });
    expect((await finish(p)).data["run_state"]).toBe("SUCCEEDED");
  });

  it("without current: RUN_NOT_ACTIVE with warrant run start, exit 3 (SCN-ENF-010)", async () => {
    const p = await repo("PROPOSED");
    const run = await finish(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("RUN_NOT_ACTIVE");
    expect(run.errors[0]?.hint).toContain("warrant run start");
  });

  it("a Run that is not RUNNING is not active, even if current names it (REQ-ENF-003)", async () => {
    const p = await repo("PROPOSED");
    const started = await start(p, "add-search", { operation: "specify" });
    const id = started.data["run"] as string;
    await finish(p, { state: "CANCELLED" });
    p.write(CURRENT, `${id}\n`);

    const run = await finish(p);
    expect(run.errors[0]?.code).toBe("RUN_NOT_ACTIVE");
    const second = await start(p, "add-search", { operation: "specify" });
    expect(second.errors).toEqual([]);
  });

  it("--dry-run: the same JSON, would_write[] of the Run file and current, the tree unchanged (REQ-KRN-034)", async () => {
    const p = await repo("PROPOSED");
    const started = await start(p, "add-search", { operation: "specify" });
    const id = started.data["run"] as string;
    const before = p.tree();

    const dry = await finish(p, { state: "FAILED" }, p.dryRun());
    expect(dry.errors).toEqual([]);
    expect(dry.data["would_write"]).toEqual([`${RUNS}/${id}.json`, CURRENT]);
    expect(p.tree()).toEqual(before);

    const real = await finish(p, { state: "FAILED" });
    const { finished_at: _dryAt, ...dryRest } = withoutDryRun(dry.data);
    const { finished_at: _realAt, ...realRest } = withoutDryRun(real.data);
    expect(dryRest).toEqual(realRest);
    expect(writtenBeyond(before, p.tree(), dry.data["would_write"])).toEqual([]);
  });

  it("the lock of the Run held by another process: BUSY after the wait, exit 2, the Run unchanged (F18)", async () => {
    const p = await repo("PROPOSED");
    const started = await start(p, "add-search", { operation: "specify" });
    const id = started.data["run"] as string;
    const lock = path.join(p.root, ".warrant", "runs", `${id}.lock`);
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: 4242, what: "guard", at: "2026-09-25T10:00:00.000Z" }), "utf8");

    const run = await finish(p);
    expect(run.exitCode).toBe(2);
    expect(run.errors[0]?.code).toBe("BUSY");
    expect(run.errors[0]?.message).toContain("4242");
    expect(run.errors[0]?.hint).toContain(`${RUNS}/${id}.lock`);
    expect(readRun(p, id)["run_state"]).toBe("RUNNING");
    expect(p.read(CURRENT)).toBe(`${id}\n`);
    // Someone else's lock stays (D-23); no interrupt cleanup is left registered.
    expect(existsSync(lock)).toBe(true);
    expect(p.signals.registered).toBe(0);
  });
});

describe("warrant validate over Run files (SCN-ENF-002)", () => {
  it("an event with decision ask is SCHEMA_VIOLATION at /guard_events/0/decision", async () => {
    const p = await repo("PROPOSED");
    const started = await start(p, "add-search", { operation: "specify" });
    const id = started.data["run"] as string;
    const stored = readRun(p, id);
    stored["guard_events"] = [
      { at: "2026-09-25T10:00:00.000Z", phase: "pre", action: "edit", paths: ["docs/a.md"], decision: "ask", findings: [], rules_shown: [] }
    ];
    p.write(`${RUNS}/${id}.json`, stored);
    const errors = await validateErrors(p);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: "SCHEMA_VIOLATION", path: `${RUNS}/${id}.json#/guard_events/0/decision` })
    );
  });
});
