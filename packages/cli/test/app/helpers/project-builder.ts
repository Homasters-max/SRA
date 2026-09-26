/**
 * `ProjectBuilder` (ADR-0025 п. 6, design §6): a WARRANT project in a temporary
 * directory and a `ctx` over fake ports, for tests of the `app` level. Every
 * `with…` call writes the files — JSON through `writeJsonFile`, as the CLI —
 * and fills the model of the fakes in the same call, so the fakes answer what
 * the real `openspec` and `git` would answer about those files. `synced()` runs
 * `runSync` in the test process with the same `ctx`; `commit()` takes a
 * snapshot of the files into `FakeGit`.
 *
 * The base project is the one `useSyncedProject` builds before `openspec init`
 * and `warrant sync` (e2e); after `synced()` the files are the same bytes
 * (contract `project-builder`). Methods are added as tests move here (§9).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

import { runSync } from "../../../src/commands/sync.js";
import { writeJsonFile } from "../../../src/core/canon/format-json.js";
import type { Ctx } from "../../../src/core/ctx.js";
import { packContentHash } from "../../../src/core/packs/hash.js";
import type { Json } from "../../../src/core/schemas/loader.js";
import { createWrites } from "../../../src/core/writes.js";
import { CLI_VERSION } from "../../../src/version.js";
import { CORE_SDD_RANGE, CORE_SDD_VERSION, REPO_ROOT } from "../../helpers/cli.js";
import { readJsonFile } from "../../helpers/json.js";
import { FakeCheckRunner, type FakeBehaviour } from "./fakes/checks.js";
import { FakeClock } from "./fakes/clock.js";
import { FakeForge, type ForgeModel } from "./fakes/forge.js";
import { FakeGit, type Tree } from "./fakes/git.js";
import { FakeOpenSpec, OPENSPEC_VERSION } from "./fakes/openspec.js";
import { FakeSignals } from "./fakes/signals.js";
import { deltaSpecMarkdown, mainSpecMarkdown, proposalMarkdown, type ModelRequirement } from "./fakes/spec-model.js";

export const PACKS = path.join(REPO_ROOT, "packs");

export interface BuilderOptions {
  /** The project's directory inside the git repository (`git rev-parse --show-prefix`); default the top. */
  prefix?: string;
  /** Date of the fake clock. */
  today?: string;
  /** Delay of `FakeOpenSpec` answers, by journal line. */
  openspecDelay?: (call: string) => number;
}

export interface ChangeFiles {
  /** Why of the proposal; `false` leaves the Change without `proposal.md`. Default: a proposal is written. */
  proposal?: string | false;
  design?: string;
  tasks?: string;
  /** Delta specs by capability path, each adding its requirements. */
  specs?: Record<string, ModelRequirement[]>;
}

/** A Change record in `state`, as the e2e helper `record()` writes it. */
export function changeRecord(change: string, state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change,
    change_state: state,
    transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }],
    ...extra
  };
}

/** Every file under `dir`, POSIX paths relative to it. */
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(dir, child));
    else out.push(child);
  }
  return out;
}

export class ProjectBuilder {
  readonly root: string;
  readonly clock: FakeClock;
  readonly openspec: FakeOpenSpec;
  readonly git: FakeGit;
  readonly checks = new FakeCheckRunner();
  readonly signals = new FakeSignals();
  readonly forge = new FakeForge();
  /** What the commands wrote to stderr through `ctx.warn`. */
  readonly warnings: string[] = [];
  readonly ctx: Ctx;

  /** Top of the (fake) git repository; the project is `root`, `prefix` below it. */
  readonly top: string;
  readonly prefix: string;

  constructor(options: BuilderOptions = {}) {
    this.top = mkdtempSync(path.join(tmpdir(), "warrant-app-"));
    this.prefix = (options.prefix ?? "").replace(/^\/+|\/+$/g, "");
    this.root = this.prefix === "" ? this.top : path.join(this.top, ...this.prefix.split("/"));
    mkdirSync(this.root, { recursive: true });
    this.clock = new FakeClock(options.today);
    this.openspec = new FakeOpenSpec(this.root, this.clock, options.openspecDelay);
    this.git = new FakeGit(path.join(this.top, ".git"), this.prefix);
    this.ctx = {
      root: this.root,
      openspec: this.openspec,
      git: this.git,
      checks: this.checks,
      clock: this.clock,
      forge: this.forge,
      signals: this.signals,
      writes: createWrites(false),
      warn: (text) => void this.warnings.push(text)
    };
    this.base();
  }

