/**
 * Form of the WARRANT development hooks (ADR-0029 п. 6, 7, ADR-0031): the committed `.claude/settings.json` holds only
 * `$schema` and `hooks`; the only events are `SubagentStart`, `PreToolUse` and `PostToolUse`; every hook command is
 * `node "${CLAUDE_PROJECT_DIR}/scripts/dev/cs-hook.js" <event>` with an event the script handles. No permissions, no
 * statusline, no graft's own hooks (ADR-0026 п. 2, ADR-0023).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CLI_ROOT } from "../../helpers/cli.js";

const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
const SETTINGS = path.join(REPO_ROOT, ".claude", "settings.json");
const COMMAND = /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/dev\/cs-hook\.js" (subagent-start|pre-tool|post-tool)$/;
const EVENT_ARG: Record<string, string> = { SubagentStart: "subagent-start", PreToolUse: "pre-tool", PostToolUse: "post-tool" };

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as { hooks: Record<string, HookGroup[]> } & Record<string, unknown>;

describe(".claude/settings.json — development hooks only", () => {
  it("has only $schema and hooks", () => {
    expect(Object.keys(settings).sort()).toEqual(["$schema", "hooks"]);
  });

  it("uses only SubagentStart, PreToolUse and PostToolUse", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SubagentStart"]);
  });

  it("every hook runs scripts/dev/cs-hook.js with the event of its section", () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          const m = COMMAND.exec(hook.command);
          expect(m, hook.command).not.toBeNull();
          expect(m?.[1]).toBe(EVENT_ARG[event]);
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

  it("the hook script exists", () => {
    expect(existsSync(path.join(REPO_ROOT, "scripts", "dev", "cs-hook.js"))).toBe(true);
  });
});
