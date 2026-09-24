/**
 * Logic of `scripts/dev/pr-form.js` (ADR-0033 п. 10): the form of a pull request — its branch prefix and the subjects
 * of its commits. Pure; the CI step passes the head ref and the subjects of `git log --no-merges base..head`.
 *
 * - Branch: `spec/`, `worktree/`, `archive/` + `<change>` (a Change, ADR-0011), `process/` (ADR and process
 *   implementation), `docs/` (documents only), `fix/` (a fix outside a Change) + a kebab-case name. `feature/` is gone.
 * - Subject: `<change>: …` in a Change branch, `<prefix>: …` in the others (`process: …`, `docs: …`, `fix: …`).
 *
 * This is a development check, not `warrant ci` (phase 4): it does not look at the Change or its record.
 */

/** Branch prefixes of a Change: the subject starts with the Change name. */
export const CHANGE_PREFIXES = ["spec", "worktree", "archive"];
/** Branch prefixes outside a Change: the subject starts with the prefix. */
export const OTHER_PREFIXES = ["process", "docs", "fix"];

const NAME = /^[a-z0-9][a-z0-9.-]*$/;

/** `{ prefix, name, subject }` — what a commit subject of this branch starts with — or `{ error }`. */
export function parseBranch(branch) {
  const b = String(branch ?? "");
  const slash = b.indexOf("/");
  const prefix = slash > 0 ? b.slice(0, slash) : "";
  const name = slash > 0 ? b.slice(slash + 1) : "";
  const known = [...CHANGE_PREFIXES, ...OTHER_PREFIXES];
  if (!known.includes(prefix)) {
    return { error: `branch ${b || "(none)"}: prefix must be one of ${known.map((p) => `${p}/`).join(", ")} (ADR-0033 п. 10)` };
  }
  if (!NAME.test(name)) return { error: `branch ${b}: name after ${prefix}/ must be kebab-case [a-z0-9.-]` };
  return { prefix, name, subject: CHANGE_PREFIXES.includes(prefix) ? name : prefix };
}

/** Problems of a PR: its branch, then every commit subject that does not start with `<subject>: `. */
export function checkPr(branch, subjects) {
  const parsed = parseBranch(branch);
  if (parsed.error) return [parsed.error];
  const want = `${parsed.subject}: `;
  return subjects
    .filter((s) => s.trim() !== "" && !(s.startsWith(want) && s.length > want.length))
    .map((s) => `commit «${s}»: subject must start with «${want}» in branch ${branch} (ADR-0033 п. 10)`);
}
