/**
 * `warrant ci` in the test process (REQ-VER-011, group 4 of phase-4c): the
 * structure of the record — SCN-VER-078, 090, 105, 107, 108 — refs through the
 * forge — SCN-VER-081, 093 — path rules by kind — SCN-VER-073, 074, 092, 094,
 * 099, 100 — the merge verdict of an impl-PR — SCN-VER-068, 075, 076, 082, 095,
 * 098 — the forge unavailable and `--dry-run` — SCN-VER-084, 085 — the CI
 * evidence and the repeated archive of an archive-PR (group 5) — SCN-VER-079,
 * 080, 091, 096, 102, 106. Decisions of UNKNOWNs through the forge and the
 * UNKNOWNs of the base kept (slice-fixes, group 3) — SCN-VER-111…116. Agent
 * identities of the base (lattice-issues, group 5) — SCN-VER-120, 121. The ref
 * of MERGED by the law of M^1, the ground of recorded WAIVED and NOT_APPLICABLE,
 * code without a Change and NO_HUMAN_ACCEPTANCE (agent-merge, group 4) —
 * SCN-VER-127…135. Exit codes by class (exit-contract, group 4): a gate
 * BLOCKED by a failed check, the forge refusing access or unknown, the range of
 * a pack — SCN-VER-084, 095, 137, 138, 139.
 *
 * Each case builds the synced core-sdd project on `main` of `FakeGit`, opens a
 * pull request on a branch and merges it into `main` with a merge commit: HEAD
 * is the result of the merge, as the job `warrant` makes it. `tests-passed` is
 * overridden with a fake command writing junit into `{out}`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runArchive } from "../../../src/commands/archive.js";
import { runCheck } from "../../../src/commands/check.js";
import { runCi, type CiOptions } from "../../../src/commands/ci.js";
import { runTransition } from "../../../src/commands/transition.js";
import { acquireLock, lockPath } from "../../../src/core/check/lock.js";
import type { WorkflowRun } from "../../../src/core/ports/forge.js";
import { toEnvelope, type CommandResult } from "../../../src/io/output.js";
import { advance, artifactOf, AT, HASH, pullRequest, RECORD } from "../helpers/ci.js";
import { FAKE_REPOSITORY, fakePull, fakeRun, type FakeComment } from "../helpers/fakes/forge.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { started } from "../helpers/run.js";

const project = useProjectBuilder();

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

const EVIDENCE = ".warrant/evidence/add-search";
const SPEC_PR = `https://github.com/${FAKE_REPOSITORY}/pull/5`;
const IMPL_PR = `https://github.com/${FAKE_REPOSITORY}/pull/9`;
const LOCAL: NodeJS.ProcessEnv = {};
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: FAKE_REPOSITORY,
  GITHUB_RUN_ID: "42"
};
const CHORE = { classification: { profiles: ["chore"] } };

function ci(p: ProjectBuilder, env: NodeJS.ProcessEnv = LOCAL, opts: CiOptions = {}): Promise<Result> {
  return invoke(() => runCi(p.ctx, opts, env)) as Promise<Result>;
}

const junit = (failures: number): string =>
  '<?xml version="1.0" encoding="UTF-8" ?>\n' +
  `<testsuites tests="2" failures="${failures}">\n` +
  `  <testsuite name="fake" tests="2" failures="${failures}" errors="0" skipped="0">\n  </testsuite>\n</testsuites>\n`;

/** `tests-passed` overridden by `fake-tests {out}`; `failures` — what its junit report says. */
function fakeTests(p: ProjectBuilder, failures = 0): void {
  p.withCheck(
    "fake-tests",
    { effect: (spec) => writeFileSync(path.resolve(spec.cwd, spec.argv[1] as string, "junit.xml"), junit(failures), "utf8") },
    { id: "tests-passed", args: ["{out}"] }
  );
}

