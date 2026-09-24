/**
 * Graft experiment metrics (ADR-0026, ADR-0027, docs/process/graft.md): what one subagent spent on one task group or
 * one benchmark question, read from its Claude Code transcript, whether it followed the code-search procedure, and
 * how the arms compare.
 *
 * Transcript — `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` next
 * to it (`description` = the Agent call's description). One API response may span several JSONL lines with the same
 * `message.id` — usage is counted once per id, tool calls once per `tool_use` id.
 *
 * Arms are blind labels at the end of the description: `[A]` — code search via `scripts/dev/cs.js`
 * (the code-search skill, .claude/skills/code-search/SKILL.md; ADR-0028 — every group since adoption), `[B]` — control, usual tools. Graft's own "tokens saved"
 * lines are not used (and `cs.js` strips them).
 *
 * Primary metric (ADR-0027): bytes of tool results the agent pulled into its context while exploring
 * (`ingest.explore_bytes`), and the same before its first edit (`ingest.explore_before_edit_bytes`).
 *
 * Deviations from the code-search skill (`deviationsOf`) are the one detector shared by the metrics and the live hook
 * `scripts/dev/cs-hook.js` (D-3); a range that covers a whole code file is a whole read (D-8).
 *
 * Shared by `scripts/dev/graft-metrics.js`, `scripts/dev/bench-score.js`, `scripts/dev/cs-hook-lib.js` and
 * `packages/cli/test/unit/dev/graft-metrics.test.ts`. Plain Node ESM. Dev tooling only — not in `files` of
 * package.json.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUN_FORMAT = "graft-run/2";
export const REPORT_FORMAT = "graft-report/2";
export const BENCH_RESULT_FORMAT = "code-search-bench-result/1";
export const BENCH_REPORT_FORMAT = "code-search-bench-report/1";

/** Blind arm label at the end of the Agent description. */
const ARM_TAG = /\[(A|B)\]\s*$/;
const ARM_MODE = { A: "on", B: "off" };

/** ON runs with more deviations from the procedure than this are not counted in the verdict. */
export const MAX_DEVIATIONS = 3;

const CODE_FILE = /\.(?:[cm]?[jt]s)$/;
const CODE_GLOB = /\.(?:[cm]?[jt]sx?|\{[^}]*\b[cm]?[jt]sx?\b[^}]*\})$/;
const EXT_GLOB = /\.(?:[\w-]+|\{[^}]*\})$/;
const CODE_TYPE = /^(?:[cm]?[jt]s|tsx|jsx|typescript|javascript)$/i;
const CODE_DIR = /^(?:\.\/)?(?:packages|scripts|src|test)(?:\/|$)/;
const CODE_PATH = /(?:^|\/)(?:packages|scripts)(?:\/|$)/;
/** Not WARRANT code even under packages/ or scripts/: dependencies, build output, data, fixtures, JSON schemas. */
const NOT_CODE_ALWAYS =
  /(?:^|\/)(?:node_modules|dist|\.git|\.claude)(?:\/|$)|(?:^|\/)packages\/[^/]+\/schemas(?:\/|$)|(?:^|\/)test\/(?:fixtures|golden)(?:\/|$)|\.(?:json|jsonc|jsonl|ya?ml|md|lock|txt|toml|html|css|svg|log|csv)$/i;
/** Docs and specs at the repo root (`packages/cli/src/core/openspec/` is code). */
const DOC_DIR = /(?:^|\/)(?:docs|openspec)(?:\/|$)/;
const NOT_CODE = { test: (p) => NOT_CODE_ALWAYS.test(p) || (DOC_DIR.test(p) && !CODE_PATH.test(p)) };
/** A repo or worktree root by name (`D:/project/SRA`, `/d/project/SRA-graft-audit`) when the real root is unknown. */
const ROOT_NAME = /(?:^|\/)SRA(?:-[\w.-]+)?\/?$/i;
/** D-8: a whole read of a code file this short is cheap and not a deviation. */
export const SMALL_FILE_LINES = 40;
/** Read without `limit` returns at most this many lines. */
const READ_TOOL_CAP = 2000;

export const DEV_GREP = "Grep over code";
export const DEV_SHELL_SEARCH = "shell search over code";
export const DEV_SHELL_WHOLE = "shell whole read of code";
export const DEV_CS_TRUNCATED = "cs output truncated";

/** Heredoc bodies (`<<'EOF' … EOF`) are file content being written, not commands. */
export function stripHeredocs(command) {
  return command.replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, "<<$1$2");
}

const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const isAbs = (p) => /^(?:[a-zA-Z]:)?\//.test(p) || p.startsWith("~");

function collapse(p) {
  if (p === "") return ".";
  const out = [];
  for (const [i, s] of p.split("/").entries()) {
    if (s === "." || (s === "" && i > 0)) continue;
    const top = out.at(-1);
    if (s === ".." && out.length > 0 && top !== ".." && top !== "" && !/^[a-zA-Z]:$/.test(top)) {
      out.pop();
      continue;
    }
    out.push(s);
  }
  if (out.length === 1 && out[0] === "") return "/";
  return out.join("/") || ".";
}

/** `p` relative to `dir` (POSIX separators, `.`/`..` collapsed); absolute `p` wins. */
export function joinPath(dir, p) {
  const t = norm(p);
  if (!dir || isAbs(t)) return collapse(t);
  return collapse(`${norm(dir)}/${t}`);
}

/** Comparable form: `/d/x` ≡ `D:\x` ≡ `d:/x/`. */
const canon = (p) =>
  collapse(norm(p))
    .replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:")
    .replace(/\/+$/, "")
    .toLowerCase();

const isBroad = (p, root) => {
  const c = collapse(norm(p));
  return c === "." || c === "*" || (Boolean(root) && canon(c) === canon(root)) || ROOT_NAME.test(c);
};

/** The path (file, directory, glob) reaches WARRANT code: packages/**, scripts/**, a code file, or the repo root. */
export function coversCode(p, root) {
  const t = norm(p);
  return !NOT_CODE.test(t) && (CODE_FILE.test(t) || CODE_GLOB.test(t) || CODE_DIR.test(t) || CODE_PATH.test(t) || isBroad(t, root));
}

const isCodeFile = (p) => CODE_FILE.test(norm(p)) && !NOT_CODE.test(norm(p));

/** File filters of a search or listing (`--include`, `-g`, `-t`, `-name`, `-Include`): code | noncode | none. */
function filterKind(globs = [], types = []) {
  let kind = "none";
  for (const t of types) {
    if (CODE_TYPE.test(t)) return "code";
    kind = "noncode";
  }
  for (const g of globs.map(norm)) {
    if (!g || g.startsWith("!")) continue;
    if (CODE_GLOB.test(g)) return "code";
    if (EXT_GLOB.test(g) || NOT_CODE.test(g.replace(/\/?\*.*$/, ""))) kind = "noncode";
  }
  return kind;
}

