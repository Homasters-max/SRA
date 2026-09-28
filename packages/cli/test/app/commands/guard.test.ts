/**
 * `warrant guard` without `--frontend` in the test process (REQ-ENF-004,
 * SCN-ENF-011…016, SCN-ENF-037…041, F8, F9, F16, F18): the normalised event, `pre` of an edit
 * with and without a Run, `pre` of a shell command against `guard_prefixes`,
 * the hints of `post`, the failures that close `pre` and open `post`, the
 * events in `guard_events[]` and the lock of the Run. Exit 0 whatever the
 * decision.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runGuard } from "../../../src/commands/guard.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { started } from "../helpers/run.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const RUNS = ".warrant/runs";

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

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

/** `warrant guard` on `event`; `cwd` is the project root unless the event names one. */
async function guard(p: ProjectBuilder, event: Record<string, unknown> | string, env: NodeJS.ProcessEnv = ENV): Promise<Result> {
  const input = typeof event === "string" ? event : JSON.stringify({ paths: [], cwd: p.root, ...event });
  const result = await invoke(() => runGuard(p.ctx, input, env));
  // The decision is data, not an error (design §6).
  expect(result.exitCode).toBe(0);
  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
  return result;
}

function events(p: ProjectBuilder, id: string): Data[] {
  return (JSON.parse(p.read(`${RUNS}/${id}.json`)) as Data)["guard_events"] as Data[];
}

describe("warrant guard: pre edit with an active Run", () => {
  it("a path outside write_scope is denied, the Run records the event (SCN-ENF-011)", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["docs/readme.md"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain("docs/readme.md");
    expect(result.data["reason"]).toContain("write_scope");
    expect(result.data["reason"]).toContain("src/**");
    expect(events(p, id)).toEqual([
      {
        at: expect.any(String),
        phase: "pre",
        action: "edit",
        paths: ["docs/readme.md"],
        decision: "deny",
        reason: result.data["reason"],
        findings: [],
        rules_shown: []
      }
    ]);
  });

  it("inside write_scope: allow without hints; a path from cwd, an absolute one, tasks.md, design.md and specs/** of the Change, not proposal.md (SCN-ENF-036)", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const relative = await guard(p, { phase: "pre", action: "edit", paths: ["app.py"], cwd: path.join(p.root, "src") });
    expect(relative.data).toEqual({ decision: "allow", hints: [] });
    const absolute = await guard(p, { phase: "pre", action: "edit", paths: [path.join(p.root, "tests", "test_app.py")] });
    expect(absolute.data["decision"]).toBe("allow");
    const tasks = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/tasks.md"] });
    expect(tasks.data["decision"]).toBe("allow");
    const design = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/design.md"] });
    expect(design.data["decision"]).toBe("allow");
    const spec = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/specs/search/spec.md"] });
    expect(spec.data["decision"]).toBe("allow");
    const proposal = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/proposal.md"] });
    expect(proposal.data["decision"]).toBe("deny");
    expect(events(p, id).map((e) => [e["paths"], e["decision"]])).toEqual([
      [["src/app.py"], "allow"],
      [["tests/test_app.py"], "allow"],
      [["openspec/changes/add-search/tasks.md"], "allow"],
      [["openspec/changes/add-search/design.md"], "allow"],
      [["openspec/changes/add-search/specs/search/spec.md"], "allow"],
      [["openspec/changes/add-search/proposal.md"], "deny"]
    ]);
  });

  it("a non-empty scope narrows: a path of write_scope outside scope is denied, the reason names the scope", async () => {
    const p = await repo("IMPLEMENTING");
    await started(p, "add-search", { operation: "implement", scope: "src/search/**" });
    expect((await guard(p, { phase: "pre", action: "edit", paths: ["src/search/index.py"] })).data["decision"]).toBe("allow");
    const other = await guard(p, { phase: "pre", action: "edit", paths: ["src/search/index.py", "src/other.py"] });
    expect(other.data["decision"]).toBe("deny");
    expect(other.data["reason"]).toContain("src/other.py");
    expect(other.data["reason"]).not.toContain("src/search/index.py outside");
    expect(other.data["reason"]).toContain("scope: src/search/**");
  });

  it("a path outside the project is not guarded: allow, the event keeps project paths only", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const result = await guard(p, { phase: "pre", action: "edit", paths: [path.join(path.dirname(p.root), "elsewhere.md"), "../x.md"] });
    expect(result.data["decision"]).toBe("allow");
    expect(events(p, id)[0]?.["paths"]).toEqual([]);
  });

  it("action other: allow, and the event is recorded", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    expect((await guard(p, { phase: "pre", action: "other", paths: ["docs/a.md"] })).data).toEqual({ decision: "allow", hints: [] });
    expect(events(p, id)[0]).toMatchObject({ phase: "pre", action: "other", decision: "allow" });
  });
});