function waiver(p: ProjectBuilder, id: string, gate: string, change = "add-search"): void {
  p.withWaiver({
    id,
    change,
    gate,
    reason: "no producer in the fixture",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
}

/** The synced project on `main`: `setup` adds files and models before the first commit. */
async function repo(setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project().withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("base");
  return p;
}

/** Change `add-search` with its record in `state` on `main`, `tests-passed` fake and `spec-approved` waived. */
async function changeRepo(state: string, extra: Record<string, unknown> = CHORE, setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  return repo((p) => {
    p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", state, extra);
    waiver(p, "WAV-2026-001", "spec-approved");
    fakeTests(p);
    setup?.(p);
  });
}

function codes(result: Result): string[] {
  return result.errors.map((e) => e.code);
}

function scope(result: Result): string[] {
  return result.errors.filter((e) => e.code === "SCOPE_VIOLATION").map((e) => e.path as string);
}

/** The lock holds another hash of core-sdd than the bundled pack: the law the pull request is judged by differs (I-179). */
function stale(p: ProjectBuilder): void {
  const lock = p.json(".warrant/warrant.lock.json");
  lock.packs["core-sdd"].hash = HASH;
  p.write(".warrant/warrant.lock.json", lock);
}

describe("warrant ci: path rules by kind", () => {
  it("spec-PR: only code is out of scope; the Run, evidence, docs and the Change are its own (SCN-VER-073)", async () => {
    const build = async (withCode: boolean): Promise<Result> => {
      const p = await repo((b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
      p.branch("spec/add-search", "main");
      p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", "PROPOSED", CHORE);
      p.write(`${EVIDENCE}/EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W.json`, { $schema: "warrant://evidence/1" });
      p.write("docs/adr/0042.md", "# ADR 42\n");
      if (withCode) p.write("src/app.py", "print(1)\n");
      // A Run of the Change, committed as frontends commit it (`current` is ignored by git).
      await started(p, "add-search", { operation: "specify" });
      p.remove(".warrant/runs/current");
      pullRequest(p, "spec/add-search", () => undefined);
      return ci(p);
    };
    const withCode = await build(true);
    expect(withCode.data["kind"]).toBe("spec");
    expect(scope(withCode)).toEqual(["src/app.py"]);
    expect(withCode.exitCode).toBe(1);

    const clean = await build(false);
    expect(clean.errors).toEqual([]);
    expect(clean.exitCode).toBe(0);
    expect(clean.data["transitions"]).toEqual([{ to: "PROPOSED", at: "2026-09-22T09:00:00Z" }]);
    expect(clean.data["gates"]).toBeDefined();
  });

  it("spec-PR that drops paths.src from warrant.json: its code is judged by paths.src of the base (SCN-VER-073, I-171)", async () => {
    const p = await repo((b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
    p.branch("spec/add-search", "main");
    p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", "PROPOSED", CHORE);
    const config = p.json(".warrant/warrant.json");
    delete config.paths;
    p.write(".warrant/warrant.json", config);
    p.write("src/app.py", "print(1)\n");
    pullRequest(p, "spec/add-search", () => undefined);
    const result = await ci(p);
    expect(result.data["kind"]).toBe("spec");
    // warrant.json itself is a policy path (factory-change of the base); src/app.py is code by the base, not by the PR.
    expect(scope(result)).toEqual([".warrant/warrant.json", "src/app.py"]);
    expect(result.data["skipped"].filter((s: Data) => s["rule"] === "code")).toEqual([]);
    expect(result.exitCode).toBe(1);
  });

  it("main specs without a Change: kind none, SCOPE_VIOLATION (SCN-VER-074)", async () => {
    const p = await repo((b) => b.withSpec("search"));
    pullRequest(p, "fix/specs", (b) => b.write("openspec/specs/search/spec.md", `${b.read("openspec/specs/search/spec.md")}\nMore.\n`));
    const result = await ci(p);
    expect(result.data["kind"]).toBe("none");
    expect(scope(result)).toEqual(["openspec/specs/search/spec.md"]);
    expect(result.exitCode).toBe(1);
  });

  it("policy path and artifacts of a Change without its record: kind none, both paths (SCN-VER-094)", async () => {
    const p = await changeRepo("SPECIFIED");
    pullRequest(p, "fix/process", (b) => {
      b.write("packs/core-sdd/gates/spec-valid.json", { id: "spec-valid" });
      b.write("openspec/changes/add-search/tasks.md", "# Tasks\n\n- [ ] more\n");
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("none");
    expect(scope(result)).toEqual(["openspec/changes/add-search/tasks.md", "packs/core-sdd/gates/spec-valid.json"]);
    expect(result.exitCode).toBe(1);
  });

  it("abandon-PR: main specs beside the record and the removed Change are out of scope (SCN-VER-092)", async () => {
    const p = await changeRepo("SPECIFIED", CHORE, (b) => b.withSpec("search"));
    pullRequest(p, "abandon/add-search", (b) => {
      advance(b, "ABANDONED");
      b.remove("openspec/changes/add-search");
      b.write("openspec/specs/search/spec.md", `${b.read("openspec/specs/search/spec.md")}\nMore.\n`);
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("abandon");
    expect(scope(result)).toEqual(["openspec/specs/search/spec.md"]);
    expect(result.exitCode).toBe(1);
  });

  it("spec-PR: a waiver of its own Change is allowed, one of another Change is not (SCN-VER-099)", async () => {
    const p = await changeRepo("PROPOSED");
    pullRequest(p, "spec/add-search", (b) => {
      advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
      waiver(b, "WAV-2026-020", "adversarial-review");
      waiver(b, "WAV-2026-021", "adversarial-review", "fix-login");
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("spec");
    expect(scope(result)).toEqual([".warrant/waivers/WAV-2026-021.json"]);
    expect(result.exitCode).toBe(1);
  });
});

describe("warrant ci: the structure of the record", () => {
  it("a new transition naming evidence without a file, or without effective_policy_hash: RECORD_MISMATCH (SCN-VER-078)", async () => {
    const p = await changeRepo("PROPOSED");
    pullRequest(p, "spec/add-search", (b) => advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" }, evidence: ["EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W"] }));
    const missing = await ci(p);
    expect(codes(missing)).toEqual(["RECORD_MISMATCH"]);
    expect(missing.errors[0]?.message).toContain("SPECIFIED");
    expect(missing.errors[0]?.message).toContain("evidence: EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W");
    expect(missing.exitCode).toBe(1);

    const q = await changeRepo("PROPOSED");
    pullRequest(q, "spec/add-search", (b) => {
      advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
      const record = b.json(RECORD);
      delete record.transitions.at(-1).effective_policy_hash;
      b.write(RECORD, record);
    });
    const noHash = await ci(q);
    expect(codes(noHash)).toEqual(["RECORD_MISMATCH"]);
    expect(noHash.errors[0]?.message).toContain("effective_policy_hash");
  });

  it("an impl-PR that drops factory-change from the profiles of the base: RECORD_MISMATCH classification (SCN-VER-105)", async () => {
    const p = await changeRepo("IMPLEMENTING", { classification: { profiles: ["chore", "factory-change"] } });
    pullRequest(p, "worktree/add-search", (b) => {
      b.write("src/search.ts", "export const search = 1;\n");
      advance(b, "VERIFYING");
      const record = b.json(RECORD);
      record.classification.profiles = ["chore"];
      b.write(RECORD, record);
    });
    const result = await ci(p, CI_ENV);
    const mismatch = result.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.message).toContain("classification");
    expect(mismatch[0]?.message).toContain("factory-change");
    expect(result.exitCode).toBe(1);
  });

  it("an impl-PR that narrows the policy paths: the profile derived by the packs of the base is required (SCN-VER-107)", async () => {
    const p = await changeRepo("IMPLEMENTING", { classification: { profiles: ["feature"] } });
    pullRequest(p, "worktree/add-search", (b) => {
      b.write("packs/core-sdd/profiles/factory-change.json", { id: "factory-change", match: { paths: [".warrant/**"] } });
      advance(b, "VERIFYING");
    });
    const result = await ci(p, CI_ENV);
    const mismatch = result.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);
    expect(result.exitCode).toBe(1);
  });

  it("an impl-PR that narrows match.paths of a profile of the project layer: the path only the base covers derives it (SCN-VER-107, I-171)", async () => {
    // The project layer is read from the tree, unlike the bundled pack: the base and the PR hold different profiles.
    const INFRA = ".warrant/local/profiles/infra.json";
    const infra = (paths: string[]): Record<string, unknown> => ({
      $schema: "warrant://profile/1",
      id: "infra",
      version: "1.0.0",
      description: "Infrastructure of the project.",
      match: { paths }
    });
    const p = await changeRepo("IMPLEMENTING", { classification: { profiles: ["feature", "factory-change"] } }, (b) =>
      b.write(INFRA, infra(["infra/**", "deploy/**"]))
    );
    pullRequest(p, "worktree/add-search", (b) => {
      b.write(INFRA, infra(["deploy/**"]));
      b.write("infra/main.tf", "resource {}\n");
      advance(b, "VERIFYING");
    });
    const result = await ci(p, CI_ENV);
    const mismatch = result.errors.filter((e) => e.code === "RECORD_MISMATCH");
    // factory-change (the path of the layer itself) is held; infra/main.tf derives infra only by the paths of the base.
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.message).toContain("classification");
    expect(mismatch[0]?.message).toContain("lack infra,");
    expect(mismatch[0]?.message).not.toContain("factory-change");
    expect(result.exitCode).toBe(1);
  });

  it("a bundled pack not held by the lock of the base is the law changed: factory-change required in impl, SCOPE_VIOLATION elsewhere (I-179)", async () => {
    const impl = await changeRepo("IMPLEMENTING");
    stale(impl);
    impl.commit("base: a lock of another core-sdd");
    pullRequest(impl, "worktree/add-search", (b) => advance(b, "VERIFYING"));
    const judged = await ci(impl, CI_ENV);
    const mismatch = judged.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);

    const none = await repo();
    stale(none);
    none.commit("base: a lock of another core-sdd");
    pullRequest(none, "docs/readme", (b) => b.write("docs/readme.md", "# Readme\n"));
    const result = await ci(none);
    expect(scope(result)).toEqual([".warrant/warrant.lock.json"]);
    expect(result.exitCode).toBe(1);
  });

  it("a profile the impl-PR introduces in .warrant/local/** is not law of the base: no CONFIG_INVALID, factory-change still required (I-234)", async () => {
    const p = await changeRepo("IMPLEMENTING");
    pullRequest(p, "worktree/add-search", (b) => {
      b.write(".warrant/local/profiles/acceptance.json", {
        $schema: "warrant://profile/1",
        id: "acceptance",
        version: "1.0.0",
        description: "A profile this pull request introduces.",
        match: { paths: ["src/**"] },
        gates: { "VERIFYING->MERGED": ["human-approval"] },
        approvals: [{ role: "maintainer", at: "VERIFYING->MERGED" }]
      });
      const record = b.json(".warrant/changes/add-search.json");
      b.write(".warrant/changes/add-search.json", { ...record, classification: { profiles: ["chore", "acceptance"] } });
      advance(b, "VERIFYING");
    });
    const judged = await ci(p, CI_ENV);
    expect(codes(judged)).not.toContain("CONFIG_INVALID");
    const mismatch = judged.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);
  });

  it("a new minor of a bundled pack outside the range of the base is the law changed, not a broken base; an unchanged pack outside the range is (I-179, I-233, SCN-VER-139)", async () => {
    const outOfRange = (b: ProjectBuilder): void => {
      const config = b.json(".warrant/warrant.json");
      b.write(".warrant/warrant.json", { ...config, packs: { ...config.packs, "core-sdd": { version: "^0.0.1" } } });
    };
    const impl = await changeRepo("IMPLEMENTING");
    stale(impl);
    outOfRange(impl);
    impl.commit("base: a lock and a range of another core-sdd");
    pullRequest(impl, "worktree/add-search", (b) => advance(b, "VERIFYING"));
    const judged = await ci(impl, CI_ENV);
    expect(codes(judged)).not.toContain("PACK_VERSION_RANGE");
    expect(codes(judged)).not.toContain("CONFIG_INVALID");
    const mismatch = judged.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);

    const broken = await repo();
    outOfRange(broken);
    broken.commit("base: a range of another core-sdd, the lock holds the bundled pack");
    pullRequest(broken, "docs/readme", (b) => b.write("docs/readme.md", "# Readme\n"));
    const result = await ci(broken);
    expect(codes(result)).toEqual(["PACK_VERSION_RANGE"]);
    expect(toEnvelope("ci", result).errors[0]).not.toHaveProperty("retryable");
    expect(result.exitCode).toBe(3);
  });

  it("an abandon-PR over a bundled pack not held by the lock of the base: only SCOPE_VIOLATION of the lock, no RECORD_MISMATCH (I-179)", async () => {
    const p = await changeRepo("SPECIFIED");
    stale(p);
    p.commit("base: a lock of another core-sdd");
    pullRequest(p, "abandon/add-search", (b) => {
      advance(b, "ABANDONED");
      b.remove("openspec/changes/add-search");
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("abandon");
    expect(codes(result)).toEqual(["SCOPE_VIOLATION"]);
    expect(scope(result)).toEqual([".warrant/warrant.lock.json"]);
    expect(result.exitCode).toBe(1);
  });
});

/**
 * The spec-PR merged by `S` (pull 5) — `specWork` edits it — then an impl-PR
 * whose first commit records `APPROVED` with the ref of the spec-PR and
 * `IMPLEMENTING` (SCN-VER-090). `base` — the author of the spec-PR (`kat` by
 * default) and a change of the base project before its first commit.
 */
async function firstImplCommit(
  mergedBy: string,
  extra: Record<string, unknown> = CHORE,
  work?: (p: ProjectBuilder) => void,
  specWork?: (p: ProjectBuilder) => void,
  base: { author?: string; setup?: (p: ProjectBuilder) => void } = {}
): Promise<ProjectBuilder> {
  const p = await changeRepo("PROPOSED", extra, base.setup);
  const spec = pullRequest(p, "spec/add-search", (b) => {
    advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
    specWork?.(b);
  });
  p.withForge({ pulls: [fakePull(5, { mergeCommit: spec.merge, headSha: spec.head, mergedBy, author: base.author ?? "kat" })] });
  pullRequest(p, "worktree/add-search", (b) => {
    advance(b, "APPROVED", { gates: { "human-approval": "PASS" }, ref: SPEC_PR });
    advance(b, "IMPLEMENTING", { gates: { "branch-isolated": "PASS" } });
    work?.(b);
  });
  return p;
}

const AGENT = "warrant-agent[bot]";

/** The base project with `identities.agents` `[AGENT]`; `maintainers` — `roles.maintainer`. */
function withAgent(maintainers: string[] = ["kat"]): (p: ProjectBuilder) => void {
  return (p) =>
    p.write(".warrant/warrant.json", {
      ...p.json(".warrant/warrant.json"),
      roles: { maintainer: maintainers },
      identities: { agents: [{ login: AGENT, kind: "bot" }] }
    });
}

/** Codes of the findings `SHARED_IDENTITY` and `APPROVER_IS_AUTHOR`, in order. */
function identityFindings(result: Result): string[] {
  return result.data["findings"]
    .map((f: Data) => f["code"] as string)
    .filter((code: string) => code === "SHARED_IDENTITY" || code === "APPROVER_IS_AUTHOR");
}

describe("warrant ci: refs through the forge", () => {
  it("first commit of an impl-PR: record and ref in order, not VERIFYING yet (SCN-VER-090, SCN-VER-081, SCN-VER-120)", async () => {
    const p = await firstImplCommit("kat");
    const result = await ci(p);
    expect(result.data["kind"]).toBe("impl");
    expect(result.data["transitions"]).toEqual([
      { to: "APPROVED", at: AT, ref: SPEC_PR },
      { to: "IMPLEMENTING", at: AT }
    ]);
    expect(codes(result)).not.toContain("RECORD_MISMATCH");
    expect(codes(result)).not.toContain("REF_NOT_VERIFIED");
    expect(codes(result)).toContain("CHANGE_NOT_VERIFYING");
    // Merged by the maintainer who authored the spec-PR, no identities.agents in the base: findings, not a violation (ADR-0044 п. 3).
    expect(identityFindings(result)).toEqual(["SHARED_IDENTITY", "APPROVER_IS_AUTHOR"]);
    expect(result.data["findings"].find((f: Data) => f["code"] === "SHARED_IDENTITY")["message"]).toContain(
      `transition 2 (APPROVED) ref ${SPEC_PR}: merged by kat`
    );
    expect(result.exitCode).toBe(1);
    expect(p.forge.calls).toEqual(["pullRequest 5"]);
  });

  it("the spec-PR merged by a login outside roles.maintainer: REF_NOT_VERIFIED merged_by (SCN-VER-081)", async () => {
    const p = await firstImplCommit("mallory");
    const result = await ci(p);
    const ref = result.errors.filter((e) => e.code === "REF_NOT_VERIFIED");
    expect(ref).toHaveLength(1);
    expect(ref[0]?.message).toContain("merged_by");
    expect(ref[0]?.path).toBe(`${RECORD}#/transitions/2/ref`);
    // A ref with REF_NOT_VERIFIED gives no SHARED_IDENTITY.
    expect(identityFindings(result)).toEqual([]);
    expect(result.data["findings"].filter((f: Data) => f["code"] === "ROLES_CHANGED")).toEqual([]);
    expect(result.exitCode).toBe(1);
  });

  it("the pull request adds the login that merged the spec-PR to roles: REF_NOT_VERIFIED merged_by by the roles of the base, ROLES_CHANGED (SCN-VER-081, I-171)", async () => {
    // factory-change is held: warrant.json is a policy path, so only roles are judged here.
    const p = await firstImplCommit("mallory", { classification: { profiles: ["chore", "factory-change"] } }, (b) =>
      b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), roles: { maintainer: ["kat", "mallory"] } })
    );
    const result = await ci(p);
    expect(result.data["kind"]).toBe("impl");
    expect(codes(result)).not.toContain("RECORD_MISMATCH");
    const ref = result.errors.filter((e) => e.code === "REF_NOT_VERIFIED");
    expect(ref).toHaveLength(1);
    expect(ref[0]?.message).toContain("merged_by");
    expect(ref[0]?.path).toBe(`${RECORD}#/transitions/2/ref`);
    expect(result.data["findings"].filter((f: Data) => f["code"] === "ROLES_CHANGED")).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  it("identities.agents in the base: a self-merge and a merge by an agent are REF_NOT_VERIFIED merged_by, no identity findings (SCN-VER-120)", async () => {
    const refErrors = (result: Result): string[] => result.errors.filter((e) => e.code === "REF_NOT_VERIFIED").map((e) => e.message);

    const self = await ci(await firstImplCommit("kat", CHORE, undefined, undefined, { setup: withAgent() }));
    expect(refErrors(self)).toEqual([expect.stringContaining(`ref ${SPEC_PR}: merged_by: kat merged pull request 5 they authored`)]);
    expect(identityFindings(self)).toEqual([]);
    expect(self.exitCode).toBe(1);

    const opened = await ci(await firstImplCommit("kat", CHORE, undefined, undefined, { author: AGENT, setup: withAgent() }));
    expect(refErrors(opened)).toEqual([]);
    expect(identityFindings(opened)).toEqual([]);

    // Outside roles.maintainer — the reason of roles; also in it (a configuration error) — the reason of the agent.
    const outside = await ci(await firstImplCommit(AGENT, CHORE, undefined, undefined, { setup: withAgent() }));
    expect(refErrors(outside)).toEqual([expect.stringContaining(`ref ${SPEC_PR}: merged_by: ${AGENT} merged pull request 5, not a member`)]);
    const inside = await ci(await firstImplCommit(AGENT, CHORE, undefined, undefined, { setup: withAgent(["kat", AGENT]) }));
    expect(refErrors(inside)).toEqual([expect.stringContaining(`ref ${SPEC_PR}: merged_by: ${AGENT} merged pull request 5 and is an agent identity`)]);
    expect(identityFindings(inside)).toEqual([]);
    expect(inside.exitCode).toBe(1);
  });
});

const UNK = "UNK-SRC-004";
/** The maintainer's comment in the spec-PR (pull 5). */
const DECISION_REF = `${SPEC_PR}#issuecomment-11`;

/** A blocking UNKNOWN closed by the maintainer's decision `ref`. */
function decided(id: string, ref: string): Record<string, unknown> {
  return { id, text: "Which index does search use?", blocking: true, resolution: "The inverted index.", resolved_as: "decision", ref };
}

/** Writes `unknowns[]` into the record of `add-search` in the working tree. */
function withUnknowns(p: ProjectBuilder, unknowns: Record<string, unknown>[]): void {
  p.write(RECORD, { ...p.json(RECORD), unknowns });
}

/** A comment `issuecomment-<id>` of pull request `pr` of the fake forge. */
function issueComment(id: number, author: string, body: string, pr = 5): FakeComment {
  return { kind: "issue", id, author, pullRequest: pr, body };
}

/** The first commit of the impl-PR over a spec-PR whose record closes {@link UNK} by `ref`; `comments` are on the forge. */
async function decisionPr(ref: string, comments: FakeComment[], work?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = await firstImplCommit("kat", CHORE, work, (b) => withUnknowns(b, [decided(UNK, ref)]));
  p.withForge({ comments });
  return p;
}

/** Messages of `REF_NOT_VERIFIED` of the decisions. */
function decisionErrors(result: Result): string[] {
  return result.errors.filter((e) => e.code === "REF_NOT_VERIFIED" && e.message.startsWith("unknowns/")).map((e) => e.message);
}

/** Messages of `RECORD_MISMATCH` of a result. */
function mismatches(result: Result): string[] {
  return result.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message);
}

describe("warrant ci: decisions of UNKNOWNs through the forge (REQ-VER-013)", () => {
  it("the maintainer's comment in the spec-PR of APPROVED names the UNKNOWN: no REF_NOT_VERIFIED, exit 0 (SCN-VER-111)", async () => {
    const p = await decisionPr(DECISION_REF, [issueComment(11, "kat", `Decision on ${UNK}: the inverted index.`)], (b) =>
      advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } })
    );
    const result = await ci(p, CI_ENV);
    expect(result.errors).toEqual([]);
    expect(result.data["findings"].filter((f: Data) => f["code"] === "DECISION_NOT_VERIFIED")).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(p.forge.calls).toContain("comment issue 11");
  });

  it("a comment of an agent of identities.agents: REF_NOT_VERIFIED decision: author; the maintainer's with none: SHARED_IDENTITY (SCN-VER-121)", async () => {
    const byAgent = await firstImplCommit("kat", CHORE, undefined, (b) => withUnknowns(b, [decided(UNK, DECISION_REF)]), {
      author: AGENT,
      setup: withAgent(["kat", AGENT])
    });
    byAgent.withForge({ comments: [issueComment(11, AGENT, `Decision on ${UNK}: the inverted index.`)] });
    const agent = await ci(byAgent);
    expect(decisionErrors(agent)).toEqual([expect.stringContaining(`ref ${DECISION_REF}: decision: author: ${AGENT} wrote the comment and is an agent identity`)]);
    expect(identityFindings(agent)).toEqual([]);
    expect(agent.exitCode).toBe(1);

    const kat = await ci(await decisionPr(DECISION_REF, [issueComment(11, "kat", `Decision on ${UNK}: the inverted index.`)]));
    expect(decisionErrors(kat)).toEqual([]);
    const shared = kat.data["findings"].filter((f: Data) => f["code"] === "SHARED_IDENTITY").map((f: Data) => f["message"] as string);
    // One for the decision, one for the ref of APPROVED.
    expect(shared.filter((m: string) => m.startsWith(`unknowns/0 (${UNK}) ref`))).toEqual([expect.stringContaining("written by kat")]);
    expect(shared).toHaveLength(2);
  });

  it("a comment of a login outside roles.maintainer of the base, or one not naming the UNKNOWN: REF_NOT_VERIFIED author / text (SCN-VER-112)", async () => {
    const bob = await ci(await decisionPr(DECISION_REF, [issueComment(11, "bob", `Decision on ${UNK}.`)]));
    const errors = bob.errors.filter((e) => e.code === "REF_NOT_VERIFIED");
    expect(errors.map((e) => e.path)).toEqual([`${RECORD}#/unknowns/0/ref`]);
    expect(errors[0]?.message.startsWith(`unknowns/0 (${UNK}) ref ${DECISION_REF}: decision: author`)).toBe(true);
    expect(bob.exitCode).toBe(1);
    const silent = await ci(await decisionPr(DECISION_REF, [issueComment(11, "kat", "Decided: the inverted index.")]));
    expect(decisionErrors(silent)).toEqual([expect.stringContaining(`ref ${DECISION_REF}: decision: text`)]);
    expect(silent.exitCode).toBe(1);
  });

  it("a comment in another PR than the spec-PR of APPROVED, a comment the forge places in another PR, a review comment: pull_request / form (SCN-VER-113)", async () => {
    const other = `https://github.com/${FAKE_REPOSITORY}/pull/4#issuecomment-3`;
    const elsewhere = await decisionPr(other, [issueComment(3, "kat", `Decision on ${UNK}.`, 4)]);
    elsewhere.withForge({ pulls: [fakePull(4)] });
    const first = await ci(elsewhere);
    expect(decisionErrors(first)).toEqual([expect.stringContaining(`ref ${other}: decision: pull_request`)]);
    expect(first.exitCode).toBe(1);

    const moved = `${SPEC_PR}#issuecomment-3`;
    const second = await ci(await decisionPr(moved, [issueComment(3, "kat", `Decision on ${UNK}.`, 4)]));
    expect(decisionErrors(second)).toEqual([expect.stringContaining(`ref ${moved}: decision: pull_request`)]);
    expect(second.exitCode).toBe(1);

    const review = `${SPEC_PR}#discussion_r9`;
    const form = await ci(await decisionPr(review, []));
    expect(decisionErrors(form)).toEqual([expect.stringContaining(`ref ${review}: decision: form`)]);
    expect(form.exitCode).toBe(1);
  });

  it("no such comment on the forge, a comment of another repository: missing / repository (SCN-VER-115)", async () => {
    const missing = await ci(await decisionPr(DECISION_REF, []));
    expect(decisionErrors(missing)).toEqual([expect.stringContaining(`ref ${DECISION_REF}: decision: missing`)]);
    expect(missing.exitCode).toBe(1);
    const foreign = "https://github.com/x/y/pull/5#issuecomment-11";
    const result = await ci(await decisionPr(foreign, [issueComment(11, "kat", `Decision on ${UNK}.`)]));
    expect(decisionErrors(result)).toEqual([expect.stringContaining(`ref ${foreign}: decision: repository`)]);
    expect(result.exitCode).toBe(1);
  });

  it("a spec-PR before approval: a finding DECISION_NOT_VERIFIED — author, or forge when it is unavailable or refuses access — not an error (SCN-VER-114)", async () => {
    for (const [failure, detail] of [
      [undefined, "author"],
      ["unavailable", "forge"],
      ["access", "forge"]
    ] as const) {
      const p = await changeRepo("PROPOSED");
      pullRequest(p, "spec/add-search", (b) => {
        advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
        withUnknowns(b, [decided(UNK, DECISION_REF)]);
      });
      p.withForge({ pulls: [fakePull(5)], comments: [issueComment(11, "bob", `Decision on ${UNK}.`)] });
      p.forge.failure = failure;
      const result = await ci(p);
      expect(result.data["kind"]).toBe("spec");
      const findings = result.data["findings"].filter((f: Data) => f["code"] === "DECISION_NOT_VERIFIED");
      expect(findings.map((f: Data) => f["message"])).toEqual([expect.stringContaining(`ref ${DECISION_REF}: decision: ${detail}`)]);
      expect(codes(result)).toEqual([]);
      expect(result.exitCode).toBe(0);
    }
  });

  it("the record of the base in SPECIFIED: a decided UNKNOWN removed or weakened on HEAD — RECORD_MISMATCH unknowns; an open one closed by a decision — none (SCN-VER-116)", async () => {
    const open = { id: "UNK-SRC-005", text: "Which tokenizer?", blocking: true };
    const closed = decided("UNK-SRC-005", `${SPEC_PR}#issuecomment-12`);
    const judged = async (head: Record<string, unknown>[]): Promise<Result> => {
      const p = await firstImplCommit(
        "kat",
        CHORE,
        (b) => withUnknowns(b, head),
        (b) => withUnknowns(b, [decided(UNK, DECISION_REF), open])
      );
      p.withForge({ comments: [issueComment(11, "kat", `Decision on ${UNK}.`), issueComment(12, "kat", "Decision on UNK-SRC-005.")] });
      return ci(p);
    };
    for (const head of [
      [closed],
      [{ ...decided(UNK, DECISION_REF), blocking: false }, closed],
      [{ ...decided(UNK, DECISION_REF), resolved_as: "fact" }, closed]
    ]) {
      const result = await judged(head);
      expect(mismatches(result)).toEqual([expect.stringMatching(new RegExp(`^unknowns/0 \\(${UNK}\\): unknowns: ${UNK} `))]);
      expect(result.errors.find((e) => e.code === "RECORD_MISMATCH")?.path).toMatch(/^\.warrant\/changes\/add-search\.json#\/unknowns/);
      expect(result.exitCode).toBe(1);
    }
    const kept = await judged([decided(UNK, DECISION_REF), closed]);
    expect(mismatches(kept)).toEqual([]);
    expect(decisionErrors(kept)).toEqual([]);
  });
});

/**
 * The whole way to an archive-PR: `main` with the record in `IMPLEMENTING`; the
 * impl-PR records `VERIFYING` and is merged by M; `warrant ci` on M writes the
 * CI records — run 42, attempt 1, whose artifact `evidence-add-search-1` the
 * fake forge holds (`artifact: false` — expired); the archive branch commits
 * them with `transition MERGED --ref` of the impl-PR (pull 9) and, with
 * `archive`, `warrant archive`; `main` — after one more commit of `base`,
 * when given — merges the archive branch: HEAD. `setup` changes the project
 * before its first commit; `records` — the CI records before the artifact is taken.
 */
async function archivePr(
  options: {
    pull?: Record<string, unknown>;
    run?: Partial<WorkflowRun>;
    artifact?: boolean;
    archive?: boolean;
    work?: (p: ProjectBuilder, evidence: string[]) => void;
    record?: (record: Data) => void;
    base?: (p: ProjectBuilder) => void;
    setup?: (p: ProjectBuilder) => void;
    records?: (p: ProjectBuilder, evidence: string[]) => void;
    extra?: Record<string, unknown>;
  } = {}
): Promise<{ p: ProjectBuilder; m: string; head: string; evidence: string[] }> {
  const p = await changeRepo("IMPLEMENTING", options.extra ?? CHORE, (b) => {
    b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } });
    options.setup?.(b);
  });
  const impl = pullRequest(p, "worktree/add-search", (b) => {
    b.write("src/search.ts", "export const search = 1;\n");
    advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  });
  const run = await ci(p, CI_ENV);
  expect(run.errors).toEqual([]);
  const evidence = run.data["evidence"] as string[];
  options.records?.(p, evidence);
  p.withForge({
    pulls: [fakePull(9, { mergeCommit: impl.merge, headSha: impl.head, ...options.pull })],
    runs: [fakeRun(42, { headSha: impl.head, ...options.run })],
    artifacts: options.artifact === false ? [] : [{ runId: 42, name: run.data["artifact"].name, files: artifactOf(p, run.data["artifact"].path) }]
  });

  p.branch("archive/add-search", "main");
  const merged = await invoke(() => runTransition(p.ctx, "add-search", "MERGED", { ref: IMPL_PR }, LOCAL));
  expect(merged.errors).toEqual([]);
  if (options.archive === true) {
    const archived = await invoke(() => runArchive(p.ctx, "add-search", LOCAL));
    expect(archived.errors).toEqual([]);
  }
  if (options.record !== undefined) {
    const record = p.json(RECORD);
    options.record(record);
    p.write(RECORD, record);
  }
  options.work?.(p, evidence);
  p.commit("archive: MERGED");
  p.checkout("main", { force: true });
  if (options.base !== undefined) {
    options.base(p);
    p.commit("base of the archive-PR");
  }
  p.merge("archive/add-search", { label: "Merge archive" });
  return { p, m: impl.merge, head: impl.head, evidence };
}

describe("warrant ci: archive-PR", () => {
  it("an archive-PR with MERGED from CI evidence: ref and record in order; code in it is out of scope (SCN-VER-100)", async () => {
    const { p } = await archivePr({ work: (b) => b.write("src/app.py", "print(1)\n") });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("archive");
    expect(result.data["transitions"]).toEqual([{ to: "MERGED", at: expect.any(String), ref: IMPL_PR }]);
    expect(codes(result)).toEqual(["SCOPE_VIOLATION"]);
    expect(scope(result)).toEqual(["src/app.py"]);
    expect(result.exitCode).toBe(1);
  });

  it("MERGED whose ref is a PR merged by another commit than M: REF_NOT_VERIFIED merge_commit (SCN-VER-093)", async () => {
    const { p } = await archivePr({ pull: { mergeCommit: "c".repeat(40) } });
    const result = await ci(p);
    expect(codes(result)).toEqual(["REF_NOT_VERIFIED"]);
    expect(result.errors[0]?.message).toContain("merge_commit");
    expect(result.exitCode).toBe(1);
  });

  it("MERGED with a PASS gate of checks but no CI record: ci_evidence; with empty gates: policy; a CI record of another check: ci_evidence (SCN-VER-108)", async () => {
    const local = await archivePr({
      record: (record) => {
        const merged = record.transitions.at(-1);
        merged.evidence = [];
      }
    });
    const noCi = await ci(local.p);
    const reasons = noCi.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message);
    expect(reasons.some((m) => m.includes("ci_evidence") && m.includes("tests-passed"))).toBe(true);
    expect(noCi.exitCode).toBe(1);

    const empty = await archivePr({ record: (record) => void (record.transitions.at(-1).gates = {}) });
    const policy = await ci(empty.p);
    expect(policy.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message.includes(": policy: "))).toEqual([true]);
    expect(policy.exitCode).toBe(1);

    // The base narrows tests-passed to check dev-check: the CI record of tests-passed does not back it (I-205).
    const narrowed = await archivePr({
      base: (b) => {
        b.write(".warrant/local/checks/dev-check.json", {
          $schema: "warrant://check/1",
          id: "dev-check",
          version: "1.0.0",
          level: "L1",
          produces: ["test-report"],
          parser: "junit",
          run: { command: ["dev-tests", "{out}"] }
        });
        b.write(".warrant/local/gates/tests-passed.json", {
          $schema: "warrant://gate/1",
          id: "tests-passed",
          version: "1.0.0",
          overrides: "core-sdd:tests-passed",
          level: "L1",
          requires_evidence: [{ kind: "test-report", status: "PROVEN", check: "dev-check" }],
          waivable: false,
          accepts_attestation: ["ci"]
        });
      }
    });
    const other = await ci(narrowed.p);
    const mismatches = other.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message);
    expect(mismatches.filter((m) => m.includes("ci_evidence"))).toEqual([expect.stringContaining("test-report record of check dev-check")]);
    expect(other.exitCode).toBe(1);
  });

  it("gh without access while a ref needs it: FORGE_ACCESS with the hint, exit 3; the forge unreachable: FORGE_UNAVAILABLE retryable, exit 4 (SCN-VER-084)", async () => {
    const denied = await archivePr();
    denied.p.forge.failure = "access";
    const access = await ci(denied.p);
    expect(access.errors[0]?.code).toBe("FORGE_ACCESS");
    expect(access.errors[0]?.hint).toContain("gh auth login");
    expect(access.errors[0]?.hint).toContain("GH_TOKEN");
    expect(toEnvelope("ci", access).errors[0]).not.toHaveProperty("retryable");
    expect(access.exitCode).toBe(3);

    const down = await archivePr();
    down.p.forge.failure = "unavailable";
    const unavailable = await ci(down.p);
    expect(unavailable.errors[0]?.code).toBe("FORGE_UNAVAILABLE");
    expect(toEnvelope("ci", unavailable).errors[0]).toMatchObject({ code: "FORGE_UNAVAILABLE", retryable: true });
    expect(unavailable.exitCode).toBe(4);
  });

  it("GITHUB_REPOSITORY not <owner>/<repo>: USAGE with the hint, exit 3, no call of the forge; a spec-PR that needs no forge — 0; one with a decision — USAGE, no finding (SCN-VER-138)", async () => {
    const { p } = await archivePr();
    p.forge.failure = "repository";
    const archive = await ci(p);
    expect(archive.errors[0]?.code).toBe("USAGE");
    expect(archive.errors[0]?.hint).toContain("<owner>/<repo>");
    expect(toEnvelope("ci", archive).errors[0]).not.toHaveProperty("retryable");
    expect(archive.exitCode).toBe(3);
    expect(p.forge.calls).toEqual([]);

    for (const decision of [false, true]) {
      const spec = await changeRepo("PROPOSED");
      pullRequest(spec, "spec/add-search", (b) => {
        advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
        if (decision) withUnknowns(b, [decided(UNK, DECISION_REF)]);
      });
      spec.forge.failure = "repository";
      const result = await ci(spec);
      // An error of the environment, not the finding DECISION_NOT_VERIFIED of an unavailable forge.
      expect(codes(result)).toEqual(decision ? ["USAGE"] : []);
      expect((result.data["findings"] ?? []).filter((f: Data) => f["code"] === "DECISION_NOT_VERIFIED")).toEqual([]);
      if (!decision) expect(result.data["kind"]).toBe("spec");
      expect(result.exitCode).toBe(decision ? 3 : 0);
    }
  });
});

