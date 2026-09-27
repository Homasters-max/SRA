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
import type { Ctx } from "../ctx.js";
import { projectPath, stateDir } from "../fs.js";
import { commitFiles } from "../git/files.js";
import { changeRunsIn, readChangeRuns, RESULT_SUFFIX, RUN_ID_RE } from "./store.js";

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
export function ownState(
  root: string,
  change: string,
  env: NodeJS.ProcessEnv = process.env,
  runIds?: ReadonlySet<string>
): (p: string) => boolean {
  const record = `.warrant/changes/${change}.json`;
  const state = statePrefix(root, env);
  const evidence = state === null ? null : `${state}evidence/${change}/`;
  const runs = state === null ? null : `${state}runs/`;
  let ids: ReadonlySet<string> | undefined = runIds;
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

/**
 * {@link ownState} of `change` as `commit` holds it (R-21): the Runs of the
 * Change are read from the Run files of the commit the gates judge, not from
 * the working tree — on `transition MERGED` in an archive branch the working
 * tree is not the head of the impl-PR. Git is asked only when `paths` (the
 * diff) holds a path under `<state>/runs/`; without a commit, or when git
 * cannot list the files, the working tree is read as before.
 */
export async function ownStateAt(
  ctx: Pick<Ctx, "git" | "root">,
  commit: string | null,
  change: string,
  paths: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<(p: string) => boolean> {
  const state = statePrefix(ctx.root, env);
  if (commit === null || state === null) return ownState(ctx.root, change, env);
  const runs = `${state}runs`;
  if (!paths.some((p) => p.startsWith(`${runs}/`))) return ownState(ctx.root, change, env, new Set());
  const files = await commitFiles(ctx, commit, [runs]);
  if (files === null) return ownState(ctx.root, change, env);
  return ownState(ctx.root, change, env, new Set(changeRunsIn(files, runs, change).map((run) => run.id)));
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

/**
 * Everything the CLI writes as state, for any Change (REQ-ENF-004, I-190):
 * records `.warrant/changes/**`, waivers `.warrant/waivers/**`, and
 * `<state>/evidence/**`, `<state>/runs/**` when `<state>` lies in the project.
 * Nothing here is edited by hand: `guard` names the commands that write it.
 */
export function cliWrittenState(root: string, env: NodeJS.ProcessEnv = process.env): (p: string) => boolean {
  const state = statePrefix(root, env);
  const dirs = [".warrant/changes/", ".warrant/waivers/", ...(state === null ? [] : [`${state}evidence/`, `${state}runs/`])];
  return (p) => dirs.some((dir) => p.startsWith(dir));
}
