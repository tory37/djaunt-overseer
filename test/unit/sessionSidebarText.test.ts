import { describe, expect, it } from "vitest";
import { EMPTY_POPULATE_SUMMARY, PopulateSummary } from "../../src/populateMerge";
import { linkRowTitle, metaLine, metaTitle, recheckSummaryText, shortLinkStatus, stateSentence, summaryPrompt } from "../../src/sessionSidebarText";

describe("metaLine", () => {
  it("joins the repo, branch, and other repos", () => {
    expect(metaLine("~/src/web-app", "fix/proj-2567-login-timeout", ["api"])).toBe("web-app · fix/proj-2567-login-timeout · +api");
  });

  it("lists every other repo after one plus sign", () => {
    expect(metaLine("~/src/web-app", "main", ["api", "infra"])).toBe("web-app · main · +api, infra");
  });

  it("drops the parts that are missing", () => {
    expect(metaLine("~/src/docs", undefined, [])).toBe("docs");
    expect(metaLine(undefined, "main", [])).toBe("main");
    expect(metaLine(undefined, undefined, [])).toBe("");
  });
});

describe("metaTitle", () => {
  it("shows the full path and the branch", () => {
    expect(metaTitle("~/src/web-app", "main")).toBe("~/src/web-app · main");
  });

  it("drops a missing branch", () => {
    expect(metaTitle("~/src/web-app", undefined)).toBe("~/src/web-app");
  });
});

describe("stateSentence", () => {
  it("names a live session in this window", () => {
    expect(stateSentence({ runKind: "idle", lastActive: "now", isBackgroundAgent: false })).toBe("Idle in this window");
    expect(stateSentence({ runKind: "busy", lastActive: "now", isBackgroundAgent: false })).toBe("Working in this window");
  });

  it("gives a paused session its last activity", () => {
    expect(stateSentence({ runKind: "paused", lastActive: "2d ago", isBackgroundAgent: false })).toBe("Paused · last active 2d ago");
  });

  it("says only Paused when the last activity is unknown", () => {
    expect(stateSentence({ runKind: "paused", lastActive: undefined, isBackgroundAgent: false })).toBe("Paused");
  });

  it("offers a fork for a session running in another terminal", () => {
    expect(stateSentence({ runKind: "elsewhere", lastActive: "4m ago", isBackgroundAgent: false })).toBe(
      "Running in another terminal · fork to work on it here",
    );
  });

  it("offers attach or fork for a background agent", () => {
    expect(stateSentence({ runKind: "elsewhere", lastActive: "4m ago", isBackgroundAgent: true })).toBe(
      "Running as a background agent · attach or fork to work on it here",
    );
  });
});

describe("shortLinkStatus", () => {
  it("strips a leading open state", () => {
    expect(shortLinkStatus("open · approved")).toBe("approved");
    expect(shortLinkStatus("open · review required")).toBe("review required");
  });

  it("keeps any other status as is", () => {
    expect(shortLinkStatus("In Progress")).toBe("In Progress");
    expect(shortLinkStatus("merged")).toBe("merged");
  });

  it("passes a missing status through", () => {
    expect(shortLinkStatus(undefined)).toBeUndefined();
  });
});

describe("linkRowTitle", () => {
  const row = {
    displayId: "PROJ-2567",
    label: "Session times out",
    statusText: "In Progress",
    agentNote: undefined,
    mark: undefined,
  };

  it("joins the key, label, and status", () => {
    expect(linkRowTitle(row)).toBe("PROJ-2567 — Session times out — In Progress");
  });

  it("adds the agent note and the pin note", () => {
    expect(linkRowTitle({ ...row, agentNote: "owns the fix", mark: "pinned" })).toBe(
      "PROJ-2567 — Session times out — In Progress — Agent: owns the fix — Pinned by you",
    );
  });

  it("drops the parts that are missing", () => {
    expect(linkRowTitle({ ...row, label: undefined, statusText: undefined, mark: "removed" })).toBe("PROJ-2567");
  });
});

describe("recheckSummaryText", () => {
  function summary(added: Partial<PopulateSummary["added"]>, notesUpdated = 0): PopulateSummary {
    return { added: { ...EMPTY_POPULATE_SUMMARY.added, ...added }, notesUpdated };
  }

  it("names up to two tickets and counts the other kinds", () => {
    const rechecked = summary({ tickets: ["ASSMNT-2892"], pullRequests: ["pr"], commits: ["a", "b", "c", "d", "e"] }, 3);
    expect(recheckSummaryText(rechecked)).toBe("Added ASSMNT-2892, 1 PR, 5 commits. Updated 3 notes.");
    expect(recheckSummaryText(summary({ tickets: ["PROJ-1", "PROJ-2"] }))).toBe("Added PROJ-1, PROJ-2.");
  });

  it("counts tickets past two", () => {
    expect(recheckSummaryText(summary({ tickets: ["PROJ-1", "PROJ-2", "PROJ-3"], artifacts: ["a", "b"] }))).toBe("Added 3 tickets, 2 artifacts.");
  });

  it("uses the singular for one of a kind", () => {
    expect(recheckSummaryText(summary({ commits: ["a"], artifacts: ["b"] }, 1))).toBe("Added 1 commit, 1 artifact. Updated 1 note.");
  });

  it("reports only updated notes when nothing was added", () => {
    expect(recheckSummaryText(summary({}, 2))).toBe("Updated 2 notes.");
  });

  it("says nothing is new when nothing changed", () => {
    expect(recheckSummaryText(EMPTY_POPULATE_SUMMARY)).toBe("Nothing new. Working on is up to date.");
  });
});

describe("summaryPrompt", () => {
  it("offers a Haiku run when there is no summary yet", () => {
    expect(summaryPrompt(undefined, true)).toEqual({ kind: "empty", text: "No summary yet.", canRunHaiku: true });
  });

  it("offers no run without a transcript", () => {
    expect(summaryPrompt(undefined, false)).toEqual({ kind: "empty", text: "No summary yet.", canRunHaiku: false });
  });

  it("flags a stale summary", () => {
    expect(summaryPrompt({ isStale: true }, true)).toEqual({ kind: "stale", text: "Potentially out of date.", canRunHaiku: true });
  });

  it("shows nothing for a fresh summary", () => {
    expect(summaryPrompt({ isStale: false }, true)).toBeUndefined();
  });
});