const SPEC = "openspec/specs/search/spec.md";

/** `EVIDENCE_NOT_VERIFIED` errors: `<id>: <reason>`. */
function unverified(result: Result): string[] {
  return result.errors.filter((e) => e.code === "EVIDENCE_NOT_VERIFIED").map((e) => e.message.split(": ").slice(0, 2).join(": "));
}

describe("warrant ci: CI evidence and the repeated archive of an archive-PR", () => {
  it("an honest archive-PR: MERGED and ARCHIVED, records of the run on the tree of M, specs of the repeat (SCN-VER-091)", async () => {
    const { p, evidence } = await archivePr({ archive: true });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("archive");
    expect(result.data["transitions"].map((t: Data) => t["to"])).toEqual(["MERGED", "ARCHIVED"]);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data["evidence"]).toEqual(evidence);
    expect(p.forge.calls).toEqual(expect.arrayContaining(["pullRequest 9", "workflowRun 42 1", "downloadArtifact 42 evidence-add-search-1"]));
    expect(p.forge.calls.filter((c) => c.startsWith("downloadArtifact"))).toHaveLength(1);
    expect(p.openspec.calls.filter((c) => c === "archive add-search --yes")).toHaveLength(2);
    expect(p.git.checkouts.every((c) => c.disposed)).toBe(true);
  });

  it("an archive-PR with MERGED alone: no repeat of the archive, no SPECS_NOT_ARCHIVED (SCN-VER-106)", async () => {
    const { p } = await archivePr();
    const result = await ci(p);
    expect(result.data["kind"]).toBe("archive");
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(p.openspec.calls.filter((c) => c.startsWith("archive"))).toEqual([]);
  });

  it("main specs with a line the repeated archive does not write: SPECS_NOT_ARCHIVED with the path (SCN-VER-080)", async () => {
    const { p } = await archivePr({ archive: true, work: (b) => b.write(SPEC, `${readFileSync(path.join(b.root, SPEC), "utf8")}Extra line.\n`) });
    const result = await ci(p);
    expect(codes(result)).toEqual(["SPECS_NOT_ARCHIVED"]);
    expect(result.errors[0]?.path).toBe(SPEC);
    expect(result.exitCode).toBe(1);
  });

  it("openspec on PATH out of the range of the base: the repeat fails with exit 3", async () => {
    const { p } = await archivePr({ archive: true });
    p.openspec.installedVersion = "0.1.0";
    const result = await ci(p);
    expect(codes(result)).toEqual(["OPENSPEC_VERSION"]);
    expect(result.exitCode).toBe(3);
  });

  it("a CI record differing from the artifact by evidence_status: EVIDENCE_NOT_VERIFIED content with its id (SCN-VER-079)", async () => {
    let changed = "";
    const { p } = await archivePr({
      work: (b, evidence) => {
        changed = evidence[0] as string;
        const rel = `${EVIDENCE}/${changed}.json`;
        const record = b.json(rel);
        record.evidence_status = record.evidence_status === "PROVEN" ? "NOT_PROVEN" : "PROVEN";
        b.write(rel, record);
      }
    });
    const result = await ci(p);
    expect(unverified(result)).toEqual([`${changed}: content`]);
    expect(result.errors.find((e) => e.code === "EVIDENCE_NOT_VERIFIED")?.path).toBe(`${EVIDENCE}/${changed}.json`);
    expect(result.exitCode).toBe(1);
  });

  it("a workflow_dispatch attempt from feature/x: EVIDENCE_NOT_VERIFIED branch (SCN-VER-102); from main it is verified without head sha (SCN-VER-096)", async () => {
    const feature = await archivePr({ run: { event: "workflow_dispatch", headBranch: "feature/x", headSha: "d".repeat(40) } });
    const refused = await ci(feature.p);
    expect(unverified(refused)).toEqual(feature.evidence.map((id) => `${id}: branch`));
    expect(refused.exitCode).toBe(1);

    const main = await archivePr({ run: { event: "workflow_dispatch", headBranch: "main", headSha: "d".repeat(40) } });
    const accepted = await ci(main.p);
    expect(accepted.errors).toEqual([]);
    expect(accepted.data["evidence"]).toEqual(main.evidence);
  });

  it("an attempt that failed, of a pull_request run on another head, or without its artifact: EVIDENCE_NOT_VERIFIED with the reason", async () => {
    const failed = await archivePr({ run: { conclusion: "failure" } });
    expect(unverified(await ci(failed.p))).toEqual(failed.evidence.map((id) => `${id}: conclusion`));
    const other = await archivePr({ run: { headSha: "e".repeat(40) } });
    expect(unverified(await ci(other.p))).toEqual(other.evidence.map((id) => `${id}: head_sha`));
    const expired = await archivePr({ artifact: false });
    const result = await ci(expired.p);
    expect(unverified(result)).toEqual(expired.evidence.map((id) => `${id}: artifact`));
    expect(result.errors[0]?.hint).toContain("gh workflow run ci.yml -f merge_commit=");
  });

  it("the recovery hint of an expired artifact names the workflow of the run, not a literal (BL-53)", async () => {
    const { p, m } = await archivePr({ artifact: false, run: { workflowPath: ".github/workflows/warrant.yml" } });
    const result = await ci(p);
    expect(result.errors[0]?.hint).toBe(`run the job on M: gh workflow run warrant.yml -f merge_commit=${m}, then warrant ci fetch <impl-PR>`);
  });
});

