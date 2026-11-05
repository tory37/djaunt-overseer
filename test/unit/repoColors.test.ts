import { describe, expect, it } from "vitest";
import type { BranchStatus } from "../../src/gitStatus";
import { REPO_CLEAN_COLOR_ID, REPO_DIRTY_COLOR_ID, REPO_FAILED_COLOR_ID, REPO_LOADING_COLOR_ID, repoRowColors } from "../../src/repoColors";

const branchStatus = (changedFileCount: number): BranchStatus => ({
  branch: "main",
  headShortHash: "abc1234",
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  changedFileCount,
});

describe("repoRowColors", () => {
  it("colors a clean repo's icon and label with the clean color", () => {
    expect(repoRowColors({ kind: "ready", branchStatus: branchStatus(0) })).toEqual({
      iconName: "repo",
      iconColorId: REPO_CLEAN_COLOR_ID,
      labelColorId: REPO_CLEAN_COLOR_ID,
    });
  });

  it("colors a dirty repo's icon and label with the git modified color", () => {
    expect(repoRowColors({ kind: "ready", branchStatus: branchStatus(3) })).toEqual({
      iconName: "repo",
      iconColorId: REPO_DIRTY_COLOR_ID,
      labelColorId: REPO_DIRTY_COLOR_ID,
    });
  });

  it("shows a warning icon and leaves the label alone when git failed", () => {
    expect(repoRowColors({ kind: "failed", message: "boom" })).toEqual({
      iconName: "warning",
      iconColorId: REPO_FAILED_COLOR_ID,
      labelColorId: undefined,
    });
  });

  it("mutes the icon while loading and leaves the label alone", () => {
    expect(repoRowColors({ kind: "loading" })).toEqual({ iconName: "repo", iconColorId: REPO_LOADING_COLOR_ID, labelColorId: undefined });
  });
});
