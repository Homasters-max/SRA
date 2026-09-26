/**
 * `warrant run submit` (REQ-ENF-007, ADR-0034 п. 10, ADR-0036 п. 4, design
 * §4): the envelope `warrant://skill-result/1` of the active `review` Run
 * becomes three writes of one plan — the envelope beside the Run
 * (`<state>/runs/<RUN>.result.json`, committed with it), an evidence record
 * `kind: review` and the finished Run (`finishRun`).
 *
 * The skill reports only `run_state` and findings (07 §4); the status of the
 * record is the CLI's (N22): `SUCCEEDED` without a `BLOCKER` — `PROVEN`, a
 * `BLOCKER` — `NOT_PROVEN`, `FAILED` / `CANCELLED` — `INCONCLUSIVE`. The
 * record is judged by the spec tree the Run read (`subject.spec_tree`), not by
 * `base_commit`, and is attested by nobody (`attestation: none`, limitations
 * of ADR-0034 п. 10).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { canonicalText, writeJsonFile } from "../canon/format-json.js";
import { bytesHash } from "../canon/hash.js";
import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import { buildEvidenceRecord, evidenceSubject, NO_GIT_COMMIT, NO_GIT_LIMITATION, type EvidenceStatus } from "../evidence/record.js";
import { evidenceDir, MANIFEST_FILE } from "../evidence/store.js";
import { manifestVersions, storeRecord } from "../evidence/write.js";
import { projectUri, readJson } from "../fs.js";
import { allocateUlid } from "../ids/allocate.js";
import { isPlainObject } from "../json.js";
import { LOCK_REL } from "../packs/hash.js";
import { loadPacks } from "../packs/loader.js";
import { packSkills } from "../packs/objects.js";
import type { Json } from "../schemas/loader.js";
import { validateFile } from "../schemas/semantic.js";
import { versionSatisfies } from "../version-range.js";
import { finishRun, requireActiveRun } from "./lifecycle.js";
import { RESULT_SUFFIX, runFile, runsDir } from "./store.js";
import type { Run, RunState } from "./types.js";

/** `severity` of a finding (07 §4); the schema `skill-result/1` and the metrics of kind `review` hold the same values. */
export const SEVERITIES = ["BLOCKER", "MAJOR", "MINOR", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type SeverityCounts = Record<Severity, number>;

/** What a review record does not prove (ADR-0034 п. 10). */
export const REVIEW_LIMITATIONS: readonly string[] = ["produced locally, unattested", "same model family as author"];

/** Evidence kind and level of a review (REQ-ENF-007). */
export const REVIEW_KIND = "review";
export const REVIEW_LEVEL = "L2";

const SCHEMA = "warrant://skill-result/1";

/** The fields of an envelope `submit` reads; the schema holds the rest. */
export interface Envelope {
  $schema: typeof SCHEMA;
  skill: string;
  run: string;
  run_state: Exclude<RunState, "QUEUED" | "RUNNING">;
  findings: { severity: Severity }[];
  provenance: { model?: string };
}

/** The envelope as text and where it came from: the path of `--file`, or none for stdin. */
export interface SubmitInput {
  text: string;
  source?: string | undefined;
}

export interface Submitted {
  run: string;
  change: string;
  evidence: string;
  status: EvidenceStatus;
  findings: SeverityCounts;
}

/** Findings by `severity`, every severity present. */
export function severityCounts(findings: readonly { severity: Severity }[]): SeverityCounts {
  const counts: SeverityCounts = { BLOCKER: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** The status of the review record (N22, ADR-0036 п. 4). */
export function reviewStatus(runState: Envelope["run_state"], counts: SeverityCounts): EvidenceStatus {
  if (runState !== "SUCCEEDED") return "INCONCLUSIVE";
  return counts.BLOCKER > 0 ? "NOT_PROVEN" : "PROVEN";
}

const FIX_HINT = "fix the envelope (warrant://skill-result/1, docs/07-skills.md §4) and run `warrant run submit` again";

function invalid(message: string, pointer: string, source: string | undefined, hint = FIX_HINT): WarrantError {
  const where = source === undefined ? pointer : `${source}#${pointer}`;
  return new WarrantError("SKILL_RESULT_INVALID", message, { ...(where === "" ? {} : { path: where }), hint });
}

/** The envelope of `input`, valid against `warrant://skill-result/1`; `SKILL_RESULT_INVALID` with the JSON Pointer otherwise. */
export function parseEnvelope(input: SubmitInput): Envelope {
  const { text, source } = input;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw invalid(`the envelope is not JSON: ${(cause as Error).message}`, "", source);
  }
  if (!isPlainObject(json)) throw invalid("the envelope is not a JSON object", "", source);
  if (json["$schema"] !== SCHEMA) throw invalid(`$schema must be ${SCHEMA}`, "/$schema", source);
  const checked = validateFile(json as Json, source);
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    const more = checked.errors.length > 1 ? ` (and ${checked.errors.length - 1} more)` : "";
    throw new WarrantError("SKILL_RESULT_INVALID", `${first.message}${more}`, { ...(first.path === undefined ? {} : { path: first.path }), hint: FIX_HINT });
  }
  return json as unknown as Envelope;
}

/** `skill` of the envelope names a skill of an enabled pack that the lock holds, at a version in the pack's range. */
function checkSkill(root: string, skill: string, source: string | undefined): void {
  const loaded = loadPacks(root);
  const first = loaded.errors[0];
  if (first !== undefined) throw new WarrantError(first.code, `the policy does not load: ${first.message}`, { ...(first.path === undefined ? {} : { path: first.path }), hint: "run `warrant validate`" });
  const lock = readJson(path.join(root, ...LOCK_REL.split("/")), LOCK_REL, []);
  const locked = isPlainObject(lock) && isPlainObject(lock["skills"]) ? lock["skills"] : {};
  const skills = packSkills(loaded).filter((s) => locked[s.name] !== undefined);
  const expected = skills.map((s) => `${s.name}@${s.range}`).join(" or ");
  const at = skill.lastIndexOf("@");
  const name = skill.slice(0, at);
  const version = skill.slice(at + 1);
  const declared = skills.find((s) => s.name === name);
  if (declared === undefined) {
    throw invalid(
      `skill ${skill} is not a skill of the enabled packs in ${LOCK_REL}${expected === "" ? "" : `: expected ${expected}`}`,
      "/skill",
      source,
      expected === "" ? "declare the review skill in a pack and run `warrant sync`" : `run the review skill ${expected} and name it in "skill"`
    );
  }
  if (!versionSatisfies(version, declared.range)) {
    throw invalid(`skill ${skill}: version ${version} is outside ${declared.range} of pack ${declared.pack}`, "/skill", source, `run the review skill ${expected} and name it in "skill"`);
  }
}

/**
 * Takes the envelope of the active `review` Run: no active Run —
 * `RUN_NOT_ACTIVE`; a Run of another operation — `STATE_INVALID`; an envelope
 * off its schema, of another Run or of another skill — `SKILL_RESULT_INVALID`.
 * Nothing is written before every check passed; the writes are one plan
 * `[result, evidence, manifest, Run, current]` (`ctx.writes`, `--dry-run`).
 */
export async function submitReview(ctx: Ctx, read: () => Promise<SubmitInput>, env: NodeJS.ProcessEnv): Promise<Submitted> {
  const { root } = ctx;
  const { id, run } = requireActiveRun(root, env);
  if (run.operation !== "review") {
    throw new WarrantError("STATE_INVALID", `the active Run ${id} of ${run.change} is ${run.operation}: only a review Run takes a submitted result`, {
      path: projectUri(root, runFile(root, id, env)),
      hint: "end it with `warrant run finish`, then `warrant run start <change> --operation review`"
    });
  }
  const input = await read();
  const envelope = parseEnvelope(input);
  if (envelope.run !== id) {
    throw invalid(`the envelope is of ${envelope.run}, the active Run is ${id}`, "/run", input.source, `set "run": "${id}" — the result of another Run is not this review`);
  }
  checkSkill(root, envelope.skill, input.source);

  const findings = severityCounts(envelope.findings);
  const status = reviewStatus(envelope.run_state, findings);
  const resultFile = path.join(runsDir(root, env), `${id}${RESULT_SUFFIX}`);
  const resultUri = projectUri(root, resultFile);
  const head = await ctx.git.head();
  const commit = head ?? NO_GIT_COMMIT;
  const evidence = allocateUlid("EVID");
  const at = envelope.skill.lastIndexOf("@");
  const record = buildEvidenceRecord({
    id: evidence,
    kind: REVIEW_KIND,
    level: REVIEW_LEVEL,
    status,
    subject: evidenceSubject({ change: run.change, commit, specTree: run.spec_tree }),
    claim: `${envelope.skill} reviewed the spec of ${run.change}: ${findings.BLOCKER} BLOCKER, ${findings.MAJOR} MAJOR, ${findings.MINOR} MINOR, ${findings.INFO} INFO`,
    producedBy: { type: "skill", id: envelope.skill.slice(0, at), version: envelope.skill.slice(at + 1), run: id },
    attestation: { type: "none" },
    contextHash: run.context_hash,
    effectivePolicyHash: run.effective_policy_hash,
    createdAt: new Date().toISOString(),
    artifacts: [{ uri: resultUri, sha256: bytesHash(canonicalText(envelope as unknown as Json).text) }],
    limitations: [...(head === null ? [NO_GIT_LIMITATION] : []), ...REVIEW_LIMITATIONS],
    metrics: { ...findings }
  });
  const dir = evidenceDir(root, run.change, env);
  const checked = validateFile(record as Json, projectUri(root, path.join(dir, `${evidence}.json`)));
  if (!checked.ok) throw new WarrantError("INTERNAL", `the review record would not match its schema: ${checked.errors[0]?.message ?? ""}`);
  const versions = await manifestVersions(ctx, run.effective_policy_hash);

  await finishRun(ctx, envelope.run_state, env, {
    targets: [resultUri, projectUri(root, path.join(dir, `${evidence}.json`)), projectUri(root, path.join(dir, MANIFEST_FILE))],
    write: () => {
      mkdirSync(path.dirname(resultFile), { recursive: true });
      writeJsonFile(resultFile, envelope as unknown as Json);
      storeRecord({ root, writes: ctx.writes, change: run.change, env, record, commit, versions, what: `review of ${run.change}` });
    },
    fields: (now: Run) => ({
      evidence: [...(now.evidence ?? []), evidence],
      skill: envelope.skill,
      ...(typeof envelope.provenance.model === "string" && envelope.provenance.model !== "" ? { model: envelope.provenance.model } : {})
    })
  });
  return { run: id, change: run.change, evidence, status, findings };
}