/** `main` with the record in `IMPLEMENTING` (`extra`), the impl-PR recording `VERIFYING` with `src/search.ts`, merged: HEAD. */
async function implPr(extra: Record<string, unknown> = CHORE, setup?: (p: ProjectBuilder) => void): Promise<{ p: ProjectBuilder; head: string; merge: string }> {
  const p = await changeRepo("IMPLEMENTING", extra, setup);
  const { head, merge } = pullRequest(p, "worktree/add-search", (b) => {
    b.write("src/search.ts", "export const search = 1;\n");
    advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  });
  return { p, head, merge };
}

/** `human-approval` on `VERIFYING->MERGED` comes from the profile of acceptance over `src/**`, not from risk (design D6, D9). */
const ACCEPTED = { classification: { profiles: ["chore", "human-acceptance"] } };

describe("warrant ci: the merge verdict of an impl-PR", () => {
  it("checks on the result of the merge write CI evidence; human-approval deferred; no commit (SCN-VER-075, SCN-VER-068)", async () => {
    const { p, head, merge } = await implPr(ACCEPTED, (b) => b.write(ACCEPTANCE, acceptance()));
    const commits = p.git.commits.size;
    const result = await ci(p, CI_ENV);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data["kind"]).toBe("impl");
    expect(result.data["deferred"]).toEqual(["human-approval"]);
    expect(result.data["gates"]["tests-passed"]).toBe("PASS");
    expect(result.data["artifact"]).toEqual({ name: "evidence-add-search-1", path: EVIDENCE });
    const ids = result.data["evidence"] as string[];
    expect(ids.length).toBeGreaterThan(0);
    const tree = await p.git.treeId(merge);
    for (const id of ids) {
      const record = p.json(`${EVIDENCE}/${id}.json`);
      expect(record.attestation).toEqual({ type: "ci", ref: "https://github.com/kat/project/actions/runs/42" });
      expect(record.subject).toMatchObject({ commit: head, base_commit: await p.git.resolveCommit(`${merge}^1`), tree });
    }
    expect(p.git.commits.size).toBe(commits);
    expect(await p.git.head()).toBe(merge);

    const second = await ci(p, { ...CI_ENV, GITHUB_RUN_ATTEMPT: "2" });
    expect(second.data["artifact"]["name"]).toBe("evidence-add-search-2");
  });

  it("junit with a failure: tests-passed FAIL, GATE_NOT_PASSED (SCN-VER-076)", async () => {
    const { p } = await implPr();
    fakeTests(p, 1);
    const result = await ci(p, CI_ENV);
    expect(result.data["gates"]["tests-passed"]).toBe("FAIL");
    expect(result.errors.filter((e) => e.code === "GATE_NOT_PASSED").map((e) => e.message.includes("tests-passed"))).toEqual([true]);
    expect(result.exitCode).toBe(1);
  });

  it("code changed without a post event: FRONTEND_HOOKS_INACTIVE in findings, exit 0 (SCN-VER-082)", async () => {
    const { p } = await implPr(CHORE, (b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
    const result = await ci(p, CI_ENV);
    expect(result.errors).toEqual([]);
    const hooks = result.data["findings"].filter((f: Data) => f["code"] === "FRONTEND_HOOKS_INACTIVE");
    expect(hooks.map((f: Data) => f["paths"])).toEqual([["src/search.ts"]]);
    expect(result.exitCode).toBe(0);
  });

  it("a check over its timeout: CHECK_TIMEOUT retryable, tests-passed BLOCKED without GATE_NOT_PASSED, exit 4; with SCOPE_VIOLATION — 1 (SCN-VER-095)", async () => {
    const { p } = await implPr();
    p.checks.on("fake-tests", { timedOut: true });
    const result = await ci(p, CI_ENV);
    expect(codes(result)).toEqual(["CHECK_TIMEOUT"]);
    expect(toEnvelope("ci", result).errors[0]).toMatchObject({ code: "CHECK_TIMEOUT", retryable: true });
    expect(result.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(result.exitCode).toBe(4);

    // A violation of the pull request is elder than the failure (1 > 4): a retry would not lift it.
    const scoped = await changeRepo("IMPLEMENTING");
    pullRequest(scoped, "worktree/add-search", (b) => {
      b.write("src/search.ts", "export const search = 1;\n");
      b.write("openspec/specs/search/spec.md", "# search\n");
      advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
    });
    scoped.checks.on("fake-tests", { timedOut: true });
    const violated = await ci(scoped, CI_ENV);
    expect(codes(violated)).toEqual(expect.arrayContaining(["CHECK_TIMEOUT", "SCOPE_VIOLATION"]));
    // scope-valid fails on the specs in the diff; tests-passed, starved by the failed check, gives no GATE_NOT_PASSED.
    expect(violated.errors.filter((e) => e.code === "GATE_NOT_PASSED").map((e) => e.message)).toEqual(["gate scope-valid of VERIFYING->MERGED is FAIL"]);
    expect(violated.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(violated.exitCode).toBe(1);
  });

  it("a conflict of the effective policy of the base: POLICY_CONFLICT, class wait — exit 2 (3 before exit-contract), --dry-run too", async () => {
    const { p } = await implPr(CHORE, (b) =>
      b.write(".warrant/local/overlays/perf.json", { $schema: "warrant://overlay/1", id: "perf", version: "1.0.0", match: {}, evidence: { required: ["perf-report"] } })
    );
    const result = await ci(p, CI_ENV);
    expect(codes(result)).toEqual(["POLICY_CONFLICT"]);
    expect(result.exitCode).toBe(2);
    const plan = await ci(p, CI_ENV, { dryRun: true });
    expect([codes(plan), plan.exitCode]).toEqual([["POLICY_CONFLICT"], 2]);
  });

  it("the lock of check held: BUSY retryable, the gate of the check BLOCKED without GATE_NOT_PASSED, exit 4 (SCN-VER-137)", async () => {
    const { p } = await implPr();
    const held = acquireLock(lockPath(p.root, await p.git.commonDir()).file, { pid: 1, check: "tests-passed", started_at: AT, cwd: p.root }, p.ctx.signals);
    expect(held.ok).toBe(true);
    try {
      const result = await ci(p, CI_ENV);
      expect(codes(result)).toEqual(["BUSY"]);
      expect(toEnvelope("ci", result).errors[0]).toMatchObject({ code: "BUSY", retryable: true });
      expect(result.data["gates"]["tests-passed"]).toBe("BLOCKED");
      expect(result.exitCode).toBe(4);
    } finally {
      if (held.ok) held.release();
    }
  });

  it("a later PROVEN record of another run does not count: the attempt's NOT_PROVEN fails the gate (SCN-VER-098)", async () => {
    const { p } = await implPr();
    const other = await ci(p, { ...CI_ENV, GITHUB_RUN_ID: "41" });
    expect(other.exitCode).toBe(0);
    for (const id of other.data["evidence"] as string[]) {
      const rel = `${EVIDENCE}/${id}.json`;
      p.write(rel, { ...p.json(rel), created_at: "2099-01-01T00:00:00Z" });
    }
    fakeTests(p, 1);
    const result = await ci(p, CI_ENV);
    expect(result.data["gates"]["tests-passed"]).toBe("FAIL");
    expect(codes(result)).toContain("GATE_NOT_PASSED");
    expect(result.exitCode).toBe(1);
  });

  it("--dry-run: kind, checks and would_write without running a check or asking the forge (SCN-VER-085)", async () => {
    const { p } = await implPr();
    const result = await ci(p, CI_ENV, { dryRun: true });
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ kind: "impl", change: "add-search", dry_run: true, would_write: [`${EVIDENCE}/`] });
    expect(result.data["checks"]).toContain("tests-passed");
    expect(p.checks.calls).toEqual([]);
    expect(p.forge.calls).toEqual([]);
  });

  it("--no-record: the verdict of warrant ci, nothing left in .warrant — on success and on CHECK_TIMEOUT (SCN-VER-154)", async () => {
    const { p } = await implPr();
    // The evidence directory already holds a record, a manifest and raw/ of an earlier run.
    const first = await ci(p);
    expect(first.data["evidence"]).toHaveLength(1);
    const warrantTree = (): Record<string, string> => Object.fromEntries(Object.entries(p.tree()).filter(([k]) => k.startsWith(".warrant/")));
    const before = warrantTree();

    const dry = await ci(p, LOCAL, { noRecord: true });
    expect(warrantTree()).toEqual(before);
    expect(dry.data).toMatchObject({ no_record: true, not_restored: [] });
    const wet = await ci(p);
    const verdict = (r: Result): unknown => ({
      kind: r.data["kind"],
      gates: r.data["gates"],
      deferred: r.data["deferred"],
      findings: (r.data["findings"] as Data[]).map((x) => x["code"]),
      errors: r.errors.map((e) => e.code),
      exit: r.exitCode
    });
    expect(verdict(dry)).toEqual(verdict(wet));
    expect(dry.exitCode).toBe(1);
    expect(dry.errors.map((e) => e.code)).toContain("GATE_NOT_PASSED");

    p.checks.on("fake-tests", { timedOut: true });
    const settled = warrantTree();
    const timedOut = await ci(p, LOCAL, { noRecord: true });
    expect(codes(timedOut)).toContain("CHECK_TIMEOUT");
    expect(timedOut.exitCode).toBe(4);
    expect(timedOut.data).toMatchObject({ no_record: true, not_restored: [] });
    expect(warrantTree()).toEqual(settled);
  });

  it("--no-record with --dry-run or in GitHub Actions: USAGE, no_record, exit 3, nothing written (SCN-VER-155)", async () => {
    const { p } = await implPr();
    const before = p.tree();
    for (const [env, opts] of [[LOCAL, { noRecord: true, dryRun: true }], [CI_ENV, { noRecord: true }]] as const) {
      const result = await ci(p, env, opts);
      expect(codes(result)).toEqual(["USAGE"]);
      expect(result.data).toMatchObject({ no_record: true, not_restored: [] });
      expect(result.exitCode).toBe(3);
    }
    expect(p.tree()).toEqual(before);
  });

  it("WARRANT_STATE_DIR: USAGE, exit 3", async () => {
    const { p } = await implPr();
    const result = await ci(p, { ...CI_ENV, WARRANT_STATE_DIR: path.join(p.root, "state") });
    expect(codes(result)).toEqual(["USAGE"]);
    expect(result.exitCode).toBe(3);
  });

  it("a local run of runCheck leaves nothing for ci to count (the attempt of this call only)", async () => {
    const { p } = await implPr();
    const local = await invoke(() => runCheck(p.ctx, "add-search", ["tests-passed"], {}, LOCAL));
    expect(local.errors).toEqual([]);
    // Outside GitHub Actions the records of this call carry attestation none: gates L1 are BLOCKED (REQ-VER-003).
    const result = await ci(p, LOCAL);
    expect(result.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(codes(result)).toContain("GATE_NOT_PASSED");
    expect(result.exitCode).toBe(1);
  });
});

const ACCEPTANCE = ".warrant/local/profiles/human-acceptance.json";
const HOMASTERS = "homasters";

/** The profile of human acceptance of the project layer (design D6): an impl-PR touching `paths` is merged by a human. */
function acceptance(paths: string[] = ["src/**"]): Record<string, unknown> {
  return {
    $schema: "warrant://profile/1",
    id: "human-acceptance",
    version: "1.0.0",
    description: "Paths whose impl-PR a human merges.",
    match: { paths },
    gates: { "VERIFYING->MERGED": ["human-approval"] },
    approvals: [{ role: "maintainer", at: "VERIFYING->MERGED" }]
  };
}

/** `paths.src`, `roles.maintainer` `[kat]`, `identities.agents` `[homasters]`; with `human` — the profile of acceptance over `src/**`. */
function agentProject(human: boolean): (p: ProjectBuilder) => void {
  return (p) => {
    p.write(".warrant/warrant.json", {
      ...p.json(".warrant/warrant.json"),
      paths: { src: "src" },
      roles: { maintainer: ["kat"] },
      identities: { agents: [{ login: HOMASTERS, kind: "bot" }] }
    });
    if (human) p.write(ACCEPTANCE, acceptance());
  };
}

/**
 * The way of SCN-VER-129…131, 135: `main` with the record in `PROPOSED`; the
 * spec-PR (pull 5, opened by `homasters`, merged by `kat`) records `SPECIFIED`;
 * the impl-PR (pull 9, opened by `homasters`, merged by `mergedBy`) records
 * `APPROVED`, `IMPLEMENTING`, `src/search.ts` and `VERIFYING` — with `split`,
 * the first three come in an earlier pull request and the impl-PR brings only
 * `VERIFYING`; `warrant ci` on M writes the CI records; the archive-PR records
 * `MERGED --ref` of the impl-PR (`--by`, when the policy of HEAD asks a human).
 * `main` changes `main` in one more commit before the impl-PR; `hand` writes `MERGED`
 * by hand, for an impl-PR whose record `warrant transition` would not move.
 */
async function agentMerge(o: {
  mergedBy: string;
  human?: boolean;
  profiles?: string[];
  split?: boolean;
  main?: (p: ProjectBuilder) => void;
  work?: (p: ProjectBuilder) => void;
  by?: string;
  hand?: boolean;
}): Promise<ProjectBuilder> {
  const human = o.human === true;
  const profiles = o.profiles ?? (human ? ["chore", "human-acceptance"] : ["chore"]);
  const p = await changeRepo("PROPOSED", { classification: { profiles } }, agentProject(human));
  const spec = pullRequest(p, "spec/add-search", (b) => advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } }));
  p.withForge({ pulls: [fakePull(5, { mergeCommit: spec.merge, headSha: spec.head, author: HOMASTERS })] });
  if (o.main !== undefined) {
    o.main(p);
    p.commit("base: main moves");
  }
  const approve = (b: ProjectBuilder): void => {
    advance(b, "APPROVED", { gates: { "human-approval": "PASS" }, ref: SPEC_PR });
    advance(b, "IMPLEMENTING", { gates: { "branch-isolated": "PASS" } });
    b.write("src/search.ts", "export const search = 1;\n");
  };
  if (o.split === true) pullRequest(p, "worktree/add-search", approve);
  const impl = pullRequest(p, o.split === true ? "worktree/add-search-verify" : "worktree/add-search", (b) => {
    if (o.split === true) b.write("src/search.ts", "export const search = 2;\n");
    else approve(b);
    o.work?.(b);
    advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  });
  const run = await ci(p, CI_ENV);
  p.withForge({
    pulls: [fakePull(9, { mergeCommit: impl.merge, headSha: impl.head, mergedBy: o.mergedBy, author: HOMASTERS })],
    runs: [fakeRun(42, { headSha: impl.head })],
    artifacts: [{ runId: 42, name: run.data["artifact"].name, files: artifactOf(p, run.data["artifact"].path) }]
  });
  p.branch("archive/add-search", "main");
  if (o.hand === true) advance(p, "MERGED", { ref: IMPL_PR, evidence: run.data["evidence"] });
  else {
    const merged = await invoke(() => runTransition(p.ctx, "add-search", "MERGED", { ref: IMPL_PR, ...(o.by === undefined ? {} : { by: o.by }) }, LOCAL));
    expect(merged.errors).toEqual([]);
  }
  p.commit("archive: MERGED");
  p.checkout("main", { force: true });
  p.merge("archive/add-search", { label: "Merge archive" });
  return p;
}

