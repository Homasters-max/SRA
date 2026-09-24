/**
 * `FakeOpenSpec` (ADR-0025 п. 4, design §5): `OpenSpecPort` answered from a
 * model of Changes, specs, requirements and scenarios, which `ProjectBuilder`
 * fills while it writes the files. It parses nothing: what the real `openspec`
 * would read from the Markdown is put into the model by the same call that
 * wrote the Markdown. The contract (`test/contract/openspec.contract.test.ts`)
 * holds the two to the same answers.
 *
 * Besides answering, the fake keeps a journal of calls (spelled like the
 * `openspec` argv), counts calls in flight, can delay answers and can be told
 * to fail a method (`fail`). `archive` and `newChange` act on the model and on
 * the Change directory on disk, since the CLI looks for the directory after
 * them; `archive` does not merge deltas into the specs — that is OpenSpec's job.
 */
import { mkdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { OpenspecStatusResult, ArtifactStatuses } from "../../../../src/core/ports/openspec.js";
import type { OpenspecAct, OpenSpecPort } from "../../../../src/core/ports/openspec.js";
import type { ClockPort } from "../../../../src/core/ports/clock.js";
import { OPENSPEC_VERSION } from "../../../helpers/openspec.js";
import { shownTexts, type ModelRequirement } from "./spec-model.js";

export { OPENSPEC_VERSION };

/** One artifact of an OpenSpec schema and the artifacts it requires. */
export interface ModelArtifact {
  id: string;
  requires: string[];
}

/** The artifact graph of `spec-driven` and of `warrant-sdd` (core-sdd): the default of the fake. */
export const SDD_ARTIFACTS: readonly ModelArtifact[] = [
  { id: "proposal", requires: [] },
  { id: "specs", requires: ["proposal"] },
  { id: "design", requires: ["proposal"] },
  { id: "tasks", requires: ["specs", "design"] }
];

export interface ModelChange {
  name: string;
  /** Artifact files written: `proposal`, `design`, `tasks`; `specs` is derived from `specs`. */
  files: Set<string>;
  /** Delta specs by capability path, each adding its requirements. */
  specs: Map<string, ModelRequirement[]>;
  /** False when `list` does not return the change although `show` answers it (injected, I-127). */
  listed: boolean;
}

export interface ModelSpec {
  id: string;
  reqs: ModelRequirement[];
}

type Method = keyof OpenSpecPort;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Each text once, in the order first seen — the answer of the port (I-129). */
const unique = (texts: string[]): string[] => [...new Set(texts)];

export class FakeOpenSpec implements OpenSpecPort {
  /** The calls made, as `openspec` argv without `--json`: `list`, `show add-search`, `show --type spec search`, … */
  readonly calls: string[] = [];
  /** Calls answered at once at most, over the life of the fake. */
  maxInFlight = 0;

  readonly changes = new Map<string, ModelChange>();
  readonly specs = new Map<string, ModelSpec>();
  /** Names of the archived Changes, `YYYY-MM-DD-<change>`. */
  readonly archived: string[] = [];
  /** Schemas `openspec` knows: the built-in one, and those `warrant sync` generated. */
  readonly schemas = new Set<string>(["spec-driven"]);
  artifacts: readonly ModelArtifact[] = SDD_ARTIFACTS;
  /** What `openspec --version` prints; null as when the binary is absent. */
  installedVersion: string | null = OPENSPEC_VERSION;

  private inFlight = 0;
  private readonly failing = new Set<Method>();

  /**
   * @param root   project root: `archive` and `newChange` move and create the Change directory there
   * @param clock  the date of `archive` (`YYYY-MM-DD-<change>`) and of `.openspec.yaml`
   * @param delayOf milliseconds before a call (by its journal line) is answered
   */
  constructor(
    private readonly root: string,
    private readonly clock: ClockPort,
    private readonly delayOf: (call: string) => number = () => 0
  ) {}

  // ---- model -------------------------------------------------------------

  /** The Change `name`, created empty when absent. */
  change(name: string): ModelChange {
    let change = this.changes.get(name);
    if (change === undefined) {
      change = { name, files: new Set(), specs: new Map(), listed: true };
      this.changes.set(name, change);
    }
    return change;
  }

  spec(id: string, reqs: ModelRequirement[]): void {
    this.specs.set(id, { id, reqs });
  }

  /** From now on `method` answers as when the `openspec` call fails. */
  fail(method: Method): this {
    this.failing.add(method);
    return this;
  }

  recover(method: Method): this {
    this.failing.delete(method);
    return this;
  }

  // ---- port --------------------------------------------------------------

  version(): Promise<string | null> {
    return this.answer("--version", "version", () => this.installedVersion, null);
  }

  listChanges(): Promise<string[]> {
    return this.answer("list", "listChanges", () => [...this.changes.values()].filter((c) => c.listed).map((c) => c.name).sort(byName), []);
  }

  listSpecs(): Promise<string[]> {
    return this.answer("list --specs", "listSpecs", () => [...this.specs.keys()].sort(byName), []);
  }

  showChange(name: string): Promise<string[]> {
    return this.answer(`show ${name}`, "showChange", () => {
      const change = this.changes.get(name);
      // OpenSpec refuses to show a Change without a proposal ("must have a Why section").
      if (change === undefined || !change.files.has("proposal")) return [];
      const texts = [...change.specs.keys()].sort(byName).flatMap((cap) => shownTexts(change.specs.get(cap) ?? []));
      return unique(texts);
    }, []);
  }

  showSpec(id: string): Promise<string[]> {
    return this.answer(`show --type spec ${id}`, "showSpec", () => unique(shownTexts(this.specs.get(id)?.reqs ?? [])), []);
  }

  status(change: string): Promise<OpenspecStatusResult> {
    const failed: OpenspecStatusResult = { artifacts: {}, warning: `openspec status --change ${change} failed` };
    return this.answer(`status --change ${change}`, "status", () => {
      const model = this.changes.get(change);
      if (model === undefined) return failed;
      const done = new Set(model.files);
      if (model.specs.size > 0) done.add("specs");
      const artifacts: ArtifactStatuses = {};
      for (const artifact of this.artifacts) {
        if (done.has(artifact.id)) artifacts[artifact.id] = "done";
        else artifacts[artifact.id] = artifact.requires.every((r) => artifacts[r] === "done") ? "ready" : "blocked";
      }
      return { artifacts };
    }, failed);
  }

  archive(change: string): Promise<OpenspecAct> {
    const failed: OpenspecAct = { ok: false, output: `Change '${change}' not found` };
    return this.answer(`archive ${change} --yes`, "archive", () => {
      if (!this.changes.has(change)) return failed;
      const target = `${this.clock.today()}-${change}`;
      const from = path.join(this.root, "openspec", "changes", change);
      const to = path.join(this.root, "openspec", "changes", "archive", target);
      if (existsSync(from)) {
        mkdirSync(path.dirname(to), { recursive: true });
        renameSync(from, to);
      }
      this.changes.delete(change);
      this.archived.push(target);
      return { ok: true, output: JSON.stringify({ archive: { change, archivedAs: target } }) };
    }, failed);
  }

  newChange(name: string, schema: string): Promise<OpenspecAct> {
    const failed: OpenspecAct = { ok: false, output: `openspec new change ${name} failed` };
    return this.answer(`new change ${name} --schema ${schema}`, "newChange", () => {
      if (this.changes.has(name)) return { ok: false, output: `Change '${name}' already exists` };
      if (!this.schemas.has(schema)) return { ok: false, output: `Schema '${schema}' not found` };
      const dir = path.join(this.root, "openspec", "changes", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, ".openspec.yaml"), `schema: ${schema}\ncreated: ${this.clock.today()}\n`, "utf8");
      this.change(name);
      return { ok: true, output: JSON.stringify({ change: { id: name, schema } }) };
    }, failed);
  }

  schemaValidate(schema: string): Promise<OpenspecAct> {
    const failed: OpenspecAct = { ok: false, output: `Schema '${schema}' not found` };
    return this.answer(`schema validate ${schema}`, "schemaValidate", () => {
      if (!this.schemas.has(schema)) return failed;
      return { ok: true, output: JSON.stringify({ name: schema, valid: true, issues: [] }) };
    }, failed);
  }

  /** Journal, delay, in-flight count; the failure answer when `method` is failing. */
  private async answer<T>(call: string, method: Method, compute: () => T, failure: T): Promise<T> {
    this.calls.push(call);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const delay = this.delayOf(call);
      await new Promise<void>((resolve) => (delay > 0 ? setTimeout(resolve, delay) : queueMicrotask(resolve)));
      return this.failing.has(method) ? failure : compute();
    } finally {
      this.inFlight -= 1;
    }
  }
}
