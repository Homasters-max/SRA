/** Shapes shared by the check output parsers (design §5). */
import type { EvidenceStatus } from "../record.js";

export interface ParseResult {
  status: EvidenceStatus;
  /** Present when the output could be read; its shape is the pack form of the kind. */
  metrics?: Record<string, number>;
  /** What the parse could not establish, copied into the record's `limitations[]`. */
  limitations: string[];
}

export interface ParseInput {
  /** Absolute `{out}` of the run. */
  outDir: string;
  /** Captured stdout; empty unless the parser reads it. */
  stdout: string;
}

export interface Parser {
  name: string;
  /** Evidence kind the parser yields. */
  kind: string;
  /** True when the parser reads stdout; the runner then captures it into `{out}`. */
  readsStdout: boolean;
  /** File name of the captured stdout inside `{out}`. */
  stdoutFile?: string;
  parse(input: ParseInput): ParseResult;
}
