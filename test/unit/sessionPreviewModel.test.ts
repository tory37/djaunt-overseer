import { describe, expect, it } from "vitest";
import { LiveSession } from "../../src/liveParse";
import { LinkCandidate } from "../../src/linkCandidates";
import { LinkStatus } from "../../src/linkStatus";
import {
  distinctLastPrompt,
  previewRunState,
  previewTabTitle,
  recentConversation,
  shownPreviewLinks,
  sidebarRunKind,
} from "../../src/sessionPreviewModel";

function liveSession(overrides: Partial<LiveSession>): LiveSession {
  return {
    sessionId: "a",
    agentId: undefined,
    pid: 4821,
    kind: "interactive",
    status: "idle",
    name: undefined,
    cwd: undefined,
    processCount: 1,
    ...overrides,
  };
}

describe("previewRunState", () => {
  it("offers a resume for a paused session", () => {
    expect(previewRunState(undefined)).toEqual({ stateLabel: "Paused", resumeLabel: "Resume", isElsewhere: false });
  });

  it("offers a fork for a session live in another terminal", () => {
    expect(previewRunState(liveSession({}))).toEqual({
      stateLabel: "Running in another terminal (pid 4821)",
      resumeLabel: "Fork here",
      isElsewhere: true,
    });
  });

  it("offers attach for a background agent", () => {
    const runState = previewRunState(liveSession({ kind: "background", agentId: "agent-1" }));
    expect(runState.resumeLabel).toBe("Attach or fork");
  });
});

describe("previewTabTitle", () => {
  it("shortens long titles", () => {
    expect(previewTabTitle("abcdefghij", 5)).toBe("Preview: abcd…");
    expect(previewTabTitle("abc", 5)).toBe("Preview: abc");
  });
});

describe("recentConversation", () => {
  it("keeps the newest user and Claude turns and drops tool calls", () => {
    const turns = [
      { speaker: "user" as const, text: "first" },
      { speaker: "claude" as const, text: "reply" },
      { speaker: "tool" as const, text: "Bash: run tests" },
      { speaker: "user" as const, text: "second" },
    ];
    expect(recentConversation(turns, 2)).toEqual([
      { speaker: "claude", text: "reply" },
      { speaker: "user", text: "second" },
    ]);
  });

  it("puts long turns on one clipped line", () => {
    const [turn] = recentConversation([{ speaker: "claude", text: `line one\n\n${"x".repeat(700)}` }]);
    expect(turn.text.startsWith("line one x")).toBe(true);
    expect(turn.text.length).toBe(600);
  });
});

describe("distinctLastPrompt", () => {
  it("hides the last prompt when it is the first one", () => {
    expect(distinctLastPrompt("fix it", "fix it")).toBeUndefined();
    expect(distinctLastPrompt("fix it", "ship it")).toBe("ship it");
  });
});

describe("sidebarRunKind", () => {
  it("follows the live status when the terminal is here", () => {
    expect(sidebarRunKind(true, liveSession({ status: "busy" }))).toBe("busy");
    expect(sidebarRunKind(true, undefined)).toBe("idle");
  });

  it("tells paused from running somewhere else when there is no terminal here", () => {
    expect(sidebarRunKind(false, undefined)).toBe("paused");
    expect(sidebarRunKind(false, liveSession({ pid: 48211 }))).toBe("elsewhere");
  });
});

describe("shownPreviewLinks", () => {
  const candidate = (kind: LinkCandidate["kind"], id: string): LinkCandidate => ({
    kind,
    id,
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
  });
  const openPr = candidate("pr", "acme/web/pull/1");
  const mergedPr = candidate("pr", "acme/web/pull/2");
  const unknownPr = candidate("pr", "acme/web/pull/3");
  const commit = candidate("commit", "0123456789abcdef");
  const statuses = new Map<string, LinkStatus>([
    [openPr.id, { text: "open", colorKey: "open" }],
    [mergedPr.id, { text: "merged", colorKey: "merged" }],
  ]);
  const statusOf = (link: LinkCandidate): LinkStatus | undefined => statuses.get(link.id);
  const allLinks = [openPr, mergedPr, unknownPr, commit];

  it("drops commits and finished PRs by default, keeping order", () => {
    const settings = { enabledKinds: new Set<LinkCandidate["kind"]>(["pr"]), jiraBaseUrl: "", showsOnlyOpenPrs: true };
    expect(shownPreviewLinks(allLinks, statusOf, settings)).toEqual([openPr, unknownPr]);
  });

  it("shows everything when commits are on and open-only is off", () => {
    const settings = { enabledKinds: new Set<LinkCandidate["kind"]>(["pr", "commit"]), jiraBaseUrl: "", showsOnlyOpenPrs: false };
    expect(shownPreviewLinks(allLinks, statusOf, settings)).toEqual(allLinks);
  });
});