describe("warrant guard: a deny whose way out is not a Run (BL-56, I-190)", () => {
  const joined = (result: Result): string => (result.data["hints"] as string[]).join("\n");

  it("a policy path no Run writes: the hint names a human edit in factory-change, not run start or run finish (SCN-ENF-038)", async () => {
    const p = await repo("IMPLEMENTING");
    const areas = await guard(p, { phase: "pre", action: "edit", paths: [".warrant/local/areas.json"] });
    expect(areas.data["decision"]).toBe("deny");
    expect(joined(areas)).toContain("maintainer");
    expect(joined(areas)).toContain("factory-change");
    expect(joined(areas)).not.toContain("warrant run start");
    expect(joined(areas)).not.toContain("warrant run finish");

    await started(p);
    const workflow = await guard(p, { phase: "pre", action: "edit", paths: [".github/workflows/ci.yml"] });
    expect(workflow.data["decision"]).toBe("deny");
    expect(workflow.data["hints"]).toEqual(areas.data["hints"]);
    const docs = await guard(p, { phase: "pre", action: "edit", paths: ["docs/notes.md"] });
    expect(docs.data["decision"]).toBe("deny");
    expect(docs.data["hints"]).toEqual([expect.stringContaining("warrant run finish")]);
  });

  it("the state the CLI writes: the hint names its commands, not factory-change, run start or run finish (SCN-ENF-039)", async () => {
    const p = await repo("IMPLEMENTING");
    const record = await guard(p, { phase: "pre", action: "edit", paths: [".warrant/changes/add-search.json"] });
    await started(p);
    const waiver = await guard(p, { phase: "pre", action: "edit", paths: [".warrant/waivers/WAV-2026-001.json"] });
    for (const result of [record, waiver]) {
      expect(result.data["decision"]).toBe("deny");
      for (const command of ["warrant transition", "warrant unknown", "warrant waive"]) expect(joined(result)).toContain(command);
      for (const absent of ["factory-change", "warrant run start", "warrant run finish"]) expect(joined(result)).not.toContain(absent);
    }
  });

  it("paths of several classes: one hint per class present; <state> follows WARRANT_STATE_DIR", async () => {
    const p = await repo("IMPLEMENTING");
    const mixed = await guard(p, { phase: "pre", action: "edit", paths: [".warrant/evidence/add-search/manifest.json", ".warrant/local/areas.json", "src/app.py"] });
    expect(mixed.data["hints"]).toHaveLength(3);
    expect(joined(mixed)).toContain("warrant transition");
    expect(joined(mixed)).toContain("factory-change");
    expect(joined(mixed)).toContain("warrant run start");

    const input = JSON.stringify({ phase: "pre", action: "edit", paths: ["state/runs/x.json", ".warrant/evidence/add-search/manifest.json"], cwd: p.root });
    const moved = await invoke(() => runGuard(p.ctx, input, { WARRANT_STATE_DIR: "state" }));
    // `state/**` is under no guarded glob; `.warrant/evidence` is no longer where the CLI writes: a policy path.
    expect(moved.data["decision"]).toBe("deny");
    expect(moved.data["hints"]).toEqual([expect.stringContaining("factory-change")]);
  });
});

