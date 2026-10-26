import { describe, expect, it } from "vitest";
import { buildGroups, buildSectionGroups, GroupingInput, pinnedSessionTitle } from "../../src/grouping";
import { SessionMeta } from "../../src/indexer";
import { UNGROUPED_REF, userGroupRef } from "../../src/registry";

function sessionMeta(sessionId: string, overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId,
    transcriptFile: `/tmp/${sessionId}.jsonl`,
    startCwd: "/repo",
    resumeCwd: "/repo",
    gitBranch: undefined,
    firstPrompt: undefined,
    customTitle: undefined,
    agentName: undefined,
    aiTitle: undefined,
    prUrl: undefined,
    lastPrompt: undefined,
    recap: undefined,
    homeRepo: "/repo",
    otherReposTouched: [],
    commitHashes: [],
    lastActivityMs: 0,
    sizeBytes: 0,
    ...overrides,
  };
}

function groupingInput(sessions: SessionMeta[], overrides: Partial<GroupingInput> = {}): GroupingInput {
  return {
    pinnedSessionIds: sessions.map((session) => session.sessionId),
    sessionsById: new Map(sessions.map((session) => [session.sessionId, session])),
    userGroups: [],
    assignments: {},
    labels: {},
    pendingSessions: {},
    groupOrder: [],
    sessionOrder: [],
    ...overrides,
  };
}

function summarize(input: GroupingInput): Array<[string, string[]]> {
  return buildGroups(input).map((group) => [group.label, group.sessions.map((pinned) => pinned.sessionId)]);
}

describe("buildGroups", () => {
  it("puts a session with a ticket key in its title but no assignment in Ungrouped", () => {
    const sessions = [sessionMeta("a", { customTitle: "PROJ-1 triage", gitBranch: "fix/proj-1-followup" })];

    expect(summarize(groupingInput(sessions))).toEqual([["Ungrouped", ["a"]]]);
  });

  it("puts user groups first, including empty ones", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, {
      userGroups: [
        { id: "g1", name: "Waiting on review" },
        { id: "g2", name: "Empty" },
      ],
      assignments: { a: userGroupRef("g1") },
    });

    expect(summarize(input)).toEqual([
      ["Waiting on review", ["a"]],
      ["Empty", []],
    ]);
  });

  it("puts a session assigned to an unknown group ref in Ungrouped", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, { assignments: { a: "auto:CR-9" } });

    expect(summarize(input)).toEqual([["Ungrouped", ["a"]]]);
  });

  it("falls back to Ungrouped when the assigned user group was deleted", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, { assignments: { a: userGroupRef("gone") } });

    expect(summarize(input)).toEqual([["Ungrouped", ["a"]]]);
  });


  it("files a brand-new session under Ungrouped before Claude writes a transcript", () => {
    const input = groupingInput([], {
      pinnedSessionIds: ["new"],
      labels: { new: "CR-5 spike" },
      pendingSessions: { new: { cwd: "/repo", createdAtMs: 1 } },
    });

    expect(summarize(input)).toEqual([["Ungrouped", ["new"]]]);
  });

  it("stops treating a session as pending once its transcript is indexed", () => {
    const groups = buildGroups(
      groupingInput([sessionMeta("started", {})], {
        pinnedSessionIds: ["started"],
        pendingSessions: { started: { cwd: "/repo", createdAtMs: 1 } },
      }),
    );

    expect(groups[0].sessions[0].pending).toBeUndefined();
  });

  it("titles a terminal session, files it by its assignment, and sorts it by creation time", () => {
    const olderClaude = sessionMeta("claude", { lastActivityMs: 1_000 });
    const groups = buildGroups(
      groupingInput([olderClaude], {
        pinnedSessionIds: ["claude", "shell", "ticket-shell"],
        userGroups: [{ id: "g1", name: "Logs" }],
        assignments: { "ticket-shell": userGroupRef("g1") },
        terminalSessions: {
          shell: { cwd: "/repo", createdAtMs: 2_000 },
          "ticket-shell": { cwd: "/repo", createdAtMs: 3_000 },
        },
      }),
    );

    const ungrouped = groups.find((group) => group.ref === UNGROUPED_REF);
    expect(ungrouped?.sessions.map((pinned) => pinned.sessionId)).toEqual(["shell", "claude"]);
    expect(pinnedSessionTitle(ungrouped!.sessions[0])).toBe("Terminal");
    expect(groups.find((group) => group.ref === userGroupRef("g1"))?.sessions[0].terminal?.cwd).toBe("/repo");
  });

  it("keeps pinned sessions missing from the index under Ungrouped", () => {
    const input = groupingInput([], { pinnedSessionIds: ["missing"] });

    expect(summarize(input)).toEqual([["Ungrouped", ["missing"]]]);
  });

  it("applies a saved group order and a saved session order, ignoring unknown group refs", () => {
    const sessions = [
      sessionMeta("a", { customTitle: "PROJ-1 triage", lastActivityMs: 10 }),
      sessionMeta("b", { customTitle: "PROJ-1 notes", lastActivityMs: 30 }),
      sessionMeta("c", { customTitle: "CR-9 fix", lastActivityMs: 50 }),
      sessionMeta("d", { customTitle: "chat", lastActivityMs: 40 }),
    ];

    const input = groupingInput(sessions, {
      userGroups: [
        { id: "g1", name: "PROJ-1" },
        { id: "g2", name: "CR-9" },
      ],
      assignments: { a: userGroupRef("g1"), b: userGroupRef("g1"), c: userGroupRef("g2") },
      groupOrder: [UNGROUPED_REF, "auto:PROJ-1", userGroupRef("g1"), userGroupRef("g2")],
      sessionOrder: ["a", "b"],
    });

    expect(summarize(input)).toEqual([
      ["Ungrouped", ["d"]],
      ["PROJ-1", ["a", "b"]],
      ["CR-9", ["c"]],
    ]);
  });

  it("puts a group missing from the saved order on top", () => {
    const sessions = [sessionMeta("a", { customTitle: "PROJ-1 triage" }), sessionMeta("c", { customTitle: "chat" })];

    const input = groupingInput(sessions, {
      userGroups: [{ id: "g1", name: "PROJ-1" }],
      assignments: { a: userGroupRef("g1") },
      groupOrder: [userGroupRef("g1")],
    });

    expect(summarize(input).map(([label]) => label)).toEqual(["Ungrouped", "PROJ-1"]);
  });

});

