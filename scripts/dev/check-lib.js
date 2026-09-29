/**
 * Logic of `scripts/dev/check.js`: the fast checks of the repository before a commit or a push — the ones every
 * branch runs by hand between full `npm test` runs in CI. Pure: the steps as argv and the summary of their JSON.
 */

/** `{ id, argv }` — argv after `node`; `warrant` is the entry of the built CLI in the checkout. */
export function checkSteps(warrant) {
  return [
    { id: "sync --check", argv: [warrant, "sync", "--check", "--json"] },
    { id: "validate", argv: [warrant, "validate", "--json"] },
    { id: "fmt --check", argv: [warrant, "fmt", "--check", "--json"] },
    { id: "versions:check", argv: ["scripts/versions-check.js"] },
  ];
}

/** One line of an error of the envelope (`CliError`) or of versions:check (`{ component, message }`). */
function errorLine(e) {
  if (typeof e === "string") return e;
  const where = e.path ?? e.component;
  return [e.code, where, e.message].filter(Boolean).join(" ") + (e.hint ? ` (${e.hint})` : "");
}

/**
 * `{ ok, lines }` of one step from its exit code and stdout: the errors of the JSON, or the raw tail of the output
 * when it is not JSON (a crash, a missing build).
 */
export function summarizeStep(id, status, stdout, stderr = "") {
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  const ok = status === 0 && (json === null || json.ok !== false);
  const errors = Array.isArray(json?.errors) ? json.errors.map(errorLine) : [];
  if (!ok && errors.length === 0) {
    const raw = `${stderr}\n${stdout}`.trim().split(/\r?\n/).slice(-5);
    errors.push(...raw.filter(Boolean), `exit ${status}`);
  }
  return { id, ok, errors };
}

/** Text report: one line per step, the errors of the failed ones indented, and the verdict. */
export function formatReport(results) {
  const out = [];
  for (const r of results) {
    out.push(`${r.ok ? "ok  " : "FAIL"} ${r.id}`);
    for (const e of r.errors) out.push(`       ${e}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  out.push(failed === 0 ? "check: all passed" : `check: ${failed} of ${results.length} failed`);
  return `${out.join("\n")}\n`;
}
