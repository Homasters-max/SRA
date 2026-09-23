/**
 * One POSIX launcher for every fake `openspec` of the suite (I-101).
 *
 * On Linux, executing a file that some process still holds open for writing
 * fails with ETXTBSY; a test that writes a fake executable and runs it at once
 * races every `fork` in flight in the same worker (the child keeps the write
 * descriptor until its `exec`). The launcher is written here, before any
 * worker starts, and each fake directory only symlinks it: `$0` is then the
 * link, so `$(dirname "$0")/shim.cjs` is the test's own shim, which node reads
 * rather than the kernel executing it.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function setup(): () => void {
  const dir = mkdtempSync(path.join(tmpdir(), "warrant-fake-launcher-"));
  const launcher = path.join(dir, "launcher");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/shim.cjs" "$@"\n`, "utf8");
  chmodSync(launcher, 0o755);
  process.env["WARRANT_FAKE_LAUNCHER"] = launcher;
  return () => rmSync(dir, { recursive: true, force: true });
}
