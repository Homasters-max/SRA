/**
 * Decision logic of the git hook `scripts/dev/git-hook.js` (ADR-0033 п. 9): which Bash / PowerShell calls of the main
 * session and of subagents are denied before they run. Pure — the only IO (where a directory's git dirs are) is
 * injected, so unit tests need no process.
 *
 * Rules (`RULES`, the white list is pinned by test/unit/meta/dev-hooks.test.ts):
 * - `main-checkout` — in the main checkout of this repo (`--git-dir` = `--git-common-dir` = the project's common dir):
 *   `commit`, `merge`, `cherry-pick`, `revert`, `pull` without `--ff-only`, `checkout` / `switch` to another branch or
 *   with `-b`. The main checkout stays on `main`; work goes to a worktree (skill `git-start`).
 * - `force-push` — `git push --force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+` refspec — anywhere.
 * - `openspec-archive` — `openspec archive` anywhere; `warrant archive` runs it from its own process, unseen here.
 *
 * The command text is split into simple commands (`&&`, `||`, `;`, `|`, newlines) and tokenized with quotes; only the
 * first word decides (`grep "openspec archive"` is not a call). `cd <dir>` before a command and `git -C <dir>` move the
 * directory. This catches mistakes, not evasion (`bash -c`, variables, subshells pass) — ADR-0033 п. 9.
 */

/** Rule id → what it protects and what to do instead. */
export const RULES = {
  "main-checkout": {
    what: "the main checkout stays on `main`: no commits, merges or branch switches there (ADR-0033 п. 9, ADR-0011 п. 3)",
    instead: "work in a worktree: `git worktree add ../SRA-<name> -b <prefix>/<name> origin/main` (skill `git-start`); update main with `git pull --ff-only`; restore files with `git restore`",
  },
  "force-push": {
    what: "force push rewrites published history (ADR-0033 п. 9)",
    instead: "push without force; rewriting a published branch is the maintainer's manual act",
  },
  "openspec-archive": {
    what: "`openspec archive` bypasses `warrant archive` and the gates MERGED → ARCHIVED (ADR-0011 п. 4, ADR-0033 п. 9)",
    instead: "`warrant archive <change>` (skill `change-archive-pr`)",
  },
};

const CHECKED_TOOLS = new Set(["Bash", "PowerShell"]);
const CD = new Set(["cd", "pushd", "set-location", "sl", "push-location", "chdir"]);
/** git global options that take a value as the next word. */
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

const posix = (p) => String(p ?? "").replace(/\\/g, "/");

/**
 * Simple commands of a shell text, each a list of words (quotes removed). Operators split outside quotes. The escape
 * character is `\` in bash and a backtick in PowerShell, where `\` is a path separator.
 */
export function simpleCommands(text, shell = "bash") {
  const esc = shell === "powershell" ? "`" : "\\";
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === esc && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) word += s[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === esc && i + 1 < s.length && s[i + 1] !== "\n") {
      word += s[++i];
      inWord = true;
    } else if (c === " " || c === "\t") endWord();
    else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") endCommand();
    else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/** `dir` resolved against `base` (absolute stays; `~` is left alone — unknown home, the caller's cwd wins). */
function resolveDir(base, dir) {
  const d = posix(dir);
  if (/^[a-zA-Z]:\//.test(d) || d.startsWith("/")) return d;
  if (d === "" || d.startsWith("~")) return base;
  return `${base.replace(/\/+$/, "")}/${d}`;
}

/** Words after leading `VAR=value` assignments. */
function withoutAssignments(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  return words.slice(i);
}

const base = (w) => posix(w).split("/").pop().toLowerCase().replace(/\.(exe|cmd|ps1)$/, "");

/** `{ sub, args, dir }` of a git call, or null. `dir` — from `-C` (last wins, relative to the previous). */
function gitCall(words, cwd) {
  if (base(words[0] ?? "") !== "git") return null;
  let dir = cwd;
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) {
    const w = words[i];
    const eq = w.indexOf("=");
    const name = eq > 0 ? w.slice(0, eq) : w;
    if (GIT_VALUE_OPTS.has(name) && eq < 0) {
      if (name === "-C" && i + 1 < words.length) dir = resolveDir(dir, words[i + 1]);
      i += 2;
    } else i += 1;
  }
  if (i >= words.length) return null;
  return { sub: words[i], args: words.slice(i + 1), dir };
}

