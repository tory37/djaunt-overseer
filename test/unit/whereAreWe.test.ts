import { describe, expect, it } from "vitest";
import { LiveSession } from "../../src/liveParse";
import {
  MERGE_SYSTEM_PROMPT,
  REPLY_END_SENTINEL,
  DEFAULT_TIMEOUT_MINUTES,
  SKIP_REASON_BACKGROUND,
  SKIP_REASON_NOT_LIVE,
  SKIP_REASON_TERMINAL_CLOSED,
  buildMergeInput,
  briefFile,
  checkTarget,
  noTargetsMessage,
  progressMessage,
  unansweredReason,
  whereAreWeTimeoutMs,
  briefRunDir,
  fallbackBrief,
  isCompleteReply,
  mergeArgs,
  pickTargets,
  replyBody,
  replyFile,
  whereAreWePrompt,
  whereAreWeRunId,
} from "../../src/whereAreWe";

const CLAUDE_HOME = "/home/me/.claude";
const RUN_ID = "2026-11-23T09-05-12";
const REPLY_PATH = "/home/me/.claude/overseer/briefs/2026-11-23T09-05-12/sid-1.md";

function liveSession(sessionId: string, status: LiveSession["status"], name?: string): LiveSession {
  return { sessionId, agentId: undefined, pid: 1, kind: "interactive", status, name, cwd: "/repo", processCount: 1 };
}

describe("where are we paths", () => {
  it("builds a sortable, filesystem-safe run id from the local time", () => {
    expect(whereAreWeRunId(new Date(2026, 10, 23, 9, 5, 12))).toBe(RUN_ID);
  });

  it("puts the run folder, reply files, and brief under overseer/briefs", () => {
    expect(briefRunDir(CLAUDE_HOME, RUN_ID)).toBe("/home/me/.claude/overseer/briefs/2026-11-23T09-05-12");
    expect(replyFile(CLAUDE_HOME, RUN_ID, "sid-1")).toBe(REPLY_PATH);
    expect(briefFile(CLAUDE_HOME, RUN_ID)).toBe("/home/me/.claude/overseer/briefs/2026-11-23T09-05-12.md");
  });
});

describe("whereAreWePrompt", () => {
  it("is one line that names the reply path, the headings, the cap, and the sentinel", () => {
    const prompt = whereAreWePrompt(REPLY_PATH);
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain(`only to ${REPLY_PATH}`);
    expect(prompt).toContain("overwrite");
    for (const heading of ["Goal", "Done", "State", "Next", "Needs Tory"]) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toContain("120 words");
    expect(prompt).toContain(REPLY_END_SENTINEL);
    expect(prompt).not.toContain("Extra instructions");
  });

  it("appends extra instructions on the same line", () => {
    const prompt = whereAreWePrompt(REPLY_PATH, "mention the ticket\nand the PR");
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain("Extra instructions: mention the ticket and the PR");
  });

  it("ignores blank extra instructions", () => {
    expect(whereAreWePrompt(REPLY_PATH, "  \n ")).toBe(whereAreWePrompt(REPLY_PATH));
  });
});

describe("reply sentinel", () => {
  it("is complete only when the trimmed text ends with the sentinel", () => {
    expect(isCompleteReply(`## Goal\nShip it\n${REPLY_END_SENTINEL}\n\n`)).toBe(true);
    expect(isCompleteReply("## Goal\nShip it\n")).toBe(false);
    expect(isCompleteReply(`${REPLY_END_SENTINEL}\nmore text`)).toBe(false);
    expect(isCompleteReply("")).toBe(false);
  });

  it("strips the sentinel from the body", () => {
    expect(replyBody(`## Goal\nShip it\n${REPLY_END_SENTINEL}\n`)).toBe("## Goal\nShip it");
    expect(replyBody("## Goal\nPartial")).toBe("## Goal\nPartial");
  });
});

describe("pickTargets", () => {
  it("sends idle sessions now, busy ones when idle, and skips the rest with a reason", () => {
    const live = [
      liveSession("idle-here", "idle"),
      liveSession("busy-here", "busy"),
      liveSession("idle-elsewhere", "idle", "Auth work"),
      liveSession("background-here", "background"),
    ];
    const targets = pickTargets(live, (sessionId) => sessionId !== "idle-elsewhere");
    expect(targets.sendNow.map((session) => session.sessionId)).toEqual(["idle-here"]);
    expect(targets.sendWhenIdle.map((session) => session.sessionId)).toEqual(["busy-here"]);
    expect(targets.skipped).toEqual([
      { sessionId: "idle-elsewhere", reason: "no terminal in this window" },
      { sessionId: "background-here", reason: "background agent, no terminal to type into" },
    ]);
  });
});