describe("warrant guard: pre edit without a Run", () => {
  it("code is denied with the hint run start; docs are allowed with the same hint (SCN-ENF-012)", async () => {
    const p = await repo("IMPLEMENTING");
    const code = await guard(p, { phase: "pre", action: "edit", paths: ["src/app.py"] });
    expect(code.data["decision"]).toBe("deny");
    expect(code.data["reason"]).toContain("src/app.py");
    expect(code.data["hints"]).toEqual([expect.stringContaining("warrant run start <change> --operation")]);
    const docs = await guard(p, { phase: "pre", action: "edit", paths: ["docs/notes.md"] });
    expect(docs.data["decision"]).toBe("allow");
    expect(docs.data["hints"]).toEqual(code.data["hints"]);
    // No Run: no event anywhere.
    expect(existsSync(path.join(p.root, ".warrant", "runs"))).toBe(false);
  });

  it("tests, openspec/changes/** and the policy paths of factory-change are denied too (ADR-0022 п. 7)", async () => {
    const p = await repo("IMPLEMENTING");
    for (const file of ["tests/test_app.py", "openspec/changes/add-search/proposal.md", ".warrant/local/areas.json", "openspec/config.yaml"]) {
      const result = await guard(p, { phase: "pre", action: "edit", paths: [file] });
      expect([file, result.data["decision"]]).toEqual([file, "deny"]);
    }
    expect((await guard(p, { phase: "pre", action: "edit", paths: ["README.md"] })).data["decision"]).toBe("allow");
    // Several paths: each is matched on its own.
    expect((await guard(p, { phase: "pre", action: "edit", paths: ["docs/a.md", "docs/b.md", "README.md"] })).data["decision"]).toBe("allow");
  });

  it("a Run that is not RUNNING is not active: the paths of code are denied as without a Run", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const stored = JSON.parse(p.read(`${RUNS}/${id}.json`)) as Data;
    p.write(`${RUNS}/${id}.json`, { ...stored, run_state: "SUCCEEDED", finished_at: "2026-09-25T11:00:00.000Z" });
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["src/app.py"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["hints"]).toEqual([expect.stringContaining("warrant run start")]);
    expect(events(p, id)).toEqual([]);
  });
});

