/**
 * State of a WARRANT development session (ADR-0032 п. 4, 9, 11; ADR-0033 п. 12, 13): branch and worktree of the
 * session, uncommitted changes, all worktrees with their docs/handoff/*.md, streams in the order of their `После:`,
 * latest tag, CLI and pack versions, active Changes with open tasks, merged branches not deleted (local and on origin),
 * the count of hygiene findings, auto-memory warnings. At most 2 KB; local reads only (git and files, local-io.js).
 *
 *   node scripts/dev/brief.js                  manual call: prints the state
 *   node scripts/dev/brief.js session-start    SessionStart hook: the same text on stdout (it becomes session context);
 *                                              the hook input on stdin is not read
 *   node scripts/dev/brief.js --help           usage on stdout, exit 0
 *
 * Any other argument → exit 0, no output (a hook must never break a session). Logic — brief-lib.js and hygiene-lib.js
 * (pure); this file is only IO. Any failure or exception, and git calls running past DEADLINE_MS in total → exit 0 and
 * empty output (п. 11). Root — `git rev-parse --show-toplevel` from CLAUDE_PROJECT_DIR or cwd.
 */
import { localIo } from "./local-io.js";

/** Under the hook's 10 s timeout: past it, give up silently rather than be killed. */
const DEADLINE_MS = 8_000;

const USAGE = "usage: node scripts/dev/brief.js [session-start]  — state of the WARRANT dev session (ADR-0032 п. 4)\n";

async function main() {
  const mode = process.argv[2];
  if (mode === "--help" || mode === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (mode !== undefined && mode !== "session-start") return;
  const io = localIo(DEADLINE_MS);
  const { collectState, formatBrief } = await import("./brief-lib.js");
  const state = collectState(io);
  if (!state) return;
  try {
    const { findings } = await import("./hygiene-lib.js");
    state.hygiene = findings(io, state).length;
  } catch {
    // hygiene is a bonus line: its failure must not take the state away
  }
  process.stdout.write(formatBrief(state));
}

main().catch(() => {
  process.exitCode = 0;
});