function hitsCode(paths, globs, types, root) {
  const kind = filterKind(globs, types);
  if (kind === "noncode") return false;
  if (kind === "code") return paths.some((p) => !NOT_CODE.test(norm(p)));
  return paths.some((p) => coversCode(p, root));
}

// ---------------------------------------------------------------------------------------------------------------
// Shell parsing: quotes, heredocs, pipes, chains, redirects — so a `|` inside a quoted regex or a commit message
// mentioning `graft ask` is not a command.

/**
 * Parse a Bash or PowerShell command into pipelines (split on `&&`, `||`, `;`, `&`, newlines, `(`, `)`, `$(`,
 * backticks) of stages (split on `|`); each stage — its words (quotes removed, a quoted string stays one word) and
 * redirects. Heredoc bodies are dropped first.
 */
export function parseShell(command, { ps = false } = {}) {
  const src = stripHeredocs(String(command ?? ""));
  const chain = [];
  let pipeline = [];
  let stage = { words: [], redirects: [] };
  let word = null;
  let redirect = null;
  /** Open `(`, `$(`, backticks: output inside `$(…)` / backticks is captured, not printed. */
  const nest = [];
  const add = (s) => {
    word = (word ?? "") + s;
  };
  const endWord = () => {
    if (word === null) return;
    if (redirect) stage.redirects.push({ op: redirect, target: word });
    else stage.words.push(word);
    word = null;
    redirect = null;
  };
  const endStage = () => {
    endWord();
    if (redirect) stage.redirects.push({ op: redirect, target: "" });
    redirect = null;
    if (stage.words.length > 0 || stage.redirects.length > 0) pipeline.push(stage);
    stage = { words: [], redirects: [] };
  };
  const endPipeline = () => {
    endStage();
    if (pipeline.length > 0) {
      pipeline.captured = nest.some((x) => x !== "(");
      chain.push(pipeline);
    }
    pipeline = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const e = j < 0 ? src.length : j;
      add(src.slice(i + 1, e));
      i = e;
    } else if (c === '"') {
      let s = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== '"'; j++) {
        const d = src[j];
        if (!ps && d === "\\" && /["\\$`]/.test(src[j + 1] ?? "")) s += src[++j];
        else if (ps && d === "`" && j + 1 < src.length) s += src[++j];
        else s += d;
      }
      add(s);
      i = j;
    } else if (c === "\\" && !ps) {
      if (n === "\n") i++;
      else if (n !== undefined && /[\s|&;<>()'"`$\\]/.test(n)) {
        add(n);
        i++;
      } else add(c);
    } else if (c === "`" && ps) {
      if (n !== undefined && n !== "\n") add(n);
      i++;
    } else if (c === "#" && word === null) {
      const j = src.indexOf("\n", i);
      i = (j < 0 ? src.length : j) - 1;
    } else if (c === " " || c === "\t" || c === "\r") endWord();
    else if (c === "\n" || c === ";") endPipeline();
    else if (c === "|") {
      if (n === "|") {
        endPipeline();
        i++;
      } else {
        endStage();
        if (n === "&") i++;
      }
    } else if (c === "&") {
      if (n === "&") {
        endPipeline();
        i++;
      } else if (n === ">") {
        endWord();
        i++;
        if (src[i + 1] === ">") i++;
        redirect = ">";
      } else endPipeline();
    } else if (c === "(" || c === ")" || c === "`" || (c === "$" && n === "(")) {
      endPipeline();
      if (c === "$") {
        nest.push("$");
        i++;
      } else if (c === "(") nest.push("(");
      else if (c === ")") nest.pop();
      else if (nest.at(-1) === "`") nest.pop();
      else nest.push("`");
    } else if (c === ">" || c === "<") {
      if (word !== null && /^\d+$/.test(word) && !redirect) word = null;
      else endWord();
      let op = c;
      while (src[i + 1] === c && op.length < 3) {
        op += c;
        i++;
      }
      if (src[i + 1] === "&") {
        i++;
        while (/[\d-]/.test(src[i + 1] ?? "")) i++;
        continue;
      }
      redirect = op;
    } else add(c);
  }
  endPipeline();
  return chain;
}

const PREFIX_WORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{", "}", "time", "exec", "command", "builtin", "nohup", "sudo", "env", "nice"]);
const ALIAS = { sls: "select-string", gc: "get-content", gci: "get-childitem", dir: "get-childitem", select: "select-object", sl: "cd", "set-location": "cd", pushd: "cd", chdir: "cd", egrep: "grep", fgrep: "grep" };
const PS_ALIAS = { cat: "get-content", type: "get-content", ls: "get-childitem" };

function commandOf(words, ps) {
  let i = 0;
  while (i < words.length && (PREFIX_WORDS.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i++;
  if (words[i] === "timeout") {
    i++;
    while (words[i]?.startsWith("-")) i++;
    i++;
  }
  if (i >= words.length) return null;
  const base = norm(words[i]).split("/").pop().toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, "");
  const name = (ps ? PS_ALIAS[base] : undefined) ?? ALIAS[base] ?? base;
  return { name, args: words.slice(i + 1) };
}

/** POSIX-style flags: `short` — letters taking a value, `long` — long options taking a value. */
function parseArgs(args, { short = "", long = [] } = {}) {
  const flags = [];
  const pos = [];
  const after = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) after.push(a);
    else if (a === "--") rest = true;
    else if (!a.startsWith("-") || a === "-") pos.push(a);
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      let value = eq < 0 ? undefined : a.slice(eq + 1);
      if (value === undefined && long.includes(name)) value = args[++i];
      flags.push({ name, value });
    } else if (/^[-+]\d+$/.test(a)) flags.push({ name: "#", value: a.slice(1) });
    else {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (short.includes(ch)) {
          flags.push({ name: ch, value: j + 1 < a.length ? a.slice(j + 1) : args[++i] });
          break;
        }
        flags.push({ name: ch });
      }
    }
  }
  const has = (...names) => flags.some((f) => names.includes(f.name));
  const values = (...names) => flags.filter((f) => names.includes(f.name) && f.value !== undefined).map((f) => f.value);
  return { flags, pos, after, has, values };
}

