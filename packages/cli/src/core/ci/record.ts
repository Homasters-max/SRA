/**
 * The structure of the record a pull request presents (REQ-VER-011 «Record»,
 * N44 narrowed, design §4 of phase-4c): the new transitions — those the record
 * of the base does not hold — extend it along the chain of 04 §2, carry the
 * policy hash and passing verdicts, name evidence files valid on HEAD; a frozen
 * record does not change; the classification is not weaker than the base and
 * than what `classify` by the base derives from the diff (I-171); a new
 * `MERGED` holds the policy of the base and CI evidence behind its gates (I-172);
 * from `SPECIFIED` of the base on, no UNKNOWN of the base is removed or
 * weakened (I-188); a recorded `WAIVED` or `NOT_APPLICABLE` has its ground
 * (design D4 of agent-merge).
 * What each rule requires comes from the base; no verdict is computed again.
 */
import { canonicalHash } from "../canon/hash.js";
import { checksForTransition } from "../check/execute.js";
import type { Ctx } from "../ctx.js";
import { cliError, type CliError } from "../errors.js";
import { attestationOf } from "../evidence/attestation.js";
import { subjectOf } from "../evidence/record.js";
import { evidenceRel } from "../evidence/store.js";
import { isPlainObject, strings } from "../json.js";
import { appliesTo, appliesWhenPaths, countingWaiver } from "../gates/predicates.js";
import { PASSING_VERDICTS, MERGE_TRANSITION, type Verdict } from "../gates/types.js";
import { requirementsOf, satisfies } from "../gates/verdict.js";
import type { DiffEntry } from "../ports/git.js";
import { effectiveCheck, FACTORY_PROFILE, gateDefinitions } from "../packs/objects.js";
import { isFrozen, isMergeKind, transitionKind, UNKNOWNS_HELD_STATES } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";
import { recordPath } from "../record/write.js";
import { RISK_LEVELS } from "../resolve/index.js";
import { roleMembers } from "../roles.js";
import { ownState } from "../run/state.js";
import { validateFile } from "../schemas/semantic.js";
import type { Json } from "../schemas/loader.js";
import { isClosed, unknownsOf } from "../unknowns/state.js";
import { readWaivers, type WaiverInput } from "../waivers/read.js";
import { basePolicy, changedBundledPacks, requiredProfiles, type BaseContext } from "./base.js";
import { jsonAt, type CiSubject } from "./kind.js";
import { mergeDiff, type MergeCommit } from "./merge.js";
import { mergeOfMerged } from "./refs.js";

/** Schema every evidence record of a transition must be valid by. */
const EVIDENCE_SCHEMA = "warrant://evidence/1";

/** One transition of the record on HEAD that the record of the base does not hold. */
export interface NewTransition {
  /** Index in `transitions[]` of the record on HEAD. */
  index: number;
  /** `change_state` before it; undefined for the first transition of a new record. */
  from: string | undefined;
  to: string;
  entry: Record<string, unknown>;
}

export interface RecordJudgement {
  transitions: NewTransition[];
  /** Evidence records named by the new transitions, as HEAD holds them (valid or not), by id. */
  evidence: Map<string, Record<string, unknown>>;
  errors: CliError[];
}

/** The reasons of `RECORD_MISMATCH` (REQ-VER-011). */
export type MismatchReason =
  | "prefix"
  | "change_state"
  | "chain"
  | "effective_policy_hash"
  | "gates"
  | "evidence"
  | "frozen"
  | "classification"
  | "policy"
  | "ci_evidence"
  | "unknowns"
  | "waiver"
  | "not_applicable";

function transitionsOf(record: ChangeRecord | undefined): Record<string, unknown>[] {
  const list = record?.["transitions"];
  return Array.isArray(list) ? list.filter(isPlainObject) : [];
}

function mismatch(change: string, where: string, reason: MismatchReason, detail: string, pointer = ""): CliError {
  return cliError("RECORD_MISMATCH", `${where}: ${reason}: ${detail}`, { path: `${recordPath(change)}${pointer}` });
}

function label(t: NewTransition): string {
  return `transition ${t.index} (${t.from ?? "none"} -> ${t.to})`;
}

/**
 * The new transitions: the suffix of `transitions[]` on HEAD after the prefix
 * the base holds. A HEAD that does not start with the transitions of the base
 * yields none and a `prefix` mismatch.
 */
