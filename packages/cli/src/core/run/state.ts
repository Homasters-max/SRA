/**
 * The own state of a Change (N27, REQ-VER-004, REQ-KRN-028): what the CLI
 * writes for it and what is committed with its work — the record
 * `.warrant/changes/<change>.json`, the evidence directory
 * `<state>/evidence/<change>/**`, the Run files `<state>/runs/<id>.json` that
 * name the Change (read by `readChangeRuns`) and their `<id>.result.json`.
 * One definition for both readers: `scope-valid` gets the matchers through
 * `signals` (`core/transition`), `classify` from `commands/classify.ts`.
 *
 * A matcher takes a path as the diff gives it: POSIX, relative to the project
 * root. A `<state>` outside the project (`WARRANT_STATE_DIR`) has no path in
 * the diff, so then only records match.
 */
import { projectPath, stateDir } from "../fs.js";
import { readChangeRuns, RESULT_SUFFIX, RUN_ID_RE } from "./store.js";

/** Records live in `.warrant` whatever `<state>` is (D-2). */
const RECORD_RE = /^\.warrant\/changes\/[^/]+\.json$/;

/** `<state>/` relative to the project root with a trailing slash, or null when it lies outside. */
function statePrefix(root: string, env: NodeJS.ProcessEnv): string | null {
  const rel = projectPath(root, stateDir(root, env));
  return rel === undefined || rel === "" ? null : `${rel}/`;
}

/** The id of a Run file or of its envelope under `runs`, or undefined for any other name. */
function runIdOf(name: string): string | undefined {
  const id = name.endsWith(RESULT_SUFFIX) ? name.slice(0, -RESULT_SUFFIX.length) : name.endsWith(".json") ? name.slice(0, -".json".length) : "";
  return RUN_ID_RE.test(id) ? id : undefined;
}

/**
 * The own state of `change`. The Runs of the Change are read from the
 * working tree once, on the first path under `<state>/runs/`.
 */
export function ownState(root: string, change: string, env: NodeJS.ProcessEnv = process.env): (p: string) => boolean {
  const record = `.warrant/changes/${change}.json`;
  const state = statePrefix(root, env);
  const evidence = state === null ? null : `${state}evidence/${change}/`;
  const runs = state === null ? null : `${state}runs/`;
  let ids: Set<string> | undefined;
  return (p) => {
    if (p === record) return true;
    if (evidence !== null && p.startsWith(evidence)) return true;
    if (runs === null || !p.startsWith(runs)) return false;
    const id = runIdOf(p.slice(runs.length));
    if (id === undefined) return false;
    ids ??= new Set(readChangeRuns(root, change, env).map((run) => run.id));
    return ids.has(id);
  };
}

/** The same for any Change: every record, evidence directory, Run file and envelope. */
export function otherState(root: string, env: NodeJS.ProcessEnv = process.env): (p: string) => boolean {
  const state = statePrefix(root, env);
  const evidence = state === null ? null : `${state}evidence/`;
  const runs = state === null ? null : `${state}runs/`;
  return (p) => {
    if (RECORD_RE.test(p)) return true;
    if (evidence !== null && p.startsWith(evidence) && p.slice(evidence.length).includes("/")) return true;
    return runs !== null && p.startsWith(runs) && runIdOf(p.slice(runs.length)) !== undefined;
  };
}
