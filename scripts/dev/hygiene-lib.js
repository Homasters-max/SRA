/**
 * Logic of `scripts/dev/hygiene.js` (ADR-0033 п. 13): what is superfluous in the repository and its worktrees, and who
 * removes it. Pure — reads go through the `io` of brief-lib.js (git, readFile, readDir) plus `io.exists(path)` and
 * `io.today` (`YYYY-MM-DD`); the worktrees, local merged branches and auto-memory come from `collectState`, not a second
 * parse. Finds only; the skill `repo-hygiene` acts.
 *
 * Every finding has an `action` (ADR-0033 п. 1, 13):
 *   auto     reversible — the skill does it without asking (merged branches, clean worktrees of merged branches,
 *            prunable worktrees, ignored leftovers);
 *   pr       tracked in git — fixed in a hygiene-PR, whose merge is the review (broken links, stale audit snapshot:
 *            older than the last tag, `AUDIT_STALE_FILES` changed files of its dir or a new module since its commit);
 *   confirm  irreversible or the maintainer's decision — listed and asked in one answer (a worktree with changes,
 *            an expiring waiver, a draft without movement, auto-memory).
 */
import { moduleOf } from "./arch-snapshot-lib.js";
import { join, lines, posix } from "./brief-lib.js";

/** A waiver expiring within this many days is a finding. */
export const WAIVER_WARN_DAYS = 30;
/** A draft folder older than this many days (by its date) is a finding. */
export const DRAFT_STALE_DAYS = 14;
/** More files of the audited dir changed on main since the snapshot's commit than this — the snapshot is stale. */
export const AUDIT_STALE_FILES = 20;
/** Markdown trees checked for broken relative links; archives are history and are not checked. */
export const LINK_ROOTS = ["docs", ".claude/skills", "AGENTS.md", "packages/cli/AGENTS.md", "README.md"];
const LINK_SKIP = [/^docs\/archive\//, /^openspec\/changes\/archive\//];

const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Markdown files under `rel` (a file or a directory), relative to `root`. */
function markdownFiles(io, root, rel) {
  if (rel.endsWith(".md")) return io.exists(join(root, rel)) ? [rel] : [];
  const out = [];
  for (const e of io.readDir(join(root, rel)) ?? []) {
    const child = `${rel}/${e.name}`;
    if (LINK_SKIP.some((re) => re.test(`${child}/`))) continue;
    if (e.dir) out.push(...markdownFiles(io, root, child));
    else if (e.name.endsWith(".md")) out.push(child);
  }
  return out;
}

/** Relative link targets of a markdown text, outside fenced code: `[x](target)` without scheme or pure anchor. */
export function relativeLinks(text) {
  const out = [];
  let fenced = false;
  for (const line of lines(text)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("<")) continue;
      let path = target.split("#")[0];
      try {
        path = decodeURI(path);
      } catch {
        // a stray % — keep the target as written
      }
      out.push(path);
    }
  }
  return out;
}

