import { describe, expect, it } from "vitest";
import {
  EMPTY_SESSION_WORK,
  mergeSessionWork,
  normalizeCommitHash,
  normalizePullRequestUrl,
  pullRequestLabel,
  readSessionWork,
  untrackedKinds,
  withDeclaredCommit,
} from "../../src/agentWork";

describe("readSessionWork", () => {
  it("keeps valid entries and skips the rest", () => {
    const work = readSessionWork({
      commits: [{ hash: "ABC1234", note: "fix", addedAt: 5 }, { hash: "nope" }, "abc1234", null],
      pullRequests: [{ url: "https://github.com/o/r/pull/3" }, { url: "https://example.com/pull/3" }],
      populatedAt: 9,
    });
    expect(work).toEqual({
      commits: [{ hash: "abc1234", note: "fix", addedAt: 5 }],
      pullRequests: [{ url: "https://github.com/o/r/pull/3", addedAt: 0 }],
      populatedAt: 9,
    });
  });

  it.each([undefined, null, [], "x"])("returns empty work for %o", (entries) => {
    expect(readSessionWork(entries)).toEqual(EMPTY_SESSION_WORK);
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

  it("merges a copied session without losing the target's entries", () => {
    const target = { commits: [{ hash: "abc1234", addedAt: 1 }], pullRequests: [] };
    const incoming = { commits: [{ hash: "abc1234", note: "dup", addedAt: 2 }, { hash: "def5678", addedAt: 3 }], pullRequests: [], populatedAt: 4 };
    expect(mergeSessionWork(target, incoming)).toEqual({
      commits: [{ hash: "abc1234", addedAt: 1 }, { hash: "def5678", addedAt: 3 }],
      pullRequests: [],
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
