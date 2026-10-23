import { describe, expect, it } from "vitest";
import {
  EMPTY_SESSION_WORK,
  isSameCommit,
  mergeSessionWork,
  normalizeCommitHash,
  normalizePullRequestUrl,
  pullRequestLabel,
  readSessionWork,
  untrackedKinds,
  withDeclaredCommit,
  withDeclaredPullRequest,
} from "../../src/agentWork";

describe("readSessionWork", () => {
  it("collapses one commit saved at two lengths into the longer hash, earliest time, and newer note", () => {
    const work = readSessionWork({
      commits: [
        { hash: "09fd90e", note: "old", addedAt: 5 },
        { hash: "abc1234", addedAt: 6 },
        { hash: "09fd90e1", note: "new", addedAt: 9 },
      ],
    });
    expect(work.commits).toEqual([
      { hash: "09fd90e1", note: "new", addedAt: 5 },
      { hash: "abc1234", addedAt: 6 },
    ]);
  });

  it("reads a file written before parents and artifacts existed", () => {
    const work = readSessionWork({ commits: [], pullRequests: [{ url: "https://github.com/o/r/pull/3", note: "fix", addedAt: 1 }] });
    expect(work).toEqual({ commits: [], pullRequests: [{ url: "https://github.com/o/r/pull/3", note: "fix", addedAt: 1 }], artifacts: [] });
  });

  it("keeps valid parents and artifacts and drops bad ones", () => {
    const work = readSessionWork({
      pullRequests: [
        { url: "https://github.com/o/r/pull/3", parentKey: "proj-1", addedAt: 1 },
        { url: "https://github.com/o/r/pull/4", parentKey: "not a key", addedAt: 1 },
      ],
      artifacts: [
        { url: "https://claude.ai/artifact/a-1", note: "report", parentKey: "https://github.com/o/r/pull/3", addedAt: 2 },
        { url: "https://claude.ai/code/artifact/a-2", parentKey: 7 },
        { url: "https://example.com/artifact/x" },
      ],
    });
    expect(work.pullRequests).toEqual([
      { url: "https://github.com/o/r/pull/3", parentKey: "PROJ-1", addedAt: 1 },
      { url: "https://github.com/o/r/pull/4", addedAt: 1 },
    ]);
    expect(work.artifacts).toEqual([
      { url: "https://claude.ai/artifact/a-1", note: "report", parentKey: "https://github.com/o/r/pull/3", addedAt: 2 },
      { url: "https://claude.ai/code/artifact/a-2", addedAt: 0 },
    ]);
  });

  it("keeps a PR's parent when the agent declares it again without one", () => {
    const withParent = withDeclaredPullRequest(EMPTY_SESSION_WORK, "https://github.com/o/r/pull/3", "draft", 1, "PROJ-1");
    expect(withDeclaredPullRequest(withParent, "https://github.com/o/r/pull/3", "merged", 2).pullRequests).toEqual([
      { url: "https://github.com/o/r/pull/3", note: "merged", parentKey: "PROJ-1", addedAt: 1 },
    ]);
  });

  it("keeps valid entries and skips the rest", () => {
    const work = readSessionWork({
      commits: [{ hash: "ABC1234", note: "fix", addedAt: 5 }, { hash: "nope" }, "abc1234", null],
      pullRequests: [{ url: "https://github.com/o/r/pull/3" }, { url: "https://example.com/pull/3" }],
      populatedAt: 9,
    });
    expect(work).toEqual({
      commits: [{ hash: "abc1234", note: "fix", addedAt: 5 }],
      pullRequests: [{ url: "https://github.com/o/r/pull/3", addedAt: 0 }],
      artifacts: [],
      populatedAt: 9,
    });
  });

  it.each([undefined, null, [], "x"])("returns empty work for %o", (entries) => {
    expect(readSessionWork(entries)).toEqual(EMPTY_SESSION_WORK);
  });
});

