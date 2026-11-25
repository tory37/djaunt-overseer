import { describe, expect, it } from "vitest";
import { LiveSession } from "../../src/liveParse";
import {
  MERGE_SYSTEM_PROMPT,
  REPLY_END_SENTINEL,
  DEFAULT_TIMEOUT_MINUTES,
  SKIP_REASON_BACKGROUND,
  SKIP_REASON_NOT_LIVE,
  SKIP_REASON_TERMINAL_CLOSED,
  buildBrief,
  buildMergeInput,
  briefReadyMessage,
  discussPrompt,
  discussSessionName,
  latestBriefRunId,
  briefFile,
  briefHeader,
  noRepliesMessage,
  parseMergeOutput,
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
  COORDINATOR_SYSTEM_PROMPT,
  askReplyFile,
  asksDir,
  combineInstructions,
  coordinatorPrompt,
  followUpPrompt,
  parseAskFileName,
  unreachableReply,
} from "../../src/whereAreWe";

const CLAUDE_HOME = "/home/me/.claude";
const RUN_ID = "2026-11-23T09-05-12";
const REPLY_PATH = "/home/me/.claude/overseer/briefs/2026-11-23T09-05-12/sid-1.md";

function liveSession(sessionId: string, status: LiveSession["status"], name?: string): LiveSession {
  return {
    sessionId,
    agentId: undefined,
    pid: 1,
    kind: "interactive",
    status,
    isWaitingWithBackgroundShell: false,
    name,
    cwd: "/repo",
    processCount: 1,
  };
}

