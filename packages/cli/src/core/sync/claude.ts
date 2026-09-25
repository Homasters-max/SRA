/**
 * Files of the `claude` frontend `sync` keeps (REQ-KRN-033, ADR-0034 п. 3,
 * design phase-4a §8): the managed subset of `.claude/settings.json` — the
 * static deny of ADR-0014 п. 1 and the hook groups of `warrant guard
 * --frontend claude` (F19) — and the `@AGENTS.md` line of `CLAUDE.md` (F7).
 * The generator is one of the places the frontend name may appear (design §9).
 */
import { canonicalHash } from "../canon/hash.js";
import { canonicalText } from "../canon/format-json.js";
import { cliError } from "../errors.js";
import { isPlainObject } from "../json.js";
import type { Json } from "../schemas/loader.js";
import { driftPath, linesTarget, subsetTarget, type Merged, type OwnEntry, type SubsetTarget } from "./subset.js";

/** Name of this frontend in `frontends[]` of `config/1`. */
export const CLAUDE_FRONTEND = "claude";

export const CLAUDE_SETTINGS_REL = ".claude/settings.json";
export const CLAUDE_MD_REL = "CLAUDE.md";

/** Command of our hooks; a group is ours when one of its hooks runs exactly this. */
export const GUARD_COMMAND = "warrant guard --frontend claude";

/**
 * Paths no agent edits (ADR-0014 п. 1). `/path` anchors a rule of project
 * settings at the project root (I-162); `Edit(…)` covers `Write` too —
 * `Write(…)` path rules do not act (probe of Claude Code 2.1.263, I-165).
 */
const PROTECTED_PATHS = [
  ".warrant/changes/**",
  ".warrant/evidence/**",
  ".warrant/runs/**",
  "openspec/specs/**",
  "openspec/config.yaml",
  "openspec/schemas/**"
];

/** `permissions.deny` entries of ADR-0014 п. 1, in the order `sync` appends them. */
export const CLAUDE_DENY: readonly string[] = [
  ...PROTECTED_PATHS.map((p) => `Edit(/${p})`),
  "Bash(git push origin main:*)",
  "Bash(gh pr merge:*)",
  "Bash(openspec archive:*)"
];

/** Hook event → matcher of our group (F19: `NotebookEdit` edits a file too). */
export const CLAUDE_HOOKS: ReadonlyArray<{ event: string; matcher: string }> = [
  { event: "PreToolUse", matcher: "Edit|Write|NotebookEdit|Bash" },
  { event: "PostToolUse", matcher: "Edit|Write|NotebookEdit" }
];

function guardGroup(matcher: string): Record<string, unknown> {
  return { matcher, hooks: [{ type: "command", command: GUARD_COMMAND }] };
}

/** True for a hook entry that runs our command. */
function isGuardHook(hook: unknown): boolean {
  return isPlainObject(hook) && hook["type"] === "command" && hook["command"] === GUARD_COMMAND;
}

/** True for a group holding at least one of our hooks. */
function isGuardGroup(group: unknown): boolean {
  return isPlainObject(group) && Array.isArray(group["hooks"]) && group["hooks"].some(isGuardHook);
}

type Parsed = { ok: true; doc: Record<string, unknown> } | { ok: false; message: string };

/** The current settings as an object; no file is an empty object. */
function parse(current: Buffer | undefined): Parsed {
  if (current === undefined) return { ok: true, doc: {} };
  let json: unknown;
  try {
    json = JSON.parse(current.toString("utf8"));
  } catch (cause) {
    return { ok: false, message: `${CLAUDE_SETTINGS_REL} is not valid JSON: ${(cause as Error).message}` };
  }
  return isPlainObject(json) ? { ok: true, doc: json } : { ok: false, message: `${CLAUDE_SETTINGS_REL} is not a JSON object` };
}

function own(current: Buffer | undefined): OwnEntry[] {
  const parsed = parse(current);
  if (!parsed.ok) return [{ pointer: "", exact: false }];
  const permissions = parsed.doc["permissions"];
  const deny = isPlainObject(permissions) && Array.isArray(permissions["deny"]) ? permissions["deny"] : [];
  const hooks = isPlainObject(parsed.doc["hooks"]) ? parsed.doc["hooks"] : {};
  const entries: OwnEntry[] = CLAUDE_DENY.map((rule) => ({ pointer: "/permissions/deny", exact: deny.includes(rule) }));
  for (const { event, matcher } of CLAUDE_HOOKS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const ours = groups.filter(isGuardGroup);
    const exact = ours.length === 1 && canonicalHash(ours[0]) === canonicalHash(guardGroup(matcher));
    entries.push({ pointer: `/hooks/${event}`, exact });
  }
  return entries;
}

function refused(pointer: string, message: string): Merged {
  return {
    error: cliError("CONFIG_INVALID", message, {
      path: driftPath(CLAUDE_SETTINGS_REL, pointer),
      hint: `fix ${CLAUDE_SETTINGS_REL} by hand, then run \`warrant sync\``
    })
  };
}

/**
 * Our deny entries appended where missing; in each hook event our hook taken
 * out of every group that holds it (a group left empty is dropped) and our
 * exact group put where the first of them stood, or at the end.
 */
function merge(current: Buffer | undefined): Merged {
  const parsed = parse(current);
  if (!parsed.ok) return refused("", parsed.message);
  const doc = { ...parsed.doc };

  const permissions = doc["permissions"] ?? {};
  if (!isPlainObject(permissions)) return refused("/permissions", "`permissions` is not an object");
  const deny = permissions["deny"] ?? [];
  if (!Array.isArray(deny)) return refused("/permissions/deny", "`permissions.deny` is not an array");
  doc["permissions"] = { ...permissions, deny: [...deny, ...CLAUDE_DENY.filter((rule) => !deny.includes(rule))] };

  const hooks = doc["hooks"] ?? {};
  if (!isPlainObject(hooks)) return refused("/hooks", "`hooks` is not an object");
  const nextHooks: Record<string, unknown> = { ...hooks };
  for (const { event, matcher } of CLAUDE_HOOKS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) return refused(`/hooks/${event}`, `\`hooks.${event}\` is not an array`);
    const next: unknown[] = [];
    let at = -1;
    for (const group of groups) {
      if (!isGuardGroup(group)) {
        next.push(group);
        continue;
      }
      if (at === -1) at = next.length;
      const record = group as Record<string, unknown>;
      const rest = (record["hooks"] as unknown[]).filter((hook) => !isGuardHook(hook));
      if (rest.length > 0) next.push({ ...record, hooks: rest });
    }
    next.splice(at === -1 ? next.length : at, 0, guardGroup(matcher));
    nextHooks[event] = next;
  }
  doc["hooks"] = nextHooks;

  return { bytes: Buffer.from(canonicalText(doc as Json).text, "utf8"), json: doc };
}

/** The managed subset of `.claude/settings.json`, written in canonical JSON. */
export const claudeSettingsTarget: SubsetTarget = subsetTarget({ path: CLAUDE_SETTINGS_REL, own, merge });

/** `CLAUDE.md` imports the generated `AGENTS.md` (F7). */
export const claudeMdTarget: SubsetTarget = linesTarget(CLAUDE_MD_REL, ["@AGENTS.md"]);