describe("warrant guard: pre shell", () => {
  /** A project check `tests`: exclusive, `pytest -q`. */
  function testsCheck(p: ProjectBuilder, execution: Record<string, unknown> = { exclusive: true }, run: Record<string, unknown> = {}): void {
    p.write(".warrant/local/checks/tests.json", {
      $schema: "warrant://check/1",
      id: "tests",
      version: "1.0.0",
      level: "L1",
      run: { command: ["pytest", "-q"], ...run },
      execution,
      produces: ["test-report"],
      parser: "junit"
    });
  }

  it("bash -c with pytest of an exclusive check is denied, the hint names warrant check, the event keeps argv (SCN-ENF-013)", async () => {
    const p = await repo("IMPLEMENTING", (b) => testsCheck(b));
    const id = await started(p);
    const argv = ["bash", "-c", "cd src && pytest tests/"];
    const result = await guard(p, { phase: "pre", action: "shell", argv });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain("tests");
    expect(result.data["hints"]).toEqual(["warrant check add-search tests"]);
    expect(events(p, id)).toEqual([expect.objectContaining({ phase: "pre", action: "shell", decision: "deny", argv })]);
  });

  it("without a Run the hint names <change>; a command of no guarded check is allowed and its event has no argv", async () => {
    const p = await repo("IMPLEMENTING", (b) => testsCheck(b));
    const denied = await guard(p, { phase: "pre", action: "shell", argv: ["VAR=1", "pytest", "tests/"] });
    expect(denied.data["hints"]).toEqual(["warrant check <change> tests"]);
    const id = await started(p);
    expect((await guard(p, { phase: "pre", action: "shell", argv: ["ls", "&&", "npm", "run", "build"] })).data).toEqual({ decision: "allow", hints: [] });
    expect(events(p, id)).toEqual([expect.not.objectContaining({ argv: expect.anything() })]);
    // A shell command is not an edit: no Run is needed for it (F8).
    expect((await guard(p, { phase: "pre", action: "shell", argv: ["echo", "src/app.py"] })).data["decision"]).toBe("allow");
  });

  it("guard_prefixes replace the default prefix; local scoped-only guards a check that is not exclusive; --paths when it narrows", async () => {
    const p = await repo("IMPLEMENTING", (b) =>
      testsCheck(b, { local: "scoped-only", guard_prefixes: [["make", "test"]] }, { scoped_command: ["pytest", "{paths}"] })
    );
    expect((await guard(p, { phase: "pre", action: "shell", argv: ["pytest", "-q"] })).data["decision"]).toBe("allow");
    const make = await guard(p, { phase: "pre", action: "shell", argv: ["make", "test", "V=1"] });
    expect(make.data["decision"]).toBe("deny");
    expect(make.data["reason"]).toContain('execution.local: "scoped-only"');
    expect(make.data["hints"]).toEqual(["warrant check <change> tests [--paths <a,b>]"]);
  });

  it("<< in a comment or inside $((…)) is no heredoc: pytest on the next line is denied (I-167)", async () => {
    const p = await repo("IMPLEMENTING", (b) => testsCheck(b));
    for (const line of ["echo # <<X\npytest\nX", "echo $((1<<X))\npytest\nX"]) {
      const result = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", line] });
      expect(result.data["decision"], line).toBe("deny");
      expect(result.data["hints"], line).toEqual(["warrant check <change> tests"]);
    }
  });

  it("a check that may run directly is not guarded", async () => {
    const p = await repo("IMPLEMENTING", (b) => testsCheck(b, { exclusive: false, local: "allowed" }));
    expect((await guard(p, { phase: "pre", action: "shell", argv: ["pytest"] })).data["decision"]).toBe("allow");
  });

  it("the prefix of python -m pytest keeps -m pytest: python - is allowed, python -m pytest denied (SCN-ENF-037)", async () => {
    const p = await repo("IMPLEMENTING", (b) =>
      b.withCheck("python", { output: "" }, { id: "tests-passed", args: ["-m", "pytest", "--junitxml={out}"] })
    );
    const stdin = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "python - <<'EOF'"] });
    expect(stdin.data["decision"]).toBe("allow");
    const pytest = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "python -m pytest tests/"] });
    expect(pytest.data["decision"]).toBe("deny");
    expect(pytest.data["hints"]).toEqual(["warrant check <change> tests-passed"]);
  });

  it("an interpreter check keeps its mode flags: node -e and scripts allowed, node --test … denied in any order (SCN-ENF-040)", async () => {
    const args = ["--experimental-strip-types", "--test", "--test-reporter=junit", "--test-reporter-destination={out}/junit.xml", "test/**/*.test.ts"];
    const p = await repo("IMPLEMENTING", (b) => b.withCheck("node", { output: "" }, { id: "tests-passed", args }));
    const other = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "node -e 1 && node --version && node scripts/build.js"] });
    expect(other.data["decision"]).toBe("allow");
    const direct = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "node --test --experimental-strip-types test/a.test.ts"] });
    expect(direct.data["decision"]).toBe("deny");
    expect(direct.data["hints"]).toEqual(["warrant check <change> tests-passed"]);

    // declared guard_prefixes stay a strict word prefix
    p.write(".warrant/local/checks/tests-passed.json", {
      $schema: "warrant://check/1",
      id: "tests-passed",
      version: "1.0.0",
      overrides: "core-sdd:tests-passed",
      level: "L1",
      run: { command: ["node", ...args] },
      execution: { exclusive: true, guard_prefixes: [["node", "--test"]] }
    });
    const declared = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "node -e 1 && node --experimental-strip-types --test x"] });
    expect(declared.data["decision"]).toBe("allow");
    const strict = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "node --test x"] });
    expect(strict.data["decision"]).toBe("deny");
  });
});