/** Is `words` an `openspec archive` call (directly, or through npx / npm exec / pnpm dlx / node <path>/openspec)? */
function isOpenspecArchive(words) {
  let w = words;
  const first = base(w[0] ?? "");
  if (first === "npx" || first === "bunx") w = w.slice(1);
  else if ((first === "npm" && w[1] === "exec") || ((first === "pnpm" || first === "yarn") && w[1] === "dlx")) w = w.slice(2);
  else if (first === "node") w = w.slice(1);
  w = w.filter((x, k) => !(k === 0 && x === "--") && !x.startsWith("-"));
  const bin = (w[0] ?? "").toLowerCase();
  const isOpenspec = base(bin) === "openspec" || /(^|\/)openspec(@[^/\s]*)?$/.test(posix(bin)) || /@fission-ai\/openspec(@\S*)?$/.test(bin) || /\/openspec\/bin\/openspec(\.js)?$/.test(posix(bin));
  return isOpenspec && w[1] === "archive";
}

function isForcePush(args) {
  for (const a of args) {
    if (a === "--force" || a === "-f" || a.startsWith("--force-with-lease") || a === "--force-if-includes") return true;
    if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) && !a.startsWith("--")) return true;
    if (a.startsWith("+") && a.length > 1) return true;
  }
  return false;
}

/** Does this git call leave `main` or write history in the checkout it runs in? */
function writesCheckout(sub, args) {
  if (["commit", "merge", "cherry-pick", "revert"].includes(sub)) {
    // `git merge --abort` / `cherry-pick --abort` undo an in-progress operation — allowed
    return !args.some((a) => a === "--abort" || a === "--quit");
  }
  if (sub === "pull") return !args.includes("--ff-only");
  if (sub === "switch") {
    const pos = args.filter((a) => !a.startsWith("-"));
    return args.some((a) => /^-(c|C|-create|-force-create|-orphan|-detach|d)$/.test(a)) || pos.length !== 1 || pos[0] !== "main";
  }
  if (sub === "checkout") {
    if (args.some((a) => /^-(b|B|-orphan|-detach)$/.test(a))) return true;
    const dd = args.indexOf("--");
    const before = (dd >= 0 ? args.slice(0, dd) : args).filter((a) => !a.startsWith("-"));
    if (dd >= 0) return before.length > 0 && before[0] !== "main" && before[0] !== "HEAD";
    return before.length > 0 && before[0] !== "main";
  }
  return false;
}

/**
 * Hook response for `pre-tool` and the hook input JSON, or null (allow, print nothing).
 * `io`: `env` — process env (CLAUDE_PROJECT_DIR); `gitDirs(dir)` — `{ gitDir, commonDir }` (absolute, `/`) of the work
 * tree containing `dir`, or null (not a repo, git failed). Inert (null) when the project dir is not a git work tree.
 */
export function hookResponse(event, input, io) {
  if (event !== "pre-tool" || !input || typeof input !== "object") return null;
  if (!CHECKED_TOOLS.has(input.tool_name)) return null;
  const command = input.tool_input?.command;
  if (typeof command !== "string" || command.trim() === "") return null;

  const safeDirs = (dir) => {
    try {
      return io.gitDirs(dir);
    } catch {
      return null;
    }
  };
  const lower = (p) => posix(p).replace(/\/+$/, "").toLowerCase();
  let projectCommon;
  const isMainCheckout = (dir) => {
    if (projectCommon === undefined) {
      const project = io.env?.CLAUDE_PROJECT_DIR || input.cwd;
      projectCommon = project ? (safeDirs(posix(project))?.commonDir ?? null) : null;
    }
    if (!projectCommon) return false;
    const d = safeDirs(dir);
    return !!d && lower(d.gitDir) === lower(d.commonDir) && lower(d.commonDir) === lower(projectCommon);
  };

  let cwd = posix(input.cwd || io.env?.CLAUDE_PROJECT_DIR || "");
  const hits = new Set();
  for (const raw of simpleCommands(command, input.tool_name === "PowerShell" ? "powershell" : "bash")) {
    const words = withoutAssignments(raw);
    if (words.length === 0) continue;
    if (CD.has(words[0].toLowerCase())) {
      const target = words.slice(1).find((w) => !w.startsWith("-"));
      if (target !== undefined) cwd = resolveDir(cwd, target);
      continue;
    }
    if (isOpenspecArchive(words)) {
      hits.add("openspec-archive");
      continue;
    }
    const git = gitCall(words, cwd);
    if (!git) continue;
    if (git.sub === "push" && isForcePush(git.args)) hits.add("force-push");
    if (writesCheckout(git.sub, git.args) && isMainCheckout(git.dir)) hits.add("main-checkout");
  }
  if (hits.size === 0) return null;
  const reason = [...hits].map((id) => `git-hook: ${id} — ${RULES[id].what} → ${RULES[id].instead}`).join("\n");
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
