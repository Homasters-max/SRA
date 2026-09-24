/**
 * Strengthen-only check of `.warrant/local/` overrides (05 section 5, 08
 * section 4): what an override drops from the object it replaces.
 */
import { isPlainObject, strings } from "../json.js";
import type { ObjectKind } from "./types.js";

const POLICY_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["profile", "overlay"]);

function missing(original: string[], override: string[]): string[] {
  const have = new Set(override);
  return original.filter((v) => !have.has(v));
}

/**
 * Strengthen-only composition (05 section 5, 08 section 4): an override may add,
 * never remove. Returns the names of everything the override dropped.
 */
export function weakenings(kind: ObjectKind, original: unknown, override: unknown): string[] {
  if (!isPlainObject(original) || !isPlainObject(override)) return [];
  const lost: string[] = [];

  if (POLICY_KINDS.has(kind)) {
    const origArtifacts = isPlainObject(original["artifacts"]) ? original["artifacts"] : {};
    const overArtifacts = isPlainObject(override["artifacts"]) ? override["artifacts"] : {};
    for (const field of ["required", "forbidden"] as const) {
      for (const item of missing(strings(origArtifacts[field]), strings(overArtifacts[field]))) {
        lost.push(`artifacts.${field}: ${item}`);
      }
    }

    const origGates = isPlainObject(original["gates"]) ? original["gates"] : {};
    const overGates = isPlainObject(override["gates"]) ? override["gates"] : {};
    for (const transition of Object.keys(origGates).sort()) {
      if (transition === "$comment") continue;
      const gone = missing(strings(origGates[transition]), strings(overGates[transition]));
      for (const item of gone) lost.push(`gates.${transition}: ${item}`);
    }

    const origCaps = isPlainObject(original["capabilities"]) ? original["capabilities"] : {};
    const overCaps = isPlainObject(override["capabilities"]) ? override["capabilities"] : {};
    for (const item of missing(strings(origCaps["forbidden"]), strings(overCaps["forbidden"]))) {
      lost.push(`capabilities.forbidden: ${item}`);
    }

    const origEvidence = isPlainObject(original["evidence"]) ? original["evidence"] : {};
    const overEvidence = isPlainObject(override["evidence"]) ? override["evidence"] : {};
    for (const item of missing(strings(origEvidence["required"]), strings(overEvidence["required"]))) {
      lost.push(`evidence.required: ${item}`);
    }

    const key = (a: unknown): string =>
      isPlainObject(a) ? `${String(a["role"])}@${String(a["at"])}` : JSON.stringify(a);
    const origApprovals = Array.isArray(original["approvals"]) ? original["approvals"].map(key) : [];
    const overApprovals = Array.isArray(override["approvals"]) ? override["approvals"].map(key) : [];
    for (const item of missing(origApprovals, overApprovals)) lost.push(`approvals: ${item}`);
  }

  if (kind === "overlay") {
    // `match` сужает область действия overlay: каждый его ключ — дополнительное
    // условие, каждое значение внутри ключа — разрешённый вариант. Поэтому
    // override не слабее только тогда, когда он не добавил ни одного ключа и
    // не убрал ни одного значения у общего ключа (design Decision 7).
    const origMatch = isPlainObject(original["match"]) ? original["match"] : {};
    const overMatch = isPlainObject(override["match"]) ? override["match"] : {};
    for (const key of Object.keys(overMatch).sort()) {
      if (key === "$comment") continue;
      const values = strings(overMatch[key]);
      if (!(key in origMatch)) {
        for (const value of values) lost.push(`match.${key}: narrowed to ${value}`);
        continue;
      }
      for (const value of missing(strings(origMatch[key]), values)) {
        lost.push(`match.${key}: ${value}`);
      }
    }
  }

  if (kind === "profile") {
    // `extends` только добавляет слои, поэтому override должен быть надмножеством.
    for (const item of missing(strings(original["extends"]), strings(override["extends"]))) {
      lost.push(`extends: ${item}`);
    }
  }

  if (kind === "gate") {
    const evidenceKey = (e: unknown): string =>
      isPlainObject(e) ? `${String(e["kind"])}/${String(e["status"])}` : JSON.stringify(e);
    const orig = Array.isArray(original["requires_evidence"]) ? original["requires_evidence"].map(evidenceKey) : [];
    const over = Array.isArray(override["requires_evidence"]) ? override["requires_evidence"].map(evidenceKey) : [];
    for (const item of missing(orig, over)) lost.push(`requires_evidence: ${item}`);

    if (original["waivable"] === false && override["waivable"] === true) {
      lost.push("waivable: false -> true");
    }

    // `accepts_attestation` narrows what is accepted, so the override's list must
    // be a subset of the original's; anything new widens it and weakens the gate.
    if (Array.isArray(original["accepts_attestation"]) && Array.isArray(override["accepts_attestation"])) {
      const allowed = new Set(strings(original["accepts_attestation"]));
      for (const item of strings(override["accepts_attestation"])) {
        if (!allowed.has(item)) lost.push(`accepts_attestation: ${item}`);
      }
    }
  }

  return lost;
}
