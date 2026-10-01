/**
 * The shell parse of `guard` (design §6, ADR-0017 п. 5, task 5.2): the
 * tokenizer (`core/shell.ts`) — quotes, `\`, operators, a newline, a heredoc as
 * data (I-167) —, simple commands with `VAR=…` dropped and `bash -c` parsed one level deep, the default prefix of
 * `run.command` and the prefix match; the strict form under a `review` Run
 * (REQ-ENF-004, I-202, I-207).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { projectPath } from "../../../src/core/fs.js";
import {
  inCliForm,
  recoveryEditAnswer,
  recoveryShellAnswer,
  reviewShellAnswer,
  SUBMIT_HINT,
  type RecoveryFailure
} from "../../../src/core/guard/decide.js";
import { defaultPrefix, leafCommands, matchesPrefix, simpleCommands, startsWithPrefix } from "../../../src/core/guard/shell.js";
import type { Run } from "../../../src/core/run/types.js";
import { shellWords } from "../../../src/core/shell.js";

describe("shellWords", () => {
  it("splits at blanks; quotes join, single quotes are literal", () => {
    expect(shellWords("pytest  -q\ttests/")).toEqual(["pytest", "-q", "tests/"]);
    expect(shellWords(`echo 'a  b' "c d" e"f g"h`)).toEqual(["echo", "a  b", "c d", "ef gh"]);
    expect(shellWords(`echo '\\n $x "q"'`)).toEqual(["echo", '\\n $x "q"']);
    expect(shellWords(`echo "" ''`)).toEqual(["echo", "", ""]);
  });

  it("backslash: escapes outside quotes, only \" \\ $ ` and a newline inside double quotes", () => {
    expect(shellWords("echo a\\ b \\&\\& c")).toEqual(["echo", "a b", "&&", "c"]);
    expect(shellWords(`echo "a\\"b" "c\\d" "\\$x"`)).toEqual(["echo", 'a"b', "c\\d", "$x"]);
    expect(shellWords("pytest \\\n  -q")).toEqual(["pytest", "-q"]);
  });

  it("operators &&, ||, ;, | and a newline are words of their own, also without blanks", () => {
    expect(shellWords("cd src&&pytest||echo x;ls|wc\nnpm test")).toEqual([
      "cd", "src", "&&", "pytest", "||", "echo", "x", ";", "ls", "|", "wc", "\n", "npm", "test"
    ]);
  });

  it("an operator inside quotes stays part of the word", () => {
    expect(shellWords(`echo "a && b" 'c;d'`)).toEqual(["echo", "a && b", "c;d"]);
  });
});

describe("shellWords: a heredoc is data of its command (I-167)", () => {
  it("drops the redirection and the body for <<DELIM, <<'DELIM', <<\"DELIM\" and << DELIM", () => {
    for (const redirection of ["<<EOF", "<<'EOF'", '<<"EOF"', "<< EOF", "<<E'O'F"]) {
      expect(shellWords(`cat ${redirection}\nrm -rf x; it's && a | b\nEOF\nls -l`), redirection).toEqual(["cat", "\n", "ls", "-l"]);
    }
    expect(shellWords("cat<<EOF\nrm x\nEOF")).toEqual(["cat", "\n"]);
  });

  it("<<- strips leading tabs of the body lines and of the delimiter line", () => {
    expect(shellWords("cat <<-EOF\n\trm x\n\t\tEOF\nls")).toEqual(["cat", "\n", "ls"]);
    // Without `-` a tab-indented delimiter line is body: the heredoc is never closed.
    expect(shellWords("cat <<EOF\n\tEOF")).toEqual(["cat", "\n", "EOF"]);
  });

  it("a heredoc in the middle of a && chain: the rest of its line stays commands, the body does not", () => {
    expect(shellWords("cat <<EOF && warrant run submit\nrm x; y\nEOF\nls")).toEqual([
      "cat", "&&", "warrant", "run", "submit", "\n", "ls"
    ]);
    expect(shellWords("cat <<A <<-B | wc\na\nA\n\tb\n\tB")).toEqual(["cat", "|", "wc", "\n"]);
  });

  it("a redirection before the command name does not shift its first word", () => {
    expect(simpleCommands(shellWords("<<EOF pytest -q\nx\nEOF"))).toEqual([["pytest", "-q"]]);
  });

  it("a delimiter line that never comes: the lines stay commands (fail-safe)", () => {
    expect(shellWords("warrant run submit <<'JSON'\n{\nrm -rf x")).toEqual([
      "warrant", "run", "submit", "\n", "{", "\n", "rm", "-rf", "x"
    ]);
    expect(shellWords("cat <<EOF")).toEqual(["cat"]);
  });

  it("a delimiter line ending in CR closes; <<< and << without a delimiter are words", () => {
    expect(shellWords("cat <<EOF\r\nrm x\r\nEOF\r\nls")).toEqual(["cat", "\n", "ls"]);
    expect(shellWords("cat <<<'a b'")).toEqual(["cat", "<<<a b"]);
    expect(shellWords("echo << ;ls")).toEqual(["echo", "<<", ";", "ls"]);
  });

  it("a heredoc inside bash -c is data too", () => {
    expect(leafCommands(["bash", "-c", "warrant run submit <<'J'\nrm x\nJ"])).toEqual([["warrant", "run", "submit"]]);
  });

  it("<< in a comment is no heredoc: the next lines stay commands; quotes and \\ in a comment are text, its words stay words", () => {
    expect(shellWords("warrant run submit # <<X\nrm -rf src\nX")).toEqual([
      "warrant", "run", "submit", "#", "<<X", "\n", "rm", "-rf", "src", "\n", "X"
    ]);
    expect(simpleCommands(shellWords("echo # it's \\\npytest\n'"))).toEqual([["echo", "#", "it's", "\\"], ["pytest"], [""]]);
    // `#` inside a word, quoted or escaped starts no comment.
    expect(shellWords("a#b <<X\nrm\nX")).toEqual(["a#b", "\n"]);
    expect(shellWords("echo '#' <<X\nrm\nX")).toEqual(["echo", "#", "\n"]);
    expect(shellWords("echo \\# <<X\nrm\nX")).toEqual(["echo", "#", "\n"]);
    expect(shellWords("cat <<X # c\nrm\nX\nls")).toEqual(["cat", "#", "c", "\n", "ls"]);
  });

  it("<< inside $((…)), ((…)), $[…], ${…} is no heredoc: the next lines stay commands", () => {
    for (const line of ["echo $((1<<X))", "((x<<X))", "(( (1+2) << X ))", "echo $[1<<X]", "echo ${x:-<<X}", "a=$((1<<X)) && ls"]) {
      const commands = simpleCommands(shellWords(`${line}\npytest\nX`));
      expect(commands.slice(-2), line).toEqual([["pytest"], ["X"]]);
    }
    // After the closing bracket, and for `$(…)` / `((…) )` (no arithmetic), a heredoc is one again.
    expect(shellWords("echo $((1)) <<X\nrm\nX")).toEqual(["echo", "$((1))", "\n"]);
    expect(shellWords("echo $(cat <<X\nrm\nX\n)")).toEqual(["echo", "$(cat", "\n", ")"]);
    expect(shellWords("((cat <<X\nit's\nX\n) )\npytest")).toEqual(["((cat", "\n", ")", ")", "\n", "pytest"]);
    // An unclosed one is no arithmetic: the heredoc is read as before.
    expect(shellWords("echo $((1 <<X\nrm\nX")).toEqual(["echo", "$((1", "\n"]);
  });

  it("# and $(( in a heredoc body do not change the parse: the body is data", () => {
    expect(shellWords("warrant run submit <<'JSON'\n# $((1<<Y)) ${z\n{\"a\": \"it's\"}\nJSON\nls")).toEqual(["warrant", "run", "submit", "\n", "ls"]);
  });
});

describe("simpleCommands", () => {
  it("splits at the operators and drops empty commands", () => {
    expect(simpleCommands(shellWords("cd src && pytest tests/ ; ; ls | wc -l"))).toEqual([
      ["cd", "src"],
      ["pytest", "tests/"],
      ["ls"],
      ["wc", "-l"]
    ]);
  });

  it("VAR=1 before a command is skipped", () => {
    expect(simpleCommands(shellWords("VAR=1 CI=true pytest -q && A=b"))).toEqual([["pytest", "-q"]]);
  });

  it("bash -c / sh -c: the string is parsed one level deep (SCN-ENF-013)", () => {
    expect(simpleCommands(["bash", "-c", "cd src && pytest tests/"])).toEqual([
      ["bash", "-c", "cd src && pytest tests/"],
      ["cd", "src"],
      ["pytest", "tests/"]
    ]);
    expect(simpleCommands(shellWords(`sh -lc 'X=1 pytest'`))).toEqual([["sh", "-lc", "X=1 pytest"], ["pytest"]]);
    expect(simpleCommands(["/bin/bash", "-e", "-c", "npm test"])).toEqual([["/bin/bash", "-e", "-c", "npm test"], ["npm", "test"]]);
  });

  it("only one level: bash -c inside bash -c is not parsed again", () => {
    expect(simpleCommands(["bash", "-c", `bash -c "pytest"`])).toEqual([
      ["bash", "-c", `bash -c "pytest"`],
      ["bash", "-c", "pytest"]
    ]);
  });

  it("a script of bash without -c is not read", () => {
    expect(simpleCommands(["bash", "run-tests.sh"])).toEqual([["bash", "run-tests.sh"]]);
  });
});

describe("leafCommands", () => {
  it("a parsed bash -c stands for its commands, not for itself; one level deep", () => {
    expect(leafCommands(["bash", "-c", "cd src && pytest tests/"])).toEqual([["cd", "src"], ["pytest", "tests/"]]);
    expect(leafCommands(shellWords("X=1 warrant run submit --file r.json"))).toEqual([["warrant", "run", "submit", "--file", "r.json"]]);
    expect(leafCommands(["bash", "-c", `bash -c "pytest"`])).toEqual([["bash", "-c", "pytest"]]);
    expect(leafCommands(["bash", "-c", ""])).toEqual([]);
    expect(leafCommands(["bash", "run-tests.sh"])).toEqual([["bash", "run-tests.sh"]]);
  });

  it("as written: VAR=… stays, only exactly bash -c / sh -c <string> is parsed", () => {
    expect(leafCommands(shellWords("X=1 warrant run submit"), true)).toEqual([["X=1", "warrant", "run", "submit"]]);
    expect(leafCommands(["sh", "-c", "a && b"], true)).toEqual([["a"], ["b"]]);
    for (const wrapper of [["bash", "-lc", "a"], ["/bin/bash", "-c", "a"], ["bash", "-c", "a", "x"], ["bash", "-e", "-c", "a"]]) {
      expect(leafCommands(wrapper, true), JSON.stringify(wrapper)).toEqual([wrapper]);
    }
  });
});

describe("reviewShellAnswer (REQ-ENF-004)", () => {
  const run = { id: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", change: "add-search", operation: "review" } as Run;

  it("allow only when every command starts with warrant run submit (SCN-ENF-027)", () => {
    expect(reviewShellAnswer(["bash", "-c", "warrant run submit --file result.json"], run).decision).toBe("allow");
    expect(reviewShellAnswer(["warrant", "run", "submit"], run).decision).toBe("allow");
    const denied = reviewShellAnswer(["bash", "-c", "cat x && warrant run submit"], run);
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("cat x");
    expect(denied.hints.join(" ")).toContain("warrant run submit");
  });

  it("an envelope in a heredoc is data: allow; a command after the delimiter line is denied (I-167)", () => {
    const envelope = `{"statement": "it's; a && b | c", "run": "RUN-1"}`;
    expect(reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}\nJSON`), run).decision).toBe("allow");
    const after = reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}\nJSON\nrm -rf x`), run);
    expect(after.decision).toBe("deny");
    expect(after.reason).toContain("rm -rf x");
    expect(reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}`), run).decision).toBe("deny");
  });

  it("only the strict form: exactly warrant run submit, --dry-run and --file <path> once each, trailing newlines", () => {
    for (const line of [
      "warrant run submit",
      "warrant run submit --file envelope.json",
      "warrant run submit --dry-run --file a/b.json",
      "warrant run submit --file 'C:\\r\\результат-1.json' --dry-run\n\n",
      "warrant run submit --dry-run --file a.json && warrant run submit --file a.json",
      "warrant run submit <<'JSON'\n{\"statement\": \"it's; a && b | c # d $((1<<2))\"}\nJSON"
    ]) {
      expect(reviewShellAnswer(shellWords(line), run).decision, line).toBe("allow");
    }
  });

  it("anything else is denied with the reason and hint as before: &, redirections, $(…), `…`, <(…), VAR=…, a comment, wrappers, options", () => {
    for (const line of [
      "warrant run submit & rm -rf src",
      "warrant run submit > openspec/changes/c/proposal.md",
      "warrant run submit --file $(rm -rf src)",
      "warrant run submit --file `rm -rf src`",
      "warrant run submit --file <(rm -rf src)",
      "warrant run submit --file 'a b.json'",
      "warrant run submit --file 'x;rm'",
      "NODE_OPTIONS=--import=x warrant run submit",
      "warrant run submit # <<X\nrm -rf src\nX",
      "warrant run submit # note",
      "warrant run submit --file",
      "warrant run submit --file -x.json",
      "warrant run submit --dry-run --dry-run",
      "warrant run submit --force",
      "warrant run submit < envelope.json",
      "bash -lc 'warrant run submit'",
      "/bin/bash -c 'warrant run submit'",
      "bash -c 'warrant run submit' x"
    ]) {
      const denied = reviewShellAnswer(shellWords(line), run);
      expect(denied.decision, line).toBe("deny");
      expect(denied.reason, line).toContain("a review Run runs only `warrant run submit`");
      expect(denied.hints, line).toEqual([SUBMIT_HINT]);
    }
    expect(reviewShellAnswer(shellWords("NODE_OPTIONS=--import=x warrant run submit"), run).reason).toContain("NODE_OPTIONS=--import=x");
    expect(reviewShellAnswer(shellWords("warrant run submit # <<X\nrm -rf src\nX"), run).reason).toContain("`warrant run submit # <<X`");
  });

  it("the operators that join the commands: collected when asked, of every level parsed", () => {
    const operators: string[] = [];
    expect(leafCommands(["bash", "-c", "a | b\nc && d"], true, 1, operators)).toEqual([["a"], ["b"], ["c"], ["d"]]);
    expect(operators).toEqual(["|", "\n", "&&"]);
  });

  it("no command, no argv, a longer bash nesting and a lookalike are denied", () => {
    for (const argv of [undefined, [], ["bash", "-c", ""], ["bash", "-c", 'bash -c "warrant run submit"'], ["warrant", "run", "finish"], ["npx", "warrant", "run", "submit"]]) {
      expect(reviewShellAnswer(argv, run).decision, JSON.stringify(argv)).toBe("deny");
    }
  });
});

describe("defaultPrefix, matchesPrefix and startsWithPrefix", () => {
  const w = (...words: string[]) => ({ words, flags: [] });
  it("the words of run.command before the first flag or placeholder", () => {
    expect(defaultPrefix(["pytest", "-q"])).toEqual(w("pytest"));
    expect(defaultPrefix(["npm", "test", "--", "--reporter=junit"])).toEqual(w("npm", "test"));
    expect(defaultPrefix(["openspec", "validate", "{change}", "--strict"])).toEqual(w("openspec", "validate"));
    expect(defaultPrefix(["-x"])).toEqual(w());
  });

  it("keeps the pair -m <module> right after the first word (BL-61, SCN-ENF-037)", () => {
    expect(defaultPrefix(["python", "-m", "pytest", "--junitxml={out}"])).toEqual(w("python", "-m", "pytest"));
    expect(defaultPrefix(["python3", "-m", "unittest", "discover", "-s", "tests"])).toEqual(w("python3", "-m", "unittest", "discover"));
    expect(startsWithPrefix(["python", "-"], defaultPrefix(["python", "-m", "pytest"]).words)).toBe(false);
  });

  it("SCN-ENF-040 a single interpreter word takes the mode flags of the command: no =, no placeholder, no repeats", () => {
    const lattice = ["node", "--experimental-strip-types", "--test", "--test-reporter=junit", "--test-reporter-destination={out}/junit.xml", "test/**/*.test.ts"];
    expect(defaultPrefix(lattice)).toEqual({ words: ["node"], flags: ["--experimental-strip-types", "--test"] });
    expect(defaultPrefix(["node", "--test", "--test", "{out}"])).toEqual({ words: ["node"], flags: ["--test"] });
    expect(defaultPrefix(["python", "-X", "dev", "-m", "pytest"])).toEqual({ words: ["python"], flags: ["-X", "-m"] });
    expect(defaultPrefix(["python", "-m", "{module}"])).toEqual({ words: ["python"], flags: ["-m"] });
    // an interpreter with a plain next word and a non-interpreter keep the word rule
    expect(defaultPrefix(["node", "scripts/test.js", "--ci"])).toEqual(w("node", "scripts/test.js"));
    expect(defaultPrefix(["vitest", "--run"])).toEqual(w("vitest"));
    // an interpreter without mode flags stays a single word
    expect(defaultPrefix(["node", "--reporter=junit"])).toEqual(w("node"));
  });

  it("SCN-ENF-040 a flagged prefix matches the interpreter holding every flag, in any order", () => {
    const prefix = { words: ["node"], flags: ["--experimental-strip-types", "--test"] };
    expect(matchesPrefix(["node", "--test", "--experimental-strip-types", "test/a.test.ts"], prefix)).toBe(true);
    expect(matchesPrefix(["node", "--experimental-strip-types", "--test"], prefix)).toBe(true);
    expect(matchesPrefix(["node", "--test", "x"], prefix)).toBe(false);
    expect(matchesPrefix(["node", "-e", "1"], prefix)).toBe(false);
    expect(matchesPrefix(["node", "--version"], prefix)).toBe(false);
    expect(matchesPrefix(["deno", "--test", "--experimental-strip-types"], prefix)).toBe(false);
    expect(matchesPrefix(["pytest", "tests/"], w("pytest"))).toBe(true);
  });

  it("a command matches a non-empty prefix word by word", () => {
    expect(startsWithPrefix(["pytest", "tests/"], ["pytest"])).toBe(true);
    expect(startsWithPrefix(["npm", "test"], ["npm", "test"])).toBe(true);
    expect(startsWithPrefix(["npm"], ["npm", "test"])).toBe(false);
    expect(startsWithPrefix(["pytests"], ["pytest"])).toBe(false);
    expect(startsWithPrefix(["pytest"], [])).toBe(false);
  });
});