/** Messages of `REF_NOT_VERIFIED`. */
function refMessages(result: Result): string[] {
  return result.errors.filter((e) => e.code === "REF_NOT_VERIFIED").map((e) => e.message);
}

/** Findings of `code`. */
function findingsOf(result: Result, code: string): Data[] {
  return result.data["findings"].filter((f: Data) => f["code"] === code);
}

describe("warrant ci: the ref of MERGED by the law of M^1 (agent-merge, design D3)", () => {
  it("an impl-PR opened and merged by an agent of M^1 without human-approval: verified, no identity findings; merged outside roles and agents — merged_by (SCN-VER-130)", async () => {
    const p = await agentMerge({ mergedBy: HOMASTERS });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("archive");
    expect(result.errors).toEqual([]);
    expect(identityFindings(result)).toEqual([]);
    expect(findingsOf(result, "AGENT_MERGE_CLOSED")).toEqual([]);
    expect(result.exitCode).toBe(0);

    const outside = await ci(await agentMerge({ mergedBy: "mallory" }));
    expect(refMessages(outside)).toEqual([expect.stringContaining(`ref ${IMPL_PR}: merged_by: mallory merged pull request 9, neither a member of roles nor an agent identity of M^1`)]);
    expect(outside.exitCode).toBe(1);
  });

  it("the policy by M^1 holds human-approval (the profile of acceptance over the diff): an agent's merge is merged_by, no AGENT_MERGE_CLOSED (SCN-VER-131)", async () => {
    const result = await ci(await agentMerge({ mergedBy: HOMASTERS, human: true, by: "kat" }));
    expect(refMessages(result)).toEqual([expect.stringContaining(`ref ${IMPL_PR}: merged_by: ${HOMASTERS} merged pull request 9, not a member of roles maintainer of M^1`)]);
    expect(findingsOf(result, "AGENT_MERGE_CLOSED")).toEqual([]);
    expect(result.exitCode).toBe(1);
  });

  it("an impl-PR that narrowed the profile of acceptance and dropped it from the record, or moved the agent into roles: judged by M^1 — merged_by (SCN-VER-129)", async () => {
    const narrowed = await agentMerge({
      mergedBy: HOMASTERS,
      human: true,
      hand: true,
      work: (b) => {
        b.write(ACCEPTANCE, acceptance(["nothing/**"]));
        const record = b.json(RECORD);
        // factory-change: the impl-PR touches the project layer, its own warrant ci asks for it.
        record.classification.profiles = ["chore", "factory-change"];
        b.write(RECORD, record);
      }
    });
    const lifted = await ci(narrowed);
    expect(refMessages(lifted)).toEqual([expect.stringContaining(`merged_by: ${HOMASTERS} merged pull request 9, not a member of roles maintainer of M^1`)]);
    expect(lifted.exitCode).toBe(1);

    const promoted = await agentMerge({
      mergedBy: HOMASTERS,
      human: true,
      profiles: ["chore", "factory-change", "human-acceptance"],
      hand: true,
      work: (b) => {
        const config = b.json(".warrant/warrant.json");
        delete config.identities;
        b.write(".warrant/warrant.json", { ...config, roles: { maintainer: ["kat", HOMASTERS] } });
      }
    });
    const role = await ci(promoted);
    expect(refMessages(role)).toEqual([expect.stringContaining(`merged_by: ${HOMASTERS} merged pull request 9, not a member of roles maintainer of M^1`)]);
    expect(role.exitCode).toBe(1);
  });

  it("the implementation reached main before the impl-PR: an agent's merge is merged_by with AGENT_MERGE_CLOSED; a maintainer's is verified with it (SCN-VER-135)", async () => {
    const agent = await ci(await agentMerge({ mergedBy: HOMASTERS, split: true }));
    expect(refMessages(agent)).toEqual([expect.stringContaining(`merged_by: ${HOMASTERS} merged pull request 9, not a member of roles maintainer of M^1`)]);
    expect(findingsOf(agent, "AGENT_MERGE_CLOSED").map((f) => f["message"])).toEqual([
      expect.stringContaining("the record of add-search is IMPLEMENTING on M^1")
    ]);
    expect(agent.exitCode).toBe(1);

    const maintainer = await ci(await agentMerge({ mergedBy: "kat", split: true }));
    expect(maintainer.errors).toEqual([]);
    expect(findingsOf(maintainer, "AGENT_MERGE_CLOSED")).toHaveLength(1);
    expect(maintainer.exitCode).toBe(0);
  });

  it("the policy by M^1 is not computed — a bundled pack the lock of M^1 does not hold: fail-closed to roles.maintainer of M^1, AGENT_MERGE_CLOSED (REQ-VER-011, design D3)", async () => {
    const LOCK = ".warrant/warrant.lock.json";
    let held: Data = {};
    const p = await agentMerge({
      mergedBy: HOMASTERS,
      profiles: ["chore", "factory-change"],
      hand: true,
      main: (b) => {
        held = b.json(LOCK);
        stale(b);
      },
      work: (b) => b.write(LOCK, held)
    });
    const result = await ci(p);
    expect(refMessages(result)).toEqual([expect.stringContaining(`merged_by: ${HOMASTERS} merged pull request 9, not a member of roles maintainer of M^1`)]);
    expect(findingsOf(result, "AGENT_MERGE_CLOSED").map((f) => f["message"])).toEqual([expect.stringContaining("is not computed by this CLI: bundled pack core-sdd")]);
    expect(result.exitCode).toBe(1);
  });

  it("a spec-PR merged by an agent of the base, no approvals[] at SPECIFIED->APPROVED: merged_by — approval of a spec is roles.maintainer (SCN-VER-132)", async () => {
    const plain = { $schema: "warrant://profile/1", id: "plain", version: "1.0.0", description: "A profile without approvals.", match: { paths: ["notes/**"] } };
    const p = await firstImplCommit(HOMASTERS, { classification: { profiles: ["plain"] } }, undefined, undefined, {
      setup: (b) => {
        agentProject(false)(b);
        b.write(".warrant/local/profiles/plain.json", plain);
      }
    });
    const result = await ci(p);
    expect(refMessages(result)).toEqual([expect.stringContaining(`ref ${SPEC_PR}: merged_by: ${HOMASTERS} merged pull request 5, not a member of roles maintainer of the base`)]);
    expect(result.exitCode).toBe(1);
  });
});