describe("merge", () => {
  const replies = [
    { sessionId: "sid-1", title: "Auth fix", repo: "api", branch: "fix/auth", body: "## Goal\nFix login" },
    { sessionId: "sid-2", title: "Docs", body: "## Goal\nWrite docs" },
  ];
  const skipped = [{ sessionId: "sid-3", title: "Other window", reason: "no terminal in this window" }];

  it("asks for Start here, one block per session, and Skipped", () => {
    expect(MERGE_SYSTEM_PROMPT).toContain("Start here");
    expect(MERGE_SYSTEM_PROMPT).toContain("Skipped");
    expect(MERGE_SYSTEM_PROMPT).toContain("5");
  });

  it("lists each reply with its title, repo, and branch, then the skipped sessions", () => {
    const mergeInput = buildMergeInput(replies, skipped);
    expect(mergeInput).toContain("Auth fix");
    expect(mergeInput).toContain("api");
    expect(mergeInput).toContain("fix/auth");
    expect(mergeInput).toContain("Fix login");
    expect(mergeInput).toContain("Write docs");
    expect(mergeInput).toContain("Other window");
    expect(mergeInput).toContain("no terminal in this window");
    expect(mergeInput.indexOf("Fix login")).toBeLessThan(mergeInput.indexOf("Other window"));
  });

  it("clips each reply fairly so one long reply cannot crowd out the rest", () => {
    const longReplies = [
      { sessionId: "long", title: "Long", body: "x".repeat(500_000) },
      { sessionId: "short", title: "Short", body: "short body survives" },
    ];
    const mergeInput = buildMergeInput(longReplies, []);
    expect(mergeInput.length).toBeLessThan(70_000);
    expect(mergeInput).toContain("short body survives");
    expect(mergeInput).toContain("…");
  });

  it("builds headless args with the model and the merge system prompt", () => {
    const args = mergeArgs("sonnet");
    expect(args).toContain("-p");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(MERGE_SYSTEM_PROMPT);
    expect(args).not.toContain("--json-schema");
  });
});

describe("fallbackBrief", () => {
  it("joins the raw replies under per-session headings, then the skipped list", () => {
    const brief = fallbackBrief(
      [{ sessionId: "sid-1", title: "Auth fix", repo: "api", branch: "fix/auth", body: "## Goal\nFix login" }],
      [{ sessionId: "sid-3", title: "Other window", reason: "no terminal in this window" }],
      RUN_ID,
    );
    expect(brief).toContain(RUN_ID);
    expect(brief).toContain("## Auth fix");
    expect(brief).toContain("api");
    expect(brief).toContain("Fix login");
    expect(brief).toContain("## Skipped");
    expect(brief).toContain("- Other window: no terminal in this window");
  });

  it("says when there are no replies and nothing was skipped", () => {
    const brief = fallbackBrief([], [], RUN_ID);
    expect(brief).toContain("No replies");
    expect(brief).not.toContain("## Skipped");
  });
});

describe("checkTarget", () => {
  it("sends to an idle session with a terminal here", () => {
    expect(checkTarget(liveSession("sid-1", "idle"), true)).toEqual({ action: "send" });
  });

  it("waits on a busy session", () => {
    expect(checkTarget(liveSession("sid-1", "busy"), true)).toEqual({ action: "wait" });
  });

  it("skips a session that left the live list, went to the background, or lost its terminal", () => {
    expect(checkTarget(undefined, true)).toEqual({ action: "skip", reason: SKIP_REASON_NOT_LIVE });
    expect(checkTarget(liveSession("sid-1", "background"), true)).toEqual({ action: "skip", reason: SKIP_REASON_BACKGROUND });
    expect(checkTarget(liveSession("sid-1", "idle"), false)).toEqual({ action: "skip", reason: SKIP_REASON_TERMINAL_CLOSED });
  });
});

describe("run bookkeeping", () => {
  it("says why a target has no answer, by whether it was asked and how the run ended", () => {
    expect(unansweredReason(true, "timeout")).toBe("no answer before the timeout");
    expect(unansweredReason(false, "timeout")).toBe("busy until the timeout");
    expect(unansweredReason(true, "mergeNow")).toBe("no answer before Merge now");
    expect(unansweredReason(false, "mergeNow")).toBe("busy until Merge now");
  });

  it("reads the timeout in minutes with a floor of one and a default for junk", () => {
    expect(whereAreWeTimeoutMs(5)).toBe(5 * 60_000);
    expect(whereAreWeTimeoutMs(0)).toBe(60_000);
    expect(whereAreWeTimeoutMs("ten")).toBe(DEFAULT_TIMEOUT_MINUTES * 60_000);
    expect(whereAreWeTimeoutMs(Number.NaN)).toBe(DEFAULT_TIMEOUT_MINUTES * 60_000);
  });

  it("shows the answered count over the askable count", () => {
    expect(progressMessage(4, 6)).toBe("4 of 6 answered");
  });

  it("lists each skipped session and its reason when nothing can be asked", () => {
    expect(noTargetsMessage([])).toBe("Where are we: no live sessions to ask.");
    expect(noTargetsMessage([{ sessionId: "sid-1", title: "Auth fix", reason: "no terminal in this window" }])).toBe(
      "Where are we: no session here to ask. Skipped: Auth fix (no terminal in this window).",
    );
  });
});