describe("reviewShellAnswer: commands that write nothing and the cancel (SCN-ENF-044, I-202, I-207)", () => {
  const run = { id: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", change: "add-search", operation: "review" } as Run;
  const root = path.resolve("/work/project");
  const places = { cwd: root, inProject: (dir: string) => projectPath(root, dir) !== undefined };
  const decision = (line: string): string => reviewShellAnswer(shellWords(line), run, places).decision;

  it("allowed: status, gate, --help, the cancel, git status|log|diff|show, cd inside, joined by &&, ||, ; and a newline", () => {
    for (const line of [
      "warrant status",
      "warrant status add-search --json",
      "warrant gate add-search spec-approved",
      "warrant --help",
      "warrant run submit --help",
      "warrant transition -h",
      "warrant run finish --state CANCELLED",
      "warrant run finish --dry-run --state=CANCELLED",
      "git status --porcelain",
      "git log --oneline -5",
      "git diff main -- openspec",
      "git show --stat HEAD~1",
      "git diff --ours || git log --oneline",
      "cd openspec && git status; warrant status\nwarrant gate add-search",
      "cd . || cd openspec/changes",
      "warrant run submit --file a.json\nwarrant status"
    ]) {
      expect(decision(line), line).toBe("allow");
    }
  });

  it("denied: writes, global options of git, arguments that write, a pipe, &, redirections, substitutions, groups, !, assignments", () => {
    for (const line of [
      "warrant verify add-search",
      "warrant gate",
      "warrant run finish",
      "warrant run finish --state FAILED",
      "warrant run finish --state CANCELLED --state CANCELLED",
      "warrant -- --help",
      "warrant run --file x --help",
      "git -C .. status",
      "git --no-pager log",
      "git commit -m x",
      "git checkout --ours x",
      "git diff -o x.patch",
      "git diff -ox.patch",
      "git diff --ou x.patch",
      "git diff --output=x.patch",
      "git diff --outp=x.patch",
      "git log --ext-diff",
      "git log --ext-d",
      "git log | head",
      "warrant status | warrant gate add-search",
      "warrant status & rm -rf src",
      "warrant status > s.txt",
      "warrant status 2>&1",
      "git diff < x",
      "git log $(rm -rf src)",
      "git log `rm -rf src`",
      "git log $HOME",
      "git diff --{output=x,}",
      "( warrant status )",
      "{ warrant status; }",
      "! warrant status",
      "X=1 warrant status",
      "cd",
      "cd ..",
      "cd ../other && warrant run finish --state CANCELLED",
      "cd -",
      "cd ~",
      "cd -P openspec",
      "cd a b",
      "cat x"
    ]) {
      const answer = reviewShellAnswer(shellWords(line), run, places);
      expect(answer.decision, line).toBe("deny");
      expect(answer.hints, line).toEqual([SUBMIT_HINT]);
    }
  });

  it("the hint names the result, the cancel and the state; the reason names the command or the operator", () => {
    expect(SUBMIT_HINT).toContain("warrant run submit");
    expect(SUBMIT_HINT).toContain("warrant run finish --state CANCELLED");
    expect(SUBMIT_HINT).toContain("warrant status");
    expect(reviewShellAnswer(shellWords("git log | warrant status"), run, places).reason).toContain("`|`");
    expect(reviewShellAnswer(shellWords("git -c a=b diff"), run, places).reason).toContain("`git -c a=b diff`");
  });

  it("cd without places, and a cd whose every possible start does not stay inside, are denied", () => {
    expect(reviewShellAnswer(shellWords("cd openspec"), run).decision).toBe("deny");
    expect(decision("cd openspec || cd ..")).toBe("deny");
    expect(decision("cd openspec && cd ..")).toBe("deny");
    expect(reviewShellAnswer(shellWords("cd .."), run, { ...places, cwd: path.join(root, "openspec") }).decision).toBe("allow");
  });

  it("submits alone keep every operator of the tokenizer (I-167)", () => {
    expect(decision("warrant run submit | warrant run submit")).toBe("allow");
  });
});

describe("the recovery mode and the pinned CLI (ADR-0053 п. 2–3)", () => {
  const root = path.resolve("/work/project");
  const places = {
    cwd: root,
    inProject: (dir: string) => projectPath(root, dir) !== undefined,
    isRoot: (dir: string) => path.resolve(dir) === root,
    cli: "tools/warrant.js"
  };
  const failure: RecoveryFailure = {
    error: { code: "PACK_VERSION_RANGE", message: "pack core-sdd version 0.4.1 does not satisfy", hint: "set …, then run `warrant sync`" },
    exit: "pin-up",
    carries: "core-sdd 0.4.1",
    reason: "the policy does not load (PACK_VERSION_RANGE): CLI 0.10.0 carries core-sdd 0.4.1; warrant.json pins core-sdd ^0.3.4"
  };
  const shell = (line: string, at = places): string => recoveryShellAnswer(shellWords(line), failure, at).decision;

  it("recovery commands and commands that write nothing pass in the strict form; anything else is denied", () => {
    for (const line of ["warrant sync", "warrant validate --files a.json", "warrant status", "warrant --version", "warrant -V", "git diff", "cd src && warrant sync"]) {
      expect(shell(line), line).toBe("allow");
    }
    for (const line of ["warrant fmt", "warrant run submit", "warrant --version x", "npm ci", "warrant sync | cat", "warrant sync $X", "git -C x log", ""]) {
      expect(shell(line), line).toBe("deny");
    }
    const denied = recoveryShellAnswer(shellWords("npm ci"), failure, places);
    expect(denied.reason).toContain("`npm ci`");
    expect(denied.reason).toContain(failure.reason);
  });

  it("node <cli> is warrant only exactly as written and only at the project root", () => {
    expect(shell("node tools/warrant.js sync")).toBe("allow");
    expect(shell("node ./tools/warrant.js sync")).toBe("deny");
    expect(shell("cd src && node tools/warrant.js sync")).toBe("deny");
    expect(shell("node tools/warrant.js sync", { ...places, cwd: path.join(root, "src") })).toBe("deny");
    const { cli: _cli, ...without } = places;
    expect(shell("node tools/warrant.js sync", without)).toBe("deny");
  });

  it("the hints name the commands as node <cli>, from the project root", () => {
    const hints = recoveryShellAnswer(shellWords("npm ci"), failure, places).hints.join("\n");
    expect(hints).toContain("`node tools/warrant.js sync`");
    expect(hints).toContain("from the project root");
    expect(hints).not.toContain("`warrant sync`");
    expect(inCliForm("run `warrant validate`", undefined)).toBe("run `warrant validate`");
    expect(inCliForm("no command here", "tools/warrant.js")).toBe("no command here");
  });

  it("edits: the pin alone passes with the hint sync, any other path is denied", () => {
    expect(recoveryEditAnswer([".warrant/warrant.json"], undefined, failure)).toEqual({ decision: "allow", hints: [expect.stringContaining("`warrant sync`")] });
    const denied = recoveryEditAnswer([".warrant/warrant.json", "src/a.ts"], undefined, failure);
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("src/a.ts");
    expect(denied.hints.join("\n")).toContain("pin-Change");
  });
});