export function newTransitions(change: string, head: ChangeRecord, base: ChangeRecord | undefined): { transitions: NewTransition[]; errors: CliError[] } {
  const before = transitionsOf(base);
  const after = transitionsOf(head);
  const errors: CliError[] = [];
  const kept = before.length <= after.length && before.every((entry, i) => canonicalHash(entry) === canonicalHash(after[i]));
  if (!kept) {
    errors.push(mismatch(change, "transitions", "prefix", `transitions[] on HEAD do not start with the ${before.length} transitions of the record of the base`, "#/transitions"));
    return { transitions: [], errors };
  }
  const transitions: NewTransition[] = [];
  let from = typeof base?.["change_state"] === "string" ? base["change_state"] : undefined;
  for (let index = before.length; index < after.length; index += 1) {
    const entry = after[index] as Record<string, unknown>;
    const to = typeof entry["to"] === "string" ? entry["to"] : "";
    transitions.push({ index, from, to, entry });
    from = to;
  }
  return { transitions, errors };
}

/** Kinds that the checks of `VERIFYING->MERGED` of `policy` produce, by the packs of the base. */
function checkKinds(base: BaseContext, policy: Parameters<typeof checksForTransition>[1]): Set<string> {
  return new Set(checksForTransition(base.loaded, policy, MERGE_TRANSITION).flatMap((o) => strings(effectiveCheck(o)["produces"])));
}


/** Rules of a new `MERGED` (I-172): the policy of the base, CI evidence behind the gates that checks feed. */
function mergedRules(
  change: string,
  t: NewTransition,
  head: ChangeRecord,
  base: BaseContext,
  evidence: Map<string, Record<string, unknown>>
): CliError[] {
  const resolved = basePolicy(base, change, head);
  if (!resolved.ok) {
    const detail = resolved.conflict ? resolved.error.message : resolved.errors.map((e) => e.message).join("; ");
    return [mismatch(change, label(t), "policy", `the policy of the classification on HEAD by the packs of the base cannot be composed: ${detail}`)];
  }
  const policy = resolved.policy;
  const gates = isPlainObject(t.entry["gates"]) ? t.entry["gates"] : {};
  const errors: CliError[] = [];
  const expected = [...(policy.gates[MERGE_TRANSITION] ?? [])].sort();
  const recorded = Object.keys(gates).sort();
  if (t.entry["effective_policy_hash"] !== policy.hash) {
    errors.push(
      mismatch(change, label(t), "policy", `effective_policy_hash ${String(t.entry["effective_policy_hash"])} is not ${policy.hash}, the policy of the base for the classification on HEAD`, `#/transitions/${t.index}/effective_policy_hash`)
    );
  } else if (canonicalHash(expected) !== canonicalHash(recorded)) {
    errors.push(
      mismatch(change, label(t), "policy", `gates {${recorded.join(", ")}} are not the gates of ${MERGE_TRANSITION} of the policy of the base {${expected.join(", ")}}`, `#/transitions/${t.index}/gates`)
    );
  }
  const produced = checkKinds(base, policy);
  const ids = strings(t.entry["evidence"]);
  const definitions = gateDefinitions(base.loaded);
  for (const [gate, verdict] of Object.entries(gates)) {
    if (verdict !== "PASS") continue;
    // A requirement with `check` is backed only by a CI record of that check (ADR-0044 п. 6, I-205).
    for (const requirement of requirementsOf(definitions.get(gate)).filter((r) => produced.has(r.kind))) {
      const backed = ids.some((id) => {
        const json = evidence.get(id);
        return json !== undefined && satisfies(requirement, { id, json }) && attestationOf(json).type === "ci";
      });
      if (!backed) {
        const what = `${requirement.kind} record${requirement.check === undefined ? "" : ` of check ${requirement.check}`}`;
        errors.push(
          mismatch(change, label(t), "ci_evidence", `gate ${gate} is PASS, but evidence[] holds no ${what} with attestation.type "ci"`, `#/transitions/${t.index}/evidence`)
        );
      }
    }
  }
  return errors;
}

