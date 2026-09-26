/**
 * Probe of the hooks of Claude Code (ADR-0034 п. 2, design phase-4a §7, task 8.2): `scripts/dev/probe-hooks-lib.js`
 * builds the probe project (recording hooks on Edit|Write|NotebookEdit|Bash, test deny entries), answers the code
 * words of Q1 from the recorder, picks the eight fixtures of the contract from the records and reads Q2, Q3 off the
 * files the scenario left; for the subagent (phase-4b task 6.2) — its file with the recorder as frontmatter hook on
 * Bash, the deny of the marker command, its fixtures and the answers A1–A3.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_BASH_COMMAND,
  AGENT_DENY_COMMAND,
  AGENT_DENY_FILE,
  AGENT_DENY_MARKER,
  AGENT_FIXTURES,
  AGENT_HEREDOC_COMMAND,
  AGENT_NAME,
  agentAnswers,
  agentFile,
  BASH_COMMAND,
  CONTEXT_TRIGGER,
  DENY_RULES,
  DENY_TARGETS,
  FIXTURES,
  MATCHER,
  newProbe,
  NOTEBOOK_FILE,
  NOTES_FILE,
  parseVersion,
  pickAgentFixtures,
  pickFixtures,
  probeAnswers,
  probeSettings,
  readings,
  recordHook,
  recorderSource,
  redacted,
  scenarioPrompt
} from "../../../../../scripts/dev/probe-hooks-lib.js";

const PROBE = { trigger: CONTEXT_TRIGGER, preWord: "pre-aaa", postWord: "post-bbb", denyMarker: AGENT_DENY_MARKER, denyWord: "deny-ccc" };
const ROOT = "D:\\tmp\\probe";
const HOME = "C:\\Users\\me";

function hook(event: string, tool: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: "s1",
    transcript_path: `${HOME}\\.claude\\projects\\p\\s1.jsonl`,
    cwd: ROOT,
    hook_event_name: event,
    tool_name: tool,
    tool_input: toolInput
  };
}

let seq = 0;
function record(json: Record<string, unknown>, source?: string): { name: string; text: string } {
  seq += 1;
  const text = JSON.stringify(json);
  return { name: recordHook(text, PROBE, String(seq).padStart(4, "0"), source).name, text };
}

/** Input of a subagent's Bash call: the main session's fields and those of the subagent. */
function agentHook(event: string, command: string): Record<string, unknown> {
  return { ...hook(event, "Bash", { command }), agent_id: "a-1", agent_type: AGENT_NAME };
}

/**
 * Records of step 7: each of the three calls seen by the frontmatter hook (`agent`) and the hook of settings.json;
 * `ran` — the marker command ran (its PostToolUse recorded), otherwise the plain and heredoc calls only.
 */
function agentScenario(ran: boolean): Array<{ name: string; text: string }> {
  const out = [];
  for (const command of [AGENT_BASH_COMMAND, AGENT_HEREDOC_COMMAND, AGENT_DENY_COMMAND]) {
    out.push(record(agentHook("PreToolUse", command), "agent"), record(agentHook("PreToolUse", command)));
    if (command !== AGENT_DENY_COMMAND || ran) out.push(record(agentHook("PostToolUse", command)));
  }
  return out;
}

/** The records of a full scenario: steps 1–5, then Write of every deny target seen by `pre` only. */
function scenario(): Array<{ name: string; text: string }> {
  const out = [];
  for (const event of ["PreToolUse", "PostToolUse"]) out.push(record(hook(event, "Write", { file_path: `${ROOT}\\notes\\a.txt`, content: "one" })));
  for (const event of ["PreToolUse", "PostToolUse"]) out.push(record(hook(event, "Edit", { file_path: `${ROOT}\\notes\\a.txt`, old_string: "one", new_string: "two" })));
  for (const event of ["PreToolUse", "PostToolUse"]) out.push(record(hook(event, "NotebookEdit", { notebook_path: `${ROOT}\\${NOTEBOOK_FILE}`, new_source: "print(2)" })));
  for (const event of ["PreToolUse", "PostToolUse"]) out.push(record(hook(event, "Bash", { command: BASH_COMMAND })));
  for (const event of ["PreToolUse", "PostToolUse"]) out.push(record(hook(event, "Bash", { command: `echo ${CONTEXT_TRIGGER}` })));
  for (const t of DENY_TARGETS) out.push(record(hook("PreToolUse", "Write", { file_path: `${ROOT}\\${t.path.split("/").join("\\")}`, content: "x" })));
  return out;
}