describe("buildSectionGroups", () => {
  const sessions = [
    sessionMeta("claude-a", { customTitle: "PROJ-1 fix", lastActivityMs: 20 }),
    sessionMeta("claude-b", { customTitle: "chat", lastActivityMs: 10 }),
  ];
  const input = groupingInput(sessions, {
    pinnedSessionIds: ["claude-a", "claude-b", "term-a", "term-b"],
    userGroups: [
      { id: "g1", name: "Empty" },
      { id: "g2", name: "Mixed" },
    ],
    assignments: { "claude-b": userGroupRef("g2"), "term-b": userGroupRef("g2") },
    labels: { "term-a": "PROJ-1 logs" },
    terminalSessions: { "term-a": { cwd: "/repo", createdAtMs: 5 }, "term-b": { cwd: "/repo", createdAtMs: 6 } },
  });
  const summarizeSection = (section: "claude" | "terminal") =>
    buildSectionGroups(input, section).map((group) => [group.label, group.sessions.map((pinned) => pinned.sessionId)]);

  it("keeps terminals out of the Sessions view, and keeps its empty user groups", () => {
    expect(summarizeSection("claude")).toEqual([
      ["Empty", []],
      ["Mixed", ["claude-b"]],
      ["Ungrouped", ["claude-a"]],
    ]);
  });

  it("shows only terminals in the Terminals view, in the groups that hold one", () => {
    expect(summarizeSection("terminal")).toEqual([
      ["Mixed", ["term-b"]],
      ["Ungrouped", ["term-a"]],
    ]);
  });
});