/** Rule `classification` (SCN-VER-105, SCN-VER-107): kinds impl, archive and abandon. */
function classificationRule(
  ctx: Pick<Ctx, "root">,
  subject: CiSubject,
  change: string,
  head: ChangeRecord,
  base: BaseContext,
  env: NodeJS.ProcessEnv
): CliError[] {
  const changed = subject.diff.flatMap((e) => (e.from === undefined ? [e.path] : [e.path, e.from]));
  const required = requiredProfiles(base, changed, ownState(ctx.root, change, env), subject.baseRecord);
  // The law changed by the pull request itself (I-179): an impl-PR answers by factory-change, other kinds by SCOPE_VIOLATION (paths.ts).
  if (subject.kind === "impl" && changedBundledPacks(base).length > 0 && !required.includes(FACTORY_PROFILE)) required.push(FACTORY_PROFILE);
  const classification = isPlainObject(head["classification"]) ? head["classification"] : {};
  const held = new Set(strings(classification["profiles"]));
  const missing = required.filter((p) => !held.has(p));
  const errors: CliError[] = [];
  if (missing.length > 0) {
    errors.push(
      mismatch(change, "classification", "classification", `profiles on HEAD lack ${missing.join(", ")}, which the record of the base or classify by the packs of the base on the diff require`, "#/classification/profiles")
    );
  }
  if (subject.baseRecord !== undefined) {
    const now = basePolicy(base, change, head);
    const before = basePolicy(base, change, subject.baseRecord);
    if (now.ok && before.ok && RISK_LEVELS.indexOf(now.policy.risk_level) < RISK_LEVELS.indexOf(before.policy.risk_level)) {
      errors.push(
        mismatch(change, "classification", "classification", `risk_level ${now.policy.risk_level} on HEAD is below ${before.policy.risk_level} of the record of the base`, "#/classification")
      );
    }
  }
  return errors;
}

/**
 * The UNKNOWNs of the record of the base in `SPECIFIED` or later, kept on HEAD
 * (REQ-VER-011 «Record», I-188): the same id, `blocking: true` stays true, a
 * non-empty `resolution` stays non-empty, `resolved_as` and `ref` once set are
 * not removed and `resolved_as` does not change; a blocking element closed on
 * HEAD is closed as `decision` — its ref `decisions.ts` judges. Otherwise a
 * pull request would lift `WAIT` without the maintainer: the verdict of
 * `blocking-unknowns-resolved` is not computed again.
 */
function unknownsRule(change: string, head: ChangeRecord, base: ChangeRecord | undefined): CliError[] {
  const state = base?.["change_state"];
  if (base === undefined || typeof state !== "string" || !UNKNOWNS_HELD_STATES.has(state)) return [];
  const after = unknownsOf(head);
  const errors: CliError[] = [];
  for (const [i, before] of unknownsOf(base).entries()) {
    if (!isPlainObject(before) || typeof before["id"] !== "string") continue;
    const id = before["id"];
    const index = after.findIndex((e) => isPlainObject(e) && e["id"] === id);
    const now = after[index];
    const fail = (detail: string, pointer: string): void => {
      errors.push(mismatch(change, `unknowns/${i} (${id})`, "unknowns", `${id} ${detail} (record of the base in ${state})`, pointer));
    };
    if (index < 0 || !isPlainObject(now)) {
      fail("is removed from unknowns[]", "#/unknowns");
      continue;
    }
    const at = `#/unknowns/${index}`;
    const weakened: string[] = [];
    if (before["blocking"] === true && now["blocking"] !== true) weakened.push("blocking is no longer true");
    if (isClosed(before) && !isClosed(now)) weakened.push("its resolution is emptied");
    if (before["resolved_as"] !== undefined && now["resolved_as"] !== before["resolved_as"]) {
      weakened.push(`resolved_as ${String(before["resolved_as"])} is ${now["resolved_as"] === undefined ? "removed" : `changed to ${String(now["resolved_as"])}`}`);
    }
    if (before["ref"] !== undefined && now["ref"] === undefined) weakened.push("its ref is removed");
    if (now["blocking"] === true && isClosed(now) && now["resolved_as"] !== "decision") {
      weakened.push(`a blocking UNKNOWN is closed as ${String(now["resolved_as"] ?? "(none)")}, only a decision closes it`);
    }
    if (weakened.length > 0) fail(`is weakened: ${weakened.join("; ")}`, at);
  }
  return errors;
}

/**
 * The waivers the rule `verdicts` reads (design D4): every file of
 * `.warrant/waivers/` of the base, and of HEAD those the base does not hold —
 * a new waiver lies on a path of the class of human acceptance (ADR-0051 п. 2).
 */