describe("probe-hooks — the probe project (ADR-0034 п. 2)", () => {
  it("settings: the recorder on PreToolUse and PostToolUse with the matcher of F19, the test deny entries, echo allowed", () => {
    const settings = probeSettings("D:/tmp/probe/.probe/recorder.mjs");
    const group = { matcher: "Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: 'node "D:/tmp/probe/.probe/recorder.mjs"' }] };
    expect(MATCHER).toBe(group.matcher);
    expect(settings).toEqual({ permissions: { allow: ["Bash(echo:*)"], deny: DENY_RULES }, hooks: { PreToolUse: [group], PostToolUse: [group] } });
    expect(DENY_RULES).toEqual(["Edit(/probe-deny/anchored/**)", "Edit(probe-deny/relative/**)", "Write(/probe-deny/write-rule/**)"]);
  });

  it("the probe has fresh code words; the prompt names every step of the fixtures and every deny target", () => {
    const probe = newProbe(() => 0.123456789);
    expect(probe).toEqual({
      trigger: CONTEXT_TRIGGER,
      preWord: expect.stringMatching(/^pre-\w+$/),
      postWord: expect.stringMatching(/^post-\w+$/),
      denyMarker: AGENT_DENY_MARKER,
      denyWord: expect.stringMatching(/^deny-\w+$/)
    });
    const prompt = scenarioPrompt();
    for (const text of [NOTES_FILE, NOTEBOOK_FILE, BASH_COMMAND, `echo ${CONTEXT_TRIGGER}`, "probe-hooks code word", ...DENY_TARGETS.map((t) => t.path), AGENT_NAME, "probe-hooks agent deny", AGENT_DENY_FILE]) {
      expect(prompt).toContain(text);
    }
  });

  it("parses the version of claude --version", () => {
    expect(parseVersion("2.1.263 (Claude Code)\n")).toBe("2.1.263");
    expect(parseVersion("claude: command not found")).toBeUndefined();
  });
});

describe("probe-hooks — the recorder", () => {
  it("names a record by stamp, event and tool; answers only the Bash call of the trigger, a code word per event", () => {
    expect(recordHook(JSON.stringify(hook("PreToolUse", "Edit", { file_path: "a" })), PROBE, "0001")).toEqual({ name: "0001-PreToolUse-Edit.json", stdout: "" });
    const pre = recordHook(JSON.stringify(hook("PreToolUse", "Bash", { command: "echo probe-context" })), PROBE, "0002");
    expect(pre.name).toBe("0002-PreToolUse-Bash-ctx.json");
    expect(JSON.parse(pre.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "probe-hooks code word: pre-aaa" } });
    expect(pre.stdout).not.toContain("permissionDecision");
    const post = recordHook(JSON.stringify(hook("PostToolUse", "Bash", { command: "echo probe-context" })), PROBE, "0003");
    expect(JSON.parse(post.stdout).hookSpecificOutput.additionalContext).toBe("probe-hooks code word: post-bbb");
    expect(recordHook("not json", PROBE, "0004")).toEqual({ name: "0004-unknown-unknown.json", stdout: "" });
    expect(recordHook(JSON.stringify({ hook_event_name: "../x", tool_name: "a/b" }), PROBE, "0005").name).toBe("0005-unknown-unknown.json");
  });

  it("the recorder source carries the probe and recordHook itself", () => {
    const source = recorderSource(PROBE);
    expect(source).toContain(`const probe = ${JSON.stringify(PROBE)};`);
    expect(source).toContain(`const recordHook = ${recordHook.toString()};`);
    expect(source).toContain('writeFileSync(path.join(dir, "records", name), input);');
  });
});

