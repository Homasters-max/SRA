/**
 * The pair «dry-run, then the real run» of a command that changes state
 * (REQ-KRN-034, lens `cli-contract` п. 4): the JSON of both runs compared
 * without what differs by nature — the ids of new evidence records and Runs (ULIDs) and
 * the time of the recorded entry — and the files the real run changed checked
 * against `would_write[]` of the dry-run. Trees come from `ProjectBuilder.tree()`.
 */

const NEW_IDS = /(EVID|RUN)-[0-9A-HJKMNP-TV-Z]{26}/g;

/** `data` of a run without `dry_run`, `would_write`, the ids of evidence and Runs and the time of `recorded`. */
export function withoutDryRun(data: Record<string, unknown>): Record<string, unknown> {
  const { dry_run: _dryRun, would_write: _wouldWrite, ...rest } = data;
  const recorded = rest["recorded"];
  const timeless =
    typeof recorded === "object" && recorded !== null ? { ...rest, recorded: { ...recorded, at: "<at>" } } : rest;
  return JSON.parse(JSON.stringify(timeless).replace(NEW_IDS, "$1-*")) as Record<string, unknown>;
}

/**
 * Paths added, removed or rewritten between two trees that no target names or
 * contains — a directory also counts as covered when it holds a target (it was
 * created as its parent): what the real run wrote beyond `would_write[]`.
 * Directories come without the trailing `/`; evidence and Run ids compare as `EVID-*`, `RUN-*`.
 */
export function writtenBeyond(before: Record<string, string>, after: Record<string, string>, targets: readonly string[]): string[] {
  const norm = (p: string): string => p.replace(NEW_IDS, "$1-*");
  const covered = targets.map(norm);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const beyond: string[] = [];
  for (const key of keys) {
    if (before[key] === after[key]) continue;
    const dir = key.endsWith("/");
    const p = norm(dir ? key.slice(0, -1) : key);
    if (covered.some((t) => p === t || p.startsWith(`${t}/`) || (dir && t.startsWith(`${p}/`)))) continue;
    beyond.push(p);
  }
  return beyond.sort();
}