function recordedWaivers(ctx: Pick<Ctx, "root">, base: BaseContext): WaiverInput[] {
  const inBase = readWaivers(base.root);
  const held = new Set(inBase.map((w) => w.path));
  return [...inBase, ...readWaivers(ctx.root).filter((w) => !held.has(w.path))];
}

/** Whether `json` was produced by a check (`produced_by.type: "check"`). */
function byCheck(json: Record<string, unknown>): boolean {
  const producedBy = json["produced_by"];
  return isPlainObject(producedBy) && producedBy["type"] === "check";
}

/**
 * Rule `verdicts` (REQ-VER-011 «Record», design D4, ADR-0051 п. 5): a recorded
 * `WAIVED` or `NOT_APPLICABLE` of a new transition has its ground; the verdict
 * itself is not computed again (N44). `WAIVED` — a waiver of this Change on the
 * gate that counts on the date of the run (`countingWaiver`: approvers — `roles`
 * of the base, the gate — as the base defines it). `NOT_APPLICABLE` —
 * `applies_when` of the gate, which at `MERGED` misses the diff of the impl-PR
 * `merge-base(M^1, M^2)..M^2` (elsewhere that diff is out of reach, only its
 * presence is read); or every element of a non-empty `requires_evidence`
 * satisfied by a `NOT_APPLICABLE` record of a check of the transition — at
 * `MERGED` a CI record of M^2.
 */
async function verdictsRule(
  ctx: Pick<Ctx, "root" | "git" | "forge" | "clock">,
  subject: CiSubject,
  change: string,
  transitions: readonly NewTransition[],
  base: BaseContext,
  evidence: ReadonlyMap<string, Record<string, unknown>>
): Promise<CliError[]> {
  const errors: CliError[] = [];
  const definitions = gateDefinitions(base.loaded);
  let waivers: WaiverInput[] | undefined;
  const today = ctx.clock.today();
  for (const t of transitions.filter((x) => x.to !== "PROPOSED")) {
    const gates = isPlainObject(t.entry["gates"]) ? t.entry["gates"] : {};
    const records = strings(t.entry["evidence"]).flatMap((id) => {
      const json = evidence.get(id);
      return json === undefined ? [] : [{ id, json }];
    });
    // M of a MERGED, asked only when a NOT_APPLICABLE needs it; undefined — not found.
    let merge: { found: MergeCommit | undefined; diff: DiffEntry[] | undefined } | undefined;
    for (const [gate, verdict] of Object.entries(gates).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const at = `#/transitions/${t.index}/gates/${gate}`;
      if (verdict === "WAIVED") {
        waivers ??= recordedWaivers(ctx, base);
        const judged = countingWaiver(gate, change, waivers, definitions, { today, approvers: roleMembers(base.loaded.config) });
        if (judged.counting === undefined) {
          const ignored = judged.ignored.map((i) => `${String(i.waiver.json["id"])} (${i.reason})`);
          errors.push(
            mismatch(change, label(t), "waiver", `gate ${gate} is WAIVED, but no waiver of ${change} on it counts on ${today}${ignored.length > 0 ? `: ${ignored.join(", ")}` : ""}`, at)
          );
        }
        continue;
      }
      if (verdict !== "NOT_APPLICABLE") continue;
      const definition = definitions.get(gate);
      if (t.to === "MERGED" && merge === undefined) {
        const found = await mergeOfMerged(ctx, subject, t, evidence);
        merge = { found, diff: found === undefined ? undefined : await mergeDiff(ctx, found) };
      }
      // M not found: the diff is not checked (the rule merge_commit of the ref reports it).
      const outsideDiff =
        appliesWhenPaths(definition).length > 0 &&
        (t.to !== "MERGED" || merge?.found === undefined || (merge.diff !== undefined && !appliesTo(definition, merge.diff)));
      const requirements = requirementsOf(definition);
      const byEvidence =
        requirements.length > 0 &&
        requirements.every((requirement) =>
          records.some(
            (record) =>
              satisfies(requirement, record) &&
              record.json["evidence_status"] === "NOT_APPLICABLE" &&
              byCheck(record.json) &&
              (t.to !== "MERGED" ||
                (attestationOf(record.json).type === "ci" && (merge?.found === undefined || subjectOf(record.json)?.commit === merge.found.second)))
          )
        );
      if (!outsideDiff && !byEvidence) {
        errors.push(
          mismatch(
            change,
            label(t),
            "not_applicable",
            `gate ${gate} is NOT_APPLICABLE without a ground: neither applies_when missing the diff${t.to === "MERGED" ? " of the impl-PR" : ""} nor NOT_APPLICABLE records of a check for each of its requires_evidence`,
            at
          )
        );
      }
    }
  }
  return errors;
}

