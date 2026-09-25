/**
 * Neutrality of guard (ADR-0034 п. 2, REQ-ENF-005, design phase-4a §9, task
 * 8.1): the name of a frontend — the string `claude`, in any case — stands in
 * `packages/cli/src` only in the adapters (`adapters/frontend/**`), the
 * generator of `sync` (`core/sync/**`) and the table of adapters of
 * `bin/warrant.ts` (its import lines from `adapters/frontend/` and the line
 * `const FRONTENDS`). One place more (I-164): the directory `.claude` of check
 * (6) of `validate` in `core/secrets.ts` — the kernel scans `.claude/**` for
 * secrets (REQ-KRN-021) — and nothing else of that file.
 * Level `unit`: reads files, starts no process.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../helpers/cli.js";

const SRC = path.join(REPO_ROOT, "packages", "cli", "src");
const NAME = /claude/i;

interface Source {
  file: string;
  text: string;
}

function srcSources(dir: string = SRC): Source[] {
  const out: Source[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcSources(full));
    else if (entry.name.endsWith(".ts")) out.push({ file: path.relative(SRC, full).split(path.sep).join("/"), text: readFileSync(full, "utf8") });
  }
  return out;
}

/** True when `line` of `file` may name the frontend. */
function allowed(file: string, line: string): boolean {
  if (file.startsWith("adapters/frontend/") || file.startsWith("core/sync/")) return true;
  if (file === "bin/warrant.ts") return /^import .* from "\.\.\/adapters\/frontend\//.test(line) || /^const FRONTENDS\b/.test(line);
  if (file === "core/secrets.ts") return !NAME.test(line.replace(/\.claude\b/g, ""));
  return false;
}

/** `file:line: text` of every line of `sources` that names the frontend where it may not. */
function frontendNameLeaks(sources: readonly Source[]): string[] {
  const out: string[] = [];
  for (const { file, text } of sources) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (NAME.test(line) && !allowed(file, line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("the frontend name only in the adapter, sync and the adapter table of bin (ADR-0034 п. 2, design §9)", () => {
  it("packages/cli/src names claude nowhere else", () => {
    const sources = srcSources();
    expect(sources.some((s) => s.file === "adapters/frontend/claude.ts")).toBe(true);
    expect(frontendNameLeaks(sources)).toEqual([]);
  });

  it("a line naming the frontend outside those places fails", () => {
    const leaks = frontendNameLeaks([
      { file: "core/guard/guard.ts", text: 'const x = 1;\nif (frontend === "claude") deny();\n' },
      { file: "commands/guard.ts", text: "// Claude Code sends this\n" },
      { file: "bin/warrant.ts", text: 'const FRONTENDS = [claudeFrontend];\nimport { claudeFrontend } from "../adapters/frontend/claude.js";\nhelp("claude");\n' },
      { file: "core/secrets.ts", text: 'export const SECRET_SCAN_DIRS = [".warrant", ".claude"] as const;\nconst CLAUDE = 1;\n' },
      { file: "adapters/frontend/claude.ts", text: 'name: "claude"\n' },
      { file: "core/sync/claude.ts", text: 'export const CLAUDE_FRONTEND = "claude";\n' }
    ]);
    expect(leaks).toEqual([
      'core/guard/guard.ts:2: if (frontend === "claude") deny();',
      "commands/guard.ts:1: // Claude Code sends this",
      'bin/warrant.ts:3: help("claude");',
      "core/secrets.ts:2: const CLAUDE = 1;"
    ]);
  });
});
