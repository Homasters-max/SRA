import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Full CLI version (semver). */
export const CLI_VERSION: string = pkg.version;

/** `kernel` value for warrant.json: major.minor of the CLI. */
export const KERNEL_VERSION: string = CLI_VERSION.split(".").slice(0, 2).join(".");
