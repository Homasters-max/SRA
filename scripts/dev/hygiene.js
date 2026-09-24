/**
 * Hygiene of the repository and its worktrees (ADR-0033 п. 13) — what is superfluous and who removes it:
 *
 *   node scripts/dev/hygiene.js          findings grouped by action (auto / pr / confirm)
 *   node scripts/dev/hygiene.js --json   the same as JSON: [{ kind, action, item, detail }]
 *
 * Finds only; the skill `repo-hygiene` acts. Logic — hygiene-lib.js (pure) over the state of brief-lib.js; IO —
 * local-io.js (git and files, no network: branches on origin are as of the last `git fetch`). Exit 0 — report printed
 * (with or without findings); 2 — not a git work tree or IO failed.
 */
import { collectState } from "./brief-lib.js";
import { findings, formatFindings } from "./hygiene-lib.js";
import { localIo } from "./local-io.js";

try {
  const io = localIo(60_000);
  const state = collectState(io);
  if (!state) {
    console.error("hygiene: not a git work tree");
    process.exit(2);
  }
  const list = findings(io, state);
  process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(list, null, 2)}\n` : formatFindings(list));
} catch (e) {
  console.error(`hygiene: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
