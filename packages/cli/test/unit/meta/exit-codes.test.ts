/**
 * The choice of an exit code has three places (exit-contract D10, REQ-KRN-003):
 * the table and `exitCodeFor` of `core/errors.ts`, the builders and the
 * emitters of `io/output.ts`, and `bin/warrant.ts` (help and version, the
 * protocol of `guard --frontend`). Elsewhere in `packages/cli/src` there is no
 * reference to `EXIT`, no combining of codes (`Math.max` / `Math.min` over
 * codes), no `exitCode:` set by a call site and no `process.exitCode =`; a
 * command's code comes from the class of its errors and its outcome only.
 * Read from the TypeScript syntax tree: comments and strings do not count.
 * Level `unit`: reads files, starts no process.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../helpers/cli.js";

const SRC = path.join(REPO_ROOT, "packages", "cli", "src");

/** The places allowed to choose a code, per kind of literal. */
const ALLOWED = {
  EXIT: ["core/errors.ts", "io/output.ts", "bin/warrant.ts"],
  combine: ["core/errors.ts", "io/output.ts", "bin/warrant.ts"],
  "exitCode:": ["io/output.ts"],
  "process.exitCode": ["io/output.ts", "bin/warrant.ts"]
} as const;

type Kind = keyof typeof ALLOWED;

/** Every `*.ts` under `dir`, as a POSIX path relative to `SRC`. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(path.relative(SRC, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/** An argument that is an exit code: names `exitCode`, `EXIT` or `exit`. */
const CODE_ARGUMENT = /\bexitCode\b|\bEXIT\b|\.exit\b/;

/** The literals choosing a code in `text`, as `<kind> L<line>`. */
function codeLiterals(file: string, text: string): { kind: Kind; line: number }[] {
  if (!/EXIT|exitCode|Math\.m/.test(text)) return []; // no candidate: skip the parse
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: { kind: Kind; line: number }[] = [];
  const at = (kind: Kind, node: ts.Node): void => {
    found.push({ kind, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "EXIT") at("EXIT", node);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Math" &&
      ["max", "min"].includes(node.expression.name.text) &&
      node.arguments.some((arg) => CODE_ARGUMENT.test(arg.getText(sf)))
    ) {
      at("combine", node);
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === "exitCode") at("exitCode:", node);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(sf) === "process.exitCode"
    ) {
      at("process.exitCode", node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

describe("exit codes are chosen in three places (exit-contract D10, REQ-KRN-003)", () => {
  it("EXIT, combining of codes, exitCode: and process.exitCode stand only in their places", () => {
    const files = sourceFiles();
    expect(files).toContain("core/errors.ts");
    const offending = files.flatMap((file) =>
      codeLiterals(file, readFileSync(path.join(SRC, ...file.split("/")), "utf8"))
        .filter(({ kind }) => !(ALLOWED[kind] as readonly string[]).includes(file))
        .map(({ kind, line }) => `${file}:${line} ${kind}`)
    );
    expect(offending, "a code comes from exitCodeFor (class of errors, outcome) via the builders of io/output.ts").toEqual([]);
  });

  it("the detector catches every form and skips comments and strings", () => {
    const kinds = (text: string): Kind[] => codeLiterals("x.ts", text).map((f) => f.kind);
    expect(kinds(`import { EXIT } from "../core/errors.js";`)).toEqual(["EXIT"]);
    expect(kinds(`return failures(errors, {}, change, EXIT.FAIL as never);`)).toEqual(["EXIT"]);
    expect(kinds(`const code = Math.max(a.exitCode, b.exitCode);`)).toEqual(["combine"]);
    expect(kinds(`const code = Math.max(...results.map((r) => r.exitCode));`)).toEqual(["combine"]);
    expect(kinds(`const r = { ok, data, errors, exitCode: 1 };`)).toEqual(["exitCode:"]);
    expect(kinds(`process.exitCode = 3;`)).toEqual(["process.exitCode"]);
    expect(kinds(`// EXIT.FAIL and Math.max(a.exitCode, b.exitCode)\nconst s = "process.exitCode = EXIT.OK";`)).toEqual([]);
    expect(kinds(`const wait = Math.max(1, deadline - Date.now());`)).toEqual([]);
    expect(kinds(`if (result.exitCode === code) return;`)).toEqual([]);
  });
});