/**
 * Judges the record of the Change of `subject` (REQ-VER-011 «Record»).
 * `RECORD_MISMATCH` errors name the transition and the reason.
 */
export async function judgeRecord(
  ctx: Pick<Ctx, "root" | "git" | "forge" | "clock">,
  subject: CiSubject,
  base: BaseContext,
  env: NodeJS.ProcessEnv
): Promise<RecordJudgement> {
  const change = subject.change as string;
  const head = subject.record as ChangeRecord;
  const { transitions, errors } = newTransitions(change, head, subject.baseRecord);
  const evidence = new Map<string, Record<string, unknown>>();
  const judgement: RecordJudgement = { transitions, evidence, errors };
  if (errors.length > 0) return judgement;

  const baseState = subject.baseRecord?.["change_state"];
  if (typeof baseState === "string" && isFrozen(baseState) && canonicalHash(head) !== canonicalHash(subject.baseRecord)) {
    errors.push(mismatch(change, "record", "frozen", `the record is ${baseState} in the base: it never changes again (ADR-0021)`));
    return judgement;
  }

  const last = transitionsOf(head).at(-1);
  if (last === undefined || head["change_state"] !== last["to"]) {
    errors.push(mismatch(change, "change_state", "change_state", `change_state ${String(head["change_state"])} is not the target of the last transition ${String(last?.["to"])}`, "#/change_state"));
  }

  for (const t of transitions) {
    const kind = t.from === undefined ? (t.to === "PROPOSED" ? "forward" : null) : transitionKind(t.from, t.to);
    if (kind === null) {
      errors.push(mismatch(change, label(t), "chain", `${t.from ?? "a new record"} -> ${t.to} is not a transition of 04 §2${t.from === undefined ? " (a new record starts with PROPOSED)" : ""}`, `#/transitions/${t.index}`));
      continue;
    }
    if (kind === "forward" && t.to !== "PROPOSED") {
      if (typeof t.entry["effective_policy_hash"] !== "string") {
        errors.push(mismatch(change, label(t), "effective_policy_hash", "a forward transition carries effective_policy_hash", `#/transitions/${t.index}`));
      }
      const gates = isPlainObject(t.entry["gates"]) ? t.entry["gates"] : {};
      const failing = Object.entries(gates).filter(([, v]) => !PASSING_VERDICTS.has(v as Verdict));
      if (failing.length > 0) {
        errors.push(
          mismatch(change, label(t), "gates", `gates ${failing.map(([g, v]) => `${g}=${String(v)}`).join(", ")} are not PASS, WAIVED or NOT_APPLICABLE`, `#/transitions/${t.index}/gates`)
        );
      }
    }
    for (const id of strings(t.entry["evidence"])) {
      const rel = `${evidenceRel(change)}/${id}.json`;
      const json = await jsonAt(ctx, subject.merge, rel);
      if (!isPlainObject(json)) {
        errors.push(mismatch(change, label(t), "evidence", `${id}: ${json === undefined ? `no file ${rel} on HEAD` : `${rel} is not JSON`}`, `#/transitions/${t.index}/evidence`));
        continue;
      }
      evidence.set(id, json);
      const valid = json["$schema"] === EVIDENCE_SCHEMA && validateFile(json as Json, rel).ok;
      if (!valid) errors.push(mismatch(change, label(t), "evidence", `${id}: ${rel} is not a valid ${EVIDENCE_SCHEMA} record`, `#/transitions/${t.index}/evidence`));
    }
  }

  errors.push(...(await verdictsRule(ctx, subject, change, transitions, base, evidence)));
  errors.push(...unknownsRule(change, head, subject.baseRecord));
  if (isMergeKind(subject.kind)) {
    errors.push(...classificationRule(ctx, subject, change, head, base, env));
  }
  for (const t of transitions.filter((x) => x.to === "MERGED")) {
    errors.push(...mergedRules(change, t, head, base, evidence));
  }
  return judgement;
}