/** PowerShell parameters: `-Name value` for `valueParams` (prefixes allowed), switches otherwise; commas split lists. */
function parsePs(args, valueParams) {
  const named = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[A-Za-z]/.test(a)) {
      let name = a.slice(1).toLowerCase();
      let value;
      const colon = name.indexOf(":");
      if (colon >= 0) {
        value = a.slice(colon + 2);
        name = name.slice(0, colon);
      }
      const full = valueParams.find((v) => v === name) ?? valueParams.find((v) => v.startsWith(name));
      if (full) {
        if (value === undefined) value = args[++i];
        (named[full] ??= []).push(...String(value ?? "").split(","));
      } else (named[name] ??= []).push(true);
    } else pos.push(a);
  }
  return { named, pos };
}

const HEAD_ARGS = { short: "nc", long: ["lines", "bytes"] };
const intOf = (v, dflt) => {
  const m = /^[+-]?(\d+)$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : dflt;
};

/** `sed -n` script → range: `a,bp`, `a,$p`, `ap`, `p`; anything else (regex, several commands) — partial. */
function sedRange(script) {
  const s = String(script ?? "").trim();
  if (s === "p") return null;
  const m = /^(\d+)(?:,(\d+|\$))?p$/.exec(s);
  if (!m) return "partial";
  const start = Number(m[1]);
  if (m[2] === "$") return { start, count: Infinity };
  return { start, count: (m[2] === undefined ? start : Number(m[2])) - start + 1 };
}

const REV_PATH = /^(?![a-zA-Z]:[\\/])[^:\s]*:(.+)$/;

function isGraftPath(p) {
  const segs = norm(p).toLowerCase().split("/");
  const last = segs.at(-1) ?? "";
  if (last === "cs.js") return false;
  return segs.slice(0, -1).includes("graft") || /^graft(?:\.[cm]?js)?$/.test(last);
}

/**
 * One pipeline stage → what it does: cd | cs | graft | search | list | read | filter | sink | xargs | write | other.
 * Paths are joined with `dir` (the directory the chain has `cd`-ed into).
 */
