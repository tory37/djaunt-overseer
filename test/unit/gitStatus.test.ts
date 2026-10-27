import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  branchStatusLabel,
  commitHashesIn,
  printedCommitsIn,
  commitSessionId,
  describeCommitsArgs,
  githubCommitUrl,
  indexCommitAuthorship,
  parseBranchStatus,
  parseLog,
  statusArgs,
} from "../../src/gitStatus";

describe("branch status", () => {
  it("reads branch, ahead and behind, and changed files, skipping ignored ones", () => {
    const status = parseBranchStatus(
      [
        "# branch.oid 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
        "# branch.head fix/proj-2567",
        "# branch.upstream origin/fix/proj-2567",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
        "2 R. N... 100644 100644 100644 aaa bbb R100 src/b.ts\tsrc/old.ts",
        "? notes.txt",
        "! dist/extension.js",
        "",
      ].join("\n"),
    );
    expect(status).toEqual({
      branch: "fix/proj-2567",
      headShortHash: "1a2b3c4",
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      changedFileCount: 3,
    });
    expect(branchStatusLabel(status)).toBe("fix/proj-2567 · ↑2 ↓1 · 3 changed");
  });

  it("labels a clean branch with no upstream by name alone", () => {
    const status = parseBranchStatus("# branch.oid 1a2b3c4d5e\n# branch.head main\n");
    expect(branchStatusLabel(status)).toBe("main");
  });

  it("labels a detached HEAD by its short hash, and an empty repo as having no commits", () => {
    expect(branchStatusLabel(parseBranchStatus("# branch.oid 9f8e7d6c5b\n# branch.head (detached)\n"))).toBe("detached 9f8e7d6");
    expect(branchStatusLabel(parseBranchStatus("# branch.oid (initial)\n# branch.head main\n"))).toBe("main");
    expect(branchStatusLabel(parseBranchStatus("# branch.oid (initial)\n# branch.head (detached)\n"))).toBe("no commits");
  });

  it("parses what git itself prints for a repo with a change", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-git-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
      git("init", "-q", "-b", "main");
      fs.writeFileSync(path.join(repoRoot, "a.txt"), "one\n");
      git("add", "a.txt");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
      fs.writeFileSync(path.join(repoRoot, "a.txt"), "two\n");
      const porcelainText = execFileSync("git", statusArgs(repoRoot), { encoding: "utf8" });
      expect(branchStatusLabel(parseBranchStatus(porcelainText))).toBe("main · 1 changed");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("session commits", () => {
  it("looks up the hashes a repo has and skips the rest", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-git-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
      git("init", "-q", "-b", "main");
      fs.writeFileSync(path.join(repoRoot, "a.txt"), "one\n");
      git("add", "a.txt");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
      const shortHash = git("rev-parse", "--short", "HEAD").trim();
      const logText = execFileSync("git", describeCommitsArgs(repoRoot, [shortHash, "deadbee"]), { encoding: "utf8" });
      expect(parseLog(logText).map((commit) => commit.subject)).toEqual(["first"]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("commit log", () => {
  it("parses git log records, refs included", () => {
    const record = (fields: string[]) => fields.join("\x1f") + "\x1e";
    const logText =
      record(["a20a66bc0ffee", "a20a66b", "Tory", "1760000000", "Fix login", "HEAD -> main, origin/main"]) +
      "\n" +
      record(["b31c4d5e0ffee", "b31c4d5", "Sam", "1759990000", "Subject with | pipe", ""]) +
      "\n";
    expect(parseLog(logText)).toEqual([
      { hash: "a20a66bc0ffee", shortHash: "a20a66b", author: "Tory", committedAtMs: 1760000000000, subject: "Fix login", refs: ["HEAD -> main", "origin/main"] },
      { hash: "b31c4d5e0ffee", shortHash: "b31c4d5", author: "Sam", committedAtMs: 1759990000000, subject: "Subject with | pipe", refs: [] },
    ]);
  });

  it("matches a full hash to the session whose transcript printed its short hash", () => {
    const authorship = indexCommitAuthorship(new Map([["session-a", ["a20a66b"]], ["session-b", ["a20a66b9f"]]]));
    expect(commitSessionId("a20a66b9f1234", authorship)).toBe("session-a");
    expect(commitSessionId("a20a66c0000", authorship)).toBeUndefined();
  });

  it("finds printed and recorded commit hashes, including root commits", () => {
    expect(commitHashesIn('"[main (root-commit) 1a2b3c4] first" "gitOperation":{"commit":{"sha":"5d6e7f8a"')).toEqual(["1a2b3c4", "5d6e7f8a"]);
    expect(commitHashesIn("see [link] here and [main notahash] x")).toEqual([]);
  });

  it("reads printed commits with branch and subject", () => {
    expect(printedCommitsIn("Switched\n[feat/x 09912f0e8] PROJ-1: fix tile\n 2 files changed\n[main (root-commit) 1a2b3c4] first")).toEqual([
      { shortHash: "09912f0e8", branch: "feat/x", subject: "PROJ-1: fix tile" },
      { shortHash: "1a2b3c4", branch: "main", subject: "first" },
    ]);
  });

  it("builds a GitHub commit URL from ssh and https remotes only", () => {
    expect(githubCommitUrl("git@github.com:tory37/djaunt-overseer.git", "abc")).toBe("https://github.com/tory37/djaunt-overseer/commit/abc");
    expect(githubCommitUrl("https://github.com/tory37/djaunt-overseer\n", "abc")).toBe("https://github.com/tory37/djaunt-overseer/commit/abc");
    expect(githubCommitUrl("https://gitlab.com/acme/app.git", "abc")).toBeUndefined();
  });
});
