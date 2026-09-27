/**
 * The archive-PR rules of `warrant ci` (REQ-VER-011 «archive», N35, design §5
 * of phase-4c):
 *
 * - every CI record of a new `MERGED` is verified by reference: it speaks of
 *   M^2 and the tree of M (M — as in the rule of the ref), the run attempt of
 *   its `attestation.ref` belongs to this repository and succeeded — a
 *   `pull_request` run on that head, a `workflow_dispatch` run from the default
 *   branch (ADR-0037 п. 4, N49) — and every committed record with that ref is
 *   byte for byte the file of the artifact `evidence-<change>-<attempt>` of
 *   the attempt; otherwise `EVIDENCE_NOT_VERIFIED` with the reason;
 * - with a new `ARCHIVED` the main specs of HEAD are the result of `openspec
 *   archive <change>` repeated on a checkout of HEAD^1 (R-16), otherwise
 *   `SPECS_NOT_ARCHIVED` with the paths. The directory of the archive (dated)
 *   is not compared; the gates of `MERGED->ARCHIVED` are not computed again
 *   (N44).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Ctx } from "../ctx.js";
import { cliError, EXIT, WarrantError, type CliError, type ExitCode } from "../errors.js";
import { artifactName, attestationOf, ciRunKey, parseCiRef, runAttemptKey } from "../evidence/attestation.js";
import { subjectOf } from "../evidence/record.js";
import { evidenceRel } from "../evidence/store.js";
import { walkFiles } from "../fs.js";
import { mergeOfHead } from "../git/facts.js";
import { strings } from "../json.js";
import { requireOpenspec } from "../openspec/version.js";
import type { PullRequest, WorkflowRun } from "../ports/forge.js";
import type { BaseContext } from "./base.js";
import type { CiSubject } from "./kind.js";
import type { NewTransition } from "./record.js";
import { parsePullUrl } from "./refs.js";

/** Reasons of `EVIDENCE_NOT_VERIFIED`. */
export type EvidenceReason = "commit" | "tree" | "ref" | "run" | "repository" | "conclusion" | "head_sha" | "branch" | "event" | "artifact" | "content";

/** Main specs: what a repeated archive must reproduce. */
const SPECS_DIR = "openspec/specs";

/** A record file of an evidence directory or of an artifact. */
const RECORD_FILE_RE = /^EVID-[0-9A-HJKMNP-TV-Z]{26}\.json$/;

export interface EvidenceVerification {
  /** Ids of the CI records verified through the forge (`data.evidence[]`). */
  verified: string[];
  errors: CliError[];
}

export interface ArchiveReplay {
  errors: CliError[];
  /** 1 — specs differ; 3 — `openspec` failed or is out of range, the base cannot be checked out. */
  exitCode: ExitCode;
}

/** The parsed JSON of `text`, or undefined. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `attestation.ref` of a CI record, or undefined. */
function ciRef(json: unknown): string | undefined {
  const attestation = attestationOf(json);
  return attestation.type === "ci" ? attestation.ref : undefined;
}

/**
 * The recovery run on M (ADR-0037 п. 4, BL-53): `gh workflow run` of the
 * workflow file of `run` — a run of the head of the pull request — or, without
 * one, a placeholder for the workflow file of the job `warrant`: the file is
 * the project's own, not a literal of the CLI.
 */
export function recoveryRun(m: string, run: WorkflowRun | null | undefined): string {
  const file = run === null || run === undefined ? "<workflow file of the job warrant>" : path.posix.basename(run.workflowPath);
  return `gh workflow run ${file} -f merge_commit=${m}`;
}

/** The committed CI records of `change` on HEAD, by id, with their text. */
async function committedRecords(ctx: Pick<Ctx, "git">, subject: CiSubject, change: string): Promise<Map<string, string>> {
  const dir = evidenceRel(change);
  const listed = await ctx.git.tree(subject.merge, [dir]);
  const files = listed.ok ? Object.keys(listed.value).filter((p) => RECORD_FILE_RE.test(path.posix.basename(p))) : [];
  const texts = await ctx.git.contents(subject.merge, files.map((f) => `./${f}`));
  const out = new Map<string, string>();
  for (const file of files) {
    const text = texts.get(`./${file}`);
    if (text !== undefined) out.set(path.posix.basename(file, ".json"), text);
  }
  return out;
}

/**
 * Verifies the CI records of every new `MERGED` of `transitions` through the
 * forge (REQ-VER-011 «archive»). One download per run attempt. Throws
 * `FORGE_UNAVAILABLE` (exit 3) when the forge cannot be read.
 */