function classify(words, dir, ps) {
  const c = commandOf(words, ps);
  if (!c) return { kind: "other" };
  const { name, args } = c;
  const at = (p) => joinPath(dir, p);
  const here = dir || ".";
  switch (name) {
    case "cd":
      return { kind: "cd", to: args.find((a) => !a.startsWith("-")) ?? "~" };
    case "node": {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (["-e", "--eval", "-p", "--print"].includes(a)) return { kind: "other" };
        if (["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions"].includes(a)) i++;
        else if (!a.startsWith("-")) {
          const sub = args.slice(i + 1).find((x) => !x.startsWith("-")) ?? "";
          if (norm(a).split("/").pop() === "cs.js") return { kind: "cs", sub };
          if (isGraftPath(at(a))) return /^[a-z][a-z-]*$/.test(sub) ? { kind: "graft", sub } : { kind: "other" };
          return { kind: "other" };
        }
      }
      return { kind: "other" };
    }
    case "npx": {
      const p = parseArgs(args, { short: "pc", long: ["package", "call"] });
      const [pkg, sub = ""] = p.pos;
      if (pkg && /(?:^|\/)graft(?:@[^/]*)?$/.test(pkg) && /^[a-z][a-z-]*$/.test(sub)) return { kind: "graft", sub };
      return { kind: "other" };
    }
    case "graft": {
      const sub = args.find((a) => !a.startsWith("-")) ?? "";
      return /^[a-z][a-z-]*$/.test(sub) ? { kind: "graft", sub } : { kind: "other" };
    }
    case "git": {
      let i = 0;
      let gdir = dir;
      while (i < args.length && args[i].startsWith("-")) {
        if (args[i] === "-C") gdir = joinPath(gdir, args[++i] ?? ".");
        else if (args[i] === "-c") i++;
        i++;
      }
      const sub = args[i];
      const rest = args.slice(i + 1);
      const gat = (p) => joinPath(gdir, p);
      if (sub === "grep") {
        const p = parseArgs(rest, { short: "efABCm", long: ["max-depth", "max-count", "context", "after-context", "before-context"] });
        const pos = p.has("e", "f") ? p.pos : p.pos.slice(1);
        const paths = [...pos.filter((a) => /[/.*]/.test(a)), ...p.after].map(gat);
        return { kind: "search", name, paths: paths.length > 0 ? paths : [gdir || "."], globs: [], types: [] };
      }
      if (sub === "show" || sub === "cat-file") {
        const files = rest.map((a) => REV_PATH.exec(a)?.[1]).filter(Boolean);
        return files.length > 0 ? { kind: "read", files, range: null } : { kind: "other" };
      }
      if (sub === "ls-files") {
        const p = parseArgs(rest);
        const paths = [...p.pos, ...p.after].map(gat);
        return { kind: "list", name: "git-ls-files", paths: paths.length > 0 ? paths : [gdir || "."], globs: [], types: [] };
      }
      return { kind: "other" };
    }
    case "grep": {
      const p = parseArgs(args, {
        short: "efmABCdD",
        long: ["regexp", "file", "max-count", "after-context", "before-context", "context", "include", "exclude", "exclude-dir", "directories", "devices", "label", "binary-files"],
      });
      const recursive = p.has("r", "R", "recursive", "dereference-recursive") || p.values("d", "directories").includes("recurse");
      const pos = p.has("e", "f", "regexp", "file") ? p.pos : p.pos.slice(1);
      const paths = pos.length > 0 ? pos.map(at) : recursive ? [here] : null;
      return { kind: "search", name, paths, globs: p.values("include"), types: [] };
    }
    case "rg": {
      const p = parseArgs(args, {
        short: "efgtTmABCjMr",
        long: ["regexp", "file", "glob", "iglob", "type", "type-not", "max-count", "context", "after-context", "before-context", "threads", "max-columns", "type-add", "sort", "sortr", "max-depth", "replace", "encoding", "pre", "pre-glob", "ignore-file", "max-filesize", "path-separator"],
      });
      const globs = p.values("g", "glob", "iglob");
      const types = p.values("t", "type");
      if (p.has("files")) return { kind: "list", name, paths: p.pos.length > 0 ? p.pos.map(at) : [here], globs, types };
      const pos = p.has("e", "f", "regexp", "file") ? p.pos : p.pos.slice(1);
      return { kind: "search", name, paths: pos.length > 0 ? pos.map(at) : [here], globs, types };
    }
    case "select-string": {
      const p = parsePs(args, ["path", "literalpath", "pattern", "include", "exclude", "encoding", "context", "culture"]);
      const pos = p.named.pattern ? p.pos : p.pos.slice(1);
      const paths = [...(p.named.path ?? []), ...(p.named.literalpath ?? []), ...pos.flatMap((a) => a.split(","))].filter(Boolean);
      return { kind: "search", name, paths: paths.length > 0 ? paths.map(at) : null, globs: p.named.include ?? [], types: [] };
    }
    case "get-childitem": {
      const p = parsePs(args, ["path", "literalpath", "filter", "include", "exclude", "depth"]);
      const paths = [...(p.named.path ?? []), ...(p.named.literalpath ?? []), ...p.pos.flatMap((a) => a.split(","))].filter(Boolean);
      return { kind: "list", name, paths: paths.length > 0 ? paths.map(at) : [here], globs: [...(p.named.filter ?? []), ...(p.named.include ?? [])], types: [] };
    }
    case "ls": {
      const pos = args.filter((a) => !a.startsWith("-"));
      return { kind: "list", name, paths: pos.length > 0 ? pos.map(at) : [here], globs: [], types: [] };
    }
    case "find": {
      let i = 0;
      const paths = [];
      while (i < args.length && !/^[-(!]/.test(args[i])) paths.push(at(args[i++]));
      const globs = [];
      let exec = null;
      for (; i < args.length; i++) {
        const a = args[i];
        if (["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"].includes(a)) globs.push(args[++i] ?? "");
        else if (["-exec", "-execdir", "-ok", "-okdir"].includes(a)) {
          const inner = [];
          while (i + 1 < args.length && args[i + 1] !== ";" && args[i + 1] !== "+") inner.push(args[++i]);
          i++;
          exec = classify(
            inner.filter((w) => w !== "{}"),
            dir,
            ps,
          );
        } else if (/^-(?:type|maxdepth|mindepth|newer|size|mtime|mmin|user|group|perm|regex|printf|fprint)$/.test(a)) i++;
      }
      return { kind: "list", name, paths: paths.length > 0 ? paths : [here], globs, types: [], exec };
    }
    case "xargs": {
      const p = parseArgs(args, { short: "nIPLdsEa", long: ["max-args", "max-procs", "replace", "delimiter", "arg-file", "max-chars", "max-lines"] });
      const start = args.indexOf(p.pos[0]);
      const replace = p.values("I", "replace");
      const inner = start < 0 ? [] : args.slice(start).filter((w) => !replace.includes(w) && w !== "{}");
      return { kind: "xargs", inner: classify(inner, dir, ps) };
    }
    case "cat":
    case "nl":
    case "bat":
    case "more":
    case "less":
      return { kind: "read", files: args.filter((a) => !a.startsWith("-")).map(at), range: null };
    case "get-content": {
      const p = parsePs(args, ["path", "literalpath", "totalcount", "head", "first", "tail", "last", "encoding", "readcount", "delimiter"]);
      const files = [...(p.named.path ?? []), ...(p.named.literalpath ?? []), ...p.pos.flatMap((a) => a.split(","))].filter(Boolean).map(at);
      const head = p.named.totalcount ?? p.named.head ?? p.named.first;
      const tail = p.named.tail ?? p.named.last;
      const range = head ? { start: 1, count: intOf(head[0], Infinity) } : tail ? { tail: intOf(tail[0], Infinity) } : null;
      return { kind: "read", files, range };
    }
    case "head":
    case "tail": {
      const p = parseArgs(args, HEAD_ARGS);
      const [raw] = p.values("n", "lines", "#");
      let range;
      if (p.has("c", "bytes")) range = "partial";
      else if (name === "head") range = String(raw ?? "").startsWith("-") ? null : { start: 1, count: intOf(raw, 10) };
      else range = String(raw ?? "").startsWith("+") ? { start: intOf(raw, 1), count: Infinity } : { tail: intOf(raw, 10) };
      const files = p.pos.map(at);
      return files.length > 0 ? { kind: "read", files, range } : { kind: "filter", range, truncating: true };
    }
    case "sed": {
      const p = parseArgs(args, { short: "ef", long: ["expression", "file"] });
      if (p.has("i", "in-place") || p.flags.some((f) => f.name.startsWith("in-place"))) return { kind: "write" };
      if (!p.has("n", "quiet", "silent")) return { kind: "other" };
      const pos = [...p.pos];
      const [script] = p.values("e", "expression").length > 0 ? p.values("e", "expression") : [pos.shift()];
      const range = sedRange(script);
      const files = pos.map(at);
      return files.length > 0 ? { kind: "read", files, range } : { kind: "filter", range, truncating: range !== "partial" };
    }
    case "select-object": {
      const p = parsePs(args, ["first", "last", "skip", "index", "property", "expandproperty"]);
      const skip = intOf(p.named.skip?.[0], 0);
      if (p.named.first) return { kind: "filter", range: { start: skip + 1, count: intOf(p.named.first[0], Infinity) }, truncating: true };
      if (p.named.last) return { kind: "filter", range: { tail: intOf(p.named.last[0], Infinity) }, truncating: true };
      return { kind: "other" };
    }
    case "wc":
    case "md5sum":
    case "sha1sum":
    case "sha256sum":
    case "cksum":
    case "measure-object":
    case "out-null":
      return { kind: "sink" };
    case "tee":
    case "set-content":
    case "out-file":
    case "add-content":
      return { kind: "write" };
    default:
      return { kind: "other" };
  }
}

const NULL_TARGET = /^(?:\/dev\/null|\$null|nul)$/i;
const stageWrites = (stage, cls) => cls.kind === "write" || stage.redirects.some((r) => r.op.startsWith(">") && !NULL_TARGET.test(r.target));

/** Stages of every pipeline with `cd` applied (a lone `cd x` changes the directory of the rest of the chain). */
function plan(command, { ps = false, cwd = "" } = {}) {
  let dir = cwd ? norm(cwd) : "";
  const out = [];
  for (const pipeline of parseShell(command, { ps })) {
    const stages = pipeline.map((st) => {
      const cls = classify(st.words, dir, ps);
      return { ...cls, writes: stageWrites(st, cls), captured: pipeline.captured === true };
    });
    if (stages.length === 1 && stages[0].kind === "cd") dir = joinPath(dir, stages[0].to);
    else out.push(stages);
  }
  return out;
}

/** A shell command explores files when the head of any pipeline reads, searches or lists (`cd x && cat y`). */
export function isShellSearch(command, { ps = false } = {}) {
  return plan(command, { ps }).some(([s]) => !s.writes && (["search", "read", "list", "sink"].includes(s.kind) || (s.kind === "xargs" && s.inner.kind === "search")));
}

/** A shell command writes files (heredoc to a file, `sed -i`, redirect, `tee`). */
export function isShellWrite(command, { ps = false } = {}) {
  return plan(command, { ps }).some((stages) => stages.some((s) => s.writes));
}

