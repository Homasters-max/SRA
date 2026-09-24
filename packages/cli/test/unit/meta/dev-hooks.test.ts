/**
 * Form of the WARRANT development hooks (ADR-0029 п. 6, 7, ADR-0031, ADR-0032 п. 11): the committed
 * `.claude/settings.json` holds only `$schema` and `hooks`; the only events are `SubagentStart`, `PreToolUse`,
 * `PostToolUse` and `SessionStart`; every hook command is `node "${CLAUDE_PROJECT_DIR}/scripts/dev/<script>.js" <event>`
 * from the white list — `cs-hook.js` for the first three (code-search), `brief.js` for `SessionStart` (session state,
 * all sources: no matcher). No permissions, no statusline, no graft's own hooks (ADR-0026 п. 2, ADR-0023).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CLI_ROOT } from "../../helpers/cli.js";

const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
const SETTINGS = path.join(REPO_ROOT, ".claude", "settings.json");
const COMMAND = /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/dev\/([a-z-]+\.js)" ([a-z-]+)$/;
/** White list (ADR-0032 п. 11): event → script and its argument. */
const WHITE_LIST: Record<string, { script: string; arg: string }> = {
  SubagentStart: { script: "cs-hook.js", arg: "subagent-start" },
  PreToolUse: { script: "cs-hook.js", arg: "pre-tool" },
  PostToolUse: { script: "cs-hook.js", arg: "post-tool" },
  SessionStart: { script: "brief.js", arg: "session-start" },
};

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as { hooks: Record<string, HookGroup[]> } & Record<string, unknown>;

describe(".claude/settings.json — development hooks only", () => {
  it("has only $schema and hooks", () => {
    expect(Object.keys(settings).sort()).toEqual(["$schema", "hooks"]);
  });

  it("uses only SubagentStart, PreToolUse, PostToolUse and SessionStart", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionStart", "SubagentStart"]);
  });

  it("every hook runs the white-listed scripts/dev script with the event of its section", () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          const m = COMMAND.exec(hook.command);
          expect(m, hook.command).not.toBeNull();
          expect({ script: m?.[1], arg: m?.[2] }, `${event}: ${hook.command}`).toEqual(WHITE_LIST[event]);
          expect(hook.timeout ?? 600).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it("PostToolUse watches only reading and searching tools", () => {
    const matchers = settings.hooks.PostToolUse!.map((g) => g.matcher);
    expect(matchers).toEqual(["Read|Grep|Glob|Bash|PowerShell"]);
  });

  it("PreToolUse (deny, ADR-0031) sees only the tools the detector can flag — not Glob, never Edit or Write", () => {
    const matchers = settings.hooks.PreToolUse!.map((g) => g.matcher);
    expect(matchers).toEqual(["Read|Grep|Bash|PowerShell"]);
  });

  it("SessionStart has no matcher — the state comes back on startup, resume, clear and compact (ADR-0032 п. 4)", () => {
    const groups = settings.hooks.SessionStart!;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.matcher).toBeUndefined();
  });

  it("the hook scripts exist", () => {
    for (const script of ["cs-hook.js", "brief.js"]) {
      expect(existsSync(path.join(REPO_ROOT, "scripts", "dev", script)), script).toBe(true);
    }
  });
});
