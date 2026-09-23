// Measurement preload (test-levels §10, I-118): logs every child process started
// by the current process and, through the environment, by its descendants.
// Loaded only by `scripts/dev/test-measure.js` via NODE_OPTIONS=--require and
// active only when WARRANT_SPAWN_LOG is set; nothing in src or test loads it.
"use strict";
const log = process.env.WARRANT_SPAWN_LOG;
if (log) {
  const cp = require("node:child_process");
  const fs = require("node:fs");
  const path = require("node:path");
  const { syncBuiltinESMExports } = require("node:module");
  const TAG = "WARRANT_SPAWN_TAG";
  const testFile = () => {
    const match = /[\\/]packages[\\/]cli[\\/](test[\\/][^:\s)]+\.test\.ts)/.exec(new Error().stack ?? "");
    return match ? match[1].replace(/\\/g, "/") : null;
  };
  const withTag = (args, tag) => {
    const at = args.findIndex((a, i) => i > 0 && a !== null && typeof a === "object" && !Array.isArray(a));
    if (at === -1) args.splice(Array.isArray(args[1]) ? 2 : 1, 0, { env: { ...process.env, [TAG]: tag } });
    else args[at] = { ...args[at], env: { ...(args[at].env ?? process.env), [TAG]: tag } };
  };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const original = cp[name];
    cp[name] = function (...args) {
      // The test file comes from the stack in the vitest worker and from the
      // environment in every process below it.
      const tag = process.env[TAG] ?? testFile();
      if (tag !== null) withTag(args, tag);
      const cmd = path.basename(String(args[0]));
      try {
        fs.appendFileSync(log, `${JSON.stringify({ tag, fn: name, cmd })}\n`);
      } catch {
        // a lost line only lowers the count
      }
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
}