/** Normalise `a/b/../c` → `a/c`. */
function normal(p) {
  const out = [];
  for (const part of posix(p).split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return (/^[a-zA-Z]:/.test(p) ? "" : p.startsWith("/") ? "/" : "") + out.join("/");
}

/**
 * Why the audit snapshot `docs/process/audits/<file>` no longer describes main: more than `AUDIT_STALE_FILES` files of
 * its `dir` changed after its `commit`, a module (`moduleOf` at its `level`) it does not list, or a commit git does not
 * know. Empty — still current or not a snapshot.
 */
function snapshotDrift(io, root, file) {
  let snap;
  try {
    snap = JSON.parse(io.readFile(join(root, "docs", "process", "audits", file)) ?? "null");
  } catch {
    snap = null;
  }
  if (typeof snap?.commit !== "string" || typeof snap.dir !== "string") return [];
  const changed = io.git(["diff", "--name-only", snap.commit, "main", "--", snap.dir], root);
  if (changed == null) return [`коммит снимка ${snap.commit} не найден`];
  const out = [];
  const n = lines(changed).filter((l) => l.trim()).length;
  if (n > AUDIT_STALE_FILES) out.push(`${n} файлов ${snap.dir} изменено после ${snap.commit} (порог ${AUDIT_STALE_FILES})`);
  const known = new Set((snap.modules ?? []).map((m) => m.id));
  const code = lines(io.git(["ls-tree", "-r", "--name-only", "main", "--", snap.dir], root) ?? "").filter((f) => /\.[cm]?[jt]s$/.test(f));
  const fresh = [...new Set(code.map((f) => moduleOf(f, snap.dir, snap.level ?? 2)))].filter((m) => !known.has(m)).sort();
  if (fresh.length > 0) out.push(`новые модули: ${fresh.join(", ")}`);
  return out;
}

/** Findings `[{ kind, action, item, detail }]` for the state `collectState(io)` returned. */
export function findings(io, state) {
  if (!state) return [];
  const { root } = state;
  const out = [];
  const add = (kind, action, item, detail) => out.push({ kind, action, item, detail });

  // truly merged = the tip is the second parent of a merge on main (a fresh branch at main's tip is not merged)
  const merges = io.git(["log", "main", "--merges", "--format=%P", "-n", "500"], root);
  const secondParents = new Set(lines(merges ?? "").map((l) => l.split(" ")[1]).filter(Boolean));
  const tip = (ref) => (io.git(["rev-parse", "--verify", "--quiet", ref], root) ?? "").trim();

  for (const b of state.merged ?? []) {
    if (secondParents.has(tip(b))) add("merged-branch", "auto", b, "git branch -d");
  }

  for (const w of state.worktrees.slice(1)) {
    if (w.prunable) {
      add("prunable-worktree", "auto", w.path, "git worktree prune");
      continue;
    }
    if (!w.branch || !secondParents.has(tip(w.branch))) continue;
    const status = io.git(["status", "--porcelain"], w.path);
    const dirty = status == null || lines(status).some((l) => l.trim());
    if (dirty) add("merged-worktree-dirty", "confirm", w.path, `ветка ${w.branch} слита, в worktree изменения`);
    else add("merged-worktree", "auto", w.path, `git worktree remove, ветка ${w.branch}`);
  }

  if (io.git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], root) != null) {
    const inUse = new Set(state.worktrees.map((w) => w.branch && `origin/${w.branch}`).filter(Boolean));
    for (const b of lines(io.git(["branch", "-r", "--merged", "origin/main", "--format=%(refname:short)"], root) ?? "")) {
      const r = b.trim();
      if (!r.startsWith("origin/") || r === "origin/main" || r === "origin/HEAD" || inUse.has(r)) continue;
      if (secondParents.has(tip(`refs/remotes/${r}`))) add("merged-origin", "auto", r, "git push origin --delete");
    }
  }

  for (const change of io.readDir(join(root, ".warrant", "evidence")) ?? []) {
    if (change.dir && io.exists(join(root, ".warrant", "evidence", change.name, "raw"))) {
      add("ignored-leftover", "auto", `.warrant/evidence/${change.name}/raw`, "удалить каталог (игнорируется git)");
    }
  }

  for (const f of io.readDir(join(root, ".warrant", "waivers")) ?? []) {
    if (f.dir || !f.name.endsWith(".json")) continue;
    let w;
    try {
      w = JSON.parse(io.readFile(join(root, ".warrant", "waivers", f.name)) ?? "null");
    } catch {
      w = null;
    }
    if (w?.waiver_state !== "ACTIVE" || typeof w.expires_at !== "string" || !io.today) continue;
    const left = days(io.today, w.expires_at);
    if (left <= WAIVER_WARN_DAYS) add("waiver-expiring", "confirm", w.id ?? f.name, `${w.gate}: истекает ${w.expires_at} (${left} дн.)`);
  }

  for (const d of io.readDir(join(root, "docs", "drafts")) ?? []) {
    const m = /^(\d{4}-\d{2}-\d{2})-/.exec(d.name);
    if (d.dir && m && io.today && days(m[1], io.today) > DRAFT_STALE_DAYS) {
      add("stale-draft", "confirm", `docs/drafts/${d.name}`, `старше ${DRAFT_STALE_DAYS} дн.: grilling или удалить`);
    }
  }

  // `<date>.json` or `<date>-<topic>.json` (a second audit of the same day); the topic one sorts after the bare date.
  const audits = (io.readDir(join(root, "docs", "process", "audits")) ?? [])
    .map((e) => /^(\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?)\.json$/.exec(e.name)?.[1])
    .filter(Boolean)
    .sort();
  const last = audits[audits.length - 1];
  const stale = last ? snapshotDrift(io, root, `${last}.json`) : [];
  if (state.tag) {
    const tagDate = (io.git(["log", "-1", "--format=%cs", state.tag], root) ?? "").trim();
    if (tagDate && (!last || last < tagDate)) stale.unshift(`снимок старше ${state.tag} (${tagDate})`);
  }
  if (stale.length > 0) add("audit-stale", "pr", `docs/process/audits/${last ?? "—"}`, `${stale.join("; ")}: навык architecture-audit`);

  for (const rel of LINK_ROOTS.flatMap((r) => markdownFiles(io, root, r))) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    for (const target of relativeLinks(io.readFile(join(root, rel)) ?? "")) {
      if (target === "") continue;
      const abs = normal(target.startsWith("/") ? join(root, target) : join(root, dir, target));
      if (!io.exists(abs)) add("broken-link", "pr", rel, target);
    }
  }

  if (state.memory && (state.memory.warnings.length || state.memory.project.length)) {
    add("auto-memory", "confirm", state.memory.dir, [...state.memory.warnings, ...state.memory.project.map((p) => `type: project — ${p}`)].join("; "));
  }
  return out;
}

/** Findings as text, grouped by action. */
export function formatFindings(list) {
  if (list.length === 0) return "Гигиена: чисто.\n";
  const head = { auto: "Сам, без вопросов", pr: "Через hygiene-PR", confirm: "С подтверждением maintainer'а" };
  const out = [`Гигиена: ${list.length} (ADR-0033 п. 13)`];
  for (const action of ["auto", "pr", "confirm"]) {
    const group = list.filter((f) => f.action === action);
    if (group.length === 0) continue;
    out.push(`${head[action]} (${group.length}):`);
    for (const f of group) out.push(`  - [${f.kind}] ${f.item} — ${f.detail}`);
  }
  return `${out.join("\n")}\n`;
}
