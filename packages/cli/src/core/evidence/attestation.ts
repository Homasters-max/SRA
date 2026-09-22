/**
 * Attestation of a check record, derived from the environment rather than
 * from arguments (P-15, design §7, 06a section 3).
 *
 * Under GitHub Actions the record is vouched for by the run that produced it;
 * everywhere else it is a local draft (`none`). Other CI systems are later.
 */

export type Attestation = { type: "ci"; ref: string } | { type: "none" };

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export function attestationFromEnv(env: NodeJS.ProcessEnv = process.env): Attestation {
  const server = env["GITHUB_SERVER_URL"];
  const repository = env["GITHUB_REPOSITORY"];
  const runId = env["GITHUB_RUN_ID"];
  if (env["GITHUB_ACTIONS"] === "true" && present(server) && present(repository) && present(runId)) {
    return { type: "ci", ref: `${server.replace(/\/+$/, "")}/${repository}/actions/runs/${runId}` };
  }
  return { type: "none" };
}