/** `tests-passed` of the project layer: `waivable`, and with `appliesWhen` — `applies_when.changed_paths`. */
function testsPassed(fields: Record<string, unknown>): (p: ProjectBuilder) => void {
  return (p) =>
    p.write(".warrant/local/gates/tests-passed.json", {
      $schema: "warrant://gate/1",
      id: "tests-passed",
      version: "1.0.0",
      overrides: "core-sdd:tests-passed",
      level: "L1",
      requires_evidence: [{ kind: "test-report", status: "PROVEN" }],
      waivable: false,
      accepts_attestation: ["ci"],
      ...fields
    });
}

/** The Change classified with profile `waivable` of the project layer (`waivableGate`). */
const WAIVABLE = { classification: { profiles: ["chore", "waivable"] } };

/** Gate `tests-accepted` of the project layer — waivable, backed by the CI test report — on `VERIFYING->MERGED` by profile `waivable`. */
function waivableGate(p: ProjectBuilder): void {
  p.write(".warrant/local/gates/tests-accepted.json", {
    $schema: "warrant://gate/1",
    id: "tests-accepted",
    version: "1.0.0",
    level: "L1",
    requires_evidence: [{ kind: "test-report", status: "PROVEN" }],
    waivable: true,
    accepts_attestation: ["ci"]
  });
  p.write(".warrant/local/profiles/waivable.json", {
    $schema: "warrant://profile/1",
    id: "waivable",
    version: "1.0.0",
    description: "A waivable gate before merge.",
    match: { paths: ["nothing/**"] },
    gates: { "VERIFYING->MERGED": ["tests-accepted"] }
  });
}