/** Subcommands of every `cs.js <sub>` call in a shell command. */
export function csCalls(command, { ps = false } = {}) {
  return plan(command, { ps })
    .flat()
    .filter((s) => s.kind === "cs")
    .map((s) => s.sub);
}

/** Subcommands of every direct graft call (`graft`, `npx @nanonets/graft`, `node …/graft/dist/cli.js`), outside `cs.js`. */
export function rawGraftCalls(command, { ps = false } = {}) {
  return plan(command, { ps })
    .flat()
    .filter((s) => s.kind === "graft")
    .map((s) => s.sub);
}

const countLines = (text) => {
  const t = String(text).replace(/\r/g, "").replace(/\n+$/, "");
  return t === "" ? 0 : t.split("\n").length;
};

/**
 * D-8: does reading `range` of `file` take the whole file? `range` — null (all), "partial", `{start, count, cap?}` or
 * `{tail}`. Output (`outLines`) that stopped short of the range reached the end of file; otherwise the file length
 * comes from `fileLines(file)` (ignored when the output has more lines — the file changed since). A whole read of a
 * file of ≤ SMALL_FILE_LINES lines is not a deviation.
 */
function wholeRead(file, range, fileLines, outLines) {
  if (range === "partial") return false;
  if (range !== null && range.tail === undefined && range.start > 1) return false;
  let len = fileLines?.(file) ?? null;
  // the output is direct evidence: more lines than the known length — the file changed since, length unknown
  if (len !== null && outLines !== null && outLines > len) len = null;
  const bound = range === null ? Infinity : (range.tail ?? range.count);
  const cap = range?.cap ?? Infinity;
  let whole;
  if (outLines !== null && outLines < Math.min(bound, cap)) {
    whole = true; // stopped short of the range: end of file
    len = outLines;
  } else if (bound === Infinity) whole = true;
  else if (len !== null) whole = bound >= len;
  else whole = bound >= cap;
  return whole && !(len !== null && len <= SMALL_FILE_LINES);
}

const compose = (a, b) => (a === null ? b : b === null ? a : "partial");

function shellDeviations(command, ctx, ps) {
  const out = [];
  const stagesList = plan(command, { ps, cwd: ctx.cwd });
  const heads = stagesList.filter(([s]) => s.kind === "read" && !s.captured);
  const outLines = ctx.result === undefined || heads.length !== 1 ? null : countLines(ctx.result);
  const codeListing = (s) => s?.kind === "list" && hitsCode(s.paths, s.globs, s.types, ctx.root);
  for (const stages of stagesList) {
    for (const [i, s] of stages.entries()) {
      if (s.writes) continue;
      const later = stages.slice(i + 1);
      if (s.kind === "graft") out.push(`raw graft ${s.sub}`);
      else if (s.kind === "cs") {
        if (later.some((x) => x.kind === "filter" && x.truncating)) out.push(DEV_CS_TRUNCATED);
      } else if (s.kind === "search") {
        if (s.paths) {
          if (hitsCode(s.paths, s.globs, s.types, ctx.root)) out.push(DEV_SHELL_SEARCH);
        } else if (i > 0) {
          const up = stages[0];
          if ((up.kind === "read" && up.range === null && up.files.some(isCodeFile)) || (s.name === "select-string" && up.name === "get-childitem" && codeListing(up))) {
            out.push(DEV_SHELL_SEARCH);
          }
        }
      } else if (s.kind === "xargs" || (s.kind === "list" && s.exec)) {
        const inner = s.kind === "xargs" ? s.inner : s.exec;
        const source = s.kind === "xargs" ? (i > 0 ? stages[0] : null) : s;
        const fromCode = codeListing(source);
        if (inner.kind === "search" && ((inner.paths && hitsCode(inner.paths, inner.globs, inner.types, ctx.root)) || (!inner.paths && fromCode))) {
          out.push(DEV_SHELL_SEARCH);
        } else if (inner.kind === "read" && (inner.files.some(isCodeFile) || (inner.files.length === 0 && fromCode)) && wholeRead("", inner.range, null, null)) {
          out.push(DEV_SHELL_WHOLE);
        }
      } else if (s.kind === "read" && i === 0 && !s.captured) {
        const files = s.files.filter(isCodeFile);
        if (files.length === 0) continue;
        const next = later[0];
        let range = s.range;
        if (next) {
          if (next.kind !== "filter") continue;
          range = compose(range, next.range);
        }
        const lines = files.length === 1 && later.length <= 1 ? outLines : null;
        if (files.some((f) => wholeRead(f, range, ctx.fileLines, lines))) out.push(DEV_SHELL_WHOLE);
      }
    }
  }
  return out;
}

/** Numbered lines of a Read result (`   12\t…` or `12→…`). */
function readResultLines(text) {
  return (String(text).match(/^\s*\d+(?:\t|→)/gm) ?? []).length;
}

/**
 * Deviations from the code-search skill (rules 1, 2, 5) in one tool call: text search over code instead of `cs grep` /
 * `cs ask`, graft called around `cs.js`, a whole code file read (no range, or a range that covers the file — D-8)
 * instead of `cs skeleton` + a range, `cs` output cut with `head` / `tail`.
 * Not deviations: writes (heredoc, `sed -i`), JSON / configs / locks / docs / schemas / fixtures, `node_modules`, file
 * listing (`find`, `ls`, Glob), filtering piped output, a range piped into grep, file content captured by `$(…)`,
 * quoted text (commit messages, `echo`), whole reads of files of ≤ SMALL_FILE_LINES lines.
 * `ctx` (all optional): `result` — the tool result text (a Read's numbered lines, a command's output) to see where
 * a read stopped; `fileLines(path)` — line count of a file (null when unknown); `cwd` — directory of the call;
 * `root` — repo root.
 */
export function deviationsOf(block, ctx = {}) {
  const input = block?.input ?? {};
  const out = [];
  if (block?.name === "Grep") {
    const path = input.path ? joinPath(ctx.cwd ?? "", input.path) : ctx.cwd ? norm(ctx.cwd) : ".";
    const glob = input.glob ? String(input.glob) : "";
    const globs = glob && !glob.includes("/") ? [glob] : [];
    const paths = glob.includes("/") ? [joinPath(path, glob)] : [path];
    const types = input.type ? [String(input.type)] : [];
    if (hitsCode(paths, globs, types, ctx.root)) out.push(DEV_GREP);
  } else if (block?.name === "Read") {
    const file = joinPath(ctx.cwd ?? "", input.file_path ?? "");
    if (!isCodeFile(file)) return out;
    const start = typeof input.offset === "number" ? input.offset : 1;
    if (start > 1) return out;
    const lines = ctx.result === undefined ? null : readResultLines(ctx.result);
    if (lines === 0) return out;
    const range = typeof input.limit === "number" ? { start: 1, count: input.limit, cap: READ_TOOL_CAP } : { start: 1, count: Infinity, cap: READ_TOOL_CAP };
    if (wholeRead(file, range, ctx.fileLines, lines)) {
      out.push(`whole read ${file.split("/").slice(-2).join("/")}${typeof input.limit === "number" ? " via range" : ""}`);
    }
  } else if (block?.name === "Bash" || block?.name === "PowerShell") {
    out.push(...shellDeviations(String(input.command ?? ""), ctx, block.name === "PowerShell"));
  }
  return out;
}