describe("warrant guard under a review Run (REQ-ENF-004)", () => {
  /** `add-search` in PROPOSED, its spec committed, a review Run active. */
  async function underReview(): Promise<{ p: ProjectBuilder; id: string }> {
    const p = await repo("PROPOSED");
    p.commit("spec");
    return { p, id: await started(p, "add-search", { operation: "review" }) };
  }

  it("any edit is denied: a review Run only reads; the Run records the event (SCN-ENF-026)", async () => {
    const { p, id } = await underReview();
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/proposal.md"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain("only reads");
    expect(result.data["reason"]).toContain("openspec/changes/add-search/proposal.md");
    expect(result.data["hints"].join(" ")).toContain("warrant run submit");
    expect(events(p, id)).toEqual([
      expect.objectContaining({ phase: "pre", action: "edit", paths: ["openspec/changes/add-search/proposal.md"], decision: "deny" })
    ]);
  });

  it("an edit outside the project: only the temporary directory; the reason keeps no outside path (SCN-ENF-041)", async () => {
    const { p, id } = await underReview();
    const temp = mkdtempSync(path.join(tmpdir(), "warrant-temp-"));
    const elsewhere = mkdtempSync(path.join(tmpdir(), "warrant-elsewhere-"));
    const env = { TEMP: temp, TMP: temp, TMPDIR: temp };
    const envelope = await guard(p, { phase: "pre", action: "edit", paths: [path.join(temp, `${id}.envelope.json`)] }, env);
    expect(envelope.data["decision"]).toBe("allow");
    const stray = await guard(p, { phase: "pre", action: "edit", paths: [path.join(elsewhere, "x.json")] }, env);
    expect(stray.data["decision"]).toBe("deny");
    expect(stray.data["reason"]).not.toContain(path.basename(elsewhere));
    expect(stray.data["hints"].join(" ")).toContain("warrant run submit --file");
    expect(stray.data["hints"].join(" ")).toContain(path.basename(temp));
    const inProject = await guard(p, { phase: "pre", action: "edit", paths: ["openspec/changes/add-search/proposal.md"] }, env);
    expect(inProject.data["decision"]).toBe("deny");
    expect(events(p, id).map((e) => [e.decision, e.paths])).toEqual([
      ["allow", []],
      ["deny", []],
      ["deny", ["openspec/changes/add-search/proposal.md"]]
    ]);
  });

  it("a temporary directory inside the project: the envelope cannot be written, the reason says why (I-198)", async () => {
    const { p } = await underReview();
    const inside = path.join(p.root, "tmp");
    mkdirSync(inside, { recursive: true });
    const env = { TEMP: inside, TMP: inside, TMPDIR: inside };
    const result = await guard(p, { phase: "pre", action: "edit", paths: [path.join(inside, "e.json")] }, env);
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain("inside the project");
  });

  it("shell: warrant run submit is allowed, a line with any other command is denied with the hint (SCN-ENF-027)", async () => {
    const { p, id } = await underReview();
    const submit = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "warrant run submit --file result.json"] });
    expect(submit.data).toEqual({ decision: "allow", hints: [] });
    const mixed = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", "cat x && warrant run submit"] });
    expect(mixed.data["decision"]).toBe("deny");
    expect(mixed.data["hints"].join(" ")).toContain("warrant run submit");
    expect(events(p, id).map((e) => e["decision"])).toEqual(["allow", "deny"]);
  });

  it("shell: only the strict form of warrant run submit is allowed; &, a redirection, $(…), `…`, <(…), VAR=… and << in a comment are denied (SCN-ENF-027)", async () => {
    const { p, id } = await underReview();
    const allowed = [
      "warrant run submit --file envelope.json",
      "warrant run submit --dry-run --file a/b.json",
      "warrant run submit <<'JSON'\n{\"statement\": \"it's; a && b | c # d $((1<<2))\"}\nJSON"
    ];
    const denied = [
      "warrant run submit & rm -rf src",
      "warrant run submit > openspec/changes/add-search/proposal.md",
      "warrant run submit --file $(rm -rf src)",
      "warrant run submit --file `rm -rf src`",
      "warrant run submit --file <(rm -rf src)",
      "NODE_OPTIONS=--import=x warrant run submit",
      "warrant run submit # <<X\nrm -rf src\nX"
    ];
    for (const line of allowed) {
      expect((await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", line] })).data, line).toEqual({ decision: "allow", hints: [] });
    }
    for (const line of denied) {
      const result = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", line] });
      expect(result.data["decision"], line).toBe("deny");
      expect(result.data["hints"].join(" "), line).toContain("warrant run submit");
    }
    expect(events(p, id).map((e) => e["decision"])).toEqual([...allowed.map(() => "allow"), ...denied.map(() => "deny")]);
  });

  it("shell: an envelope in a heredoc of warrant run submit is data, a command after the delimiter line is not (I-167)", async () => {
    const { p, id } = await underReview();
    const submit = `warrant run submit <<'JSON'\n{"statement": "it's; a && b | c"}\nJSON`;
    expect((await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", submit] })).data).toEqual({ decision: "allow", hints: [] });
    const after = await guard(p, { phase: "pre", action: "shell", argv: ["bash", "-c", `${submit}\nrm -rf x`] });
    expect(after.data["decision"]).toBe("deny");
    expect(after.data["reason"]).toContain("rm -rf x");
    expect(events(p, id).map((e) => e["decision"])).toEqual(["allow", "deny"]);
  });

  it("post and other actions keep their answers", async () => {
    const { p } = await underReview();
    expect((await guard(p, { phase: "post", action: "shell", argv: ["cat", "x"] })).data["decision"]).toBe("allow");
    expect((await guard(p, { phase: "pre", action: "other" })).data["decision"]).toBe("allow");
  });
});

describe("warrant guard: post", () => {
  const NOT_CANONICAL_AREAS = '{"$schema":"warrant://areas/1","KRN":{"capability":"kernel"},"SRC":{"capability":"search"}}\n';

  function jsonRule(p: ProjectBuilder): void {
    p.write(".warrant/local/rules/json-canonical.json", {
      $schema: "warrant://rule/1",
      id: "json-canonical",
      paths: [".warrant/**/*.json"],
      text: "Write JSON only through warrant fmt."
    });
  }

  it("findings of validate --files and the rule text once per Run (SCN-ENF-014)", async () => {
    const p = await repo("IMPLEMENTING", jsonRule);
    const id = await started(p);
    p.write(".warrant/local/areas.json", NOT_CANONICAL_AREAS);
    const event = { phase: "post", action: "edit", paths: [".warrant/local/areas.json"] };

    const first = await guard(p, event);
    expect(first.data["decision"]).toBe("allow");
    expect(first.data["reason"]).toBeUndefined();
    expect(first.data["hints"]).toEqual([
      expect.stringMatching(/^NOT_CANONICAL \.warrant\/local\/areas\.json: .* — .*warrant fmt/),
      "rule json-canonical: Write JSON only through warrant fmt."
    ]);
    expect(events(p, id)).toEqual([
      expect.objectContaining({ phase: "post", decision: "allow", findings: ["NOT_CANONICAL"], rules_shown: ["json-canonical"] })
    ]);

    const second = await guard(p, event);
    expect(second.data["hints"]).toEqual([first.data["hints"][0]]);
    expect(events(p, id)[1]).toMatchObject({ findings: ["NOT_CANONICAL"], rules_shown: [] });
  });

  it("without a Run: the findings and the hint run start of pre, no rule text, no event (I-165)", async () => {
    const p = await repo("IMPLEMENTING", jsonRule);
    p.write(".warrant/local/areas.json", NOT_CANONICAL_AREAS);
    const result = await guard(p, { phase: "post", action: "edit", paths: [".warrant/local/areas.json"] });
    expect(result.data["hints"]).toEqual([expect.stringMatching(/^NOT_CANONICAL /), expect.stringContaining("warrant run start <change> --operation")]);
    expect(existsSync(path.join(p.root, ".warrant", "runs"))).toBe(false);
    // A clean file gets the hint alone; a path outside the project, none.
    expect((await guard(p, { phase: "post", action: "edit", paths: ["docs/notes.md"] })).data["hints"]).toEqual([expect.stringContaining("warrant run start")]);
    expect((await guard(p, { phase: "post", action: "edit", paths: [path.join(path.dirname(p.root), "elsewhere.md")] })).data["hints"]).toEqual([]);
  });

  it("a clean file: allow without hints", async () => {
    const p = await repo("IMPLEMENTING");
    await started(p);
    expect((await guard(p, { phase: "post", action: "edit", paths: ["src/app.py"] })).data).toEqual({ decision: "allow", hints: [] });
  });

  it("a rule is shown only for a path its paths match, whatever the number of paths", async () => {
    const p = await repo("IMPLEMENTING", jsonRule);
    await started(p);
    const result = await guard(p, { phase: "post", action: "edit", paths: ["src/a.py", "src/b.py", "docs/c.md"] });
    expect(result.data).toEqual({ decision: "allow", hints: [] });
  });
});

describe("warrant guard: failures (F9)", () => {
  it("current names a Run that fails run/1: pre is denied, the reason names the Run file, the hint warrant validate (SCN-ENF-015)", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const stored = JSON.parse(p.read(`${RUNS}/${id}.json`)) as Data;
    p.write(`${RUNS}/${id}.json`, { ...stored, run_state: "PAUSED" });
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["src/app.py"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain(`${RUNS}/${id}.json`);
    expect(result.data["hints"]).toEqual([expect.stringContaining("warrant validate")]);

    // post of the same failure: allow, no hints, a line on stderr.
    const post = await guard(p, { phase: "post", action: "edit", paths: ["src/app.py"] });
    expect(post.data).toEqual({ decision: "allow", hints: [] });
    expect(p.warnings.join("")).toContain(`${RUNS}/${id}.json`);
  });

  it("an event that does not read: pre (or no phase) is denied, post is allowed with a line on stderr", async () => {
    const p = await repo("IMPLEMENTING");
    const notJson = await guard(p, "{not json");
    expect(notJson.data["decision"]).toBe("deny");
    expect(notJson.data["reason"]).toContain("not JSON");
    expect(notJson.data["hints"]).toEqual([expect.stringContaining("warrant validate")]);
    const noCwd = await guard(p, JSON.stringify({ phase: "pre", action: "edit", paths: ["src/a.py"] }));
    expect(noCwd.data["decision"]).toBe("deny");
    const post = await guard(p, JSON.stringify({ phase: "post", action: "edit", paths: "src/a.py", cwd: p.root }));
    expect(post.data).toEqual({ decision: "allow", hints: [] });
    expect(p.warnings.join("")).toContain("paths");
  });

  it("a policy that does not load: pre is denied with the hint warrant validate", async () => {
    const p = await repo("IMPLEMENTING");
    p.write(".warrant/local/checks/broken.json", { $schema: "warrant://check/1", id: "broken" });
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["docs/a.md"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toContain(".warrant/local/checks/broken.json");
    expect(result.data["hints"]).toEqual([expect.stringContaining("warrant validate")]);
  });
});

describe("warrant guard outside a project under WARRANT (SCN-ENF-016)", () => {
  it("no .warrant/warrant.json: allow for every phase and action, nothing written", async () => {
    const p = project().remove(".warrant/warrant.json");
    const inputs: Array<Record<string, unknown> | string> = [
      { phase: "pre", action: "edit", paths: ["src/app.py"] },
      { phase: "pre", action: "shell", argv: ["pytest"] },
      { phase: "pre", action: "other" },
      { phase: "post", action: "edit", paths: ["src/app.py"] },
      "not json"
    ];
    for (const input of inputs) expect((await guard(p, input)).data).toEqual({ decision: "allow", hints: [] });
    expect(existsSync(path.join(p.root, ".warrant", "runs"))).toBe(false);
  });
});

describe("warrant guard and the lock of the Run (F18)", () => {
  function holdLock(p: ProjectBuilder, id: string): string {
    const lock = path.join(p.root, ".warrant", "runs", `${id}.lock`);
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: 4242, what: "guard", at: "2026-09-25T10:00:00.000Z" }), "utf8");
    return lock;
  }

  it("pre with the lock held: deny BUSY after the wait, the event lost, the lock left alone", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const lock = holdLock(p, id);
    const result = await guard(p, { phase: "pre", action: "edit", paths: ["src/app.py"] });
    expect(result.data["decision"]).toBe("deny");
    expect(result.data["reason"]).toMatch(/^BUSY: /);
    expect(result.data["reason"]).toContain("4242");
    expect(result.data["hints"]).toEqual([expect.stringContaining(`${RUNS}/${id}.lock`)]);
    expect(events(p, id)).toEqual([]);
    expect(existsSync(lock)).toBe(true);
    expect(p.signals.registered).toBe(0);
  });

  it("post with the lock held: allow with the hints, the event lost with a line on stderr", async () => {
    const p = await repo("IMPLEMENTING", (b) =>
      b.write(".warrant/local/rules/src-style.json", { $schema: "warrant://rule/1", id: "src-style", paths: ["src/**"], text: "Keep modules small." })
    );
    const id = await started(p);
    holdLock(p, id);
    const result = await guard(p, { phase: "post", action: "edit", paths: ["src/app.py"] });
    expect(result.data).toEqual({ decision: "allow", hints: ["rule src-style: Keep modules small."] });
    expect(events(p, id)).toEqual([]);
    expect(p.warnings.join("")).toMatch(/not recorded .*BUSY|not recorded/);
  });
});
