/**
 * Logic of `scripts/dev/brief.js` (ADR-0032 п. 4, 9, 11; ADR-0033 п. 7, 12): the state of a WARRANT development
 * session, computed from the local repository only (git and files — no network, no `gh`, no `openspec`) and printed in
 * at most 2 KB. Streams (handoff files of all worktrees) come in the order of their `После:` lines; merged branches on
 * origin are counted by the last `git fetch`.
 * Pure — every read goes through the injected `io`, so unit tests need no process:
 *
 *   io.startDir                 directory the session runs in (CLAUDE_PROJECT_DIR or cwd)
 *   io.home                     user home directory (forward slashes)
 *   io.git(args, cwd)           stdout of `git <args>` in `cwd`, or null (non-zero exit, timeout, no git)
 *   io.readFile(path)           UTF-8 text, or null (no file)
 *   io.readDir(path)            [{ name, dir }] entries, or null (no directory)
 *
 * Paths are joined with `/` (git on Windows prints `D:/project/SRA`; Node accepts forward slashes).
 */

/** Upper bound of the printed state, UTF-8 bytes (ADR-0032 п. 4). */
export const MAX_BYTES = 2048;
/** MEMORY.md longer than this many lines is a warning (ADR-0032 п. 9). */
export const MEMORY_INDEX_MAX_LINES = 10;
/** Handoff files shown per worktree before `… ещё N`. */
const HANDOFF_PER_WORKTREE = 5;

export const TITLE = "WARRANT — состояние (scripts/dev/brief.js, ADR-0032 п. 4)";

const posix = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const join = (...parts) => parts.map((p, i) => (i === 0 ? posix(p) : posix(p).replace(/^\/+/, ""))).join("/");
const samePath = (a, b) => posix(a).toLowerCase() === posix(b).toLowerCase();
const lines = (text) => {
  const all = String(text ?? "").split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  return all;
};
const bytes = (s) => new TextEncoder().encode(s).length;

/**
 * `git worktree list --porcelain` → [{ path, branch, detached, bare, prunable }] in git's order (the main worktree
 * first). `branch` — short name (`refs/heads/` dropped) or null.
 */
export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of lines(porcelain)) {
    if (line.startsWith("worktree ")) {
      cur = { path: posix(line.slice("worktree ".length)), branch: null, detached: false, bare: false, prunable: false };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line === "bare") {
      cur.bare = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      cur.prunable = true;
    }
  }
  return out;
}

/** Claude Code project slug of a path: every character other than [A-Za-z0-9] → `-` (`D:\project\SRA` → `D--project-SRA`). */
export function memorySlug(mainWorktreePath) {
  return String(mainWorktreePath).replace(/[^A-Za-z0-9]/g, "-");
}

/** Auto-memory directory of the repository whose main worktree is `mainWorktreePath`. */
export function memoryDir(home, mainWorktreePath) {
  return join(home, ".claude", "projects", memorySlug(mainWorktreePath), "memory");
}

const TYPE_PROJECT = /^[ \t]*type:[ \t]*["']?project["']?[ \t]*$/m;

/**
 * Warnings about auto-memory (ADR-0032 п. 9): the index MEMORY.md longer than 10 lines; any other `*.md` of the memory
 * with a `type: project` line (any indentation — top-level frontmatter or under `metadata:`). `files` — [{ name, text }].
 */
export function memoryWarnings(files) {
  const warnings = [];
  const index = files.find((f) => f.name === "MEMORY.md");
  if (index) {
    const n = lines(index.text).length;
    if (n > MEMORY_INDEX_MAX_LINES) warnings.push(`MEMORY.md — ${n} строк (> ${MEMORY_INDEX_MAX_LINES})`);
  }
  const project = files
    .filter((f) => f.name !== "MEMORY.md" && f.name.endsWith(".md") && TYPE_PROJECT.test(f.text))
    .map((f) => f.name)
    .sort();
  return { warnings, project };
}

/** Number of open task lines `- [ ]` in a tasks.md. */
export function countOpenTasks(text) {
  return lines(text).filter((l) => /^[ \t]*- \[ \]/.test(l)).length;
}

function versionKey(tag) {
  const [core, ...pre] = String(tag).replace(/^v/, "").split("-");
  return { parts: core.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)), pre: pre.join("-") };
}