describe("probe-hooks — collect", () => {
  it("picks the eight fixtures from the scenario calls, transcript_path under ~, the rest as recorded", () => {
    const { fixtures, missing } = pickFixtures(scenario(), HOME);
    expect(missing).toEqual([]);
    expect(fixtures.map((f) => f.file)).toEqual(FIXTURES.map((f) => f.file));
    const preWrite = JSON.parse(fixtures.find((f) => f.file === "pre-write.json")!.text);
    expect(preWrite).toEqual({ ...hook("PreToolUse", "Write", { file_path: `${ROOT}\\notes\\a.txt`, content: "one" }), transcript_path: "~\\.claude\\projects\\p\\s1.jsonl" });
    const bash = JSON.parse(fixtures.find((f) => f.file === "post-bash.json")!.text);
    expect(bash.tool_input.command).toBe(BASH_COMMAND);
  });

  it("the home directory is ~ in every string value: either slash, any case of the drive and the profile, at any depth", () => {
    const json = {
      transcript_path: `${HOME}\\.claude\\projects\\p\\s1.jsonl`,
      scratchpad_dir: "c:\\users\\ME\\AppData\\Local\\Temp\\s1\\scratchpad",
      tool_input: { command: "ls C:/Users/me/x && ls C:/Users/meme", list: ["C:\\Users\\me"] },
      effort: { level: "high" },
      n: 1
    };
    expect(redacted(json, HOME)).toEqual({
      transcript_path: "~\\.claude\\projects\\p\\s1.jsonl",
      scratchpad_dir: "~\\AppData\\Local\\Temp\\s1\\scratchpad",
      tool_input: { command: "ls ~/x && ls C:/Users/meme", list: ["~"] },
      effort: { level: "high" },
      n: 1
    });
    expect(redacted(json, "")).toBe(json);
  });

  it("names the fixtures the records lack", () => {
    const records = scenario().filter((r) => !r.name.includes("NotebookEdit"));
    expect(pickFixtures(records, HOME).missing).toEqual(["pre-notebook-edit.json", "post-notebook-edit.json"]);
  });

  it("answers Q1 by the words sent and Q2, Q3 by the files left", () => {
    const written = new Set(["sub/probe-deny/anchored/a.txt", ".claude/probe-deny/anchored/a.txt", "probe-deny/write-rule/a.txt"]);
    const answers = probeAnswers(scenario(), (p: string) => written.has(p), PROBE);
    expect(answers.q1).toEqual({ preSent: true, postSent: true, preWord: "pre-aaa", postWord: "post-bbb" });
    expect(answers.targets.map((t: { path: string; pre: boolean; post: boolean; verdict: string }) => [t.path, t.pre, t.post, t.verdict])).toEqual([
      ["probe-deny/anchored/a.txt", true, false, "not written"],
      ["sub/probe-deny/anchored/a.txt", true, false, "written"],
      [".claude/probe-deny/anchored/a.txt", true, false, "written"],
      ["probe-deny/relative/a.txt", true, false, "not written"],
      ["sub/probe-deny/relative/a.txt", true, false, "not written"],
      ["probe-deny/write-rule/a.txt", true, false, "written"]
    ]);
    expect(readings(answers)).toEqual({
      q2Anchor: "Edit(/…) is anchored at the project root (the directory claude started in)",
      q2Relative: "Edit(path) without / matches at any depth",
      q3: "Write(/…) does not act: the file was written"
    });
  });
});