/** A waiver of `add-search` on `tests-accepted`, approved by `kat`, in force; `fields` override. */
function acceptedWaiver(p: ProjectBuilder, fields: Record<string, unknown> = {}): void {
  p.withWaiver({
    id: "WAV-2026-030",
    change: "add-search",
    gate: "tests-accepted",
    reason: "the fixture waives the gate",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE",
    ...fields
  });
}

/** Sets the verdict of `gate` of the last transition (`MERGED`) of the record. */
function verdictOf(gate: string, verdict: string): (record: Data) => void {
  return (record) => void (record.transitions.at(-1).gates[gate] = verdict);
}

/** `RECORD_MISMATCH` messages with `: <reason>: `. */
function mismatchesOf(result: Result, reason: string): string[] {
  return result.errors.filter((e) => e.code === "RECORD_MISMATCH" && e.message.includes(`: ${reason}: `)).map((e) => e.message);
}

/** The archive-PR of {@link archivePr} whose `MERGED` records `tests-accepted: WAIVED`; `base` — the waiver the base holds, `head` — the one HEAD adds. */
async function waivedPr(base?: Record<string, unknown>, head?: Record<string, unknown>): Promise<ProjectBuilder> {
  const { p } = await archivePr({
    extra: WAIVABLE,
    setup: (b) => {
      waivableGate(b);
      if (base !== undefined) acceptedWaiver(b, base);
    },
    ...(head === undefined ? {} : { work: (b: ProjectBuilder) => acceptedWaiver(b, head) }),
    record: verdictOf("tests-accepted", "WAIVED")
  });
  return p;
}