  /** What `useSyncedProject` writes before `openspec init` and `warrant sync`, and what `openspec init` adds. */
  private base(): void {
    this.write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      roles: { maintainer: ["kat"] }
    });
    this.write(".warrant/local/areas.json", {
      $schema: "warrant://areas/1",
      KRN: { capability: "kernel" },
      SRC: { capability: "search" }
    });
    this.write(".warrant/warrant.lock.json", {
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: OPENSPEC_VERSION,
      packs: { "core-sdd": { version: CORE_SDD_VERSION, source: "bundled", hash: packContentHash(path.join(PACKS, "core-sdd")) } }
    });
    // `openspec init --tools none`; its config.yaml is replaced by `synced()`.
    this.write("openspec/specs/.gitkeep", "");
    this.write("openspec/changes/archive/.gitkeep", "");
  }

  // ---- files and models -------------------------------------------------

  /** Writes a file: an object through `writeJsonFile`, a string as it is. */
  write(rel: string, content: string | object): this {
    const absolute = path.join(this.root, ...rel.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    if (typeof content === "string") writeFileSync(absolute, content, "utf8");
    else writeJsonFile(absolute, content as Json);
    return this;
  }

  read(rel: string): string {
    return readFileSync(path.join(this.root, ...rel.split("/")), "utf8");
  }

  /** The parsed JSON of a project file (A-30). */
  json(rel: string): any {
    return readJsonFile(this.root, rel);
  }

  remove(rel: string): this {
    rmSync(path.join(this.root, ...rel.split("/")), { recursive: true, force: true });
    return this;
  }

  /** The `ctx` of `--dry-run`: the same fakes, `writes` collecting instead of writing (REQ-KRN-034). */
  dryRun(): Ctx {
    return { ...this.ctx, writes: createWrites(true) };
  }

  /**
   * Every directory (`<path>/`) and file of the project, POSIX paths relative to
   * `root`, files with their bytes in base64: equal before and after a command
   * that wrote nothing.
   */
  tree(): Record<string, string> {
    const out: Record<string, string> = {};
    const visit = (rel: string): void => {
      for (const entry of readdirSync(path.join(this.root, rel), { withFileTypes: true })) {
        const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          out[`${child}/`] = "";
          visit(child);
        } else {
          out[child] = readFileSync(path.join(this.root, child)).toString("base64");
        }
      }
    };
    visit("");
    return out;
  }

  /** A Change directory `openspec/changes/<name>/` with its artifacts; `FakeOpenSpec` learns the same. */
  withChange(name: string, files: ChangeFiles = {}): this {
    const dir = `openspec/changes/${name}`;
    const model = this.openspec.change(name);
    if (files.proposal !== false) {
      this.write(`${dir}/proposal.md`, proposalMarkdown(files.proposal ?? `Change ${name}.`));
      model.files.add("proposal");
    }
    for (const artifact of ["design", "tasks"] as const) {
      const text = files[artifact];
      if (text === undefined) continue;
      this.write(`${dir}/${artifact}.md`, text);
      model.files.add(artifact);
    }
    for (const [capability, reqs] of Object.entries(files.specs ?? {})) {
      this.write(`${dir}/specs/${capability}/spec.md`, deltaSpecMarkdown(reqs));
      model.specs.set(capability, reqs);
    }
    return this;
  }

  /** A main spec `openspec/specs/<id>/spec.md`; `FakeOpenSpec` learns the same. */
  withSpec(id: string, reqs: ModelRequirement[] = [], purpose = `Behaviour of ${id}.`): this {
    this.write(`openspec/specs/${id}/spec.md`, mainSpecMarkdown(id, purpose, reqs));
    this.openspec.spec(id, reqs);
    return this;
  }

  /** The Change record `.warrant/changes/<change>.json`. */
  withRecord(change: string, state: string, extra: Record<string, unknown> = {}): this {
    return this.write(`.warrant/changes/${change}.json`, changeRecord(change, state, extra));
  }

  /** Pull requests, run attempts and artifacts of the forge (`FakeForge`); repeated calls add. */
  withForge(model: ForgeModel): this {
    this.forge.add(model);
    return this;
  }

  /** A waiver `.warrant/waivers/<id>.json`. */
  withWaiver(waiver: Record<string, unknown> & { id: string }): this {
    return this.write(`.warrant/waivers/${waiver.id}.json`, { $schema: "warrant://waiver/1", ...waiver });
  }

  /**
   * The answer of `FakeCheckRunner` to the check command `command` (its argv[0]);
   * with `override`, also a project check `.warrant/local/checks/<id>.json`
   * that overrides `core-sdd:<id>` and runs `[command, ...args]`.
   */
  withCheck(command: string, behaviour: FakeBehaviour, override?: { id: string; args?: string[]; run?: Record<string, unknown> }): this {
    this.checks.on(command, behaviour);
    if (override !== undefined) {
      this.write(`.warrant/local/checks/${override.id}.json`, {
        $schema: "warrant://check/1",
        id: override.id,
        version: "1.0.0",
        overrides: `core-sdd:${override.id}`,
        level: "L1",
        run: { command: [command, ...(override.args ?? [])], ...override.run }
      });
    }
    return this;
  }

  /**
   * The answer of `openspec validate <change> --strict --json`, the command of
   * the check `core-sdd:openspec-validate`, through `FakeCheckRunner`: the
   * report of OpenSpec 1.13.1 (I-78) for the Change named in argv — valid with
   * exit 0, or invalid with one issue and exit 1. The check parses the report;
   * what `openspec validate` itself finds in the files is the contract's and
   * e2e's concern.
   */
  withOpenspecValidate(valid = true): this {
    this.checks.on("openspec", (spec) => {
      const [, verb, change] = spec.argv;
      if (verb !== "validate") return { exit: 1 };
      const issues = valid ? [] : [{ level: "ERROR", path: "proposal.md", message: "broken" }];
      const report = {
        items: [{ id: change, type: "change", valid, issues, durationMs: 1 }],
        summary: { totals: { items: 1, passed: valid ? 1 : 0, failed: valid ? 0 : 1 } },
        version: "1.0"
      };
      return { exit: valid ? 0 : 1, output: `${JSON.stringify(report)}\n` };
    });
    return this;
  }

  /** `warrant sync` in the test process; `FakeOpenSpec` learns the generated schema. */
  async synced(): Promise<this> {
    const result = await runSync(this.ctx, {});
    if (!result.ok) throw new Error(`ProjectBuilder.synced: ${JSON.stringify(result.errors)}`);
    const schema = result.data["schema"];
    if (typeof schema === "string" && schema !== "") this.openspec.schemas.add(schema);
    return this;
  }

  // ---- git ---------------------------------------------------------------

  /** The files of the project, keyed by their path from the top of the repository. */
  private snapshot(paths?: string[]): Tree {
    const tree: Tree = new Map(paths === undefined ? [] : (this.git.headCommit()?.tree ?? []));
    const files = paths ?? walk(this.root);
    for (const rel of files) {
      const absolute = path.join(this.root, ...rel.split("/"));
      if (existsSync(absolute)) tree.set(this.git.repoPath(rel), readFileSync(absolute));
      else tree.delete(this.git.repoPath(rel));
    }
    return tree;
  }

  /** `git init` on `main` without a commit; `commit()` does it by itself. */
  gitInit(): this {
    this.git.init();
    return this;
  }

  /**
   * `git add -A && git commit` (or `git add <paths> && git commit`): the files on
   * disk become a commit on the checked-out branch. The first commit makes the
   * repository (`git init` on `main`). Returns the commit id.
   */
  commit(label: string, options: { paths?: string[] } = {}): string {
    return this.git.commit(this.snapshot(options.paths), label);
  }

  /** `git checkout -b <name> [<from>]`: a new branch, checked out; the files follow `from`. */
  branch(name: string, from = "HEAD"): this {
    this.git.createBranch(name, from);
    return this.checkout(name);
  }

  /**
   * `git checkout <name>`: the tracked files become those of the branch.
   * Untracked files stay; a changed tracked file refuses the checkout unless `force`.
   */
  checkout(name: string, options: { force?: boolean } = {}): this {
    const from = this.git.headCommit()?.tree ?? new Map<string, Buffer>();
    const to = this.git.treeOf(name);
    if (to === null) throw new Error(`ProjectBuilder.checkout: no commit ${name}`);
    if (options.force !== true) {
      for (const [file, content] of from) {
        const absolute = this.absoluteOf(file);
        if (absolute === null) continue;
        const now = existsSync(absolute) ? readFileSync(absolute) : null;
        if (now === null || !now.equals(content)) throw new Error(`ProjectBuilder.checkout: ${file} has uncommitted changes`);
      }
    }
    this.git.switchTo(name);
    this.materialise(from, to);
    return this;
  }

  /**
   * `git merge <name>` into the checked-out branch: with a merge commit (`ff: "no"`,
   * default) or a fast-forward (`ff: "only"`). Files are merged per path; a
   * path changed on both sides differently is a conflict (throws).
   */
  merge(name: string, options: { label?: string; ff?: "no" | "only" } = {}): string {
    const ours = this.git.headCommit();
    const theirs = this.git.resolve(name);
    if (ours === null || theirs === null) throw new Error(`ProjectBuilder.merge: nothing to merge ${name} into`);
    const theirsTree = this.git.treeOf(theirs) as Tree;
    if (options.ff === "only") {
      if (!this.git.ancestorsOf(theirs).has(ours.sha)) {
        throw new Error(`ProjectBuilder.merge: ${name} is not a fast-forward`);
      }
      this.git.moveHead(theirs);
      this.materialise(ours.tree, theirsTree);
      return theirs;
    }
    const baseSha = this.git.bestCommonAncestor(ours.sha, theirs);
    const base = baseSha === null ? new Map<string, Buffer>() : (this.git.treeOf(baseSha) as Tree);
    const merged: Tree = new Map();
    for (const file of new Set([...ours.tree.keys(), ...theirsTree.keys(), ...base.keys()])) {
      const [b, o, t] = [base.get(file), ours.tree.get(file), theirsTree.get(file)];
      const same = (x?: Buffer, y?: Buffer): boolean => (x === undefined ? y === undefined : y !== undefined && x.equals(y));
      let result: Buffer | undefined;
      if (same(o, t) || same(t, b)) result = o;
      else if (same(o, b)) result = t;
      else throw new Error(`ProjectBuilder.merge: conflict in ${file}`);
      if (result !== undefined) merged.set(file, result);
    }
    const sha = this.git.commit(merged, options.label ?? `Merge ${name}`, [theirs]);
    this.materialise(ours.tree, merged);
    return sha;
  }

  /** Absolute path of a repository path inside the project, or null outside it. */
  private absoluteOf(file: string): string | null {
    const rel = this.prefix === "" ? file : file.startsWith(`${this.prefix}/`) ? file.slice(this.prefix.length + 1) : null;
    return rel === null ? null : path.join(this.root, ...rel.split("/"));
  }

  /** Makes the tracked files on disk go from tree `from` to tree `to`; untracked files are left alone. */
  private materialise(from: Tree, to: Tree): void {
    for (const file of from.keys()) {
      const absolute = this.absoluteOf(file);
      if (!to.has(file) && absolute !== null && existsSync(absolute)) unlinkSync(absolute);
    }
    for (const [file, content] of to) {
      const absolute = this.absoluteOf(file);
      if (absolute === null) continue;
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  }

  /** Removes the temporary directory. */
  dispose(): void {
    rmSync(this.top, { recursive: true, force: true });
  }
}

/** Registers `afterEach` cleanup and returns a factory of builders for the tests of a file. */
export function useProjectBuilder(): (options?: BuilderOptions) => ProjectBuilder {
  const built: ProjectBuilder[] = [];
  afterEach(() => {
    for (const builder of built.splice(0)) builder.dispose();
  });
  return (options) => {
    const builder = new ProjectBuilder(options);
    built.push(builder);
    return builder;
  };
}