describe("probe-hooks — the subagent (phase-4b task 6.2, ADR-0034 п. 10)", () => {
  it("the subagent file: read-only tools and Bash, the recorder with `agent` as PreToolUse hook on Bash, the three calls", () => {
    const text = agentFile("D:/tmp/probe/.probe/recorder.mjs");
    expect(text.startsWith(`---\nname: ${AGENT_NAME}\n`)).toBe(true);
    expect(text).toContain("\ntools: Read, Grep, Glob, Bash\n");
    expect(text).toContain(
      "hooks:\n  PreToolUse:\n    - matcher: \"Bash\"\n      hooks:\n        - type: command\n          command: 'node \"D:/tmp/probe/.probe/recorder.mjs\" agent'\n---\n"
    );
    for (const command of [AGENT_BASH_COMMAND, `\`\`\`bash\n${AGENT_HEREDOC_COMMAND}\n\`\`\``, AGENT_DENY_COMMAND]) expect(text).toContain(command);
    expect(agentFile("D:/it's/recorder.mjs")).toContain("command: 'node \"D:/it''s/recorder.mjs\" agent'");
  });

  it("the recorder with `agent` denies only the PreToolUse of the marker command, with the code word as reason", () => {
    const deny = recordHook(JSON.stringify(agentHook("PreToolUse", AGENT_DENY_COMMAND)), PROBE, "0001", "agent");
    expect(deny.name).toBe("0001-agent-PreToolUse-Bash-deny.json");
    expect(JSON.parse(deny.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "probe-hooks agent deny: deny-ccc" }
    });
    expect(recordHook(JSON.stringify(agentHook("PreToolUse", AGENT_BASH_COMMAND)), PROBE, "0002", "agent")).toEqual({ name: "0002-agent-PreToolUse-Bash.json", stdout: "" });
    // The hook of settings.json neither denies the marker nor answers for the subagent's hook with a code word.
    expect(recordHook(JSON.stringify(agentHook("PreToolUse", AGENT_DENY_COMMAND)), PROBE, "0003")).toEqual({ name: "0003-PreToolUse-Bash.json", stdout: "" });
    expect(recordHook(JSON.stringify(hook("PreToolUse", "Bash", { command: `echo ${CONTEXT_TRIGGER}` })), PROBE, "0004", "agent").stdout).toBe("");
    // A probe.json of an earlier setup has no marker: nothing is denied.
    const old = { trigger: CONTEXT_TRIGGER, preWord: "pre-aaa", postWord: "post-bbb" };
    expect(recordHook(JSON.stringify(agentHook("PreToolUse", AGENT_DENY_COMMAND)), old, "0005", "agent").stdout).toBe("");
  });

  it("picks the agent fixtures by hook, leaves them out of the main ones, and names those absent", () => {
    const records = [...scenario(), ...agentScenario(false)];
    expect(pickFixtures(records, HOME).fixtures.map((f) => f.file)).toEqual(FIXTURES.map((f) => f.file));
    const { fixtures, absent } = pickAgentFixtures(records, HOME);
    expect(absent).toEqual([]);
    expect(fixtures.map((f) => f.file)).toEqual(AGENT_FIXTURES.map((f) => f.file));
    const heredoc = JSON.parse(fixtures.find((f) => f.file === "agent-pre-bash-heredoc.json")!.text);
    expect(heredoc).toEqual({ ...agentHook("PreToolUse", AGENT_HEREDOC_COMMAND), transcript_path: "~\\.claude\\projects\\p\\s1.jsonl" });
    const onlySession = records.filter((r) => !r.name.includes("-agent-"));
    expect(pickAgentFixtures(onlySession, HOME).absent).toEqual(["agent-pre-bash.json", "agent-pre-bash-heredoc.json", "agent-pre-bash-deny.json"]);
  });

  it("A1–A3: which hook saw each call, whether the deny acted, how the input differs from the main session's", () => {
    const acted = agentAnswers([...scenario(), ...agentScenario(false)], () => false);
    expect(acted.steps).toEqual([
      { step: "plain", frontmatterPre: true, sessionPre: true, sessionPost: true },
      { step: "heredoc", frontmatterPre: true, sessionPre: true, sessionPost: true },
      { step: "marker", frontmatterPre: true, sessionPre: true, sessionPost: false }
    ]);
    expect(acted.deny).toBe("deny acted: the marker command did not run");
    expect(acted.frontmatterVsMain).toEqual({ onlyOther: ["agent_id", "agent_type"], onlyMain: [], agentFields: { agent_id: "a-1", agent_type: AGENT_NAME } });
    expect(acted.sessionVsMain).toEqual(acted.frontmatterVsMain);
    expect(acted.heredocCommand).toBe(AGENT_HEREDOC_COMMAND);

    expect(agentAnswers([...scenario(), ...agentScenario(true)], () => false).deny).toBe("deny did NOT act: the marker command ran (PostToolUse seen)");
    expect(agentAnswers([...scenario(), ...agentScenario(false)], (p: string) => p === AGENT_DENY_FILE).deny).toBe(
      `deny did NOT act: the marker command ran (${AGENT_DENY_FILE} written)`
    );
    const noFrontmatter = [...scenario(), ...agentScenario(true).filter((r) => !r.name.includes("-agent-"))];
    const none = agentAnswers(noFrontmatter, () => true);
    expect(none.steps.map((s: { frontmatterPre: boolean }) => s.frontmatterPre)).toEqual([false, false, false]);
    expect(none.deny).toBe("no deny sent: the frontmatter hook was not called on the marker command");
    expect(none.frontmatterVsMain).toBeUndefined();
    expect(agentAnswers(scenario(), () => false).deny).toBe("not tried: no hook saw the marker command (step 7 not done?)");
  });
});