describe("warrant ci: the ground of recorded WAIVED and NOT_APPLICABLE (agent-merge, design D4)", () => {
  it("WAIVED with a waiver REVOKED in the base and ACTIVE on HEAD, with none, or expired before the run: RECORD_MISMATCH waiver (SCN-VER-127)", async () => {
    const byBase = await ci(await waivedPr({ waiver_state: "REVOKED" }, {}));
    expect(mismatchesOf(byBase, "waiver")).toEqual([
      expect.stringContaining("gate tests-accepted is WAIVED, but no waiver of add-search on it counts on 2026-09-24: WAV-2026-030 (state)")
    ]);
    expect(byBase.errors.find((e) => e.code === "RECORD_MISMATCH")?.path).toBe(`${RECORD}#/transitions/2/gates/tests-accepted`);
    expect(byBase.exitCode).toBe(1);

    expect(mismatchesOf(await ci(await waivedPr()), "waiver")).toEqual([expect.stringContaining("gate tests-accepted is WAIVED")]);
    expect(mismatchesOf(await ci(await waivedPr({ expires_at: "2026-09-01" })), "waiver")).toEqual([expect.stringContaining("WAV-2026-030 (expired)")]);
  });

  it("WAIVED with a waiver of the base that counts, or one only HEAD holds: the rule holds (SCN-VER-127)", async () => {
    const inBase = await ci(await waivedPr({}));
    expect(inBase.errors).toEqual([]);
    expect(inBase.exitCode).toBe(0);

    // A new waiver on HEAD counts; the archive-PR that adds it is judged by its paths as well (classification: factory-change).
    const onHead = await ci(await waivedPr(undefined, {}));
    expect(mismatchesOf(onHead, "waiver")).toEqual([]);
  });

  it("NOT_APPLICABLE over a diff applies_when hits and a PROVEN record, or of a gate with neither applies_when nor requires_evidence: RECORD_MISMATCH not_applicable (SCN-VER-128)", async () => {
    const proven = await archivePr({ setup: testsPassed({ applies_when: { changed_paths: ["src/**"] } }), record: verdictOf("tests-passed", "NOT_APPLICABLE") });
    const hit = await ci(proven.p);
    expect(mismatchesOf(hit, "not_applicable")).toEqual([expect.stringContaining("gate tests-passed is NOT_APPLICABLE without a ground")]);
    expect(hit.exitCode).toBe(1);

    const scope = await archivePr({ record: verdictOf("scope-valid", "NOT_APPLICABLE") });
    expect(mismatchesOf(await ci(scope.p), "not_applicable")).toEqual([expect.stringContaining("gate scope-valid is NOT_APPLICABLE")]);
  });

  it("NOT_APPLICABLE backed by CI records NOT_APPLICABLE of a check on M^2, or by applies_when missing the diff of the impl-PR: the rule holds (SCN-VER-128)", async () => {
    const byEvidence = await archivePr({
      setup: testsPassed({ applies_when: { changed_paths: ["src/**"] } }),
      records: (b, ids) => {
        for (const id of ids) {
          const rel = `${EVIDENCE}/${id}.json`;
          const record = b.json(rel);
          if (record.kind === "test-report") b.write(rel, { ...record, evidence_status: "NOT_APPLICABLE" });
        }
      }
    });
    const evidence = await ci(byEvidence.p);
    expect(byEvidence.p.json(RECORD).transitions.at(-1).gates["tests-passed"]).toBe("NOT_APPLICABLE");
    expect(mismatchesOf(evidence, "not_applicable")).toEqual([]);
    expect(evidence.exitCode).toBe(0);

    const missed = await archivePr({ setup: testsPassed({ applies_when: { changed_paths: ["lib/**"] } }) });
    const diff = await ci(missed.p);
    expect(missed.p.json(RECORD).transitions.at(-1).gates["tests-passed"]).toBe("NOT_APPLICABLE");
    expect(mismatchesOf(diff, "not_applicable")).toEqual([]);
    expect(diff.exitCode).toBe(0);
  });
});

describe("warrant ci: code without a Change and a project without human acceptance (agent-merge, D8, D10)", () => {
  it("a pull request without a Change changes code: SCOPE_VIOLATION by paths.src; without paths.src and paths.tests — skipped (SCN-VER-133)", async () => {
    const p = await repo((b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
    pullRequest(p, "fix/code", (b) => b.write("src/a.ts", "export const a = 1;\n"));
    const result = await ci(p);
    expect(result.data["kind"]).toBe("none");
    expect(scope(result)).toEqual(["src/a.ts"]);
    expect(result.exitCode).toBe(1);

    const q = await repo();
    pullRequest(q, "fix/code", (b) => b.write("src/a.ts", "export const a = 1;\n"));
    const skipped = await ci(q);
    expect(skipped.errors).toEqual([]);
    expect(skipped.data["skipped"]).toEqual([{ rule: "code", reason: expect.stringContaining("paths.src and paths.tests") }]);
    expect(skipped.exitCode).toBe(0);
  });

  it("no object of the policy of the base puts human-approval on VERIFYING->MERGED: the finding NO_HUMAN_ACCEPTANCE, exit unchanged; the profile of acceptance — none (SCN-VER-134)", async () => {
    const p = await repo();
    pullRequest(p, "docs/readme", (b) => b.write("docs/readme.md", "# Readme\n"));
    const result = await ci(p);
    expect(findingsOf(result, "NO_HUMAN_ACCEPTANCE")).toEqual([{ code: "NO_HUMAN_ACCEPTANCE", message: expect.stringContaining("human-approval on VERIFYING->MERGED") }]);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);

    const q = await repo((b) => b.write(ACCEPTANCE, acceptance()));
    pullRequest(q, "docs/readme", (b) => b.write("docs/readme.md", "# Readme\n"));
    expect(findingsOf(await ci(q), "NO_HUMAN_ACCEPTANCE")).toEqual([]);
  });
});