describe("isSameCommit", () => {
  it("matches a hash and its longer abbreviation in any case", () => {
    expect(isSameCommit("09fd90e", "09FD90E1")).toBe(true);
    expect(isSameCommit("09fd90e1", "09fd90e")).toBe(true);
  });

  it("rejects different commits, prefixes under 7 chars, and non-hex ids", () => {
    expect(isSameCommit("09fd90e", "09fd91e1")).toBe(false);
    expect(isSameCommit("09fd90", "09fd90e1")).toBe(false);
    expect(isSameCommit("main-br", "main-branch")).toBe(false);
  });
});

describe("normalizing ids", () => {
  it.each([
    ["ABC1234", "abc1234"],
    ["abc12", undefined],
    ["xyz1234", undefined],
  ])("normalizes commit %s", (rawHash, expectedHash) => {
    expect(normalizeCommitHash(rawHash)).toBe(expectedHash);
  });

  it("trims a PR URL to the PR itself and labels it", () => {
    const url = normalizePullRequestUrl("https://github.com/o/r/pull/12/files#diff");
    expect(url).toBe("https://github.com/o/r/pull/12");
    expect(pullRequestLabel(url ?? "")).toBe("o/r#12");
  });
});

describe("declaring work", () => {
  it("keeps the first time and updates the note", () => {
    const once = withDeclaredCommit(EMPTY_SESSION_WORK, "abc1234", "old", 10);
    expect(withDeclaredCommit(once, "abc1234", "new", 20).commits).toEqual([{ hash: "abc1234", note: "new", addedAt: 10 }]);
  });

  it("updates an abbreviated commit in place and keeps the longer hash", () => {
    const once = withDeclaredCommit(EMPTY_SESSION_WORK, "09fd90e", "old", 10);
    const longer = withDeclaredCommit(once, "09fd90e1", "new", 20);
    expect(longer.commits).toEqual([{ hash: "09fd90e1", note: "new", addedAt: 10 }]);
    expect(withDeclaredCommit(longer, "09fd90e", undefined, 30).commits).toEqual([{ hash: "09fd90e1", note: "new", addedAt: 10 }]);
  });

  it("skips an incoming commit the target has at another length", () => {
    const target = { commits: [{ hash: "09fd90e", addedAt: 1 }], pullRequests: [], artifacts: [] };
    const incoming = { commits: [{ hash: "09fd90e1", addedAt: 2 }], pullRequests: [], artifacts: [] };
    expect(mergeSessionWork(target, incoming).commits).toEqual([{ hash: "09fd90e", addedAt: 1 }]);
  });

  it("merges a copied session without losing the target's entries", () => {
    const target = { commits: [{ hash: "abc1234", addedAt: 1 }], pullRequests: [], artifacts: [] };
    const incoming = {
      commits: [{ hash: "abc1234", note: "dup", addedAt: 2 }, { hash: "def5678", addedAt: 3 }],
      pullRequests: [],
      artifacts: [{ url: "https://claude.ai/artifact/a1", addedAt: 5 }],
      populatedAt: 4,
    };
    expect(mergeSessionWork(target, incoming)).toEqual({
      commits: [{ hash: "abc1234", addedAt: 1 }, { hash: "def5678", addedAt: 3 }],
      pullRequests: [],
      artifacts: [{ url: "https://claude.ai/artifact/a1", addedAt: 5 }],
      populatedAt: 4,
    });
  });
});

describe("untrackedKinds", () => {
  it("lists every empty kind before a populate run", () => {
    const work = withDeclaredCommit(EMPTY_SESSION_WORK, "abc1234", undefined, 1);
    expect(untrackedKinds(work, 0)).toEqual(["tickets", "pullRequests"]);
  });

  it("treats everything as tracked after a populate run", () => {
    expect(untrackedKinds({ ...EMPTY_SESSION_WORK, populatedAt: 5 }, 0)).toEqual([]);
  });
});