export async function verifyCiEvidence(
  ctx: Pick<Ctx, "git" | "forge">,
  subject: CiSubject,
  transitions: readonly NewTransition[],
  evidence: ReadonlyMap<string, Record<string, unknown>>
): Promise<EvidenceVerification> {
  const change = subject.change as string;
  const out: EvidenceVerification = { verified: [], errors: [] };
  const merged = transitions.filter((t) => t.to === "MERGED");
  if (merged.length === 0) return out;

  const runs = new Map<string, Promise<WorkflowRun | null>>();
  const artifacts = new Map<string, Promise<Map<string, Buffer> | null>>();
  let committed: Map<string, string> | undefined;
  /** Per verified ref: ids of the committed records that differ from the artifact. */
  const compared = new Map<string, Set<string>>();

  for (const t of merged) {
    let pull: Promise<PullRequest | null> | undefined;
    const defaultBranch = async (): Promise<string | null> => {
      const parsed = typeof t.entry["ref"] === "string" ? parsePullUrl(t.entry["ref"]) : null;
      if (parsed === null) return null;
      pull ??= ctx.forge.pullRequest(parsed.number);
      return (await pull)?.defaultBranch ?? null;
    };

    for (const id of strings(t.entry["evidence"])) {
      const json = evidence.get(id);
      const ref = json === undefined ? undefined : ciRef(json);
      if (json === undefined || ref === undefined) continue;
      const rel = `${evidenceRel(change)}/${id}.json`;
      const fail = (reason: EvidenceReason, detail: string, hint?: string): void => {
        out.errors.push(cliError("EVIDENCE_NOT_VERIFIED", `${id}: ${reason}: ${detail}`, { path: rel, ...(hint === undefined ? {} : { hint }) }));
      };

      const recorded = subjectOf(json);
      const m = recorded === undefined ? null : await mergeOfHead(ctx, recorded.commit, subject.base);
      if (recorded === undefined || m === null) {
        fail("commit", `no merge commit M on the first-parent line of the base has ${String(recorded?.commit)}, the subject.commit of the record, as its head`);
        continue;
      }
      const parsed = parseCiRef(ref);
      const runOf = (at: NonNullable<typeof parsed>): Promise<WorkflowRun | null> => {
        const key = `${at.id} ${at.attempt}`;
        if (!runs.has(key)) runs.set(key, ctx.forge.workflowRun(at.id, at.attempt));
        return runs.get(key) as Promise<WorkflowRun | null>;
      };
      const tree = await ctx.git.treeId(m);
      if (recorded.tree === undefined || recorded.tree !== tree) {
        fail(
          "tree",
          recorded.tree === undefined ? `the record has no subject.tree: evidence on the result of the merge M ${m} is required` : `subject.tree ${recorded.tree} is not ${String(tree)}, the tree of M ${m}`,
          `run the job on M: ${recoveryRun(m, parsed === null ? null : await runOf(parsed))}, then warrant ci fetch <impl-PR>`
        );
        continue;
      }

      if (parsed === null) {
        fail("ref", `attestation.ref ${ref} is not the URL of a run attempt of GitHub Actions`);
        continue;
      }
      const run = await runOf(parsed);
      if (run === null) {
        fail("run", `no attempt ${parsed.attempt} of run ${parsed.id} in the repository of the forge`);
        continue;
      }
      if (run.repository.toLowerCase() !== parsed.repository) {
        fail("repository", `run ${parsed.id} of ${parsed.repository} is not a run of the repository of the forge (${run.repository})`);
        continue;
      }
      if (run.conclusion !== "success") {
        fail("conclusion", `attempt ${run.attempt} of run ${run.id} concluded ${String(run.conclusion)}, not success`);
        continue;
      }
      if (run.event === "pull_request") {
        if (run.headSha !== recorded.commit) {
          fail("head_sha", `run ${run.id} of pull_request ran on ${run.headSha}, not on ${recorded.commit}, the subject.commit of the record`);
          continue;
        }
      } else if (run.event === "workflow_dispatch") {
        const branch = await defaultBranch();
        if (branch === null || run.headBranch !== branch) {
          fail("branch", `run ${run.id} of workflow_dispatch ran from branch ${run.headBranch}, not from the default branch${branch === null ? " (unknown: the ref of MERGED names no pull request of the forge)" : ` ${branch}`}`);
          continue;
        }
      } else {
        fail("event", `run ${run.id} is a ${run.event} run: only pull_request and recovery workflow_dispatch runs produce evidence of a merge`);
        continue;
      }

      const name = artifactName(change, parsed.attempt);
      const artifactKey = `${run.id} ${name}`;
      if (!artifacts.has(artifactKey)) artifacts.set(artifactKey, ctx.forge.downloadArtifact(run.id, name));
      const files = await artifacts.get(artifactKey);
      if (files === null || files === undefined) {
        fail("artifact", `run ${run.id} has no artifact ${name} (expired after 90 days, or never uploaded)`, `run the job on M: ${recoveryRun(m, run)}, then warrant ci fetch <impl-PR>`);
        continue;
      }
      const attempt = runAttemptKey(parsed);
      if (!compared.has(attempt)) {
        // Every committed record of this run attempt, not only those of evidence[]: each is one error.
        committed ??= await committedRecords(ctx, subject, change);
        const differ = new Set<string>();
        for (const [other, text] of committed) {
          const otherRef = ciRef(parsedJson(text));
          if (otherRef === undefined || ciRunKey(otherRef) !== attempt) continue;
          const file = files.get(`${other}.json`);
          if (file === undefined || !file.equals(Buffer.from(text, "utf8"))) differ.add(other);
        }
        compared.set(attempt, differ);
        for (const other of [...differ].sort()) {
          out.errors.push(
            cliError("EVIDENCE_NOT_VERIFIED", `${other}: content: the committed record is not byte for byte ${other}.json of artifact ${name} of ${ref}`, {
              path: `${evidenceRel(change)}/${other}.json`
            })
          );
        }
      }
      if (compared.get(attempt)?.has(id) === true) continue;
      out.verified.push(id);
    }
  }
  out.verified.sort();
  return out;
}