/** Semver-like comparison of `v*` tags: numeric parts numerically, a release above its pre-releases. */
export function compareVersions(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.parts.length, kb.parts.length); i++) {
    const x = ka.parts[i] ?? 0;
    const y = kb.parts[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  if (ka.pre === kb.pre) return 0;
  if (!ka.pre) return 1;
  if (!kb.pre) return -1;
  return ka.pre < kb.pre ? -1 : 1;
}

/** Latest of the `git tag -l v*` lines by version, or null. */
export function latestTag(tagList) {
  const tags = lines(tagList).map((t) => t.trim()).filter((t) => /^v\d/.test(t));
  return tags.length ? tags.sort(compareVersions)[tags.length - 1] : null;
}

function readJson(io, p) {
  const text = io.readFile(p);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Streams named by the `После: a, b` line of a handoff file (before its first `## `); [] without one. */
export function parseAfter(text) {
  for (const line of lines(text ?? "")) {
    if (line.startsWith("## ")) break;
    const m = /^После:s*(.*)$/.exec(line.trim());
    if (m) return m[1].split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Streams in dependency order (`after` first, ties by name): `[{ name, waits, missing, cycle }]` — `waits`: streams
 * of `after` that still exist; `missing`: named in `После` but without a handoff file (the line should have gone with
 * the predecessor's last PR); `cycle`: the stream is on a dependency cycle (appended at the end).
 */
export function orderStreams(streams) {
  const names = [...streams.keys()].sort();
  const deps = new Map(names.map((n) => [n, (streams.get(n) ?? []).filter((d) => streams.has(d) && d !== n)]));
  const done = new Set();
  const out = [];
  for (;;) {
    const next = names.find((n) => !done.has(n) && deps.get(n).every((d) => done.has(d)));
    if (next === undefined) break;
    done.add(next);
    out.push(next);
  }
  const item = (n, cycle) => ({ name: n, waits: deps.get(n), missing: (streams.get(n) ?? []).filter((d) => !streams.has(d)), cycle });
  return [...out.map((n) => item(n, false)), ...names.filter((n) => !done.has(n)).map((n) => item(n, true))];
}

/**
 * Collect the state. Null when `io.startDir` is not in a git work tree (print nothing). Missing pieces are null or
 * empty, never an exception from here — except a broken `io`, which brief.js turns into empty output.
 */
export function collectState(io) {
  const rootOut = io.git(["rev-parse", "--show-toplevel"], io.startDir);
  if (rootOut == null || !rootOut.trim()) return null;
  const root = posix(rootOut.trim());

  let branch = (io.git(["branch", "--show-current"], root) ?? "").trim();
  if (!branch) {
    const sha = (io.git(["rev-parse", "--short", "HEAD"], root) ?? "").trim();
    branch = sha ? `detached ${sha}` : "detached";
  }
  const status = io.git(["status", "--porcelain"], root);
  const dirty = status == null ? null : lines(status).filter((l) => l.trim()).length;

  const worktrees = parseWorktrees(io.git(["worktree", "list", "--porcelain"], root) ?? "").map((w) => ({
    ...w,
    handoff: w.bare
      ? []
      : (io.readDir(join(w.path, "docs", "handoff")) ?? [])
          .filter((e) => !e.dir && e.name.endsWith(".md"))
          .map((e) => e.name)
          .sort(),
  }));

  const tag = latestTag(io.git(["tag", "-l", "v*"], root) ?? "");
  // packages/cli/package.json has no version of its own (design D-1): the CLI's version is the root package.json's
  const cli =
    readJson(io, join(root, "packages", "cli", "package.json"))?.version ?? readJson(io, join(root, "package.json"))?.version ?? null;
  const packs = (io.readDir(join(root, "packs")) ?? [])
    .filter((e) => e.dir)
    .map((e) => readJson(io, join(root, "packs", e.name, "pack.json")))
    .filter((p) => p && p.id)
    .map((p) => `${p.id}@${p.version ?? "?"}`)
    .sort();

  const changes = (io.readDir(join(root, "openspec", "changes")) ?? [])
    .filter((e) => e.dir && e.name !== "archive")
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const tasks = io.readFile(join(root, "openspec", "changes", name, "tasks.md"));
      return { name, open: tasks == null ? null : countOpenTasks(tasks) };
    });

  // branches checked out in a worktree are in use, not leftovers to delete
  let merged = null;
  if (io.git(["show-ref", "--verify", "--quiet", "refs/heads/main"], root) != null) {
    const out = io.git(["branch", "--merged", "main", "--format=%(refname:short)"], root);
    if (out != null) {
      const inUse = new Set(worktrees.map((w) => w.branch).filter(Boolean));
      merged = lines(out)
        .map((b) => b.trim())
        .filter((b) => b && b !== "main" && !inUse.has(b))
        .sort();
    }
  }

  let memory = null;
  if (worktrees.length > 0 && io.home) {
    const dir = memoryDir(io.home, worktrees[0].path);
    const entries = io.readDir(dir);
    if (entries) {
      const files = entries
        .filter((e) => !e.dir && e.name.endsWith(".md"))
        .map((e) => ({ name: e.name, text: io.readFile(join(dir, e.name)) ?? "" }));
      memory = { dir, ...memoryWarnings(files) };
    }
  }

  // a stream's own worktree has its newest handoff file: a copy outside the main worktree wins
  const streamAfter = new Map();
  for (const w of [...worktrees.slice(1), ...worktrees.slice(0, 1)]) {
    for (const name of w.handoff) {
      const stream = name.replace(/.md$/, "");
      if (!streamAfter.has(stream)) streamAfter.set(stream, parseAfter(io.readFile(join(w.path, "docs", "handoff", name))));
    }
  }
  const streams = orderStreams(streamAfter);

  // merged branches on origin by the last fetch (no network); those checked out in a worktree are in use
  let mergedOrigin = null;
  if (io.git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], root) != null) {
    const out = io.git(["branch", "-r", "--merged", "origin/main", "--format=%(refname:short)"], root);
    if (out != null) {
      const inUse = new Set(worktrees.map((w) => w.branch && `origin/${w.branch}`).filter(Boolean));
      mergedOrigin = lines(out)
        .map((b) => b.trim())
        .filter((b) => b.startsWith("origin/") && b !== "origin/main" && b !== "origin/HEAD" && !inUse.has(b)).length;
    }
  }

  return { root, branch, dirty, worktrees, tag, cli, packs, changes, merged, mergedOrigin, streams, memory };
}

/** A worktree as one list item: path, branch (or detached / bare), its handoff files. */
function worktreeItem(w) {
  const ref = w.bare ? "bare" : w.branch ?? (w.detached ? "detached" : "?");
  let item = `${w.path} [${ref}${w.prunable ? ", prunable" : ""}]`;
  if (!w.bare) {
    const shown = w.handoff.slice(0, HANDOFF_PER_WORKTREE);
    const rest = w.handoff.length - shown.length;
    item += ` handoff: ${shown.length ? shown.join(", ") : "—"}${rest > 0 ? `, … ещё ${rest}` : ""}`;
  }
  return item;
}

/** A stream with what it waits for: `phase-4 (ждёт git-automation)`, `x (! нет потока y)`, `z (! цикл)`. */
function streamItem(s) {
  const notes = [];
  if (s.cycle) notes.push("! цикл");
  if (s.waits.length) notes.push(`ждёт ${s.waits.join(", ")}`);
  if (s.missing.length) notes.push(`! нет потока ${s.missing.join(", ")}`);
  return notes.length ? `${s.name} (${notes.join("; ")})` : s.name;
}

/** Document blocks: `{ text }` — a line; `{ head, items, inline }` — a list the byte limit may shorten. */
function blocks(state) {
  const b = [{ text: TITLE }];
  b.push({
    text: `Сессия: ${state.root} [${state.branch}], незакоммиченных изменений: ${state.dirty ?? "?"}`,
  });
  b.push({ head: `Worktree (${state.worktrees.length}):`, items: state.worktrees.map(worktreeItem) });
  if (state.streams?.length) b.push({ head: "Потоки по порядку: ", items: state.streams.map(streamItem), inline: true });
  b.push({ text: `Последний тег: ${state.tag ?? "нет"}; CLI: ${state.cli ?? "?"}` });
  b.push({ head: "Packs: ", items: state.packs, inline: true, empty: "нет" });
  b.push({
    head: `Активные Changes (${state.changes.length}):`,
    items: state.changes.map((c) => `${c.name}: ${c.open == null ? "нет tasks.md" : `открытых задач ${c.open}`}`),
    empty: " нет",
  });
  if (state.merged) {
    b.push({ head: `Ветки, слитые в main и не удалённые (${state.merged.length}): `, items: state.merged, inline: true, empty: "нет" });
  }
  if (state.mergedOrigin) b.push({ text: `Слитые ветки на origin (по последнему fetch): ${state.mergedOrigin}` });
  if (state.memory && (state.memory.warnings.length || state.memory.project.length)) {
    b.push({ text: `auto-memory (${state.memory.dir}) — только личное, ADR-0032 п. 9:` });
    for (const w of state.memory.warnings) b.push({ text: `  ! ${w}` });
    if (state.memory.project.length) {
      b.push({ head: "  ! type: project — ", items: state.memory.project, inline: true });
    }
  }
  return b;
}

function render(doc) {
  const out = [];
  for (const blk of doc) {
    if (blk.items === undefined) {
      out.push(blk.text);
      continue;
    }
    const shown = blk.items.slice(0, blk.shown);
    const rest = blk.items.length - shown.length;
    if (blk.inline) {
      const parts = rest > 0 ? [...shown, `… ещё ${rest}`] : shown;
      out.push(blk.head + (parts.length ? parts.join(", ") : blk.empty ?? ""));
    } else if (blk.items.length === 0) {
      out.push(blk.head + (blk.empty ?? ""));
    } else {
      out.push(blk.head);
      for (const item of shown) out.push(`  - ${item}`);
      if (rest > 0) out.push(`  … ещё ${rest}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** Cut `text` to at most `max` UTF-8 bytes at a line boundary (last resort: a single line longer than the limit). */
function cutBytes(text, max) {
  if (bytes(text) <= max) return text;
  const out = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const n = bytes(line) + 1;
    if (used + n > max) break;
    out.push(line);
    used += n;
  }
  if (out.length > 0) return `${out.join("\n")}\n`;
  let s = text.slice(0, max);
  while (bytes(s) > max) s = s.slice(0, -1);
  return s;
}

/**
 * The state as text of at most `maxBytes` UTF-8 bytes: while over the limit, the list with the most items shown loses
 * one (marked `… ещё N`); if even empty lists do not fit, the text is cut at a line boundary.
 */
export function formatBrief(state, maxBytes = MAX_BYTES) {
  const doc = blocks(state).map((blk) => (blk.items ? { ...blk, shown: blk.items.length } : blk));
  let text = render(doc);
  while (bytes(text) > maxBytes) {
    let widest = null;
    for (const blk of doc) if (blk.items && blk.shown > 0 && (!widest || blk.shown > widest.shown)) widest = blk;
    if (!widest) break;
    widest.shown -= 1;
    text = render(doc);
  }
  return cutBytes(text, maxBytes);
}

/** The printed state, or "" when there is nothing to say (not a git work tree). */
export function brief(io, maxBytes = MAX_BYTES) {
  const state = collectState(io);
  return state ? formatBrief(state, maxBytes) : "";
}