/** The deviation is a whole-file read (rule 2). */
export const isWholeReadDeviation = (d) => d.startsWith("whole read") || d === DEV_SHELL_WHOLE;

const resultText = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "";

/**
 * Metrics of one transcript (JSONL text). Deviations of a call are judged with its result (where a read stopped);
 * `fileLines(path)` — optional line count of a file as the agent saw it (D-8: a range covering the whole file).
 */
export function parseTranscript(text, { fileLines } = {}) {
  const seenMsg = new Set();
  const seenTool = new Set();
  const kindOf = new Map();
  const pending = new Map();
  const tokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0, total: 0, context_peak: 0 };
  const ingest = { explore_bytes: 0, cs_bytes: 0, explore_before_edit_bytes: 0, results_bytes: 0 };
  const wholeReads = { count: 0, bytes: 0 };
  const byName = {};
  const searchCommands = [];
  const deviations = [];
  let shellSearch = 0;
  let rawGraft = 0;
  let edited = false;
  let start = null;
  let end = null;
  const judge = ({ block, cwd }, result, bytes) => {
    const found = deviationsOf(block, { result, cwd, fileLines });
    deviations.push(...found);
    const whole = found.filter(isWholeReadDeviation).length;
    if (whole > 0) {
      wholeReads.count += whole;
      wholeReads.bytes += bytes;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof rec.timestamp === "string") {
      if (start === null || rec.timestamp < start) start = rec.timestamp;
      if (end === null || rec.timestamp > end) end = rec.timestamp;
    }
    const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
    if (rec.type === "user") {
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const text = resultText(block.content);
        const bytes = Buffer.byteLength(text);
        if (pending.has(block.tool_use_id)) {
          judge(pending.get(block.tool_use_id), text, bytes);
          pending.delete(block.tool_use_id);
        }
        if (!kindOf.has(block.tool_use_id)) continue;
        const { kind, beforeEdit } = kindOf.get(block.tool_use_id);
        kindOf.delete(block.tool_use_id);
        ingest.results_bytes += bytes;
        if (kind === "explore" || kind === "cs") {
          ingest.explore_bytes += bytes;
          if (beforeEdit) ingest.explore_before_edit_bytes += bytes;
        }
        if (kind === "cs") ingest.cs_bytes += bytes;
      }
      continue;
    }
    if (rec.type !== "assistant" || !rec.message) continue;
    const msg = rec.message;
    const msgKey = msg.id ?? rec.requestId ?? rec.uuid;
    if (msg.usage && !seenMsg.has(msgKey)) {
      seenMsg.add(msgKey);
      const u = msg.usage;
      const inp = u.input_tokens ?? 0;
      const cc = u.cache_creation_input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;
      tokens.input += inp;
      tokens.cache_creation += cc;
      tokens.cache_read += cr;
      tokens.output += u.output_tokens ?? 0;
      tokens.context_peak = Math.max(tokens.context_peak, inp + cc + cr);
    }
    for (const block of content) {
      if (block.type !== "tool_use" || seenTool.has(block.id)) continue;
      seenTool.add(block.id);
      byName[block.name] = (byName[block.name] ?? 0) + 1;
      pending.set(block.id, { block, cwd: typeof rec.cwd === "string" ? rec.cwd : undefined });
      let kind = "other";
      if (block.name === "Read" || block.name === "Grep" || block.name === "Glob") kind = "explore";
      else if (block.name === "Edit" || block.name === "Write" || block.name === "NotebookEdit") kind = "edit";
      else if (block.name === "Bash" || block.name === "PowerShell") {
        const command = String(block.input?.command ?? "");
        const ps = block.name === "PowerShell";
        const cs = csCalls(command, { ps });
        const raw = rawGraftCalls(command, { ps });
        rawGraft += raw.length;
        if (cs.length + raw.length > 0) {
          kind = "cs";
          searchCommands.push(command.length > 160 ? `${command.slice(0, 157)}...` : command);
        } else if (isShellWrite(command, { ps })) kind = "edit";
        else if (isShellSearch(command, { ps })) {
          kind = "explore";
          shellSearch++;
        }
      }
      if (kind === "edit") edited = true;
      kindOf.set(block.id, { kind, beforeEdit: !edited });
    }
  }
  for (const call of pending.values()) judge(call, undefined, 0);
  tokens.total = tokens.input + tokens.cache_creation + tokens.cache_read + tokens.output;
  const readLike = (byName.Read ?? 0) + (byName.Grep ?? 0) + (byName.Glob ?? 0);
  const total = Object.values(byName).reduce((a, b) => a + b, 0);
  const durationS = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : 0;
  return {
    window: { start, end, duration_s: durationS },
    requests: seenMsg.size,
    tokens,
    ingest,
    tool_calls: { total, by_name: byName, read_like: readLike, shell_search: shellSearch, graft: searchCommands.length, raw_graft: rawGraft },
    graft_commands: searchCommands,
    deviations,
    whole_reads: wholeReads,
  };
}

/** Mode from the blind arm label (`[A]` → on, `[B]` → off); `null` when unlabelled. */
export function modeOf(description) {
  const m = ARM_TAG.exec(String(description ?? "").trim());
  return m ? ARM_MODE[m[1]] : null;
}

/**
 * Run record: transcript metrics + who/what + the coordinator's card. `part` — the k-th subagent of a group that had
 * to be split (one group = one agent; parts are summed by `report`).
 * Violations: any graft use in an OFF run. In an ON run deviations are kept; more than `MAX_DEVIATIONS` make the run
 * non-compliant (reported, not counted in the verdict).
 */