/** The text of a file with CRLF as LF: a checkout on Windows does not make specs differ. */
function lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * R-16: repeats `openspec archive <change>` on a checkout of HEAD^1 and
 * compares `openspec/specs/**` of the result with HEAD by path and content.
 * The version of `openspec` is checked against the range of the base, as
 * `warrant archive` does; its failure is exit 3 with its output.
 */
export async function replayArchive(ctx: Pick<Ctx, "git" | "openspec">, subject: CiSubject, base: BaseContext): Promise<ArchiveReplay> {
  const change = subject.change as string;
  const config = (message: string, code: "OPENSPEC_FAILED" | "USAGE" = "OPENSPEC_FAILED"): ArchiveReplay => ({
    errors: [cliError(code, message, { path: `openspec/changes/${change}` })],
    exitCode: EXIT.CONFIG
  });
  try {
    await requireOpenspec(ctx.openspec, base.loaded.config);
  } catch (thrown) {
    if (!(thrown instanceof WarrantError)) throw thrown;
    return {
      errors: [cliError(thrown.code, thrown.message, { ...(thrown.path === undefined ? {} : { path: thrown.path }), ...(thrown.hint === undefined ? {} : { hint: thrown.hint }) })],
      exitCode: EXIT.CONFIG
    };
  }

  const checkout = await ctx.git.worktreeAt(subject.base);
  if (!checkout.ok) return config(`git could not check out the base ${subject.base} to repeat the archive: ${checkout.detail}`, "USAGE");
  try {
    const act = await ctx.openspec.archive(change, checkout.value.root);
    if (!act.ok) return config(`openspec archive ${change} --yes --json failed on the base ${subject.base}: ${act.output.trim()}`);

    const specsRoot = path.join(checkout.value.root, ...SPECS_DIR.split("/"));
    const repeated = new Map<string, string>();
    for (const file of walkFiles(specsRoot)) {
      repeated.set(`${SPECS_DIR}/${path.relative(specsRoot, file).split(path.sep).join("/")}`, readFileSync(file, "utf8"));
    }
    const listed = await ctx.git.tree(subject.merge, [SPECS_DIR]);
    if (!listed.ok) return config(`git could not list ${SPECS_DIR} of HEAD: ${listed.detail}`, "USAGE");
    const headPaths = Object.keys(listed.value);
    const texts = await ctx.git.contents(subject.merge, headPaths.map((p) => `./${p}`));

    const errors: CliError[] = [];
    for (const p of [...new Set([...headPaths, ...repeated.keys()])].sort()) {
      const head = texts.get(`./${p}`);
      const again = repeated.get(p);
      if (head !== undefined && again !== undefined && lf(head) === lf(again)) continue;
      const why = head === undefined ? "the repeated archive writes it, HEAD has not" : again === undefined ? "HEAD has it, the repeated archive does not" : "HEAD differs from the repeated archive";
      errors.push(
        cliError("SPECS_NOT_ARCHIVED", `${p}: ${why} (openspec archive ${change} on HEAD^1, R-16)`, {
          path: p,
          hint: `main specs change only by \`warrant archive ${change}\`: restore ${SPECS_DIR}/** from its result`
        })
      );
    }
    return { errors, exitCode: errors.length > 0 ? EXIT.FAIL : EXIT.OK };
  } finally {
    await checkout.value.dispose();
  }
}
