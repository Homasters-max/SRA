/**
 * `OpenSpecPort` over the `openspec` binary on PATH (design D-7, ADR-0025 п. 3).
 * Runs in the project root; parses `--json` and turns failures into values.
 *
 * Shapes observed on OpenSpec 1.13.1 in this repository:
 *
 *   openspec list --json
 *     { "changes": [ { "name", "completedTasks", "totalTasks", "lastModified", "status" } ],
 *       "root": { "path", "source" } }
 *
 *   openspec list --specs --json
 *     { "specs": [ ... ], "root": { ... } }
 *
 *   openspec show <change> --json
 *     { "id", "title", "deltaCount",
 *       "deltas": [ { "spec", "operation", "description",
 *                     "requirement":  { "text", "scenarios": [ { "rawText" } ] },
 *                     "requirements": [ { "text", "scenarios": [ { "rawText" } ] } ] } ] }
 *
 *   openspec show <spec> --type spec --json
 *     { "id", "requirements": [ { "text", "scenarios": [ { "rawText" } ] } ], ... }
 *
 * In both `show` shapes a stable-ID comment that is placed correctly is the
 * FIRST line of `requirement.text` / `scenario.rawText` (ADR-0015, spike S1).
 */
import { parseOpenspecStatus, type OpenspecStatusResult } from "../core/openspec/status.js";
import type { OpenspecAct, OpenSpecPort } from "../core/ports/openspec.js";
import { exec } from "./exec.js";

interface OpenspecRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  json: unknown;
}

/** Runs `openspec` with the given arguments in `cwd` and parses `--json` output. */
async function run(args: string[], cwd: string): Promise<OpenspecRun> {
  const proc = await exec("openspec", args, cwd);
  const stdout = proc.stdout.toString("utf8");
  const stderr = proc.stderr.toString("utf8");
  if (!proc.ok) return { ok: false, stdout, stderr, json: undefined };
  // OpenSpec prints deprecation warnings before the JSON body; start at the
  // first `{` or `[` so those lines do not break the parse.
  const start = stdout.search(/[[{]/);
  if (start < 0) return { ok: true, stdout, stderr, json: undefined };
  try {
    return { ok: true, stdout, stderr, json: JSON.parse(stdout.slice(start)) };
  } catch {
    return { ok: true, stdout, stderr, json: undefined };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function act(result: OpenspecRun, ok: boolean = result.ok): OpenspecAct {
  return { ok, output: result.stderr || result.stdout };
}

/** Every `text` / `rawText` string of a `show` body, depth first, in print order. */
function collectTexts(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectTexts(item, into);
    return into;
  }
  if (!isObject(node)) return into;
  for (const key of ["text", "rawText"] as const) {
    const value = node[key];
    if (typeof value === "string") into.push(value);
  }
  for (const value of Object.values(node)) collectTexts(value, into);
  return into;
}

/**
 * The texts of a `show` body, each once: a change prints every delta's
 * requirement twice (`requirement` and `requirements[]`), which carries nothing
 * a set of texts does not; the fake answers the same (I-129).
 */
function shownTexts(node: unknown): string[] {
  return [...new Set(collectTexts(node))];
}

export class OpenSpecCli implements OpenSpecPort {
  private versionOnce: Promise<string | null> | undefined;

  constructor(private readonly root: string) {}

  /** Cached for the lifetime of the adapter: one `--version` per CLI call. */
  version(): Promise<string | null> {
    this.versionOnce ??= run(["--version"], this.root).then((result) => {
      if (!result.ok) return null;
      const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?/.exec(result.stdout);
      return match === null ? null : match[0];
    });
    return this.versionOnce;
  }

  async listChanges(): Promise<string[]> {
    const json = (await run(["list", "--json"], this.root)).json;
    if (!isObject(json) || !Array.isArray(json["changes"])) return [];
    const names: string[] = [];
    for (const entry of json["changes"] as unknown[]) {
      const name = isObject(entry) ? entry["name"] : undefined;
      if (typeof name === "string") names.push(name);
    }
    return names;
  }

  async listSpecs(): Promise<string[]> {
    const json = (await run(["list", "--specs", "--json"], this.root)).json;
    if (!isObject(json) || !Array.isArray(json["specs"])) return [];
    const ids: string[] = [];
    for (const entry of json["specs"] as unknown[]) {
      const id = typeof entry === "string" ? entry : isObject(entry) ? (entry["id"] ?? entry["name"]) : undefined;
      if (typeof id === "string") ids.push(id);
    }
    return ids;
  }

  async showChange(name: string): Promise<string[]> {
    return shownTexts((await run(["show", name, "--json"], this.root)).json);
  }

  async showSpec(id: string): Promise<string[]> {
    return shownTexts((await run(["show", id, "--type", "spec", "--json"], this.root)).json);
  }

  /**
   * Never throws: `warrant status` reports the record even when OpenSpec cannot
   * answer (the change directory may be gone, which `stale[]` already explains).
   */
  async status(change: string): Promise<OpenspecStatusResult> {
    const result = await run(["status", "--change", change, "--json"], this.root);
    if (!result.ok) {
      const detail = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
      return { artifacts: {}, warning: `openspec status --change ${change} failed${detail === "" ? "" : `: ${detail}`}` };
    }
    try {
      return { artifacts: parseOpenspecStatus(result.json) };
    } catch (thrown) {
      return { artifacts: {}, warning: `${change}: ${(thrown as Error).message}` };
    }
  }

  async archive(change: string): Promise<OpenspecAct> {
    return act(await run(["archive", change, "--yes", "--json"], this.root));
  }

  async newChange(name: string, schema: string): Promise<OpenspecAct> {
    return act(await run(["new", "change", name, "--schema", schema, "--json"], this.root));
  }

  async schemaValidate(schema: string): Promise<OpenspecAct> {
    const result = await run(["schema", "validate", schema, "--json"], this.root);
    const valid = isObject(result.json) ? result.json["valid"] : undefined;
    return act(result, result.ok && valid !== false);
  }
}
