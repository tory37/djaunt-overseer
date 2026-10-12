import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { branchStatusLabel, parseBranchStatus, statusArgs } from "../../src/gitStatus";

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
