/**
 * Attestation of a check record, derived from the environment rather than
 * from arguments (P-15, design §7, 06a section 3).
 *
 * Under GitHub Actions the record is vouched for by the run that produced it;
 * everywhere else it is a local draft (`none`). Other CI systems are later.
 */

/** `attestation.type` of a record (06a §3): owned here (registry `enums` of `architecture.json`); the schema holds the same values. */
export const ATTESTATION_TYPES = ["ci", "human-review", "signature", "none"] as const;
export type AttestationType = (typeof ATTESTATION_TYPES)[number];

/** What a check record carries: `ci` with the run, or a local draft. */
export type Attestation = { type: "ci"; ref: string } | { type: "none" };

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * `ci` with the URL of the run attempt under GitHub Actions
 * (`<server>/<repo>/actions/runs/<id>/attempts/<n>`; without
 * `GITHUB_RUN_ATTEMPT` — the run, REQ-VER-001): a Re-run is another attempt
 * with its own artifact (ADR-0037 п. 3); `none` everywhere else.
 */
export function attestationFromEnv(env: NodeJS.ProcessEnv = process.env): Attestation {
  const server = env["GITHUB_SERVER_URL"];
  const repository = env["GITHUB_REPOSITORY"];
  const runId = env["GITHUB_RUN_ID"];
  if (env["GITHUB_ACTIONS"] === "true" && present(server) && present(repository) && present(runId)) {
    const run = `${server.replace(/\/+$/, "")}/${repository}/actions/runs/${runId}`;
    const attempt = env["GITHUB_RUN_ATTEMPT"];
    return { type: "ci", ref: present(attempt) ? `${run}/attempts/${attempt}` : run };
  }
  return { type: "none" };
}

/** The run attempt an `attestation.ref` of `ci` names. */
export interface CiRunRef {
  /** `<owner>/<repo>`, lower case. */
  repository: string;
  id: number;
  /** `/attempts/<n>` of the ref; a ref without it names attempt 1 (REQ-VER-011). */
  attempt: number;
}

/**
 * The inverse of {@link attestationFromEnv}: the repository, run and attempt
 * of `…/<owner>/<repo>/actions/runs/<id>[/attempts/<n>]`, or null when `ref`
 * is not such a URL.
 */
export function parseCiRef(ref: string): CiRunRef | null {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/([1-9][0-9]*)(?:\/attempts\/([1-9][0-9]*))?\/?$/.exec(url.pathname);
  if (match === null) return null;
  return {
    repository: `${match[1] as string}/${match[2] as string}`.toLowerCase(),
    id: Number.parseInt(match[3] as string, 10),
    attempt: match[4] === undefined ? 1 : Number.parseInt(match[4], 10)
  };
}