export function buildRun({ change, group, part = null, mode, agent, metrics, card }) {
  const violations = [];
  if (mode === "off" && metrics.tool_calls.graft > 0) violations.push("graft used in an OFF run");
  const { deviations, ...rest } = metrics;
  return {
    format: RUN_FORMAT,
    change,
    group,
    part,
    mode,
    agent,
    ...rest,
    deviations: mode === "on" ? deviations : [],
    compliant: mode !== "on" || deviations.length <= MAX_DEVIATIONS,
    violations,
    card: {
      red_runs: card?.red_runs ?? null,
      helped: card?.helped ?? null,
      misled: card?.misled ?? null,
      notes: card?.notes ?? null,
    },
  };
}

const sumObj = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (a[k] ?? 0) + (b[k] ?? 0)]));

/** Parts of one group (`part` set) → one run: sums, peak = max, deviations concatenated, cards merged. */
export function mergeParts(runs) {
  const byGroup = new Map();
  for (const r of runs) {
    const key = `${r.change}#${r.group}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  return [...byGroup.values()].map((parts) => {
    if (parts.length === 1) return parts[0];
    parts.sort((x, y) => (x.part ?? 0) - (y.part ?? 0));
    const merged = parts.reduce((acc, r) => ({
      ...acc,
      tokens: { ...sumObj(acc.tokens, r.tokens), context_peak: Math.max(acc.tokens.context_peak, r.tokens.context_peak) },
      ingest: sumObj(acc.ingest ?? {}, r.ingest ?? {}),
      whole_reads: sumObj(acc.whole_reads ?? {}, r.whole_reads ?? {}),
      tool_calls: { ...sumObj({ ...acc.tool_calls, by_name: 0 }, { ...r.tool_calls, by_name: 0 }), by_name: sumObj(acc.tool_calls.by_name, r.tool_calls.by_name) },
      window: { start: acc.window.start, end: r.window.end, duration_s: acc.window.duration_s + r.window.duration_s },
      requests: acc.requests + r.requests,
      graft_commands: [...acc.graft_commands, ...r.graft_commands],
      deviations: [...acc.deviations, ...r.deviations],
      violations: [...acc.violations, ...r.violations],
      card: {
        red_runs: (acc.card.red_runs ?? 0) + (r.card.red_runs ?? 0),
        helped: r.card.helped ?? acc.card.helped,
        misled: [acc.card.misled, r.card.misled].filter((m) => m && m !== "none").join("; ") || acc.card.misled || r.card.misled,
        notes: [acc.card.notes, r.card.notes].filter(Boolean).join("; ") || null,
      },
    }));
    return { ...merged, part: null, parts: parts.length, compliant: merged.mode !== "on" || merged.deviations.length <= MAX_DEVIATIONS };
  });
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number");
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarize(runs) {
  return {
    n: runs.length,
    groups: runs.map((r) => `${r.change}#${r.group}`),
    median_explore_bytes: median(runs.map((r) => r.ingest?.explore_bytes)),
    median_explore_before_edit_bytes: median(runs.map((r) => r.ingest?.explore_before_edit_bytes)),
    median_tokens_total: median(runs.map((r) => r.tokens.total)),
    median_tokens_output: median(runs.map((r) => r.tokens.output)),
    median_context_peak: median(runs.map((r) => r.tokens.context_peak)),
    median_tool_calls: median(runs.map((r) => r.tool_calls.total)),
    median_duration_s: median(runs.map((r) => r.window.duration_s)),
    red_runs: runs.reduce((a, r) => a + (r.card.red_runs ?? 0), 0),
    misled: runs.filter((r) => r.card.misled && r.card.misled !== "none").length,
    violations: runs.reduce((a, r) => a + r.violations.length, 0),
    deviations: runs.reduce((a, r) => a + (r.deviations?.length ?? 0), 0),
  };
}

const delta = (on, off) => (on === null || off === null || off === 0 ? null : Math.round(((on - off) / off) * 1000) / 10);

/**
 * Field report (task groups). Informative since ADR-0027 — the verdict comes from the benchmark; the field verdict
 * stays as a cross-check: ≥ 2 counted runs per arm (ON — compliant only), ON median of explore bytes ≥ 20 % lower,
 * no more red runs, no misled run, no violation. A `[B]` run is counted only with no cs / graft call (violation
 * otherwise). `missing` — groups closed in tasks.md without a record (see `closedGroups`).
 */
export function buildReport(records, { minPerMode = 2, threshold = -20, missing = [] } = {}) {
  const runs = mergeParts(records);
  const nonCompliant = runs.filter((r) => r.mode === "on" && r.compliant === false);
  const on = summarize(runs.filter((r) => r.mode === "on" && r.compliant !== false));
  const off = summarize(runs.filter((r) => r.mode === "off" && r.violations.length === 0));
  const baseline = summarize(runs.filter((r) => r.mode === "baseline"));
  const d = {
    explore_bytes_pct: delta(on.median_explore_bytes, off.median_explore_bytes),
    explore_before_edit_pct: delta(on.median_explore_before_edit_bytes, off.median_explore_before_edit_bytes),
    tokens_total_pct: delta(on.median_tokens_total, off.median_tokens_total),
    tool_calls_pct: delta(on.median_tool_calls, off.median_tool_calls),
    duration_pct: delta(on.median_duration_s, off.median_duration_s),
  };
  const reasons = [];
  let verdict;
  if (on.n < minPerMode || off.n < minPerMode) {
    verdict = "insufficient";
    reasons.push(`need ≥ ${minPerMode} counted runs per arm (on=${on.n}, off=${off.n})`);
  } else {
    if (!(d.explore_bytes_pct !== null && d.explore_bytes_pct <= threshold)) reasons.push(`explore bytes ${d.explore_bytes_pct}% is not ≤ ${threshold}%`);
    if (on.red_runs > off.red_runs) reasons.push(`more red runs with graft (${on.red_runs} > ${off.red_runs})`);
    if (on.misled > 0) reasons.push(`graft misled ${on.misled} run(s)`);
    const violations = runs.reduce((a, r) => a + r.violations.length, 0);
    if (violations > 0) reasons.push(`${violations} rule violation(s)`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }
  return {
    format: REPORT_FORMAT,
    verdict,
    reasons,
    delta: d,
    on,
    off,
    baseline,
    non_compliant: nonCompliant.map((r) => ({ group: `${r.change}#${r.group}`, deviations: r.deviations })),
    blind_leak: runs.filter((r) => /blind-leak/.test(r.card.notes ?? "")).map((r) => `${r.change}#${r.group}`),
    missing,
  };
}

/** Numbers of task groups in tasks.md whose every box is ticked (`## N.` headings, `- [x] N.k` lines). */
export function closedGroups(tasksMd) {
  const groups = new Map();
  let current = null;
  for (const line of tasksMd.split(/\r?\n/)) {
    const h = /^##\s+(\d+)\./.exec(line);
    if (h) {
      current = Number(h[1]);
      groups.set(current, { open: 0, done: 0 });
      continue;
    }
    const box = /^\s*-\s+\[( |x)\]/i.exec(line);
    if (box && current !== null) groups.get(current)[box[1] === " " ? "open" : "done"]++;
  }
  return [...groups].filter(([, c]) => c.done > 0 && c.open === 0).map(([n]) => n);
}

/** Subagent transcripts of this project whose Agent description contains `text` (case-insensitive). */
export function findTranscripts(text, { exact = false } = {}) {
  const root = path.join(os.homedir(), ".claude", "projects");
  const hits = [];
  if (!existsSync(root)) return hits;
  const needle = text.toLowerCase();
  for (const project of readdirSync(root)) {
    if (!project.startsWith("D--project-SRA")) continue;
    for (const session of readdirSync(path.join(root, project))) {
      const dir = path.join(root, project, session, "subagents");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".meta.json")) continue;
        const meta = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        const desc = String(meta.description ?? "").toLowerCase().trim();
        if (exact ? desc !== needle : !desc.includes(needle)) continue;
        hits.push({ jsonl: path.join(dir, f.replace(/\.meta\.json$/, ".jsonl")), meta });
      }
    }
  }
  return hits;
}