function busyWithBackgroundShell(sessionId: string): LiveSession {
  return { ...liveSession(sessionId, "busy"), isWaitingWithBackgroundShell: true };
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

  it("puts extra instructions on the same line, before the sentinel sentence", () => {
    const prompt = whereAreWePrompt(REPLY_PATH, "mention the ticket\nand the PR");
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain("Extra instructions: mention the ticket and the PR The last line");
    expect(prompt.endsWith(`The last line must be exactly ${REPLY_END_SENTINEL}`)).toBe(true);
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

  it("sends now to a busy session that only waits with a background shell", () => {
    const targets = pickTargets([busyWithBackgroundShell("shell-here")], () => true);
    expect(targets.sendNow.map((session) => session.sessionId)).toEqual(["shell-here"]);
    expect(targets.sendWhenIdle).toEqual([]);
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

describe("brief", () => {
  const replies = [{ sessionId: "sid-1", title: "Auth fix", repo: "api", branch: "fix/auth", body: "## Goal\nFix login" }];
  const skipped = [{ sessionId: "sid-3", title: "Other window", reason: "no terminal in this window" }];
  const mergeStdout = (result: unknown, isError = false): string => JSON.stringify({ is_error: isError, result });

  it("heads the brief with the run id and the counts", () => {
    expect(briefHeader(RUN_ID, 2, 1)).toBe(`# Where are we: ${RUN_ID}\n\n2 answered, 1 skipped.`);
  });

  it("parses the merged markdown from the JSON envelope", () => {
    expect(parseMergeOutput(mergeStdout("  ## Start here\n- Auth fix  "))).toBe("## Start here\n- Auth fix");
  });

  it("rejects an error envelope, empty text, and output that is not JSON", () => {
    expect(() => parseMergeOutput(mergeStdout("rate limited", true))).toThrow("rate limited");
    expect(() => parseMergeOutput(mergeStdout("   "))).toThrow("no text");
    expect(() => parseMergeOutput("not json")).toThrow();
  });

  it("puts the header above the merged markdown", () => {
    const brief = buildBrief({ stdout: mergeStdout("## Start here\n- Auth fix") }, replies, skipped, RUN_ID);
    expect(brief.mergeError).toBeUndefined();
    expect(brief.text).toBe(`${briefHeader(RUN_ID, 1, 1)}\n\n## Start here\n- Auth fix\n`);
  });

  it("falls back to the raw replies when the run fails", () => {
    const brief = buildBrief({ error: "timed out after 300s" }, replies, skipped, RUN_ID);
    expect(brief.mergeError).toBe("timed out after 300s");
    expect(brief.text).toBe(fallbackBrief(replies, skipped, RUN_ID));
  });

  it("falls back to the raw replies when the merge returns nothing", () => {
    const brief = buildBrief({ stdout: mergeStdout("") }, replies, skipped, RUN_ID);
    expect(brief.mergeError).toContain("no text");
    expect(brief.text).toContain("Fix login");
  });

  it("uses the same header in the fallback", () => {
    expect(fallbackBrief(replies, skipped, RUN_ID).startsWith(briefHeader(RUN_ID, 1, 1))).toBe(true);
  });

  it("lists the skipped reasons when no session answered", () => {
    expect(noRepliesMessage(skipped)).toBe("Where are we: no session answered. Skipped: Other window (no terminal in this window).");
    expect(noRepliesMessage([])).toBe("Where are we: no session answered.");
  });
});

describe("discuss", () => {
  it("picks the newest brief by run id and ignores other files", () => {
    const fileNames = ["2026-11-23T09-05-12.md", "2026-11-23T10-00-00.md", "2026-11-22T23-59-59.md", "2026-11-24T00-00-00", "notes.md"];
    expect(latestBriefRunId(fileNames)).toBe("2026-11-23T10-00-00");
  });

  it("finds nothing among run folders and other files", () => {
    expect(latestBriefRunId([RUN_ID, "notes.md"])).toBeUndefined();
    expect(latestBriefRunId([])).toBeUndefined();
  });

  it("asks for one line that reads the brief and replies, then waits without changing code", () => {
    const briefPath = briefFile(CLAUDE_HOME, RUN_ID);
    const runDir = briefRunDir(CLAUDE_HOME, RUN_ID);
    const prompt = discussPrompt(briefPath, runDir);
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain(briefPath);
    expect(prompt).toContain(runDir);
    expect(prompt).toContain("wait for my questions");
    expect(prompt).toContain("Do not change any code");
  });

  it("names the session and the ready notice", () => {
    expect(discussSessionName(RUN_ID)).toBe(`Where are we ${RUN_ID}`);
    expect(briefReadyMessage(2, 1)).toBe("Where are we: brief ready (2 answered, 1 skipped)");
  });
});

describe("checkTarget", () => {
  it("sends to an idle session with a terminal here", () => {
    expect(checkTarget(liveSession("sid-1", "idle"), true)).toEqual({ action: "send" });
  });

  it("waits on a busy session", () => {
    expect(checkTarget(liveSession("sid-1", "busy"), true)).toEqual({ action: "wait" });
  });

  it("sends to a busy session that only waits with a background shell", () => {
    expect(checkTarget(busyWithBackgroundShell("sid-1"), true)).toEqual({ action: "send" });
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

const RUN_DIR = "/home/me/.claude/overseer/briefs/2026-11-23T09-05-12";
const SESSION_UUID = "0b7f3c1e-1a2b-4c3d-8e9f-0123456789ab";

describe("combineInstructions", () => {
  it("puts the setting first, then the run text, on one line", () => {
    expect(combineInstructions("name the PR", "anything for\nRodrigo?")).toBe("name the PR anything for Rodrigo?");
  });

  it("drops blank parts", () => {
    expect(combineInstructions("", "  ")).toBe("");
    expect(combineInstructions(" ", "only this")).toBe("only this");
  });
});

describe("ask files", () => {
  it("parses a question file name into the session id and number", () => {
    expect(parseAskFileName(`${SESSION_UUID}-3.md`)).toEqual({ sessionId: SESSION_UUID, askNumber: 3 });
    expect(parseAskFileName("sid-12.md")).toEqual({ sessionId: "sid", askNumber: 12 });
  });

  it("ignores reply files and anything else", () => {
    expect(parseAskFileName(`${SESSION_UUID}-3.reply.md`)).toBeUndefined();
    expect(parseAskFileName(`${SESSION_UUID}.md`)).toBeUndefined();
    expect(parseAskFileName(`${SESSION_UUID}-3.md.swp`)).toBeUndefined();
    expect(parseAskFileName("-3.md")).toBeUndefined();
    expect(parseAskFileName("../x-1.md")).toBeUndefined();
  });

  it("puts the reply beside the question in the asks folder", () => {
    expect(asksDir(RUN_DIR)).toBe(`${RUN_DIR}/asks`);
    expect(askReplyFile(RUN_DIR, SESSION_UUID, 2)).toBe(`${RUN_DIR}/asks/${SESSION_UUID}-2.reply.md`);
  });

  it("writes an unreachable reply that ends with the sentinel", () => {
    const reply = unreachableReply("sid", "terminal closed");
    expect(reply).toBe(`Session sid is not reachable: terminal closed\n${REPLY_END_SENTINEL}\n`);
    expect(isCompleteReply(reply)).toBe(true);
  });
});

describe("followUpPrompt", () => {
  it("is one line with the question, the reply path, and the sentinel last", () => {
    const replyPath = askReplyFile(RUN_DIR, "sid", 1);
    const prompt = followUpPrompt("Is PR 42\nwaiting on Rodrigo?", replyPath);
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain("Is PR 42 waiting on Rodrigo?");
    expect(prompt).toContain(`only to ${replyPath}`);
    expect(prompt).toContain("overwrite");
    expect(prompt).toContain("Do not change any code");
    expect(prompt.endsWith(`exactly ${REPLY_END_SENTINEL}`)).toBe(true);
  });
});

describe("coordinator prompts", () => {
  it("lists the run prompt, the run folder, the asked sessions, and the skipped ones", () => {
    const prompt = coordinatorPrompt(
      "anything waiting on Rodrigo?",
      RUN_DIR,
      [{ sessionId: "sid-1", title: "Login\nfix", replyPath: `${RUN_DIR}/sid-1.md` }],
      [{ sessionId: "sid-2", title: "Docs", reason: "terminal closed" }],
    );
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt).toContain("Tory's prompt for this run: anything waiting on Rodrigo?");
    expect(prompt).toContain(`Run folder: ${RUN_DIR}`);
    expect(prompt).toContain(`Login fix (session sid-1, reply ${RUN_DIR}/sid-1.md)`);
    expect(prompt).toContain("Docs (session sid-2): terminal closed");
  });

  it("says none for an empty run prompt and no skipped sessions", () => {
    const prompt = coordinatorPrompt("  ", RUN_DIR, [], []);
    expect(prompt).toContain("Tory's prompt for this run: none.");
    expect(prompt).toContain("Sessions skipped: none.");
  });

  it("tells the coordinator about the reply files, the ask channel, and no code changes", () => {
    expect(COORDINATOR_SYSTEM_PROMPT).toContain(REPLY_END_SENTINEL);
    expect(COORDINATOR_SYSTEM_PROMPT).toContain("<runDir>/asks/<sessionId>-<n>.md");
    expect(COORDINATOR_SYSTEM_PROMPT).toContain("<runDir>/asks/<sessionId>-<n>.reply.md");
    expect(COORDINATOR_SYSTEM_PROMPT).toContain("Do not change any code.");
  });
});
