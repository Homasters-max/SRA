/**
 * `FRONTEND_HOOKS_INACTIVE` in `verify`, `gate` and `status` in the test
 * process (REQ-VER-009, SCN-VER-053…055, F10): a path of the Change's diff
 * under `paths.src` ∪ `paths.tests` without a `post` event of `warrant guard`
 * in the Runs of the Change. `verify` and `gate` name it on `VERIFYING->MERGED`,
 * `status` from `IMPLEMENTING` on; the verdicts, `controller_action` and the
 * exit code are those without it.
 *
 * Each case builds the synced core-sdd project with `paths.src: src`,
 * `paths.tests: tests` and Change `add-search` in `IMPLEMENTING` on `main`,
 * starts a Run, then commits the edits of the case on a branch with the
 * record in `VERIFYING`. The events come from `warrant guard` itself.
 */
import { describe, expect, it } from "vitest";

import { runGate } from "../../../src/commands/gate.js";
import { runGuard } from "../../../src/commands/guard.js";
import { runStart } from "../../../src/commands/run.js";
import { runStatus } from "../../../src/commands/status.js";
import { runVerify } from "../../../src/commands/verify.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** Environment of a local run: `<state>` is `.warrant`, no CI attestation. */
const LOCAL: NodeJS.ProcessEnv = {};
const MERGE = "VERIFYING->MERGED";
const CODE = "FRONTEND_HOOKS_INACTIVE";
const FEATURE = { classification: { profiles: ["feature"] } };

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

/** The synced project with `paths.*` and `add-search` in `IMPLEMENTING` on `main`, a Run started on a branch. */
async function implementing(paths: Record<string, string> = { src: "src", tests: "tests" }): Promise<ProjectBuilder> {
  const code = Object.keys(paths).length > 0;
  const p = project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      ...(code ? { paths } : {}),
      roles: { maintainer: ["kat"] }
    })
    .withChange("add-search", { design: "# Design\n", tasks: "## 1. Search\n\n- [ ] 1.1 Index\n", specs: { search: [] } })
    .withRecord("add-search", "IMPLEMENTING", FEATURE)
    .withOpenspecValidate();
  await p.synced();
  p.commit("base");
  p.branch("worktree/add-search");
  // `run start --operation implement` needs paths.src or paths.tests.
  if (code) {
    const started = await invoke(() => runStart(p.ctx, "add-search", { operation: "implement" }, LOCAL));
    expect(started.errors).toEqual([]);
  }
  return p;
}

/** `warrant guard` with a `post` event of an edit of `paths`. */
async function posted(p: ProjectBuilder, paths: string[]): Promise<void> {
  const input = JSON.stringify({ phase: "post", action: "edit", paths, cwd: p.root });
  const result = await invoke(() => runGuard(p.ctx, input, LOCAL));
  expect(result.errors).toEqual([]);
}

/** Writes `files`, puts the record in `state` and commits the impl-PR. */
function implemented(p: ProjectBuilder, files: string[], state = "VERIFYING"): void {
  for (const file of files) p.write(file, `# ${file}\n`);
  p.withRecord("add-search", state, FEATURE);
  p.commit("impl");
}

function verify(p: ProjectBuilder): Promise<Result> {
  return invoke(() => runVerify(p.ctx, "add-search", { transition: MERGE }, LOCAL));
}

function gate(p: ProjectBuilder, transition = MERGE): Promise<Result> {
  return invoke(() => runGate(p.ctx, "add-search", [], { transition }, LOCAL));
}

async function statusFindings(p: ProjectBuilder): Promise<Data[]> {
  const result = await invoke(() => runStatus(p.ctx, "add-search", LOCAL));
  return result.data["verification"]["findings"] as Data[];
}

function hooksFinding(findings: readonly Data[]): Data | undefined {
  return findings.find((f) => f["code"] === CODE);
}

/** What the finding must not change: verdicts, controller fields, exit code. */
function outcome(result: Result): Data {
  const { gates, controller_action, rule, next } = result.data;
  return { gates, controller_action, rule, next, exitCode: result.exitCode, errors: result.errors.map((e) => e.code) };
}

describe("FRONTEND_HOOKS_INACTIVE", () => {
  it("verify names an edit without a post event; verdicts and exit code are those without it (SCN-VER-053)", async () => {
    const p = await implementing();
    await posted(p, ["src/search.py"]);
    implemented(p, ["src/search.py", "src/app.py"]);

    const without = await verify(p);
    expect(without.data["findings"]).toContainEqual({ code: CODE, paths: ["src/app.py"], more: 0, message: expect.stringContaining("src/app.py") });
    expect(hooksFinding(without.data["findings"])).not.toHaveProperty("gate");

    // The same diff once the edit has its post event: only the finding goes away.
    await posted(p, ["src/app.py"]);
    const with_ = await verify(p);
    expect(hooksFinding(with_.data["findings"])).toBeUndefined();
    expect(outcome(without)).toEqual(outcome(with_));
    expect(without.data["findings"].filter((f: Data) => f["code"] !== CODE)).toEqual(with_.data["findings"]);
  });

  it("gate names it on VERIFYING->MERGED only, with the same verdicts and exit code", async () => {
    const p = await implementing();
    implemented(p, ["src/app.py"]);

    const merge = await gate(p);
    expect(hooksFinding(merge.data["findings"])).toMatchObject({ paths: ["src/app.py"], more: 0 });
    const other = await gate(p, "IMPLEMENTING->VERIFYING");
    expect(hooksFinding(other.data["findings"])).toBeUndefined();

    await posted(p, ["src/app.py"]);
    const covered = await gate(p);
    expect(hooksFinding(covered.data["findings"])).toBeUndefined();
    expect(outcome(merge)).toEqual(outcome(covered));
  });

  it("is absent from status and verify when every code path has a post event; docs/notes.md does not count (SCN-VER-054)", async () => {
    const p = await implementing();
    await posted(p, ["src/app.py"]);
    await posted(p, ["tests/test_app.py"]);
    implemented(p, ["src/app.py", "tests/test_app.py", "docs/notes.md"]);

    expect(hooksFinding(await statusFindings(p))).toBeUndefined();
    expect(hooksFinding((await verify(p)).data["findings"])).toBeUndefined();
  });

  it("names 10 paths and more: 3 for 13 files without guard events (SCN-VER-055)", async () => {
    const p = await implementing();
    const files = Array.from({ length: 13 }, (_, i) => `src/m${String(i).padStart(2, "0")}.py`);
    implemented(p, files);

    const finding = hooksFinding((await gate(p)).data["findings"]);
    expect(finding).toMatchObject({ paths: files.slice(0, 10), more: 3 });
  });

  it("status names it from IMPLEMENTING on, not before", async () => {
    const p = await implementing();
    implemented(p, ["src/app.py"], "IMPLEMENTING");
    expect(hooksFinding(await statusFindings(p))).toMatchObject({ paths: ["src/app.py"], more: 0 });

    p.withRecord("add-search", "VERIFYING", FEATURE);
    expect(hooksFinding(await statusFindings(p))).toMatchObject({ paths: ["src/app.py"] });

    p.withRecord("add-search", "APPROVED", FEATURE);
    expect(hooksFinding(await statusFindings(p))).toBeUndefined();
  });

  it("is not computed without paths.src and paths.tests", async () => {
    const p = await implementing({});
    implemented(p, ["src/app.py"]);
    expect(hooksFinding((await gate(p)).data["findings"])).toBeUndefined();
    expect(hooksFinding(await statusFindings(p))).toBeUndefined();
  });
});
