/**
 * `analyze-clean`: `warrant analyze` does not exist yet (phase 4), so the gate
 * has no input and is `BLOCKED` — never a quiet `PASS` (REQ-VER-004). A
 * waiver turns it into `WAIVED` (P-16).
 */
import { noInput, type Calculator } from "./types.js";

export const analyzeClean: Calculator = (ctx) => noInput(ctx.gate, "`warrant analyze` is not implemented");