// ---- code-search benchmark (ADR-0027) ----

/**
 * The agent's answer: the last ```json fenced block (or last bare JSON array) of its last message with one — a text
 * block or the `message` of its hand-back tool call (`SubagentHandback`), whichever comes last.
 */
export function extractAnswer(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== "assistant" || !Array.isArray(rec.message?.content)) continue;
    for (const b of rec.message.content) {
      const body = b.type === "text" ? b.text : b.type === "tool_use" && typeof b.input?.message === "string" ? b.input.message : "";
      if (body.includes("[")) last = body;
    }
  }
  if (last === null) return null;
  const fenced = [...last.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const cand of [...fenced.reverse(), last.slice(last.indexOf("["), last.lastIndexOf("]") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (Array.isArray(v)) return v;
    } catch {
      // next candidate
    }
  }
  return null;
}

const normFile = (f) => {
  const s = String(f ?? "").replace(/\\/g, "/");
  const i = s.indexOf("packages/");
  return i >= 0 ? s.slice(i) : s.replace(/^\.\//, "");
};
const normSymbol = (s) => {
  const v = String(s ?? "").replace(/\(\)$/, "").trim();
  if (v === "(file)" || v === "") return "(file)";
  return v.split(/[.#]/).pop();
};

/** Recall / precision of an answer against the truth: symbol questions by file + symbol, file questions by file. */
export function scoreAnswer(question, answer) {
  const fileLevel = question.level === "file";
  const key = (it) => (fileLevel ? normFile(it.file) : `${normFile(it.file)}::${normSymbol(it.symbol)}`);
  const truth = new Set(question.truth.map(key));
  const given = new Set((Array.isArray(answer) ? answer : []).filter((it) => it && typeof it === "object").map(key));
  const hit = [...given].filter((k) => truth.has(k));
  const truthFiles = new Set(question.truth.map((it) => normFile(it.file)));
  const givenFiles = new Set((Array.isArray(answer) ? answer : []).map((it) => normFile(it?.file)));
  return {
    answered: Array.isArray(answer),
    recall: truth.size ? Math.round((hit.length / truth.size) * 1000) / 1000 : null,
    precision: given.size ? Math.round((hit.length / given.size) * 1000) / 1000 : 0,
    file_recall: Math.round(([...truthFiles].filter((f) => givenFiles.has(f)).length / truthFiles.size) * 1000) / 1000,
    missed: [...truth].filter((k) => !given.has(k)),
    extra: [...given].filter((k) => !truth.has(k)),
  };
}

/**
 * Benchmark verdict (ADR-0027): paired by question. Accept when every question has both arms, the median of
 * per-question ratios explore_bytes[A] / explore_bytes[B] is ≤ 0.8, and mean recall of A is not below B.
 */
export function buildBenchReport(results, questionIds) {
  const pairs = questionIds.map((id) => {
    const a = results.find((r) => r.question === id && r.arm === "A");
    const b = results.find((r) => r.question === id && r.arm === "B");
    return {
      question: id,
      a: a ? { explore_bytes: a.ingest.explore_bytes, tokens: a.tokens.total, tool_calls: a.tool_calls.total, recall: a.score.recall, precision: a.score.precision, cs: a.tool_calls.graft, deviations: a.deviations.length } : null,
      b: b ? { explore_bytes: b.ingest.explore_bytes, tokens: b.tokens.total, tool_calls: b.tool_calls.total, recall: b.score.recall, precision: b.score.precision, cs: b.tool_calls.graft } : null,
      ratio_explore: a && b && b.ingest.explore_bytes > 0 ? Math.round((a.ingest.explore_bytes / b.ingest.explore_bytes) * 1000) / 1000 : null,
      ratio_tokens: a && b && b.tokens.total > 0 ? Math.round((a.tokens.total / b.tokens.total) * 1000) / 1000 : null,
    };
  });
  const complete = pairs.filter((p) => p.a && p.b);
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + (x ?? 0), 0) / xs.length) * 1000) / 1000 : null);
  const summary = {
    pairs: complete.length,
    median_ratio_explore: median(complete.map((p) => p.ratio_explore)),
    median_ratio_tokens: median(complete.map((p) => p.ratio_tokens)),
    mean_recall_a: mean(complete.map((p) => p.a.recall)),
    mean_recall_b: mean(complete.map((p) => p.b.recall)),
    mean_precision_a: mean(complete.map((p) => p.a.precision)),
    mean_precision_b: mean(complete.map((p) => p.b.precision)),
    b_with_cs: complete.filter((p) => p.b.cs > 0).map((p) => p.question),
  };
  const reasons = [];
  let verdict;
  if (complete.length < questionIds.length) {
    verdict = "insufficient";
    reasons.push(`${questionIds.length - complete.length} question(s) without both arms`);
  } else {
    if (!(summary.median_ratio_explore !== null && summary.median_ratio_explore <= 0.8)) reasons.push(`median explore ratio ${summary.median_ratio_explore} is not ≤ 0.8`);
    if (summary.mean_recall_a < summary.mean_recall_b) reasons.push(`recall A ${summary.mean_recall_a} < B ${summary.mean_recall_b}`);
    if (summary.b_with_cs.length > 0) reasons.push(`cs used in [B]: ${summary.b_with_cs.join(", ")}`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }
  return { format: BENCH_REPORT_FORMAT, verdict, reasons, summary, pairs };
}
